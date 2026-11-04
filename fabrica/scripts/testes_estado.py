import copy
import datetime
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import estado as est  # noqa: E402
import raias  # noqa: E402

PROTEGIDOS = ["**/migrations/**"]
PR_URL = "https://github.com/dono/nome/pull/1"


def _raia(id_, papel, plano_seeds, depende, arquivos):
    return {
        "id": id_,
        "papel": papel,
        "planoSeeds": plano_seeds,
        "dependeDe": depende,
        "arquivos": arquivos,
        "verificacao": "pnpm test",
        "criteriosAceite": [f"{id_} pronta"],
    }


def plano(fase="nucleo"):
    return {
        "versao": 1,
        "faseAtual": fase,
        "fases": [
            {"id": "fundacao", "raias": ["fundacao"]},
            {"id": "nucleo", "raias": ["a", "b", "c", "d"]},
        ],
        "raias": [
            _raia("fundacao", "arquiteto", "pl-0000", [], ["prisma/"]),
            _raia("a", "backend", "pl-000a", ["fundacao"], ["src/a/"]),
            _raia("b", "backend", "pl-000b", ["fundacao"], ["src/b/"]),
            _raia("c", "frontend", "pl-000c", ["fundacao"], ["src/c/"]),
            _raia("d", "qa", "pl-000d", ["fundacao"], ["e2e/"]),
        ],
    }


def plano_com_raia_e():
    p = plano()
    p["fases"][1]["raias"].append("e")
    p["raias"].append(_raia("e", "backend", "pl-000e", ["fundacao"], ["src/e/"]))
    return p


def veredito(sha, resultado="aprovado", achados=None):
    return {"sha": sha, "resultado": resultado, "achados": achados or []}


def verificacao(sha, codigo=0):
    return {"sha": sha, "codigo": codigo, "saida": "ok"}


def filho(seed="s1", estado="pr_open", run="r1", pr=PR_URL):
    return {"seedId": seed, "estado": estado, "runId": run, "prUrl": pr}


def estado_inicial(limite=3):
    e = est.novo_estado(plano(), projeto="prj_x", repo="dono/nome", limite_paralelo=limite)
    e["raias"]["fundacao"]["estado"] = "concluida"
    return e


def despachar(e, raia, plan_run="plan_"):
    return est.aplicar(
        e, {"tipo": "despachar_raia", "raia": raia}, {"planRunId": plan_run + raia}
    )


def com_pr(sha="bbb", arquivos=None, ci="verde"):
    """Raia `a` executando com a seed `s1` em revisão, PR lido no head `sha`."""
    e = despachar(estado_inicial(), "a")
    e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho()])
    return est.registrar_pr(
        e,
        "s1",
        head_sha=sha,
        branch="warren/s1",
        arquivos=["src/a/x.ts"] if arquivos is None else arquivos,
        ci=ci,
    )


def revisar(e, sha, run_id, v):
    """Dispara a revisão e encerra o run com o veredito `v` (ou None)."""
    e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": sha}, {"runId": run_id})
    return est.registrar_fim_de_run(
        e, run_id, estado_run="succeeded", motivo_falha=None, veredito=v, cota=False
    )


def verificar(e, sha, codigo=0):
    return est.aplicar(
        e,
        {"tipo": "verificar", "seed": "s1", "sha": sha},
        {"verificacao": verificacao(sha, codigo)},
    )


def tudo_verde(sha="bbb", **kw):
    e = com_pr(sha=sha, **kw)
    e = revisar(e, sha, "rv1", veredito(sha))
    return verificar(e, sha)


def acoes(e, p=None, protegidos=None):
    return est.proximas_acoes(
        e, plano() if p is None else p, PROTEGIDOS if protegidos is None else protegidos
    )


def da_seed(lista, seed="s1"):
    return [a for a in lista if a.get("seed") == seed or a.get("alvo") == seed]


def dos_tipos(lista, *tipos):
    return [a for a in lista if a["tipo"] in tipos]


def corrigir_apos_gate_vermelho(sha="bbb", novo="ccc"):
    """Gate vermelho → corrigir → fixer termina → novo head → nova revisão e verificação."""
    e = tudo_verde(sha=sha, ci="vermelho")
    [acao] = da_seed(acoes(e))
    e = est.aplicar(e, acao, {"runId": "fx1"})
    e = est.registrar_fim_de_run(
        e, "fx1", estado_run="succeeded", motivo_falha=None, veredito=None, cota=False
    )
    e = est.registrar_pr(e, "s1", head_sha=novo, branch="warren/s1", arquivos=["src/a/x.ts"], ci="vermelho")
    e = revisar(e, novo, "rv2", veredito(novo))
    return verificar(e, novo)


class TestNovoEstado(unittest.TestCase):
    def test_plano_da_fixture_e_valido(self):
        self.assertEqual(raias.validar_plano(plano()), [])

    def test_novo_estado_tem_o_formato_exato(self):
        e = est.novo_estado(plano(), projeto="prj_x", repo="dono/nome")
        raia = {"estado": "planejada", "planRunId": None, "retomar": False, "retomadas": 0, "falha": None}
        planos = {"fundacao": "pl-0000", "a": "pl-000a", "b": "pl-000b", "c": "pl-000c", "d": "pl-000d"}
        self.assertEqual(
            e,
            {
                "projeto": "prj_x",
                "repo": "dono/nome",
                "limiteParalelo": 3,
                "pausado": None,
                "raias": {i: dict(raia, planoSeeds=ps) for i, ps in planos.items()},
                "seeds": {},
                "orquestrador": {"runId": None, "motivo": None},
                "chavesAcordadas": [],
                "falhasAcordar": 0,
                "runsOom": [],
                "avisos": [],
                "decisoes": [],
            },
        )

    def test_novo_estado_aceita_limite_e_plano_malformado(self):
        self.assertEqual(est.novo_estado(plano(), projeto="p", repo="r", limite_paralelo=5)["limiteParalelo"], 5)
        e = est.novo_estado({"raias": [None, {"id": 3}, {"id": "x"}]}, projeto="p", repo="r")
        self.assertEqual(list(e["raias"]), ["x"])
        self.assertEqual(est.novo_estado("lixo", projeto="p", repo="r")["raias"], {})

    def test_sincronizar_acrescenta_raias_novas_e_preserva_as_existentes(self):
        e = despachar(estado_inicial(), "a")
        novo = est.sincronizar_plano(e, plano_com_raia_e())
        self.assertEqual(novo["raias"]["a"], e["raias"]["a"])
        self.assertEqual(novo["raias"]["fundacao"]["estado"], "concluida")
        self.assertEqual(novo["raias"]["e"]["estado"], "planejada")
        self.assertEqual(novo["raias"]["e"]["retomadas"], 0)
        self.assertEqual(list(novo["raias"])[-1], "e")


class TestDespacho(unittest.TestCase):
    def test_despacha_so_raias_prontas_ate_o_limite(self):
        e = estado_inicial()
        lista = acoes(e)
        self.assertEqual(lista, [{"tipo": "despachar_raia", "raia": r} for r in ["a", "b", "c"]])
        for acao in lista:
            e = est.aplicar(e, acao, {"planRunId": "plan_" + acao["raia"]})
        self.assertEqual(e["raias"]["a"], {"estado": "executando", "planRunId": "plan_a", "retomar": False, "retomadas": 0, "falha": None, "planoSeeds": "pl-000a"})
        self.assertEqual(acoes(e), [])

    def test_sem_fundacao_concluida_nada_e_despachado(self):
        e = est.novo_estado(plano(), projeto="p", repo="r")
        self.assertEqual(acoes(e), [])
        self.assertEqual(acoes(e, plano("fundacao")), [{"tipo": "despachar_raia", "raia": "fundacao"}])

    def test_vaga_liberada_despacha_a_proxima(self):
        e = estado_inicial()
        for r in ["a", "b", "c"]:
            e = despachar(e, r)
        e = est.registrar_plano(e, "a", estado_plano="succeeded", falha=None, filhos=[])
        self.assertEqual(e["raias"]["a"]["estado"], "concluida")
        self.assertEqual(acoes(e), [{"tipo": "despachar_raia", "raia": "d"}])

    def test_limite_conta_raias_executando_de_outras_fases(self):
        e = estado_inicial(limite=2)
        e["raias"]["fundacao"]["estado"] = "concluida"
        e = despachar(e, "a")
        self.assertEqual(dos_tipos(acoes(e), "despachar_raia"), [{"tipo": "despachar_raia", "raia": "b"}])

    def test_limite_malformado_nao_despacha(self):
        for limite in [None, "3", True, -1]:
            e = estado_inicial()
            e["limiteParalelo"] = limite
            self.assertEqual(dos_tipos(acoes(e), "despachar_raia"), [], limite)

    def test_raia_falhou_nao_e_redespachada(self):
        e = despachar(estado_inicial(), "a")
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="run_failed", filhos=[])
        despachos = [a["raia"] for a in dos_tipos(acoes(e), "despachar_raia")]
        self.assertNotIn("a", despachos)
        self.assertEqual(despachos, ["b", "c", "d"])

    def test_raia_fora_do_estado_nao_e_despachada(self):
        e = estado_inicial()
        del e["raias"]["b"]
        self.assertEqual([a["raia"] for a in acoes(e)], ["a", "c", "d"])

    def test_despacho_sem_plan_run_id_falha_a_raia_sem_redespachar(self):
        e = est.aplicar(estado_inicial(), {"tipo": "despachar_raia", "raia": "a"}, {})
        self.assertEqual(e["raias"]["a"]["estado"], "falhou")
        self.assertNotIn({"tipo": "despachar_raia", "raia": "a"}, acoes(e))
        self.assertTrue(e["avisos"])

    def test_despacho_de_raia_ja_executando_nao_troca_o_plan_run(self):
        e = despachar(estado_inicial(), "a")
        e = est.aplicar(e, {"tipo": "despachar_raia", "raia": "a"}, {"planRunId": "outro"})
        self.assertEqual(e["raias"]["a"]["planRunId"], "plan_a")
        self.assertTrue(e["avisos"])


