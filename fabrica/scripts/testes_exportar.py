import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

import exportar  # noqa: E402

SHA = "a" * 40
OID_A = b"1" * 40
OID_B = b"2" * 40
OID_C = b"3" * 40


def ls_tree_saida(*entradas):
    """Bytes de `git ls-tree -r -z`; cada entrada é `(modo, caminho, oid)`."""
    partes = []
    for modo, caminho, oid in entradas:
        tipo = b"commit" if modo == b"160000" else b"blob"
        caminho = caminho if isinstance(caminho, bytes) else caminho.encode("utf-8")
        partes.append(modo + b" " + tipo + b" " + oid + b"\t" + caminho + b"\0")
    return b"".join(partes)


def cat_file_saida(*blobs):
    """Bytes de `git cat-file --batch`; cada item é `(oid, conteúdo)`."""
    return b"".join(oid + b" blob " + str(len(dados)).encode() + b"\n" + dados + b"\n" for oid, dados in blobs)


def proc_bytes(saida=b"", codigo=0, erro=b""):
    return types.SimpleNamespace(returncode=codigo, stdout=saida, stderr=erro)


class GitFalso:
    """Responde a `ls-tree` e `cat-file --batch` e grava as chamadas."""

    def __init__(self, ls_tree=b"", cat_file=b"", falha_ls=None, falha_cat=None):
        self.ls_tree = ls_tree
        self.cat_file = cat_file
        self.falha_ls = falha_ls
        self.falha_cat = falha_cat
        self.chamadas = []

    def __call__(self, argv, **kwargs):
        self.chamadas.append((list(argv), dict(kwargs)))
        comando = argv[len(exportar.GIT)]
        if comando == "ls-tree":
            return self.falha_ls or proc_bytes(self.ls_tree)
        if comando == "cat-file":
            return self.falha_cat or proc_bytes(self.cat_file)
        raise AssertionError("chamada inesperada: %r" % (argv,))


