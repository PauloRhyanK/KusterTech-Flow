import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import gates  # noqa: E402

HEAD = "abc123"
OUTRO = "def456"


def verificacao_ok(sha=HEAD, codigo=0):
    return {"sha": sha, "codigo": codigo, "saida": "ok"}


def veredito_ok(sha=HEAD, resultado="aprovado", achados=None):
    return {"sha": sha, "resultado": resultado, "achados": achados or []}


def avaliar(**sobrescritas):
    args = {
        "head_sha": HEAD,
        "ci": "verde",
        "verificacao": verificacao_ok(),
        "veredito": veredito_ok(),
        "arquivos": ["src/a.ts"],
        "protegidos": ["**/migrations/**"],
    }
    args.update(sobrescritas)
    return gates.avaliar_merge(**args)


class TocaProtegidosTest(unittest.TestCase):
    def test_devolve_so_os_que_casam_na_ordem_de_entrada(self):
        arquivos = ["z/migrations/1.sql", "src/a.ts", "a/migrations/2.sql", "pnpm-lock.yaml"]
        self.assertEqual(
            gates.toca_protegidos(arquivos, ["**/migrations/**", "pnpm-lock.yaml"]),
            ["z/migrations/1.sql", "a/migrations/2.sql", "pnpm-lock.yaml"],
        )

    def test_nada_protegido_devolve_vazio(self):
        self.assertEqual(gates.toca_protegidos(["src/a.ts"], ["**/migrations/**"]), [])
        self.assertEqual(gates.toca_protegidos([], ["**/migrations/**"]), [])
        self.assertEqual(gates.toca_protegidos(["src/a.ts"], []), [])

    def test_arquivo_que_casa_varios_globs_aparece_uma_vez(self):
        self.assertEqual(
            gates.toca_protegidos(["a/migrations/1.sql"], ["a/", "**/migrations/**"]),
            ["a/migrations/1.sql"],
        )

    def test_entrada_que_nao_e_texto_e_ignorada_aqui_e_avaliar_merge_valida_antes(self):
        self.assertEqual(gates.toca_protegidos([None, 3, "a/migrations/1.sql"], ["**/migrations/**"]), ["a/migrations/1.sql"])
        self.assertEqual(avaliar(arquivos=[None, 3, "a/migrations/1.sql"])["decisao"], "humano")


