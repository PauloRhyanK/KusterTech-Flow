import http.client
import inspect
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import types
import unittest
import urllib.error
from unittest import mock

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

import forja  # noqa: E402
import motor  # noqa: E402
import motor_warren  # noqa: E402
import verificacao  # noqa: E402

TOKEN = "ghp_segredo123"
SHA = "a" * 40
SHA2 = "b" * 40
PR_URL = "https://github.com/acme/app/pull/12"
ISSUE_URL = "https://github.com/acme/app/issues/7"
API = "https://api.github.com"
SEGREDO = "corpo-secreto-ghs_zzz"


def json_bytes(obj):
    return json.dumps(obj).encode("utf-8")


def ok(obj, status=200):
    return (status, {}, json_bytes(obj))


def vazio(status):
    return (status, {}, b"")


class TransporteFalso:
    """Consome uma fila de respostas e falha alto quando ela acaba."""

    def __init__(self, *respostas):
        self.respostas = list(respostas)
        self.requisicoes = []

    def __call__(self, metodo, url, headers, corpo):
        self.requisicoes.append((metodo, url, dict(headers), corpo))
        if not self.respostas:
            raise AssertionError("requisição inesperada: %s %s" % (metodo, url))
        return self.respostas.pop(0)

    def exigir(self, testcase, quantidade):
        testcase.assertEqual(len(self.requisicoes), quantidade, self.requisicoes)
        testcase.assertEqual(self.respostas, [], "respostas não consumidas")

    def corpo_json(self, indice=-1):
        return json.loads(self.requisicoes[indice][3].decode("utf-8"))

    def urls(self):
        return [r[1] for r in self.requisicoes]


def novo(*respostas):
    transporte = TransporteFalso(*respostas)
    return forja.ForjaGitHub(TOKEN, transporte), transporte


def arquivos(n, inicio=0):
    return [{"filename": "src/f%d.ts" % i} for i in range(inicio, inicio + n)]


def pr_json(**extra):
    base = {"state": "open", "merged": False, "head": {"sha": SHA, "ref": "feat/x"}}
    base.update(extra)
    return base


def run(status="completed", conclusion="success"):
    return {"status": status, "conclusion": conclusion}


def checks(*runs, total=None):
    return {"total_count": len(runs) if total is None else total, "check_runs": list(runs)}


def status(state="pending", total=0):
    return {"state": state, "total_count": total, "statuses": [{"state": state}] * total}


def corpo_http_error(codigo, corpo=b""):
    return urllib.error.HTTPError(API + "/x", codigo, "m", {}, io.BytesIO(corpo))


class TestesAmbiente(unittest.TestCase):
    def test_python_minimo(self):
        self.assertGreaterEqual(sys.version_info[:2], (3, 11))


class TestesToken(unittest.TestCase):
    def test_token_vazio_ou_de_tipo_errado_e_recusado(self):
        for token in ("", "  \n", None, 5):
            with self.assertRaises(ValueError):
                forja.ForjaGitHub(token, TransporteFalso())

    def test_token_com_espaco_interno_ou_controle_e_invalido_e_nao_vaza(self):
        for token in ("a b", "a\tb", "ab\x00c", "ab\ncd", "toké"):
            with self.assertRaises(ValueError) as ctx:
                forja.ForjaGitHub(token, TransporteFalso())
            self.assertEqual(str(ctx.exception), "token inválido")
            self.assertNotIn(token.strip(), str(ctx.exception))

    def test_token_com_quebra_de_linha_final_e_limpo(self):
        t = TransporteFalso(ok(pr_json()), ok([]))
        ForjaGitHub = forja.ForjaGitHub("abc\n", t)
        ForjaGitHub.pr(PR_URL)
        self.assertEqual(t.requisicoes[0][2]["Authorization"], "Bearer abc")

    def test_cabecalhos_em_toda_requisicao(self):
        f, t = novo(ok(pr_json()), ok([]))
        f.pr(PR_URL)
        t.exigir(self, 2)
        for metodo, url, headers, corpo in t.requisicoes:
            self.assertEqual(metodo, "GET")
            self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)
            self.assertEqual(headers["Accept"], "application/vnd.github+json")
            self.assertEqual(headers["X-GitHub-Api-Version"], "2022-11-28")
            self.assertIsNone(corpo)


class TestesUrlsEValidacao(unittest.TestCase):
    URLS_RUINS = [
        "http://github.com/acme/app/pull/12",
        "https://github.com.evil.com/acme/app/pull/12",
        "https://api.github.com/acme/app/pull/12",
        "https://user@github.com/acme/app/pull/12",
        "https://github.com/acme/app/pull/12/",
        "https://github.com/acme/app/pull/12/files",
        "https://github.com/acme/app/pull/12?x=1",
        "https://github.com/acme/app/pull/12#c",
        "https://github.com/acme/app/pull/12\n",
        " https://github.com/acme/app/pull/12",
        "https://github.com/acme/app/pull/abc",
        "https://github.com/acme/app/pull/-1",
        "https://github.com/acme/app/pull/",
        "https://github.com/acme/app/pull/١٢",
        "https://github.com/./app/pull/12",
        "https://github.com/acme/../pull/12",
        "https://github.com/../app/pull/12",
        "https://github.com//app/pull/12",
        "https://github.com/acme/app%2Fx/pull/12",
        "https://github.com/ac me/app/pull/12",
        "https://github.com/acme/app/commit/12",
        "https://github.com/acme/app/issues/12",
        "",
        None,
        12,
    ]

    def test_pr_recusa_urls_ruins_sem_requisicao(self):
        for url in self.URLS_RUINS:
            f, t = novo()
            with self.assertRaises(ValueError, msg=repr(url)):
                f.pr(url)
            t.exigir(self, 0)

    def test_mergear_recusa_urls_ruins_sem_requisicao(self):
        for url in self.URLS_RUINS:
            f, t = novo()
            with self.assertRaises(ValueError, msg=repr(url)):
                f.mergear(url, SHA)
            t.exigir(self, 0)

    def test_decisao_recusa_urls_ruins_e_de_pr(self):
        urls = [u.replace("/pull/", "/issues/") for u in self.URLS_RUINS if isinstance(u, str) and "/pull/" in u]
        urls = [u for u in urls if u not in ("https://github.com/acme/app/issues/12",)]
        for url in urls + [None, 12, PR_URL, "https://github.com/acme/app/pull/7"]:
            f, t = novo()
            with self.assertRaises(ValueError, msg=repr(url)):
                f.decisao(url)
            t.exigir(self, 0)

    def test_repo_invalido_em_todos_os_metodos_sem_requisicao(self):
        ruins = ["acme", "acme/app/x", "/app", "acme/", "./app", "acme/..", "a c/app", "acme/app\n", "", None, "acme/ap%70"]
        for repo in ruins:
            for chamada in (
                lambda f: f.ci(repo, SHA),
                lambda f: f.arquivo(repo, "main", "a.txt"),
                lambda f: f.abrir_decisao(repo, "t", "c"),
            ):
                f, t = novo()
                with self.assertRaises(ValueError, msg=repr(repo)):
                    chamada(f)
                t.exigir(self, 0)

    def test_owner_e_repo_com_pontos_hifens_e_sublinhado_passam(self):
        f, t = novo(ok(pr_json()), ok([]))
        r = f.pr("https://github.com/a.b-c_d/e.f-g_h/pull/3")
        t.exigir(self, 2)
        self.assertEqual(r["repo"], "a.b-c_d/e.f-g_h")
        self.assertEqual(r["numero"], 3)
        self.assertEqual(t.urls()[0], API + "/repos/a.b-c_d/e.f-g_h/pulls/3")


