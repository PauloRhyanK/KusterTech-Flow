import io
import json
import pathlib
import subprocess
import sys
import unittest
import urllib.error
import urllib.request
from unittest import mock

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

import motor  # noqa: E402
import motor_warren  # noqa: E402

BASE = "http://127.0.0.1:8080"
TOKEN = "tok-secreto-123"


def json_bytes(obj):
    return json.dumps(obj).encode("utf-8")


class TransporteFalso:
    """Grava as requisições e devolve respostas fixas, na ordem."""

    def __init__(self, *respostas):
        self.respostas = list(respostas)
        self.requisicoes = []

    def __call__(self, metodo, url, headers, corpo):
        self.requisicoes.append((metodo, url, dict(headers), corpo))
        if not self.respostas:
            raise AssertionError("requisição inesperada: %s %s" % (metodo, url))
        resposta = self.respostas.pop(0) if len(self.respostas) > 1 else self.respostas[0]
        return resposta

    @property
    def ultima(self):
        return self.requisicoes[-1]

    def corpo_json(self, indice=-1):
        return json.loads(self.requisicoes[indice][3].decode("utf-8"))


def ok(obj, status=200):
    return (status, {}, json_bytes(obj))


def novo(*respostas, base=BASE):
    transporte = TransporteFalso(*respostas)
    return motor_warren.MotorWarren(base, TOKEN, transporte), transporte


ARGS_PLANO = dict(
    projeto="kustertech-flow",
    plano_seeds="pl-1a2b",
    agente="claude-code",
    modelo="claude-sonnet-5-5",
    prompt_template="leia .fabrica/equipes/backend.md e trabalhe na seed {seed_id}",
    max_custo_usd=7.5,
)

ARGS_RUN = dict(
    projeto="kustertech-flow",
    agente="claude-code",
    modelo="claude-opus-4-7",
    prompt="revise o PR 12",
    branch_existente=None,
    max_custo_usd=3.0,
)


class TestesDespachoWarren(unittest.TestCase):
    def test_despachar_plano_corpo_url_e_autorizacao(self):
        m, t = novo(ok({"planRun": {"id": "pr-9", "state": "pending"}, "children": []}, 201))
        self.assertEqual(m.despachar_plano(**ARGS_PLANO), "pr-9")
        metodo, url, headers, corpo = t.ultima
        self.assertEqual(metodo, "POST")
        self.assertEqual(url, BASE + "/plan-runs")
        self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(
            json.loads(corpo),
            {
                "project": "kustertech-flow",
                "agent": "claude-code",
                "planId": "pl-1a2b",
                "promptTemplate": "leia .fabrica/equipes/backend.md e trabalhe na seed {seed_id}",
                "modelOverride": "claude-sonnet-5-5",
                "maxCostUsd": 7.5,
            },
        )

    def test_aceita_qualquer_2xx(self):
        for status in (200, 201, 202):
            m, _ = novo(ok({"planRun": {"id": "pr-1"}}, status))
            self.assertEqual(m.despachar_plano(**ARGS_PLANO), "pr-1")
            m, _ = novo(ok({"run": {"id": "r-1"}}, status))
            self.assertEqual(m.despachar_run(**ARGS_RUN), "r-1")

    def test_despachar_run_sem_branch_nao_envia_existing_branch(self):
        m, t = novo(ok({"run": {"id": "r-5"}, "sandbox": {}}))
        self.assertEqual(m.despachar_run(**ARGS_RUN), "r-5")
        metodo, url, headers, _ = t.ultima
        self.assertEqual((metodo, url), ("POST", BASE + "/runs"))
        self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)
        self.assertEqual(
            t.corpo_json(),
            {
                "project": "kustertech-flow",
                "agent": "claude-code",
                "prompt": "revise o PR 12",
                "modelOverride": "claude-opus-4-7",
                "maxCostUsd": 3.0,
            },
        )
        self.assertNotIn("existingBranch", t.corpo_json())

    def test_despachar_run_com_branch_envia_existing_branch(self):
        m, t = novo(ok({"run": {"id": "r-6"}}))
        args = dict(ARGS_RUN, branch_existente="feat/clientes")
        m.despachar_run(**args)
        corpo = t.corpo_json()
        self.assertEqual(corpo["existingBranch"], "feat/clientes")
        self.assertEqual(
            sorted(corpo),
            ["agent", "existingBranch", "maxCostUsd", "modelOverride", "project", "prompt"],
        )

    def test_url_base_com_barra_final(self):
        m, t = novo(ok({"run": {"id": "r-1"}}), base=BASE + "/")
        m.despachar_run(**ARGS_RUN)
        self.assertEqual(t.ultima[1], BASE + "/runs")

    def test_retomar_plano_envia_corpo_vazio(self):
        m, t = novo(ok({}))
        self.assertIsNone(m.retomar_plano("pr-3"))
        metodo, url, headers, corpo = t.ultima
        self.assertEqual((metodo, url), ("POST", BASE + "/plan-runs/pr-3/resume"))
        self.assertEqual(json.loads(corpo), {})
        self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)

    def test_token_vazio_e_recusado(self):
        with self.assertRaises(ValueError):
            motor_warren.MotorWarren(BASE, "", TransporteFalso())


