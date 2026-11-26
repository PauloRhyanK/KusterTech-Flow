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
import forja as forja_  # noqa: E402
import motor  # noqa: E402
import prompts  # noqa: E402
import publicar  # noqa: E402
from retrato import FalhaDeEnvio  # noqa: E402
from testes_raias import plano_referencia  # noqa: E402

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
            (item("desenvolvendo"), retrato("desenvolvida", encerrada="descartada"), "encerrar"),
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
        self.forja = forja_.ForjaFalsa()
        self.estado = {"fila": [], "avisos": [], "chaves": {}}
        self.salvos = []

    def passo(self, cliente, *, modelos=None, projetos=None, publicacao=None, pedir_publicacao=None):
        return demandas.passo(
            self.estado,
            atualizar_branch=getattr(self, "atualizar_branch", None),
            cliente=cliente,
            motor=self.motor,
            forja=self.forja,
            capacidade_path=self.capacidade,
            projetos={REPO: "app"} if projetos is None else projetos,
            modelos=CONFIG_DO_KIT["modelos"] if modelos is None else modelos,
            raiz=self.raiz,
            agora=self.agora,
            mem_disponivel_mb=None,
            salvar=lambda: self.salvos.append(json.loads(json.dumps(self.estado))),
            publicacao=publicacao,
            pedir_publicacao=pedir_publicacao,
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
        # o run da triagem deixa de contar; o que segue é o plano (Task 4), com nonce próprio
        self.assertEqual(self.item()["alvo"], "planejando")
        self.assertEqual(self.item()["nonce"], demandas.nonce_do_motor(ID, "plano", 0))

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


DEMANDA_A = "aaaaaaaa-1111-4111-8111-111111111111"
ERRO_1 = "eeeeeeee-1111-4111-8111-111111111111"
CANDIDATAS = {
    "demandas": [{"id": DEMANDA_A, "titulo": "Salvar cliente não funciona", "resumo": "O botão salvar fica parado.", "origem": "relato",
                  "tipo": "defeito", "etapa": "Recebida", "relatos": 2, "erros": 0, "criadaEm": "2026-11-20T09:00:00Z"}],
    "erros": [{"id": ERRO_1, "titulo": "TypeError: salvar is undefined", "onde": "/clientes", "eventos": 12, "usuarios": 3,
               "ultimoEm": "2026-11-20T08:00:00Z", "estado": "na_espera"}],
}
JUNTAR = {"em": DEMANDA_A, "motivo": "mesmo defeito do salvar"}
LIGAR = {"erros": [ERRO_1], "motivo": "o erro do salvar"}
DIVIDIR = {"partes": [{"titulo": "Salvar", "descricao": "não salva", "tipo": "defeito"}, {"titulo": "Lento", "descricao": "demora", "tipo": "ajuste"}], "motivo": "dois problemas"}


def resposta_cruzada(cruzamento, triagem=None):
    bloco = "%s\n%s\n%s\n" % (prompts.INICIO_CRUZAMENTO, json.dumps(cruzamento, ensure_ascii=False), prompts.FIM_CRUZAMENTO)
    return bloco + resposta_triagem(triagem or triagem_ok())


class TestesTriagemCruzada(BasePasso):
    def triar_com_resposta(self, texto):
        self.passo(ClienteDeBusca(pagina(retrato(candidatas=CANDIDATAS))))
        run_id = self.item()["runId"]
        self.assertIn("Salvar cliente não funciona", self.despachos()[0]["prompt"])
        self.motor.definir_run(run_id, estado="succeeded")
        self.motor.definir_texto(run_id, texto)
        self.passo(ClienteDeBusca())

    def tipos(self):
        return [e["tipo"] for e in self.saida()]

    def test_ligar_erros_e_juntar_saem_nessa_ordem_sem_a_triagem_guardada(self):
        self.triar_com_resposta(resposta_cruzada({"juntar": JUNTAR, "ligarErros": LIGAR, "dividir": None}))
        self.assertEqual(self.tipos(), ["ligar_erros", "juntar"])
        self.assertEqual([e["dados"] for e in self.saida()], [LIGAR, JUNTAR])
        self.assertEqual(self.item()["triagem"], triagem_ok())
        self.assertTrue(self.item()["juntando"])
        self.assertEqual((self.item()["fase"], self.item()["runId"]), ("triando", None))
        # tudo no mesmo `salvar`
        self.assertEqual([s["evento"]["tipo"] for s in self.salvos[-1]["demandas"]["saida"]], ["ligar_erros", "juntar"])

    def test_dividir_sai_antes_da_triagem(self):
        self.triar_com_resposta(resposta_cruzada({"dividir": DIVIDIR}))
        self.assertEqual(self.tipos(), ["dividir", "triagem"])
        self.assertEqual(self.saida()[0]["dados"], DIVIDIR)
        self.assertNotIn("juntando", self.item())

    def test_ligar_erros_dividir_e_triagem(self):
        self.triar_com_resposta(resposta_cruzada({"ligarErros": LIGAR, "dividir": DIVIDIR}))
        self.assertEqual(self.tipos(), ["ligar_erros", "dividir", "triagem"])

    def test_sem_cruzamento_so_a_triagem(self):
        for texto in (resposta_triagem(triagem_ok()), resposta_cruzada({"juntar": None, "ligarErros": None, "dividir": None})):
            with self.subTest(texto=texto[:40]):
                self.estado = {"fila": [], "avisos": [], "chaves": {}}
                self.motor = motor.MotorFalso()
                self.motor.agora = lambda: self.agora
                self.triar_com_resposta(texto)
                self.assertEqual(self.tipos(), ["triagem"])
                self.assertEqual(self.saida()[0]["dados"], triagem_ok())

    def test_juntar_fora_das_candidatas_vira_triagem(self):
        fora = {"em": "99999999-9999-4999-8999-999999999999", "motivo": "m"}
        self.triar_com_resposta(resposta_cruzada({"juntar": fora}))
        self.assertEqual(self.tipos(), ["triagem"])
        self.assertNotIn("juntando", self.item())

    def test_cruzamento_sem_triagem_vira_triagem_falhou(self):
        bloco = "%s\n%s\n%s" % (prompts.INICIO_CRUZAMENTO, json.dumps({"juntar": JUNTAR}), prompts.FIM_CRUZAMENTO)
        self.triar_com_resposta(bloco)
        self.assertEqual(self.tipos(), ["triagem_falhou"])

    def test_juntar_recusado_manda_a_triagem_guardada_uma_vez(self):
        self.triar_com_resposta(resposta_cruzada({"juntar": JUNTAR, "ligarErros": LIGAR}))
        demandas.esvaziar_saida(self.estado, ClienteFalso("aplicado", "recusado"), self.raiz, salvar=lambda: None)
        self.assertTrue(self.item()["precisa_ressincronizar"])
        self.passo(ClienteDeBusca(pagina(retrato(candidatas=CANDIDATAS), cursor="2")))
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("triagem", triagem_ok()))
        self.assertTrue(self.item()["juntarRecusado"])
        self.assertFalse(self.item()["precisa_ressincronizar"])
        # a triagem guardada recusada também: a decisão do Paulo, como hoje (uma vez)
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["tipo"], "triagem_falhou")
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        self.assertEqual(len(self.despachos()), 1)

    def test_ligar_erros_recusado_com_juntar_aplicado_encerra_sem_mandar_nada(self):
        self.triar_com_resposta(resposta_cruzada({"juntar": JUNTAR, "ligarErros": LIGAR}))
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado", "aplicado"), self.raiz, salvar=lambda: None)
        self.passo(ClienteDeBusca(pagina(retrato(encerrada="juntada"), cursor="2")))
        self.assertEqual(self.saida(), [])
        self.passo(ClienteDeBusca())
        self.assertNotIn(ID, self.estado["demandas"]["itens"])

    def test_dividir_recusado_nao_manda_nada_a_mais(self):
        self.triar_com_resposta(resposta_cruzada({"dividir": DIVIDIR}))
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado", "aplicado"), self.raiz, salvar=lambda: None)
        self.passo(ClienteDeBusca(pagina(retrato("planejada", destino="fila_de_agentes"), cursor="2")))
        self.assertNotIn("triagem_falhou", self.tipos())
        self.assertNotIn("triagem", self.tipos())

    def test_separada_antes_de_o_kit_ver_a_juntada_e_triada_de_novo(self):
        self.triar_com_resposta(resposta_cruzada({"juntar": JUNTAR, "ligarErros": LIGAR}))
        demandas.esvaziar_saida(self.estado, ClienteFalso("aplicado", "aplicado"), self.raiz, salvar=lambda: None)
        # o Paulo separou antes da busca: o retrato volta `recebida`, sem triagem, com o `separada`
        separada = {"id": "s1", "tipo": "separada", "origem": "paulo", "em": AGORA, "dados": {"de": DEMANDA_A}}
        self.passo(ClienteDeBusca(pagina(retrato(candidatas=CANDIDATAS, eventos=[separada]), cursor="2")))
        self.assertEqual(len(self.despachos()), 2)  # uma triagem nova
        it = self.item()
        self.assertEqual(it.get("alvo"), "triando")
        self.assertEqual(it["nonce"], demandas.nonce_do_motor(ID, "triagem", 1))
        self.assertNotEqual(self.despachos()[1]["chave_idempotencia"], self.despachos()[0]["chave_idempotencia"])
        for campo in ("juntando", "juntarRecusado", "triagem"):
            self.assertNotIn(campo, it)
        self.assertEqual(self.saida(), [])

    def test_juntando_com_o_retrato_antigo_nao_tria_de_novo(self):
        self.triar_com_resposta(resposta_cruzada({"juntar": JUNTAR}))
        demandas.esvaziar_saida(self.estado, ClienteFalso("aplicado"), self.raiz, salvar=lambda: None)
        # nenhuma mudança nova no Flow: o retrato guardado é o de antes da junção
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 1)
        self.assertTrue(self.item()["juntando"])

    def test_juntando_com_o_juntar_na_saida_espera_o_envio(self):
        self.triar_com_resposta(resposta_cruzada({"juntar": JUNTAR}))
        separada = {"id": "s1", "tipo": "separada", "origem": "paulo", "em": AGORA, "dados": {"de": DEMANDA_A}}
        self.passo(ClienteDeBusca(pagina(retrato(candidatas=CANDIDATAS, eventos=[separada]), cursor="2")))
        self.assertEqual(len(self.despachos()), 1)
        self.assertEqual(self.tipos(), ["juntar"])

    def test_juntar_aplicado_encerra_o_item_como_juntada(self):
        self.triar_com_resposta(resposta_cruzada({"juntar": JUNTAR}))
        demandas.esvaziar_saida(self.estado, ClienteFalso("aplicado"), self.raiz, salvar=lambda: None)
        self.assertEqual(demandas.proxima_acao(self.item(), retrato(encerrada="juntada")), "encerrar")
        eventos = self.passo(ClienteDeBusca(pagina(retrato(encerrada="juntada"), cursor="2")))
        self.assertNotIn(ID, self.estado["demandas"]["itens"])
        self.assertIn({"evento": "demanda_encerrada", "id": ID}, eventos)
        self.assertEqual(self.saida(), [])


PR = "https://github.com/kustertech-exemplo/app/pull/7"
HEAD = "a" * 40
CAMINHO = ".fabrica/planos/demanda-11111111.json"


def plano_da_demanda():
    plano = plano_referencia()
    plano["demanda"] = ID
    return plano