class TestRegistrarPlano(unittest.TestCase):
    def setUp(self):
        self.e = despachar(estado_inicial(), "a")

    def registrar(self, filhos, estado_plano="running", falha=None, raia="a", e=None):
        return est.registrar_plano(
            self.e if e is None else e, raia, estado_plano=estado_plano, falha=falha, filhos=filhos
        )

    def test_vocabulario_dos_filhos(self):
        e = self.registrar(
            [
                filho("s1", "pending"),
                filho("s2", "dispatched"),
                filho("s3", "running"),
                filho("s4", "pr_open", pr="https://github.com/dono/nome/pull/4"),
                filho("s5", "merged"),
                filho("s6", "failed"),
            ]
        )
        self.assertNotIn("s1", e["seeds"])
        self.assertEqual(
            {s: e["seeds"][s]["estado"] for s in e["seeds"]},
            {"s2": "executando", "s3": "executando", "s4": "em_revisao", "s5": "mergeada", "s6": "falhou"},
        )
        self.assertEqual(e["seeds"]["s4"]["pr"], "https://github.com/dono/nome/pull/4")
        self.assertEqual({s["raia"] for s in e["seeds"].values()}, {"a"})
        self.assertEqual(e["avisos"], [])

    def test_seed_que_falhou_volta_a_executar_se_redespachada(self):
        e = self.registrar([filho("s1", "failed")])
        self.assertEqual(e["seeds"]["s1"]["estado"], "falhou")
        e = self.registrar([filho("s1", "running", run="r2")], e=e)
        self.assertEqual((e["seeds"]["s1"]["estado"], e["seeds"]["s1"]["runId"]), ("executando", "r2"))

    def test_seed_nova_tem_o_formato_exato(self):
        e = self.registrar([filho("s1", "running", run="r1", pr=None)])
        self.assertEqual(
            e["seeds"]["s1"],
            {
                "raia": "a",
                "estado": "executando",
                "runId": "r1",
                "pr": None,
                "branch": None,
                "headSha": None,
                "arquivos": [],
                "ci": None,
                "verificacao": None,
                "veredito": None,
                "vereditoAnterior": None,
                "revisaoRunId": None,
                "tentativasRevisao": 0,
                "fixerRunId": None,
                "fixerUsado": False,
                "tentativasMerge": 0,
                "interrupcoes": 0,
                "pendenteHumano": None,
                "motivoHumano": None,
            },
        )

    def test_pr_open_so_promove_seed_executando(self):
        e = self.registrar([filho("s1", "running")])
        e = self.registrar([filho("s1", "pr_open")], e=e)
        self.assertEqual(e["seeds"]["s1"]["estado"], "em_revisao")
        self.assertEqual(e["seeds"]["s1"]["pr"], PR_URL)
        for outro in ["corrigindo", "aguardando_gates", "bloqueada_humano", "mergeada", "falhou"]:
            e["seeds"]["s1"]["estado"] = outro
            self.assertEqual(self.registrar([filho("s1", "pr_open")], e=e)["seeds"]["s1"]["estado"], outro)

    def test_pr_open_sem_url_nao_promove(self):
        for anterior in [[], [filho("s1", "running")]]:
            e = self.registrar(anterior)
            e = self.registrar([filho("s1", "pr_open", pr=None)], e=e)
            self.assertEqual((e["seeds"]["s1"]["estado"], e["seeds"]["s1"]["pr"]), ("executando", None))
            self.assertTrue(e["avisos"])
            e = self.registrar([filho("s1", "pr_open")], e=e)
            self.assertEqual(e["seeds"]["s1"]["estado"], "em_revisao")

    def test_running_nao_rebaixa_seed_em_revisao_nem_mergeada(self):
        e = self.registrar([filho("s1", "pr_open")])
        for estado in ["em_revisao", "corrigindo", "aguardando_gates", "bloqueada_humano", "mergeada"]:
            e["seeds"]["s1"]["estado"] = estado
            for obs in ["running", "dispatched"]:
                self.assertEqual(self.registrar([filho("s1", obs)], e=e)["seeds"]["s1"]["estado"], estado)
        e["seeds"]["s1"]["estado"] = "mergeada"
        self.assertEqual(self.registrar([filho("s1", "failed")], e=e)["seeds"]["s1"]["estado"], "mergeada")

    def test_estado_do_plano(self):
        self.assertEqual(self.registrar([], "succeeded")["raias"]["a"]["estado"], "concluida")
        self.assertEqual(self.registrar([], "cancelled")["raias"]["a"]["estado"], "falhou")
        falhou = self.registrar([], "failed", "run_failed")["raias"]["a"]
        self.assertEqual((falhou["estado"], falhou["falha"], falhou["retomar"]), ("falhou", "run_failed", False))
        self.assertEqual(self.registrar([], "running")["raias"]["a"]["estado"], "executando")

    def test_observacoes_malformadas_nao_quebram(self):
        lixo = [None, "x", {}, {"seedId": 3, "estado": "running"}, {"seedId": "s9", "estado": "voando"}, {"seedId": "s8"}]
        e = self.registrar(lixo, estado_plano="??")
        self.assertEqual(e["seeds"], {})
        self.assertEqual(e["raias"]["a"]["estado"], "executando")
        self.assertTrue(any("voando" in a for a in e["avisos"]))
        self.assertEqual(self.registrar("nada")["seeds"], {})

    def test_raia_desconhecida_ou_parada_e_ignorada(self):
        e = self.registrar([filho("s1", "running")], "succeeded", raia="zzz")
        self.assertEqual(e["seeds"], {})
        self.assertTrue(e["avisos"])
        e = self.registrar([filho("s1", "running")], "failed", "x", raia="b")
        self.assertEqual(e["raias"]["b"]["estado"], "planejada")
        self.assertEqual(e["seeds"], {})

    def test_seed_de_outra_raia_mantem_a_raia_original(self):
        e = self.registrar([filho("s1", "running")])
        e = despachar(e, "b")
        e = self.registrar([filho("s1", "pr_open")], raia="b", e=e)
        self.assertEqual(e["seeds"]["s1"]["raia"], "a")

    def test_timeout_de_merge_retoma_ate_tres_vezes_e_depois_falha(self):
        e = self.e
        timeout = "child_pr_merge_timeout"
        for n in range(3):
            e = self.registrar([], "failed", timeout, e=e)
            raia = e["raias"]["a"]
            self.assertEqual((raia["estado"], raia["retomar"], raia["retomadas"]), ("executando", True, n))
            # observar de novo antes de retomar não conta outra retomada
            e = self.registrar([], "failed", timeout, e=e)
            self.assertEqual(e["raias"]["a"]["retomadas"], n)
            lista = acoes(e)
            self.assertIn({"tipo": "retomar_raia", "raia": "a"}, lista)
            self.assertEqual(lista, acoes(e))
            e = est.aplicar(e, {"tipo": "retomar_raia", "raia": "a"}, {})
            self.assertEqual((e["raias"]["a"]["retomar"], e["raias"]["a"]["retomadas"]), (False, n + 1))
            self.assertNotIn({"tipo": "retomar_raia", "raia": "a"}, acoes(e))
            e = self.registrar([], "running", e=e)
        e = self.registrar([], "failed", timeout, e=e)
        raia = e["raias"]["a"]
        self.assertEqual((raia["estado"], raia["retomar"], raia["retomadas"]), ("falhou", False, 3))
        self.assertNotIn("retomar_raia", [a["tipo"] for a in acoes(e)])
        self.assertIn({"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}, acoes(e))

    def test_retomar_adiado_mantem_o_pedido(self):
        e = self.registrar([], "failed", "child_pr_merge_timeout")
        e2 = est.aplicar(e, {"tipo": "retomar_raia", "raia": "a"}, {"adiado": True})
        self.assertEqual(e2, e)
        self.assertIn({"tipo": "retomar_raia", "raia": "a"}, acoes(e2))


class TestRegistrarPrEVerificacao(unittest.TestCase):
    def test_registrar_pr_grava_head_branch_arquivos_e_ci(self):
        e = com_pr(sha="bbb", arquivos=["src/a/x.ts", "src/a/y.ts"], ci="pendente")
        s = e["seeds"]["s1"]
        self.assertEqual(
            (s["headSha"], s["branch"], s["arquivos"], s["ci"]),
            ("bbb", "warren/s1", ["src/a/x.ts", "src/a/y.ts"], "pendente"),
        )

    def test_registrar_pr_com_head_invalido_zera_o_head(self):
        e = com_pr(sha="bbb")
        for ruim in [None, "", 3]:
            e2 = est.registrar_pr(e, "s1", head_sha=ruim, branch="warren/s1", arquivos=[], ci="verde")
            self.assertIsNone(e2["seeds"]["s1"]["headSha"])
            self.assertTrue(e2["avisos"])
            self.assertEqual(da_seed(acoes(e2)), [])

    def test_registrar_de_seed_inexistente_nao_quebra(self):
        e = estado_inicial()
        e1 = est.registrar_pr(e, "nada", head_sha="x", branch="b", arquivos=[], ci="verde")
        e2 = est.registrar_verificacao(e, "nada", verificacao("x"))
        for novo in [e1, e2]:
            self.assertEqual(novo["seeds"], {})
            self.assertTrue(novo["avisos"])

    def test_registrar_verificacao_grava(self):
        e = est.registrar_verificacao(com_pr(), "s1", verificacao("bbb", 2))
        self.assertEqual(e["seeds"]["s1"]["verificacao"], verificacao("bbb", 2))

    def test_avisos_nao_se_repetem(self):
        e = estado_inicial()
        for _ in range(3):
            e = est.registrar_pr(e, "nada", head_sha="x", branch="b", arquivos=[], ci="verde")
        self.assertEqual(len(e["avisos"]), 1)


class TestGates(unittest.TestCase):
    def test_pr_open_leva_seed_a_em_revisao_e_pede_revisao_e_verificacao(self):
        e = com_pr(sha="bbb")
        self.assertEqual(e["seeds"]["s1"]["estado"], "em_revisao")
        self.assertEqual(e["seeds"]["s1"]["pr"], PR_URL)
        self.assertEqual(
            da_seed(acoes(e)),
            [{"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"tipo": "verificar", "seed": "s1", "sha": "bbb"}],
        )

    def test_sem_head_nao_age(self):
        e = despachar(estado_inicial(), "a")
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho()])
        self.assertEqual(da_seed(acoes(e)), [])

    def test_ci_nao_lido_decide_pelo_faltando(self):
        e = com_pr(sha="bbb", ci=None)
        self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["revisar", "verificar"])
        e = revisar(e, "bbb", "rv1", veredito("bbb"))
        e = verificar(e, "bbb")
        self.assertEqual(da_seed(acoes(e)), [])

    def test_so_a_verificacao_faltando_pede_so_verificar(self):
        e = revisar(com_pr(sha="bbb"), "bbb", "rv1", veredito("bbb"))
        self.assertEqual(e["seeds"]["s1"]["estado"], "aguardando_gates")
        self.assertEqual(da_seed(acoes(e)), [{"tipo": "verificar", "seed": "s1", "sha": "bbb"}])

    def test_ci_pendente_espera(self):
        self.assertEqual(da_seed(acoes(tudo_verde(ci="pendente"))), [])

    def test_tudo_verde_emite_mergear_com_sha_do_head(self):
        e = tudo_verde(sha="bbb")
        self.assertEqual(da_seed(acoes(e)), [{"tipo": "mergear", "seed": "s1", "sha": "bbb"}])
        self.assertEqual(est.aplicar(e, {"tipo": "mergear", "seed": "s1", "sha": "bbb"}, {"ok": True})["seeds"]["s1"]["estado"], "mergeada")

    def test_merge_recusado_conta_e_na_terceira_vai_para_o_paulo(self):
        e = tudo_verde()
        acao = {"tipo": "mergear", "seed": "s1", "sha": "bbb"}
        for n in [1, 2]:
            e = est.aplicar(e, acao, {"ok": False})
            s = e["seeds"]["s1"]
            self.assertEqual((s["tentativasMerge"], s["estado"], s["pendenteHumano"]), (n, "aguardando_gates", None))
            self.assertEqual(da_seed(acoes(e)), [acao])
        e = est.aplicar(e, acao, {"ok": False})
        humano = {"tipo": "aguardar_humano", "seed": "s1", "motivos": ["merge recusado pelo GitHub 3 vezes"]}
        self.assertEqual(e["seeds"]["s1"]["pendenteHumano"], "merge recusado pelo GitHub 3 vezes")
        self.assertEqual(da_seed(acoes(e)), [humano])
        self.assertEqual(acoes(e), acoes(e))
        e = est.aplicar(e, humano, {})
        s = e["seeds"]["s1"]
        self.assertEqual((s["estado"], s["motivoHumano"], s["pendenteHumano"]), ("bloqueada_humano", "merge recusado pelo GitHub 3 vezes", None))
        self.assertEqual(da_seed(acoes(e)), [])

    def test_resultado_de_merge_malformado_conta_como_recusa(self):
        e = tudo_verde()
        acao = {"tipo": "mergear", "seed": "s1", "sha": "bbb"}
        for resultado in [{}, {"ok": "sim"}, {"ok": 1}]:
            novo = est.aplicar(e, acao, resultado)
            self.assertEqual((novo["seeds"]["s1"]["tentativasMerge"], novo["seeds"]["s1"]["estado"]), (1, "aguardando_gates"))
        e["seeds"]["s1"]["tentativasMerge"] = "x"
        self.assertTrue(est.aplicar(e, acao, {"ok": False})["seeds"]["s1"]["pendenteHumano"])

    def test_recusas_de_merge_zeram_quando_o_head_muda(self):
        e = tudo_verde(sha="bbb")
        for _ in range(2):
            e = est.aplicar(e, {"tipo": "mergear", "seed": "s1", "sha": "bbb"}, {"ok": False})
        mesmo = est.registrar_pr(e, "s1", head_sha="bbb", branch="warren/s1", arquivos=["src/a/x.ts"], ci="verde")
        self.assertEqual(mesmo["seeds"]["s1"]["tentativasMerge"], 2)
        # head ilegível no meio não zera: não dá para saber se mudou
        ilegivel = est.registrar_pr(e, "s1", head_sha=None, branch="warren/s1", arquivos=["src/a/x.ts"], ci="verde")
        ilegivel = est.registrar_pr(ilegivel, "s1", head_sha="ccc", branch="warren/s1", arquivos=["src/a/x.ts"], ci="verde")
        self.assertEqual(ilegivel["seeds"]["s1"]["tentativasMerge"], 2)
        e = est.registrar_pr(e, "s1", head_sha="ccc", branch="warren/s1", arquivos=["src/a/x.ts"], ci="verde")
        self.assertEqual(e["seeds"]["s1"]["tentativasMerge"], 0)
        e = revisar(e, "ccc", "rv2", veredito("ccc"))
        e = verificar(e, "ccc")
        acao = {"tipo": "mergear", "seed": "s1", "sha": "ccc"}
        for _ in range(2):
            e = est.aplicar(e, acao, {"ok": False})
        self.assertEqual(da_seed(acoes(e)), [acao])

    def test_seed_de_raia_falhou_nunca_recebe_mergear(self):
        e = tudo_verde()
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="run_failed", filhos=[])
        self.assertEqual(e["raias"]["a"]["estado"], "falhou")
        self.assertNotIn("mergear", [a["tipo"] for a in acoes(e)])
        self.assertEqual(da_seed(acoes(e)), [])
        self.assertIn({"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}, acoes(e))
        # as outras decisões da seed continuam (revisão de um head novo, por exemplo)
        e = est.registrar_pr(e, "s1", head_sha="ccc", branch="warren/s1", arquivos=["src/a/x.ts"], ci="verde")
        self.assertIn({"tipo": "revisar", "seed": "s1", "sha": "ccc"}, acoes(e))
        e["raias"]["a"]["estado"] = "executando"
        e = revisar(e, "ccc", "rv2", veredito("ccc"))
        e = verificar(e, "ccc")
        self.assertIn({"tipo": "mergear", "seed": "s1", "sha": "ccc"}, acoes(e))

    def test_veredito_de_sha_antigo_pede_nova_revisao(self):
        e = com_pr(sha="aaa")
        e = revisar(e, "aaa", "rv1", veredito("aaa"))
        e = verificar(e, "aaa")
        e = est.registrar_pr(e, "s1", head_sha="bbb", branch="warren/s1", arquivos=["src/a/x.ts"], ci="verde")
        lista = da_seed(acoes(e))
        self.assertIn({"tipo": "revisar", "seed": "s1", "sha": "bbb"}, lista)
        self.assertIn({"tipo": "verificar", "seed": "s1", "sha": "bbb"}, lista)
        self.assertNotIn("mergear", [a["tipo"] for a in lista])

    def test_corrigir_uma_vez_depois_acorda(self):
        e = tudo_verde(sha="bbb", ci="vermelho")
        [corrigir] = da_seed(acoes(e))
        self.assertEqual(corrigir["tipo"], "corrigir")
        self.assertEqual((corrigir["seed"], corrigir["sha"]), ("s1", "bbb"))
        self.assertEqual(corrigir["motivos"], ["CI vermelho"])
        self.assertEqual(corrigir["achados"], [])
        e = est.aplicar(e, corrigir, {"runId": "fx1"})
        s = e["seeds"]["s1"]
        self.assertEqual(
            (s["estado"], s["fixerRunId"], s["fixerUsado"], s["veredito"], s["tentativasRevisao"]),
            ("corrigindo", "fx1", True, None, 0),
        )
        self.assertEqual(da_seed(acoes(e)), [])
        e = est.registrar_fim_de_run(e, "fx1", estado_run="succeeded", motivo_falha=None, veredito=None, cota=False)
        self.assertEqual((e["seeds"]["s1"]["estado"], e["seeds"]["s1"]["fixerRunId"]), ("corrigindo", None))
        e = est.registrar_pr(e, "s1", head_sha="ccc", branch="warren/s1", arquivos=["src/a/x.ts"], ci="vermelho")
        self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["revisar", "verificar"])
        e = revisar(e, "ccc", "rv2", veredito("ccc"))
        e = verificar(e, "ccc")
        acordar = {"tipo": "acordar", "motivo": "gate_falhou_apos_fixer", "alvo": "s1"}
        self.assertEqual(da_seed(acoes(e)), [acordar])
        e = est.aplicar(e, acordar, {"runId": "orq1"})
        self.assertEqual(e["orquestrador"], {"runId": "orq1", "motivo": "gate_falhou_apos_fixer"})
        self.assertEqual(e["chavesAcordadas"], ["gate_falhou_apos_fixer:s1"])
        self.assertEqual(dos_tipos(acoes(e), "acordar", "corrigir"), [])
        e["orquestrador"] = {"runId": None, "motivo": None}
        self.assertEqual(dos_tipos(acoes(e), "acordar", "corrigir"), [])

    def test_corrigir_leva_achados_e_motivos_do_revisor(self):
        achados = [{"arquivo": "src/a/x.ts", "motivo": "sem teste"}]
        e = com_pr(sha="bbb")
        e = revisar(e, "bbb", "rv1", veredito("bbb", "correcoes", achados))
        e = verificar(e, "bbb", codigo=1)
        [acao] = da_seed(acoes(e))
        self.assertEqual(acao["tipo"], "corrigir")
        self.assertEqual(acao["achados"], achados)
        self.assertEqual(acao["motivos"], ["verificação falhou (código 1)", "revisão pediu correções: src/a/x.ts: sem teste"])

    def test_fixer_usado_malformado_conta_como_usado(self):
        for valor in ["talvez", None, 0, ""]:
            e = tudo_verde(ci="vermelho")
            e["seeds"]["s1"]["fixerUsado"] = valor
            self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["acordar"], valor)
        del e["seeds"]["s1"]["fixerUsado"]
        self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["acordar"])

    def test_fim_do_fixer_descarta_veredito_gravado_durante_o_run(self):
        e = tudo_verde(ci="vermelho")
        e = est.aplicar(e, da_seed(acoes(e))[0], {"runId": "fx1"})
        e["seeds"]["s1"]["veredito"] = veredito("bbb")
        e = est.registrar_fim_de_run(e, "fx1", estado_run="succeeded", motivo_falha=None, veredito=None, cota=False)
        self.assertEqual((e["seeds"]["s1"]["estado"], e["seeds"]["s1"]["veredito"]), ("corrigindo", None))
        self.assertIn({"tipo": "revisar", "seed": "s1", "sha": "bbb"}, acoes(e))

    def test_revisor_sem_veredito_tenta_de_novo_uma_vez_e_depois_humano(self):
        e = verificar(com_pr(sha="bbb"), "bbb")
        self.assertEqual(da_seed(acoes(e)), [{"tipo": "revisar", "seed": "s1", "sha": "bbb"}])
        e = revisar(e, "bbb", "rv1", None)
        s = e["seeds"]["s1"]
        self.assertEqual((s["estado"], s["revisaoRunId"], s["tentativasRevisao"], s["veredito"]), ("em_revisao", None, 1, None))
        self.assertEqual(da_seed(acoes(e)), [{"tipo": "revisar", "seed": "s1", "sha": "bbb"}])
        e = revisar(e, "bbb", "rv2", None)
        humano = {"tipo": "aguardar_humano", "seed": "s1", "motivos": ["revisor sem veredito válido"]}
        self.assertEqual(da_seed(acoes(e)), [humano])
        e = est.aplicar(e, humano, {})
        self.assertEqual((e["seeds"]["s1"]["estado"], e["seeds"]["s1"]["motivoHumano"]), ("bloqueada_humano", "revisor sem veredito válido"))
        self.assertEqual(da_seed(acoes(e)), [])

    def test_revisor_esgotado_nao_pede_verificacao(self):
        e = com_pr(sha="bbb")
        e["seeds"]["s1"]["tentativasRevisao"] = 2
        self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["aguardar_humano"])

    def test_tentativas_malformadas_contam_como_esgotadas(self):
        e = com_pr(sha="bbb")
        e["seeds"]["s1"]["tentativasRevisao"] = "0"
        self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["aguardar_humano"])

    def test_run_de_revisao_que_falhou_nao_grava_veredito(self):
        e = com_pr(sha="bbb")
        e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv1"})
        e = est.registrar_fim_de_run(e, "rv1", estado_run="failed", motivo_falha="x", veredito=veredito("bbb"), cota=False)
        s = e["seeds"]["s1"]
        self.assertEqual((s["veredito"], s["revisaoRunId"], s["estado"]), (None, None, "em_revisao"))

    def test_veredito_nao_tira_seed_de_estado_terminal(self):
        e = com_pr(sha="bbb")
        e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv1"})
        e["seeds"]["s1"]["estado"] = "bloqueada_humano"
        e = est.registrar_fim_de_run(e, "rv1", estado_run="succeeded", motivo_falha=None, veredito=veredito("bbb"), cota=False)
        self.assertEqual(e["seeds"]["s1"]["estado"], "bloqueada_humano")

    def test_fixer_que_falhou_leva_seed_a_falhou(self):
        for estado_run in ["failed", "cancelled", "??"]:
            e = est.aplicar(tudo_verde(ci="vermelho"), {"tipo": "corrigir", "seed": "s1", "sha": "bbb", "motivos": [], "achados": []}, {"runId": "fx1"})
            e = est.registrar_fim_de_run(e, "fx1", estado_run=estado_run, motivo_falha="x", veredito=None, cota=False)
            self.assertEqual((e["seeds"]["s1"]["estado"], e["seeds"]["s1"]["fixerRunId"]), ("falhou", None), estado_run)
            self.assertEqual(da_seed(acoes(e)), [{"tipo": "acordar", "motivo": "gate_falhou_apos_fixer", "alvo": "s1"}])

    def test_fixer_que_falhou_com_raia_executando_acorda_o_orquestrador(self):
        e = est.aplicar(tudo_verde(ci="vermelho"), {"tipo": "corrigir", "seed": "s1", "sha": "bbb", "motivos": []}, {"runId": "fx1"})
        e = est.registrar_fim_de_run(e, "fx1", estado_run="failed", motivo_falha="no_changes", veredito=None, cota=False)
        e["raias"][e["seeds"]["s1"]["raia"]]["estado"] = "executando"
        e["seeds"]["s1"]["pr"] = "https://github.com/o/r/pull/1"
        plano_ = {"versao": 1, "faseAtual": None, "fases": [], "raias": []}
        self.assertIn(
            {"tipo": "acordar", "motivo": "gate_falhou_apos_fixer", "alvo": "s1"}, est.proximas_acoes(e, plano_, [])
        )
        e["raias"][e["seeds"]["s1"]["raia"]]["estado"] = "falhou"
        self.assertNotIn(
            {"tipo": "acordar", "motivo": "gate_falhou_apos_fixer", "alvo": "s1"}, est.proximas_acoes(e, plano_, [])
        )

    def test_seed_com_run_em_curso_nao_age(self):
        e = est.aplicar(com_pr(), {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv1"})
        e["seeds"]["s1"]["veredito"] = veredito("bbb")
        e["seeds"]["s1"]["verificacao"] = verificacao("bbb")
        self.assertEqual(da_seed(acoes(e)), [])
        e["seeds"]["s1"]["revisaoRunId"] = None
        e["seeds"]["s1"]["fixerRunId"] = "fx9"
        self.assertEqual(da_seed(acoes(e)), [])

    def test_seed_fora_dos_estados_de_gate_nao_age(self):
        e = tudo_verde()
        for estado in ["executando", "mergeada", "bloqueada_humano", "falhou", None]:
            e["seeds"]["s1"]["estado"] = estado
            self.assertEqual(da_seed(acoes(e)), [], estado)
        for estado in ["em_revisao", "aguardando_gates", "corrigindo"]:
            e["seeds"]["s1"]["estado"] = estado
            self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["mergear"], estado)

    def test_protegido_vai_para_humano_e_nao_repete(self):
        e = tudo_verde(arquivos=["prisma/migrations/001/x.sql"])
        [acao] = da_seed(acoes(e))
        self.assertEqual(acao["tipo"], "aguardar_humano")
        self.assertEqual(acao["motivos"], ["toca arquivos protegidos: prisma/migrations/001/x.sql"])
        e = est.aplicar(e, acao, {})
        self.assertEqual(e["seeds"]["s1"]["estado"], "bloqueada_humano")
        self.assertEqual(da_seed(acoes(e)), [])

    def test_sem_ci_vai_para_humano(self):
        [acao] = da_seed(acoes(tudo_verde(ci="ausente")))
        self.assertEqual(acao, {"tipo": "aguardar_humano", "seed": "s1", "motivos": ["repositório sem CI"]})

    def assertPedeHumanoUmaVez(self, e, motivo, estado_antes):
        """O bloqueio vira ação `aguardar_humano` (issue para o Paulo) e aviso, sem redespachar."""
        s = e["seeds"]["s1"]
        self.assertEqual((s["estado"], s["pendenteHumano"]), (estado_antes, motivo))
        self.assertTrue(any(motivo in a for a in e["avisos"]))
        humano = {"tipo": "aguardar_humano", "seed": "s1", "motivos": [motivo]}
        self.assertEqual(da_seed(acoes(e)), [humano])
        self.assertEqual(acoes(e), acoes(e))
        e = est.aplicar(e, humano, {})
        s = e["seeds"]["s1"]
        self.assertEqual((s["estado"], s["motivoHumano"], s["pendenteHumano"]), ("bloqueada_humano", motivo, None))
        self.assertEqual(da_seed(acoes(e)), [])

    def test_revisao_sem_run_id_pede_humano_sem_redespachar(self):
        e = est.aplicar(com_pr(), {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": ""})
        self.assertPedeHumanoUmaVez(e, "despacho da revisão sem runId", "em_revisao")

    def test_corrigir_sem_run_id_pede_humano_sem_redespachar(self):
        e = est.aplicar(tudo_verde(ci="vermelho"), {"tipo": "corrigir", "seed": "s1", "sha": "bbb", "motivos": [], "achados": []}, {})
        self.assertTrue(e["seeds"]["s1"]["fixerUsado"])
        self.assertPedeHumanoUmaVez(e, "despacho do fixer sem runId", "aguardando_gates")

    def test_verificacao_invalida_pede_humano_sem_repetir(self):
        e = com_pr(sha="bbb")
        for ruim in [None, {"sha": "aaa", "codigo": 0}, {"sha": "bbb", "codigo": "0"}, {"sha": "bbb", "codigo": True}]:
            e2 = est.aplicar(e, {"tipo": "verificar", "seed": "s1", "sha": "bbb"}, {"verificacao": ruim})
            self.assertPedeHumanoUmaVez(e2, "verificação com resultado inválido", "em_revisao")

    def test_pendente_humano_vale_em_qualquer_estado_nao_terminal(self):
        e = com_pr()
        e["seeds"]["s1"]["pendenteHumano"] = True
        self.assertEqual(da_seed(acoes(e)), [{"tipo": "aguardar_humano", "seed": "s1", "motivos": ["decisão humana necessária"]}])
        for estado in ["executando", "falhou", "corrigindo"]:
            e["seeds"]["s1"]["estado"] = estado
            self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["aguardar_humano"], estado)
        for estado in ["mergeada", "bloqueada_humano"]:
            e["seeds"]["s1"]["estado"] = estado
            self.assertEqual(da_seed(acoes(e)), [], estado)


class TestPausaEAvisos(unittest.TestCase):
    def test_oom_baixa_limite_para_2_e_avisa(self):
        e = est.aplicar(com_pr(), {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv1"})
        e = est.registrar_fim_de_run(e, "rv1", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
        self.assertEqual(e["limiteParalelo"], 2)
        self.assertEqual(len(e["avisos"]), 1)
        self.assertIn("oom", e["avisos"][0].lower())
        self.assertIsNone(e["seeds"]["s1"]["revisaoRunId"])
        self.assertIsNone(e["pausado"])
        e["limiteParalelo"] = 1
        self.assertEqual(est.registrar_fim_de_run(e, "x", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)["limiteParalelo"], 1)

    def test_oom_com_dois_executando_nao_despacha_mais(self):
        e = estado_inicial()
        e = despachar(despachar(e, "a"), "b")
        e = est.registrar_fim_de_run(e, "x", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
        self.assertEqual(dos_tipos(acoes(e), "despachar_raia"), [])

    def test_cota_pausa_e_nao_emite_acoes(self):
        e = est.aplicar(tudo_verde(), {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv2"})
        e = est.registrar_fim_de_run(e, "rv2", estado_run="failed", motivo_falha="provider_error", veredito=None, cota=True)
        self.assertEqual(e["pausado"], "cota")
        self.assertEqual(len(e["avisos"]), 1)
        self.assertIsNone(e["seeds"]["s1"]["revisaoRunId"])
        self.assertEqual(e["limiteParalelo"], 3)
        self.assertEqual(acoes(e), [])
        e["pausado"] = None
        self.assertNotEqual(acoes(e), [])
        self.assertEqual(est.registrar_fim_de_run(e, "x", estado_run="failed", motivo_falha=None, veredito=None, cota=False)["pausado"], None)
        self.assertEqual(est.registrar_fim_de_run(e, "x", estado_run="failed", motivo_falha=None, veredito=None, cota="sim")["pausado"], "cota")

    def test_fim_de_run_desconhecido_nao_quebra(self):
        e = com_pr()
        novo = est.registrar_fim_de_run(e, "nada", estado_run="succeeded", motivo_falha=None, veredito=veredito("bbb"), cota=False)
        self.assertEqual(novo["seeds"], e["seeds"])


class TestAcordar(unittest.TestCase):
    def test_fase_concluida_acorda_uma_vez(self):
        e = est.novo_estado(plano(), projeto="p", repo="r")
        e["raias"]["fundacao"]["estado"] = "concluida"
        acordar = {"tipo": "acordar", "motivo": "fase_concluida", "alvo": "fundacao"}
        self.assertEqual(acoes(e, plano("fundacao")), [acordar])
        e = est.aplicar(e, acordar, {"runId": "orq1"})
        self.assertEqual(e["chavesAcordadas"], ["fase_concluida:fundacao"])
        self.assertEqual(acoes(e, plano("fundacao")), [])
        e["orquestrador"] = {"runId": None, "motivo": None}
        self.assertEqual(acoes(e, plano("fundacao")), [])

    def test_fase_com_raia_nao_concluida_nao_acorda(self):
        e = estado_inicial()
        for r in ["a", "b", "c"]:
            e["raias"][r]["estado"] = "concluida"
        e["raias"]["d"]["estado"] = "executando"
        self.assertEqual(dos_tipos(acoes(e), "acordar"), [])
        e["raias"]["d"]["estado"] = "concluida"
        self.assertEqual(acoes(e), [{"tipo": "acordar", "motivo": "fase_concluida", "alvo": "nucleo"}])

    def test_fase_vazia_ou_inexistente_nao_acorda(self):
        e = estado_inicial()
        p = plano()
        p["fases"][1]["raias"] = []
        self.assertEqual(acoes(e, p), [])
        self.assertEqual(acoes(e, plano("zzz")), [])

    def test_raia_falhou_acorda_uma_vez(self):
        e = despachar(estado_inicial(limite=1), "a")
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="run_failed", filhos=[])
        acordar = {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}
        self.assertEqual(dos_tipos(acoes(e), "acordar"), [acordar])
        e = est.aplicar(e, acordar, {"runId": "orq1"})
        e["orquestrador"] = {"runId": None, "motivo": None}
        self.assertEqual(dos_tipos(acoes(e), "acordar"), [])

    def test_orquestrador_em_curso_segura_acordar(self):
        e = despachar(estado_inicial(), "a")
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="x", filhos=[])
        e["orquestrador"] = {"runId": "orq0", "motivo": "nova_spec"}
        self.assertEqual(dos_tipos(acoes(e), "acordar"), [])
        e["orquestrador"]["runId"] = None
        self.assertEqual(len(dos_tipos(acoes(e), "acordar")), 1)

    def test_no_maximo_um_acordar_por_chamada(self):
        e = estado_inicial()
        for r in ["a", "b"]:
            e = despachar(e, r)
            e = est.registrar_plano(e, r, estado_plano="failed", falha="x", filhos=[])
        lista = dos_tipos(acoes(e), "acordar")
        self.assertEqual(lista, [{"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}])
        e = est.aplicar(e, lista[0], {"runId": "orq1"})
        e["orquestrador"] = {"runId": None, "motivo": None}
        self.assertEqual(dos_tipos(acoes(e), "acordar"), [{"tipo": "acordar", "motivo": "raia_falhou", "alvo": "b"}])

    def test_acordar_sem_run_id_tenta_de_novo_e_pausa_na_terceira(self):
        acordar = {"tipo": "acordar", "motivo": "fase_concluida", "alvo": "fundacao"}
        e = est.novo_estado(plano(), projeto="p", repo="r")
        e["raias"]["fundacao"]["estado"] = "concluida"
        for n in [1, 2]:
            e = est.aplicar(e, acordar, {})
            self.assertEqual((e["chavesAcordadas"], e["orquestrador"]["runId"], e["falhasAcordar"], e["pausado"]), ([], None, n, None))
            self.assertEqual(acoes(e, plano("fundacao")), [acordar])
        self.assertEqual(len(e["avisos"]), 2)
        e = est.aplicar(e, acordar, {"runId": None})
        self.assertEqual((e["falhasAcordar"], e["pausado"], e["chavesAcordadas"]), (3, "acordar falhou", []))
        self.assertEqual(len(e["avisos"]), 4)
        self.assertEqual(acoes(e, plano("fundacao")), [])

    def test_acordar_com_sucesso_zera_as_falhas(self):
        acordar = {"tipo": "acordar", "motivo": "fase_concluida", "alvo": "fundacao"}
        e = est.novo_estado(plano(), projeto="p", repo="r")
        e["raias"]["fundacao"]["estado"] = "concluida"
        e = est.aplicar(est.aplicar(e, acordar, {}), acordar, {})
        e = est.aplicar(e, acordar, {"runId": "orq1"})
        self.assertEqual((e["falhasAcordar"], e["pausado"], e["chavesAcordadas"]), (0, None, ["fase_concluida:fundacao"]))
        e = est.concluir_orquestrador(e)
        outro = {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}
        e = est.aplicar(est.aplicar(e, outro, {}), outro, {})
        self.assertEqual((e["falhasAcordar"], e["pausado"]), (2, None))

    def test_falhas_acordar_malformado_pausa(self):
        e = est.novo_estado(plano(), projeto="p", repo="r")
        e["falhasAcordar"] = "x"
        e = est.aplicar(e, {"tipo": "acordar", "motivo": "m", "alvo": "a"}, {})
        self.assertEqual(e["pausado"], "acordar falhou")


class TestAplicar(unittest.TestCase):
    def test_admissao_adiada_nao_muda_estado(self):
        e = com_pr()
        for acao in acoes(e) + [{"tipo": "acordar", "motivo": "fase_concluida", "alvo": "nucleo"}]:
            self.assertEqual(est.aplicar(e, acao, {"adiado": True}), e, acao)
        self.assertEqual(acoes(est.aplicar(e, {"tipo": "despachar_raia", "raia": "b"}, {"adiado": True})), acoes(e))

    def test_acao_ou_resultado_malformado_nao_quebra(self):
        e = com_pr()
        for acao, resultado in [
            ({"tipo": "voar"}, {}),
            ({}, {}),
            ("x", {}),
            ({"tipo": "revisar"}, {"runId": "r"}),
            ({"tipo": "revisar", "seed": "nada"}, {"runId": "r"}),
            ({"tipo": "despachar_raia", "raia": "zzz"}, {"planRunId": "p"}),
            ({"tipo": "retomar_raia", "raia": "zzz"}, {}),
            ({"tipo": "mergear", "seed": "s1"}, None),
        ]:
            novo = est.aplicar(e, acao, resultado)
            self.assertEqual(novo["seeds"], e["seeds"], acao)
            self.assertEqual(novo["raias"], e["raias"], acao)

    def test_proximas_acoes_com_estado_malformado_nao_quebra(self):
        e = com_pr()
        e["seeds"]["lixo"] = "x"
        e["seeds"]["s2"] = {"estado": "em_revisao", "headSha": "z"}
        e["raias"]["lixo"] = None
        lista = est.proximas_acoes(e, plano(), PROTEGIDOS)
        self.assertIn({"tipo": "revisar", "seed": "s1", "sha": "bbb"}, lista)
        self.assertEqual(est.proximas_acoes(e, "lixo", PROTEGIDOS), [a for a in lista if a["tipo"] != "despachar_raia"])
        self.assertNotIn("revisar", [a["tipo"] for a in lista if a.get("seed") == "s2"])


class TestIdempotencia(unittest.TestCase):
    """Duas chamadas seguidas dão a mesma lista; uma ação aplicada não volta sem observação nova."""

    def assertNaoRepete(self, e, acao, resultado, p=None):
        lista = acoes(e, p)
        self.assertEqual(lista, acoes(e, p))
        self.assertIn(acao, lista)
        depois = est.aplicar(e, acao, resultado)
        self.assertNotIn(acao, acoes(depois, p))
        self.assertEqual(acoes(depois, p), acoes(depois, p))
        return depois

    def test_despachar_raia(self):
        self.assertNaoRepete(estado_inicial(), {"tipo": "despachar_raia", "raia": "a"}, {"planRunId": "p"})

    def test_revisar_e_novo_head_justifica_outra(self):
        e = self.assertNaoRepete(com_pr(sha="bbb"), {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv1"})
        e = est.registrar_fim_de_run(e, "rv1", estado_run="succeeded", motivo_falha=None, veredito=veredito("bbb"), cota=False)
        self.assertNotIn({"tipo": "revisar", "seed": "s1", "sha": "bbb"}, acoes(e))
        e = est.registrar_pr(e, "s1", head_sha="ccc", branch="warren/s1", arquivos=[], ci="verde")
        self.assertIn({"tipo": "revisar", "seed": "s1", "sha": "ccc"}, acoes(e))

    def test_verificar(self):
        self.assertNaoRepete(
            com_pr(sha="bbb"), {"tipo": "verificar", "seed": "s1", "sha": "bbb"}, {"verificacao": verificacao("bbb")}
        )

    def test_corrigir_e_fim_do_fixer_justifica_nova_revisao(self):
        e = tudo_verde(ci="vermelho")
        [acao] = da_seed(acoes(e))
        e = self.assertNaoRepete(e, acao, {"runId": "fx1"})
        self.assertEqual(da_seed(acoes(e)), [])
        e = est.registrar_fim_de_run(e, "fx1", estado_run="succeeded", motivo_falha=None, veredito=None, cota=False)
        self.assertIn({"tipo": "revisar", "seed": "s1", "sha": "bbb"}, acoes(e))
        self.assertNotIn("corrigir", [a["tipo"] for a in acoes(e)])

    def test_mergear(self):
        self.assertNaoRepete(tudo_verde(), {"tipo": "mergear", "seed": "s1", "sha": "bbb"}, {"ok": True})

    def test_aguardar_humano(self):
        e = tudo_verde(arquivos=["x/migrations/y.sql"])
        self.assertNaoRepete(e, da_seed(acoes(e))[0], {})

    def test_acordar(self):
        e = corrigir_apos_gate_vermelho()
        self.assertNaoRepete(e, {"tipo": "acordar", "motivo": "gate_falhou_apos_fixer", "alvo": "s1"}, {"runId": "orq"})

    def test_retomar_raia(self):
        e = despachar(estado_inicial(), "a")
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="child_pr_merge_timeout", filhos=[])
        self.assertNaoRepete(e, {"tipo": "retomar_raia", "raia": "a"}, {})

    def test_proximas_acoes_e_pura_e_deterministica(self):
        e = corrigir_apos_gate_vermelho()
        antes = copy.deepcopy(e)
        p = plano()
        p_antes = copy.deepcopy(p)
        prot = list(PROTEGIDOS)
        self.assertEqual(est.proximas_acoes(e, p, prot), est.proximas_acoes(e, p, prot))
        self.assertEqual((e, p, prot), (antes, p_antes, PROTEGIDOS))


class TestPrOrquestrador(unittest.TestCase):
    def decidir(self, motivo="gate_falhou_apos_fixer", arquivos=None, erros=None):
        return est.decidir_pr_orquestrador(
            motivo=motivo,
            arquivos=[".fabrica/plano.json"] if arquivos is None else arquivos,
            erros_plano=[] if erros is None else erros,
        )

    def test_pr_orquestrador_fora_de_fabrica_vai_para_humano(self):
        self.assertEqual(self.decidir(arquivos=[".fabrica/plano.json", "src/x.ts"]), "humano")
        self.assertEqual(self.decidir(arquivos=[".fabrica/plano.json", "src/x.ts"], erros=["e"]), "humano")

    def test_pr_orquestrador_com_plano_invalido_replaneja(self):
        self.assertEqual(self.decidir(erros=["ciclo de dependência: a → a"]), "replanejar")
        self.assertEqual(self.decidir(motivo="nova_spec", erros=["x"]), "replanejar")

    def test_pr_orquestrador_nova_spec_vai_para_humano(self):
        self.assertEqual(self.decidir(motivo="nova_spec"), "humano")
        self.assertEqual(self.decidir(motivo="fase_concluida"), "humano")

    def test_pr_orquestrador_replanejamento_valido_mergeia(self):
        self.assertEqual(self.decidir(arquivos=[".fabrica/plano.json", ".fabrica/briefings/a.md", ".seeds/issues.jsonl"]), "mergear")
        self.assertEqual(self.decidir(motivo="raia_falhou"), "mergear")

    def test_pr_orquestrador_caminhos_suspeitos_vao_para_humano(self):
        for arquivos in [
            [],
            [".fabricax/plano.json"],
            [".fabrica"],
            [".fabrica/../src/x.ts"],
            ["/.fabrica/plano.json"],
            ["./.fabrica/plano.json"],
            [".seeds2/x"],
            [None],
            "nada",
        ]:
            self.assertEqual(self.decidir(arquivos=arquivos), "humano", arquivos)
        self.assertEqual(self.decidir(erros="nada"), "humano")


class TestPlanoConcluido(unittest.TestCase):
    """Task 1: o plano só termina depois da homologação da última fase e sem nada em curso."""

    def completo(self):
        p = plano(fase="nucleo")
        e = est.novo_estado(p, projeto="prj", repo="dono/nome")
        for raia in e["raias"].values():
            raia["estado"] = "concluida"
        e["chavesAcordadas"] = ["fase_concluida:fundacao", "fase_concluida:nucleo"]
        e["acordarPendentes"] = []
        return e, p

    def test_verdadeiro_no_caso_completo(self):
        e, p = self.completo()
        self.assertIs(est.plano_concluido(e, p), True)

    def test_falso_com_raia_executando_na_ultima_fase(self):
        e, p = self.completo()
        e["raias"]["c"]["estado"] = "executando"
        self.assertIs(est.plano_concluido(e, p), False)

    def test_falso_sem_a_chave_da_fase_concluida(self):
        e, p = self.completo()
        e["chavesAcordadas"] = ["fase_concluida:fundacao"]
        self.assertIs(est.plano_concluido(e, p), False)

    def test_falso_com_o_orquestrador_rodando(self):
        e, p = self.completo()
        e["orquestrador"]["runId"] = "orq-1"
        self.assertIs(est.plano_concluido(e, p), False)

    def test_falso_com_decisao_aberta(self):
        e, p = self.completo()
        e["decisoes"] = [{"url": PR_URL, "motivo": "m", "alvo": "x"}]
        self.assertIs(est.plano_concluido(e, p), False)

    def test_falso_com_acordada_na_fila(self):
        e, p = self.completo()
        e["acordarPendentes"] = [{"motivo": "resposta_paulo", "alvo": "x"}]
        self.assertIs(est.plano_concluido(e, p), False)

    def test_falso_com_intencao_de_decisao_pendente(self):
        e, p = self.completo()
        e["decisoesPendentes"] = [{"nonce": "a" * 32, "tipo": "config", "alvo": "config:x"}]
        self.assertIs(est.plano_concluido(e, p), False)
        e["decisoesPendentes"] = []
        self.assertIs(est.plano_concluido(e, p), True)
        del e["decisoesPendentes"]
        self.assertIs(est.plano_concluido(e, p), True)

    def test_falso_com_pr_ou_issue_para_fechar(self):
        # final M10: a issue de decisão do fase_concluida ainda não foi fechada
        e, p = self.completo()
        e["prsParaFechar"] = [{"url": "https://github.com/dono/nome/issues/9", "decisao": True, "tentativas": 0}]
        self.assertIs(est.plano_concluido(e, p), False)
        e["prsParaFechar"] = []
        self.assertIs(est.plano_concluido(e, p), True)
        del e["prsParaFechar"]
        self.assertIs(est.plano_concluido(e, p), True)

    def test_falso_quando_a_fase_atual_nao_e_a_ultima(self):
        e, p = self.completo()
        p["faseAtual"] = "fundacao"
        self.assertIs(est.plano_concluido(e, p), False)

    def test_entrada_malformada_e_falso_sem_excecao(self):
        e, p = self.completo()
        for estado_, plano_ in [
            ({}, {}),
            (None, p),
            (e, None),
            (e, dict(p, fases=[])),
            (e, dict(p, fases="x")),
            (dict(e, raias="x"), p),
            (dict(e, orquestrador=None), p),
            (dict(e, orquestrador={"runId": ""}), p),
            (dict(e, chavesAcordadas=None), p),
            (dict(e, acordarPendentes="x"), p),
            (dict(e, acordarPendentes={}), p),
            (dict(e, decisoes="x"), p),
            (dict(e, decisoes=0), p),
            (dict(e, decisoesPendentes="x"), p),
            (dict(e, decisoesPendentes={}), p),
            (dict(e, prsParaFechar="x"), p),
            (e, dict(p, fases=[p["fases"][0], {"id": "nucleo", "raias": []}])),
            (e, dict(p, fases=[p["fases"][0], {"id": "nucleo", "raias": "x"}])),
            (e, dict(p, fases=[p["fases"][0], "nucleo"])),
            (dict(e, raias=dict(e["raias"], c="concluida")), p),
            (dict(e, raias=dict(e["raias"], c=None)), p),
        ]:
            with self.subTest(estado=estado_, plano=plano_):
                self.assertIs(est.plano_concluido(estado_, plano_), False)

    def test_nao_muta_a_entrada(self):
        e, p = self.completo()
        antes = (copy.deepcopy(e), copy.deepcopy(p))
        est.plano_concluido(e, p)
        self.assertEqual((e, p), antes)


class TestOcupacaoDoPlano(unittest.TestCase):
    """Final I1: o que o plano segura (vagas e trava), lido só do estado.json, sem mutar nada."""

    def base(self):
        p = plano(fase="nucleo")
        return est.novo_estado(p, projeto="prj", repo="dono/nome")

    def test_raias_ocupadas_executando_acao_em_curso_e_incertos(self):
        e = self.base()
        self.assertEqual(est.raias_ocupadas(e), set())
        e["raias"]["a"]["estado"] = "executando"
        e["acaoEmCurso"] = {"tipo": "despachar_raia", "raia": "b"}
        e["despachosIncertos"] = [
            {"chave": "despachar_raia:c", "acao": {"tipo": "despachar_raia", "raia": "c"}},
            {"chave": "acordar:x", "acao": {"tipo": "acordar", "motivo": "x"}},
            "lixo",
        ]
        antes = copy.deepcopy(e)
        self.assertEqual(est.raias_ocupadas(e), {"a", "b", "c"})
        self.assertEqual(e, antes)

    def test_raias_ocupadas_com_entrada_malformada(self):
        for estado_ in (None, {}, {"raias": "x", "acaoEmCurso": "x", "despachosIncertos": {}}, {"raias": {"a": None}}):
            with self.subTest(estado=estado_):
                self.assertEqual(est.raias_ocupadas(estado_), set())

    def test_orquestrador_em_curso(self):
        e = self.base()
        self.assertIs(est.orquestrador_em_curso(e), False)
        for mudanca in (
            {"orquestrador": {"runId": "orq-1", "motivo": "m"}},
            {"prsOrquestrador": ["https://github.com/dono/nome/pull/3"]},
            {"acaoEmCurso": {"tipo": "acordar", "motivo": "m"}},
            {"despachosIncertos": [{"chave": "acordar:m:x", "acao": {"tipo": "acordar"}}]},
        ):
            with self.subTest(mudanca=mudanca):
                self.assertIs(est.orquestrador_em_curso(dict(e, **mudanca)), True)
        self.assertIs(est.orquestrador_em_curso(dict(e, acaoEmCurso={"tipo": "despachar_raia", "raia": "a"})), False)
        self.assertIs(est.orquestrador_em_curso(dict(e, orquestrador=None)), False)
        self.assertIs(est.orquestrador_em_curso(None), False)


class TestNaoMutacao(unittest.TestCase):
    def test_funcoes_nao_mutam_a_entrada(self):
        e = tudo_verde()
        chamadas = [
            lambda x: est.aplicar(x, {"tipo": "mergear", "seed": "s1", "sha": "bbb"}, {"ok": True}),
            lambda x: est.aplicar(x, {"tipo": "despachar_raia", "raia": "b"}, {"planRunId": "p"}),
            lambda x: est.aplicar(x, {"tipo": "aguardar_humano", "seed": "s1", "motivos": ["m"]}, {}),
            lambda x: est.aplicar(x, {"tipo": "acordar", "motivo": "m", "alvo": "a"}, {"runId": "o"}),
            lambda x: est.registrar_plano(x, "a", estado_plano="failed", falha="child_pr_merge_timeout", filhos=[filho("s1", "merged"), filho("s2", "running")]),
            lambda x: est.registrar_pr(x, "s1", head_sha="zzz", branch="b", arquivos=["q"], ci="vermelho"),
            lambda x: est.registrar_verificacao(x, "s1", verificacao("zzz")),
            lambda x: est.registrar_fim_de_run(x, "rv1", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=True),
            lambda x: est.sincronizar_plano(x, plano_com_raia_e()),
            lambda x: est.registrar_pr(x, "nada", head_sha="z", branch="b", arquivos=[], ci="verde"),
            lambda x: est.concluir_orquestrador(est.aplicar(x, {"tipo": "acordar", "motivo": "m", "alvo": "a"}, {"runId": "o"})),
            lambda x: est.aplicar(x, {"tipo": "mergear", "seed": "s1", "sha": "bbb"}, {"ok": False}),
            lambda x: est.aplicar(x, {"tipo": "acordar", "motivo": "m", "alvo": "a"}, {}),
            lambda x: est.registrar_plano(x, "a", estado_plano="running", falha=None, filhos=[dict(filho("s1", "pr_open", pr=PR2), falha="oom_killed")]),
        ]
        for chamar in chamadas:
            antes = copy.deepcopy(e)
            novo = chamar(e)
            self.assertEqual(e, antes)
            self.assertIsNot(novo, e)
            self.assertNotEqual(novo, e)

    def test_concluir_e_sincronizar_nao_mutam_a_entrada(self):
        e = despachar(estado_inicial(), "a")
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="x", filhos=[])
        e = est.aplicar(e, {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}, {"runId": "orq1"})
        p = plano()
        p["raias"][1]["planoSeeds"] = "pl-00aa"
        antes, p_antes = copy.deepcopy(e), copy.deepcopy(p)
        novo = est.sincronizar_plano(est.concluir_orquestrador(e), p)
        self.assertEqual((e, p), (antes, p_antes))
        self.assertEqual(novo["raias"]["a"]["estado"], "planejada")
        novo["chavesAcordadas"].append("x")
        self.assertEqual(e["chavesAcordadas"], ["raia_falhou:a"])

    def test_estado_novo_nao_compartilha_objetos_com_a_entrada(self):
        e = tudo_verde()
        filhos = [filho("s2", "running")]
        novo = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=filhos)
        novo["seeds"]["s1"]["arquivos"].append("z")
        novo["raias"]["a"]["estado"] = "z"
        self.assertNotIn("z", e["seeds"]["s1"]["arquivos"])
        self.assertEqual(e["raias"]["a"]["estado"], "executando")
        arquivos = ["src/a/x.ts"]
        novo = est.registrar_pr(e, "s1", head_sha="bbb", branch="b", arquivos=arquivos, ci="verde")
        arquivos.append("mudou")
        self.assertEqual(novo["seeds"]["s1"]["arquivos"], ["src/a/x.ts"])
        v = veredito("bbb")
        e2 = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv9"})
        e2 = est.registrar_fim_de_run(e2, "rv9", estado_run="succeeded", motivo_falha=None, veredito=v, cota=False)
        v["resultado"] = "correcoes"
        self.assertEqual(e2["seeds"]["s1"]["veredito"]["resultado"], "aprovado")


PR2 = "https://github.com/dono/nome/pull/2"


def ciclo(e, executar, p=None):
    """Um ciclo do despachante: calcula as ações, executa cada uma e aplica o resultado."""
    feitas = []
    for acao in acoes(e, p):
        e = est.aplicar(e, acao, executar(acao))
        feitas.append(acao)
    return e, feitas


def executor(**por_tipo):
    """Resultado padrão de cada tipo de ação; `por_tipo` sobrescreve (valor ou função)."""
    contador = {"n": 0}

    def executar(acao):
        contador["n"] += 1
        tipo = acao["tipo"]
        if tipo in por_tipo:
            r = por_tipo[tipo]
            return r(acao) if callable(r) else r
        if tipo == "despachar_raia":
            return {"planRunId": f"plan_{acao['raia']}"}
        if tipo == "verificar":
            return {"verificacao": verificacao(acao["sha"])}
        if tipo == "mergear":
            return {"ok": True}
        if tipo in ("revisar", "corrigir", "acordar"):
            return {"runId": f"{tipo}{contador['n']}"}
        return {}

    return executar


class TestNovaTentativa(unittest.TestCase):
    """A: uma seed redespachada ou com PR novo recomeça do zero (só raia e runId sobrevivem)."""

    def campos_da_tentativa(self, s):
        chaves = ["fixerUsado", "tentativasRevisao", "headSha", "ci", "veredito", "verificacao", "arquivos",
                  "branch", "motivoHumano", "tentativasMerge", "interrupcoes", "pendenteHumano", "vereditoAnterior",
                  "revisaoRunId", "fixerRunId"]
        return {k: s[k] for k in chaves}

    def fresca(self):
        return self.campos_da_tentativa(est._seed_nova("a"))

    def test_falhou_redespachada_reinicia_a_seed(self):
        e = corrigir_apos_gate_vermelho()
        e["seeds"]["s1"]["motivoHumano"] = "x"
        e["seeds"]["s1"]["tentativasMerge"] = 2
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho("s1", "failed")])
        self.assertEqual(e["seeds"]["s1"]["estado"], "falhou")
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho("s1", "running", run="r2")])
        s = e["seeds"]["s1"]
        self.assertEqual((s["estado"], s["raia"], s["runId"], s["pr"]), ("executando", "a", "r2", None))
        self.assertEqual(self.campos_da_tentativa(s), self.fresca())
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho("s1", "pr_open", run="r2", pr=PR2)])
        self.assertEqual((e["seeds"]["s1"]["estado"], e["seeds"]["s1"]["pr"]), ("em_revisao", PR2))
        self.assertEqual(da_seed(acoes(e)), [])  # sem head lido não há mergear com o SHA velho

    def test_pr_novo_reinicia_a_tentativa_em_qualquer_estado(self):
        for estado in ["em_revisao", "corrigindo", "aguardando_gates", "bloqueada_humano", "falhou"]:
            e = corrigir_apos_gate_vermelho()
            e["seeds"]["s1"]["estado"] = estado
            e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho("s1", "pr_open", run="r9", pr=PR2)])
            s = e["seeds"]["s1"]
            self.assertEqual((s["estado"], s["pr"], s["runId"], s["raia"]), ("em_revisao", PR2, "r9", "a"), estado)
            self.assertEqual(self.campos_da_tentativa(s), self.fresca(), estado)

    def test_mesmo_pr_nao_reinicia_e_mergeada_nunca_reinicia(self):
        e = corrigir_apos_gate_vermelho()
        antes = e["seeds"]["s1"]
        mesmo = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho("s1", "pr_open")])
        self.assertEqual(mesmo["seeds"]["s1"], antes)
        e["seeds"]["s1"]["estado"] = "mergeada"
        for obs in [filho("s1", "pr_open", pr=PR2), filho("s1", "running")]:
            novo = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[obs])
            self.assertEqual(novo["seeds"]["s1"]["estado"], "mergeada")
            self.assertEqual(novo["seeds"]["s1"]["fixerUsado"], True)
            self.assertEqual(novo["seeds"]["s1"]["pr"], PR_URL)

    def test_cenario_redespacho_ganha_o_seu_proprio_fixer(self):
        """sonda1: a nova tentativa com gate vermelho pede `corrigir`, não `acordar`."""
        e = corrigir_apos_gate_vermelho()
        self.assertEqual(da_seed(acoes(e)), [{"tipo": "acordar", "motivo": "gate_falhou_apos_fixer", "alvo": "s1"}])
        for obs in [filho("s1", "failed"), filho("s1", "running", run="r2"), filho("s1", "pr_open", run="r2", pr=PR2)]:
            e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[obs])
        e = est.registrar_pr(e, "s1", head_sha="zzz", branch="warren/s1-2", arquivos=["src/a/x.ts"], ci="vermelho")
        e, feitas = ciclo(e, executor())
        self.assertEqual([a["tipo"] for a in da_seed(feitas)], ["revisar", "verificar"])
        run_revisao = e["seeds"]["s1"]["revisaoRunId"]
        e = est.registrar_fim_de_run(e, run_revisao, estado_run="succeeded", motivo_falha=None, veredito=veredito("zzz"), cota=False)
        [acao] = da_seed(acoes(e))
        self.assertEqual((acao["tipo"], acao["sha"]), ("corrigir", "zzz"))


