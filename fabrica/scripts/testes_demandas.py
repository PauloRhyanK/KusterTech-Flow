import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import demandas  # noqa: E402
import despachante  # noqa: E402
from retrato import FalhaDeEnvio  # noqa: E402

ID = "11111111-2222-4333-8444-555555555555"
OUTRO = "22222222-3333-4444-8555-666666666666"
TERCEIRO = "33333333-4444-4555-8666-777777777777"
AGORA = "2026-11-20T10:00:00Z"

MODELO = [
    {"chave": "recebida", "marco": "recebida"},
    {"chave": "planejada", "marco": "planejada"},
    {"chave": "desenho", "marco": "desenho"},
    {"chave": "desenvolvida", "marco": "desenvolvida"},
    {"chave": "testada", "marco": "testada"},
    {"chave": "entregue", "marco": "entregue"},
]


def retrato(marco="recebida", *, espera=None, etapas=None, **extra):
    etapas = MODELO if etapas is None else etapas
    chave = next((e["chave"] for e in etapas if e["marco"] == marco), marco)
    base = {
        "id": ID,
        "repositorio": "kustertech-exemplo/app",
        "destino": None,
        "nivel": "vai_sozinho",
        "criadaEm": "2026-11-20T09:00:00Z",
        "etapas": etapas,
        "etapaAtual": {"chave": chave, "marco": marco},
        "espera": {"tipo": espera, "motivo": None, "desde": AGORA} if espera else None,
        "encerrada": None,
        "desenho": {"versao": 0, "aprovada": None},
        "ajustes": [],
        "plano": None,
        "eventos": [],
    }
    base.update(extra)
    return base


def item(fase="nova", **extra):
    base = demandas.item_novo()
    base["fase"] = fase
    base.update(extra)
    return base


class ClienteFalso:
    """Registra cada envio e responde pela lista `respostas` (texto ou exceção, levantada depois de registrar)."""

    def __init__(self, *respostas):
        self.respostas, self.enviados, self.ultima_recusa = list(respostas), [], None

    def _responder(self):
        r = self.respostas.pop(0)
        if isinstance(r, BaseException):
            raise r
        if r == "recusado":
            self.ultima_recusa = "Evento fora de ordem."
        return r

    def enviar_evento(self, demanda_id, evento):
        self.enviados.append(("evento", demanda_id, evento["id"], evento))
        return self._responder()

    def enviar_arquivo(self, demanda_id, *, id_, tipo, nome, conteudo, dados, tela):
        self.enviados.append(("arquivo", demanda_id, id_, {"tipo": tipo, "nome": nome, "conteudo": conteudo, "dados": dados, "tela": tela}))
        return self._responder()


class TestesOrdem(unittest.TestCase):
    def test_ordenar_poe_urgente_antes_do_mais_antigo(self):
        itens = {
            ID: item(ultima=retrato(criadaEm="2026-11-20T08:00:00Z")),
            OUTRO: item(ultima=retrato(criadaEm="2026-11-20T09:30:00Z", destino="urgente")),
            TERCEIRO: item(ultima=retrato(criadaEm="2026-11-20T07:00:00Z", destino="fila_de_agentes")),
        }
        self.assertEqual(demandas.ordenar(itens), [OUTRO, TERCEIRO, ID])

    def test_nonce_e_chaves_ocupando(self):
        self.assertEqual(demandas.nonce(ID, "desenhando", 2), "demanda:%s:desenhando:2" % ID)
        estado = {
            "demandas": {
                "cursor": None,
                "semRotaEm": None,
                "saida": [],
                "itens": {
                    ID: item("desenhando", runId="r1"),
                    OUTRO: item("testando", runId=None),
                    TERCEIRO: item("planejando", runId="r3"),
                },
            }
        }
        self.assertEqual(demandas.chaves_ocupando(estado), {"demanda:%s" % ID})
        self.assertEqual(demandas.chaves_ocupando({}), set())


