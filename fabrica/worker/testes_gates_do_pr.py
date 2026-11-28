import json
import pathlib
import subprocess
import tempfile
import threading
import unittest

import adaptador_claude as ad
import gates_do_pr as gates
import workspace

FALSO = str(pathlib.Path(__file__).resolve().parent / "claude_falso.py")


def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class Base(unittest.TestCase):
    def setUp(self):
        base = pathlib.Path(tempfile.mkdtemp())
        self.remoto = base / "remoto.git"
        git("init", "-q", "--bare", "-b", "main", str(self.remoto), cwd=base)
        semente = base / "semente"
        git("clone", "-q", str(self.remoto), str(semente), cwd=base)
        (semente / "LEIA.md").write_text("oi\n")
        (semente / ".fabrica").mkdir()
        (semente / ".fabrica" / "config.json").write_text(json.dumps({"verificacao": {"imagem": "node:22"}}))
        git("add", "-A", cwd=semente)
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "inicio", cwd=semente)
        git("push", "-q", "origin", "main", cwd=semente)
        git("checkout", "-qb", "fabrica/22222222", cwd=semente)
        (semente / "novo.ts").write_text("export const x = 1\n")
        git("add", "novo.ts", cwd=semente)
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "etapa", cwd=semente)
        git("push", "-q", "origin", "fabrica/22222222", cwd=semente)
        self.sha = git("rev-parse", "HEAD", cwd=semente)
        self.ws = workspace.Workspace(base / "raiz")
        self.url = str(self.remoto)

    def tarefa(self, **extra):
        t = {
            "execucaoId": "11111111-aaaa-4bbb-8ccc-000000000001",
            "etapaId": "22222222-aaaa-4bbb-8ccc-000000000002",
            "geracao": 1,
            "tipo": "executar",
            "finalidade": "verificar",
            "sha": self.sha,
            "verificacao": "pnpm test",
            "correcao": None,
            "etapaChave": "rodape",
            "tipoDaEtapa": "implementacao",
            "instrucoes": "Mostre a versão no rodapé.",
            "papel": "verificador",
            "repo": "dono/repo",
            "prUrl": "https://github.com/dono/repo/pull/9",
        }
        t.update(extra)
        return t


class VerificarTest(Base):
    def test_roda_o_comando_no_sha_com_a_config_do_proprio_commit(self):
        chamadas = []

        def verificador(repo_dir, sha, comando, *, conteiner):
            chamadas.append((sha, comando, conteiner, (pathlib.Path(repo_dir) / "novo.ts").exists()))
            return {"sha": sha, "codigo": 0, "saida": "ok"}

        r = gates.verificar(self.tarefa(), self.ws, self.url, "main", None, verificador)
        self.assertEqual(r, {"tipo": "verificacao", "sha": self.sha, "codigo": 0})
        self.assertEqual(chamadas, [(self.sha, "pnpm test", {"imagem": "node:22"}, True)])

    def test_codigo_do_comando_vai_como_evidencia(self):
        r = gates.verificar(self.tarefa(), self.ws, self.url, "main", None, lambda *a, **k: {"sha": self.sha, "codigo": 3})
        self.assertEqual(r["codigo"], 3)

    def test_falha_do_proprio_verificador_e_falha_tecnica(self):
        r = gates.verificar(
            self.tarefa(), self.ws, self.url, "main", None,
            lambda *a, **k: {"sha": self.sha, "codigo": 2, "interno": True, "saida": "docker"},
        )
        self.assertEqual(r["tipo"], "falha_tecnica")

    def test_head_mudou(self):
        r = gates.verificar(self.tarefa(sha="f" * 40), self.ws, self.url, "main", None, lambda *a, **k: 1 / 0)
        self.assertEqual(r, {"tipo": "cancelada"})

    def test_sem_config_de_verificacao_e_erro_de_configuracao(self):
        r = gates.verificar(self.tarefa(), self.ws, self.url, "main", None, lambda *a, **k: 1 / 0, config_do_repo=lambda p: {})
        self.assertEqual(r["tipo"], "erro_de_configuracao")


class OrigemTest(Base):
    def test_copia_limpa_tem_origin_para_o_verificador_do_kit(self):
        copia = self.ws.preparar(self.url, "dono/repo", "fabrica/22222222", "main", "ex9")
        p = subprocess.run(["git", "fetch", "--quiet", "origin"], cwd=copia.limpa, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(git("cat-file", "-t", self.sha, cwd=copia.limpa), "commit")


class RevisarTest(Base):
    def rodar_com(self, texto):
        def rodar(comando, cwd, ambiente, prazo, cancelar):
            self.pedido = comando[comando.index("-p") + 1]
            self.cwd = pathlib.Path(cwd)
            self.diff = (self.cwd / gates.ARQUIVO_DO_DIFF).read_text()
            return ad.Saida("ok", texto=texto)

        return rodar

    def veredito(self, dados):
        return f"análise...\n{gates.prompts.INICIO_VEREDITO}\n{json.dumps(dados)}\n{gates.prompts.FIM_VEREDITO}"

    def test_revisao_cega_com_diff_e_requisitos(self):
        texto = self.veredito({"sha": self.sha, "resultado": "aprovado", "achados": []})
        r = gates.revisar(
            self.tarefa(finalidade="revisar"), self.ws, self.url, "main", None,
            self.rodar_com(texto), "claude", "opus", 60, threading.Event(),
        )
        self.assertEqual(r, {"tipo": "revisao", "sha": self.sha, "veredito": {"resultado": "aprovado", "achados": []}})
        self.assertIn("Mostre a versão no rodapé.", self.pedido)
        self.assertIn(self.sha, self.pedido)
        self.assertIn("novo.ts", self.diff)
        self.assertFalse((self.cwd / ".git").exists())

    def test_veredito_de_outro_sha_ou_ilegivel_e_saida_invalida(self):
        for texto in ("sem bloco", self.veredito({"sha": "x" * 40, "resultado": "aprovado", "achados": []})):
            r = gates.revisar(
                self.tarefa(finalidade="revisar"), self.ws, self.url, "main", None,
                self.rodar_com(texto), "claude", "opus", 60, threading.Event(),
            )
            self.assertEqual(r["tipo"], "saida_invalida")

    def test_achados_sao_limpos_e_limitados(self):
        achados = [{"arquivo": "a" * 400, "motivo": "m" * 2000, "extra": 1}] * 60
        texto = self.veredito({"sha": self.sha, "resultado": "correcoes", "achados": achados})
        r = gates.revisar(
            self.tarefa(finalidade="revisar"), self.ws, self.url, "main", None,
            self.rodar_com(texto), "claude", "opus", 60, threading.Event(),
        )
        a = r["veredito"]["achados"]
        self.assertEqual(len(a), 50)
        self.assertEqual(set(a[0]), {"arquivo", "motivo"})
        self.assertEqual((len(a[0]["arquivo"]), len(a[0]["motivo"])), (300, 1000))


if __name__ == "__main__":
    unittest.main()
