import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import conversas_flow  # noqa: E402
import retrato  # noqa: E402
from testes_demandas_flow import Base, Flow, ID, TOKEN  # noqa: E402

OUTRO = "99999999-2222-4333-8444-555555555555"
ATE = "2026-11-21T10:10:00Z"


def conversa(**extra):
    base = {
        "id": ID,
        "repositorio": "dono/cliente",
        "responderA": OUTRO,
        "aguardaDesde": "2026-11-21T10:00:00Z",
        "item": {"chave": "k", "tipo": "pedido", "titulo": "T", "pergunta": "P", "fatos": [], "relato": None, "acoes": ["destino"]},
        "mensagens": [],
    }
    base.update(extra)
    return base


def corpo(conversas, ate=ATE):
    return json.dumps({"conversas": conversas, "ativaAte": ate}).encode()


class TestesConversasFlow(Base):
    def cliente(self, servidor):
        return conversas_flow.ClienteDasConversas(servidor.url, str(self.token_file))

    def test_buscar_conversas_manda_bearer_e_le_conversas_e_ativa_ate(self):
        servidor = self.flow(resposta=corpo([conversa()]))
        r = self.cliente(servidor).buscar_conversas()
        self.assertEqual([c["id"] for c in r["conversas"]], [ID])
        self.assertEqual(r["ativaAte"], ATE)
        ((metodo, caminho, cab, _),) = servidor.recebidos
        self.assertEqual((metodo, caminho), ("GET", "/api/fabrica/conversas"))
        self.assertEqual(cab["Authorization"], "Bearer " + TOKEN)

    def test_buscar_conversas_com_404_devolve_none(self):
        self.assertIsNone(self.cliente(self.flow(codigo=404)).buscar_conversas())

    def test_buscar_conversas_com_outro_codigo_levanta(self):
        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            self.cliente(self.flow(codigo=401)).buscar_conversas()
        self.assertEqual(ctx.exception.codigo, 401)

    def test_buscar_descarta_conversa_torta_e_mantem_as_validas(self):
        item = conversa()["item"]
        tortas = [
            conversa(id="nao-e-uuid"),
            conversa(responderA="x"),
            conversa(repositorio="sem-barra"),
            conversa(item=dict(item, acoes="destino")),
            conversa(item=dict(item, acoes=[1])),
            conversa(mensagens="oi"),
            "texto",
        ]
        r = self.cliente(self.flow(resposta=corpo(tortas + [conversa()]))).buscar_conversas()
        self.assertEqual(len(r["conversas"]), 1)

    def test_buscar_corta_mensagens_nas_30_ultimas(self):
        msgs = [{"id": str(i)} for i in range(45)]
        r = self.cliente(self.flow(resposta=corpo([conversa(mensagens=msgs)]))).buscar_conversas()
        got = r["conversas"][0]["mensagens"]
        self.assertEqual(len(got), conversas_flow.LIMITE_DE_MENSAGENS)
        self.assertEqual(got[0]["id"], "15")
        self.assertEqual(got[-1]["id"], "44")

    def test_ativa_ate_fora_do_formato_vale_none(self):
        for ate in ("ontem", "2026-11-21T10:10:00.000Z", 5, None):
            with self.subTest(ate=ate):
                r = conversas_flow.ler_conversas(corpo([], ate))
                self.assertIsNone(r["ativaAte"])

    def test_ler_conversas_corpo_torto_levanta(self):
        for c in (b"nao json", b"[]", b'{"conversas":{}}'):
            with self.subTest(c=c):
                with self.assertRaises(retrato.FalhaDeEnvio):
                    conversas_flow.ler_conversas(c)

    def test_responder_201_aplicado_200_repetido_410_encerrada_404_encerrada(self):
        for codigo, esperado in ((201, "aplicado"), (200, "repetido"), (410, "encerrada"), (404, "encerrada")):
            with self.subTest(codigo=codigo):
                servidor = self.flow(codigo=codigo, resposta=b"{}")
                self.assertEqual(self.cliente(servidor).responder(ID, {"id": OUTRO}), esperado)
        ((metodo, caminho, cab, enviado),) = servidor.recebidos
        self.assertEqual((metodo, caminho), ("POST", "/api/fabrica/conversas/%s/respostas" % ID))
        self.assertEqual(cab["Content-Type"], "application/json")
        self.assertEqual(json.loads(enviado), {"id": OUTRO})

    def test_responder_409_e_422_recusado_com_o_erro(self):
        for codigo in (409, 422):
            with self.subTest(codigo=codigo):
                c = self.cliente(self.flow(codigo=codigo, resposta='{"erro":"Corpo inválido."}'.encode()))
                self.assertEqual(c.responder(ID, {}), "recusado")
                self.assertEqual(c.ultima_recusa, "Corpo inválido.")
                self.assertIsNone(c.ultimo_motivo_do_cartao)

    def test_responder_422_de_cartao_guarda_o_motivo(self):
        c = self.cliente(self.flow(codigo=422, resposta='{"erro":"Cartão inválido.","campo":"cartao","motivo":"Escolha o tipo."}'.encode()))
        self.assertEqual(c.responder(ID, {}), "recusado")
        self.assertEqual(c.ultimo_motivo_do_cartao, "Escolha o tipo.")
        self.assertEqual(c.ultima_recusa, "Cartão inválido.")

    def test_responder_500_ou_rede_vira_falha_de_envio_sem_o_token(self):
        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            self.cliente(self.flow(codigo=500)).responder(ID, {})
        self.assertNotIn(TOKEN, str(ctx.exception))
        servidor = Flow()
        url = servidor.url
        servidor.parar()
        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            conversas_flow.ClienteDasConversas(url, str(self.token_file)).responder(ID, {})
        self.assertNotIn(TOKEN, str(ctx.exception))

    def test_url_http_fora_de_localhost_e_recusada(self):
        c = conversas_flow.ClienteDasConversas("http://central.exemplo/api/fabrica/estado", str(self.token_file))
        with self.assertRaises(retrato.FalhaDeEnvio):
            c.buscar_conversas()
        with self.assertRaises(retrato.FalhaDeEnvio):
            c.responder(ID, {})


if __name__ == "__main__":
    unittest.main()