class TestesPlano(BasePasso):
    def planejar(self, **extra):
        """Um ciclo com a demanda na etapa `planejada`: o run do orquestrador fica despachado."""
        self.passo(ClienteDeBusca(pagina(retrato("planejada", **extra))))
        return self.item()["runId"]

    def com_pr(self, run_id, *, arquivos=(CAMINHO,), ci="verde", plano=None, config=None):
        self.forja.definir_pr(PR, head_sha=HEAD, branch="fabrica/demanda", arquivos=list(arquivos))
        self.forja.definir_ci(REPO, HEAD, ci)
        self.forja.definir_arquivo(REPO, HEAD, CAMINHO, json.dumps(plano_da_demanda() if plano is None else plano))
        if config is not None:  # a config vale a do branch padrão, nunca a do head do PR
            self.forja.definir_arquivo(REPO, "main", ".fabrica/config.json", json.dumps(config))
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR)

    def trava(self):
        return capacidade.ler(self.capacidade)["orquestrador"].get(REPO)

    def test_planejamento_toma_a_trava_do_orquestrador_e_nao_reserva_vaga(self):
        capacidade.configurar(self.capacidade, vagas=1, ram_minima_mb=0)
        self.assertTrue(capacidade.reservar(self.capacidade, "outro-plano", "raia-0", mem_disponivel_mb=None))
        self.assertTrue(capacidade.tomar_orquestrador(self.capacidade, REPO, "outro-plano"))
        reservas = capacidade.ler(self.capacidade)["reservas"]
        # trava de outro plano: espera o próximo ciclo, sem despachar
        self.passo(ClienteDeBusca(pagina(retrato("planejada"))))
        self.assertEqual(self.despachos(), [])
        self.assertEqual(self.item()["fase"], "nova")
        capacidade.soltar_orquestrador(self.capacidade, REPO, "outro-plano")
        self.passo(ClienteDeBusca())
        (despacho,) = self.despachos()
        orq = CONFIG_DO_KIT["modelos"]["orquestrador"]
        self.assertEqual((despacho["agente"], despacho["modelo"], despacho["max_custo_usd"], despacho["projeto"]), (orq["agente"], orq["modelo"], orq["maxCustoUsd"], "app"))
        hexa = demandas.nonce_do_motor(ID, "plano", 0)
        self.assertEqual(despacho["chave_idempotencia"], hexa)
        self.assertTrue(despacho["prompt"].endswith("<!-- fabrica:nonce=%s -->" % hexa))
        self.assertIn("Motivo: nova_spec", despacho["prompt"])
        self.assertIn("Seu plano: `%s`" % CAMINHO, despacho["prompt"])
        self.assertEqual(self.trava(), demandas.chave(ID))
        self.assertEqual(capacidade.ler(self.capacidade)["reservas"], reservas)
        self.assertEqual(demandas.chaves_ocupando(self.estado), set())
        antes = [x["demandas"]["itens"][ID] for x in self.salvos if x["demandas"]["itens"][ID].get("fase") == "planejando"]
        self.assertEqual((antes[0]["nonce"], antes[0]["runId"]), (hexa, None))  # no disco antes do POST
        self.assertEqual((self.item()["fase"], self.item()["runId"]), ("planejando", "run-1"))

    def test_triagem_da_demanda_vai_no_contexto_do_plano(self):
        self.triar()
        self.motor.definir_run("run-1", estado="succeeded")
        self.motor.definir_texto("run-1", resposta_triagem(triagem_ok()))
        self.passo(ClienteDeBusca())
        self.estado["demandas"]["saida"] = []
        self.passo(ClienteDeBusca(pagina(retrato("planejada"), cursor="2")))
        prompt = self.despachos()[-1]["prompt"]
        self.assertIn('"motivo": "defeito pequeno"', prompt)
        self.assertIn('"plano": "%s"' % CAMINHO, prompt)

    def test_plano_so_em_fabrica_com_ci_verde_e_mergeado_e_vira_plano_criado(self):
        run_id = self.planejar()
        self.com_pr(run_id, arquivos=(CAMINHO, ".fabrica/planejamento/exportar/plano.md", ".seeds/issues.jsonl"))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR, HEAD)])
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("plano_criado", {"plano": CAMINHO, "prUrl": PR}))
        self.assertEqual((self.item()["fase"], self.item()["plano"], self.item()["prUrl"]), ("plano_no_repo", CAMINHO, PR))
        self.assertIsNone(self.trava())
        self.assertEqual(len(self.despachos()), 1)
        # o ciclo seguinte não mergeia nem enfileira de novo
        self.estado["demandas"]["saida"] = []
        self.passo(ClienteDeBusca())
        self.assertEqual((len(self.forja.merges), self.saida(), len(self.despachos())), (1, [], 1))

    def test_ci_ausente_passa_sem_ci_obrigatorio_no_plano(self):
        run_id = self.planejar()
        self.com_pr(run_id, ci="ausente")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida()[0]["tipo"], "plano_criado")

    def test_ci_ausente_com_ci_obrigatorio_no_plano_trava(self):
        run_id = self.planejar()
        self.com_pr(run_id, ci="ausente", config={"protegidos": [], "ciObrigatorioNoPlano": True})
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(self.saida()[0]["dados"], {"motivo": "o repositório exige CI no plano e o head não tem CI", "url": PR})

    def test_ci_vermelho_vira_travada(self):
        run_id = self.planejar()
        self.com_pr(run_id, ci="vermelho")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [])
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o CI do plano está vermelho", "url": PR}))
        self.assertIsNone(self.trava())

    def test_plano_que_mexe_fora_de_fabrica_vira_travada_e_nao_mergeia(self):
        for fora in ("src/app.ts", ".fabrica/planos/outra-feature.json", ".fabrica/config.json", ".fabrica/demandas/x/desenho.html"):
            with self.subTest(fora=fora):
                self.setUp()
                run_id = self.planejar()
                self.com_pr(run_id, arquivos=(CAMINHO, fora, "src/outro.ts"))
                self.passo(ClienteDeBusca())
                self.assertEqual(self.forja.merges, [])
                (evento,) = self.saida()
                self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o plano mexe fora de .fabrica: %s" % fora, "url": PR}))
                self.assertEqual(self.item()["fase"], "esperando_paulo")
                self.assertIsNone(self.trava())

    PERGUNTA = "# Pergunta ao Paulo — demanda 11111111\n\nTexto longo.\n\n## 1. O que fazer\n- (a) padrão\n"

    def perguntar(self, *, extras=(".fabrica/planejamento/demanda-11111111/cobertura.md", ".seeds/issues.jsonl")):
        run_id = self.planejar()
        self.com_pr(run_id, arquivos=(".fabrica/pergunta.md",) + tuple(extras))
        self.forja.definir_arquivo(REPO, HEAD, ".fabrica/pergunta.md", self.PERGUNTA)
        self.passo(ClienteDeBusca())

    def test_pergunta_do_orquestrador_vira_travada_com_a_pergunta_e_nao_mergeia(self):
        self.perguntar()
        self.assertEqual(self.forja.merges, [])
        (evento,) = self.saida()
        self.assertEqual(
            (evento["tipo"], evento["dados"]),
            ("travada", {"motivo": "o orquestrador perguntou (responda ao tentar de novo): Pergunta ao Paulo — demanda 11111111", "url": PR}),
        )
        self.assertEqual(self.item()["pergunta"], self.PERGUNTA)
        self.assertEqual(self.item()["fase"], "esperando_paulo")
        self.assertIsNone(self.trava())

    def test_pergunta_com_arquivo_fora_continua_fora(self):
        self.perguntar(extras=("src/app.ts",))
        (evento,) = self.saida()
        self.assertEqual(evento["dados"]["motivo"], "o plano mexe fora de .fabrica: src/app.ts")

    def test_resposta_do_paulo_na_retomada_vai_na_conversa_do_planejamento_novo(self):
        self.perguntar()
        self.estado["demandas"]["saida"] = []
        self.passo(ClienteDeBusca(pagina(retrato("planejada", espera="travada"), cursor="2")))
        self.avancar(60)
        retomada = [{"id": OUTRO, "tipo": "retomada", "origem": "paulo", "em": "2026-11-20T10:01:00Z", "dados": {"resposta": "1a 2a"}}]
        self.passo(ClienteDeBusca(pagina(retrato("planejada", eventos=retomada), cursor="3")))
        self.assertEqual(len(self.despachos()), 2)
        prompt = self.despachos()[1]["prompt"]
        ctx, _ = json.JSONDecoder().raw_decode(prompt[prompt.index("Contexto:\n") + len("Contexto:\n"):])
        self.assertEqual(ctx["conversa"], [{"pergunta": self.PERGUNTA.strip(), "resposta": "1a 2a"}])
        self.assertNotIn("pergunta", self.item())
        self.assertEqual(self.item()["conversa"], [{"pergunta": self.PERGUNTA, "resposta": "1a 2a"}])

    def test_retomada_sem_resposta_tambem_leva_a_pergunta_com_resposta_vazia(self):
        self.perguntar()
        self.estado["demandas"]["saida"] = []
        self.avancar(60)
        retomada = [{"id": OUTRO, "tipo": "retomada", "origem": "paulo", "em": "2026-11-20T10:01:00Z", "dados": {}}]
        self.passo(ClienteDeBusca(pagina(retrato("planejada", eventos=retomada), cursor="3")))
        self.assertEqual(self.item()["conversa"], [{"pergunta": self.PERGUNTA, "resposta": ""}])

    def test_config_do_head_do_plano_nao_vale(self):
        run_id = self.planejar()
        self.com_pr(run_id, arquivos=(CAMINHO, ".fabrica/planejamento/auth/notas.md"), config={"protegidos": ["**/auth/**"]})
        self.forja.definir_arquivo(REPO, HEAD, ".fabrica/config.json", json.dumps({"protegidos": []}))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(self.saida()[-1]["tipo"], "travada")

    def test_plano_em_caminho_protegido_da_config_vira_travada(self):
        run_id = self.planejar()
        self.com_pr(run_id, arquivos=(CAMINHO, ".fabrica/planejamento/auth/notas.md"), config={"protegidos": ["**/auth/**"]})
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(self.saida()[0]["dados"]["motivo"], "o plano mexe em caminho protegido: .fabrica/planejamento/auth/notas.md")

    def test_plano_invalido_ou_sem_o_id_da_demanda_vira_travada(self):
        sem_fases = plano_da_demanda()
        sem_fases["fases"] = []
        outra = plano_da_demanda()
        outra["demanda"] = OUTRO
        casos = (
            (sem_fases, "o plano não passa em validar_plano: plano sem fases"),
            (outra, 'o plano não traz "demanda": "%s"' % ID),
        )
        for plano, motivo in casos:
            with self.subTest(motivo=motivo):
                self.setUp()
                run_id = self.planejar()
                self.com_pr(run_id, plano=plano)
                self.passo(ClienteDeBusca())
                self.assertEqual(self.forja.merges, [])
                self.assertEqual(self.saida()[0]["dados"]["motivo"], motivo)
        self.setUp()
        run_id = self.planejar()
        self.com_pr(run_id, arquivos=(".seeds/issues.jsonl",))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida()[0]["dados"]["motivo"], "o PR não traz o plano %s" % CAMINHO)

    def test_ci_pendente_espera_e_depois_de_2h_vira_travada(self):
        run_id = self.planejar()
        self.com_pr(run_id, ci="pendente")
        self.passo(ClienteDeBusca())
        self.assertEqual((self.forja.merges, self.saida()), ([], []))
        self.assertEqual(self.trava(), demandas.chave(ID))
        self.avancar(7199)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        self.avancar(2)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [])
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o CI do plano não terminou em 2 h", "url": PR}))
        self.assertIsNone(self.trava())
        self.assertEqual(len(self.despachos()), 1)

    def test_ci_pendente_que_fica_verde_mergeia_no_mesmo_head(self):
        run_id = self.planejar()
        self.com_pr(run_id, ci="pendente")
        self.passo(ClienteDeBusca())
        self.avancar(600)
        self.forja.definir_ci(REPO, HEAD, "verde")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR, HEAD)])

    def test_planejar_comigo_nunca_despacha_e_adota_o_plano_entregue_pela_sessao(self):
        self.passo(ClienteDeBusca(pagina(retrato("planejada", espera="planejar_comigo", nivel="planejar_comigo"))))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.despachos(), [])
        self.assertEqual(self.item()["fase"], "esperando_sessao")
        self.assertIsNone(self.trava())
        entregue = {"caminho": ".fabrica/planos/exportar.json", "prUrl": None, "artefato": None}
        self.passo(ClienteDeBusca(pagina(retrato("planejada", espera="planejar_comigo", nivel="planejar_comigo", plano=entregue), cursor="2")))
        self.assertEqual((self.item()["fase"], self.item()["plano"]), ("plano_no_repo", ".fabrica/planos/exportar.json"))
        self.assertEqual((self.despachos(), self.saida(), self.forja.merges), ([], [], []))

    def test_planejar_comigo_adota_o_plano_mesmo_com_a_etapa_ja_adiante(self):
        self.passo(ClienteDeBusca(pagina(retrato("planejada", espera="planejar_comigo", nivel="planejar_comigo"))))
        entregue = {"caminho": ".fabrica/planos/exportar.json", "prUrl": None, "artefato": None}
        eventos = self.passo(ClienteDeBusca(pagina(retrato("desenho", nivel="planejar_comigo", plano=entregue), cursor="2")))
        self.assertEqual(self.item()["plano"], ".fabrica/planos/exportar.json")
        self.assertIn({"evento": "demanda_plano_da_sessao", "id": ID, "plano": ".fabrica/planos/exportar.json"}, eventos)
        # antes da primeira versão o desenho não espera o Paulo: o ux-ui desenha no mesmo ciclo
        self.assertEqual(self.item()["fase"], "desenhando")

    def artefato_esperando_o_paulo(self):
        """"Planejar comigo" com o artefato do Claude: o Flow entra no desenho esperando a aprovação (versão 0)."""
        self.passo(ClienteDeBusca(pagina(retrato("planejada", espera="planejar_comigo", nivel="planejar_comigo"))))
        entregue = {"caminho": ".fabrica/planos/exportar.json", "prUrl": None, "artefato": "https://claude.ai/a/1"}
        self.passo(ClienteDeBusca(pagina(retrato("desenho", espera="aprovar_desenho", nivel="planejar_comigo", plano=entregue), cursor="2")))
        self.assertEqual(self.item()["fase"], "plano_no_repo")
        self.assertEqual((self.despachos(), self.saida()), ([], []))
        return entregue

    def test_planejar_comigo_com_artefato_aprovado_vai_ao_desenvolvimento_sem_ux_ui_nem_merge_de_desenho(self):
        entregue = self.artefato_esperando_o_paulo()
        self.passo(ClienteDeBusca())
        self.assertEqual(self.despachos(), [])
        aprovado = [{"id": OUTRO, "tipo": "desenho_aprovado", "origem": "paulo", "em": AGORA, "dados": {"versao": 0, "peloArtefato": True}}]
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", nivel="planejar_comigo", plano=entregue, desenho={"versao": 0, "aprovada": 0}, eventos=aprovado), cursor="3")))
        self.assertEqual(self.item()["fase"], "plano_no_repo")
        self.assertEqual(demandas.proxima_acao(self.item(), retrato("desenvolvida", nivel="planejar_comigo", plano=entregue)), "acompanhar")
        self.assertEqual((self.despachos(), self.saida(), self.forja.merges, self.reservas()), ([], [], [], {}))

    def test_planejar_comigo_com_artefato_e_ajuste_espera_a_sessao_de_novo(self):
        entregue = self.artefato_esperando_o_paulo()
        ajuste = [{"id": OUTRO, "tipo": "ajuste_pedido", "origem": "paulo", "em": AGORA, "dados": {"versao": 0, "texto": "botão embaixo"}}]
        espera_sessao = retrato("desenho", espera="planejar_comigo", nivel="planejar_comigo", plano=entregue, eventos=ajuste, ajustes=[{"versao": 0, "texto": "botão embaixo", "em": AGORA}])
        self.passo(ClienteDeBusca(pagina(espera_sessao, cursor="3")))
        self.passo(ClienteDeBusca())
        self.assertEqual((self.despachos(), self.saida(), self.reservas()), ([], [], {}))
        self.assertEqual(demandas.proxima_acao(self.item(), espera_sessao), "nada")
        # a sessão entrega de novo: o Flow volta a esperar a aprovação, e o kit segue sem desenhar
        de_novo = dict(entregue, artefato="https://claude.ai/a/2")
        self.passo(ClienteDeBusca(pagina(retrato("desenho", espera="aprovar_desenho", nivel="planejar_comigo", plano=de_novo), cursor="4")))
        self.assertEqual((self.despachos(), self.saida(), self.item()["fase"]), ([], [], "plano_no_repo"))

    def reservas(self):
        return capacidade.ler(self.capacidade)["reservas"]

    def test_trava_do_orquestrador_e_solta_ao_sair_de_planejando(self):
        # sem PR: uma nova tentativa (nonce novo), depois `travada`
        run_id = self.planejar()
        self.motor.definir_run(run_id, estado="succeeded")
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(self.despachos()[1]["chave_idempotencia"], demandas.nonce_do_motor(ID, "plano", 1))
        self.assertEqual(self.trava(), demandas.chave(ID))
        self.motor.definir_run(self.item()["runId"], estado="failed", motivoFalha="erro")
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 2)
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o orquestrador terminou sem PR do plano 2 vezes", "url": None}))
        self.assertIsNone(self.trava())
        # o Paulo encerra a demanda com o run no meio: a trava fica até o run terminar (o motor não cancela run)
        self.setUp()
        run_id = self.planejar()
        self.assertEqual(self.trava(), demandas.chave(ID))
        self.passo(ClienteDeBusca(pagina(retrato("planejada", encerrada="cancelada"), cursor="2")))
        self.assertIsNone(self.item()["runId"])
        self.assertEqual(self.trava(), demandas.chave(ID))
        self.assertEqual(demandas.chaves_do_orquestrador(self.estado), {demandas.chave(ID)})
        self.passo(ClienteDeBusca())
        self.assertEqual(self.trava(), demandas.chave(ID))
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR)  # termina com PR: o resultado não conta
        self.passo(ClienteDeBusca())
        self.assertIsNone(self.trava())
        self.assertEqual((self.saida(), self.forja.merges, demandas.chaves_do_orquestrador(self.estado)), ([], [], set()))

    def test_plano_parado_pelo_paulo_segura_a_trava_ate_o_run_terminar_e_a_retomada_planeja_de_novo(self):
        run_id = self.planejar()
        self.assertTrue(self.trava())
        capacidade.tomar_orquestrador(self.capacidade, REPO, "outro-plano")  # outro plano espera a trava
        self.passo(ClienteDeBusca(pagina(retrato("planejada", espera="travada"), cursor="2")))
        self.assertEqual((self.item()["fase"], self.item()["runId"]), ("esperando_paulo", None))
        self.assertEqual(self.trava(), demandas.chave(ID))
        self.assertFalse(capacidade.tomar_orquestrador(self.capacidade, REPO, "outro-plano"))
        # a retomada com o run antigo vivo não despacha um segundo orquestrador
        self.avancar(60)
        retomada = [{"id": OUTRO, "tipo": "retomada", "origem": "paulo", "em": "2026-11-20T10:01:00Z", "dados": {}}]
        self.passo(ClienteDeBusca(pagina(retrato("planejada", eventos=retomada), cursor="3")))
        self.assertEqual(len(self.despachos()), 1)
        self.motor.definir_run(run_id, estado="failed", motivoFalha="erro")
        self.passo(ClienteDeBusca())
        # o run terminou: a trava solta, e quem esperava primeiro na fila do repositório a leva
        self.assertEqual(len(self.despachos()), 1)
        self.assertTrue(capacidade.tomar_orquestrador(self.capacidade, REPO, "outro-plano"))
        capacidade.soltar_orquestrador(self.capacidade, REPO, "outro-plano")
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(self.despachos()[1]["chave_idempotencia"], demandas.nonce_do_motor(ID, "plano", 1))
        self.assertEqual(self.trava(), demandas.chave(ID))

    def test_nivel_ausente_nulo_ou_desconhecido_nao_planeja_sozinho(self):
        for nivel in ("ausente", None, "outro"):
            with self.subTest(nivel=nivel):
                self.setUp()
                r = retrato("planejada", nivel=nivel)
                if nivel == "ausente":
                    del r["nivel"]
                eventos = self.passo(ClienteDeBusca(pagina(r)))
                self.assertEqual(self.despachos(), [])
                self.assertEqual(self.item()["fase"], "esperando_sessao")
                self.assertIsNone(self.trava())
                self.assertEqual([e["chave"] for e in eventos if e.get("evento") == "aviso"], ["demandas:nivel:%s" % ID])
                self.assertEqual(demandas.NIVEIS_SEM_SESSAO, ("vai_sozinho", "aprovar_desenho"))

    def test_aprovar_desenho_planeja_e_mergeia(self):
        run_id = self.planejar(nivel="aprovar_desenho")
        self.com_pr(run_id)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR, HEAD)])

    def test_nivel_nulo_ou_desconhecido_na_hora_do_merge_nao_mergeia(self):
        for nivel in (None, "outro"):
            with self.subTest(nivel=nivel):
                self.setUp()
                run_id = self.planejar()
                self.com_pr(run_id)
                self.passo(ClienteDeBusca(pagina(retrato("planejada", nivel=nivel), cursor="2")))
                self.assertEqual(self.forja.merges, [])
                self.assertEqual(self.saida()[0]["dados"], {"motivo": "o nível da demanda não deixa a Fábrica mergear o plano", "url": PR})

    def test_plano_acima_de_2h_sem_pr_vira_travada_e_segura_a_trava_ate_o_run_terminar_ou_a_folga(self):
        self.planejar()
        self.avancar(7199)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        self.avancar(2)
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o plano passou de 2 h sem PR", "url": None}))
        self.assertEqual(self.item()["fase"], "esperando_paulo")
        self.assertEqual(self.trava(), demandas.chave(ID))  # o run ainda roda
        self.avancar(1798)  # 2 h 30 min do despacho, ainda dentro
        self.passo(ClienteDeBusca())
        self.assertEqual(self.trava(), demandas.chave(ID))
        self.avancar(2)
        self.passo(ClienteDeBusca())
        self.assertIsNone(self.trava())
        self.assertEqual((demandas.TETO_PLANO_S, demandas.FOLGA_DO_RUN_SUPERADO_S), (7200, 1800))

    def test_sem_modelo_com_o_post_pendente_cai_no_teto(self):
        self.motor.falhar_despacho("antes")
        self.planejar()
        self.assertEqual((self.item()["fase"], self.item()["runId"]), ("planejando", None))
        modelos = dict(CONFIG_DO_KIT["modelos"])
        del modelos["orquestrador"]
        self.avancar(7201)
        self.passo(ClienteDeBusca(), modelos=modelos)
        self.assertEqual(self.saida()[0]["dados"]["motivo"], "o plano passou de 2 h sem PR")
        self.passo(ClienteDeBusca(), modelos=modelos)  # o POST nunca criou o run: a trava solta
        self.assertIsNone(self.trava())

    def test_o_mesmo_erro_5_ciclos_seguidos_vira_travada_e_solta_a_trava(self):
        run_id = self.planejar()
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR)  # a forja não conhece o PR: KeyError todo ciclo
        for _ in range(4):
            eventos = self.passo(ClienteDeBusca())
            self.assertIn("erro", [e["evento"] for e in eventos])
            self.assertEqual(self.saida(), [])
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["tipo"], "travada")
        self.assertTrue(evento["dados"]["motivo"].startswith("o plano parou: o mesmo erro 5 ciclos seguidos (KeyError"))
        self.assertEqual(evento["dados"]["url"], PR)
        self.assertIsNone(self.trava())
        self.assertEqual(demandas.LIMITE_ERROS_DO_PLANO, 5)

    def test_um_ciclo_sem_erro_zera_a_contagem(self):
        run_id = self.planejar()
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR)
        for _ in range(4):
            self.passo(ClienteDeBusca())
        self.com_pr(run_id, ci="pendente")
        self.passo(ClienteDeBusca())
        self.assertNotIn("erroDoPlano", self.item())
        self.forja = forja_.ForjaFalsa()
        for _ in range(4):
            self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])

    def test_link_de_pr_invalido_vira_travada(self):
        run_id = self.planejar()
        self.motor.definir_run(run_id, estado="succeeded", prUrl="https://github.com/kustertech-exemplo/app/issues/3")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida()[0]["dados"], {"motivo": "o run do plano devolveu um link de PR inválido", "url": None})
        self.assertIsNone(self.trava())

    def test_queda_no_post_do_plano_acha_o_run_pelo_nonce(self):
        self.motor.falhar_despacho("incerta")
        self.passo(ClienteDeBusca(pagina(retrato("planejada"))))
        self.assertEqual((self.item()["fase"], self.item()["runId"]), ("planejando", None))
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 1)
        self.assertEqual(self.item()["runId"], "run-1")

    def test_queda_depois_do_merge_recupera_e_vira_plano_criado(self):
        run_id = self.planejar()
        self.com_pr(run_id)
        self.assertTrue(self.forja.mergear(PR, HEAD))  # o merge passou, o estado não foi gravado
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.forja.merges), 1)
        self.assertEqual(self.saida()[0]["tipo"], "plano_criado")
        self.assertIsNone(self.trava())

    def test_nivel_planejar_comigo_nunca_mergeia(self):
        run_id = self.planejar()
        self.com_pr(run_id)
        self.passo(ClienteDeBusca(pagina(retrato("planejada", nivel="planejar_comigo"), cursor="2")))
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(self.saida()[0]["dados"]["motivo"], "planejar comigo: o PR do plano vai para o Paulo")

    def test_retomada_do_paulo_depois_da_trava_planeja_de_novo(self):
        run_id = self.planejar()
        self.com_pr(run_id, ci="vermelho")
        self.passo(ClienteDeBusca())
        self.estado["demandas"]["saida"] = []
        self.passo(ClienteDeBusca(pagina(retrato("planejada", espera="travada"), cursor="2")))
        self.assertEqual(len(self.despachos()), 1)
        self.passo(ClienteDeBusca(pagina(retrato("planejada"), cursor="3")))  # sem retomada: nada
        self.assertEqual(len(self.despachos()), 1)
        self.avancar(60)
        retomada = [{"id": OUTRO, "tipo": "retomada", "origem": "paulo", "em": "2026-11-20T10:01:00Z", "dados": {}}]
        self.passo(ClienteDeBusca(pagina(retrato("planejada", eventos=retomada), cursor="4")))
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(self.despachos()[1]["chave_idempotencia"], demandas.nonce_do_motor(ID, "plano", 1))

    def test_plano_criado_recusado_pelo_flow_vira_travada_uma_vez(self):
        run_id = self.planejar()
        self.com_pr(run_id)
        self.passo(ClienteDeBusca())
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o Flow recusou o plano criado pela Fábrica", "url": PR}))
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        self.assertFalse(self.item()["precisa_ressincronizar"])
        self.assertEqual(len(self.despachos()), 1)

    def test_sem_modelo_do_orquestrador_espera_com_aviso(self):
        modelos = dict(CONFIG_DO_KIT["modelos"])
        del modelos["orquestrador"]
        eventos = self.passo(ClienteDeBusca(pagina(retrato("planejada"))), modelos=modelos)
        self.assertEqual(self.despachos(), [])
        self.assertIn("demandas:modelo:orquestrador", [e.get("chave") for e in eventos])
        self.assertIsNone(self.trava())


