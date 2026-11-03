import copy
import hashlib
import json
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
        "hash": fila.hash_do_plano(plano_com(globs)),
    }


def estados(lista):
    return {e["feature"]: e["estado"] for e in lista}


def h6(repo, feature):
    return hashlib.sha256(f"{repo.lower()}/{feature}".encode("utf-8")).hexdigest()[:6]


ID_SEGURO = r"^[a-z0-9]+(-[a-z0-9]+)*(--[a-z0-9]+(-[a-z0-9]+)*){3}$"


class TestesIdDoPlano(unittest.TestCase):
    def test_minusculas_e_troca_de_caracteres(self):
        self.assertEqual(
            fila.id_do_plano("PauloRhyanK/KusterTech-Flow", "Login_v2"),
            f"paulorhyank--kustertech-flow--login-v2--{h6('PauloRhyanK/KusterTech-Flow', 'Login_v2')}",
        )

    def test_nunca_tem_traco_duplo_dentro_de_uma_parte(self):
        id_ = fila.id_do_plano("Dono/Meu__Repo..x", "a--b__c")
        dono, repo, feature, hash_ = id_.split("--")
        self.assertEqual((dono, repo, feature), ("dono", "meu-repo-x", "a-b-c"))
        self.assertEqual(hash_, h6("Dono/Meu__Repo..x", "a--b__c"))

    def test_apara_tracos_nas_pontas_de_cada_parte(self):
        id_ = fila.id_do_plano("-Dono-/_repo_", "-feature-")
        self.assertEqual(id_.rsplit("--", 1)[0], "dono--repo--feature")

    def test_parte_vazia_depois_de_limpar_vira_x(self):
        id_ = fila.id_do_plano("o/..", "___")
        self.assertEqual(id_.rsplit("--", 1)[0], "o--x--x")

    def test_o_hash_ignora_a_caixa_do_repo_mas_nao_da_feature(self):
        self.assertEqual(fila.id_do_plano("O/R", "f"), fila.id_do_plano("o/r", "f"))
        self.assertNotEqual(fila.id_do_plano("o/r", "F"), fila.id_do_plano("o/r", "f"))

    def test_repos_que_a_limpeza_confundiria_tem_ids_distintos(self):
        ids = {fila.id_do_plano(r, "f") for r in ("o/my.app", "o/my_app", "o/my-app")}
        self.assertEqual(len(ids), 3)
        self.assertNotEqual(fila.id_do_plano("o/.github", "f"), fila.id_do_plano("o/github", "f"))

    def test_o_id_sempre_casa_com_o_formato_seguro_para_unit_systemd(self):
        for repo in ("PauloRhyanK/KusterTech-Flow", "o/..", "-/_", "o/.github", "a-b/c.d_e"):
            for feature in ("login", "Login_v2", "___", "a--b"):
                with self.subTest(repo=repo, feature=feature):
                    self.assertRegex(fila.id_do_plano(repo, feature), ID_SEGURO)

    def test_repo_malformado_levanta_value_error(self):
        for repo in ("semslash", "a/b/c", "", "/r", "o/", "o/r\n", "d ono/r", "dóno/r", "o/café", "o/日本"):
            with self.subTest(repo=repo):
                with self.assertRaises(ValueError):
                    fila.id_do_plano(repo, "f")

    def test_repo_que_nao_e_texto_levanta_value_error(self):
        with self.assertRaises(ValueError):
            fila.id_do_plano(None, "f")


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

    def test_a_caixa_do_repo_nao_importa(self):
        self.assertTrue(
            fila.colide(
                entrada("a", ["src/x/"], repo="Dono/Repo"),
                entrada("b", ["src/x/"], repo="dono/repo"),
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
                    "id": fila.id_do_plano(REPO, "login"),
                    "repo": REPO,
                    "feature": "login",
                    "caminho": ".fabrica/planos/login.json",
                    "entrouEm": self.AGORA,
                    "estado": "aguardando",
                    "arquivos": ["src/login/"],
                    "hash": fila.hash_do_plano(plano_com(["src/login/"])),
                }
            ],
        )

    def test_plano_legado_vira_feature_plano(self):
        item = {"repo": REPO, "caminho": ".fabrica/plano.json", "plano": plano_com(["a/"])}
        nova = fila.enfileirar([], [item], self.AGORA)
        self.assertEqual(nova[0]["feature"], "plano")
        self.assertEqual(nova[0]["id"], fila.id_do_plano(REPO, "plano"))

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
        for estado in ("admitindo", "ativo", "pausado", "concluido"):
            with self.subTest(estado=estado):
                antes = [entrada("login", ["a/"], estado=estado)]
                nova = fila.enfileirar(antes, [], self.AGORA)
                self.assertEqual(nova, antes)

    def test_ativo_e_pausado_so_atualizam_o_hash(self):
        for estado in ("admitindo", "ativo", "pausado"):
            with self.subTest(estado=estado):
                antes = [entrada("login", ["a/"], estado=estado)]
                novo = achado("login", ["z/"])
                nova = fila.enfileirar(antes, [novo], self.AGORA)
                esperado = {**antes[0], "hash": fila.hash_do_plano(novo["plano"])}
                self.assertEqual(nova, [esperado])
                self.assertEqual(nova[0]["arquivos"], ["a/"])

    def test_concluido_igual_continua_concluido(self):
        antes = [entrada("login", ["a/"], estado="concluido")]
        nova = fila.enfileirar(antes, [achado("login", ["a/"])], self.AGORA)
        self.assertEqual(nova, antes)

    def test_concluido_com_conteudo_novo_volta_como_entrada_nova(self):
        antes = [entrada("login", ["a/"], estado="concluido")]
        novo = achado("login", ["a/", "b/"])
        nova = fila.enfileirar(antes, [novo], self.AGORA)
        self.assertEqual(len(nova), 2)
        self.assertEqual(nova[0], antes[0])
        self.assertEqual(nova[1]["estado"], "aguardando")
        self.assertEqual(nova[1]["entrouEm"], self.AGORA)
        self.assertEqual(nova[1]["arquivos"], ["a/", "b/"])
        self.assertEqual(nova[1]["hash"], fila.hash_do_plano(novo["plano"]))
        self.assertEqual(nova[1]["id"], antes[0]["id"])

    def test_concluido_volta_quando_so_o_resto_do_plano_muda(self):
        antes = [entrada("login", ["a/"], estado="concluido")]
        novo = achado("login", ["a/"])
        novo["plano"]["raias"][0]["verificacao"] = "pnpm lint"
        nova = fila.enfileirar(antes, [novo], self.AGORA)
        self.assertEqual([e["estado"] for e in nova], ["concluido", "aguardando"])

    def test_concluido_antigo_sem_hash_nao_volta_e_ganha_o_hash(self):
        antes = [entrada("login", ["a/"], estado="concluido")]
        del antes[0]["hash"]
        nova = fila.enfileirar(antes, [achado("login", ["a/"])], self.AGORA)
        self.assertEqual(len(nova), 1)
        self.assertEqual(nova[0]["hash"], fila.hash_do_plano(plano_com(["a/"])))

    def test_aguardando_guarda_o_hash_novo(self):
        antes = [entrada("login", ["a/"])]
        novo = achado("login", ["a/"])
        novo["plano"]["raias"][0]["verificacao"] = "pnpm lint"
        nova = fila.enfileirar(antes, [novo], self.AGORA)
        self.assertEqual(nova[0]["hash"], fila.hash_do_plano(novo["plano"]))

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

    def test_admitindo_bloqueia_como_ativo_e_nao_e_admitido_de_novo(self):
        lista = [entrada("a", ["src/a/"], estado="admitindo"), entrada("b", ["src/a/"])]
        self.assertEqual(fila.admitir(lista), [])
        self.assertEqual(fila.marcar(lista, lista[0]["id"], "ativo")[0]["estado"], "ativo")

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
            fila.ESTADOS, ("aguardando", "admitindo", "ativo", "pausado", "concluido", "removido")
        )


