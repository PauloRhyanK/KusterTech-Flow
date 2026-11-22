"""Ponta a ponta do atendente do Decidir: o coordenador real, o cliente real das conversas e um Flow em memória.

O `FlowFalso` responde pelo `abrir` do `ClienteDasConversas` (o HTTP do kit roda de verdade) com as regras de
`registrarRespostaDoAtendente` e `buscarConversasParaOAtendente` do Flow: a busca traz só as conversas com uma
mensagem escrita do Paulo sem resposta, a mais antiga primeiro, e `ativaAte` = a última mensagem do Paulo + 10 min;
a resposta com o mesmo `id` e o mesmo conteúdo é `repetido` (200), com outro conteúdo `409`; o cartão inválido é
`422` com o motivo, sem gravar nada; e a espera só é limpa quando `emRespostaA` é a mensagem que espera. Tocar uma
resposta rápida do agente é escrever o texto dela (uma mensagem escrita do Paulo).

O "Warren" é o `MotorFalso` do kit: o run termina quando o teste diz, com o texto que o teste escreve. As quedas
simulam o processo morrendo no meio de um passo (`Queda` é `BaseException`: nada do kit a captura); depois dela o
coordenador seguinte é construído do disco.
"""

import datetime
import json
import pathlib
import sys
import tempfile
import unittest
import unittest.mock
import urllib.parse
import uuid

RAIZ_DOS_SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ_DOS_SCRIPTS))

import atendente  # noqa: E402
import capacidade  # noqa: E402
import conversas_flow  # noqa: E402
import coordenador  # noqa: E402
import forja as forja_  # noqa: E402
import motor as motor_  # noqa: E402
import prompts  # noqa: E402
import testes_coordenador as tc  # noqa: E402

REPO = "kustertech-exemplo/app"
PROJETO = "app"
CONVERSA = "11111111-2222-4333-8444-555555555555"
TOKEN = "token-do-flow-de-teste-123"
INICIO = datetime.datetime(2026, 11, 22, 10, 0, 0, tzinfo=datetime.timezone.utc)
FORMATO = "%Y-%m-%dT%H:%M:%SZ"
CARTAO = {"acao": "destino", "destino": "urgente", "nivel": "planejar_comigo"}


class Queda(BaseException):
    """O processo do coordenador morreu aqui."""


def texto_do_agente(mensagem, rapidas=(), cartao=None):
    corpo = {"mensagem": mensagem, "respostasRapidas": list(rapidas), "cartao": cartao}
    return "li o código\n%s\n%s\n%s" % (prompts.INICIO_ATENDENTE, json.dumps(corpo, ensure_ascii=False), prompts.FIM_ATENDENTE)


class Resposta:
    def __init__(self, codigo, corpo):
        self.status, self._corpo = codigo, json.dumps(corpo).encode("utf-8")

    def read(self, limite=-1):
        return self._corpo if limite < 0 else self._corpo[:limite]

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


# ---------------------------------------------------------------- Flow