PLANO_WARREN = {
    "planRun": {"id": "pr-1", "state": "running", "failureReason": None},
    "children": [
        {"planRunId": "pr-1", "seq": 0, "seedId": "sd-a", "runId": "r-a", "state": "merged", "failureReason": None},
        {"planRunId": "pr-1", "seq": 1, "seedId": "sd-b", "runId": "r-b", "state": "failed", "failureReason": "oom_killed"},
        {"planRunId": "pr-1", "seq": 2, "seedId": "sd-c", "runId": None, "state": "pending", "failureReason": None},
    ],
    "runs": [
        {"id": "r-a", "state": "succeeded", "failureReason": None, "prUrl": "https://gh/pr/1", "costUsd": 1.2},
        {"id": "r-b", "state": "failed", "failureReason": "oom_killed", "prUrl": None, "costUsd": 0.4},
        {"id": "r-x", "state": "succeeded", "prUrl": "https://gh/pr/99"},
    ],
}


class TestesLeituraWarren(unittest.TestCase):
    def test_plano_junta_pr_url_de_runs_pelo_run_id(self):
        m, t = novo(ok(PLANO_WARREN))
        resultado = m.plano("pr-1")
        self.assertEqual(t.ultima[0:2], ("GET", BASE + "/plan-runs/pr-1"))
        self.assertEqual(t.ultima[3], None)
        self.assertEqual(t.ultima[2]["Authorization"], "Bearer " + TOKEN)
        self.assertEqual(
            resultado,
            {
                "estado": "running",
                "falha": None,
                "filhos": [
                    {"seedId": "sd-a", "estado": "merged", "runId": "r-a", "prUrl": "https://gh/pr/1", "falha": None},
                    {"seedId": "sd-b", "estado": "failed", "runId": "r-b", "prUrl": None, "falha": "oom_killed"},
                    {"seedId": "sd-c", "estado": "pending", "runId": None, "prUrl": None, "falha": None},
                ],
            },
        )

    def test_plano_com_falha_e_sem_runs(self):
        corpo = {
            "planRun": {"id": "pr-1", "state": "failed", "failureReason": "merge_timeout"},
            "children": [{"seedId": "sd-a", "runId": "r-a", "state": "dispatched"}],
        }
        m, _ = novo(ok(corpo))
        resultado = m.plano("pr-1")
        self.assertEqual(resultado["estado"], "failed")
        self.assertEqual(resultado["falha"], "merge_timeout")
        self.assertEqual(
            resultado["filhos"],
            [{"seedId": "sd-a", "estado": "dispatched", "runId": "r-a", "prUrl": None, "falha": None}],
        )

    def test_run_mapeia_campos(self):
        corpo = {
            "run": {"id": "r-1", "state": "failed", "failureReason": "oom_killed", "prUrl": "https://gh/pr/2", "costUsd": 2.5}
        }
        m, t = novo(ok(corpo))
        self.assertEqual(
            m.run("r-1"),
            {"estado": "failed", "motivoFalha": "oom_killed", "prUrl": "https://gh/pr/2", "custoUsd": 2.5},
        )
        self.assertEqual(t.ultima[0:2], ("GET", BASE + "/runs/r-1"))

    def test_run_campos_opcionais_ausentes(self):
        m, _ = novo(ok({"run": {"id": "r-1", "state": "running"}}))
        self.assertEqual(
            m.run("r-1"), {"estado": "running", "motivoFalha": None, "prUrl": None, "custoUsd": None}
        )

    def test_ultimo_texto_ignora_linha_quebrada_e_devolve_o_ultimo_text(self):
        eventos = (
            b'{"kind": "text", "payload": {"text": "primeiro"}}\n'
            b'{"kind": "tool", "payload": {"text": "ferramenta"}}\n'
            b"isto nao e json {\n"
            b"\n"
            b'{"kind": "text", "payload": {"text": "VEREDITO: ok"}}\n'
            b'{"kind": "state", "payload": {}}\n'
            b'{"kind": "text", "payload": {"text": "ultimo valido"}}\n'
            b'{"kind": "tool", "payload": {"text": "ferramenta depois"}}\n'
            b'{"kind": "text", "payload": {"text": '
        )
        m, t = novo((200, {}, eventos))
        self.assertEqual(m.ultimo_texto("r-1"), "ultimo valido")
        self.assertEqual(t.ultima[0:2], ("GET", BASE + "/runs/r-1/events?follow=0"))

    def test_ultimo_texto_ignora_text_malformado_e_nao_objetos(self):
        eventos = (
            b'{"kind": "text", "payload": {"text": "bom"}}\n'
            b'{"kind": "text", "payload": {"text": 42}}\n'
            b'{"kind": "text", "payload": "solto"}\n'
            b'{"kind": "text"}\n'
            b"[1, 2]\n"
            b'"texto"\n'
            b"\xff\xfe\n"
        )
        m, _ = novo((200, {}, eventos))
        self.assertEqual(m.ultimo_texto("r-1"), "bom")

    def test_ultimo_texto_sem_eventos_text_devolve_vazio(self):
        m, _ = novo((200, {}, b'{"kind": "state", "payload": {}}\n'))
        self.assertEqual(m.ultimo_texto("r-1"), "")
        m, _ = novo((200, {}, b""))
        self.assertEqual(m.ultimo_texto("r-1"), "")

    def test_ultimo_texto_aceita_crlf(self):
        m, _ = novo((200, {}, b'{"kind": "text", "payload": {"text": "a"}}\r\n'))
        self.assertEqual(m.ultimo_texto("r-1"), "a")


