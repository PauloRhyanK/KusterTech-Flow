"""Entrega de verdade (demanda 9c44dfa8 do CAISv2): o teste diz contra o quê testou, o que só passou contra a
simulação não é publicado sozinho, o contrato de outro repositório é cópia fiel e o plano que depende de outro
repositório pede o endereço que falta em vez de inventá-lo."""

import copy
import json
import pathlib
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import contratos_externos as ce  # noqa: E402
import demandas  # noqa: E402
import despachante  # noqa: E402
import instalar  # noqa: E402
import prompts  # noqa: E402
from testes_demandas import (  # noqa: E402
    CAMINHO,
    CAPTURAS,
    BRANCH_T,
    HEAD_C,
    ID,
    MODELO,
    PNG,
    PR_C,
    PR_T,
    HEAD_T,
    PUBLICACAO,
    REPO,
    TESTE_JSON,
    BasePasso,
    ClienteDeBusca,
    PedirFalso,
    item,
    pagina,
    retrato,
)
import testes_coordenador as tc  # noqa: E402
import testes_despachante as td  # noqa: E402
import testes_instalar as ti  # noqa: E402

BACK = "dono/back"
OPENAPI = "pacotes/contratos/openapi.yaml"
LISTA = "docs/back/enderecos.txt"
COPIA = "docs/back/openapi.yaml"

YAML_DO_BACK = textwrap.dedent(
    """\
    openapi: "3.1.0"
    info:
      title: "API: a porta"
      description: |
        Texto em bloco que parece YAML:
        get: isto não é um método
    servers:
      - url: "/"
    paths:
      "/v1/relatos":
        get:
          operationId: "getRelatos"
          parameters:
            - name: "id"
              in: "path"
          responses:
            "200":
              description: "Deu certo: sim."
              content: {}
        post:
          operationId: 'postRelatos'
      "/v1/relatos/{id}":
        parameters: []
        delete:
          operationId: "apagar"
        put: null
      /publico/tema.json:
        get:
          operationId: tema # comentário
    components:
      schemas:
        ComandoNome:
          type: "string"
          enum:
            - "sinalizar_relato"
            - "abrir_rascunho"
        Outro:
          enum: ["x"]
    """
)
ENDERECOS = ["DELETE /v1/relatos/{id}", "GET /publico/tema.json", "GET /v1/relatos", "POST /v1/relatos", "COMANDO abrir_rascunho", "COMANDO sinalizar_relato"]
CONTRATO_LISTA = {"arquivo": LISTA, "repo": BACK, "caminho": OPENAPI, "modo": "enderecos"}
CONTRATO_COPIA = {"arquivo": COPIA, "repo": BACK, "caminho": OPENAPI, "modo": "copia"}
SO_SIMULACAO = (
    "Testado só contra a simulação do back-end. Publicar assim pode expor algo que não funciona. "
    "Retomar publica mesmo assim; Encerrar não publica."
)


def lista(*linhas, commit="abc1234"):
    return "# gerado do commit %s\n# não edite à mão\n%s\n" % (commit, "\n".join(linhas))


# ---------------------------------------------------------------- 3. contrato de outro repositório (puro)


