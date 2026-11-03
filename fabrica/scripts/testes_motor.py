import datetime
import errno
import http.client
import io
import json
import pathlib
import subprocess
import sys
import traceback
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
        return self.respostas.pop(0)

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
        self.assertEqual(len(t.requisicoes), 1)
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
            m, t = novo(ok({"planRun": {"id": "pr-1"}}, status))
            self.assertEqual(m.despachar_plano(**ARGS_PLANO), "pr-1")
            self.assertEqual(len(t.requisicoes), 1)
            m, t = novo(ok({"run": {"id": "r-1"}}, status))
            self.assertEqual(m.despachar_run(**ARGS_RUN), "r-1")
            self.assertEqual(len(t.requisicoes), 1)

    def test_despachar_run_sem_branch_nao_envia_existing_branch(self):
        m, t = novo(ok({"run": {"id": "r-5"}, "sandbox": {}}))
        self.assertEqual(m.despachar_run(**ARGS_RUN), "r-5")
        self.assertEqual(len(t.requisicoes), 1)
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

    def test_branch_vazio_nao_envia_existing_branch(self):
        m, t = novo(ok({"run": {"id": "r-5"}}))
        m.despachar_run(**dict(ARGS_RUN, branch_existente=""))
        self.assertNotIn("existingBranch", t.corpo_json())

    def test_despachar_run_com_branch_envia_existing_branch(self):
        m, t = novo(ok({"run": {"id": "r-6"}}))
        args = dict(ARGS_RUN, branch_existente="feat/clientes")
        m.despachar_run(**args)
        self.assertEqual(len(t.requisicoes), 1)
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
        self.assertEqual(len(t.requisicoes), 1)
        metodo, url, headers, corpo = t.ultima
        self.assertEqual((metodo, url), ("POST", BASE + "/plan-runs/pr-3/resume"))
        self.assertEqual(json.loads(corpo), {})
        self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)

    def test_token_vazio_e_recusado(self):
        for token in ("", "  \n", None, 5):
            with self.assertRaises(ValueError):
                motor_warren.MotorWarren(BASE, token, TransporteFalso())

    def test_token_com_quebra_de_linha_final_e_limpo(self):
        t = TransporteFalso(ok({"run": {"id": "r-1", "state": "running"}}))
        m = motor_warren.MotorWarren(BASE, "abc\n", t)
        m.run("r-1")
        self.assertEqual(t.ultima[2]["Authorization"], "Bearer abc")

    def test_token_com_espaco_interno_ou_controle_e_invalido_e_nao_vaza(self):
        for token in ("a b", "a\tb", "ab\x00c", "ab\ncd", "toké"):
            with self.assertRaises(ValueError) as ctx:
                motor_warren.MotorWarren(BASE, token, TransporteFalso())
            self.assertEqual(str(ctx.exception), "token inválido")
            self.assertNotIn(token.strip(), str(ctx.exception))


