import pathlib
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import atualizar_branch  # noqa: E402


def git(cwd, *args):
    r = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=str(cwd), capture_output=True, text=True, check=True)
    return r.stdout.strip()


class Testes(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        tmp = pathlib.Path(self._tmp.name)
        self.origem = tmp / "origem.git"
        git(tmp, "init", "--quiet", "--bare", "-b", "main", str(self.origem))
        self.autor = tmp / "autor"
        git(tmp, "clone", "--quiet", str(self.origem), str(self.autor))
        git(self.autor, "switch", "--quiet", "-c", "main")
        self.escrever(".gitattributes", ".seeds/issues.jsonl merge=union\n")
        self.escrever(".seeds/issues.jsonl", "base\n")
        self.escrever("codigo.txt", "base\n")
        self.commitar("base")
        git(self.autor, "push", "--quiet", "origin", "main")
        self.clone = tmp / "clone"
        git(tmp, "clone", "--quiet", str(self.origem), str(self.clone))

    def escrever(self, caminho, texto):
        alvo = self.autor / caminho
        alvo.parent.mkdir(parents=True, exist_ok=True)
        alvo.write_text(texto, encoding="utf-8")

    def commitar(self, mensagem):
        git(self.autor, "add", "-A")
        git(self.autor, "commit", "--quiet", "-m", mensagem)

    def divergir(self, no_pr, no_main):
        git(self.autor, "switch", "--quiet", "-c", "pr", "main")
        for caminho, texto in no_pr.items():
            self.escrever(caminho, texto)
        self.commitar("pr")
        git(self.autor, "push", "--quiet", "origin", "pr")
        git(self.autor, "switch", "--quiet", "main")
        for caminho, texto in no_main.items():
            self.escrever(caminho, texto)
        self.commitar("main")
        git(self.autor, "push", "--quiet", "origin", "main")

    def ref(self, nome):
        return git(self.origem, "rev-parse", nome)

    def test_conflito_so_em_seeds_e_resolvido_e_enviado(self):
        self.divergir({".seeds/issues.jsonl": "base\npr\n", "novo.txt": "x\n"}, {".seeds/issues.jsonl": "base\nmain\n"})
        antes = self.ref("pr")
        novo = atualizar_branch.atualizar(self.clone, "pr", "main")
        self.assertEqual(novo, self.ref("pr"))
        self.assertNotEqual(novo, antes)
        pais = git(self.origem, "log", "-1", "--format=%P", "pr").split()
        self.assertEqual(pais, [antes, self.ref("main")])
        conteudo = git(self.origem, "show", "pr:.seeds/issues.jsonl").splitlines()
        self.assertEqual(sorted(conteudo), ["base", "main", "pr"])

    def test_conflito_de_verdade_nao_muda_nada(self):
        self.divergir({"codigo.txt": "pr\n"}, {"codigo.txt": "main\n"})
        antes = self.ref("pr")
        self.assertIsNone(atualizar_branch.atualizar(self.clone, "pr", "main"))
        self.assertEqual(self.ref("pr"), antes)

    def test_nao_deixa_worktree_para_tras(self):
        self.divergir({"codigo.txt": "pr\n"}, {"codigo.txt": "main\n"})
        atualizar_branch.atualizar(self.clone, "pr", "main")
        self.assertEqual(len(git(self.clone, "worktree", "list").splitlines()), 1)

    def test_nada_a_trazer_devolve_none(self):
        git(self.autor, "switch", "--quiet", "-c", "pr", "main")
        self.escrever("novo.txt", "x\n")
        self.commitar("pr")
        git(self.autor, "push", "--quiet", "origin", "pr")
        self.assertIsNone(atualizar_branch.atualizar(self.clone, "pr", "main"))

    def test_branch_inexistente_ou_invalido_devolve_none(self):
        self.assertIsNone(atualizar_branch.atualizar(self.clone, "nao-existe", "main"))
        self.assertIsNone(atualizar_branch.atualizar(self.clone, "--upload-pack=x", "main"))
        self.assertIsNone(atualizar_branch.atualizar(self.clone, "", "main"))

    def test_git_ausente_devolve_none(self):
        def falha(*a, **k):
            raise OSError("sem git")

        self.assertIsNone(atualizar_branch.atualizar(self.clone, "pr", "main", executar=falha))


if __name__ == "__main__":
    unittest.main()
