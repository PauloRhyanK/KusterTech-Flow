import contextlib
import datetime
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import unittest.mock

RAIZ_DOS_SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ_DOS_SCRIPTS))

import atendente  # noqa: E402
import capacidade  # noqa: E402
import coordenador  # noqa: E402
import despachante  # noqa: E402
import fila  # noqa: E402
import forja  # noqa: E402
import motor  # noqa: E402
import retrato  # noqa: E402
import testes_atendente  # noqa: E402
import testes_demandas  # noqa: E402
import testes_retrato  # noqa: E402

REPO = "dono/cliente"
OUTRO = "dono/outro"
TOKEN = "tok-secreto-do-warren-123"
INICIO = datetime.datetime(2026, 11, 3, 12, 0, 0, tzinfo=datetime.timezone.utc)
PRONTO = {"estado": "ja_aplicado", "detalhe": "", "dropin": "ok", "automerge": "ja_desligado", "desligados": {"warren-automerge.service": "ja_desligado", "warren-auto.service": "ja_desligado"}, "sha": "a" * 64}
ESPERANDO = dict(PRONTO, estado="aguardando_runs", dropin="ok")


def plano_com(*grupos, fase_unica=True):
    """Um plano válido com uma raia por grupo de globs, todas numa única fase."""
    ids = ["raia-%d" % n for n in range(len(grupos))]
    return {
        "versao": 1,
        "faseAtual": "unica",
        "fases": [{"id": "unica", "raias": ids}],
        "raias": [
            {
                "id": id_,
                "papel": "backend",
                "planoSeeds": "pl-0000",
                "dependeDe": [],
                "arquivos": list(globs),
                "verificacao": "pnpm test",
                "criteriosAceite": ["ok"],
            }
            for id_, globs in zip(ids, grupos)
        ],
    }


def estado_inicial(plano):
    return {
        "repo": REPO,
        "projeto": "cliente",
        "pausado": None,
        "faseAtual": plano["faseAtual"],
        "raias": {r["id"]: {"estado": "planejada"} for r in plano["raias"]},
        "orquestrador": {"runId": None, "motivo": None},
        "chavesAcordadas": [],
        "acordarPendentes": [],
        "decisoes": [],
        "decisoesPendentes": [],
    }


class SystemdFalso:
    """`systemctl --user` em memória: `enable --now` liga, `disable --now` desliga."""

    def __init__(self):
        self.estados = {}
        self.chamadas = []
        self.falhar_enable = set()
        self.status = {}
        self.quebrado = False

    def __call__(self, *args):
        self.chamadas.append(args)
        if self.quebrado:
            raise OSError("systemctl sumiu")
        acao, unit = args[0], args[-1]
        if acao == "enable":
            if unit in self.falhar_enable:
                return 1, "Failed to enable unit"
            self.estados[unit] = "active"
            return 0, ""
        if acao == "disable":
            self.estados[unit] = "inactive"
            return 0, ""
        if acao == "is-active":
            estado = self.estados.get(unit, "inactive")
            return (0 if estado == "active" else 3), estado + "\n"
        if acao == "status":
            return 3, self.status.get(unit, "")
        raise AssertionError("chamada inesperada: %r" % (args,))

    def de(self, acao):
        return [c for c in self.chamadas if c[0] == acao]


class ExecutarFalso:
    """`despachante.py iniciar`: grava estado.json e plano.json na FABRICA_RAIZ, como o real."""

    def __init__(self, forja_):
        self.forja = forja_
        self.chamadas = []
        self.codigo = 0

    def __call__(self, argv, env):
        self.chamadas.append((list(argv), dict(env)))
        if self.codigo != 0:
            return self.codigo, "plano inválido %s" % TOKEN
        raiz = pathlib.Path(env["FABRICA_RAIZ"])
        texto = self.forja.arquivo(env["FABRICA_REPO"], "main", env["FABRICA_PLANO"])
        plano = json.loads(texto)
        (raiz / "plano.json").write_text(json.dumps(plano), encoding="utf-8")
        (raiz / "estado.json").write_text(json.dumps(estado_inicial(plano)), encoding="utf-8")
        return 0, "estado iniciado"


class PrepararFalso:
    def __init__(self, *resultados):
        self.resultados = list(resultados) or [PRONTO]
        self.chamadas = []

    def __call__(self, **argumentos):
        self.chamadas.append(argumentos)
        if len(self.resultados) > 1:
            return dict(self.resultados.pop(0))
        return dict(self.resultados[0])


class FlowVazio:
    """O cliente das rotas de demandas sem nenhuma demanda: guarda com que URL e token foi criado e cada busca."""

    def __init__(self, url_central=None, token_file=None):
        self.url_central, self.token_file = url_central, token_file
        self.desdes, self.enviados, self.ultima_recusa = [], [], None

    def buscar(self, desde):
        self.desdes.append(desde)
        return {"cursor": desde or "0", "mais": False, "demandas": []}

    def enviar_evento(self, demanda_id, evento):
        self.enviados.append(("evento", demanda_id, evento))
        return "aplicado"

    def enviar_arquivo(self, demanda_id, **arquivo):
        self.enviados.append(("arquivo", demanda_id, arquivo))
        return "aplicado"


class ConversasVazias:
    """O cliente das conversas do Decidir sem nenhuma conversa esperando o agente."""

    def __init__(self, url_central=None, token_file=None):
        self.url_central, self.token_file = url_central, token_file
        self.ultima_recusa, self.ultimo_motivo_do_cartao = None, None

    def buscar_conversas(self):
        return {"conversas": [], "ativaAte": None}

    def responder(self, conversa_id, corpo):
        raise AssertionError("nada a responder")


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.raiz = pathlib.Path(self._tmp.name) / "fabrica"
        self.raiz.mkdir()
        self.forja = forja.ForjaFalsa()
        self.motor = motor.MotorFalso()
        self.systemd = SystemdFalso()
        self.executar = ExecutarFalso(self.forja)
        self.preparar = PrepararFalso()
        self.clones = []
        self.instante = INICIO
        self.escrever_fila({"repos": [{"repo": REPO, "projeto": "cliente"}]})

    def escrever_fila(self, dados):
        (self.raiz / "fila.json").write_text(json.dumps(dados), encoding="utf-8")

    def clonar(self, repo, destino):
        self.clones.append((repo, pathlib.Path(destino)))
        (pathlib.Path(destino) / ".git").mkdir(parents=True)

    def novo(self, **extra):
        argumentos = dict(
            raiz=self.raiz,
            forja=self.forja,
            motor=self.motor,
            systemd=self.systemd,
            executar=self.executar,
            preparar_warren=self.preparar,
            kit=pathlib.Path("/kit"),
            agora=lambda: self.instante,
            clonar=self.clonar,
            ambiente={"WARREN_API": "http://127.0.0.1:8080", "WARREN_TOKEN_FILE": "/seg/warren", "GH_TOKEN_FILE": "/seg/gh"},
            segredos=(TOKEN,),
            cliente_do_flow=FlowVazio,
            cliente_das_conversas=ConversasVazias,
        )
        argumentos.update(extra)
        return coordenador.Coordenador(**argumentos)

    def publicar(self, feature, *grupos, repo=REPO):
        caminho = ".fabrica/planos/%s.json" % feature
        self.forja.definir_arquivo(repo, "main", caminho, json.dumps(plano_com(*grupos)))
        return fila.id_do_plano(repo, feature)

    def apagar(self, feature, repo=REPO):
        del self.forja._arquivos[(repo, "main", ".fabrica/planos/%s.json" % feature)]

    def fila_estado(self):
        return json.loads((self.raiz / "fila-estado.json").read_text(encoding="utf-8"))

    def estados(self):
        atual = {}
        for entrada in self.fila_estado()["fila"]:
            atual[entrada["id"]] = entrada["estado"]
        return atual

    def avisos(self):
        return [a["mensagem"] for a in self.fila_estado().get("avisos", [])]

    def unit(self, id_):
        return "fabrica-plano@%s" % id_

    def pasta(self, id_):
        return self.raiz / "planos" / id_

    def estado_do_plano(self, id_):
        return json.loads((self.pasta(id_) / "estado.json").read_text(encoding="utf-8"))

    def gravar_estado_do_plano(self, id_, estado):
        (self.pasta(id_) / "estado.json").write_text(json.dumps(estado), encoding="utf-8")

    def concluir(self, id_, *, com_chave=True):
        estado = self.estado_do_plano(id_)
        for raia in estado["raias"].values():
            raia["estado"] = "concluida"
        if com_chave:
            estado["chavesAcordadas"] = ["fase_concluida:unica"]
        self.gravar_estado_do_plano(id_, estado)

    def publicar_da_demanda(self, demanda, *grupos, repo=REPO):
        """O plano de uma demanda (`demanda-<id8>`, com o uuid no campo `demanda`) no branch padrão."""
        feature = "demanda-%s" % demanda[:8]
        plano = plano_com(*grupos)
        plano["demanda"] = demanda
        self.forja.definir_arquivo(repo, "main", ".fabrica/planos/%s.json" % feature, json.dumps(plano))
        return fila.id_do_plano(repo, feature)

    def demanda_em(self, demanda, marco, **extra):
        """Grava no `fila-estado.json` o item da demanda com o retrato na etapa `marco`."""
        caminho = pathlib.Path(self.raiz / "fila-estado.json")
        dados = json.loads(caminho.read_text(encoding="utf-8")) if caminho.exists() else {"fila": []}
        sec = dados.setdefault("demandas", {"cursor": None, "semRotaEm": None, "saida": [], "itens": {}})
        retrato_ = testes_demandas.retrato(marco, repositorio=REPO, **extra)
        retrato_["id"] = demanda
        sec["itens"][demanda] = testes_demandas.item("plano_no_repo", plano=".fabrica/planos/demanda-%s.json" % demanda[:8], ultima=retrato_)
        caminho.write_text(json.dumps(dados), encoding="utf-8")

    def iniciados(self):
        return [env["FABRICA_PLANO_ID"] for _, env in self.executar.chamadas]

    def ligados(self):
        return [c[-1] for c in self.systemd.de("enable")]


class TestesRegistrar(Base):
    def test_acha_o_projeto_pelo_git_url_e_grava_fila_json(self):
        self.escrever_fila({"repos": []})
        self.motor.definir_projeto("outro", "https://github.com/dono/outro.git")
        self.motor.definir_projeto("flow", "https://github.com/Dono/Cliente.git")
        mensagem = self.novo().registrar(REPO)
        self.assertIn("flow", mensagem)
        dados = json.loads((self.raiz / "fila.json").read_text(encoding="utf-8"))
        self.assertEqual(dados["repos"], [{"repo": REPO, "projeto": "flow"}])
        self.assertIn(("branch_padrao", {"repo": REPO}), self.forja.chamadas)

    def test_aceita_ssh_e_sem_ponto_git_e_e_idempotente(self):
        self.escrever_fila({"repos": []})
        self.motor.definir_projeto("flow", "git@github.com:dono/cliente")
        c = self.novo()
        c.registrar(REPO)
        c.registrar("Dono/Cliente")
        dados = json.loads((self.raiz / "fila.json").read_text(encoding="utf-8"))
        self.assertEqual(dados["repos"], [{"repo": REPO, "projeto": "flow"}])

    def test_nao_confunde_prefixo(self):
        self.escrever_fila({"repos": []})
        self.motor.definir_projeto("x", "https://github.com/dono/cliente-velho.git")
        self.motor.definir_projeto("y", "https://github.com/outrodono/cliente.git")
        with self.assertRaises(coordenador.ErroDeEntrada):
            self.novo().registrar(REPO)

    def test_repo_sem_projeto_e_recusado_com_a_mensagem(self):
        self.escrever_fila({"repos": []})
        with self.assertRaises(coordenador.ErroDeEntrada) as ctx:
            self.novo().registrar(REPO)
        self.assertIn("crie o projeto no Warren", str(ctx.exception))
        self.assertEqual(json.loads((self.raiz / "fila.json").read_text(encoding="utf-8")), {"repos": []})

    def test_repo_fora_do_formato_e_recusado(self):
        for ruim in ("dono", "dono/repo/x", "", "../x"):
            with self.subTest(ruim=ruim):
                with self.assertRaises(coordenador.ErroDeEntrada):
                    self.novo().registrar(ruim)

    def test_sem_acesso_ao_repositorio_e_recusado(self):
        class SemAcesso(forja.ForjaFalsa):
            def branch_padrao(self, repo):
                raise RuntimeError("GET /repos/dono/cliente: HTTP 404")

        self.motor.definir_projeto("flow", "https://github.com/dono/cliente.git")
        with self.assertRaises(coordenador.ErroDeEntrada) as ctx:
            self.novo(forja=SemAcesso()).registrar(REPO)
        self.assertIn("acesso", str(ctx.exception))

    def test_fila_json_ausente_e_criada(self):
        (self.raiz / "fila.json").unlink()
        self.motor.definir_projeto("flow", "https://github.com/dono/cliente")
        self.novo().registrar(REPO)
        self.assertEqual(json.loads((self.raiz / "fila.json").read_text(encoding="utf-8"))["repos"], [{"repo": REPO, "projeto": "flow"}])