class AvaliarMergeTest(unittest.TestCase):
    def test_tudo_verde_mergeia(self):
        r = avaliar()
        self.assertEqual(r["decisao"], "mergear")
        self.assertEqual(r["faltando"], [])
        self.assertEqual(r["motivos"], [])

    def test_sem_ci_vai_para_humano(self):
        r = avaliar(ci="ausente")
        self.assertEqual(r["decisao"], "humano")
        self.assertTrue(any("sem CI" in m for m in r["motivos"]))

    def test_ci_opcional_trata_ausente_como_verde_e_mergeia(self):
        self.assertEqual(avaliar(ci="ausente", ci_opcional=True)["decisao"], "mergear")

    def test_ci_opcional_nao_afrouxa_os_outros_gates(self):
        self.assertEqual(avaliar(ci="ausente", ci_opcional=True, veredito=None)["decisao"], "aguardar")
        self.assertEqual(avaliar(ci="ausente", ci_opcional=True, verificacao=None)["decisao"], "aguardar")
        self.assertEqual(avaliar(ci="ausente", ci_opcional=True, verificacao=verificacao_ok(codigo=1))["decisao"], "corrigir")
        self.assertEqual(avaliar(ci="ausente", ci_opcional=True, arquivos=["db/migrations/1.sql"])["decisao"], "humano")

    def test_ci_opcional_respeita_ci_que_existe(self):
        self.assertEqual(avaliar(ci="vermelho", ci_opcional=True)["decisao"], "corrigir")
        self.assertEqual(avaliar(ci="pendente", ci_opcional=True)["decisao"], "aguardar")

    def test_ci_opcional_so_vale_com_true(self):
        for valor in (False, None, 1, "true"):
            self.assertEqual(avaliar(ci="ausente", ci_opcional=valor)["decisao"], "humano", repr(valor))

    def test_sem_ci_prevalece_sobre_faltando_e_vermelho(self):
        r = avaliar(ci="ausente", veredito=None, verificacao=verificacao_ok(codigo=1))
        self.assertEqual(r["decisao"], "humano")

    def test_ci_pendente_aguarda(self):
        r = avaliar(ci="pendente")
        self.assertEqual(r["decisao"], "aguardar")
        self.assertEqual(r["faltando"], [])
        self.assertTrue(r["motivos"])

    def test_pendente_prevalece_sobre_correcoes_e_protegidos(self):
        r = avaliar(
            ci="pendente",
            veredito=veredito_ok(resultado="correcoes"),
            verificacao=verificacao_ok(codigo=2),
            arquivos=["a/migrations/1.sql"],
        )
        self.assertEqual(r["decisao"], "aguardar")

    def test_veredito_de_outro_sha_conta_como_faltando(self):
        r = avaliar(veredito=veredito_ok(sha=OUTRO))
        self.assertEqual(r["decisao"], "aguardar")
        self.assertEqual(r["faltando"], ["revisao"])

    def test_veredito_ausente_conta_como_faltando(self):
        r = avaliar(veredito=None)
        self.assertEqual(r["decisao"], "aguardar")
        self.assertEqual(r["faltando"], ["revisao"])

    def test_verificacao_ausente_conta_como_faltando(self):
        r = avaliar(verificacao=None)
        self.assertEqual(r["decisao"], "aguardar")
        self.assertEqual(r["faltando"], ["verificacao"])

    def test_verificacao_de_outro_sha_conta_como_faltando(self):
        r = avaliar(verificacao=verificacao_ok(sha=OUTRO))
        self.assertEqual(r["decisao"], "aguardar")
        self.assertEqual(r["faltando"], ["verificacao"])

    def test_os_dois_faltando(self):
        r = avaliar(verificacao=None, veredito=None)
        self.assertEqual(r["decisao"], "aguardar")
        self.assertEqual(sorted(r["faltando"]), ["revisao", "verificacao"])

    def test_faltando_prevalece_sobre_ci_vermelho_e_protegidos(self):
        r = avaliar(ci="vermelho", veredito=None, arquivos=["a/migrations/1.sql"])
        self.assertEqual(r["decisao"], "aguardar")
        self.assertEqual(r["faltando"], ["revisao"])

    def test_ci_vermelho_sozinho_corrige(self):
        r = avaliar(ci="vermelho")
        self.assertEqual(r["decisao"], "corrigir")
        self.assertEqual(len(r["motivos"]), 1)
        self.assertEqual(r["faltando"], [])

    def test_ci_vermelho_e_veredito_correcoes_juntam_motivos(self):
        r = avaliar(
            ci="vermelho",
            veredito=veredito_ok(resultado="correcoes", achados=[{"arquivo": "src/a.ts", "motivo": "falta teste"}]),
        )
        self.assertEqual(r["decisao"], "corrigir")
        self.assertEqual(len(r["motivos"]), 2)
        self.assertTrue(any("src/a.ts" in m and "falta teste" in m for m in r["motivos"]))

    def test_veredito_correcoes_sozinho_corrige(self):
        r = avaliar(veredito=veredito_ok(resultado="correcoes"))
        self.assertEqual(r["decisao"], "corrigir")
        self.assertEqual(len(r["motivos"]), 1)

    def test_verificacao_codigo_1_corrige(self):
        r = avaliar(verificacao=verificacao_ok(codigo=1))
        self.assertEqual(r["decisao"], "corrigir")
        self.assertEqual(len(r["motivos"]), 1)

    def test_tres_motivos_de_correcao_juntos(self):
        r = avaliar(ci="vermelho", verificacao=verificacao_ok(codigo=1), veredito=veredito_ok(resultado="correcoes"))
        self.assertEqual(r["decisao"], "corrigir")
        self.assertEqual(len(r["motivos"]), 3)

    def test_protegido_com_tudo_verde_vai_para_humano(self):
        r = avaliar(arquivos=["prisma/migrations/1/migration.sql"], protegidos=["**/migrations/**"])
        self.assertEqual(r["decisao"], "humano")
        self.assertTrue(any("prisma/migrations/1/migration.sql" in m for m in r["motivos"]))

    def test_protegido_nao_salva_gate_vermelho(self):
        r = avaliar(ci="vermelho", arquivos=["prisma/migrations/1/migration.sql"], protegidos=["**/migrations/**"])
        self.assertEqual(r["decisao"], "corrigir")

    def test_arquivo_comum_com_protegidos_mergeia(self):
        r = avaliar(arquivos=["src/a.ts"], protegidos=["**/migrations/**"])
        self.assertEqual(r["decisao"], "mergear")

    def test_sem_arquivos_nem_protegidos_mergeia(self):
        self.assertEqual(avaliar(arquivos=[], protegidos=[])["decisao"], "mergear")

    def test_ci_desconhecido_nunca_mergeia(self):
        for ci in ("quebrado", 3, "", [], {}):
            with self.subTest(ci=ci):
                self.assertEqual(avaliar(ci=ci)["decisao"], "humano")

    def test_ci_none_ainda_nao_lido_aguarda(self):
        r = avaliar(ci=None)
        self.assertEqual(r["decisao"], "aguardar")
        self.assertEqual(r["motivos"], ["CI ainda não lido"])
        self.assertEqual(r["faltando"], [])

    def test_ci_none_nao_vira_humano_nem_mergeia_mesmo_com_tudo_o_mais_ok(self):
        r = avaliar(ci=None, arquivos=["a/migrations/1.sql"])
        self.assertEqual(r["decisao"], "aguardar")

    def test_verificacao_com_codigo_negativo_corrige(self):
        for codigo in (-9, -1, 137):
            with self.subTest(codigo=codigo):
                r = avaliar(verificacao=verificacao_ok(codigo=codigo))
                self.assertEqual(r["decisao"], "corrigir")
                self.assertEqual(len(r["motivos"]), 1)

    def test_head_sha_invalido_nunca_mergeia(self):
        for head in (None, "", 0, 123, [], b"abc"):
            for item_sha in (None, "", head, 0):
                with self.subTest(head=head, item_sha=item_sha):
                    v = {"sha": item_sha, "resultado": "aprovado", "achados": []}
                    c = {"sha": item_sha, "codigo": 0, "saida": ""}
                    r = avaliar(head_sha=head, veredito=v, verificacao=c)
                    self.assertEqual(r["decisao"], "aguardar")
                    self.assertEqual(sorted(r["faltando"]), ["revisao", "verificacao"])

    def test_head_sha_invalido_com_itens_sem_chave_sha_nao_mergeia(self):
        for head in (None, ""):
            with self.subTest(head=head):
                r = avaliar(
                    head_sha=head,
                    veredito={"resultado": "aprovado"},
                    verificacao={"codigo": 0},
                )
                self.assertEqual(r["decisao"], "aguardar")
                self.assertEqual(sorted(r["faltando"]), ["revisao", "verificacao"])

    def test_sha_do_item_que_nao_e_texto_conta_como_faltando(self):
        for sha in (None, "", 0, 123, [HEAD], {"x": HEAD}):
            with self.subTest(sha=sha):
                self.assertEqual(avaliar(veredito=veredito_ok(sha=sha))["faltando"], ["revisao"])
                self.assertEqual(avaliar(verificacao=verificacao_ok(sha=sha))["faltando"], ["verificacao"])

    def test_listas_malformadas_vao_para_humano(self):
        malformadas = [
            {"arquivos": "prisma/migrations/1/m.sql"},
            {"protegidos": "**/migrations/**"},
            {"arquivos": None},
            {"protegidos": None},
            {"arquivos": ["src/a.ts", None]},
            {"arquivos": ["src/a.ts", 3]},
            {"arquivos": [{"filename": "prisma/migrations/1/m.sql"}]},
            {"protegidos": ["**/migrations/**", None]},
            {"protegidos": [["**/migrations/**"]]},
            {"arquivos": ("src/a.ts",)},
            {"protegidos": ("**/migrations/**",)},
        ]
        for entrada in malformadas:
            with self.subTest(entrada=entrada):
                r = avaliar(**entrada)
                self.assertEqual(r["decisao"], "humano")
                self.assertEqual(r["motivos"], ["lista de arquivos/protegidos inválida"])

    def test_listas_malformadas_nao_antecipam_as_regras_1_a_3(self):
        ruins = {"arquivos": "x", "protegidos": None}
        self.assertEqual(avaliar(ci="ausente", **ruins)["decisao"], "humano")
        self.assertEqual(avaliar(ci="ausente", **ruins)["motivos"], ["repositório sem CI"])
        self.assertEqual(avaliar(ci="pendente", **ruins)["decisao"], "aguardar")
        self.assertEqual(avaliar(veredito=None, **ruins)["decisao"], "aguardar")
        self.assertEqual(avaliar(ci="vermelho", **ruins)["decisao"], "corrigir")
        self.assertEqual(avaliar(verificacao=verificacao_ok(codigo=1), **ruins)["decisao"], "corrigir")

    def test_veredito_malformado_conta_como_faltando(self):
        malformados = [
            {},
            {"sha": HEAD},
            {"resultado": "aprovado"},
            {"sha": HEAD, "resultado": "talvez"},
            {"sha": HEAD, "resultado": None},
            {"sha": HEAD, "resultado": ["aprovado"]},
            "aprovado",
            [],
            42,
        ]
        for v in malformados:
            with self.subTest(veredito=v):
                r = avaliar(veredito=v)
                self.assertEqual(r["decisao"], "aguardar")
                self.assertEqual(r["faltando"], ["revisao"])

    def test_verificacao_malformada_conta_como_faltando(self):
        malformadas = [
            {},
            {"sha": HEAD},
            {"codigo": 0},
            {"sha": HEAD, "codigo": "0"},
            {"sha": HEAD, "codigo": None},
            {"sha": HEAD, "codigo": True},
            "ok",
            [],
            42,
        ]
        for v in malformadas:
            with self.subTest(verificacao=v):
                r = avaliar(verificacao=v)
                self.assertEqual(r["decisao"], "aguardar")
                self.assertEqual(r["faltando"], ["verificacao"])

    def test_veredito_sem_achados_ou_com_achados_malformados_nao_quebra(self):
        for achados in ([{"arquivo": "x"}, "texto", None, 3], None, "x"):
            with self.subTest(achados=achados):
                v = {"sha": HEAD, "resultado": "correcoes", "achados": achados}
                r = avaliar(veredito=v)
                self.assertEqual(r["decisao"], "corrigir")
        v = {"sha": HEAD, "resultado": "correcoes"}
        self.assertEqual(avaliar(veredito=v)["decisao"], "corrigir")
        self.assertEqual(avaliar(veredito={"sha": HEAD, "resultado": "aprovado"})["decisao"], "mergear")

    def test_verificacao_sem_saida_e_aceita(self):
        self.assertEqual(avaliar(verificacao={"sha": HEAD, "codigo": 0})["decisao"], "mergear")

    def test_resultado_tem_sempre_as_tres_chaves_e_listas_novas(self):
        r = avaliar()
        self.assertEqual(set(r), {"decisao", "faltando", "motivos"})
        self.assertIsInstance(r["faltando"], list)
        self.assertIsInstance(r["motivos"], list)

    def test_nao_muda_as_entradas(self):
        arquivos = ["a/migrations/1.sql"]
        protegidos = ["**/migrations/**"]
        avaliar(arquivos=arquivos, protegidos=protegidos)
        self.assertEqual(arquivos, ["a/migrations/1.sql"])
        self.assertEqual(protegidos, ["**/migrations/**"])



