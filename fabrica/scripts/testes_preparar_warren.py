import hashlib
import json
import os
import pathlib
import subprocess
import sys
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


class ExecutorFalso:
    """Simula cat, test, cp, tee, bun, mv, rm e systemctl sobre um dicionário de arquivos em memória."""

    def __init__(self, arquivos):
        self.arquivos = dict(arquivos)
        self.chamadas = []
        self.bun_ok = True
        self.codigos = {}  # nome do comando -> código de saída forçado
        self.levantar = {}  # nome do comando -> exceção
        self.restarts = 0

    def __call__(self, argv, **opcoes):
        if "shell" in opcoes:
            raise AssertionError("shell não é permitido")
        if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv):
            raise AssertionError("argv deve ser lista de textos: %r" % (argv,))
        self.chamadas.append(list(argv))
        entrada = opcoes.get("input")
        if argv[:2] != ["sudo", "-n"]:
            raise AssertionError("comando sem sudo -n: %r" % (argv,))
        if argv[2:3] == ["systemctl"]:
            nome, args = "systemctl", argv[3:]
        else:
            if argv[2:4] != ["-u", U]:
                raise AssertionError("comando sem -u %s: %r" % (U, argv))
            nome, args = ("bun", argv[5:]) if argv[4] == BUN else (argv[4], argv[5:])
        if nome in self.levantar:
            raise self.levantar[nome]
        if nome in self.codigos:
            return subprocess.CompletedProcess(argv, self.codigos[nome], b"", b"falhou de mentira")
        return getattr(self, "_" + nome)(argv, args, entrada)

    def _ok(self, argv, saida=b""):
        return subprocess.CompletedProcess(argv, 0, saida, b"")

    def _erro(self, argv):
        return subprocess.CompletedProcess(argv, 1, b"", b"No such file or directory")

    def _cat(self, argv, args, entrada):
        (caminho,) = args
        if caminho not in self.arquivos:
            return self._erro(argv)
        return self._ok(argv, self.arquivos[caminho])

    def _test(self, argv, args, entrada):
        opcao, caminho = args
        assert opcao == "-e"
        return self._ok(argv) if caminho in self.arquivos else subprocess.CompletedProcess(argv, 1, b"", b"")

    def _cp(self, argv, args, entrada):
        opcao, origem, destino = args
        assert opcao == "-p"
        if origem not in self.arquivos:
            return self._erro(argv)
        self.arquivos[destino] = self.arquivos[origem]
        return self._ok(argv)

    def _tee(self, argv, args, entrada):
        (caminho,) = args
        assert isinstance(entrada, bytes)
        self.arquivos[caminho] = entrada
        return self._ok(argv, entrada)

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
        self.arquivos[destino] = self.arquivos.pop(origem)
        return self._ok(argv)

    def _rm(self, argv, args, entrada):
        opcao, caminho = args
        assert opcao == "-f"
        self.arquivos.pop(caminho, None)
        return self._ok(argv)

    def _systemctl(self, argv, args, entrada):
        assert args == ["restart", SERVICO], args
        self.restarts += 1
        return self._ok(argv)

    def escritas(self):
        """Comandos que mudam algo no disco ou no serviço."""
        mutaveis = {"cp", "tee", "mv", "rm", "systemctl"}
        return [c for c in self.chamadas if (c[2] if c[2] == "systemctl" else c[4]) in mutaveis]


def cmd(*args):
    return ["sudo", "-n", "-u", U, *args]


RESTART = ["sudo", "-n", "systemctl", "restart", SERVICO]


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


class BasePreparar(unittest.TestCase):
    def setUp(self):
        self.executor = ExecutorFalso({CAMINHO: SINTETICO.encode("utf-8")})
        self.nao_terminais = 0
        self.visoes = 0
        self.respostas_de_versao = []
        self.versoes = 0
        self.sonos = []

    def visao_geral(self):
        self.visoes += 1
        return {"runs": {"nonTerminal": self.nao_terminais, "total": 9}, "window": "24h"}

    def versao(self):
        self.versoes += 1
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


