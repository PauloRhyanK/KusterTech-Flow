import http.server
import json
import pathlib
import sys
import tempfile
import threading
import unittest
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import demandas_flow  # noqa: E402
import retrato  # noqa: E402

TOKEN = "tok-de-demandas-0123456789"
ID = "11111111-2222-4333-8444-555555555555"
CENTRAL = "https://central.exemplo/api/fabrica/estado"


def demanda(**extra):
    base = {
        "id": ID,
        "repositorio": "dono/cliente",
        "titulo": "Ajustar",
        "etapas": [{"chave": "plano", "marco": None}],
        "etapaAtual": {"chave": "plano", "marco": None},
    }
    base.update(extra)
    return base


class Flow(http.server.ThreadingHTTPServer):
    def __init__(self, codigo=200, resposta=b"{}"):
        self.codigo, self.resposta, self.recebidos = codigo, resposta, []
        super().__init__(("127.0.0.1", 0), self.Tratador)
        threading.Thread(target=self.serve_forever, daemon=True).start()

    @property
    def url(self):
        return "http://127.0.0.1:%d/api/fabrica/estado" % self.server_address[1]

    class Tratador(http.server.BaseHTTPRequestHandler):
        def _tratar(self):
            corpo = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            self.server.recebidos.append((self.command, self.path, dict(self.headers), corpo))
            self.send_response(self.server.codigo)
            self.send_header("Content-Length", str(len(self.server.resposta)))
            self.end_headers()
            self.wfile.write(self.server.resposta)

        do_GET = do_POST = _tratar

        def log_message(self, *_):
            pass

    def parar(self):
        self.shutdown()
        self.server_close()


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.token_file = pathlib.Path(self._tmp.name) / "token"
        self.token_file.write_text(TOKEN + "\n", encoding="utf-8")

    def flow(self, **kw):
        servidor = Flow(**kw)
        self.addCleanup(servidor.parar)
        return servidor

    def cliente(self, servidor):
        return demandas_flow.ClienteDoFlow(servidor.url, str(self.token_file))


