import json
import unittest

import github


class TransporteFalso:
    def __init__(self, respostas):
        self.respostas = list(respostas)
        self.chamadas = []

    def __call__(self, metodo, url, headers, corpo):
        self.chamadas.append((metodo, url, headers, json.loads(corpo) if corpo else None))
        status, dados = self.respostas.pop(0)
        return status, {}, json.dumps(dados).encode()


def gh(*respostas):
    t = TransporteFalso(respostas)
    return github.GitHub("tok", transporte=t), t


class GitHubTest(unittest.TestCase):
    def test_branch_padrao(self):
        g, t = gh((200, {"default_branch": "main"}))
        self.assertEqual(g.branch_padrao("dono/repo"), "main")
        self.assertEqual(t.chamadas[0][1], "https://api.github.com/repos/dono/repo")
        self.assertEqual(t.chamadas[0][2]["Authorization"], "Bearer tok")

    def test_pr_aberto_da_branch(self):
        g, t = gh((200, [{"html_url": "https://github.com/dono/repo/pull/7"}]), (200, []))
        self.assertEqual(g.pr_aberto_da_branch("dono/repo", "fabrica/abc"), "https://github.com/dono/repo/pull/7")
        self.assertIn("head=dono%3Afabrica%2Fabc", t.chamadas[0][1])
        self.assertIn("state=open", t.chamadas[0][1])
        self.assertIsNone(g.pr_aberto_da_branch("dono/repo", "fabrica/abc"))

    def test_abrir_pr_reaproveita_o_existente(self):
        g, t = gh((200, [{"html_url": "https://github.com/dono/repo/pull/7"}]))
        self.assertEqual(g.abrir_pr("dono/repo", "fabrica/abc", "main", "t", "c"), "https://github.com/dono/repo/pull/7")
        self.assertEqual(len(t.chamadas), 1)

    def test_abrir_pr_novo(self):
        g, t = gh((200, []), (201, {"html_url": "https://github.com/dono/repo/pull/8"}))
        self.assertEqual(g.abrir_pr("dono/repo", "fabrica/abc", "main", "Título", "Corpo"), "https://github.com/dono/repo/pull/8")
        metodo, url, _, corpo = t.chamadas[1]
        self.assertEqual((metodo, url), ("POST", "https://api.github.com/repos/dono/repo/pulls"))
        self.assertEqual(corpo, {"title": "Título", "head": "fabrica/abc", "base": "main", "body": "Corpo"})

    def test_branch_existe(self):
        g, t = gh((200, {"name": "fabrica/abc"}), (404, {"message": "Branch not found"}))
        self.assertTrue(g.branch_existe("dono/repo", "fabrica/abc"))
        self.assertEqual(t.chamadas[0][1], "https://api.github.com/repos/dono/repo/branches/fabrica%2Fabc")
        self.assertFalse(g.branch_existe("dono/repo", "fabrica/abc"))

    def test_erro_http_nao_vaza_token(self):
        g, _ = gh((403, {"message": "tok proibido"}))
        with self.assertRaises(github.ErroDoGitHub) as ctx:
            g.branch_padrao("dono/repo")
        self.assertNotIn("tok", str(ctx.exception).replace("GitHub", ""))

    def test_nao_existe_merge(self):
        self.assertFalse(hasattr(github.GitHub, "mergear"))


if __name__ == "__main__":
    unittest.main()
