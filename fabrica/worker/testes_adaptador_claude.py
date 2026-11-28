import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone

import adaptador_claude as ad

FALSO = str(pathlib.Path(__file__).resolve().parent / "claude_falso.py")


class MontarComandoTest(unittest.TestCase):
    def test_pedido_vem_logo_depois_de_p_e_modelo_e_explicito(self):
        c = ad.montar_comando("claude", "faça x", "sonnet", "escrita")
        self.assertEqual(c[:3], ["claude", "-p", "faça x"])
        self.assertEqual(c[c.index("--model") + 1], "sonnet")
        self.assertEqual(c[c.index("--output-format") + 1], "stream-json")

    def test_leitura_nega_escrita_e_escrita_permite_o_necessario(self):
        leitura = ad.montar_comando("claude", "x", "opus", "leitura")
        self.assertEqual(leitura[leitura.index("--permission-mode") + 1], "plan")
        negadas = leitura[leitura.index("--disallowedTools") + 1 :]
        for f in ("Edit", "Write", "NotebookEdit", "Bash"):
            self.assertIn(f, negadas)
        escrita = ad.montar_comando("claude", "x", "sonnet", "escrita")
        self.assertEqual(escrita[escrita.index("--permission-mode") + 1], "acceptEdits")
        self.assertIn("Bash", escrita[escrita.index("--allowedTools") + 1 :])

    def test_resume_so_com_sessao(self):
        self.assertNotIn("--resume", ad.montar_comando("claude", "x", "m", "escrita"))
        c = ad.montar_comando("claude", "x", "m", "escrita", sessao="s1")
        self.assertEqual(c[c.index("--resume") + 1], "s1")

    def test_modo_desconhecido_e_recusado(self):
        with self.assertRaises(ValueError):
            ad.montar_comando("claude", "x", "m", "tudo")


class AmbienteTest(unittest.TestCase):
    def test_tira_credenciais_e_variaveis_da_fabrica(self):
        base = {
            "PATH": "/bin", "HOME": "/h", "LANG": "C", "GITHUB_TOKEN": "t", "GH_TOKEN": "t",
            "FABRICA_WORKER_TOKEN": "t", "AWS_SECRET": "t", "CLAUDE_CONFIG_DIR": "/c",
        }
        self.assertEqual(
            ad.ambiente_do_agente(base),
            {"PATH": "/bin", "HOME": "/h", "LANG": "C", "CLAUDE_CONFIG_DIR": "/c"},
        )


class RodarTest(unittest.TestCase):
    def setUp(self):
        self.cwd = tempfile.mkdtemp()
        self.agora = datetime(2026, 11, 28, 12, 0, tzinfo=timezone.utc)

    def rodar(self, pedido, prazo_s=30, cancelar=None, ambiente=None):
        comando = [sys.executable, FALSO, *ad.montar_comando("claude", pedido, "m", "escrita")[1:]]
        return ad.rodar(
            comando, self.cwd, ambiente or {"PATH": os.environ["PATH"]}, prazo_s,
            cancelar or threading.Event(), agora=lambda: self.agora,
        )

    def test_ok_traz_sessao_uso_e_custo(self):
        s = self.rodar("tudo certo")
        self.assertEqual(s.tipo, "ok")
        self.assertEqual(s.sessao, "sessao-falsa-1")
        self.assertEqual(s.uso, {"input_tokens": 10, "output_tokens": 5})
        self.assertEqual(s.custo_usd, 0.0123)
        self.assertTrue(s.texto.startswith("pronto"))

    def test_escreve_no_workspace(self):
        self.assertEqual(self.rodar("ESCREVE").tipo, "ok")
        self.assertTrue((pathlib.Path(self.cwd) / "feito.txt").exists())

    def test_limite_de_uso_com_retorno(self):
        s = self.rodar("LIMITE")
        self.assertEqual(s.tipo, "limite_de_uso")
        self.assertEqual(s.retorno_em, "2026-11-28T14:00:00+00:00")

    def test_modelo_invalido_e_erro_de_configuracao(self):
        s = self.rodar("MODELO")
        self.assertEqual(s.tipo, "erro_de_configuracao")
        self.assertIn("selected model", s.motivo)

    def test_saida_sem_resultado_e_falha_tecnica(self):
        s = self.rodar("QUEBRA")
        self.assertEqual(s.tipo, "falha_tecnica")
        self.assertIn("código 3", s.motivo)

    def test_prazo_estourado_e_falha_tecnica_sem_processo_sobrando(self):
        inicio = time.monotonic()
        s = self.rodar("DEMORA", prazo_s=1)
        self.assertEqual((s.tipo, s.motivo), ("falha_tecnica", "prazo de 1 s estourado"))
        self.assertLess(time.monotonic() - inicio, 15)
        self.assertEqual(subprocess.run(["pgrep", "-f", "DEMORA"], capture_output=True).stdout, b"")

    def test_cancelamento(self):
        cancelar = threading.Event()
        threading.Timer(1, cancelar.set).start()
        s = self.rodar("DEMORA", cancelar=cancelar)
        self.assertEqual(s.tipo, "cancelada")
        self.assertEqual(subprocess.run(["pgrep", "-f", "DEMORA"], capture_output=True).stdout, b"")

    def test_ambiente_do_processo_e_so_o_que_foi_passado(self):
        s = self.rodar("AMBIENTE", ambiente={"PATH": os.environ["PATH"], "HOME": self.cwd})
        nomes = json.loads(s.texto)
        self.assertNotIn("GITHUB_TOKEN", nomes)
        self.assertTrue(set(nomes) <= {"PATH", "HOME", "LC_CTYPE", "PWD", "__CF_USER_TEXT_ENCODING", "SHLVL", "_"})


if __name__ == "__main__":
    unittest.main()
