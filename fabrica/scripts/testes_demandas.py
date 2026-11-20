import datetime
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import capacidade  # noqa: E402
import demandas  # noqa: E402
import despachante  # noqa: E402
import motor  # noqa: E402
import prompts  # noqa: E402
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
                item("esperando_paulo", inicio="2026-11-20T09:30:00Z", ultima=retrato("testada", espera="teste_falhou")),
                retrato("testada", eventos=[{"id": "e2", "tipo": "retomada", "origem": "paulo", "em": AGORA, "dados": {}}]),
                "corrigir",
            ),
            (  # retomada de uma trava no teste (o qa não subiu o sistema): testa de novo, não corrige
                item("esperando_paulo", inicio="2026-11-20T09:30:00Z", ultima=retrato("testada", espera="travada")),
                retrato("testada", eventos=[{"id": "e2", "tipo": "retomada", "origem": "paulo", "em": AGORA, "dados": {}}]),
                "testar",
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

    def test_saida_pendente_segura_a_decisao(self):
        # o desenho_pronto ainda na saída: o retrato está na versão 0 (ou na v1 com o ajuste) e não pode redesenhar
        estado = {}
        demandas.enfileirar_evento(estado, ID, "desenho_pronto", {"arquivoId": OUTRO}, agora=AGORA)
        self.assertTrue(demandas.tem_pendente(estado, ID))
        self.assertFalse(demandas.tem_pendente(estado, OUTRO))
        self.assertFalse(demandas.tem_pendente({}, ID))
        it = item("desenho_enviado")
        self.assertEqual(demandas.proxima_acao(it, retrato("desenho"), pendente=True), "aguardar_envio")
        com_ajuste = retrato("desenho", desenho={"versao": 1, "aprovada": None}, ajustes=[{"versao": 1, "texto": "x", "em": AGORA}])
        self.assertEqual(demandas.proxima_acao(it, com_ajuste, pendente=demandas.tem_pendente(estado, ID)), "aguardar_envio")
        self.assertEqual(demandas.proxima_acao(it, retrato("entregue", encerrada="entregue"), pendente=True), "aguardar_envio")

    def test_item_a_ressincronizar(self):
        it = item("testando", precisa_ressincronizar=True)
        self.assertEqual(demandas.proxima_acao(it, retrato("desenvolvida")), "ressincronizar")
        self.assertEqual(demandas.proxima_acao(it, retrato("desenvolvida"), pendente=True), "aguardar_envio")
        self.assertFalse(demandas.item_novo()["precisa_ressincronizar"])

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
        self.assertEqual(salvos, [2, 1, 0])  # salva antes do primeiro envio e depois de cada item

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

    def test_queda_no_meio_do_primeiro_post_guarda_o_id(self):
        class Queda(BaseException):
            pass

        self.salvar()  # o estado de antes do ciclo, sem a saída
        id_ = demandas.enfileirar_evento(self.estado, ID, "etapa_concluida", {"marco": "desenvolvida"}, agora=AGORA)
        with self.assertRaises(Queda):  # quem chama não salvou: esvaziar_saida salva antes do POST
            demandas.esvaziar_saida(self.estado, ClienteFalso(Queda()), self.raiz, salvar=self.salvar)
        self.recarregar()
        cliente = ClienteFalso("repetido")
        demandas.esvaziar_saida(self.estado, cliente, self.raiz, salvar=self.salvar)
        self.assertEqual([e[2] for e in cliente.enviados], [id_])
        self.assertEqual(self.estado["demandas"]["saida"], [])

    def test_descarte_marca_a_demanda_para_ressincronizar(self):
        secao = demandas.secao(self.estado)
        secao["itens"][ID] = item("testando")
        secao["itens"][OUTRO] = item("desenvolvendo")
        demandas.enfileirar_evento(self.estado, ID, "etapa_concluida", {"marco": "desenvolvida"}, agora=AGORA)
        demandas.enfileirar_evento(self.estado, OUTRO, "destravada", {}, agora=AGORA)
        demandas.enfileirar_evento(self.estado, TERCEIRO, "destravada", {}, agora=AGORA)  # sem item: nada a marcar
        cliente = ClienteFalso("recusado", "aplicado", FalhaDeEnvio("HTTP 413"))
        avisos = demandas.esvaziar_saida(self.estado, cliente, self.raiz, salvar=lambda: None)
        self.assertEqual([a["chave"] for a in avisos], ["demandas:recusa:%s" % ID, "demandas:recusa:%s" % TERCEIRO])
        self.assertTrue(secao["itens"][ID]["precisa_ressincronizar"])
        self.assertFalse(secao["itens"][OUTRO]["precisa_ressincronizar"])
        self.assertNotIn(TERCEIRO, secao["itens"])

    def test_404_pausa_a_saida_com_um_aviso_e_nunca_descarta(self):
        demandas.secao(self.estado)["itens"][ID] = item("desenvolvendo")
        id_ = demandas.enfileirar_evento(self.estado, ID, "destravada", {}, agora=AGORA)
        avisos = []
        for _ in range(demandas.LIMITE_DE_FALHAS_IGUAIS * 3):
            avisos += demandas.esvaziar_saida(self.estado, ClienteFalso(FalhaDeEnvio("HTTP 404")), self.raiz, salvar=lambda: None)
        self.assertEqual([a["chave"] for a in avisos], ["demandas:saida-parada"])
        self.assertIn("404", avisos[0]["mensagem"])
        self.assertEqual([s["evento"]["id"] for s in self.estado["demandas"]["saida"]], [id_])
        self.assertFalse(self.estado["demandas"]["itens"][ID]["precisa_ressincronizar"])

    def test_falha_que_nao_descarta_avisa_uma_vez_no_limite_e_o_sucesso_limpa(self):
        demandas.enfileirar_evento(self.estado, ID, "destravada", {}, agora=AGORA)
        demandas.enfileirar_evento(self.estado, OUTRO, "destravada", {}, agora=AGORA)
        for falha in ("HTTP 500", "HTTP 401", "HTTP 403", "Flow inacessível (ConnectionRefusedError)"):
            with self.subTest(falha=falha):
                avisos = []
                for _ in range(demandas.LIMITE_DE_FALHAS_IGUAIS - 1):
                    avisos += demandas.esvaziar_saida(self.estado, ClienteFalso(FalhaDeEnvio(falha)), self.raiz, salvar=lambda: None)
                self.assertEqual(avisos, [])
                for _ in range(demandas.LIMITE_DE_FALHAS_IGUAIS * 2):
                    avisos += demandas.esvaziar_saida(self.estado, ClienteFalso(FalhaDeEnvio(falha)), self.raiz, salvar=lambda: None)
                self.assertEqual([a["chave"] for a in avisos], ["demandas:saida-parada"])
                self.assertIn(falha, avisos[0]["mensagem"])
                self.assertEqual(len(self.estado["demandas"]["saida"]), 2)
        # o primeiro sai; o segundo falha de novo do zero e a marca de parada já foi limpa pelo sucesso
        demandas.esvaziar_saida(self.estado, ClienteFalso("aplicado", FalhaDeEnvio("HTTP 500")), self.raiz, salvar=lambda: None)
        self.assertIsNone(self.estado["demandas"]["saidaParada"])
        avisos = []
        for _ in range(demandas.LIMITE_DE_FALHAS_IGUAIS):
            avisos += demandas.esvaziar_saida(self.estado, ClienteFalso(FalhaDeEnvio("HTTP 500")), self.raiz, salvar=lambda: None)
        self.assertEqual([a["chave"] for a in avisos], ["demandas:saida-parada"])

    def test_item_torto_na_saida_sai_com_aviso(self):
        secao = demandas.secao(self.estado)
        secao["saida"] += [{"demanda": ID}, "lixo", {"demanda": ID, "arquivo": {"id": OUTRO}}]
        seguinte = demandas.enfileirar_evento(self.estado, OUTRO, "destravada", {}, agora=AGORA)
        cliente = ClienteFalso("aplicado")
        avisos = demandas.esvaziar_saida(self.estado, cliente, self.raiz, salvar=lambda: None)
        self.assertEqual(len(avisos), 3)
        self.assertEqual([e[2] for e in cliente.enviados], [seguinte])
        self.assertEqual(secao["saida"], [])
        self.assertEqual(demandas.ordenar({ID: "lixo", OUTRO: item(ultima=retrato())}), [OUTRO, ID])

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


CONFIG_DO_KIT = json.loads((pathlib.Path(__file__).resolve().parent.parent / "modelos" / "config.json").read_text())
INSTANTE = datetime.datetime(2026, 11, 20, 10, 0, 0, tzinfo=datetime.timezone.utc)
REPO = "kustertech-exemplo/app"


def triagem_ok(**mudancas):
    base = {
        "tipo": "defeito",
        "destino": "fila_de_agentes",
        "tamanho": "pequeno",
        "mexeEm": "src/modules/clientes",
        "risco": "baixo",
        "dados": "nenhum",
        "impacto": {"toca": ["tela de clientes"], "podeQuebrar": ["listagem"], "autorizacao": False, "caminhoProtegido": False},
        "resposta": None,
        "motivo": "defeito pequeno",
    }
    base.update(mudancas)
    return base


def resposta_triagem(obj):
    return "li o código\n%s\n%s\n%s" % (prompts.INICIO_TRIAGEM, json.dumps(obj, ensure_ascii=False), prompts.FIM_TRIAGEM)


class ClienteDeBusca:
    """Responde `buscar` pela lista `paginas` (dict, None = 404, ou exceção); depois dela, uma página vazia."""

    def __init__(self, *paginas, cursor="1"):
        self.paginas, self.desdes, self.cursor = list(paginas), [], cursor

    def buscar(self, desde):
        self.desdes.append(desde)
        if not self.paginas:
            return {"cursor": desde or self.cursor, "mais": False, "demandas": []}
        r = self.paginas.pop(0)
        if isinstance(r, BaseException):
            raise r
        return r


def pagina(*demandas_, cursor="1", mais=False):
    return {"cursor": cursor, "mais": mais, "demandas": list(demandas_)}


class BasePasso(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.raiz = pathlib.Path(self._tmp.name)
        self.capacidade = self.raiz / "capacidade.json"
        self.motor = motor.MotorFalso()
        self.agora = INSTANTE
        self.motor.agora = lambda: self.agora
        self.estado = {"fila": [], "avisos": [], "chaves": {}}
        self.salvos = []

    def passo(self, cliente, *, modelos=None, projetos=None):
        return demandas.passo(
            self.estado,
            cliente=cliente,
            motor=self.motor,
            forja=None,
            capacidade_path=self.capacidade,
            projetos={REPO: "app"} if projetos is None else projetos,
            modelos=CONFIG_DO_KIT["modelos"] if modelos is None else modelos,
            raiz=self.raiz,
            agora=self.agora,
            mem_disponivel_mb=None,
            salvar=lambda: self.salvos.append(json.loads(json.dumps(self.estado))),
        )

    def despachos(self):
        return [a for nome, a in self.motor.chamadas if nome == "despachar_run"]

    def item(self, id_=ID):
        return self.estado["demandas"]["itens"][id_]

    def saida(self):
        return [s["evento"] for s in self.estado["demandas"]["saida"]]

    def triar(self):
        """Um ciclo com a demanda recém-chegada: o run da triagem fica despachado."""
        self.passo(ClienteDeBusca(pagina(retrato())))
        return self.item()["runId"]

    def avancar(self, segundos):
        self.agora = self.agora + datetime.timedelta(seconds=segundos)


class TestesTriagem(BasePasso):
    def test_triagem_despacha_run_produto_com_o_modelo_haiku_da_config_e_sem_reservar_vaga(self):
        self.passo(ClienteDeBusca(pagina(retrato())))
        (despacho,) = self.despachos()
        produto = CONFIG_DO_KIT["modelos"]["produto"]
        self.assertEqual(despacho["modelo"], produto["modelo"])
        self.assertEqual(despacho["modelo"], "claude-haiku-5-5")
        self.assertEqual((despacho["agente"], despacho["max_custo_usd"], despacho["projeto"]), (produto["agente"], produto["maxCustoUsd"], "app"))
        hexa = demandas.nonce_do_motor(ID, "triagem", 0)
        self.assertRegex(hexa, r"^[0-9a-f]{32}$")
        self.assertEqual(despacho["chave_idempotencia"], hexa)
        self.assertTrue(despacho["prompt"].endswith("<!-- fabrica:nonce=%s -->" % hexa))
        self.assertIn("Não mude arquivo nem abra PR", despacho["prompt"])
        self.assertIsNone(despacho["branch_existente"])
        self.assertNotIn(demandas.chave(ID), capacidade.ler(self.capacidade)["reservas"])
        self.assertEqual(demandas.chaves_ocupando(self.estado), set())
        # `despachando` com o nonce e o início no disco antes do POST
        antes = [s for s in self.salvos if s["demandas"]["itens"].get(ID, {}).get("fase") == "despachando"]
        self.assertTrue(antes)
        self.assertEqual((antes[0]["demandas"]["itens"][ID]["nonce"], antes[0]["demandas"]["itens"][ID]["inicio"]), (hexa, "2026-11-20T10:00:00Z"))
        self.assertEqual((self.item()["fase"], self.item()["runId"]), ("triando", "run-1"))
        self.assertEqual(self.item()["ultima"]["id"], ID)

    def test_review_focus_5_triagem_roda_com_todas_as_vagas_ocupadas(self):
        capacidade.configurar(self.capacidade, vagas=1, ram_minima_mb=0)
        self.assertTrue(capacidade.reservar(self.capacidade, "outro-plano", "raia-0", mem_disponivel_mb=None))
        antes = capacidade.ler(self.capacidade)["reservas"]
        self.passo(ClienteDeBusca(pagina(retrato(destino="urgente"))))
        self.assertEqual(len(self.despachos()), 1)
        self.assertEqual(capacidade.ler(self.capacidade)["reservas"], antes)

    def test_triagem_respondida_vira_evento_triagem_na_saida(self):
        run_id = self.triar()
        self.motor.definir_run(run_id, estado="succeeded")
        self.motor.definir_texto(run_id, resposta_triagem(triagem_ok()))
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("triagem", triagem_ok()))
        self.assertEqual(len(self.despachos()), 1)
        self.assertIsNone(self.item()["runId"])
        # gravado no estado (o coordenador esvazia a saída depois)
        self.assertEqual(self.salvos[-1]["demandas"]["saida"][0]["evento"]["id"], evento["id"])
        # o ciclo seguinte, com o retrato ainda em `recebida`, não despacha nem enfileira de novo
        self.estado["demandas"]["saida"] = []
        self.passo(ClienteDeBusca(pagina(retrato(), cursor="2")))
        self.assertEqual((len(self.despachos()), self.saida()), (1, []))

    def test_triagem_orientada_vira_evento_com_resposta(self):
        run_id = self.triar()
        self.motor.definir_run(run_id, estado="succeeded")
        t = triagem_ok(destino="orientada", tipo="ajuste", resposta="Isso se configura em Configurações → Demandas.")
        self.motor.definir_texto(run_id, resposta_triagem(t))
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["tipo"], "triagem")
        self.assertEqual((evento["dados"]["destino"], evento["dados"]["resposta"]), ("orientada", t["resposta"]))

    def test_triagem_sem_formato_vira_triagem_falhou(self):
        run_id = self.triar()
        self.motor.definir_run(run_id, estado="succeeded")
        self.motor.definir_texto(run_id, "acho que é um defeito")
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("triagem_falhou", {"motivo": "a triagem não respondeu no formato"}))

    def test_run_falho_vira_triagem_falhou_com_o_motivo_do_agente(self):
        run_id = self.triar()
        self.motor.definir_run(run_id, estado="failed", motivoFalha="x" * 300)
        self.motor.definir_texto(run_id, resposta_triagem(triagem_ok()))
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("triagem_falhou", {"motivo": "o agente falhou: " + "x" * 200}))

    def test_run_cancelado_sem_motivo(self):
        run_id = self.triar()
        self.motor.definir_run(run_id, estado="cancelled")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida()[0]["dados"], {"motivo": "o agente falhou: cancelled"})

    def test_triagem_acima_de_30_min_vira_triagem_falhou(self):
        self.triar()
        self.avancar(1799)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        self.avancar(2)
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("triagem_falhou", {"motivo": "a triagem passou de 30 min"}))
        self.assertEqual(demandas.TETO_TRIAGEM_S, 1800)

    def test_run_sumido_vira_triagem_falhou(self):
        self.triar()
        self.item()["runId"] = "run-que-nao-existe"
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida()[0]["dados"], {"motivo": "o agente falhou: run não encontrado no Warren"})

    def test_run_perdido_por_infra_adota_o_retry_do_warren(self):
        run_id = self.triar()
        self.motor.definir_run(run_id, estado="failed", motivoFalha="sandbox_run_lost")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        novo = self.item()["runId"]
        self.assertNotEqual(novo, run_id)
        self.motor.definir_run(novo, estado="succeeded")
        self.motor.definir_texto(novo, resposta_triagem(triagem_ok()))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida()[0]["tipo"], "triagem")
        self.assertEqual(len(self.despachos()), 1)

    def test_reinicio_em_despachando_adota_o_run_pelo_nonce(self):
        hexa = demandas.nonce_do_motor(ID, "triagem", 0)
        run_id = self.motor.despachar_run(
            projeto="app", agente="claude-code", modelo="m", prompt="x\n<!-- fabrica:nonce=%s -->" % hexa,
            branch_existente=None, max_custo_usd=1, chave_idempotencia=hexa,
        )
        it = demandas.secao(self.estado)["itens"][ID] = item("despachando", alvo="triando", nonce=hexa, inicio="2026-11-20T10:00:00Z", projeto="app", ultima=retrato())
        self.assertIsNone(it["runId"])
        self.passo(ClienteDeBusca(pagina(retrato())))
        self.assertEqual(len(self.despachos()), 1)  # só o de cima
        self.assertEqual((self.item()["fase"], self.item()["runId"]), ("triando", run_id))

    def test_reinicio_em_despachando_sem_run_despacha_de_novo_com_a_mesma_chave(self):
        hexa = demandas.nonce_do_motor(ID, "triagem", 0)
        demandas.secao(self.estado)["itens"][ID] = item("despachando", alvo="triando", nonce=hexa, inicio="2026-11-20T10:00:00Z", projeto="app", ultima=retrato())
        self.passo(ClienteDeBusca())
        (despacho,) = self.despachos()
        self.assertEqual(despacho["chave_idempotencia"], hexa)
        self.assertEqual(self.item()["fase"], "triando")

    def test_queda_no_post_fica_despachando_e_o_ciclo_seguinte_acha_pelo_nonce(self):
        self.motor.falhar_despacho("incerta")
        eventos = self.passo(ClienteDeBusca(pagina(retrato())))
        self.assertEqual(self.item()["fase"], "despachando")
        self.assertIn("erro", [e["evento"] for e in eventos])
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 1)
        self.assertEqual((self.item()["fase"], self.item()["runId"]), ("triando", "run-1"))

    def test_saida_pendente_nao_despacha(self):
        demandas.secao(self.estado)["itens"][ID] = item("nova", ultima=retrato())
        demandas.enfileirar_evento(self.estado, ID, "travada", {"motivo": "x", "url": None}, agora=AGORA)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.despachos(), [])

    def test_repositorio_fora_da_fila_espera_com_um_aviso_por_repositorio(self):
        outro = dict(retrato(), id=OUTRO)
        eventos = self.passo(ClienteDeBusca(pagina(retrato(), outro)), projetos={})
        avisos = [e for e in eventos if e["evento"] == "aviso"]
        self.assertEqual(len(avisos), 1)
        self.assertEqual(avisos[0]["mensagem"], "Demandas: kustertech-exemplo/app não tem projeto do Warren em fila.json")
        self.assertEqual(self.despachos(), [])
        self.assertEqual(self.item()["fase"], "nova")
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 2)

    def test_sem_modelo_do_produto_avisa_e_espera(self):
        modelos = {k: v for k, v in CONFIG_DO_KIT["modelos"].items() if k != "produto"}
        eventos = self.passo(ClienteDeBusca(pagina(retrato())), modelos=modelos)
        (aviso,) = [e for e in eventos if e["evento"] == "aviso"]
        self.assertIn("configure modelos.produto", aviso["mensagem"])
        self.assertEqual(self.despachos(), [])

    def test_triagem_ja_resolvida_pelo_paulo_nao_vira_evento(self):
        run_id = self.triar()
        self.motor.definir_run(run_id, estado="succeeded")
        self.motor.definir_texto(run_id, resposta_triagem(triagem_ok()))
        self.passo(ClienteDeBusca(pagina(retrato("planejada", destino="fila_de_agentes"), cursor="2")))
        self.assertEqual(self.saida(), [])
        self.assertIsNone(self.item()["runId"])

    def test_recusa_da_triagem_ressincroniza_e_manda_para_a_decisao_do_paulo_uma_vez(self):
        run_id = self.triar()
        self.motor.definir_run(run_id, estado="succeeded")
        self.motor.definir_texto(run_id, resposta_triagem(triagem_ok()))
        self.passo(ClienteDeBusca())
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        self.assertTrue(self.item()["precisa_ressincronizar"])
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["tipo"], "triagem_falhou")
        self.assertFalse(self.item()["precisa_ressincronizar"])
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        self.assertEqual(len(self.despachos()), 1)


