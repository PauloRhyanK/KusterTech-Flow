import http.client
import inspect
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
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
            {"aberto": True, "headSha": SHA, "branch": "feat/x", "repo": "acme/app", "numero": 12, "arquivos": ["a.ts", "b.ts"]},
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


def exec_falso(resultados):
    """Devolve (executar, chamadas); `resultados` é uma lista de CompletedProcess-like ou exceções."""
    chamadas = []
    fila = list(resultados)

    def executar(argv, **kwargs):
        chamadas.append((list(argv), dict(kwargs)))
        if not fila:
            raise AssertionError("chamada inesperada: %r" % (argv,))
        item = fila.pop(0)
        if isinstance(item, BaseException):
            raise item
        if callable(item):
            return item(argv, **kwargs)
        return item

    executar.fila = fila
    return executar, chamadas


def proc(codigo=0, saida="", erro=""):
    return types.SimpleNamespace(returncode=codigo, stdout=saida, stderr=erro)


def membro(nome, tipo="arq", conteudo=b"", alvo=None, modo=0o644):
    info = tarfile.TarInfo(nome)
    info.mode = modo
    if tipo == "arq":
        info.size = len(conteudo)
    elif tipo == "dir":
        info.type = tarfile.DIRTYPE
        info.mode = 0o755
    elif tipo == "link":
        info.type = tarfile.SYMTYPE
        info.linkname = alvo
    elif tipo == "hard":
        info.type = tarfile.LNKTYPE
        info.linkname = alvo
    elif tipo == "dev":
        info.type = tarfile.CHRTYPE
    return info, conteudo


def tar_de(*membros):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as tar:
        for info, conteudo in membros:
            tar.addfile(info, io.BytesIO(conteudo) if info.isreg() else None)
    return buffer.getvalue()


def git_dir(argv, **kwargs):
    return proc(0, str(pathlib.Path(kwargs["cwd"]) / ".git") + "\n")


def archive(*membros):
    return types.SimpleNamespace(returncode=0, stdout=tar_de(*membros), stderr=b"")


def tar_padrao():
    return archive(
        membro("a.txt", conteudo=b"a"),
        membro("sub", "dir"),
        membro("sub/run.sh", conteudo=b"#!/bin/sh\n", modo=0o755),
        membro("lnk", "link", alvo="a.txt"),
    )


def sequencia(final=None):
    """fetch ok, rev-parse ok, archive ok, e o comando."""
    return [proc(), git_dir, tar_padrao(), final if final is not None else proc()]


