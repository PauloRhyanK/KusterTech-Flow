import io
import os
import pathlib
import tarfile
import tempfile
import unittest
from unittest import mock

import fabrica_agente as fa

ID = "11111111-aaaa-4bbb-8ccc-000000000001"


class PacoteTest(unittest.TestCase):
    def setUp(self):
        self.base = pathlib.Path(tempfile.mkdtemp())

    def test_ida_e_volta_sem_git_e_sem_especiais(self):
        origem = self.base / "o"
        (origem / "src").mkdir(parents=True)
        (origem / "src" / "a.ts").write_text("a")
        (origem / ".git").mkdir()
        (origem / ".git" / "config").write_text("x")
        (origem / "sub" / ".git").mkdir(parents=True)
        (origem / "link").symlink_to("src/a.ts")
        os.mkfifo(origem / "fifo")
        destino = self.base / "d"
        destino.mkdir()
        fa.desempacotar(fa.empacotar(str(origem)), str(destino))
        self.assertEqual((destino / "src" / "a.ts").read_text(), "a")
        self.assertTrue((destino / "link").is_symlink())
        self.assertFalse((destino / ".git").exists())
        self.assertFalse((destino / "sub" / ".git").exists())
        self.assertFalse((destino / "fifo").exists())

    def test_atalho_para_fora_e_recusado_na_extracao(self):
        for alvo in ("/home/devops/.warren-gh-token", "../../fora"):
            with self.subTest(alvo=alvo):
                pacote = io.BytesIO()
                with tarfile.open(fileobj=pacote, mode="w") as tar:
                    info = tarfile.TarInfo("ruim")
                    info.type = tarfile.SYMTYPE
                    info.linkname = alvo
                    tar.addfile(info)
                destino = self.base / f"d{abs(hash(alvo))}"
                destino.mkdir()
                with self.assertRaises(tarfile.FilterError):
                    fa.desempacotar(pacote.getvalue(), str(destino))

    def _pacote_com(self, nome):
        pacote = io.BytesIO()
        with tarfile.open(fileobj=pacote, mode="w") as tar:
            info = tarfile.TarInfo(nome)
            info.size = 1
            tar.addfile(info, io.BytesIO(b"x"))
        return pacote.getvalue()

    def test_caminho_com_ponto_ponto_e_recusado(self):
        destino = self.base / "dd"
        destino.mkdir()
        with self.assertRaises(tarfile.FilterError):
            fa.desempacotar(self._pacote_com("../x"), str(destino))

    def test_caminho_absoluto_cai_dentro_da_pasta(self):
        destino = self.base / "da"
        destino.mkdir()
        fa.desempacotar(self._pacote_com("/etc/x"), str(destino))
        self.assertTrue((destino / "etc" / "x").exists())

    def test_extra_substitui_atalho_do_repositorio_com_o_mesmo_nome(self):
        origem = self.base / "r"
        origem.mkdir()
        (origem / "_DIFF.patch").symlink_to("/home/devops/.bashrc")
        destino = self.base / "rd"
        destino.mkdir()
        fa.desempacotar(fa.empacotar(str(origem), {"_DIFF.patch": "diff"}), str(destino))
        self.assertFalse((destino / "_DIFF.patch").is_symlink())
        self.assertEqual((destino / "_DIFF.patch").read_text(), "diff")


class PrincipalTest(unittest.TestCase):
    def setUp(self):
        self.base = pathlib.Path(tempfile.mkdtemp())

    def test_id_invalido_e_recusado(self):
        for ruim in ("../x", "abc", "11111111-aaaa-4bbb-8ccc-000000000001/../.."):
            with self.subTest(ruim=ruim), self.assertRaises(fa.Recusado):
                fa.principal(["limpar", ruim], base=str(self.base))

    def test_preparar_entregar_limpar(self):
        origem = self.base / "o"
        origem.mkdir()
        (origem / "a.txt").write_text("a")
        with mock.patch.object(fa.sys, "stdin", mock.Mock(buffer=io.BytesIO(fa.empacotar(str(origem))))):
            self.assertEqual(fa.principal(["preparar", ID], base=str(self.base)), 0)
        pasta = self.base / ID
        self.assertEqual(pasta.stat().st_mode & 0o777, 0o700)
        (pasta / "novo.txt").write_text("n")
        saida = io.BytesIO()
        with mock.patch.object(fa.sys, "stdout", mock.Mock(buffer=saida)):
            fa.principal(["entregar", ID], base=str(self.base))
        nomes = tarfile.open(fileobj=io.BytesIO(saida.getvalue())).getnames()
        self.assertEqual(sorted(nomes), ["a.txt", "novo.txt"])
        fa.principal(["limpar", ID], base=str(self.base))
        self.assertFalse(pasta.exists())

    def test_rodar_so_aceita_o_claude_de_opt(self):
        (self.base / ID).mkdir()
        with self.assertRaises(fa.Recusado):
            fa.principal(["rodar", ID, "/bin/sh", "-c", "id"], base=str(self.base))


if __name__ == "__main__":
    unittest.main()