class TestCotaEOomNoRun(unittest.TestCase):
    """B: cota e OOM interrompem o run sem gastar o fixer nem a tentativa de revisão."""

    def com_fixer(self, ci="vermelho"):
        achados = [{"arquivo": "src/a/x.ts", "motivo": "sem teste"}]
        e = com_pr(sha="bbb", ci=ci)
        e = revisar(e, "bbb", "rv1", veredito("bbb", "correcoes", achados))
        e = verificar(e, "bbb")
        [corrigir] = da_seed(acoes(e))
        self.assertEqual(corrigir["tipo"], "corrigir")
        return est.aplicar(e, corrigir, {"runId": "fx1"}), corrigir

    def test_fixer_com_cota_volta_depois_da_pausa(self):
        e, corrigir = self.com_fixer()
        e = est.registrar_fim_de_run(e, "fx1", estado_run="failed", motivo_falha="provider_error", veredito=None, cota=True)
        s = e["seeds"]["s1"]
        self.assertEqual((s["estado"], s["fixerUsado"], s["fixerRunId"], e["pausado"]), ("corrigindo", False, None, "cota"))
        self.assertEqual(acoes(e), [])
        e["pausado"] = None  # o `retomar` do despachante
        self.assertEqual(da_seed(acoes(e)), [corrigir])

    def test_fixer_com_oom_volta_na_hora_e_baixa_o_limite(self):
        e, corrigir = self.com_fixer()
        e = est.registrar_fim_de_run(e, "fx1", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
        s = e["seeds"]["s1"]
        self.assertEqual((s["estado"], s["fixerUsado"], s["fixerRunId"], e["limiteParalelo"]), ("corrigindo", False, None, 2))
        self.assertEqual(da_seed(acoes(e)), [corrigir])
        e = est.aplicar(e, corrigir, {"runId": "fx2"})
        e = est.registrar_fim_de_run(e, "fx2", estado_run="failed", motivo_falha="run_failed", veredito=None, cota=False)
        self.assertEqual(e["seeds"]["s1"]["estado"], "falhou")

    def test_fixer_interrompido_que_mudou_o_head_pede_revisao_nova(self):
        e, _ = self.com_fixer()
        e = est.registrar_fim_de_run(e, "fx1", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
        e = est.registrar_pr(e, "s1", head_sha="ccc", branch="warren/s1", arquivos=["src/a/x.ts"], ci="vermelho")
        self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["revisar", "verificar"])

    def test_fixer_que_terminou_bem_ainda_gasta_o_fixer(self):
        e, _ = self.com_fixer()
        e = est.registrar_fim_de_run(e, "fx1", estado_run="succeeded", motivo_falha=None, veredito=None, cota=True)
        s = e["seeds"]["s1"]
        self.assertEqual((s["fixerUsado"], s["veredito"], s["vereditoAnterior"]), (True, None, None))

    def test_revisao_com_cota_ou_oom_nao_gasta_tentativa(self):
        for motivo, cota in [("provider_error", True), ("oom_killed", False)]:
            e = verificar(com_pr(sha="bbb"), "bbb")
            for n in range(3):
                [acao] = da_seed(acoes(e))
                self.assertEqual(acao, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, (motivo, n))
                e = est.aplicar(e, acao, {"runId": f"rv{n}"})
                self.assertEqual(e["seeds"]["s1"]["tentativasRevisao"], 1)
                e = est.registrar_fim_de_run(e, f"rv{n}", estado_run="failed", motivo_falha=motivo, veredito=None, cota=cota)
                self.assertEqual((e["seeds"]["s1"]["tentativasRevisao"], e["seeds"]["s1"]["revisaoRunId"]), (0, None))
                e["pausado"] = None

    def test_revisao_com_falha_comum_gasta_tentativa(self):
        e = verificar(com_pr(sha="bbb"), "bbb")
        e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv1"})
        e = est.registrar_fim_de_run(e, "rv1", estado_run="failed", motivo_falha="run_failed", veredito=None, cota=False)
        self.assertEqual(e["seeds"]["s1"]["tentativasRevisao"], 1)

    def test_tentativa_nunca_fica_negativa(self):
        e = com_pr(sha="bbb")
        e["seeds"]["s1"]["revisaoRunId"] = "rv1"
        e = est.registrar_fim_de_run(e, "rv1", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
        self.assertEqual(e["seeds"]["s1"]["tentativasRevisao"], 0)

    def test_cenario_cota_no_fixer_retomar_e_merge(self):
        """cenarios1 S5b: cota no fixer, pausa, retomar, fixer de novo, revisão nova e merge."""
        e, _ = self.com_fixer()
        e = est.registrar_fim_de_run(e, "fx1", estado_run="failed", motivo_falha="provider_error", veredito=None, cota=True)
        for _ in range(2):
            e, feitas = ciclo(e, executor())
            self.assertEqual(feitas, [])
        e["pausado"] = None
        e, feitas = ciclo(e, executor())
        self.assertEqual([a["tipo"] for a in da_seed(feitas)], ["corrigir"])
        e = est.registrar_fim_de_run(e, e["seeds"]["s1"]["fixerRunId"], estado_run="succeeded", motivo_falha=None, veredito=None, cota=False)
        e = est.registrar_pr(e, "s1", head_sha="ccc", branch="warren/s1", arquivos=["src/a/x.ts"], ci="verde")
        e, feitas = ciclo(e, executor())
        self.assertEqual([a["tipo"] for a in da_seed(feitas)], ["revisar", "verificar"])
        e = est.registrar_fim_de_run(e, e["seeds"]["s1"]["revisaoRunId"], estado_run="succeeded", motivo_falha=None, veredito=veredito("ccc"), cota=False)
        e, feitas = ciclo(e, executor())
        self.assertEqual(da_seed(feitas), [{"tipo": "mergear", "seed": "s1", "sha": "ccc"}])
        self.assertEqual(e["seeds"]["s1"]["estado"], "mergeada")


class TestOrdemDosPassos(unittest.TestCase):
    """D: a ordem 1 seeds → 2 retomar → 3 despachar → 4 raia falhou → 5 fase concluída."""

    def test_lista_com_quatro_passos_ativos_tem_a_ordem_exata(self):
        e = est.sincronizar_plano(tudo_verde(), plano_com_raia_e())
        e["limiteParalelo"] = 4
        e = despachar(e, "b")
        e = est.registrar_plano(e, "b", estado_plano="failed", falha="child_pr_merge_timeout", filhos=[])
        e = despachar(e, "e")
        e = est.registrar_plano(e, "e", estado_plano="failed", falha="run_failed", filhos=[])
        self.assertEqual(
            acoes(e, plano_com_raia_e()),
            [
                {"tipo": "mergear", "seed": "s1", "sha": "bbb"},
                {"tipo": "retomar_raia", "raia": "b"},
                {"tipo": "despachar_raia", "raia": "c"},
                {"tipo": "despachar_raia", "raia": "d"},
                {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "e"},
            ],
        )

    def test_acordar_do_passo_1_ganha_do_passo_4(self):
        e = despachar(corrigir_apos_gate_vermelho(), "b")
        e = est.registrar_plano(e, "b", estado_plano="failed", falha="run_failed", filhos=[])
        self.assertEqual(
            acoes(e),
            [
                {"tipo": "acordar", "motivo": "gate_falhou_apos_fixer", "alvo": "s1"},
                {"tipo": "despachar_raia", "raia": "c"},
                {"tipo": "despachar_raia", "raia": "d"},
            ],
        )
        e = est.concluir_orquestrador(est.aplicar(e, acoes(e)[0], {"runId": "orq1"}))
        self.assertEqual(acoes(e)[-1], {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "b"})

    def test_acordar_do_passo_4_ganha_do_passo_5(self):
        e = despachar(estado_inicial(), "a")
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="run_failed", filhos=[])
        p = plano("fundacao")
        self.assertEqual(acoes(e, p), [{"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}])
        e = est.concluir_orquestrador(est.aplicar(e, acoes(e, p)[0], {"runId": "orq1"}))
        self.assertEqual(acoes(e, p), [{"tipo": "acordar", "motivo": "fase_concluida", "alvo": "fundacao"}])

    def test_passo_1_vem_antes_de_retomar_e_de_fase_concluida(self):
        e = com_pr(sha="bbb")
        e["raias"]["a"]["retomar"] = True
        e["raias"]["fundacao"]["estado"] = "concluida"
        self.assertEqual(
            acoes(e, plano("fundacao")),
            [
                {"tipo": "revisar", "seed": "s1", "sha": "bbb"},
                {"tipo": "verificar", "seed": "s1", "sha": "bbb"},
                {"tipo": "retomar_raia", "raia": "a"},
                {"tipo": "acordar", "motivo": "fase_concluida", "alvo": "fundacao"},
            ],
        )


class TestReplanejarRaiaFalha(unittest.TestCase):
    """H: uma raia falha só volta com um plano Seeds novo."""

    def falhou(self):
        e = despachar(estado_inicial(), "a")
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="run_failed", filhos=[])
        e = est.aplicar(e, {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}, {"runId": "orq1"})
        e["chavesAcordadas"].append("fase_concluida:fundacao")
        return est.concluir_orquestrador(e)

    def plano_trocado(self, plano_seeds="pl-00aa"):
        p = plano()
        p["raias"][1]["planoSeeds"] = plano_seeds
        return p

    def test_plano_seeds_novo_reinicia_a_raia_e_libera_a_chave(self):
        e = est.sincronizar_plano(self.falhou(), self.plano_trocado())
        self.assertEqual(
            e["raias"]["a"],
            {
                "estado": "planejada",
                "planRunId": None,
                "retomar": False,
                "retomadas": 0,
                "falha": None,
                "planoSeeds": "pl-00aa",
                "seedsSubstituidas": [],
                "replanejamentos": 1,
            },
        )
        self.assertEqual(e["chavesAcordadas"], ["fase_concluida:fundacao"])
        self.assertIn({"tipo": "despachar_raia", "raia": "a"}, acoes(e, self.plano_trocado()))

    def test_mesmo_plano_seeds_mantem_falhou(self):
        antes = self.falhou()
        e = est.sincronizar_plano(antes, plano())
        self.assertEqual(e, antes)
        for ruim in [None, "", 3]:
            self.assertEqual(est.sincronizar_plano(antes, self.plano_trocado(ruim))["raias"]["a"]["estado"], "falhou")

    def test_sem_plano_seeds_guardado_mantem_falhou(self):
        e = self.falhou()
        del e["raias"]["a"]["planoSeeds"]
        self.assertEqual(est.sincronizar_plano(e, self.plano_trocado())["raias"]["a"]["estado"], "falhou")

    def test_so_a_raia_falhou_reinicia(self):
        e = despachar(estado_inicial(), "a")
        e["raias"]["b"]["estado"] = "concluida"
        p = plano()
        for r in p["raias"]:
            r["planoSeeds"] = "pl-ffff"
        e = est.sincronizar_plano(e, p)
        self.assertEqual((e["raias"]["a"]["estado"], e["raias"]["a"]["planoSeeds"]), ("executando", "pl-000a"))
        self.assertEqual((e["raias"]["b"]["estado"], e["raias"]["b"]["planoSeeds"]), ("concluida", "pl-000b"))
        self.assertEqual((e["raias"]["c"]["estado"], e["raias"]["c"]["planoSeeds"]), ("planejada", "pl-ffff"))

    def test_cenario_raia_falha_replanejada_volta_a_andar(self):
        """cenarios3 S16: com o mesmo id e um plano Seeds novo, a raia é despachada de novo."""
        e = despachar(estado_inicial(), "a")
        for r in ["b", "c", "d"]:
            e["raias"][r]["estado"] = "concluida"
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="run_failed", filhos=[])
        e, feitas = ciclo(e, executor())
        self.assertEqual(feitas, [{"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}])
        e = est.concluir_orquestrador(e)
        for _ in range(2):
            e, feitas = ciclo(e, executor())
            self.assertEqual(feitas, [])
        p = self.plano_trocado()
        e = est.sincronizar_plano(e, p)
        e, feitas = ciclo(e, executor(), p)
        self.assertEqual(feitas, [{"tipo": "despachar_raia", "raia": "a"}])
        self.assertEqual(e["raias"]["a"]["estado"], "executando")


class TestOomDoImplementador(unittest.TestCase):
    """I: um filho do plan run morto por OOM baixa o limite, uma vez por runId."""

    def test_filho_com_oom_baixa_o_limite_uma_vez_por_run(self):
        e = despachar(estado_inicial(), "a")
        oom = dict(filho("s1", "failed", run="r1"), falha="oom_killed")
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[oom])
        self.assertEqual((e["limiteParalelo"], e["runsOom"]), (2, ["r1"]))
        self.assertTrue(any("oom" in a for a in e["avisos"]))
        e["limiteParalelo"] = 3  # o Paulo subiu o limite de novo
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="run_failed", filhos=[oom])
        self.assertEqual(e["limiteParalelo"], 3)

    def test_outro_run_com_oom_baixa_de_novo(self):
        e = despachar(estado_inicial(), "a")
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[dict(filho("s1", "failed", run="r1"), falha="oom_killed")])
        e["limiteParalelo"] = 3
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[dict(filho("s1", "running", run="r2"), falha="oom_killed")])
        self.assertEqual((e["limiteParalelo"], e["runsOom"]), (2, ["r1", "r2"]))

    def test_filho_sem_oom_nao_mexe_no_limite(self):
        e = despachar(estado_inicial(), "a")
        for f in [filho("s1", "failed"), dict(filho("s1", "failed"), falha="run_failed"), dict(filho("s1", "failed"), falha=None)]:
            novo = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[f])
            self.assertEqual((novo["limiteParalelo"], novo["runsOom"]), (3, []))

    def test_oom_sem_run_id_ou_com_runs_oom_malformado_nao_quebra(self):
        e = despachar(estado_inicial(), "a")
        e["runsOom"] = None
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[dict(filho("s1", "failed", run=None), falha="oom_killed")])
        self.assertEqual((e["limiteParalelo"], e["runsOom"]), (2, []))

    def test_oom_do_filho_reduz_o_despacho(self):
        e = despachar(estado_inicial(), "a")
        e = despachar(e, "b")
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[dict(filho("s1", "failed"), falha="oom_killed")])
        self.assertEqual(dos_tipos(acoes(e), "despachar_raia"), [])