class TestesProximaAcao(unittest.TestCase):
    def test_proxima_acao_tabela(self):
        casos = [
            (item("nova"), retrato("recebida"), "triar"),
            (item("triando"), retrato("planejada"), "planejar"),
            (item("triando"), retrato("planejada", espera="planejar_comigo"), "esperar_sessao"),
            (item("esperando_sessao"), retrato("planejada", espera="planejar_comigo", plano={"caminho": ".fabrica/planos/demanda-11111111.json", "prUrl": None, "artefato": None}), "acompanhar"),
            (item("plano_no_repo"), retrato("desenho"), "desenhar"),
            (
                item("desenho_enviado"),
                retrato(
                    "desenho",
                    desenho={"versao": 1, "aprovada": None},
                    eventos=[{"id": "e1", "tipo": "ajuste_pedido", "origem": "paulo", "em": AGORA, "dados": {"versao": 1, "texto": "mais contraste"}}],
                ),
                "refazer_desenho",
            ),
            (item("desenho_enviado"), retrato("desenho", desenho={"versao": 1, "aprovada": None}, ajustes=[{"versao": 1, "texto": "x", "em": AGORA}]), "refazer_desenho"),
            (item("desenho_enviado"), retrato("desenho", espera="aprovar_desenho", desenho={"versao": 1, "aprovada": None}), "nada"),
            (item("plano_no_repo"), retrato("desenho", nivel="planejar_comigo", plano={"caminho": ".fabrica/planos/demanda-11111111.json", "prUrl": None, "artefato": "https://claude.ai/a/1"}), "nada"),
            (item("desenho_enviado"), retrato("desenvolvida"), "mergear_desenho"),
            (item("plano_no_repo", segurado=True), retrato("desenvolvida"), "soltar_plano"),
            (item("desenvolvendo"), retrato("testada"), "testar"),
            (item("testando"), retrato("desenvolvida"), "corrigir"),
            (
                item("esperando_paulo", inicio="2026-11-20T09:30:00Z"),
                retrato("testada", espera="teste_falhou", eventos=[{"id": "e2", "tipo": "retomada", "origem": "paulo", "em": AGORA, "dados": {}}]),
                "corrigir",
            ),
            (
                item("esperando_paulo", inicio="2026-11-20T10:30:00Z"),
                retrato("testada", espera="teste_falhou", eventos=[{"id": "e2", "tipo": "retomada", "origem": "paulo", "em": AGORA, "dados": {}}]),
                "nada",
            ),
            (
                item("esperando_paulo", inicio="2026-11-20T09:30:00Z"),
                retrato("testada", eventos=[{"id": "e2", "tipo": "retomada", "origem": "paulo", "em": AGORA, "dados": {}}]),
                "corrigir",
            ),
            (item("esperando_paulo"), retrato("testada", espera="teste_falhou"), "nada"),
            (item("triando"), retrato("recebida"), "acompanhar"),
            (item("planejando"), retrato("planejada"), "acompanhar"),
            (item("desenhando"), retrato("desenho"), "acompanhar"),
            (item("testando"), retrato("testada"), "acompanhar"),
            (item("corrigindo"), retrato("testada"), "testar"),
            (item("desenho_enviado"), retrato("desenho", desenho={"versao": 2, "aprovada": None}, ajustes=[{"versao": 1, "texto": "x", "em": AGORA}]), "nada"),
            (item("desenvolvendo"), retrato("entregue"), "entregar"),
            (item("desenvolvendo"), retrato("entregue", encerrada="entregue"), "encerrar"),
            (item("nova"), retrato("recebida", encerrada="orientada"), "encerrar"),
            (item("nova"), retrato("recebida", espera="decidir_destino"), "nada"),
            (item("desenvolvendo"), retrato("desenvolvida", espera="travada"), "nada"),
            (item("desenvolvendo"), retrato("desenvolvida", espera="concluir_etapa"), "nada"),
        ]
        for i, (it, demanda, esperado) in enumerate(casos):
            with self.subTest(caso=i, fase=it["fase"], marco=demanda["etapaAtual"]["marco"]):
                self.assertEqual(demandas.proxima_acao(it, demanda), esperado)

    def test_proxima_acao_e_pura(self):
        it, d = item("triando"), retrato("planejada")
        copia_item, copia_d = json.dumps(it, sort_keys=True), json.dumps(d, sort_keys=True)
        demandas.proxima_acao(it, d)
        self.assertEqual((json.dumps(it, sort_keys=True), json.dumps(d, sort_keys=True)), (copia_item, copia_d))

    def test_marcos_ausentes_no_modelo_pulam_a_fase(self):
        etapas = [e for e in MODELO if e["marco"] not in ("desenho", "testada")]
        self.assertEqual(demandas.proxima_acao(item("triando"), retrato("planejada", etapas=etapas)), "planejar")
        self.assertEqual(demandas.proxima_acao(item("plano_no_repo", segurado=True), retrato("desenvolvida", etapas=etapas)), "soltar_plano")
        self.assertEqual(demandas.proxima_acao(item("desenvolvendo"), retrato("desenvolvida", etapas=etapas)), "acompanhar")
        self.assertEqual(demandas.proxima_acao(item("desenvolvendo"), retrato("entregue", etapas=etapas)), "entregar")


