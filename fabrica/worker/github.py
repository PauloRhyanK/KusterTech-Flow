"""O mínimo do GitHub que o worker usa: branch padrão, achar e abrir PR. Merge não existe aqui:
quem mergeia é o Flow, depois dos gates."""
import json
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.github.com"
TIMEOUT_S = 30


class ErroDoGitHub(Exception):
    pass


def _transporte_urllib(metodo, url, headers, corpo):
    req = urllib.request.Request(url, data=corpo, headers=dict(headers), method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()


class GitHub:
    def __init__(self, token: str, transporte=None):
        self._token = token
        self._transporte = transporte or _transporte_urllib

    def _chamar(self, metodo: str, caminho: str, corpo: dict | None = None, aceita_404: bool = False):
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        dados = json.dumps(corpo).encode() if corpo is not None else None
        try:
            status, _, bruto = self._transporte(metodo, API + caminho, headers, dados)
        except Exception as erro:  # noqa: BLE001
            raise ErroDoGitHub(f"{metodo} {caminho.split('?')[0]}: {type(erro).__name__}") from None
        if status == 404 and aceita_404:
            return None
        if status >= 300:
            raise ErroDoGitHub(f"{metodo} {caminho.split('?')[0]}: HTTP {status}")
        return json.loads(bruto or b"null")

    def branch_padrao(self, repo: str) -> str:
        return self._chamar("GET", f"/repos/{repo}")["default_branch"]

    def branch_existe(self, repo: str, branch: str) -> bool:
        caminho = f"/repos/{repo}/branches/{urllib.parse.quote(branch, safe='')}"
        return self._chamar("GET", caminho, aceita_404=True) is not None

    def pr_aberto_da_branch(self, repo: str, branch: str) -> str | None:
        dono = repo.split("/")[0]
        consulta = urllib.parse.urlencode({"head": f"{dono}:{branch}", "state": "open"})
        prs = self._chamar("GET", f"/repos/{repo}/pulls?{consulta}")
        return prs[0]["html_url"] if prs else None

    def abrir_pr(self, repo: str, branch: str, base: str, titulo: str, corpo: str) -> str:
        existente = self.pr_aberto_da_branch(repo, branch)
        if existente:
            return existente
        pr = self._chamar("POST", f"/repos/{repo}/pulls", {"title": titulo, "head": branch, "base": base, "body": corpo})
        return pr["html_url"]
