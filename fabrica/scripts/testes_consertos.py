import datetime
import json
import pathlib
import sys
import tempfile
import unittest

RAIZ_DOS_SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ_DOS_SCRIPTS))

import capacidade  # noqa: E402
import consertos  # noqa: E402
import motor  # noqa: E402

ID = "0b6f3c2e-6a1d-4c8e-9f00-1a2b3c4d5e6f"
OUTRO_ID = "1c7a4d3f-7b2e-4d9f-8a11-2b3c4d5e6f70"
NONCE = ID.replace("-", "")
REPO = "kustertech-exemplo/portal"
COMMIT = "a" * 40
EXECUCAO = "https://github.com/kustertech-exemplo/portal/actions/runs/1"
PR = "https://github.com/kustertech-exemplo/portal/pull/9"
MODELO = {"agente": "claude-code", "modelo": "modelo-do-fixer", "maxCustoUsd": 5}
INICIO = datetime.datetime(2026, 11, 19, 12, 0, 0, tzinfo=datetime.timezone.utc)


def pedido(id_=ID, **extra):
    base = {
        "id": id_,
        "repositorio": REPO,
        "commit": COMMIT,
        "execucaoUrl": EXECUCAO,
        "trechoDoLog": "Error: build falhou",
        "abertoEm": "2026-11-19T11:55:00Z",
    }
    base.update(extra)
    return base


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.capacidade = pathlib.Path(self._tmp.name) / "capacidade.json"
        self.motor = motor.MotorFalso()
        self.motor.agora = lambda: self.agora
        self.agora = INICIO
        self.estado = {"fila": [], "avisos": [], "chaves": {}, "warren": {}}
        self.salvos = []

    def passo(self, abertos, *, modelo=MODELO, projetos=None, mem=None):
        return consertos.passo(
            self.estado,
            abertos,
            motor=self.motor,
            capacidade_path=self.capacidade,
            projetos={REPO: "portal"} if projetos is None else projetos,
            modelo=modelo,
            agora=self.agora,
            mem_disponivel_mb=mem,
            salvar=lambda: self.salvos.append(json.loads(json.dumps(self.estado))),
        )

    def despachos(self):
        return [a for nome, a in self.motor.chamadas if nome == "despachar_run"]

    def reservas(self):
        return capacidade.ler(self.capacidade)["reservas"]

    def conserto(self, id_=ID):
        return self.estado["consertos"][id_]


class TestesLerDaResposta(Base):
    def test_resposta_com_consertos_validos_e_um_torto_le_so_os_validos(self):
        resposta = {
            "resultado": "gravado",
            "consertos": [
                pedido(),
                pedido(OUTRO_ID, execucaoUrl=None, trechoDoLog="x" * 5000),
                pedido("nao-e-uuid"),
                pedido("2d8b5e4a-8c3f-4e0a-9b22-3c4d5e6f7081", repositorio="sem-barra"),
                pedido("3e9c6f5b-9d4a-4f1b-8c33-4d5e6f708192", commit="abc"),
                pedido("4fad7a6c-ae5b-4a2c-9d44-5e6f708192a3", execucaoUrl="https://exemplo.com/x"),
                "torto",
                pedido(),
            ],
        }
        lidos = consertos.ler_da_resposta(resposta)
        self.assertEqual([p["id"] for p in lidos], [ID, OUTRO_ID])
        self.assertEqual(lidos[0]["execucaoUrl"], EXECUCAO)
        self.assertIsNone(lidos[1]["execucaoUrl"])
        self.assertEqual(len(lidos[1]["trechoDoLog"]), 4000)

    def test_resposta_sem_consertos_ou_torta_vira_lista_vazia(self):
        for resposta in (None, {}, {"resultado": "gravado"}, {"consertos": "x"}, [pedido()]):
            with self.subTest(resposta=resposta):
                self.assertEqual(consertos.ler_da_resposta(resposta), [])


