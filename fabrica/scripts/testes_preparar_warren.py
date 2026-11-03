import copy
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

import preparar_warren as pw  # noqa: E402

LINHA = (
    '...(typeof ctx.frontmatter?.model === "string" && ctx.frontmatter.model.trim() !== "" '
    '? ["--model", ctx.frontmatter.model.trim()] : []), // fabrica:model-flag'
)

# Reproduz o trecho real de src/runtime/adapters/claude-code.ts do Warren 0.19.3: tabs, vírgulas finais e o
# comentário de duas linhas acima da âncora.
SINTETICO = (
    'import type { AdapterSpawnContext, SpawnCommand } from "./types.ts";\n'
    "\n"
    'const CLAUDE_BIN = "claude";\n'
    "\n"
    "export const claudeCodeAdapter: AgentRuntimeAdapter = {\n"
    '\truntimeId: "claude-code",\n'
    "\n"
    "\tbuildSpawnCommand(ctx: AdapterSpawnContext): SpawnCommand {\n"
    "\t\treturn {\n"
    "\t\t\targv: [\n"
    "\t\t\t\tCLAUDE_BIN,\n"
    '\t\t\t\t"--print",\n'
    '\t\t\t\t"--input-format",\n'
    '\t\t\t\t"stream-json",\n'
    '\t\t\t\t"--output-format",\n'
    '\t\t\t\t"stream-json",\n'
    '\t\t\t\t"--verbose",\n'
    "\t\t\t\t// The sandbox is the enforcement boundary; an in-app prompt would\n"
    "\t\t\t\t// deadlock a non-interactive spawn.\n"
    '\t\t\t\t"--dangerously-skip-permissions",\n'
    "\t\t\t],\n"
    "\t\t\tenv: { TMPDIR: claudeCodeBurrowTmpdir(ctx.workspacePath) },\n"
    "\t\t\tstdin: encodeClaudeStdin(ctx.prompt, ctx.pendingMessages),\n"
    "\t\t};\n"
    "\t},\n"
    "};\n"
)
SHA_SINTETICO = hashlib.sha256(SINTETICO.encode("utf-8")).hexdigest()

CAMINHO = "/home/agentops/w/src/runtime/adapters/claude-code.ts"
BACKUP = CAMINHO + ".fabrica-orig"
NOVO = CAMINHO + ".fabrica-novo.ts"
U = "agentops"
BUN = "/home/agentops/.bun/bin/bun"
SERVICO = "warren.service"



PENDENTE = CAMINHO + ".fabrica-pendente"
AUTOMERGE = "warren-automerge.service"
AUTO = "warren-auto.service"
DROPIN_DIR = "/etc/systemd/system/warren.service.d"
DROPIN = DROPIN_DIR + "/fabrica.conf"
DROPIN_CONTEUDO = (
    "# gerado pela fábrica de agentes\n[Service]\nEnvironment=WARREN_PLAN_RUN_MERGE_TIMEOUT_MS=10800000\n"
)
LIVRE = {"runs": {"byState": {}, "nonTerminal": 0, "total": 9}, "services": {"dbReachable": True}, "window": "24h"}


class ExecutorFalso:
    """Simula o host: arquivos em memória com mtime, o systemd (units, restart, daemon-reload) e o bun."""

    def __init__(self, arquivos):
        self.arquivos = dict(arquivos)
        self.relogio = 10
        self.mtimes = {caminho: 1 for caminho in self.arquivos}
        self.ativo_desde = 5  # o Warren subiu depois dos arquivos: nada pendente
        self.units = {}  # unit -> {"enabled": ..., "active": ...}
        self.diretorios = set()
        self.chamadas = []
        self.bun_ok = True
        self.codigos = {}  # "nome" ou "nome sub" (systemctl) -> código de saída forçado
        self.levantar = {}  # idem -> exceção
        self.restarts = 0
        self.reloads = 0

    def __call__(self, argv, **opcoes):
        if "shell" in opcoes:
            raise AssertionError("shell não é permitido")
        if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv):
            raise AssertionError("argv deve ser lista de textos: %r" % (argv,))
        self.chamadas.append(list(argv))
        entrada = opcoes.get("input")
        if argv[:2] != ["sudo", "-n"]:
            raise AssertionError("comando sem sudo -n: %r" % (argv,))
        if argv[2] == "-u":
            if argv[3] != U:
                raise AssertionError("comando sem -u %s: %r" % (U, argv))
            nome, args = ("bun", argv[5:]) if argv[4] == BUN else (argv[4], argv[5:])
        else:
            nome, args = argv[2], argv[3:]
        for chave in ("%s %s" % (nome, args[0]) if args else nome, nome):
            if chave in self.levantar:
                raise self.levantar[chave]
            if chave in self.codigos:
                return subprocess.CompletedProcess(argv, self.codigos[chave], b"", b"falhou de mentira")
        return getattr(self, "_" + nome.replace("-", "_"))(argv, args, entrada)

    def _ok(self, argv, saida=b""):
        return subprocess.CompletedProcess(argv, 0, saida, b"")

    def _erro(self, argv, codigo=1):
        return subprocess.CompletedProcess(argv, codigo, b"", b"No such file or directory")

    def _gravar(self, caminho, dados, mtime=None):
        self.relogio += 1
        self.arquivos[caminho] = dados
        self.mtimes[caminho] = self.relogio if mtime is None else mtime

    def _cat(self, argv, args, entrada):
        (caminho,) = args
        if caminho not in self.arquivos:
            return self._erro(argv)
        return self._ok(argv, self.arquivos[caminho])

    def _test(self, argv, args, entrada):
        opcao, caminho = args
        assert opcao == "-e"
        return self._ok(argv) if caminho in self.arquivos else subprocess.CompletedProcess(argv, 1, b"", b"")

    def _stat(self, argv, args, entrada):
        assert args[:2] == ["-c", "%Y"], args
        caminho = args[2]
        if caminho not in self.arquivos:
            return self._erro(argv)
        return self._ok(argv, b"%d\n" % self.mtimes[caminho])

    def _cp(self, argv, args, entrada):
        opcao, origem, destino = args
        assert opcao == "-p"
        if origem not in self.arquivos:
            return self._erro(argv)
        self._gravar(destino, self.arquivos[origem], mtime=self.mtimes[origem])
        return self._ok(argv)

    def _tee(self, argv, args, entrada):
        (caminho,) = args
        assert isinstance(entrada, bytes)
        if caminho.startswith("/etc/") and caminho.rsplit("/", 1)[0] not in self.diretorios:
            return self._erro(argv)
        self._gravar(caminho, entrada)
        return self._ok(argv, entrada)

    def _mkdir(self, argv, args, entrada):
        opcao, caminho = args
        assert opcao == "-p"
        self.diretorios.add(caminho)
        return self._ok(argv)

    def _chmod(self, argv, args, entrada):
        referencia, caminho = args
        assert referencia.startswith("--reference=")
        if referencia[len("--reference=") :] not in self.arquivos or caminho not in self.arquivos:
            return self._erro(argv)
        return self._ok(argv)

    def _bun(self, argv, args, entrada):
        opcao, script = args
        assert opcao == "-e"
        alvo = json.dumps(NOVO)
        ok = self.bun_ok and alvo in script and pw.MARCADOR.encode() in self.arquivos.get(NOVO, b"")
        return subprocess.CompletedProcess(argv, 0 if ok else 1, b"", b"" if ok else b"validacao falhou")

    def _mv(self, argv, args, entrada):
        opcao, origem, destino = args
        assert opcao == "-f"
        if origem not in self.arquivos:
            return self._erro(argv)
        mtime = self.mtimes.pop(origem)
        self.arquivos[destino] = self.arquivos.pop(origem)
        self.mtimes[destino] = mtime
        return self._ok(argv)

    def _rm(self, argv, args, entrada):
        opcao, caminho = args
        assert opcao == "-f"
        self.arquivos.pop(caminho, None)
        self.mtimes.pop(caminho, None)
        return self._ok(argv)

    def _systemctl(self, argv, args, entrada):
        sub = args[0]
        if sub == "restart":
            assert args == ["restart", SERVICO], args
            self.restarts += 1
            self.relogio += 1
            self.ativo_desde = self.relogio
            return self._ok(argv)
        if sub == "daemon-reload":
            assert args == ["daemon-reload"], args
            self.reloads += 1
            return self._ok(argv)
        if args == ["show", SERVICO, "-P", "ActiveEnterTimestamp", "--timestamp=unix"]:
            return self._ok(argv, b"@%d\n" % self.ativo_desde)
        if sub == "show" and args[2:] == ["-P", "LoadState"]:
            unit = self.units.get(args[1])
            return self._ok(argv, (unit.get("load", "loaded") if unit else "not-found").encode() + b"\n")
        if sub in ("is-enabled", "is-active"):
            assert len(args) == 2 and args[1] in (AUTOMERGE, AUTO), args
            unit = self.units.get(args[1])
            if unit is None:
                return subprocess.CompletedProcess(argv, 4, b"not-found\n", b"")
            valor = unit["enabled" if sub == "is-enabled" else "active"]
            ligado = valor in ("enabled", "active")
            return subprocess.CompletedProcess(argv, 0 if ligado else 1, valor.encode() + b"\n", b"")
        if sub == "disable":
            assert args[:2] == ["disable", "--now"] and len(args) == 3 and args[2] in (AUTOMERGE, AUTO), args
            self.units[args[2]] = {"enabled": "disabled", "active": "inactive"}
            return self._ok(argv)
        raise AssertionError("systemctl inesperado: %r" % (args,))

    def escritas(self):
        """Comandos que mudam algo no disco ou no systemd."""
        mutaveis = {"cp", "tee", "mv", "rm", "mkdir", "chmod"}
        saida = []
        for c in self.chamadas:
            if c[0] != "sudo":
                continue
            nome = c[4] if c[2] == "-u" else c[2]
            if nome in mutaveis or (nome == "systemctl" and c[3] in ("restart", "daemon-reload", "disable")):
                saida.append(c)
        return saida