class FlowFalso:
    """As rotas do Decidir do Flow em memória, atrás do `abrir` do cliente real."""

    def __init__(self, relogio):
        self.relogio = relogio
        self.sem_rota = False
        self.conversas = {}
        self.aplicados = {}  # id da resposta → conteúdo gravado
        self.aplicacoes = []  # cada id gravado (nunca repetido)
        self.repetidos = []
        self.buscas = 0
        self.pedidos = 0
        self.cair_depois_de_gravar = 0

    def abrir_conversa(self, conversa_id, *, acoes=("destino",)):
        self.conversas[conversa_id] = {
            "repositorio": REPO,
            "item": {"chave": "demanda:x", "tipo": "pedido", "titulo": "Tela de login", "pergunta": "Para onde vai?", "fatos": [], "relato": None, "acoes": list(acoes)},
            "mensagens": [{"id": str(uuid.uuid4()), "autor": "flow", "texto": "A triagem não conseguiu classificar.", "respostaRapida": None, "respostasRapidas": [], "anexos": [], "em": self.relogio()}],
            "aguardaDesde": None,
            "responderA": None,
            "cartao": None,
            "encerrada": False,
        }

    def paulo_escreve(self, conversa_id, texto):
        c = self.conversas[conversa_id]
        id_ = str(uuid.uuid4())
        c["mensagens"].append({"id": id_, "autor": "paulo", "texto": texto, "respostaRapida": None, "respostasRapidas": [], "anexos": [], "em": self.relogio()})
        c["aguardaDesde"] = c["aguardaDesde"] or self.relogio()
        c["responderA"] = id_
        return id_

    def do_agente(self, conversa_id):
        return [m for m in self.conversas[conversa_id]["mensagens"] if m["autor"] in ("agente", "flow-falha")]

    # ------------------------------------------------ HTTP

    def abrir(self, req, timeout=None):
        assert req.get_header("Authorization") == "Bearer " + TOKEN, "sem o token da Fábrica"
        caminho = urllib.parse.urlsplit(req.full_url).path
        self.pedidos += 1
        if self.sem_rota:
            return Resposta(404, {"erro": "Não encontrado."})
        if req.get_method() == "GET" and caminho == conversas_flow.CAMINHO_DA_ROTA:
            return Resposta(200, self.buscar())
        partes = caminho[len(conversas_flow.CAMINHO_DA_ROTA) + 1 :].split("/")
        if req.get_method() == "POST" and len(partes) == 2 and partes[1] == "respostas":
            return self.responder(partes[0], json.loads(req.data.decode("utf-8")))
        return Resposta(404, {"erro": "Não encontrado."})

    def buscar(self):
        self.buscas += 1
        esperando = sorted((c["aguardaDesde"], id_) for id_, c in self.conversas.items() if c["aguardaDesde"] and not c["encerrada"])
        do_paulo = [m["em"] for c in self.conversas.values() for m in c["mensagens"] if m["autor"] == "paulo"]
        ate = None
        if do_paulo:
            ate = (datetime.datetime.strptime(max(do_paulo), FORMATO) + datetime.timedelta(minutes=10)).strftime(FORMATO)
        conversas = []
        for _, id_ in esperando:
            c = self.conversas[id_]
            mensagens = [{k: m[k] for k in ("id", "autor", "texto", "respostaRapida", "anexos", "em")} for m in c["mensagens"]]
            conversas.append({"id": id_, "repositorio": c["repositorio"], "responderA": c["responderA"], "aguardaDesde": c["aguardaDesde"], "item": c["item"], "mensagens": mensagens})
        return {"conversas": conversas, "ativaAte": ate}

    def responder(self, conversa_id, corpo):
        c = self.conversas.get(conversa_id)
        if c is None:
            return Resposta(404, {"erro": "Não encontrado."})
        if c["encerrada"]:
            return Resposta(410, {"erro": "Este item já foi resolvido."})
        conteudo = json.dumps(corpo, sort_keys=True, ensure_ascii=False)
        if corpo["id"] in self.aplicados:
            if self.aplicados[corpo["id"]] == conteudo:
                self.repetidos.append(corpo["id"])
                return Resposta(200, {"resultado": "repetido"})
            return Resposta(409, {"erro": "Resposta repetida com outro conteúdo."})
        cartao = corpo.get("cartao")
        if cartao is not None and (not isinstance(cartao, dict) or cartao.get("acao") not in c["item"]["acoes"]):
            return Resposta(422, {"erro": "Cartão inválido.", "campo": "cartao", "motivo": "ação fora do item"})
        self.aplicados[corpo["id"]] = conteudo
        self.aplicacoes.append(corpo["id"])
        if "falha" in corpo:
            c["mensagens"].append({"id": corpo["id"], "autor": "flow-falha", "texto": corpo["falha"], "respostaRapida": None, "respostasRapidas": [], "anexos": [], "em": self.relogio()})
        else:
            c["mensagens"].append(
                {"id": corpo["id"], "autor": "agente", "texto": corpo["mensagem"], "respostaRapida": None, "respostasRapidas": corpo["respostasRapidas"], "anexos": [], "em": self.relogio()}
            )
            if cartao is not None:
                c["cartao"] = cartao
        if corpo["emRespostaA"] == c["responderA"]:
            c["aguardaDesde"] = c["responderA"] = None
        if self.cair_depois_de_gravar:
            self.cair_depois_de_gravar -= 1
            raise Queda()  # gravado no Flow; a resposta não chega ao kit
        return Resposta(201, {"resultado": "aplicado"})