class TestesContratosExternos(unittest.TestCase):
    def test_extrai_os_enderecos_e_os_comandos_como_o_script_do_caisv2(self):
        self.assertEqual(ce.extrair_enderecos(YAML_DO_BACK), ENDERECOS)

    def test_ancora_ou_alias_nao_sao_aceitos(self):
        with self.assertRaises(ValueError):
            ce.extrair_enderecos("paths:\n  /a: &x\n    get: {}\n")
        with self.assertRaises(ValueError):
            ce.extrair_enderecos("openapi: 3\n")  # sem paths

    def test_lista_gerada_tem_cabecalho_que_nao_conta_na_comparacao(self):
        texto = ce.gerar_enderecos(YAML_DO_BACK, "9c127b7")
        self.assertTrue(texto.splitlines()[0].startswith("# "))
        self.assertIn("9c127b7", texto)
        self.assertEqual(ce.linhas_da_lista(texto), ENDERECOS)

    def test_validar_aceita_as_entradas_e_recusa_com_o_campo(self):
        self.assertEqual(ce.validar(None), [])
        self.assertEqual(ce.validar([CONTRATO_LISTA, CONTRATO_COPIA]), [CONTRATO_LISTA, CONTRATO_COPIA])
        casos = {
            "contratosExternos": {"a": 1},
            "contratosExternos[0]": [dict(CONTRATO_LISTA, extra=1)],
            "contratosExternos[0].arquivo": [dict(CONTRATO_LISTA, arquivo="../fora")],
            "contratosExternos[0].repo": [dict(CONTRATO_LISTA, repo="sem-barra")],
            "contratosExternos[0].caminho": [dict(CONTRATO_LISTA, caminho="/abs")],
            "contratosExternos[0].modo": [dict(CONTRATO_LISTA, modo="parecido")],
            "contratosExternos[1].arquivo repetido": [CONTRATO_LISTA, dict(CONTRATO_COPIA, arquivo=LISTA)],
        }
        for campo, valor in casos.items():
            with self.subTest(campo=campo):
                with self.assertRaises(ValueError) as ctx:
                    ce.validar(valor)
                self.assertEqual(str(ctx.exception), campo)
        self.assertEqual(ce.arquivos([CONTRATO_LISTA, CONTRATO_COPIA]), [LISTA, COPIA])

    def test_copia_precisa_ser_identica(self):
        self.assertIsNone(ce.comparar(CONTRATO_COPIA, b"a: 1\n", b"a: 1\n"))
        self.assertEqual(ce.comparar(CONTRATO_COPIA, b"a: 2\n", b"a: 1\n"), "%s não é mais a cópia fiel de %s:%s" % (COPIA, BACK, OPENAPI))
        self.assertEqual(ce.comparar(CONTRATO_COPIA, None, b"a"), "%s não existe no repositório (cópia de %s:%s)" % (COPIA, BACK, OPENAPI))
        self.assertEqual(ce.comparar(CONTRATO_COPIA, b"a", None), "%s não existe mais na origem (%s)" % (OPENAPI, BACK))

    def test_lista_de_enderecos_diz_o_que_sobra_e_o_que_falta(self):
        origem = YAML_DO_BACK.encode()
        self.assertIsNone(ce.comparar(CONTRATO_LISTA, lista(*reversed(ENDERECOS), commit="outro").encode(), origem))
        copia = lista(*[e for e in ENDERECOS if e != "POST /v1/relatos"], "GET /v1/suporte/conversa")
        self.assertEqual(
            ce.comparar(CONTRATO_LISTA, copia.encode(), origem),
            "%s: estes endereços não existem mais em %s: GET /v1/suporte/conversa; estes endereços de %s faltam na cópia: POST /v1/relatos"
            % (LISTA, BACK, BACK),
        )

    def test_conferir_le_a_origem_no_branch_padrao_dela(self):
        f = td.forja.ForjaFalsa()
        f.definir_branch_padrao(BACK, "trunk")
        f.definir_arquivo(BACK, "trunk", OPENAPI, YAML_DO_BACK)
        f.definir_arquivo(BACK, "main", OPENAPI, "paths: {}\n")  # o main da origem não vale: o padrão é trunk
        f.definir_arquivo(td.REPO, "h1", LISTA, lista(*ENDERECOS))
        f.definir_arquivo(td.REPO, "h1", COPIA, "outra coisa")
        self.assertEqual(ce.conferir(f, td.REPO, "h1", [CONTRATO_LISTA]), [])
        self.assertEqual(len(ce.conferir(f, td.REPO, "h1", [CONTRATO_LISTA, CONTRATO_COPIA])), 1)
        self.assertEqual(ce.conferir(f, td.REPO, "h1", [CONTRATO_LISTA, CONTRATO_COPIA], so={LISTA}), [])


