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

RAIZ_DOS_SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ_DOS_SCRIPTS))

import capacidade  # noqa: E402
import coordenador  # noqa: E402
import fila  # noqa: E402
import forja  # noqa: E402
import motor  # noqa: E402

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