def cmd(*args):
    return ["sudo", "-n", "-u", U, *args]


def root(*args):
    return ["sudo", "-n", *args]


RESTART = root("systemctl", "restart", SERVICO)
RELOAD = root("systemctl", "daemon-reload")
LOADSTATE = root("systemctl", "show", AUTOMERGE, "-P", "LoadState")
LOADSTATE_AUTO = root("systemctl", "show", AUTO, "-P", "LoadState")
ATIVO_DESDE = root("systemctl", "show", SERVICO, "-P", "ActiveEnterTimestamp", "--timestamp=unix")


# ---------------------------------------------------------------- aplicar_patch


class TestesAplicarPatch(unittest.TestCase):
    def test_constantes_da_interface(self):
        self.assertEqual(pw.SHA_ORIGINAL_0_19_3, "dcd242f8ebb5b24e9057cc90f13ee4789e8a04ff23c208056fd49893c12c41db")
        self.assertEqual(pw.MARCADOR, "fabrica:model-flag")
        self.assertEqual(
            pw.CAMINHO_PADRAO,
            "/home/agentops/.bun/install/global/node_modules/@os-eco/warren-cli/src/runtime/adapters/claude-code.ts",
        )

    def test_insere_a_linha_logo_depois_da_ancora_com_a_mesma_indentacao(self):
        resultado = pw.aplicar_patch(SINTETICO)
        linhas = resultado.split("\n")
        i = linhas.index('\t\t\t\t"--dangerously-skip-permissions",')
        self.assertEqual(linhas[i + 1], "\t\t\t\t" + LINHA)
        self.assertEqual(linhas[i + 2], "\t\t\t],")
        # tirando a linha nova, o texto é o original byte a byte
        self.assertEqual("\n".join(linhas[: i + 1] + linhas[i + 2 :]), SINTETICO)
        self.assertEqual(resultado.count(pw.MARCADOR), 1)
        self.assertEqual(len(linhas), len(SINTETICO.split("\n")) + 1)

    def test_copia_a_indentacao_da_ancora_qualquer_que_seja(self):
        texto = SINTETICO.replace('\t\t\t\t"--dangerously-skip-permissions",', '        "--dangerously-skip-permissions",')
        linhas = pw.aplicar_patch(texto).split("\n")
        i = linhas.index('        "--dangerously-skip-permissions",')
        self.assertEqual(linhas[i + 1], "        " + LINHA)

    def test_preserva_crlf(self):
        texto = SINTETICO.replace("\n", "\r\n")
        resultado = pw.aplicar_patch(texto)
        self.assertIn('\t\t\t\t"--dangerously-skip-permissions",\r\n\t\t\t\t' + LINHA + "\r\n\t\t\t],\r\n", resultado)
        self.assertEqual(resultado.count("\n"), resultado.count("\r\n"))

    def test_ancora_ausente_levanta(self):
        texto = SINTETICO.replace('"--dangerously-skip-permissions",', '"--outra-coisa",')
        with self.assertRaises(ValueError):
            pw.aplicar_patch(texto)

    def test_ancora_sem_virgula_nao_conta(self):
        texto = SINTETICO.replace('"--dangerously-skip-permissions",', '"--dangerously-skip-permissions"')
        with self.assertRaises(ValueError):
            pw.aplicar_patch(texto)

    def test_ancora_duplicada_levanta(self):
        texto = SINTETICO.replace(
            '\t\t\t\t"--dangerously-skip-permissions",\n',
            '\t\t\t\t"--dangerously-skip-permissions",\n\t\t\t\t"--dangerously-skip-permissions",\n',
        )
        with self.assertRaises(ValueError):
            pw.aplicar_patch(texto)

    def test_ancora_duplicada_na_mesma_linha_levanta(self):
        texto = SINTETICO.replace(
            '\t\t\t\t"--dangerously-skip-permissions",\n',
            '\t\t\t\t"--dangerously-skip-permissions", "--dangerously-skip-permissions",\n',
        )
        with self.assertRaises(ValueError):
            pw.aplicar_patch(texto)

    def test_ancora_duplicada_fora_do_argv_tambem_levanta(self):
        texto = SINTETICO + '// "--dangerously-skip-permissions", aparece aqui também\n'
        with self.assertRaises(ValueError):
            pw.aplicar_patch(texto)

    def test_ancora_fora_do_argv_de_build_spawn_command_levanta(self):
        texto = SINTETICO.replace('\t\t\t\t"--dangerously-skip-permissions",\n', "").replace(
            "\t\t\tenv: {", '\t\t\textra: ["--dangerously-skip-permissions",],\n\t\t\tenv: {'
        )
        with self.assertRaises(ValueError):
            pw.aplicar_patch(texto)
        sem_build = SINTETICO.replace("buildSpawnCommand(", "outraCoisa(")
        with self.assertRaises(ValueError):
            pw.aplicar_patch(sem_build)

    def test_marcador_ja_presente_levanta(self):
        with self.assertRaises(ValueError):
            pw.aplicar_patch(pw.aplicar_patch(SINTETICO))
        with self.assertRaises(ValueError):
            pw.aplicar_patch(SINTETICO + "// fabrica:model-flag\n")

    @unittest.skipUnless(
        os.path.isfile(os.environ.get("FABRICA_WARREN_CLAUDE_CODE_TS", "")),
        "FABRICA_WARREN_CLAUDE_CODE_TS não aponta para o claude-code.ts do Warren 0.19.3",
    )
    def test_arquivo_real_do_warren(self):
        bruto = pathlib.Path(os.environ["FABRICA_WARREN_CLAUDE_CODE_TS"]).read_bytes()
        self.assertEqual(hashlib.sha256(bruto).hexdigest(), pw.SHA_ORIGINAL_0_19_3)
        resultado = pw.aplicar_patch(bruto.decode("utf-8"))
        self.assertEqual(resultado.count(pw.MARCADOR), 1)
        linhas = resultado.split("\n")
        i = linhas.index('\t\t\t\t"--dangerously-skip-permissions",')
        self.assertEqual(linhas[i + 1], "\t\t\t\t" + LINHA)




