import pathlib
import subprocess
import tempfile
import unittest

import workspace


def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class WorkspaceTest(unittest.TestCase):
    def setUp(self):
        base = pathlib.Path(tempfile.mkdtemp())
        self.remoto = base / "remoto.git"
        git("init", "-q", "--bare", "-b", "main", str(self.remoto), cwd=base)
        semente = base / "semente"
        git("clone", "-q", str(self.remoto), str(semente), cwd=base)
        (semente / "LEIA.md").write_text("oi\n")
        git("add", "LEIA.md", cwd=semente)
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "inicio", cwd=semente)
        git("push", "-q", "origin", "main", cwd=semente)
        self.ws = workspace.Workspace(base / "raiz")
        self.url = str(self.remoto)

    def test_branch_nova_parte_da_base_e_entrega_chega_no_remoto(self):
        w = self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", "ex1")
        self.assertTrue((w / "LEIA.md").exists())
        self.assertFalse(self.ws.tem_mudancas(w))
        (w / "novo.txt").write_text("x\n")
        self.assertTrue(self.ws.tem_mudancas(w))
        sha = self.ws.entregar(w, "fabrica/abc", "feat: novo", self.url)
        self.assertEqual(git("rev-parse", "fabrica/abc", cwd=self.remoto), sha)
        self.assertEqual(git("log", "-1", "--format=%an", "fabrica/abc", cwd=self.remoto), "Fábrica KusterTech")

    def test_branch_existente_continua_de_onde_parou(self):
        w = self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", "ex1")
        (w / "a.txt").write_text("a\n")
        self.ws.entregar(w, "fabrica/abc", "a", self.url)
        self.ws.limpar(w)
        w2 = self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", "ex2")
        self.assertTrue((w2 / "a.txt").exists())

    def test_limpar_remove_a_worktree(self):
        w = self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", "ex1")
        self.ws.limpar(w)
        self.assertFalse(w.exists())

    def test_preparar_de_novo_a_mesma_execucao_recomeca_limpo(self):
        w = self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", "ex1")
        (w / "lixo.txt").write_text("x")
        w = self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", "ex1")
        self.assertFalse((w / "lixo.txt").exists())

    def test_credencial_nao_fica_gravada_em_nenhum_arquivo(self):
        cab = workspace.cabecalho_do_token("segredo123")
        w = self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", "ex1", cabecalho=cab)
        (w / "n.txt").write_text("n")
        self.ws.entregar(w, "fabrica/abc", "n", self.url, cabecalho=cab)
        segredo = cab.split()[-1]
        for arquivo in self.ws.raiz.rglob("*"):
            if arquivo.is_file():
                self.assertNotIn(segredo.encode(), arquivo.read_bytes(), str(arquivo))

if __name__ == "__main__":
    unittest.main()