class TestesPr(unittest.TestCase):
    def test_campos_e_urls(self):
        f, t = novo(ok(pr_json()), ok(arquivos(2)))
        r = f.pr(PR_URL)
        t.exigir(self, 2)
        self.assertEqual(
            r,
            {
                "aberto": True,
                "headSha": SHA,
                "branch": "feat/x",
                "repo": "acme/app",
                "numero": 12,
                "arquivos": ["src/f0.ts", "src/f1.ts"],
                "mergeado": False,
            },
        )
        self.assertEqual(t.urls()[0], API + "/repos/acme/app/pulls/12")
        self.assertEqual(t.urls()[1], API + "/repos/acme/app/pulls/12/files?per_page=100&page=1")

    def test_pagina_dois_blocos_100_mais_3(self):
        f, t = novo(ok(pr_json()), ok(arquivos(100)), ok(arquivos(3, 100)))
        r = f.pr(PR_URL)
        t.exigir(self, 3)
        self.assertEqual(len(r["arquivos"]), 103)
        self.assertEqual(r["arquivos"][0], "src/f0.ts")
        self.assertEqual(r["arquivos"][102], "src/f102.ts")
        self.assertTrue(t.urls()[2].endswith("/files?per_page=100&page=2"))

    def test_pagina_cheia_pede_a_seguinte_ate_uma_vazia(self):
        f, t = novo(ok(pr_json()), ok(arquivos(100)), ok([]))
        r = f.pr(PR_URL)
        t.exigir(self, 3)
        self.assertEqual(len(r["arquivos"]), 100)

    def test_99_arquivos_nao_pedem_segunda_pagina(self):
        f, t = novo(ok(pr_json()), ok(arquivos(99)))
        self.assertEqual(len(f.pr(PR_URL)["arquivos"]), 99)
        t.exigir(self, 2)

    def test_renomeacao_inclui_o_caminho_antigo(self):
        entradas = [
            {"filename": "src/novo.ts", "previous_filename": "src/modules/auth/antigo.ts", "status": "renamed"},
            {"filename": "README.md"},
        ]
        f, t = novo(ok(pr_json()), ok(entradas))
        r = f.pr(PR_URL)
        t.exigir(self, 2)
        self.assertEqual(r["arquivos"], ["src/novo.ts", "src/modules/auth/antigo.ts", "README.md"])

    def test_estado_aberto_vem_de_state(self):
        for estado, merged, esperado in (("open", False, True), ("closed", False, False), ("closed", True, False)):
            f, t = novo(ok(pr_json(state=estado, merged=merged)), ok([]))
            self.assertIs(f.pr(PR_URL)["aberto"], esperado)
            t.exigir(self, 2)

    def test_changed_files_diferente_do_total_lido_e_erro(self):
        f, t = novo(ok(pr_json(changed_files=3001)), ok(arquivos(2)))
        with self.assertRaises(RuntimeError) as ctx:
            f.pr(PR_URL)
        t.exigir(self, 2)
        self.assertIn("changed_files", str(ctx.exception))

    def test_changed_files_coerente_passa(self):
        f, t = novo(ok(pr_json(changed_files=2)), ok(arquivos(2)))
        self.assertEqual(len(f.pr(PR_URL)["arquivos"]), 2)
        t.exigir(self, 2)

    def test_formato_inesperado_vira_runtime_error_com_o_campo(self):
        casos = [
            ([ok([1])], "resposta não é um objeto"),
            ([ok({"state": "open"})], "head"),
            ([ok({"state": "open", "head": {"sha": SHA}})], "head.ref"),
            ([ok({"state": "open", "head": {"ref": "x"}})], "head.sha"),
            ([ok({"state": "open", "head": {"sha": 5, "ref": "x"}})], "head.sha"),
            ([ok({"state": "open", "head": {"sha": "", "ref": "x"}})], "head.sha"),
            ([ok({"head": {"sha": SHA, "ref": "x"}})], "state"),
            ([ok({"state": 1, "head": {"sha": SHA, "ref": "x"}})], "state"),
            ([ok(pr_json(changed_files="3"))], "changed_files"),
            ([ok(pr_json()), ok({"filename": "a"})], "lista"),
            ([ok(pr_json()), ok([{"nome": "a"}])], "filename"),
            ([ok(pr_json()), ok([{"filename": ""}])], "filename"),
            ([ok(pr_json()), ok([{"filename": 3}])], "filename"),
            ([ok(pr_json()), ok(["a"])], "arquivos"),
            ([ok(pr_json()), ok([{"filename": "a", "previous_filename": 4}])], "previous_filename"),
            ([(200, {}, b"<html>" + SEGREDO.encode() + b"</html>")], "não é JSON"),
        ]
        for respostas, trecho in casos:
            f, t = novo(*respostas)
            with self.assertRaises(RuntimeError, msg=trecho) as ctx:
                f.pr(PR_URL)
            self.assertIn(trecho, str(ctx.exception))
            self.assertNotIn(SEGREDO, str(ctx.exception))
            self.assertNotIn(SEGREDO, "".join(traceback.format_exception(ctx.exception)))
            self.assertEqual(t.respostas, [])

    def test_previous_filename_nulo_e_aceito(self):
        f, t = novo(ok(pr_json()), ok([{"filename": "a", "previous_filename": None}]))
        self.assertEqual(f.pr(PR_URL)["arquivos"], ["a"])
        t.exigir(self, 2)

    def test_limite_de_paginas_e_erro(self):
        respostas = [ok(pr_json())] + [ok(arquivos(100)) for _ in range(40)]
        f, t = novo(*respostas)
        with self.assertRaises(RuntimeError):
            f.pr(PR_URL)
        self.assertLessEqual(len(t.requisicoes), 41)

    def test_404_e_erro(self):
        f, t = novo(vazio(404))
        with self.assertRaises(RuntimeError) as ctx:
            f.pr(PR_URL)
        t.exigir(self, 1)
        self.assertIn("HTTP 404", str(ctx.exception))
        self.assertIn("/repos/acme/app/pulls/12", str(ctx.exception))