class TestesBusca(BasePasso):
    def test_cursor_so_avanca_depois_de_gravar_os_itens(self):
        cliente = ClienteDeBusca(pagina(retrato(), cursor="5", mais=True), pagina(dict(retrato(), id=OUTRO), cursor="9"))
        self.passo(cliente, modelos={})
        self.assertEqual(cliente.desdes, [None, "5"])
        self.assertEqual(self.estado["demandas"]["cursor"], "9")
        cursores = [s["demandas"]["cursor"] for s in self.salvos]
        com_id = [ID in s["demandas"]["itens"] for s in self.salvos]
        com_outro = [OUTRO in s["demandas"]["itens"] for s in self.salvos]
        self.assertLess(com_id.index(True), cursores.index("5"))
        self.assertLess(com_outro.index(True), cursores.index("9"))

    def test_queda_ao_gravar_os_itens_nao_avanca_o_cursor(self):
        def salvar_que_cai():
            raise OSError("disco cheio")

        with self.assertRaises(OSError):
            demandas.passo(
                self.estado, cliente=ClienteDeBusca(pagina(retrato(), cursor="5")), motor=self.motor, forja=None,
                capacidade_path=self.capacidade, projetos={REPO: "app"}, modelos={}, raiz=self.raiz, agora=self.agora,
                mem_disponivel_mb=None, salvar=salvar_que_cai,
            )
        self.assertIsNone(self.estado["demandas"]["cursor"])

    def test_busca_le_ate_5_paginas_por_ciclo(self):
        paginas = [pagina(cursor=str(i), mais=True) for i in range(1, 9)]
        cliente = ClienteDeBusca(*paginas)
        self.passo(cliente, modelos={})
        self.assertEqual(len(cliente.desdes), 5)
        self.assertEqual(self.estado["demandas"]["cursor"], "5")

    def test_falha_na_busca_avisa_e_segue_com_as_demandas_que_ja_tem(self):
        demandas.secao(self.estado)["itens"][ID] = item("nova", ultima=retrato())
        eventos = self.passo(ClienteDeBusca(FalhaDeEnvio("HTTP 500")))
        self.assertIn("demandas:busca", [e.get("chave") for e in eventos])
        self.assertEqual(len(self.despachos()), 1)

    def test_flow_sem_rota_desliga_o_passo_avisa_uma_vez_e_tenta_de_novo_em_1h(self):
        demandas.secao(self.estado)["itens"][ID] = item("nova", ultima=retrato())
        cliente = ClienteDeBusca(None, None, None)
        eventos = self.passo(cliente)
        self.assertEqual([e["chave"] for e in eventos if e["evento"] == "aviso"], ["demandas:sem-rota"])
        self.assertEqual(self.despachos(), [])
        self.assertEqual(self.estado["demandas"]["semRotaEm"], "2026-11-20T10:00:00Z")
        self.avancar(3599)
        self.assertEqual(self.passo(cliente), [])
        self.assertEqual(len(cliente.desdes), 1)
        self.avancar(2)
        self.assertEqual([e for e in self.passo(cliente) if e["evento"] == "aviso"], [])
        self.assertEqual(len(cliente.desdes), 2)
        self.assertEqual(demandas.REVER_FLOW_SEM_DEMANDAS_S, 3600)
        self.avancar(3601)
        cliente.paginas = [pagina(cursor="3")]
        self.passo(cliente)
        self.assertIsNone(self.estado["demandas"]["semRotaEm"])
        self.assertEqual(len(self.despachos()), 1)


if __name__ == "__main__":
    unittest.main()
