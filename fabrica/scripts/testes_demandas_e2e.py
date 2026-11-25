"""Ponta a ponta das demandas: o coordenador real, um Flow em memória e o motor e a forja falsos do kit.

O `FlowFalso` aplica as mesmas regras de etapa e de espera do Flow (`src/modules/demandas/transicoes.ts` e
`model.ts`): o modelo padrão de etapas, as esperas do nível, o `repetido` do mesmo id e a recusa do evento fora da
etapa. O "Warren" e o "desenvolvedor" desta simulação trabalham entre os ciclos: cada run despachado termina antes do
ciclo seguinte (com o PR e os arquivos do papel dele) e o plano admitido conclui com uma seed mergeada.

As quedas simulam o processo morrendo no meio do ciclo (`Queda` é `BaseException`, nada do kit a captura): depois
da queda nenhum `fila-estado.json` é gravado, e o coordenador seguinte é construído do disco.
"""

import datetime
import hashlib
import json
import pathlib
import sys
import tempfile
import unittest
import unittest.mock

RAIZ_DOS_SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ_DOS_SCRIPTS))

import capacidade  # noqa: E402
import coordenador  # noqa: E402
import demandas  # noqa: E402
import demandas_flow  # noqa: E402
import fila  # noqa: E402
import forja as forja_  # noqa: E402
import motor as motor_  # noqa: E402
import prompts  # noqa: E402
import testes_coordenador as tc  # noqa: E402
import testes_demandas as td  # noqa: E402
from retrato import FalhaDeEnvio  # noqa: E402

REPO = "kustertech-exemplo/app"
PROJETO = "app"
COM_TELA = td.ID
SEM_TELA = td.OUTRO
ORIENTADA = td.TERCEIRO
CENTRAL = {
    "url": "https://central.exemplo/api/fabrica/estado",
    "token_file": "/seg/central",
    "publicacao_token_file": "/seg/publicacao",
}
INICIO = datetime.datetime(2026, 11, 20, 9, 0, 0, tzinfo=datetime.timezone.utc)
PNG = td.PNG
LIMITE_DE_CICLOS = 15

# o MODELO_PADRAO do Flow (model.ts), no formato do fio
MODELO = [
    {"chave": "recebida", "nome": "Recebida", "marco": "recebida", "quemConclui": "fabrica", "puladaSemTela": False, "esperaEm": []},
    {"chave": "planejada", "nome": "Planejada", "marco": "planejada", "quemConclui": "qualquer", "puladaSemTela": False, "esperaEm": ["planejar_comigo"]},
    {"chave": "desenho", "nome": "Desenho aprovado", "marco": "desenho", "quemConclui": "paulo", "puladaSemTela": True, "esperaEm": ["planejar_comigo", "aprovar_desenho"]},
    {"chave": "desenvolvida", "nome": "Desenvolvida", "marco": "desenvolvida", "quemConclui": "fabrica", "puladaSemTela": False, "esperaEm": []},
    {"chave": "testada", "nome": "Testada no navegador", "marco": "testada", "quemConclui": "fabrica", "puladaSemTela": True, "esperaEm": []},
    {"chave": "entregue", "nome": "Entregue", "marco": "entregue", "quemConclui": "fabrica", "puladaSemTela": False, "esperaEm": []},
]
MODOS = {"urgente": "imediato", "lote_da_noite": "lote"}


class Queda(BaseException):
    """O processo do coordenador morreu aqui."""


def sha(*partes) -> str:
    return hashlib.sha1("/".join(str(p) for p in partes).encode("utf-8")).hexdigest()


def canonico(valor) -> str:
    return json.dumps(valor, sort_keys=True, ensure_ascii=False)


# ---------------------------------------------------------------- Flow