# ---------------------------------------------------------------- preparar

VISAO = ["<visao_geral>"]
VERSAO = ["<versao>"]


class BasePreparar(unittest.TestCase):
    """O mundo padrão: arquivo original, drop-in já certo, sem warren-automerge, Warren livre e de pé."""

    def setUp(self):
        self.executor = ExecutorFalso({CAMINHO: SINTETICO.encode("utf-8"), DROPIN: DROPIN_CONTEUDO.encode("utf-8")})
        self.executor.diretorios.add(DROPIN_DIR)
        self.visoes = []  # respostas de visao_geral, em ordem (a última se repete)
        self.respostas_de_versao = []
        self.sonos = []

    def visao_geral(self):
        self.executor.chamadas.append(VISAO)
        resposta = (self.visoes.pop(0) if len(self.visoes) > 1 else self.visoes[0]) if self.visoes else LIVRE
        if isinstance(resposta, BaseException):
            raise resposta
        return copy.deepcopy(resposta)

    def versao(self):
        self.executor.chamadas.append(VERSAO)
        if self.respostas_de_versao:
            resposta = self.respostas_de_versao.pop(0)
            if isinstance(resposta, BaseException):
                raise resposta
            return resposta
        return "0.19.3"

    def preparar(self, **extra):
        argumentos = dict(
            executar=self.executor,
            visao_geral=self.visao_geral,
            versao=self.versao,
            caminho=CAMINHO,
            usuario=U,
            bun=BUN,
            servico=SERVICO,
            dormir=self.sonos.append,
            sha_esperado=SHA_SINTETICO,
        )
        argumentos.update(extra)
        return pw.preparar(**argumentos)

    def conteudo(self, caminho=CAMINHO):
        return self.executor.arquivos[caminho].decode("utf-8")

    def contar(self, evento):
        return sum(1 for c in self.executor.chamadas if c == evento)

    def patchado(self, *, carregado=True, pendente=False):
        """O arquivo já com o patch (e o backup), carregado ou não pelo Warren."""
        e = self.executor
        e.arquivos[BACKUP] = SINTETICO.encode("utf-8")
        e.mtimes[BACKUP] = 1
        e.arquivos[CAMINHO] = pw.aplicar_patch(SINTETICO).encode("utf-8")
        e.mtimes[CAMINHO] = 3 if carregado else 8
        if pendente:
            e.arquivos[PENDENTE] = b"pendente\n"
            e.mtimes[PENDENTE] = 3