class TestConcluirOrquestrador(unittest.TestCase):
    """J: encerrar o run do orquestrador libera o próximo `acordar`."""

    def test_limpa_run_e_guarda_o_motivo(self):
        e = estado_inicial()
        e = est.aplicar(e, {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}, {"runId": "orq1"})
        antes = copy.deepcopy(e)
        novo = est.concluir_orquestrador(e)
        self.assertEqual(e, antes)
        self.assertEqual(novo["orquestrador"], {"runId": None, "motivo": None, "ultimoMotivo": "raia_falhou"})
        self.assertEqual(est.concluir_orquestrador(novo), novo)
        self.assertEqual(novo["chavesAcordadas"], ["raia_falhou:a"])

    def test_sem_run_em_curso_nao_muda_e_malformado_nao_quebra(self):
        e = estado_inicial()
        self.assertEqual(est.concluir_orquestrador(e), e)
        e["orquestrador"] = None
        self.assertEqual(est.concluir_orquestrador(e)["orquestrador"], {"runId": None, "motivo": None, "ultimoMotivo": None})

    def test_fim_do_run_do_orquestrador_nao_e_desconhecido(self):
        e = est.aplicar(estado_inicial(), {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}, {"runId": "orq1"})
        novo = est.registrar_fim_de_run(e, "orq1", estado_run="failed", motivo_falha="provider_error", veredito=None, cota=True)
        self.assertEqual(novo["orquestrador"]["runId"], "orq1")  # quem limpa é concluir_orquestrador
        self.assertFalse(any("desconhecido" in a for a in novo["avisos"]))
        self.assertEqual(novo["pausado"], "cota")


