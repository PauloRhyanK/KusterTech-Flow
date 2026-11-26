import datetime
import json
import pathlib
import subprocess
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import buscador  # noqa: E402
from retrato import FalhaDeEnvio  # noqa: E402

BUSCA = "11111111-2222-4333-8444-555555555555"
A = "aaaaaaaa-2222-4333-8444-555555555555"
B = "bbbbbbbb-2222-4333-8444-555555555555"
FORA = "ffffffff-2222-4333-8444-555555555555"
AGORA = datetime.datetime(2026, 11, 26, 18, 0, 0, tzinfo=datetime.timezone.utc)
MODELOS = {"buscador": {"agente": "claude-code", "modelo": "claude-haiku-5-5", "maxCustoUsd": 0.5}}


def ficha(i, titulo):
    return {"id": i, "titulo": titulo, "resumo": "r"}


BUSCA_PENDENTE = {
    "id": BUSCA,
    "pergunta": "notificação por WhatsApp",
    "fichas": [ficha(A, "Relatos pelo WhatsApp"), ficha(B, "Backup")],
    "candidatas": 10,
}


class ClienteFalso:
    def __init__(self, buscas=(), respostas=(), textos=None):
        self.buscas, self.respostas = list(buscas), list(respostas)
        self.textos_dados = textos or [{"id": A, "titulo": "Relatos pelo WhatsApp", "texto": "Bot do WhatsApp"}]
        self.chamadas = []

    def buscar(self):
        self.chamadas.append(("buscar",))
        r = self.buscas.pop(0) if self.buscas else {}
        if isinstance(r, Exception):
            raise r
        return r

    def textos(self, busca_id, ids):
        self.chamadas.append(("textos", busca_id, list(ids)))
        return [t for t in self.textos_dados if t["id"] in ids]

    def responder(self, busca_id, corpo):
        self.chamadas.append(("responder", busca_id, corpo))
        r = self.respostas.pop(0) if self.respostas else "aplicado"
        if isinstance(r, Exception):
            raise r
        return r


def chamadas_falsas(*saidas):
    """`chamar` falso: devolve as saídas em ordem (dict de saída ou exceção) e guarda os prompts."""
    fila = list(saidas)
    feitas = []

    def chamar(prompt, schema, *, modelo, max_custo_usd):
        feitas.append({"prompt": prompt, "schema": schema, "modelo": modelo, "max": max_custo_usd})
        s = fila.pop(0)
        if isinstance(s, Exception):
            raise s
        return {"saida": s, "custoUsd": 0.01, "tokensEntrada": 1000, "tokensSaida": 100}

    chamar.feitas = feitas
    return chamar


class Base(unittest.TestCase):
    def setUp(self):
        self.estado = {}
        self.salvos = 0

    def salvar(self):
        self.salvos += 1

    def passo(self, cliente, chamar, modelos=MODELOS, agora=AGORA):
        return buscador.passo(self.estado, cliente=cliente, modelos=modelos, agora=agora, salvar=self.salvar, chamar=chamar)