class TestesCi(unittest.TestCase):
    def resultado(self, check_runs, estado):
        f, t = novo(ok(check_runs), ok(estado))
        r = f.ci("acme/app", SHA)
        t.exigir(self, 2)
        return r

    def test_urls(self):
        f, t = novo(ok(checks()), ok(status()))
        f.ci("acme/app", SHA)
        self.assertEqual(
            t.urls(),
            [
                API + "/repos/acme/app/commits/%s/check-runs?per_page=100&page=1" % SHA,
                API + "/repos/acme/app/commits/%s/status" % SHA,
            ],
        )

    def test_ausente_sem_check_runs_e_com_status_pending_total_zero(self):
        self.assertEqual(self.resultado(checks(), status("pending", 0)), "ausente")

    def test_status_pending_com_total_zero_nao_e_pendente_quando_ha_check_run(self):
        self.assertEqual(self.resultado(checks(run()), status("pending", 0)), "verde")

    def test_so_check_runs_verdes_e_verde(self):
        self.assertEqual(self.resultado(checks(run(), run()), status("pending", 0)), "verde")

    def test_neutral_e_skipped_sao_verdes(self):
        for conclusao in ("neutral", "skipped", "success"):
            self.assertEqual(self.resultado(checks(run(conclusion=conclusao)), status()), "verde", conclusao)

    def test_check_run_nao_completo_e_pendente(self):
        for estado in ("queued", "in_progress", "waiting", "requested", "pending"):
            r = self.resultado(checks(run(), run(estado, None)), status())
            self.assertEqual(r, "pendente", estado)

    def test_status_pending_com_total_positivo_e_pendente(self):
        self.assertEqual(self.resultado(checks(), status("pending", 1)), "pendente")
        self.assertEqual(self.resultado(checks(run()), status("pending", 2)), "pendente")

    def test_so_success_neutral_e_skipped_contam_como_sucesso(self):
        # Qualquer outra conclusão (inclusive vazia, nula ou desconhecida) é vermelho.
        for conclusao in (
            "failure",
            "cancelled",
            "timed_out",
            "action_required",
            "startup_failure",
            "stale",
            "",
            None,
            "mistério",
            "SUCCESS",
            "Success",
            3,
            ["success"],
        ):
            r = self.resultado(checks(run(), run(conclusion=conclusao)), status())
            self.assertEqual(r, "vermelho", repr(conclusao))
            r = self.resultado(checks(run(conclusion=conclusao)), status("pending", 0))
            self.assertEqual(r, "vermelho", repr(conclusao))

    def test_check_run_completo_sem_a_chave_conclusion_e_vermelho(self):
        self.assertEqual(self.resultado(checks({"status": "completed"}), status()), "vermelho")

    def test_status_failure_error_e_desconhecido_sao_vermelhos(self):
        for estado in ("failure", "error", "mistério", "", None, 5, "SUCCESS", ["success"]):
            corpo = {"state": estado, "total_count": 1, "statuses": [{}]}
            self.assertEqual(self.resultado(checks(run()), corpo), "vermelho", repr(estado))
            self.assertEqual(self.resultado(checks(), corpo), "vermelho", repr(estado))
        sem_state = {"total_count": 1, "statuses": [{}]}
        self.assertEqual(self.resultado(checks(run()), sem_state), "vermelho")

    def test_status_success_sozinho_e_verde(self):
        self.assertEqual(self.resultado(checks(), status("success", 2)), "verde")

    def test_pendente_tem_precedencia_sobre_vermelho(self):
        r = self.resultado(checks(run(conclusion="failure"), run("in_progress", None)), status())
        self.assertEqual(r, "pendente")
        r = self.resultado(checks(run(conclusion="failure")), status("pending", 1))
        self.assertEqual(r, "pendente")

    def test_vermelho_do_status_com_check_run_verde(self):
        self.assertEqual(self.resultado(checks(run(), run(conclusion="skipped")), status("failure", 1)), "vermelho")

    def test_paginacao_de_check_runs(self):
        pagina1 = checks(*[run() for _ in range(100)], total=150)
        pagina2 = checks(*([run() for _ in range(49)] + [run(conclusion="failure")]), total=150)
        f, t = novo(ok(pagina1), ok(pagina2), ok(status()))
        self.assertEqual(f.ci("acme/app", SHA), "vermelho")
        t.exigir(self, 3)
        self.assertTrue(t.urls()[0].endswith("check-runs?per_page=100&page=1"))
        self.assertTrue(t.urls()[1].endswith("check-runs?per_page=100&page=2"))
        self.assertTrue(t.urls()[2].endswith("/status"))

    def test_check_run_vermelho_so_na_pagina_dois_nao_e_perdido_com_total_cem(self):
        pagina1 = checks(*[run() for _ in range(100)], total=101)
        pagina2 = checks(run(conclusion="timed_out"), total=101)
        f, t = novo(ok(pagina1), ok(pagina2), ok(status()))
        self.assertEqual(f.ci("acme/app", SHA), "vermelho")
        t.exigir(self, 3)

    def test_total_cem_com_cem_itens_usa_uma_pagina(self):
        f, t = novo(ok(checks(*[run() for _ in range(100)])), ok(status()))
        self.assertEqual(f.ci("acme/app", SHA), "verde")
        t.exigir(self, 2)

    def test_pagina_vazia_antes_do_total_e_erro(self):
        f, t = novo(ok(checks(run(), total=3)), ok(checks(total=3)))
        with self.assertRaises(RuntimeError) as ctx:
            f.ci("acme/app", SHA)
        t.exigir(self, 2)
        self.assertIn("check-runs", str(ctx.exception))

    def test_sha_invalido_levanta_sem_requisicao(self):
        ruins = ["", "abc12", "abcdef", "abc1234", "a" * 7, "a" * 39, "g" * 40, "a" * 41, "A" * 40, "../x"]
        ruins += [SHA + "\n", " " + SHA, None, 5, "a/b/c1234", "é" * 7, "main", "v1.0.0"]
        for sha in ruins:
            f, t = novo()
            with self.assertRaises(ValueError, msg=repr(sha)):
                f.ci("acme/app", sha)
            t.exigir(self, 0)

    def test_so_sha_de_40_hex_minusculos_e_aceito(self):
        for sha in (SHA, "0123456789abcdef" * 2 + "01234567"):
            f, t = novo(ok(checks()), ok(status()))
            f.ci("acme/app", sha)
            t.exigir(self, 2)
            self.assertIn("/commits/%s/" % sha, t.urls()[0])

    def test_formato_inesperado(self):
        casos = [
            ([ok([])], "resposta não é um objeto"),
            ([ok({"total_count": 1})], "check_runs"),
            ([ok({"check_runs": []})], "total_count"),
            ([ok({"total_count": "1", "check_runs": []})], "total_count"),
            ([ok({"total_count": True, "check_runs": []})], "total_count"),
            ([ok({"total_count": 1, "check_runs": ["x"]})], "check_runs"),
            ([ok({"total_count": 1, "check_runs": [{"conclusion": "success"}]})], "status"),
            ([ok(checks()), ok([])], "resposta não é um objeto"),
            ([ok(checks()), ok({"state": "pending"})], "total_count"),
            ([ok(checks()), ok({"state": "pending", "total_count": "0"})], "total_count"),
            ([ok(checks()), ok({"state": "pending", "total_count": True})], "total_count"),
            ([ok(checks()), ok({"state": "pending", "total_count": -1})], "total_count"),
        ]
        for respostas, trecho in casos:
            f, t = novo(*respostas)
            with self.assertRaises(RuntimeError, msg=trecho) as ctx:
                f.ci("acme/app", SHA)
            self.assertIn(trecho, str(ctx.exception))
            self.assertEqual(t.respostas, [])

    def test_check_run_pendente_nao_exige_conclusao(self):
        self.assertEqual(self.resultado(checks({"status": "queued", "conclusion": None}), status()), "pendente")
        self.assertEqual(self.resultado(checks({"status": "queued"}), status()), "pendente")

    def test_erro_http_em_check_runs_e_em_status(self):
        f, t = novo(vazio(500))
        with self.assertRaises(RuntimeError) as ctx:
            f.ci("acme/app", SHA)
        t.exigir(self, 1)
        self.assertIn("HTTP 500", str(ctx.exception))
        f, t = novo(ok(checks()), vazio(403))
        with self.assertRaises(RuntimeError) as ctx:
            f.ci("acme/app", SHA)
        t.exigir(self, 2)
        self.assertIn("HTTP 403", str(ctx.exception))