class FlowFalso:
    """As rotas de demandas do Flow em memória (o mesmo protocolo do `ClienteDoFlow`)."""

    def __init__(self, relogio, queda):
        self.relogio = relogio
        self.queda = queda
        self.seq = 0
        self.demandas = {}
        self.arquivos = {}
        self.aplicados = []  # (demanda, id do evento, tipo), na ordem
        self.repetidos = []  # ids reenviados (e respondidos `repetido`)
        self.recusados = []
        self.buscas = []
        self.cair_depois = set()  # tipos de evento (ou `arquivo:<tipo>`) que derrubam o coordenador depois do 2xx
        self.ultima_recusa = None

    # ------------------------------------------------ o que o Paulo faz no Flow

    def criar(self, id_, *, tem_tela, nivel, titulo):
        etapas = [dict(e) for e in MODELO if tem_tela or not e["puladaSemTela"]]
        self.demandas[id_] = {
            "id": id_,
            "titulo": titulo,
            "temTela": tem_tela,
            "criadaEm": self.relogio(),
            "etapas": etapas,
            "estado": {
                "etapaAtual": etapas[0]["chave"],
                "concluidas": [],
                "nivel": nivel,
                "destino": None,
                "espera": None,
                "esperaMotivo": None,
                "esperaDesde": None,
                "recusasDoDesenho": 0,
                "falhasDoTeste": 0,
                "versaoDoDesenho": 0,
                "desenhoAprovado": None,
                "encerrada": None,
                "antesDaTrava": None,
            },
            "plano": None,
            "ajustes": [],
            "eventosDoPaulo": [],
            "ids": {},
            "seq": 0,
        }
        self._mudou(id_)

    def aprovar(self, id_):
        d = self.demandas[id_]
        e = d["estado"]
        assert e["espera"] == "aprovar_desenho", e
        self._do_paulo(id_, "desenho_aprovado", {"versao": e["versaoDoDesenho"]})
        e.update(desenhoAprovado=e["versaoDoDesenho"], espera=None, esperaMotivo=None)
        self._concluir(d)
        self._mudou(id_)

    def ajustar(self, id_, texto):
        d = self.demandas[id_]
        e = d["estado"]
        assert e["espera"] == "aprovar_desenho", e
        self._do_paulo(id_, "ajuste_pedido", {"versao": e["versaoDoDesenho"], "texto": texto})
        d["ajustes"].append({"versao": e["versaoDoDesenho"], "texto": texto, "em": self.relogio()})
        e.update(recusasDoDesenho=e["recusasDoDesenho"] + 1, espera=None, esperaMotivo=None)
        self._mudou(id_)

    def _do_paulo(self, id_, tipo, dados):
        self.seq += 1
        self.demandas[id_]["eventosDoPaulo"].append({"seq": self.seq, "id": sha("paulo", self.seq)[:8] + "-0000-4000-8000-000000000000", "tipo": tipo, "origem": "paulo", "em": self.relogio(), "dados": dados})

    def marco(self, id_):
        d = self.demandas[id_]
        return next(e["marco"] for e in d["etapas"] if e["chave"] == d["estado"]["etapaAtual"])

    def espera(self, id_):
        return self.demandas[id_]["estado"]["espera"]

    # ------------------------------------------------ rotas

    def buscar(self, desde):
        self.buscas.append(desde)
        inicio = int(desde) if desde else 0
        mudadas = sorted((d for d in self.demandas.values() if d["seq"] > inicio), key=lambda d: (d["estado"]["destino"] != "urgente", d["criadaEm"]))
        corpo = {"cursor": str(self.seq), "mais": False, "demandas": [self._retrato(d, inicio) for d in mudadas]}
        return demandas_flow.ler_resposta(json.dumps(corpo))

    def enviar_evento(self, demanda_id, evento):
        self.ultima_recusa = None
        d = self.demandas.get(demanda_id)
        if d is None:
            raise FalhaDeEnvio("HTTP 404")
        id_, tipo, dados = evento["id"], evento["tipo"], evento["dados"]
        if id_ in d["ids"]:
            if d["ids"][id_] == (tipo, canonico(dados)):
                self.repetidos.append(id_)
                return "repetido"
            self.ultima_recusa = "Evento com o mesmo id e outro conteúdo."
            return "recusado"
        motivo = self._aplicar(d, tipo, dados)
        if motivo is not None:
            self.recusados.append((demanda_id, tipo, motivo))
            self.ultima_recusa = motivo
            return "recusado"
        d["ids"][id_] = (tipo, canonico(dados))
        self.aplicados.append((demanda_id, id_, tipo))
        self._mudou(demanda_id)
        self._talvez_cair(tipo)
        return "aplicado"

    def enviar_arquivo(self, demanda_id, *, id_, tipo, nome, conteudo, dados, tela):
        self.ultima_recusa = None
        if demanda_id not in self.demandas:
            raise FalhaDeEnvio("HTTP 404")
        if id_ in self.arquivos:
            self.repetidos.append(id_)
            return "repetido"
        aceitos = {"desenho": ("text/html", "image/png"), "captura": ("image/png",)}
        if conteudo not in aceitos.get(tipo, ()):
            raise FalhaDeEnvio("HTTP 415")
        if len(dados) > 10 * 1024 * 1024:
            raise FalhaDeEnvio("HTTP 413")
        self.arquivos[id_] = {"demanda": demanda_id, "tipo": tipo, "nome": nome, "tela": tela, "dados": bytes(dados)}
        self._talvez_cair("arquivo:%s" % tipo)
        return "aplicado"

    # ------------------------------------------------ regras (transicoes.ts)

    def _mudou(self, id_):
        self.seq += 1
        self.demandas[id_]["seq"] = self.seq

    def _talvez_cair(self, tipo):
        if tipo in self.cair_depois:
            self.cair_depois.discard(tipo)
            self.queda()

    @staticmethod
    def _espera_ao_entrar(etapa, nivel, tem_versao):
        espera = nivel in etapa["esperaEm"]
        if etapa["marco"] == "planejada" and espera:
            return "planejar_comigo"
        if etapa["marco"] == "desenho" and espera and tem_versao:
            return "aprovar_desenho"
        if etapa["marco"] is None and etapa["quemConclui"] == "paulo":
            return "concluir_etapa"
        return None

    def _concluir(self, d):
        e = d["estado"]
        chaves = [x["chave"] for x in d["etapas"]]
        posicao = chaves.index(e["etapaAtual"])
        if e["etapaAtual"] not in e["concluidas"]:
            e["concluidas"].append(e["etapaAtual"])
        if posicao + 1 >= len(d["etapas"]):
            e.update(espera=None, esperaMotivo=None, encerrada="entregue")
            return
        proxima = d["etapas"][posicao + 1]
        e.update(etapaAtual=proxima["chave"], espera=self._espera_ao_entrar(proxima, e["nivel"], e["versaoDoDesenho"] > 0), esperaMotivo=None)
        if e["espera"] is not None:
            e["esperaDesde"] = self.relogio()

    @staticmethod
    def _pode_concluir(etapa, nivel):
        if etapa["marco"] is None and etapa["quemConclui"] == "paulo":
            return False
        return nivel not in etapa["esperaEm"]

    def _aplicar(self, d, tipo, dados):
        """`None` aplicado; senão o motivo da recusa (o 409 do Flow)."""
        e = d["estado"]
        if e["encerrada"]:
            return "A demanda já foi encerrada."
        atual = next(x for x in d["etapas"] if x["chave"] == e["etapaAtual"])
        if e["espera"] is not None and tipo not in ("travada", "destravada"):
            return "A demanda está parada e não aceita este evento agora."
        nao_e = "A etapa atual não é %s."
        if tipo == "triagem":
            if atual["marco"] != "recebida":
                return nao_e % "recebida"
            e["destino"] = dados["destino"]
            if dados["destino"] == "orientada":
                if not (dados.get("resposta") or "").strip():
                    return "A orientação precisa de uma resposta."
                e["encerrada"] = "orientada"
            elif dados["destino"] == "decisao_do_paulo":
                e.update(espera="decidir_destino", esperaMotivo=dados["motivo"], esperaDesde=self.relogio())
            else:
                self._concluir(d)
            return None
        if tipo == "triagem_falhou":
            if atual["marco"] != "recebida":
                return nao_e % "recebida"
            e.update(destino="decisao_do_paulo", espera="decidir_destino", esperaMotivo=dados["motivo"], esperaDesde=self.relogio())
            return None
        if tipo == "plano_criado":
            if atual["marco"] != "planejada":
                return nao_e % "planejada"
            if not self._pode_concluir(atual, e["nivel"]):
                return "A etapa de planejamento espera o Paulo."
            d["plano"] = {"caminho": dados["plano"], "prUrl": dados["prUrl"], "artefato": None}
            self._concluir(d)
            return None
        if tipo == "desenho_pronto":
            if atual["marco"] != "desenho":
                return nao_e % "desenho"
            arquivo = self.arquivos.get(dados["arquivoId"])
            if arquivo is None or arquivo["demanda"] != d["id"] or arquivo["tipo"] != "desenho":
                return "Arquivo do desenho não encontrado."
            e["versaoDoDesenho"] += 1
            if e["nivel"] in atual["esperaEm"]:
                e.update(espera="aprovar_desenho", esperaMotivo=None, esperaDesde=self.relogio())
            else:
                e.update(desenhoAprovado=e["versaoDoDesenho"])
                self._concluir(d)
            return None
        if tipo == "etapa_concluida":
            if atual["marco"] != dados["marco"] or not self._pode_concluir(atual, e["nivel"]):
                return nao_e % dados["marco"]
            self._concluir(d)
            return None
        if tipo == "travada":
            antes = e["antesDaTrava"] if e["espera"] == "travada" else {"espera": e["espera"], "motivo": e["esperaMotivo"]}
            e.update(antesDaTrava=antes, espera="travada", esperaMotivo=dados["motivo"], esperaDesde=self.relogio())
            return None
        if tipo == "destravada":
            if e["espera"] == "travada":
                antes = e["antesDaTrava"] or {}
                e.update(espera=antes.get("espera"), esperaMotivo=antes.get("motivo"), antesDaTrava=None)
            return None
        if tipo == "teste":
            if atual["marco"] != "testada":
                return nao_e % "testada"
            if dados["resultado"] == "passou":
                telas = {self.arquivos[c]["tela"] for c in dados["capturas"] if c in self.arquivos and self.arquivos[c]["demanda"] == d["id"]}
                if not {"desktop", "celular"} <= telas:
                    return "O teste precisa de capturas de desktop e celular."
                self._concluir(d)
                return None
            e["falhasDoTeste"] += 1
            chaves = [x["chave"] for x in d["etapas"]]
            if e["falhasDoTeste"] >= 2:
                e.update(espera="teste_falhou", esperaMotivo=dados["resumo"], esperaDesde=self.relogio())
            else:
                volta = next(x["chave"] for x in d["etapas"] if x["marco"] == "desenvolvida")
                e.update(etapaAtual=volta, concluidas=[c for c in e["concluidas"] if chaves.index(c) < chaves.index(volta)])
            return None
        if tipo == "entregue":
            if atual["marco"] != "entregue":
                return nao_e % "entregue"
            self._concluir(d)
            return None
        return "Evento desconhecido."

    def _retrato(self, d, inicio):
        e = d["estado"]
        atual = next(x for x in d["etapas"] if x["chave"] == e["etapaAtual"])
        return {
            "id": d["id"],
            "repositorio": REPO,
            "projeto": "App",
            "titulo": d["titulo"],
            "descricao": None,
            "tipo": None,
            "destino": e["destino"],
            "nivel": e["nivel"],
            "temTela": d["temTela"],
            "origem": "flow",
            "criadaEm": d["criadaEm"],
            "etapas": [dict(x, rotulo=x["nome"]) for x in d["etapas"]],
            "etapaAtual": {"chave": atual["chave"], "marco": atual["marco"]},
            "espera": {"tipo": e["espera"], "motivo": e["esperaMotivo"], "desde": e["esperaDesde"] or self.relogio()} if e["espera"] else None,
            "encerrada": e["encerrada"],
            "desenho": {"versao": e["versaoDoDesenho"], "aprovada": e["desenhoAprovado"]},
            "ajustes": list(d["ajustes"]),
            "plano": dict(d["plano"]) if d["plano"] else None,
            "publicacao": {"modo": MODOS.get(e["destino"])},
            "anexos": [],
            "eventos": [{k: v for k, v in ev.items() if k != "seq"} for ev in d["eventosDoPaulo"] if ev["seq"] > inicio],
        }