class TestesPrepararSemTocar(BasePreparar):
    def test_ja_aplicado_e_carregado_nao_toca_em_nada(self):
        self.patchado()
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "ja_aplicado")
        self.assertEqual((resultado["dropin"], resultado["automerge"]), ("ok", "ausente"))
        self.assertEqual(self.executor.escritas(), [])
        self.assertEqual(self.contar(VISAO), 0)
        self.assertIn(cmd("test", "-e", PENDENTE), self.executor.chamadas)
        self.assertIn(ATIVO_DESDE, self.executor.chamadas)
        self.assertIn(cmd("stat", "-c", "%Y", CAMINHO), self.executor.chamadas)

    def test_versao_desconhecida_nao_toca_em_nada(self):
        self.executor.arquivos[CAMINHO] = (SINTETICO + "// outra versão\n").encode("utf-8")
        antes = dict(self.executor.arquivos)
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "versao_desconhecida")
        self.assertEqual(self.executor.escritas(), [])
        self.assertEqual(self.executor.arquivos, antes)
        self.assertEqual(self.contar(VISAO), 0)

    def test_sha_padrao_e_o_do_0_19_3(self):
        resultado = pw.preparar(
            executar=self.executor, visao_geral=self.visao_geral, versao=self.versao, caminho=CAMINHO, dormir=self.sonos.append, bun=BUN
        )
        self.assertEqual(resultado["estado"], "versao_desconhecida")
        self.assertEqual(self.executor.escritas(), [])

    def test_aguardando_runs_nao_toca_em_nada(self):
        self.visoes = [dict(LIVRE, runs={"nonTerminal": 2})]
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aguardando_runs")
        self.assertIn("2", resultado["detalhe"])
        self.assertEqual(self.executor.escritas(), [])
        self.assertEqual(self.contar(VISAO), 1)

    def test_um_run_ativo_ja_basta_para_esperar(self):
        self.visoes = [dict(LIVRE, runs={"nonTerminal": 1})]
        self.assertEqual(self.preparar()["estado"], "aguardando_runs")
        self.assertEqual(self.executor.escritas(), [])

    def test_overview_degradado_com_banco_fora_nao_e_livre(self):
        # ops-overview.ts: falha de banco devolve nonTerminal 0 com services.dbReachable false
        degradado = {"runs": {"byState": {}, "nonTerminal": 0, "total": 0}, "services": {"dbReachable": False}}
        self.visoes = [degradado]
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aguardando_runs")
        self.assertIn("banco", resultado["detalhe"])
        self.assertEqual(self.executor.escritas(), [])
        self.assertEqual(self.executor.restarts, 0)

    def test_qualquer_outra_visao_e_aguardando_sem_escrita(self):
        visoes = (
            {"runs": {"nonTerminal": 0}},
            {"runs": {"nonTerminal": 0}, "services": {}},
            {"runs": {"nonTerminal": 0}, "services": {"dbReachable": "true"}},
            {"runs": {"nonTerminal": 0}, "services": {"dbReachable": 1}},
            {"runs": {"nonTerminal": 0}, "services": None},
            {"services": {"dbReachable": True}},
            {"runs": {}, "services": {"dbReachable": True}},
            {"runs": {"nonTerminal": "0"}, "services": {"dbReachable": True}},
            {"runs": {"nonTerminal": False}, "services": {"dbReachable": True}},
            {"runs": {"nonTerminal": -1}, "services": {"dbReachable": True}},
            {"runs": [], "services": {"dbReachable": True}},
            [],
            None,
            RuntimeError("GET /ops/overview: HTTP 500"),
        )
        for visao in visoes:
            with self.subTest(visao=visao):
                self.setUp()
                self.visoes = [visao]
                resultado = self.preparar()
                self.assertEqual(resultado["estado"], "aguardando_runs")
                self.assertEqual(self.executor.escritas(), [])

    def test_cat_que_falha_e_erro(self):
        del self.executor.arquivos[CAMINHO]
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn("cat", resultado["detalhe"])
        self.assertEqual(self.executor.escritas(), [])
        self.assertEqual(set(resultado) >= {"dropin", "automerge"}, True)

    def test_conteudo_que_nao_e_utf8_e_versao_desconhecida(self):
        self.executor.arquivos[CAMINHO] = b"\xff\xfe lixo"
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "versao_desconhecida")
        self.assertEqual(self.executor.escritas(), [])

    def test_resultado_traz_o_sha_do_arquivo(self):
        self.assertEqual(self.preparar(visao_geral=lambda: dict(LIVRE, runs={"nonTerminal": 3}))["sha"], SHA_SINTETICO)


