import unittest

import baseline


class TestFracao(unittest.TestCase):
    def test_sem_amostra_fica_indisponivel_nao_zero(self):
        self.assertIsNone(baseline.fracao(0, 0))

    def test_arredonda_em_quatro_casas(self):
        self.assertEqual(baseline.fracao(14, 27), 0.5185)


class TestDemandas(unittest.TestCase):
    def test_separa_no_ar_encerradas_sem_ar_e_abertas(self):
        demandas = [
            {"id": "a", "noArEm": "2026-11-28T10:00:00Z", "encerrada": "no_ar"},
            {"id": "b", "noArEm": None, "encerrada": "cancelada"},
            {"id": "c", "noArEm": None, "encerrada": None},
        ]
        r = baseline.resumo_de_demandas(demandas, [])
        self.assertEqual(r["criadas"], 3)
        self.assertEqual(r["noAr"], 1)
        self.assertEqual(r["encerradasSemAr"], 1)
        self.assertEqual(r["abertas"], 1)
        self.assertEqual(r["taxaNoAr"], 0.3333)

    def test_conta_travas_e_testes_por_resultado(self):
        eventos = [
            {"demandaId": "a", "tipo": "travada", "resultado": None},
            {"demandaId": "a", "tipo": "travada", "resultado": None},
            {"demandaId": "a", "tipo": "teste", "resultado": "falhou"},
            {"demandaId": "a", "tipo": "teste", "resultado": "passou"},
            {"demandaId": "b", "tipo": "teste", "resultado": "passou"},
        ]
        r = baseline.resumo_de_demandas([{"id": "a"}, {"id": "b"}], eventos)
        self.assertEqual(r["travas"], 2)
        self.assertEqual(r["demandasComTrava"], 1)
        self.assertEqual(r["testes"], {"total": 3, "falharam": 1})
        self.assertEqual(r["testesDePrimeira"], {"demandas": 2, "passaram": 1, "taxa": 0.5})

    def test_eventos_de_demanda_fora_da_coorte_sao_ignorados(self):
        eventos = [{"demandaId": "x", "tipo": "travada", "resultado": None}]
        r = baseline.resumo_de_demandas([{"id": "a"}], eventos)
        self.assertEqual(r["travas"], 0)

    def test_coorte_vazia_nao_inventa_taxas(self):
        r = baseline.resumo_de_demandas([], [])
        self.assertIsNone(r["taxaNoAr"])
        self.assertIsNone(r["testesDePrimeira"]["taxa"])


class TestCusto(unittest.TestCase):
    def test_soma_por_tipo_e_informa_cobertura(self):
        intervalos = [
            {"tipo": "orquestrador", "papel": "orquestrador", "custoUsd": "2.5"},
            {"tipo": "orquestrador", "papel": "orquestrador", "custoUsd": None},
            {"tipo": "raia", "papel": "frontend", "custoUsd": "1.25"},
        ]
        r = baseline.resumo_de_custo(intervalos)
        self.assertEqual(r["totalUsd"], 3.75)
        self.assertEqual(r["porTipo"]["orquestrador"], {"execucoes": 2, "comCusto": 1, "usd": 2.5})
        self.assertEqual(r["cobertura"], 0.6667)
        self.assertEqual(r["porPapel"]["frontend"], {"execucoes": 1, "comCusto": 1, "usd": 1.25})

    def test_sem_intervalos_total_indisponivel(self):
        self.assertIsNone(baseline.resumo_de_custo([])["totalUsd"])


class TestPlanos(unittest.TestCase):
    def test_conta_seeds_com_fixer_e_replanejamentos(self):
        estados = [
            {
                "raias": {"r1": {"replanejamentos": 2}, "r2": {}},
                "seeds": {"s1": {"fixersUsados": 1}, "s2": {"fixerUsado": True}, "s3": {}},
            },
            {"raias": {"r3": {"replanejamentos": 1}}, "seeds": {"s4": {"fixersUsados": 0}}},
        ]
        r = baseline.resumo_de_planos(estados)
        self.assertEqual(r["planos"], 2)
        self.assertEqual(r["raias"], 3)
        self.assertEqual(r["replanejamentos"], 3)
        self.assertEqual(r["seeds"], 4)
        self.assertEqual(r["seedsComFixer"], 2)
        self.assertEqual(r["seedsSemFixer"], 0.5)

    def test_estado_malformado_nao_quebra(self):
        r = baseline.resumo_de_planos([{"raias": None, "seeds": []}])
        self.assertEqual(r["seeds"], 0)
        self.assertIsNone(r["seedsSemFixer"])


class TestRelatorio(unittest.TestCase):
    def test_markdown_mostra_indisponivel_e_janela(self):
        dados = {
            "janela": {"desde": "2026-11-27T03:00:00Z", "ate": "2026-12-27T03:00:00Z"},
            "demandas": baseline.resumo_de_demandas([], []),
            "custo": baseline.resumo_de_custo([]),
            "planos": baseline.resumo_de_planos([]),
        }
        texto = baseline.markdown(dados)
        self.assertIn("2026-11-27T03:00:00Z", texto)
        self.assertIn("indisponível", texto)


if __name__ == "__main__":
    unittest.main()
