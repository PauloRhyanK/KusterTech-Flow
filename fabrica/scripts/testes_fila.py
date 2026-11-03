import copy
import pathlib
import sys
import unittest

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

import fila  # noqa: E402
import raias  # noqa: E402

REPO = "paulorhyank/kustertech-flow"
OUTRO_REPO = "paulorhyank/outro"


def plano_com(*grupos):
    """Um plano válido com uma raia por grupo de globs, todas numa única fase."""
    ids = [f"raia-{n}" for n in range(len(grupos))]
    return {
        "versao": 1,
        "faseAtual": "unica",
        "fases": [{"id": "unica", "raias": ids}],
        "raias": [
            {
                "id": id_,
                "papel": "backend",
                "planoSeeds": "pl-0000",
                "dependeDe": [],
                "arquivos": list(globs),
                "verificacao": "pnpm test",
                "criteriosAceite": ["ok"],
            }
            for id_, globs in zip(ids, grupos)
        ],
    }


def achado(feature, globs, repo=REPO):
    return {
        "repo": repo,
        "caminho": f".fabrica/planos/{feature}.json",
        "plano": plano_com(globs),
    }


def entrada(feature, globs, estado="aguardando", entrou="2026-11-03T10:00:00Z", repo=REPO):
    return {
        "id": fila.id_do_plano(repo, feature),
        "repo": repo,
        "feature": feature,
        "caminho": f".fabrica/planos/{feature}.json",
        "entrouEm": entrou,
        "estado": estado,
        "arquivos": sorted(globs),
    }


def estados(lista):
    return {e["feature"]: e["estado"] for e in lista}


class TestesIdDoPlano(unittest.TestCase):
    def test_minusculas_e_troca_de_caracteres(self):
        self.assertEqual(
            fila.id_do_plano("PauloRhyanK/KusterTech-Flow", "Login_v2"),
            "paulorhyank--kustertech-flow--login-v2",
        )

    def test_nunca_tem_traco_duplo_dentro_de_uma_parte(self):
        id_ = fila.id_do_plano("Dono/Meu__Repo..x", "a--b__c")
        dono, repo, feature = id_.split("--")
        self.assertEqual((dono, repo, feature), ("dono", "meu-repo-x", "a-b-c"))

    def test_apara_tracos_nas_pontas_de_cada_parte(self):
        self.assertEqual(
            fila.id_do_plano("-Dono-/_repo_", "-feature-"),
            "dono--repo--feature",
        )

    def test_so_caracteres_permitidos(self):
        id_ = fila.id_do_plano("Dóno/Repó Ç", "Fé Nova!")
        self.assertRegex(id_, r"^[a-z0-9]+(-[a-z0-9]+)*(--[a-z0-9]+(-[a-z0-9]+)*){2}$")


class TestesFeatureDoCaminho(unittest.TestCase):
    def test_plano_de_feature(self):
        self.assertEqual(fila.feature_do_caminho(".fabrica/planos/login.json"), "login")
        self.assertEqual(fila.feature_do_caminho(".fabrica/planos/login-v2.json"), "login-v2")

    def test_plano_legado(self):
        self.assertEqual(fila.feature_do_caminho(".fabrica/plano.json"), "plano")

    def test_o_nome_plano_e_recusado_em_planos(self):
        self.assertIsNone(fila.feature_do_caminho(".fabrica/planos/plano.json"))

    def test_o_resto_da_none(self):
        for caminho in (
            "",
            "plano.json",
            ".fabrica/planos/Login.json",
            ".fabrica/planos/a_b.json",
            ".fabrica/planos/-a.json",
            ".fabrica/planos/a-.json",
            ".fabrica/planos/a--b.json",
            ".fabrica/planos/a/b.json",
            ".fabrica/planos/.json",
            ".fabrica/planos/login.json\n",
            ".fabrica/planos/login.yaml",
            ".fabrica/outro.json",
            "x/.fabrica/plano.json",
        ):
            with self.subTest(caminho=caminho):
                self.assertIsNone(fila.feature_do_caminho(caminho))

    def test_nao_texto_da_none(self):
        self.assertIsNone(fila.feature_do_caminho(None))


class TestesArquivosDoPlano(unittest.TestCase):
    def test_uniao_ordenada_sem_repeticao(self):
        plano = plano_com(["src/b/", "src/a/"], ["src/a/", "docs/"])
        self.assertEqual(fila.arquivos_do_plano(plano), ["docs/", "src/a/", "src/b/"])

    def test_nao_muda_a_entrada(self):
        plano = plano_com(["src/b/", "src/a/"])
        antes = copy.deepcopy(plano)
        fila.arquivos_do_plano(plano)
        self.assertEqual(plano, antes)

    def test_plano_torto_da_lista_vazia(self):
        self.assertEqual(fila.arquivos_do_plano({}), [])
        self.assertEqual(fila.arquivos_do_plano({"raias": [1, {"arquivos": "x"}]}), [])
        self.assertEqual(fila.arquivos_do_plano(None), [])


