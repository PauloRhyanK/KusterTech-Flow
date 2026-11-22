import datetime
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import atendente  # noqa: E402
import capacidade  # noqa: E402
import motor  # noqa: E402
import prompts  # noqa: E402
from retrato import FalhaDeEnvio  # noqa: E402

CONVERSA = "11111111-2222-4333-8444-555555555555"
OUTRA = "22222222-3333-4444-8555-666666666666"
MENSAGEM = "33333333-4444-4555-8666-777777777777"
NOVA = "44444444-5555-4666-8777-888888888888"
REPO = "kustertech-exemplo/app"
INSTANTE = datetime.datetime(2026, 11, 22, 10, 0, 0, tzinfo=datetime.timezone.utc)
MODELOS = {"atendente": {"agente": "claude-code", "modelo": "claude-sonnet-5-5", "maxCustoUsd": 2}}
CARTAO = {"acao": "destino", "destino": "urgente", "nivel": "planejar_comigo"}


def conversa(id_=CONVERSA, responder_a=MENSAGEM, repositorio=REPO):
    return {
        "id": id_,
        "repositorio": repositorio,
        "responderA": responder_a,
        "aguardaDesde": "2026-11-22T09:59:00Z",
        "item": {"chave": "k", "tipo": "pedido", "titulo": "T", "pergunta": "P", "fatos": [], "relato": None, "acoes": ["destino"]},
        "mensagens": [{"id": responder_a, "autor": "paulo", "texto": "o que acha?", "respostaRapida": None, "anexos": [], "em": "2026-11-22T09:59:00Z"}],
    }


def busca(*conversas, ate="2026-11-22T10:10:00Z"):
    return {"conversas": list(conversas), "ativaAte": ate}


def resposta(mensagem="Mando para a fila?", cartao=None):
    corpo = {"mensagem": mensagem, "respostasRapidas": ["Sim"], "cartao": cartao}
    return "li o código\n%s\n%s\n%s" % (prompts.INICIO_ATENDENTE, json.dumps(corpo, ensure_ascii=False), prompts.FIM_ATENDENTE)


class ClienteFalso:
    """`buscas`: dict, None (404) ou exceção; `respostas`: texto, exceção ou `("recusado", motivo_do_cartao)`."""

    def __init__(self, buscas=(), respostas=()):
        self.buscas, self.respostas = list(buscas), list(respostas)
        self.buscados, self.enviados = 0, []
        self.ultima_recusa, self.ultimo_motivo_do_cartao = None, None

    def buscar_conversas(self):
        self.buscados += 1
        r = self.buscas.pop(0) if self.buscas else busca(ate=None)
        if isinstance(r, BaseException):
            raise r
        return r

    def responder(self, conversa_id, corpo):
        self.enviados.append((conversa_id, json.loads(json.dumps(corpo))))
        self.ultima_recusa, self.ultimo_motivo_do_cartao = None, None
        r = self.respostas.pop(0) if self.respostas else "aplicado"
        if isinstance(r, BaseException):
            raise r
        if isinstance(r, tuple):
            self.ultima_recusa, self.ultimo_motivo_do_cartao = "Cartão inválido.", r[1]
            return r[0]
        if r == "recusado":
            self.ultima_recusa = "Resposta fora de ordem."
        return r


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.capacidade = pathlib.Path(self._tmp.name) / "capacidade.json"
        self.motor = motor.MotorFalso()
        self.agora = INSTANTE
        self.motor.agora = lambda: self.agora
        self.estado = {}
        self.salvos = []
        self.mem = None

    def passo(self, cliente, *, modelos=None, projetos=None):
        return atendente.passo(
            self.estado,
            cliente=cliente,
            motor=self.motor,
            capacidade_path=self.capacidade,
            projetos={REPO: "app"} if projetos is None else projetos,
            modelos=MODELOS if modelos is None else modelos,
            agora=self.agora,
            mem_disponivel_mb=self.mem,
            salvar=lambda: self.salvos.append(json.loads(json.dumps(self.estado))),
        )

    def despachos(self):
        return [a for nome, a in self.motor.chamadas if nome == "despachar_run"]

    def atual(self):
        return self.estado["atendente"]["atual"]

    def avancar(self, segundos):
        self.agora = self.agora + datetime.timedelta(seconds=segundos)

    def despachar(self, *conversas):
        self.passo(ClienteFalso([busca(*(conversas or (conversa(),)))]))
        return self.atual()["runId"]

    def responder(self, run_id, texto=None):
        self.motor.definir_run(run_id, estado="succeeded")
        self.motor.definir_texto(run_id, resposta() if texto is None else texto)

    def avisos(self, eventos):
        return [e for e in eventos if e["evento"] == "aviso"]