class TestesPrepararAplica(BasePreparar):
    def test_caminho_feliz_sequencia_exata(self):
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertEqual((resultado["dropin"], resultado["automerge"]), ("ok", "ausente"))
        chamadas = self.executor.chamadas
        script = chamadas[9][6]
        self.assertEqual(
            chamadas,
            [
                LOADSTATE,
                LOADSTATE_AUTO,
                cmd("cat", CAMINHO),
                root("test", "-e", DROPIN),
                root("cat", DROPIN),
                VISAO,
                cmd("test", "-e", BACKUP),
                cmd("cp", "-p", CAMINHO, BACKUP),
                cmd("tee", NOVO),
                cmd(BUN, "-e", script),
                cmd("chmod", "--reference=" + CAMINHO, NOVO),
                VISAO,
                cmd("tee", PENDENTE),
                cmd("mv", "-f", NOVO, CAMINHO),
                RELOAD,
                RESTART,
                VERSAO,
                cmd("rm", "-f", PENDENTE),
            ],
        )
        self.assertEqual(self.conteudo(), pw.aplicar_patch(SINTETICO))
        self.assertEqual(self.conteudo(BACKUP), SINTETICO)
        self.assertNotIn(NOVO, self.executor.arquivos)
        self.assertNotIn(PENDENTE, self.executor.arquivos)
        self.assertEqual(self.executor.restarts, 1)
        self.assertEqual(self.sonos, [3])

    def test_script_do_bun_confere_model_com_e_sem_frontmatter(self):
        self.preparar()
        (script,) = [c[6] for c in self.executor.chamadas if c[:5] == cmd(BUN)]
        self.assertIn("await import(%s)" % json.dumps(NOVO), script)
        self.assertIn("claudeCodeAdapter.buildSpawnCommand", script)
        self.assertIn('"claude-haiku-5-5"', script)
        self.assertIn('"--model"', script)
        self.assertIn('"/tmp/fabrica-validacao"', script)
        self.assertIn("frontmatter: {}", script)
        self.assertIn("frontmatter: { model: MODELO }", script)
        self.assertIn('!sem.includes("--model")', script)
        self.assertIn("com[i + 1] === MODELO", script)
        self.assertIn(".catch(() => process.exit(1))", script)

    def test_rechecagem_imediata_antes_do_mv_e_do_restart(self):
        self.visoes = [LIVRE, dict(LIVRE, runs={"nonTerminal": 1})]
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aguardando_runs")
        self.assertEqual(self.contar(VISAO), 2)
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertNotIn(NOVO, self.executor.arquivos)
        self.assertNotIn(PENDENTE, self.executor.arquivos)
        self.assertEqual(self.executor.chamadas[-1], cmd("rm", "-f", NOVO))
        self.assertEqual(self.executor.restarts, 0)
        self.assertNotIn(cmd("mv", "-f", NOVO, CAMINHO), self.executor.chamadas)

    def test_rechecagem_com_banco_fora_tambem_espera(self):
        self.visoes = [LIVRE, dict(LIVRE, services={"dbReachable": False})]
        self.assertEqual(self.preparar()["estado"], "aguardando_runs")
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertEqual(self.executor.restarts, 0)

    def test_rechecagem_que_levanta_tambem_espera_e_apaga_o_temporario(self):
        self.visoes = [LIVRE, ConnectionRefusedError("x")]
        self.assertEqual(self.preparar()["estado"], "aguardando_runs")
        self.assertNotIn(NOVO, self.executor.arquivos)
        self.assertEqual(self.executor.restarts, 0)

    def test_chmod_por_referencia_antes_do_mv(self):
        self.preparar()
        chamadas = self.executor.chamadas
        self.assertLess(
            chamadas.index(cmd("chmod", "--reference=" + CAMINHO, NOVO)), chamadas.index(cmd("mv", "-f", NOVO, CAMINHO))
        )

    def test_chmod_que_falha_e_erro_e_apaga_o_temporario(self):
        self.executor.codigos["chmod"] = 1
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn("chmod", resultado["detalhe"])
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertNotIn(NOVO, self.executor.arquivos)
        self.assertEqual(self.executor.restarts, 0)

    def test_pendencia_gravada_antes_do_mv_e_removida_depois_da_versao(self):
        self.preparar()
        chamadas = self.executor.chamadas
        tee, mv = chamadas.index(cmd("tee", PENDENTE)), chamadas.index(cmd("mv", "-f", NOVO, CAMINHO))
        versao, rm = chamadas.index(VERSAO), chamadas.index(cmd("rm", "-f", PENDENTE))
        self.assertLess(tee, mv)
        self.assertLess(versao, rm)

    def test_backup_existente_nao_e_sobrescrito(self):
        self.executor.arquivos[BACKUP] = SINTETICO.encode("utf-8")
        self.executor.mtimes[BACKUP] = 1
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertFalse(any(c[:5] == cmd("cp") for c in self.executor.chamadas))
        self.assertIn(cmd("cat", BACKUP), self.executor.chamadas)
        self.assertEqual(self.conteudo(BACKUP), SINTETICO)

    def test_backup_existente_diferente_do_original_e_erro_sem_escrita(self):
        self.executor.arquivos[BACKUP] = b"outra coisa"
        self.executor.mtimes[BACKUP] = 1
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn(".fabrica-orig", resultado["detalhe"])
        self.assertEqual(self.executor.escritas(), [])
        self.assertEqual(self.executor.arquivos[BACKUP], b"outra coisa")

    def test_espera_o_warren_voltar_com_poll_de_3_s(self):
        self.respostas_de_versao = [ConnectionRefusedError("x"), None, "", "0.19.3"]
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertEqual(self.sonos, [3, 3, 3, 3])
        self.assertEqual(self.contar(VERSAO), 4)
        self.assertEqual(self.executor.restarts, 1)

    def test_validacao_do_bun_falha_original_intacto_sem_restart(self):
        self.executor.bun_ok = False
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn("bun", resultado["detalhe"])
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertNotIn(NOVO, self.executor.arquivos)
        self.assertEqual(self.executor.chamadas[-1], cmd("rm", "-f", NOVO))
        self.assertEqual(self.executor.restarts, 0)
        self.assertEqual(self.contar(VISAO), 1)
        self.assertEqual(self.contar(VERSAO), 0)

    def test_bun_que_levanta_tambem_apaga_o_temporario(self):
        self.executor.levantar["bun"] = subprocess.TimeoutExpired(["bun"], 60)
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertTrue(resultado["detalhe"].startswith("TimeoutExpired: "))
        self.assertNotIn(NOVO, self.executor.arquivos)
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertEqual(self.executor.restarts, 0)

    def test_tee_que_falha_e_erro_sem_mv_nem_restart(self):
        self.executor.codigos["tee"] = 1
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn("tee", resultado["detalhe"])
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertEqual(self.executor.restarts, 0)
        self.assertEqual(self.executor.chamadas[-1], cmd("rm", "-f", NOVO))

    def test_mv_que_falha_e_erro_sem_restart_e_apaga_o_temporario(self):
        self.executor.codigos["mv"] = 1
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn("mv", resultado["detalhe"])
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertEqual(self.executor.restarts, 0)
        self.assertNotIn(NOVO, self.executor.arquivos)
        self.assertNotIn(PENDENTE, self.executor.arquivos)

    def test_cp_que_falha_e_erro_sem_gravar(self):
        self.executor.codigos["cp"] = 1
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn("cp", resultado["detalhe"])
        self.assertNotIn(cmd("tee", NOVO), self.executor.chamadas)
        self.assertEqual(self.executor.restarts, 0)

    def test_parametros_de_usuario_bun_e_servico(self):
        vistos = []

        def executar(argv, **opcoes):
            vistos.append(list(argv))
            saida = b""
            if argv[-2:] == ["cat", "/x/c.ts"] or argv[-2:] == ["cat", "/x/c.ts.fabrica-orig"]:
                saida = SINTETICO.encode("utf-8")
            elif argv[-1] == "/etc/systemd/system/w2.service.d/fabrica.conf" and "cat" in argv:
                saida = DROPIN_CONTEUDO.encode("utf-8")
            elif "LoadState" in argv:
                saida = b"not-found\n"
            return subprocess.CompletedProcess(argv, 0, saida, b"")

        resultado = pw.preparar(
            executar=executar,
            visao_geral=lambda: LIVRE,
            versao=self.versao,
            caminho="/x/c.ts",
            usuario="outro",
            bun="/opt/bun",
            servico="w2.service",
            dormir=self.sonos.append,
            sha_esperado=SHA_SINTETICO,
        )
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertIn(["sudo", "-n", "-u", "outro", "cat", "/x/c.ts"], vistos)
        self.assertIn(["sudo", "-n", "-u", "outro", "mv", "-f", "/x/c.ts.fabrica-novo.ts", "/x/c.ts"], vistos)
        self.assertIn(["sudo", "-n", "systemctl", "restart", "w2.service"], vistos)
        self.assertIn(["sudo", "-n", "test", "-e", "/etc/systemd/system/w2.service.d/fabrica.conf"], vistos)
        self.assertTrue(any(v[4] == "/opt/bun" for v in vistos if len(v) > 4))


class TestesRollback(BasePreparar):
    def test_warren_que_nao_volta_reverte_reinicia_e_confere_de_novo(self):
        self.respostas_de_versao = [ConnectionRefusedError("fora")] * 30 + ["0.19.3"]
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "revertido")
        self.assertIn("90", resultado["detalhe"])
        self.assertIs(resultado["warrenVoltou"], True)
        self.assertEqual(self.sonos, [3] * 31)
        self.assertEqual(self.executor.restarts, 2)
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertNotIn(BACKUP, self.executor.arquivos)
        self.assertNotIn(PENDENTE, self.executor.arquivos)
        self.assertEqual(resultado["sha"], SHA_SINTETICO)
        restarts = [i for i, c in enumerate(self.executor.chamadas) if c == RESTART]
        self.assertLess(self.executor.chamadas.index(cmd("mv", "-f", BACKUP, CAMINHO)), restarts[1])
        self.assertIn(VERSAO, self.executor.chamadas[restarts[1] :])

    def test_warren_fora_mesmo_depois_do_rollback(self):
        self.respostas_de_versao = [ConnectionRefusedError("fora")] * 100
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "revertido")
        self.assertIs(resultado["warrenVoltou"], False)
        self.assertEqual(self.sonos, [3] * 60)
        self.assertEqual(self.contar(VERSAO), 60)
        self.assertEqual(self.executor.restarts, 2)
        self.assertEqual(self.conteudo(), SINTETICO)

    def test_restart_que_falha_tambem_reverte(self):
        chamadas = []
        original = self.executor._systemctl

        def systemctl(argv, args, entrada):
            if args[0] == "restart":
                chamadas.append(1)
                if len(chamadas) == 1:
                    return subprocess.CompletedProcess(argv, 1, b"", b"Job failed")
            return original(argv, args, entrada)

        self.executor._systemctl = systemctl
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "revertido")
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertEqual(len(chamadas), 2)
        self.assertIs(resultado["warrenVoltou"], True)

    def test_sha_revertido_igual_interrompe_sem_tocar(self):
        resultado = self.preparar(sha_revertido=SHA_SINTETICO)
        self.assertEqual(resultado["estado"], "revertido")
        self.assertNotIn("warrenVoltou", resultado)
        self.assertEqual(self.executor.escritas(), [])
        self.assertEqual(self.contar(VISAO), 0)

    def test_sha_revertido_diferente_segue_normalmente(self):
        resultado = self.preparar(sha_revertido="0" * 64)
        self.assertEqual(resultado["estado"], "aplicado")