class TestesErrosWarren(unittest.TestCase):
    def test_429_levanta_motor_ocupado_com_retry_after(self):
        m, _ = novo((429, {"Retry-After": "12"}, b'{"error": {"code": "busy", "message": "x"}}'))
        with self.assertRaises(motor.MotorOcupado) as ctx:
            m.despachar_plano(**ARGS_PLANO)
        self.assertEqual(ctx.exception.retry_after, 12)
        self.assertIsInstance(ctx.exception.retry_after, int)

    def test_429_retry_after_em_minusculas_e_padrao_30(self):
        m, _ = novo((429, {"retry-after": "7"}, b""))
        with self.assertRaises(motor.MotorOcupado) as ctx:
            m.despachar_run(**ARGS_RUN)
        self.assertEqual(ctx.exception.retry_after, 7)
        for headers in ({}, {"Retry-After": "amanha"}, {"Retry-After": ""}):
            m, _ = novo((429, headers, b""))
            with self.assertRaises(motor.MotorOcupado) as ctx:
                m.despachar_run(**ARGS_RUN)
            self.assertEqual(ctx.exception.retry_after, 30)

    def test_429_tambem_em_leitura(self):
        m, _ = novo((429, {"Retry-After": "5"}, b""))
        with self.assertRaises(motor.MotorOcupado):
            m.plano("pr-1")

    def test_motor_ocupado_e_exception_com_retry_after(self):
        erro = motor.MotorOcupado(9)
        self.assertIsInstance(erro, Exception)
        self.assertEqual(erro.retry_after, 9)

    def test_erro_http_nao_vaza_corpo_nem_token(self):
        for status in (400, 401, 404, 500, 503):
            m, _ = novo((status, {}, b"segredo ghs_x " + TOKEN.encode()))
            with self.assertRaises(RuntimeError) as ctx:
                m.despachar_plano(**ARGS_PLANO)
            msg = str(ctx.exception)
            self.assertNotIn("ghs_", msg)
            self.assertNotIn("segredo", msg)
            self.assertNotIn(TOKEN, msg)
            self.assertIn("POST", msg)
            self.assertIn("/plan-runs", msg)
            self.assertIn(str(status), msg)

    def test_erro_http_em_get_cita_metodo_caminho_e_status(self):
        m, _ = novo((404, {}, b"nada"))
        with self.assertRaises(RuntimeError) as ctx:
            m.run("r-9")
        msg = str(ctx.exception)
        self.assertIn("GET", msg)
        self.assertIn("/runs/r-9", msg)
        self.assertIn("404", msg)

    def test_status_nao_2xx_abaixo_de_400_tambem_e_erro(self):
        for status in (199, 300, 301, 302, 304):
            corpo = json_bytes({"run": {"id": "r-1", "state": "running"}})
            m, _ = novo((status, {"Location": "http://outro"}, corpo))
            with self.assertRaises(RuntimeError) as ctx:
                m.run("r-1")
            self.assertIn(str(status), str(ctx.exception))

    def test_erro_em_eventos_e_resume(self):
        m, _ = novo((500, {}, b"ghs_x"))
        with self.assertRaises(RuntimeError) as ctx:
            m.ultimo_texto("r-1")
        self.assertNotIn("ghs_", str(ctx.exception))
        m, _ = novo((500, {}, b"ghs_x"))
        with self.assertRaises(RuntimeError):
            m.retomar_plano("pr-1")

    def test_falha_de_rede_vira_runtime_error_sem_detalhes(self):
        def transporte(metodo, url, headers, corpo):
            raise urllib.error.URLError("recusado " + headers["Authorization"])

        m = motor_warren.MotorWarren(BASE, TOKEN, transporte)
        with self.assertRaises(RuntimeError) as ctx:
            m.run("r-1")
        msg = str(ctx.exception)
        self.assertNotIn(TOKEN, msg)
        self.assertIn("GET", msg)
        self.assertIn("/runs/r-1", msg)

    def test_id_e_codificado_no_caminho(self):
        malicioso = "../x?y#z/w"
        codificado = "..%2Fx%3Fy%23z%2Fw"
        m, t = novo(ok({"run": {"id": "r", "state": "running"}}))
        m.run(malicioso)
        self.assertEqual(t.ultima[1], BASE + "/runs/" + codificado)
        m, t = novo(ok(PLANO_WARREN))
        m.plano(malicioso)
        self.assertEqual(t.ultima[1], BASE + "/plan-runs/" + codificado)
        m, t = novo((200, {}, b""))
        m.ultimo_texto(malicioso)
        self.assertEqual(t.ultima[1], BASE + "/runs/" + codificado + "/events?follow=0")
        m, t = novo(ok({}))
        m.retomar_plano(malicioso)
        self.assertEqual(t.ultima[1], BASE + "/plan-runs/" + codificado + "/resume")

    def test_id_com_caracteres_comuns_do_warren_passa_intacto(self):
        m, t = novo(ok({"run": {"id": "r", "state": "running"}}))
        m.run("run_01H-abc.9")
        self.assertEqual(t.ultima[1], BASE + "/runs/run_01H-abc.9")