class TestesVerificarComFalso(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.dir, ignore_errors=True))

    def test_ordem_das_chamadas_argumentos_cwd_e_diretorio_novo(self):
        vistos = {}

        def comando(argv, **kwargs):
            cwd = pathlib.Path(kwargs["cwd"])
            vistos["cwd"] = cwd
            vistos["itens"] = sorted(p.name for p in cwd.iterdir())
            vistos["conteudo"] = (cwd / "a.txt").read_text()
            vistos["link"] = os.readlink(cwd / "lnk")
            vistos["exec"] = os.access(cwd / "sub" / "run.sh", os.X_OK)
            vistos["nao_exec"] = os.access(cwd / "a.txt", os.X_OK)
            return proc(0, "tudo ok\n")

        executar, chamadas = exec_falso(sequencia(comando))
        r = verificacao.verificar(self.dir, SHA, "pnpm test", executar=executar)
        self.assertEqual(r, {"sha": SHA, "codigo": 0, "saida": "tudo ok\n"})
        self.assertEqual(executar.fila, [])
        self.assertEqual(len(chamadas), 4)
        git = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"]
        self.assertEqual(chamadas[0][0], git + ["fetch", "--quiet", "origin"])
        self.assertEqual(chamadas[1][0], git + ["rev-parse", "--git-dir"])
        self.assertEqual(chamadas[2][0], git + ["archive", "--format=tar", SHA])
        self.assertEqual(chamadas[3][0], ["bash", "-lc", "pnpm test"])
        for _, kwargs in chamadas[:3]:
            self.assertEqual(kwargs["cwd"], self.dir)
        # O comando nunca roda em repo_dir; o diretório é novo, sem .git, e some no fim.
        cwd = vistos["cwd"]
        self.assertNotEqual(cwd, self.dir)
        self.assertNotIn(str(self.dir), str(cwd))
        self.assertEqual(vistos["itens"], ["a.txt", "lnk", "sub"])
        self.assertEqual((vistos["conteudo"], vistos["link"]), ("a", "a.txt"))
        self.assertTrue(vistos["exec"])
        self.assertFalse(vistos["nao_exec"])
        self.assertFalse(cwd.exists())
        self.assertFalse(cwd.parent.exists())
        for _, kwargs in chamadas:
            self.assertFalse(kwargs.get("shell", False))

    def test_archive_pede_binario_e_fetch_pede_texto(self):
        executar, chamadas = exec_falso(sequencia())
        verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertTrue(chamadas[0][1]["text"])
        self.assertTrue(chamadas[0][1]["capture_output"])
        self.assertFalse(chamadas[2][1].get("text", False))
        self.assertTrue(chamadas[2][1]["capture_output"])
        self.assertTrue(chamadas[3][1]["text"])

    def test_diretorios_novos_a_cada_chamada(self):
        cwds = []

        def comando(argv, **kwargs):
            cwds.append(kwargs["cwd"])
            return proc()

        for _ in range(2):
            executar, _ = exec_falso(sequencia(comando))
            verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(len(cwds), 2)
        self.assertNotEqual(cwds[0], cwds[1])

    def test_timeout_padrao_1800_e_configuravel(self):
        executar, chamadas = exec_falso(sequencia())
        verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(chamadas[3][1]["timeout"], 1800)
        executar, chamadas = exec_falso(sequencia())
        verificacao.verificar(self.dir, SHA, "x", timeout_s=42, executar=executar)
        self.assertEqual(chamadas[3][1]["timeout"], 42)

    def test_git_tem_timeout_proprio_sem_prompt_e_sem_config_do_sistema(self):
        executar, chamadas = exec_falso(sequencia())
        with mock.patch.dict(os.environ, {"GIT_CONFIG_NOSYSTEM": "0"}):
            verificacao.verificar(self.dir, SHA, "x", timeout_s=42, executar=executar)
        for argv, kwargs in chamadas[:3]:
            self.assertIsInstance(kwargs["timeout"], int)
            self.assertGreater(kwargs["timeout"], 0)
            self.assertNotEqual(kwargs["timeout"], 42)
            self.assertEqual(kwargs["env"]["GIT_TERMINAL_PROMPT"], "0")
            self.assertEqual(kwargs["env"]["GIT_CONFIG_NOSYSTEM"], "1")

    def test_git_usa_o_ambiente_do_pai(self):
        executar, chamadas = exec_falso(sequencia())
        with mock.patch.dict(os.environ, {"GIT_ASKPASS": "/bin/askpass-teste"}):
            verificacao.verificar(self.dir, SHA, "x", executar=executar)
        for _, kwargs in chamadas[:3]:
            self.assertEqual(kwargs["env"]["GIT_ASKPASS"], "/bin/askpass-teste")

    def test_ambiente_do_comando_e_limpo(self):
        executar, chamadas = exec_falso(sequencia())
        sujo = {
            "PATH": "/usr/bin:/bin:/opt/x",
            "HOME": "/home/real",
            "GH_TOKEN": "ghp_a",
            "GITHUB_TOKEN": "ghp_b",
            "WARREN_TOKEN_FILE": "/x",
            "WARREN_URL": "http://x",
            "ANTHROPIC_API_KEY": "sk",
            "GH_TOKEN_FILE": "/y",
            "AWS_SECRET_ACCESS_KEY": "z",
            "SSH_AUTH_SOCK": "/s",
        }
        with mock.patch.dict(os.environ, sujo, clear=True):
            verificacao.verificar(self.dir, SHA, "x", executar=executar)
        env = chamadas[3][1]["env"]
        self.assertEqual(set(env), {"PATH", "HOME", "LANG", "CI"})
        self.assertEqual(env["PATH"], "/usr/bin:/bin:/opt/x")
        self.assertEqual(env["LANG"], "C.UTF-8")
        self.assertEqual(env["CI"], "1")
        self.assertNotEqual(env["HOME"], "/home/real")

    def test_home_e_temporario_fora_do_diretorio_do_comando_e_some_depois(self):
        vistos = []

        def comando(argv, **kwargs):
            home = pathlib.Path(kwargs["env"]["HOME"])
            vistos.append((home, home.is_dir(), pathlib.Path(kwargs["cwd"])))
            (home / "lixo").write_text("x")
            return proc()

        for _ in range(2):
            executar, _ = exec_falso(sequencia(comando))
            verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertNotEqual(vistos[0][0], vistos[1][0])
        for home, existia, cwd in vistos:
            self.assertTrue(existia)
            self.assertFalse(home.exists())
            self.assertNotEqual(home, pathlib.Path.home())
            self.assertNotIn(home, cwd.parents)
            self.assertNotEqual(home, cwd)

    def test_diretorios_somem_com_timeout_erro_e_excecao_inesperada(self):
        casos = [
            subprocess.TimeoutExpired(["bash"], 1),
            FileNotFoundError("bash"),
            RuntimeError("boom"),
        ]
        for caso in casos:
            cwds = []

            def comando(argv, caso=caso, **kwargs):
                cwds.append(pathlib.Path(kwargs["cwd"]))
                raise caso

            executar, _ = exec_falso(sequencia(comando))
            try:
                verificacao.verificar(self.dir, SHA, "x", executar=executar)
            except RuntimeError:
                pass
            self.assertFalse(cwds[0].exists(), repr(caso))
            self.assertFalse(cwds[0].parent.exists(), repr(caso))

    def test_diretorio_com_permissao_negada_deixada_pelo_comando_tambem_e_apagado(self):
        cwds = []

        def comando(argv, **kwargs):
            cwd = pathlib.Path(kwargs["cwd"])
            cwds.append(cwd)
            (cwd / "d" / "e").mkdir(parents=True)
            (cwd / "d" / "e" / "f").write_text("x")
            os.chmod(cwd / "d" / "e", 0o000)
            os.chmod(cwd / "d", 0o500)
            return proc()

        executar, _ = exec_falso(sequencia(comando))
        verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertFalse(cwds[0].parent.exists())

    # Permissões e executar_como

    def test_sem_executar_como_o_comando_roda_direto_com_permissoes_privadas(self):
        vistos = {}

        def comando(argv, **kwargs):
            cwd = pathlib.Path(kwargs["cwd"])
            modo = lambda p: os.stat(p).st_mode & 0o777  # noqa: E731
            vistos.update(
                src=modo(cwd), arq=modo(cwd / "a.txt"), exe=modo(cwd / "sub" / "run.sh"), sub=modo(cwd / "sub")
            )
            return proc()

        executar, chamadas = exec_falso(sequencia(comando))
        verificacao.verificar(self.dir, SHA, "x", executar=executar, executar_como=None)
        self.assertEqual(len(chamadas), 4)
        self.assertEqual(chamadas[3][0], ["bash", "-lc", "x"])
        self.assertEqual(vistos["arq"], 0o644)
        self.assertEqual(vistos["exe"], 0o755)
        self.assertEqual(vistos["sub"], 0o755)
        self.assertEqual(vistos["src"] & 0o007, 0)

    def test_executar_como_prefixa_o_comando_e_abre_permissoes(self):
        prefixo = ["sudo", "-n", "-u", "fabrica-verif", "--"]
        vistos = {}

        def comando(argv, **kwargs):
            cwd = pathlib.Path(kwargs["cwd"])
            modo = lambda p: os.stat(p).st_mode & 0o777  # noqa: E731
            vistos.update(
                base=modo(cwd.parent),
                src=modo(cwd),
                home=modo(kwargs["env"]["HOME"]),
                arq=modo(cwd / "a.txt"),
                exe=modo(cwd / "sub" / "run.sh"),
                sub=modo(cwd / "sub"),
                base_path=cwd.parent,
            )
            return proc(5, "saída\n")

        executar, chamadas = exec_falso(sequencia(comando) + [proc()])
        r = verificacao.verificar(self.dir, SHA, "make test", executar=executar, executar_como=prefixo)
        self.assertEqual(r, {"sha": SHA, "codigo": 5, "saida": "saída\n"})
        self.assertEqual(chamadas[3][0], prefixo + ["bash", "-lc", "make test"])
        self.assertEqual(vistos["src"], 0o777)
        self.assertEqual(vistos["home"], 0o777)
        self.assertEqual(vistos["sub"], 0o777)
        self.assertEqual(vistos["arq"], 0o666)
        self.assertEqual(vistos["exe"], 0o777)
        self.assertEqual(vistos["base"] & 0o011, 0o011)
        # Depois do comando, devolve a permissão ao despachante e só então apaga.
        self.assertEqual(len(chamadas), 5)
        self.assertEqual(chamadas[4][0], prefixo + ["chmod", "-R", "a+rwX", str(vistos["base_path"])])
        self.assertFalse(vistos["base_path"].exists())
        # O git nunca usa o prefixo.
        self.assertEqual([c[0][0] for c in chamadas[:3]], ["git", "git", "git"])

    def test_executar_como_limpa_mesmo_com_timeout_e_ignora_falha_da_limpeza(self):
        prefixo = ["sudo", "-n", "-u", "fabrica-verif", "--"]
        executar, chamadas = exec_falso(
            sequencia(subprocess.TimeoutExpired(["bash"], 1)) + [subprocess.TimeoutExpired(["chmod"], 60)]
        )
        r = verificacao.verificar(self.dir, SHA, "x", timeout_s=1, executar=executar, executar_como=prefixo)
        self.assertEqual(r["codigo"], 124)
        self.assertEqual(len(chamadas), 5)
        self.assertEqual(chamadas[4][0][: len(prefixo)], prefixo)

    def test_executar_como_invalido_nao_executa_nada(self):
        for ruim in ([], "sudo", ["sudo", ""], ["sudo", 5], ["su\0do"], 5, ()):
            executar, chamadas = exec_falso([])
            r = verificacao.verificar(self.dir, SHA, "x", executar=executar, executar_como=ruim)
            self.assertEqual(r, {"sha": SHA, "codigo": 2, "saida": "executar_como inválido"}, repr(ruim))
            self.assertEqual(chamadas, [])

    # Resultado, git e cortes

    def test_codigo_do_comando_propaga(self):
        executar, _ = exec_falso(sequencia(proc(3, "falhou\n", "erro\n")))
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r["codigo"], 3)
        self.assertEqual(r["saida"], "falhou\nerro\n")

    def test_corte_da_saida_nos_ultimos_4000(self):
        casos = [
            (proc(0, "x" * 1000 + "y" * 4000), "y" * 4000),
            (proc(0, "A" * 3000, "B" * 3000), ("A" * 3000 + "B" * 3000)[-4000:]),
            (proc(0, "z" * 4000), "z" * 4000),
            (proc(0, "w" + "z" * 4000), "z" * 4000),
        ]
        for final, esperado in casos:
            executar, _ = exec_falso(sequencia(final))
            self.assertEqual(verificacao.verificar(self.dir, SHA, "c", executar=executar)["saida"], esperado)

    def test_saida_none_vira_vazia(self):
        executar, _ = exec_falso(sequencia(types.SimpleNamespace(returncode=0, stdout=None, stderr=None)))
        self.assertEqual(verificacao.verificar(self.dir, SHA, "c", executar=executar)["saida"], "")

    def test_timeout_do_comando_da_124_com_stdout_e_stderr_parciais(self):
        execucao = subprocess.TimeoutExpired(["bash"], 5, output=b"parcial-out ", stderr=b"parcial-err")
        executar, chamadas = exec_falso(sequencia(execucao))
        r = verificacao.verificar(self.dir, SHA, "sleep 99", timeout_s=5, executar=executar)
        self.assertEqual(r["codigo"], 124)
        self.assertEqual(r["sha"], SHA)
        self.assertIn("parcial-out parcial-err", r["saida"])
        self.assertIn("[tempo esgotado após 5 s]", r["saida"])
        self.assertEqual(len(chamadas), 4)

    def test_timeout_sem_saida_ou_com_texto(self):
        for out in (None, "texto"):
            execucao = subprocess.TimeoutExpired(["bash"], 5, output=out)
            executar, _ = exec_falso(sequencia(execucao))
            r = verificacao.verificar(self.dir, SHA, "x", timeout_s=5, executar=executar)
            self.assertEqual(r["codigo"], 124)
            self.assertIsInstance(r["saida"], str)
            self.assertIn("[tempo esgotado", r["saida"])

    def test_timeout_do_comando_corta_a_saida_em_4000_e_mantem_o_aviso(self):
        execucao = subprocess.TimeoutExpired(["bash"], 5, output="o" * 9000, stderr="e" * 9000)
        executar, _ = exec_falso(sequencia(execucao))
        r = verificacao.verificar(self.dir, SHA, "x", timeout_s=5, executar=executar)
        self.assertEqual(r["codigo"], 124)
        self.assertEqual(len(r["saida"]), 4000)
        self.assertTrue(r["saida"].endswith("[tempo esgotado após 5 s]"))
        self.assertIn("e" * 100, r["saida"])

    def test_timeout_no_fetch_ou_no_archive_da_124_para_e_corta_em_4000(self):
        for posicao, nome in ((0, "fetch"), (1, "rev-parse"), (2, "archive")):
            fila = [proc(), git_dir, tar_padrao()]
            fila[posicao] = subprocess.TimeoutExpired(["git"], 9, output=b"o" * 9000, stderr=b"e" * 9000)
            executar, chamadas = exec_falso(fila)
            r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
            self.assertEqual(r["codigo"], 124, nome)
            self.assertEqual(len(chamadas), posicao + 1)
            self.assertEqual(len(r["saida"]), 4000)
            self.assertTrue(r["saida"].endswith("e" * 100))

    def test_timeout_curto_do_git_mostra_o_nome_do_passo(self):
        for posicao, nome in ((0, "fetch"), (1, "rev-parse"), (2, "archive")):
            fila = [proc(), git_dir, tar_padrao()]
            fila[posicao] = subprocess.TimeoutExpired(["git"], 9)
            executar, _ = exec_falso(fila)
            r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
            self.assertIn("git " + nome, r["saida"])

    def test_falha_no_fetch_devolve_codigo_e_saida_do_git_sem_seguir(self):
        executar, chamadas = exec_falso([proc(128, "", "fatal: sem remoto\n")])
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r, {"sha": SHA, "codigo": 128, "saida": "fatal: sem remoto\n"})
        self.assertEqual(len(chamadas), 1)

    def test_falha_no_archive_devolve_codigo_e_saida_do_git_sem_rodar_o_comando(self):
        falha = types.SimpleNamespace(returncode=1, stdout=b"", stderr=b"fatal: sha inexistente\n")
        executar, chamadas = exec_falso([proc(), git_dir, falha])
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r, {"sha": SHA, "codigo": 1, "saida": "fatal: sha inexistente\n"})
        self.assertEqual(len(chamadas), 3)

    def test_saida_do_git_tambem_e_cortada(self):
        executar, _ = exec_falso([proc(2, "", "e" * 9000)])
        self.assertEqual(len(verificacao.verificar(self.dir, SHA, "x", executar=executar)["saida"]), 4000)

    def test_archive_com_saida_nao_binaria_e_recusado(self):
        executar, chamadas = exec_falso([proc(), git_dir, proc(0, "texto")])
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r["codigo"], 2)
        self.assertEqual(len(chamadas), 3)

    # Entradas inválidas

    def test_sha_precisa_ter_exatamente_40_hex_minusculos(self):
        ruins = ["", "abc12", "abc1234", "a" * 7, "a" * 39, "g" * 40, "a" * 41, "A" * 40, "--upload-pack=x"]
        ruins += ["-f" + "a" * 38, SHA + "\n", "a b", "main", None, 5]
        for sha in ruins:
            executar, chamadas = exec_falso([])
            r = verificacao.verificar(self.dir, sha, "x", executar=executar)
            self.assertEqual(r, {"sha": sha, "codigo": 2, "saida": "sha inválido"}, repr(sha))
            self.assertEqual(chamadas, [])

    def test_comando_invalido_nao_executa_nada(self):
        for comando in ("", "   \n", None, 5, "echo a\0b", "\0"):
            executar, chamadas = exec_falso([])
            r = verificacao.verificar(self.dir, SHA, comando, executar=executar)
            self.assertEqual(r, {"sha": SHA, "codigo": 2, "saida": "comando inválido"}, repr(comando))
            self.assertEqual(chamadas, [])

    def test_programa_inexistente_da_127_sem_excecao(self):
        executar, _ = exec_falso([FileNotFoundError("git")])
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r["codigo"], 127)
        self.assertIn("FileNotFoundError", r["saida"])
        self.assertIn("git", r["saida"])

    def test_bash_inexistente_da_127_e_limpa(self):
        cwds = []

        def comando(argv, **kwargs):
            cwds.append(kwargs["cwd"])
            raise FileNotFoundError("bash")

        executar, _ = exec_falso(sequencia(comando))
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r["codigo"], 127)
        self.assertIn("bash", r["saida"])
        self.assertFalse(pathlib.Path(cwds[0]).exists())

    # Atributos de export (export-ignore / export-subst não podem esconder arquivos)

    def test_grava_info_attributes_antes_do_archive_e_sobrescreve_o_que_havia(self):
        alvo = self.dir / ".git" / "info" / "attributes"
        alvo.parent.mkdir(parents=True)
        alvo.write_text("tests/ export-ignore\n")
        vistos = []

        def archive_conferindo(argv, **kwargs):
            vistos.append(alvo.read_text())
            return tar_padrao()

        executar, chamadas = exec_falso([proc(), git_dir, archive_conferindo, proc()])
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r["codigo"], 0)
        self.assertEqual(vistos, ["* -export-ignore -export-subst\n"])
        self.assertEqual(alvo.read_text(), "* -export-ignore -export-subst\n")
        self.assertEqual(chamadas[1][0][-2:], ["rev-parse", "--git-dir"])

    def test_git_dir_relativo_e_absoluto_sao_resolvidos(self):
        outro = self.dir / "outro-git"
        for saida, esperado in ((".git\n", self.dir / ".git"), (str(outro) + "\n", outro), ("sub/gd\n", self.dir / "sub" / "gd")):
            executar, _ = exec_falso([proc(), proc(0, saida), tar_padrao(), proc()])
            verificacao.verificar(self.dir, SHA, "x", executar=executar)
            self.assertTrue((esperado / "info" / "attributes").is_file(), saida)

    def test_falha_no_rev_parse_devolve_o_codigo_do_git_sem_archive(self):
        executar, chamadas = exec_falso([proc(), proc(128, "", "fatal: not a git repository\n")])
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r, {"sha": SHA, "codigo": 128, "saida": "fatal: not a git repository\n"})
        self.assertEqual(len(chamadas), 2)

    def test_nao_conseguir_gravar_attributes_da_codigo_2_sem_archive_nem_comando(self):
        (self.dir / ".git").write_text("arquivo no lugar do diretório")
        executar, chamadas = exec_falso([proc(), git_dir])
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r["codigo"], 2)
        self.assertIn("info/attributes", r["saida"])
        self.assertEqual(len(chamadas), 2)

    # Extração segura do tar

    def rodar_com_tar(self, *membros):
        chamado = []

        def comando(argv, **kwargs):
            chamado.append(kwargs["cwd"])
            return proc()

        executar, chamadas = exec_falso([proc(), git_dir, archive(*membros), comando])
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        return r, chamado, chamadas

    def test_tars_inseguros_sao_recusados_sem_rodar_o_comando_e_sem_escrever_fora(self):
        casos = {
            "absoluto": [membro("/tmp/forja-fora.txt", conteudo=b"x")],
            "ponto-ponto": [membro("../fora.txt", conteudo=b"x")],
            "ponto-ponto-no-meio": [membro("a/../../fora.txt", conteudo=b"x")],
            "dir-ponto-ponto": [membro("a/..", "dir")],
            "link-absoluto": [membro("l", "link", alvo="/etc/passwd")],
            "link-para-fora": [membro("l", "link", alvo="../fora")],
            "link-para-fora-fundo": [membro("a", "dir"), membro("a/l", "link", alvo="../../fora")],
            "link-com-ponto-ponto-no-meio": [membro("l", "link", alvo="a/../../fora")],
            "link-vazio": [membro("l", "link", alvo="")],
            "hardlink": [membro("a.txt", conteudo=b"a"), membro("h", "hard", alvo="a.txt")],
            "dispositivo": [membro("dev", "dev")],
            "escrita-atraves-de-link": [membro("l", "link", alvo=".."), membro("l/fora.txt", conteudo=b"x")],
            "arquivo-sobre-diretorio": [membro("d", "dir"), membro("d", conteudo=b"x")],
            "diretorio-sobre-link": [membro("l", "link", alvo="."), membro("l", "dir")],
        }
        for nome, membros in casos.items():
            r, chamado, chamadas = self.rodar_com_tar(*membros)
            self.assertEqual(r["codigo"], 2, nome)
            self.assertTrue(r["saida"].startswith("export inválido"), (nome, r["saida"]))
            self.assertEqual(chamado, [], nome)
            self.assertEqual(len(chamadas), 3, nome)
            self.assertFalse(pathlib.Path("/tmp/forja-fora.txt").exists(), nome)
        self.assertEqual([p.name for p in self.dir.iterdir()], [".git"])

    def test_escrita_atraves_de_link_interno_fica_dentro(self):
        vistos = []

        def comando(argv, **kwargs):
            cwd = pathlib.Path(kwargs["cwd"])
            vistos.append(sorted(str(p.relative_to(cwd)) for p in cwd.rglob("*")))
            return proc()

        executar, _ = exec_falso(
            [
                proc(),
                git_dir,
                archive(membro("d", "dir"), membro("l", "link", alvo="d"), membro("l/x.txt", conteudo=b"x")),
                comando,
            ]
        )
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r["codigo"], 0)
        self.assertEqual(vistos[0], ["d", "d/x.txt", "l"])

    def test_links_relativos_validos_dentro_da_raiz_sao_aceitos(self):
        vistos = []

        def comando(argv, **kwargs):
            cwd = pathlib.Path(kwargs["cwd"])
            vistos.append((os.readlink(cwd / "a" / "b" / "l"), (cwd / "a" / "b" / "l").read_text()))
            return proc()

        executar, _ = exec_falso(
            [
                proc(),
                git_dir,
                archive(
                    membro("a", "dir"),
                    membro("a/b", "dir"),
                    membro("alvo.txt", conteudo=b"dentro"),
                    membro("a/b/l", "link", alvo="../../alvo.txt"),
                ),
                comando,
            ]
        )
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r["codigo"], 0)
        self.assertEqual(vistos, [("../../alvo.txt", "dentro")])

    def test_link_que_sobe_demais_mesmo_so_com_ponto_ponto_no_inicio_e_recusado(self):
        r, chamado, _ = self.rodar_com_tar(membro("a", "dir"), membro("a/l", "link", alvo="../../x"))
        self.assertEqual(r["codigo"], 2)
        self.assertEqual(chamado, [])

    def test_tar_corrompido_e_recusado(self):
        corrompido = types.SimpleNamespace(returncode=0, stdout=b"isto nao e um tar" * 100, stderr=b"")
        chamado = []
        executar, _ = exec_falso([proc(), git_dir, corrompido, lambda argv, **kw: chamado.append(1)])
        r = verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(r["codigo"], 2)
        self.assertTrue(r["saida"].startswith("export inválido"))
        self.assertEqual(chamado, [])

    def test_tar_vazio_e_aceito(self):
        r, chamado, _ = self.rodar_com_tar()
        self.assertEqual(r["codigo"], 0)
        self.assertEqual(len(chamado), 1)

    def test_entrada_ponto_da_raiz_e_ignorada_e_barra_dupla_normalizada(self):
        vistos = []

        def comando(argv, **kwargs):
            vistos.append(sorted(os.listdir(kwargs["cwd"])))
            return proc()

        executar, _ = exec_falso(
            [proc(), git_dir, archive(membro("./", "dir"), membro("./a.txt", conteudo=b"a"), membro("b//c.txt", conteudo=b"b")), comando]
        )
        verificacao.verificar(self.dir, SHA, "x", executar=executar)
        self.assertEqual(vistos, [["a.txt", "b"]])