class TestesMergear(unittest.TestCase):
    def test_200_envia_sha_e_merge_method_e_devolve_true(self):
        f, t = novo(ok({"merged": True, "sha": SHA2}))
        self.assertIs(f.mergear(PR_URL, SHA), True)
        t.exigir(self, 1)
        metodo, url, headers, corpo = t.requisicoes[0]
        self.assertEqual((metodo, url), ("PUT", API + "/repos/acme/app/pulls/12/merge"))
        self.assertEqual(json.loads(corpo), {"sha": SHA, "merge_method": "merge"})
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)

    def test_405_409_422_devolvem_false_com_uma_unica_requisicao(self):
        for codigo in (405, 409, 422):
            f, t = novo(ok({"message": SEGREDO}, codigo))
            self.assertIs(f.mergear(PR_URL, SHA), False, codigo)
            t.exigir(self, 1)

    def test_outros_status_sao_erro_sem_vazar_corpo(self):
        for codigo in (201, 204, 301, 302, 400, 401, 403, 404, 429, 500, 502):
            f, t = novo((codigo, {}, SEGREDO.encode()))
            with self.assertRaises(RuntimeError, msg=str(codigo)) as ctx:
                f.mergear(PR_URL, SHA)
            t.exigir(self, 1)
            self.assertIn("HTTP %d" % codigo, str(ctx.exception))
            self.assertNotIn(SEGREDO, str(ctx.exception))

    def test_sha_invalido_sem_requisicao(self):
        for sha in ("", "abc", "abcdef", "abc1234", "a" * 39, "x" * 40, "a" * 41, "A" * 40, None, 5, SHA + "\n", "main"):
            f, t = novo()
            with self.assertRaises(ValueError, msg=repr(sha)):
                f.mergear(PR_URL, sha)
            t.exigir(self, 0)

    def test_resposta_200_com_corpo_qualquer_e_true(self):
        f, t = novo((200, {}, b""))
        self.assertIs(f.mergear(PR_URL, SHA), True)
        t.exigir(self, 1)


class TestesArquivo(unittest.TestCase):
    def test_200_devolve_texto_com_accept_raw(self):
        f, t = novo((200, {}, "olá\nmundo".encode("utf-8")))
        self.assertEqual(f.arquivo("acme/app", "main", ".fabrica/plano.json"), "olá\nmundo")
        t.exigir(self, 1)
        metodo, url, headers, corpo = t.requisicoes[0]
        self.assertEqual(metodo, "GET")
        self.assertEqual(url, API + "/repos/acme/app/contents/.fabrica/plano.json?ref=main")
        self.assertEqual(headers["Accept"], "application/vnd.github.raw")
        self.assertEqual(headers["X-GitHub-Api-Version"], "2022-11-28")
        self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)

    def test_404_devolve_none(self):
        f, t = novo(vazio(404))
        self.assertIsNone(f.arquivo("acme/app", "main", "nao/existe.md"))
        t.exigir(self, 1)

    def test_conteudo_vazio_e_string_vazia_e_nao_none(self):
        f, t = novo((200, {}, b""))
        self.assertEqual(f.arquivo("acme/app", "main", "a.txt"), "")
        t.exigir(self, 1)

    def test_outros_erros_levantam(self):
        for codigo in (301, 403, 500):
            f, t = novo((codigo, {}, SEGREDO.encode()))
            with self.assertRaises(RuntimeError) as ctx:
                f.arquivo("acme/app", "main", "a.txt")
            t.exigir(self, 1)
            self.assertIn("HTTP %d" % codigo, str(ctx.exception))
            self.assertNotIn(SEGREDO, str(ctx.exception))

    def test_ref_e_caminho_sao_codificados(self):
        f, t = novo((200, {}, b"x"))
        f.arquivo("acme/app", "feat/x y&z=1#h", "docs/a b#c?d%e.md")
        t.exigir(self, 1)
        self.assertEqual(
            t.urls()[0],
            API + "/repos/acme/app/contents/docs/a%20b%23c%3Fd%25e.md?ref=feat%2Fx%20y%26z%3D1%23h",
        )

    def test_caminhos_perigosos_sem_requisicao(self):
        for caminho in ("../x", "a/../b", "a/..", "..", "/abs.txt", "", "a//b", "a/", "./x", "a/./b", ".", None, 5):
            f, t = novo()
            with self.assertRaises(ValueError, msg=repr(caminho)):
                f.arquivo("acme/app", "main", caminho)
            t.exigir(self, 0)

    def test_caminho_com_dois_pontos_dentro_do_nome_e_valido(self):
        f, t = novo((200, {}, b"x"))
        f.arquivo("acme/app", "main", "a/..b/c..d/e..")
        t.exigir(self, 1)

    def test_ref_vazio_ou_invalido_sem_requisicao(self):
        for ref in ("", None, 3):
            f, t = novo()
            with self.assertRaises(ValueError, msg=repr(ref)):
                f.arquivo("acme/app", ref, "a.txt")
            t.exigir(self, 0)

    def test_conteudo_que_nao_e_utf8_e_erro_sem_vazar(self):
        f, t = novo((200, {}, b"\xff\xfe" + SEGREDO.encode()))
        with self.assertRaises(RuntimeError) as ctx:
            f.arquivo("acme/app", "main", "a.bin")
        t.exigir(self, 1)
        self.assertNotIn(SEGREDO, str(ctx.exception))
        self.assertIsNone(ctx.exception.__cause__)
        self.assertTrue(ctx.exception.__suppress_context__)