class TestesDemandasFlow(Base):
    def test_url_da_rota_troca_o_caminho_e_junta_partes(self):
        self.assertEqual(demandas_flow.url_da_rota(CENTRAL), "https://central.exemplo/api/fabrica/demandas")
        self.assertEqual(
            demandas_flow.url_da_rota(CENTRAL, ID, "eventos"),
            "https://central.exemplo/api/fabrica/demandas/%s/eventos" % ID,
        )

    def test_url_da_rota_aceita_outro_caminho_e_o_padrao_nao_muda(self):
        self.assertEqual(
            demandas_flow.url_da_rota(CENTRAL, ID, "respostas", caminho="/api/fabrica/conversas"),
            "https://central.exemplo/api/fabrica/conversas/%s/respostas" % ID,
        )
        self.assertEqual(demandas_flow.url_da_rota(CENTRAL, ID), "https://central.exemplo/api/fabrica/demandas/%s" % ID)

    def test_buscar_manda_desde_e_bearer_e_le_cursor_mais_e_demandas(self):
        corpo = json.dumps({"cursor": "12", "mais": True, "demandas": [demanda()]}).encode()
        servidor = self.flow(resposta=corpo)
        r = self.cliente(servidor).buscar("7")
        self.assertEqual(r["cursor"], "12")
        self.assertIs(r["mais"], True)
        self.assertEqual(r["demandas"][0]["id"], ID)
        ((metodo, caminho, cab, _),) = servidor.recebidos
        self.assertEqual(metodo, "GET")
        self.assertEqual(caminho, "/api/fabrica/demandas?desde=7")
        self.assertEqual(cab["Authorization"], "Bearer " + TOKEN)

    def test_buscar_sem_cursor_nao_manda_desde(self):
        servidor = self.flow(resposta=b'{"cursor":"0","mais":false,"demandas":[]}')
        self.cliente(servidor).buscar(None)
        self.assertEqual(servidor.recebidos[0][1], "/api/fabrica/demandas")

    def test_buscar_com_404_devolve_none(self):
        self.assertIsNone(self.cliente(self.flow(codigo=404)).buscar(None))

    def test_buscar_com_outras_falhas_levanta_com_a_categoria(self):
        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            self.cliente(self.flow(codigo=401)).buscar(None)
        self.assertEqual(ctx.exception.codigo, 401)

    def test_buscar_descarta_demanda_torta_e_mantem_as_validas(self):
        tortas = [
            demanda(id="nao-e-uuid"),
            demanda(repositorio="sem-barra"),
            demanda(etapas=[{"marco": None}]),
            {k: v for k, v in demanda().items() if k != "etapaAtual"},
            "texto",
        ]
        corpo = json.dumps({"cursor": "3", "mais": False, "demandas": tortas + [demanda()]}).encode()
        r = self.cliente(self.flow(resposta=corpo)).buscar(None)
        self.assertEqual([d["id"] for d in r["demandas"]], [ID])

    def test_ler_resposta_recusa_cursor_invalido_e_corpo_ilegivel(self):
        for corpo in (
            b'{"cursor":"abc","mais":false,"demandas":[]}',
            b'{"cursor":5,"mais":false,"demandas":[]}',
            b'{"cursor":"1","mais":"sim","demandas":[]}',
            b'{"cursor":"1","mais":false,"demandas":{}}',
            b"nao json",
            b"[]",
        ):
            with self.subTest(corpo=corpo):
                with self.assertRaises(retrato.FalhaDeEnvio):
                    demandas_flow.ler_resposta(corpo)

    def test_enviar_evento_201_aplicado_200_repetido_422_recusado_com_o_erro(self):
        evento = {"id": ID, "em": "2026-11-19T10:00:00Z", "tipo": "destravada", "dados": {}}
        for codigo, esperado in ((201, "aplicado"), (200, "repetido")):
            with self.subTest(codigo=codigo):
                servidor = self.flow(codigo=codigo, resposta=b'{"resultado":"x"}')
                self.assertEqual(self.cliente(servidor).enviar_evento(ID, evento), esperado)
                metodo, caminho, cab, corpo = servidor.recebidos[0]
                self.assertEqual((metodo, caminho), ("POST", "/api/fabrica/demandas/%s/eventos" % ID))
                self.assertEqual(cab["Content-Type"], "application/json")
                self.assertEqual(json.loads(corpo), evento)
        for codigo in demandas_flow.RECUSAS_DEFINITIVAS:
            with self.subTest(codigo=codigo):
                cliente = self.cliente(self.flow(codigo=codigo, resposta='{"erro":"Etapa já feita."}'.encode()))
                self.assertEqual(cliente.enviar_evento(ID, evento), "recusado")
                self.assertEqual(cliente.ultima_recusa, "Etapa já feita.")

    def test_enviar_evento_500_ou_rede_vira_falha_de_envio_sem_o_token(self):
        evento = {"id": ID}
        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            self.cliente(self.flow(codigo=500)).enviar_evento(ID, evento)
        self.assertEqual(ctx.exception.codigo, 500)
        servidor = self.flow()
        servidor.parar()
        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            self.cliente(servidor).enviar_evento(ID, evento)
        self.assertNotIn(TOKEN, str(ctx.exception))
        sem_arquivo = demandas_flow.ClienteDoFlow(servidor.url, str(self.token_file) + ".nao")
        with self.assertRaises(retrato.FalhaDeEnvio):
            sem_arquivo.enviar_evento(ID, evento)

    def test_enviar_arquivo_manda_query_id_tipo_nome_tela_content_type_e_length(self):
        servidor = self.flow(codigo=201, resposta=b'{"id":"x","tamanho":3}')
        r = self.cliente(servidor).enviar_arquivo(
            ID, id_=ID, tipo="captura", nome="tela 1.png", conteudo="image/png", dados=b"\x89PN", tela="desktop"
        )
        self.assertEqual(r, "aplicado")
        metodo, caminho, cab, corpo = servidor.recebidos[0]
        partes = urllib.parse.urlsplit(caminho)
        self.assertEqual(partes.path, "/api/fabrica/demandas/%s/arquivos" % ID)
        self.assertEqual(
            urllib.parse.parse_qs(partes.query),
            {"id": [ID], "tipo": ["captura"], "nome": ["tela 1.png"], "tela": ["desktop"]},
        )
        self.assertEqual(cab["Content-Type"], "image/png")
        self.assertEqual(cab["Content-Length"], "3")
        self.assertEqual(corpo, b"\x89PN")

    def test_enviar_arquivo_sem_tela_nao_manda_tela_e_200_e_repetido(self):
        servidor = self.flow(codigo=200)
        r = self.cliente(servidor).enviar_arquivo(
            ID, id_=ID, tipo="desenho", nome="d.md", conteudo="text/markdown", dados=b"", tela=None
        )
        self.assertEqual(r, "repetido")
        self.assertNotIn("tela", servidor.recebidos[0][1])
        self.assertEqual(servidor.recebidos[0][2]["Content-Length"], "0")

    def test_url_http_fora_de_localhost_e_recusada(self):
        cliente = demandas_flow.ClienteDoFlow("http://central.exemplo/api/fabrica/estado", str(self.token_file))
        with self.assertRaises(retrato.FalhaDeEnvio):
            cliente.buscar(None)
        with self.assertRaises(retrato.FalhaDeEnvio):
            cliente.enviar_evento(ID, {})

    def test_redirecionamento_e_falha(self):
        with self.assertRaises(retrato.FalhaDeEnvio):
            self.cliente(self.flow(codigo=302)).buscar(None)


if __name__ == "__main__":
    unittest.main()