def git(cwd, *args, **kwargs):
    base = ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"]
    return subprocess.run(
        base + list(args), cwd=cwd, check=True, capture_output=True, text=True, **kwargs
    ).stdout.strip()


def processo_vivo(pid):
    """True se o processo existe e não é zumbi."""
    estado = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(estado) and not estado.startswith("Z")


def esperar_morte(pid, limite_s=5.0):
    fim = time.monotonic() + limite_s
    while time.monotonic() < fim:
        if not processo_vivo(pid):
            return True
        time.sleep(0.05)
    return not processo_vivo(pid)


class TestesVerificarComGitReal(unittest.TestCase):
    """Usa `git` e `bash` de verdade, só com repositórios locais em diretórios temporários."""

    def setUp(self):
        base = tempfile.TemporaryDirectory()
        self.addCleanup(base.cleanup)
        patcher = mock.patch.dict(
            os.environ,
            {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"},
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.base = pathlib.Path(base.name).resolve()
        self.origem = self.base / "origem"
        self.origem.mkdir()
        git(self.origem, "init", "--quiet", "-b", "main")
        self.sha1 = self.commitar({"a.txt": "a", "teste.sh": "exit 0\n"}, "um")
        self.clone = self.base / "clone"
        git(self.base, "clone", "--quiet", str(self.origem), str(self.clone))

    def commitar(self, arquivos, mensagem):
        for nome, conteudo in arquivos.items():
            (self.origem / nome).write_text(conteudo)
            git(self.origem, "add", nome)
        git(self.origem, "commit", "--quiet", "-m", mensagem)
        return git(self.origem, "rev-parse", "HEAD")

    def test_sucesso_com_arquivo_presente(self):
        r = verificacao.verificar(self.clone, self.sha1, "test -f a.txt")
        self.assertEqual(r["codigo"], 0, r)
        self.assertEqual(r["sha"], self.sha1)

    def test_comando_falho_propaga_o_codigo(self):
        r = verificacao.verificar(self.clone, self.sha1, "echo falhei; exit 7")
        self.assertEqual(r["codigo"], 7)
        self.assertIn("falhei", r["saida"])

    def test_comando_roda_fora_do_repositorio_sem_git_e_o_diretorio_some(self):
        r = verificacao.verificar(self.clone, self.sha1, "test ! -e .git && pwd -P")
        self.assertEqual(r["codigo"], 0, r)
        cwd = pathlib.Path(r["saida"].strip())
        self.assertNotEqual(cwd, self.clone)
        self.assertNotIn(self.clone, cwd.parents)
        self.assertFalse(cwd.exists())
        self.assertFalse(cwd.parent.exists())

    def test_o_repositorio_nao_e_tocado_pela_verificacao(self):
        sha2 = self.commitar({"b.txt": "b"}, "dois")
        antes = git(self.clone, "rev-parse", "HEAD")
        r = verificacao.verificar(self.clone, sha2, "test -f b.txt && touch novo.txt")
        self.assertEqual(r["codigo"], 0, r)
        self.assertEqual(git(self.clone, "rev-parse", "HEAD"), antes)
        self.assertEqual(git(self.clone, "status", "--porcelain"), "")
        self.assertFalse((self.clone / "novo.txt").exists())
        self.assertFalse((self.clone / "b.txt").exists())

    def test_fetch_traz_o_commit_novo_e_a_exportacao_e_a_do_sha_pedido(self):
        sha2 = self.commitar({"b.txt": "b"}, "dois")
        r = verificacao.verificar(self.clone, sha2, "test -f b.txt")
        self.assertEqual(r["codigo"], 0, r)
        r = verificacao.verificar(self.clone, self.sha1, "test ! -f b.txt && test -f a.txt")
        self.assertEqual(r["codigo"], 0, r)

    def test_modificacao_e_arquivo_novo_de_uma_verificacao_nao_passam_para_a_proxima(self):
        sha_b = self.commitar({"teste.sh": "exit 1\n"}, "teste quebrado")
        r = verificacao.verificar(
            self.clone, self.sha1, "echo 'exit 0' > teste.sh; echo x > sujeira.txt; echo x > a.txt; bash teste.sh"
        )
        self.assertEqual(r["codigo"], 0, r)
        r = verificacao.verificar(self.clone, sha_b, "test ! -e sujeira.txt && bash teste.sh")
        self.assertEqual(r["codigo"], 1, r)
        r = verificacao.verificar(self.clone, sha_b, "bash teste.sh")
        self.assertEqual(r["codigo"], 1, r)
        r = verificacao.verificar(self.clone, self.sha1, "test \"$(cat a.txt)\" = a && test ! -e sujeira.txt")
        self.assertEqual(r["codigo"], 0, r)

    def test_commit_ja_exportado_antes_continua_falhando_depois_de_adulterado(self):
        sha_b = self.commitar({"teste.sh": "exit 1\n"}, "teste quebrado")
        verificacao.verificar(self.clone, sha_b, "echo 'exit 0' > teste.sh")
        self.assertEqual(verificacao.verificar(self.clone, sha_b, "bash teste.sh")["codigo"], 1)

    def test_comando_nao_consegue_plantar_hooks_em_repo_dir(self):
        hooks = self.clone / ".git" / "hooks"
        antes = sorted(os.listdir(hooks))
        r = verificacao.verificar(
            self.clone,
            self.sha1,
            "test ! -e .git; mkdir -p .git/hooks && printf '#!/bin/sh\\n' > .git/hooks/post-checkout; true",
        )
        self.assertEqual(r["codigo"], 0, r)
        self.assertEqual(sorted(os.listdir(hooks)), antes)

    def plantar_hook(self, repo, nome, marcador):
        hook = repo / ".git" / "hooks" / nome
        hook.write_text("#!/bin/sh\necho executou >> '%s'\n" % marcador)
        hook.chmod(0o755)

    def test_hooks_plantados_a_mao_nao_rodam_durante_verificar(self):
        sha2 = self.commitar({"b.txt": "b"}, "dois")
        marcador = self.base / "marcador.txt"
        controle = self.base / "controle"
        shutil.copytree(self.clone, controle, symlinks=True)
        for nome in ("post-checkout", "reference-transaction", "post-merge", "pre-auto-gc"):
            self.plantar_hook(self.clone, nome, marcador)
            self.plantar_hook(controle, nome, self.base / "marcador-controle.txt")
        # Controle positivo: um fetch comum no mesmo cenário dispara o hook de transação de refs.
        git(controle, "fetch", "--quiet", "origin")
        if not (self.base / "marcador-controle.txt").exists():
            self.skipTest("este git não dispara hooks no fetch; o teste não provaria nada")
        r = verificacao.verificar(self.clone, sha2, "test -f b.txt")
        self.assertEqual(r["codigo"], 0, r)
        self.assertFalse(marcador.exists(), marcador.read_text() if marcador.exists() else "")

    def test_fsmonitor_plantado_no_config_nao_roda(self):
        sha2 = self.commitar({"b.txt": "b"}, "dois")
        marcador = self.base / "fsmonitor.txt"
        script = self.base / "fsm.sh"
        script.write_text("#!/bin/sh\necho executou >> '%s'\n" % marcador)
        script.chmod(0o755)
        git(self.clone, "config", "core.fsmonitor", str(script))
        r = verificacao.verificar(self.clone, sha2, "true")
        self.assertEqual(r["codigo"], 0, r)
        self.assertFalse(marcador.exists())

    def test_export_ignore_do_commit_nao_esconde_os_testes(self):
        (self.origem / "tests").mkdir()
        sha = self.commitar(
            {".gitattributes": "tests/ export-ignore\n", "tests/falha.sh": "exit 1\n"}, "esconde os testes"
        )
        r = verificacao.verificar(self.clone, sha, "bash tests/falha.sh")
        self.assertEqual(r["codigo"], 1, r)
        r = verificacao.verificar(self.clone, sha, "test -f tests/falha.sh && test -f .gitattributes")
        self.assertEqual(r["codigo"], 0, r)

    def test_export_ignore_em_arquivo_e_com_padrao_tambem_nao_esconde(self):
        sha = self.commitar(
            {".gitattributes": "teste.sh export-ignore\n*.spec export-ignore\n", "x.spec": "s\n"}, "esconde arquivos"
        )
        r = verificacao.verificar(self.clone, sha, "test -f teste.sh && test -f x.spec")
        self.assertEqual(r["codigo"], 0, r)

    def test_export_subst_do_commit_nao_substitui_nada(self):
        sha = self.commitar({".gitattributes": "v.txt export-subst\n", "v.txt": "versao $Format:%H$\n"}, "subst")
        r = verificacao.verificar(self.clone, sha, "grep -F '$Format:%H$' v.txt")
        self.assertEqual(r["codigo"], 0, r)

    def test_comando_que_apaga_info_attributes_nao_reabre_o_buraco(self):
        (self.origem / "tests").mkdir()
        sha = self.commitar({".gitattributes": "tests/ export-ignore\n", "tests/falha.sh": "exit 1\n"}, "esconde")
        atributos = self.clone / ".git" / "info" / "attributes"
        r = verificacao.verificar(self.clone, sha, "true")
        self.assertEqual(r["codigo"], 0, r)
        atributos.write_text("")
        r = verificacao.verificar(self.clone, sha, "bash tests/falha.sh")
        self.assertEqual(r["codigo"], 1, r)

    def test_sha_inexistente_devolve_codigo_do_git(self):
        r = verificacao.verificar(self.clone, "d" * 40, "true")
        self.assertNotEqual(r["codigo"], 0)
        self.assertNotEqual(r["codigo"], 124)
        self.assertTrue(r["saida"])

    def test_ref_com_nome_de_sha_curto_nao_desvia_a_verificacao(self):
        sha2 = self.commitar({"b.txt": "b"}, "dois")
        git(self.clone, "fetch", "--quiet", "origin")
        git(self.clone, "branch", self.sha1[:7], sha2)
        r = verificacao.verificar(self.clone, self.sha1[:7], "true")
        self.assertEqual(r, {"sha": self.sha1[:7], "codigo": 2, "saida": "sha inválido"})
        r = verificacao.verificar(self.clone, self.sha1, "test ! -f b.txt")
        self.assertEqual(r["codigo"], 0, r)

    def test_sem_remoto_origin_o_fetch_falha_com_codigo_do_git(self):
        sem_remoto = self.base / "sem"
        sem_remoto.mkdir()
        git(sem_remoto, "init", "--quiet")
        r = verificacao.verificar(sem_remoto, self.sha1, "true")
        self.assertNotEqual(r["codigo"], 0)
        self.assertTrue(r["saida"])

    def test_arquivos_executaveis_e_links_do_commit_sao_preservados(self):
        (self.origem / "run.sh").write_text("#!/bin/sh\necho oi\n")
        (self.origem / "run.sh").chmod(0o755)
        os.symlink("a.txt", self.origem / "lnk")
        git(self.origem, "add", "run.sh", "lnk")
        git(self.origem, "commit", "--quiet", "-m", "exec e link")
        sha2 = git(self.origem, "rev-parse", "HEAD")
        r = verificacao.verificar(self.clone, sha2, 'test -x run.sh && test ! -x a.txt && test -L lnk && test "$(cat lnk)" = a && ./run.sh')
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("oi", r["saida"])

    def test_timeout_real_da_124(self):
        r = verificacao.verificar(self.clone, self.sha1, "sleep 30", timeout_s=1)
        self.assertEqual(r["codigo"], 124)

    # Contenção de processos

    def pid_do_marcador(self, marcador):
        return int(pathlib.Path(marcador).read_text().strip())

    def test_processo_de_segundo_plano_morre_no_retorno_normal(self):
        marcador = self.base / "pid1"
        inicio = time.monotonic()
        r = verificacao.verificar(self.clone, self.sha1, "sleep 30 & echo $! > '%s'; echo pronto" % marcador)
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("pronto", r["saida"])
        self.assertLess(time.monotonic() - inicio, 15)
        pid = self.pid_do_marcador(marcador)
        self.assertTrue(esperar_morte(pid), "o processo de segundo plano sobreviveu")

    def test_processo_de_segundo_plano_que_ignora_sigterm_tambem_morre(self):
        marcador = self.base / "pid2"
        r = verificacao.verificar(
            self.clone, self.sha1, "trap '' TERM; sleep 30 & echo $! > '%s'; exit 0" % marcador
        )
        self.assertEqual(r["codigo"], 0, r)
        self.assertTrue(esperar_morte(self.pid_do_marcador(marcador)))

    def test_netos_morrem_no_timeout(self):
        marcador = self.base / "pid3"
        inicio = time.monotonic()
        r = verificacao.verificar(
            self.clone, self.sha1, "(sleep 30 & echo $! > '%s'; wait) & sleep 30" % marcador, timeout_s=1
        )
        self.assertEqual(r["codigo"], 124)
        self.assertLess(time.monotonic() - inicio, 15)
        self.assertTrue(esperar_morte(self.pid_do_marcador(marcador)))

    def test_processo_tardio_nao_escreve_depois_do_retorno(self):
        tardio = self.base / "tardio.txt"
        r = verificacao.verificar(self.clone, self.sha1, "(sleep 2; echo x > '%s') >/dev/null 2>&1 & exit 0" % tardio)
        self.assertEqual(r["codigo"], 0, r)
        time.sleep(3)
        self.assertFalse(tardio.exists())

    def test_saida_de_segundo_plano_nao_segura_a_leitura(self):
        inicio = time.monotonic()
        r = verificacao.verificar(self.clone, self.sha1, "sleep 30 & echo ok")
        self.assertLess(time.monotonic() - inicio, 15)
        self.assertEqual(r["saida"].strip(), "ok")

    def test_saida_enorme_e_cortada_em_4000_e_pega_a_cauda(self):
        r = verificacao.verificar(
            self.clone, self.sha1, "head -c 300000 /dev/zero | tr '\\0' x; echo; echo FIM"
        )
        self.assertEqual(r["codigo"], 0)
        self.assertEqual(len(r["saida"]), 4000)
        self.assertTrue(r["saida"].endswith("xxx\nFIM\n"))

    def test_stdout_e_stderr_aparecem_na_saida(self):
        r = verificacao.verificar(self.clone, self.sha1, "echo para-stdout; echo para-stderr >&2")
        self.assertIn("para-stdout", r["saida"])
        self.assertIn("para-stderr", r["saida"])

    def test_comando_sem_stdin_nao_trava(self):
        r = verificacao.verificar(self.clone, self.sha1, "cat; echo fim", timeout_s=10)
        self.assertEqual(r["codigo"], 0, r)

    def test_executar_como_com_prefixo_real_inofensivo(self):
        r = verificacao.verificar(
            self.clone,
            self.sha1,
            'test "$(stat -f %Lp a.txt 2>/dev/null || stat -c %a a.txt)" = 666 && echo ok',
            executar_como=["env"],
        )
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("ok", r["saida"])

    def test_comando_nao_enxerga_segredos_do_ambiente_do_pai(self):
        segredos = {
            "GH_TOKEN": "ghp_segredo_gh",
            "GITHUB_TOKEN": "ghp_segredo_github",
            "WARREN_TOKEN_FILE": "/segredo/warren",
            "WARREN_URL": "http://segredo",
            "GH_TOKEN_FILE": "/segredo/gh",
            "ANTHROPIC_API_KEY": "sk-segredo",
            "OUTRA_VARIAVEL": "valor_outro",
        }
        home_real = str(pathlib.Path.home())
        with mock.patch.dict(os.environ, segredos):
            r = verificacao.verificar(self.clone, self.sha1, 'env; echo "HOME_VISTO=$HOME"')
        self.assertEqual(r["codigo"], 0, r)
        for nome, valor in segredos.items():
            self.assertNotIn(nome, r["saida"])
            self.assertNotIn(valor, r["saida"])
        self.assertIn("CI=1", r["saida"])
        self.assertIn("LANG=C.UTF-8", r["saida"])
        home_visto = [l for l in r["saida"].splitlines() if l.startswith("HOME_VISTO=")][0].split("=", 1)[1]
        self.assertNotEqual(home_visto, home_real)
        self.assertFalse(pathlib.Path(home_visto).exists())

    def test_comando_com_aspas_e_metacaracteres_roda_como_um_so_argumento(self):
        r = verificacao.verificar(self.clone, self.sha1, "test -f a.txt && echo 'a;b' | cat")
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("a;b", r["saida"])


class TestesExecucaoDireta(unittest.TestCase):
    def test_modulos_importam_so_com_biblioteca_padrao_em_modo_isolado(self):
        resultado = subprocess.run(
            [sys.executable, "-I", "-c", "import sys; sys.path.insert(0, %r); import forja, verificacao" % str(RAIZ)],
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
