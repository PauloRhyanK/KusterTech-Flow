import copy
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
        self.assertEqual(
            e,
            {
                "projeto": "prj_x",
                "repo": "dono/nome",
                "limiteParalelo": 3,
                "pausado": None,
                "raias": {i: dict(raia) for i in ["fundacao", "a", "b", "c", "d"]},
                "seeds": {},
                "orquestrador": {"runId": None, "motivo": None},
                "chavesAcordadas": [],
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
        self.assertEqual(e["raias"]["a"], {"estado": "executando", "planRunId": "plan_a", "retomar": False, "retomadas": 0, "falha": None})
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
                "revisaoRunId": None,
                "tentativasRevisao": 0,
                "fixerRunId": None,
                "fixerUsado": False,
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

    def test_merge_recusado_nao_muda_nada(self):
        e = tudo_verde()
        acao = {"tipo": "mergear", "seed": "s1", "sha": "bbb"}
        for resultado in [{"ok": False}, {}, {"ok": "sim"}]:
            self.assertEqual(est.aplicar(e, acao, resultado), e)

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
            self.assertEqual(da_seed(acoes(e)), [])

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

    def test_revisao_sem_run_id_bloqueia_sem_redespachar(self):
        e = est.aplicar(com_pr(), {"tipo": "revisar", "seed": "s1", "sha": "bbb"}, {"runId": ""})
        self.assertEqual(e["seeds"]["s1"]["estado"], "bloqueada_humano")
        self.assertEqual(da_seed(acoes(e)), [])

    def test_corrigir_sem_run_id_bloqueia_sem_redespachar(self):
        e = est.aplicar(tudo_verde(ci="vermelho"), {"tipo": "corrigir", "seed": "s1", "sha": "bbb", "motivos": [], "achados": []}, {})
        self.assertEqual(e["seeds"]["s1"]["estado"], "bloqueada_humano")
        self.assertEqual(da_seed(acoes(e)), [])

    def test_verificacao_invalida_bloqueia_sem_repetir(self):
        e = com_pr(sha="bbb")
        for ruim in [None, {"sha": "aaa", "codigo": 0}, {"sha": "bbb", "codigo": "0"}, {"sha": "bbb", "codigo": True}]:
            e2 = est.aplicar(e, {"tipo": "verificar", "seed": "s1", "sha": "bbb"}, {"verificacao": ruim})
            self.assertEqual(e2["seeds"]["s1"]["estado"], "bloqueada_humano", ruim)
            self.assertEqual(da_seed(acoes(e2)), [])


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

    def test_acordar_sem_run_id_nao_repete(self):
        acordar = {"tipo": "acordar", "motivo": "fase_concluida", "alvo": "fundacao"}
        e = est.novo_estado(plano(), projeto="p", repo="r")
        e["raias"]["fundacao"]["estado"] = "concluida"
        e = est.aplicar(e, acordar, {})
        self.assertEqual(e["orquestrador"]["runId"], None)
        self.assertEqual(acoes(e, plano("fundacao")), [])
        self.assertTrue(e["avisos"])


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
        ]
        for chamar in chamadas:
            antes = copy.deepcopy(e)
            novo = chamar(e)
            self.assertEqual(e, antes)
            self.assertIsNot(novo, e)
            self.assertNotEqual(novo, e)

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


if __name__ == "__main__":
    unittest.main()