class TestesDecisao(unittest.TestCase):
    def test_abrir_decisao_corpo_label_e_retorno(self):
        f, t = novo(ok({"html_url": ISSUE_URL, "number": 7}, 201))
        self.assertEqual(f.abrir_decisao("acme/app", "[fábrica] sd-1: decisão necessária", "motivos\n- a"), ISSUE_URL)
        t.exigir(self, 1)
        metodo, url, headers, corpo = t.requisicoes[0]
        self.assertEqual((metodo, url), ("POST", API + "/repos/acme/app/issues"))
        self.assertEqual(
            json.loads(corpo),
            {"title": "[fábrica] sd-1: decisão necessária", "body": "motivos\n- a", "labels": ["fabrica:decisao"]},
        )
        self.assertEqual(headers["Content-Type"], "application/json")

    def test_abrir_decisao_formato_inesperado(self):
        casos = [
            ([ok({"number": 7}, 201)], "html_url"),
            ([ok({"html_url": 5}, 201)], "html_url"),
            ([ok({"html_url": ""}, 201)], "html_url"),
            ([ok({"html_url": "javascript:alert(1)"}, 201)], "html_url"),
            ([ok({"html_url": "https://github.com/acme/app/pull/7"}, 201)], "html_url"),
            ([ok([], 201)], "resposta não é um objeto"),
            ([ok({"html_url": ISSUE_URL}, 200)], "HTTP 200"),
            ([ok({"message": SEGREDO}, 500)], "HTTP 500"),
            ([ok({"message": SEGREDO}, 403)], "HTTP 403"),
            ([ok({"message": SEGREDO}, 422)], "HTTP 422"),
        ]
        for respostas, trecho in casos:
            f, t = novo(*respostas)
            with self.assertRaises(RuntimeError, msg=trecho) as ctx:
                f.abrir_decisao("acme/app", "t", "c")
            t.exigir(self, 1)
            self.assertIn(trecho, str(ctx.exception))
            self.assertNotIn(SEGREDO, str(ctx.exception))

    def test_abrir_decisao_titulo_ou_corpo_invalido_sem_requisicao(self):
        for titulo, corpo in (("", "c"), (None, "c"), ("t", None), (5, "c"), ("t", 5)):
            f, t = novo()
            with self.assertRaises(ValueError, msg=repr((titulo, corpo))):
                f.abrir_decisao("acme/app", titulo, corpo)
            t.exigir(self, 0)

    def test_corpo_vazio_e_permitido(self):
        f, t = novo(ok({"html_url": ISSUE_URL}, 201))
        f.abrir_decisao("acme/app", "t", "")
        t.exigir(self, 1)
        self.assertEqual(t.corpo_json()["body"], "")

    def test_decisao_aberta_sem_comentarios(self):
        f, t = novo(ok({"state": "open"}), ok([]))
        self.assertEqual(f.decisao(ISSUE_URL), {"fechada": False, "ultimoComentario": ""})
        t.exigir(self, 2)
        self.assertEqual(t.urls()[0], API + "/repos/acme/app/issues/7")
        self.assertEqual(t.urls()[1], API + "/repos/acme/app/issues/7/comments?per_page=100&page=1")

    def test_decisao_fechada_devolve_o_ultimo_comentario(self):
        f, t = novo(ok({"state": "closed"}), ok([{"body": "primeiro"}, {"body": "aprovado, pode seguir"}]))
        self.assertEqual(f.decisao(ISSUE_URL), {"fechada": True, "ultimoComentario": "aprovado, pode seguir"})
        t.exigir(self, 2)

    def test_decisao_pagina_ate_uma_pagina_curta(self):
        cheia = [{"body": "c%d" % i} for i in range(100)]
        f, t = novo(ok({"state": "closed"}), ok(cheia), ok([{"body": "x"}, {"body": "ultimo"}]))
        self.assertEqual(f.decisao(ISSUE_URL)["ultimoComentario"], "ultimo")
        t.exigir(self, 3)
        self.assertTrue(t.urls()[2].endswith("/comments?per_page=100&page=2"))

    def test_decisao_pagina_cheia_seguida_de_vazia_usa_o_ultimo_da_cheia(self):
        cheia = [{"body": "c%d" % i} for i in range(100)]
        f, t = novo(ok({"state": "open"}), ok(cheia), ok([]))
        self.assertEqual(f.decisao(ISSUE_URL)["ultimoComentario"], "c99")
        t.exigir(self, 3)

    def test_decisao_formato_inesperado(self):
        casos = [
            ([ok({})], "state"),
            ([ok({"state": 3})], "state"),
            ([ok([])], "resposta não é um objeto"),
            ([ok({"state": "open"}), ok({"body": "x"})], "lista"),
            ([ok({"state": "open"}), ok(["x"])], "comentários"),
            ([ok({"state": "open"}), ok([{"corpo": "x"}])], "body"),
            ([ok({"state": "open"}), ok([{"body": None}])], "body"),
            ([ok({"state": "open"}), vazio(404)], "HTTP 404"),
            ([vazio(404)], "HTTP 404"),
        ]
        for respostas, trecho in casos:
            f, t = novo(*respostas)
            with self.assertRaises(RuntimeError, msg=trecho) as ctx:
                f.decisao(ISSUE_URL)
            self.assertIn(trecho, str(ctx.exception))
            self.assertEqual(t.respostas, [])

    def test_so_state_closed_conta_como_fechada(self):
        for estado in ("open", "draft", "CLOSED", "locked"):
            f, t = novo(ok({"state": estado}), ok([]))
            self.assertIs(f.decisao(ISSUE_URL)["fechada"], False, estado)
            t.exigir(self, 2)

    def test_decisao_corpo_vazio_de_comentario_e_string_vazia(self):
        f, t = novo(ok({"state": "closed"}), ok([{"body": ""}]))
        self.assertEqual(f.decisao(ISSUE_URL), {"fechada": True, "ultimoComentario": ""})
        t.exigir(self, 2)


class TestesHigiene(unittest.TestCase):
    def test_erro_http_nao_vaza_corpo_nem_token(self):
        f, t = novo((500, {}, json_bytes({"message": SEGREDO, "token": TOKEN})))
        with self.assertRaises(RuntimeError) as ctx:
            f.pr(PR_URL)
        t.exigir(self, 1)
        impresso = "".join(traceback.format_exception(ctx.exception))
        self.assertNotIn(SEGREDO, impresso)
        self.assertNotIn(TOKEN, impresso)

    def test_falha_de_transporte_injetado_nao_vaza_nem_encadeia(self):
        erros = [
            urllib.error.URLError("x"),
            OSError("x"),
            TimeoutError("x"),
            http.client.IncompleteRead(b"x"),
            http.client.RemoteDisconnected("x"),
        ]
        for erro in erros:

            def transporte(metodo, url, headers, corpo, erro=erro):
                raise type(erro)("tok " + headers["Authorization"])

            f = forja.ForjaGitHub(TOKEN, transporte)
            with self.assertRaises(RuntimeError) as ctx:
                f.pr(PR_URL)
            impresso = "".join(traceback.format_exception(ctx.exception))
            self.assertNotIn(TOKEN, impresso)
            self.assertIn(type(erro).__name__, str(ctx.exception))
            self.assertIn("GET", str(ctx.exception))
            self.assertIn("/repos/acme/app/pulls/12", str(ctx.exception))
            self.assertIsNone(ctx.exception.__cause__)
            self.assertTrue(ctx.exception.__suppress_context__)

    def test_json_invalido_nao_encadeia_a_excecao_do_parser(self):
        f, t = novo((200, {}, b"{" + SEGREDO.encode()))
        with self.assertRaises(RuntimeError) as ctx:
            f.pr(PR_URL)
        self.assertIsNone(ctx.exception.__cause__)
        self.assertTrue(ctx.exception.__suppress_context__)
        self.assertNotIn(SEGREDO, "".join(traceback.format_exception(ctx.exception)))

    def test_json_nao_utf8_e_json_profundo_viram_runtime_error(self):
        for corpo in (b"\xff\xfe\x00", b"[" * 100000):
            f, t = novo((200, {}, corpo))
            with self.assertRaises(RuntimeError):
                f.pr(PR_URL)

    def test_resposta_malformada_do_transporte_e_runtime_error(self):
        for resposta in ("x", (200, {}), ("200", {}, b"{}"), (200, {}, "texto")):
            f = forja.ForjaGitHub(TOKEN, lambda *a, r=resposta: r)
            with self.assertRaises(RuntimeError):
                f.pr(PR_URL)


