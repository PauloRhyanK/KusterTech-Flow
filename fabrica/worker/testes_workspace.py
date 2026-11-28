import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

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
        (semente / "velho.txt").write_text("v\n")
        git("add", "LEIA.md", "velho.txt", cwd=semente)
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "inicio", cwd=semente)
        git("push", "-q", "origin", "main", cwd=semente)
        self.ws = workspace.Workspace(base / "raiz")
        self.url = str(self.remoto)

    def preparar(self, execucao="ex1"):
        return self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", execucao)

    def test_agente_recebe_so_os_arquivos_sem_git(self):
        c = self.preparar()
        self.assertTrue((c.agente / "LEIA.md").exists())
        self.assertFalse((c.agente / ".git").exists())
        self.assertFalse(self.ws.tem_mudancas(c))

    def test_entrega_leva_criados_alterados_e_removidos(self):
        c = self.preparar()
        (c.agente / "novo.txt").write_text("x\n")
        (c.agente / "LEIA.md").write_text("mudou\n")
        (c.agente / "velho.txt").unlink()
        self.assertTrue(self.ws.tem_mudancas(c))
        sha = self.ws.entregar(c, "fabrica/abc", "feat: novo", self.url)
        self.assertEqual(git("rev-parse", "fabrica/abc", cwd=self.remoto), sha)
        arquivos = git("ls-tree", "-r", "--name-only", "fabrica/abc", cwd=self.remoto).split()
        self.assertEqual(sorted(arquivos), ["LEIA.md", "novo.txt"])
        self.assertEqual(git("log", "-1", "--format=%an", "fabrica/abc", cwd=self.remoto), "Fábrica KusterTech")

    def test_repositorio_aninhado_criado_pelo_agente_nao_entra(self):
        c = self.preparar()
        (c.agente / "sub" / ".git").mkdir(parents=True)
        (c.agente / "sub" / ".git" / "config").write_text("[core]\n")
        (c.agente / "sub" / "a.txt").write_text("a\n")
        self.ws.entregar(c, "fabrica/abc", "sub", self.url)
        arquivos = git("ls-tree", "-r", "--name-only", "fabrica/abc", cwd=self.remoto).split()
        self.assertIn("sub/a.txt", arquivos)
        self.assertNotIn("sub/.git/config", arquivos)

    def test_hooks_nao_rodam_na_entrega(self):
        c = self.preparar()
        hooks = pathlib.Path(git("rev-parse", "--git-common-dir", cwd=c.limpa))
        if not hooks.is_absolute():
            hooks = c.limpa / hooks
        marca = c.limpa.parent / "hook-rodou"
        for nome in ("pre-commit", "pre-push", "post-commit"):
            h = hooks / "hooks" / nome
            h.parent.mkdir(parents=True, exist_ok=True)
            h.write_text(f"#!/bin/sh\ntouch {marca}\n")
            h.chmod(0o755)
        (c.agente / "n.txt").write_text("n\n")
        self.ws.entregar(c, "fabrica/abc", "n", self.url)
        self.assertFalse(marca.exists())

    def test_branch_existente_continua_de_onde_parou(self):
        c = self.preparar()
        (c.agente / "a.txt").write_text("a\n")
        self.ws.entregar(c, "fabrica/abc", "a", self.url)
        self.ws.limpar(c)
        c2 = self.preparar("ex2")
        self.assertTrue((c2.agente / "a.txt").exists())

    def test_limpar_e_limpar_tudo(self):
        c = self.preparar()
        self.ws.limpar(c)
        self.assertFalse(c.agente.exists() or c.limpa.exists())
        c = self.preparar("ex3")
        self.ws.limpar_tudo()
        self.assertFalse(c.agente.exists() or c.limpa.exists())

    def test_preparar_de_novo_a_mesma_execucao_recomeca_limpo(self):
        c = self.preparar()
        (c.agente / "lixo.txt").write_text("x")
        c = self.preparar()
        self.assertFalse((c.agente / "lixo.txt").exists())

    def test_credencial_nao_vai_em_argumento_nem_fica_em_arquivo(self):
        chamadas = []
        original = subprocess.run

        def espiar(args, *a, **k):
            chamadas.append((list(args), dict(k.get("env") or {})))
            return original(args, *a, **k)

        cab = workspace.cabecalho_do_token("segredo123")
        with mock.patch.object(workspace.subprocess, "run", espiar):
            c = self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", "ex1", cab)
            (c.agente / "n.txt").write_text("n")
            self.ws.entregar(c, "fabrica/abc", "n", self.url, cab)
        segredo = cab.split()[-1]
        self.assertFalse(any(segredo in " ".join(args) for args, _ in chamadas))
        self.assertTrue(any(segredo in env.get("GIT_CONFIG_VALUE_0", "") for _, env in chamadas))
        for arquivo in self.ws.raiz.rglob("*"):
            if arquivo.is_file():
                self.assertNotIn(segredo.encode(), arquivo.read_bytes(), str(arquivo))

    def test_git_tem_prazo(self):
        with mock.patch.object(workspace.subprocess, "run", side_effect=subprocess.TimeoutExpired("git", 1)):
            with self.assertRaises(workspace.ErroDeGit):
                self.preparar()


class UsuarioDoAgenteTest(unittest.TestCase):
    def setUp(self):
        base = pathlib.Path(tempfile.mkdtemp())
        self.remoto = base / "remoto.git"
        git("init", "-q", "--bare", "-b", "main", str(self.remoto), cwd=base)
        semente = base / "semente"
        git("clone", "-q", str(self.remoto), str(semente), cwd=base)
        (semente / "src").mkdir()
        (semente / "src" / "a.ts").write_text("a\n")
        git("add", "-A", cwd=semente)
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "inicio", cwd=semente)
        git("push", "-q", "origin", "main", cwd=semente)
        self.pasta = base / "agente-separado"
        self.chamadas = []
        self.ws = workspace.Workspace(base / "raiz", pasta_do_agente=self.pasta, usuario_do_agente="fabrica")
        self.ws._como_agente = lambda *args: self.chamadas.append(args)

    def test_copia_do_agente_fica_na_pasta_separada_com_grupo_gravavel(self):
        c = self.ws.preparar(str(self.remoto), "dono/repo", "fabrica/abc", "main", "ex1")
        self.assertEqual(c.agente, self.pasta / "ex1")
        for caminho in [c.agente, c.agente / "src", c.agente / "src" / "a.ts"]:
            modo = caminho.stat().st_mode
            self.assertTrue(modo & 0o020, caminho)  # grupo grava
        self.assertTrue((c.agente / "src").stat().st_mode & 0o2000)  # setgid nas pastas

    def test_limpar_apaga_como_o_agente_antes(self):
        c = self.ws.preparar(str(self.remoto), "dono/repo", "fabrica/abc", "main", "ex1")
        self.chamadas.clear()
        self.ws.limpar(c)
        self.assertEqual(self.chamadas, [("rm", "-rf", "--", str(c.agente))])
        self.assertFalse(c.agente.exists())


if __name__ == "__main__":
    unittest.main()