# ---------------------------------------------------------------- 1 e 4. prompts


class TestesPrompts(unittest.TestCase):
    def test_qa_declara_contra_o_que_testou_e_quando_nao_publicar(self):
        texto = prompts.prompt_teste_no_navegador(demanda={"id": ID, "repositorio": REPO, "titulo": "t"}, desenho=None)
        self.assertIn('"contra": "simulacao" | "real"', texto)
        self.assertIn("porta de mentira", texto)
        self.assertIn('"publicar": false', texto)
        self.assertIn("motivoDeNaoPublicar", texto)

    def test_plano_da_demanda_declara_a_fonte_do_contrato_e_pede_o_endereco_que_falta(self):
        texto = prompts.prompt_plano_da_demanda(demanda={"id": ID, "repositorio": REPO, "titulo": "t"}, triagem={})
        for trecho in ("contratosExternos", "nenhuma raia recebe a posse da cópia", "pedido para a demanda do outro repositório", "dublê", "contra"):
            with self.subTest(trecho=trecho):
                self.assertIn(trecho, texto)

    def test_orquestrador_e_equipes_dizem_o_mesmo(self):
        kit = pathlib.Path(__file__).resolve().parent.parent
        orquestrador = (kit / "orquestrador.md").read_text(encoding="utf-8")
        for trecho in ("contratosExternos", "publicar: false", "motivoDeNaoPublicar", "dublê"):
            with self.subTest(trecho=trecho):
                self.assertIn(trecho, orquestrador)
        self.assertIn('"contra"', (kit / "equipes" / "qa.md").read_text(encoding="utf-8"))
        self.assertIn("contratosExternos", (kit / "equipes" / "revisor.md").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- 1 e 2. teste e entrega da demanda


class BaseEntrega(BasePasso):
    def setUp(self):
        super().setUp()
        demandas.secao(self.estado)["itens"][ID] = item("desenvolvendo", plano=CAMINHO, desenvolvida=True, ultima=retrato("desenvolvida"))

    def testar(self, cursor="2", **teste):
        """O teste no navegador com o `teste.json` dado; devolve o evento `teste` enviado (ou `None`)."""
        self.passo(ClienteDeBusca(pagina(retrato("testada"), cursor=cursor)))
        run_id = self.item()["runId"]
        telas = ("desktop-01.png", "celular-01.png")
        self.forja.definir_pr(PR_T, head_sha=HEAD_T, branch=BRANCH_T, arquivos=[TESTE_JSON] + ["%s/%s" % (CAPTURAS, t) for t in telas])
        self.forja.definir_arquivo(REPO, HEAD_T, TESTE_JSON, json.dumps(dict({"resultado": "passou", "resumo": "Tudo funciona."}, **teste)))
        for t in telas:
            self.forja.definir_arquivo(REPO, HEAD_T, "%s/%s" % (CAPTURAS, t), PNG)
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR_T)
        self.passo(ClienteDeBusca())
        eventos = [s["evento"] for s in self.estado["demandas"]["saida"] if "evento" in s]
        self.estado["demandas"]["saida"] = []
        return eventos[-1] if eventos else None

    def entregar(self, cursor="4", pedir=None, **extra):
        self.pedir = pedir or getattr(self, "pedir", None) or PedirFalso()
        extra.setdefault("titulo", "Suporte por IA")
        extra.setdefault("publicacao", {"modo": "lote"})
        self.passo(ClienteDeBusca(pagina(retrato("entregue", **extra), cursor=cursor)), publicacao=PUBLICACAO, pedir_publicacao=self.pedir)
        eventos = [s["evento"] for s in self.estado["demandas"]["saida"] if "evento" in s]
        self.estado["demandas"]["saida"] = []
        return eventos


