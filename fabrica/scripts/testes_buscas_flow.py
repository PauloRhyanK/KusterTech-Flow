import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import buscas_flow  # noqa: E402
import retrato  # noqa: E402
from testes_demandas_flow import Base, ID, TOKEN  # noqa: E402

DEMANDA = "99999999-2222-4333-8444-555555555555"


def ficha(**extra):
    base = {
        "id": DEMANDA,
        "titulo": "Relatos pelo WhatsApp",
        "projeto": "Flow.ia",
        "clientes": [],
        "tipo": "funcao_nova",
        "estado": "no_ar",
        "criadaEm": "2026-11-20T15:00:00Z",
        "atualizadaEm": "2026-11-21T10:30:00Z",
        "resumo": "Bot",
    }
    base.update(extra)
    return base


def busca(**extra):
    base = {"id": ID, "pergunta": "notificação por WhatsApp", "fichas": [ficha()], "candidatas": 10}
    base.update(extra)
    return json.dumps({"busca": base}).encode()


class TestesBuscasFlow(Base):
    def cliente(self, servidor):
        return buscas_flow.ClienteDasBuscas(servidor.url, str(self.token_file))

    def test_buscar_manda_bearer_e_le_a_busca(self):
        servidor = self.flow(resposta=busca())
        r = self.cliente(servidor).buscar()
        self.assertEqual((r["id"], r["pergunta"], r["candidatas"]), (ID, "notificação por WhatsApp", 10))
        self.assertEqual([f["id"] for f in r["fichas"]], [DEMANDA])
        ((metodo, caminho, cab, _),) = servidor.recebidos
        self.assertEqual((metodo, caminho), ("GET", "/api/fabrica/buscas"))
        self.assertEqual(cab["Authorization"], "Bearer " + TOKEN)

    def test_sem_busca_pendente_devolve_dict_vazio(self):
        self.assertEqual(self.cliente(self.flow(resposta=b'{"busca":null}')).buscar(), {})

    def test_404_e_flow_sem_a_rota(self):
        self.assertIsNone(self.cliente(self.flow(codigo=404)).buscar())

    def test_outro_codigo_levanta(self):
        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            self.cliente(self.flow(codigo=401)).buscar()
        self.assertEqual(ctx.exception.codigo, 401)

    def test_busca_mal_formada_levanta(self):
        for corpo in (b"nao json", b'{"x":1}', busca(fichas="x"), busca(id="nao-uuid"), busca(pergunta=3)):
            with self.subTest(corpo=corpo), self.assertRaises(retrato.FalhaDeEnvio):
                self.cliente(self.flow(resposta=corpo)).buscar()

    def test_ficha_torta_sai_e_as_outras_ficam(self):
        corpo = busca(fichas=[ficha(), ficha(id="x"), "lixo", ficha(titulo=None)])
        self.assertEqual(len(self.cliente(self.flow(resposta=corpo)).buscar()["fichas"]), 1)

    def test_textos_pede_os_ids_e_le_as_demandas(self):
        resposta = json.dumps({"demandas": [{"id": DEMANDA, "titulo": "T", "texto": "X"}, {"id": 1}]}).encode()
        servidor = self.flow(resposta=resposta)
        r = self.cliente(servidor).textos(ID, [DEMANDA, ID])
        self.assertEqual(r, [{"id": DEMANDA, "titulo": "T", "texto": "X"}])
        ((metodo, caminho, _, _),) = servidor.recebidos
        self.assertEqual(metodo, "GET")
        self.assertEqual(caminho, "/api/fabrica/buscas/%s/demandas?ids=%s,%s" % (ID, DEMANDA, ID))

    def test_textos_com_erro_levanta(self):
        with self.assertRaises(retrato.FalhaDeEnvio):
            self.cliente(self.flow(codigo=422, resposta=b"{}")).textos(ID, [DEMANDA])

    def test_responder_manda_o_json_e_mapeia_os_codigos(self):
        casos = {201: "aplicado", 200: "repetido", 409: "recusado", 404: "encerrada", 410: "encerrada"}
        for codigo, esperado in casos.items():
            with self.subTest(codigo=codigo):
                servidor = self.flow(codigo=codigo, resposta=b'{"erro":"x"}')
                self.assertEqual(self.cliente(servidor).responder(ID, {"id": DEMANDA, "falha": "x"}), esperado)
                ((metodo, caminho, cab, corpo),) = servidor.recebidos
                self.assertEqual((metodo, caminho), ("POST", "/api/fabrica/buscas/%s/respostas" % ID))
                self.assertEqual(cab["Content-Type"], "application/json")
                self.assertEqual(json.loads(corpo), {"id": DEMANDA, "falha": "x"})
        with self.assertRaises(retrato.FalhaDeEnvio):
            self.cliente(self.flow(codigo=500)).responder(ID, {"id": DEMANDA, "falha": "x"})


if __name__ == "__main__":
    unittest.main()