class MotorQueCai(motor_.MotorFalso):
    """O `MotorFalso` que pode cair logo depois de criar o run (o `POST` pago foi, o `runId` não foi gravado)."""

    def __init__(self):
        super().__init__()
        self.cair_depois_do_despacho = 0

    def despachar_run(self, **argumentos):
        run_id = super().despachar_run(**argumentos)
        if self.cair_depois_do_despacho:
            self.cair_depois_do_despacho -= 1
            raise Queda()
        return run_id


# ---------------------------------------------------------------- simulação


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.raiz = pathlib.Path(self._tmp.name) / "fabrica"
        self.raiz.mkdir()
        self.token_file = pathlib.Path(self._tmp.name) / "central-token"
        self.token_file.write_text(TOKEN, encoding="utf-8")
        (self.raiz / "fila.json").write_text(json.dumps({"repos": [{"repo": REPO, "projeto": PROJETO}]}), encoding="utf-8")
        capacidade.configurar(self.raiz / "capacidade.json", vagas=3, ram_minima_mb=0)
        patcher = unittest.mock.patch.object(capacidade, "mem_disponivel_mb", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.instante = INICIO
        self.flow = FlowFalso(lambda: self.instante.strftime(FORMATO))
        self.motor = MotorQueCai()
        self.motor.agora = lambda: self.instante
        self.forja = forja_.ForjaFalsa()
        self.enviar = tc.EnviarFalso(resposta={"resultado": "gravado"})
        self.demandas = tc.FlowVazio()
        self.quedas = 0
        self.c = self.novo()

    def novo(self):
        return coordenador.Coordenador(
            raiz=self.raiz,
            forja=self.forja,
            motor=self.motor,
            systemd=tc.SystemdFalso(),
            executar=tc.ExecutarFalso(self.forja),
            preparar_warren=tc.PrepararFalso(),
            kit=coordenador.KIT_PADRAO,
            agora=lambda: self.instante,
            clonar=lambda repo, destino: (pathlib.Path(destino) / ".git").mkdir(parents=True),
            ambiente={"WARREN_API": "http://127.0.0.1:8080", "WARREN_TOKEN_FILE": "/seg/warren", "GH_TOKEN_FILE": "/seg/gh"},
            central={"url": "https://central.exemplo/api/fabrica/estado", "token_file": str(self.token_file)},
            enviar=self.enviar,
            cliente_do_flow=lambda url, token_file: self.demandas,
            cliente_das_conversas=lambda url, token_file: conversas_flow.ClienteDasConversas(url, token_file, abrir=self.flow.abrir),
        )

    def protegido(self, passo):
        """Roda um passo; com uma queda, o serviço volta e o coordenador seguinte lê tudo do disco."""
        try:
            passo(self.c)
        except Queda:
            self.quedas += 1
            self.c = self.novo()

    def ciclo(self):
        self.instante += datetime.timedelta(seconds=atendente.INTERVALO_DO_ATENDENTE_S)
        self.protegido(lambda c: c.ciclo())

    def consulta(self):
        """Uma consulta rápida entre ciclos (o que o `_esperar` faz a cada 3 s com conversa ativa)."""
        self.instante += datetime.timedelta(seconds=atendente.INTERVALO_DO_ATENDENTE_S)
        self.protegido(lambda c: c._passo_atendente())

    def despachos(self):
        return [a for nome, a in self.motor.chamadas if nome == "despachar_run"]

    def run_atual(self):
        atual = coordenador.ler_estado(self.raiz).get("atendente", {}).get("atual") or {}
        return atual.get("runId")

    def terminar(self, texto):
        run_id = self.run_atual()
        self.assertIsNotNone(run_id, "sem run em curso")
        self.motor.definir_texto(run_id, texto)
        self.motor.definir_run(run_id, estado="succeeded")
        return run_id

    def assert_sem_duplicatas(self):
        chaves = [a["chave_idempotencia"] for a in self.despachos()]
        criados = [ident for ident in self.motor._momentos]
        self.assertEqual(len(criados), len(set(chaves)), "um run por nonce")
        self.assertEqual(len(self.flow.aplicacoes), len(set(self.flow.aplicacoes)), "nenhum id aplicado duas vezes")


class TestesAtendenteE2E(Base):
    def test_duas_replicas_ate_o_cartao(self):
        self.flow.abrir_conversa(CONVERSA)
        primeira = self.flow.paulo_escreve(CONVERSA, "Isso é urgente mesmo?")
        self.ciclo()
        self.assertEqual(len(self.despachos()), 1)
        self.assertIn("Isso é urgente mesmo?", self.despachos()[0]["prompt"])
        self.assertEqual(self.despachos()[0]["modelo"], "claude-sonnet-5-5")
        self.assertEqual(self.flow.do_agente(CONVERSA), [])
        self.terminar(texto_do_agente("O login quebra para todos. Mando como urgente?", ["Sim, urgente", "Pode esperar a noite"]))
        dormidas = []
        self.c._esperar(60, lambda s: (dormidas.append(s), setattr(self, "instante", self.instante + datetime.timedelta(seconds=s))))
        (resposta,) = self.flow.do_agente(CONVERSA)
        self.assertEqual(resposta["respostasRapidas"], ["Sim, urgente", "Pode esperar a noite"])
        self.assertIsNone(self.flow.conversas[CONVERSA]["aguardaDesde"])
        self.assertEqual(json.loads(self.flow.aplicados[resposta["id"]])["emRespostaA"], primeira)
        self.assertEqual(dormidas[0], 3)  # respondida na primeira consulta rápida, dentro do intervalo
        self.assertEqual(sum(dormidas), 60)

        self.flow.paulo_escreve(CONVERSA, resposta["respostasRapidas"][0])  # o Paulo toca a primeira
        self.ciclo()
        self.assertEqual(len(self.despachos()), 2)
        self.terminar(texto_do_agente("Proponho urgente, planejando com você.", ["Confirmar"], CARTAO))
        self.consulta()
        self.assertEqual(len(self.flow.do_agente(CONVERSA)), 2)
        self.assertEqual({k: self.flow.conversas[CONVERSA]["cartao"][k] for k in CARTAO}, CARTAO)
        self.assertIsNone(self.flow.conversas[CONVERSA]["aguardaDesde"])
        self.assertEqual(len({a["chave_idempotencia"] for a in self.despachos()}), 2)
        self.assert_sem_duplicatas()
        self.assertEqual(self.flow.repetidos, [])
        self.assertIn("atendente: ocioso", self.c.status())

    def test_reinicio_em_cada_fase_nao_duplica_run_nem_resposta(self):
        self.flow.abrir_conversa(CONVERSA)
        self.flow.paulo_escreve(CONVERSA, "Isso é urgente mesmo?")
        self.motor.cair_depois_do_despacho = 1
        self.ciclo()  # despachando: o run foi criado e o processo caiu antes de gravar o runId
        self.assertEqual((self.quedas, len(self.motor._momentos)), (1, 1))
        self.assertEqual(coordenador.ler_estado(self.raiz)["atendente"]["atual"]["fase"], "despachando")
        self.c = self.novo()
        self.ciclo()  # acha o run pelo nonce
        self.assertEqual(coordenador.ler_estado(self.raiz)["atendente"]["atual"]["fase"], "respondendo")
        self.c = self.novo()
        self.ciclo()  # respondendo, o run ainda roda
        self.assertEqual(len(self.motor._momentos), 1)
        self.terminar(texto_do_agente("Mando como urgente?", ["Sim", "Não"]))
        self.flow.cair_depois_de_gravar = 1
        self.c = self.novo()
        self.ciclo()  # enviando: o Flow gravou e o processo caiu antes de limpar a saída
        self.assertEqual((self.quedas, len(self.flow.aplicacoes)), (2, 1))
        self.assertEqual(coordenador.ler_estado(self.raiz)["atendente"]["atual"]["fase"], "enviando")
        self.c = self.novo()
        self.ciclo()  # reenvia o mesmo id: repetido
        self.assertEqual(self.flow.repetidos, self.flow.aplicacoes)
        self.assertIsNone(coordenador.ler_estado(self.raiz)["atendente"]["atual"])

        self.flow.paulo_escreve(CONVERSA, "Sim")
        for _ in range(3):  # o coordenador reiniciado sempre começa por um ciclo inteiro
            self.c = self.novo()
            self.ciclo()
        self.terminar(texto_do_agente("Proponho urgente.", [], CARTAO))
        for _ in range(3):
            self.c = self.novo()
            self.ciclo()
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(len(self.motor._momentos), 2)
        self.assertEqual(len(self.flow.do_agente(CONVERSA)), 2)
        self.assertEqual({k: self.flow.conversas[CONVERSA]["cartao"][k] for k in CARTAO}, CARTAO)
        self.assert_sem_duplicatas()

    def test_flow_antigo_sem_a_rota_segue_com_retrato_e_demandas(self):
        self.flow.sem_rota = True
        plano = tc.plano_com(["src/login/**"])
        self.forja.definir_arquivo(REPO, "main", ".fabrica/planos/login.json", json.dumps(plano))
        id_ = coordenador.fila.id_do_plano(REPO, "login")
        dormidas = []
        self.c.rodar(intervalo=60, ciclos=3, dormir=dormidas.append)
        self.assertEqual(dormidas, [60, 60])  # nada ativo: o intervalo de sempre, sem consulta rápida
        self.assertEqual(self.flow.pedidos, 1)  # um 404 e o atendente fica desligado por 1 h
        estado = coordenador.ler_estado(self.raiz)
        self.assertEqual(coordenador._atuais(estado["fila"])[id_]["estado"], "ativo")
        self.assertEqual(len(self.enviar.chamadas), 3)
        self.assertEqual(len(self.demandas.desdes), 3)
        avisos = [a["mensagem"] for a in estado["avisos"] if a["mensagem"].startswith("Atendente:")]
        self.assertEqual(avisos, [atendente.AVISO_SEM_ROTA])
        self.assertIn("atendente: Flow sem o Decidir", self.c.status())
        self.assertEqual(self.despachos(), [])

        # o Flow ganha o Decidir: uma hora depois o atendente volta sozinho e o aviso sai
        self.flow.sem_rota = False
        self.flow.abrir_conversa(CONVERSA)
        self.flow.paulo_escreve(CONVERSA, "E agora?")
        self.instante += datetime.timedelta(seconds=atendente.REVER_FLOW_SEM_CONVERSAS_S)
        self.ciclo()
        self.assertEqual(len(self.despachos()), 1)
        self.assertNotIn("atendente:sem-rota", coordenador.ler_estado(self.raiz)["chaves"])


if __name__ == "__main__":
    unittest.main()