class TestPerguntaDoOrquestrador(unittest.TestCase):
    """C: um PR com `.fabrica/pergunta.md` é uma pergunta ao Paulo, nunca um merge."""

    def test_pergunta_vai_para_humano_antes_de_tudo(self):
        for motivo in ["raia_falhou", "gate_falhou_apos_fixer", "plano_invalido", "resposta_paulo", "nova_spec"]:
            for arquivos, erros in [
                ([".fabrica/pergunta.md"], []),
                ([".fabrica/plano.json", ".fabrica/pergunta.md"], []),
                ([".fabrica/pergunta.md", ".seeds/issues.jsonl"], ["ciclo"]),
            ]:
                self.assertEqual(
                    est.decidir_pr_orquestrador(motivo=motivo, arquivos=arquivos, erros_plano=erros), "humano", (motivo, arquivos)
                )

    def test_outros_arquivos_de_fabrica_nao_sao_pergunta(self):
        for arquivos in [[".fabrica/perguntas.md"], [".fabrica/x/pergunta.md"], [".fabrica/pergunta.md.bak"]]:
            self.assertEqual(est.decidir_pr_orquestrador(motivo="raia_falhou", arquivos=arquivos, erros_plano=[]), "mergear")


def replanejar(e, raia="a", plano_seeds="pl-NEW"):
    """Raia falha → acordar → orquestrador termina → plano novo com outro planoSeeds."""
    e = est.registrar_plano(e, raia, estado_plano="failed", falha="run_failed", filhos=[])
    e = est.aplicar(e, {"tipo": "acordar", "motivo": "raia_falhou", "alvo": raia}, {"runId": "orq1"})
    e = est.concluir_orquestrador(e)
    p = plano()
    for r in p["raias"]:
        if r["id"] == raia:
            r["planoSeeds"] = plano_seeds
    return est.sincronizar_plano(e, p), p


