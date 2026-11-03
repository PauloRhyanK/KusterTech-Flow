import http.server
import json
import pathlib
import sys
import tempfile
import threading
import unittest
import urllib.request

RAIZ_DOS_SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ_DOS_SCRIPTS))

import retrato  # noqa: E402

EXEMPLO = RAIZ_DOS_SCRIPTS.parents[1] / "src" / "modules" / "fabrica" / "retrato-exemplo.json"
AGORA = "2026-11-03T21:40:00Z"
ID_A = "dono--cliente--login--aaaaaa"
ID_B = "dono--cliente--cobranca--bbbbbb"
ID_C = "dono--cliente--antigo--cccccc"
ISSUE = "https://github.com/dono/cliente/issues/7"


def capacidade_com(**extra):
    dados = {
        "vagasConfig": 3,
        "ramMinimaMb": 2048,
        "oomEm": None,
        "reservas": {},
        "orquestrador": {},
        "esperando": {},
        "drenagem": None,
    }
    dados.update(extra)
    return dados


def entrada(id_, estado="ativo", entrou="2026-11-03T20:00:00Z", **extra):
    base = {"id": id_, "repo": "dono/cliente", "feature": "Login", "estado": estado, "entrouEm": entrou, "arquivos": ["src/**"]}
    base.update(extra)
    return base


def plano_json(*raias, atual="fase-1"):
    return {"faseAtual": atual, "fases": [{"id": "fase-1", "raias": list(raias)}], "raias": [{"id": r} for r in raias]}


def estado_json(raias, **extra):
    base = {"pausado": None, "raias": {r: {"estado": e} for r, e in raias.items()}, "orquestrador": {"runId": None}}
    base.update(extra)
    return base


def montar(fila=None, avisos=None, planos=None, capacidade=None, warren=None, mem=5120):
    fila_estado = {"fila": fila or [], "avisos": avisos or [], "warren": warren or {}}
    return retrato.montar(agora=AGORA, fila_estado=fila_estado, capacidade=capacidade or capacidade_com(), planos=planos or {}, mem_disponivel_mb=mem)