class TestesPasso(Base):
    def test_sem_modelo_avisa_e_nao_busca(self):
        cliente = ClienteFalso()
        eventos = self.passo(cliente, chamadas_falsas(), modelos={})
        self.assertEqual(eventos, [{"evento": "aviso", "chave": "buscador:modelo", "mensagem": buscador.AVISO_SEM_MODELO}])
        self.assertEqual(cliente.chamadas, [])

    def test_flow_sem_a_rota_desliga_por_uma_hora(self):
        cliente = ClienteFalso(buscas=[None])
        self.assertEqual(self.passo(cliente, chamadas_falsas()), [])
        self.passo(cliente, chamadas_falsas(), agora=AGORA + datetime.timedelta(minutes=59))
        self.assertEqual(len(cliente.chamadas), 1)
        self.passo(cliente, chamadas_falsas(), agora=AGORA + datetime.timedelta(minutes=61))
        self.assertEqual(len(cliente.chamadas), 2)

    def test_nada_pendente_nao_chama_o_modelo(self):
        chamar = chamadas_falsas()
        self.assertEqual(self.passo(ClienteFalso(buscas=[{}]), chamar), [])
        self.assertEqual(chamar.feitas, [])

    def test_sem_candidatas_responde_o_resumo_da_etapa_1(self):
        cliente = ClienteFalso(buscas=[BUSCA_PENDENTE])
        chamar = chamadas_falsas({"candidatas": [], "resumo": "Nenhuma trata de WhatsApp."})
        eventos = self.passo(cliente, chamar)
        self.assertEqual(len(chamar.feitas), 1)
        self.assertIn("notificação por WhatsApp", chamar.feitas[0]["prompt"])
        self.assertIn(A, chamar.feitas[0]["prompt"])
        self.assertEqual((chamar.feitas[0]["modelo"], chamar.feitas[0]["max"]), ("claude-haiku-5-5", 0.5))
        (_, (_, busca_id, corpo)) = cliente.chamadas
        self.assertEqual(busca_id, BUSCA)
        self.assertEqual(corpo["resumo"], "Nenhuma trata de WhatsApp.")
        self.assertEqual(corpo["itens"], [])
        self.assertEqual((corpo["tokensEntrada"], corpo["tokensSaida"], corpo["custoUsd"]), (1000, 100, 0.01))
        self.assertEqual(corpo["modelo"], "claude-haiku-5-5")
        self.assertRegex(corpo["id"], r"^[0-9a-f-]{36}$")
        self.assertEqual(eventos, [{"evento": "buscador_respondida", "buscaId": BUSCA, "resultado": "aplicado"}])
        self.assertIsNone(self.estado["buscador"]["atual"])

    def test_com_candidatas_le_os_textos_e_soma_as_duas_etapas(self):
        cliente = ClienteFalso(buscas=[BUSCA_PENDENTE])
        chamar = chamadas_falsas(
            {"candidatas": [A, FORA, A], "resumo": "x"},
            {
                "resumo": "Existe: os relatos pelo WhatsApp.",
                "itens": [
                    {"demandaId": A, "relevancia": "alta", "motivo": "Recebe pelo bot."},
                    {"demandaId": B, "relevancia": "baixa", "motivo": "Não era candidata."},
                    {"demandaId": A, "relevancia": "muita", "motivo": "x"},
                ],
            },
        )
        self.passo(cliente, chamar)
        self.assertEqual(cliente.chamadas[1], ("textos", BUSCA, [A]))
        self.assertIn("Bot do WhatsApp", chamar.feitas[1]["prompt"])
        corpo = cliente.chamadas[2][2]
        self.assertEqual(corpo["itens"], [{"demandaId": A, "relevancia": "alta", "motivo": "Recebe pelo bot."}])
        self.assertEqual(corpo["resumo"], "Existe: os relatos pelo WhatsApp.")
        self.assertEqual((corpo["tokensEntrada"], corpo["tokensSaida"]), (2000, 200))
        self.assertAlmostEqual(corpo["custoUsd"], 0.02)

    def test_falha_do_modelo_vira_falha_com_o_custo_gasto(self):
        cliente = ClienteFalso(buscas=[BUSCA_PENDENTE])
        chamar = chamadas_falsas({"candidatas": [A], "resumo": "x"}, buscador.FalhaDaChamada("passou de 60 s"))
        self.passo(cliente, chamar)
        corpo = cliente.chamadas[-1][2]
        self.assertEqual(corpo["falha"], "passou de 60 s")
        self.assertEqual(corpo["custoUsd"], 0.01)
        self.assertNotIn("resumo", corpo)

    def test_saida_da_etapa_1_torta_vira_falha(self):
        cliente = ClienteFalso(buscas=[BUSCA_PENDENTE])
        self.passo(cliente, chamadas_falsas({"outra": 1}))
        self.assertEqual(cliente.chamadas[-1][2]["falha"], "resposta do modelo fora do formato")

    def test_post_que_falha_guarda_o_corpo_e_reenvia_o_mesmo_id(self):
        cliente = ClienteFalso(buscas=[BUSCA_PENDENTE], respostas=[FalhaDeEnvio("rede"), "aplicado"])
        chamar = chamadas_falsas({"candidatas": [], "resumo": "Nada."})
        eventos = self.passo(cliente, chamar)
        self.assertEqual(eventos[0]["evento"], "erro")
        guardado = self.estado["buscador"]["atual"]
        self.assertEqual(guardado["buscaId"], BUSCA)
        self.passo(cliente, chamadas_falsas())
        primeiro, segundo = [c for c in cliente.chamadas if c[0] == "responder"]
        self.assertEqual(primeiro[2]["id"], segundo[2]["id"])
        self.assertIsNone(self.estado["buscador"]["atual"])
        self.assertEqual(cliente.chamadas.count(("buscar",)), 1)

    def test_erro_ao_buscar_vira_evento_e_nao_levanta(self):
        eventos = self.passo(ClienteFalso(buscas=[FalhaDeEnvio("HTTP 500")]), chamadas_falsas())
        self.assertEqual(eventos[0]["evento"], "erro")