class TestesPrazoDasChaves(unittest.TestCase):
    """A vaga e a trava de uma demanda vencem no teto da fase + 30 min (e o do CI pendente + 30 min), mesmo sem o
    `decidir` rodar: o coordenador passa o `agora`."""

    def estado(self, **it):
        return {"demandas": com_itens(**{ID: item(**it)})}

    def em(self, segundos):
        return INSTANTE + datetime.timedelta(seconds=segundos)

    def test_vaga_do_desenho_vence_no_teto_mais_a_folga(self):
        estado = self.estado(fase="desenhando", alvo="desenhando", runId="r1", inicio=AGORA)
        limite = demandas.TETO_RUN_S + demandas.FOLGA_DO_RUN_SUPERADO_S
        self.assertEqual(demandas.chaves_ocupando(estado, self.em(limite)), {demandas.chave(ID)})
        self.assertEqual(demandas.chaves_ocupando(estado, self.em(limite + 1)), set())
        self.assertEqual(demandas.chaves_ocupando(estado), {demandas.chave(ID)})  # sem `agora`, como antes
        self.assertEqual(demandas.chaves_vencidas(estado, self.em(limite + 1)), [(ID, "desenhando", AGORA)])
        self.assertEqual(demandas.chaves_vencidas(estado, self.em(limite)), [])

    def test_ci_pendente_e_run_superado_tem_o_proprio_prazo(self):
        depois = "2026-11-20T11:30:00Z"  # o CI ficou pendente 1 h 30 min depois do despacho
        estado = self.estado(fase="corrigindo", alvo="corrigindo", runId="r1", inicio=AGORA, correcao={"ciPendenteDesde": depois})
        limite = 5400 + demandas.CI_PENDENTE_MAXIMO_S + demandas.FOLGA_DO_RUN_SUPERADO_S
        self.assertEqual(demandas.chaves_ocupando(estado, self.em(limite)), {demandas.chave(ID)})
        self.assertEqual(demandas.chaves_ocupando(estado, self.em(limite + 1)), set())
        sup = self.estado(fase="esperando_paulo", testeSuperado={"runId": "r1", "inicio": AGORA})
        self.assertEqual(demandas.chaves_ocupando(sup, self.em(demandas.TETO_RUN_S + 1800)), {demandas.chave(ID)})
        self.assertEqual(demandas.chaves_ocupando(sup, self.em(demandas.TETO_RUN_S + 1801)), set())

    def test_trava_do_plano_vence_e_inicio_ilegivel_vence_logo(self):
        estado = self.estado(fase="planejando", alvo="planejando", inicio=AGORA, ciPendenteDesde=None)
        limite = demandas.TETO_PLANO_S + demandas.FOLGA_DO_RUN_SUPERADO_S
        self.assertEqual(demandas.chaves_do_orquestrador(estado, self.em(limite)), {demandas.chave(ID)})
        self.assertEqual(demandas.chaves_do_orquestrador(estado, self.em(limite + 1)), set())
        sup = self.estado(fase="esperando_paulo", runSuperado={"runId": "r1", "inicio": AGORA})
        self.assertEqual(demandas.chaves_do_orquestrador(sup, self.em(limite + 1)), set())
        torto = self.estado(fase="planejando", alvo="planejando", inicio="ontem")
        self.assertEqual(demandas.chaves_do_orquestrador(torto, INSTANTE), set())
        self.assertEqual(demandas.chaves_vencidas(torto, INSTANTE), [(ID, "planejando", "ontem")])


class TestesBusca(BasePasso):
    def test_busca_recusada_401_espera_15_min_com_um_aviso(self):
        cliente = ClienteDeBusca(FalhaDeEnvio("HTTP 401"), FalhaDeEnvio("HTTP 401"))
        eventos = self.passo(cliente, modelos={})
        self.assertEqual(
            [e["mensagem"] for e in eventos if e.get("chave") == demandas.CHAVE_BUSCA],
            ["Demandas: o Flow recusou a busca (HTTP 401); tento de novo a cada 15 min"],
        )
        self.avancar(14 * 60)
        self.assertEqual(self.passo(cliente, modelos={}), [])
        self.assertEqual(len(cliente.desdes), 1)
        self.avancar(60)
        self.passo(cliente, modelos={})  # passou dos 15 min: uma tentativa, recusada de novo
        self.assertEqual(len(cliente.desdes), 2)
        self.avancar(15 * 60)
        self.passo(cliente, modelos={})  # a busca voltou: a espera sai
        self.assertEqual(len(cliente.desdes), 3)
        self.assertNotIn("buscaRecusadaEm", self.estado["demandas"])
        # rede e 5xx continuam tentando em todo ciclo
        cliente = ClienteDeBusca(FalhaDeEnvio("HTTP 503"))
        self.passo(cliente, modelos={})
        self.passo(cliente, modelos={})
        self.assertEqual(len(cliente.desdes), 2)

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


ID_DO_PLANO = "kustertech-exemplo--app--demanda-11111111--abc123"


def na_fila(estado="aguardando", *, demanda=ID, caminho=CAMINHO, repo=REPO, id_=ID_DO_PLANO, **extra):
    base = {
        "id": id_,
        "repo": repo,
        "feature": caminho.rsplit("/", 1)[-1][: -len(".json")],
        "caminho": caminho,
        "entrouEm": "2026-11-20T09:30:00Z",
        "estado": estado,
        "arquivos": ["src/a/**"],
        "hash": "h",
    }
    if demanda is not None:
        base["demanda"] = demanda
    base.update(extra)
    return base


def com_itens(**itens):
    return {"cursor": None, "semRotaEm": None, "saida": [], "itens": {i: it for i, it in itens.items()}}


class TestesAplicarNaFila(unittest.TestCase):
    def test_aplicar_na_fila_segura_ate_a_etapa_desenvolvida_e_solta_depois(self):
        fila_ = [na_fila()]
        for marco in ("recebida", "planejada", "desenho"):
            with self.subTest(marco=marco):
                nova = demandas.aplicar_na_fila(com_itens(**{ID: item("plano_no_repo", ultima=retrato(marco))}), fila_)
                self.assertEqual((nova[0]["segurado"], nova[0]["seguradoPor"], nova[0]["urgente"]), (True, "demanda", False))
        self.assertNotIn("segurado", fila_[0])  # pura: a fila de entrada não muda
        segurada = demandas.aplicar_na_fila(com_itens(**{ID: item("plano_no_repo", ultima=retrato("desenho"))}), fila_)
        # o retrato recém-chegado (`recebida`) vale mais que a `ultima`
        it = item("plano_no_repo", ultima=retrato("desenho"), recebida=retrato("desenvolvida", destino="urgente"))
        solta = demandas.aplicar_na_fila(com_itens(**{ID: it}), segurada)
        self.assertIs(solta[0]["segurado"], False)
        self.assertNotIn("seguradoPor", solta[0])
        self.assertIs(solta[0]["urgente"], True)
        # depois de desenvolvida (o Paulo concluiu a etapa) também fica solta
        depois = demandas.aplicar_na_fila(com_itens(**{ID: item("plano_no_repo", ultima=retrato("testada"))}), segurada)
        self.assertIs(depois[0]["segurado"], False)
        # sem tela não há desenho: o plano fica segurado só até desenvolvida
        sem_tela = [e for e in MODELO if e["marco"] not in ("desenho", "testada")]
        nova = demandas.aplicar_na_fila(com_itens(**{ID: item("plano_no_repo", ultima=retrato("planejada", etapas=sem_tela))}), fila_)
        self.assertIs(nova[0]["segurado"], True)
        nova = demandas.aplicar_na_fila(com_itens(**{ID: item("plano_no_repo", ultima=retrato("desenvolvida", etapas=sem_tela))}), nova)
        self.assertIs(nova[0]["segurado"], False)

    def test_aplicar_na_fila_liga_pelo_caminho_do_plano_no_mesmo_repositorio(self):
        plano = {"caminho": CAMINHO, "prUrl": None, "artefato": None}
        itens = com_itens(**{ID: item("plano_no_repo", ultima=retrato("desenho", plano=plano, destino="urgente"))})
        nova = demandas.aplicar_na_fila(itens, [na_fila(demanda=None), na_fila(demanda=None, repo="kustertech-exemplo/outro", id_="x")])
        self.assertEqual((nova[0]["demanda"], nova[0]["segurado"], nova[0]["urgente"]), (ID, True, True))
        self.assertEqual(nova[1], na_fila(demanda=None, repo="kustertech-exemplo/outro", id_="x"))

    def test_aplicar_na_fila_liga_pelo_prefixo_da_feature_sem_o_campo_demanda(self):
        # "planejar comigo": a sessão pode entregar o plano sem o campo `demanda` e o retrato sem o caminho
        itens = com_itens(**{ID: item("esperando_sessao", ultima=retrato("planejada", espera="planejar_comigo"))})
        sem_campo = na_fila(demanda=None)
        outro_repo = na_fila(demanda=None, repo="kustertech-exemplo/outro", id_="x")
        outra_feature = na_fila(demanda=None, caminho=".fabrica/planos/demanda-11111111x.json", id_="y")
        nova = demandas.aplicar_na_fila(itens, [sem_campo, outro_repo, outra_feature])
        self.assertEqual((nova[0]["demanda"], nova[0]["segurado"], nova[0]["seguradoPor"]), (ID, True, "demanda"))
        self.assertEqual(nova[1:], [outro_repo, outra_feature])
        # o prefixo só liga a uma demanda que o kit conhece: um plano qualquer chamado demanda-<algo> segue livre
        self.assertEqual(demandas.aplicar_na_fila(com_itens(), [sem_campo]), [sem_campo])
        com_sufixo = na_fila(demanda=None, caminho=".fabrica/planos/demanda-11111111-tela.json")
        self.assertEqual(demandas.aplicar_na_fila(itens, [com_sufixo])[0]["demanda"], ID)

    def test_aplicar_na_fila_segura_plano_de_demanda_desconhecida_e_nao_toca_no_resto(self):
        outras = [
            na_fila(demanda=None, caminho=".fabrica/planos/login.json", id_="login"),
            na_fila("ativo", id_="ativo"),
            na_fila("concluido", demanda=OUTRO, id_="concluido"),
            "torta",
        ]
        nova = demandas.aplicar_na_fila(com_itens(), [na_fila(demanda=OUTRO), *outras])
        self.assertEqual((nova[0]["segurado"], nova[0]["seguradoPor"]), (True, "demanda"))
        self.assertEqual(nova[1:], outras)
        self.assertEqual(demandas.aplicar_na_fila({}, []), [])

    def test_aplicar_na_fila_nao_solta_plano_segurado_pelo_paulo(self):
        pelo_paulo = [na_fila(segurado=True)]
        for marco in ("desenho", "desenvolvida"):
            with self.subTest(marco=marco):
                nova = demandas.aplicar_na_fila(com_itens(**{ID: item("plano_no_repo", ultima=retrato(marco))}), pelo_paulo)
                self.assertIs(nova[0]["segurado"], True)
                self.assertNotIn("seguradoPor", nova[0])


class TestesDesenvolvimento(BasePasso):
    def com_plano(self, estado="ativo", *, fase="plano_no_repo", marco="desenvolvida", **extra):
        self.estado["fila"] = [na_fila(estado)]
        demandas.secao(self.estado)["itens"][ID] = item(fase, plano=CAMINHO, ultima=retrato(marco), **extra)

    def na_fila_fica(self, estado):
        self.estado["fila"][0]["estado"] = estado

    def pausa_do_plano(self, motivo):
        pasta = self.raiz / "planos" / ID_DO_PLANO
        pasta.mkdir(parents=True, exist_ok=True)
        (pasta / "estado.json").write_text(json.dumps({"pausado": motivo}), encoding="utf-8")

    def tipos(self):
        return [(e["tipo"], e["dados"]) for e in self.saida()]

    def test_plano_ativo_vira_desenvolvendo(self):
        self.com_plano("aguardando")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.item()["fase"], "plano_no_repo")
        self.na_fila_fica("ativo")
        eventos = self.passo(ClienteDeBusca())
        self.assertEqual(self.item()["fase"], "desenvolvendo")
        self.assertIn({"evento": "demanda_desenvolvendo", "id": ID, "plano": ID_DO_PLANO}, eventos)
        self.assertEqual(self.saida(), [])
        self.assertEqual(self.despachos(), [])

    def test_plano_concluido_vira_etapa_concluida_desenvolvida(self):
        self.com_plano("ativo")
        self.passo(ClienteDeBusca())
        self.na_fila_fica("concluido")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.tipos(), [("etapa_concluida", {"marco": "desenvolvida"})])
        self.passo(ClienteDeBusca())
        self.demandas_enviadas()
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])  # uma vez só
        # concluído antes do coordenador ver o `ativo`: também conclui
        self.com_plano("concluido")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.tipos(), [("etapa_concluida", {"marco": "desenvolvida"})])

    def demandas_enviadas(self):
        demandas.esvaziar_saida(self.estado, ClienteFalso(*["aplicado"] * len(self.saida())), self.raiz, salvar=lambda: None)

    def test_plano_pausado_vira_travada_uma_vez_e_destravada_ao_voltar(self):
        self.com_plano("ativo")
        self.passo(ClienteDeBusca())
        self.na_fila_fica("pausado")
        self.passo(ClienteDeBusca())
        self.passo(ClienteDeBusca())
        self.assertEqual(self.tipos(), [("travada", {"motivo": "plano pausado", "url": None})])
        self.demandas_enviadas()
        # o Flow mostra a trava: a Fábrica ainda acompanha o plano
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", espera="travada"), cursor="2")))
        self.assertEqual(self.saida(), [])
        self.na_fila_fica("ativo")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.tipos(), [("destravada", {})])
        self.demandas_enviadas()
        # a pausa da fábrica no plano vai como motivo
        self.pausa_do_plano("cota")
        self.na_fila_fica("pausado")
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida"), cursor="3")))
        self.assertEqual(self.tipos(), [("travada", {"motivo": "cota", "url": None})])
        # concluído ainda travado: destrava antes de concluir
        self.na_fila_fica("concluido")
        self.passo(ClienteDeBusca())
        self.assertEqual([t for t, _ in self.tipos()], ["travada", "destravada", "etapa_concluida"])

    def test_desenvolvimento_concluido_pelo_paulo_nao_manda_etapa_concluida(self):
        self.com_plano("ativo", fase="desenvolvendo", marco="testada")
        self.na_fila_fica("concluido")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        self.assertTrue(self.item()["desenvolvida"])

    def test_etapa_concluida_recusada_vira_travada_uma_vez(self):
        self.com_plano("concluido", fase="desenvolvendo")
        self.passo(ClienteDeBusca())
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.tipos(), [("travada", {"motivo": "o Flow recusou a conclusão do desenvolvimento", "url": None})])
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        eventos = self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        self.assertFalse(self.item()["precisa_ressincronizar"])
        self.assertNotIn("demandas:desenvolvimento:%s" % ID, [e.get("chave") for e in eventos])

    def test_trava_da_pausa_recusada_so_avisa(self):
        self.com_plano("pausado", fase="desenvolvendo")
        self.passo(ClienteDeBusca())
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        eventos = self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])  # não manda de novo (o Flow recusaria outra vez)
        self.assertIn("demandas:desenvolvimento:%s" % ID, [e.get("chave") for e in eventos])

    def test_soltar_plano_limpa_a_marca_local(self):
        self.com_plano("aguardando", segurado=True)
        self.passo(ClienteDeBusca())
        self.assertIs(self.item()["segurado"], False)



