import copy
import json
import pathlib
import subprocess
import tempfile
import unittest

import globs
import raias

RAIZ = pathlib.Path(__file__).resolve().parent


def plano_referencia():
    return {
        "versao": 1,
        "faseAtual": "fundacao",
        "fases": [
            {"id": "fundacao", "raias": ["fundacao"]},
            {"id": "nucleo", "raias": ["back-clientes", "front-clientes"]},
        ],
        "raias": [
            {
                "id": "fundacao",
                "papel": "arquiteto",
                "planoSeeds": "pl-0000",
                "dependeDe": [],
                "arquivos": ["prisma/"],
                "verificacao": "pnpm typecheck",
                "criteriosAceite": ["Esquema base criado"],
            },
            {
                "id": "back-clientes",
                "papel": "backend",
                "planoSeeds": "pl-1a2b",
                "dependeDe": ["fundacao"],
                "arquivos": ["src/modules/clientes/"],
                "verificacao": "pnpm test",
                "criteriosAceite": ["Cadastrar cliente persiste e lista"],
            },
            {
                "id": "front-clientes",
                "papel": "frontend",
                "planoSeeds": "pl-3c4d",
                "dependeDe": ["fundacao"],
                "arquivos": ["src/app/clientes/"],
                "verificacao": "pnpm test",
                "criteriosAceite": ["Tela de clientes lista os cadastrados"],
            },
        ],
    }


def raia_de(plano, id_):
    return next(r for r in plano["raias"] if r["id"] == id_)


class TestesGlobs(unittest.TestCase):
    def test_duplo_asterisco_casa_qualquer_sequencia(self):
        self.assertTrue(globs.casa_glob("src/a/b.ts", "src/**"))

    def test_asterisco_simples_nao_atravessa_barra(self):
        self.assertFalse(globs.casa_glob("src/a/b.ts", "src/*.ts"))
        self.assertTrue(globs.casa_glob("src/b.ts", "src/*.ts"))

    def test_glob_terminado_em_barra_casa_o_prefixo(self):
        self.assertTrue(globs.casa_glob("src/a/b.ts", "src/a/"))
        self.assertFalse(globs.casa_glob("src/ab/b.ts", "src/a/"))

    def test_asterisco_dentro_do_segmento(self):
        self.assertTrue(globs.casa_glob(".env.local", ".env*"))

    def test_interrogacao_casa_um_caractere_fora_de_barra(self):
        self.assertTrue(globs.casa_glob("a.ts", "?.ts"))
        self.assertFalse(globs.casa_glob("ab.ts", "?.ts"))
        self.assertFalse(globs.casa_glob("a/b", "a?b"))

    def test_caracteres_especiais_de_regex_sao_literais(self):
        self.assertTrue(globs.casa_glob("a.ts", "a.ts"))
        self.assertFalse(globs.casa_glob("axts", "a.ts"))

    def test_sobreposicao_verdadeira(self):
        self.assertTrue(globs.globs_sobrepoem("src/clientes/", "src/clientes/**"))
        self.assertTrue(globs.globs_sobrepoem("src/**", "src/a/x.ts"))
        self.assertTrue(globs.globs_sobrepoem("prisma/schema.prisma", "prisma/"))
        self.assertTrue(globs.globs_sobrepoem("src/x/", "src/x/y.ts"))

    def test_sobreposicao_falsa(self):
        self.assertFalse(globs.globs_sobrepoem("src/clientes/", "src/projetos/"))
        self.assertFalse(globs.globs_sobrepoem("a.ts", "b.ts"))