class TestesFormatoInesperado(unittest.TestCase):
    def assert_formato(self, chamada, resposta, campo):
        m, _ = novo(resposta)
        with self.assertRaises(RuntimeError) as ctx:
            chamada(m)
        msg = str(ctx.exception)
        self.assertIn(campo, msg)
        self.assertNotIn("segredo", msg)
        self.assertNotIn(TOKEN, msg)

    def test_despachar_plano_sem_plan_run_id(self):
        chamada = lambda m: m.despachar_plano(**ARGS_PLANO)  # noqa: E731
        for corpo in ({}, {"planRun": {}}, {"planRun": None}, {"planRun": []}, {"planRun": {"id": ""}}, {"planRun": {"id": 7}}):
            self.assert_formato(chamada, ok(corpo), "planRun.id")

    def test_despachar_run_sem_run_id(self):
        chamada = lambda m: m.despachar_run(**ARGS_RUN)  # noqa: E731
        for corpo in ({}, {"run": {}}, {"run": None}, {"run": {"id": None}}):
            self.assert_formato(chamada, ok(corpo), "run.id")

    def test_resposta_que_nao_e_json_ou_nao_e_objeto(self):
        chamada = lambda m: m.despachar_plano(**ARGS_PLANO)  # noqa: E731
        for bruto in (b"segredo nao json", b"", b"[1]", b'"texto"', b"\xff\xfe"):
            m, _ = novo((200, {}, bruto))
            with self.assertRaises(RuntimeError) as ctx:
                chamada(m)
            self.assertNotIn("segredo", str(ctx.exception))
            self.assertIn("POST", str(ctx.exception))

    def test_plano_campos_obrigatorios(self):
        chamada = lambda m: m.plano("pr-1")  # noqa: E731
        self.assert_formato(chamada, ok({}), "planRun")
        self.assert_formato(chamada, ok({"planRun": {"id": "p"}, "children": []}), "planRun.state")
        self.assert_formato(chamada, ok({"planRun": {"state": "running"}}), "children")
        self.assert_formato(chamada, ok({"planRun": {"state": "running"}, "children": {}}), "children")
        self.assert_formato(
            chamada,
            ok({"planRun": {"state": "running"}, "children": [{"state": "pending"}]}),
            "seedId",
        )
        self.assert_formato(
            chamada,
            ok({"planRun": {"state": "running"}, "children": [{"seedId": "a"}]}),
            "state",
        )
        self.assert_formato(
            chamada,
            ok({"planRun": {"state": "running"}, "children": ["x"]}),
            "children",
        )
        self.assert_formato(
            chamada,
            ok({"planRun": {"state": "running"}, "children": [], "runs": {}}),
            "runs",
        )

    def test_run_campos_obrigatorios(self):
        chamada = lambda m: m.run("r-1")  # noqa: E731
        self.assert_formato(chamada, ok({}), "run")
        self.assert_formato(chamada, ok({"run": {"id": "r"}}), "run.state")
        self.assert_formato(chamada, ok({"run": []}), "run")