class TestesRecarga(BasePreparar):
    def test_pendencia_existente_reinicia_e_confirma(self):
        self.patchado(pendente=True)
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertEqual(self.executor.restarts, 1)
        self.assertEqual(self.contar(VISAO), 2)
        self.assertNotIn(PENDENTE, self.executor.arquivos)
        self.assertEqual(self.conteudo(), pw.aplicar_patch(SINTETICO))
        self.assertFalse(any(c[:5] == cmd("mv") for c in self.executor.chamadas))

    def test_arquivo_mais_novo_que_o_servico_reinicia(self):
        self.patchado(carregado=False)
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertEqual(self.executor.restarts, 1)

    def test_arquivo_mais_velho_que_o_servico_nao_reinicia(self):
        self.patchado(carregado=True)
        self.assertEqual(self.preparar()["estado"], "ja_aplicado")
        self.assertEqual(self.executor.restarts, 0)

    def test_recarga_passa_pelos_gates(self):
        self.patchado(pendente=True)
        self.visoes = [dict(LIVRE, services={"dbReachable": False})]
        self.assertEqual(self.preparar()["estado"], "aguardando_runs")
        self.assertEqual(self.executor.restarts, 0)
        self.assertIn(PENDENTE, self.executor.arquivos)
        self.setUp()
        self.patchado(pendente=True)
        self.visoes = [LIVRE, dict(LIVRE, runs={"nonTerminal": 1})]
        self.assertEqual(self.preparar()["estado"], "aguardando_runs")
        self.assertEqual(self.executor.restarts, 0)

    def test_arquivo_do_mesmo_segundo_da_subida_conta_como_carregado(self):
        # o mv preserva o mtime do temporário, gravado antes do restart: mesmo segundo não é "mais novo"
        self.patchado()
        self.executor.mtimes[CAMINHO] = self.executor.ativo_desde
        self.assertEqual(self.preparar()["estado"], "ja_aplicado")
        self.assertEqual(self.executor.restarts, 0)

    def test_timestamp_ilegivel_nao_reinicia(self):
        self.patchado(carregado=False)
        original = self.executor._systemctl

        def systemctl(argv, args, entrada):
            if "ActiveEnterTimestamp" in args:
                return subprocess.CompletedProcess(argv, 0, b"\n", b"")
            return original(argv, args, entrada)

        self.executor._systemctl = systemctl
        self.assertEqual(self.preparar()["estado"], "ja_aplicado")
        self.assertEqual(self.executor.restarts, 0)

    def test_morte_no_systemctl_a_proxima_chamada_reinicia(self):
        original = self.executor._systemctl

        def morre(argv, args, entrada):
            if args[0] == "restart":
                raise SystemExit(143)
            return original(argv, args, entrada)

        self.executor._systemctl = morre
        with self.assertRaises(SystemExit):
            self.preparar()
        self.assertIn(PENDENTE, self.executor.arquivos)
        self.assertEqual(self.conteudo(), pw.aplicar_patch(SINTETICO))
        self.executor._systemctl = original
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertEqual(self.executor.restarts, 1)
        self.assertNotIn(PENDENTE, self.executor.arquivos)

    def test_morte_durante_o_poll_a_proxima_chamada_reinicia_e_reverte(self):
        self.respostas_de_versao = [KeyboardInterrupt()]
        with self.assertRaises(KeyboardInterrupt):
            self.preparar()
        self.assertEqual(self.executor.restarts, 1)
        self.assertIn(PENDENTE, self.executor.arquivos)
        self.respostas_de_versao = [ConnectionRefusedError("fora")] * 30 + ["0.19.3"]
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "revertido")
        self.assertEqual(self.executor.restarts, 3)
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertNotIn(PENDENTE, self.executor.arquivos)

    def test_morte_durante_o_poll_e_warren_de_volta_confirma(self):
        self.respostas_de_versao = [KeyboardInterrupt()]
        with self.assertRaises(KeyboardInterrupt):
            self.preparar()
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertEqual(self.executor.restarts, 2)
        self.assertNotIn(PENDENTE, self.executor.arquivos)