class TestesTransportePadrao(unittest.TestCase):
    def resposta_falsa(self, status=200, corpo=b"{}"):
        r = mock.MagicMock()
        r.status = status
        r.headers = {}
        r.read.return_value = corpo
        r.__enter__.return_value = r
        r.__exit__.return_value = False
        return r

    def test_padrao_usa_urllib_com_a_api_do_github(self):
        resposta = self.resposta_falsa(200, json_bytes(pr_json()))
        resposta2 = self.resposta_falsa(200, b"[]")
        f = forja.ForjaGitHub(TOKEN)
        with mock.patch.object(motor_warren, "_abrir", side_effect=[resposta, resposta2]) as abrir:
            r = f.pr(PR_URL)
        self.assertEqual(abrir.call_count, 2)
        req = abrir.call_args_list[0].args[0]
        self.assertEqual(req.full_url, API + "/repos/acme/app/pulls/12")
        self.assertEqual(req.get_header("Authorization"), "Bearer " + TOKEN)
        self.assertEqual(abrir.call_args_list[0].kwargs["timeout"], 30)
        self.assertEqual(r["headSha"], SHA)

    def test_padrao_trata_erro_http_sem_vazar(self):
        erro = corpo_http_error(500, SEGREDO.encode())
        f = forja.ForjaGitHub(TOKEN)
        with mock.patch.object(motor_warren, "_abrir", side_effect=erro) as abrir:
            with self.assertRaises(RuntimeError) as ctx:
                f.pr(PR_URL)
        self.assertEqual(abrir.call_count, 1)
        self.assertIn("HTTP 500", str(ctx.exception))
        self.assertNotIn(SEGREDO, "".join(traceback.format_exception(ctx.exception)))

    def test_padrao_converte_falha_de_rede_em_runtime_error(self):
        f = forja.ForjaGitHub(TOKEN)
        with mock.patch.object(motor_warren, "_abrir", side_effect=urllib.error.URLError("segredo ghs_x")) as abrir:
            with self.assertRaises(RuntimeError) as ctx:
                f.pr(PR_URL)
        self.assertEqual(abrir.call_count, 1)
        self.assertIn("URLError", str(ctx.exception))
        self.assertNotIn("ghs_", str(ctx.exception))

    def test_redirecionamento_nao_e_seguido_e_vira_erro(self):
        erro = corpo_http_error(302)
        f = forja.ForjaGitHub(TOKEN)
        with mock.patch.object(motor_warren, "_abrir", side_effect=erro) as abrir:
            with self.assertRaises(RuntimeError) as ctx:
                f.pr(PR_URL)
        self.assertEqual(abrir.call_count, 1)
        self.assertIn("HTTP 302", str(ctx.exception))
        tipos = [type(h) for h in motor_warren._OPENER.handlers]
        self.assertIn(motor_warren._SemRedirecionamento, tipos)


class TestesMergeadoEFechar(unittest.TestCase):
    def test_mergeado_vem_do_campo_merged(self):
        for extra, esperado in (({"merged": True, "state": "closed"}, True), ({"merged": False}, False), ({}, False), ({"merged": "true"}, False)):
            with self.subTest(extra=extra):
                corpo = pr_json(**extra)
                if "merged" not in extra:
                    corpo.pop("merged")
                f, t = novo(ok(corpo), ok(arquivos(1)))
                self.assertIs(f.pr(PR_URL)["mergeado"], esperado)
                t.exigir(self, 2)

    def test_fechar_pr_comenta_e_fecha_pela_api_de_issues(self):
        f, t = novo(ok({"id": 1}, 201), ok({"state": "closed"}))
        self.assertIsNone(f.fechar_pr(PR_URL, "substituído pelo PR 13"))
        t.exigir(self, 2)
        self.assertEqual(t.requisicoes[0][0:2], ("POST", API + "/repos/acme/app/issues/12/comments"))
        self.assertEqual(t.corpo_json(0), {"body": "substituído pelo PR 13"})
        self.assertEqual(t.requisicoes[1][0:2], ("PATCH", API + "/repos/acme/app/issues/12"))
        self.assertEqual(t.corpo_json(1), {"state": "closed"})
        self.assertEqual(t.requisicoes[1][2]["Authorization"], "Bearer " + TOKEN)

    def test_fechar_aceita_url_de_issue(self):
        f, t = novo(ok({"id": 1}, 201), ok({"state": "closed"}))
        f.fechar_pr(ISSUE_URL, "o Warren voltou")
        self.assertEqual(t.requisicoes[1][0:2], ("PATCH", API + "/repos/acme/app/issues/7"))

    def test_fechar_pr_entradas_invalidas_sem_requisicao(self):
        for url, comentario in (
            ("https://github.com/acme/app/pull/x", "c"),
            ("http://github.com/acme/app/pull/1", "c"),
            ("https://github.com/acme/app/commit/1", "c"),
            (PR_URL, ""),
            (PR_URL, None),
            (None, "c"),
        ):
            with self.subTest(url=url, comentario=comentario):
                f, t = novo()
                with self.assertRaises(ValueError):
                    f.fechar_pr(url, comentario)
                t.exigir(self, 0)

    def test_fechar_pr_erros_http_nao_vazam(self):
        for respostas, trecho, n in (
            ([ok({"message": SEGREDO}, 404)], "HTTP 404", 1),
            ([ok({"id": 1}, 201), ok({"message": SEGREDO}, 422)], "HTTP 422", 2),
            ([ok({"id": 1}, 200)], "HTTP 200", 1),
        ):
            with self.subTest(trecho=trecho):
                f, t = novo(*respostas)
                with self.assertRaises(RuntimeError) as ctx:
                    f.fechar_pr(PR_URL, "c")
                t.exigir(self, n)
                self.assertIn(trecho, str(ctx.exception))
                self.assertNotIn(SEGREDO, str(ctx.exception))
                self.assertNotIn(TOKEN, str(ctx.exception))

    def test_falsa_fecha_pr_e_decisao_e_mergear_marca_mergeado(self):
        f = forja.ForjaFalsa()
        f.definir_pr(PR_URL, head_sha=SHA, branch="a")
        f.fechar_pr(PR_URL, "x")
        self.assertEqual((f.pr(PR_URL)["aberto"], f.pr(PR_URL)["mergeado"]), (False, False))
        self.assertEqual(f.fechados, [(PR_URL, "x")])
        url = f.abrir_decisao("acme/app", "t", "c")
        f.fechar_pr(url, "y")
        self.assertEqual(f.decisao(url), {"fechada": True, "ultimoComentario": "y"})
        outro = "https://github.com/acme/app/pull/99"
        f.definir_pr(outro, head_sha=SHA, branch="b")
        self.assertTrue(f.mergear(outro, SHA))
        self.assertEqual((f.pr(outro)["aberto"], f.pr(outro)["mergeado"]), (False, True))
        f.definir_pr(outro, head_sha=SHA, branch="b", mergeado=True, aberto=False)
        self.assertTrue(f.pr(outro)["mergeado"])
        with self.assertRaises(KeyError):
            f.fechar_pr("https://github.com/acme/app/pull/55", "z")
        with self.assertRaises(ValueError):
            f.fechar_pr(PR_URL, "")
        self.assertEqual([n for n, _ in f.chamadas].count("fechar_pr"), 4)