class TestesTesteDizContraOQue(BaseEntrega):
    def test_teste_sem_contra_e_invalido_e_refaz(self):
        self.assertIsNone(self.testar())
        self.assertEqual(len(self.despachos()), 2)  # refeito uma vez, como o teste.json torto

    def test_contra_desconhecido_tambem_e_invalido(self):
        self.assertIsNone(self.testar(contra="mais_ou_menos"))

    def test_resumo_ao_paulo_diz_contra_o_que_testou(self):
        evento = self.testar(contra="simulacao")
        self.assertEqual(evento["dados"]["resumo"], "Tudo funciona.\n\nTestado contra a simulação do back-end.")
        self.assertEqual(self.item()["teste"]["contra"], "simulacao")
        self.setUp()
        evento = self.testar(contra="real")
        self.assertEqual(evento["dados"]["resumo"], "Tudo funciona.\n\nTestado contra o back-end real.")

    def test_resumo_longo_e_cortado_para_caber_a_frase(self):
        evento = self.testar(contra="simulacao", resumo="x" * 3000)
        resumo = evento["dados"]["resumo"]
        self.assertTrue(resumo.endswith("Testado contra a simulação do back-end."))
        self.assertLessEqual(len(resumo), prompts.LIMITE_RESUMO_DO_TESTE)

    def test_publicar_torto_e_invalido(self):
        self.assertIsNone(self.testar(contra="real", publicar="talvez"))