PLANO_WARREN = {
    "planRun": {"id": "pr-1", "state": "running", "failureReason": None},
    "children": [
        {"planRunId": "pr-1", "seq": 0, "seedId": "sd-a", "runId": "r-a", "state": "merged", "failureReason": None},
        {"planRunId": "pr-1", "seq": 1, "seedId": "sd-b", "runId": "r-b", "state": "failed", "failureReason": "child_oom_killed"},
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


class TestesRodada1(unittest.TestCase):
    def plano_com_filho(self, filho, runs=None):
        corpo = {
            "planRun": {"id": "pr-1", "state": "running", "failureReason": None},
            "children": [dict({"seedId": "sd-a", "state": "failed", "runId": None}, **filho)],
        }
        if runs is not None:
            corpo["runs"] = runs
        m, t = novo(ok(corpo))
        return m.plano("pr-1")["filhos"][0], t

    # A: `falha` do filho é sempre um RunFailureReason sem o prefixo `child_`

    def test_falha_so_do_filho_perde_o_prefixo_child(self):
        for runs in (None, [], [{"id": "r-a", "state": "failed"}], [{"id": "r-a", "failureReason": None}],
                     [{"id": "r-a", "failureReason": ""}], [{"id": "r-a", "failureReason": 5}]):
            filho, _ = self.plano_com_filho(
                {"runId": "r-a", "failureReason": "child_oom_killed"}, runs
            )
            self.assertEqual(filho["falha"], "oom_killed")

    def test_falha_do_run_tem_prioridade_sobre_a_do_filho(self):
        filho, _ = self.plano_com_filho(
            {"runId": "r-a", "failureReason": "child_failed"},
            [{"id": "r-a", "state": "failed", "failureReason": "oom_killed"}],
        )
        self.assertEqual(filho["falha"], "oom_killed")

    def test_falha_do_run_vem_do_run_do_filho_e_nao_de_outro(self):
        filho, _ = self.plano_com_filho(
            {"runId": "r-a", "failureReason": "child_timeout"},
            [{"id": "r-x", "failureReason": "oom_killed"}, {"id": "r-a", "failureReason": None}],
        )
        self.assertEqual(filho["falha"], "timeout")

    def test_falha_com_estado_do_run_quando_nao_ha_motivo(self):
        filho, _ = self.plano_com_filho({"runId": "r-a", "failureReason": "child_cancelled"})
        self.assertEqual(filho["falha"], "cancelled")

    def test_codigos_compostos_do_warren_passam_adiante(self):
        for motivo in (
            "dispatch_failed:burrow unreachable",
            "child_seed_not_found:warren-a",
            "child_seed_not_resolved:sd-9",
        ):
            filho, _ = self.plano_com_filho({"failureReason": motivo})
            self.assertEqual(filho["falha"], motivo)

    def test_sem_nenhum_motivo_a_falha_e_none(self):
        for motivo in (None, "", 7, "child_"):
            filho, _ = self.plano_com_filho({"runId": "r-a", "failureReason": motivo}, [{"id": "r-a"}])
            if motivo == "child_":
                self.assertEqual(filho["falha"], "child_")
            else:
                self.assertIsNone(filho["falha"])
        filho, _ = self.plano_com_filho({"state": "pending"})
        self.assertIsNone(filho["falha"])

    def test_falha_do_plano_continua_crua(self):
        corpo = {
            "planRun": {"state": "failed", "failureReason": "child_pr_merge_timeout"},
            "children": [],
        }
        m, _ = novo(ok(corpo))
        self.assertEqual(m.plano("pr-1")["falha"], "child_pr_merge_timeout")

    # B e J: último texto

    def test_ultimo_texto_nao_quebra_em_separadores_unicode(self):
        texto = "antes\u2028meio\u2029fim\x85fim\x0b\x0c\x1c"
        evento = json.dumps({"kind": "text", "payload": {"text": texto}}, ensure_ascii=False)
        antigo = json.dumps({"kind": "text", "payload": {"text": "antigo"}})
        bruto = (antigo + "\n" + evento + "\n").encode("utf-8")
        m, _ = novo((200, {}, bruto))
        self.assertEqual(m.ultimo_texto("r-1"), texto)

    def test_ultimo_texto_tolera_cr_no_fim_da_linha(self):
        m, _ = novo((200, {}, b'{"kind": "text", "payload": {"text": "a"}}\r\n{"kind": "text", "payload": {"text": "b"}}\r'))
        self.assertEqual(m.ultimo_texto("r-1"), "b")

    def test_ultimo_texto_ignora_texto_vazio_ou_so_com_espacos(self):
        eventos = (
            b'{"kind": "text", "payload": {"text": "VEREDITO aprovado"}}\n'
            b'{"kind": "text", "payload": {"text": ""}}\n'
            b'{"kind": "text", "payload": {"text": "  \\n\\t "}}\n'
        )
        m, _ = novo((200, {}, eventos))
        self.assertEqual(m.ultimo_texto("r-1"), "VEREDITO aprovado")
        m, _ = novo((200, {}, b'{"kind": "text", "payload": {"text": " "}}\n'))
        self.assertEqual(m.ultimo_texto("r-1"), "")

    # C: falhas de transporte

    def test_transporte_padrao_converte_falhas_em_runtime_error(self):
        erros = [
            http.client.IncompleteRead(b"segredo ghs_x"),
            http.client.BadStatusLine("segredo ghs_x"),
            http.client.RemoteDisconnected("segredo ghs_x"),
            urllib.error.URLError("segredo ghs_x"),
            TimeoutError("segredo ghs_x"),
            ConnectionResetError("segredo ghs_x"),
            OSError("segredo ghs_x"),
        ]
        for erro in erros:
            with mock.patch.object(motor_warren, "_abrir", side_effect=erro):
                with self.assertRaises(RuntimeError) as ctx:
                    motor_warren._transporte_urllib("GET", BASE + "/runs/r-1/events?follow=0", {}, None)
            msg = str(ctx.exception)
            self.assertIn("GET", msg)
            self.assertIn("/runs/r-1/events", msg)
            self.assertIn(type(erro).__name__, msg)
            self.assertNotIn("segredo", msg)
            self.assertNotIn("ghs_", msg)
            self.assertIs(ctx.exception.__cause__, erro)

    def test_transporte_padrao_converte_falha_na_leitura_do_corpo(self):
        resposta = mock.MagicMock()
        resposta.status = 200
        resposta.headers = {}
        resposta.read.side_effect = http.client.IncompleteRead(b"segredo")
        resposta.__enter__.return_value = resposta
        resposta.__exit__.return_value = False
        with mock.patch.object(motor_warren, "_abrir", return_value=resposta):
            with self.assertRaises(RuntimeError) as ctx:
                motor_warren._transporte_urllib("POST", BASE + "/runs", {}, b"{}")
        self.assertIn("IncompleteRead", str(ctx.exception))
        self.assertNotIn("segredo", str(ctx.exception))

    def test_transporte_padrao_converte_falha_na_leitura_do_corpo_de_erro_http(self):
        fp = mock.MagicMock()
        fp.read.side_effect = http.client.IncompleteRead(b"segredo")
        erro = urllib.error.HTTPError(BASE + "/runs", 500, "boom", {}, fp)
        with mock.patch.object(motor_warren, "_abrir", side_effect=erro):
            with self.assertRaises(RuntimeError) as ctx:
                motor_warren._transporte_urllib("POST", BASE + "/runs", {}, b"{}")
        self.assertIn("IncompleteRead", str(ctx.exception))

    def test_falha_de_transporte_injetado_nao_vaza_nem_encadeia_o_token(self):
        for erro in (urllib.error.URLError("x"), OSError("x"), TimeoutError("x")):

            def transporte(metodo, url, headers, corpo, erro=erro):
                raise type(erro)("tok " + headers["Authorization"])

            m = motor_warren.MotorWarren(BASE, TOKEN, transporte)
            with self.assertRaises(RuntimeError) as ctx:
                m.run("r-1")
            impresso = "".join(traceback.format_exception(ctx.exception))
            self.assertNotIn(TOKEN, impresso)

    def test_opener_padrao_nao_segue_redirecionamento(self):
        tipos = [type(h) for h in motor_warren._OPENER.handlers]
        self.assertIn(motor_warren._SemRedirecionamento, tipos)
        self.assertNotIn(urllib.request.HTTPRedirectHandler, tipos)

    # F: envelope de erro real do Warren

    def test_envelope_json_de_erro_nao_vaza_na_mensagem(self):
        envelope = json_bytes({"error": {"code": "x", "message": "segredo ghs_abc " + TOKEN, "hint": "dica"}})
        for status in (400, 404, 422, 500):
            for chamada in (
                lambda m: m.despachar_plano(**ARGS_PLANO),
                lambda m: m.despachar_run(**ARGS_RUN),
                lambda m: m.plano("pr-1"),
                lambda m: m.run("r-1"),
                lambda m: m.ultimo_texto("r-1"),
                lambda m: m.retomar_plano("pr-1"),
            ):
                m, t = novo((status, {}, envelope))
                with self.assertRaises(RuntimeError) as ctx:
                    chamada(m)
                self.assertEqual(len(t.requisicoes), 1)
                msg = str(ctx.exception)
                for proibido in ("ghs_", "segredo", TOKEN, "dica", '"code"'):
                    self.assertNotIn(proibido, msg)
                self.assertIn(str(status), msg)

    # H: entradas malformadas

    def test_runs_e_run_id_malformados_dao_runtime_error_com_o_campo(self):
        base = {"planRun": {"state": "running"}}
        casos = [
            ({"children": [], "runs": [{"id": ["x"]}]}, "runs[]"),
            ({"children": [], "runs": [{}]}, "runs[]"),
            ({"children": [], "runs": ["x"]}, "runs"),
            ({"children": [], "runs": [None]}, "runs"),
            ({"children": [], "runs": [{"id": ""}]}, "runs[]"),
            ({"children": [{"seedId": "a", "state": "x", "runId": ["r"]}], "runs": []}, "children[].runId"),
            ({"children": [{"seedId": "a", "state": "x", "runId": {"a": 1}}]}, "children[].runId"),
            ({"children": [{"seedId": "a", "state": "x", "runId": 5}]}, "children[].runId"),
        ]
        for extra, campo in casos:
            m, _ = novo(ok(dict(base, **extra)))
            with self.assertRaises(RuntimeError) as ctx:
                m.plano("pr-1")
            self.assertIn(campo, str(ctx.exception))

    # I: ids inválidos

    def test_ids_invalidos_levantam_value_error_sem_requisicao(self):
        for invalido in ("", ".", "..", None, 7, b"r-1", ["r"]):
            for chamada in (
                lambda m, i: m.plano(i),
                lambda m, i: m.run(i),
                lambda m, i: m.ultimo_texto(i),
                lambda m, i: m.retomar_plano(i),
            ):
                m, t = novo(ok({}))
                with self.assertRaises(ValueError) as ctx:
                    chamada(m, invalido)
                self.assertEqual(str(ctx.exception), "id inválido")
                self.assertEqual(t.requisicoes, [])

    def test_id_com_pontos_dentro_de_um_nome_e_valido(self):
        m, t = novo(ok({"run": {"id": "r", "state": "running"}}))
        m.run("...")
        self.assertEqual(t.ultima[1], BASE + "/runs/...")

    # K: bootstrap de sys.path

    def test_motor_warren_importa_sozinho_em_modo_isolado(self):
        resultado = subprocess.run(
            [sys.executable, "-I", "-B", str(RAIZ / "motor_warren.py")],
            capture_output=True,
            text=True,
            cwd="/",
        )
        self.assertEqual(resultado.returncode, 0, resultado.stderr)


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
                ("despachar_run", dict(ARGS_RUN, branch_existente="feat/x", chave_idempotencia=None)),
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

    def test_armazenamento_por_id_mantem_dados_separados(self):
        m = motor.MotorFalso()
        m.definir_run("r-1", estado="running", custoUsd=1.0)
        m.definir_run("r-2", estado="failed", motivoFalha="oom_killed", prUrl="https://gh/2")
        m.definir_plano("p-1", "running", [{"seedId": "a", "estado": "pending"}])
        m.definir_plano("p-2", "failed", [{"seedId": "b", "estado": "merged"}], falha="x")
        m.definir_texto("r-1", "texto um")
        m.definir_texto("r-2", "texto dois")
        self.assertEqual(m.run("r-1")["estado"], "running")
        self.assertEqual(m.run("r-1")["custoUsd"], 1.0)
        self.assertEqual(m.run("r-2")["estado"], "failed")
        self.assertEqual(m.run("r-2")["prUrl"], "https://gh/2")
        self.assertEqual(m.plano("p-1")["filhos"][0]["seedId"], "a")
        self.assertEqual(m.plano("p-1")["falha"], None)
        self.assertEqual(m.plano("p-2")["filhos"][0]["seedId"], "b")
        self.assertEqual(m.plano("p-2")["falha"], "x")
        self.assertEqual(m.ultimo_texto("r-1"), "texto um")
        self.assertEqual(m.ultimo_texto("r-2"), "texto dois")

    def test_id_desconhecido_tem_comportamento_definido(self):
        m = motor.MotorFalso()
        m.definir_run("r-1")
        m.definir_texto("r-1", "texto")
        with self.assertRaises(KeyError):
            m.run("r-2")
        with self.assertRaises(KeyError):
            m.plano("p-2")
        self.assertEqual(m.ultimo_texto("r-2"), "")

    def test_leituras_e_retomada_nao_consomem_a_lotacao(self):
        m = motor.MotorFalso()
        m.definir_run("r-1")
        m.definir_plano("p-1", "running", [])
        m.lotar(3)
        m.plano("p-1")
        m.run("r-1")
        m.ultimo_texto("r-1")
        m.retomar_plano("p-1")
        with self.assertRaises(motor.MotorOcupado) as ctx:
            m.despachar_plano(**ARGS_PLANO)
        self.assertEqual(ctx.exception.retry_after, 3)

    def test_falso_e_warren_cumprem_o_protocolo(self):
        self.assertIsInstance(motor.MotorFalso(), motor.Motor)
        self.assertIsInstance(motor_warren.MotorWarren(BASE, TOKEN, TransporteFalso()), motor.Motor)


class TestesModeloEfetivo(unittest.TestCase):
    def test_warren_le_o_modelo_do_evento_system_init(self):
        eventos = (
            b'{"kind": "text", "payload": {"text": "oi"}}\n'
            b"isto nao e json {\n"
            b'{"kind": "system", "payload": {"subtype": "init", "model": "claude-sonnet-5-5"}}\n'
            b'{"kind": "text", "payload": {"text": "fim"}}\n'
        )
        m, t = novo((200, {}, eventos))
        self.assertEqual(m.modelo_efetivo("r-1"), "claude-sonnet-5-5")
        self.assertEqual(t.ultima[0:2], ("GET", BASE + "/runs/r-1/events?follow=0"))
        self.assertEqual(t.ultima[2]["Authorization"], "Bearer " + TOKEN)

    def test_warren_le_o_formato_confirmado_do_evento_init(self):
        # formato real confirmado pelo controlador (Warren 0.19.3)
        eventos = (
            b'{"kind":"state_change","stream":"system","origin":"warren","payload":{"state":"running"}}\n'
            b'{"kind":"state_change","stream":"system","origin":"warren",'
            b'"payload":{"type":"system","subtype":"init","model":"claude-sonnet-5-5"}}\n'
            b'{"kind":"text","payload":{"text":"ok"}}\n'
        )
        m, _ = novo((200, {}, eventos))
        self.assertEqual(m.modelo_efetivo("r-1"), "claude-sonnet-5-5")

    def test_warren_aceita_o_evento_init_no_formato_do_claude_code(self):
        m, _ = novo((200, {}, b'{"type": "system", "subtype": "init", "model": "claude-opus-5-5"}\n'))
        self.assertEqual(m.modelo_efetivo("r-1"), "claude-opus-5-5")

    def test_warren_vale_o_primeiro_init(self):
        eventos = (
            b'{"kind": "system", "payload": {"subtype": "init", "model": "primeiro"}}\n'
            b'{"kind": "system", "payload": {"subtype": "init", "model": "segundo"}}\n'
        )
        m, _ = novo((200, {}, eventos))
        self.assertEqual(m.modelo_efetivo("r-1"), "primeiro")

    def test_warren_sem_init_valido_devolve_none(self):
        for eventos in (
            b"",
            b'{"kind": "text", "payload": {"text": "x", "model": "m"}}\n',
            b'{"kind": "system", "payload": {"subtype": "other", "model": "m"}}\n',
            b'{"kind": "system", "payload": {"subtype": "init"}}\n',
            b'{"kind": "system", "payload": {"subtype": "init", "model": 42}}\n',
            b'{"kind": "system", "payload": {"subtype": "init", "model": "  "}}\n',
            b'{"kind": "system", "payload": "init"}\n[1]\n"x"\n\xff\xfe\n',
            b'{"kind": "tool", "payload": {"subtype": "init", "model": "m"}}\n',
        ):
            with self.subTest(eventos=eventos):
                m, _ = novo((200, {}, eventos))
                self.assertIsNone(m.modelo_efetivo("r-1"))

    def test_warren_nao_quebra_em_separadores_unicode(self):
        linha = '{"kind": "system", "payload": {"subtype": "init", "model": "m x\u0085y"}}\n'
        m, _ = novo((200, {}, linha.encode("utf-8")))
        self.assertEqual(m.modelo_efetivo("r-1"), "m x\u0085y")

    def test_warren_tolera_crlf(self):
        m, _ = novo((200, {}, b'{"kind": "system", "payload": {"subtype": "init", "model": "m"}}\r\n'))
        self.assertEqual(m.modelo_efetivo("r-1"), "m")

    def test_warren_codifica_o_id_e_trata_erros(self):
        m, t = novo((200, {}, b""))
        m.modelo_efetivo("a/b")
        self.assertEqual(t.ultima[1], BASE + "/runs/a%2Fb/events?follow=0")
        m, _ = novo((500, {}, b"corpo secreto"))
        with self.assertRaises(RuntimeError) as ctx:
            m.modelo_efetivo("r-1")
        self.assertNotIn("corpo secreto", str(ctx.exception))
        self.assertNotIn(TOKEN, str(ctx.exception))

    def test_falso_devolve_none_por_padrao_e_o_modelo_definido(self):
        m = motor.MotorFalso()
        self.assertIsNone(m.modelo_efetivo("r-1"))
        m.definir_modelo_efetivo("r-1", "claude-haiku-5-5")
        self.assertEqual(m.modelo_efetivo("r-1"), "claude-haiku-5-5")
        self.assertEqual(m.chamadas[-1], ("modelo_efetivo", {"run_id": "r-1"}))

    def test_protocolo_exige_modelo_efetivo(self):
        class SemModelo:
            def despachar_plano(self, **_):
                pass

            def despachar_run(self, **_):
                pass

            def plano(self, _):
                pass

            def run(self, _):
                pass

            def ultimo_texto(self, _):
                pass

            def retomar_plano(self, _):
                pass

        self.assertNotIsInstance(SemModelo(), motor.Motor)
        self.assertTrue(hasattr(motor.Motor, "modelo_efetivo"))


class TestesFalhaDeRede(unittest.TestCase):
    """Rodada 2, I1: falha na camada de rede é distinguível de um HTTP >= 400."""

    def test_transporte_padrao_levanta_falha_de_rede(self):
        for erro in (urllib.error.URLError("x"), TimeoutError("x"), ConnectionRefusedError("x"), OSError("x")):
            with mock.patch.object(motor_warren, "_abrir", side_effect=erro):
                with self.assertRaises(motor.FalhaDeRede) as ctx:
                    motor_warren._transporte_urllib("POST", BASE + "/runs", {}, b"{}")
            self.assertIsInstance(ctx.exception, RuntimeError)

    def test_transporte_injetado_com_erro_de_socket_vira_falha_de_rede(self):
        def transporte(metodo, url, headers, corpo):
            raise ConnectionRefusedError("recusado")

        m = motor_warren.MotorWarren(BASE, TOKEN, transporte)
        with self.assertRaises(motor.FalhaDeRede):
            m.despachar_run(**ARGS_RUN)

    def test_http_500_nao_e_falha_de_rede(self):
        m, _ = novo((500, {}, b""))
        with self.assertRaises(RuntimeError) as ctx:
            m.despachar_run(**ARGS_RUN)
        self.assertNotIsInstance(ctx.exception, motor.FalhaDeRede)


class TestesFalhaAntesOuDepoisDoEnvio(unittest.TestCase):
    """Rodada 3, P1: só a falha antes do envio é segura para repetir o POST."""

    def test_transporte_padrao_classifica(self):
        import socket

        antes = [
            urllib.error.URLError(ConnectionRefusedError(111, "x")),
            urllib.error.URLError(socket.gaierror(-2, "x")),
            urllib.error.URLError(TimeoutError("x")),
            urllib.error.URLError(OSError(errno.EHOSTUNREACH, "No route to host")),
        ]
        depois = [
            TimeoutError("x"),
            http.client.RemoteDisconnected("x"),
            ConnectionResetError("x"),
            http.client.IncompleteRead(b"x"),
            urllib.error.URLError(ConnectionResetError("x")),
            urllib.error.URLError("x"),
        ]
        for erro, classe in [(e, motor.FalhaAntesDoEnvio) for e in antes] + [(e, motor.FalhaIncerta) for e in depois]:
            with self.subTest(erro=repr(erro)):
                with mock.patch.object(motor_warren, "_abrir", side_effect=erro):
                    with self.assertRaises(classe) as ctx:
                        motor_warren._transporte_urllib("POST", BASE + "/runs", {}, b"{}")
                self.assertIsInstance(ctx.exception, motor.FalhaDeRede)
                self.assertIs(ctx.exception.__cause__, erro)

    def test_transporte_injetado_classifica(self):
        for erro, classe in ((ConnectionRefusedError("x"), motor.FalhaAntesDoEnvio), (TimeoutError("x"), motor.FalhaIncerta)):
            def transporte(metodo, url, headers, corpo, _e=erro):
                raise _e

            m = motor_warren.MotorWarren(BASE, TOKEN, transporte)
            with self.assertRaises(classe):
                m.despachar_run(**ARGS_RUN)


class TestesProcurarPorNonce(unittest.TestCase):
    """Rodada 3, P1: achar o run ou o Plan Run despachado pelo marcador no texto enviado."""

    NONCE = "0123456789abcdef0123456789abcdef"
    MARCA = "<!-- fabrica:nonce=0123456789abcdef0123456789abcdef -->"

    def test_procurar_run_varre_o_prompt(self):
        runs = [{"id": "r-1", "prompt": "outro"}, {"id": "r-2", "prompt": "revise\n" + self.MARCA}]
        m, t = novo(ok({"runs": runs, "total": 2, "limit": 100, "offset": 0}))
        self.assertEqual(m.procurar_run("prj x", self.NONCE), "r-2")
        self.assertEqual(t.ultima[0:2], ("GET", BASE + "/runs?project=prj%20x&sort=started&dir=desc&limit=100&offset=0"))
        m, _ = novo(ok({"runs": runs[:1]}), ok({"runs": []}))
        self.assertIsNone(m.procurar_run("prj", self.NONCE))

    def test_procurar_plano_varre_o_prompt_template(self):
        planos = [{"id": "p-1", "promptTemplate": "x {seed_id}"}, {"id": "p-2", "promptTemplate": "y {seed_id}\n" + self.MARCA}]
        m, t = novo(ok({"planRuns": planos}))
        self.assertEqual(m.procurar_plano("prj", self.NONCE), "p-2")
        self.assertEqual(t.ultima[0:2], ("GET", BASE + "/plan-runs?project=prj"))

    def test_entradas_e_respostas_invalidas(self):
        for nonce in ("", "xyz", self.NONCE.upper(), None):
            m, t = novo()
            with self.assertRaises(ValueError):
                m.procurar_run("prj", nonce)
            self.assertEqual(t.requisicoes, [])
        for metodo, corpo in (("procurar_run", {"x": 1}), ("procurar_plano", {"planRuns": "x"})):
            m, _ = novo(ok(corpo))
            with self.assertRaises(RuntimeError):
                getattr(m, metodo)("prj", self.NONCE)
        m, _ = novo(ok({"runs": [{"id": 5, "prompt": self.MARCA}]}))
        with self.assertRaises(RuntimeError):
            m.procurar_run("prj", self.NONCE)

    def test_falso_procura_e_falha_incerta_ou_antes(self):
        m = motor.MotorFalso()
        rid = m.despachar_run(**dict(ARGS_RUN, prompt="p\n" + self.MARCA))
        self.assertEqual(m.procurar_run("kustertech-flow", self.NONCE), rid)
        pid = m.despachar_plano(**dict(ARGS_PLANO, prompt_template="t {seed_id}\n" + self.MARCA))
        self.assertEqual(m.procurar_plano("kustertech-flow", self.NONCE), pid)
        self.assertIsNone(m.procurar_run("outro", self.NONCE))
        m.falhar_despacho("incerta", 1)
        with self.assertRaises(motor.FalhaIncerta):
            m.despachar_run(**dict(ARGS_RUN, prompt="q\n<!-- fabrica:nonce=%s -->" % ("f" * 32)))
        self.assertIsNotNone(m.procurar_run("kustertech-flow", "f" * 32))  # aceito, apesar do erro
        m.falhar_despacho("antes", 1)
        with self.assertRaises(motor.FalhaAntesDoEnvio):
            m.despachar_plano(**dict(ARGS_PLANO, prompt_template="z {seed_id}\n<!-- fabrica:nonce=%s -->" % ("e" * 32)))
        self.assertIsNone(m.procurar_plano("kustertech-flow", "e" * 32))  # nada criado
        self.assertTrue(m.despachar_run(**ARGS_RUN))  # o modo vale só para as próximas `vezes`


class TestesCancelarPlano(unittest.TestCase):
    def test_warren_cancela_com_post_e_corpo_vazio(self):
        m, t = novo(ok({"planRun": {"id": "p/1", "state": "cancelled"}}))
        self.assertIsNone(m.cancelar_plano("p/1"))
        metodo, url, headers, corpo = t.ultima
        self.assertEqual((metodo, url), ("POST", BASE + "/plan-runs/p%2F1/cancel"))
        self.assertEqual(json.loads(corpo), {})
        self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)

    def test_warren_erros_e_429(self):
        m, _ = novo((500, {}, b"segredo do corpo"))
        with self.assertRaises(RuntimeError) as ctx:
            m.cancelar_plano("p-1")
        self.assertNotIn("segredo do corpo", str(ctx.exception))
        m, _ = novo((429, {"Retry-After": "7"}, b""))
        with self.assertRaises(motor.MotorOcupado):
            m.cancelar_plano("p-1")
        m, t = novo()
        with self.assertRaises(ValueError):
            m.cancelar_plano("..")
        self.assertEqual(t.requisicoes, [])

    def test_falso_registra_e_marca_o_plano_cancelado(self):
        m = motor.MotorFalso()
        pid = m.despachar_plano(**ARGS_PLANO)
        m.cancelar_plano(pid)
        self.assertEqual(m.plano(pid)["estado"], "cancelled")
        self.assertIn(("cancelar_plano", {"plan_run_id": pid}), m.chamadas)
        with self.assertRaises(KeyError):
            m.cancelar_plano("nao-existe")

    def test_protocolo_exige_cancelar_plano(self):
        self.assertTrue(hasattr(motor.Motor, "cancelar_plano"))
        self.assertIsInstance(motor.MotorFalso(), motor.Motor)
        self.assertIsInstance(motor_warren.MotorWarren(BASE, TOKEN, TransporteFalso()), motor.Motor)


class TestesRodada4(unittest.TestCase):
    """Q1: `Idempotency-Key` no POST /runs e busca pelo nonce que enxerga os runs ainda na fila.

    Conferido na fonte do Warren 0.19.3: GET /runs aceita só project|agent, sort=started|cost, dir, limit (<= 500)
    e offset, ordena por started_at DESC, id ASC (runs-queries.ts); um run queued tem started_at NULL (runs.ts),
    que no SQLite (padrão) fica por último em DESC e primeiro em ASC; no Postgres é o contrário. Uma chave repetida
    em POST /runs devolve o mesmo 201 com o run já criado (idempotency.ts, janela de 10 min por projeto).
    """

    NONCE = "0123456789abcdef0123456789abcdef"
    MARCA = motor.MARCADOR_NONCE % NONCE
    CHAVE = "fedcba9876543210fedcba9876543210"
    DESDE = "2026-11-03T12:00:00Z"
    PROJETO = "kustertech-flow"

    @staticmethod
    def _runs(prefixo, n, started_at):
        return [{"id": "%s-%d" % (prefixo, i), "prompt": "outro", "startedAt": started_at} for i in range(n)]

    def _url(self, direcao, offset):
        return BASE + "/runs?project=prj%%20x&sort=started&dir=%s&limit=100&offset=%d" % (direcao, offset)

    def test_warren_manda_idempotency_key_so_no_post_runs_com_chave(self):
        m, t = novo(ok({"run": {"id": "r-1"}}, 201), ok({"run": {"id": "r-1"}}, 201))
        self.assertEqual(m.despachar_run(**ARGS_RUN, chave_idempotencia=self.CHAVE), "r-1")
        self.assertEqual(t.ultima[2].get("Idempotency-Key"), self.CHAVE)
        self.assertEqual(t.ultima[0:2], ("POST", BASE + "/runs"))
        self.assertEqual(m.despachar_run(**ARGS_RUN), "r-1")
        self.assertNotIn("Idempotency-Key", t.ultima[2])
        # chave repetida: o Warren responde o MESMO 201 com o run já criado; é sucesso com o id existente
        m, t = novo(ok({"run": {"id": "r-9", "state": "queued"}}, 201))
        self.assertEqual(m.despachar_run(**ARGS_RUN, chave_idempotencia=self.CHAVE), "r-9")
        # POST /plan-runs não aceita a chave no Warren: nunca a manda
        m, t = novo(ok({"planRun": {"id": "p-1"}}, 201))
        m.despachar_plano(**ARGS_PLANO)
        self.assertNotIn("Idempotency-Key", t.ultima[2])
        # a chave é um nonce (hex de 32): nada de texto livre num cabeçalho
        for chave in ("x", "", self.CHAVE.upper(), 5):
            m, t = novo()
            with self.assertRaises(ValueError):
                m.despachar_run(**ARGS_RUN, chave_idempotencia=chave)
            self.assertEqual(t.requisicoes, [])

    def test_warren_procura_nas_duas_direcoes_e_para_nos_runs_anteriores_a_acao(self):
        # SQLite: em DESC os queued (NULL) ficam depois de TODOS os iniciados; só o ASC os mostra primeiro
        novos = self._runs("n", 100, "2026-11-03T12:30:00.000Z")
        antigos = self._runs("a", 100, "2026-11-03T11:00:00.000Z")
        fila = [{"id": "q-1", "prompt": "revise\n" + self.MARCA, "startedAt": None}]
        m, t = novo(ok({"runs": novos}), ok({"runs": antigos}), ok({"runs": fila + antigos[:99]}))
        self.assertEqual(m.procurar_run("prj x", self.NONCE, self.DESDE), "q-1")
        self.assertEqual([r[1] for r in t.requisicoes], [self._url("desc", 0), self._url("desc", 100), self._url("asc", 0)])
        # Postgres: em DESC os NULL vêm primeiro; achado na primeira página
        m, t = novo(ok({"runs": fila + novos[:99]}))
        self.assertEqual(m.procurar_run("prj x", self.NONCE, self.DESDE), "q-1")
        self.assertEqual(len(t.requisicoes), 1)

    def test_warren_pagina_desc_ate_achar_um_run_iniciado_depois_da_acao(self):
        alvo = {"id": "r-x", "prompt": "revise\n" + self.MARCA, "startedAt": "2026-11-03T12:05:00.000Z"}
        novos = self._runs("n", 100, "2026-11-03T12:30:00.000Z")
        m, t = novo(ok({"runs": novos}), ok({"runs": novos[:60] + [alvo]}))
        self.assertEqual(m.procurar_run("prj x", self.NONCE, self.DESDE), "r-x")
        self.assertEqual(len(t.requisicoes), 2)
        # página curta (menos de 100) encerra a direção; startedAt em milissegundos também vale
        alvo_ms = dict(alvo, startedAt=1762171500000)
        m, t = novo(ok({"runs": novos}), ok({"runs": [alvo_ms]}))
        self.assertEqual(m.procurar_run("prj x", self.NONCE, self.DESDE), "r-x")

    def test_warren_busca_sem_desde_le_uma_pagina_desc_e_a_asc(self):
        novos = self._runs("n", 100, "2026-11-03T12:30:00.000Z")
        m, t = novo(ok({"runs": novos}), ok({"runs": self._runs("v", 10, "2026-11-01T00:00:00.000Z")}))
        self.assertIsNone(m.procurar_run("prj x", self.NONCE))
        self.assertEqual([r[1] for r in t.requisicoes], [self._url("desc", 0), self._url("asc", 0)])

    def test_warren_asc_para_na_primeira_pagina_com_run_iniciado_e_ha_teto_de_paginas(self):
        # ASC: só o prefixo de NULL interessa (SQLite); uma página que já traz iniciados encerra, mesmo recentes
        fila = [{"id": "q-%d" % i, "prompt": "outro", "startedAt": None} for i in range(100)]
        m, t = novo(ok({"runs": self._runs("a", 5, "2026-11-03T11:00:00.000Z")}), ok({"runs": fila}), ok({"runs": fila[:50] + self._runs("v", 50, "2026-11-03T12:30:00.000Z")}))
        self.assertIsNone(m.procurar_run("prj x", self.NONCE, self.DESDE))
        self.assertEqual([r[1] for r in t.requisicoes], [self._url("desc", 0), self._url("asc", 0), self._url("asc", 100)])
        # teto: 20 páginas por direção, mesmo com páginas cheias sem fim
        novos = self._runs("n", 100, "2026-11-03T12:30:00.000Z")
        m, t = novo(*([ok({"runs": novos})] * 20 + [ok({"runs": fila})] * 20))
        self.assertIsNone(m.procurar_run("prj x", self.NONCE, self.DESDE))
        self.assertEqual(len(t.requisicoes), 40)

    def test_warren_busca_valida_entradas_e_respostas(self):
        m, t = novo()
        with self.assertRaises(ValueError):
            m.procurar_run("prj", self.NONCE, "ontem")
        self.assertEqual(t.requisicoes, [])
        m, _ = novo(ok({"runs": [{"id": "r", "prompt": "x", "startedAt": "ontem"}]}), ok({"runs": []}))
        self.assertIsNone(m.procurar_run("prj", self.NONCE, self.DESDE))  # startedAt ilegível: nem corta nem quebra

    def test_falso_ordena_como_o_warren_e_a_busca_acha_o_run_na_fila(self):
        inicio = datetime.datetime(2026, 11, 3, 12, 0, tzinfo=datetime.timezone.utc)
        for dialeto in ("sqlite", "postgres"):
            with self.subTest(dialeto=dialeto):
                m = motor.MotorFalso()
                m.agora = lambda: inicio
                m.dialeto = dialeto
                m.iniciar_historico(150, projeto=self.PROJETO, ha=datetime.timedelta(hours=1))
                m.enfileirar(True)
                rid = m.despachar_run(**dict(ARGS_RUN, prompt="p\n" + self.MARCA))
                self.assertEqual(m.run(rid)["estado"], "queued")
                ids = [r["id"] for r in m._listar_runs(self.PROJETO, "desc", 100, 0)]
                self.assertEqual(ids[0] == rid, dialeto == "postgres")  # NULL por último no SQLite, primeiro no Postgres
                self.assertEqual(ids[0] == rid, m._listar_runs(self.PROJETO, "asc", 100, 0)[0]["id"] != rid)
                self.assertEqual(m.procurar_run(self.PROJETO, self.NONCE, "2026-11-03T11:50:00Z"), rid)
                self.assertIsNone(m.procurar_run("outro", self.NONCE, "2026-11-03T11:50:00Z"))
                m.iniciar_run(rid)
                self.assertEqual(m.run(rid)["estado"], "running")
                self.assertEqual(m._listar_runs(self.PROJETO, "desc", 1, 0)[0]["id"], rid)  # o mais recente iniciado
                self.assertEqual(m.procurar_run(self.PROJETO, self.NONCE, "2026-11-03T11:50:00Z"), rid)
        m = motor.MotorFalso()
        m.enfileirar(True)
        rid = m.despachar_run(**ARGS_RUN)
        m.enfileirar(False)
        self.assertEqual(m.run(m.despachar_run(**ARGS_RUN))["estado"], "running")
        with self.assertRaises(ValueError):
            m.dialeto = "oracle"
            m._listar_runs(self.PROJETO, "desc", 1, 0)

    def test_falso_dedupe_por_chave_e_projeto_dentro_da_janela(self):
        relogio = {"t": datetime.datetime(2026, 11, 3, 12, 0, tzinfo=datetime.timezone.utc)}
        m = motor.MotorFalso()
        m.agora = lambda: relogio["t"]
        a = m.despachar_run(**ARGS_RUN, chave_idempotencia=self.CHAVE)
        self.assertEqual(m.despachar_run(**ARGS_RUN, chave_idempotencia=self.CHAVE), a)
        self.assertEqual(len(m._runs), 1)
        self.assertEqual(m.chamadas[-1][1]["chave_idempotencia"], self.CHAVE)
        self.assertNotEqual(m.despachar_run(**dict(ARGS_RUN, projeto="outro"), chave_idempotencia=self.CHAVE), a)
        self.assertNotEqual(m.despachar_run(**ARGS_RUN), a)  # sem chave: sempre cria
        relogio["t"] += datetime.timedelta(minutes=10, seconds=1)
        self.assertNotEqual(m.despachar_run(**ARGS_RUN, chave_idempotencia=self.CHAVE), a)  # janela vencida
        # 429 e falha antes do envio não ocupam a chave; a falha incerta ocupa (o Warren criou)
        m.lotar()
        with self.assertRaises(motor.MotorOcupado):
            m.despachar_run(**ARGS_RUN, chave_idempotencia=self.NONCE)
        m.falhar_despacho("antes", 1)
        with self.assertRaises(motor.FalhaAntesDoEnvio):
            m.despachar_run(**ARGS_RUN, chave_idempotencia=self.NONCE)
        antes = len(m._runs)
        m.falhar_despacho("incerta", 1)
        with self.assertRaises(motor.FalhaIncerta):
            m.despachar_run(**ARGS_RUN, chave_idempotencia=self.NONCE)
        self.assertEqual(len(m._runs), antes + 1)
        criado = m.despachar_run(**ARGS_RUN, chave_idempotencia=self.NONCE)
        self.assertEqual(len(m._runs), antes + 1)
        self.assertIn(criado, m._runs)
        with self.assertRaises(ValueError):
            m.despachar_run(**ARGS_RUN, chave_idempotencia="x")

    def test_protocolo_tem_chave_de_idempotencia_e_desde(self):
        import inspect

        self.assertIn("chave_idempotencia", inspect.signature(motor.Motor.despachar_run).parameters)
        self.assertIn("desde", inspect.signature(motor.Motor.procurar_run).parameters)
        for classe in (motor.MotorFalso, motor_warren.MotorWarren):
            self.assertEqual(
                list(inspect.signature(classe.despachar_run).parameters), list(inspect.signature(motor.Motor.despachar_run).parameters)
            )
            self.assertEqual(list(inspect.signature(classe.procurar_run).parameters), list(inspect.signature(motor.Motor.procurar_run).parameters))


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