class TestesDropin(BasePreparar):
    def sem_dropin(self):
        del self.executor.arquivos[DROPIN]
        self.executor.diretorios.discard(DROPIN_DIR)

    def test_conteudo_exato_do_dropin(self):
        self.assertEqual(pw.DROPIN_CONTEUDO, DROPIN_CONTEUDO)
        self.assertEqual(pw.caminho_dropin("warren.service"), DROPIN)

    def test_dropin_ausente_e_gravado_com_daemon_reload_no_mesmo_restart(self):
        self.sem_dropin()
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["dropin"]), ("aplicado", "alterado"))
        self.assertEqual(self.conteudo(DROPIN), DROPIN_CONTEUDO)
        chamadas = self.executor.chamadas
        mv = chamadas.index(cmd("mv", "-f", NOVO, CAMINHO))
        self.assertEqual(chamadas[mv + 1 : mv + 5], [root("mkdir", "-p", DROPIN_DIR), root("tee", DROPIN), RELOAD, RESTART])
        self.assertEqual(self.executor.restarts, 1)
        self.assertEqual(self.executor.reloads, 1)

    def test_dropin_diferente_e_reescrito(self):
        self.executor.arquivos[DROPIN] = b"[Service]\nEnvironment=WARREN_PLAN_RUN_MERGE_TIMEOUT_MS=1800000\n"
        resultado = self.preparar()
        self.assertEqual(resultado["dropin"], "alterado")
        self.assertEqual(self.conteudo(DROPIN), DROPIN_CONTEUDO)

    def test_dropin_igual_nao_e_regravado(self):
        resultado = self.preparar()
        self.assertEqual(resultado["dropin"], "ok")
        self.assertNotIn(root("tee", DROPIN), self.executor.chamadas)
        self.assertNotIn(root("mkdir", "-p", DROPIN_DIR), self.executor.chamadas)
        # o drop-in no lugar ganha daemon-reload antes do restart (cobre um drop-in gravado e não recarregado)
        self.assertEqual(self.executor.reloads, 1)

    def test_so_o_dropin_faltando_reinicia_sem_mexer_no_patch(self):
        self.patchado()
        self.sem_dropin()
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["dropin"]), ("ja_aplicado", "alterado"))
        self.assertEqual(self.executor.restarts, 1)
        self.assertEqual(self.contar(VISAO), 2)
        self.assertFalse(any(c[:5] == cmd("mv") for c in self.executor.chamadas))

    def test_dropin_faltando_com_runs_ativos_espera(self):
        self.patchado()
        self.sem_dropin()
        self.visoes = [dict(LIVRE, runs={"nonTerminal": 4})]
        self.assertEqual(self.preparar()["estado"], "aguardando_runs")
        self.assertEqual(self.executor.escritas(), [])

    def test_dropin_gravado_mas_nao_carregado_reinicia(self):
        self.patchado()
        self.executor.mtimes[DROPIN] = 9  # gravado depois da última subida do Warren
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["dropin"]), ("ja_aplicado", "ok"))
        self.assertEqual(self.executor.restarts, 1)

    def test_versao_desconhecida_ainda_grava_o_dropin(self):
        self.executor.arquivos[CAMINHO] = (SINTETICO + "// outra versão\n").encode("utf-8")
        self.sem_dropin()
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["dropin"]), ("versao_desconhecida", "alterado"))
        self.assertEqual(self.executor.restarts, 1)
        self.assertEqual(self.conteudo(), SINTETICO + "// outra versão\n")

    def test_dropin_que_falha_nao_derruba_o_patch(self):
        self.sem_dropin()
        self.executor.codigos["mkdir"] = 1
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["dropin"]), ("aplicado", "erro"))
        self.assertEqual(self.executor.restarts, 1)

    def test_daemon_reload_que_falha_e_dropin_erro(self):
        self.sem_dropin()
        self.executor.codigos["systemctl daemon-reload"] = 1
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["dropin"]), ("aplicado", "erro"))

    def test_so_o_dropin_e_ele_falha_nao_reinicia(self):
        self.patchado()
        self.sem_dropin()
        self.executor.codigos["mkdir"] = 1
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["dropin"]), ("ja_aplicado", "erro"))
        self.assertEqual(self.executor.restarts, 0)

    def test_leitura_do_dropin_que_falha_e_dropin_erro_sem_gravar(self):
        self.executor.codigos["cat"] = 1  # também falha o cat do adaptador: erro geral
        self.assertEqual(self.preparar()["dropin"], "erro")
        self.setUp()
        original = self.executor._cat

        def cat(argv, args, entrada):
            if args == [DROPIN]:
                return subprocess.CompletedProcess(argv, 1, b"", b"permissao")
            return original(argv, args, entrada)

        self.executor._cat = cat
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["dropin"]), ("aplicado", "erro"))
        self.assertNotIn(root("tee", DROPIN), self.executor.chamadas)

    def test_so_o_dropin_e_o_warren_nao_volta_reverte_o_dropin(self):
        self.patchado()
        self.sem_dropin()
        self.respostas_de_versao = [ConnectionRefusedError("fora")] * 30 + ["0.19.3"]
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "revertido")
        self.assertNotIn(DROPIN, self.executor.arquivos)
        self.assertEqual(self.executor.reloads, 2)
        self.assertEqual(self.conteudo(), pw.aplicar_patch(SINTETICO))
        self.assertEqual(self.executor.restarts, 2)

    def test_dropin_diferente_revertido_volta_ao_conteudo_anterior(self):
        anterior = b"[Service]\nEnvironment=X=1\n"
        self.executor.arquivos[DROPIN] = anterior
        self.respostas_de_versao = [ConnectionRefusedError("fora")] * 100
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "revertido")
        self.assertEqual(self.executor.arquivos[DROPIN], anterior)
        self.assertEqual(self.conteudo(), SINTETICO)


class TestesAutomerge(BasePreparar):
    def com_automerge(self, enabled, active):
        self.executor.units[AUTOMERGE] = {"enabled": enabled, "active": active}

    def test_ausente(self):
        self.assertEqual(self.preparar()["automerge"], "ausente")
        self.assertFalse(any("disable" in c for c in self.executor.chamadas))

    def test_ativo_ou_habilitado_e_desligado(self):
        for enabled, active in (("enabled", "active"), ("enabled", "inactive"), ("disabled", "active")):
            with self.subTest(enabled=enabled, active=active):
                self.setUp()
                self.com_automerge(enabled, active)
                resultado = self.preparar()
                self.assertEqual(resultado["automerge"], "desligado")
                self.assertIn(root("systemctl", "disable", "--now", AUTOMERGE), self.executor.chamadas)
                self.assertIn(root("systemctl", "is-enabled", AUTOMERGE), self.executor.chamadas)
                self.assertIn(root("systemctl", "is-active", AUTOMERGE), self.executor.chamadas)
                self.assertEqual(self.executor.units[AUTOMERGE], {"enabled": "disabled", "active": "inactive"})

    def test_unit_mascarada_e_inativa_ja_esta_desligada(self):
        self.executor.units[AUTOMERGE] = {"load": "masked", "enabled": "masked", "active": "inactive"}
        self.assertEqual(self.preparar()["automerge"], "ja_desligado")
        self.assertIn(root("systemctl", "is-enabled", AUTOMERGE), self.executor.chamadas)

    def test_ja_desligado(self):
        self.com_automerge("disabled", "inactive")
        self.assertEqual(self.preparar()["automerge"], "ja_desligado")
        self.assertFalse(any("disable" in c for c in self.executor.chamadas))

    def test_falha_no_disable_e_aviso_nunca_erro_do_patch(self):
        self.com_automerge("enabled", "active")
        self.executor.codigos["systemctl disable"] = 1
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["automerge"]), ("aplicado", "erro"))

    def test_excecao_na_consulta_e_automerge_erro(self):
        original = self.executor._systemctl

        def systemctl(argv, args, entrada):
            if AUTOMERGE in args:
                raise OSError("sem systemd")
            return original(argv, args, entrada)

        self.executor._systemctl = systemctl
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["automerge"]), ("aplicado", "erro"))

    def test_desliga_mesmo_sem_poder_reiniciar_o_warren(self):
        self.com_automerge("enabled", "active")
        self.visoes = [dict(LIVRE, runs={"nonTerminal": 3})]
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["automerge"]), ("aguardando_runs", "desligado"))
        self.assertEqual(self.executor.restarts, 0)