class TestesPrepararSemTocar(BasePreparar):
    def test_ja_aplicado_quando_o_conteudo_tem_o_marcador(self):
        self.executor.arquivos[CAMINHO] = pw.aplicar_patch(SINTETICO).encode("utf-8")
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "ja_aplicado")
        self.assertIsInstance(resultado["detalhe"], str)
        self.assertEqual(self.executor.chamadas, [cmd("cat", CAMINHO)])
        self.assertEqual(self.visoes, 0)
        self.assertEqual(self.executor.restarts, 0)

    def test_versao_desconhecida_nao_toca_em_nada(self):
        self.executor.arquivos[CAMINHO] = (SINTETICO + "// outra versão\n").encode("utf-8")
        antes = dict(self.executor.arquivos)
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "versao_desconhecida")
        self.assertEqual(self.executor.chamadas, [cmd("cat", CAMINHO)])
        self.assertEqual(self.executor.escritas(), [])
        self.assertEqual(self.executor.arquivos, antes)
        self.assertEqual(self.visoes, 0)

    def test_sha_padrao_e_o_do_0_19_3(self):
        # sem sha_esperado, o sintético (sha diferente) é versão desconhecida
        resultado = pw.preparar(
            executar=self.executor, visao_geral=self.visao_geral, versao=self.versao, caminho=CAMINHO, dormir=self.sonos.append, bun=BUN
        )
        self.assertEqual(resultado["estado"], "versao_desconhecida")
        self.assertEqual(self.executor.escritas(), [])

    def test_aguardando_runs_nao_toca_em_nada(self):
        self.nao_terminais = 2
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aguardando_runs")
        self.assertIn("2", resultado["detalhe"])
        self.assertEqual(self.executor.chamadas, [cmd("cat", CAMINHO)])
        self.assertEqual(self.executor.escritas(), [])
        self.assertEqual(self.visoes, 1)

    def test_um_run_ativo_ja_basta_para_esperar(self):
        self.nao_terminais = 1
        self.assertEqual(self.preparar()["estado"], "aguardando_runs")
        self.assertEqual(self.executor.escritas(), [])

    def test_visao_geral_malformada_e_erro_sem_escrita(self):
        for visao in ({}, {"runs": {}}, {"runs": {"nonTerminal": "0"}}, {"runs": {"nonTerminal": True}}, {"runs": {"nonTerminal": -1}}, {"runs": []}):
            with self.subTest(visao=visao):
                self.setUp()
                self.visao_geral = lambda visao=visao: visao
                resultado = self.preparar()
                self.assertEqual(resultado["estado"], "erro")
                self.assertEqual(self.executor.escritas(), [])

    def test_cat_que_falha_e_erro(self):
        del self.executor.arquivos[CAMINHO]
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn("cat", resultado["detalhe"])
        self.assertEqual(self.executor.escritas(), [])

    def test_conteudo_que_nao_e_utf8_e_versao_desconhecida(self):
        self.executor.arquivos[CAMINHO] = b"\xff\xfe lixo"
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "versao_desconhecida")
        self.assertEqual(self.executor.escritas(), [])