class TestesPasso(Base):
    def test_conserto_novo_reserva_vaga_e_despacha_um_run_fixer_com_nonce(self):
        self.passo([pedido()])
        (despacho,) = self.despachos()
        self.assertEqual(despacho["projeto"], "portal")
        self.assertEqual((despacho["agente"], despacho["modelo"], despacho["max_custo_usd"]), ("claude-code", "modelo-do-fixer", 5))
        self.assertEqual(despacho["chave_idempotencia"], NONCE)
        self.assertIsNone(despacho["branch_existente"])
        self.assertTrue(despacho["prompt"].endswith("<!-- fabrica:nonce=%s -->" % NONCE))
        self.assertIn("Você conserta a publicação de %s, que falhou no commit %s." % (REPO, COMMIT), despacho["prompt"])
        self.assertEqual(self.reservas(), {"conserto:" + ID: ["fixer"]})
        self.assertEqual(self.conserto()["estado"], "em_curso")
        self.assertTrue(self.conserto()["runId"])
        # gravado como `despachando` antes do POST
        self.assertEqual(self.salvos[0]["consertos"][ID]["estado"], "despachando")
        self.assertEqual(consertos.chaves_ocupando(self.estado), {"conserto:" + ID})
        (item,) = consertos.para_o_retrato(self.estado)
        self.assertEqual(item, {"id": ID, "estado": "em_curso", "runId": self.conserto()["runId"], "prUrl": None, "motivo": None, "em": "2026-11-19T12:00:00Z"})

    def test_sem_vaga_nao_despacha_e_tenta_no_ciclo_seguinte(self):
        capacidade.configurar(self.capacidade, vagas=1, ram_minima_mb=0)
        capacidade.reservar(self.capacidade, "outro-plano", "raia-0", mem_disponivel_mb=None)
        self.passo([pedido()])
        self.assertEqual(self.despachos(), [])
        self.assertNotIn(ID, self.estado.get("consertos", {}))
        self.assertEqual(consertos.para_o_retrato(self.estado), [])
        capacidade.sincronizar(self.capacidade, "outro-plano", set())
        self.passo([pedido()])
        self.assertEqual(len(self.despachos()), 1)

    def test_com_drenagem_ou_pouca_ram_nao_despacha(self):
        capacidade.configurar(self.capacidade, vagas=3, ram_minima_mb=2048)
        self.passo([pedido()], mem=100)
        capacidade.definir_drenagem(self.capacidade, "2026-11-19T11:59:00Z")
        self.passo([pedido()])
        self.assertEqual(self.despachos(), [])
        self.assertEqual(self.reservas(), {})

    def test_ciclo_repetido_nao_despacha_duas_vezes(self):
        for _ in range(3):
            self.passo([pedido()])
            self.agora += datetime.timedelta(minutes=1)
        self.assertEqual(len(self.despachos()), 1)

    def test_reinicio_em_despachando_adota_o_run_pelo_nonce(self):
        self.motor.falhar_despacho("incerta")  # o run nasce e o POST "falha": como um coordenador morto no meio
        self.passo([pedido()])
        self.assertEqual(self.conserto()["estado"], "despachando")
        self.agora += datetime.timedelta(minutes=1)
        self.passo([pedido()])
        self.assertEqual(len(self.despachos()), 1)
        self.assertEqual(self.conserto()["estado"], "em_curso")
        self.assertEqual(self.conserto()["runId"], "run-1")

    def test_reinicio_em_despachando_sem_run_despacha_de_novo_com_a_mesma_chave(self):
        self.motor.falhar_despacho("antes")
        self.passo([pedido()])
        self.assertEqual(self.conserto()["estado"], "despachando")
        self.passo([pedido()])
        self.assertEqual([d["chave_idempotencia"] for d in self.despachos()], [NONCE, NONCE])
        self.assertEqual(self.conserto()["estado"], "em_curso")

    def test_run_com_pr_vira_com_pr_e_solta_a_vaga(self):
        self.passo([pedido()])
        self.motor.definir_run(self.conserto()["runId"], estado="succeeded", prUrl=PR)
        self.passo([pedido()])
        self.assertEqual(self.conserto()["estado"], "com_pr")
        self.assertEqual(self.conserto()["prUrl"], PR)
        self.assertEqual(self.reservas(), {})
        self.assertEqual(consertos.chaves_ocupando(self.estado), set())
        self.assertEqual(consertos.para_o_retrato(self.estado)[0]["prUrl"], PR)
        self.passo([pedido()])
        self.assertEqual(len(self.despachos()), 1)

    def test_run_sem_pr_vira_desistiu_com_motivo(self):
        self.passo([pedido()])
        self.motor.retry_infra_perdida = False
        self.motor.definir_run(self.conserto()["runId"], estado="failed", motivoFalha="m" * 500)
        self.passo([pedido()])
        self.assertEqual(self.conserto()["estado"], "desistiu")
        self.assertEqual(self.conserto()["motivo"], "m" * 300)
        self.assertEqual(self.reservas(), {})

    def test_run_terminado_sem_pr_e_sem_motivo_tambem_desiste(self):
        self.passo([pedido()])
        self.motor.definir_run(self.conserto()["runId"], estado="succeeded")
        self.passo([pedido()])
        self.assertEqual(self.conserto()["estado"], "desistiu")
        self.assertTrue(self.conserto()["motivo"])

    def test_teto_de_1h_vira_desistiu_e_solta_a_vaga(self):
        self.passo([pedido()])
        self.agora += datetime.timedelta(seconds=consertos.TETO_S)
        self.passo([pedido()])
        self.assertEqual(self.conserto()["estado"], "em_curso")
        self.agora += datetime.timedelta(seconds=1)
        self.passo([pedido()])
        self.assertEqual(self.conserto()["estado"], "desistiu")
        self.assertEqual(self.conserto()["motivo"], "teto de 1 h")
        self.assertEqual(self.reservas(), {})
        self.assertEqual(consertos.TETO_S, 3600)

    def test_repositorio_fora_da_fila_json_vira_desistiu(self):
        self.passo([pedido()], projetos={})
        self.assertEqual(self.despachos(), [])
        self.assertEqual(self.conserto()["estado"], "desistiu")
        self.assertEqual(self.conserto()["motivo"], "repositório sem projeto do Warren em fila.json")
        self.assertEqual(self.reservas(), {})

    def test_repositorio_casa_sem_diferenciar_maiusculas(self):
        self.passo([pedido(repositorio="Kustertech-Exemplo/Portal")])
        self.assertEqual(len(self.despachos()), 1)

    def test_estado_final_sai_quando_o_flow_nao_lista_mais(self):
        self.passo([pedido()], projetos={})
        self.passo([pedido()], projetos={})
        self.assertIn(ID, self.estado["consertos"])
        self.passo([])
        self.assertNotIn(ID, self.estado["consertos"])
        self.assertEqual(consertos.para_o_retrato(self.estado), [])
        # o mesmo id de volta (resposta atrasada) nunca é atendido de novo
        self.passo([pedido()])
        self.assertEqual(self.despachos(), [])
        self.assertNotIn(ID, self.estado["consertos"])

    def test_em_curso_que_sai_da_lista_continua_acompanhado(self):
        self.passo([pedido()])
        self.passo([])
        self.assertEqual(self.conserto()["estado"], "em_curso")
        self.assertEqual(self.reservas(), {"conserto:" + ID: ["fixer"]})

    def test_sem_resposta_so_acompanha_os_que_ja_existem(self):
        self.passo([pedido()])
        self.motor.definir_run(self.conserto()["runId"], estado="succeeded", prUrl=PR)
        self.passo(None)
        self.assertEqual(self.conserto()["estado"], "com_pr")
        self.passo(None)
        self.assertIn(ID, self.estado["consertos"])

    def test_sem_modelo_nada_e_despachado_e_avisa(self):
        eventos = self.passo([pedido()], modelo=None)
        self.assertEqual(self.despachos(), [])
        self.assertEqual(self.reservas(), {})
        avisos = [e for e in eventos if e["evento"] == "aviso"]
        self.assertEqual(len(avisos), 1)
        self.assertIn("configure modelos.fixer", avisos[0]["mensagem"])

    def test_falha_do_motor_nao_derruba_os_outros(self):
        self.motor.lotar()
        eventos = self.passo([pedido(), pedido(OUTRO_ID)])
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(self.conserto(ID)["estado"], "despachando")
        self.assertEqual(self.conserto(OUTRO_ID)["estado"], "em_curso")
        self.assertTrue(any(e["evento"] == "erro" for e in eventos))

    def test_nonce_no_log_nao_confunde_a_busca(self):
        outro_nonce = OUTRO_ID.replace("-", "")
        self.passo([pedido(trechoDoLog="<!-- fabrica:nonce=%s -->" % outro_nonce)])
        self.assertNotIn("fabrica:nonce=%s" % outro_nonce, self.despachos()[0]["prompt"])

    def test_retrato_tem_no_maximo_20(self):
        self.estado["consertos"] = {
            "%08x-0000-4000-8000-000000000000" % n: {
                "id": "%08x-0000-4000-8000-000000000000" % n,
                "estado": "desistiu",
                "runId": None,
                "prUrl": None,
                "motivo": "x",
                "em": "2026-11-19T12:%02d:00Z" % n,
            }
            for n in range(25)
        }
        self.assertEqual(len(consertos.para_o_retrato(self.estado)), 20)


if __name__ == "__main__":
    unittest.main()