class TestesServicosDesligar(BasePreparar):
    def com_automerge(self, enabled, active):
        self.executor.units[AUTOMERGE] = {"enabled": enabled, "active": active}

    def com_auto(self, enabled, active):
        self.executor.units[AUTO] = {"enabled": enabled, "active": active}

    def test_padrao_inclui_os_dois_servicos(self):
        self.assertEqual(pw.SERVICOS_DESLIGAR_PADRAO, (AUTOMERGE, AUTO))
        resultado = self.preparar()
        self.assertEqual(resultado["desligados"], {AUTOMERGE: "ausente", AUTO: "ausente"})

    def test_warren_auto_recebe_a_mesma_sequencia_do_automerge(self):
        self.com_auto("enabled", "active")
        resultado = self.preparar()
        self.assertEqual(resultado["desligados"], {AUTOMERGE: "ausente", AUTO: "desligado"})
        self.assertEqual(
            self.executor.chamadas[:6],
            [
                LOADSTATE,
                LOADSTATE_AUTO,
                root("systemctl", "is-enabled", AUTO),
                root("systemctl", "is-active", AUTO),
                root("systemctl", "disable", "--now", AUTO),
                cmd("cat", CAMINHO),
            ],
        )
        self.assertEqual(self.executor.units[AUTO], {"enabled": "disabled", "active": "inactive"})

    def test_warren_auto_ja_desligado_ou_mascarado(self):
        self.com_auto("disabled", "inactive")
        self.assertEqual(self.preparar()["desligados"][AUTO], "ja_desligado")
        self.assertFalse(any("disable" in c for c in self.executor.chamadas))
        self.setUp()
        self.executor.units[AUTO] = {"load": "masked", "enabled": "masked", "active": "inactive"}
        self.assertEqual(self.preparar()["desligados"][AUTO], "ja_desligado")

    def test_warren_auto_ausente_nao_e_erro(self):
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["desligados"][AUTO]), ("aplicado", "ausente"))
        self.assertEqual(resultado["automerge"], "ausente")
        self.assertFalse(any("disable" in c for c in self.executor.chamadas))

    def test_erro_no_warren_auto_nao_muda_a_chave_automerge(self):
        self.com_automerge("enabled", "active")
        self.com_auto("enabled", "active")
        original = self.executor._systemctl

        def systemctl(argv, args, entrada):
            if args[0] == "disable" and AUTO in args:
                return subprocess.CompletedProcess(argv, 1, b"", b"x")
            return original(argv, args, entrada)

        self.executor._systemctl = systemctl
        resultado = self.preparar()
        self.assertEqual(resultado["automerge"], "desligado")
        self.assertEqual(resultado["desligados"], {AUTOMERGE: "desligado", AUTO: "erro"})
        self.assertEqual(resultado["estado"], "aplicado")

    def test_excecao_no_warren_auto_e_so_dele(self):
        self.com_automerge("enabled", "active")
        original = self.executor._systemctl

        def systemctl(argv, args, entrada):
            if AUTO in args:
                raise OSError("sem systemd")
            return original(argv, args, entrada)

        self.executor._systemctl = systemctl
        resultado = self.preparar()
        self.assertEqual(resultado["desligados"], {AUTOMERGE: "desligado", AUTO: "erro"})
        self.assertEqual((resultado["estado"], resultado["automerge"]), ("aplicado", "desligado"))

    def test_erro_no_automerge_nao_impede_desligar_o_warren_auto(self):
        self.com_automerge("enabled", "active")
        self.com_auto("enabled", "active")
        original = self.executor._systemctl

        def systemctl(argv, args, entrada):
            if args[0] == "disable" and AUTOMERGE in args:
                return subprocess.CompletedProcess(argv, 1, b"", b"x")
            return original(argv, args, entrada)

        self.executor._systemctl = systemctl
        resultado = self.preparar()
        self.assertEqual(resultado["automerge"], "erro")
        self.assertEqual(resultado["desligados"], {AUTOMERGE: "erro", AUTO: "desligado"})

    def test_servicos_desligar_personalizados_e_automerge_e_o_primeiro(self):
        self.com_auto("enabled", "active")
        resultado = self.preparar(servicos_desligar=(AUTO,))
        self.assertEqual(resultado["desligados"], {AUTO: "desligado"})
        self.assertEqual(resultado["automerge"], "desligado")
        self.assertNotIn(LOADSTATE, self.executor.chamadas)

    def test_servicos_desligar_vazio(self):
        resultado = self.preparar(servicos_desligar=())
        self.assertEqual((resultado["desligados"], resultado["automerge"]), ({}, "ausente"))
        self.assertNotIn(LOADSTATE, self.executor.chamadas)
        self.assertNotIn(LOADSTATE_AUTO, self.executor.chamadas)

    def test_resultado_de_erro_antecipado_traz_desligados_vazio(self):
        self.executor.levantar["cat"] = OSError("sudo sumiu")
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertEqual(resultado["automerge"], "ausente")
        self.assertEqual(set(resultado["desligados"]), {AUTOMERGE, AUTO})

    def test_desliga_mesmo_sem_poder_reiniciar_o_warren(self):
        self.com_auto("enabled", "active")
        self.visoes = [dict(LIVRE, runs={"nonTerminal": 3})]
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["desligados"][AUTO]), ("aguardando_runs", "desligado"))
        self.assertEqual(self.executor.restarts, 0)


class TestesPrepararExcecoes(BasePreparar):
    def test_excecao_no_executar_vira_erro_sem_traceback(self):
        self.executor.levantar["cat"] = OSError("sudo sumiu\nTraceback (most recent call last): segunda linha")
        resultado = self.preparar()
        self.assertEqual((resultado["estado"], resultado["detalhe"]), ("erro", "OSError: sudo sumiu"))
        self.assertEqual(resultado["dropin"], "erro")

    def test_detalhe_e_curto(self):
        self.executor.levantar["cat"] = OSError("x" * 5000)
        resultado = self.preparar()
        self.assertLessEqual(len(resultado["detalhe"]), 300)
        self.assertTrue({"estado", "detalhe", "dropin", "automerge"} <= set(resultado))

    def test_executar_sempre_com_lista_e_sem_shell(self):
        opcoes_vistas = []
        executor = self.executor

        def executar(argv, **opcoes):
            opcoes_vistas.append(opcoes)
            return executor(argv, **opcoes)

        self.assertEqual(self.preparar(executar=executar)["estado"], "aplicado")
        for opcoes in opcoes_vistas:
            self.assertNotIn("shell", opcoes)
            self.assertIsInstance(opcoes.get("timeout"), (int, float))
            self.assertTrue(opcoes.get("capture_output"))


@unittest.skipUnless(
    os.path.isdir(os.environ.get("FABRICA_WARREN_SRC", "")) and shutil.which("bun"),
    "FABRICA_WARREN_SRC (cópia do src do Warren 0.19.3) e um bun no PATH",
)
class TestesBunReal(unittest.TestCase):
    def test_script_gerado_aceita_o_patch_e_recusa_o_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / "src"
            shutil.copytree(os.environ["FABRICA_WARREN_SRC"], src)
            adaptadores = src / "runtime" / "adapters"
            original = (adaptadores / "claude-code.ts").read_text(encoding="utf-8")
            novo = adaptadores / ("claude-code.ts" + pw.SUFIXO_NOVO)
            for texto, esperado in ((pw.aplicar_patch(original), 0), (original, 1)):
                novo.write_text(texto, encoding="utf-8")
                saida = subprocess.run(
                    [shutil.which("bun"), "-e", pw.script_de_validacao(str(novo))], capture_output=True, cwd="/", timeout=120
                )
                self.assertEqual(saida.returncode, esperado, saida.stderr[-500:])


class TestesExecucaoDireta(unittest.TestCase):
    def test_modulo_importa_so_com_biblioteca_padrao_em_modo_isolado(self):
        resultado = subprocess.run(
            [sys.executable, "-I", "-c", "import sys; sys.path.insert(0, %r); import preparar_warren" % str(RAIZ)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(resultado.returncode, 0, resultado.stderr)


if __name__ == "__main__":
    unittest.main()