def tipos(valor):
    """O formato de um JSON: tipos em todos os níveis (`None` é curinga, pois os campos anuláveis variam)."""
    if isinstance(valor, dict):
        return {k: tipos(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [tipos(v) for v in valor]
    if valor is None:
        return None
    return type(valor).__name__


def confere(testes, gerado, exemplo, caminho="retrato"):
    if exemplo is None or gerado is None:
        return
    if isinstance(exemplo, dict):
        testes.assertIsInstance(gerado, dict, caminho)
        testes.assertEqual(sorted(gerado), sorted(exemplo), caminho)
        for chave in exemplo:
            confere(testes, gerado[chave], exemplo[chave], "%s.%s" % (caminho, chave))
    elif isinstance(exemplo, list):
        testes.assertIsInstance(gerado, list, caminho)
        if exemplo:
            for n, item in enumerate(gerado):
                confere(testes, item, exemplo[0], "%s[%d]" % (caminho, n))
    else:
        testes.assertIs(type(gerado), type(exemplo), caminho)


class TestesContratoComOExemplo(unittest.TestCase):
    def cenario(self):
        planos = {
            ID_A: {
                "estado": estado_json({"contrato-retrato": "executando", "back-painel": "planejada"}, decisoes=[{"titulo": "Homologar o painel", "url": ISSUE}]),
                "plano": plano_json("contrato-retrato", "back-painel"),
            },
            ID_B: {"estado": None, "plano": None},
        }
        fila = [entrada(ID_A, feature="Painel da Fábrica na Central"), entrada(ID_B, estado="aguardando", entrou="2026-11-03T21:00:00Z")]
        return montar(
            fila=fila,
            avisos=[{"em": "2026-11-03T21:30:00Z", "mensagem": "Vagas reduzidas por falta de memória"}],
            planos=planos,
            capacidade=capacidade_com(oomEm="2026-11-03T21:00:00Z", reservas={ID_A: ["contrato-retrato"]}, drenagem="2026-11-03T21:39:00Z"),
            warren={"preparado": {"estado": "ja_aplicado", "em": "2026-11-03T21:35:00Z"}},
        )

    def test_campos_e_tipos_iguais_aos_do_exemplo_em_todos_os_niveis(self):
        exemplo = json.loads(EXEMPLO.read_text(encoding="utf-8"))
        gerado = self.cenario()
        confere(self, gerado, exemplo)
        self.assertEqual(sorted(gerado["planos"][0]), sorted(exemplo["planos"][0]))
        self.assertEqual(tipos(gerado["planos"][0]["fases"]), tipos(exemplo["planos"][0]["fases"]))
        self.assertEqual(tipos(gerado["planos"][0]["decisoes"]), tipos(exemplo["planos"][0]["decisoes"]))
        self.assertEqual(gerado["avisos"], exemplo["avisos"])
        self.assertEqual(gerado["warren"]["em"], exemplo["warren"]["em"])
        self.assertEqual(gerado["vagas"]["efetivas"], 2)
        self.assertEqual(gerado["vagas"]["ocupadas"], 1)

    def test_o_confere_pega_campo_a_mais_e_tipo_errado(self):
        exemplo = json.loads(EXEMPLO.read_text(encoding="utf-8"))
        gerado = self.cenario()
        gerado["planos"][0]["fases"][0]["raias"][0]["extra"] = 1
        with self.assertRaises(AssertionError):
            confere(self, gerado, exemplo)
        gerado = self.cenario()
        gerado["planos"][0]["fases"][0]["raias"][0]["estado"] = 3
        with self.assertRaises(AssertionError):
            confere(self, gerado, exemplo)


class TestesMontar(unittest.TestCase):
    def test_uma_entrada_por_id_a_vigente_e_id_invalido_fica_de_fora(self):
        fila = [entrada(ID_A, estado="aguardando"), entrada(ID_A, estado="ativo"), entrada("lixo", estado="ativo"), entrada(ID_B, estado="inventado")]
        planos = montar(fila=fila)["planos"]
        self.assertEqual([(p["id"], p["estado"]) for p in planos], [(ID_A, "ativo")])

    def test_sem_estado_ou_plano_ou_com_um_ilegivel_vai_sem_fase_e_sem_excecao(self):
        casos = {
            ID_A: {"estado": None, "plano": None},
            ID_B: {"estado": estado_json({"r": "executando"}), "plano": None},
            ID_C: {"estado": None, "plano": plano_json("r")},
        }
        fila = [entrada(i) for i in casos]
        for p in montar(fila=fila, planos=casos)["planos"]:
            self.assertIsNone(p["faseAtual"], p["id"])
            self.assertEqual(p["fases"], [], p["id"])
        self.assertEqual([p["id"] for p in montar(fila=fila)["planos"]], sorted([ID_A, ID_B, ID_C], key=lambda i: ("2026-11-03T20:00:00Z", i)))

    def test_fases_e_raias_vem_do_plano_e_do_estado(self):
        plano = {"faseAtual": "f2", "fases": [{"id": "f1", "raias": ["a"]}, {"id": "f2", "raias": ["b", "c", "d"]}]}
        estado = estado_json({"a": "concluida", "b": "executando", "c": "falhou"})
        (p,) = montar(fila=[entrada(ID_A)], planos={ID_A: {"estado": estado, "plano": plano}})["planos"]
        self.assertEqual(p["faseAtual"], "f2")
        self.assertEqual(
            p["fases"],
            [
                {"id": "f1", "raias": [{"id": "a", "estado": "concluida"}]},
                {"id": "f2", "raias": [{"id": "b", "estado": "executando"}, {"id": "c", "estado": "falhou"}, {"id": "d", "estado": "planejada"}]},
            ],
        )

    def test_vagas_ocupadas_e_o_total_de_reservas_e_o_resto_vem_da_capacidade(self):
        cap = capacidade_com(reservas={ID_A: ["x", "y"], ID_B: ["z"]}, oomEm="2026-11-03T21:00:00Z", ramMinimaMb=4096)
        vagas = montar(capacidade=cap, mem=None)["vagas"]
        self.assertEqual(vagas, {"efetivas": 2, "configuradas": 3, "ocupadas": 3, "ramMinimaMb": 4096, "memDisponivelMb": None, "oomEm": "2026-11-03T21:00:00Z"})

    def test_instante_torto_vira_nulo(self):
        retrato_ = montar(capacidade=capacidade_com(oomEm="ontem", drenagem="2026-02-30T00:00:00Z"), warren={"preparado": {"estado": "aplicado", "em": "agora"}})
        self.assertIsNone(retrato_["vagas"]["oomEm"])
        self.assertIsNone(retrato_["drenagem"])
        self.assertEqual(retrato_["warren"], {"preparo": "aplicado", "em": None})

    def test_decisoes_vem_das_quatro_fontes_e_so_com_url_do_github(self):
        estado = estado_json(
            {},
            decisoes=[
                {"titulo": "Escolher A ou B", "url": ISSUE},
                {"titulo": "Link de fora", "url": "https://exemplo.com/x"},
                {"titulo": "Quase", "url": "https://github.com.exemplo.com/x"},
                {"titulo": "Sem https", "url": "http://github.com/dono/cliente/issues/1"},
                {"titulo": "Com usuário", "url": "https://github.com@exemplo.com/x"},
                {"titulo": "Com porta", "url": "https://github.com:8443/x"},
                {"titulo": "Sem url"},
                "lixo",
            ],
            decisaoPausa={"url": "https://github.com/dono/cliente/issues/8", "motivo": "cota"},
            warrenFora={"ciclos": 3, "url": "https://github.com/dono/cliente/issues/9"},
            warrenParcial={"url": "https://exemplo.com/nao", "limpos": 0},
        )
        (p,) = montar(fila=[entrada(ID_A)], planos={ID_A: {"estado": estado, "plano": plano_json("r")}})["planos"]
        self.assertEqual([d["url"] for d in p["decisoes"]], [ISSUE, "https://github.com/dono/cliente/issues/8", "https://github.com/dono/cliente/issues/9"])
        self.assertEqual(p["decisoes"][0]["titulo"], "Escolher A ou B")
        self.assertTrue(all(d["titulo"] for d in p["decisoes"]))

    def test_orquestrador_ativo_e_pausado_vem_do_estado(self):
        estado = estado_json({}, pausado="cota", orquestrador={"runId": "run-1"})
        (p,) = montar(fila=[entrada(ID_A, estado="pausado")], planos={ID_A: {"estado": estado, "plano": plano_json("r")}})["planos"]
        self.assertTrue(p["orquestradorAtivo"])
        self.assertEqual(p["pausado"], "cota")

    def test_avisos_sem_caminho_da_maquina_e_cortados_em_unidades_utf16(self):
        longo = "😀" * 400
        avisos = [
            {"em": "2026-11-03T21:00:00Z", "mensagem": "falha em /home/devops/fabrica/planos/x/estado.json e em ~/fabrica/fila.json agora"},
            {"em": "2026-11-03T21:01:00Z", "mensagem": "veja https://github.com/dono/cliente/issues/1 e vagas/ram"},
            {"em": "2026-11-03T21:02:00Z", "mensagem": longo},
            {"em": "ontem", "mensagem": "instante torto"},
            {"em": "2026-11-03T21:03:00Z", "mensagem": "   "},
        ]
        saida = montar(avisos=avisos)["avisos"]
        self.assertEqual(len(saida), 3)
        self.assertNotIn("/home", saida[0]["mensagem"])
        self.assertNotIn("~/", saida[0]["mensagem"])
        self.assertIn("falha em", saida[0]["mensagem"])
        self.assertIn("https://github.com/dono/cliente/issues/1 e vagas/ram", saida[1]["mensagem"])
        unidades = len(saida[2]["mensagem"].encode("utf-16-le")) // 2
        self.assertLessEqual(unidades, retrato.LIMITES["textoLongo"])
        self.assertGreater(unidades, retrato.LIMITES["textoLongo"] - 3)

    def test_cinquenta_avisos_no_maximo_os_mais_recentes(self):
        avisos = [{"em": "2026-11-03T21:00:00Z", "mensagem": "aviso %d" % n} for n in range(60)]
        saida = montar(avisos=avisos)["avisos"]
        self.assertEqual(len(saida), 50)
        self.assertEqual(saida[-1]["mensagem"], "aviso 59")

    def test_titulo_com_emoji_nao_passa_do_limite(self):
        estado = estado_json({}, decisoes=[{"titulo": "😀" * 400, "url": ISSUE}])
        (p,) = montar(fila=[entrada(ID_A)], planos={ID_A: {"estado": estado, "plano": plano_json("r")}})["planos"]
        self.assertLessEqual(len(p["decisoes"][0]["titulo"].encode("utf-16-le")) // 2, retrato.LIMITES["textoLongo"])

    def test_nada_alem_do_contrato_vaza(self):
        estado = estado_json(
            {"r": "executando"},
            seeds={"s": {"pr": "https://github.com/dono/cliente/pull/3", "corpoDoPr": "SEGREDO-DO-CORPO", "branch": "warren/run_1"}},
            caminho="/home/devops/fabrica/planos/x",
        )
        texto = json.dumps(montar(fila=[entrada(ID_A)], planos={ID_A: {"estado": estado, "plano": plano_json("r")}}), ensure_ascii=False)
        for proibido in ("SEGREDO-DO-CORPO", "/home/devops", "warren/run_1", "arquivos", "src/**"):
            self.assertNotIn(proibido, texto)

    def test_surrogate_solto_nao_quebra_a_serializacao(self):
        retrato_ = montar(avisos=[{"em": "2026-11-03T21:00:00Z", "mensagem": "ruim \ud800 fim"}])
        retrato.serializar(retrato_)


class TestesAjustar(unittest.TestCase):
    def planos(self, estados, extra_titulo=0):
        saida = []
        for n, estado in enumerate(estados):
            saida.append(
                {
                    "id": "p%02d" % n,
                    "repo": "dono/cliente",
                    "feature": "f%d" % n,
                    "estado": estado,
                    "entrouEm": "2026-11-03T20:%02d:00Z" % n,
                    "faseAtual": None,
                    "fases": [],
                    "pausado": None,
                    "decisoes": [{"titulo": "t" * 250 + str(i), "url": ISSUE} for i in range(extra_titulo)],
                    "orquestradorAtivo": False,
                }
            )
        return saida

    def retrato_com(self, planos, avisos=()):
        base = montar()
        base["planos"] = planos
        base["avisos"] = list(avisos)
        return base

    def test_cabendo_nao_muda_nada(self):
        r = self.retrato_com(self.planos(["ativo", "concluido"]))
        self.assertEqual(retrato.ajustar(r), r)

    def test_mais_de_50_planos_tira_removido_e_concluido_do_mais_antigo(self):
        estados = ["concluido"] * 3 + ["removido"] * 2 + ["ativo"] * 48
        saida = retrato.ajustar(self.retrato_com(self.planos(estados)))
        self.assertEqual(len(saida["planos"]), 50)
        self.assertEqual([p["id"] for p in saida["planos"]], ["p%02d" % n for n in range(3, 53)])

    def test_nunca_tira_plano_ocupando_vaga_nem_aguardando(self):
        estados = ["ativo", "pausado", "admitindo"] * 18
        self.assertIsNone(retrato.ajustar(self.retrato_com(self.planos(estados))))

    def test_por_tamanho_saem_primeiro_os_encerrados_mais_antigos_depois_os_avisos(self):
        limite = 30_000
        planos = self.planos(["concluido", "ativo", "removido", "ativo"], extra_titulo=40)
        avisos = [{"em": "2026-11-03T21:00:00Z", "mensagem": "a%d" % n + "x" * 280} for n in range(50)]
        r = self.retrato_com(planos, avisos)
        tamanho = len(retrato.serializar(r))
        self.assertGreater(tamanho, limite)
        saida = retrato.ajustar(r, limite_bytes=limite)
        self.assertLessEqual(len(retrato.serializar(saida)), limite)
        self.assertEqual([p["id"] for p in saida["planos"]], ["p01", "p03"])  # ocupando ficam
        self.assertLess(len(saida["avisos"]), 50)
        self.assertEqual(saida["avisos"][-1]["mensagem"], avisos[-1]["mensagem"])  # os mais antigos saem primeiro

    def test_encerrados_saem_um_a_um_e_param_quando_cabe(self):
        planos = self.planos(["concluido", "removido", "ativo"], extra_titulo=40)
        um_plano = len(retrato.serializar(self.retrato_com(planos[2:])))
        dois = len(retrato.serializar(self.retrato_com(planos[1:])))
        saida = retrato.ajustar(self.retrato_com(planos), limite_bytes=dois)
        self.assertEqual([p["id"] for p in saida["planos"]], ["p01", "p02"])
        self.assertLess(um_plano, dois)

    def test_se_ainda_nao_couber_devolve_none(self):
        r = self.retrato_com(self.planos(["ativo"], extra_titulo=40))
        self.assertIsNone(retrato.ajustar(r, limite_bytes=1000))

    def test_o_limite_padrao_e_256_kb(self):
        self.assertEqual(retrato.LIMITE_BYTES, 256 * 1024)

    def test_nao_altera_o_retrato_recebido(self):
        r = self.retrato_com(self.planos(["concluido"] * 60))
        antes = json.dumps(r)
        retrato.ajustar(r)
        self.assertEqual(json.dumps(r), antes)


class TestesLerPlanos(unittest.TestCase):
    def test_le_estado_e_plano_de_cada_id_e_ilegivel_ou_ausente_vira_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz = pathlib.Path(tmp)
            for id_ in (ID_A, ID_B, ID_C):
                (raiz / id_).mkdir()
            (raiz / ID_A / "estado.json").write_text(json.dumps({"x": 1}), encoding="utf-8")
            (raiz / ID_A / "plano.json").write_text(json.dumps({"faseAtual": "f"}), encoding="utf-8")
            (raiz / ID_B / "estado.json").write_text("{quebrado", encoding="utf-8")
            (raiz / ID_B / "plano.json").write_text("[]", encoding="utf-8")
            lidos = retrato.ler_planos(raiz, [ID_A, ID_B, ID_C, "sem-pasta"])
        self.assertEqual(lidos[ID_A], {"estado": {"x": 1}, "plano": {"faseAtual": "f"}})
        self.assertEqual(lidos[ID_B], {"estado": None, "plano": None})
        self.assertEqual(lidos[ID_C], {"estado": None, "plano": None})
        self.assertEqual(lidos["sem-pasta"], {"estado": None, "plano": None})


class TestesUrl(unittest.TestCase):
    def test_https_e_localhost_aceitos(self):
        for url in (
            "https://central.exemplo.com/api/fabrica/estado",
            "http://localhost:3000/api/fabrica/estado",
            "http://127.0.0.1:13000/api/fabrica/estado",
            "http://localhost/x",
        ):
            with self.subTest(url=url):
                self.assertTrue(retrato.url_valida(url))

    def test_o_resto_e_recusado(self):
        for url in (
            "http://localhost.exemplo.com/x",
            "http://127.0.0.1.exemplo.com/x",
            "http://central.exemplo.com/x",
            "http://localhost@exemplo.com/x",
            "https://usuario:senha@central.exemplo.com/x",
            "ftp://central.exemplo.com/x",
            "https:///x",
            "central.exemplo.com",
            "",
            None,
            "http://[::1]/x",
        ):
            with self.subTest(url=url):
                self.assertFalse(retrato.url_valida(url))


class Central(http.server.ThreadingHTTPServer):
    """Central de mentira: responde com o `codigo`/`local` configurado e guarda o que recebeu."""

    def __init__(self, codigo=200, local=None):
        self.codigo, self.local, self.recebidos = codigo, local, []
        super().__init__(("127.0.0.1", 0), self.Tratador)
        self.thread = threading.Thread(target=self.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self):
        return "http://127.0.0.1:%d/api/fabrica/estado" % self.server_address[1]

    class Tratador(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            corpo = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            self.server.recebidos.append((self.path, dict(self.headers), corpo))
            self.send_response(self.server.codigo)
            if self.server.local:
                self.send_header("Location", self.server.local)
            self.send_header("Content-Length", "0")
            self.end_headers()

        do_GET = do_POST

        def log_message(self, *_):
            pass

    def parar(self):
        self.shutdown()
        self.server_close()


TOKEN = "tok-da-central-0123456789"


class TestesEnviar(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.token_file = pathlib.Path(self._tmp.name) / "token"
        self.token_file.write_text(TOKEN + "\n", encoding="utf-8")

    def central(self, **kw):
        servidor = Central(**kw)
        self.addCleanup(servidor.parar)
        return servidor

    def test_post_com_bearer_json_e_corpo(self):
        servidor = self.central()
        retrato.enviar(b'{"versao":1}', url=servidor.url, token_file=self.token_file)
        ((caminho, cabecalhos, corpo),) = servidor.recebidos
        self.assertEqual(caminho, "/api/fabrica/estado")
        self.assertEqual(cabecalhos["Authorization"], "Bearer " + TOKEN)
        self.assertEqual(cabecalhos["Content-Type"], "application/json")
        self.assertEqual(corpo, b'{"versao":1}')

    def test_timeout_de_10_segundos(self):
        vistos = []

        class Resposta:
            status = 204

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self, *_):
                return b""

        def abrir(req, timeout):
            vistos.append(timeout)
            return Resposta()

        retrato.enviar(b"{}", url="https://central.exemplo.com/x", token_file=self.token_file, abrir=abrir)
        self.assertEqual(vistos, [10])
        self.assertEqual(retrato.TIMEOUT_S, 10)

    def test_redirecionamento_e_falha_e_o_token_nao_vai_para_o_outro_host(self):
        destino = self.central()
        origem = self.central(codigo=302, local=destino.url)
        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            retrato.enviar(b"{}", url=origem.url, token_file=self.token_file)
        self.assertIn("302", str(ctx.exception))
        self.assertEqual(destino.recebidos, [])
        self.assertEqual(len(origem.recebidos), 1)

    def test_o_opener_padrao_do_urllib_seguiria_o_redirecionamento(self):
        # prova de que o teste acima tem dentes: sem o `_SemRedirecionamento`, o token chegaria ao outro host
        destino = self.central()
        origem = self.central(codigo=302, local=destino.url)
        req = urllib.request.Request(origem.url, data=b"{}", method="POST", headers={"Authorization": "Bearer x"})
        urllib.request.urlopen(req, timeout=5).close()
        self.assertEqual(len(destino.recebidos), 1)

    def test_status_de_erro_vira_falha_sem_vazar_o_token(self):
        for codigo in (401, 403, 413, 500):
            with self.subTest(codigo=codigo):
                servidor = self.central(codigo=codigo)
                with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
                    retrato.enviar(b"{}", url=servidor.url, token_file=self.token_file)
                self.assertIn("HTTP %d" % codigo, str(ctx.exception))
                self.assertNotIn(TOKEN, str(ctx.exception))

    def test_central_fora_do_ar_e_timeout(self):
        servidor = self.central()
        url = servidor.url
        servidor.parar()
        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            retrato.enviar(b"{}", url=url, token_file=self.token_file)
        self.assertNotIn(TOKEN, str(ctx.exception))

        def abrir(req, timeout):
            raise TimeoutError("demorou " + TOKEN)

        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            retrato.enviar(b"{}", url="https://central.exemplo.com/x", token_file=self.token_file, abrir=abrir)
        self.assertIn("timeout", str(ctx.exception))
        self.assertNotIn(TOKEN, str(ctx.exception))

    def test_excecao_qualquer_da_abertura_so_mostra_a_classe(self):
        class Estranha(Exception):
            pass

        def abrir(req, timeout):
            raise Estranha("Authorization: Bearer " + TOKEN)

        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            retrato.enviar(b"{}", url="https://central.exemplo.com/x", token_file=self.token_file, abrir=abrir)
        self.assertIn("Estranha", str(ctx.exception))
        self.assertNotIn(TOKEN, str(ctx.exception))

    def test_token_ausente_ilegivel_vazio_ou_torto(self):
        servidor = self.central()
        casos = {
            "ausente": None,
            "vazio": b"\n",
            "binario": b"\xff\xfe\x00",
            "com quebra": b"abc\ndef",
        }
        for nome, conteudo in casos.items():
            with self.subTest(nome=nome):
                arquivo = pathlib.Path(self._tmp.name) / ("t-" + nome.replace(" ", "-"))
                if conteudo is not None:
                    arquivo.write_bytes(conteudo)
                with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
                    retrato.enviar(b"{}", url=servidor.url, token_file=arquivo)
                self.assertIn("token", str(ctx.exception))
        self.assertEqual(servidor.recebidos, [])

    def test_token_file_ausente_na_configuracao(self):
        with self.assertRaises(retrato.FalhaDeEnvio) as ctx:
            retrato.enviar(b"{}", url="https://central.exemplo.com/x", token_file=None)
        self.assertIn("FABRICA_CENTRAL_TOKEN_FILE", str(ctx.exception))

    def test_url_recusada_nao_abre_conexao(self):
        def abrir(req, timeout):
            raise AssertionError("não devia abrir")

        for url in ("http://central.exemplo.com/x", "http://localhost.exemplo.com/x"):
            with self.assertRaises(retrato.FalhaDeEnvio):
                retrato.enviar(b"{}", url=url, token_file=self.token_file, abrir=abrir)


if __name__ == "__main__":
    unittest.main()