class TestesPuros(unittest.TestCase):
    def test_nonce_do_motor(self):
        n = atendente.nonce_do_motor(CONVERSA, MENSAGEM, 0)
        self.assertRegex(n, r"^[0-9a-f]{32}$")
        self.assertNotEqual(n, atendente.nonce_do_motor(CONVERSA, MENSAGEM, 1))
        self.assertNotEqual(n, atendente.nonce_do_motor(CONVERSA, NOVA, 0))

    def test_secao_com_padrao_e_valores_tortos(self):
        estado = {}
        self.assertEqual(atendente.secao(estado), {"atual": None, "ativaAte": None, "semRotaEm": None})
        estado = {"atendente": {"atual": "x", "ativaAte": "amanhã", "semRotaEm": 3}}
        self.assertEqual(atendente.secao(estado), {"atual": None, "ativaAte": None, "semRotaEm": None})
        estado = {"atendente": {"atual": {"conversaId": "x", "fase": "respondendo"}}}
        self.assertIsNone(atendente.secao(estado)["atual"])
        self.assertEqual(atendente.secao({"atendente": []}), {"atual": None, "ativaAte": None, "semRotaEm": None})

    def test_proximo_passo(self):
        agora = INSTANTE
        self.assertEqual(atendente.proximo_passo(None, agora=agora), "buscar")
        self.assertEqual(atendente.proximo_passo({"fase": "enviando", "saida": {"id": "x"}}, agora=agora), "enviar")
        self.assertEqual(atendente.proximo_passo({"fase": "despachando", "saida": None}, agora=agora), "retomar_despacho")
        self.assertEqual(atendente.proximo_passo({"fase": "respondendo", "saida": None}, agora=agora), "acompanhar")

    def test_ativo_com_atual_ou_ativa_ate_no_futuro(self):
        self.assertFalse(atendente.ativo({}, INSTANTE))
        self.assertTrue(atendente.ativo({"atendente": {"ativaAte": "2026-11-22T10:05:00Z"}}, INSTANTE))
        self.assertFalse(atendente.ativo({"atendente": {"ativaAte": "2026-11-22T09:55:00Z"}}, INSTANTE))
        atual = {"conversaId": CONVERSA, "responderA": MENSAGEM, "fase": "respondendo", "runId": "run-1", "tentativa": 0, "conversa": conversa()}
        self.assertTrue(atendente.ativo({"atendente": {"atual": atual}}, INSTANTE))