class TestesNaoPublicaSozinho(BaseEntrega):
    def test_testado_so_contra_a_simulacao_trava_em_vez_de_publicar(self):
        self.testar(contra="simulacao")
        (evento,) = self.entregar()
        self.assertEqual((evento["tipo"], evento["dados"]), ("travada", {"motivo": SO_SIMULACAO, "url": None}))
        self.assertEqual(self.pedir.chamadas, [])
        self.assertEqual((self.item()["fase"], self.item()["travaDaPublicacao"]), ("esperando_paulo", True))
        # enquanto o Paulo não decide, nada
        self.assertEqual(self.entregar(cursor="5", espera="travada"), [])
        self.assertEqual(self.pedir.chamadas, [])

    def test_retomar_publica_mesmo_assim(self):
        self.testar(contra="simulacao")
        self.entregar()
        self.entregar(cursor="5", espera="travada")
        self.avancar(60)
        retomada = [{"id": "44444444-5555-4666-8777-888888888888", "tipo": "retomada", "origem": "paulo", "em": "2026-11-20T10:05:00Z", "dados": {}}]
        eventos = self.entregar(cursor="6", eventos=retomada)
        self.assertEqual([e["tipo"] for e in eventos], ["entregue"])
        self.assertEqual(len(self.pedir.chamadas), 1)
        self.assertEqual(self.item()["fase"], "entregando")

    def test_encerrar_nao_publica(self):
        self.testar(contra="simulacao")
        self.entregar()
        self.entregar(cursor="5", espera="travada")
        self.estado["demandas"]["saida"] = []
        self.entregar(cursor="6", encerrada="descartada")
        self.entregar(cursor="7", encerrada="descartada")
        self.assertEqual(self.pedir.chamadas, [])
        self.assertNotIn(ID, self.estado["demandas"]["itens"])

    def test_testado_contra_o_back_end_real_publica_sozinho(self):
        self.testar(contra="real")
        self.assertEqual([e["tipo"] for e in self.entregar()], ["entregue"])
        self.assertEqual(len(self.pedir.chamadas), 1)

    def test_teste_com_publicar_false_trava_com_o_motivo(self):
        self.testar(contra="real", publicar=False, motivoDeNaoPublicar="o back-end ainda não tem a rota da conversa")
        (evento,) = self.entregar()
        self.assertEqual(
            evento["dados"]["motivo"],
            "O teste pede para não publicar: o back-end ainda não tem a rota da conversa. Retomar publica mesmo assim; Encerrar não publica.",
        )
        self.assertEqual(self.pedir.chamadas, [])

    def test_relatorio_final_com_publicar_false_trava_a_demanda_sem_tela(self):
        etapas = [e for e in MODELO if e["marco"] not in ("desenho", "testada")]
        self.estado["fila"] = [{"id": "p1", "repo": REPO, "caminho": CAMINHO, "feature": "demanda-11111111", "demanda": ID, "estado": "concluido"}]
        self.forja.definir_arquivo(
            REPO,
            "main",
            ".fabrica/planejamento/demanda-11111111/relatorio-final.md",
            "# Relatório final\n\nEntregue: o passo 1.\n\npublicar: false\nmotivoDeNaoPublicar: passo 1 contra a porta de mentira\n",
        )
        (evento,) = self.entregar(etapas=etapas)
        self.assertEqual(
            evento["dados"]["motivo"],
            "O relatório final pede para não publicar: passo 1 contra a porta de mentira. Retomar publica mesmo assim; Encerrar não publica.",
        )
        self.assertEqual(self.pedir.chamadas, [])

    def test_relatorio_final_sem_a_marca_nao_segura(self):
        etapas = [e for e in MODELO if e["marco"] not in ("desenho", "testada")]
        self.estado["fila"] = [{"id": "p1", "repo": REPO, "caminho": CAMINHO, "feature": "demanda-11111111", "demanda": ID, "estado": "concluido"}]
        self.forja.definir_arquivo(REPO, "main", ".fabrica/planejamento/demanda-11111111/relatorio-final.md", "# Relatório\n\nNão há o que publicar: false alarme.\n")
        self.assertEqual([e["tipo"] for e in self.entregar(etapas=etapas)], ["entregue"])

    def test_copia_do_contrato_que_nao_bate_com_a_origem_trava_antes_de_publicar(self):
        self.forja.definir_arquivo(REPO, "main", demandas.CAMINHO_CONFIG_DO_REPO, json.dumps({"contratosExternos": [CONTRATO_LISTA]}))
        self.forja.definir_arquivo(BACK, "main", OPENAPI, YAML_DO_BACK)
        self.forja.definir_arquivo(REPO, "main", LISTA, lista(*ENDERECOS, "GET /v1/suporte/conversa"))
        self.testar(contra="real")
        (evento,) = self.entregar()
        self.assertEqual(
            evento["dados"]["motivo"],
            "O back-end mudou: %s: estes endereços não existem mais em %s: GET /v1/suporte/conversa. Retomar publica mesmo assim; Encerrar não publica."
            % (LISTA, BACK),
        )
        self.assertEqual(self.pedir.chamadas, [])
        # com a cópia certa, publica
        self.setUp()
        self.forja.definir_arquivo(REPO, "main", demandas.CAMINHO_CONFIG_DO_REPO, json.dumps({"contratosExternos": [CONTRATO_LISTA]}))
        self.forja.definir_arquivo(BACK, "main", OPENAPI, YAML_DO_BACK)
        self.forja.definir_arquivo(REPO, "main", LISTA, lista(*ENDERECOS))
        self.testar(contra="real")
        self.assertEqual([e["tipo"] for e in self.entregar()], ["entregue"])