DESENHO = ".fabrica/demandas/%s/desenho.html" % ID
PR_D = "https://github.com/kustertech-exemplo/app/pull/9"
HEAD_D = "c" * 40
HEAD_D2 = "d" * 40
BRANCH_D = "fabrica/desenho-11111111"
HTML_OK = (
    b'<!doctype html><html><head><style>body{background:url(data:image/png;base64,AAAA)}</style></head>'
    b'<body><a href="#topo">topo</a><img src="data:image/png;base64,AAAA" alt="logo"><p>Pede uma opini\xc3\xa3o</p></body></html>'
)


class TestesValidarDesenho(unittest.TestCase):
    def test_validar_desenho_tabela(self):
        casos = [
            (HTML_OK, None),
            (b"<p>ok</p>", None),
            (b"<SCRIPT>alert(1)</SCRIPT>", "tem script"),
            (b"<p>x</p><script src=a.js></script>", "tem script"),
            (b'<button onclick="x()">a</button>', "tem script"),
            (b"<svg/onload=x()>", "tem script"),
            (b'<a href="javascript:x()">a</a>', "tem script"),
            (b'<img src="https://x.exemplo/a.png">', "carrega recurso de fora"),
            (b"<img src=http://x.exemplo/a.png>", "carrega recurso de fora"),
            (b"<link href='//x.exemplo/a.css' rel=stylesheet>", "carrega recurso de fora"),
            (b"<style>body{background:url(//x)}</style>", "carrega recurso de fora"),
            (b"<style>body{background:url( 'HTTPS://x' )}</style>", "carrega recurso de fora"),
            (b"<style>@import 'https://x.exemplo/a.css';</style>", "carrega recurso de fora"),
            (b"<p>\xff</p>", "não é UTF-8"),
            (b"a" * (10 * 1024 * 1024 + 1), "maior que 10 MB"),
            (b"a" * (10 * 1024 * 1024), None),
            (b"<p>Leia em https://x.exemplo (texto, n\xc3\xa3o recurso)</p>", None),
            (b'<img src="data:image/png;base64,AAAA/onab=">', None),  # o base64 pode terminar em /on..=
            (b'<img src="data:image/png;base64,AAAA" onerror="x()">', "tem script"),
            (b"<img src=data:image/png;base64,AAAA onerror=alert(1)>", "tem script"),
            (b"<img src=data:;base64,A src=https://x.exemplo/a.png>", "carrega recurso de fora"),
        ]
        for dados, esperado in casos:
            with self.subTest(dados=dados[:60]):
                self.assertEqual(demandas.validar_desenho(dados), esperado)


class TestesDesenho(BasePasso):
    def setUp(self):
        super().setUp()
        demandas.secao(self.estado)["itens"][ID] = item("plano_no_repo", plano=CAMINHO, prUrl=PR, ultima=retrato("planejada"))

    def desenhar(self, cursor="2", **extra):
        """Um ciclo com a demanda na etapa `desenho`: o run do ux-ui fica despachado."""
        self.passo(ClienteDeBusca(pagina(retrato("desenho", **extra), cursor=cursor)))
        return self.item()["runId"]

    def entregar(self, run_id, html=HTML_OK, *, head=HEAD_D, arquivos=(DESENHO,), ci="verde"):
        self.forja.definir_pr(PR_D, head_sha=head, branch=BRANCH_D, arquivos=list(arquivos))
        self.forja.definir_arquivo(REPO, head, DESENHO, html)
        self.forja.definir_ci(REPO, head, ci)
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR_D)

    def reservas(self):
        return capacidade.ler(self.capacidade)["reservas"]

    def enviado(self):
        """O ciclo seguinte ao envio: o Flow aplicou o arquivo e o `desenho_pronto` (a saída está vazia)."""
        self.estado["demandas"]["saida"] = []

    def test_desenho_reserva_vaga_ux_ui_e_envia_arquivo_antes_do_evento(self):
        run_id = self.desenhar()
        (despacho,) = self.despachos()
        ux = CONFIG_DO_KIT["modelos"]["ux-ui"]
        self.assertEqual((despacho["agente"], despacho["modelo"], despacho["max_custo_usd"], despacho["projeto"]), (ux["agente"], ux["modelo"], ux["maxCustoUsd"], "app"))
        hexa = demandas.nonce_do_motor(ID, "desenho", 0)
        self.assertEqual(despacho["chave_idempotencia"], hexa)
        self.assertTrue(despacho["prompt"].endswith("<!-- fabrica:nonce=%s -->" % hexa))
        self.assertIsNone(despacho["branch_existente"])
        self.assertIn(DESENHO, despacho["prompt"])
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["ux-ui"]})
        self.assertEqual(demandas.chaves_ocupando(self.estado), {demandas.chave(ID)})
        antes = [x["demandas"]["itens"][ID] for x in self.salvos if x["demandas"]["itens"][ID].get("fase") == "desenhando"]
        self.assertEqual((antes[0]["nonce"], antes[0]["runId"]), (hexa, None))  # no disco antes do POST
        self.entregar(run_id)
        self.passo(ClienteDeBusca())
        saida = self.estado["demandas"]["saida"]
        self.assertEqual([("arquivo" if "arquivo" in s else s["evento"]["tipo"]) for s in saida], ["arquivo", "desenho_pronto"])
        arquivo = saida[0]["arquivo"]
        self.assertEqual((arquivo["tipo"], arquivo["nome"], arquivo["conteudo"], arquivo["tela"]), ("desenho", "desenho.html", "text/html", None))
        self.assertEqual((self.raiz / arquivo["caminho"]).read_bytes(), HTML_OK)
        self.assertEqual(saida[1]["evento"]["dados"], {"arquivoId": arquivo["id"]})
        self.assertEqual(self.item()["fase"], "desenho_enviado")
        self.assertEqual(self.reservas(), {})
        self.assertEqual(demandas.chaves_ocupando(self.estado), set())
        # o retrato ainda sem a versão nova (o Flow aplicou, a busca não trouxe) não desenha de novo
        self.enviado()
        self.passo(ClienteDeBusca())
        self.passo(ClienteDeBusca(pagina(retrato("desenho"), cursor="3")))
        self.assertEqual((len(self.despachos()), self.saida(), self.reservas()), (1, [], {}))
        # aprovar_desenho: a versão 1 espera o Paulo
        self.passo(ClienteDeBusca(pagina(retrato("desenho", espera="aprovar_desenho", desenho={"versao": 1, "aprovada": None}), cursor="4")))
        self.assertEqual((len(self.despachos()), self.saida(), self.forja.merges), (1, [], []))

    def test_review_focus_4_desenho_com_script_refaz_uma_vez_e_depois_trava(self):
        run_id = self.desenhar()
        self.entregar(run_id, b"<p>oi</p><script>fetch('/x')</script>")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.estado["demandas"]["saida"], [])
        self.assertEqual(len(self.despachos()), 2)
        segundo = self.despachos()[1]
        self.assertIn("A versão anterior foi recusada pelo kit: tem script", segundo["prompt"])
        self.assertEqual(segundo["branch_existente"], BRANCH_D)
        self.assertEqual(segundo["chave_idempotencia"], demandas.nonce_do_motor(ID, "desenho", 1))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["ux-ui"]})
        self.entregar(self.item()["runId"], b'<img src="https://x.exemplo/a.png">', head=HEAD_D2)
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 2)
        (s,) = self.estado["demandas"]["saida"]
        self.assertEqual((s["evento"]["tipo"], s["evento"]["dados"]), ("travada", {"motivo": "o desenho gerado não é autocontido: carrega recurso de fora", "url": PR_D}))
        self.assertEqual(self.reservas(), {})
        self.assertEqual(list((self.raiz / "demandas").glob("**/*")) if (self.raiz / "demandas").exists() else [], [])
        # a trava fica: nada se refaz sozinho; a retomada do Paulo desenha de novo
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("desenho", espera="travada"), cursor="3")))
        self.passo(ClienteDeBusca(pagina(retrato("desenho"), cursor="4")))
        self.assertEqual(len(self.despachos()), 2)
        self.avancar(60)
        retomada = [{"id": OUTRO, "tipo": "retomada", "origem": "paulo", "em": "2026-11-20T10:01:00Z", "dados": {}}]
        self.passo(ClienteDeBusca(pagina(retrato("desenho", eventos=retomada), cursor="5")))
        self.assertEqual(len(self.despachos()), 3)
        self.assertEqual(self.despachos()[2]["chave_idempotencia"], demandas.nonce_do_motor(ID, "desenho", 2))
        self.assertNotIn("recusada pelo kit", self.despachos()[2]["prompt"])

    def test_html_acima_de_10_mb_nao_e_enviado(self):
        run_id = self.desenhar()
        self.entregar(run_id, b"a" * (10 * 1024 * 1024 + 1))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.estado["demandas"]["saida"], [])
        self.assertIn("recusada pelo kit: maior que 10 MB", self.despachos()[1]["prompt"])

    def test_ajuste_pedido_refaz_no_mesmo_branch_com_o_texto_do_ajuste(self):
        run_id = self.desenhar()
        self.entregar(run_id)
        self.passo(ClienteDeBusca())
        self.enviado()
        ajuste = {"versao": 1, "texto": "mais contraste no topo", "em": AGORA}
        self.passo(ClienteDeBusca(pagina(retrato("desenho", desenho={"versao": 1, "aprovada": None}, ajustes=[ajuste]), cursor="3")))
        self.assertEqual(len(self.despachos()), 2)
        segundo = self.despachos()[1]
        self.assertEqual(segundo["branch_existente"], BRANCH_D)
        self.assertIn("Versão 1: mais contraste no topo", segundo["prompt"])
        self.assertEqual(segundo["chave_idempotencia"], demandas.nonce_do_motor(ID, "desenho", 2))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["ux-ui"]})
        self.entregar(self.item()["runId"], head=HEAD_D2)
        self.passo(ClienteDeBusca())
        self.assertEqual([s["evento"]["tipo"] for s in self.estado["demandas"]["saida"] if "evento" in s], ["desenho_pronto"])
        self.assertEqual((self.item()["fase"], self.item()["desenho"]["headSha"]), ("desenho_enviado", HEAD_D2))
        self.assertEqual(self.reservas(), {})

    def ajustar_sem_pr_url(self, *, estado="succeeded", motivo=None, head=HEAD_D2):
        """O ajuste roda no branch do PR que já existe: o Warren devolve o run sem `prUrl` (o PR é o mesmo)."""
        run_id = self.desenhar()
        self.entregar(run_id)
        self.passo(ClienteDeBusca())
        self.enviado()
        ajuste = {"versao": 1, "texto": "mais contraste no topo", "em": AGORA}
        self.passo(ClienteDeBusca(pagina(retrato("desenho", desenho={"versao": 1, "aprovada": None}, ajustes=[ajuste]), cursor="3")))
        self.forja.definir_pr(PR_D, head_sha=head, branch=BRANCH_D, arquivos=[DESENHO])
        self.forja.definir_arquivo(REPO, head, DESENHO, HTML_OK)
        self.motor.definir_run(self.item()["runId"], estado=estado, prUrl=None, motivoFalha=motivo)
        self.passo(ClienteDeBusca())

    def test_ajuste_no_mesmo_branch_sem_pr_url_confere_o_pr_que_ja_existe(self):
        self.ajustar_sem_pr_url()
        self.assertEqual([s["evento"]["tipo"] for s in self.estado["demandas"]["saida"] if "evento" in s], ["desenho_pronto"])
        self.assertEqual((self.item()["fase"], self.item()["desenho"]["headSha"], self.item()["desenho"]["versao"]), ("desenho_enviado", HEAD_D2, 2))
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(self.reservas(), {})

    def test_ajuste_sem_mudanca_e_pr_que_ja_andou_confere_o_pr(self):
        # o run anterior já tinha empurrado a v2: o seguinte termina em `no_changes`, e o head do PR é outro
        self.ajustar_sem_pr_url(estado="failed", motivo="no_changes")
        self.assertEqual([s["evento"]["tipo"] for s in self.estado["demandas"]["saida"] if "evento" in s], ["desenho_pronto"])
        self.assertEqual(len(self.despachos()), 2)

    def test_ajuste_sem_pr_url_e_head_parado_conta_como_sem_pr(self):
        self.ajustar_sem_pr_url(estado="failed", motivo="no_changes", head=HEAD_D)
        self.assertEqual(self.estado["demandas"]["saida"], [])
        self.assertEqual(len(self.despachos()), 3)
        self.assertEqual(self.item()["desenho"]["semPr"], 1)

    def test_aprovacao_mergeia_o_pr_do_desenho_e_solta_a_vaga(self):
        run_id = self.desenhar()
        self.entregar(run_id)
        self.passo(ClienteDeBusca())
        self.enviado()
        # o plano segue segurado com a etapa já em `desenvolvida`, até o desenho chegar ao branch padrão
        self.estado["fila"] = [na_fila("aguardando")]
        self.item()["recebida"] = retrato("desenvolvida")
        self.estado["fila"] = demandas.aplicar_na_fila(self.estado["demandas"], self.estado["fila"])
        self.assertTrue(self.estado["fila"][0]["segurado"])
        del self.item()["recebida"]
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", desenho={"versao": 1, "aprovada": 1}), cursor="3")))
        self.assertEqual(self.forja.merges, [(PR_D, HEAD_D)])
        self.assertEqual(self.item()["fase"], "plano_no_repo")
        self.assertEqual(self.reservas(), {})
        self.assertFalse(demandas.aplicar_na_fila(self.estado["demandas"], self.estado["fila"])[0]["segurado"])
        self.passo(ClienteDeBusca())
        self.assertEqual((len(self.forja.merges), self.saida()), (1, []))

    def test_etapa_concluida_sem_aprovar_nao_mergeia_o_desenho(self):
        run_id = self.desenhar()
        self.entregar(run_id)
        self.passo(ClienteDeBusca())
        self.enviado()
        eventos = self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", desenho={"versao": 1, "aprovada": None}), cursor="3")))
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(self.item()["fase"], "plano_no_repo")
        self.assertIn("demandas:desenho:%s" % ID, [e.get("chave") for e in eventos])
        self.passo(ClienteDeBusca())
        self.assertEqual((self.forja.merges, self.saida()), ([], []))

    def test_desenho_pronto_v2_recusado_com_a_etapa_adiante_nao_mergeia_a_v2(self):
        run_id = self.desenhar()
        self.entregar(run_id)
        self.passo(ClienteDeBusca())
        self.enviado()
        ajuste = {"versao": 1, "texto": "mais contraste", "em": AGORA}
        self.passo(ClienteDeBusca(pagina(retrato("desenho", desenho={"versao": 1, "aprovada": None}, ajustes=[ajuste]), cursor="3")))
        self.entregar(self.item()["runId"], head=HEAD_D2)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.item()["desenho"]["versao"], 2)
        # o Paulo concluiu a etapa aprovando a v1 antes de a v2 chegar: o Flow recusa o desenho_pronto v2 (409)
        demandas.esvaziar_saida(self.estado, ClienteFalso("aplicado", "recusado"), self.raiz, salvar=lambda: None)
        eventos = self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", desenho={"versao": 1, "aprovada": 1}), cursor="4")))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [])
        self.assertEqual((self.item()["fase"], self.item()["precisa_ressincronizar"]), ("plano_no_repo", False))
        self.assertIn("demandas:desenho:%s" % ID, [e.get("chave") for e in eventos])
        self.assertEqual(self.saida(), [])

    def test_pr_do_desenho_com_ci_vermelho_trava_uma_vez(self):
        run_id = self.desenhar()
        self.entregar(run_id, ci="vermelho")
        self.passo(ClienteDeBusca())
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", desenho={"versao": 1, "aprovada": 1}), cursor="3")))
        self.assertEqual(self.forja.merges, [])
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o PR do desenho está com o CI vermelho", "url": PR_D}))
        self.enviado()
        self.passo(ClienteDeBusca())  # retrato atrasado: não trava de novo
        self.assertEqual(self.saida(), [])
        # o Paulo conserta o CI e retoma: mergeia
        self.forja.definir_ci(REPO, HEAD_D, "verde")
        self.avancar(60)
        retomada = [{"id": OUTRO, "tipo": "retomada", "origem": "paulo", "em": "2026-11-20T10:01:00Z", "dados": {}}]
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", desenho={"versao": 1, "aprovada": 1}, eventos=retomada), cursor="4")))
        self.assertEqual(self.forja.merges, [(PR_D, HEAD_D)])
        self.assertEqual(self.item()["fase"], "plano_no_repo")

    def test_pr_do_desenho_que_mexe_fora_do_arquivo_trava_sem_enviar(self):
        run_id = self.desenhar()
        self.entregar(run_id, arquivos=(DESENHO, "src/app/page.tsx"))
        self.passo(ClienteDeBusca())
        (s,) = self.estado["demandas"]["saida"]
        self.assertEqual(s["evento"]["dados"], {"motivo": "o PR do desenho mexe fora de %s: src/app/page.tsx" % DESENHO, "url": PR_D})
        self.assertEqual(self.reservas(), {})

    def test_sem_vaga_o_desenho_espera_o_ciclo_seguinte(self):
        capacidade.configurar(self.capacidade, vagas=1, ram_minima_mb=0)
        self.assertTrue(capacidade.reservar(self.capacidade, "outro-plano", "raia-0", mem_disponivel_mb=None))
        self.desenhar()
        self.assertEqual(self.despachos(), [])
        self.assertEqual(self.item()["fase"], "plano_no_repo")
        capacidade.sincronizar(self.capacidade, "outro-plano", set())
        # duas demandas esperando a única vaga: a urgente (mais nova) passa na frente
        urgente = retrato("desenho", id=OUTRO, destino="urgente", criadaEm="2026-11-20T09:30:00Z")
        demandas.secao(self.estado)["itens"][OUTRO] = item("plano_no_repo", plano=".fabrica/planos/demanda-22222222.json", ultima=retrato("planejada", id=OUTRO))
        self.passo(ClienteDeBusca(pagina(urgente, cursor="3")))
        self.assertEqual(len(self.despachos()), 1)
        self.assertEqual(self.reservas(), {demandas.chave(OUTRO): ["ux-ui"]})
        self.assertEqual(self.item()["fase"], "plano_no_repo")

    def test_espera_planejar_comigo_depois_de_tres_recusas_nao_desenha(self):
        run_id = self.desenhar()
        self.entregar(run_id)
        self.passo(ClienteDeBusca())
        self.enviado()
        ajustes = [{"versao": v, "texto": "outra", "em": AGORA} for v in (1, 2, 3)]
        r = retrato("desenho", espera="planejar_comigo", nivel="planejar_comigo", desenho={"versao": 3, "aprovada": None}, ajustes=ajustes)
        self.assertEqual(demandas.proxima_acao(self.item(), r), "nada")
        self.passo(ClienteDeBusca(pagina(r, cursor="3")))
        self.passo(ClienteDeBusca())
        self.assertEqual((len(self.despachos()), self.saida(), self.reservas()), (1, [], {}))

    def test_aprovado_pelo_artefato_da_sessao_nao_mergeia_o_desenho_recusado(self):
        run_id = self.desenhar()
        self.entregar(run_id)
        self.passo(ClienteDeBusca())
        self.enviado()
        plano = {"caminho": CAMINHO, "prUrl": PR, "artefato": "https://claude.ai/public/artifacts/x"}
        eventos = self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", nivel="planejar_comigo", plano=plano, desenho={"versao": 3, "aprovada": 3}), cursor="3")))
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(self.item()["fase"], "plano_no_repo")
        self.assertIn("demandas:desenho:%s" % ID, [e.get("chave") for e in eventos])

    def test_teto_trava_segura_a_vaga_ate_o_run_terminar(self):
        run_id = self.desenhar()
        self.avancar(demandas.TETO_RUN_S + 1)
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o agente passou de 2 h", "url": None}))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["ux-ui"]})  # o run segue no Warren
        self.assertEqual(demandas.chaves_ocupando(self.estado), {demandas.chave(ID)})
        self.enviado()
        self.avancar(60)
        em = (self.agora).strftime("%Y-%m-%dT%H:%M:%SZ")
        retomada = [{"id": OUTRO, "tipo": "retomada", "origem": "paulo", "em": em, "dados": {}}]
        self.passo(ClienteDeBusca(pagina(retrato("desenho", eventos=retomada), cursor="3")))
        self.assertEqual(len(self.despachos()), 1)  # nunca dois runs do desenho
        self.entregar(run_id)  # termina com PR: o resultado não conta
        self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["ux-ui"]})
        self.assertNotIn("desenhoSuperado", self.item())

    def test_o_mesmo_erro_5_ciclos_seguidos_vira_travada_e_solta_a_vaga(self):
        run_id = self.desenhar()
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR_D)  # a forja não conhece o PR: KeyError todo ciclo
        for _ in range(4):
            eventos = self.passo(ClienteDeBusca())
            self.assertIn("erro", [e["evento"] for e in eventos])
        self.assertEqual(self.saida(), [])
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertTrue(evento["dados"]["motivo"].startswith("o desenho parou: o mesmo erro 5 ciclos seguidos (KeyError"))
        self.assertEqual(self.reservas(), {})

    def test_sem_pr_duas_vezes_trava(self):
        run_id = self.desenhar()
        self.motor.definir_run(run_id, estado="succeeded")
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 2)
        self.motor.definir_run(self.item()["runId"], estado="failed", motivoFalha="erro")
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["dados"], {"motivo": "o ux-ui terminou sem PR do desenho 2 vezes", "url": None})
        self.assertEqual(self.reservas(), {})

    def test_queda_no_post_do_desenho_acha_o_run_pelo_nonce(self):
        self.motor.falhar_despacho("incerta")
        self.desenhar()
        self.assertEqual((self.item()["fase"], self.item()["runId"]), ("desenhando", None))
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 1)
        self.assertEqual(self.item()["runId"], "run-1")

    def test_desenho_pronto_recusado_vira_travada_uma_vez(self):
        run_id = self.desenhar()
        self.entregar(run_id)
        self.passo(ClienteDeBusca())
        demandas.esvaziar_saida(self.estado, ClienteFalso("aplicado", "recusado"), self.raiz, salvar=lambda: None)
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o Flow recusou o desenho enviado pela Fábrica", "url": PR_D}))
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        eventos = self.passo(ClienteDeBusca())
        self.assertEqual((self.saida(), len(self.despachos())), ([], 1))
        self.assertIn("demandas:desenho:%s" % ID, [e.get("chave") for e in eventos])

    def test_paulo_tira_a_demanda_do_desenho_com_o_run_no_meio(self):
        run_id = self.desenhar()
        self.passo(ClienteDeBusca(pagina(retrato("desenho", encerrada="cancelada"), cursor="3")))
        self.assertEqual((self.item()["fase"], self.item()["runId"]), ("esperando_paulo", None))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["ux-ui"]})
        self.motor.definir_run(run_id, estado="failed", motivoFalha="erro")
        self.passo(ClienteDeBusca())
        self.assertEqual((self.reservas(), self.saida()), ({}, []))

    def test_sem_modelo_do_ux_ui_espera_com_aviso(self):
        modelos = dict(CONFIG_DO_KIT["modelos"])
        del modelos["ux-ui"]
        eventos = self.passo(ClienteDeBusca(pagina(retrato("desenho"), cursor="2")), modelos=modelos)
        self.assertEqual((self.despachos(), self.reservas()), ([], {}))
        self.assertIn("demandas:modelo:ux-ui", [e.get("chave") for e in eventos])