class TestesPasso(Base):
    def test_sem_conversa_nao_despacha_e_grava_ativa_ate(self):
        eventos = self.passo(ClienteFalso([busca(ate="2026-11-22T10:10:00Z")]))
        self.assertEqual(self.despachos(), [])
        self.assertEqual(self.estado["atendente"]["ativaAte"], "2026-11-22T10:10:00Z")
        self.assertIsNone(self.atual())
        self.assertEqual(eventos, [])
        self.assertTrue(atendente.ativo(self.estado, INSTANTE))

    def test_conversa_esperando_despacha_um_run_com_o_modelo_atendente_e_sem_reservar_vaga(self):
        eventos = self.passo(ClienteFalso([busca(conversa())]))
        (despacho,) = self.despachos()
        hexa = atendente.nonce_do_motor(CONVERSA, MENSAGEM, 0)
        self.assertEqual(despacho["chave_idempotencia"], hexa)
        self.assertEqual((despacho["agente"], despacho["modelo"], despacho["max_custo_usd"], despacho["projeto"]), ("claude-code", "claude-sonnet-5-5", 2, "app"))
        self.assertTrue(despacho["prompt"].endswith("<!-- fabrica:nonce=%s -->" % hexa))
        self.assertIn(prompts.INICIO_ATENDENTE, despacho["prompt"])
        self.assertIsNone(despacho["branch_existente"])
        self.assertEqual(capacidade.ler(self.capacidade)["reservas"], {})
        antes = [s for s in self.salvos if (s["atendente"]["atual"] or {}).get("fase") == "despachando"]
        self.assertTrue(antes)
        self.assertEqual((antes[0]["atendente"]["atual"]["nonce"], antes[0]["atendente"]["atual"]["inicio"]), (hexa, "2026-11-22T10:00:00Z"))
        self.assertEqual((self.atual()["fase"], self.atual()["runId"], self.atual()["tentativa"]), ("respondendo", "run-1", 0))
        self.assertIn({"evento": "atendente_run", "conversaId": CONVERSA, "responderA": MENSAGEM, "runId": "run-1", "tentativa": 0}, eventos)

    def test_review_focus_1_reinicio_em_despachando_adota_o_run_pelo_nonce(self):
        hexa = atendente.nonce_do_motor(CONVERSA, MENSAGEM, 0)
        run_id = self.motor.despachar_run(
            projeto="app", agente="claude-code", modelo="m", prompt="x\n<!-- fabrica:nonce=%s -->" % hexa,
            branch_existente=None, max_custo_usd=1, chave_idempotencia=hexa,
        )
        self.estado["atendente"] = {"atual": {
            "conversaId": CONVERSA, "responderA": MENSAGEM, "projeto": "app", "tentativa": 0, "motivo": None,
            "cartaoRecusado": False, "fase": "despachando", "nonce": hexa, "runId": None, "inicio": "2026-11-22T10:00:00Z",
            "conversa": conversa(), "saida": None,
        }}
        cliente = ClienteFalso()
        self.passo(cliente)
        self.assertEqual(len(self.despachos()), 1)  # só o de cima
        self.assertEqual((self.atual()["fase"], self.atual()["runId"]), ("respondendo", run_id))
        self.assertEqual(cliente.buscados, 0)

    def test_reinicio_em_despachando_sem_run_repete_o_post_com_a_mesma_chave(self):
        hexa = atendente.nonce_do_motor(CONVERSA, MENSAGEM, 0)
        self.estado["atendente"] = {"atual": {
            "conversaId": CONVERSA, "responderA": MENSAGEM, "projeto": "app", "tentativa": 0, "motivo": None,
            "cartaoRecusado": False, "fase": "despachando", "nonce": hexa, "runId": None, "inicio": "2026-11-22T10:00:00Z",
            "conversa": conversa(), "saida": None,
        }}
        self.passo(ClienteFalso())
        (despacho,) = self.despachos()
        self.assertEqual(despacho["chave_idempotencia"], hexa)
        self.assertEqual(self.atual()["fase"], "respondendo")

    def test_queda_no_post_vira_erro_e_o_ciclo_seguinte_acha_pelo_nonce(self):
        self.motor.falhar_despacho("incerta")
        eventos = self.passo(ClienteFalso([busca(conversa())]))
        self.assertIn("erro", [e["evento"] for e in eventos])
        self.assertEqual(self.atual()["fase"], "despachando")
        self.passo(ClienteFalso())
        self.assertEqual(len(self.despachos()), 1)
        self.assertEqual((self.atual()["fase"], self.atual()["runId"]), ("respondendo", "run-1"))

    def test_review_focus_1_reinicio_em_enviando_reenvia_o_mesmo_id(self):
        run_id = self.despachar()
        self.responder(run_id)
        self.passo(ClienteFalso(respostas=[FalhaDeEnvio("falha de rede")]))  # o POST pode ter chegado
        id_ = self.atual()["saida"]["id"]
        self.assertEqual(self.atual()["fase"], "enviando")
        cliente = ClienteFalso(respostas=["repetido"])
        self.passo(cliente)
        ((conversa_id, corpo),) = cliente.enviados
        self.assertEqual((conversa_id, corpo["id"]), (CONVERSA, id_))
        self.assertIsNone(self.atual())
        self.assertEqual(len(self.despachos()), 1)

    def test_run_respondido_vira_saida_e_e_enviado_no_mesmo_passo(self):
        run_id = self.despachar()
        self.responder(run_id)
        cliente = ClienteFalso()
        eventos = self.passo(cliente)
        ((conversa_id, corpo),) = cliente.enviados
        self.assertEqual(conversa_id, CONVERSA)
        self.assertEqual(set(corpo), {"id", "emRespostaA", "mensagem", "respostasRapidas", "cartao"})
        self.assertRegex(corpo["id"], r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        self.assertEqual((corpo["emRespostaA"], corpo["mensagem"], corpo["respostasRapidas"], corpo["cartao"]), (MENSAGEM, "Mando para a fila?", ["Sim"], None))
        gravada = [s for s in self.salvos if (s["atendente"]["atual"] or {}).get("saida")]
        self.assertEqual(gravada[0]["atendente"]["atual"]["saida"]["id"], corpo["id"])  # gravada antes do POST
        self.assertEqual(gravada[0]["atendente"]["atual"]["fase"], "enviando")
        self.assertIsNone(self.atual())
        self.assertIn("atendente_resposta", [e["evento"] for e in eventos])

    def test_uma_conversa_por_vez_com_duas_esperando(self):
        segunda = conversa(OUTRA, NOVA)
        cliente = ClienteFalso([busca(conversa(), segunda)])
        self.passo(cliente)
        (despacho,) = self.despachos()
        self.assertEqual(despacho["chave_idempotencia"], atendente.nonce_do_motor(CONVERSA, MENSAGEM, 0))
        self.passo(cliente)  # o run ainda roda: nada de busca nem de run novo
        self.assertEqual((cliente.buscados, len(self.despachos())), (1, 1))
        self.responder("run-1")
        cliente.buscas.append(busca(segunda))
        self.passo(cliente)  # envia a primeira
        self.assertEqual(len(self.despachos()), 1)
        self.passo(cliente)  # e só agora a segunda
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(self.despachos()[1]["chave_idempotencia"], atendente.nonce_do_motor(OUTRA, NOVA, 0))

    def test_review_focus_2_mensagem_nova_durante_o_run(self):
        cliente = ClienteFalso([busca(conversa())])
        self.passo(cliente)
        # o Paulo escreve de novo: o Flow devolveria a conversa com `responderA` novo, mas nada busca durante o run
        cliente.buscas.append(busca(conversa(responder_a=NOVA)))
        self.passo(cliente)
        self.assertEqual((cliente.buscados, len(self.despachos())), (1, 1))
        self.responder("run-1")
        self.passo(cliente)
        ((_, corpo),) = cliente.enviados
        self.assertEqual(corpo["emRespostaA"], MENSAGEM)
        self.assertEqual(len(self.despachos()), 1)
        self.passo(cliente)
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(self.despachos()[1]["chave_idempotencia"], atendente.nonce_do_motor(CONVERSA, NOVA, 0))
        self.assertEqual(self.atual()["responderA"], NOVA)

    def test_resposta_fora_do_formato_refaz_uma_vez_com_o_motivo_e_depois_falha(self):
        run_id = self.despachar()
        self.responder(run_id, "sem bloco nenhum")
        cliente = ClienteFalso()
        self.passo(cliente)
        self.assertEqual(cliente.enviados, [])
        self.assertEqual(len(self.despachos()), 2)
        segundo = self.despachos()[1]
        self.assertEqual(segundo["chave_idempotencia"], atendente.nonce_do_motor(CONVERSA, MENSAGEM, 1))
        self.assertIn(atendente.MOTIVO_FORMATO, segundo["prompt"])
        self.assertEqual((self.atual()["tentativa"], self.atual()["motivo"], self.atual()["fase"]), (1, atendente.MOTIVO_FORMATO, "respondendo"))
        self.responder(self.atual()["runId"], "ainda fora")
        self.passo(cliente)
        ((_, corpo),) = cliente.enviados
        self.assertEqual(set(corpo), {"id", "emRespostaA", "falha"})
        self.assertEqual((corpo["emRespostaA"], corpo["falha"]), (MENSAGEM, "a resposta não veio no formato"))
        self.assertEqual(len(self.despachos()), 2)
        self.assertIsNone(self.atual())

    def test_cartao_recusado_refaz_uma_vez_e_depois_envia_sem_cartao_com_id_novo(self):
        run_id = self.despachar()
        self.responder(run_id, resposta(cartao=CARTAO))
        cliente = ClienteFalso(respostas=[("recusado", "o destino não vale aqui")])
        self.passo(cliente)
        ((_, primeiro),) = cliente.enviados
        self.assertEqual(primeiro["cartao"]["acao"], "destino")
        self.assertEqual(len(self.despachos()), 2)
        segundo = self.despachos()[1]
        self.assertEqual(segundo["chave_idempotencia"], atendente.nonce_do_motor(CONVERSA, MENSAGEM, 1))
        self.assertIn("o destino não vale aqui", segundo["prompt"])
        self.assertTrue(self.atual()["cartaoRecusado"])
        self.assertIsNone(self.atual()["saida"])
        self.responder(self.atual()["runId"], resposta("De novo", cartao=CARTAO))
        cliente.respostas = [("recusado", "ainda não vale"), "aplicado"]
        self.passo(cliente)
        _, segunda, terceira = [c for _, c in cliente.enviados]
        self.assertEqual(segunda["cartao"]["acao"], "destino")
        self.assertEqual((terceira["mensagem"], terceira["cartao"]), ("De novo", None))
        self.assertNotEqual(terceira["id"], segunda["id"])
        self.assertEqual(len(self.despachos()), 2)
        self.assertIsNone(self.atual())

    def test_teto_e_da_replica_somando_a_nova_tentativa(self):
        run_id = self.despachar()
        self.avancar(9 * 60)
        self.responder(run_id, "sem bloco nenhum")
        cliente = ClienteFalso()
        self.passo(cliente)  # minuto 9: refaz com o motivo do formato
        self.assertEqual((len(self.despachos()), self.atual()["inicio"]), (2, "2026-11-22T10:00:00Z"))
        self.avancar(2 * 60)
        self.passo(cliente)  # minuto 11: o segundo run ainda roda
        ((_, corpo),) = cliente.enviados
        self.assertEqual(corpo["falha"], "o agente passou de 10 min")
        self.assertIsNone(self.atual())

    def test_cartao_recusado_depois_do_formato_refaz_na_tentativa_2(self):
        run_id = self.despachar()
        self.responder(run_id, "sem bloco nenhum")
        cliente = ClienteFalso(respostas=[("recusado", "o destino não vale aqui")])
        self.passo(cliente)
        self.responder(self.atual()["runId"], resposta(cartao=CARTAO))
        self.passo(cliente)
        self.assertEqual(len(self.despachos()), 3)
        self.assertEqual(self.despachos()[2]["chave_idempotencia"], atendente.nonce_do_motor(CONVERSA, MENSAGEM, 2))
        self.assertEqual(self.atual()["tentativa"], 2)
        self.responder(self.atual()["runId"], "fora de novo")
        self.passo(cliente)
        _, corpo = cliente.enviados[-1]
        self.assertEqual(corpo["falha"], "a resposta não veio no formato")
        self.assertEqual(len(self.despachos()), 3)

    def test_falhas_de_envio_seguidas_dao_um_aviso_so_e_seguem_com_o_mesmo_id(self):
        run_id = self.despachar()
        self.responder(run_id)
        limite = atendente.LIMITE_FALHAS_DE_ENVIO
        cliente = ClienteFalso(respostas=[FalhaDeEnvio("HTTP 401")] * (limite + 3))
        avisos = []
        for _ in range(limite + 3):
            avisos += self.avisos(self.passo(cliente))
        (aviso,) = avisos
        self.assertEqual(aviso["chave"], "atendente:envio")
        self.assertIn("HTTP 401", aviso["mensagem"])
        self.assertEqual(len({c["id"] for _, c in cliente.enviados}), 1)
        self.assertEqual(self.atual()["falhasDeEnvio"], limite + 3)
        self.assertEqual((cliente.buscados, len(self.despachos())), (0, 1))
        self.passo(cliente)  # o Flow volta
        self.assertIsNone(self.atual())

    def test_falha_de_envio_conta_do_zero_depois_de_um_envio_que_chega(self):
        run_id = self.despachar()
        self.responder(run_id, resposta(cartao=CARTAO))
        cliente = ClienteFalso(respostas=[FalhaDeEnvio("HTTP 503")] * 3 + [("recusado", "não vale")])
        for _ in range(4):
            self.passo(cliente)
        self.assertNotIn("falhasDeEnvio", self.atual())
        self.assertEqual(self.atual()["fase"], "respondendo")

    def test_entrada_torta_nao_levanta(self):
        eventos = atendente.passo(
            [], cliente=ClienteFalso(), motor=self.motor, capacidade_path=self.capacidade, projetos=None,
            modelos=MODELOS, agora="nao e instante", mem_disponivel_mb=None, salvar=None,
        )
        (erro,) = eventos
        self.assertEqual((erro["evento"], erro["etapa"]), ("erro", "atendente"))

    def test_ultimo_texto_que_falha_respeita_o_teto(self):
        run_id = self.despachar()
        self.motor.definir_run(run_id, estado="succeeded")
        self.motor.ultimo_texto = lambda _run_id: (_ for _ in ()).throw(RuntimeError("HTTP 500"))
        cliente = ClienteFalso()
        self.assertEqual([e["evento"] for e in self.passo(cliente)], ["erro"])
        self.avancar(atendente.TETO_ATENDENTE_S + 1)
        self.passo(cliente)
        ((_, corpo),) = cliente.enviados
        self.assertEqual(corpo["falha"], "o agente passou de 10 min")

    def test_ativo_nao_muda_o_estado(self):
        atual = {"conversaId": CONVERSA, "responderA": MENSAGEM, "fase": "respondendo", "runId": "r", "tentativa": "x", "conversa": conversa()}
        estado = {"atendente": {"atual": atual}}
        self.assertTrue(atendente.ativo(estado, INSTANTE))
        self.assertEqual(atual["tentativa"], "x")

    def test_outra_recusa_avisa_e_tira_o_atual(self):
        run_id = self.despachar()
        self.responder(run_id)
        eventos = self.passo(ClienteFalso(respostas=["recusado"]))
        (aviso,) = self.avisos(eventos)
        self.assertIn("Resposta fora de ordem.", aviso["mensagem"])
        self.assertIsNone(self.atual())

    def test_run_falho_teto_e_pr_aberto_viram_falha_para_o_flow(self):
        casos = [
            ({"estado": "failed", "motivoFalha": "x" * 300}, 0, "o agente falhou: " + "x" * 150),
            ({"estado": "cancelled"}, 0, "o agente falhou: cancelled"),
            ({"estado": "running"}, atendente.TETO_ATENDENTE_S + 1, "o agente passou de 10 min"),
            ({"estado": "succeeded", "prUrl": "https://github.com/kustertech-exemplo/app/pull/7"}, 0, "o agente abriu um PR; resposta descartada"),
        ]
        for campos, espera, motivo in casos:
            with self.subTest(motivo=motivo):
                self.setUp()
                run_id = self.despachar()
                self.motor.retry_infra_perdida = False
                self.motor.definir_run(run_id, **campos)
                self.motor.definir_texto(run_id, resposta())
                self.avancar(espera)
                cliente = ClienteFalso()
                eventos = self.passo(cliente)
                ((_, corpo),) = cliente.enviados
                self.assertEqual(corpo, {"id": corpo["id"], "emRespostaA": MENSAGEM, "falha": motivo})
                self.assertIsNone(self.atual())
                self.assertEqual(len(self.despachos()), 1)
                if "prUrl" in campos:
                    (aviso,) = self.avisos(eventos)
                    self.assertEqual(aviso["mensagem"], "Atendente: o agente abriu um PR (https://github.com/kustertech-exemplo/app/pull/7); resposta descartada")

    def test_run_dentro_do_teto_nao_faz_nada(self):
        self.despachar()
        self.avancar(atendente.TETO_ATENDENTE_S - 1)
        cliente = ClienteFalso()
        self.assertEqual(self.passo(cliente), [])
        self.assertEqual((cliente.enviados, cliente.buscados), ([], 0))

    def test_run_perdido_por_infra_adota_o_retry_do_warren(self):
        run_id = self.despachar()
        self.motor.definir_run(run_id, estado="failed", motivoFalha="sandbox_run_lost")
        cliente = ClienteFalso()
        self.passo(cliente)
        self.assertEqual(cliente.enviados, [])
        novo = self.atual()["runId"]
        self.assertNotEqual(novo, run_id)
        self.responder(novo)
        self.passo(cliente)
        ((_, corpo),) = cliente.enviados
        self.assertEqual(corpo["mensagem"], "Mando para a fila?")
        self.assertEqual(len(self.despachos()), 1)

    def test_review_focus_4_flow_fora_com_saida_pronta_nao_despacha_nada(self):
        run_id = self.despachar()
        self.responder(run_id)
        cliente = ClienteFalso([busca(conversa(OUTRA, NOVA))], respostas=[FalhaDeEnvio("HTTP 503"), FalhaDeEnvio("falha de rede")])
        eventos = self.passo(cliente)
        self.assertIn("erro", [e["evento"] for e in eventos])
        id_ = self.atual()["saida"]["id"]
        self.passo(cliente)
        self.assertEqual((cliente.buscados, len(self.despachos())), (0, 1))
        self.assertEqual(self.atual()["saida"]["id"], id_)
        self.passo(cliente)
        self.assertEqual([c["id"] for _, c in cliente.enviados], [id_, id_, id_])
        self.assertIsNone(self.atual())
        self.passo(cliente)
        self.assertEqual(len(self.despachos()), 2)

    def test_review_focus_5_memoria_baixa_ou_drenagem_espera_com_um_aviso(self):
        capacidade.configurar(self.capacidade, vagas=2, ram_minima_mb=2048)
        self.mem = 1024
        cliente = ClienteFalso([busca(conversa()), busca(conversa())])
        eventos = self.passo(cliente)
        (aviso,) = self.avisos(eventos)
        self.assertEqual(aviso["mensagem"], "Atendente: memória livre abaixo do mínimo; a conversa espera")
        self.assertEqual(self.despachos(), [])
        self.assertIsNone(self.atual())
        self.mem = 4096
        capacidade.definir_drenagem(self.capacidade, "2026-11-22T10:00:00Z")
        eventos = self.passo(cliente)
        self.assertEqual(len(self.avisos(eventos)), 1)
        self.assertEqual(self.despachos(), [])
        capacidade.definir_drenagem(self.capacidade, None)
        self.passo(ClienteFalso([busca(conversa())]))
        (despacho,) = self.despachos()
        self.assertEqual(despacho["chave_idempotencia"], atendente.nonce_do_motor(CONVERSA, MENSAGEM, 0))

    def test_repositorio_fora_da_fila_vira_falha(self):
        cliente = ClienteFalso([busca(conversa(repositorio="kustertech-exemplo/outro"))])
        self.passo(cliente)
        self.assertEqual(self.despachos(), [])
        ((_, corpo),) = cliente.enviados
        self.assertEqual((corpo["emRespostaA"], corpo["falha"]), (MENSAGEM, "o repositório kustertech-exemplo/outro não está na fila da Fábrica"))
        self.assertIsNone(self.atual())

    def test_sem_modelo_atendente_avisa_e_espera(self):
        cliente = ClienteFalso([busca(conversa())])
        eventos = self.passo(cliente, modelos={})
        (aviso,) = self.avisos(eventos)
        self.assertEqual(aviso["mensagem"], "Atendente: configure modelos.atendente (agente, modelo, maxCustoUsd) em fabrica/modelos/config.json do kit")
        self.assertEqual((self.despachos(), cliente.enviados), ([], []))
        self.assertIsNone(self.atual())

    def test_flow_antigo_404_desliga_por_uma_hora_com_um_aviso(self):
        cliente = ClienteFalso([None, None])
        eventos = self.passo(cliente)
        (aviso,) = self.avisos(eventos)
        self.assertEqual(aviso["mensagem"], "Atendente: o Flow ainda não tem o Decidir")
        self.assertEqual(self.estado["atendente"]["semRotaEm"], "2026-11-22T10:00:00Z")
        self.avancar(atendente.REVER_FLOW_SEM_CONVERSAS_S - 1)
        self.assertEqual(self.passo(cliente), [])
        self.assertEqual(cliente.buscados, 1)
        self.avancar(2)
        self.assertEqual(self.passo(cliente), [])  # de novo 404: sem segundo aviso
        self.assertEqual(cliente.buscados, 2)
        self.avancar(atendente.REVER_FLOW_SEM_CONVERSAS_S)
        cliente.buscas.append(busca(conversa()))
        self.passo(cliente)
        self.assertIsNone(self.estado["atendente"]["semRotaEm"])
        self.assertEqual(len(self.despachos()), 1)

    def test_conversa_encerrada_no_flow_410_tira_o_atual(self):
        run_id = self.despachar()
        self.responder(run_id)
        self.passo(ClienteFalso(respostas=["encerrada"]))
        self.assertIsNone(self.atual())

    def test_falha_na_busca_vira_evento_e_nao_levanta(self):
        eventos = self.passo(ClienteFalso([FalhaDeEnvio("HTTP 500")]))
        (erro,) = [e for e in eventos if e["evento"] == "erro"]
        self.assertIn("HTTP 500", erro["erro"])
        self.assertIsNone(self.atual())


if __name__ == "__main__":
    unittest.main()