class TestesPrepararAplica(BasePreparar):
    def test_caminho_feliz_sequencia_exata(self):
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aplicado")
        chamadas = self.executor.chamadas
        self.assertEqual(chamadas[0], cmd("cat", CAMINHO))
        self.assertEqual(chamadas[1], cmd("test", "-e", BACKUP))
        self.assertEqual(chamadas[2], cmd("cp", "-p", CAMINHO, BACKUP))
        self.assertEqual(chamadas[3], cmd("tee", NOVO))
        self.assertEqual(chamadas[4][:6], cmd(BUN, "-e"))
        self.assertEqual(len(chamadas[4]), 7)
        self.assertEqual(chamadas[5], cmd("mv", "-f", NOVO, CAMINHO))
        self.assertEqual(chamadas[6], RESTART)
        self.assertEqual(len(chamadas), 7)
        self.assertEqual(self.conteudo(), pw.aplicar_patch(SINTETICO))
        self.assertEqual(self.conteudo(BACKUP), SINTETICO)
        self.assertNotIn(NOVO, self.executor.arquivos)
        self.assertEqual(self.executor.restarts, 1)
        self.assertEqual(self.sonos, [3])
        self.assertEqual(self.versoes, 1)

    def test_script_do_bun_confere_model_com_e_sem_frontmatter(self):
        self.preparar()
        script = self.executor.chamadas[4][6]
        self.assertIn("await import(%s)" % json.dumps(NOVO), script)
        self.assertIn("claudeCodeAdapter.buildSpawnCommand", script)
        self.assertIn('"claude-haiku-5-5"', script)
        self.assertIn('"--model"', script)
        self.assertIn('"/tmp/fabrica-validacao"', script)
        self.assertIn("frontmatter: {}", script)
        self.assertIn("frontmatter: { model: MODELO }", script)
        self.assertIn("process.exit(", script)
        self.assertIn('!sem.includes("--model")', script)
        self.assertIn("com[i + 1] === MODELO", script)
        self.assertIn(".catch(() => process.exit(1))", script)

    def test_backup_existente_nao_e_sobrescrito(self):
        self.executor.arquivos[BACKUP] = SINTETICO.encode("utf-8")
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertNotIn("cp", [c[4] for c in self.executor.chamadas if c[2] == "-u"])
        self.assertEqual(self.executor.chamadas[1], cmd("test", "-e", BACKUP))
        self.assertEqual(self.executor.chamadas[2], cmd("cat", BACKUP))
        self.assertEqual(self.executor.chamadas[3], cmd("tee", NOVO))
        self.assertEqual(self.conteudo(BACKUP), SINTETICO)

    def test_backup_existente_diferente_do_original_e_erro_sem_escrita(self):
        self.executor.arquivos[BACKUP] = b"outra coisa"
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn(".fabrica-orig", resultado["detalhe"])
        self.assertEqual(self.executor.escritas(), [])
        self.assertEqual(self.executor.arquivos[BACKUP], b"outra coisa")
        self.assertEqual(self.conteudo(), SINTETICO)

    def test_espera_o_warren_voltar_com_poll_de_3_s(self):
        self.respostas_de_versao = [ConnectionRefusedError("x"), None, "", "0.19.3"]
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertEqual(self.sonos, [3, 3, 3, 3])
        self.assertEqual(self.versoes, 4)
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
        self.assertNotIn(cmd("mv", "-f", NOVO, CAMINHO), self.executor.chamadas)
        self.assertEqual(self.versoes, 0)

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
        self.assertEqual(self.executor.chamadas[-1], cmd("rm", "-f", NOVO))
        self.assertNotIn(NOVO, self.executor.arquivos)

    def test_cp_que_falha_e_erro_sem_gravar(self):
        self.executor.codigos["cp"] = 1
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn("cp", resultado["detalhe"])
        self.assertNotIn(cmd("tee", NOVO), self.executor.chamadas)
        self.assertEqual(self.executor.restarts, 0)

    def test_warren_que_nao_volta_restaura_o_backup_e_reinicia_de_novo(self):
        self.respostas_de_versao = [ConnectionRefusedError("fora")] * 100
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertIn("90", resultado["detalhe"])
        self.assertEqual(self.sonos, [3] * 30)
        self.assertEqual(self.versoes, 30)
        self.assertEqual(self.executor.chamadas[-2], cmd("mv", "-f", BACKUP, CAMINHO))
        self.assertEqual(self.executor.chamadas[-1], RESTART)
        self.assertEqual(self.executor.restarts, 2)
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertNotIn(BACKUP, self.executor.arquivos)

    def test_restart_que_falha_tambem_restaura(self):
        chamadas = []
        original = self.executor._systemctl

        def systemctl(argv, args, entrada):
            chamadas.append(1)
            if len(chamadas) == 1:
                return subprocess.CompletedProcess(argv, 1, b"", b"Job failed")
            return original(argv, args, entrada)

        self.executor._systemctl = systemctl
        resultado = self.preparar()
        self.assertEqual(resultado["estado"], "erro")
        self.assertEqual(self.conteudo(), SINTETICO)
        self.assertEqual(self.executor.chamadas[-2:], [cmd("mv", "-f", BACKUP, CAMINHO), RESTART])
        self.assertEqual(self.versoes, 0)

    def test_parametros_de_usuario_bun_e_servico(self):
        self.executor = ExecutorFalso({"/x/c.ts": SINTETICO.encode("utf-8")})
        vistos = []

        def executar(argv, **opcoes):
            vistos.append(list(argv))
            return subprocess.CompletedProcess(argv, 0, SINTETICO.encode("utf-8") if "cat" in argv else b"", b"")

        resultado = pw.preparar(
            executar=executar,
            visao_geral=self.visao_geral,
            versao=self.versao,
            caminho="/x/c.ts",
            usuario="outro",
            bun="/opt/bun",
            servico="w2.service",
            dormir=self.sonos.append,
            sha_esperado=SHA_SINTETICO,
        )
        self.assertEqual(resultado["estado"], "aplicado")
        self.assertEqual(vistos[0], ["sudo", "-n", "-u", "outro", "cat", "/x/c.ts"])
        self.assertIn(["sudo", "-n", "-u", "outro", "mv", "-f", "/x/c.ts.fabrica-novo.ts", "/x/c.ts"], vistos)
        self.assertEqual(vistos[-1], ["sudo", "-n", "systemctl", "restart", "w2.service"])
        self.assertTrue(any(v[4] == "/opt/bun" for v in vistos))


class TestesPrepararExcecoes(BasePreparar):
    def test_excecao_no_executar_vira_erro_sem_traceback(self):
        self.executor.levantar["cat"] = OSError("sudo sumiu\nTraceback (most recent call last): segunda linha")
        resultado = self.preparar()
        self.assertEqual(resultado, {"estado": "erro", "detalhe": "OSError: sudo sumiu"})

    def test_excecao_na_visao_geral_vira_erro(self):
        def quebrada():
            raise RuntimeError("GET /ops/overview: HTTP 500")

        self.visao_geral = quebrada
        resultado = self.preparar()
        self.assertEqual(resultado, {"estado": "erro", "detalhe": "RuntimeError: GET /ops/overview: HTTP 500"})
        self.assertEqual(self.executor.escritas(), [])

    def test_detalhe_e_curto(self):
        self.executor.levantar["cat"] = OSError("x" * 5000)
        resultado = self.preparar()
        self.assertLessEqual(len(resultado["detalhe"]), 300)
        self.assertEqual(set(resultado), {"estado", "detalhe"})

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
