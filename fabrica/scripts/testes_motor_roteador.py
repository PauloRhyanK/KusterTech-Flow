import json
import pathlib
import sys
import tempfile
import unittest

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

import motor  # noqa: E402
import motor_roteador  # noqa: E402
import motor_warren  # noqa: E402

RESERVA = "claude-reserva"
URL = "https://github.com/dono/repo.git"


def montar():
    padrao, reserva = motor.MotorFalso(), motor.MotorFalso()
    padrao.definir_projeto("p-padrao", URL)
    reserva.definir_projeto("p-reserva", URL)
    roteador = motor_roteador.MotorRoteador({motor_roteador.CONTA_PADRAO: padrao, RESERVA: reserva})
    return roteador, padrao, reserva


def despachar_run(roteador, projeto="p-padrao", conta=None):
    return roteador.despachar_run(
        projeto=projeto, agente="claude-code", modelo="m", prompt="x", branch_existente=None, max_custo_usd=1.0, conta=conta
    )


def despachar_plano(roteador, projeto="p-padrao", conta=None):
    return roteador.despachar_plano(
        projeto=projeto, plano_seeds="pl", agente="claude-code", modelo="m", prompt_template="x", max_custo_usd=1.0, conta=conta
    )


class ProtocolTest(unittest.TestCase):
    def test_falso_registra_a_conta_e_warren_a_ignora(self):
        falso = motor.MotorFalso()
        despachar_run(falso, conta="outra")
        despachar_plano(falso, conta="outra")
        self.assertEqual([c[1]["conta"] for c in falso.chamadas], ["outra", "outra"])
        despachar_run(falso)
        self.assertNotIn("conta", falso.chamadas[-1][1])
        corpos = []

        def transporte(metodo, url, headers, corpo):
            corpos.append(corpo)
            return 201, {}, json.dumps({"run": {"id": "r1"}, "planRun": {"id": "pr1"}}).encode()

        warren = motor_warren.MotorWarren("http://x", "tok", transporte)
        self.assertEqual(despachar_run(warren, conta="outra"), "r1")
        self.assertEqual(despachar_plano(warren, conta="outra"), "pr1")
        self.assertNotIn(b"outra", b"".join(c if isinstance(c, bytes) else str(c).encode() for c in corpos))