class TestesRodarClaude(unittest.TestCase):
    def executar(self, stdout="", erro=None, codigo=0):
        chamadas = []

        def executar(argv, **kw):
            chamadas.append((argv, kw))
            if erro:
                raise erro
            return subprocess.CompletedProcess(argv, codigo, stdout=stdout, stderr="")

        executar.chamadas = chamadas
        return executar

    def rodar(self, executar):
        return buscador.rodar_claude(
            "PROMPT", {"type": "object"}, modelo="claude-haiku-5-5", max_custo_usd=0.5, binario="/bin/claude", executar=executar
        )

    def test_argv_e_leitura_do_json(self):
        saida = {
            "is_error": False,
            "structured_output": {"candidatas": []},
            "total_cost_usd": 0.0123,
            "usage": {"input_tokens": 100, "cache_read_input_tokens": 50, "cache_creation_input_tokens": 25, "output_tokens": 40},
        }
        executar = self.executar(json.dumps(saida))
        r = self.rodar(executar)
        self.assertEqual(r, {"saida": {"candidatas": []}, "custoUsd": 0.0123, "tokensEntrada": 175, "tokensSaida": 40})
        ((argv, kw),) = executar.chamadas
        self.assertEqual(
            argv,
            [
                "/bin/claude", "-p", "--model", "claude-haiku-5-5", "--output-format", "json",
                "--json-schema", json.dumps({"type": "object"}), "--tools", "", "--no-session-persistence",
                "--max-budget-usd", "0.5", "--setting-sources", "", "--strict-mcp-config",
                "--system-prompt", buscador.SISTEMA,
            ],
        )
        self.assertEqual((kw["input"], kw["timeout"], kw["text"], kw["capture_output"]), ("PROMPT", 60, True, True))

    def test_falhas_viram_falha_da_chamada_com_motivo_curto(self):
        casos = [
            (self.executar(erro=subprocess.TimeoutExpired("claude", 60)), "passou de 60 s"),
            (self.executar(erro=FileNotFoundError()), "CLI claude não encontrado"),
            (self.executar("isso não é json"), "resposta ilegível"),
            (self.executar(json.dumps({"is_error": True, "result": "Invalid API key · Please run /login"})), "Invalid API key · Please run /login"),
            (self.executar(json.dumps({"is_error": False, "total_cost_usd": 0})), "sem saída estruturada"),
        ]
        for executar, motivo in casos:
            with self.subTest(motivo=motivo), self.assertRaises(buscador.FalhaDaChamada) as ctx:
                self.rodar(executar)
            self.assertEqual(str(ctx.exception), motivo)


if __name__ == "__main__":
    unittest.main()
