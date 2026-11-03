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
import motor_warren  # noqa: E402
import verificacao  # noqa: E402
from testes_exportar import (  # noqa: E402
    OID_A,
    OID_B,
    OID_C,
    cat_file_saida,
    git,
    ls_tree_saida,
    proc_bytes,
)

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


ID = "0123456789ab"
IMAGEM = "alpine:3.20"
CONTEINER = {"imagem": IMAGEM}
ARVORE_LS = ls_tree_saida(
    (b"100644", "a.txt", OID_A), (b"100755", "sub/run.sh", OID_B), (b"120000", "lnk", OID_C)
)
ARVORE_CAT = cat_file_saida((OID_A, b"a"), (OID_B, b"#!/bin/sh\n"), (OID_C, b"a.txt"))
GIT_OPCOES = [
    "git",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.attributesFile=/dev/null",
]


def proc(codigo=0, saida="", erro=""):
    return types.SimpleNamespace(returncode=codigo, stdout=saida, stderr=erro)


class DockerFalso:
    """Executor falso: classifica cada chamada, grava e responde (sucesso por padrão)."""

    def __init__(self, ls=ARVORE_LS, cat=ARVORE_CAT):
        self.chamadas = []
        self.respostas = {}
        self.ls = ls
        self.cat = cat

    @staticmethod
    def tipo(argv):
        if argv[0] == "git":
            return argv[len(GIT_OPCOES)]
        assert argv[0] == "docker", argv
        if argv[1] == "network":
            return "rede-" + argv[2]
        if argv[1] == "run":
            if argv[-3:] == ["rm", "-rf", "/b/src"]:
                return "limpeza-root"
            return "servico" if "-d" in argv else "principal"
        return argv[1]  # kill, rm

    def __call__(self, argv, **kwargs):
        self.chamadas.append((list(argv), dict(kwargs)))
        tipo = self.tipo(argv)
        resposta = self.respostas.get(tipo)
        if isinstance(resposta, list):
            resposta = resposta.pop(0)
        if isinstance(resposta, BaseException):
            raise resposta
        if callable(resposta):
            return resposta(argv, **kwargs)
        if resposta is not None:
            return resposta
        if tipo == "ls-tree":
            return proc_bytes(self.ls)
        if tipo == "cat-file":
            return proc_bytes(self.cat)
        return proc()

    def tipos(self):
        return [self.tipo(argv) for argv, _ in self.chamadas]

    def argv(self, tipo, indice=0):
        return [a for a, _ in self.chamadas if self.tipo(a) == tipo][indice]

    def kwargs(self, tipo, indice=0):
        return [k for a, k in self.chamadas if self.tipo(a) == tipo][indice]


def src_do_principal(fake):
    argv = fake.argv("principal")
    return pathlib.Path(argv[argv.index("-v") + 1].split(":")[0])