# ---------------------------------------------------------------- Warren, GitHub e systemd


class MotorQueCai(motor_.MotorFalso):
    """O `MotorFalso` que guarda o run de cada nonce e derruba o coordenador logo depois do POST quando
    `deve_cair(nonce)` diz que sim."""

    def __init__(self, queda):
        super().__init__()
        self.queda = queda
        self.por_nonce = {}
        self.deve_cair = lambda nonce: False

    def despachar_run(self, **argumentos):
        run_id = super().despachar_run(**argumentos)
        nonce = argumentos.get("chave_idempotencia")
        self.por_nonce.setdefault(nonce, run_id)
        if self.deve_cair(nonce):
            self.queda()  # o run existe no Warren; o `runId` nunca chegou ao disco
        return run_id


class ForjaQueMergeia(forja_.ForjaFalsa):
    """O merge leva os arquivos do head do PR ao branch padrão (`main`), como no GitHub."""

    def mergear(self, url, sha_):
        ok = super().mergear(url, sha_)
        if ok:
            pr = self._prs[url]
            for caminho in pr["arquivos"]:
                conteudo = self._arquivos.get((pr["repo"], sha_, caminho))
                if conteudo is not None:
                    self._arquivos[(pr["repo"], "main", caminho)] = conteudo
        return ok