class TestSeedsObsoletas(unittest.TestCase):
    """K (revisto na rodada 2 da Task 7, I5): replanejar uma raia falha tira do estado as seeds não
    mergeadas da tentativa anterior; fora do estado elas nunca mais recebem ação, e um id
    reaproveitado pelo plano novo começa limpo."""

    AVISO = f"PR {PR_URL} da tentativa anterior da raia a ficou obsoleto; feche-o"

    def test_cenario_pr_verde_da_tentativa_antiga_nunca_e_mergeado(self):
        e = tudo_verde()
        self.assertIn({"tipo": "mergear", "seed": "s1", "sha": "bbb"}, acoes(e))
        e, p = replanejar(e)
        self.assertEqual(e["raias"]["a"]["estado"], "planejada")
        self.assertNotIn("s1", e["seeds"])
        self.assertEqual(e["raias"]["a"]["seedsSubstituidas"], ["s1"])
        self.assertIn(self.AVISO, e["avisos"])
        lista = acoes(e, p)
        self.assertNotIn("mergear", [a["tipo"] for a in lista])
        self.assertEqual(da_seed(lista), [])
        self.assertIn({"tipo": "despachar_raia", "raia": "a"}, lista)
        e, feitas = ciclo(e, executor(), p)
        self.assertEqual(da_seed(feitas), [])
        self.assertEqual(e["raias"]["a"]["estado"], "executando")
        for _ in range(2):
            e, feitas = ciclo(e, executor(), p)
            self.assertEqual(da_seed(feitas), [])
        # o plano novo reaproveita o id s1: a seed recomeça limpa, sem nada da tentativa antiga
        for obs, esperado in [(filho("s1", "pr_open", pr=PR2), "em_revisao"), (filho("s1", "merged"), "mergeada"), (filho("s1", "failed"), "falhou")]:
            novo = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[obs])
            s = novo["seeds"]["s1"]
            self.assertEqual(s["estado"], esperado, obs)
            self.assertEqual((s["veredito"], s["verificacao"], s["headSha"], s["fixerUsado"]), (None, None, None, False))
        novo = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho("s1", "pr_open", pr=PR2)])
        self.assertEqual(da_seed(acoes(novo, p)), [])  # sem head lido nenhuma ação, nem com o SHA velho

    def test_idempotente(self):
        e, p = replanejar(tudo_verde())
        self.assertEqual(est.sincronizar_plano(e, p), e)
        self.assertEqual(e["avisos"].count(self.AVISO), 1)
        self.assertEqual(acoes(e, p), acoes(e, p))

    def test_todo_estado_nao_mergeado_sai_do_estado(self):
        for estado in ["executando", "em_revisao", "aguardando_gates", "corrigindo", "bloqueada_humano", "falhou", "obsoleta"]:
            e = tudo_verde()
            e["seeds"]["s1"]["estado"] = estado
            e["seeds"]["s1"]["pendenteHumano"] = "x"
            e, p = replanejar(e)
            self.assertNotIn("s1", e["seeds"], estado)
            self.assertEqual(da_seed(acoes(e, p)), [], estado)

    def test_mergeada_fica_e_outras_raias_nao_mudam(self):
        e = tudo_verde()
        e["seeds"]["s1"]["estado"] = "mergeada"
        e = despachar(e, "b")
        e = est.registrar_plano(e, "b", estado_plano="running", falha=None, filhos=[filho("s2", "pr_open", pr=PR2)])
        e["seeds"]["s3"] = dict(est._seed_nova("a"), estado="em_revisao")  # sem PR: sem aviso
        e, _ = replanejar(e)
        self.assertEqual({s: e["seeds"][s]["estado"] for s in e["seeds"]}, {"s1": "mergeada", "s2": "em_revisao"})
        self.assertEqual(e["raias"]["a"]["seedsSubstituidas"], ["s3"])
        self.assertFalse(any("obsoleto" in a for a in e["avisos"]))

    def test_fim_de_run_nao_ressuscita_a_seed_removida(self):
        e = tudo_verde(ci="vermelho")
        e = est.aplicar(e, da_seed(acoes(e))[0], {"runId": "fx1"})
        e, _ = replanejar(e)
        for estado_run, motivo in [("failed", "run_failed"), ("succeeded", None), ("failed", "oom_killed")]:
            novo = est.registrar_fim_de_run(e, "fx1", estado_run=estado_run, motivo_falha=motivo, veredito=None, cota=False)
            self.assertNotIn("s1", novo["seeds"], estado_run)
            self.assertEqual(da_seed(acoes(novo)), [])

    def test_mesmo_plano_seeds_nao_torna_obsoleta(self):
        e = est.registrar_plano(tudo_verde(), "a", estado_plano="failed", falha="x", filhos=[])
        e = est.sincronizar_plano(e, plano())
        self.assertEqual(e["seeds"]["s1"]["estado"], "aguardando_gates")