class TransporteUrllibTestes(unittest.TestCase):
    def resposta_falsa(self, status=200, headers=None, corpo=b"{}"):
        r = mock.MagicMock()
        r.status = status
        r.headers = headers or {}
        r.read.return_value = corpo
        r.__enter__.return_value = r
        r.__exit__.return_value = False
        return r

    def test_timeouts_30_para_requisicao_e_180_para_eventos(self):
        with mock.patch.object(motor_warren, "_abrir", return_value=self.resposta_falsa()) as abrir:
            motor_warren._transporte_urllib("GET", BASE + "/runs/r-1", {"A": "b"}, None)
            motor_warren._transporte_urllib("GET", BASE + "/runs/r-1/events?follow=0", {}, None)
        self.assertEqual(abrir.call_args_list[0].kwargs["timeout"], 30)
        self.assertEqual(abrir.call_args_list[1].kwargs["timeout"], 180)

    def test_monta_requisicao_e_devolve_status_headers_e_corpo(self):
        resposta = self.resposta_falsa(201, {"X-Teste": "1"}, b'{"a": 1}')
        with mock.patch.object(motor_warren, "_abrir", return_value=resposta) as abrir:
            status, headers, corpo = motor_warren._transporte_urllib(
                "POST", BASE + "/runs", {"Authorization": "Bearer t"}, b"{}"
            )
        self.assertEqual((status, corpo), (201, b'{"a": 1}'))
        self.assertEqual(headers["X-Teste"], "1")
        req = abrir.call_args.args[0]
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.full_url, BASE + "/runs")
        self.assertEqual(req.data, b"{}")
        self.assertEqual(req.get_header("Authorization"), "Bearer t")

    def test_http_error_vira_tupla_com_status_headers_e_corpo(self):
        erro = urllib.error.HTTPError(
            BASE + "/runs", 429, "busy", {"Retry-After": "12"}, io.BytesIO(b"corpo")
        )
        with mock.patch.object(motor_warren, "_abrir", side_effect=erro):
            status, headers, corpo = motor_warren._transporte_urllib("POST", BASE + "/runs", {}, b"{}")
        self.assertEqual(status, 429)
        self.assertEqual(headers["Retry-After"], "12")
        self.assertEqual(corpo, b"corpo")

    def test_padrao_do_motor_usa_urllib_e_trata_429_e_500(self):
        erro429 = urllib.error.HTTPError(BASE + "/runs", 429, "busy", {"Retry-After": "12"}, io.BytesIO(b""))
        erro500 = urllib.error.HTTPError(BASE + "/runs", 500, "boom", {}, io.BytesIO(b"segredo ghs_x"))
        m = motor_warren.MotorWarren(BASE, TOKEN)
        with mock.patch.object(motor_warren, "_abrir", side_effect=erro429):
            with self.assertRaises(motor.MotorOcupado) as ctx:
                m.despachar_run(**ARGS_RUN)
        self.assertEqual(ctx.exception.retry_after, 12)
        with mock.patch.object(motor_warren, "_abrir", side_effect=erro500):
            with self.assertRaises(RuntimeError) as ctx:
                m.despachar_run(**ARGS_RUN)
        self.assertNotIn("ghs_", str(ctx.exception))

    def test_padrao_do_motor_le_resposta_ok(self):
        resposta = self.resposta_falsa(200, {}, json_bytes({"run": {"id": "r-7"}}))
        m = motor_warren.MotorWarren(BASE, TOKEN)
        with mock.patch.object(motor_warren, "_abrir", return_value=resposta):
            self.assertEqual(m.despachar_run(**ARGS_RUN), "r-7")

    def test_nao_segue_redirecionamento(self):
        handler = motor_warren._SemRedirecionamento()
        req = urllib.request.Request(BASE + "/runs", headers={"Authorization": "Bearer t"})
        self.assertIsNone(handler.redirect_request(req, None, 302, "Found", {}, "http://outro/x"))