class SystemdQueAnota(tc.SystemdFalso):
    """Anota a etapa da demanda no Flow no momento em que a unit do plano é ligada."""

    def __init__(self, ao_ligar):
        super().__init__()
        self.ao_ligar = ao_ligar
        self.ligados = []

    def __call__(self, *args):
        codigo, saida = super().__call__(*args)
        if args[0] == "enable" and codigo == 0:
            self.ligados.append((args[-1], self.ao_ligar()))
        return codigo, saida


class PedirPublicacao:
    def __init__(self):
        self.chamadas = []

    def __call__(self, **argumentos):
        self.chamadas.append(argumentos)
        return {"id": "publicacao-1"}


class CoordenadorQueCai(coordenador.Coordenador):
    """Depois da queda, nada mais chega ao disco (o `finally` do ciclo roda aqui, num processo de verdade não)."""

    def __init__(self, *args, caiu, **kwargs):
        self._caiu = caiu
        super().__init__(*args, **kwargs)

    def _salvar(self):
        if not self._caiu():
            super()._salvar()


# ---------------------------------------------------------------- a jornada


class BaseJornada(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.raiz = pathlib.Path(self._tmp.name) / "fabrica"
        self.raiz.mkdir()
        (self.raiz / "fila.json").write_text(json.dumps({"repos": [{"repo": REPO, "projeto": PROJETO}]}), encoding="utf-8")
        capacidade.configurar(self.raiz / "capacidade.json", vagas=3, ram_minima_mb=0)
        patcher = unittest.mock.patch.object(capacidade, "mem_disponivel_mb", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.instante = INICIO
        self.caiu = False
        self.quedas = 0
        self.reiniciar_sempre = False
        self.coordenadores = 0
        self.flow = FlowFalso(self.agora_texto, self.cair)
        self.motor = MotorQueCai(self.cair)
        self.motor.agora = lambda: self.instante
        self.forja = ForjaQueMergeia()
        self.forja.agora = lambda: self.instante
        self.systemd = SystemdQueAnota(lambda: {i: self.flow.marco(i) for i in self.flow.demandas})
        self.executar = tc.ExecutarFalso(self.forja)
        self.pedir = PedirPublicacao()
        self.triagens = {}
        self.terminados = set()
        self.rodando = set()
        self.desenvolvidos = set()
        self.c = self.novo()

    # ------------------------------------------------ montagem

    def agora_texto(self):
        return self.instante.strftime("%Y-%m-%dT%H:%M:%SZ")

    def cair(self):
        self.caiu = True
        raise Queda()

    def clonar(self, repo, destino):
        (pathlib.Path(destino) / ".git").mkdir(parents=True)

    def novo(self):
        self.coordenadores += 1
        return CoordenadorQueCai(
            raiz=self.raiz,
            forja=self.forja,
            motor=self.motor,
            systemd=self.systemd,
            executar=self.executar,
            preparar_warren=tc.PrepararFalso(),
            kit=coordenador.KIT_PADRAO,
            agora=lambda: self.instante,
            clonar=self.clonar,
            ambiente={"WARREN_API": "http://127.0.0.1:8080", "WARREN_TOKEN_FILE": "/seg/warren", "GH_TOKEN_FILE": "/seg/gh"},
            central=dict(CENTRAL),
            enviar=tc.EnviarFalso(resposta={"resultado": "gravado"}),
            pedir_publicacao=self.pedir,
            cliente_do_flow=lambda url, token_file: self.flow,
            caiu=lambda: self.caiu,
        )

    # ------------------------------------------------ o que acontece entre os ciclos

    def trabalhar(self):
        """Cada run despachado roda um ciclo inteiro e termina antes do seguinte, com o resultado do papel; o plano
        admitido conclui com uma seed mergeada."""
        for nonce, run_id in list(self.motor.por_nonce.items()):
            if run_id in self.terminados:
                continue
            if run_id not in self.rodando:
                self.rodando.add(run_id)  # ainda roda durante o próximo ciclo
                continue
            self.terminados.add(run_id)
            self.terminar(nonce, run_id)
        for entrada in coordenador._atuais(self.ler_estado()["fila"]).values():
            if entrada.get("estado") == "ativo" and entrada["id"] not in self.desenvolvidos:
                self.desenvolvidos.add(entrada["id"])
                self.desenvolver(entrada["id"])

    def do_nonce(self, nonce):
        """`(demanda, fase, tentativa)` do nonce de um run de demanda."""
        for id_ in self.flow.demandas:
            for tentativa in range(10):
                for fase in ("triagem", "plano", "desenho", "teste", "correcao"):
                    if nonce == demandas.nonce_do_motor(id_, fase, tentativa):
                        return id_, fase, tentativa
        raise AssertionError("run de nonce desconhecido: %s" % nonce)

    def terminar(self, nonce, run_id):
        id_, fase, tentativa = self.do_nonce(nonce)
        getattr(self, "entregar_" + fase)(id_, tentativa, run_id)

    def entregar_triagem(self, id_, tentativa, run_id):
        self.motor.definir_texto(run_id, td.resposta_triagem(self.triagens[id_]))
        self.motor.definir_run(run_id, estado="succeeded")

    def pr(self, id_, papel):
        numero = {"plano": 1, "desenho": 2, "teste": 3}[papel] + 10 * list(self.flow.demandas).index(id_)
        return "https://github.com/%s/pull/%d" % (REPO, numero)

    def entregar_plano(self, id_, tentativa, run_id):
        caminho = prompts.caminho_do_plano_da_demanda(id_)
        plano = tc.plano_com(["src/%s/**" % id_[:8]])
        plano["demanda"] = id_
        head = sha("plano", id_, tentativa)
        url = self.pr(id_, "plano")
        self.forja.definir_pr(url, head_sha=head, branch="fabrica/plano-%s" % id_[:8], arquivos=[caminho])
        self.forja.definir_arquivo(REPO, head, caminho, json.dumps(plano))
        self.forja.definir_ci(REPO, head, "verde")
        self.motor.definir_run(run_id, estado="succeeded", prUrl=url)

    def entregar_desenho(self, id_, tentativa, run_id):
        caminho = "%s/desenho.html" % prompts.pasta_da_demanda(id_)
        head = sha("desenho", id_, tentativa)
        url = self.pr(id_, "desenho")
        self.forja.definir_pr(url, head_sha=head, branch="fabrica/desenho-%s" % id_[:8], arquivos=[caminho])
        self.forja.definir_arquivo(REPO, head, caminho, b"<!doctype html><html><body><p>Tela, vers\xc3\xa3o %d</p></body></html>" % (tentativa + 1))
        self.forja.definir_ci(REPO, head, "verde")
        self.motor.definir_run(run_id, estado="succeeded", prUrl=url)

    def entregar_teste(self, id_, tentativa, run_id):
        pasta = prompts.pasta_da_demanda(id_)
        head = sha("teste", id_, tentativa)
        url = self.pr(id_, "teste")
        capturas = ["%s/capturas/%s" % (pasta, nome) for nome in ("desktop-01.png", "celular-01.png")]
        self.forja.definir_pr(url, head_sha=head, branch="fabrica/teste-%s" % id_[:8], arquivos=[pasta + "/teste.json", *capturas])
        self.forja.definir_arquivo(REPO, head, pasta + "/teste.json", json.dumps({"resultado": "passou", "contra": "real", "resumo": "a tela abre e salva"}))
        for caminho in capturas:
            self.forja.definir_arquivo(REPO, head, caminho, PNG)
        self.motor.definir_run(run_id, estado="succeeded", prUrl=url)

    def desenvolver(self, id_do_plano):
        pasta = self.raiz / "planos" / id_do_plano
        estado = json.loads((pasta / "estado.json").read_text(encoding="utf-8"))
        for raia in estado["raias"].values():
            raia["estado"] = "concluida"
        estado["chavesAcordadas"] = ["fase_concluida:unica"]
        estado["seeds"] = {"s1": {"estado": "mergeada", "pr": "https://github.com/%s/pull/9%d" % (REPO, len(self.desenvolvidos))}}
        (pasta / "estado.json").write_text(json.dumps(estado), encoding="utf-8")

    # ------------------------------------------------ ciclos

    def ciclo(self):
        self.instante += datetime.timedelta(minutes=1)
        self.trabalhar()
        try:
            self.c.ciclo()
        except Queda:
            self.quedas += 1
            self.caiu = False
            self.c = self.novo()  # o serviço volta e lê tudo do disco
            return
        if self.reiniciar_sempre:
            self.c = self.novo()

    def ate(self, condicao, descricao):
        for _ in range(LIMITE_DE_CICLOS):
            if condicao():
                return
            self.ciclo()
        self.fail("%s não aconteceu em %d ciclos (Flow: %s)" % (descricao, LIMITE_DE_CICLOS, {i: (self.flow.marco(i), self.flow.espera(i)) for i in self.flow.demandas}))

    # ------------------------------------------------ leitura

    def ler_estado(self):
        caminho = self.raiz / "fila-estado.json"
        return json.loads(caminho.read_text(encoding="utf-8")) if caminho.exists() else {"fila": []}

    def itens(self):
        return (self.ler_estado().get("demandas") or {}).get("itens") or {}

    def despachos(self):
        return [a for nome, a in self.motor.chamadas if nome == "despachar_run"]

    def nonces(self):
        return [a["chave_idempotencia"] for a in self.despachos()]

    def fases_despachadas(self, id_):
        return [fase for demanda, fase, _ in map(self.do_nonce, self.nonces()) if demanda == id_]

    def tipos_aplicados(self, id_):
        return [tipo for demanda, _, tipo in self.flow.aplicados if demanda == id_]

    def plano_da_fila(self, id_):
        return fila.id_do_plano(REPO, "demanda-%s" % id_[:8])

    def conferir_sem_duplicata(self):
        """Nenhum run foi despachado duas vezes e nenhum evento foi aplicado duas vezes no Flow."""
        self.assertEqual(len(self.nonces()), len(set(self.nonces())), self.nonces())
        self.assertEqual(len(self.motor._runs), len(self.despachos()))
        ids = [i for _, i, _ in self.flow.aplicados]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(self.flow.recusados, [])

    # ------------------------------------------------ as jornadas

    def jornada_com_tela(self):
        """Do pedido à entrega: triagem, plano mergeado e segurado, desenho v1, ajuste, v2, aprovação, merge do
        desenho, plano admitido e concluído, teste com duas capturas, publicação pedida e `entregue`."""
        self.triagens[COM_TELA] = td.triagem_ok(destino="urgente")
        self.flow.criar(COM_TELA, tem_tela=True, nivel="aprovar_desenho", titulo="Nova tela de clientes")
        plano = self.plano_da_fila(COM_TELA)
        self.ate(lambda: self.flow.marco(COM_TELA) == "planejada", "a triagem")
        self.ate(lambda: self.flow.marco(COM_TELA) == "desenho", "o plano criado")
        self.ate(lambda: coordenador._atuais(self.ler_estado()["fila"]).get(plano, {}).get("segurado") is True, "o plano segurado na fila")
        self.ate(lambda: self.flow.espera(COM_TELA) == "aprovar_desenho", "o desenho v1")
        self.assertEqual(coordenador._atuais(self.ler_estado()["fila"])[plano]["estado"], "aguardando")
        self.flow.ajustar(COM_TELA, "o botão salvar fica embaixo")
        self.ate(lambda: self.flow.espera(COM_TELA) == "aprovar_desenho" and self.flow.demandas[COM_TELA]["estado"]["versaoDoDesenho"] == 2, "o desenho v2")
        self.assertEqual(self.systemd.ligados, [])  # nada de desenvolvimento antes da aprovação
        self.flow.aprovar(COM_TELA)
        self.ate(lambda: self.flow.marco(COM_TELA) == "testada", "o desenvolvimento")
        self.ate(lambda: self.flow.marco(COM_TELA) == "entregue", "o teste no navegador")
        self.ate(lambda: self.flow.demandas[COM_TELA]["estado"]["encerrada"] == "entregue", "a entrega")
        self.ate(lambda: COM_TELA not in self.itens(), "o fim da demanda no kit")

    def conferir_jornada_com_tela(self):
        plano = self.plano_da_fila(COM_TELA)
        self.assertEqual(
            self.tipos_aplicados(COM_TELA), ["triagem", "plano_criado", "desenho_pronto", "desenho_pronto", "etapa_concluida", "teste", "entregue"]
        )
        self.assertEqual(self.fases_despachadas(COM_TELA), ["triagem", "plano", "desenho", "desenho", "teste"])
        self.conferir_sem_duplicata()
        # o plano e só a versão aprovada do desenho foram mergeados; o PR do teste foi fechado sem merge
        (_, _, segundo_desenho) = [self.do_nonce(n) for n in self.nonces()][3]
        self.assertEqual(self.forja.merges, [(self.pr(COM_TELA, "plano"), sha("plano", COM_TELA, 0)), (self.pr(COM_TELA, "desenho"), sha("desenho", COM_TELA, segundo_desenho))])
        self.assertEqual([u for u, _ in self.forja.fechados], [self.pr(COM_TELA, "teste")])
        # o plano só foi admitido com a demanda no desenvolvimento, e chegou ao fim
        self.assertEqual(self.systemd.ligados, [("fabrica-plano@%s" % plano, {COM_TELA: "desenvolvida"})])
        self.assertEqual(coordenador._atuais(self.ler_estado()["fila"])[plano]["estado"], "concluido")
        # as capturas de desktop e celular e as duas versões do desenho chegaram ao Flow
        self.assertEqual(sorted((a["tipo"], a["tela"]) for a in self.flow.arquivos.values()), [("captura", "celular"), ("captura", "desktop"), ("desenho", None), ("desenho", None)])
        # a publicação foi pedida uma vez, com a demanda e o modo do destino
        self.assertEqual(
            self.pedir.chamadas,
            [{"repo": REPO, "descricao": "Nova tela de clientes", "url": "https://central.exemplo/api/publicacoes", "token_file": "/seg/publicacao", "modo": "imediato", "demanda": COM_TELA}],
        )
        (entregue,) = [ev for ev in self.flow.demandas[COM_TELA]["ids"].values() if ev[0] == "entregue"]
        self.assertEqual(json.loads(entregue[1]), {"prs": ["https://github.com/%s/pull/91" % REPO]})
        # nada sobra: vaga, trava e a pasta local da demanda
        cap = capacidade.ler(self.raiz / "capacidade.json")
        self.assertEqual((cap["reservas"], cap["orquestrador"]), ({}, {}))
        self.assertFalse((self.raiz / "demandas" / COM_TELA).exists())


class TestesJornadaDasDemandas(BaseJornada):
    def test_demanda_com_tela_do_comeco_ao_fim(self):
        self.jornada_com_tela()
        self.conferir_jornada_com_tela()
        self.assertEqual((self.flow.repetidos, self.quedas, self.coordenadores), ([], 0, 1))
        self.assertIn("demandas: 0 em curso (0 esperando o Paulo)", self.c.status())

    def test_demanda_sem_tela_vai_sozinho_sem_desenho_nem_teste(self):
        self.triagens[SEM_TELA] = td.triagem_ok(destino="lote_da_noite")
        self.flow.criar(SEM_TELA, tem_tela=False, nivel="vai_sozinho", titulo="Ajustar o texto do recibo")
        self.ate(lambda: self.flow.demandas[SEM_TELA]["estado"]["encerrada"] == "entregue", "a entrega")
        self.ate(lambda: SEM_TELA not in self.itens(), "o fim da demanda no kit")
        self.assertEqual(self.tipos_aplicados(SEM_TELA), ["triagem", "plano_criado", "etapa_concluida", "entregue"])
        self.assertEqual(self.fases_despachadas(SEM_TELA), ["triagem", "plano"])
        self.conferir_sem_duplicata()
        self.assertEqual(self.flow.arquivos, {})
        self.assertEqual(self.systemd.ligados, [("fabrica-plano@%s" % self.plano_da_fila(SEM_TELA), {SEM_TELA: "desenvolvida"})])
        (pedido,) = self.pedir.chamadas
        self.assertEqual((pedido["demanda"], pedido["modo"], pedido["descricao"]), (SEM_TELA, "lote", "Ajustar o texto do recibo"))

    def test_demanda_orientada_fecha_na_triagem_sem_plano(self):
        self.triagens[ORIENTADA] = td.triagem_ok(destino="orientada", tipo="ideia", resposta="Isso já existe: use o filtro por status na lista.")
        self.flow.criar(ORIENTADA, tem_tela=True, nivel="vai_sozinho", titulo="Filtrar clientes por status")
        self.ate(lambda: self.flow.demandas[ORIENTADA]["estado"]["encerrada"] == "orientada", "a orientação")
        self.ate(lambda: ORIENTADA not in self.itens(), "o fim da demanda no kit")
        self.assertEqual(self.tipos_aplicados(ORIENTADA), ["triagem"])
        self.assertEqual(self.fases_despachadas(ORIENTADA), ["triagem"])
        self.conferir_sem_duplicata()
        self.assertEqual((self.ler_estado()["fila"], self.pedir.chamadas, self.systemd.ligados), ([], [], []))
        cap = capacidade.ler(self.raiz / "capacidade.json")
        self.assertEqual((cap["reservas"], cap["orquestrador"]), ({}, {}))

    def test_reinicio_em_cada_fase_nao_duplica_run_evento_nem_pedido(self):
        # o coordenador é recriado do disco depois de todo ciclo e morre nos pontos de risco: logo depois de cada
        # POST pago ao Warren (antes de gravar o `runId`) e logo depois de cada 2xx do Flow (antes de tirar o item
        # da caixa de saída)
        self.reiniciar_sempre = True
        cair_no_despacho = {"triagem", "plano", "desenho", "teste"}  # o primeiro run de cada fase

        def deve_cair(nonce):
            fase = self.do_nonce(nonce)[1]
            if fase in cair_no_despacho:
                cair_no_despacho.discard(fase)
                return True
            return False

        self.motor.deve_cair = deve_cair
        self.flow.cair_depois = {"triagem", "plano_criado", "arquivo:desenho", "desenho_pronto", "etapa_concluida", "arquivo:captura", "teste", "entregue"}
        vistos = {"plano": 0, "desenho": 0}
        original = self.novo

        def novo():
            # a cada reinício: a trava do plano e a vaga do desenho continuam com a demanda enquanto o run dela roda
            # (o ciclo depois da queda adota o run pelo nonce e a limpeza de órfãos não solta nada)
            cap = capacidade.ler(self.raiz / "capacidade.json")
            chave = demandas.chave(COM_TELA)
            vistos["plano"] += cap["orquestrador"].get(REPO) == chave
            vistos["desenho"] += cap["reservas"].get(chave) == ["ux-ui"]
            return original()

        self.novo = novo
        self.jornada_com_tela()
        self.conferir_jornada_com_tela()
        self.assertEqual((cair_no_despacho, self.flow.cair_depois), (set(), set()))
        self.assertEqual(self.quedas, 4 + 8)
        # cada queda depois de um 2xx reenviou o mesmo id, e o Flow respondeu `repetido`
        self.assertEqual(len(self.flow.repetidos), 8)
        self.assertGreaterEqual(min(vistos.values()), 2, vistos)


if __name__ == "__main__":
    unittest.main()