class TestesColide(unittest.TestCase):
    def test_mesmo_repo_com_globs_que_se_sobrepoem(self):
        self.assertTrue(
            fila.colide(entrada("a", ["src/x/"]), entrada("b", ["src/x/y.ts"]))
        )

    def test_mesmo_repo_com_globs_disjuntos(self):
        self.assertFalse(fila.colide(entrada("a", ["src/x/"]), entrada("b", ["src/y/"])))

    def test_repos_diferentes_nunca_colidem(self):
        self.assertFalse(
            fila.colide(
                entrada("a", ["src/x/"]),
                entrada("a", ["src/x/"], repo=OUTRO_REPO),
            )
        )

    def test_alguma_combinacao_basta(self):
        self.assertTrue(
            fila.colide(entrada("a", ["docs/", "src/x/"]), entrada("b", ["lib/", "src/x/z"]))
        )

    def test_sem_arquivos_nao_colide(self):
        self.assertFalse(fila.colide(entrada("a", []), entrada("b", ["src/"])))


class TestesEnfileirar(unittest.TestCase):
    AGORA = "2026-11-03T12:00:00Z"

    def test_acrescenta_planos_novos_como_aguardando(self):
        nova = fila.enfileirar([], [achado("login", ["src/login/"])], self.AGORA)
        self.assertEqual(
            nova,
            [
                {
                    "id": "paulorhyank--kustertech-flow--login",
                    "repo": REPO,
                    "feature": "login",
                    "caminho": ".fabrica/planos/login.json",
                    "entrouEm": self.AGORA,
                    "estado": "aguardando",
                    "arquivos": ["src/login/"],
                }
            ],
        )

    def test_plano_legado_vira_feature_plano(self):
        item = {"repo": REPO, "caminho": ".fabrica/plano.json", "plano": plano_com(["a/"])}
        nova = fila.enfileirar([], [item], self.AGORA)
        self.assertEqual(nova[0]["feature"], "plano")
        self.assertEqual(nova[0]["id"], "paulorhyank--kustertech-flow--plano")

    def test_caminho_recusado_e_plano_invalido_nao_entram(self):
        invalido = {"repo": REPO, "caminho": ".fabrica/planos/ruim.json", "plano": {"fases": []}}
        fora = {"repo": REPO, "caminho": ".fabrica/planos/plano.json", "plano": plano_com(["a/"])}
        self.assertEqual(fila.enfileirar([], [invalido, fora], self.AGORA), [])

    def test_descoberto_repetido_entra_uma_vez(self):
        nova = fila.enfileirar(
            [], [achado("login", ["a/"]), achado("login", ["b/"])], self.AGORA
        )
        self.assertEqual(len(nova), 1)

    def test_e_idempotente(self):
        uma = fila.enfileirar([], [achado("login", ["a/"])], self.AGORA)
        duas = fila.enfileirar(uma, [achado("login", ["a/"])], "2026-11-03T13:00:00Z")
        self.assertEqual(uma, duas)

    def test_atualiza_arquivos_de_quem_aguarda(self):
        antes = [entrada("login", ["a/"])]
        nova = fila.enfileirar(antes, [achado("login", ["b/", "a/"])], self.AGORA)
        self.assertEqual(nova[0]["arquivos"], ["a/", "b/"])
        self.assertEqual(nova[0]["entrouEm"], antes[0]["entrouEm"])
        self.assertEqual(nova[0]["estado"], "aguardando")

    def test_aguardando_que_sumiu_vira_removido(self):
        antes = [entrada("login", ["a/"]), entrada("cobranca", ["b/"])]
        nova = fila.enfileirar(antes, [achado("cobranca", ["b/"])], self.AGORA)
        self.assertEqual(estados(nova), {"login": "removido", "cobranca": "aguardando"})

    def test_removido_so_vale_para_aguardando(self):
        for estado in ("ativo", "pausado", "concluido"):
            with self.subTest(estado=estado):
                antes = [entrada("login", ["a/"], estado=estado)]
                nova = fila.enfileirar(antes, [], self.AGORA)
                self.assertEqual(nova, antes)

    def test_nao_toca_ativo_pausado_e_concluido_mesmo_com_conteudo_novo(self):
        for estado in ("ativo", "pausado"):
            with self.subTest(estado=estado):
                antes = [entrada("login", ["a/"], estado=estado)]
                nova = fila.enfileirar(antes, [achado("login", ["z/"])], self.AGORA)
                self.assertEqual(nova, antes)

    def test_concluido_igual_continua_concluido(self):
        antes = [entrada("login", ["a/"], estado="concluido")]
        nova = fila.enfileirar(antes, [achado("login", ["a/"])], self.AGORA)
        self.assertEqual(nova, antes)

    def test_concluido_com_conteudo_novo_volta_como_entrada_nova(self):
        antes = [entrada("login", ["a/"], estado="concluido")]
        nova = fila.enfileirar(antes, [achado("login", ["a/", "b/"])], self.AGORA)
        self.assertEqual(len(nova), 2)
        self.assertEqual(nova[0], antes[0])
        self.assertEqual(nova[1]["estado"], "aguardando")
        self.assertEqual(nova[1]["entrouEm"], self.AGORA)
        self.assertEqual(nova[1]["arquivos"], ["a/", "b/"])
        self.assertEqual(nova[1]["id"], antes[0]["id"])

    def test_removido_que_reaparece_volta_como_entrada_nova(self):
        antes = [entrada("login", ["a/"], estado="removido")]
        for globs in (["a/"], ["b/"]):
            with self.subTest(globs=globs):
                nova = fila.enfileirar(antes, [achado("login", globs)], self.AGORA)
                self.assertEqual(len(nova), 2)
                self.assertEqual(nova[1]["estado"], "aguardando")
                self.assertEqual(nova[1]["entrouEm"], self.AGORA)

    def test_reaparecido_nao_duplica_na_rodada_seguinte(self):
        antes = [entrada("login", ["a/"], estado="concluido")]
        uma = fila.enfileirar(antes, [achado("login", ["b/"])], self.AGORA)
        duas = fila.enfileirar(uma, [achado("login", ["b/"])], "2026-11-03T13:00:00Z")
        self.assertEqual(uma, duas)

    def test_historico_nao_e_removido_quando_o_arquivo_some(self):
        antes = [
            entrada("login", ["a/"], estado="concluido"),
            entrada("login", ["b/"], entrou="2026-11-03T11:00:00Z"),
        ]
        nova = fila.enfileirar(antes, [], self.AGORA)
        self.assertEqual([e["estado"] for e in nova], ["concluido", "removido"])

    def test_nao_muda_as_entradas(self):
        antes = [entrada("login", ["a/"]), entrada("velho", ["v/"], estado="concluido")]
        descobertos = [achado("login", ["b/"]), achado("novo", ["n/"])]
        fila_antes = copy.deepcopy(antes)
        descobertos_antes = copy.deepcopy(descobertos)
        fila.enfileirar(antes, descobertos, self.AGORA)
        self.assertEqual(antes, fila_antes)
        self.assertEqual(descobertos, descobertos_antes)

    def test_resultado_nao_compartilha_listas_com_a_entrada(self):
        antes = [entrada("login", ["a/"], estado="ativo")]
        nova = fila.enfileirar(antes, [], self.AGORA)
        nova[0]["arquivos"].append("x/")
        self.assertEqual(antes[0]["arquivos"], ["a/"])

    def test_planos_novos_da_mesma_rodada_entram_em_ordem_estavel(self):
        nova = fila.enfileirar(
            [], [achado("zeta", ["z/"]), achado("alfa", ["a/"])], self.AGORA
        )
        self.assertEqual([e["feature"] for e in nova], ["alfa", "zeta"])