class TestesDecisoesRastreadas(unittest.TestCase):
    """Rodada 2, I2/I4/L9: procurar pelo nonce, reabrir e fechar decisões."""

    NONCE = "0123456789abcdef0123456789abcdef"

    def issue(self, n, corpo, **extra):
        item = {"html_url": "https://github.com/acme/app/issues/%d" % n, "body": corpo}
        item.update(extra)
        return item

    def test_procurar_decisao_acha_pelo_marcador_e_pagina(self):
        marcador = "<!-- fabrica:nonce=%s -->" % self.NONCE
        pagina1 = [self.issue(i, "outra") for i in range(100)]
        pagina2 = [
            self.issue(500, "x " + marcador, pull_request={"url": "x"}),
            self.issue(501, None),
            self.issue(502, "texto\n\n" + marcador),
        ]
        f, t = novo(ok(pagina1), ok(pagina2))
        self.assertEqual(f.procurar_decisao("acme/app", self.NONCE), "https://github.com/acme/app/issues/502")
        t.exigir(self, 2)
        self.assertEqual(
            t.urls(),
            [
                API + "/repos/acme/app/issues?labels=fabrica%3Adecisao&state=all&per_page=100&page=1",
                API + "/repos/acme/app/issues?labels=fabrica%3Adecisao&state=all&per_page=100&page=2",
            ],
        )

    def test_procurar_decisao_desde_ordena_por_criacao_e_para_cedo(self):
        """Rodada 3, P5: com 4.000 issues de decisão, poucas requisições."""
        desde = "2026-11-03T12:00:00Z"
        novas = [self.issue(5000 - i, "outra", created_at="2026-11-03T12:%02d:00Z" % (59 - i)) for i in range(60)]
        velhas = [self.issue(4000 - i, "outra", created_at="2026-11-02T10:00:00Z") for i in range(40)]
        f, t = novo(ok(novas + velhas))
        self.assertIsNone(f.procurar_decisao("acme/app", self.NONCE, desde))
        t.exigir(self, 1)
        self.assertEqual(
            t.urls()[0],
            API + "/repos/acme/app/issues?labels=fabrica%3Adecisao&state=all&per_page=100"
            "&since=2026-11-03T12%3A00%3A00Z&sort=created&direction=desc&page=1",
        )
        marcador = "<!-- fabrica:nonce=%s -->" % self.NONCE
        f, t = novo(ok([self.issue(7, "x " + marcador, created_at="2026-11-03T12:01:00Z")]))
        self.assertEqual(f.procurar_decisao("acme/app", self.NONCE, desde), "https://github.com/acme/app/issues/7")
        for ruim in ("ontem", 5, ""):
            f, t = novo()
            with self.assertRaises(ValueError):
                f.procurar_decisao("acme/app", self.NONCE, ruim)
            t.exigir(self, 0)
        falsa = forja.ForjaFalsa()
        url = falsa.abrir_decisao("acme/app", "t", marcador)
        self.assertEqual(falsa.procurar_decisao("acme/app", self.NONCE, desde), url)

    def test_procurar_decisao_sem_achado_devolve_none(self):
        f, t = novo(ok([self.issue(1, "nada")]))
        self.assertIsNone(f.procurar_decisao("acme/app", self.NONCE))
        t.exigir(self, 1)

    def test_procurar_decisao_entradas_e_respostas_invalidas(self):
        for nonce in ("", "xyz", "0" * 31, None, self.NONCE.upper()):
            f, t = novo()
            with self.assertRaises(ValueError):
                f.procurar_decisao("acme/app", nonce)
            t.exigir(self, 0)
        marcador = "<!-- fabrica:nonce=%s -->" % self.NONCE
        for respostas, trecho in (
            ([ok({"x": 1})], "lista"),
            ([ok({"message": SEGREDO}, 500)], "HTTP 500"),
            ([ok([{"html_url": "https://github.com/acme/app/pull/3", "body": marcador}])], "html_url"),
        ):
            f, t = novo(*respostas)
            with self.assertRaises(RuntimeError) as ctx:
                f.procurar_decisao("acme/app", self.NONCE)
            self.assertIn(trecho, str(ctx.exception))
            self.assertNotIn(SEGREDO, str(ctx.exception))

    def test_reabrir_e_fechar_decisao(self):
        for metodo, estado in (("reabrir_decisao", "open"), ("fechar_decisao", "closed")):
            f, t = novo(ok({"id": 1}, 201), ok({"state": estado}))
            self.assertIsNone(getattr(f, metodo)(ISSUE_URL, "comentário"))
            t.exigir(self, 2)
            self.assertEqual(t.requisicoes[0][0:2], ("POST", API + "/repos/acme/app/issues/7/comments"))
            self.assertEqual(t.corpo_json(0), {"body": "comentário"})
            self.assertEqual(t.requisicoes[1][0:2], ("PATCH", API + "/repos/acme/app/issues/7"))
            self.assertEqual(t.corpo_json(1), {"state": estado})
            for url, comentario in ((PR_URL, "c"), (ISSUE_URL, ""), ("x", "c")):
                f, t = novo()
                with self.assertRaises(ValueError):
                    getattr(f, metodo)(url, comentario)
                t.exigir(self, 0)
            f, t = novo(ok({"message": SEGREDO}, 403))
            with self.assertRaises(RuntimeError) as ctx:
                getattr(f, metodo)(ISSUE_URL, "c")
            self.assertNotIn(SEGREDO, str(ctx.exception))

    def test_falha_de_rede_da_forja_e_falha_de_rede(self):
        def transporte(metodo, url, headers, corpo):
            raise ConnectionRefusedError("x")

        f = forja.ForjaGitHub(TOKEN, transporte)
        with self.assertRaises(motor.FalhaDeRede):
            f.mergear(PR_URL, SHA)

    def test_falsa_procura_reabre_e_fecha(self):
        f = forja.ForjaFalsa()
        url = f.abrir_decisao("acme/app", "t", "corpo <!-- fabrica:nonce=%s -->" % self.NONCE)
        self.assertEqual(f.procurar_decisao("acme/app", self.NONCE), url)
        self.assertIsNone(f.procurar_decisao("acme/app", "f" * 32))
        f.fechar_decisao(url, "fechada")
        self.assertEqual(f.decisao(url), {"fechada": True, "ultimoComentario": "fechada"})
        f.reabrir_decisao(url, "reaberta")
        self.assertEqual(f.decisao(url), {"fechada": False, "ultimoComentario": "reaberta"})
        with self.assertRaises(KeyError):
            f.fechar_decisao("https://github.com/acme/app/issues/99", "x")
        with self.assertRaises(ValueError):
            f.reabrir_decisao(PR_URL, "x")
        nomes = [n for n, _ in f.chamadas]
        for nome in ("procurar_decisao", "fechar_decisao", "reabrir_decisao"):
            self.assertIn(nome, nomes)


