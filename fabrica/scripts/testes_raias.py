import copy
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

import globs  # noqa: E402
import raias  # noqa: E402


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

    def test_glob_ancora_o_caminho_inteiro(self):
        self.assertFalse(globs.casa_glob("src/a.tsx", "src/*.ts"))
        self.assertFalse(globs.casa_glob("xsrc/a.ts", "src/*.ts"))
        self.assertFalse(globs.casa_glob("a.ts.bak", "a.ts"))
        self.assertFalse(globs.casa_glob("xsrc/a/b.ts", "src/a/"))

    def test_glob_com_curinga_e_barra_final_casa_o_prefixo(self):
        self.assertTrue(globs.casa_glob("src/a/x.ts", "src/*/"))
        self.assertTrue(globs.casa_glob("src/a/b/x.ts", "src/*/"))
        self.assertFalse(globs.casa_glob("src/x.ts", "src/*/"))
        self.assertTrue(globs.casa_glob("src/clientes/x.ts", "**/clientes/"))
        self.assertTrue(globs.casa_glob("a/b/clientes/x.ts", "**/clientes/"))
        self.assertTrue(globs.casa_glob("clientes/x.ts", "**/clientes/"))
        self.assertFalse(globs.casa_glob("src/meus-clientes/x.ts", "**/clientes/"))
        self.assertFalse(globs.casa_glob("src/projetos/x.ts", "**/clientes/"))

    def test_sobreposicao_com_curinga_e_barra_final(self):
        self.assertTrue(globs.globs_sobrepoem("src/a/x.ts", "src/*/"))
        self.assertTrue(globs.globs_sobrepoem("src/*/", "src/a/x.ts"))
        self.assertTrue(globs.globs_sobrepoem("src/clientes/x.ts", "**/clientes/"))
        self.assertTrue(globs.globs_sobrepoem("**/clientes/", "src/clientes/x.ts"))
        self.assertFalse(globs.globs_sobrepoem("src/x.ts", "src/*/"))
        self.assertFalse(globs.globs_sobrepoem("src/projetos/x.ts", "**/clientes/"))

    def test_sobreposicao_e_simetrica_para_diretorios_aninhados(self):
        self.assertTrue(globs.globs_sobrepoem("src/x/y/", "src/x/"))
        self.assertTrue(globs.globs_sobrepoem("src/x/", "src/x/y/"))
        self.assertTrue(globs.globs_sobrepoem("src/x/y/**", "src/x/**"))
        self.assertTrue(globs.globs_sobrepoem("src/x/**", "src/x/y/**"))

    def test_interrogacao_conta_como_curinga_na_sobreposicao(self):
        self.assertTrue(globs.globs_sobrepoem("src/a?.ts", "src/ab.ts"))
        self.assertTrue(globs.globs_sobrepoem("src/ab.ts", "src/a?.ts"))
        self.assertFalse(globs.globs_sobrepoem("src/a?.ts", "src/b.ts"))

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
            ("produto", "arquiteto", "ux-ui", "frontend", "backend", "qa", "devops", "seguranca"),
        )

    def test_aliases_de_papel(self):
        self.assertEqual(raias.ALIASES_DE_PAPEL, {"ux-engineer": "ux-ui"})
        for alias, canonico in raias.ALIASES_DE_PAPEL.items():
            self.assertNotIn(alias, raias.PAPEIS_DE_RAIA)
            self.assertIn(canonico, raias.PAPEIS_DE_RAIA)

    def test_papel_normalizado(self):
        self.assertEqual(raias.papel_normalizado("ux-engineer"), "ux-ui")
        self.assertEqual(raias.papel_normalizado("backend"), "backend")
        self.assertEqual(raias.papel_normalizado("inexistente"), "inexistente")
        self.assertIsNone(raias.papel_normalizado(None))
        self.assertEqual(raias.papel_normalizado(["ux-engineer"]), ["ux-engineer"])

    def test_todo_papel_novo_e_valido(self):
        for papel in raias.PAPEIS_DE_RAIA:
            with self.subTest(papel=papel):
                plano = plano_referencia()
                raia_de(plano, "fundacao")["papel"] = papel
                self.assertEqual(raias.validar_plano(plano), [])

    def test_alias_ux_engineer_continua_valido_sem_mudar_o_plano(self):
        plano = plano_referencia()
        raia_de(plano, "front-clientes")["papel"] = "ux-engineer"
        antes = copy.deepcopy(plano)
        self.assertEqual(raias.validar_plano(plano), [])
        self.assertEqual(plano, antes)

    def test_papel_invalido_cita_os_permitidos(self):
        plano = plano_referencia()
        raia_de(plano, "fundacao")["papel"] = "designer"
        erros = self.assertErro(plano, "papel inválido 'designer'")
        self.assertTrue(any("ux-ui" in e and "seguranca" in e for e in erros), erros)

    def test_papel_nao_texto_e_invalido(self):
        for papel in (None, ["backend"], {"ux-engineer": 1}, 3):
            with self.subTest(papel=papel):
                plano = plano_referencia()
                raia_de(plano, "fundacao")["papel"] = papel
                self.assertErro(plano, "papel inválido")

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
        for invalido in (
            "pl-XYZ1",
            "pl-1a2",
            "pl-1a2b3",
            "1a2b",
            "PL-1A2B",
            "pl-zzzz",
            "pl-1a2g",
            "pl-1A2B",
            "",
            None,
            1234,
        ):
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

    def test_dependencia_na_mesma_fase_e_valida(self):
        plano = plano_referencia()
        raia_de(plano, "front-clientes")["dependeDe"] = ["fundacao", "back-clientes"]
        self.assertEqual(raias.validar_plano(plano), [])

    def test_sobreposicao_com_varios_globs_e_tres_raias_na_mesma_fase(self):
        casos = [
            # (arquivos de a, de b, de c, par esperado)
            (["src/a/", "src/x/"], ["src/b/"], ["src/x/y.ts"], ("a", "c")),
            (["src/a/"], ["src/b/", "src/c/"], ["src/d/", "src/c/z.ts"], ("b", "c")),
            (["src/a/"], ["src/b/"], ["src/b/", "src/e/"], ("b", "c")),
            (["src/a/", "src/q/"], ["src/b/"], ["src/c/", "src/q/w.ts"], ("a", "c")),
        ]
        for arq_a, arq_b, arq_c, (x, y) in casos:
            plano = plano_referencia()
            modelo = raia_de(plano, "back-clientes")
            plano["raias"] = [raia_de(plano, "fundacao")] + [
                {**copy.deepcopy(modelo), "id": id_, "arquivos": arquivos}
                for id_, arquivos in (("a", arq_a), ("b", arq_b), ("c", arq_c))
            ]
            plano["fases"][1]["raias"] = ["a", "b", "c"]
            erros = [e for e in raias.validar_plano(plano) if "sobrepõe" in e]
            self.assertEqual(len(erros), 1, erros)
            self.assertIn(f"'{x}'", erros[0])
            self.assertIn(f"'{y}'", erros[0])

    def test_glob_com_curinga_e_barra_final_acusa_sobreposicao_na_fase(self):
        plano = plano_referencia()
        raia_de(plano, "back-clientes")["arquivos"] = ["src/a/x.ts"]
        raia_de(plano, "front-clientes")["arquivos"] = ["src/*/"]
        self.assertErro(plano, "sobrepõe")

    def test_fase_atual_inexistente(self):
        plano = plano_referencia()
        plano["faseAtual"] = "fantasma"
        self.assertErro(plano, "faseAtual")

    def test_entradas_que_nao_sao_objetos_viram_erro(self):
        for chave, lixo in (("raias", "lixo"), ("raias", 7), ("fases", "lixo"), ("fases", None)):
            plano = plano_referencia()
            plano[chave].append(lixo)
            erros = raias.validar_plano(plano)
            self.assertTrue(
                any(f"{chave}[" in e and "objeto" in e for e in erros),
                f"{chave}={lixo!r}: {erros}",
            )

    def test_valores_nao_hashaveis_viram_erros_sem_excecao(self):
        def fase_cita_lista(p):
            p["fases"][1]["raias"].append(["x"])

        def fase_cita_dict(p):
            p["fases"][1]["raias"].append({"a": 1})

        def fase_com_id_lista(p):
            p["fases"][1]["id"] = ["nucleo"]

        def raia_com_id_lista(p):
            raia_de(p, "back-clientes")["id"] = ["back"]

        def depende_de_nao_hashavel(p):
            raia_de(p, "back-clientes")["dependeDe"] = [["fundacao"], {"x": 1}]

        def fase_atual_lista(p):
            p["faseAtual"] = ["nucleo"]

        for mutacao in (
            fase_cita_lista,
            fase_cita_dict,
            fase_com_id_lista,
            raia_com_id_lista,
            depende_de_nao_hashavel,
            fase_atual_lista,
        ):
            with self.subTest(mutacao.__name__):
                plano = plano_referencia()
                mutacao(plano)
                self.assertNotEqual(raias.validar_plano(plano), [])
                raias.raias_prontas(plano, set(), set())

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

    def test_ordem_segue_plano_raias(self):
        plano = self.plano_no_nucleo()
        plano["raias"] = [plano["raias"][0], plano["raias"][2], plano["raias"][1]]
        self.assertEqual(
            [r["id"] for r in plano["raias"]],
            ["fundacao", "front-clientes", "back-clientes"],
        )
        self.assertEqual(plano["fases"][1]["raias"], ["back-clientes", "front-clientes"])
        prontas = raias.raias_prontas(plano, {"fundacao"}, set())
        self.assertEqual(prontas, ["front-clientes", "back-clientes"])

    def test_exige_todas_as_dependencias_concluidas(self):
        plano = self.plano_no_nucleo()
        raia_de(plano, "front-clientes")["dependeDe"] = ["fundacao", "back-clientes"]
        prontas = raias.raias_prontas(plano, {"fundacao"}, set())
        self.assertEqual(prontas, ["back-clientes"])
        prontas = raias.raias_prontas(plano, {"fundacao", "back-clientes"}, set())
        self.assertEqual(prontas, ["front-clientes"])

    def test_dependencia_ativa_nao_conta_como_concluida(self):
        plano = self.plano_no_nucleo()
        raia_de(plano, "front-clientes")["dependeDe"] = ["back-clientes"]
        prontas = raias.raias_prontas(plano, {"fundacao"}, {"back-clientes"})
        self.assertEqual(prontas, [])

    def test_ignora_entradas_malformadas(self):
        plano = self.plano_no_nucleo()
        plano["raias"].append("lixo")
        plano["raias"].append({"id": ["x"]})
        plano["fases"].append(42)
        plano["fases"][1]["raias"].append(["x"])
        prontas = raias.raias_prontas(plano, {"fundacao"}, set())
        self.assertEqual(prontas, ["back-clientes", "front-clientes"])

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

    def test_imprime_um_erro_por_linha(self):
        plano = plano_referencia()
        raia_de(plano, "back-clientes")["dependeDe"] = ["front-clientes"]
        raia_de(plano, "front-clientes")["dependeDe"] = ["back-clientes"]
        raia_de(plano, "back-clientes")["criteriosAceite"] = []
        raia_de(plano, "front-clientes")["verificacao"] = ""
        esperados = raias.validar_plano(plano)
        self.assertGreaterEqual(len(esperados), 3)
        resultado = self.executar(plano)
        self.assertEqual(resultado.returncode, 1)
        self.assertEqual(resultado.stdout.splitlines(), esperados)

    def test_valor_nao_hashavel_nao_imprime_traceback(self):
        plano = plano_referencia()
        plano["fases"][1]["raias"].append(["x"])
        resultado = self.executar(plano)
        self.assertEqual(resultado.returncode, 1)
        self.assertEqual(resultado.stderr, "")

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