class TestesPlano(unittest.TestCase):
    def assertErro(self, plano, trecho):
        erros = raias.validar_plano(plano)
        self.assertTrue(
            any(trecho in e for e in erros),
            f"nenhum erro contém {trecho!r}: {erros}",
        )
        return erros

    def test_papeis_de_raia(self):
        self.assertEqual(
            raias.PAPEIS_DE_RAIA,
            ("arquiteto", "ux-engineer", "backend", "frontend", "qa"),
        )

    def test_plano_de_referencia_e_valido(self):
        self.assertEqual(raias.validar_plano(plano_referencia()), [])

    def test_id_duplicado(self):
        plano = plano_referencia()
        plano["raias"].append(copy.deepcopy(raia_de(plano, "back-clientes")))
        self.assertErro(plano, "duplicad")

    def test_raia_em_nenhuma_fase(self):
        plano = plano_referencia()
        plano["fases"][1]["raias"].remove("front-clientes")
        self.assertErro(plano, "nenhuma fase")

    def test_raia_em_duas_fases(self):
        plano = plano_referencia()
        plano["fases"][0]["raias"].append("back-clientes")
        self.assertErro(plano, "mais de uma fase")

    def test_papel_revisor_e_rejeitado(self):
        plano = plano_referencia()
        raia_de(plano, "back-clientes")["papel"] = "revisor"
        self.assertErro(plano, "papel")

    def test_plano_seeds_fora_do_formato(self):
        for invalido in ("pl-XYZ1", "pl-1a2", "pl-1a2b3", "1a2b", "PL-1A2B", ""):
            plano = plano_referencia()
            raia_de(plano, "back-clientes")["planoSeeds"] = invalido
            self.assertErro(plano, "planoSeeds")

    def test_depende_de_inexistente(self):
        plano = plano_referencia()
        raia_de(plano, "back-clientes")["dependeDe"] = ["fantasma"]
        self.assertErro(plano, "inexistente")

    def test_ciclo(self):
        plano = plano_referencia()
        raia_de(plano, "back-clientes")["dependeDe"] = ["front-clientes"]
        raia_de(plano, "front-clientes")["dependeDe"] = ["back-clientes"]
        self.assertErro(plano, "ciclo")

    def test_dependencia_de_fase_posterior(self):
        plano = plano_referencia()
        raia_de(plano, "fundacao")["dependeDe"] = ["back-clientes"]
        self.assertErro(plano, "fase posterior")

    def test_criterios_de_aceite_vazios(self):
        plano = plano_referencia()
        raia_de(plano, "back-clientes")["criteriosAceite"] = []
        self.assertErro(plano, "criteriosAceite")

    def test_verificacao_vazia(self):
        plano = plano_referencia()
        raia_de(plano, "back-clientes")["verificacao"] = "  "
        self.assertErro(plano, "verificacao")

    def test_arquivos_vazios(self):
        plano = plano_referencia()
        raia_de(plano, "back-clientes")["arquivos"] = []
        self.assertErro(plano, "arquivos")

    def test_arquivos_sobrepostos_na_mesma_fase(self):
        plano = plano_referencia()
        raia_de(plano, "back-clientes")["arquivos"] = ["src/x/"]
        raia_de(plano, "front-clientes")["arquivos"] = ["src/x/y.ts"]
        erros = self.assertErro(plano, "sobrepõe")
        erro = next(e for e in erros if "sobrepõe" in e)
        self.assertIn("back-clientes", erro)
        self.assertIn("front-clientes", erro)

    def test_arquivos_sobrepostos_em_fases_diferentes_sao_validos(self):
        plano = plano_referencia()
        raia_de(plano, "fundacao")["arquivos"] = ["src/modules/clientes/"]
        self.assertEqual(raias.validar_plano(plano), [])

    def test_fase_atual_inexistente(self):
        plano = plano_referencia()
        plano["faseAtual"] = "fantasma"
        self.assertErro(plano, "faseAtual")

    def test_plano_malformado_nao_levanta_excecao(self):
        self.assertNotEqual(raias.validar_plano([]), [])
        self.assertNotEqual(raias.validar_plano({}), [])
        plano = plano_referencia()
        plano["raias"][1]["arquivos"] = "src/"
        plano["raias"][2]["dependeDe"] = None
        self.assertNotEqual(raias.validar_plano(plano), [])


class TestesRaiasProntas(unittest.TestCase):
    def plano_no_nucleo(self):
        plano = plano_referencia()
        plano["faseAtual"] = "nucleo"
        return plano

    def test_raias_da_fase_com_dependencias_concluidas(self):
        prontas = raias.raias_prontas(self.plano_no_nucleo(), {"fundacao"}, set())
        self.assertEqual(prontas, ["back-clientes", "front-clientes"])

    def test_raia_ativa_nao_e_pronta(self):
        prontas = raias.raias_prontas(
            self.plano_no_nucleo(), {"fundacao"}, {"back-clientes"}
        )
        self.assertEqual(prontas, ["front-clientes"])

    def test_sem_dependencias_concluidas_nada_e_pronto(self):
        self.assertEqual(
            raias.raias_prontas(self.plano_no_nucleo(), set(), set()), []
        )

    def test_raia_concluida_nao_e_pronta(self):
        prontas = raias.raias_prontas(
            self.plano_no_nucleo(), {"fundacao", "back-clientes"}, set()
        )
        self.assertEqual(prontas, ["front-clientes"])

    def test_raias_de_outra_fase_nunca_aparecem(self):
        prontas = raias.raias_prontas(plano_referencia(), set(), set())
        self.assertEqual(prontas, ["fundacao"])


class TestesCli(unittest.TestCase):
    def executar(self, plano):
        with tempfile.TemporaryDirectory() as pasta:
            caminho = pathlib.Path(pasta) / "plano.json"
            caminho.write_text(json.dumps(plano), encoding="utf-8")
            return subprocess.run(
                ["python3", "-I", str(RAIZ / "raias.py"), "validar", str(caminho)],
                capture_output=True,
                text=True,
            )

    def test_plano_valido_sai_com_zero(self):
        resultado = self.executar(plano_referencia())
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertEqual(resultado.stdout, "")

    def test_plano_invalido_sai_com_um_e_imprime_o_erro(self):
        plano = plano_referencia()
        raia_de(plano, "back-clientes")["dependeDe"] = ["front-clientes"]
        raia_de(plano, "front-clientes")["dependeDe"] = ["back-clientes"]
        resultado = self.executar(plano)
        self.assertEqual(resultado.returncode, 1)
        self.assertIn("ciclo", resultado.stdout)

    def test_arquivo_inexistente_sai_com_um(self):
        resultado = subprocess.run(
            ["python3", "-I", str(RAIZ / "raias.py"), "validar", "/nao/existe.json"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(resultado.returncode, 1)
        self.assertIn("plano", resultado.stdout)


if __name__ == "__main__":
    unittest.main()