class TestesExportarComFalso(unittest.TestCase):
    def setUp(self):
        base = tempfile.TemporaryDirectory()
        self.addCleanup(base.cleanup)
        self.base = pathlib.Path(base.name).resolve()
        self.destino = self.base / "destino"
        self.destino.mkdir()
        self.repo = self.base / "repo"

    def exportar(self, git):
        return exportar.exportar(self.repo, SHA, self.destino, git)

    def arvore(self):
        return sorted(str(p.relative_to(self.destino)) for p in self.destino.rglob("*"))

    def test_comandos_git_com_opcoes_e_ambiente_endurecidos(self):
        git = GitFalso(ls_tree_saida((b"100644", "a.txt", OID_A)), cat_file_saida((OID_A, b"a")))
        self.exportar(git)
        self.assertEqual(len(git.chamadas), 2)
        opcoes = [
            "git",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.attributesFile=/dev/null",
        ]
        self.assertEqual(git.chamadas[0][0], opcoes + ["ls-tree", "-r", "-z", "--full-tree", SHA])
        self.assertEqual(git.chamadas[1][0], opcoes + ["cat-file", "--batch"])
        self.assertEqual(git.chamadas[1][1]["input"], OID_A + b"\n")
        for _, kwargs in git.chamadas:
            self.assertEqual(kwargs["cwd"], self.repo)
            self.assertTrue(kwargs["capture_output"])
            self.assertFalse(kwargs.get("text", False))
            self.assertIsInstance(kwargs["timeout"], int)
            env = kwargs["env"]
            for chave in ("GIT_NO_REPLACE_OBJECTS", "GIT_CONFIG_NOSYSTEM", "GIT_ATTR_NOSYSTEM"):
                self.assertEqual(env[chave], "1", chave)
            self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")

    def test_ambiente_sobrescreve_o_do_pai(self):
        with mock.patch.dict(os.environ, {"GIT_NO_REPLACE_OBJECTS": "0", "GIT_ATTR_NOSYSTEM": "0", "GIT_CONFIG_NOSYSTEM": "0"}):
            git = GitFalso()
            self.exportar(git)
        env = git.chamadas[0][1]["env"]
        self.assertEqual((env["GIT_NO_REPLACE_OBJECTS"], env["GIT_ATTR_NOSYSTEM"], env["GIT_CONFIG_NOSYSTEM"]), ("1", "1", "1"))

    def test_modos_conteudo_diretorios_e_deduplicacao_de_blobs(self):
        git = GitFalso(
            ls_tree_saida(
                (b"100644", "a.txt", OID_A),
                (b"100755", "sub/run.sh", OID_B),
                (b"100644", "sub/fundo/b.txt", OID_A),
                (b"100644", "com espaço/ç.txt", OID_C),
            ),
            cat_file_saida((OID_A, b"a\0\n\r\nb"), (OID_B, b"#!/bin/sh\n"), (OID_C, b"")),
        )
        notas = self.exportar(git)
        self.assertEqual(notas, [])
        self.assertEqual(git.chamadas[1][1]["input"], OID_A + b"\n" + OID_B + b"\n" + OID_C + b"\n")
        modo = lambda p: os.stat(self.destino / p).st_mode & 0o777  # noqa: E731
        self.assertEqual((self.destino / "a.txt").read_bytes(), b"a\0\n\r\nb")
        self.assertEqual((self.destino / "sub" / "fundo" / "b.txt").read_bytes(), b"a\0\n\r\nb")
        self.assertEqual((self.destino / "com espaço" / "ç.txt").read_bytes(), b"")
        self.assertEqual(modo("a.txt"), 0o644)
        self.assertEqual(modo("sub/run.sh"), 0o755)
        self.assertEqual(modo("sub"), 0o755)
        self.assertEqual(modo("sub/fundo"), 0o755)

    def test_arvore_vazia_nao_chama_cat_file(self):
        git = GitFalso()
        self.assertEqual(self.exportar(git), [])
        self.assertEqual(len(git.chamadas), 1)
        self.assertEqual(self.arvore(), [])

    def test_symlink_e_criado_como_symlink_e_nunca_seguido(self):
        git = GitFalso(
            ls_tree_saida((b"120000", "fora", OID_A), (b"120000", "abs", OID_B), (b"100644", "ok.txt", OID_C)),
            cat_file_saida((OID_A, b"../fora-do-destino"), (OID_B, b"/etc/passwd"), (OID_C, b"ok")),
        )
        self.exportar(git)
        self.assertTrue(os.path.islink(self.destino / "fora"))
        self.assertEqual(os.readlink(self.destino / "fora"), "../fora-do-destino")
        self.assertEqual(os.readlink(self.destino / "abs"), "/etc/passwd")
        self.assertFalse((self.base / "fora-do-destino").exists())

    def test_nenhum_arquivo_e_gravado_atraves_de_symlink(self):
        fora = self.base / "fora"
        fora.mkdir()
        casos = {
            "symlink-para-fora-e-arquivo-dentro": (
                ls_tree_saida((b"120000", "l", OID_A), (b"100644", "l/x.txt", OID_B)),
                cat_file_saida((OID_A, b"../fora"), (OID_B, b"x")),
            ),
            "symlink-absoluto-e-arquivo-dentro": (
                ls_tree_saida((b"120000", "l", OID_A), (b"100644", "l/x.txt", OID_B)),
                cat_file_saida((OID_A, str(fora).encode()), (OID_B, b"x")),
            ),
            "symlink-e-subdiretorio-profundo": (
                ls_tree_saida((b"120000", "l", OID_A), (b"100644", "l/a/b/x.txt", OID_B)),
                cat_file_saida((OID_A, str(fora).encode()), (OID_B, b"x")),
            ),
            "symlink-para-dentro-tambem-nao": (
                ls_tree_saida((b"100644", "d/y.txt", OID_C), (b"120000", "l", OID_A), (b"100644", "l/x.txt", OID_B)),
                cat_file_saida((OID_A, b"d"), (OID_B, b"x"), (OID_C, b"y")),
            ),
            "arquivo-sobre-symlink": (
                ls_tree_saida((b"120000", "l", OID_A), (b"100644", "l", OID_B)),
                cat_file_saida((OID_A, str(fora / "alvo").encode()), (OID_B, b"x")),
            ),
        }
        for nome, (ls, cat) in casos.items():
            shutil.rmtree(self.destino)
            self.destino.mkdir()
            with self.assertRaises(exportar.ExportInvalido, msg=nome):
                self.exportar(GitFalso(ls, cat))
            self.assertEqual(list(fora.iterdir()), [], nome)
            self.assertFalse((self.destino / "d" / "x.txt").exists(), nome)

    def test_submodulo_e_ignorado_com_nota(self):
        git = GitFalso(
            ls_tree_saida((b"160000", "vendor/sub", OID_A), (b"100644", "a.txt", OID_B)),
            cat_file_saida((OID_B, b"a")),
        )
        notas = self.exportar(git)
        self.assertEqual(notas, ["submódulo ignorado: vendor/sub"])
        self.assertEqual(self.arvore(), ["a.txt"])
        self.assertEqual(git.chamadas[1][1]["input"], OID_B + b"\n")

    def test_caminhos_inseguros_abortam_antes_de_gravar_qualquer_coisa(self):
        ruins = ["/abs.txt", "a/../b", "../x", "..", ".", "./a", "a/./b", "a//b", "a/", "", ".git/config", ".GIT/x", "a/.git/x", ".Git"]
        for caminho in ruins:
            git = GitFalso(
                ls_tree_saida((b"100644", "antes.txt", OID_A), (b"100644", caminho, OID_B)),
                cat_file_saida((OID_A, b"a"), (OID_B, b"b")),
            )
            with self.assertRaises(exportar.ExportInvalido, msg=repr(caminho)):
                self.exportar(git)
            self.assertEqual(self.arvore(), [], repr(caminho))
            self.assertEqual(len(git.chamadas), 1)

    def test_nome_que_apenas_contem_git_ou_pontos_e_valido(self):
        git = GitFalso(
            ls_tree_saida((b"100644", ".gitignore", OID_A), (b"100644", "a/..b/c..d/.gitattributes", OID_A)),
            cat_file_saida((OID_A, b"x")),
        )
        self.exportar(git)
        self.assertEqual((self.destino / ".gitignore").read_bytes(), b"x")

    def test_modo_nao_suportado_aborta(self):
        for modo in (b"100664", b"040000", b"100000", b"120755", b"abc"):
            git = GitFalso(ls_tree_saida((modo, "a.txt", OID_A)), cat_file_saida((OID_A, b"a")))
            with self.assertRaises(exportar.ExportInvalido, msg=modo):
                self.exportar(git)
            self.assertEqual(self.arvore(), [])

    def test_ls_tree_com_formato_inesperado(self):
        for saida in (b"lixo\0", b"100644 blob " + OID_A + b" a.txt\0", b"100644 blob\t a.txt\0"):
            with self.assertRaises(exportar.ExportInvalido, msg=saida):
                self.exportar(GitFalso(saida))

    def test_cat_file_com_saida_ruim(self):
        ls = ls_tree_saida((b"100644", "a.txt", OID_A), (b"100644", "b.txt", OID_B))
        ruins = {
            "truncada": cat_file_saida((OID_A, b"aaaa"))[:-3],
            "faltando-o-segundo": cat_file_saida((OID_A, b"a")),
            "oid-trocado": cat_file_saida((OID_B, b"a"), (OID_A, b"b")),
            "ausente": OID_A + b" missing\n",
            "nao-e-blob": OID_A + b" tree 1\nx\n" + cat_file_saida((OID_B, b"b")),
            "tamanho-nao-numerico": OID_A + b" blob xx\na\n",
            "sem-quebra-no-fim": OID_A + b" blob 1\naX" + cat_file_saida((OID_B, b"b")),
            "vazia": b"",
        }
        for nome, saida in ruins.items():
            shutil.rmtree(self.destino)
            self.destino.mkdir()
            with self.assertRaises(exportar.ExportInvalido, msg=nome):
                self.exportar(GitFalso(ls, saida))

    def test_caminho_duplicado_e_componente_que_e_arquivo_abortam(self):
        casos = [
            ls_tree_saida((b"100644", "a", OID_A), (b"100644", "a", OID_A)),
            ls_tree_saida((b"100644", "a", OID_A), (b"100644", "a/b", OID_A)),
        ]
        for ls in casos:
            shutil.rmtree(self.destino)
            self.destino.mkdir()
            with self.assertRaises(exportar.ExportInvalido):
                self.exportar(GitFalso(ls, cat_file_saida((OID_A, b"x"))))

    def test_symlink_vazio_ou_com_nul_aborta(self):
        for alvo in (b"", b"a\0b"):
            shutil.rmtree(self.destino)
            self.destino.mkdir()
            with self.assertRaises(exportar.ExportInvalido, msg=alvo):
                self.exportar(GitFalso(ls_tree_saida((b"120000", "l", OID_A)), cat_file_saida((OID_A, alvo))))

    def test_git_com_falha_levanta_com_codigo_e_saida(self):
        with self.assertRaises(exportar.GitFalhou) as ctx:
            self.exportar(GitFalso(falha_ls=proc_bytes(b"", 128, b"fatal: bad object\n")))
        self.assertEqual((ctx.exception.codigo, ctx.exception.saida), (128, "fatal: bad object\n"))
        git = GitFalso(ls_tree_saida((b"100644", "a", OID_A)), falha_cat=proc_bytes(b"", 1, b"erro cat"))
        with self.assertRaises(exportar.GitFalhou) as ctx:
            self.exportar(git)
        self.assertEqual((ctx.exception.codigo, ctx.exception.saida), (1, "erro cat"))

    def test_saida_nao_binaria_do_git_aborta(self):
        with self.assertRaises(exportar.ExportInvalido):
            self.exportar(lambda argv, **kw: types.SimpleNamespace(returncode=0, stdout="texto", stderr=b""))

    def test_timeout_do_git_propaga(self):
        def lento(argv, **kwargs):
            raise subprocess.TimeoutExpired(argv, 1)

        with self.assertRaises(subprocess.TimeoutExpired):
            self.exportar(lento)

    def test_modulo_importa_so_com_biblioteca_padrao_em_modo_isolado(self):
        resultado = subprocess.run(
            [sys.executable, "-I", "-c", "import sys; sys.path.insert(0, %r); import exportar" % str(RAIZ)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(resultado.returncode, 0, resultado.stderr)


def git(cwd, *args, entrada=None):
    base = ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"]
    return subprocess.run(
        base + list(args), cwd=cwd, check=True, capture_output=True, text=True, input=entrada
    ).stdout.strip()


class TestesExportarComGitReal(unittest.TestCase):
    """Usa o `git` de verdade, só com repositórios locais em diretórios temporários."""

    def setUp(self):
        base = tempfile.TemporaryDirectory()
        self.addCleanup(base.cleanup)
        patcher = mock.patch.dict(
            os.environ, {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"}
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.base = pathlib.Path(base.name).resolve()
        self.repo = self.base / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "--quiet", "-b", "main")
        self.destino = self.base / "destino"
        self.destino.mkdir()

    def commitar(self, arquivos, mensagem="c"):
        for nome, conteudo in arquivos.items():
            caminho = self.repo / nome
            caminho.parent.mkdir(parents=True, exist_ok=True)
            caminho.write_bytes(conteudo if isinstance(conteudo, bytes) else conteudo.encode())
            git(self.repo, "add", nome)
        git(self.repo, "commit", "--quiet", "-m", mensagem)
        return git(self.repo, "rev-parse", "HEAD")

    def exportar(self, sha):
        return exportar.exportar(self.repo, sha, self.destino)

    def ler(self, nome):
        return (self.destino / nome).read_bytes()

    def test_exporta_arvore_completa_com_modos_links_e_nomes_estranhos(self):
        (self.repo / "run.sh").write_text("#!/bin/sh\n")
        (self.repo / "run.sh").chmod(0o755)
        os.symlink("a.txt", self.repo / "lnk")
        sha = self.commitar({"a.txt": "a", "dir/fundo/b.bin": b"\0\1\2\n\r\n", "nome com espaço/ç é.txt": "u"})
        git(self.repo, "add", "run.sh", "lnk")
        git(self.repo, "commit", "--quiet", "-m", "exec e link")
        sha = git(self.repo, "rev-parse", "HEAD")
        notas = self.exportar(sha)
        self.assertEqual(notas, [])
        self.assertEqual(self.ler("a.txt"), b"a")
        self.assertEqual(self.ler("dir/fundo/b.bin"), b"\0\1\2\n\r\n")
        self.assertEqual(self.ler("nome com espaço/ç é.txt"), b"u")
        self.assertTrue(os.access(self.destino / "run.sh", os.X_OK))
        self.assertFalse(os.access(self.destino / "a.txt", os.X_OK))
        self.assertTrue(os.path.islink(self.destino / "lnk"))
        self.assertEqual(os.readlink(self.destino / "lnk"), "a.txt")
        self.assertFalse((self.destino / ".git").exists())

    def test_refs_replace_plantado_nao_muda_o_conteudo_exportado(self):
        sha_a = self.commitar({"a.txt": "A", "so-em-a.txt": "x"}, "A")
        git(self.repo, "rm", "--quiet", "so-em-a.txt")
        sha_b = self.commitar({"a.txt": "B"}, "B")
        # Substitui o commit A pelo B: sem GIT_NO_REPLACE_OBJECTS, `ls-tree A` leria a árvore de B.
        git(self.repo, "replace", sha_a, sha_b)
        controle = subprocess.run(
            ["git", "ls-tree", "-r", "--name-only", sha_a], cwd=self.repo, capture_output=True, text=True
        ).stdout
        self.assertNotIn("so-em-a.txt", controle, "o replace deveria estar ativo no controle")
        self.exportar(sha_a)
        self.assertEqual(self.ler("a.txt"), b"A")
        self.assertEqual(self.ler("so-em-a.txt"), b"x")

    def test_replace_de_blob_plantado_nao_muda_o_conteudo(self):
        sha = self.commitar({"a.txt": "original", "b.txt": "outro conteudo"})
        blob_a = git(self.repo, "rev-parse", sha + ":a.txt")
        blob_b = git(self.repo, "rev-parse", sha + ":b.txt")
        git(self.repo, "replace", blob_a, blob_b)
        self.exportar(sha)
        self.assertEqual(self.ler("a.txt"), b"original")

    def test_gitattributes_filtros_e_config_nao_alteram_nada(self):
        atributos = "\n".join(
            [
                "* text eol=crlf",
                "tests/ export-ignore",
                "ignorado.txt export-ignore",
                "v.txt export-subst",
                "f.txt filter=troca",
                "binario.dat -text",
                "",
            ]
        )
        sha = self.commitar(
            {
                ".gitattributes": atributos,
                "tests/falha.sh": "exit 1\n",
                "ignorado.txt": "i\n",
                "v.txt": "$Format:%H$\n",
                "f.txt": "abc\n",
                "linhas.txt": "um\ndois\n",
                "binario.dat": b"\0\r\n",
            }
        )
        git(self.repo, "config", "filter.troca.smudge", "tr a b")
        git(self.repo, "config", "filter.troca.clean", "tr b a")
        git(self.repo, "config", "core.autocrlf", "true")
        self.exportar(sha)
        self.assertEqual(self.ler("tests/falha.sh"), b"exit 1\n")
        self.assertEqual(self.ler("ignorado.txt"), b"i\n")
        self.assertEqual(self.ler("v.txt"), b"$Format:%H$\n")
        self.assertEqual(self.ler("f.txt"), b"abc\n")
        self.assertEqual(self.ler("linhas.txt"), b"um\ndois\n")
        self.assertEqual(self.ler("binario.dat"), b"\0\r\n")
        self.assertEqual(self.ler(".gitattributes"), atributos.encode())

    def test_info_attributes_do_repositorio_tambem_nao_altera(self):
        sha = self.commitar({"a.txt": "a\n"})
        info = self.repo / ".git" / "info"
        info.mkdir(exist_ok=True)
        (info / "attributes").write_text("* export-ignore eol=crlf\n")
        self.exportar(sha)
        self.assertEqual(self.ler("a.txt"), b"a\n")

    def test_submodulo_real_e_ignorado_com_nota(self):
        sha = self.commitar({"a.txt": "a"})
        git(self.repo, "update-index", "--add", "--cacheinfo", "160000,%s,vendor/sub" % sha)
        git(self.repo, "commit", "--quiet", "-m", "gitlink")
        sha2 = git(self.repo, "rev-parse", "HEAD")
        notas = self.exportar(sha2)
        self.assertEqual(notas, ["submódulo ignorado: vendor/sub"])
        self.assertFalse((self.destino / "vendor").exists())

    def test_symlink_para_fora_no_repositorio_vira_symlink_sem_gravar_atraves_dele(self):
        fora = self.base / "fora"
        fora.mkdir()
        os.symlink("../fora", self.repo / "l")
        git(self.repo, "add", "l")
        git(self.repo, "commit", "--quiet", "-m", "link")
        sha = git(self.repo, "rev-parse", "HEAD")
        self.exportar(sha)
        self.assertTrue(os.path.islink(self.destino / "l"))
        self.assertEqual(list(fora.iterdir()), [])

    def test_sha_inexistente_levanta_git_falhou(self):
        self.commitar({"a.txt": "a"})
        with self.assertRaises(exportar.GitFalhou) as ctx:
            self.exportar("d" * 40)
        self.assertNotEqual(ctx.exception.codigo, 0)

    def test_worktree_vinculado_exporta_tudo_mesmo_com_export_ignore_no_commit(self):
        sha = self.commitar({".gitattributes": "tests/ export-ignore\n", "tests/falha.sh": "exit 1\n", "ok.txt": "ok"})
        arvore = self.base / "arvore-vinculada"
        git(self.repo, "worktree", "add", "--quiet", "--detach", str(arvore), sha)
        try:
            exportar.exportar(arvore, sha, self.destino)
        finally:
            git(self.repo, "worktree", "remove", "--force", str(arvore))
        self.assertEqual(self.ler("tests/falha.sh"), b"exit 1\n")
        self.assertEqual(self.ler("ok.txt"), b"ok")

    def test_arvore_vazia(self):
        git(self.repo, "commit", "--quiet", "--allow-empty", "-m", "vazio")
        sha = git(self.repo, "rev-parse", "HEAD")
        self.assertEqual(self.exportar(sha), [])
        self.assertEqual(list(self.destino.iterdir()), [])

    def test_blob_grande(self):
        dados = os.urandom(3 * 1024 * 1024)
        sha = self.commitar({"grande.bin": dados})
        self.exportar(sha)
        self.assertEqual(self.ler("grande.bin"), dados)


if __name__ == "__main__":
    unittest.main()