class TestesMotorFalso(unittest.TestCase):
    def test_lotar_faz_o_proximo_despacho_levantar_e_o_seguinte_funcionar(self):
        m = motor.MotorFalso()
        m.lotar()
        with self.assertRaises(motor.MotorOcupado) as ctx:
            m.despachar_plano(**ARGS_PLANO)
        self.assertEqual(ctx.exception.retry_after, 30)
        plano_id = m.despachar_plano(**ARGS_PLANO)
        self.assertTrue(plano_id)
        m.lotar(retry_after=5)
        with self.assertRaises(motor.MotorOcupado) as ctx:
            m.despachar_run(**ARGS_RUN)
        self.assertEqual(ctx.exception.retry_after, 5)
        self.assertTrue(m.despachar_run(**ARGS_RUN))

    def test_lotar_nao_afeta_leituras(self):
        m = motor.MotorFalso()
        m.definir_run("r-1", estado="running")
        m.lotar()
        self.assertEqual(m.run("r-1")["estado"], "running")
        with self.assertRaises(motor.MotorOcupado):
            m.despachar_run(**ARGS_RUN)

    def test_registra_chamadas_com_nome_e_argumentos(self):
        m = motor.MotorFalso()
        plano_id = m.despachar_plano(**ARGS_PLANO)
        run_id = m.despachar_run(**dict(ARGS_RUN, branch_existente="feat/x"))
        m.definir_run(run_id, estado="succeeded")
        m.definir_texto(run_id, "texto")
        m.plano(plano_id)
        m.run(run_id)
        m.ultimo_texto(run_id)
        m.retomar_plano(plano_id)
        self.assertEqual(
            m.chamadas,
            [
                ("despachar_plano", ARGS_PLANO),
                ("despachar_run", dict(ARGS_RUN, branch_existente="feat/x")),
                ("plano", {"plan_run_id": plano_id}),
                ("run", {"run_id": run_id}),
                ("ultimo_texto", {"run_id": run_id}),
                ("retomar_plano", {"plan_run_id": plano_id}),
            ],
        )

    def test_chamada_lotada_tambem_e_registrada(self):
        m = motor.MotorFalso()
        m.lotar()
        with self.assertRaises(motor.MotorOcupado):
            m.despachar_plano(**ARGS_PLANO)
        self.assertEqual([c[0] for c in m.chamadas], ["despachar_plano"])

    def test_ids_distintos_por_despacho(self):
        m = motor.MotorFalso()
        self.assertNotEqual(m.despachar_plano(**ARGS_PLANO), m.despachar_plano(**ARGS_PLANO))
        self.assertNotEqual(m.despachar_run(**ARGS_RUN), m.despachar_run(**ARGS_RUN))

    def test_definir_plano_aceita_e_devolve_falha_dos_filhos(self):
        m = motor.MotorFalso()
        m.definir_plano(
            "pr-1",
            "running",
            [
                {"seedId": "sd-a", "estado": "failed", "runId": "r-a", "prUrl": None, "falha": "oom_killed"},
                {"seedId": "sd-b", "estado": "pending", "runId": None, "prUrl": None},
            ],
        )
        self.assertEqual(
            m.plano("pr-1"),
            {
                "estado": "running",
                "falha": None,
                "filhos": [
                    {"seedId": "sd-a", "estado": "failed", "runId": "r-a", "prUrl": None, "falha": "oom_killed"},
                    {"seedId": "sd-b", "estado": "pending", "runId": None, "prUrl": None, "falha": None},
                ],
            },
        )

    def test_definir_plano_falha_do_plano(self):
        m = motor.MotorFalso()
        m.definir_plano("pr-1", "failed", [], falha="merge_timeout")
        self.assertEqual(m.plano("pr-1")["falha"], "merge_timeout")

    def test_plano_devolve_copia(self):
        m = motor.MotorFalso()
        filhos = [{"seedId": "sd-a", "estado": "pending", "runId": None, "prUrl": None}]
        m.definir_plano("pr-1", "running", filhos)
        filhos[0]["estado"] = "merged"
        m.plano("pr-1")["filhos"][0]["estado"] = "failed"
        self.assertEqual(m.plano("pr-1")["filhos"][0]["estado"], "pending")

    def test_definir_run_mescla_campos(self):
        m = motor.MotorFalso()
        m.definir_run("r-1", estado="running")
        self.assertEqual(
            m.run("r-1"), {"estado": "running", "motivoFalha": None, "prUrl": None, "custoUsd": 0.0}
        )
        m.definir_run("r-1", estado="failed", motivoFalha="oom_killed", custoUsd=1.5)
        self.assertEqual(
            m.run("r-1"), {"estado": "failed", "motivoFalha": "oom_killed", "prUrl": None, "custoUsd": 1.5}
        )
        m.run("r-1")["estado"] = "x"
        self.assertEqual(m.run("r-1")["estado"], "failed")

    def test_definir_run_rejeita_campo_desconhecido(self):
        m = motor.MotorFalso()
        with self.assertRaises(ValueError):
            m.definir_run("r-1", estdo="running")

    def test_texto_padrao_vazio_e_definido(self):
        m = motor.MotorFalso()
        m.definir_run("r-1")
        self.assertEqual(m.ultimo_texto("r-1"), "")
        m.definir_texto("r-1", "VEREDITO")
        self.assertEqual(m.ultimo_texto("r-1"), "VEREDITO")

    def test_ids_desconhecidos_levantam_key_error(self):
        m = motor.MotorFalso()
        with self.assertRaises(KeyError):
            m.plano("nao-existe")
        with self.assertRaises(KeyError):
            m.run("nao-existe")

    def test_despacho_cria_plano_e_run_consultaveis(self):
        m = motor.MotorFalso()
        plano_id = m.despachar_plano(**ARGS_PLANO)
        self.assertEqual(m.plano(plano_id)["filhos"], [])
        run_id = m.despachar_run(**ARGS_RUN)
        self.assertEqual(m.run(run_id)["estado"], "running")

    def test_falso_e_warren_cumprem_o_protocolo(self):
        self.assertIsInstance(motor.MotorFalso(), motor.Motor)
        self.assertIsInstance(motor_warren.MotorWarren(BASE, TOKEN, TransporteFalso()), motor.Motor)


class TestesExecucaoDireta(unittest.TestCase):
    def test_modulos_importam_so_com_biblioteca_padrao_em_modo_isolado(self):
        resultado = subprocess.run(
            [sys.executable, "-I", "-c", "import sys; sys.path.insert(0, %r); import motor, motor_warren" % str(RAIZ)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(resultado.returncode, 0, resultado.stderr)


if __name__ == "__main__":
    unittest.main()