class TestesAdmitir(unittest.TestCase):
    def test_dois_planos_disjuntos_entram_juntos(self):
        lista = [entrada("a", ["src/a/"]), entrada("b", ["src/b/"])]
        self.assertEqual(fila.admitir(lista), [lista[0]["id"], lista[1]["id"]])

    def test_terceiro_que_colide_com_ativo_espera(self):
        lista = [
            entrada("a", ["src/a/"], estado="ativo"),
            entrada("b", ["src/b/"], estado="ativo"),
            entrada("c", ["src/a/x.ts"]),
        ]
        self.assertEqual(fila.admitir(lista), [])

    def test_quarto_sem_colisao_passa_na_frente_do_terceiro(self):
        lista = [
            entrada("a", ["src/a/"], estado="ativo", entrou="2026-11-03T01:00:00Z"),
            entrada("b", ["src/b/"], estado="ativo", entrou="2026-11-03T02:00:00Z"),
            entrada("c", ["src/a/x.ts"], entrou="2026-11-03T03:00:00Z"),
            entrada("d", ["src/d/"], entrou="2026-11-03T04:00:00Z"),
        ]
        self.assertEqual(fila.admitir(lista), [lista[3]["id"]])

    def test_quarto_que_colide_com_o_terceiro_que_espera_tambem_espera(self):
        lista = [
            entrada("a", ["src/a/"], estado="ativo", entrou="2026-11-03T01:00:00Z"),
            entrada("c", ["src/a/x.ts"], entrou="2026-11-03T03:00:00Z"),
            entrada("d", ["src/a/x.ts", "src/d/"], entrou="2026-11-03T04:00:00Z"),
        ]
        self.assertEqual(fila.admitir(lista), [])

    def test_pausado_bloqueia_como_ativo(self):
        lista = [entrada("a", ["src/a/"], estado="pausado"), entrada("b", ["src/a/"])]
        self.assertEqual(fila.admitir(lista), [])

    def test_concluido_e_removido_nao_bloqueiam(self):
        lista = [
            entrada("a", ["src/a/"], estado="concluido"),
            entrada("r", ["src/a/"], estado="removido"),
            entrada("b", ["src/a/"]),
        ]
        self.assertEqual(fila.admitir(lista), [lista[2]["id"]])

    def test_repos_diferentes_nunca_se_bloqueiam(self):
        lista = [
            entrada("a", ["src/"], estado="ativo"),
            entrada("a", ["src/"], repo=OUTRO_REPO),
        ]
        self.assertEqual(fila.admitir(lista), [lista[1]["id"]])

    def test_dois_aguardando_que_colidem_so_o_mais_antigo_entra(self):
        lista = [
            entrada("novo", ["src/"], entrou="2026-11-03T05:00:00Z"),
            entrada("velho", ["src/a/"], entrou="2026-11-03T01:00:00Z"),
        ]
        self.assertEqual(fila.admitir(lista), [lista[1]["id"]])

    def test_ordem_pelo_entrou_em_com_empate_pela_posicao(self):
        lista = [entrada("b", ["x/"]), entrada("a", ["y/"])]
        self.assertEqual(fila.admitir(lista), [lista[0]["id"], lista[1]["id"]])

    def test_fila_vazia_ou_sem_aguardando(self):
        self.assertEqual(fila.admitir([]), [])
        self.assertEqual(fila.admitir([entrada("a", ["x/"], estado="ativo")]), [])

    def test_nao_muda_a_fila(self):
        lista = [entrada("a", ["src/a/"], estado="ativo"), entrada("b", ["src/b/"])]
        antes = copy.deepcopy(lista)
        fila.admitir(lista)
        self.assertEqual(lista, antes)