class TestInterrupcoesPorOom(unittest.TestCase):
    """L: OOM repetido no fixer ou no revisor da mesma seed vai para o Paulo na 3ª vez."""

    HUMANO = {"tipo": "aguardar_humano", "seed": "s1", "motivos": ["OOM repetido no fixer/revisor"]}

    def test_tres_ooms_no_fixer_vao_para_o_paulo_sem_quarto_corrigir(self):
        e = tudo_verde(ci="vermelho")
        for n in [1, 2, 3]:
            [acao] = da_seed(acoes(e))
            self.assertEqual(acao["tipo"], "corrigir", n)
            e = est.aplicar(e, acao, {"runId": f"fx{n}"})
            e = est.registrar_fim_de_run(e, f"fx{n}", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
            self.assertEqual(e["seeds"]["s1"]["interrupcoes"], n)
        self.assertEqual(da_seed(acoes(e)), [self.HUMANO])
        e = est.aplicar(e, self.HUMANO, {})
        self.assertEqual(e["seeds"]["s1"]["estado"], "bloqueada_humano")
        self.assertEqual(da_seed(acoes(e)), [])

    def test_tres_ooms_no_revisor_vao_para_o_paulo_sem_quarto_revisar(self):
        e = verificar(com_pr(sha="bbb"), "bbb")
        for n in [1, 2, 3]:
            self.assertEqual(da_seed(acoes(e)), [{"tipo": "revisar", "seed": "s1", "sha": "bbb"}], n)
            e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": f"rv{n}"})
            e = est.registrar_fim_de_run(e, f"rv{n}", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
        self.assertEqual(da_seed(acoes(e)), [self.HUMANO])

    def test_cenario_oom_persistente_para_em_tres_runs(self):
        e = tudo_verde(ci="vermelho")
        corrigir = 0
        for _ in range(6):
            e, feitas = ciclo(e, executor())
            corrigir += len(dos_tipos(da_seed(feitas), "corrigir"))
            if e["seeds"]["s1"]["fixerRunId"]:
                e = est.registrar_fim_de_run(e, e["seeds"]["s1"]["fixerRunId"], estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
        self.assertEqual(corrigir, 3)
        self.assertEqual(e["seeds"]["s1"]["estado"], "bloqueada_humano")

    def test_fixer_e_revisor_somam_na_mesma_seed(self):
        e = tudo_verde(ci="vermelho")
        e = est.aplicar(e, da_seed(acoes(e))[0], {"runId": "fx1"})
        e = est.registrar_fim_de_run(e, "fx1", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
        e["seeds"]["s1"]["veredito"] = None
        e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv9"})
        e = est.registrar_fim_de_run(e, "rv9", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
        self.assertEqual((e["seeds"]["s1"]["interrupcoes"], e["seeds"]["s1"]["pendenteHumano"]), (2, None))

    def test_cota_nao_conta(self):
        e = tudo_verde(ci="vermelho")
        for n in range(4):
            [acao] = da_seed(acoes(e))
            self.assertEqual(acao["tipo"], "corrigir")
            e = est.aplicar(e, acao, {"runId": f"fx{n}"})
            e = est.registrar_fim_de_run(e, f"fx{n}", estado_run="failed", motivo_falha="provider_error", veredito=None, cota=True)
            self.assertEqual(e["seeds"]["s1"]["interrupcoes"], 0)
            e["pausado"] = None

    def test_head_novo_zera_o_contador(self):
        e = tudo_verde(ci="vermelho")
        e["seeds"]["s1"]["interrupcoes"] = 2
        mesmo = est.registrar_pr(e, "s1", head_sha="bbb", branch="warren/s1", arquivos=["src/a/x.ts"], ci="vermelho")
        self.assertEqual(mesmo["seeds"]["s1"]["interrupcoes"], 2)
        novo = est.registrar_pr(e, "s1", head_sha="ccc", branch="warren/s1", arquivos=["src/a/x.ts"], ci="vermelho")
        self.assertEqual(novo["seeds"]["s1"]["interrupcoes"], 0)

    def test_reinicio_da_seed_zera_o_contador(self):
        e = tudo_verde(ci="vermelho")
        e["seeds"]["s1"]["interrupcoes"] = 2
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho("s1", "running", run="r2")])
        self.assertEqual(e["seeds"]["s1"]["interrupcoes"], 0)

    def test_contador_malformado_vai_para_o_paulo(self):
        e = tudo_verde(ci="vermelho")
        e["seeds"]["s1"]["interrupcoes"] = "x"
        e = est.aplicar(e, da_seed(acoes(e))[0], {"runId": "fx1"})
        e = est.registrar_fim_de_run(e, "fx1", estado_run="failed", motivo_falha="oom_killed", veredito=None, cota=False)
        self.assertEqual(da_seed(acoes(e)), [self.HUMANO])


class TestRedespachoPorRunId(unittest.TestCase):
    """M: um runId novo do Warren reinicia a seed em qualquer estado não terminal."""

    def test_run_novo_reinicia_em_qualquer_estado_nao_terminal(self):
        for estado in ["executando", "em_revisao", "aguardando_gates", "corrigindo", "bloqueada_humano", "falhou"]:
            e = corrigir_apos_gate_vermelho()
            e["seeds"]["s1"]["estado"] = estado
            e["seeds"]["s1"]["pendenteHumano"] = "despacho do fixer sem runId"
            e["seeds"]["s1"]["motivoHumano"] = "m"
            for obs in ["running", "dispatched"]:
                novo = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho("s1", obs, run="r2")])
                s = novo["seeds"]["s1"]
                fresca = dict(est._seed_nova("a"), runId="r2")
                self.assertEqual(s, fresca, (estado, obs))
                self.assertEqual(da_seed(acoes(novo)), [])

    def test_mesmo_run_nao_muda_nada(self):
        for estado in ["executando", "em_revisao", "aguardando_gates", "corrigindo", "bloqueada_humano", "falhou"]:
            e = corrigir_apos_gate_vermelho()
            e["seeds"]["s1"]["estado"] = estado
            for f in [filho("s1", "running", run="r1"), filho("s1", "dispatched", run=None)]:
                novo = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[f])
                self.assertEqual(novo["seeds"]["s1"], e["seeds"]["s1"], (estado, f))

    def test_terminais_nao_reiniciam(self):
        for estado in ["mergeada", "obsoleta"]:
            e = corrigir_apos_gate_vermelho()
            e["seeds"]["s1"]["estado"] = estado
            novo = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho("s1", "running", run="r2")])
            self.assertEqual(novo["seeds"]["s1"], e["seeds"]["s1"], estado)

    def test_cenario_bloqueada_redespachada_ganha_fixer_novo(self):
        """minor rr1-1: pendenteHumano → bloqueada_humano → o Warren redespacha → a seed recomeça."""
        e = est.aplicar(tudo_verde(ci="vermelho"), {"tipo": "corrigir", "seed": "s1", "sha": "bbb", "motivos": [], "achados": []}, {})
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho("s1", "failed")])
        e, feitas = ciclo(e, executor())
        self.assertEqual([a["tipo"] for a in da_seed(feitas)], ["aguardar_humano"])
        self.assertEqual(e["seeds"]["s1"]["estado"], "bloqueada_humano")
        # mesmo PR (o Warren reaproveita o branch): só o runId novo pode reiniciar a seed
        for obs in [filho("s1", "running", run="r2"), filho("s1", "pr_open", run="r2")]:
            e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[obs])
        self.assertEqual(e["seeds"]["s1"]["estado"], "em_revisao")
        e = est.registrar_pr(e, "s1", head_sha="zzz", branch="warren/s1-2", arquivos=["src/a/x.ts"], ci="vermelho")
        e = revisar(e, "zzz", "rv5", veredito("zzz"))
        e = verificar(e, "zzz")
        self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["corrigir"])


class TestMutantesSobreviventes(unittest.TestCase):
    """N: o desconto da revisão é exatamente 1 e o reinício de H zera `retomadas`."""

    def test_revisao_interrompida_devolve_exatamente_uma_tentativa(self):
        for motivo, cota in [("oom_killed", False), ("provider_error", True)]:
            e = com_pr(sha="bbb")
            e["seeds"]["s1"]["tentativasRevisao"] = 1
            e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv2"})
            self.assertEqual(e["seeds"]["s1"]["tentativasRevisao"], 2)
            e = est.registrar_fim_de_run(e, "rv2", estado_run="failed", motivo_falha=motivo, veredito=None, cota=cota)
            self.assertEqual(e["seeds"]["s1"]["tentativasRevisao"], 1, motivo)

    def test_reinicio_de_h_zera_retomadas_e_o_resto(self):
        e = despachar(estado_inicial(), "a")
        e["raias"]["a"].update(retomadas=3, retomar=True)
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="child_pr_merge_timeout", filhos=[])
        self.assertEqual((e["raias"]["a"]["estado"], e["raias"]["a"]["retomadas"]), ("falhou", 3))
        e = est.aplicar(e, {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}, {"runId": "orq1"})
        e = est.concluir_orquestrador(e)
        p = plano()
        p["raias"][1]["planoSeeds"] = "pl-NEW"
        e = est.sincronizar_plano(e, p)
        self.assertEqual(
            e["raias"]["a"],
            {
                "estado": "planejada",
                "planRunId": None,
                "retomar": False,
                "retomadas": 0,
                "falha": None,
                "planoSeeds": "pl-NEW",
                "seedsSubstituidas": [],
                "replanejamentos": 1,
            },
        )