class TestesAdmissao(Base):
    def test_dois_planos_que_nao_colidem_entram_juntos_e_o_env_so_tem_caminhos(self):
        a = self.publicar("login", ["src/login/**"])
        b = self.publicar("cobranca", ["src/cobranca/**"])
        c = self.novo()
        eventos = c.ciclo()
        self.assertEqual(sorted(self.iniciados()), sorted([a, b]))
        self.assertEqual(sorted(self.ligados()), sorted([self.unit(a), self.unit(b)]))
        self.assertEqual(self.estados(), {a: "ativo", b: "ativo"})
        self.assertTrue([e for e in eventos if e.get("evento") == "admitido"])
        self.assertEqual(sorted(r for r, _ in self.clones), [REPO, REPO])
        env = (self.pasta(a) / "plano.env").read_text(encoding="utf-8")
        linhas = dict(linha.split("=", 1) for linha in env.splitlines() if linha and not linha.startswith("#"))
        self.assertEqual(
            linhas,
            {
                "FABRICA_RAIZ": str(self.pasta(a)),
                "FABRICA_REPO_DIR": str(self.pasta(a) / "repo"),
                "FABRICA_PROJETO": "cliente",
                "FABRICA_REPO": REPO,
                "FABRICA_PLANO": ".fabrica/planos/login.json",
                "FABRICA_CAPACIDADE": str(self.raiz / "capacidade.json"),
                "FABRICA_PLANO_ID": a,
                "FABRICA_PREPARAR_WARREN": "0",
                "WARREN_API": "http://127.0.0.1:8080",
                "WARREN_TOKEN_FILE": "/seg/warren",
                "GH_TOKEN_FILE": "/seg/gh",
            },
        )
        self.assertNotIn(TOKEN, env)
        argv, ambiente = self.executar.chamadas[0]
        self.assertEqual(argv[1:], ["-I", "/kit/fabrica/scripts/despachante.py", "iniciar"])
        self.assertNotIn(TOKEN, json.dumps(ambiente))

    def test_terceiro_que_colide_espera_a_conclusao_do_primeiro(self):
        a = self.publicar("login", ["src/login/**"])
        b = self.publicar("cobranca", ["src/cobranca/**"])
        c = self.novo()
        c.ciclo()
        self.instante += datetime.timedelta(minutes=1)
        z = self.publicar("login-2fa", ["src/login/2fa/**"])
        c.ciclo()
        self.assertEqual(self.estados()[z], "aguardando")
        self.assertNotIn(z, self.iniciados())
        self.assertNotIn(self.unit(z), self.ligados())
        capacidade.reservar(self.raiz / "capacidade.json", a, "raia-0", mem_disponivel_mb=None)
        capacidade.tomar_orquestrador(self.raiz / "capacidade.json", REPO, a)
        self.concluir(a)
        c.ciclo()  # a admissão (passo 3) vem antes da observação (passo 4): z entra no ciclo seguinte
        self.assertEqual(self.estados()[a], "concluido")
        self.assertIn(("disable", "--now", self.unit(a)), self.systemd.chamadas)
        self.assertEqual(self.estados()[z], "aguardando")
        c.ciclo()
        self.assertEqual(self.estados()[z], "ativo")
        self.assertEqual(self.estados()[b], "ativo")
        self.assertEqual(self.iniciados().count(z), 1)
        dados = capacidade.ler(self.raiz / "capacidade.json")
        self.assertNotIn(a, dados["reservas"])
        self.assertEqual(dados["orquestrador"], {})

    def test_ultima_fase_concluida_sem_a_chave_fase_concluida_continua_ativo(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        self.concluir(a, com_chave=False)
        for _ in range(3):
            c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")
        self.assertEqual(self.systemd.de("disable"), [])

    def test_concluido_com_orquestrador_rodando_continua_ativo(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        self.concluir(a)
        estado = self.estado_do_plano(a)
        estado["orquestrador"]["runId"] = "run-9"
        self.gravar_estado_do_plano(a, estado)
        c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")

    def test_coordenador_reiniciado_nao_admite_duas_vezes_nem_reinicia_o_estado(self):
        a = self.publicar("login", ["src/login/**"])
        self.novo().ciclo()
        estado = self.estado_do_plano(a)
        estado["raias"]["raia-0"]["estado"] = "executando"
        self.gravar_estado_do_plano(a, estado)
        for _ in range(2):
            self.novo().ciclo()
        self.assertEqual(self.iniciados(), [a])
        self.assertEqual(self.ligados(), [self.unit(a)])
        self.assertEqual(len(self.clones), 1)
        self.assertEqual([e["id"] for e in self.fila_estado()["fila"]], [a])
        self.assertEqual(self.estado_do_plano(a)["raias"]["raia-0"]["estado"], "executando")

    def test_morte_entre_o_iniciar_e_o_enable_retoma_sem_iniciar_de_novo(self):
        a = self.publicar("login", ["src/login/**"])
        self.systemd.falhar_enable.add(self.unit(a))
        self.novo().ciclo()
        # rodada 1, item 4: gravado como admitindo antes do enable; com a unit inativa, a admissão é refeita
        self.assertEqual(self.estados()[a], "admitindo")
        self.assertTrue([m for m in self.avisos() if a in m])
        self.systemd.falhar_enable.clear()
        self.novo().ciclo()
        self.assertEqual(self.estados()[a], "ativo")
        self.assertEqual(self.iniciados(), [a])
        self.assertEqual(len(self.ligados()), 2)

    def test_morte_entre_o_enable_e_a_gravacao_com_o_plano_sumido_mantem_a_unit_rastreada(self):
        a = self.publicar("login", ["src/login/**"])
        systemd = self.systemd

        class Morte(BaseException):
            pass

        def morre_no_enable(*args):
            resultado = systemd(*args)
            if args[0] == "enable":
                raise Morte()
            return resultado

        with self.assertRaises(Morte):
            self.novo(systemd=morre_no_enable).ciclo()
        self.assertEqual(self.estados()[a], "admitindo")
        cap = self.raiz / "capacidade.json"
        capacidade.reservar(cap, a, "raia-0", mem_disponivel_mb=None)
        capacidade.tomar_orquestrador(cap, REPO, a)
        self.apagar("login")
        self.novo().ciclo()
        self.assertEqual(self.estados()[a], "ativo")
        dados = capacidade.ler(cap)
        self.assertEqual(dados["reservas"], {a: ["raia-0"]})
        self.assertEqual(dados["orquestrador"], {REPO: a})
        self.assertEqual(self.iniciados(), [a])

    def test_admitindo_conta_como_ativo_para_os_orfaos_mesmo_sem_resposta_ativa(self):
        a = self.publicar("login", ["src/login/**"])
        self.systemd.falhar_enable.add(self.unit(a))
        self.novo().ciclo()
        cap = self.raiz / "capacidade.json"
        capacidade.reservar(cap, a, "raia-0", mem_disponivel_mb=None)
        self.novo().ciclo()  # unit inativa: refaz a admissão, que falha de novo
        self.assertEqual(self.estados()[a], "admitindo")
        self.assertEqual(capacidade.ler(cap)["reservas"], {a: ["raia-0"]})

    def test_iniciar_que_falha_fica_aguardando_com_aviso_sem_token_e_tenta_de_novo(self):
        a = self.publicar("login", ["src/login/**"])
        self.executar.codigo = 2
        c = self.novo()
        c.ciclo()
        c.ciclo()
        self.assertEqual(self.estados()[a], "aguardando")
        self.assertEqual(self.ligados(), [])
        self.assertEqual(len([m for m in self.avisos() if a in m]), 1)
        self.assertNotIn(TOKEN, (self.raiz / "fila-estado.json").read_text(encoding="utf-8"))
        self.assertNotIn(TOKEN, (self.raiz / "log.jsonl").read_text(encoding="utf-8"))
        self.executar.codigo = 0
        c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")

    def test_clone_que_falha_fica_aguardando(self):
        a = self.publicar("login", ["src/login/**"])

        def falha(repo, destino):
            raise RuntimeError("git clone saiu com 128")

        self.novo(clonar=falha).ciclo()
        self.assertEqual(self.estados()[a], "aguardando")
        self.assertEqual(self.iniciados(), [])
        self.novo().ciclo()
        self.assertEqual(self.estados()[a], "ativo")

    def test_plano_legado_vira_feature_plano(self):
        self.forja.definir_arquivo(REPO, "main", ".fabrica/plano.json", json.dumps(plano_com(["src/**"])))
        self.novo().ciclo()
        id_ = fila.id_do_plano(REPO, "plano")
        self.assertEqual(self.estados(), {id_: "ativo"})
        self.assertIn("FABRICA_PLANO=.fabrica/plano.json", (self.pasta(id_) / "plano.env").read_text(encoding="utf-8"))

    def test_plano_ativo_que_some_do_main_continua_ativo(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        self.apagar("login")
        c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")
        self.assertEqual(self.systemd.de("disable"), [])

    def test_aguardando_que_some_do_main_e_removido(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        z = self.publicar("login-2", ["src/login/x/**"])
        c.ciclo()
        self.apagar("login-2")
        c.ciclo()
        self.assertEqual(self.estados()[z], "removido")
        self.assertEqual(self.estados()[a], "ativo")

    def test_falha_ao_listar_um_repo_nao_remove_quem_aguarda_nele(self):
        self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        z = self.publicar("login-2", ["src/login/x/**"])
        c.ciclo()

        class Fora(forja.ForjaFalsa):
            def listar(self, repo, ref, diretorio):
                raise RuntimeError("GitHub fora")

        fora = Fora()
        fora._arquivos = self.forja._arquivos
        self.novo(forja=fora).ciclo()
        self.assertEqual(self.estados()[z], "aguardando")

    def test_repos_diferentes_nao_colidem(self):
        self.escrever_fila({"repos": [{"repo": REPO, "projeto": "cliente"}, {"repo": OUTRO, "projeto": "outro"}]})
        a = self.publicar("login", ["src/**"])
        b = self.publicar("login", ["src/**"], repo=OUTRO)
        self.novo().ciclo()
        self.assertEqual(self.estados(), {a: "ativo", b: "ativo"})
        self.assertIn("FABRICA_PROJETO=outro", (self.pasta(b) / "plano.env").read_text(encoding="utf-8"))


class TestesFilaDeDemandas(Base):
    DEMANDA = testes_demandas.ID
    URGENTE = testes_demandas.OUTRO

    def entrada(self, id_):
        return [e for e in self.fila_estado()["fila"] if e["id"] == id_][-1]

    def test_review_focus_2_plano_de_demanda_descoberto_antes_da_aprovacao_nao_e_admitido_no_mesmo_ciclo(self):
        self.demanda_em(self.DEMANDA, "desenho")
        id_ = self.publicar_da_demanda(self.DEMANDA, ["src/tela/**"])
        c = self.novo()
        c.ciclo()  # descoberto neste ciclo, com vaga e trava livres
        self.assertEqual(self.estados(), {id_: "aguardando"})
        entrada = self.entrada(id_)
        self.assertEqual((entrada["demanda"], entrada["segurado"], entrada["seguradoPor"]), (self.DEMANDA, True, "demanda"))
        self.assertEqual(self.iniciados(), [])
        self.assertEqual(self.ligados(), [])
        c.ciclo()
        self.assertEqual(self.iniciados(), [])
        # o desenho foi aprovado: a etapa atual passa a ser a `desenvolvida`, e o plano entra no ciclo seguinte
        self.demanda_em(self.DEMANDA, "desenvolvida")
        c.ciclo()
        self.assertEqual(self.estados(), {id_: "ativo"})
        self.assertIs(self.entrada(id_)["segurado"], False)
        self.assertEqual(self.iniciados(), [id_])

    def test_segurar_do_paulo_num_plano_segurado_pela_demanda_vale_depois_da_aprovacao(self):
        self.demanda_em(self.DEMANDA, "desenho")
        id_ = self.publicar_da_demanda(self.DEMANDA, ["src/tela/**"])
        c = self.novo()
        c.ciclo()
        c.pedir("segurar", id_)
        c.ciclo()
        self.assertNotIn("seguradoPor", self.entrada(id_))
        self.demanda_em(self.DEMANDA, "desenvolvida")
        c.ciclo()
        self.assertEqual(self.estados(), {id_: "aguardando"})
        self.assertIs(self.entrada(id_)["segurado"], True)

    def test_review_focus_5_plano_urgente_admitido_antes_sem_tirar_vaga_de_quem_roda(self):
        cap = self.raiz / "capacidade.json"
        capacidade.configurar(cap, vagas=1, ram_minima_mb=0)
        rodando = self.publicar("rodando", ["src/a/**"])
        c = self.novo()
        c.ciclo()
        self.assertTrue(capacidade.reservar(cap, rodando, "raia-0", mem_disponivel_mb=None))
        reservas = capacidade.ler(cap)["reservas"]
        self.instante += datetime.timedelta(minutes=1)
        velho = self.publicar("velho", ["src/a/**", "src/b/**"])  # colide com quem roda: espera
        c.ciclo()
        self.instante += datetime.timedelta(minutes=1)
        self.demanda_em(self.URGENTE, "desenvolvida", destino="urgente")
        urgente = self.publicar_da_demanda(self.URGENTE, ["src/b/**"])  # colide só com o velho, que espera
        comum = self.publicar("comum", ["src/b/**"])  # o mesmo, sem urgência: espera o velho
        c.ciclo()
        self.assertEqual(self.estados(), {rodando: "ativo", velho: "aguardando", urgente: "ativo", comum: "aguardando"})
        self.assertIs(self.entrada(urgente)["urgente"], True)
        self.assertEqual(self.iniciados(), [rodando, urgente])
        self.assertEqual(capacidade.ler(cap)["reservas"], reservas)  # ninguém perdeu a vaga
        self.assertEqual(self.systemd.de("disable"), [])


class TestesObservacao(Base):
    def test_unit_failed_vira_pausado_com_a_causa_e_active_volta_a_ativo(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        self.systemd.estados[self.unit(a)] = "failed"
        self.systemd.status[self.unit(a)] = "despachante.py[1]: config inválida: modelos\nMain process exited, status=2/INVALIDARGUMENT"
        c.ciclo()
        self.assertEqual(self.estados()[a], "pausado")
        avisos = [m for m in self.avisos() if a in m]
        self.assertEqual(len(avisos), 1)
        self.assertIn("config inválida", avisos[0])
        c.ciclo()
        self.assertEqual(len([m for m in self.avisos() if a in m]), 1)
        self.systemd.estados[self.unit(a)] = "active"
        c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")

    def test_unit_failed_com_estado_concluido_conclui_e_avisa_a_causa(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        cap = self.raiz / "capacidade.json"
        capacidade.reservar(cap, a, "raia-0", mem_disponivel_mb=None)
        capacidade.tomar_orquestrador(cap, REPO, a)
        self.concluir(a)
        self.systemd.estados[self.unit(a)] = "failed"
        self.systemd.status[self.unit(a)] = "Main process exited, status=2/INVALIDARGUMENT"
        c.ciclo()
        self.assertEqual(self.estados()[a], "concluido")
        self.assertIn(("disable", "--now", self.unit(a)), self.systemd.chamadas)
        avisos = [m for m in self.avisos() if a in m]
        self.assertEqual(len(avisos), 1)
        self.assertIn("plano %s concluído; a unit estava failed: " % a, avisos[0])
        self.assertIn("status=2", avisos[0])
        dados = capacidade.ler(cap)
        self.assertEqual((dados["reservas"], dados["orquestrador"]), ({}, {}))

    def test_is_active_vem_antes_da_conclusao(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        self.concluir(a)
        self.systemd.chamadas.clear()
        c.ciclo()
        acoes = [ch[0] for ch in self.systemd.chamadas]
        self.assertEqual(acoes, ["is-active", "disable"])
        self.assertEqual(self.estados()[a], "concluido")

    def test_pausado_bloqueia_quem_colide(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        self.systemd.estados[self.unit(a)] = "failed"
        c.ciclo()
        z = self.publicar("login-2", ["src/login/x/**"])
        c.ciclo()
        self.assertEqual(self.estados()[z], "aguardando")

    def test_pausa_da_fabrica_no_plano_aparece_como_pausado_e_a_unit_fica(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        estado = self.estado_do_plano(a)
        estado["pausado"] = "Warren rejeitando despachos"
        self.gravar_estado_do_plano(a, estado)
        c.ciclo()
        self.assertEqual(self.estados()[a], "pausado")
        self.assertEqual(self.systemd.de("disable"), [])
        self.assertEqual(self.systemd.estados[self.unit(a)], "active")
        estado["pausado"] = None
        self.gravar_estado_do_plano(a, estado)
        c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")

    def test_estado_json_ilegivel_nao_derruba_nem_conclui(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        (self.pasta(a) / "estado.json").write_text("{ruim", encoding="utf-8")
        c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")
        self.assertEqual(self.systemd.de("disable"), [])

    def test_reserva_orfa_de_plano_sem_unit_ativa_e_removida(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        cap = self.raiz / "capacidade.json"
        capacidade.reservar(cap, a, "raia-0", mem_disponivel_mb=None)
        capacidade.reservar(cap, "dono--cliente--fantasma--abcdef", "r", mem_disponivel_mb=None)
        capacidade.tomar_orquestrador(cap, OUTRO, "dono--cliente--fantasma--abcdef")
        c.ciclo()
        dados = capacidade.ler(cap)
        self.assertEqual(dados["reservas"], {a: ["raia-0"]})
        self.assertEqual(dados["orquestrador"], {})
        self.systemd.estados[self.unit(a)] = "failed"
        c.ciclo()
        self.assertEqual(capacidade.ler(cap)["reservas"], {})

    def test_systemd_fora_nao_limpa_reservas_nem_muda_estados(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        cap = self.raiz / "capacidade.json"
        capacidade.reservar(cap, a, "raia-0", mem_disponivel_mb=None)
        self.systemd.quebrado = True
        c.ciclo()
        self.assertEqual(capacidade.ler(cap)["reservas"], {a: ["raia-0"]})
        self.assertEqual(self.estados()[a], "ativo")

    def test_unit_parada_a_mao_vira_pausado_sem_religar(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        self.systemd.estados[self.unit(a)] = "inactive"
        c.ciclo()
        self.assertEqual(self.estados()[a], "pausado")
        self.assertEqual(self.ligados(), [self.unit(a)])


class TestesOcupacaoDePlanoParado(Base):
    """Final I1: plano OCUPANDO sem unit rodando continua segurando as vagas e a trava que o estado.json mostra."""

    def setUp(self):
        super().setUp()
        self.cap = self.raiz / "capacidade.json"

    def admitir_com(self, feature, globs_, **mudancas):
        id_ = self.publicar(feature, globs_)
        c = self.novo()
        c.ciclo()
        estado = self.estado_do_plano(id_)
        for chave, valor in mudancas.items():
            estado[chave] = valor
        self.gravar_estado_do_plano(id_, estado)
        return id_, c

    def test_unit_failed_mantem_as_vagas_executando_e_a_trava_com_pr_do_orquestrador(self):
        a, c = self.admitir_com("login", ["src/login/**"], prsOrquestrador=["https://github.com/dono/cliente/pull/7"])
        estado = self.estado_do_plano(a)
        estado["raias"]["raia-0"]["estado"] = "executando"
        self.gravar_estado_do_plano(a, estado)
        capacidade.reservar(self.cap, a, "raia-0", mem_disponivel_mb=None)
        capacidade.tomar_orquestrador(self.cap, REPO, a)
        self.systemd.estados[self.unit(a)] = "failed"
        for _ in range(3):
            c.ciclo()
        self.assertEqual(self.estados()[a], "pausado")
        dados = capacidade.ler(self.cap)
        self.assertEqual(dados["reservas"], {a: ["raia-0"]})
        self.assertEqual(dados["orquestrador"], {REPO: a})

    def test_cenario_do_driver_outro_plano_do_repo_nao_acorda_nem_passa_das_vagas(self):
        # A tem 3 raias executando e o PR de fase_concluida esperando o Paulo; a unit de A cai (failed).
        a = self.publicar("login", ["src/login/a/**"], ["src/login/b/**"], ["src/login/c/**"])
        b = self.publicar("perfil", ["src/perfil/**"])
        c = self.novo()
        c.ciclo()
        self.assertEqual((self.estados()[a], self.estados()[b]), ("ativo", "ativo"))
        estado = self.estado_do_plano(a)
        for raia in estado["raias"].values():
            raia["estado"] = "executando"
        estado["prsOrquestrador"] = ["https://github.com/dono/cliente/pull/9"]
        self.gravar_estado_do_plano(a, estado)
        for raia in estado["raias"]:
            self.assertTrue(capacidade.reservar(self.cap, a, raia, mem_disponivel_mb=None))
        self.assertTrue(capacidade.tomar_orquestrador(self.cap, REPO, a, em_curso=True))
        self.systemd.estados[self.unit(a)] = "failed"
        for _ in range(3):
            c.ciclo()
            # o despachante de B, vivo, tenta acordar o orquestrador e despachar uma raia nova
            self.assertFalse(capacidade.tomar_orquestrador(self.cap, REPO, b))
            self.assertFalse(capacidade.reservar(self.cap, b, "raia-0", mem_disponivel_mb=None))
        dados = capacidade.ler(self.cap)
        self.assertEqual(dados["orquestrador"], {REPO: a})
        self.assertEqual(sum(len(r) for r in dados["reservas"].values()), 3)
        # o Paulo reinicia a unit de A: tudo segue com A
        self.systemd.estados[self.unit(a)] = "active"
        c.ciclo()
        self.assertEqual(capacidade.ler(self.cap)["orquestrador"], {REPO: a})

    def test_trava_esquecida_e_retomada_enquanto_o_estado_mostra_o_orquestrador(self):
        for mudanca in (
            {"orquestrador": {"runId": "orq-1", "motivo": "fase_concluida"}},
            {"acaoEmCurso": {"tipo": "acordar", "motivo": "fase_concluida", "alvo": "unica"}},
            {"despachosIncertos": [{"chave": "acordar:fase_concluida:unica", "acao": {"tipo": "acordar"}}]},
        ):
            with self.subTest(mudanca=mudanca):
                self.setUp()
                a, c = self.admitir_com("login", ["src/login/**"], **mudanca)
                self.systemd.estados[self.unit(a)] = "inactive"
                c.ciclo()
                self.assertEqual(capacidade.ler(self.cap)["orquestrador"], {REPO: a})

    def test_reserva_de_despacho_em_curso_ou_incerto_fica(self):
        a, c = self.admitir_com(
            "login",
            ["src/login/**"],
            acaoEmCurso={"tipo": "despachar_raia", "raia": "raia-0"},
            despachosIncertos=[{"chave": "despachar_raia:raia-9", "acao": {"tipo": "despachar_raia", "raia": "raia-9"}}],
        )
        self.systemd.estados[self.unit(a)] = "failed"
        c.ciclo()
        self.assertEqual(capacidade.ler(self.cap)["reservas"], {a: ["raia-0", "raia-9"]})

    def test_sem_orquestrador_em_curso_solta_a_trava_e_sai_da_espera(self):
        a, c = self.admitir_com("login", ["src/login/**"])
        z = "dono--cliente--outro--abcdef"
        capacidade.tomar_orquestrador(self.cap, REPO, z)
        capacidade.tomar_orquestrador(self.cap, REPO, a)  # recusado: A entra na espera
        capacidade.soltar_orquestrador(self.cap, REPO, z)
        capacidade.tomar_orquestrador(self.cap, REPO, a)  # A é o 1º da espera e toma
        self.assertEqual(capacidade.ler(self.cap)["orquestrador"], {REPO: a})
        self.systemd.estados[self.unit(a)] = "inactive"
        c.ciclo()
        dados = capacidade.ler(self.cap)
        self.assertEqual((dados["orquestrador"], dados["esperando"], dados["reservas"]), ({}, {}, {}))

    def test_parado_na_espera_sem_demanda_nao_bloqueia_quem_vem_depois(self):
        a, c = self.admitir_com("login", ["src/login/**"])
        z = "dono--cliente--outro--abcdef"
        capacidade.tomar_orquestrador(self.cap, REPO, z)
        capacidade.tomar_orquestrador(self.cap, REPO, a)  # A espera
        capacidade.soltar_orquestrador(self.cap, REPO, z)
        self.systemd.estados[self.unit(a)] = "failed"
        c.ciclo()
        self.assertEqual(capacidade.ler(self.cap)["esperando"], {})

    def test_estado_json_ilegivel_nao_mexe_e_avisa_uma_vez(self):
        a, c = self.admitir_com("login", ["src/login/**"])
        capacidade.reservar(self.cap, a, "raia-0", mem_disponivel_mb=None)
        capacidade.tomar_orquestrador(self.cap, REPO, a)
        (self.pasta(a) / "estado.json").write_text("{ruim", encoding="utf-8")
        self.systemd.estados[self.unit(a)] = "failed"
        for _ in range(3):
            c.ciclo()
        dados = capacidade.ler(self.cap)
        self.assertEqual((dados["reservas"], dados["orquestrador"]), ({a: ["raia-0"]}, {REPO: a}))
        self.assertEqual(len([m for m in self.avisos() if "estado.json" in m and a in m]), 1)

    def test_despachante_vivo_fora_do_systemd_cuida_das_proprias_vagas(self):
        a, c = self.admitir_com("login", ["src/login/**"])
        capacidade.reservar(self.cap, a, "raia-0", mem_disponivel_mb=None)
        self.systemd.estados[self.unit(a)] = "inactive"
        with coordenador.despachante.travar(self.pasta(a)):
            c.ciclo()
        self.assertEqual(capacidade.ler(self.cap)["reservas"], {a: ["raia-0"]})

    def test_concluido_e_removido_continuam_sendo_limpos(self):
        a, c = self.admitir_com("login", ["src/login/**"])
        capacidade.reservar(self.cap, "dono--cliente--fantasma--abcdef", "r", mem_disponivel_mb=None)
        c.ciclo()
        self.assertNotIn("dono--cliente--fantasma--abcdef", capacidade.ler(self.cap)["reservas"])


class TestesConclusaoComPlanoAdotado(Base):
    """Final M1: só conclui quando o plano.json adotado é o da entrada da fila (mesmo hash)."""

    def test_plano_novo_no_main_ainda_nao_adotado_nao_conclui(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        self.concluir(a)
        novo = plano_com(["src/login/**"])
        novo["raias"][0]["criteriosAceite"] = ["ok", "e mais um"]
        self.forja.definir_arquivo(REPO, "main", ".fabrica/planos/login.json", json.dumps(novo))
        c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")
        self.assertEqual(self.systemd.de("disable"), [])
        (self.pasta(a) / "plano.json").write_text(json.dumps(novo), encoding="utf-8")
        c.ciclo()
        self.assertEqual(self.estados()[a], "concluido")


class TestesIdsDoArquivo(Base):
    def test_id_invalido_no_fila_estado_e_ignorado_com_aviso_e_nunca_vira_unit_nem_caminho(self):
        bom = self.publicar("login", ["src/login/**"])
        ruins = ["../../fora", "dono--cliente--x", "Dono--cliente--login--abcdef", "a--b--c--d--e", "dono--cliente--login--abc def"]
        fila_ = [
            {"id": id_, "repo": REPO, "feature": "x", "caminho": ".fabrica/planos/x.json", "entrouEm": "2026-11-03T10:00:00Z", "estado": estado, "arquivos": ["outro/**"]}
            for id_ in ruins
            for estado in ("ativo", "aguardando")
        ]
        (self.raiz / "fila-estado.json").write_text(json.dumps({"fila": fila_}), encoding="utf-8")
        c = self.novo()
        c.ciclo()
        c.ciclo()
        alvos = [ch[-1] for ch in self.systemd.chamadas]
        self.assertTrue(all(alvo == self.unit(bom) for alvo in alvos), alvos)
        self.assertEqual(self.iniciados(), [bom])
        self.assertFalse((self.raiz.parent / "fora").exists())
        self.assertEqual(sorted(p.name for p in (self.raiz / "planos").iterdir()), [bom])
        for id_ in ruins:
            self.assertEqual(len([m for m in self.avisos() if repr(id_) in m]), 1, id_)
        ids = [e["id"] for e in self.fila_estado()["fila"]]
        self.assertEqual(ids.count("../../fora"), 2)  # a entrada fica no arquivo, intocada
        fila_no_status = coordenador.status(self.raiz).split("vagas efetivas")[0]
        self.assertNotIn("../../fora", fila_no_status)


class TestesPlanoInvalido(Base):
    def test_plano_invalido_no_main_da_um_aviso_e_nao_entra(self):
        caminho = ".fabrica/planos/quebrado.json"
        self.forja.definir_arquivo(REPO, "main", caminho, json.dumps({"versao": 1}))
        self.forja.definir_arquivo(REPO, "main", ".fabrica/planos/ilegivel.json", "{nao json")
        self.forja.definir_arquivo(REPO, "main", ".fabrica/planos/LEIAME.md", "# x")
        c = self.novo()
        for _ in range(3):
            c.ciclo()
        self.assertEqual(self.fila_estado()["fila"], [])
        self.assertEqual(len([m for m in self.avisos() if "quebrado" in m]), 1)
        self.assertEqual(len([m for m in self.avisos() if "ilegivel" in m]), 1)
        self.assertEqual([m for m in self.avisos() if "LEIAME" in m], [])
        self.assertEqual(self.executar.chamadas, [])
        self.forja.definir_arquivo(REPO, "main", caminho, json.dumps({"versao": 2}))
        c.ciclo()
        self.assertEqual(len([m for m in self.avisos() if "quebrado" in m]), 2)
        self.novo().ciclo()
        self.assertEqual(len([m for m in self.avisos() if "quebrado" in m]), 2)

    def test_nome_de_arquivo_invalido_da_aviso(self):
        self.forja.definir_arquivo(REPO, "main", ".fabrica/planos/Login.json", json.dumps(plano_com(["src/**"])))
        self.forja.definir_arquivo(REPO, "main", ".fabrica/planos/plano.json", json.dumps(plano_com(["src/**"])))
        self.novo().ciclo()
        self.assertEqual(self.fila_estado()["fila"], [])
        self.assertTrue([m for m in self.avisos() if "Login.json" in m])
        self.assertTrue([m for m in self.avisos() if "planos/plano.json" in m])

    def test_plano_que_fica_invalido_com_o_plano_ativo_nao_mata_o_despachante(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        self.forja.definir_arquivo(REPO, "main", ".fabrica/planos/login.json", "{quebrado")
        c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")
        self.assertEqual(self.systemd.de("disable"), [])


class TestesPrepararWarren(Base):
    def chamadas(self):
        return len(self.preparar.chamadas)

    def test_a_cada_ciclo_ate_ficar_pronto_e_depois_a_cada_20(self):
        nao = dict(PRONTO, estado="versao_desconhecida")
        self.preparar = PrepararFalso(nao, nao, PRONTO)
        c = self.novo()
        for _ in range(3):
            c.ciclo()
        self.assertEqual(self.chamadas(), 3)
        for _ in range(19):
            c.ciclo()
        self.assertEqual(self.chamadas(), 3)
        c.ciclo()
        self.assertEqual(self.chamadas(), 4)
        for _ in range(19):
            c.ciclo()
        self.assertEqual(self.chamadas(), 4)
        c.ciclo()
        self.assertEqual(self.chamadas(), 5)

    def test_dropin_ou_automerge_com_erro_nao_conta_como_pronto(self):
        for ruim in (dict(PRONTO, dropin="erro"), dict(PRONTO, automerge="erro"), dict(PRONTO, estado="aplicado", dropin="erro")):
            with self.subTest(ruim=ruim):
                self.preparar = PrepararFalso(ruim)
                c = self.novo()
                for _ in range(3):
                    c.ciclo()
                self.assertEqual(self.chamadas(), 3)

    def test_warren_auto_que_nao_desligou_nao_conta_como_pronto_e_vai_para_o_log(self):
        ruim = dict(PRONTO, desligados={"warren-automerge.service": "ja_desligado", "warren-auto.service": "erro"})
        self.preparar = PrepararFalso(ruim, ruim, PRONTO)
        c = self.novo()
        for _ in range(4):
            c.ciclo()
        self.assertEqual(self.chamadas(), 3)
        linhas = [json.loads(x) for x in (self.raiz / "log.jsonl").read_text(encoding="utf-8").splitlines()]
        preparos = [x for x in linhas if x.get("evento") == "preparar_warren"]
        self.assertEqual(preparos[0]["desligados"], {"warren-automerge.service": "ja_desligado", "warren-auto.service": "erro"})
        self.assertTrue([m for m in self.avisos() if "warren-auto" in m])

    def test_preparar_que_lanca_ou_devolve_lixo_nao_derruba_o_ciclo(self):
        def lanca(**_):
            raise RuntimeError("boom %s" % TOKEN)

        a = self.publicar("login", ["src/login/**"])
        self.novo(preparar_warren=lanca).ciclo()
        self.novo(preparar_warren=lambda **_: "lixo").ciclo()
        self.assertEqual(self.estados()[a], "ativo")
        self.assertNotIn(TOKEN, (self.raiz / "log.jsonl").read_text(encoding="utf-8"))

    def test_revertido_passa_o_sha_na_proxima_tentativa(self):
        revertido = dict(PRONTO, estado="revertido", sha="b" * 64, warrenVoltou=True)
        self.preparar = PrepararFalso(revertido, PRONTO)
        c = self.novo()
        c.ciclo()
        c.ciclo()
        self.assertIsNone(self.preparar.chamadas[0]["sha_revertido"])
        self.assertEqual(self.preparar.chamadas[1]["sha_revertido"], "b" * 64)

    def test_sem_preparar_nada_e_chamado(self):
        c = self.novo(preparar_warren=None)
        c.ciclo()
        self.assertIsNone(capacidade.ler(self.raiz / "capacidade.json")["drenagem"])


class TestesDrenagem(Base):
    def drenagem(self):
        return capacidade.ler(self.raiz / "capacidade.json")["drenagem"]

    def test_duas_esperas_ligam_a_drenagem_e_o_preparo_aplicado_desliga(self):
        self.preparar = PrepararFalso(ESPERANDO, ESPERANDO, ESPERANDO, dict(PRONTO, estado="aplicado"))
        c = self.novo()
        c.ciclo()
        self.assertIsNone(self.drenagem())
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        self.assertEqual(self.drenagem(), "2026-11-03T12:01:00Z")
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        self.assertEqual(self.drenagem(), "2026-11-03T12:01:00Z")
        c.ciclo()
        self.assertIsNone(self.drenagem())

    def test_teto_de_25_min_sem_dropin_e_6_h_de_pausa(self):
        self.preparar = PrepararFalso(dict(ESPERANDO, dropin="pendente"))
        c = self.novo()
        c.ciclo()
        c.ciclo()
        self.assertEqual(self.drenagem(), "2026-11-03T12:00:00Z")
        self.instante += datetime.timedelta(minutes=24)
        c.ciclo()
        self.assertIsNotNone(self.drenagem())
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        self.assertIsNone(self.drenagem())
        self.assertTrue([m for m in self.avisos() if "drenagem" in m])
        self.instante += datetime.timedelta(hours=5)
        c.ciclo()
        c.ciclo()
        self.assertIsNone(self.drenagem())
        self.instante += datetime.timedelta(hours=1)
        c.ciclo()
        self.assertEqual(self.drenagem(), "2026-11-03T18:25:00Z")

    def test_teto_de_45_min_com_dropin_carregado(self):
        self.preparar = PrepararFalso(PRONTO, ESPERANDO)
        c = self.novo()
        c.ciclo()  # pronto: confirma o drop-in carregado
        for _ in range(20):
            c.ciclo()  # o 20º volta a chamar
        c.ciclo()
        self.assertIsNotNone(self.drenagem())
        self.instante += datetime.timedelta(minutes=30)
        c.ciclo()
        self.assertIsNotNone(self.drenagem())
        self.instante += datetime.timedelta(minutes=15)
        c.ciclo()
        self.assertIsNone(self.drenagem())

    def test_coordenador_novo_limpa_a_drenagem_herdada_antes_do_primeiro_preparo(self):
        self.preparar = PrepararFalso(ESPERANDO)
        c = self.novo()
        c.ciclo()
        c.ciclo()
        self.assertEqual(self.drenagem(), "2026-11-03T12:00:00Z")
        vistos = []
        preparar = self.preparar

        def espiao(**argumentos):
            vistos.append(self.drenagem())
            return preparar(**argumentos)

        self.instante += datetime.timedelta(minutes=5)
        novo = self.novo(preparar_warren=espiao)
        novo.ciclo()
        self.assertEqual(vistos, [None])
        self.assertIsNone(self.drenagem())
        self.assertIsNone(self.fila_estado()["warren"]["drenagem"]["desde"])
        novo.ciclo()  # duas esperas deste coordenador: drenagem nova, com o relógio dele
        self.assertEqual(self.drenagem(), "2026-11-03T12:05:00Z")

    def test_coordenador_novo_sem_preparo_tambem_limpa(self):
        capacidade.definir_drenagem(self.raiz / "capacidade.json", "2026-11-03T11:00:00Z")
        self.novo(preparar_warren=None).ciclo()
        self.assertIsNone(self.drenagem())


class TestesSegurar(Base):
    def dois_que_colidem(self):
        self.publicar("login", ["src/x/**"])
        self.publicar("cobranca", ["src/x/**"])
        c = self.novo()
        c.ciclo()
        estados = self.estados()
        primeiro = [i for i, e in estados.items() if e == "ativo"][0]
        segundo = [i for i, e in estados.items() if e == "aguardando"][0]
        return c, primeiro, segundo

    def test_segurar_impede_admissao_com_vaga_e_trava_livres(self):
        c, primeiro, segundo = self.dois_que_colidem()
        frase = c.pedir("segurar", segundo)
        self.assertEqual(frase, "pedido segurar de %s gravado; aplicado no próximo ciclo" % segundo)
        self.concluir(primeiro)
        c.ciclo()
        c.ciclo()
        self.assertEqual(self.estados()[segundo], "aguardando")
        self.assertNotIn(self.unit(segundo), self.ligados())
        self.assertIn("%s segurado na fila (coordenador.py soltar %s para liberar)" % (segundo, segundo), self.avisos())

    def test_soltar_admite_no_ciclo_seguinte(self):
        c, primeiro, segundo = self.dois_que_colidem()
        c.pedir("segurar", segundo)
        self.concluir(primeiro)
        c.ciclo()
        c.ciclo()
        c.pedir("soltar", segundo)
        c.ciclo()
        self.assertEqual(self.estados()[segundo], "ativo")
        self.assertIn(self.unit(segundo), self.ligados())
        self.assertIn("%s solto na fila" % segundo, self.avisos())

    def test_segurar_fora_de_aguardando_recusa(self):
        c, primeiro, _ = self.dois_que_colidem()
        with self.assertRaises(coordenador.ErroDeEntrada):
            c.pedir("segurar", primeiro)
        self.assertFalse(list((self.raiz / "entrada").glob("*.json")) if (self.raiz / "entrada").exists() else [])

    def test_soltar_sem_estar_segurado_recusa(self):
        c, _, segundo = self.dois_que_colidem()
        with self.assertRaises(coordenador.ErroDeEntrada):
            c.pedir("soltar", segundo)

    def test_id_desconhecido_recusa(self):
        c, _, _ = self.dois_que_colidem()
        for comando in ("segurar", "soltar"):
            with self.assertRaises(coordenador.ErroDeEntrada):
                c.pedir(comando, "nao--existe--x--y")
        self.assertFalse((self.raiz / "entrada").exists())

    def test_estado_que_mudou_depois_do_pedido_vira_aviso_e_apaga(self):
        c, primeiro, segundo = self.dois_que_colidem()
        c.pedir("segurar", segundo)
        self.concluir(primeiro)
        self.dados_forcar_ativo(segundo)
        c.ciclo()
        self.assertEqual(list((self.raiz / "entrada").glob("*.json")), [])
        self.assertTrue(any("segurar" in a and segundo in a for a in self.avisos()))

    def dados_forcar_ativo(self, id_):
        dados = self.fila_estado()
        for e in dados["fila"]:
            if e["id"] == id_:
                e["estado"] = "ativo"
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")

    def test_pedido_torto_e_descartado(self):  # [RF 1]
        self.publicar("login", ["src/x/**"])
        entrada = self.raiz / "entrada"
        entrada.mkdir()
        (entrada / "x.json").write_text("{", encoding="utf-8")
        (entrada / "y.json").write_text('{"comando":"voar"}', encoding="utf-8")
        self.novo().ciclo()
        self.assertEqual(list(entrada.glob("*.json")), [])
        self.assertEqual(len([a for a in self.avisos() if "pedido" in a]), 2)
        self.assertIn("ativo", self.estados().values())

    def test_remover_de_plano_desconhecido_vira_aviso_e_sai_da_caixa(self):
        self.publicar("login", ["src/x/**"])
        entrada = self.raiz / "entrada"
        entrada.mkdir()
        (entrada / "r.json").write_text('{"comando":"remover","id":"x"}', encoding="utf-8")
        self.novo().ciclo()
        self.assertEqual(list(entrada.glob("*.json")), [])
        self.assertTrue(any("remover" in a and "desconhecido" in a for a in self.avisos()))

    def test_pedido_que_nao_sai_da_caixa_nao_e_reaplicado(self):
        c, primeiro, segundo = self.dois_que_colidem()
        c.pedir("segurar", segundo)
        arquivo = next((self.raiz / "entrada").glob("*.json"))
        with unittest.mock.patch.object(pathlib.Path, "unlink", side_effect=PermissionError("sem permissão")):
            c.ciclo()
            c.ciclo()
        self.assertTrue(arquivo.exists())
        c.pedir("soltar", segundo)
        self.concluir(primeiro)
        c.ciclo()
        c.ciclo()
        self.assertEqual(self.estados()[segundo], "ativo")
        self.assertFalse(arquivo.exists())

    def test_segurar_de_quem_ja_esta_segurado_nao_repete_aviso(self):
        c, _, segundo = self.dois_que_colidem()
        c.pedir("segurar", segundo)
        c.ciclo()
        antes = len(self.avisos())
        c.pedir("segurar", segundo)
        c.ciclo()
        self.assertEqual(len(self.avisos()), antes)

    def test_status_mostra_segurado(self):
        c, _, segundo = self.dois_que_colidem()
        c.pedir("segurar", segundo)
        c.ciclo()
        self.assertIn("%s: aguardando (segurado)" % segundo, c.status())


ISSUE_PAUSA = "https://github.com/dono/cliente/issues/7"
PR_ORQ = "https://github.com/dono/cliente/pull/9"
COMENTARIO_REMOCAO = "Plano removido da fila pelo coordenador."
ESCRITAS_DA_FORJA = ("fechar_pr", "fechar_decisao", "reabrir_decisao", "abrir_decisao", "mergear", "garantir_label")
ESCRITAS_DO_MOTOR = ("cancelar_plano", "despachar_plano", "despachar_run", "retomar_plano", "atualizar_projeto")


class TestesRemover(Base):
    def setUp(self):
        super().setUp()
        self.cap = self.raiz / "capacidade.json"

    def admitido(self, feature="login"):
        a = self.publicar(feature, ["src/%s/**" % feature])
        c = self.novo()
        c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")
        return c, a

    def com_plan_run(self, a, estado_do_run="running"):
        estado = self.estado_do_plano(a)
        self.motor.definir_plano("plano-raia", estado_do_run, [])
        estado["raias"]["raia-0"] = {"estado": "executando", "planRunId": "plano-raia"}
        self.gravar_estado_do_plano(a, estado)
        capacidade.reservar(self.cap, a, "raia-0", mem_disponivel_mb=None)
        capacidade.tomar_orquestrador(self.cap, REPO, a)

    def pausado(self):
        c, a = self.admitido()
        self.com_plan_run(a)
        estado = self.estado_do_plano(a)
        estado["pausado"] = "Warren rejeitando despachos"
        estado["decisaoPausa"] = {"url": ISSUE_PAUSA, "motivo": "x"}
        self.gravar_estado_do_plano(a, estado)
        self.forja.definir_decisao(ISSUE_PAUSA, fechada=False)
        c.ciclo()
        self.assertEqual(self.estados()[a], "pausado")
        return c, a

    def caixa(self):
        pasta = self.raiz / "entrada"
        return sorted(pasta.glob("*.json")) if pasta.exists() else []

    def test_remove_pausado(self):
        c, a = self.pausado()
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertIn(("disable", "--now", self.unit(a)), self.systemd.chamadas)
        self.assertEqual(self.systemd.estados[self.unit(a)], "inactive")
        self.assertEqual(self.motor.plano("plano-raia")["estado"], "cancelled")
        self.assertEqual(self.forja.decisao(ISSUE_PAUSA)["fechada"], True)
        self.assertEqual(self.forja.decisao(ISSUE_PAUSA)["ultimoComentario"], COMENTARIO_REMOCAO)
        self.assertEqual(self.estados()[a], "removido")
        dados = capacidade.ler(self.cap)
        self.assertEqual((dados["reservas"], dados["orquestrador"]), ({}, {}))
        self.assertEqual(self.caixa(), [])
        self.assertIn("%s removido da fila" % a, self.avisos())
        self.assertTrue(self.pasta(a).exists())
        log = [json.loads(l) for l in (self.raiz / "log.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertIn({"evento": "removido", "id": a, "manterArquivo": True}, [{k: v for k, v in r.items() if k != "ts"} for r in log])

    def test_unit_desligada_antes_de_fechar_a_issue(self):
        c, a = self.pausado()
        ordem = []
        systemd, fechar = self.systemd.__call__, self.forja.fechar_decisao

        def systemd_com_ordem(*args):
            ordem.append(("systemd",) + args)
            return systemd(*args)

        def fechar_com_ordem(url, comentario):
            ordem.append(("fechar_decisao", url))
            return fechar(url, comentario)

        c.systemd = systemd_com_ordem
        self.forja.fechar_decisao = fechar_com_ordem
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertIn(("systemd", "disable", "--now", self.unit(a)), ordem)
        self.assertLess(ordem.index(("systemd", "disable", "--now", self.unit(a))), ordem.index(("fechar_decisao", ISSUE_PAUSA)))

    def test_remove_ativo(self):
        c, a = self.admitido()
        self.com_plan_run(a)
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertEqual(self.estados()[a], "removido")
        self.assertEqual(self.systemd.estados[self.unit(a)], "inactive")
        self.assertEqual(self.motor.plano("plano-raia")["estado"], "cancelled")
        self.assertEqual(capacidade.ler(self.cap)["reservas"], {})

    def test_remove_aguardando(self):
        self.publicar("login", ["src/x/**"])
        self.publicar("cobranca", ["src/x/**"])
        c = self.novo()
        c.ciclo()
        segundo = [i for i, e in self.estados().items() if e == "aguardando"][0]
        self.systemd.chamadas.clear()
        c.pedir("remover", segundo, manter_arquivo=True)
        c.ciclo()
        self.assertEqual(self.estados()[segundo], "removido")
        self.assertEqual([ch for ch in self.systemd.chamadas if ch[-1] == self.unit(segundo)], [])
        self.assertEqual(self.caixa(), [])

    def test_plan_run_vivo_achado_so_no_warren(self):
        c, a = self.admitido()
        vivo = self.motor.despachar_plano(
            projeto="cliente", plano_seeds="pl-0000", agente="x", modelo="m", prompt_template="p", max_custo_usd=1.0
        )
        alheio = self.motor.despachar_plano(
            projeto="cliente", plano_seeds="pl-9999", agente="x", modelo="m", prompt_template="p", max_custo_usd=1.0
        )
        self.assertEqual(self.estado_do_plano(a)["raias"]["raia-0"]["estado"], "planejada")
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertEqual(self.motor.plano(vivo)["estado"], "cancelled")
        self.assertEqual(self.motor.plano(alheio)["estado"], "running")
        self.assertEqual(self.estados()[a], "removido")

    def test_warren_fora_nao_conclui(self):
        c, a = self.pausado()
        c.pedir("remover", a, manter_arquivo=True)
        with unittest.mock.patch.object(self.motor, "cancelar_plano", side_effect=OSError("Warren fora")):
            c.ciclo()
        self.assertEqual(self.estados()[a], "pausado")
        self.assertEqual(len(self.caixa()), 1)
        self.assertTrue(any(a in m and "Warren fora" in m for m in self.avisos()))
        self.assertEqual(self.forja.decisao(ISSUE_PAUSA)["fechada"], False)
        c.ciclo()
        self.assertEqual(self.estados()[a], "removido")
        self.assertEqual(self.caixa(), [])

    def test_plan_run_404_no_estado_conclui_com_aviso(self):
        c, a = self.pausado()
        estado = self.estado_do_plano(a)
        estado["raias"]["raia-0"] = {"estado": "concluida", "planRunId": "plano-sumido"}
        self.gravar_estado_do_plano(a, estado)
        c.pedir("remover", a, manter_arquivo=True)
        self.assertIn("Plan Run plano-sumido não encontrado", c.pedir("remover", a, manter_arquivo=True, simular=True))
        c.ciclo()
        self.assertEqual(self.estados()[a], "removido")
        self.assertEqual(self.forja.decisao(ISSUE_PAUSA)["fechada"], True)
        self.assertTrue(any(a in m and "Plan Run plano-sumido não encontrado" in m for m in self.avisos()))

    def test_plan_run_404_http_do_cliente_real_tambem_conclui(self):
        c, a = self.admitido()
        self.com_plan_run(a)
        with unittest.mock.patch.object(self.motor, "plano", side_effect=RuntimeError("GET /plan-runs/plano-raia: HTTP 404")):
            c.pedir("remover", a, manter_arquivo=True)
            c.ciclo()
        self.assertEqual(self.estados()[a], "removido")

    def test_issue_404_conclui_com_aviso(self):
        c, a = self.pausado()
        del self.forja._decisoes[ISSUE_PAUSA]
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertEqual(self.estados()[a], "removido")
        self.assertTrue(any(a in m and ("issue %s não encontrada" % ISSUE_PAUSA) in m for m in self.avisos()))

    def test_issue_410_http_do_cliente_real_conclui_com_aviso(self):
        c, a = self.pausado()
        gone = RuntimeError("PATCH /repos/dono/cliente/issues/7: HTTP 410")
        with unittest.mock.patch.object(self.forja, "fechar_decisao", side_effect=gone):
            c.pedir("remover", a, manter_arquivo=True)
            c.ciclo()
        self.assertEqual(self.estados()[a], "removido")
        self.assertTrue(any(a in m and ("issue %s não encontrada" % ISSUE_PAUSA) in m for m in self.avisos()))

    def test_http_500_no_fechar_issue_nao_conclui(self):
        c, a = self.pausado()
        erro = RuntimeError("PATCH /repos/dono/cliente/issues/7: HTTP 500")
        with unittest.mock.patch.object(self.forja, "fechar_decisao", side_effect=erro):
            c.pedir("remover", a, manter_arquivo=True)
            c.ciclo()
        self.assertEqual(self.estados()[a], "pausado")

    def test_entrada_aplicada_torta_no_estado_nao_trava_o_ciclo(self):
        c, a = self.pausado()
        dados = self.fila_estado()
        dados["entradaAplicada"] = 5
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertEqual(self.estados()[a], "removido")

    def test_entrada_aplicada_com_itens_que_nao_sao_texto_mantem_so_os_textos(self):
        c, a = self.pausado()
        dados = self.fila_estado()
        dados["entradaAplicada"] = ["ok.json", 7, None]
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
        self.assertEqual(coordenador.ler_estado(self.raiz)["entradaAplicada"], ["ok.json"])

    def test_falha_de_rede_no_cancelar_nao_conclui(self):
        c, a = self.pausado()
        c.pedir("remover", a, manter_arquivo=True)
        rede = RuntimeError("POST /plan-runs/plano-raia/cancel: falha de rede (TimeoutError)")
        with unittest.mock.patch.object(self.motor, "cancelar_plano", side_effect=rede):
            c.ciclo()
        self.assertEqual(self.estados()[a], "pausado")
        self.assertEqual(len(self.caixa()), 1)

    def test_orquestrador_em_curso_espera(self):  # [RF 3]
        c, a = self.admitido()
        self.motor.definir_run("run-orq", estado="running")
        estado = self.estado_do_plano(a)
        estado["orquestrador"] = {"runId": "run-orq", "motivo": "x"}
        self.gravar_estado_do_plano(a, estado)
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertNotEqual(self.estados()[a], "removido")
        self.assertEqual(len(self.caixa()), 1)
        self.assertIn("%s: esperando o run do orquestrador terminar para remover" % a, self.avisos())
        self.forja.definir_pr(PR_ORQ, head_sha="a" * 40, branch="fabrica/orq")
        self.motor.definir_run("run-orq", estado="succeeded", prUrl=PR_ORQ)
        c.ciclo()
        self.assertEqual(self.estados()[a], "removido")
        self.assertIn((PR_ORQ, COMENTARIO_REMOCAO), self.forja.fechados)

    def test_unit_inexistente_nao_trava(self):  # [RF 2]
        c, a = self.admitido()
        systemd = self.systemd.__call__

        def sem_unit(*args):
            if args[0] == "disable":
                self.systemd.chamadas.append(args)
                return 1, "Failed to disable unit: Unit file %s.service does not exist." % args[-1]
            return systemd(*args)

        c.systemd = sem_unit
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertEqual(self.estados()[a], "removido")

    def test_unit_que_nao_desliga_nao_conclui(self):  # [RF 2]
        c, a = self.admitido()
        systemd = self.systemd.__call__

        def negado(*args):
            if args[0] == "disable":
                return 1, "Access denied"
            return systemd(*args)

        c.systemd = negado
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertEqual(self.estados()[a], "ativo")
        self.assertEqual(len(self.caixa()), 1)
        self.assertTrue(any(a in m and "Access denied" in m for m in self.avisos()))

    def test_estado_ilegivel(self):
        c, a = self.admitido()
        (self.pasta(a) / "estado.json").write_text("{ruim", encoding="utf-8")
        capacidade.reservar(self.cap, a, "raia-0", mem_disponivel_mb=None)
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertEqual(self.estados()[a], "removido")
        self.assertEqual(capacidade.ler(self.cap)["reservas"], {})
        self.assertIn(
            "%s removido com estado.json ilegível: confira à mão os Plan Runs no Warren e os PRs do orquestrador" % a, self.avisos()
        )

    def test_arquivo_presente_recusa_sem_manter_arquivo(self):
        c, a = self.admitido()
        with self.assertRaises(coordenador.ErroDeEntrada) as erro:
            c.pedir("remover", a)
        self.assertIn(
            "o arquivo .fabrica/planos/login.json continua no branch padrão: apague-o ou use --manter-arquivo", erro.exception.erros[0]
        )
        self.assertEqual(self.caixa(), [])
        self.apagar("login")
        c.pedir("remover", a)
        c.ciclo()
        self.assertEqual(self.estados()[a], "removido")

    def test_manter_arquivo_nao_reentra(self):
        c, a = self.admitido()
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        tamanho = len(self.fila_estado()["fila"])
        c.ciclo()
        c.ciclo()
        self.assertEqual(len(self.fila_estado()["fila"]), tamanho)
        self.assertEqual(self.estados()[a], "removido")
        self.assertEqual(self.ligados(), [self.unit(a)])

    def test_pedido_repetido_sem_efeito(self):
        c, a = self.pausado()
        c.pedir("remover", a, manter_arquivo=True)
        c.pedir("remover", a, manter_arquivo=True)
        c.ciclo()
        self.assertEqual(self.caixa(), [])
        self.assertEqual(len([m for m in self.avisos() if m == "%s removido da fila" % a]), 1)
        self.assertEqual(c.pedir("remover", a, manter_arquivo=True), "%s já está removido" % a)
        self.assertEqual(self.caixa(), [])
        disables = len(self.systemd.de("disable"))
        c.ciclo()
        self.assertEqual(len(self.systemd.de("disable")), disables)

    def test_concluido_recusa(self):
        c, a = self.admitido()
        self.concluir(a)
        c.ciclo()
        self.assertEqual(self.estados()[a], "concluido")
        with self.assertRaises(coordenador.ErroDeEntrada):
            c.pedir("remover", a, manter_arquivo=True)

    def test_simular_nao_muda_nada(self):
        c, a = self.pausado()
        fila_antes = (self.raiz / "fila-estado.json").read_bytes()
        cap_antes = self.cap.read_bytes()
        self.forja.chamadas.clear()
        self.motor.chamadas.clear()
        texto = c.pedir("remover", a, manter_arquivo=True, simular=True)
        self.assertEqual(self.caixa(), [])
        self.assertEqual((self.raiz / "fila-estado.json").read_bytes(), fila_antes)
        self.assertEqual(self.cap.read_bytes(), cap_antes)
        self.assertEqual([ch for ch in self.forja.chamadas if ch[0] in ESCRITAS_DA_FORJA], [])
        self.assertEqual([ch for ch in self.motor.chamadas if ch[0] in ESCRITAS_DO_MOTOR], [])
        self.assertEqual(self.systemd.de("disable"), [])
        for trecho in (self.unit(a), "plano-raia", ISSUE_PAUSA):
            self.assertIn(trecho, texto)


class TestesStatus(Base):
    def test_status_mostra_fila_vagas_reservas_travas_e_avisos(self):
        a = self.publicar("login", ["src/login/**"])
        self.forja.definir_arquivo(REPO, "main", ".fabrica/planos/quebrado.json", "{x")
        c = self.novo()
        c.ciclo()
        cap = self.raiz / "capacidade.json"
        capacidade.configurar(cap, vagas=3, ram_minima_mb=2048)
        capacidade.registrar_oom(cap, "2026-11-03T12:00:00Z")
        capacidade.reservar(cap, a, "raia-0", mem_disponivel_mb=None)
        capacidade.tomar_orquestrador(cap, REPO, a)
        texto = coordenador.status(self.raiz)
        self.assertIn("%s: ativo (entrou em 2026-11-03T12:00:00Z)" % a, texto)
        self.assertIn("vagas efetivas: 2", texto)
        self.assertIn("%s: raia-0" % a, texto)
        self.assertIn("%s: %s" % (REPO, a), texto)
        self.assertIn("quebrado", texto)

    def test_status_tambem_e_metodo(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.novo()
        c.ciclo()
        self.assertEqual(c.status(), coordenador.status(self.raiz))
        self.assertIn("%s: ativo" % a, c.status())

    def test_status_sem_nada(self):
        texto = coordenador.status(self.raiz)
        self.assertIn("fila vazia", texto)
        self.assertIn("vagas efetivas: 3", texto)


class EnviarFalso:
    """`retrato.enviar` em memória: guarda o que recebeu; `falhas` é uma fila de exceções (ou `None` para sucesso)."""

    def __init__(self, *falhas, resposta=None):
        self.chamadas = []
        self.falhas = list(falhas)
        self.resposta = resposta

    def __call__(self, corpo, *, url, token_file):
        self.chamadas.append({"corpo": json.loads(corpo.decode("utf-8")), "bytes": len(corpo), "url": url, "token_file": token_file})
        falha = self.falhas.pop(0) if self.falhas else None
        if falha is not None:
            raise falha
        return self.resposta


class FlowSemConsertos(EnviarFalso):
    """Um Flow de antes dos consertos: 400 a todo retrato com `consertos`; sem o campo, grava e responde sem ele."""

    def __init__(self):
        super().__init__(resposta={"resultado": "gravado"})

    def __call__(self, corpo, *, url, token_file):
        resposta = super().__call__(corpo, url=url, token_file=token_file)
        if "consertos" in self.chamadas[-1]["corpo"]:
            raise retrato.FalhaDeEnvio("HTTP 400")
        return resposta


CENTRAL = {"url": "https://central.exemplo.com/api/fabrica/estado", "token_file": "/seg/central"}


class TestesCentral(Base):
    def central(self, *falhas, **extra):
        self.enviar = EnviarFalso(*falhas)
        return self.novo(central=CENTRAL, enviar=self.enviar, **extra)

    def avisos_da_central(self):
        return [a for a in self.avisos() if a.startswith("Central:")]

    def test_sem_central_nada_e_enviado_e_o_status_diz_desligado(self):
        enviar = EnviarFalso()
        c = self.novo(enviar=enviar)
        c.ciclo()
        self.assertEqual(enviar.chamadas, [])
        self.assertIn("envio à Central: desligado", c.status())
        self.assertIn("FABRICA_CENTRAL_URL", c.status())
        self.assertNotIn("central", self.fila_estado())

    def test_cada_ciclo_envia_o_retrato_com_url_e_arquivo_de_token(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.central()
        c.ciclo()
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        self.assertEqual(len(self.enviar.chamadas), 2)
        primeira = self.enviar.chamadas[0]
        self.assertEqual((primeira["url"], primeira["token_file"]), (CENTRAL["url"], CENTRAL["token_file"]))
        corpo = primeira["corpo"]
        self.assertEqual(corpo["versao"], 1)
        self.assertEqual(corpo["geradoEm"], "2026-11-03T12:00:00Z")
        self.assertEqual(self.enviar.chamadas[1]["corpo"]["geradoEm"], "2026-11-03T12:01:00Z")
        self.assertEqual([(p["id"], p["estado"]) for p in corpo["planos"]], [(a, "ativo")])
        self.assertEqual(corpo["planos"][0]["feature"], "login")
        self.assertEqual(corpo["planos"][0]["faseAtual"], "unica")
        self.assertEqual(corpo["vagas"]["configuradas"], 3)
        self.assertEqual(corpo["warren"]["preparo"], "ja_aplicado")
        self.assertNotIn(str(self.raiz), json.dumps(corpo))

    def test_o_retrato_reflete_as_reservas_e_uma_entrada_por_id(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.central()
        c.ciclo()
        capacidade.reservar(self.raiz / "capacidade.json", a, "raia-0", mem_disponivel_mb=None)
        dados = self.fila_estado()
        dados["fila"].append(dict(dados["fila"][0], estado="pausado"))
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
        c.ciclo()
        corpo = self.enviar.chamadas[-1]["corpo"]
        self.assertEqual(corpo["vagas"]["ocupadas"], 1)
        self.assertEqual(len(corpo["planos"]), 1)

    def test_envia_mesmo_quando_um_passo_do_ciclo_falha(self):
        self.publicar("login", ["src/login/**"])
        c = self.central()
        c.ciclo()
        (self.raiz / "fila.json").write_text("{quebrado", encoding="utf-8")
        with self.assertRaises(coordenador.ErroDeEntrada):
            c.ciclo()
        self.assertEqual(len(self.enviar.chamadas), 2)

    def test_falha_do_envio_nao_muda_a_fila_nem_para_o_ciclo(self):
        a = self.publicar("login", ["src/login/**"])
        b = self.publicar("cobranca", ["src/cobranca/**"])
        c = self.central(*[retrato.FalhaDeEnvio("HTTP 401")] * 3)
        c.ciclo()
        self.assertEqual(self.estados(), {a: "ativo", b: "ativo"})
        self.assertEqual(sorted(self.iniciados()), sorted([a, b]))
        self.assertEqual(self.avisos_da_central(), ["Central: envio do retrato falhou (HTTP 401)"])

    def test_aviso_so_quando_o_erro_muda_e_de_novo_depois_de_um_sucesso(self):
        sequencia = [
            retrato.FalhaDeEnvio("HTTP 401"),
            retrato.FalhaDeEnvio("HTTP 401"),
            retrato.FalhaDeEnvio("timeout"),
            None,
            retrato.FalhaDeEnvio("timeout"),
        ]
        c = self.central(*sequencia)
        for _ in sequencia:
            c.ciclo()
        self.assertEqual(
            self.avisos_da_central(),
            [
                "Central: envio do retrato falhou (HTTP 401)",
                "Central: envio do retrato falhou (timeout)",
                "Central: envio do retrato falhou (timeout)",
            ],
        )

    def test_qualquer_excecao_do_envio_inclusive_erro_de_entrada_vira_aviso_so_com_a_classe(self):
        c = self.central(coordenador.ErroDeEntrada(["arquivo de token ilegível " + TOKEN]), OSError("disco " + TOKEN), KeyError(TOKEN))
        for _ in range(3):
            c.ciclo()
        avisos = self.avisos_da_central()
        self.assertEqual(
            avisos,
            [
                "Central: envio do retrato falhou (falha inesperada (ErroDeEntrada))",
                "Central: envio do retrato falhou (falha inesperada (OSError))",
                "Central: envio do retrato falhou (falha inesperada (KeyError))",
            ],
        )

    def test_rodar_continua_depois_de_erro_de_entrada_no_envio(self):
        c = self.central(coordenador.ErroDeEntrada(["x"]), coordenador.ErroDeEntrada(["x"]))
        c.rodar(intervalo=1, ciclos=2, dormir=lambda s: None)
        self.assertEqual(len(self.enviar.chamadas), 2)

    def test_capacidade_invalida_nao_envia_e_avisa(self):
        (self.raiz / "capacidade.json").write_text(json.dumps({"vagasConfig": 0}), encoding="utf-8")
        c = self.central()
        c.ciclo()
        self.assertEqual(self.enviar.chamadas, [])
        self.assertEqual(len(self.avisos_da_central()), 1)
        self.assertIn("capacidade.json", self.avisos_da_central()[0])
        (self.raiz / "capacidade.json").write_text("{lixo", encoding="utf-8")
        c.ciclo()
        self.assertEqual(self.enviar.chamadas, [])

    def test_retrato_que_nao_cabe_nao_e_enviado_e_avisa(self):
        c = self.central()
        with unittest.mock.patch.object(retrato, "ajustar", return_value=None):
            c.ciclo()
        self.assertEqual(self.enviar.chamadas, [])
        self.assertIn("não cabe", self.avisos_da_central()[0])

    def test_corta_planos_encerrados_antes_de_enviar(self):
        self.escrever_fila({"repos": [{"repo": REPO, "projeto": "cliente"}]})
        c = self.central()
        c.ciclo()
        dados = self.fila_estado()
        for n in range(60):
            dados["fila"].append(
                {
                    "id": "dono--cliente--velho%02d--aaaaaa" % n,
                    "repo": REPO,
                    "feature": "velho%d" % n,
                    "estado": "concluido",
                    "entrouEm": "2026-10-01T00:%02d:00Z" % n,
                    "arquivos": ["x"],
                }
            )
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
        c.ciclo()
        planos = self.enviar.chamadas[-1]["corpo"]["planos"]
        self.assertEqual(len(planos), 50)
        self.assertEqual(planos[0]["feature"], "velho10")

    def test_o_status_mostra_o_ultimo_envio_e_o_resultado(self):
        c = self.central(None, retrato.FalhaDeEnvio("HTTP 401"))
        c.ciclo()
        self.assertIn("envio à Central: ligado", c.status())
        self.assertIn("último envio à Central: 2026-11-03T12:00:00Z enviado", c.status())
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        self.assertIn("último envio à Central: 2026-11-03T12:01:00Z falhou: HTTP 401", c.status())
        self.assertEqual(coordenador.status(self.raiz, CENTRAL), c.status())

    def test_as_variaveis_da_central_nao_vao_para_o_plano_env_nem_para_o_ambiente(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.central(ambiente={"GH_TOKEN_FILE": "/seg/gh", "FABRICA_CENTRAL_URL": CENTRAL["url"], "FABRICA_CENTRAL_TOKEN_FILE": "/seg/central"})
        c.ciclo()
        env = (self.pasta(a) / "plano.env").read_text(encoding="utf-8")
        self.assertNotIn("CENTRAL", env)
        self.assertNotIn("/seg/central", env)
        self.assertEqual(c.ambiente, {"GH_TOKEN_FILE": "/seg/gh"})
        self.assertNotIn("CENTRAL", json.dumps(self.executar.chamadas[0][1]))

    def test_de_ponta_a_ponta_com_uma_central_de_verdade(self):
        arquivo = self.raiz / "token-central"
        arquivo.write_text(testes_retrato.TOKEN + "\n", encoding="utf-8")
        servidor = testes_retrato.Central()
        self.addCleanup(servidor.parar)
        self.publicar("login", ["src/login/**"])
        c = self.novo(central={"url": servidor.url, "token_file": str(arquivo)})
        c.ciclo()
        ((caminho, cabecalhos, corpo),) = servidor.recebidos
        self.assertEqual(caminho, "/api/fabrica/estado")
        self.assertEqual(cabecalhos["Authorization"], "Bearer " + testes_retrato.TOKEN)
        self.assertEqual(json.loads(corpo)["versao"], 1)
        self.assertIn("enviado", c.status())

    def test_central_fora_401_e_redirecionamento_nao_vazam_o_token_nem_mexem_na_fila(self):
        arquivo = self.raiz / "token-central"
        arquivo.write_text(testes_retrato.TOKEN, encoding="utf-8")
        a = self.publicar("login", ["src/login/**"])
        destino = testes_retrato.Central()
        self.addCleanup(destino.parar)
        casos = {
            "401": testes_retrato.Central(codigo=401),
            "redireciona": testes_retrato.Central(codigo=302, local=destino.url),
        }
        for nome, servidor in casos.items():
            self.addCleanup(servidor.parar)
            with self.subTest(nome=nome):
                c = self.novo(central={"url": servidor.url, "token_file": str(arquivo)})
                c.ciclo()
                self.assertEqual(self.estados()[a], "ativo")
        morto = testes_retrato.Central()
        url_morta = morto.url
        morto.parar()
        self.novo(central={"url": url_morta, "token_file": str(arquivo)}).ciclo()
        self.novo(central={"url": "http://localhost.exemplo.com/x", "token_file": str(arquivo)}).ciclo()
        self.novo(central={"url": "https://central.exemplo.com/x", "token_file": str(self.raiz / "nao-existe")}).ciclo()
        self.assertEqual(destino.recebidos, [])
        for arq in self.raiz.rglob("*"):
            if arq.is_file() and arq.name != "token-central":
                self.assertNotIn(testes_retrato.TOKEN, arq.read_text(encoding="utf-8", errors="replace"), str(arq))
        self.assertTrue(self.avisos_da_central())


ID_CONSERTO = "0b6f3c2e-6a1d-4c8e-9f00-1a2b3c4d5e6f"


class TestesConsertos(Base):
    def setUp(self):
        super().setUp()
        self.kit = pathlib.Path(self._tmp.name) / "kit"
        (self.kit / "fabrica" / "modelos").mkdir(parents=True)
        modelos = {"modelos": {"fixer": {"agente": "claude-code", "modelo": "modelo-do-fixer", "maxCustoUsd": 5}}}
        (self.kit / "fabrica" / "modelos" / "config.json").write_text(json.dumps(modelos), encoding="utf-8")
        self.pedido = {
            "id": ID_CONSERTO,
            "repositorio": REPO,
            "commit": "c" * 40,
            "execucaoUrl": None,
            "trechoDoLog": "Error: falhou",
            "abertoEm": "2026-11-03T11:50:00Z",
        }
        self.enviar = EnviarFalso(resposta={"resultado": "gravado", "consertos": [self.pedido]})

    def coordenador(self, **extra):
        return self.novo(central=CENTRAL, enviar=self.enviar, kit=self.kit, **extra)

    def despachos(self):
        return [a for nome, a in self.motor.chamadas if nome == "despachar_run"]

    def reservas(self):
        return capacidade.ler(self.raiz / "capacidade.json")["reservas"]

    def test_passo_central_despacha_conserto_da_resposta_e_o_retrato_seguinte_traz_o_estado(self):
        c = self.coordenador()
        c.ciclo()
        self.assertNotIn("consertos", self.enviar.chamadas[0]["corpo"])
        (despacho,) = self.despachos()
        self.assertEqual((despacho["projeto"], despacho["agente"], despacho["modelo"]), ("cliente", "claude-code", "modelo-do-fixer"))
        self.assertEqual(despacho["chave_idempotencia"], ID_CONSERTO.replace("-", ""))
        self.assertEqual(self.reservas(), {"conserto:" + ID_CONSERTO: ["fixer"]})
        self.assertEqual(self.fila_estado()["consertos"][ID_CONSERTO]["estado"], "em_curso")
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        (item,) = self.enviar.chamadas[1]["corpo"]["consertos"]
        self.assertEqual((item["id"], item["estado"], item["runId"]), (ID_CONSERTO, "em_curso", "run-1"))
        self.assertEqual(len(self.despachos()), 1)
        self.motor.definir_run("run-1", estado="succeeded", prUrl="https://github.com/dono/cliente/pull/3")
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        (item,) = self.enviar.chamadas[3]["corpo"]["consertos"]
        self.assertEqual((item["estado"], item["prUrl"]), ("com_pr", "https://github.com/dono/cliente/pull/3"))
        self.assertEqual(self.reservas(), {})
        self.enviar.resposta = {"resultado": "gravado", "consertos": []}
        c.ciclo()
        c.ciclo()
        self.assertNotIn("consertos", self.enviar.chamadas[-1]["corpo"])
        self.assertEqual(len(self.despachos()), 1)

    def test_orfaos_nao_soltam_a_vaga_de_conserto_em_curso(self):
        c = self.coordenador()
        for _ in range(3):
            c.ciclo()
            self.instante += datetime.timedelta(minutes=1)
        self.assertEqual(self.reservas(), {"conserto:" + ID_CONSERTO: ["fixer"]})
        self.assertEqual(len(self.despachos()), 1)

    def test_central_desligada_com_conserto_em_curso_ainda_aplica_o_teto_e_solta_a_vaga(self):
        self.coordenador().ciclo()
        self.assertEqual(self.reservas(), {"conserto:" + ID_CONSERTO: ["fixer"]})
        for central in (None, {"url": "http://central.exemplo.com/x", "token_file": "/seg/central"}):
            with self.subTest(central=central):
                c = self.novo(central=central, kit=self.kit)
                c.ciclo()
                self.assertEqual(self.fila_estado()["consertos"][ID_CONSERTO]["estado"], "em_curso")
                self.assertEqual(self.reservas(), {"conserto:" + ID_CONSERTO: ["fixer"]})
        self.instante += datetime.timedelta(hours=1, seconds=1)
        self.novo(central=None, kit=self.kit).ciclo()
        conserto = self.fila_estado()["consertos"][ID_CONSERTO]
        self.assertEqual((conserto["estado"], conserto["motivo"]), ("desistiu", "teto de 1 h"))
        self.assertEqual(self.reservas(), {})
        self.assertEqual(len(self.despachos()), 1)

    def test_coordenador_reiniciado_nao_despacha_de_novo(self):
        self.coordenador().ciclo()
        self.coordenador().ciclo()
        self.assertEqual(len(self.despachos()), 1)

    def test_sem_modelos_fixer_avisa_uma_vez_e_nao_despacha(self):
        (self.kit / "fabrica" / "modelos" / "config.json").write_text(json.dumps({"modelos": {}}), encoding="utf-8")
        c = self.coordenador()
        c.ciclo()
        c.ciclo()
        self.assertEqual(self.despachos(), [])
        self.assertEqual(len([a for a in self.avisos() if "configure modelos.fixer" in a]), 1)

    def test_envio_que_falha_nao_atende_conserto_novo(self):
        self.enviar.falhas = [retrato.FalhaDeEnvio("HTTP 500")]
        self.coordenador().ciclo()
        self.assertEqual(self.despachos(), [])

    def ate_com_pr(self):
        """Um conserto despachado e terminado com PR; o retrato seguinte o traria como `com_pr`."""
        c = self.coordenador()
        c.ciclo()
        self.motor.definir_run("run-1", estado="succeeded", prUrl="https://github.com/dono/cliente/pull/3")
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        self.assertEqual(self.fila_estado()["consertos"][ID_CONSERTO]["estado"], "com_pr")
        return c

    def test_flow_sem_consertos_400_reenvia_sem_o_campo_avisa_uma_vez_e_esquece_os_finais(self):
        c = self.ate_com_pr()
        antigo = FlowSemConsertos()
        c._enviar = antigo
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        self.assertEqual(["consertos" in ch["corpo"] for ch in antigo.chamadas], [True, False])
        self.assertNotIn(ID_CONSERTO, self.fila_estado().get("consertos", {}))
        self.assertIn("enviado", c.status())
        avisos = [a for a in self.avisos() if "sem os consertos" in a]
        self.assertEqual(len(avisos), 1)
        self.instante += datetime.timedelta(minutes=1)
        c.ciclo()
        self.assertEqual(["consertos" in ch["corpo"] for ch in antigo.chamadas], [True, False, False])
        self.assertEqual(len(self.despachos()), 1)

    def test_flow_sem_consertos_com_conserto_em_curso_avisa_uma_vez(self):
        c = self.coordenador()
        c.ciclo()
        antigo = FlowSemConsertos()
        c._enviar = antigo
        for _ in range(3):
            self.instante += datetime.timedelta(minutes=1)
            c.ciclo()
        self.assertEqual(["consertos" in ch["corpo"] for ch in antigo.chamadas], [True, False] * 3)
        self.assertEqual(self.fila_estado()["consertos"][ID_CONSERTO]["estado"], "em_curso")
        self.assertEqual(len([a for a in self.avisos() if "sem os consertos" in a]), 1)
        self.assertEqual(len(self.despachos()), 1)

    def test_400_sem_consertos_no_retrato_nao_reenvia(self):
        self.enviar.resposta = {"resultado": "gravado"}
        self.enviar.falhas = [retrato.FalhaDeEnvio("HTTP 400")]
        c = self.coordenador()
        c.ciclo()
        self.assertEqual(len(self.enviar.chamadas), 1)
        self.assertEqual([a for a in self.avisos() if a.startswith("Central:")], ["Central: envio do retrato falhou (HTTP 400)"])

    def test_fila_json_ilegivel_nao_da_conserto_como_sem_projeto(self):
        (self.raiz / "fila.json").write_text("{quebrado", encoding="utf-8")
        with self.assertRaises(coordenador.ErroDeEntrada):
            self.coordenador().ciclo()
        self.assertEqual(self.despachos(), [])
        self.assertNotIn("consertos", self.fila_estado())

    def test_consertos_tortos_no_fila_estado_nao_quebram_o_ciclo(self):
        (self.raiz / "fila-estado.json").write_text(json.dumps({"fila": [], "consertos": [1], "consertosEncerrados": "x"}), encoding="utf-8")
        self.coordenador().ciclo()
        self.assertEqual(len(self.despachos()), 1)


class PedirFalso:
    """`publicar.pedir` em memória: guarda os pedidos; `falhas` é uma fila de exceções (ou `None` para sucesso)."""

    def __init__(self, *falhas):
        self.chamadas = []
        self.falhas = list(falhas)

    def __call__(self, *, repo, descricao, url, token_file):
        self.chamadas.append({"repo": repo, "descricao": descricao, "url": url, "token_file": token_file})
        falha = self.falhas.pop(0) if self.falhas else None
        if falha is not None:
            raise falha
        return {}


PUBLICACAO = dict(CENTRAL, publicacao_token_file="/seg/publicacao")


class TestesPublicacao(Base):
    def coordenador_com(self, *falhas, central=PUBLICACAO):
        self.pedir = PedirFalso(*falhas)
        return self.novo(central=central, enviar=EnviarFalso(), pedir_publicacao=self.pedir)

    def seeds(self, id_, **seeds):
        estado = self.estado_do_plano(id_)
        estado["seeds"] = {nome: {"estado": situacao} for nome, situacao in seeds.items()}
        self.gravar_estado_do_plano(id_, estado)

    def avisos_de_publicacao(self):
        return [a for a in self.avisos() if a.startswith("Publicação:")]

    def com_seeds(self, **seeds):
        """Plano admitido e com as seeds dadas, ainda não lido pelo passo (sem linha de base)."""
        id_ = self.publicar("login", ["src/login/**"])
        c = self.coordenador_com()
        c.ciclo()
        self.seeds(id_, **seeds)
        dados = self.fila_estado()
        dados.pop("publicacao", None)
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
        return id_, c

    def test_primeira_leitura_grava_linha_de_base_sem_pedir(self):
        id_, c = self.com_seeds(a="mergeada", b="em_andamento")
        c.ciclo()
        self.assertEqual(self.pedir.chamadas, [])
        self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {id_: ["a"]})

    def test_seed_nova_mergeada_pede_uma_vez_e_nao_repete(self):
        id_, c = self.com_seeds(a="mergeada", b="em_andamento")
        c.ciclo()
        self.seeds(id_, a="mergeada", b="mergeada")
        c.ciclo()
        c.ciclo()
        self.assertEqual(
            self.pedir.chamadas,
            [{"repo": REPO, "descricao": "login · b", "url": "https://central.exemplo.com/api/publicacoes", "token_file": "/seg/publicacao"}],
        )
        self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {id_: ["a", "b"]})

    def test_duas_seeds_novas_no_mesmo_ciclo_fazem_um_pedido(self):
        id_, c = self.com_seeds(a="mergeada", b="em_andamento", c="em_andamento")
        c.ciclo()
        self.seeds(id_, a="mergeada", b="mergeada", c="mergeada")
        c.ciclo()
        self.assertEqual(len(self.pedir.chamadas), 1)
        self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {id_: ["a", "b", "c"]})

    def test_falha_no_pedido_tenta_no_ciclo_seguinte_e_avisa_uma_vez(self):
        id_, c = self.com_seeds(a="em_andamento")
        c.ciclo()
        self.seeds(id_, a="mergeada")
        self.pedir.falhas.extend([retrato.FalhaDeEnvio("HTTP 503"), retrato.FalhaDeEnvio("HTTP 503"), None])
        c.ciclo()
        c.ciclo()
        self.assertEqual(len(self.pedir.chamadas), 2)
        self.assertEqual(self.avisos_de_publicacao(), ["Publicação: pedido ao Flow falhou (HTTP 503)"])
        self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {id_: []})
        c.ciclo()
        self.assertEqual(len(self.pedir.chamadas), 3)
        self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {id_: ["a"]})
        self.assertNotIn("publicacao:envio", self.fila_estado()["chaves"])

    def test_recusa_definitiva_marca_como_vista_avisa_uma_vez_e_nao_repete(self):
        for codigo in (404, 409, 422):
            with self.subTest(codigo=codigo):
                id_, c = self.com_seeds(a="em_andamento", b="em_andamento")
                c.ciclo()
                self.seeds(id_, a="mergeada", b="em_andamento")
                self.pedir.falhas.append(retrato.FalhaDeEnvio("HTTP %d" % codigo))
                c.ciclo()
                c.ciclo()
                self.assertEqual(len(self.pedir.chamadas), 1)
                self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {id_: ["a"]})
                recusas = [a for a in self.avisos_de_publicacao() if "HTTP %d" % codigo in a]
                self.assertEqual(len(recusas), 1)
                self.assertIn("recusou", recusas[0])
                self.assertNotIn("publicacao:envio", self.fila_estado()["chaves"])
                self.seeds(id_, a="mergeada", b="mergeada")
                c.ciclo()
                self.assertEqual(len(self.pedir.chamadas), 2)
                self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {id_: ["a", "b"]})

    def test_falha_inesperada_nao_para_o_ciclo(self):
        id_, c = self.com_seeds(a="em_andamento")
        c.ciclo()
        self.seeds(id_, a="mergeada")
        self.pedir.falhas.append(KeyError("fp_segredo"))
        c.ciclo()
        self.assertEqual(self.avisos_de_publicacao(), ["Publicação: pedido ao Flow falhou (falha inesperada (KeyError))"])
        self.assertNotIn("fp_segredo", json.dumps(self.fila_estado()))

    def dois_planos(self):
        a = self.publicar("login", ["src/login/**"])
        b = self.publicar("cobranca", ["src/cobranca/**"])
        c = self.coordenador_com()
        c.ciclo()
        for id_ in (a, b):
            self.seeds(id_, s1="em_andamento")
        c.ciclo()
        for id_ in (a, b):
            self.seeds(id_, s1="mergeada")
        return a, b, c

    def test_primeira_falha_encerra_o_passo_e_o_outro_plano_espera_o_proximo_ciclo(self):
        a, b, c = self.dois_planos()
        self.pedir.falhas.append(retrato.FalhaDeEnvio("timeout"))
        c.ciclo()
        self.assertEqual(len(self.pedir.chamadas), 1)
        self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {a: [], b: []})
        c.ciclo()
        self.assertEqual(len(self.pedir.chamadas), 3)
        self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {a: ["s1"], b: ["s1"]})

    def test_recusa_definitiva_nao_trava_os_outros_planos(self):
        a, b, c = self.dois_planos()
        self.pedir.falhas.append(retrato.FalhaDeEnvio("HTTP 409"))
        c.ciclo()
        self.assertEqual(len(self.pedir.chamadas), 2)
        self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {a: ["s1"], b: ["s1"]})
        c.ciclo()
        self.assertEqual(len(self.pedir.chamadas), 2)

    def test_sucesso_e_gravado_antes_do_proximo_pedido(self):
        a, b, c = self.dois_planos()
        vistos = []
        original = self.pedir.__call__

        def espiar(**kw):
            vistos.append(self.fila_estado().get("publicacao", {}).get("vistas"))
            return original(**kw)

        c._pedir_publicacao = espiar
        c.ciclo()
        self.assertEqual(len(vistos), 2)
        self.assertEqual(sorted(vistos[1].values(), key=len), [[], ["s1"]])

    def test_passo_publicar_nao_pede_publicacao_por_seed_de_plano_de_demanda(self):
        demanda = testes_demandas.ID
        self.demanda_em(demanda, "desenvolvida")
        id_ = self.publicar_da_demanda(demanda, ["src/tela/**"])
        comum = self.publicar("login", ["src/login/**"])
        c = self.coordenador_com()
        c.ciclo()
        self.assertEqual(self.estados(), {id_: "ativo", comum: "ativo"})
        for plano in (id_, comum):
            self.seeds(plano, a="em_andamento")
        c.ciclo()
        for plano in (id_, comum):
            self.seeds(plano, a="mergeada")
        c.ciclo()
        c.ciclo()
        # a demanda pede a publicação uma vez, na entrega; o plano comum segue pedindo por seed
        self.assertEqual([p["descricao"] for p in self.pedir.chamadas], ["login · a"])
        self.assertEqual(self.fila_estado()["publicacao"]["vistas"], {comum: ["a"]})

    def test_sem_token_de_publicacao_o_passo_nao_roda(self):
        id_ = self.publicar("login", ["src/login/**"])
        c = self.coordenador_com(central=CENTRAL)
        c.ciclo()
        self.seeds(id_, a="mergeada")
        c.ciclo()
        c.ciclo()
        self.assertEqual(self.pedir.chamadas, [])
        self.assertNotIn("publicacao", self.fila_estado())

    def test_configuracao_le_o_token_de_publicacao_do_ambiente_e_do_env(self):
        (self.raiz / "coordenador.env").write_text("FABRICA_CENTRAL_URL=https://c.exemplo.com/x\nFABRICA_PUBLICACAO_TOKEN_FILE=/seg/p\n", encoding="utf-8")
        self.assertEqual(coordenador.configuracao_central({}, self.raiz)["publicacao_token_file"], "/seg/p")
        self.assertEqual(coordenador.configuracao_central({"FABRICA_PUBLICACAO_TOKEN_FILE": "/seg/q"}, self.raiz)["publicacao_token_file"], "/seg/q")
        self.assertNotIn("FABRICA_PUBLICACAO_TOKEN_FILE", coordenador.ler_coordenador_env(self.raiz))


class FlowQueFalha(FlowVazio):
    """A busca levanta a exceção dada enquanto `falha` não for `None`."""

    def __init__(self, falha):
        super().__init__()
        self.falha = falha

    def buscar(self, desde):
        if self.falha is not None:
            raise self.falha
        return super().buscar(desde)


class TestesPassoDemandas(Base):
    DEMANDA = testes_demandas.ID
    OUTRA = testes_demandas.OUTRO

    def coordenador_com(self, central=PUBLICACAO, flow=None, **extra):
        self.flow = flow or FlowVazio()
        self.criados = []

        def cliente(url, token_file):
            self.criados.append((url, token_file))
            return self.flow

        self.enviar = EnviarFalso()
        return self.novo(central=central, enviar=self.enviar, cliente_do_flow=cliente, **extra)

    def avisos_de_demandas(self):
        return [a for a in self.avisos() if a.startswith("Demandas:")]

    def test_ciclo_sem_central_nao_roda_demandas(self):
        c = self.coordenador_com(central=None)
        with unittest.mock.patch.object(coordenador.demandas, "passo") as passo, unittest.mock.patch.object(coordenador.demandas, "esvaziar_saida") as esvaziar:
            c.ciclo()
        passo.assert_not_called()
        esvaziar.assert_not_called()
        self.assertEqual(self.criados, [])
        self.assertIn("demandas: desligado", c.status())

    def test_passo_recebe_o_cliente_do_flow_a_publicacao_e_o_estado_do_ciclo(self):
        c = self.coordenador_com(kit=coordenador.KIT_PADRAO)
        with unittest.mock.patch.object(coordenador.demandas, "passo", return_value=[]) as passo:
            c.ciclo()
        self.assertEqual(self.criados, [(CENTRAL["url"], CENTRAL["token_file"])])
        (estado,), argumentos = passo.call_args
        self.assertIs(estado, c.dados)
        self.assertIs(argumentos["cliente"], self.flow)
        self.assertEqual(argumentos["publicacao"], {"url": "https://central.exemplo.com/api/publicacoes", "token_file": "/seg/publicacao"})
        self.assertIs(argumentos["pedir_publicacao"], c._pedir_publicacao)
        self.assertEqual(argumentos["projetos"], {REPO: "cliente"})
        self.assertEqual((argumentos["raiz"], argumentos["capacidade_path"], argumentos["agora"]), (self.raiz, self.raiz / "capacidade.json", INICIO))
        self.assertEqual(argumentos["modelos"]["produto"]["modelo"], "claude-haiku-5-5")  # da config do kit

    def test_sem_token_de_publicacao_o_passo_roda_sem_pedido(self):
        c = self.coordenador_com(central=CENTRAL)
        with unittest.mock.patch.object(coordenador.demandas, "passo", return_value=[]) as passo:
            c.ciclo()
        self.assertIsNone(passo.call_args.kwargs["publicacao"])
        self.assertEqual(passo.call_args.kwargs["modelos"], {})  # kit sem config: cada fase avisa o papel sem modelo

    def test_falha_no_passo_de_demandas_nao_para_o_ciclo_e_o_retrato_vai(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.coordenador_com()
        with unittest.mock.patch.object(coordenador.demandas, "passo", side_effect=RuntimeError("quebrou")), unittest.mock.patch.object(
            coordenador.demandas, "esvaziar_saida", return_value=[]
        ) as esvaziar:
            c.ciclo()
            esvaziar.assert_called_once()  # a caixa de saída vai mesmo com o passo quebrado
            self.instante += datetime.timedelta(minutes=1)
            c.ciclo()
        self.assertEqual(self.estados(), {a: "ativo"})
        self.assertEqual(len(self.enviar.chamadas), 2)
        self.assertEqual(self.avisos_de_demandas(), ["Demandas: o passo falhou (RuntimeError); tento de novo no próximo ciclo"])
        c.ciclo()  # um passo bom esquece o aviso
        self.assertNotIn("demandas:passo", self.fila_estado()["chaves"])

    def test_falha_na_caixa_de_saida_avisa_uma_vez_com_o_passo_bom(self):
        c = self.coordenador_com()
        with unittest.mock.patch.object(coordenador.demandas, "esvaziar_saida", side_effect=KeyError("x")):
            c.ciclo()
            c.ciclo()
        self.assertEqual(self.avisos_de_demandas(), ["Demandas: o envio da caixa de saída falhou (KeyError); tento de novo no próximo ciclo"])
        c.ciclo()
        self.assertNotIn("demandas:saida", self.fila_estado()["chaves"])

    def test_excecao_inesperada_na_busca_ou_no_cliente_nao_para_o_ciclo(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.coordenador_com(flow=FlowQueFalha(ValueError("resposta torta")))
        c.ciclo()
        self.assertEqual(self.estados(), {a: "ativo"})
        self.assertEqual(len(self.enviar.chamadas), 1)
        self.assertEqual(self.avisos_de_demandas(), ["Demandas: o passo falhou (ValueError); tento de novo no próximo ciclo"])

        def quebrado(url, token_file):
            raise OSError("sem rede")

        c = self.novo(central=PUBLICACAO, enviar=self.enviar, cliente_do_flow=quebrado)
        c.ciclo()
        self.assertEqual(len(self.enviar.chamadas), 2)
        self.assertEqual(self.avisos_de_demandas()[-1], "Demandas: o passo falhou (OSError); tento de novo no próximo ciclo")

    def test_avisos_do_passo_saem_uma_vez_por_categoria_e_a_busca_boa_os_esquece(self):
        c = self.coordenador_com(flow=FlowQueFalha(retrato.FalhaDeEnvio("HTTP 503")))
        c.ciclo()
        c.ciclo()
        self.assertEqual(self.avisos_de_demandas(), ["Demandas: a busca no Flow falhou (HTTP 503)"])
        self.flow.falha = None
        c.ciclo()
        self.assertNotIn("demandas:busca", self.fila_estado()["chaves"])
        self.flow.falha = retrato.FalhaDeEnvio("HTTP 503")
        c.ciclo()
        self.assertEqual(len(self.avisos_de_demandas()), 2)

    def test_busca_recusada_401_um_aviso_e_uma_tentativa_a_cada_15_min(self):
        c = self.coordenador_com(flow=FlowQueFalha(retrato.FalhaDeEnvio("HTTP 401")))
        tentativas = []
        buscar = self.flow.buscar
        self.flow.buscar = lambda desde: tentativas.append(desde) or buscar(desde)
        for _ in range(20):
            c.ciclo()
            self.instante += datetime.timedelta(minutes=1)
        self.assertEqual(len(tentativas), 2)  # 12:00 e 12:15
        self.assertEqual(self.avisos_de_demandas(), ["Demandas: o Flow recusou a busca (HTTP 401); tento de novo a cada 15 min"])

    def test_orfaos_nao_soltam_a_vaga_de_desenho_em_curso(self):
        cap = self.raiz / "capacidade.json"
        self.demanda_em(self.DEMANDA, "desenho")
        self.demanda_em(self.OUTRA, "planejada")
        dados = self.fila_estado()
        dados["demandas"]["itens"][self.DEMANDA].update(fase="desenhando", alvo="desenhando", runId="run-9", repo=REPO, inicio="2026-11-03T10:00:00Z")
        dados["demandas"]["itens"][self.OUTRA].update(fase="planejando", alvo="planejando", nonce="a" * 32, repo=REPO, inicio="2026-11-03T10:00:00Z")
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
        self.assertTrue(capacidade.reservar(cap, "demanda:" + self.DEMANDA, "ux-ui", mem_disponivel_mb=None))
        self.assertTrue(capacidade.tomar_orquestrador(cap, REPO, "demanda:" + self.OUTRA))
        self.assertTrue(capacidade.reservar(cap, "plano-sumido", "raia-0", mem_disponivel_mb=None))
        c = self.novo()  # sem a Central o passo de demandas não roda, mas a limpeza conta com ele
        c.ciclo()
        depois = capacidade.ler(cap)
        self.assertEqual(depois["reservas"], {"demanda:" + self.DEMANDA: ["ux-ui"]})
        self.assertEqual(depois["orquestrador"], {REPO: "demanda:" + self.OUTRA})

    def presas(self, inicio):
        """Uma demanda desenhando (vaga) e outra planejando (trava do repositório), as duas desde `inicio`."""
        cap = self.raiz / "capacidade.json"
        self.demanda_em(self.DEMANDA, "desenho")
        self.demanda_em(self.OUTRA, "planejada")
        dados = self.fila_estado()
        dados["demandas"]["itens"][self.DEMANDA].update(fase="desenhando", alvo="desenhando", runId="run-9", repo=REPO, inicio=inicio)
        dados["demandas"]["itens"][self.OUTRA].update(fase="planejando", alvo="planejando", nonce="a" * 32, repo=REPO, inicio=inicio)
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
        self.assertTrue(capacidade.reservar(cap, "demanda:" + self.DEMANDA, "ux-ui", mem_disponivel_mb=None))
        self.assertTrue(capacidade.tomar_orquestrador(cap, REPO, "demanda:" + self.OUTRA))
        return cap

    def conferir_soltas(self, cap):
        depois = capacidade.ler(cap)
        self.assertEqual((depois["reservas"], depois["orquestrador"]), ({}, {}))
        avisos = [a for a in self.avisos_de_demandas() if "passou do teto" in a]
        self.assertEqual(
            avisos,
            [
                "Demandas: a demanda %s (desenhando desde 2026-11-03T09:29:00Z) passou do teto da fase sem o passo das demandas a acompanhar; a trava e a vaga dela foram soltas" % self.DEMANDA[:8],
                "Demandas: a demanda %s (planejando desde 2026-11-03T09:29:00Z) passou do teto da fase sem o passo das demandas a acompanhar; a trava e a vaga dela foram soltas" % self.OUTRA[:8],
            ],
        )

    def test_flow_sem_a_rota_no_meio_da_demanda_devolve_a_vaga_e_a_trava_no_teto(self):
        # 2 h 31 min antes do ciclo: passou do teto (2 h) + a folga (30 min); o Flow voltou para antes das demandas
        cap = self.presas("2026-11-03T09:29:00Z")

        class Flow404(FlowVazio):
            def buscar(self, desde):
                return None

        c = self.coordenador_com(flow=Flow404())
        c.ciclo()
        self.conferir_soltas(cap)
        c.ciclo()  # um aviso por vencimento
        self.assertEqual(len([a for a in self.avisos_de_demandas() if "passou do teto" in a]), 2)

    def test_passo_que_levanta_todo_ciclo_devolve_a_vaga_e_a_trava_no_teto(self):
        cap = self.presas("2026-11-03T09:31:00Z")  # ainda no prazo: nada sai
        c = self.coordenador_com()
        with unittest.mock.patch.object(coordenador.demandas, "passo", side_effect=RuntimeError("quebrou")):
            c.ciclo()
            self.assertEqual(capacidade.ler(cap)["reservas"], {"demanda:" + self.DEMANDA: ["ux-ui"]})
            self.instante += datetime.timedelta(minutes=2)
            dados = self.fila_estado()
            for id_ in (self.DEMANDA, self.OUTRA):
                dados["demandas"]["itens"][id_]["inicio"] = "2026-11-03T09:29:00Z"
            (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
            c.ciclo()
        self.conferir_soltas(cap)
        # a trava voltou: um plano comum do mesmo repositório toma o orquestrador
        self.assertTrue(capacidade.tomar_orquestrador(cap, REPO, "plano-comum"))

    def test_status_mostra_as_demandas_em_curso(self):
        self.demanda_em(self.DEMANDA, "desenho", espera="aprovar_desenho")
        self.demanda_em(self.OUTRA, "planejada")
        dados = self.fila_estado()
        dados["demandas"]["cursor"] = "42"
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
        self.assertIn("demandas: 2 em curso (1 esperando o Paulo), cursor 42", coordenador.status(self.raiz, CENTRAL))
        self.assertIn("demandas: desligado", coordenador.status(self.raiz, None))
        dados["demandas"]["semRotaEm"] = "2026-11-03T12:00:00Z"
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
        self.assertIn("demandas: Flow sem a rota", coordenador.status(self.raiz, CENTRAL))

    def test_soltar_plano_segurado_pela_demanda_recusa_e_diz_como_tirar(self):
        self.demanda_em(self.DEMANDA, "desenho")
        id_ = self.publicar_da_demanda(self.DEMANDA, ["src/tela/**"])
        c = self.novo()
        c.ciclo()
        self.assertIn("%s: aguardando (segurado pela demanda %s)" % (id_, self.DEMANDA[:8]), c.status())
        mensagem = (
            "pedido soltar de %s recusado: o plano espera a demanda %s chegar ao desenvolvimento (aprove o desenho ou "
            "conclua a etapa no Flow); para tirá-lo da fila, coordenador.py remover %s" % (id_, self.DEMANDA[:8], id_)
        )
        with self.assertRaises(coordenador.ErroDeEntrada) as erro:
            c.pedir("soltar", id_)
        self.assertEqual(erro.exception.erros, [mensagem])
        # um pedido que já estava na caixa também é recusado, com o mesmo texto
        despachante.enfileirar_pedido(self.raiz, {"comando": "soltar", "id": id_})
        c.ciclo()
        entrada = [e for e in self.fila_estado()["fila"] if e["id"] == id_][-1]
        self.assertEqual((entrada["segurado"], entrada["seguradoPor"]), (True, "demanda"))
        self.assertIn(mensagem, self.avisos())


class TestesAtendente(Base):
    CONVERSA = testes_atendente.CONVERSA
    MENSAGEM = testes_atendente.MENSAGEM

    def coordenador_com(self, *, cliente=None, central=CENTRAL, **extra):
        self.cliente = cliente or testes_atendente.ClienteFalso()
        self.criados = []

        def fabrica(url, token_file):
            self.criados.append((url, token_file))
            return self.cliente

        self.enviar = EnviarFalso()
        extra.setdefault("kit", coordenador.KIT_PADRAO)
        return self.novo(central=central, enviar=self.enviar, cliente_das_conversas=fabrica, **extra)

    def conversa(self, **extra):
        return testes_atendente.conversa(repositorio=REPO, **extra)

    def avisos_do_atendente(self):
        return [a for a in self.avisos() if a.startswith("Atendente:")]

    def test_ciclo_sem_central_nao_roda_o_atendente(self):
        c = self.coordenador_com(central=None)
        dormidas = []
        with unittest.mock.patch.object(coordenador.atendente, "passo") as passo:
            c.ciclo()
            c._esperar(60, dormidas.append)
        passo.assert_not_called()
        self.assertEqual(self.criados, [])
        self.assertEqual(dormidas, [60])
        self.assertIn("atendente: desligado", c.status())

    def test_passo_recebe_cliente_projetos_modelos_e_roda_depois_das_demandas(self):
        ordem = []
        c = self.coordenador_com()
        with unittest.mock.patch.object(coordenador.demandas, "passo", side_effect=lambda *a, **k: ordem.append("demandas") or []), unittest.mock.patch.object(
            coordenador.atendente, "passo", side_effect=lambda *a, **k: ordem.append("atendente") or []
        ) as passo, unittest.mock.patch.object(coordenador.capacidade, "mem_disponivel_mb", return_value=4096):
            c.ciclo()
        self.assertEqual(ordem, ["demandas", "atendente"])
        self.assertEqual(self.criados, [(CENTRAL["url"], CENTRAL["token_file"])])
        (estado,), argumentos = passo.call_args
        self.assertIs(estado, c.dados)
        self.assertIs(argumentos["cliente"], self.cliente)
        self.assertIs(argumentos["motor"], self.motor)
        self.assertEqual(argumentos["projetos"], {REPO: "cliente"})
        self.assertEqual(argumentos["modelos"]["atendente"], {"agente": "claude-code", "modelo": "claude-sonnet-5-5", "esforco": "medium", "maxCustoUsd": 2})
        self.assertEqual((argumentos["capacidade_path"], argumentos["agora"], argumentos["mem_disponivel_mb"]), (self.raiz / "capacidade.json", INICIO, 4096))
        self.assertIs(argumentos["salvar"].__self__, c)

    def test_falha_no_atendente_nao_para_o_ciclo_e_o_retrato_vai(self):
        a = self.publicar("login", ["src/login/**"])
        c = self.coordenador_com()
        with unittest.mock.patch.object(coordenador.atendente, "passo", side_effect=RuntimeError("quebrou")):
            c.ciclo()
            self.instante += datetime.timedelta(minutes=1)
            c.ciclo()
        self.assertEqual(self.estados(), {a: "ativo"})
        self.assertEqual(len(self.enviar.chamadas), 2)

        def quebrado(url, token_file):
            raise OSError("sem rede")

        c = self.novo(central=CENTRAL, enviar=self.enviar, cliente_das_conversas=quebrado)
        c.ciclo()
        c._passo_atendente()  # entre ciclos também não levanta
        self.assertEqual(len(self.enviar.chamadas), 3)
        log = (self.raiz / "log.jsonl").read_text(encoding="utf-8")
        self.assertIn("RuntimeError: quebrou", log)
        self.assertIn("OSError: sem rede", log)
        self.assertEqual(self.estados(), {a: "ativo"})

    def test_eventos_do_atendente_vao_ao_log_e_o_estado_e_salvo(self):
        cliente = testes_atendente.ClienteFalso([testes_atendente.busca(self.conversa())])
        c = self.coordenador_com(cliente=cliente)
        with unittest.mock.patch.object(coordenador.capacidade, "mem_disponivel_mb", return_value=None):
            c.ciclo()
        atual = self.fila_estado()["atendente"]["atual"]
        self.assertEqual((atual["conversaId"], atual["fase"]), (self.CONVERSA, "respondendo"))
        self.assertIn('"evento": "atendente_run"', (self.raiz / "log.jsonl").read_text(encoding="utf-8"))
        self.assertEqual(self.fila_estado()["fila"], [])  # a fila não muda

    def test_aviso_de_memoria_volta_num_segundo_episodio(self):
        T = testes_atendente
        conversa = self.conversa()
        cliente = T.ClienteFalso([T.busca(conversa), T.busca(conversa), T.busca(conversa)])
        c = self.coordenador_com(cliente=cliente)
        with unittest.mock.patch.object(coordenador.capacidade, "mem_disponivel_mb", return_value=10):
            c.ciclo()
            c._passo_atendente()
        self.assertEqual(self.avisos_do_atendente(), [atendente.AVISO_MEMORIA])
        with unittest.mock.patch.object(coordenador.capacidade, "mem_disponivel_mb", return_value=None):
            c._passo_atendente()  # a memória voltou: despacha e o aviso sai das chaves
        self.assertNotIn("atendente:memoria", self.fila_estado()["chaves"])
        run_id = self.fila_estado()["atendente"]["atual"]["runId"]
        self.motor.definir_run(run_id, estado="succeeded")
        self.motor.definir_texto(run_id, T.resposta())
        c._passo_atendente()
        self.assertIsNone(self.fila_estado()["atendente"]["atual"])
        cliente.buscas = [T.busca(T.conversa(responder_a=T.NOVA, repositorio=REPO))]
        with unittest.mock.patch.object(coordenador.capacidade, "mem_disponivel_mb", return_value=10):
            c._passo_atendente()
        self.assertEqual(self.avisos_do_atendente(), [atendente.AVISO_MEMORIA, atendente.AVISO_MEMORIA])

    def test_avisos_de_modelo_e_drenagem_somem_quando_a_situacao_some(self):
        T = testes_atendente
        conversa = self.conversa()
        cliente = T.ClienteFalso([T.busca(conversa)] * 4)
        c = self.coordenador_com(cliente=cliente, kit=pathlib.Path("/kit"))
        with unittest.mock.patch.object(coordenador.capacidade, "mem_disponivel_mb", return_value=None):
            c._config = coordenador.ler_config(self.raiz)
            c._passo_atendente()
            self.assertIn("atendente:modelo", self.fila_estado()["chaves"])
            c.kit = coordenador.KIT_PADRAO
            capacidade.definir_drenagem(self.raiz / "capacidade.json", "2026-11-03T12:00:00Z")
            c._passo_atendente()
            self.assertNotIn("atendente:modelo", self.fila_estado()["chaves"])
            self.assertIn("atendente:drenagem", self.fila_estado()["chaves"])
            capacidade.definir_drenagem(self.raiz / "capacidade.json", None)
            c._passo_atendente()
        self.assertNotIn("atendente:drenagem", self.fila_estado()["chaves"])
        self.assertEqual(self.avisos_do_atendente(), [atendente.AVISO_SEM_MODELO, atendente.AVISO_DRENAGEM])

    def test_aviso_de_envio_some_depois_do_envio_bom_e_volta_noutro_episodio(self):
        T = testes_atendente
        falha = retrato.FalhaDeEnvio("HTTP 503")
        limite = atendente.LIMITE_FALHAS_DE_ENVIO
        cliente = T.ClienteFalso([T.busca(self.conversa()), T.busca(self.conversa(responder_a=T.NOVA))], [falha] * limite + ["aplicado"] + [falha] * limite)
        c = self.coordenador_com(cliente=cliente)
        with unittest.mock.patch.object(coordenador.capacidade, "mem_disponivel_mb", return_value=None):
            c.ciclo()
            for responder_a in (T.MENSAGEM, T.NOVA):
                run_id = self.fila_estado()["atendente"]["atual"]["runId"]
                self.motor.definir_run(run_id, estado="succeeded")
                self.motor.definir_texto(run_id, T.resposta())
                for _ in range(limite):
                    c._passo_atendente()
                self.assertIn("atendente:envio", self.fila_estado()["chaves"], responder_a)
                c._passo_atendente()  # envio bom (1º episódio) ou busca da próxima (2º)
                if responder_a == T.MENSAGEM:
                    self.assertNotIn("atendente:envio", self.fila_estado()["chaves"])
                    c._passo_atendente()  # busca a mensagem nova
        envio = [a for a in self.avisos_do_atendente() if "não chega" in a]
        self.assertEqual(len(envio), 2)

    def test_esperar_com_conversa_ativa_roda_o_atendente_a_cada_3_s_dentro_do_intervalo(self):
        c = self.coordenador_com()
        c.dados["atendente"] = {"atual": None, "ativaAte": "2026-11-03T12:10:00Z"}
        dormidas = []
        with unittest.mock.patch.object(c, "_passo_atendente") as passo, unittest.mock.patch.object(coordenador.demandas, "passo") as demandas_:
            c._esperar(60, dormidas.append)
        self.assertEqual(dormidas, [3] * 20)
        self.assertEqual(passo.call_count, 20)
        demandas_.assert_not_called()
        self.assertEqual(self.enviar.chamadas, [])  # entre ciclos só o atendente roda

    def test_esperar_dorme_o_resto_de_uma_vez_quando_a_conversa_deixa_de_ser_ativa(self):
        c = self.coordenador_com()
        c.dados["atendente"] = {"atual": None, "ativaAte": "2026-11-03T12:10:00Z"}
        dormidas = []

        def passo():
            if len(dormidas) == 2:
                c.dados["atendente"]["ativaAte"] = None

        with unittest.mock.patch.object(c, "_passo_atendente", side_effect=passo):
            c._esperar(60, dormidas.append)
        self.assertEqual(dormidas, [3, 3, 54])

    def test_esperar_para_no_intervalo_pelo_relogio_quando_o_passo_demora(self):
        c = self.coordenador_com()
        c.dados["atendente"] = {"atual": None, "ativaAte": "2026-11-03T12:10:00Z"}
        dormidas, relogio = [], [0.0]

        def passo():
            relogio[0] += 25  # um envio lento ao Flow

        with unittest.mock.patch.object(c, "_passo_atendente", side_effect=passo):
            c._esperar(60, lambda s: (dormidas.append(s), relogio.__setitem__(0, relogio[0] + s)), relogio=lambda: relogio[0])
        self.assertEqual(sum(dormidas) + 25 * len(dormidas), 84)  # 3 + 25 + 3 + 25 + 3 + 25: passa do intervalo e o ciclo vem
        self.assertEqual(dormidas, [3, 3, 3])

    def test_esperar_sem_conversa_dorme_o_intervalo_de_uma_vez(self):
        c = self.coordenador_com()
        c.dados["atendente"] = {"atual": None, "ativaAte": "2026-11-03T11:00:00Z"}  # já passou
        dormidas = []
        with unittest.mock.patch.object(c, "_passo_atendente") as passo:
            c._esperar(60, dormidas.append)
        self.assertEqual(dormidas, [60])
        passo.assert_not_called()

    def test_rodar_consulta_entre_ciclos_e_os_outros_passos_rodam_todo_ciclo(self):
        T = testes_atendente
        cliente = T.ClienteFalso([T.busca(ate="2026-11-03T12:10:00Z")] * 100)
        c = self.coordenador_com(cliente=cliente)
        dormidas = []
        with unittest.mock.patch.object(coordenador.demandas, "passo", return_value=[]) as demandas_:
            c.rodar(intervalo=60, ciclos=3, dormir=dormidas.append)
        self.assertEqual(dormidas, [3] * 40)
        self.assertEqual(cliente.buscados, 3 + 40)
        self.assertEqual(demandas_.call_count, 3)
        self.assertEqual(len(self.enviar.chamadas), 3)

    def test_status_mostra_a_linha_do_atendente(self):
        self.assertIn("atendente: desligado", coordenador.status(self.raiz))
        c = self.coordenador_com()
        c.ciclo()
        self.assertIn("atendente: ocioso", c.status())
        dados = self.fila_estado()
        dados["atendente"] = {"atual": None, "semRotaEm": "2026-11-03T12:00:00Z"}
        (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
        self.assertIn("atendente: Flow sem o Decidir (tenta de novo 1 h depois de 2026-11-03T12:00:00Z)", c.status())
        cliente = testes_atendente.ClienteFalso([testes_atendente.busca(self.conversa())])
        c = self.coordenador_com(cliente=cliente)
        with unittest.mock.patch.object(coordenador.capacidade, "mem_disponivel_mb", return_value=None):
            dados["atendente"] = {}
            (self.raiz / "fila-estado.json").write_text(json.dumps(dados), encoding="utf-8")
            c.ciclo()
        self.assertIn("atendente: conversa %s, respondendo (tentativa 0)" % self.CONVERSA[:8], c.status())


class TestesConfiguracaoDaCentral(Base):
    def test_sem_url_e_desligado(self):
        self.assertIsNone(coordenador.configuracao_central({}, self.raiz))
        self.assertIsNone(coordenador.configuracao_central({"FABRICA_CENTRAL_TOKEN_FILE": "/seg/c"}, self.raiz))

    def test_le_do_ambiente_e_do_coordenador_env_e_o_ambiente_vale_mais(self):
        (self.raiz / "coordenador.env").write_text(
            "FABRICA_CENTRAL_URL=\"https://central.exemplo.com/x\"\nFABRICA_CENTRAL_TOKEN_FILE=/seg/central\nGH_TOKEN_FILE=/seg/gh\n", encoding="utf-8"
        )
        self.assertEqual(coordenador.configuracao_central({}, self.raiz), {"url": "https://central.exemplo.com/x", "token_file": "/seg/central"})
        self.assertEqual(
            coordenador.configuracao_central({"FABRICA_CENTRAL_URL": "http://127.0.0.1:13000/x"}, self.raiz),
            {"url": "http://127.0.0.1:13000/x", "token_file": "/seg/central"},
        )

    def test_coordenador_env_ilegivel_nao_levanta(self):
        (self.raiz / "coordenador.env").write_bytes(b"\xff\xfe")
        self.assertIsNone(coordenador.configuracao_central({}, self.raiz))
        self.assertEqual(coordenador.configuracao_central({"FABRICA_CENTRAL_URL": "https://c.exemplo.com/x"}, self.raiz)["url"], "https://c.exemplo.com/x")

    def test_ler_coordenador_env_continua_so_com_as_tres_de_hoje(self):
        (self.raiz / "coordenador.env").write_text(
            "WARREN_API=http://127.0.0.1:8080\nFABRICA_CENTRAL_URL=https://c.exemplo.com/x\nFABRICA_CENTRAL_TOKEN_FILE=/seg/c\n", encoding="utf-8"
        )
        self.assertEqual(coordenador.ler_coordenador_env(self.raiz), {"WARREN_API": "http://127.0.0.1:8080"})
        self.assertEqual(coordenador.VARIAVEIS_REPASSADAS, ("WARREN_API", "WARREN_TOKEN_FILE", "GH_TOKEN_FILE"))

    def test_status_pela_cli_le_o_coordenador_env_sem_o_ambiente_da_unit(self):
        def status():
            saida = io.StringIO()
            codigo = coordenador.main(["--raiz", str(self.raiz), "status"], ambiente={}, saida=saida, erro=io.StringIO())
            self.assertEqual(codigo, 0)
            return saida.getvalue()

        self.assertIn("envio à Central: desligado", status())
        (self.raiz / "coordenador.env").write_text("FABRICA_CENTRAL_URL=https://c.exemplo.com/x\nFABRICA_CENTRAL_TOKEN_FILE=/seg/c\n", encoding="utf-8")
        self.assertIn("envio à Central: ligado", status())

    def test_construir_passa_a_central_ao_coordenador(self):
        (self.raiz / "t-warren").write_text("w" * 20, encoding="utf-8")
        (self.raiz / "t-gh").write_text("g" * 20, encoding="utf-8")
        ambiente = {
            "WARREN_TOKEN_FILE": str(self.raiz / "t-warren"),
            "GH_TOKEN_FILE": str(self.raiz / "t-gh"),
            "FABRICA_CENTRAL_URL": "https://c.exemplo.com/x",
            "FABRICA_CENTRAL_TOKEN_FILE": "/seg/c",
        }
        c = coordenador.construir(ambiente, self.raiz)
        self.assertEqual(c.central, {"url": "https://c.exemplo.com/x", "token_file": "/seg/c"})
        self.assertNotIn("FABRICA_CENTRAL_URL", c.ambiente)


class TestesMain(Base):
    def rodar(self, *argv, construir=None):
        saida, erro = io.StringIO(), io.StringIO()

        def construir_falso(ambiente, raiz):
            return self.novo()

        codigo = coordenador.main(
            ["--raiz", str(self.raiz), *argv], ambiente={}, construir=construir or construir_falso, saida=saida, erro=erro, dormir=lambda s: None
        )
        return codigo, saida.getvalue(), erro.getvalue()

    def test_cli_le_o_coordenador_env_e_o_ambiente_vale_mais(self):
        # final M3: registrar (e status/vagas) rodam na shell, sem o EnvironmentFile da unit
        (self.raiz / "coordenador.env").write_text(
            "# tokens fora do padrão\nWARREN_API=http://127.0.0.1:9090\nWARREN_TOKEN_FILE=/seg/w\nGH_TOKEN_FILE=\"/seg/g\"\nOUTRA=1\n",
            encoding="utf-8",
        )
        vistos = []

        def construir(ambiente, raiz):
            vistos.append(dict(ambiente))
            raise coordenador.ErroDeEntrada(["parou aqui"])

        for ambiente in ({}, {"GH_TOKEN_FILE": "/do/processo"}):
            coordenador.main(["--raiz", str(self.raiz), "registrar", REPO], ambiente=ambiente, construir=construir, saida=io.StringIO(), erro=io.StringIO())
        self.assertEqual(vistos[0], {"WARREN_API": "http://127.0.0.1:9090", "WARREN_TOKEN_FILE": "/seg/w", "GH_TOKEN_FILE": "/seg/g"})
        self.assertEqual(vistos[1]["GH_TOKEN_FILE"], "/do/processo")
        self.assertEqual(vistos[1]["WARREN_TOKEN_FILE"], "/seg/w")
        for comando in (["status"], ["vagas", "2"]):
            self.assertEqual(coordenador.main(["--raiz", str(self.raiz), *comando], ambiente={}, saida=io.StringIO(), erro=io.StringIO()), 0)

    def test_segurar_pela_cli_grava_pedido_e_id_desconhecido_sai_com_2(self):
        self.publicar("login", ["src/x/**"])
        self.publicar("cobranca", ["src/x/**"])
        c = self.novo()
        c.ciclo()
        aguardando = [i for i, e in self.estados().items() if e == "aguardando"][0]
        codigo, saida, _ = self.rodar("segurar", aguardando)
        self.assertEqual(codigo, 0)
        self.assertIn("gravado", saida)
        self.assertEqual(len(list((self.raiz / "entrada").glob("*.json"))), 1)
        codigo, _, erro = self.rodar("segurar", "nao-existe")
        self.assertEqual(codigo, 2)
        self.assertTrue(erro)

    def test_remover_pela_cli_exige_manter_arquivo_com_o_arquivo_presente(self):
        a = self.publicar("login", ["src/x/**"])
        self.novo().ciclo()
        codigo, _, erro = self.rodar("remover", a)
        self.assertEqual(codigo, 2)
        self.assertIn("--manter-arquivo", erro)
        self.assertEqual(list((self.raiz / "entrada").glob("*.json")) if (self.raiz / "entrada").exists() else [], [])
        codigo, saida, _ = self.rodar("remover", a, "--manter-arquivo", "--simular")
        self.assertEqual(codigo, 0)
        self.assertIn(self.unit(a), saida)
        self.assertFalse((self.raiz / "entrada").exists())
        codigo, saida, _ = self.rodar("remover", a, "--manter-arquivo")
        self.assertEqual(codigo, 0)
        self.assertIn("gravado", saida)
        self.assertEqual(len(list((self.raiz / "entrada").glob("*.json"))), 1)

    def test_ler_coordenador_env(self):
        self.assertEqual(coordenador.ler_coordenador_env(self.raiz), {})
        (self.raiz / "coordenador.env").write_text(
            "  # comentário\n\nWARREN_TOKEN_FILE = $HOME/w\nGH_TOKEN_FILE='~/g'\nWARREN_API=\nlixo\nPATH=/x\n", encoding="utf-8"
        )
        self.assertEqual(coordenador.ler_coordenador_env(self.raiz), {"WARREN_TOKEN_FILE": "$HOME/w", "GH_TOKEN_FILE": "~/g"})
        (self.raiz / "coordenador.env").write_bytes(b"\xff\xfe")
        with self.assertRaises(coordenador.ErroDeEntrada):
            coordenador.ler_coordenador_env(self.raiz)

    def test_fila_json_corrompido_sai_com_2(self):
        (self.raiz / "fila.json").write_text("{ruim", encoding="utf-8")
        codigo, _, erro = self.rodar("rodar", "--ciclos", "1")
        self.assertEqual(codigo, 2)
        self.assertIn("fila.json", erro)

    def test_fila_json_com_repo_torto_sai_com_2(self):
        for ruim in ({"repos": [{"repo": "x", "projeto": "p"}]}, {"repos": [{"repo": REPO}]}, {"repos": "x"}, []):
            with self.subTest(ruim=ruim):
                self.escrever_fila(ruim)
                self.assertEqual(self.rodar("rodar", "--ciclos", "1")[0], 2)

    def test_fila_json_ausente_sai_com_2(self):
        (self.raiz / "fila.json").unlink()
        self.assertEqual(self.rodar("rodar", "--ciclos", "1")[0], 2)

    def test_tokens_ausentes_saem_com_2(self):
        ambiente = {"WARREN_TOKEN_FILE": str(self.raiz / "nao-existe"), "GH_TOKEN_FILE": str(self.raiz / "nao-existe")}
        erro = io.StringIO()
        codigo = coordenador.main(["--raiz", str(self.raiz), "rodar", "--ciclos", "1"], ambiente=ambiente, saida=io.StringIO(), erro=erro)
        self.assertEqual(codigo, 2)
        self.assertIn("token", erro.getvalue())

    def test_trava_tomada_sai_com_3(self):
        with coordenador.travar(self.raiz):
            codigo, _, erro = self.rodar("rodar", "--ciclos", "1")
        self.assertEqual(codigo, 3)
        self.assertIn("outro coordenador", erro)

    def test_rodar_faz_os_ciclos_e_erro_num_ciclo_nao_para_o_laco(self):
        a = self.publicar("login", ["src/login/**"])
        quebras = []

        class Quebra(forja.ForjaFalsa):
            def branch_padrao(self, repo):
                quebras.append(repo)
                if len(quebras) == 1:
                    raise RuntimeError("GitHub fora")
                return "main"

        quebra = Quebra()
        quebra._arquivos = self.forja._arquivos
        codigo, _, _ = self.rodar("rodar", "--ciclos", "2", construir=lambda ambiente, raiz: self.novo(forja=quebra))
        self.assertEqual(codigo, 0)
        self.assertEqual(self.estados()[a], "ativo")

    def test_erro_inesperado_no_ciclo_vai_para_o_log_e_o_laco_segue(self):
        c = self.novo()
        chamadas = []

        def ciclo():
            chamadas.append(1)
            raise RuntimeError("inesperado %s" % TOKEN)

        c.ciclo = ciclo
        codigo, _, _ = self.rodar("rodar", "--ciclos", "3", construir=lambda ambiente, raiz: c)
        self.assertEqual(codigo, 0)
        self.assertEqual(len(chamadas), 3)
        log = (self.raiz / "log.jsonl").read_text(encoding="utf-8")
        self.assertEqual(log.count("erro_no_ciclo"), 1)  # rodada 1, item 5: só quando a mensagem muda
        self.assertNotIn(TOKEN, log)

    def test_erro_no_ciclo_registra_de_novo_quando_a_mensagem_muda(self):
        c = self.novo()
        mensagens = iter(["a", "a", "b", "b", "a"])

        def ciclo():
            raise RuntimeError(next(mensagens))

        c.ciclo = ciclo
        self.rodar("rodar", "--ciclos", "5", construir=lambda ambiente, raiz: c)
        linhas = [json.loads(x) for x in (self.raiz / "log.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual([x["erro"] for x in linhas if x.get("evento") == "erro_no_ciclo"], ["RuntimeError: a", "RuntimeError: b", "RuntimeError: a"])

    def test_fila_json_ilegivel_no_meio_sai_com_2_e_solta_a_drenagem(self):
        self.preparar = PrepararFalso(ESPERANDO)
        c = self.novo()

        def dormir(_):
            if self.drenagem_atual():
                (self.raiz / "fila.json").write_text("{ruim", encoding="utf-8")

        erro = io.StringIO()
        codigo = coordenador.main(
            ["--raiz", str(self.raiz), "rodar", "--ciclos", "10"], ambiente={}, construir=lambda ambiente, raiz: c, saida=io.StringIO(), erro=erro, dormir=dormir
        )
        self.assertEqual(codigo, 2)
        self.assertIn("fila.json", erro.getvalue())
        self.assertIsNone(self.drenagem_atual())

    def drenagem_atual(self):
        return capacidade.ler(self.raiz / "capacidade.json")["drenagem"]

    def test_vagas_limpa_o_oom(self):
        cap = self.raiz / "capacidade.json"
        capacidade.configurar(cap, vagas=3, ram_minima_mb=1024)
        capacidade.registrar_oom(cap, "2026-11-03T12:00:00Z")
        self.assertEqual(capacidade.vagas_efetivas(capacidade.ler(cap)), 2)
        codigo, saida, _ = self.rodar("vagas", "3")
        self.assertEqual(codigo, 0)
        dados = capacidade.ler(cap)
        self.assertIsNone(dados["oomEm"])
        self.assertEqual(dados["vagasConfig"], 3)
        self.assertEqual(dados["ramMinimaMb"], 1024)
        self.assertIn("3", saida)

    def test_vagas_com_ram_minima(self):
        codigo, _, _ = self.rodar("vagas", "4", "--ram-minima-mb", "3000")
        self.assertEqual(codigo, 0)
        dados = capacidade.ler(self.raiz / "capacidade.json")
        self.assertEqual((dados["vagasConfig"], dados["ramMinimaMb"]), (4, 3000))

    def test_vagas_invalidas_saem_com_2(self):
        self.assertEqual(self.rodar("vagas", "0")[0], 2)
        self.assertEqual(self.rodar("vagas", "2", "--ram-minima-mb", "-1")[0], 2)

    def test_registrar_pela_cli(self):
        self.escrever_fila({"repos": []})
        self.motor.definir_projeto("flow", "https://github.com/dono/cliente.git")
        codigo, saida, _ = self.rodar("registrar", REPO)
        self.assertEqual(codigo, 0)
        self.assertIn(REPO, saida)
        codigo, _, erro = self.rodar("registrar", OUTRO)
        self.assertEqual(codigo, 2)
        self.assertIn("crie o projeto no Warren", erro)

    def test_status_pela_cli(self):
        codigo, saida, _ = self.rodar("status")
        self.assertEqual(codigo, 0)
        self.assertIn("fila vazia", saida)

    def test_construir_real_le_os_tokens_dos_arquivos(self):
        warren = self.raiz / "w"
        gh = self.raiz / "g"
        warren.write_text(TOKEN + "\n", encoding="utf-8")
        gh.write_text("gh-token-de-teste-456\n", encoding="utf-8")
        c = coordenador.construir({"WARREN_TOKEN_FILE": str(warren), "GH_TOKEN_FILE": str(gh)}, self.raiz)
        self.assertIsInstance(c, coordenador.Coordenador)
        self.assertIn(TOKEN, c._segredos)
        self.assertEqual(c.ambiente, {"WARREN_TOKEN_FILE": str(warren), "GH_TOKEN_FILE": str(gh)})


class TestesClone(unittest.TestCase):
    """Rodada 1, item 3: o clone autentica por um credential.helper local que lê GH_TOKEN_FILE; só o caminho fica gravado."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = pathlib.Path(self._tmp.name)
        self.token = self.tmp / "segredos" / "gh-token"
        self.token.parent.mkdir()
        self.token.write_text("ghp_tokenDeTesteMuitoSecreto99\n", encoding="utf-8")
        self.chamadas = []

    def gravar(self, argv, **kw):
        self.chamadas.append(list(argv))
        env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
        return subprocess.run(argv, env=env, **kw)

    @unittest.skipUnless(shutil.which("git"), "sem git")
    def test_clone_grava_o_helper_so_com_o_caminho_e_o_helper_entrega_o_token(self):
        remoto = self.tmp / "remoto" / "dono" / "cliente.git"
        subprocess.run(["git", "init", "--quiet", "--bare", str(remoto)], check=True)
        destino = self.tmp / "planos" / "p" / "repo"
        destino.parent.mkdir(parents=True)
        coordenador._clonar("dono/cliente", destino, token_file=str(self.token), base="file://%s/" % (self.tmp / "remoto"), rodar=self.gravar)
        self.assertTrue((destino / ".git").is_dir())
        self.assertIn(["git", "clone", "--quiet"], [c[:3] for c in self.chamadas])
        clone = next(c for c in self.chamadas if c[:2] == ["git", "clone"])
        self.assertIn("file://%s/dono/cliente.git" % (self.tmp / "remoto"), clone)
        self.assertIn("credential.helper=", clone)  # o vazio zera os helpers globais durante o clone
        # final M5: o helper só responde ao github.com
        self.assertTrue([x for x in clone if x.startswith("credential.https://github.com.helper=!f()")])
        self.assertFalse([x for x in clone if x.startswith("credential.helper=!f()")])
        segredo = self.token.read_text(encoding="utf-8").strip()
        for argv in self.chamadas:
            self.assertNotIn(segredo, " ".join(argv))
        config = (destino / ".git" / "config").read_text(encoding="utf-8")
        self.assertNotIn(segredo, config)
        self.assertIn(str(self.token), config)
        self.assertIn("x-access-token", config)
        saida = self.gravar(
            ["git", "-C", str(destino), "credential", "fill"], input="protocol=https\nhost=github.com\n\n", capture_output=True, text=True
        )
        self.assertEqual(saida.returncode, 0, saida.stderr)
        self.assertIn("username=x-access-token", saida.stdout)
        self.assertIn("password=%s" % segredo, saida.stdout)
        outro = self.gravar(
            ["git", "-C", str(destino), "credential", "fill"],
            input="protocol=https\nhost=exemplo.com\nusername=u\npassword=p\n\n",
            capture_output=True,
            text=True,
        )
        self.assertNotIn(segredo, outro.stdout + outro.stderr)
        self.assertNotIn("x-access-token", outro.stdout)

    def test_url_padrao_do_github_e_falha_sem_deixar_pasta(self):
        def falha(argv, **kw):
            self.chamadas.append(list(argv))
            return subprocess.CompletedProcess(argv, 128, "", "fatal: repository not found")

        destino = self.tmp / "repo"
        with self.assertRaises(RuntimeError):
            coordenador._clonar("dono/cliente", destino, token_file=str(self.token), rodar=falha)
        self.assertIn("https://github.com/dono/cliente.git", self.chamadas[0])
        self.assertFalse(destino.exists())
        self.assertFalse((self.tmp / ".repo.clonando").exists())

    def test_caminho_do_token_com_aspa_simples_e_entrada_invalida(self):
        with self.assertRaises(coordenador.ErroDeEntrada):
            coordenador._clonar("dono/cliente", self.tmp / "repo", token_file="/tmp/it's", rodar=lambda *a, **k: None)
        ruim = self.tmp / "it's"
        ruim.write_text("x" * 20, encoding="utf-8")
        boa = self.tmp / "w"
        boa.write_text("y" * 20, encoding="utf-8")
        with self.assertRaises(coordenador.ErroDeEntrada):
            coordenador.construir({"WARREN_TOKEN_FILE": str(boa), "GH_TOKEN_FILE": str(ruim)}, self.tmp)

    def test_construir_passa_o_caminho_absoluto_do_token_ao_clone(self):
        boa = self.tmp / "w"
        boa.write_text("y" * 20, encoding="utf-8")
        c = coordenador.construir({"WARREN_TOKEN_FILE": str(boa), "GH_TOKEN_FILE": str(self.token)}, self.tmp)
        self.assertIs(c.clonar.func, coordenador._clonar)
        self.assertEqual(c.clonar.keywords["token_file"], str(self.token))


class TestesUnits(unittest.TestCase):
    SERVICO = RAIZ_DOS_SCRIPTS.parent / "servico"

    def secao(self, nome):
        texto = (self.SERVICO / nome).read_text(encoding="utf-8")
        return {linha.split("=", 1)[0]: linha.split("=", 1)[1] for linha in texto.splitlines() if "=" in linha and not linha.startswith("#")}, texto

    def test_fabrica_fila(self):
        chaves, texto = self.secao("fabrica-fila.service")
        self.assertEqual(chaves["ExecStart"], "/usr/bin/python3 -I %h/fabrica/kit/fabrica/scripts/coordenador.py rodar")
        self.assertEqual(chaves["Restart"], "always")
        self.assertEqual(chaves["RestartSec"], "30")
        self.assertEqual(chaves["RestartPreventExitStatus"], "2")
        self.assertEqual(chaves["EnvironmentFile"], "-%h/fabrica/coordenador.env")
        self.assertIn("systemctl --user enable --now fabrica-fila", texto)

    def test_fabrica_plano(self):
        chaves, texto = self.secao("fabrica-plano@.service")
        self.assertEqual(chaves["ExecStart"], "/usr/bin/python3 -I %h/fabrica/kit/fabrica/scripts/despachante.py rodar")
        self.assertEqual(chaves["EnvironmentFile"], "%h/fabrica/planos/%i/plano.env")
        self.assertEqual(chaves["Restart"], "always")
        self.assertEqual(chaves["RestartSec"], "30")
        self.assertEqual(chaves["RestartPreventExitStatus"], "2")
        self.assertIn("coordenador", texto)


class TestesExecucaoDireta(unittest.TestCase):
    def test_importa_so_com_biblioteca_padrao_em_modo_isolado(self):
        import subprocess

        resultado = subprocess.run(
            [sys.executable, "-I", "-c", "import sys; sys.path.insert(0, %r); import coordenador" % str(RAIZ_DOS_SCRIPTS)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(resultado.returncode, 0, resultado.stderr)


if __name__ == "__main__":
    unittest.main()