class TestesVerificarComFalso(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.dir, ignore_errors=True))
        patcher = mock.patch.object(verificacao.secrets, "token_hex", return_value=ID)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.bases_iniciais = set(p.name for p in pathlib.Path(tempfile.gettempdir()).glob("fabrica-verif-*"))

    def verificar(self, fake=None, comando="make test", conteiner=None, **kw):
        fake = fake or DockerFalso()
        r = verificacao.verificar(
            self.dir, SHA, comando, conteiner=CONTEINER if conteiner is None else conteiner, executar=fake, **kw
        )
        return r, fake

    def bases_restantes(self):
        """Diretórios `fabrica-verif-*` criados depois do início do teste."""
        agora = set(p.name for p in pathlib.Path(tempfile.gettempdir()).glob("fabrica-verif-*"))
        return sorted(agora - self.bases_iniciais)

    # Sequência exata

    def test_sequencia_exata_de_chamadas_e_argumentos(self):
        r, fake = self.verificar(fake=DockerFalso(), comando="pnpm test")
        self.assertEqual(r, {"sha": SHA, "codigo": 0, "saida": ""})
        self.assertEqual(
            fake.tipos(),
            ["fetch", "ls-tree", "cat-file", "rede-create", "principal", "rm", "rede-rm"],
        )
        src = src_do_principal(fake)
        self.assertEqual(fake.argv("fetch"), GIT_OPCOES + ["fetch", "--quiet", "origin"])
        self.assertEqual(fake.argv("rede-create"), ["docker", "network", "create", "fabrica-verif-" + ID])
        self.assertEqual(
            fake.argv("principal"),
            [
                "docker", "run", "--rm", "--init", "--name", "fabrica-verif-" + ID,
                "--network", "fabrica-verif-" + ID,
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--pids-limit", "512", "--memory", "3g", "--cpus", "2",
                "--tmpfs", "/tmp:rw,exec",
                "-e", "CI=1", "-e", "HOME=/tmp/home", "-e", "LANG=C.UTF-8",
                "-v", "%s:/w" % src, "-w", "/w", IMAGEM, "bash", "-lc", "pnpm test",
            ],
        )  # fmt: skip
        self.assertEqual(fake.argv("rm"), ["docker", "rm", "-f", "fabrica-verif-" + ID])
        self.assertEqual(fake.argv("rede-rm"), ["docker", "network", "rm", "fabrica-verif-" + ID])
        self.assertEqual(src.name, "src")
        self.assertTrue(src.parent.name.startswith("fabrica-verif-"))
        self.assertFalse(src.parent.exists())

    def test_so_lista_de_argumentos_nunca_shell(self):
        _, fake = self.verificar(comando="echo '$(rm -rf /)'; `x`")
        for argv, kwargs in fake.chamadas:
            self.assertIsInstance(argv, list)
            self.assertFalse(kwargs.get("shell", False))
        self.assertEqual(fake.argv("principal")[-1], "echo '$(rm -rf /)'; `x`")

    def test_flags_de_isolamento_e_um_unico_volume_so_do_src(self):
        r, fake = self.verificar()
        argv = fake.argv("principal")
        for flag in ("--init", "--rm"):
            self.assertIn(flag, argv)
        self.assertEqual(argv[argv.index("--cap-drop") + 1], "ALL")
        self.assertEqual(argv[argv.index("--security-opt") + 1], "no-new-privileges")
        self.assertEqual(argv[argv.index("--pids-limit") + 1], "512")
        self.assertEqual(argv[argv.index("--network") + 1], "fabrica-verif-" + ID)
        volumes = [argv[i + 1] for i, a in enumerate(argv) if a == "-v"]
        src = src_do_principal(fake)
        self.assertEqual(volumes, ["%s:/w" % src])
        self.assertNotIn("--privileged", argv)
        self.assertNotIn(str(self.dir), " ".join(" ".join(a) for a, _ in fake.chamadas if a[0] == "docker"))
        self.assertNotIn("/var/run/docker.sock", " ".join(argv))
        self.assertNotIn("--pid", argv)
        self.assertNotIn("--net=host", argv)

    def test_limites_configuraveis_e_shell_sh(self):
        cfg = {"imagem": "node:20-alpine", "memoria": "512m", "cpus": "1.5", "pids": 64, "shell": "sh"}
        _, fake = self.verificar(conteiner=cfg, comando="npm test")
        argv = fake.argv("principal")
        self.assertEqual(argv[argv.index("--memory") + 1], "512m")
        self.assertEqual(argv[argv.index("--cpus") + 1], "1.5")
        self.assertEqual(argv[argv.index("--pids-limit") + 1], "64")
        self.assertEqual(argv[-4:], ["node:20-alpine", "sh", "-lc", "npm test"])

    def test_container_nao_recebe_nenhuma_variavel_do_pai(self):
        sujo = {
            "GH_TOKEN": "ghp_valor_secreto",
            "GITHUB_TOKEN": "ghp_outro",
            "WARREN_TOKEN_FILE": "/segredo/w",
            "ANTHROPIC_API_KEY": "sk-segredo",
            "AWS_SECRET_ACCESS_KEY": "aws-segredo",
            "HOME": "/home/real",
            "PATH": "/usr/bin:/bin",
        }
        with mock.patch.dict(os.environ, sujo):
            _, fake = self.verificar(conteiner={"imagem": IMAGEM, "env": {"MODO": "teste"}})
        argv = fake.argv("principal")
        pares = [argv[i + 1] for i, a in enumerate(argv) if a == "-e"]
        self.assertEqual(pares, ["CI=1", "HOME=/tmp/home", "LANG=C.UTF-8", "MODO=teste"])
        todos = " ".join(" ".join(a) for a, _ in fake.chamadas if a[0] == "docker")
        for nome, valor in sujo.items():
            if nome in ("PATH", "HOME"):
                continue
            self.assertNotIn(nome, todos)
            self.assertNotIn(valor, todos)
        self.assertNotIn("/home/real", todos)

    def test_docker_roda_com_o_ambiente_do_pai_e_git_com_o_ambiente_endurecido(self):
        _, fake = self.verificar()
        for argv, kwargs in fake.chamadas:
            if argv[0] == "docker":
                self.assertNotIn("env", kwargs)
                self.assertNotIn("cwd", kwargs)
            else:
                self.assertEqual(kwargs["cwd"], self.dir)
                self.assertEqual(kwargs["env"]["GIT_NO_REPLACE_OBJECTS"], "1")
                self.assertEqual(kwargs["env"]["GIT_ATTR_NOSYSTEM"], "1")
                self.assertEqual(kwargs["env"]["GIT_CONFIG_NOSYSTEM"], "1")
                self.assertEqual(kwargs["env"]["GIT_TERMINAL_PROMPT"], "0")

    def test_todo_comando_tem_timeout(self):
        _, fake = self.verificar(timeout_s=42)
        for argv, kwargs in fake.chamadas:
            self.assertIsInstance(kwargs["timeout"], int, argv)
        self.assertEqual(fake.kwargs("principal")["timeout"], 42)
        _, fake = self.verificar()
        self.assertEqual(fake.kwargs("principal")["timeout"], 1800)
        self.assertNotEqual(fake.kwargs("fetch")["timeout"], 1800)

    def test_arquivos_do_commit_chegam_no_src_com_modos_corretos(self):
        vistos = {}

        def principal(argv, **kwargs):
            src = pathlib.Path(argv[argv.index("-v") + 1].split(":")[0])
            vistos["itens"] = sorted(str(p.relative_to(src)) for p in src.rglob("*"))
            vistos["a"] = (src / "a.txt").read_text()
            vistos["modo_a"] = os.stat(src / "a.txt").st_mode & 0o777
            vistos["modo_run"] = os.stat(src / "sub" / "run.sh").st_mode & 0o777
            vistos["link"] = os.readlink(src / "lnk")
            vistos["modo_base"] = os.stat(src.parent).st_mode & 0o777
            vistos["git"] = (src / ".git").exists()
            return proc(0, "ok")

        fake = DockerFalso()
        fake.respostas["principal"] = principal
        self.verificar(fake=fake)
        self.assertEqual(vistos["itens"], ["a.txt", "lnk", "sub", "sub/run.sh"])
        self.assertEqual((vistos["a"], vistos["modo_a"], vistos["modo_run"]), ("a", 0o644, 0o755))
        self.assertEqual(vistos["link"], "a.txt")
        self.assertEqual(vistos["modo_base"], 0o700)
        self.assertFalse(vistos["git"])

    def test_diretorios_distintos_a_cada_chamada(self):
        srcs = []
        for ident in ("aaaaaaaaaaaa", "bbbbbbbbbbbb"):
            with mock.patch.object(verificacao.secrets, "token_hex", return_value=ident):
                _, fake = self.verificar()
            srcs.append(src_do_principal(fake))
            self.assertIn("fabrica-verif-" + ident, fake.argv("principal"))
        self.assertNotEqual(srcs[0], srcs[1])

    # Serviços

    def test_servicos_sobem_antes_do_principal_na_mesma_rede_e_sao_removidos(self):
        cfg = {
            "imagem": IMAGEM,
            "env": {"DATABASE_URL": "postgres://db/teste"},
            "servicos": [
                {"nome": "db", "imagem": "postgres:16", "env": {"POSTGRES_PASSWORD": "teste", "POSTGRES_DB": "t"}},
                {"nome": "cache", "imagem": "redis:7"},
            ],
        }
        _, fake = self.verificar(conteiner=cfg)
        self.assertEqual(
            fake.tipos(),
            ["fetch", "ls-tree", "cat-file", "rede-create", "servico", "servico", "principal", "rm", "rm", "rm", "rede-rm"],
        )
        self.assertEqual(
            fake.argv("servico", 0),
            [
                "docker", "run", "-d", "--rm", "--name", "fabrica-verif-%s-db" % ID,
                "--network", "fabrica-verif-" + ID, "--network-alias", "db",
                "-e", "POSTGRES_PASSWORD=teste", "-e", "POSTGRES_DB=t", "postgres:16",
            ],
        )  # fmt: skip
        self.assertEqual(
            fake.argv("servico", 1),
            [
                "docker", "run", "-d", "--rm", "--name", "fabrica-verif-%s-cache" % ID,
                "--network", "fabrica-verif-" + ID, "--network-alias", "cache", "redis:7",
            ],
        )  # fmt: skip
        argv = fake.argv("principal")
        self.assertIn("DATABASE_URL=postgres://db/teste", argv)
        self.assertNotIn("POSTGRES_PASSWORD=teste", argv)
        removidos = [fake.argv("rm", i)[-1] for i in range(3)]
        self.assertEqual(
            sorted(removidos),
            sorted(["fabrica-verif-" + ID, "fabrica-verif-%s-db" % ID, "fabrica-verif-%s-cache" % ID]),
        )

    def test_servico_que_falha_ao_subir_aborta_e_limpa(self):
        cfg = {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "postgres:16"}, {"nome": "x", "imagem": "y"}]}
        fake = DockerFalso()
        fake.respostas["servico"] = [proc(125, "", "pull access denied")]
        r, fake = self.verificar(fake=fake, conteiner=cfg)
        self.assertEqual(r["codigo"], 125)
        self.assertIn("serviço db", r["saida"])
        self.assertIn("pull access denied", r["saida"])
        self.assertNotIn("principal", fake.tipos())
        self.assertEqual(fake.tipos().count("servico"), 1)
        self.assertIn("rede-rm", fake.tipos())
        self.assertIn("fabrica-verif-%s-db" % ID, [fake.argv("rm", i)[-1] for i in range(fake.tipos().count("rm"))])

    # Timeout, saída e avisos

    def test_timeout_mata_o_conteiner_e_da_124(self):
        fake = DockerFalso()
        fake.respostas["principal"] = subprocess.TimeoutExpired(["docker"], 5, output="parcial-out ", stderr="parcial-err")
        r, fake = self.verificar(fake=fake, timeout_s=5)
        self.assertEqual(r["codigo"], 124)
        self.assertEqual(r["sha"], SHA)
        self.assertEqual(fake.argv("kill"), ["docker", "kill", "fabrica-verif-" + ID])
        self.assertLess(fake.tipos().index("principal"), fake.tipos().index("kill"))
        self.assertLess(fake.tipos().index("kill"), fake.tipos().index("rm"))
        self.assertTrue(r["saida"].startswith("[tempo esgotado após 5 s]") or "tempo esgotado após 5 s" in r["saida"][:60])
        self.assertIn("parcial-out parcial-err", r["saida"])
        self.assertIn("rede-rm", fake.tipos())
        self.assertFalse(src_do_principal(fake).parent.exists())

    def test_timeout_com_bytes_e_none(self):
        for out, err in ((b"bytes", b"x"), (None, None), ("t", None)):
            fake = DockerFalso()
            fake.respostas["principal"] = subprocess.TimeoutExpired(["docker"], 5, output=out, stderr=err)
            r, _ = self.verificar(fake=fake, timeout_s=5)
            self.assertEqual(r["codigo"], 124)
            self.assertIsInstance(r["saida"], str)

    def test_aviso_de_timeout_fica_no_inicio_mesmo_com_saida_enorme_e_total_4000(self):
        fake = DockerFalso()
        fake.respostas["principal"] = subprocess.TimeoutExpired(["docker"], 5, output="o" * 9000, stderr="e" * 9000)
        r, _ = self.verificar(fake=fake, timeout_s=5)
        self.assertEqual(len(r["saida"]), 4000)
        aviso = "tempo esgotado após 5 s"
        self.assertTrue(r["saida"].startswith(aviso) or r["saida"].startswith("[" + aviso), r["saida"][:60])
        self.assertTrue(r["saida"].endswith("e" * 100))
        self.assertNotIn("o" * 100, r["saida"])

    def test_aviso_de_timeout_vem_antes_dos_outros_avisos(self):
        ls = ls_tree_saida((b"160000", "vendor/sub", OID_A), (b"100644", "a.txt", OID_B))
        fake = DockerFalso(ls=ls, cat=cat_file_saida((OID_B, b"a")))
        fake.respostas["principal"] = subprocess.TimeoutExpired(["docker"], 5, output="parcial")
        r, _ = self.verificar(fake=fake, timeout_s=5)
        self.assertEqual(r["codigo"], 124)
        self.assertTrue(r["saida"].startswith("tempo esgotado após 5 s\nsubmódulo ignorado: vendor/sub\n"), r["saida"])
        self.assertTrue(r["saida"].endswith("parcial"))

    def test_avisos_de_limpeza_e_submodulo_tambem_ficam_no_inicio(self):
        ls = ls_tree_saida((b"160000", "vendor/sub", OID_A), (b"100644", "a.txt", OID_B))
        fake = DockerFalso(ls=ls, cat=cat_file_saida((OID_B, b"a")))
        fake.respostas["principal"] = proc(0, "z" * 9000)
        fake.respostas["network"] = None
        fake.respostas["rede-rm"] = proc(1, "", "network has active endpoints")
        r, _ = self.verificar(fake=fake)
        self.assertEqual(len(r["saida"]), 4000)
        self.assertIn("submódulo ignorado: vendor/sub", r["saida"][:200])
        self.assertIn("erro na limpeza: docker network rm", r["saida"][:300])
        self.assertTrue(r["saida"].endswith("z" * 100))

    def test_saida_sem_aviso_e_cortada_nos_ultimos_4000(self):
        casos = [
            (proc(0, "x" * 1000 + "y" * 4000), "y" * 4000),
            (proc(0, "A" * 3000, "B" * 3000), ("A" * 3000 + "B" * 3000)[-4000:]),
            (proc(0, "z" * 4000), "z" * 4000),
            (proc(0, "w" + "z" * 4000), "z" * 4000),
            (proc(0, "curta\n"), "curta\n"),
            (types.SimpleNamespace(returncode=0, stdout=None, stderr=None), ""),
        ]
        for resposta, esperado in casos:
            fake = DockerFalso()
            fake.respostas["principal"] = resposta
            r, _ = self.verificar(fake=fake)
            self.assertEqual(r["saida"], esperado)

    def test_codigo_do_comando_propaga(self):
        fake = DockerFalso()
        fake.respostas["principal"] = proc(3, "falhou\n", "erro\n")
        r, _ = self.verificar(fake=fake)
        self.assertEqual((r["codigo"], r["saida"]), (3, "falhou\nerro\n"))

    # Limpeza

    def test_limpeza_acontece_quando_um_passo_intermediario_lanca(self):
        passos = ["principal", "servico", "rede-create"]
        for passo in passos:
            fake = DockerFalso()
            fake.respostas[passo] = RuntimeError("boom " + passo)
            cfg = {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "postgres:16"}]}
            antes = self.bases_restantes()
            with self.assertRaises(RuntimeError, msg=passo):
                self.verificar(fake=fake, conteiner=cfg)
            tipos = fake.tipos()
            self.assertIn("rm", tipos, passo)
            self.assertIn("rede-rm", tipos, passo)
            self.assertEqual(self.bases_restantes(), antes, passo)
        # exceção durante a exportação: não há rede, mas a pasta some
        fake = DockerFalso()
        fake.respostas["cat-file"] = RuntimeError("boom")
        antes = self.bases_restantes()
        with self.assertRaises(RuntimeError):
            self.verificar(fake=fake)
        self.assertEqual(self.bases_restantes(), antes)
        self.assertNotIn("rede-create", fake.tipos())
        self.assertNotIn("rede-rm", fake.tipos())

    def test_limpeza_continua_apos_falha_de_um_passo_e_anota_sem_lancar(self):
        fake = DockerFalso()
        fake.respostas["rm"] = OSError("docker sumiu")
        fake.respostas["principal"] = proc(0, "saida")
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 0)
        self.assertIn("erro na limpeza", r["saida"])
        self.assertIn("rede-rm", fake.tipos())
        self.assertTrue(r["saida"].endswith("saida"))

    def test_limpeza_com_timeout_do_docker_e_anotada(self):
        fake = DockerFalso()
        fake.respostas["rede-rm"] = subprocess.TimeoutExpired(["docker"], 60)
        r, _ = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 0)
        self.assertIn("erro na limpeza: docker network", r["saida"])

    def test_diretorio_que_nao_pode_ser_apagado_usa_docker_para_remover_src(self):
        base_guardada = []
        reais = shutil.rmtree

        def rmtree_que_falha_na_primeira(caminho, *a, **kw):
            base_guardada.append(caminho)
            if len(base_guardada) == 1:
                return None
            return reais(caminho, *a, **kw)

        with mock.patch.object(verificacao.shutil, "rmtree", rmtree_que_falha_na_primeira):
            r, fake = self.verificar()
        self.assertEqual(r["codigo"], 0)
        self.assertEqual(len(base_guardada), 2)
        base = base_guardada[0]
        self.assertEqual(fake.argv("limpeza-root"), ["docker", "run", "--rm", "-v", "%s:/b" % base, IMAGEM, "rm", "-rf", "/b/src"])
        self.assertLess(fake.tipos().index("limpeza-root"), len(fake.tipos()))
        self.assertFalse(os.path.exists(base))
        self.assertNotIn("erro na limpeza", r["saida"])

    def test_diretorio_que_continua_la_depois_do_docker_e_anotado(self):
        guardadas = []
        reais = shutil.rmtree

        def rmtree_inutil(caminho, *a, **kw):
            guardadas.append(caminho)

        with mock.patch.object(verificacao.shutil, "rmtree", rmtree_inutil):
            r, _ = self.verificar()
        self.assertIn("erro na limpeza: não foi possível apagar o diretório", r["saida"])
        reais(guardadas[0], ignore_errors=True)

    # Falhas antes do contêiner

    def test_falha_no_fetch_devolve_codigo_e_saida_do_git_sem_seguir(self):
        fake = DockerFalso()
        fake.respostas["fetch"] = proc(128, "", "fatal: sem remoto\n")
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r, {"sha": SHA, "codigo": 128, "saida": "fatal: sem remoto\n"})
        self.assertEqual(fake.tipos(), ["fetch"])
        self.assertEqual(self.bases_restantes(), [])

    def test_timeout_do_fetch_da_124_com_aviso_e_corte(self):
        fake = DockerFalso()
        fake.respostas["fetch"] = subprocess.TimeoutExpired(["git"], 9, output=b"o" * 9000, stderr=b"e" * 9000)
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 124)
        self.assertEqual(len(r["saida"]), 4000)
        self.assertIn("git fetch: tempo esgotado", r["saida"][:100])
        self.assertEqual(fake.tipos(), ["fetch"])

    def test_falha_do_git_na_exportacao_devolve_codigo_do_git_e_limpa(self):
        fake = DockerFalso()
        fake.respostas["ls-tree"] = proc_bytes(b"", 128, b"fatal: bad object\n")
        r, fake = self.verificar(fake=fake)
        self.assertEqual((r["codigo"], r["saida"]), (128, "fatal: bad object\n"))
        self.assertNotIn("rede-create", fake.tipos())
        self.assertNotIn("principal", fake.tipos())
        self.assertEqual(self.bases_restantes(), [])

    def test_timeout_do_git_na_exportacao_da_124(self):
        fake = DockerFalso()
        fake.respostas["cat-file"] = subprocess.TimeoutExpired(["git"], 9, output=b"x", stderr=b"y")
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 124)
        self.assertIn("git: tempo esgotado", r["saida"])
        self.assertNotIn("rede-create", fake.tipos())

    def test_export_inseguro_da_codigo_2_sem_docker(self):
        fake = DockerFalso(ls=ls_tree_saida((b"100644", "../fora.txt", OID_A)), cat=cat_file_saida((OID_A, b"x")))
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 2)
        self.assertTrue(r["saida"].startswith("export inválido"))
        self.assertNotIn("rede-create", fake.tipos())
        self.assertEqual(self.bases_restantes(), [])

    def test_docker_inexistente_da_127_e_limpa(self):
        fake = DockerFalso()
        fake.respostas["rede-create"] = FileNotFoundError("docker")
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 127)
        self.assertIn("docker", r["saida"])
        self.assertIn("FileNotFoundError", r["saida"])
        self.assertEqual(self.bases_restantes(), [])

    def test_git_inexistente_da_127(self):
        fake = DockerFalso()
        fake.respostas["fetch"] = FileNotFoundError("git")
        r, _ = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 127)

    def test_falha_ao_criar_a_rede_devolve_o_codigo_do_docker(self):
        fake = DockerFalso()
        fake.respostas["rede-create"] = proc(1, "", "daemon off")
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 1)
        self.assertIn("daemon off", r["saida"])
        self.assertNotIn("principal", fake.tipos())
        self.assertNotIn("rede-rm", fake.tipos())

    # Validação

    def test_validacao_recusa_antes_de_rodar_qualquer_coisa(self):
        grande = "a" * 201
        casos = {
            "imagem": [
                None, {}, {"imagem": ""}, {"imagem": "-v"}, {"imagem": "--privileged"}, {"imagem": "-x:1"},
                {"imagem": "Alpine"}, {"imagem": "a b"}, {"imagem": "a;b"}, {"imagem": grande}, {"imagem": 5},
                {"imagem": "a\nb"}, {"imagem": "a$b"}, {"imagem": ".x"},
            ],
            "env.TOKEN": [{"imagem": IMAGEM, "env": {"TOKEN": "x"}}],
            "env.GH_TOKEN": [{"imagem": IMAGEM, "env": {"GH_TOKEN": "x"}}],
            "env.MY_SECRET_KEY": [{"imagem": IMAGEM, "env": {"MY_SECRET_KEY": "x"}}],
            "env.DB_PASSWORD": [{"imagem": IMAGEM, "env": {"DB_PASSWORD": "x"}}],
            "env.GITHUB_USER": [{"imagem": IMAGEM, "env": {"GITHUB_USER": "x"}}],
            "env.WARREN_URL": [{"imagem": IMAGEM, "env": {"WARREN_URL": "x"}}],
            "env.ANTHROPIC_MODEL": [{"imagem": IMAGEM, "env": {"ANTHROPIC_MODEL": "x"}}],
            "env.minuscula": [{"imagem": IMAGEM, "env": {"minuscula": "x"}}],
            "env.1X": [{"imagem": IMAGEM, "env": {"1X": "x"}}],
            "env.A=B": [{"imagem": IMAGEM, "env": {"A=B": "x"}}],
            "env.A": [{"imagem": IMAGEM, "env": {"A": 5}}, {"imagem": IMAGEM, "env": {"A": "a\0b"}}, {"imagem": IMAGEM, "env": []}],
            "memoria": [{"imagem": IMAGEM, "memoria": m} for m in ("", "0", "-1g", "3 g", "3gb", "abc", "3g --privileged", 3)],
            "cpus": [{"imagem": IMAGEM, "cpus": c} for c in ("", "0", "0.0", "-1", "1,5", "abc", "100", "2 --x", 2)],
            "pids": [{"imagem": IMAGEM, "pids": p} for p in (0, -1, 70000, "512", True, 1.5)],
            "shell": [{"imagem": IMAGEM, "shell": s} for s in ("zsh", "", "bash -x", None, "/bin/sh")],
            "servicos": [{"imagem": IMAGEM, "servicos": "db"}, {"imagem": IMAGEM, "servicos": {"nome": "db"}}],
            "servicos[0]": [{"imagem": IMAGEM, "servicos": ["db"]}, {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "x", "extra": 1}]}],
            "servicos[0].nome": [
                {"imagem": IMAGEM, "servicos": [{"nome": n, "imagem": "postgres:16"}]}
                for n in ("-db", "DB", "d b", "db/x", "db:1", "", "a;b", "db\n", "..", None, "a" * 65, "-v")
            ],
            "servicos[0].imagem": [{"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": i}]} for i in ("-x", "", "Postgres", None, "a b")],
            "servicos[0].env.GH_TOKEN": [{"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "x", "env": {"GH_TOKEN": "x"}}]}],
            "servicos[0].env.WARREN_X": [{"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "x", "env": {"WARREN_X": "x"}}]}],
            "servicos[1].nome": [
                {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "x"}, {"nome": "db", "imagem": "y"}]}
            ],
            "desconhecido": [{"imagem": IMAGEM, "volumes": ["/:/host"]}, {"imagem": IMAGEM, "privileged": True}],
        }
        for campo, configs in casos.items():
            for cfg in configs:
                fake = DockerFalso()
                r = verificacao.verificar(self.dir, SHA, "x", conteiner=cfg, executar=fake)
                self.assertEqual(r["codigo"], 2, repr(cfg))
                self.assertTrue(r["saida"].startswith("config de contêiner inválida: "), (cfg, r["saida"]))
                self.assertEqual(fake.chamadas, [], repr(cfg))
        self.assertEqual(self.bases_restantes(), [])

    def test_mensagem_de_validacao_cita_o_campo(self):
        casos = [
            ({"imagem": "-v"}, "imagem"),
            ({"imagem": IMAGEM, "env": {"GH_TOKEN": "x"}}, "env.GH_TOKEN"),
            ({"imagem": IMAGEM, "memoria": "x"}, "memoria"),
            ({"imagem": IMAGEM, "cpus": "x"}, "cpus"),
            ({"imagem": IMAGEM, "pids": 0}, "pids"),
            ({"imagem": IMAGEM, "shell": "zsh"}, "shell"),
            ({"imagem": IMAGEM, "servicos": [{"nome": "-x", "imagem": "y"}]}, "servicos[0].nome"),
        ]
        for cfg, campo in casos:
            r, _ = self.verificar(conteiner=cfg)
            self.assertEqual(r, {"sha": SHA, "codigo": 2, "saida": "config de contêiner inválida: " + campo})

    def test_config_valida_no_limite_e_password_so_em_servico(self):
        cfg = {
            "imagem": "a" * 200,
            "memoria": "1048576k",
            "cpus": "0.5",
            "pids": 1,
            "shell": "sh",
            "env": {"_X1": "v", "LISTA": "a,b", "OUTRO": ""},
            "servicos": [
                {"nome": "db", "imagem": "postgres@sha256:" + "a" * 64, "env": {"POSTGRES_PASSWORD": "fixo", "API_TOKEN": "t", "S_SECRET": "s"}}
            ],
        }
        r, fake = self.verificar(conteiner=cfg)
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("principal", fake.tipos())

    def test_sha_precisa_ter_exatamente_40_hex_minusculos(self):
        ruins = ["", "abc12", "abc1234", "a" * 7, "a" * 39, "g" * 40, "a" * 41, "A" * 40, "--upload-pack=x"]
        ruins += ["-f" + "a" * 38, SHA + "\n", "a b", "main", None, 5]
        for sha in ruins:
            fake = DockerFalso()
            r = verificacao.verificar(self.dir, sha, "x", conteiner=CONTEINER, executar=fake)
            self.assertEqual(r, {"sha": sha, "codigo": 2, "saida": "sha inválido"}, repr(sha))
            self.assertEqual(fake.chamadas, [])

    def test_comando_invalido_nao_executa_nada(self):
        for comando in ("", "   \n", None, 5, "echo a\0b", "\0"):
            fake = DockerFalso()
            r = verificacao.verificar(self.dir, SHA, comando, conteiner=CONTEINER, executar=fake)
            self.assertEqual(r, {"sha": SHA, "codigo": 2, "saida": "comando inválido"}, repr(comando))
            self.assertEqual(fake.chamadas, [])

    def test_assinatura_sem_executar_como_e_com_conteiner_obrigatorio(self):
        import inspect

        parametros = inspect.signature(verificacao.verificar).parameters
        self.assertNotIn("executar_como", parametros)
        self.assertIs(parametros["conteiner"].default, inspect.Parameter.empty)
        self.assertEqual(parametros["conteiner"].kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertEqual(parametros["timeout_s"].default, 1800)
        self.assertIs(parametros["executar"].default, subprocess.run)
        for nome in ("_rodar_em_grupo", "_matar_grupo", "_extrair"):
            self.assertFalse(hasattr(verificacao, nome), nome)


def docker_real():
    """Imagem local com `sh` e `setsid` (busybox), ou `None` se o Docker não estiver disponível.

    Nunca baixa imagens: sem rede nos testes, só usa o que já existe no host.
    """
    try:
        if subprocess.run(["docker", "info"], capture_output=True, timeout=20).returncode != 0:
            return None
        for imagem in ("alpine:3.20", "node:26.5.1-alpine", "postgres:16-alpine"):
            achou = subprocess.run(["docker", "image", "inspect", imagem], capture_output=True, timeout=20)
            if achou.returncode == 0:
                return imagem
    except (OSError, subprocess.TimeoutExpired):
        return None
    return None


IMAGEM_REAL = docker_real()


def containers_e_redes():
    contêineres = subprocess.run(
        ["docker", "ps", "-aq", "--filter", "name=fabrica-verif"], capture_output=True, text=True
    ).stdout.split()
    redes = subprocess.run(
        ["docker", "network", "ls", "-q", "--filter", "name=fabrica-verif"], capture_output=True, text=True
    ).stdout.split()
    return contêineres, redes


@unittest.skipUnless(IMAGEM_REAL, "Docker ou imagem alpine local indisponível")
class TestesVerificarComDockerReal(unittest.TestCase):
    """Docker de verdade, com repositório local e sem baixar nada."""

    def setUp(self):
        base = tempfile.TemporaryDirectory()
        self.addCleanup(base.cleanup)
        patcher = mock.patch.dict(
            os.environ, {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"}
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.base = pathlib.Path(base.name).resolve()
        self.origem = self.base / "origem"
        self.origem.mkdir()
        git(self.origem, "init", "--quiet", "-b", "main")
        self.clone = self.base / "clone"
        self.cfg = {"imagem": IMAGEM_REAL, "shell": "sh"}
        self.sha_ok = self.commitar({"teste.sh": "exit 0\n", "a.txt": "a"})
        git(self.base, "clone", "--quiet", str(self.origem), str(self.clone))
        self.bases_antes = set(pathlib.Path(tempfile.gettempdir()).glob("fabrica-verif-*"))

    def commitar(self, arquivos):
        for nome, conteudo in arquivos.items():
            caminho = self.origem / nome
            caminho.parent.mkdir(parents=True, exist_ok=True)
            caminho.write_text(conteudo)
            git(self.origem, "add", nome)
        git(self.origem, "commit", "--quiet", "-m", "c")
        return git(self.origem, "rev-parse", "HEAD")

    def verificar(self, sha, comando, **kw):
        return verificacao.verificar(self.clone, sha, comando, conteiner=self.cfg, **kw)

    def assertSemResiduos(self):
        self.assertEqual(containers_e_redes(), ([], []))
        agora = set(pathlib.Path(tempfile.gettempdir()).glob("fabrica-verif-*"))
        self.assertEqual(agora - self.bases_antes, set())

    def test_commit_com_teste_que_falha_da_1_e_o_que_passa_da_0(self):
        sha_falha = self.commitar({"teste.sh": "echo falhando; exit 1\n"})
        r = self.verificar(sha_falha, "test -f teste.sh && sh teste.sh")
        self.assertEqual(r["codigo"], 1, r)
        self.assertIn("falhando", r["saida"])
        r = self.verificar(self.sha_ok, "test -f teste.sh && sh teste.sh")
        self.assertEqual(r["codigo"], 0, r)
        self.assertSemResiduos()

    def test_adulterar_o_teste_numa_chamada_nao_afeta_a_seguinte(self):
        sha_falha = self.commitar({"teste.sh": "exit 1\n"})
        r = self.verificar(self.sha_ok, "echo 'exit 0' > teste.sh; echo x > sujeira.txt; sh teste.sh")
        self.assertEqual(r["codigo"], 0, r)
        r = self.verificar(sha_falha, "test ! -e sujeira.txt && sh teste.sh")
        self.assertEqual(r["codigo"], 1, r)
        self.assertSemResiduos()

    def test_processo_setsid_deixado_pelo_comando_nao_sobrevive(self):
        r = self.verificar(self.sha_ok, "setsid sh -c 'sleep 300' >/dev/null 2>&1 & setsid sh -c 'sleep 300' & echo iniciado")
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("iniciado", r["saida"])
        self.assertSemResiduos()

    def test_timeout_real_da_124_e_remove_o_conteiner(self):
        inicio = time.monotonic()
        r = self.verificar(self.sha_ok, "sleep 120", timeout_s=3)
        self.assertEqual(r["codigo"], 124, r)
        self.assertIn("tempo esgotado", r["saida"])
        self.assertLess(time.monotonic() - inicio, 60)
        self.assertSemResiduos()

    def test_comando_nao_ve_o_repositorio_nem_os_segredos_do_pai(self):
        segredos = {"GH_TOKEN": "ghp_segredo_gh", "ANTHROPIC_API_KEY": "sk-segredo", "WARREN_TOKEN_FILE": "/segredo/w"}
        comando = "env; test ! -e /w/.git && test ! -e '%s' && test ! -e '%s' && echo isolado" % (self.clone, self.origem)
        with mock.patch.dict(os.environ, segredos):
            r = self.verificar(self.sha_ok, comando)
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("isolado", r["saida"])
        for nome, valor in segredos.items():
            self.assertNotIn(nome, r["saida"])
            self.assertNotIn(valor, r["saida"])
        self.assertIn("CI=1", r["saida"])
        self.assertIn("LANG=C.UTF-8", r["saida"])
        self.assertSemResiduos()

    def test_comando_nao_consegue_alterar_o_repositorio_do_host(self):
        antes = git(self.clone, "rev-parse", "HEAD")
        r = self.verificar(self.sha_ok, "echo x > /w/novo.txt; exit 0")
        self.assertEqual(r["codigo"], 0, r)
        self.assertEqual(git(self.clone, "rev-parse", "HEAD"), antes)
        self.assertEqual(git(self.clone, "status", "--porcelain"), "")

    def test_arquivos_criados_pelo_conteiner_sao_removidos(self):
        comando = "mkdir -p d/e && echo x > d/e/f && chmod 000 d/e/f && chmod 000 d/e && chmod 555 d && touch g"
        r = self.verificar(self.sha_ok, comando)
        self.assertEqual(r["codigo"], 0, r)
        self.assertNotIn("erro na limpeza", r["saida"])
        self.assertSemResiduos()

    def test_saida_enorme_e_cortada_em_4000_com_a_cauda(self):
        r = self.verificar(self.sha_ok, "head -c 300000 /dev/zero | tr '\\0' x; echo; echo FIM")
        self.assertEqual(r["codigo"], 0, r)
        self.assertEqual(len(r["saida"]), 4000)
        self.assertTrue(r["saida"].endswith("xxx\nFIM\n"))

    def test_exportacao_ignora_gitattributes_e_replace_do_repositorio(self):
        (self.origem / "tests").mkdir()
        sha = self.commitar(
            {".gitattributes": "tests/ export-ignore\n* text eol=crlf\n", "tests/falha.sh": "exit 1\n", "v.txt": "um\ndois\n"}
        )
        r = self.verificar(sha, "sh tests/falha.sh")
        self.assertEqual(r["codigo"], 1, r)
        r = self.verificar(sha, "test \"$(wc -c < v.txt)\" = 8")
        self.assertEqual(r["codigo"], 0, r)

    def test_hooks_plantados_no_repo_nao_rodam_no_fetch(self):
        marcador = self.base / "marcador.txt"
        for nome in ("reference-transaction", "post-checkout", "post-merge"):
            hook = self.clone / ".git" / "hooks" / nome
            hook.write_text("#!/bin/sh\necho executou >> '%s'\n" % marcador)
            hook.chmod(0o755)
        sha = self.commitar({"b.txt": "b"})
        r = self.verificar(sha, "test -f b.txt")
        self.assertEqual(r["codigo"], 0, r)
        self.assertFalse(marcador.exists())

    def test_sem_remoto_origin_o_fetch_falha_com_codigo_do_git(self):
        sem_remoto = self.base / "sem"
        sem_remoto.mkdir()
        git(sem_remoto, "init", "--quiet")
        r = verificacao.verificar(sem_remoto, self.sha_ok, "true", conteiner=self.cfg)
        self.assertNotEqual(r["codigo"], 0)
        self.assertTrue(r["saida"])
        self.assertSemResiduos()


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