class TestesSaida(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.raiz = pathlib.Path(self.tmp.name)
        self.caminho = self.raiz / "fila-estado.json"
        self.estado = {"fila": []}

    def tearDown(self):
        self.tmp.cleanup()

    def salvar(self):
        despachante.gravar_json_atomico(self.caminho, self.estado)

    def recarregar(self):
        self.estado = json.loads(self.caminho.read_text(encoding="utf-8"))

    def test_enfileirar_evento_gera_id_e_grava_na_saida(self):
        id_ = demandas.enfileirar_evento(self.estado, ID, "triagem_falhou", {"motivo": "sem dados"}, agora=AGORA)
        self.assertRegex(id_, r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        self.assertEqual(
            self.estado["demandas"]["saida"],
            [{"demanda": ID, "evento": {"id": id_, "em": AGORA, "tipo": "triagem_falhou", "dados": {"motivo": "sem dados"}}}],
        )
        self.assertEqual(self.estado["demandas"]["cursor"], None)
        self.assertEqual(self.estado["demandas"]["itens"], {})

    def test_enfileirar_arquivo_grava_os_bytes_antes_de_entrar_na_saida(self):
        vistos = []
        original = demandas._gravar_bytes_atomico

        def espiar(caminho, dados):
            vistos.append(len(self.estado.get("demandas", {}).get("saida", [])))
            original(caminho, dados)

        demandas._gravar_bytes_atomico = espiar
        try:
            id_ = demandas.enfileirar_arquivo(
                self.estado, self.raiz, ID, tipo="captura", nome="desktop-01.png", conteudo="image/png", dados=b"\x89PNG-bytes", tela="desktop"
            )
        finally:
            demandas._gravar_bytes_atomico = original
        self.assertEqual(vistos, [0])
        local = self.raiz / "demandas" / ID / id_
        self.assertEqual(local.read_bytes(), b"\x89PNG-bytes")
        self.assertEqual(
            self.estado["demandas"]["saida"],
            [
                {
                    "demanda": ID,
                    "arquivo": {"id": id_, "tipo": "captura", "nome": "desktop-01.png", "conteudo": "image/png", "tela": "desktop", "caminho": "demandas/%s/%s" % (ID, id_)},
                }
            ],
        )

    def test_enfileirar_arquivo_recusa_demanda_torta_e_arquivo_grande(self):
        with self.assertRaises(ValueError):
            demandas.enfileirar_arquivo(self.estado, self.raiz, "../fora", tipo="desenho", nome="d.html", conteudo="text/html", dados=b"x", tela=None)
        with self.assertRaises(ValueError):
            demandas.enfileirar_arquivo(
                self.estado, self.raiz, ID, tipo="desenho", nome="d.html", conteudo="text/html", dados=b"x" * (demandas.LIMITE_DO_ARQUIVO + 1), tela=None
            )
        self.assertEqual(self.estado.get("demandas", {}).get("saida", []), [])

    def test_aplicado_e_repetido_tiram_o_item_e_apagam_o_arquivo(self):
        ev = demandas.enfileirar_evento(self.estado, ID, "destravada", {}, agora=AGORA)
        arq = demandas.enfileirar_arquivo(self.estado, self.raiz, ID, tipo="desenho", nome="desenho.html", conteudo="text/html", dados=b"<p>oi</p>", tela=None)
        salvos = []
        cliente = ClienteFalso("aplicado", "repetido")
        avisos = demandas.esvaziar_saida(self.estado, cliente, self.raiz, salvar=lambda: salvos.append(len(self.estado["demandas"]["saida"])))
        self.assertEqual(avisos, [])
        self.assertEqual([e[2] for e in cliente.enviados], [ev, arq])
        self.assertEqual(cliente.enviados[1][3]["dados"], b"<p>oi</p>")
        self.assertEqual(self.estado["demandas"]["saida"], [])
        self.assertFalse((self.raiz / "demandas" / ID / arq).exists())
        self.assertEqual(salvos, [1, 0])

    def test_review_focus_1_saida_reenvia_o_mesmo_id_depois_de_reiniciar(self):
        id_ = demandas.enfileirar_evento(self.estado, ID, "etapa_concluida", {"marco": "desenvolvida"}, agora=AGORA)
        self.salvar()
        primeiro = ClienteFalso(FalhaDeEnvio("timeout"))
        self.assertEqual(demandas.esvaziar_saida(self.estado, primeiro, self.raiz, salvar=self.salvar), [])
        self.salvar()

        self.recarregar()  # coordenador reiniciado
        segundo = ClienteFalso("repetido")
        self.assertEqual(demandas.esvaziar_saida(self.estado, segundo, self.raiz, salvar=self.salvar), [])
        self.recarregar()
        self.assertEqual([e[2] for e in primeiro.enviados + segundo.enviados], [id_, id_])
        self.assertEqual(self.estado["demandas"]["saida"], [])

    def test_review_focus_1_arquivo_reenvia_o_mesmo_id_depois_de_reiniciar(self):
        id_ = demandas.enfileirar_arquivo(self.estado, self.raiz, ID, tipo="desenho", nome="desenho.html", conteudo="text/html", dados=b"<p>v1</p>", tela=None)
        self.salvar()
        primeiro = ClienteFalso(FalhaDeEnvio("HTTP 502"))
        demandas.esvaziar_saida(self.estado, primeiro, self.raiz, salvar=self.salvar)
        self.recarregar()
        segundo = ClienteFalso("repetido")
        demandas.esvaziar_saida(self.estado, segundo, self.raiz, salvar=self.salvar)
        self.assertEqual([e[2] for e in primeiro.enviados + segundo.enviados], [id_, id_])
        self.assertEqual(segundo.enviados[0][3]["dados"], b"<p>v1</p>")
        self.recarregar()
        self.assertEqual(self.estado["demandas"]["saida"], [])

    def test_recusa_definitiva_sai_da_saida_e_avisa(self):
        demandas.enfileirar_evento(self.estado, ID, "etapa_concluida", {"marco": "entregue"}, agora=AGORA)
        depois = demandas.enfileirar_evento(self.estado, OUTRO, "destravada", {}, agora=AGORA)
        cliente = ClienteFalso("recusado", "aplicado")
        avisos = demandas.esvaziar_saida(self.estado, cliente, self.raiz, salvar=lambda: None)
        self.assertEqual(self.estado["demandas"]["saida"], [])
        self.assertEqual(cliente.enviados[1][2], depois)
        self.assertEqual(len(avisos), 1)
        self.assertEqual(avisos[0]["evento"], "aviso")
        self.assertEqual(avisos[0]["chave"], "demandas:recusa:%s" % ID)
        self.assertIn("etapa_concluida", avisos[0]["mensagem"])
        self.assertIn("Evento fora de ordem.", avisos[0]["mensagem"])

    def test_recusa_de_arquivo_apaga_o_local(self):
        arq = demandas.enfileirar_arquivo(self.estado, self.raiz, ID, tipo="captura", nome="c.png", conteudo="image/png", dados=b"png", tela="celular")
        avisos = demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        self.assertEqual([a["chave"] for a in avisos], ["demandas:recusa:%s" % ID])
        self.assertFalse((self.raiz / "demandas" / ID / arq).exists())

    def test_falha_transitoria_para_e_mantem_a_ordem(self):
        a = demandas.enfileirar_evento(self.estado, ID, "destravada", {}, agora=AGORA)
        b = demandas.enfileirar_evento(self.estado, OUTRO, "destravada", {}, agora=AGORA)
        c = demandas.enfileirar_evento(self.estado, ID, "etapa_concluida", {"marco": "desenvolvida"}, agora=AGORA)
        cliente = ClienteFalso("aplicado", FalhaDeEnvio("Flow inacessível (ConnectionRefusedError)"))
        self.assertEqual(demandas.esvaziar_saida(self.estado, cliente, self.raiz, salvar=lambda: None), [])
        self.assertEqual([e[2] for e in cliente.enviados], [a, b])
        self.assertEqual([s["evento"]["id"] for s in self.estado["demandas"]["saida"]], [b, c])
        cliente = ClienteFalso("aplicado", "aplicado")
        demandas.esvaziar_saida(self.estado, cliente, self.raiz, salvar=lambda: None)
        self.assertEqual([e[2] for e in cliente.enviados], [b, c])
        self.assertEqual(self.estado["demandas"]["saida"], [])

    def test_falha_permanente_do_http_sai_com_um_aviso(self):
        for codigo in (411, 413, 415):
            with self.subTest(codigo=codigo):
                self.estado = {}
                demandas.enfileirar_evento(self.estado, ID, "destravada", {}, agora=AGORA)
                seguinte = demandas.enfileirar_evento(self.estado, OUTRO, "destravada", {}, agora=AGORA)
                cliente = ClienteFalso(FalhaDeEnvio("HTTP %d" % codigo), "aplicado")
                avisos = demandas.esvaziar_saida(self.estado, cliente, self.raiz, salvar=lambda: None)
                self.assertEqual([x["chave"] for x in avisos], ["demandas:recusa:%s" % ID])
                self.assertIn("HTTP %d" % codigo, avisos[0]["mensagem"])
                self.assertEqual(cliente.enviados[1][2], seguinte)
                self.assertEqual(self.estado["demandas"]["saida"], [])

    def test_falha_repetida_igual_para_de_reenviar_com_um_aviso(self):
        id_ = demandas.enfileirar_evento(self.estado, ID, "destravada", {}, agora=AGORA)
        avisos = []
        for _ in range(demandas.LIMITE_DE_FALHAS_IGUAIS - 1):
            avisos += demandas.esvaziar_saida(self.estado, ClienteFalso(FalhaDeEnvio("HTTP 400")), self.raiz, salvar=lambda: None)
        self.assertEqual(avisos, [])
        self.assertEqual([s["evento"]["id"] for s in self.estado["demandas"]["saida"]], [id_])
        avisos = demandas.esvaziar_saida(self.estado, ClienteFalso(FalhaDeEnvio("HTTP 400")), self.raiz, salvar=lambda: None)
        self.assertEqual([x["chave"] for x in avisos], ["demandas:recusa:%s" % ID])
        self.assertEqual(self.estado["demandas"]["saida"], [])

    def test_falha_diferente_zera_a_contagem_e_rede_nunca_descarta(self):
        demandas.enfileirar_evento(self.estado, ID, "destravada", {}, agora=AGORA)
        for i in range(demandas.LIMITE_DE_FALHAS_IGUAIS * 2):
            falha = "timeout" if i % 2 else "HTTP 400"
            self.assertEqual(demandas.esvaziar_saida(self.estado, ClienteFalso(FalhaDeEnvio(falha)), self.raiz, salvar=lambda: None), [])
        for _ in range(demandas.LIMITE_DE_FALHAS_IGUAIS * 2):
            demandas.esvaziar_saida(self.estado, ClienteFalso(FalhaDeEnvio("timeout")), self.raiz, salvar=lambda: None)
        self.assertEqual(len(self.estado["demandas"]["saida"]), 1)

    def test_arquivo_local_sumido_sai_com_aviso(self):
        arq = demandas.enfileirar_arquivo(self.estado, self.raiz, ID, tipo="desenho", nome="d.html", conteudo="text/html", dados=b"x", tela=None)
        (self.raiz / "demandas" / ID / arq).unlink()
        cliente = ClienteFalso()
        avisos = demandas.esvaziar_saida(self.estado, cliente, self.raiz, salvar=lambda: None)
        self.assertEqual(cliente.enviados, [])
        self.assertEqual([x["chave"] for x in avisos], ["demandas:recusa:%s" % ID])
        self.assertEqual(self.estado["demandas"]["saida"], [])


if __name__ == "__main__":
    unittest.main()