PASTA_T = ".fabrica/demandas/%s" % ID
TESTE_JSON = PASTA_T + "/teste.json"
CAPTURAS = PASTA_T + "/capturas"
PR_T = "https://github.com/kustertech-exemplo/app/pull/11"
PR_C = "https://github.com/kustertech-exemplo/app/pull/12"
HEAD_T = "e" * 40
HEAD_T2 = "f" * 40
HEAD_C = "1" * 40
BRANCH_T = "fabrica/teste-11111111"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
HEAD_C2 = "2" * 40
HEAD_C3 = "3" * 40
ACHADOS_DA_REVISAO = [
    {"arquivo": "src/app/tutorial.tsx", "motivo": "No celular o tutorial ainda não funciona"},
    {"arquivo": "src/app/x.ts", "motivo": "falta o teste"},
]
RETOMADA = [{"id": OUTRO, "tipo": "retomada", "origem": "paulo", "em": "2026-11-20T10:01:00Z", "dados": {}}]


class TestesTesteNoNavegador(BasePasso):
    def setUp(self):
        super().setUp()
        demandas.secao(self.estado)["itens"][ID] = item("desenvolvendo", plano=CAMINHO, desenvolvida=True, ultima=retrato("desenvolvida"))

    def abrir_teste(self, cursor="2", **extra):
        """Um ciclo com a demanda na etapa `testada`: o run do qa fica despachado."""
        self.passo(ClienteDeBusca(pagina(retrato("testada", **extra), cursor=cursor)))
        return self.item()["runId"]

    def entregar_teste(self, run_id, *, resultado="passou", resumo="o fluxo passou", telas=("desktop-01.png", "celular-01.png"), head=HEAD_T, teste=None, extras=()):
        arquivos = [TESTE_JSON] + ["%s/%s" % (CAPTURAS, t) for t in telas] + list(extras)
        self.forja.definir_pr(PR_T, head_sha=head, branch=BRANCH_T, arquivos=arquivos)
        corpo = json.dumps({"resultado": resultado, "contra": "real", "resumo": resumo}) if teste is None else teste
        self.forja.definir_arquivo(REPO, head, TESTE_JSON, corpo)
        for t in telas:
            self.forja.definir_arquivo(REPO, head, "%s/%s" % (CAPTURAS, t), PNG)
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR_T)

    def entregar_correcao(self, run_id, *, ci="verde", arquivos=("src/app/clientes/page.tsx",), mergeado=False, url=PR_C):
        self.forja.definir_pr(url, head_sha=HEAD_C, branch="fabrica/correcao-11111111", arquivos=list(arquivos), aberto=not mergeado, mergeado=mergeado)
        self.forja.definir_ci(REPO, HEAD_C, ci)
        self.motor.definir_run(run_id, estado="succeeded", prUrl=url)

    def reservas(self):
        return capacidade.ler(self.capacidade)["reservas"]

    def enviado(self):
        self.estado["demandas"]["saida"] = []

    def falhar_o_teste(self):
        run_id = self.abrir_teste()
        self.entregar_teste(run_id, resultado="falhou", resumo="o botão salvar não responde")
        self.passo(ClienteDeBusca())
        self.enviado()

    def test_teste_passou_envia_capturas_desktop_e_celular_antes_do_evento_e_fecha_o_pr(self):
        run_id = self.abrir_teste()
        (despacho,) = self.despachos()
        qa = CONFIG_DO_KIT["modelos"]["qa"]
        self.assertEqual((despacho["agente"], despacho["modelo"], despacho["max_custo_usd"], despacho["projeto"]), (qa["agente"], qa["modelo"], qa["maxCustoUsd"], "app"))
        hexa = demandas.nonce_do_motor(ID, "teste", 0)
        self.assertEqual(despacho["chave_idempotencia"], hexa)
        self.assertTrue(despacho["prompt"].endswith("<!-- fabrica:nonce=%s -->" % hexa))
        self.assertIn(TESTE_JSON, despacho["prompt"])
        self.assertIsNone(despacho["branch_existente"])
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["qa"]})
        self.assertEqual(demandas.chaves_ocupando(self.estado), {demandas.chave(ID)})
        antes = [x["demandas"]["itens"][ID] for x in self.salvos if x["demandas"]["itens"][ID].get("fase") == "testando"]
        self.assertEqual((antes[0]["nonce"], antes[0]["runId"]), (hexa, None))  # no disco antes do POST
        self.entregar_teste(run_id)
        self.passo(ClienteDeBusca())
        saida = self.estado["demandas"]["saida"]
        self.assertEqual([("arquivo" if "arquivo" in s else s["evento"]["tipo"]) for s in saida], ["arquivo", "arquivo", "teste"])
        telas = [(s["arquivo"]["tipo"], s["arquivo"]["nome"], s["arquivo"]["conteudo"], s["arquivo"]["tela"]) for s in saida[:2]]
        self.assertEqual(telas, [("captura", "celular-01.png", "image/png", "celular"), ("captura", "desktop-01.png", "image/png", "desktop")])
        self.assertEqual((self.raiz / saida[0]["arquivo"]["caminho"]).read_bytes(), PNG)
        dados = saida[2]["evento"]["dados"]
        self.assertEqual(dados, {"resultado": "passou", "resumo": "o fluxo passou\n\nTestado contra o back-end real.", "capturas": [saida[0]["arquivo"]["id"], saida[1]["arquivo"]["id"]]})
        self.assertEqual(self.forja.fechados, [(PR_T, "Evidência enviada ao Flow.")])
        self.assertEqual(self.forja.merges, [])
        self.assertEqual((self.reservas(), demandas.chaves_ocupando(self.estado)), ({}, set()))
        # o retrato atrasado (ainda `testada`) não testa de novo
        self.enviado()
        self.passo(ClienteDeBusca())
        self.passo(ClienteDeBusca(pagina(retrato("testada"), cursor="3")))
        self.assertEqual((len(self.despachos()), self.saida(), len(self.forja.fechados)), (1, [], 1))

    def test_teste_sem_captura_de_celular_refaz_uma_vez_e_depois_trava(self):
        run_id = self.abrir_teste()
        self.entregar_teste(run_id, telas=("desktop-01.png",))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.estado["demandas"]["saida"], [])
        self.assertEqual(len(self.despachos()), 2)
        segundo = self.despachos()[1]
        self.assertEqual(segundo["branch_existente"], BRANCH_T)
        self.assertEqual(segundo["chave_idempotencia"], demandas.nonce_do_motor(ID, "teste", 1))
        self.assertIn("faltaram capturas de desktop e celular", segundo["prompt"])
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["qa"]})
        self.entregar_teste(self.item()["runId"], telas=("desktop-01.png",), head=HEAD_T2)
        self.passo(ClienteDeBusca())
        (s,) = self.estado["demandas"]["saida"]
        self.assertEqual((s["evento"]["tipo"], s["evento"]["dados"]), ("travada", {"motivo": "o teste não trouxe capturas de desktop e celular", "url": PR_T}))
        self.assertEqual((len(self.despachos()), self.reservas()), (2, {}))
        # a retomada do Paulo testa de novo, do zero
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("testada", espera="travada"), cursor="3")))
        self.avancar(60)
        self.passo(ClienteDeBusca(pagina(retrato("testada", eventos=RETOMADA), cursor="4")))
        self.assertEqual(len(self.despachos()), 3)
        self.assertNotIn("faltaram capturas", self.despachos()[2]["prompt"])

    def test_teste_refeito_no_mesmo_branch_sem_pr_url_confere_o_pr_que_ja_existe(self):
        run_id = self.abrir_teste()
        self.entregar_teste(run_id, telas=("desktop-01.png",))
        self.passo(ClienteDeBusca())
        self.entregar_teste(self.item()["runId"], head=HEAD_T2)
        self.motor.definir_run(self.item()["runId"], estado="succeeded", prUrl=None)
        self.passo(ClienteDeBusca())
        self.assertEqual([s["evento"]["tipo"] for s in self.estado["demandas"]["saida"] if "evento" in s], ["teste"])
        self.assertEqual(len(self.despachos()), 2)

    def test_teste_json_torto_tambem_refaz_uma_vez(self):
        run_id = self.abrir_teste()
        self.entregar_teste(run_id, teste="{não é json")
        self.passo(ClienteDeBusca())
        self.assertEqual((self.estado["demandas"]["saida"], len(self.despachos())), ([], 2))

    def test_sistema_que_nao_sobe_no_run_trava_com_o_motivo(self):
        run_id = self.abrir_teste()
        self.entregar_teste(run_id, resultado="nao_subiu", resumo="o README pede um banco externo", telas=())
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["dados"], {"motivo": "o qa não subiu o sistema no run: o README pede um banco externo", "url": PR_T})
        self.assertEqual((len(self.despachos()), self.reservas()), (1, {}))

    def test_detalhes_do_teste_vao_so_para_a_correcao_e_o_resumo_vai_ao_flow(self):
        run_id = self.abrir_teste()
        corpo = json.dumps({"resultado": "falhou", "contra": "real", "resumo": "O salvar não funciona.", "detalhes": "peca.tsx:264 undefined is not iterable"})
        self.entregar_teste(run_id, teste=corpo)
        self.passo(ClienteDeBusca())
        evento = self.estado["demandas"]["saida"][-1]["evento"]
        self.assertEqual(evento["dados"]["resumo"], "O salvar não funciona.\n\nTestado contra o back-end real.")
        self.assertNotIn("detalhes", evento["dados"])
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida"), cursor="3")))
        correcao = self.despachos()[1]
        self.assertIn("peca.tsx:264 undefined is not iterable", correcao["prompt"])
        self.assertIn("O salvar não funciona.", correcao["prompt"])

    def test_pr_do_teste_fora_da_pasta_da_demanda_trava_sem_enviar(self):
        run_id = self.abrir_teste()
        self.entregar_teste(run_id, extras=("src/app/page.tsx",))
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["dados"], {"motivo": "o PR do teste mexe fora de %s/: src/app/page.tsx" % PASTA_T, "url": PR_T})
        self.assertEqual(self.forja.fechados, [])

    def test_primeira_falha_despacha_correcao_frontend_e_reenvia_desenvolvida_depois_do_merge(self):
        self.falhar_o_teste()
        self.assertEqual(self.forja.fechados, [(PR_T, "Evidência enviada ao Flow.")])
        # o Flow voltou a demanda para `desenvolvida`
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida"), cursor="3")))
        self.assertEqual(len(self.despachos()), 2)
        correcao = self.despachos()[1]
        fe = CONFIG_DO_KIT["modelos"]["frontend"]
        self.assertEqual((correcao["agente"], correcao["modelo"], correcao["max_custo_usd"]), (fe["agente"], fe["modelo"], fe["maxCustoUsd"]))
        self.assertEqual(correcao["chave_idempotencia"], demandas.nonce_do_motor(ID, "correcao", 1))
        self.assertIsNone(correcao["branch_existente"])
        self.assertIn("o botão salvar não responde", correcao["prompt"])
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})
        self.assertEqual(demandas.chaves_ocupando(self.estado), {demandas.chave(ID)})
        self.passo(ClienteDeBusca())  # o run ainda roda: nada novo
        self.assertEqual(len(self.despachos()), 2)
        self.entregar_correcao(self.item()["runId"])
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, HEAD_C)])
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("etapa_concluida", {"marco": "desenvolvida"}))
        self.assertEqual(self.reservas(), {})
        self.enviado()
        self.passo(ClienteDeBusca())  # retrato atrasado: nada
        self.assertEqual((len(self.despachos()), self.saida()), (2, []))
        # o Flow volta a `testada`: o ciclo seguinte testa de novo
        self.passo(ClienteDeBusca(pagina(retrato("testada"), cursor="4")))
        self.assertEqual(len(self.despachos()), 3)
        self.assertEqual(self.despachos()[2]["chave_idempotencia"], demandas.nonce_do_motor(ID, "teste", 2))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["qa"]})

    def test_rodada_que_falha_fica_no_historico_e_volta_no_teste_seguinte(self):
        self.falhar_o_teste()
        self.assertEqual(self.item()["rodadas"], [{"resumo": "o botão salvar não responde", "detalhes": None, "correcao": None}])
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida"), cursor="3")))
        self.assertNotIn("rodada", self.despachos()[1]["prompt"])  # a primeira correção não tem histórico
        self.entregar_correcao(self.item()["runId"])
        self.passo(ClienteDeBusca())
        self.assertEqual(self.item()["rodadas"][-1]["correcao"], PR_C)
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("testada"), cursor="4")))
        teste = self.despachos()[2]["prompt"]
        self.assertIn("Confira primeiro", teste)
        self.assertIn("o botão salvar não responde", teste)

    def test_terceira_rodada_corrige_com_o_modelo_do_orquestrador_e_o_historico(self):
        self.falhar_o_teste()
        anteriores = [
            {"resumo": "o card cobre o chat", "detalhes": None, "correcao": "https://github.com/o/r/pull/7"},
            {"resumo": "o toque não passa", "detalhes": None, "correcao": "https://github.com/o/r/pull/8"},
        ]
        self.item()["rodadas"] = anteriores + self.item()["rodadas"]
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida"), cursor="3")))
        correcao = self.despachos()[1]
        orq = CONFIG_DO_KIT["modelos"]["orquestrador"]
        self.assertEqual((correcao["agente"], correcao["modelo"]), (orq["agente"], orq["modelo"]))
        self.assertIn("3ª rodada", correcao["prompt"])
        self.assertIn("https://github.com/o/r/pull/8", correcao["prompt"])
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})

    def test_correcao_com_ci_vermelho_trava_com_a_url_do_pr(self):
        self.falhar_o_teste()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida"), cursor="3")))
        self.entregar_correcao(self.item()["runId"], ci="vermelho")
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o PR da correção do teste está com o CI vermelho", "url": PR_C}))
        self.assertEqual((self.forja.merges, self.reservas()), ([], {}))
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", espera="travada"), cursor="4")))
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida"), cursor="5")))
        self.assertEqual((len(self.despachos()), self.saida()), (2, []))
        # o Paulo conserta o CI e retoma: mergeia o mesmo PR, sem run novo
        self.forja.definir_ci(REPO, HEAD_C, "verde")
        self.avancar(60)
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", eventos=RETOMADA), cursor="6")))
        self.assertEqual((self.forja.merges, len(self.despachos())), ([(PR_C, HEAD_C)], 2))
        self.assertEqual([e["tipo"] for e in self.saida()], ["etapa_concluida"])

    def corrigir_depois_da_falha(self):
        self.falhar_o_teste()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida"), cursor="3")))
        return self.item()["runId"]

    def test_correcao_que_mexe_em_caminho_fixo_da_fabrica_trava_sem_merge(self):
        for i, caminho in enumerate((".fabrica/config.json", ".fabrica/equipes/qa.md", ".claude/settings.json", ".warren/config.yml", ".fabrica/demandas/%s/teste.json" % ID)):
            with self.subTest(caminho=caminho):
                self.setUp()
                self.entregar_correcao(self.corrigir_depois_da_falha(), arquivos=("src/app/clientes/page.tsx", caminho))
                self.passo(ClienteDeBusca())
                self.assertEqual(self.forja.merges, [])
                (evento,) = self.saida()
                self.assertEqual(evento["dados"], {"motivo": "o PR da correção mexe em caminho protegido: %s" % caminho, "url": PR_C})
                self.assertEqual(self.reservas(), {})

    def test_correcao_le_os_protegidos_do_branch_padrao_e_nunca_do_head(self):
        self.forja.definir_arquivo(REPO, "main", ".fabrica/config.json", json.dumps({"protegidos": [".github/**"]}))
        self.forja.definir_arquivo(REPO, HEAD_C, ".fabrica/config.json", json.dumps({"protegidos": []}))
        self.entregar_correcao(self.corrigir_depois_da_falha(), arquivos=("src/app/clientes/page.tsx", ".github/workflows/ci.yml"))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [])
        (evento,) = self.saida()
        self.assertEqual(evento["dados"]["motivo"], "o PR da correção mexe em caminho protegido: .github/workflows/ci.yml")

    def test_correcao_fora_dos_protegidos_do_branch_padrao_mergeia(self):
        self.forja.definir_arquivo(REPO, "main", ".fabrica/config.json", json.dumps({"protegidos": [".github/**"]}))
        self.entregar_correcao(self.corrigir_depois_da_falha(), arquivos=("src/app/clientes/page.tsx", "src/app/clientes/page.test.tsx"))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, HEAD_C)])

    def test_pr_ja_mergeado_de_outro_repo_ou_nunca_visto_nao_vale_como_correcao(self):
        for url, motivo in (
            ("https://github.com/kustertech-exemplo/outro/pull/3", "o PR da correção está em outro repositório"),
            (PR_C, "o PR da correção já estava mergeado antes de o kit conferir"),
        ):
            with self.subTest(url=url):
                self.setUp()
                self.entregar_correcao(self.corrigir_depois_da_falha(), mergeado=True, url=url)
                self.passo(ClienteDeBusca())
                (evento,) = self.saida()
                self.assertEqual((evento["tipo"], evento["dados"]["motivo"]), ("travada", motivo))

    def test_queda_depois_do_merge_da_correcao_recupera_pelo_head_visto(self):
        self.entregar_correcao(self.corrigir_depois_da_falha(), ci="pendente")
        self.passo(ClienteDeBusca())  # visto aberto: o head fica gravado
        self.entregar_correcao(self.item()["runId"] or "x", mergeado=True)
        self.passo(ClienteDeBusca())
        self.assertEqual([e["tipo"] for e in self.saida()], ["etapa_concluida"])

    def test_correcao_sem_ci_nao_mergeia_e_trava_para_o_paulo_com_o_link(self):
        self.entregar_correcao(self.corrigir_depois_da_falha(), ci="ausente")
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "PR de correção sem CI: revise e faça o merge", "url": PR_C}))
        self.assertEqual((self.forja.merges, self.reservas()), ([], {}))
        # o ciclo seguinte, com a trava no Flow e o PR ainda aberto, não faz nada
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", espera="travada"), cursor="4")))
        self.assertEqual((self.saida(), self.forja.merges, len(self.despachos())), ([], [], 2))

    def paulo_mergeia(self, head=HEAD_C, base="main"):
        self.forja.definir_pr(PR_C, head_sha=head, branch="fabrica/correcao-11111111", arquivos=["src/app/clientes/page.tsx"], aberto=False, mergeado=True, base=base)

    def test_correcao_sem_ci_mergeada_pelo_paulo_segue_sem_retomada(self):
        self.test_correcao_sem_ci_nao_mergeia_e_trava_para_o_paulo_com_o_link()
        self.paulo_mergeia()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", espera="travada"), cursor="5")))
        self.assertEqual([(e["tipo"], e["dados"]) for e in self.saida()], [("destravada", {}), ("etapa_concluida", {"marco": "desenvolvida"})])
        self.assertEqual((self.forja.merges, len(self.despachos())), ([], 2))
        # o Flow volta a `testada`: o ciclo seguinte testa de novo
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("testada"), cursor="6")))
        self.assertEqual(len(self.despachos()), 3)

    def test_correcao_mergeada_pelo_paulo_com_um_commit_a_mais_vale_no_branch_padrao(self):
        self.test_correcao_sem_ci_nao_mergeia_e_trava_para_o_paulo_com_o_link()
        self.paulo_mergeia(head="2" * 40)
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", espera="travada"), cursor="5")))
        self.assertEqual([e["tipo"] for e in self.saida()], ["destravada", "etapa_concluida"])

    def test_correcao_mergeada_em_outro_branch_nao_vale(self):
        self.test_correcao_sem_ci_nao_mergeia_e_trava_para_o_paulo_com_o_link()
        self.paulo_mergeia(head="2" * 40, base="outro")
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", espera="travada"), cursor="5")))
        self.assertEqual(self.saida(), [])
        # a retomada confere o PR e trava com o motivo do merge que não vale
        self.avancar(60)
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", eventos=RETOMADA), cursor="6")))
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]["motivo"]), ("travada", "o PR da correção já estava mergeado antes de o kit conferir"))

    def test_correcao_sem_ci_mergeada_pelo_paulo_e_retomada_tambem_segue(self):
        self.test_correcao_sem_ci_nao_mergeia_e_trava_para_o_paulo_com_o_link()
        self.paulo_mergeia(head="2" * 40)
        self.avancar(60)
        # o retrato já sem a trava (o Paulo retomou): a retomada confere o PR mergeado
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", eventos=RETOMADA), cursor="5")))
        self.assertEqual([e["tipo"] for e in self.saida()], ["etapa_concluida"])
        self.assertEqual(self.forja.merges, [])

    # -------------------------------------------------- correção sem CI revisada pela Fábrica (ciObrigatorioNasSeeds false)

    def sem_ci_obrigatorio(self, valor=False):
        self.forja.definir_arquivo(REPO, "main", ".fabrica/config.json", json.dumps({"protegidos": [], "ciObrigatorioNasSeeds": valor}))

    def veredito(self, run_id, resultado="aprovado", *, sha=HEAD_C, achados=(), estado="succeeded", motivo=None):
        corpo = json.dumps({"sha": sha, "resultado": resultado, "achados": list(achados)})
        self.motor.definir_texto(run_id, "Revisei.\n%s\n%s\n%s\n" % (prompts.INICIO_VEREDITO, corpo, prompts.FIM_VEREDITO))
        self.motor.definir_run(run_id, estado=estado, motivoFalha=motivo)

    def revisar_correcao_sem_ci(self):
        """A correção entrega o PR sem CI num repositório com `ciObrigatorioNasSeeds: false`: o revisor fica despachado."""
        self.sem_ci_obrigatorio()
        self.entregar_correcao(self.corrigir_depois_da_falha(), ci="ausente")
        self.passo(ClienteDeBusca())
        return self.item()["correcao"]["revisao"]["runId"]

    def test_correcao_sem_ci_com_ci_opcional_despacha_o_revisor_no_head_do_pr(self):
        run_id = self.revisar_correcao_sem_ci()
        self.assertEqual((self.saida(), self.forja.merges), ([], []))
        self.assertEqual(len(self.despachos()), 3)
        revisao = self.despachos()[2]
        rev = CONFIG_DO_KIT["modelos"]["revisor"]
        self.assertEqual((revisao["agente"], revisao["modelo"], revisao["max_custo_usd"]), (rev["agente"], rev["modelo"], rev["maxCustoUsd"]))
        nonce = demandas.nonce_do_motor(ID, "revisao", 2)
        self.assertEqual(revisao["chave_idempotencia"], nonce)
        self.assertTrue(revisao["prompt"].endswith("<!-- fabrica:nonce=%s -->" % nonce))
        self.assertEqual(revisao["branch_existente"], "fabrica/correcao-11111111")
        for trecho in (HEAD_C, PR_C, prompts.INICIO_VEREDITO, "o botão salvar não responde"):
            self.assertIn(trecho, revisao["prompt"])
        self.assertEqual((self.item()["correcao"]["revisao"]["sha"], run_id), (HEAD_C, "run-3"))
        # gravado com o nonce antes do POST
        antes = [s for s in self.salvos if (s["demandas"]["itens"][ID].get("correcao") or {}).get("revisao", {}).get("nonce") == nonce]
        self.assertIsNone(antes[0]["demandas"]["itens"][ID]["correcao"]["revisao"]["runId"])
        # a vaga da correção passa ao revisor (nada a mais reservado)
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["revisor"]})
        self.assertEqual(demandas.chaves_ocupando(self.estado, AGORA), {demandas.chave(ID)})
        # o run ainda roda: nada
        self.passo(ClienteDeBusca())
        self.assertEqual((len(self.despachos()), self.saida(), self.forja.merges), (3, [], []))

    def test_correcao_sem_ci_aprovada_pelo_revisor_mergeia_e_solta_a_vaga(self):
        run_id = self.revisar_correcao_sem_ci()
        self.veredito(run_id, "aprovado")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, HEAD_C)])
        self.assertEqual([(e["tipo"], e["dados"]) for e in self.saida()], [("etapa_concluida", {"marco": "desenvolvida"})])
        self.assertEqual((self.reservas(), len(self.despachos())), ({}, 3))
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("testada"), cursor="4")))
        self.assertEqual(len(self.despachos()), 4)  # testa de novo

    def test_revisor_que_nao_commita_ainda_vale_o_veredito(self):
        run_id = self.revisar_correcao_sem_ci()
        self.veredito(run_id, "aprovado", estado="failed", motivo="no_changes")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, HEAD_C)])

    # o GitHub recusa o merge (o `.seeds/` conflita: ele ignora o `merge=union`): o main vem para o branch, sem run

    def recusar_o_merge_ate_o_branch_andar(self):
        """O `mergear` da forja falsa recusa o head antigo; `atualizar_branch` empurra o merge do main (HEAD novo)."""
        real = self.forja.mergear
        self.atualizacoes = []

        def mergear(url, sha):
            return False if sha == HEAD_C else real(url, sha)

        def atualizar(repo, branch, padrao):
            self.atualizacoes.append((repo, branch, padrao))
            novo = "3" * 40
            self.forja.definir_pr(PR_C, head_sha=novo, branch=branch, arquivos=["src/app/clientes/page.tsx", ".seeds/issues.jsonl"], aberto=True, mergeado=False)
            self.forja.definir_ci(REPO, novo, self.forja.ci(REPO, HEAD_C))
            return novo

        self.forja.mergear = mergear
        self.atualizar_branch = atualizar

    def test_merge_recusado_da_correcao_aprovada_traz_o_main_e_mergeia_sem_revisar_de_novo(self):
        run_id = self.revisar_correcao_sem_ci()
        self.recusar_o_merge_ate_o_branch_andar()
        self.veredito(run_id, "aprovado")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.atualizacoes, [(REPO, "fabrica/correcao-11111111", "main")])
        self.assertEqual((self.saida(), self.forja.merges), ([], []))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, "3" * 40)])
        self.assertEqual([e["tipo"] for e in self.saida()], ["etapa_concluida"])
        self.assertEqual(len(self.despachos()), 3)  # nenhum revisor a mais

    def test_merge_recusado_com_ci_verde_traz_o_main_e_espera_o_ci_do_head_novo(self):
        self.entregar_correcao(self.corrigir_depois_da_falha(), ci="verde")
        self.recusar_o_merge_ate_o_branch_andar()
        self.passo(ClienteDeBusca())
        self.assertEqual((len(self.atualizacoes), self.saida(), self.forja.merges), (1, [], []))
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, "3" * 40)])

    def test_merge_recusado_sem_como_atualizar_o_branch_trava_como_antes(self):
        run_id = self.revisar_correcao_sem_ci()
        self.forja.mergear = lambda url, sha: False
        self.atualizar_branch = lambda repo, branch, padrao: None  # conflito de verdade
        self.veredito(run_id, "aprovado")
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["dados"], {"motivo": "o GitHub recusou o merge da correção", "url": PR_C})

    def test_merge_recusado_tres_vezes_depois_de_atualizar_trava(self):
        self.entregar_correcao(self.corrigir_depois_da_falha(), ci="verde")
        self.forja.mergear = lambda url, sha: False
        vezes = []

        def atualizar(repo, branch, padrao):
            vezes.append(1)
            novo = ("%d" % (3 + len(vezes))) * 40
            self.forja.definir_pr(PR_C, head_sha=novo, branch=branch, arquivos=["src/app/clientes/page.tsx"], aberto=True, mergeado=False)
            self.forja.definir_ci(REPO, novo, "verde")
            return novo

        self.atualizar_branch = atualizar
        for _ in range(4):
            self.passo(ClienteDeBusca())
        self.assertEqual(len(vezes), demandas.ATUALIZACOES_DA_CORRECAO)
        (evento,) = self.saida()
        self.assertEqual(evento["dados"]["motivo"], "o GitHub recusou o merge da correção")

    # reprovada pelo revisor: o conserto (um run do frontend no mesmo branch do PR, com os achados), até 2 vezes

    def reprovar(self, achados=ACHADOS_DA_REVISAO):
        """O revisor em curso reprova o head que revisou: o conserto fica despachado (devolve o run dele)."""
        rev = self.item()["correcao"]["revisao"]
        self.veredito(rev["runId"], "correcoes", sha=rev["sha"], achados=achados)
        self.passo(ClienteDeBusca())
        return self.item()["runId"]

    def consertar(self, run_id, head, *, estado="succeeded", motivo=None):
        """O conserto termina com o PR no `head` (sem CI): o mesmo head de antes é conserto sem commit."""
        self.forja.definir_pr(PR_C, head_sha=head, branch="fabrica/correcao-11111111", arquivos=["src/app/clientes/page.tsx"])
        self.forja.definir_ci(REPO, head, "ausente")
        self.motor.definir_run(run_id, estado=estado, motivoFalha=motivo, prUrl=PR_C if estado == "succeeded" else None)
        self.passo(ClienteDeBusca())

    def reprovar_depois_de_dois_consertos(self):
        self.revisar_correcao_sem_ci()
        self.consertar(self.reprovar(), HEAD_C2)
        self.consertar(self.reprovar(), HEAD_C3)
        self.reprovar()

    def test_correcao_reprovada_pelo_revisor_despacha_o_conserto_no_mesmo_branch_com_os_achados(self):
        self.revisar_correcao_sem_ci()
        conserto = self.reprovar()
        self.assertEqual((self.saida(), self.forja.merges, self.forja.fechados[1:]), ([], [], []))  # só o PR do teste foi fechado
        self.assertEqual(len(self.despachos()), 4)
        despacho = self.despachos()[3]
        frontend = CONFIG_DO_KIT["modelos"]["frontend"]
        self.assertEqual((despacho["agente"], despacho["modelo"], despacho["max_custo_usd"]), (frontend["agente"], frontend["modelo"], frontend["maxCustoUsd"]))
        self.assertEqual(despacho["branch_existente"], "fabrica/correcao-11111111")
        nonce = demandas.nonce_do_motor(ID, "conserto", 3)
        self.assertEqual(despacho["chave_idempotencia"], nonce)
        self.assertTrue(despacho["prompt"].endswith("<!-- fabrica:nonce=%s -->" % nonce))
        for trecho in (PR_C, "src/app/tutorial.tsx", "No celular o tutorial ainda não funciona", "src/app/x.ts", "falta o teste", "o botão salvar não responde"):
            self.assertIn(trecho, despacho["prompt"])
        c = self.item()["correcao"]
        self.assertEqual((c["consertos"], c["conserto"]["sha"], conserto), (1, HEAD_C, "run-4"))
        self.assertNotIn("revisao", c)
        # gravado com o nonce antes do POST
        antes = [s["demandas"]["itens"][ID] for s in self.salvos if s["demandas"]["itens"][ID].get("nonce") == nonce]
        self.assertIsNone(antes[0]["runId"])
        # a vaga do revisor passa ao conserto (nada a mais reservado)
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})
        self.assertEqual(demandas.chaves_ocupando(self.estado, AGORA), {demandas.chave(ID)})
        # o conserto ainda roda: nada
        self.passo(ClienteDeBusca())
        self.assertEqual((len(self.despachos()), self.saida()), (4, []))

    def test_conserto_com_commit_novo_e_revisado_de_novo_e_aprovado_mergeia(self):
        self.revisar_correcao_sem_ci()
        self.consertar(self.reprovar(), HEAD_C2)
        self.assertEqual(len(self.despachos()), 5)
        revisao = self.despachos()[4]
        self.assertEqual(revisao["branch_existente"], "fabrica/correcao-11111111")
        self.assertIn(HEAD_C2, revisao["prompt"])
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["revisor"]})
        self.assertNotIn("conserto", self.item()["correcao"])
        self.veredito(self.item()["correcao"]["revisao"]["runId"], "aprovado", sha=HEAD_C2)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, HEAD_C2)])
        self.assertEqual([(e["tipo"], e["dados"]) for e in self.saida()], [("etapa_concluida", {"marco": "desenvolvida"})])
        self.assertEqual(self.reservas(), {})

    def test_reprovada_depois_de_dois_consertos_trava_com_o_motivo_simples(self):
        self.reprovar_depois_de_dois_consertos()
        self.assertEqual(len(self.despachos()), 7)  # teste, correção e três revisões com dois consertos no meio
        self.assertEqual(self.forja.merges, [])
        (evento,) = self.saida()
        motivo = "O revisor da Fábrica reprovou a correção: No celular o tutorial ainda não funciona (mesmo depois de dois consertos da Fábrica)"
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": motivo, "url": PR_C}))
        self.assertEqual((self.reservas(), demandas.chaves_ocupando(self.estado, AGORA)), ({}, set()))
        # a trava no Flow e o PR aberto: nada
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", espera="travada"), cursor="4")))
        self.assertEqual((self.saida(), len(self.despachos())), ([], 7))
        # o Paulo mergeia o PR mesmo assim: segue sozinho
        self.paulo_mergeia(head=HEAD_C3)
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", espera="travada"), cursor="5")))
        self.assertEqual([e["tipo"] for e in self.saida()], ["destravada", "etapa_concluida"])

    def test_retomada_depois_dos_consertos_fecha_o_pr_e_corrige_do_zero_a_partir_de_main(self):
        self.reprovar_depois_de_dois_consertos()
        self.enviado()
        self.avancar(60)
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", eventos=RETOMADA), cursor="4")))
        self.assertEqual(self.forja.fechados[1:], [(PR_C, demandas.COMENTARIO_DA_CORRECAO_REFEITA)])
        self.assertEqual(len(self.despachos()), 8)
        nova = self.despachos()[7]
        self.assertIsNone(nova["branch_existente"])
        self.assertIn("Corrija a partir de main", nova["prompt"])
        self.assertIn("o botão salvar não responde", nova["prompt"])
        c = self.item()["correcao"]
        self.assertEqual((c.get("prUrl"), c.get("consertos", 0), self.item()["travaDaCorrecao"]), (None, 0, False))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})
        self.assertEqual(self.forja.merges, [])

    def test_queda_no_post_do_conserto_acha_o_run_pelo_nonce(self):
        self.revisar_correcao_sem_ci()
        rev = self.item()["correcao"]["revisao"]
        self.veredito(rev["runId"], "correcoes", achados=ACHADOS_DA_REVISAO)
        self.motor.falhar_despacho("incerta")
        self.passo(ClienteDeBusca())
        self.assertIsNone(self.item()["runId"])
        self.assertEqual(self.item()["correcao"]["conserto"]["branch"], "fabrica/correcao-11111111")
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 4)  # nenhum POST a mais
        self.assertEqual(self.item()["runId"], "run-4")
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})

    def test_conserto_sem_commit_conta_como_rodada_e_na_segunda_trava(self):
        self.revisar_correcao_sem_ci()
        # o frontend não mudou nada (o Warren dá o run como falho sem commit): conta, e o conserto vai de novo
        self.consertar(self.reprovar(), HEAD_C, estado="failed", motivo="no_changes")
        self.assertEqual((self.saida(), len(self.despachos())), ([], 5))
        segundo = self.despachos()[4]
        self.assertEqual(segundo["branch_existente"], "fabrica/correcao-11111111")
        self.assertIn("No celular o tutorial ainda não funciona", segundo["prompt"])
        self.assertEqual(self.item()["correcao"]["consertos"], 2)
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})
        # o segundo só ganha o commit de controle do Warren: também não mudou o código
        self.forja.definir_comparacao(REPO, HEAD_C, HEAD_C2, [".seeds/issues.jsonl"])
        self.consertar(self.item()["runId"], HEAD_C2)
        (evento,) = self.saida()
        motivo = "O revisor da Fábrica reprovou a correção: No celular o tutorial ainda não funciona (mesmo depois de dois consertos da Fábrica)"
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": motivo, "url": PR_C}))
        self.assertEqual((self.reservas(), len(self.despachos()), self.forja.merges), ({}, 5, []))

    def test_conserto_espera_a_drenagem_com_a_vaga_do_revisor(self):
        self.revisar_correcao_sem_ci()
        capacidade.definir_drenagem(self.capacidade, AGORA)
        self.reprovar()
        self.assertEqual((len(self.despachos()), self.saida()), (3, []))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["revisor"]})
        capacidade.definir_drenagem(self.capacidade, None)
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 4)
        self.assertEqual(self.despachos()[3]["branch_existente"], "fabrica/correcao-11111111")
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})

    def test_paulo_descarta_a_demanda_com_o_conserto_rodando_segura_a_vaga_ate_o_run_terminar(self):
        self.revisar_correcao_sem_ci()
        conserto = self.reprovar()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", encerrada="descartada"), cursor="4")))
        self.assertIn(ID, self.estado["demandas"]["itens"])
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})
        self.motor.definir_run(conserto, estado="succeeded", prUrl=PR_C)
        self.passo(ClienteDeBusca())
        self.passo(ClienteDeBusca())
        self.assertNotIn(ID, self.estado["demandas"]["itens"])
        self.assertEqual((self.reservas(), self.forja.merges), ({}, []))

    def test_revisor_sem_veredito_revisa_uma_vez_mais_e_depois_trava(self):
        run_id = self.revisar_correcao_sem_ci()
        self.motor.definir_texto(run_id, "esqueci o bloco")
        self.motor.definir_run(run_id, estado="succeeded")
        self.passo(ClienteDeBusca())
        self.assertEqual((len(self.despachos()), self.saida()), (4, []))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["revisor"]})
        segundo = self.item()["correcao"]["revisao"]["runId"]
        self.assertNotEqual(segundo, run_id)
        self.motor.definir_run(segundo, estado="failed", motivoFalha="agent_error")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [])
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": demandas.MOTIVO_REVISAO_SEM_VEREDITO, "url": PR_C}))
        self.assertEqual((self.reservas(), len(self.despachos())), ({}, 4))

    def test_veredito_de_outro_sha_nao_vale(self):
        run_id = self.revisar_correcao_sem_ci()
        self.veredito(run_id, "aprovado", sha="9" * 40)
        self.passo(ClienteDeBusca())
        self.assertEqual((self.forja.merges, len(self.despachos())), ([], 4))

    def test_head_que_andou_descarta_o_veredito_e_revisa_no_head_novo(self):
        run_id = self.revisar_correcao_sem_ci()
        novo = "2" * 40
        self.veredito(run_id, "aprovado")
        self.forja.definir_pr(PR_C, head_sha=novo, branch="fabrica/correcao-11111111", arquivos=["src/app/clientes/page.tsx"])
        self.forja.definir_ci(REPO, novo, "ausente")
        self.passo(ClienteDeBusca())
        self.assertEqual((self.forja.merges, self.saida()), ([], []))
        self.assertEqual(len(self.despachos()), 4)
        self.assertIn(novo, self.despachos()[3]["prompt"])
        self.assertEqual(self.item()["correcao"]["revisao"]["sha"], novo)
        self.veredito(self.item()["correcao"]["revisao"]["runId"], "aprovado", sha=novo)
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, novo)])
        self.assertEqual(self.reservas(), {})

    def test_commit_de_controle_do_warren_depois_do_revisor_mantem_o_veredito(self):
        # ao fechar o run do revisor, o Warren empurra `chore(warren): seeds state`: o head muda, o código não
        run_id = self.revisar_correcao_sem_ci()
        novo = "2" * 40
        self.veredito(run_id, "aprovado")
        self.forja.definir_pr(PR_C, head_sha=novo, branch="fabrica/correcao-11111111", arquivos=["src/app/clientes/page.tsx", ".seeds/issues.jsonl"])
        self.forja.definir_ci(REPO, novo, "ausente")
        self.forja.definir_comparacao(REPO, HEAD_C, novo, [".seeds/issues.jsonl"])
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, novo)])
        self.assertEqual(len(self.despachos()), 3)  # nenhum revisor a mais

    def test_commit_de_controle_com_o_revisor_rodando_nao_larga_a_revisao(self):
        run_id = self.revisar_correcao_sem_ci()
        novo = "2" * 40
        self.forja.definir_pr(PR_C, head_sha=novo, branch="fabrica/correcao-11111111", arquivos=["src/app/clientes/page.tsx", ".seeds/issues.jsonl"])
        self.forja.definir_ci(REPO, novo, "ausente")
        self.forja.definir_comparacao(REPO, HEAD_C, novo, [".seeds/issues.jsonl"])
        self.passo(ClienteDeBusca())
        self.veredito(run_id, "aprovado")
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, novo)])
        self.assertEqual(len(self.despachos()), 3)

    def test_head_que_andou_com_codigo_alem_do_controle_revisa_de_novo(self):
        run_id = self.revisar_correcao_sem_ci()
        novo = "2" * 40
        self.veredito(run_id, "aprovado")
        self.forja.definir_pr(PR_C, head_sha=novo, branch="fabrica/correcao-11111111", arquivos=["src/app/clientes/page.tsx"])
        self.forja.definir_ci(REPO, novo, "ausente")
        self.forja.definir_comparacao(REPO, HEAD_C, novo, [".seeds/issues.jsonl", "src/app/clientes/page.tsx"])
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(len(self.despachos()), 4)

    def test_head_que_andou_com_o_revisor_rodando_espera_o_run_antigo(self):
        run_id = self.revisar_correcao_sem_ci()
        novo = "2" * 40
        self.forja.definir_pr(PR_C, head_sha=novo, branch="fabrica/correcao-11111111", arquivos=["src/app/clientes/page.tsx"])
        self.forja.definir_ci(REPO, novo, "ausente")
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 3)  # nunca dois runs da demanda ao mesmo tempo
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["revisor"]})
        self.veredito(run_id, "aprovado")  # o antigo termina: o veredito dele não vale
        self.passo(ClienteDeBusca())
        self.passo(ClienteDeBusca())
        self.assertEqual((self.forja.merges, len(self.despachos())), ([], 4))
        self.assertEqual(self.item()["correcao"]["revisao"]["sha"], novo)
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["revisor"]})

    def test_queda_no_post_do_revisor_acha_o_run_pelo_nonce(self):
        self.sem_ci_obrigatorio()
        self.entregar_correcao(self.corrigir_depois_da_falha(), ci="ausente")
        self.motor.falhar_despacho("incerta")
        self.passo(ClienteDeBusca())
        self.assertIsNone(self.item()["correcao"]["revisao"]["runId"])
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 3)
        self.assertEqual(self.item()["correcao"]["revisao"]["runId"], "run-3")

    def test_paulo_descarta_a_demanda_com_o_revisor_rodando_segura_a_vaga_ate_o_run_terminar(self):
        run_id = self.revisar_correcao_sem_ci()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", encerrada="descartada"), cursor="4")))
        self.assertIn(ID, self.estado["demandas"]["itens"])
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["revisor"]})
        self.veredito(run_id, "aprovado")
        self.passo(ClienteDeBusca())
        self.passo(ClienteDeBusca())
        self.assertNotIn(ID, self.estado["demandas"]["itens"])
        self.assertEqual((self.reservas(), self.forja.merges), ({}, []))

    def test_revisor_que_passa_do_teto_trava_e_segura_a_vaga_ate_terminar(self):
        run_id = self.revisar_correcao_sem_ci()
        self.avancar(demandas.TETO_RUN_S + 60)
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": demandas.MOTIVO_TETO_DA_REVISAO, "url": PR_C}))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["revisor"]})
        self.veredito(run_id, "aprovado")
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", espera="travada"), cursor="4")))
        self.assertEqual((self.reservas(), self.forja.merges), ({}, []))

    def test_correcao_sem_ci_sem_modelo_do_revisor_trava_para_o_paulo(self):
        self.sem_ci_obrigatorio()
        modelos = {k: v for k, v in CONFIG_DO_KIT["modelos"].items() if k != "revisor"}
        self.falhar_o_teste()
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida"), cursor="3")), modelos=modelos)
        self.entregar_correcao(self.item()["runId"], ci="ausente")
        self.passo(ClienteDeBusca(), modelos=modelos)
        (evento,) = self.saida()
        self.assertEqual(evento["dados"], {"motivo": "PR de correção sem CI: revise e faça o merge", "url": PR_C})
        self.assertEqual((self.reservas(), len(self.despachos())), ({}, 2))

    def test_ci_obrigatorio_nas_seeds_true_mantem_a_trava_para_o_paulo(self):
        self.sem_ci_obrigatorio(True)
        self.entregar_correcao(self.corrigir_depois_da_falha(), ci="ausente")
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["dados"], {"motivo": "PR de correção sem CI: revise e faça o merge", "url": PR_C})
        self.assertEqual((self.reservas(), len(self.despachos()), self.forja.merges), ({}, 2, []))

    def test_ci_obrigatorio_nas_seeds_torto_trava_com_a_config_ilegivel(self):
        self.sem_ci_obrigatorio("nao")
        self.entregar_correcao(self.corrigir_depois_da_falha(), ci="ausente")
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["dados"], {"motivo": "a .fabrica/config.json do repositório está ilegível", "url": PR_C})

    def test_ci_verde_com_ci_opcional_mergeia_sem_revisor(self):
        self.sem_ci_obrigatorio()
        self.entregar_correcao(self.corrigir_depois_da_falha(), ci="verde")
        self.passo(ClienteDeBusca())
        self.assertEqual((self.forja.merges, len(self.despachos())), ([(PR_C, HEAD_C)], 2))

    def test_descartada_pelo_paulo_com_a_correcao_no_meio_solta_a_vaga_quando_o_run_termina(self):
        run_id = self.corrigir_depois_da_falha()
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", encerrada="descartada"), cursor="4")))
        self.assertIn(ID, self.estado["demandas"]["itens"])  # o run superado ainda segura a vaga
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR_C)  # termina com PR: não conta
        self.passo(ClienteDeBusca())
        self.passo(ClienteDeBusca())
        self.assertNotIn(ID, self.estado["demandas"]["itens"])
        self.assertEqual((self.reservas(), self.saida(), self.forja.merges, len(self.despachos())), ({}, [], [], 2))

    def test_capturas_acima_de_40_mb_por_teste_ficam_de_fora_com_nota_no_resumo(self):
        run_id = self.abrir_teste()
        telas = tuple("desktop-%02d.png" % i for i in range(1, 6)) + tuple("celular-%02d.png" % i for i in range(1, 6))
        self.entregar_teste(run_id, telas=telas)
        nove_mb = b"\x89PNG\r\n\x1a\n" + b"\x00" * (9 * 1024 * 1024)
        for t in telas:
            self.forja.definir_arquivo(REPO, HEAD_T, "%s/%s" % (CAPTURAS, t), nove_mb)
        self.passo(ClienteDeBusca())
        arquivos = [s["arquivo"] for s in self.estado["demandas"]["saida"] if "arquivo" in s]
        self.assertEqual([a["nome"] for a in arquivos], ["celular-01.png", "celular-02.png", "celular-03.png", "desktop-01.png"])
        self.assertLessEqual(sum((self.raiz / a["caminho"]).stat().st_size for a in arquivos), 40 * 1024 * 1024)
        evento = self.estado["demandas"]["saida"][-1]["evento"]
        self.assertEqual(evento["tipo"], "teste")
        self.assertEqual(evento["dados"]["capturas"], [a["id"] for a in arquivos])
        self.assertTrue(evento["dados"]["resumo"].startswith("o fluxo passou"))
        self.assertIn("6 capturas ficaram de fora (limite de 40 MB por teste)", evento["dados"]["resumo"])

    def test_segunda_falha_espera_o_paulo_e_retomada_volta_a_corrigir(self):
        self.falhar_o_teste()
        # segunda falha: o Flow segura a demanda em `testada` esperando o Paulo
        self.passo(ClienteDeBusca(pagina(retrato("testada", espera="teste_falhou"), cursor="3")))
        self.passo(ClienteDeBusca(pagina(retrato("testada", espera="teste_falhou"), cursor="4")))
        self.passo(ClienteDeBusca())
        self.assertEqual((len(self.despachos()), self.saida(), self.reservas()), (1, [], {}))
        self.assertEqual(self.item()["fase"], "esperando_paulo")
        self.avancar(60)
        self.passo(ClienteDeBusca(pagina(retrato("testada", eventos=RETOMADA), cursor="5")))
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(self.despachos()[1]["chave_idempotencia"], demandas.nonce_do_motor(ID, "correcao", 1))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["frontend"]})
        # a etapa continua `testada` enquanto a correção roda: nenhum teste junto
        self.passo(ClienteDeBusca(pagina(retrato("testada", eventos=RETOMADA), cursor="6")))
        self.assertEqual(len(self.despachos()), 2)
        self.entregar_correcao(self.item()["runId"])
        self.passo(ClienteDeBusca())
        self.assertEqual(self.forja.merges, [(PR_C, HEAD_C)])
        self.assertEqual(self.saida(), [])  # a etapa já é `testada`: sem `etapa_concluida`
        self.passo(ClienteDeBusca())
        self.assertEqual(len(self.despachos()), 3)
        self.assertEqual(self.despachos()[2]["chave_idempotencia"], demandas.nonce_do_motor(ID, "teste", 2))

    def test_entrega_parcial_do_paulo_na_segunda_falha_entrega_sem_testar_nem_corrigir(self):
        # "Entregar o que funciona" no Flow: a testada é concluída e a demanda vai à etapa `entregue`
        entrega_parcial = [{"id": "e3", "tipo": "entrega_parcial", "origem": "paulo", "em": AGORA, "dados": {"filha": "f"}}]
        self.falhar_o_teste()
        self.passo(ClienteDeBusca(pagina(retrato("testada", espera="teste_falhou"), cursor="3")))
        self.assertEqual((self.item()["fase"], self.reservas()), ("esperando_paulo", {}))
        self.avancar(60)
        pedir = PedirFalso()
        self.passo(
            ClienteDeBusca(pagina(retrato("entregue", eventos=entrega_parcial, titulo="Suporte por IA", publicacao={"modo": "lote"}), cursor="4")),
            publicacao=PUBLICACAO,
            pedir_publicacao=pedir,
        )
        self.assertEqual(([e["tipo"] for e in self.saida()], len(pedir.chamadas)), (["entregue"], 1))
        self.assertEqual((self.item()["fase"], len(self.despachos()), self.reservas()), ("entregando", 1, {}))
        self.enviado()
        self.passo(ClienteDeBusca(pagina(retrato("entregue", eventos=entrega_parcial), cursor="5")))
        self.assertEqual((self.saida(), len(self.despachos())), ([], 1))
        # o Flow aplicou o `entregue`: o item sai do estado, sem vaga e sem run novo
        self.passo(ClienteDeBusca(pagina(retrato("entregue", encerrada="entregue", eventos=entrega_parcial), cursor="6")))
        self.assertNotIn(ID, self.estado["demandas"]["itens"])
        self.assertEqual((len(self.despachos()), self.reservas()), (1, {}))

    def test_entrega_parcial_sem_o_kit_ver_a_espera_tambem_so_entrega(self):
        self.falhar_o_teste()
        # o kit não viu a `teste_falhou`: o retrato seguinte já está na etapa `entregue`
        self.passo(ClienteDeBusca(pagina(retrato("entregue"), cursor="3")))
        self.assertEqual([e["tipo"] for e in self.saida()], ["entregue"])
        self.assertEqual((self.item()["fase"], len(self.despachos()), self.reservas()), ("entregando", 1, {}))

    def test_retomada_da_segunda_falha_sem_ver_a_espera_tambem_corrige(self):
        self.falhar_o_teste()
        self.avancar(60)
        self.passo(ClienteDeBusca(pagina(retrato("testada", eventos=RETOMADA), cursor="3")))
        self.assertEqual(len(self.despachos()), 2)
        self.assertEqual(self.despachos()[1]["chave_idempotencia"], demandas.nonce_do_motor(ID, "correcao", 1))

    def test_captura_acima_de_10_mb_nao_e_enviada(self):
        grande = b"\x89PNG\r\n\x1a\n" + b"\x00" * (10 * 1024 * 1024)
        self.forja.definir_arquivo(REPO, HEAD_T, TESTE_JSON, json.dumps({"resultado": "passou", "contra": "real", "resumo": "ok"}))
        for nome, dados in (("desktop-01.png", grande), ("desktop-02.png", PNG), ("celular-01.png", PNG), ("celular-02.png", b"GIF89a"), ("outra.png", PNG)):
            self.forja.definir_arquivo(REPO, HEAD_T, "%s/%s" % (CAPTURAS, nome), dados)
        r = demandas.ler_resultado_do_teste(self.forja, REPO, HEAD_T, ID)
        self.assertEqual((r["resultado"], r["resumo"]), ("passou", "ok"))
        self.assertEqual([(c["caminho"], c["tela"]) for c in r["capturas"]], [(CAPTURAS + "/celular-01.png", "celular"), (CAPTURAS + "/desktop-02.png", "desktop")])
        self.assertEqual(r["capturas"][0]["dados"], PNG)
        self.assertIsNone(demandas.ler_resultado_do_teste(self.forja, REPO, HEAD_T2, ID))
        # pelo passo: a única captura de desktop acima de 10 MB fica de fora, e o run é refeito
        run_id = self.abrir_teste()
        self.entregar_teste(run_id, head=HEAD_T2)
        self.forja.definir_arquivo(REPO, HEAD_T2, CAPTURAS + "/desktop-01.png", grande)
        self.passo(ClienteDeBusca())
        self.assertEqual((self.estado["demandas"]["saida"], len(self.despachos())), ([], 2))

    def test_teto_trava_segura_a_vaga_ate_o_run_terminar(self):
        run_id = self.abrir_teste()
        self.avancar(demandas.TETO_RUN_S + 1)
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual(evento["dados"], {"motivo": "o agente passou de 2 h", "url": None})
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["qa"]})
        self.assertEqual(demandas.chaves_ocupando(self.estado), {demandas.chave(ID)})
        self.enviado()
        self.avancar(60)
        em = self.agora.strftime("%Y-%m-%dT%H:%M:%SZ")
        retomada = [{"id": OUTRO, "tipo": "retomada", "origem": "paulo", "em": em, "dados": {}}]
        self.passo(ClienteDeBusca(pagina(retrato("testada", eventos=retomada), cursor="3")))
        self.assertEqual(len(self.despachos()), 1)  # nunca dois runs da demanda
        self.entregar_teste(run_id)  # termina com PR: o resultado não conta
        self.passo(ClienteDeBusca())
        self.assertEqual((self.saida(), len(self.despachos())), ([], 2))
        self.assertEqual(self.reservas(), {demandas.chave(ID): ["qa"]})
        self.assertNotIn("testeSuperado", self.item())

    def test_o_mesmo_erro_5_ciclos_seguidos_vira_travada_e_solta_a_vaga(self):
        run_id = self.abrir_teste()
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR_T)  # a forja não conhece o PR: KeyError todo ciclo
        for _ in range(4):
            self.passo(ClienteDeBusca())
        self.assertEqual(self.saida(), [])
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertTrue(evento["dados"]["motivo"].startswith("o teste parou: o mesmo erro 5 ciclos seguidos (KeyError"))
        self.assertEqual(self.reservas(), {})

    def test_teste_recusado_pelo_flow_vira_travada_uma_vez(self):
        run_id = self.abrir_teste()
        self.entregar_teste(run_id)
        self.passo(ClienteDeBusca())
        demandas.esvaziar_saida(self.estado, ClienteFalso("aplicado", "aplicado", "recusado"), self.raiz, salvar=lambda: None)
        self.passo(ClienteDeBusca())
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": "o Flow recusou o teste enviado pela Fábrica", "url": PR_T}))
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        eventos = self.passo(ClienteDeBusca())
        self.assertEqual((self.saida(), len(self.despachos())), ([], 1))
        self.assertIn("demandas:teste:%s" % ID, [e.get("chave") for e in eventos])

    def test_sem_modelo_do_qa_espera_com_aviso(self):
        modelos = dict(CONFIG_DO_KIT["modelos"])
        del modelos["qa"]
        eventos = self.passo(ClienteDeBusca(pagina(retrato("testada"), cursor="2")), modelos=modelos)
        self.assertEqual((self.despachos(), self.reservas()), ([], {}))
        self.assertIn("demandas:modelo:qa", [e.get("chave") for e in eventos])

    def test_demanda_sem_tela_nao_testa_no_navegador(self):
        etapas = [e for e in MODELO if e["marco"] not in ("desenho", "testada")]
        self.assertNotEqual(demandas.proxima_acao(self.item(), retrato("entregue", etapas=etapas)), "testar")
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida", etapas=etapas), cursor="2")))
        self.passo(ClienteDeBusca(pagina(retrato("entregue", etapas=etapas), cursor="3")))
        self.assertEqual((self.despachos(), self.reservas()), ([], {}))
        self.assertNotIn("teste", self.item())


