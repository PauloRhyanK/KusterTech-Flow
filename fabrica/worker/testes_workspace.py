import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

import workspace

EX1 = "11111111-aaaa-4bbb-8ccc-000000000001"
EX2 = "11111111-aaaa-4bbb-8ccc-000000000002"


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

    def preparar(self, execucao=EX1):
        c = self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", execucao)
        self.ws.levar_ao_agente(c)
        return c

    def agente(self, c):
        return self.ws.agente.pasta(c.execucao_id)

    def test_agente_recebe_so_os_arquivos_sem_git(self):
        c = self.preparar()
        self.assertTrue((self.agente(c) / "LEIA.md").exists())
        self.assertFalse((self.agente(c) / ".git").exists())
        self.assertFalse(self.ws.tem_mudancas(c))

    def test_entrega_leva_criados_alterados_e_removidos(self):
        c = self.preparar()
        (self.agente(c) / "novo.txt").write_text("x\n")
        (self.agente(c) / "LEIA.md").write_text("mudou\n")
        (self.agente(c) / "velho.txt").unlink()
        self.assertTrue(self.ws.tem_mudancas(c))
        sha = self.ws.entregar(c, "fabrica/abc", "feat: novo", self.url)
        self.assertEqual(git("rev-parse", "fabrica/abc", cwd=self.remoto), sha)
        arquivos = git("ls-tree", "-r", "--name-only", "fabrica/abc", cwd=self.remoto).split()
        self.assertEqual(sorted(arquivos), ["LEIA.md", "novo.txt"])
        self.assertEqual(git("log", "-1", "--format=%an", "fabrica/abc", cwd=self.remoto), "Fábrica KusterTech")

    def test_repositorio_aninhado_criado_pelo_agente_nao_entra(self):
        c = self.preparar()
        (self.agente(c) / "sub" / ".git").mkdir(parents=True)
        (self.agente(c) / "sub" / ".git" / "config").write_text("[core]\n")
        (self.agente(c) / "sub" / "a.txt").write_text("a\n")
        self.ws.tem_mudancas(c)
        self.ws.entregar(c, "fabrica/abc", "sub", self.url)
        arquivos = git("ls-tree", "-r", "--name-only", "fabrica/abc", cwd=self.remoto).split()
        self.assertIn("sub/a.txt", arquivos)
        self.assertNotIn("sub/.git/config", arquivos)

    def test_atalho_para_fora_plantado_pelo_agente_nao_entra(self):
        c = self.preparar()
        segredo = self.ws.raiz / "segredo"
        segredo.write_text("token")
        (self.agente(c) / "vaza").symlink_to(segredo)
        with self.assertRaises(Exception):
            self.ws.tem_mudancas(c)
        self.assertFalse((c.limpa / "vaza").exists())

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
        (self.agente(c) / "n.txt").write_text("n\n")
        self.ws.tem_mudancas(c)
        self.ws.entregar(c, "fabrica/abc", "n", self.url)
        self.assertFalse(marca.exists())

    def test_branch_existente_continua_de_onde_parou(self):
        c = self.preparar()
        (self.agente(c) / "a.txt").write_text("a\n")
        self.ws.tem_mudancas(c)
        self.ws.entregar(c, "fabrica/abc", "a", self.url)
        self.ws.limpar(c)
        c2 = self.preparar(EX2)
        self.assertTrue((self.agente(c2) / "a.txt").exists())

    def test_limpar_e_limpar_tudo(self):
        c = self.preparar()
        self.ws.limpar(c)
        self.assertFalse(self.agente(c).exists() or c.limpa.exists())
        c = self.preparar(EX2)
        self.ws.limpar_tudo()
        self.assertFalse(self.agente(c).exists() or c.limpa.exists())

    def test_preparar_de_novo_a_mesma_execucao_recomeca_limpo(self):
        c = self.preparar()
        (self.agente(c) / "lixo.txt").write_text("x")
        c = self.preparar()
        self.assertFalse((self.agente(c) / "lixo.txt").exists())

    def test_id_invalido_e_recusado(self):
        with self.assertRaises(Exception):
            self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", "../../x")

    def test_credencial_nao_vai_em_argumento_nem_fica_em_arquivo(self):
        chamadas = []
        original = subprocess.run

        def espiar(args, *a, **k):
            chamadas.append((list(args), dict(k.get("env") or {})))
            return original(args, *a, **k)

        cab = workspace.cabecalho_do_token("segredo123")
        with mock.patch.object(workspace.subprocess, "run", espiar):
            c = self.ws.preparar(self.url, "dono/repo", "fabrica/abc", "main", EX1, cab)
            self.ws.levar_ao_agente(c)
            (self.agente(c) / "n.txt").write_text("n")
            self.ws.tem_mudancas(c)
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


class AgenteIsoladoTest(unittest.TestCase):
    def setUp(self):
        self.chamadas = []
        self.agente = workspace.AgenteIsolado("fabrica", auxiliar="/usr/local/sbin/fabrica-agente")

    def espiar(self, args, *a, **k):
        self.chamadas.append((list(args), k.get("input")))
        return subprocess.CompletedProcess(args, 0, b"PACOTE", b"")

    def test_tudo_passa_pelo_auxiliar_via_sudo(self):
        with mock.patch.object(workspace.subprocess, "run", self.espiar):
            self.agente.receber(EX1, b"tar")
            self.assertEqual(self.agente.entregar(EX1), b"PACOTE")
            self.agente.limpar(EX1)
            self.agente.matar()
        prefixo = ["sudo", "-n", "-u", "fabrica", "/usr/local/sbin/fabrica-agente"]
        self.assertEqual(
            self.chamadas,
            [
                ([*prefixo, "preparar", EX1], b"tar"),
                ([*prefixo, "entregar", EX1], b""),
                ([*prefixo, "limpar", EX1], b""),
                ([*prefixo, "matar"], b""),
            ],
        )

    def test_comando_roda_pelo_auxiliar_fora_da_pasta(self):
        cmd, cwd = self.agente.comando(EX1, ["/opt/claude/claude-2", "-p", "x"])
        self.assertEqual(cmd[:7], ["sudo", "-n", "-u", "fabrica", "/usr/local/sbin/fabrica-agente", "rodar", EX1])
        self.assertEqual(cwd, "/")

    def test_falha_do_auxiliar_vira_erro_sem_detalhe(self):
        with mock.patch.object(
            workspace.subprocess, "run", return_value=subprocess.CompletedProcess([], 2, b"", b"segredo")
        ):
            with self.assertRaises(workspace.ErroDoAgente) as ctx:
                self.agente.entregar(EX1)
        self.assertNotIn("segredo", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