class TestesMarcar(unittest.TestCase):
    def test_muda_so_o_estado_da_entrada(self):
        lista = [entrada("a", ["x/"]), entrada("b", ["y/"])]
        nova = fila.marcar(lista, lista[0]["id"], "ativo")
        self.assertEqual(estados(nova), {"a": "ativo", "b": "aguardando"})
        self.assertEqual({k: v for k, v in nova[0].items() if k != "estado"},
                         {k: v for k, v in lista[0].items() if k != "estado"})

    def test_nao_muda_a_entrada(self):
        lista = [entrada("a", ["x/"])]
        antes = copy.deepcopy(lista)
        nova = fila.marcar(lista, lista[0]["id"], "concluido")
        self.assertEqual(lista, antes)
        nova[0]["arquivos"].append("z/")
        self.assertEqual(lista, antes)

    def test_com_historico_marca_a_entrada_mais_recente(self):
        lista = [
            entrada("a", ["x/"], estado="concluido"),
            entrada("a", ["y/"], entrou="2026-11-03T11:00:00Z"),
        ]
        nova = fila.marcar(lista, lista[0]["id"], "ativo")
        self.assertEqual([e["estado"] for e in nova], ["concluido", "ativo"])

    def test_id_desconhecido_devolve_copia_igual(self):
        lista = [entrada("a", ["x/"])]
        nova = fila.marcar(lista, "nao--existe--x", "ativo")
        self.assertEqual(nova, lista)
        self.assertIsNot(nova, lista)

    def test_estado_invalido_levanta_erro(self):
        with self.assertRaises(ValueError):
            fila.marcar([entrada("a", ["x/"])], "x", "dormindo")

    def test_estados_validos(self):
        self.assertEqual(
            fila.ESTADOS, ("aguardando", "ativo", "pausado", "concluido", "removido")
        )


class TestesConsistenciaComTask1(unittest.TestCase):
    def test_plano_de_teste_e_valido_para_o_raias(self):
        self.assertEqual(raias.validar_plano(plano_com(["a/"], ["b/"])), [])


if __name__ == "__main__":
    unittest.main()