class TestesCorrecaoNaoMexeNoContrato(BaseEntrega):
    def preparar(self, conteudo):
        self.forja.definir_arquivo(REPO, "main", demandas.CAMINHO_CONFIG_DO_REPO, json.dumps({"contratosExternos": [CONTRATO_LISTA]}))
        self.forja.definir_arquivo(BACK, "main", OPENAPI, YAML_DO_BACK)
        self.forja.definir_arquivo(REPO, HEAD_C, LISTA, conteudo)
        self.testar(contra="real", resultado="falhou", resumo="O suporte não responde.")
        self.passo(ClienteDeBusca(pagina(retrato("desenvolvida"), cursor="3")))
        run_id = self.item()["runId"]
        self.forja.definir_pr(PR_C, head_sha=HEAD_C, branch="fabrica/correcao-11111111", arquivos=["src/x.tsx", LISTA])
        self.forja.definir_ci(REPO, HEAD_C, "verde")
        self.motor.definir_run(run_id, estado="succeeded", prUrl=PR_C)
        self.passo(ClienteDeBusca())
        return [s["evento"] for s in self.estado["demandas"]["saida"] if "evento" in s]

    def test_correcao_que_edita_a_copia_a_mao_e_recusada(self):
        eventos = self.preparar(lista(*ENDERECOS, "GET /v1/suporte/conversa"))
        self.assertEqual(eventos[-1]["tipo"], "travada")
        self.assertEqual(
            eventos[-1]["dados"]["motivo"],
            "o PR da correção muda a cópia de um contrato externo e ela não bate com a origem: %s: estes endereços não existem mais em %s: GET /v1/suporte/conversa"
            % (LISTA, BACK),
        )
        self.assertEqual(self.forja.merges, [])

    def test_correcao_que_traz_a_copia_fiel_passa(self):
        self.preparar(lista(*ENDERECOS))
        self.assertEqual(self.forja.merges, [(PR_C, HEAD_C)])


# ---------------------------------------------------------------- 3. despachante: config, primeira raia e seeds


CONFIG_COM_CONTRATO = dict(copy.deepcopy(td.CONFIG), contratosExternos=[{"arquivo": LISTA, "repo": BACK, "caminho": OPENAPI, "modo": "enderecos"}])


class TestesDespachanteContratos(td.Base):
    def setUp(self):
        super().setUp()
        self.config_padrao = CONFIG_COM_CONTRATO
        self.forja.definir_arquivo(BACK, "main", OPENAPI, YAML_DO_BACK)

    def copia(self, *linhas, ref="main"):
        self.forja.definir_arquivo(td.REPO, ref, LISTA, lista(*linhas))

    def decisoes(self):
        return [d for d in self.estado().get("decisoes", []) if d.get("tipo") == "contratos"]

    def test_config_valida_a_lista_como_as_outras_chaves(self):
        torta = dict(copy.deepcopy(td.CONFIG), contratosExternos=[{"arquivo": LISTA, "repo": BACK, "caminho": OPENAPI, "modo": "x"}])
        with self.assertRaises(despachante.ConfigInvalida) as ctx:
            self.novo(config=torta)
        self.assertIn("contratosExternos[0].modo", str(ctx.exception))
        self.assertEqual(self.novo(config=copy.deepcopy(td.CONFIG)).config["contratosExternos"], [])

    def test_contrato_entra_nos_protegidos(self):
        self.assertIn(LISTA, self.novo()._protegidos())

    def test_copia_divergente_segura_a_primeira_raia_e_abre_uma_decisao(self):
        self.copia(*ENDERECOS, "GET /v1/suporte/conversa")
        d = self.preparar_raia()
        d.ciclo()
        self.assertEqual(self.planos_despachados(), [])
        (decisao,) = self.decisoes()
        (titulo, corpo) = self.forja.decisoes[-1]
        self.assertIn("contrato", titulo)
        self.assertIn("GET /v1/suporte/conversa", corpo)
        self.assertIn("o back-end mudou", corpo)
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "planejada")
        # a cópia consertada solta o despacho e fecha a decisão
        self.copia(*ENDERECOS)
        d.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)
        self.assertEqual(self.decisoes(), [])

    def test_resposta_do_paulo_solta_o_despacho_mesmo_com_a_copia_divergente(self):
        self.copia(*ENDERECOS, "GET /v1/suporte/conversa")
        d = self.preparar_raia()
        (decisao,) = self.decisoes()
        self.forja.definir_decisao(decisao["url"], fechada=True, ultimo_comentario="Pode seguir, eu peço o endereço ao back-end.")
        d.ciclo()
        d.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)

    def test_copia_certa_despacha_sem_decisao(self):
        self.copia(*ENDERECOS)
        self.preparar_raia()
        self.assertEqual((len(self.planos_despachados()), self.decisoes()), (1, []))

    def test_seed_que_muda_a_copia_so_mergeia_se_bater_com_a_origem(self):
        for linhas, mergeia in ((ENDERECOS, True), (ENDERECOS + ["GET /v1/suporte/conversa"], False)):
            with self.subTest(mergeia=mergeia):
                self.setUp()
                self.copia(*ENDERECOS)
                d = self.preparar_raia()
                self.abrir_pr(td.H1, arquivos=("src/a/x.ts", LISTA))
                self.copia(*linhas, ref=td.H1)
                d.ciclo()
                self.terminar_revisao(td.H1)
                d.ciclo()
                if mergeia:
                    self.assertEqual(self.forja.merges, [(td.PR, td.H1)])
                else:
                    self.assertEqual(self.forja.merges, [])
                    seed = self.estado()["seeds"]["s-1"]
                    self.assertEqual(seed["estado"], "bloqueada_humano")
                    self.assertIn("não bate com a origem", seed["motivoHumano"])
                    self.assertIn("GET /v1/suporte/conversa", seed["motivoHumano"])