class RoteadorTest(unittest.TestCase):
    def test_conta_padrao_devolve_id_sem_mudanca(self):
        roteador, padrao, _ = montar()
        self.assertEqual(despachar_run(roteador), "run-1")
        self.assertEqual(despachar_plano(roteador, conta=motor_roteador.CONTA_PADRAO), "plano-2")
        self.assertEqual(padrao.chamadas[0][1]["projeto"], "p-padrao")

    def test_despacho_na_reserva_devolve_id_prefixado(self):
        roteador, padrao, reserva = montar()
        self.assertEqual(despachar_run(roteador, conta=RESERVA), RESERVA + ":run-1")
        self.assertEqual(despachar_plano(roteador, conta=RESERVA), RESERVA + ":plano-2")
        self.assertEqual([c[0] for c in padrao.chamadas], ["projetos"])  # só para achar o gitUrl
        self.assertEqual(reserva.chamadas[1][1]["conta"], RESERVA)

    def test_leitura_de_id_prefixado_vai_ao_motor_da_reserva(self):
        roteador, padrao, reserva = montar()
        run_id = despachar_run(roteador, conta=RESERVA)
        plano_id = despachar_plano(roteador, conta=RESERVA)
        reserva.definir_texto("run-1", "oi")
        reserva.definir_modelo_efetivo("run-1", "mm")
        reserva.eventos["run-1"] = b"{}"
        self.assertEqual(roteador.run(run_id)["estado"], "running")
        self.assertEqual(roteador.ultimo_texto(run_id), "oi")
        self.assertEqual(roteador.modelo_efetivo(run_id), "mm")
        self.assertEqual(roteador.eventos_brutos(run_id), b"{}")
        self.assertEqual(roteador.plano(plano_id)["estado"], "running")
        roteador.retomar_plano(plano_id)
        roteador.cancelar_plano(plano_id)
        self.assertEqual(reserva.plano("plano-2")["estado"], "cancelled")
        self.assertIn(("retomar_plano", {"plan_run_id": "plano-2"}), reserva.chamadas)
        self.assertEqual([c[0] for c in padrao.chamadas], ["projetos"])

    def test_id_sem_prefixo_vai_a_conta_padrao(self):
        roteador, padrao, reserva = montar()
        padrao.definir_run("run-antigo", estado="succeeded")
        self.assertEqual(roteador.run("run-antigo")["estado"], "succeeded")
        self.assertEqual(reserva.chamadas, [])

    def test_projeto_traduzido_por_git_url(self):
        roteador, _, reserva = montar()
        despachar_run(roteador, conta=RESERVA)
        despachar_run(roteador, conta=RESERVA)
        self.assertEqual([c[1]["projeto"] for c in reserva.chamadas if c[0] == "despachar_run"], ["p-reserva"] * 2)
        self.assertEqual(sum(1 for c in reserva.chamadas if c[0] == "projetos"), 1)

    def test_projeto_sem_par_levanta_conta_indisponivel(self):
        roteador, _, reserva = montar()
        reserva._projetos.clear()
        with self.assertRaises(motor_roteador.ContaIndisponivel) as ctx:
            despachar_run(roteador, conta=RESERVA)
        self.assertIsInstance(ctx.exception, motor.RecusaDoMotor)
        with self.assertRaises(motor_roteador.ContaIndisponivel):
            despachar_plano(roteador, conta=RESERVA)
        self.assertFalse([c for c in reserva.chamadas if c[0] == "despachar_run"])

    def test_conta_sem_motor_levanta_conta_indisponivel(self):
        roteador, _, _ = montar()
        with self.assertRaises(motor_roteador.ContaIndisponivel):
            despachar_run(roteador, conta="inexistente")
        with self.assertRaises(motor_roteador.ContaIndisponivel):
            roteador.run("inexistente:run-1")

    def test_procurar_run_acha_na_reserva_com_prefixo(self):
        roteador, padrao, _ = montar()
        nonce = "a" * 32
        run_id = roteador.despachar_run(
            projeto="p-padrao",
            agente="claude-code",
            modelo="m",
            prompt="x " + motor.MARCADOR_NONCE % nonce,
            branch_existente=None,
            max_custo_usd=1.0,
            conta=RESERVA,
        )
        self.assertEqual(roteador.procurar_run("p-padrao", nonce), run_id)
        self.assertEqual(run_id, RESERVA + ":run-1")
        self.assertIsNone(roteador.procurar_run("p-padrao", "b" * 32))
        self.assertEqual(roteador.procurar_plano("p-padrao", nonce), None)

    def test_procurar_na_padrao_nao_prefixa_e_busca_ignora_conta_sem_par(self):
        roteador, padrao, reserva = montar()
        nonce = "c" * 32
        roteador.despachar_run(
            projeto="p-padrao",
            agente="claude-code",
            modelo="m",
            prompt=motor.MARCADOR_NONCE % nonce,
            branch_existente=None,
            max_custo_usd=1.0,
        )
        reserva._projetos.clear()
        self.assertEqual(roteador.procurar_run("p-padrao", nonce), "run-1")

    def test_planos_e_retry_de_todas_as_contas(self):
        roteador, padrao, reserva = montar()
        padrao._planos_de_seeds["plano-9"] = ("p-padrao", "pl")
        padrao.definir_plano("plano-9", "running", [])
        reserva._planos_de_seeds["plano-8"] = ("p-reserva", "pl")
        reserva.definir_plano("plano-8", "running", [])
        ids = sorted(p["id"] for p in roteador.planos_do_projeto("p-padrao"))
        self.assertEqual(ids, [RESERVA + ":plano-8", "plano-9"])
        self.assertIsNone(roteador.procurar_retry("p-padrao", RESERVA + ":run-1", []))

    def test_conta_padrao_para_visao_geral_versao_projetos_e_atualizar(self):
        roteador, padrao, reserva = montar()
        roteador.visao_geral()
        roteador.versao()
        roteador.atualizar_projeto("p-padrao")
        self.assertEqual(roteador.projetos(), [{"id": "p-padrao", "gitUrl": URL}])
        self.assertEqual(reserva.chamadas, [])
        self.assertEqual(roteador.contas(), [motor_roteador.CONTA_PADRAO, RESERVA])


class DoAmbienteTest(unittest.TestCase):
    def test_sem_arquivo_so_a_conta_padrao(self):
        padrao = motor.MotorFalso()
        roteador, tokens = motor_roteador.do_ambiente(
            {"WARREN_TOKEN_FILE": "/t/padrao"}, padrao, lambda caminho: "tok-" + caminho
        )
        self.assertEqual(roteador.contas(), [motor_roteador.CONTA_PADRAO])
        self.assertEqual(tokens, ["tok-/t/padrao"])

    def test_com_arquivo_uma_instancia_por_conta(self):
        padrao = motor.MotorFalso()
        with tempfile.TemporaryDirectory() as pasta:
            arquivo = pathlib.Path(pasta, "contas.json")
            arquivo.write_text(json.dumps({RESERVA: {"api": "http://127.0.0.1:8081", "tokenFile": "/t/reserva"}}))
            roteador, tokens = motor_roteador.do_ambiente(
                {"WARREN_TOKEN_FILE": "/t/padrao", "FABRICA_CONTAS_FILE": str(arquivo)}, padrao, lambda c: "tok-" + c
            )
        self.assertEqual(roteador.contas(), [motor_roteador.CONTA_PADRAO, RESERVA])
        self.assertEqual(sorted(tokens), ["tok-/t/padrao", "tok-/t/reserva"])
        self.assertIsInstance(roteador._motores[RESERVA], motor_warren.MotorWarren)
        self.assertIs(roteador._motores[motor_roteador.CONTA_PADRAO], padrao)

    def test_arquivo_invalido_recusa(self):
        with tempfile.TemporaryDirectory() as pasta:
            arquivo = pathlib.Path(pasta, "contas.json")
            for conteudo in ("{{{", "[]", json.dumps({"x": {"api": "http://a"}}), json.dumps({"x": {"api": "", "tokenFile": "t"}})):
                arquivo.write_text(conteudo)
                with self.assertRaises(ValueError):
                    motor_roteador.do_ambiente({"FABRICA_CONTAS_FILE": str(arquivo)}, motor.MotorFalso(), lambda c: "t")


if __name__ == "__main__":
    unittest.main()