class TestesForjaFalsa(unittest.TestCase):
    def falsa(self):
        return forja.ForjaFalsa()

    def test_espelha_todos_os_metodos_publicos_e_assinaturas(self):
        def publicos(cls):
            return {
                nome: inspect.signature(fn)
                for nome, fn in inspect.getmembers(cls, inspect.isfunction)
                if not nome.startswith("_")
            }

        real = publicos(forja.ForjaGitHub)
        for nome in ("pr", "ci", "mergear", "arquivo", "abrir_decisao", "decisao"):
            self.assertIn(nome, real)
        falsa = publicos(forja.ForjaFalsa)
        for nome, assinatura in real.items():
            self.assertIn(nome, falsa, nome)
            self.assertEqual(list(assinatura.parameters), list(falsa[nome].parameters), nome)

    def test_pr_desconhecido_levanta_key_error_para_dois_ids_diferentes(self):
        f = self.falsa()
        outro = "https://github.com/acme/app/pull/99"
        for url in (PR_URL, outro):
            with self.assertRaises(KeyError):
                f.pr(url)
        f.definir_pr(PR_URL, head_sha=SHA, branch="a")
        self.assertEqual(f.pr(PR_URL)["branch"], "a")
        with self.assertRaises(KeyError):
            f.pr(outro)

    def test_pr_devolve_o_formato_real_e_copia(self):
        f = self.falsa()
        f.definir_pr(PR_URL, head_sha=SHA, branch="feat/x", arquivos=["a.ts", "b.ts"])
        r = f.pr(PR_URL)
        self.assertEqual(
            r,
            {
                "aberto": True,
                "headSha": SHA,
                "branch": "feat/x",
                "repo": "acme/app",
                "numero": 12,
                "arquivos": ["a.ts", "b.ts"],
                "mergeado": False,
            },
        )
        r["arquivos"].append("c.ts")
        self.assertEqual(f.pr(PR_URL)["arquivos"], ["a.ts", "b.ts"])

    def test_dados_de_prs_distintos_ficam_separados(self):
        f = self.falsa()
        outro = "https://github.com/acme/app/pull/99"
        f.definir_pr(PR_URL, head_sha=SHA, branch="a", arquivos=["x"])
        f.definir_pr(outro, head_sha=SHA2, branch="b", aberto=False)
        self.assertEqual((f.pr(PR_URL)["headSha"], f.pr(PR_URL)["aberto"]), (SHA, True))
        self.assertEqual((f.pr(outro)["headSha"], f.pr(outro)["aberto"], f.pr(outro)["numero"]), (SHA2, False, 99))

    def test_ci_desconhecido_levanta_key_error_para_dois_ids_diferentes(self):
        f = self.falsa()
        for sha in (SHA, SHA2):
            with self.assertRaises(KeyError):
                f.ci("acme/app", sha)
        f.definir_ci("acme/app", SHA, "verde")
        self.assertEqual(f.ci("acme/app", SHA), "verde")
        with self.assertRaises(KeyError):
            f.ci("acme/app", SHA2)
        with self.assertRaises(KeyError):
            f.ci("acme/outro", SHA)

    def test_ci_e_definir_ci_exigem_sha_completo(self):
        f = self.falsa()
        for sha in ("abc1234", "A" * 40, "a" * 39):
            with self.assertRaises(ValueError, msg=sha):
                f.definir_ci("acme/app", sha, "verde")
            with self.assertRaises(ValueError, msg=sha):
                f.ci("acme/app", sha)

    def test_definir_ci_rejeita_resultado_desconhecido(self):
        with self.assertRaises(ValueError):
            self.falsa().definir_ci("acme/app", SHA, "azul")

    def test_mergear_registra_e_so_funciona_com_o_head_certo(self):
        f = self.falsa()
        f.definir_pr(PR_URL, head_sha=SHA, branch="a")
        self.assertIs(f.mergear(PR_URL, SHA2), False)
        self.assertEqual(f.merges, [])
        self.assertTrue(f.pr(PR_URL)["aberto"])
        self.assertIs(f.mergear(PR_URL, SHA), True)
        self.assertEqual(f.merges, [(PR_URL, SHA)])
        self.assertFalse(f.pr(PR_URL)["aberto"])
        self.assertIs(f.mergear(PR_URL, SHA), False)
        self.assertEqual(f.merges, [(PR_URL, SHA)])

    def test_mergear_desconhecido_levanta_key_error_para_dois_ids_e_nao_registra(self):
        f = self.falsa()
        for url in (PR_URL, "https://github.com/acme/app/pull/99"):
            with self.assertRaises(KeyError):
                f.mergear(url, SHA)
        self.assertEqual(f.merges, [])

    def test_mergear_valida_entradas_como_a_real(self):
        f = self.falsa()
        f.definir_pr(PR_URL, head_sha=SHA, branch="a")
        with self.assertRaises(ValueError):
            f.mergear(PR_URL, "xyz")
        with self.assertRaises(ValueError):
            f.mergear("https://github.com/acme/app/issues/12", SHA)
        self.assertEqual(f.merges, [])

    def test_arquivo_por_repo_ref_e_caminho(self):
        f = self.falsa()
        f.definir_arquivo("acme/app", "main", ".fabrica/plano.json", "{}")
        self.assertEqual(f.arquivo("acme/app", "main", ".fabrica/plano.json"), "{}")
        self.assertIsNone(f.arquivo("acme/app", "outra", ".fabrica/plano.json"))
        self.assertIsNone(f.arquivo("acme/app", "main", ".fabrica/outro.json"))
        self.assertIsNone(f.arquivo("acme/outro", "main", ".fabrica/plano.json"))
        with self.assertRaises(ValueError):
            f.arquivo("acme/app", "main", "../x")

    def test_abrir_decisao_registra_e_cria_decisao_consultavel(self):
        f = self.falsa()
        u1 = f.abrir_decisao("acme/app", "titulo 1", "corpo 1")
        u2 = f.abrir_decisao("acme/app", "titulo 2", "corpo 2")
        self.assertNotEqual(u1, u2)
        self.assertEqual(f.decisoes, [("titulo 1", "corpo 1"), ("titulo 2", "corpo 2")])
        self.assertEqual(f.decisao(u1), {"fechada": False, "ultimoComentario": ""})
        f.definir_decisao(u1, fechada=True, ultimo_comentario="ok")
        self.assertEqual(f.decisao(u1), {"fechada": True, "ultimoComentario": "ok"})
        self.assertEqual(f.decisao(u2), {"fechada": False, "ultimoComentario": ""})

    def test_decisao_desconhecida_levanta_key_error_para_dois_ids_diferentes(self):
        f = self.falsa()
        for url in (ISSUE_URL, "https://github.com/acme/app/issues/8"):
            with self.assertRaises(KeyError):
                f.decisao(url)
        f.definir_decisao(ISSUE_URL, fechada=True, ultimo_comentario="x")
        self.assertTrue(f.decisao(ISSUE_URL)["fechada"])
        with self.assertRaises(KeyError):
            f.decisao("https://github.com/acme/app/issues/8")

    def test_urls_de_decisao_e_pr_nao_se_misturam(self):
        f = self.falsa()
        f.definir_pr(PR_URL, head_sha=SHA, branch="a")
        with self.assertRaises(ValueError):
            f.decisao(PR_URL)

    def test_abrir_decisao_valida_como_a_real(self):
        f = self.falsa()
        with self.assertRaises(ValueError):
            f.abrir_decisao("acme", "t", "c")
        with self.assertRaises(ValueError):
            f.abrir_decisao("acme/app", "", "c")
        self.assertEqual(f.decisoes, [])

    def test_chamadas_sao_registradas_inclusive_as_que_falham(self):
        f = self.falsa()
        f.definir_pr(PR_URL, head_sha=SHA, branch="a")
        f.pr(PR_URL)
        with self.assertRaises(KeyError):
            f.ci("acme/app", SHA)
        f.mergear(PR_URL, SHA)
        f.arquivo("acme/app", "main", "a.txt")
        url = f.abrir_decisao("acme/app", "t", "c")
        f.definir_decisao(url, fechada=False, ultimo_comentario="")
        f.decisao(url)
        self.assertEqual(
            [nome for nome, _ in f.chamadas],
            ["pr", "ci", "mergear", "arquivo", "abrir_decisao", "decisao"],
        )
        self.assertEqual(f.chamadas[2][1], {"url": PR_URL, "sha": SHA})
        self.assertEqual(f.chamadas[1][1], {"repo": "acme/app", "sha": SHA})
        self.assertEqual(f.chamadas[4][1], {"repo": "acme/app", "titulo": "t", "corpo": "c"})


class TestesExecucaoDireta(unittest.TestCase):
    def test_modulos_importam_so_com_biblioteca_padrao_em_modo_isolado(self):
        resultado = subprocess.run(
            [sys.executable, "-I", "-c", "import sys; sys.path.insert(0, %r); import forja, verificacao, exportar" % str(RAIZ)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(resultado.returncode, 0, resultado.stderr)

    def test_sys_path_bootstrap_permite_importar_forja_de_outro_diretorio(self):
        with tempfile.TemporaryDirectory() as outro:
            resultado = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    "-c",
                    "import importlib.util as u; s = u.spec_from_file_location('f', %r); m = u.module_from_spec(s); "
                    "s.loader.exec_module(m); assert m.ForjaGitHub" % str(RAIZ / "forja.py"),
                ],
                capture_output=True,
                text=True,
                cwd=outro,
            )
        self.assertEqual(resultado.returncode, 0, resultado.stderr)


if __name__ == "__main__":
    unittest.main()