class TestesHashDoPlano(unittest.TestCase):
    def test_e_o_sha256_do_json_canonico(self):
        plano = {"b": 1, "a": ["é"]}
        texto = json.dumps(plano, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        self.assertEqual(
            fila.hash_do_plano(plano), hashlib.sha256(texto.encode("utf-8")).hexdigest()
        )

    def test_ignora_a_ordem_das_chaves(self):
        self.assertEqual(fila.hash_do_plano({"a": 1, "b": 2}), fila.hash_do_plano({"b": 2, "a": 1}))

    def test_muda_com_o_conteudo(self):
        self.assertNotEqual(fila.hash_do_plano({"a": 1}), fila.hash_do_plano({"a": 2}))


class TestesEntradasMalformadas(unittest.TestCase):
    AGORA = "2026-11-03T12:00:00Z"

    def malformadas(self):
        base = entrada("m", ["src/"], estado="ativo")
        sem = lambda campo: {k: v for k, v in base.items() if k != campo}  # noqa: E731
        return [
            None,
            "texto",
            42,
            {},
            sem("id"),
            sem("estado"),
            sem("entrouEm"),
            sem("arquivos"),
            sem("repo"),
            {**base, "id": 7},
            {**base, "estado": "dormindo"},
            {**base, "estado": None},
            {**base, "entrouEm": 123},
            {**base, "entrouEm": "ontem"},
            {**base, "entrouEm": "2026-11-03T10:00:00+00:00"},
            {**base, "arquivos": None},
            {**base, "arquivos": "src/"},
            {**base, "arquivos": ["src/", 3]},
            {**base, "repo": 5},
        ]

    def test_admitir_nao_levanta_e_ignora_a_entrada_torta(self):
        boa = entrada("boa", ["src/"])
        for torta in self.malformadas():
            with self.subTest(torta=torta):
                self.assertEqual(fila.admitir([torta, boa]), [boa["id"]])

    def test_entrada_torta_aguardando_nao_e_admitida_nem_bloqueia(self):
        boa = entrada("boa", ["src/"], entrou="2026-11-03T05:00:00Z")
        torta = {**entrada("t", ["src/"], entrou="2026-11-03T01:00:00Z"), "arquivos": None}
        self.assertEqual(fila.admitir([torta, boa]), [boa["id"]])

    def test_entrada_torta_ativa_nao_bloqueia(self):
        boa = entrada("boa", ["src/"])
        torta = {**entrada("t", ["src/"], estado="ativo"), "arquivos": "src/"}
        self.assertEqual(fila.admitir([torta, boa]), [boa["id"]])

    def test_fila_que_nao_e_lista_vale_vazia(self):
        self.assertEqual(fila.admitir(None), [])
        self.assertEqual(fila.marcar(None, "x", "ativo"), [])
        self.assertEqual(fila.enfileirar(None, [], self.AGORA), [])

    def test_enfileirar_preserva_a_entrada_torta_como_esta(self):
        for torta in self.malformadas():
            with self.subTest(torta=torta):
                antes = [copy.deepcopy(torta)]
                nova = fila.enfileirar(antes, [achado("login", ["a/"])], self.AGORA)
                self.assertEqual(nova[0], torta)
                self.assertEqual(antes, [torta])
                self.assertEqual(nova[-1]["estado"], "aguardando")

    def test_enfileirar_nao_marca_removido_a_entrada_torta(self):
        torta = {**entrada("t", ["src/"]), "arquivos": None}
        self.assertEqual(fila.enfileirar([torta], [], self.AGORA), [torta])

    def test_marcar_nao_levanta_e_deixa_a_torta_como_esta(self):
        boa = entrada("boa", ["src/"])
        for torta in self.malformadas():
            with self.subTest(torta=torta):
                nova = fila.marcar([torta, boa], boa["id"], "ativo")
                self.assertEqual(nova[0], torta)
                self.assertEqual(nova[1]["estado"], "ativo")

    def test_marcar_ignora_a_torta_com_o_mesmo_id(self):
        boa = entrada("boa", ["src/"], estado="concluido")
        torta = {**boa, "arquivos": None}
        nova = fila.marcar([boa, torta], boa["id"], "ativo")
        self.assertEqual([nova[0]["estado"], nova[1]["estado"]], ["ativo", "concluido"])

    def test_descobertos_tortos_sao_ignorados(self):
        bom = achado("login", ["a/"])
        tortos = [
            None,
            "x",
            {},
            {**bom, "plano": None},
            {**bom, "plano": "texto"},
            {**bom, "plano": []},
            {**bom, "plano": plano_com([])},
            {**bom, "plano": plano_com(["a/", 3])},
            {**bom, "repo": None},
            {**bom, "repo": "semslash"},
            {**bom, "repo": "a/b/c"},
            {**bom, "caminho": None},
        ]
        nova = fila.enfileirar([], [*tortos, bom], self.AGORA)
        self.assertEqual([e["feature"] for e in nova], ["login"])

    def test_descobertos_none_vale_vazio(self):
        antes = [entrada("login", ["a/"], estado="ativo")]
        self.assertEqual(fila.enfileirar(antes, None, self.AGORA), antes)
        self.assertEqual(fila.enfileirar([], None, self.AGORA), [])


class TestesFormatoDoInstante(unittest.TestCase):
    def test_agora_so_aceita_iso_8601_utc_com_z(self):
        for agora in (
            "2026-11-03T12:00:00+00:00",
            "2026-11-03T09:00:00-03:00",
            "2026-11-03T12:00:00.123Z",
            "2026-11-03 12:00:00Z",
            "2026-11-03T12:00:00",
            "2026-13-03T12:00:00Z",
            "2026-1-3T12:00:00Z",
            "2026-11-03T12:00:00Z\n",
            "",
            None,
            1762171200,
        ):
            with self.subTest(agora=agora):
                with self.assertRaises(ValueError):
                    fila.enfileirar([], [achado("login", ["a/"])], agora)

    def test_agora_valido_e_gravado_como_esta(self):
        nova = fila.enfileirar([], [achado("login", ["a/"])], "2026-11-03T12:00:00Z")
        self.assertEqual(nova[0]["entrouEm"], "2026-11-03T12:00:00Z")

    def test_agora_invalido_levanta_mesmo_sem_descobertos(self):
        with self.assertRaises(ValueError):
            fila.enfileirar([], [], "ontem")

    def test_a_ordem_de_admissao_segue_o_instante(self):
        lista = [
            entrada("novo", ["src/"], entrou="2026-11-03T12:00:01Z"),
            entrada("velho", ["src/"], entrou="2026-11-03T12:00:00Z"),
        ]
        self.assertEqual(fila.admitir(lista), [lista[1]["id"]])


class TestesAguardandoRepetido(unittest.TestCase):
    def test_todas_as_entradas_aguardando_do_id_seguem_o_descoberto(self):
        antes = [entrada("login", ["a/"]), entrada("login", ["b/"], entrou="2026-11-03T11:00:00Z")]
        nova = fila.enfileirar(antes, [achado("login", ["c/"])], "2026-11-03T12:00:00Z")
        self.assertEqual([e["arquivos"] for e in nova], [["c/"], ["c/"]])


class TestesConsistenciaComTask1(unittest.TestCase):
    def test_plano_de_teste_e_valido_para_o_raias(self):
        self.assertEqual(raias.validar_plano(plano_com(["a/"], ["b/"])), [])


if __name__ == "__main__":
    unittest.main()