# ---------------------------------------------------------------- 3. instalador


class TestesInstalarContratos(ti.Base):
    def test_config_do_projeto_com_contratos_tortos_e_recusada(self):
        ti.escrever(self.destino / ".fabrica" / "config.json", json.dumps({"contratosExternos": [{"arquivo": LISTA}]}))
        with self.assertRaises(ValueError) as ctx:
            self.instalar()
        self.assertIn("contratosExternos[0].repo", str(ctx.exception))

    def test_config_do_projeto_com_contratos_validos_passa(self):
        ti.escrever(self.destino / ".fabrica" / "config.json", json.dumps({"contratosExternos": [CONTRATO_LISTA]}))
        self.instalar()


# ---------------------------------------------------------------- 3. pedido de publicação por seed


class TestesPublicacaoPorSeed(tc.Base):
    def test_seed_mergeada_com_a_copia_divergente_nao_pede_a_publicacao(self):
        self.forja.definir_arquivo(tc.REPO, "main", ".fabrica/config.json", json.dumps({"contratosExternos": [CONTRATO_LISTA]}))
        self.forja.definir_arquivo(BACK, "main", OPENAPI, YAML_DO_BACK)
        self.forja.definir_arquivo(tc.REPO, "main", LISTA, lista(*ENDERECOS, "GET /v1/suporte/conversa"))
        pedir = tc.PedirFalso()
        id_ = self.publicar("login", ["src/login/**"])
        c = self.novo(central=tc.PUBLICACAO, enviar=tc.EnviarFalso(), pedir_publicacao=pedir)
        c.ciclo()
        estado = self.estado_do_plano(id_)
        estado["seeds"] = {"a": {"estado": "em_andamento"}}
        self.gravar_estado_do_plano(id_, estado)
        c.ciclo()
        estado["seeds"] = {"a": {"estado": "mergeada"}}
        self.gravar_estado_do_plano(id_, estado)
        c.ciclo()
        self.assertEqual(pedir.chamadas, [])
        avisos = [a for a in self.avisos() if a.startswith("Publicação:")]
        self.assertEqual(len(avisos), 1)
        self.assertIn("GET /v1/suporte/conversa", avisos[0])
        # a cópia consertada pede a publicação no ciclo seguinte
        self.forja.definir_arquivo(tc.REPO, "main", LISTA, lista(*ENDERECOS))
        c.ciclo()
        self.assertEqual(len(pedir.chamadas), 1)


if __name__ == "__main__":
    unittest.main()