class CiAusenteRecenteTest(unittest.TestCase):
    """F1: CI "ausente" logo depois de um head novo é transitório (os checks ainda não foram criados)."""

    def test_ausente_recente_aguarda_em_vez_de_humano(self):
        r = avaliar(ci="ausente", ci_ausente_recente=True)
        self.assertEqual(r["decisao"], "aguardar")
        self.assertEqual(r["faltando"], [])
        self.assertTrue(any("CI ausente" in m for m in r["motivos"]))

    def test_ausente_recente_com_gate_faltando_aguarda_e_lista_o_que_falta(self):
        r = avaliar(ci="ausente", ci_ausente_recente=True, veredito=None, verificacao=None)
        self.assertEqual(r["decisao"], "aguardar")
        self.assertEqual(r["faltando"], ["revisao", "verificacao"])

    def test_ausente_sem_a_janela_continua_humano(self):
        for kw in ({}, {"ci_ausente_recente": False}):
            with self.subTest(kw=kw):
                r = avaliar(ci="ausente", **kw)
                self.assertEqual((r["decisao"], r["motivos"]), ("humano", ["repositório sem CI"]))

    def test_janela_nao_muda_os_outros_estados_de_ci(self):
        self.assertEqual(avaliar(ci="verde", ci_ausente_recente=True)["decisao"], "mergear")
        self.assertEqual(avaliar(ci="vermelho", ci_ausente_recente=True)["decisao"], "corrigir")
        self.assertEqual(avaliar(ci="pendente", ci_ausente_recente=True)["decisao"], "aguardar")

if __name__ == "__main__":
    unittest.main()
