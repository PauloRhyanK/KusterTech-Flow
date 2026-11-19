import http.server
import json
import pathlib
import sys
import tempfile
import threading
import unittest

RAIZ_DOS_SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ_DOS_SCRIPTS))

import publicar  # noqa: E402
import retrato  # noqa: E402


def estado_com(**seeds):
    return {"seeds": {nome: {"estado": situacao} for nome, situacao in seeds.items()}}


class TestesUrl(unittest.TestCase):
    def test_url_da_rota_troca_o_caminho(self):
        self.assertEqual(publicar.url_da_rota("https://central.exemplo/api/fabrica/estado"), "https://central.exemplo/api/publicacoes")
        self.assertEqual(publicar.url_da_rota("http://localhost:3000/api/fabrica/estado?x=1#y"), "http://localhost:3000/api/publicacoes")

    def test_url_invalida_e_recusada(self):
        for url in ("http://central.exemplo/api/fabrica/estado", "ftp://x/y", "https://u:s@x/y", None):
            with self.assertRaises(retrato.FalhaDeEnvio):
                publicar.url_da_rota(url)


class TestesSeedsNovas(unittest.TestCase):
    def test_so_as_mergeadas_que_ainda_nao_foram_vistas(self):
        estado = estado_com(a="mergeada", b="mergeada", c="em_andamento", d="obsoleta")
        self.assertEqual(publicar.seeds_novas(["a"], estado), ["b"])
        self.assertEqual(publicar.seeds_novas([], estado), ["a", "b"])

    def test_estado_ilegivel_nao_tem_seeds_novas(self):
        for estado in (None, {}, {"seeds": []}, {"seeds": {"a": 3}}):
            self.assertEqual(publicar.seeds_novas([], estado), [])


class _Servidor(http.server.BaseHTTPRequestHandler):
    recebido = []

    def do_POST(self):
        corpo = self.rfile.read(int(self.headers["Content-Length"]))
        _Servidor.recebido.append((self.path, self.headers["Authorization"], json.loads(corpo)))
        self.send_response(201)
        self.end_headers()
        self.wfile.write(b'{"id": "x"}')

    def log_message(self, *_):
        pass


class TestesPedir(unittest.TestCase):
    def test_posta_repositorio_e_descricao_com_o_token_do_arquivo(self):
        _Servidor.recebido = []
        servidor = http.server.HTTPServer(("127.0.0.1", 0), _Servidor)
        threading.Thread(target=servidor.serve_forever, daemon=True).start()
        self.addCleanup(servidor.server_close)
        self.addCleanup(servidor.shutdown)
        with tempfile.TemporaryDirectory() as pasta:
            arquivo = pathlib.Path(pasta) / "token"
            arquivo.write_text("fp_segredo\n", encoding="utf-8")
            url = publicar.url_da_rota("http://127.0.0.1:%d/api/fabrica/estado" % servidor.server_port)
            resposta = publicar.pedir(repo="dono/cliente", descricao="login · s1", url=url, token_file=str(arquivo))
        self.assertEqual(resposta, {"id": "x"})
        self.assertEqual(_Servidor.recebido, [("/api/publicacoes", "Bearer fp_segredo", {"repositorio": "dono/cliente", "descricao": "login · s1"})])

    def test_falha_traz_a_categoria_sem_o_token(self):
        class Erro(Exception):
            pass

        def abrir(req, timeout):
            raise Erro("fp_segredo")

        with tempfile.TemporaryDirectory() as pasta:
            arquivo = pathlib.Path(pasta) / "token"
            arquivo.write_text("fp_segredo", encoding="utf-8")
            with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
                publicar.pedir(repo="a/b", descricao="d", url="https://central.exemplo/api/publicacoes", token_file=str(arquivo), abrir=abrir)
        self.assertNotIn("fp_segredo", str(ctx.exception))
        self.assertIn("Erro", str(ctx.exception))

    def test_token_ausente_e_falha(self):
        with self.assertRaises(retrato.FalhaDeEnvio):
            publicar.pedir(repo="a/b", descricao="d", url="https://central.exemplo/api/publicacoes", token_file="/nao/existe")


if __name__ == "__main__":
    unittest.main()