class TestReplanejamentoNoMeioDaExecucao(unittest.TestCase):
    """O: o reinício de H só vale depois de o orquestrador ter visto a falha e terminado o run."""

    def plano_novo(self, plano_seeds="pl-NEW"):
        p = plano()
        p["raias"][1]["planoSeeds"] = plano_seeds
        return p

    def falhou_depois_de_replanejada(self):
        e = tudo_verde()
        p = self.plano_novo()
        e = est.sincronizar_plano(e, p)  # replanejada enquanto executava: fica com pl-000a
        self.assertEqual((e["raias"]["a"]["estado"], e["raias"]["a"]["planoSeeds"]), ("executando", "pl-000a"))
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="run_failed", filhos=[])
        return e, p

    def test_falha_depois_de_replanejar_acorda_e_nao_reinicia(self):
        e, p = self.falhou_depois_de_replanejada()
        e = est.sincronizar_plano(e, p)
        self.assertEqual((e["raias"]["a"]["estado"], e["seeds"]["s1"]["estado"]), ("falhou", "aguardando_gates"))
        self.assertFalse(any("obsoleto" in a for a in e["avisos"]))
        e, feitas = ciclo(e, executor(), p)
        self.assertIn({"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}, feitas)
        self.assertNotIn({"tipo": "despachar_raia", "raia": "a"}, feitas)
        self.assertNotIn("mergear", [a["tipo"] for a in da_seed(feitas)])
        # com o run do orquestrador em curso, o plano ainda não vale
        e = est.sincronizar_plano(e, p)
        self.assertEqual(e["raias"]["a"]["estado"], "falhou")
        self.assertEqual(e["chavesAcordadas"], ["raia_falhou:a"])

    def test_depois_do_acordar_concluido_um_plano_novo_reinicia(self):
        e, p = self.falhou_depois_de_replanejada()
        e = est.sincronizar_plano(e, p)
        e, feitas = ciclo(e, executor(), p)
        self.assertIn({"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}, feitas)
        for r in ["b", "c", "d"]:  # o mesmo ciclo despachou as outras raias; liberar as vagas
            e["raias"][r]["estado"] = "concluida"
        e = est.concluir_orquestrador(e)
        for plano_seeds in ["pl-NEW", "pl-NEW2"]:
            p2 = self.plano_novo(plano_seeds)
            novo = est.sincronizar_plano(e, p2)
            self.assertEqual((novo["raias"]["a"]["estado"], novo["raias"]["a"]["planoSeeds"]), ("planejada", plano_seeds))
            self.assertEqual(("s1" in novo["seeds"], novo["chavesAcordadas"]), (False, []))
            self.assertEqual(novo["raias"]["a"]["seedsSubstituidas"], ["s1"])
            novo, feitas = ciclo(novo, executor(), p2)
            self.assertIn({"tipo": "despachar_raia", "raia": "a"}, feitas)
            self.assertEqual(da_seed(feitas), [])

    def test_chave_de_outra_raia_ou_orquestrador_ocupado_nao_libera(self):
        e, p = self.falhou_depois_de_replanejada()
        e["chavesAcordadas"] = ["raia_falhou:b", "gate_falhou_apos_fixer:a"]
        self.assertEqual(est.sincronizar_plano(e, p)["raias"]["a"]["estado"], "falhou")
        e["chavesAcordadas"] = ["raia_falhou:a"]
        e["orquestrador"] = {"runId": "orq9", "motivo": "fase_concluida"}
        self.assertEqual(est.sincronizar_plano(e, p)["raias"]["a"]["estado"], "falhou")
        e["orquestrador"] = {"runId": None, "motivo": None}
        self.assertEqual(est.sincronizar_plano(e, p)["raias"]["a"]["estado"], "planejada")
        e["chavesAcordadas"] = None
        self.assertEqual(est.sincronizar_plano(e, p)["raias"]["a"]["estado"], "falhou")

    def test_caminho_original_de_h_continua(self):
        e, p = replanejar(tudo_verde())
        self.assertEqual((e["raias"]["a"]["estado"], "s1" in e["seeds"]), ("planejada", False))
        self.assertIn({"tipo": "despachar_raia", "raia": "a"}, acoes(e, p))


class TestSubstituirRaia(unittest.TestCase):
    """Rodada 1 da Task 7, H: replanejamento de uma raia `executando` (planoSeeds novo no plano)."""

    def com_seeds(self):
        e = com_pr(sha="bbb")
        e["seeds"]["s0"] = dict(est._seed_nova("a"), estado="mergeada", pr="https://github.com/dono/nome/pull/9")
        e["seeds"]["s2"] = dict(est._seed_nova("a"), estado="executando")
        e["seeds"]["sb"] = dict(est._seed_nova("b"), estado="em_revisao", pr=PR2)
        return e

    def test_volta_a_planejada_com_o_plano_novo_e_remove_as_seeds_nao_mergeadas(self):
        e = self.com_seeds()
        e["raias"]["a"].update(retomadas=2, retomar=True, falha="x")
        antes = copy.deepcopy(e)
        novo = est.substituir_raia(e, "a", "pl-00aa")
        self.assertEqual(e, antes)
        self.assertEqual(novo["raias"]["a"], dict(est._raia_nova("pl-00aa"), seedsSubstituidas=["s1", "s2"], replanejamentos=1))
        self.assertNotIn("s1", novo["seeds"])
        self.assertNotIn("s2", novo["seeds"])
        self.assertEqual(novo["seeds"]["s0"]["estado"], "mergeada")
        # um id reaproveitado pelo plano novo começa limpo
        reaproveitado = copy.deepcopy(novo)
        reaproveitado["raias"]["a"].update(estado="executando", planRunId="p2")
        depois = est.registrar_plano(reaproveitado, "a", estado_plano="running", falha=None, filhos=[filho("s1", "pr_open", run="r7", pr=PR2)])
        self.assertEqual(depois["seeds"]["s1"]["estado"], "em_revisao")
        self.assertEqual(depois["seeds"]["s1"]["pr"], PR2)
        self.assertEqual(novo["seeds"]["sb"], e["seeds"]["sb"])
        self.assertEqual(novo["raias"]["b"], e["raias"]["b"])
        # nenhuma ação para as seeds obsoletas; a raia volta a ser despachável
        self.assertEqual(da_seed(acoes(novo)), [])
        self.assertIn({"tipo": "despachar_raia", "raia": "a"}, acoes(novo))
        self.assertNotIn({"tipo": "despachar_raia", "raia": "a"}, acoes(e))

    def test_entrada_invalida_so_avisa(self):
        e = self.com_seeds()
        for raia_id, plano_seeds in (("zz", "pl-00aa"), ("a", None), ("a", "")):
            with self.subTest(raia=raia_id, plano_seeds=plano_seeds):
                novo = est.substituir_raia(e, raia_id, plano_seeds)
                self.assertEqual(novo["raias"], e["raias"])
                self.assertEqual(novo["seeds"], e["seeds"])
                self.assertTrue(novo["avisos"])

    def test_so_raia_executando_e_substituida(self):
        for estado in ("planejada", "concluida", "falhou"):
            with self.subTest(estado=estado):
                e = self.com_seeds()
                e["raias"]["a"]["estado"] = estado
                novo = est.substituir_raia(e, "a", "pl-00aa")
                self.assertEqual(novo["raias"]["a"], e["raias"]["a"])
                self.assertEqual(novo["seeds"], e["seeds"])



T0 = datetime.datetime(2026, 11, 3, 12, 0, 0)


class TestCorrecaoFinalF1CiAusente(unittest.TestCase):
    """F1: CI "ausente" com menos de 10 min desde o head visto aguarda; depois vai para o humano, como antes."""

    def com_ausente(self, sha="bbb", agora=T0):
        e = despachar(estado_inicial(), "a")
        e = est.registrar_plano(e, "a", estado_plano="running", falha=None, filhos=[filho()])
        return est.registrar_pr(e, "s1", head_sha=sha, branch="warren/s1", arquivos=["src/a/x.ts"], ci="ausente", agora=agora)

    def test_registrar_pr_grava_head_visto_em_quando_o_head_muda(self):
        e = self.com_ausente()
        self.assertEqual(e["seeds"]["s1"]["headVistoEm"], T0.isoformat())
        mesmo = est.registrar_pr(e, "s1", head_sha="bbb", branch="warren/s1", arquivos=[], ci="ausente", agora=T0 + datetime.timedelta(minutes=5))
        self.assertEqual(mesmo["seeds"]["s1"]["headVistoEm"], T0.isoformat())
        depois = T0 + datetime.timedelta(minutes=7)
        novo = est.registrar_pr(e, "s1", head_sha="ccc", branch="warren/s1", arquivos=[], ci="ausente", agora=depois)
        self.assertEqual(novo["seeds"]["s1"]["headVistoEm"], depois.isoformat())
        sem_relogio = est.registrar_pr(e, "s1", head_sha="ddd", branch="warren/s1", arquivos=[], ci="ausente")
        self.assertIsNone(sem_relogio["seeds"]["s1"]["headVistoEm"])

    def test_estado_antigo_sem_head_visto_em_ganha_a_marca(self):
        e = com_pr(sha="bbb", ci="ausente")
        e["seeds"]["s1"].pop("headVistoEm", None)
        e = est.registrar_pr(e, "s1", head_sha="bbb", branch="warren/s1", arquivos=["src/a/x.ts"], ci="ausente", agora=T0)
        self.assertEqual(e["seeds"]["s1"]["headVistoEm"], T0.isoformat())

    def test_ausente_recente_aguarda_sem_humano_e_pede_os_gates(self):
        e = self.com_ausente()
        for minutos in (0, 9):
            with self.subTest(minutos=minutos):
                lista = est.proximas_acoes(e, plano(), PROTEGIDOS, agora=T0 + datetime.timedelta(minutes=minutos, seconds=59))
                self.assertEqual([a["tipo"] for a in da_seed(lista)], ["revisar", "verificar"])

    def test_ausente_com_tudo_verde_dentro_da_janela_nao_mergeia_nem_escala(self):
        e = self.com_ausente()
        e = revisar(e, "bbb", "rv1", veredito("bbb"))
        e = verificar(e, "bbb")
        self.assertEqual(da_seed(est.proximas_acoes(e, plano(), PROTEGIDOS, agora=T0 + datetime.timedelta(minutes=3))), [])

    def test_ausente_depois_de_10_min_vai_para_o_humano(self):
        e = self.com_ausente()
        for agora in (T0 + datetime.timedelta(minutes=10), T0 + datetime.timedelta(hours=3)):
            with self.subTest(agora=agora):
                [acao] = da_seed(est.proximas_acoes(e, plano(), PROTEGIDOS, agora=agora))
                self.assertEqual((acao["tipo"], acao["motivos"]), ("aguardar_humano", ["repositório sem CI"]))

    def test_sem_relogio_ou_marca_ilegivel_vai_para_o_humano(self):
        e = self.com_ausente()
        [acao] = da_seed(est.proximas_acoes(e, plano(), PROTEGIDOS))
        self.assertEqual(acao["tipo"], "aguardar_humano")
        for ruim in (None, "", "ontem", 3, (T0 + datetime.timedelta(hours=1)).isoformat()):
            with self.subTest(ruim=ruim):
                e2 = copy.deepcopy(e)
                e2["seeds"]["s1"]["headVistoEm"] = ruim
                [acao] = da_seed(est.proximas_acoes(e2, plano(), PROTEGIDOS, agora=T0))
                self.assertEqual(acao["tipo"], "aguardar_humano")
        com_fuso = T0.replace(tzinfo=datetime.timezone.utc)
        [acao] = da_seed(est.proximas_acoes(e, plano(), PROTEGIDOS, agora=com_fuso))
        self.assertEqual(acao["tipo"], "aguardar_humano")


class TestCorrecaoFinalF2Replanejamentos(unittest.TestCase):
    """F2c: cada reinício da raia por planoSeeds novo conta em `replanejamentos`."""

    def test_substituir_raia_conta(self):
        e = com_pr(sha="bbb")
        e = est.substituir_raia(e, "a", "pl-00aa")
        self.assertEqual(e["raias"]["a"]["replanejamentos"], 1)
        e["raias"]["a"].update(estado="executando", planRunId="p2")
        e = est.substituir_raia(e, "a", "pl-00ab")
        self.assertEqual(e["raias"]["a"]["replanejamentos"], 2)

    def test_reinicio_h_da_raia_falha_conta(self):
        e = despachar(estado_inicial(), "a")
        e["raias"]["a"]["replanejamentos"] = 1
        e = est.registrar_plano(e, "a", estado_plano="failed", falha="run_failed", filhos=[])
        e = est.aplicar(e, {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "a"}, {"runId": "orq1"})
        e = est.concluir_orquestrador(e)
        p = plano()
        p["raias"][1]["planoSeeds"] = "pl-00aa"
        e = est.sincronizar_plano(e, p)
        self.assertEqual((e["raias"]["a"]["estado"], e["raias"]["a"]["replanejamentos"]), ("planejada", 2))

    def test_contador_corrompido_recomeca_em_um(self):
        for ruim in (None, "x", True, -3):
            with self.subTest(ruim=ruim):
                e = com_pr(sha="bbb")
                e["raias"]["a"]["replanejamentos"] = ruim
                self.assertGreaterEqual(est.substituir_raia(e, "a", "pl-00aa")["raias"]["a"]["replanejamentos"], 1)


class TestCorrecaoFinalF4VereditoDoShaPedido(unittest.TestCase):
    """F4: o veredito só vale se o sha dele é o sha pedido na revisão (`revisaoSha`)."""

    def test_revisar_grava_o_sha_pedido(self):
        e = com_pr(sha="bbb")
        e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv1"})
        self.assertEqual(e["seeds"]["s1"]["revisaoSha"], "bbb")

    def test_veredito_de_outro_sha_e_descartado(self):
        e = com_pr(sha="bbb")
        e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv1"})
        e = est.registrar_pr(e, "s1", head_sha="ccc", branch="warren/s1", arquivos=["src/a/x.ts"], ci="verde")
        e = est.registrar_fim_de_run(e, "rv1", estado_run="succeeded", motivo_falha=None, veredito=veredito("ccc"), cota=False)
        seed = e["seeds"]["s1"]
        self.assertIsNone(seed["veredito"])
        self.assertIsNone(seed["revisaoRunId"])
        self.assertEqual(seed["estado"], "em_revisao")
        e = verificar(e, "ccc")
        self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["revisar"])
        e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "ccc"}, {"runId": "rv2"})
        e = est.registrar_fim_de_run(e, "rv2", estado_run="succeeded", motivo_falha=None, veredito=veredito("bbb"), cota=False)
        self.assertEqual([a["tipo"] for a in da_seed(acoes(e))], ["aguardar_humano"])

    def test_veredito_do_sha_pedido_vale(self):
        e = com_pr(sha="bbb")
        e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv1"})
        e = est.registrar_fim_de_run(e, "rv1", estado_run="succeeded", motivo_falha=None, veredito=veredito("bbb"), cota=False)
        self.assertEqual(e["seeds"]["s1"]["veredito"], veredito("bbb"))

    def test_sem_sha_pedido_nenhum_veredito_vale(self):
        e = com_pr(sha="bbb")
        e = est.aplicar(e, {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": "rv1"})
        del e["seeds"]["s1"]["revisaoSha"]
        e = est.registrar_fim_de_run(e, "rv1", estado_run="succeeded", motivo_falha=None, veredito=veredito("bbb"), cota=False)
        self.assertIsNone(e["seeds"]["s1"]["veredito"])

if __name__ == "__main__":
    unittest.main()