PLANO_ID = "plano-da-demanda"
PR_S1 = "https://github.com/kustertech-exemplo/app/pull/11"
PR_S2 = "https://github.com/kustertech-exemplo/app/pull/12"
PUBLICACAO = {"url": "https://central.exemplo/api/publicacoes", "token_file": "/tmp/token-de-publicacao"}


class PedirFalso:
    """Substitui `publicar.pedir`: cada chamada consome uma resposta (`None` = sucesso; exceção = falha)."""

    def __init__(self, *respostas):
        self.respostas, self.chamadas = list(respostas), []

    def __call__(self, **kwargs):
        self.chamadas.append(kwargs)
        r = self.respostas.pop(0) if self.respostas else None
        if isinstance(r, BaseException):
            raise r
        return {"id": "p"}


class TestesEntrega(BasePasso):
    def setUp(self):
        super().setUp()
        demandas.secao(self.estado)["itens"][ID] = item("testando", plano=CAMINHO, desenvolvida=True, planoNaFila=PLANO_ID, ultima=retrato("testada"))
        pasta = self.raiz / "planos" / PLANO_ID
        pasta.mkdir(parents=True)
        seeds = {
            "s1": {"estado": "mergeada", "pr": PR_S1},
            "s2": {"estado": "mergeada", "pr": PR_S2},
            "s3": {"estado": "em_andamento", "pr": "https://github.com/kustertech-exemplo/app/pull/13"},
            "s4": {"estado": "mergeada", "pr": "https://exemplo.com/fora"},
        }
        (pasta / "estado.json").write_text(json.dumps({"seeds": seeds}), encoding="utf-8")

    def entregue(self, cursor="2", **extra):
        extra.setdefault("titulo", "Corrigir a listagem de clientes")
        return pagina(retrato("entregue", **extra), cursor=cursor)

    def test_entregar_urgente_pede_imediato_com_a_demanda_e_envia_entregue_com_os_prs(self):
        pedir = PedirFalso()
        self.passo(ClienteDeBusca(self.entregue(destino="urgente", publicacao={"modo": "imediato"})), publicacao=PUBLICACAO, pedir_publicacao=pedir)
        self.assertEqual(
            pedir.chamadas,
            [{"repo": REPO, "descricao": "Corrigir a listagem de clientes", "url": PUBLICACAO["url"], "token_file": PUBLICACAO["token_file"], "modo": "imediato", "demanda": ID}],
        )
        (evento,) = self.saida()
        self.assertEqual((evento["tipo"], evento["dados"]), ("entregue", {"prs": [PR_S1, PR_S2]}))
        self.assertEqual((self.item()["fase"], self.item()["pedida"]), ("entregando", True))

    def test_entregar_lote_da_noite_pede_modo_lote(self):
        pedir = PedirFalso()
        self.passo(ClienteDeBusca(self.entregue(destino="lote_da_noite", publicacao={"modo": "lote"}, titulo="x" * 300)), publicacao=PUBLICACAO, pedir_publicacao=pedir)
        (chamada,) = pedir.chamadas
        self.assertEqual((chamada["modo"], len(chamada["descricao"])), ("lote", 200))

    def test_reinicio_depois_do_pedido_nao_pede_de_novo(self):
        pedir = PedirFalso()
        self.passo(ClienteDeBusca(self.entregue(publicacao={"modo": "lote"})), publicacao=PUBLICACAO, pedir_publicacao=pedir)
        # queda antes de gravar o evento: o item volta sem a fase, mas com a marca do pedido
        self.item().update(fase="testando")
        self.estado["demandas"]["saida"] = []
        self.passo(ClienteDeBusca(self.entregue(cursor="3", publicacao={"modo": "lote"})), publicacao=PUBLICACAO, pedir_publicacao=pedir)
        self.assertEqual(len(pedir.chamadas), 1)
        self.assertEqual([e["tipo"] for e in self.saida()], ["entregue"])
        # a fase `entregando` nunca repete o evento
        self.passo(ClienteDeBusca(self.entregue(cursor="4", publicacao={"modo": "lote"})), publicacao=PUBLICACAO, pedir_publicacao=pedir)
        self.assertEqual((len(pedir.chamadas), len(self.saida())), (1, 1))

    def test_sem_token_de_publicacao_so_envia_entregue(self):
        pedir = PedirFalso()
        self.passo(ClienteDeBusca(self.entregue(publicacao={"modo": "lote"})), publicacao=None, pedir_publicacao=pedir)
        self.assertEqual(pedir.chamadas, [])
        self.assertEqual([e["tipo"] for e in self.saida()], ["entregue"])

    def test_fila_de_publicacao_ausente_404_so_envia_entregue_com_aviso(self):
        pedir = PedirFalso(FalhaDeEnvio("HTTP 404"))
        eventos = self.passo(ClienteDeBusca(self.entregue()), publicacao=PUBLICACAO, pedir_publicacao=pedir)
        self.assertEqual([e["tipo"] for e in self.saida()], ["entregue"])
        self.assertIn("demandas:publicacao:%s" % ID, [e.get("chave") for e in eventos])

    def test_recusa_definitiva_avisa_e_segue_sem_repetir(self):
        for codigo in (409, 422):
            with self.subTest(codigo=codigo):
                self.setUp()
                pedir = PedirFalso(FalhaDeEnvio("HTTP %d" % codigo))
                eventos = self.passo(ClienteDeBusca(self.entregue()), publicacao=PUBLICACAO, pedir_publicacao=pedir)
                self.assertEqual(([e["tipo"] for e in self.saida()], len(pedir.chamadas)), (["entregue"], 1))
                self.assertIn("demandas:publicacao:%s" % ID, [e.get("chave") for e in eventos])

    def test_falha_transitoria_tenta_no_ciclo_seguinte_sem_enviar_entregue(self):
        pedir = PedirFalso(FalhaDeEnvio("timeout"), FalhaDeEnvio("HTTP 503"))
        for cursor in ("2", "3"):
            self.passo(ClienteDeBusca(self.entregue(cursor=cursor)), publicacao=PUBLICACAO, pedir_publicacao=pedir)
            self.assertEqual((self.saida(), self.item()["fase"], self.item().get("pedida")), ([], "testando", None))
        self.passo(ClienteDeBusca(self.entregue(cursor="4")), publicacao=PUBLICACAO, pedir_publicacao=pedir)
        self.assertEqual(([e["tipo"] for e in self.saida()], len(pedir.chamadas)), (["entregue"], 3))

    def test_demanda_sem_tela_entrega_sem_passar_pelo_teste(self):
        etapas = [e for e in MODELO if e["marco"] not in ("desenho", "testada")]
        self.item().update(ultima=retrato("desenvolvida", etapas=etapas))
        pedir = PedirFalso()
        self.passo(ClienteDeBusca(pagina(retrato("entregue", etapas=etapas, titulo="t", publicacao={"modo": "lote"}))), publicacao=PUBLICACAO, pedir_publicacao=pedir)
        self.assertEqual((len(pedir.chamadas), [e["tipo"] for e in self.saida()], self.despachos()), (1, ["entregue"], []))

    def test_entregue_recusado_pelo_flow_so_avisa(self):
        pedir = PedirFalso()
        self.passo(ClienteDeBusca(self.entregue()), publicacao=PUBLICACAO, pedir_publicacao=pedir)
        demandas.esvaziar_saida(self.estado, ClienteFalso("recusado"), self.raiz, salvar=lambda: None)
        eventos = self.passo(ClienteDeBusca(self.entregue(cursor="3")), publicacao=PUBLICACAO, pedir_publicacao=pedir)
        self.assertEqual((self.saida(), len(pedir.chamadas), self.item()["precisa_ressincronizar"]), ([], 1, False))
        self.assertIn("demandas:entrega:%s" % ID, [e.get("chave") for e in eventos])

    def test_encerrada_sai_do_estado_e_apaga_os_arquivos_locais(self):
        arq = demandas.enfileirar_arquivo(self.estado, self.raiz, ID, tipo="desenho", nome="d.html", conteudo="text/html", dados=b"x", tela=None)
        pasta = self.raiz / "demandas" / ID
        self.assertTrue((pasta / arq).exists())
        # com a saída da demanda ainda cheia, o item fica
        self.passo(ClienteDeBusca(pagina(retrato("entregue", encerrada="entregue"), cursor="2")))
        self.assertIn(ID, self.estado["demandas"]["itens"])
        self.assertTrue(pasta.exists())
        self.estado["demandas"]["saida"] = []
        self.passo(ClienteDeBusca())
        self.assertNotIn(ID, self.estado["demandas"]["itens"])
        self.assertFalse(pasta.exists())
        self.passo(ClienteDeBusca())  # sem a demanda no estado, nada volta
        self.assertNotIn(ID, self.estado["demandas"]["itens"])

    def test_encerrada_com_run_superado_vivo_espera_o_run_terminar(self):
        self.motor.definir_run("r1", estado="running", prUrl=None)
        self.item().update(testeSuperado={"runId": "r1", "projeto": "app", "nonce": "n", "inicio": AGORA})
        self.passo(ClienteDeBusca(pagina(retrato("testada", encerrada="orientada"), cursor="2")))
        self.assertIn(ID, self.estado["demandas"]["itens"])


if __name__ == "__main__":
    unittest.main()
