"""Cliente da API REST do GitHub (PRs, CI, merge com guarda de sha, arquivos e issues de decisão)."""

import copy
import http.client
import json
import pathlib
import re
import sys
import urllib.error
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from motor import FalhaDeRede  # noqa: E402
from motor_warren import _transporte_urllib  # noqa: E402

BASE = "https://api.github.com"
VERSAO_API = "2022-11-28"
LABEL_DECISAO = "fabrica:decisao"
POR_PAGINA = 100
MAX_PAGINAS = 40
RESULTADOS_CI = ("ausente", "pendente", "vermelho", "verde")

_NOME = r"[A-Za-z0-9_.-]+"
_URL = re.compile(r"https://github\.com/(%s)/(%s)/(pull|issues)/([0-9]+)" % (_NOME, _NOME))
_TIPOS_DE_URL = ("pull", "issues")
_REPO = re.compile(r"(%s)/(%s)" % (_NOME, _NOME))
_SHA_COMPLETO = re.compile(r"[0-9a-f]{40}")
_NONCE = re.compile(r"[0-9a-f]{32}")
MARCADOR_NONCE = "<!-- fabrica:nonce=%s -->"
# Só estas conclusões contam como sucesso; qualquer outra (inclusive vazia ou nova) é vermelho.
_CONCLUSOES_VERDES = frozenset({"success", "neutral", "skipped"})


def _validar_token(token) -> str:
    if not isinstance(token, str):
        raise ValueError("token inválido")
    token = token.strip()
    if not token:
        raise ValueError("token do GitHub vazio")
    if not all(33 <= ord(c) <= 126 for c in token):
        raise ValueError("token inválido")
    return token


def _componente(valor: str) -> str:
    if valor in (".", ".."):
        raise ValueError("nome inválido")
    return urllib.parse.quote(valor, safe="")


def _analisar_repo(repo) -> tuple[str, str]:
    achado = _REPO.fullmatch(repo) if isinstance(repo, str) else None
    if achado is None:
        raise ValueError("repo inválido")
    dono, nome = achado.groups()
    return _componente(dono), _componente(nome)


def _analisar_url(url, tipo) -> tuple[str, str, int]:
    """`(dono, nome, número)` de uma URL estrita de PR (`pull`) ou issue (`issues`); `tipo` pode ser uma tupla."""
    tipos = tipo if isinstance(tipo, tuple) else (tipo,)
    achado = _URL.fullmatch(url) if isinstance(url, str) else None
    if achado is None or achado.group(3) not in tipos:
        raise ValueError("url inválida")
    dono, nome = _componente(achado.group(1)), _componente(achado.group(2))
    return dono, nome, int(achado.group(4))


def _validar_sha_completo(sha) -> str:
    """40 hex minúsculos: um sha curto também seria lido como nome de branch ou tag."""
    if not isinstance(sha, str) or _SHA_COMPLETO.fullmatch(sha) is None:
        raise ValueError("sha inválido")
    return sha


def _caminho_de_arquivo(caminho) -> str:
    if not isinstance(caminho, str) or not caminho or caminho.startswith("/"):
        raise ValueError("caminho inválido")
    partes = caminho.split("/")
    if any(parte in ("", ".", "..") for parte in partes):
        raise ValueError("caminho inválido")
    return "/".join(urllib.parse.quote(parte, safe="") for parte in partes)


def _texto_nao_vazio(valor, nome: str) -> str:
    if not isinstance(valor, str) or not valor:
        raise ValueError("%s inválido" % nome)
    return valor


def _inteiro(valor) -> bool:
    return isinstance(valor, int) and not isinstance(valor, bool)


class ForjaGitHub:
    def __init__(self, token: str, transporte=None):
        self._token = _validar_token(token)
        self._transporte = transporte or _transporte_urllib

    # Camada HTTP. Nenhuma mensagem de erro carrega token nem corpo de resposta.

    def _enviar(self, metodo: str, caminho: str, corpo: dict | None = None, bruto: bool = False):
        headers = {
            "Authorization": "Bearer " + self._token,
            "Accept": "application/vnd.github.raw" if bruto else "application/vnd.github+json",
            "X-GitHub-Api-Version": VERSAO_API,
        }
        dados = None
        if corpo is not None:
            headers["Content-Type"] = "application/json"
            dados = json.dumps(corpo).encode("utf-8")
        try:
            resposta = self._transporte(metodo, BASE + caminho, headers, dados)
        except (http.client.HTTPException, OSError) as erro:
            raise FalhaDeRede("%s %s: falha de rede (%s)" % (metodo, caminho, type(erro).__name__)) from None
        if not isinstance(resposta, tuple) or len(resposta) != 3:
            raise RuntimeError("%s %s: resposta do transporte inválida" % (metodo, caminho))
        status, _, resp_corpo = resposta
        if not _inteiro(status) or not isinstance(resp_corpo, (bytes, bytearray)):
            raise RuntimeError("%s %s: resposta do transporte inválida" % (metodo, caminho))
        return status, bytes(resp_corpo)

    def _pedir(self, metodo: str, caminho: str, corpo: dict | None = None, aceitos=(200,)):
        """JSON da resposta; qualquer status fora de `aceitos` é erro."""
        status, bruto = self._enviar(metodo, caminho, corpo)
        if status not in aceitos:
            raise RuntimeError("%s %s: HTTP %s" % (metodo, caminho, status))
        try:
            return json.loads(bruto.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, RecursionError):
            raise RuntimeError("%s %s: resposta não é JSON" % (metodo, caminho)) from None

    def _objeto(self, metodo: str, caminho: str, corpo: dict | None = None, aceitos=(200,)) -> dict:
        dados = self._pedir(metodo, caminho, corpo, aceitos)
        if not isinstance(dados, dict):
            raise RuntimeError("%s %s: resposta não é um objeto JSON" % (metodo, caminho))
        return dados

    def _lista(self, caminho: str, campo: str) -> list:
        dados = self._pedir("GET", caminho)
        if not isinstance(dados, list):
            raise RuntimeError("GET %s: resposta sem a lista de %s" % (caminho, campo))
        return dados

    @staticmethod
    def _texto(objeto: dict, pai: str, chave: str, metodo: str, caminho: str) -> str:
        valor = objeto.get(chave)
        if not isinstance(valor, str) or not valor:
            raise RuntimeError("%s %s: resposta sem o campo %r" % (metodo, caminho, pai + chave))
        return valor

    # Pull requests

    def pr(self, url: str) -> dict:
        dono, nome, numero = _analisar_url(url, "pull")
        raiz = "/repos/%s/%s/pulls/%d" % (dono, nome, numero)
        dados = self._objeto("GET", raiz)
        estado = self._texto(dados, "", "state", "GET", raiz)
        cabeca = dados.get("head")
        if not isinstance(cabeca, dict):
            raise RuntimeError("GET %s: resposta sem o campo 'head'" % raiz)
        head_sha = self._texto(cabeca, "head.", "sha", "GET", raiz)
        branch = self._texto(cabeca, "head.", "ref", "GET", raiz)
        esperados = dados.get("changed_files")
        if esperados is not None and not _inteiro(esperados):
            raise RuntimeError("GET %s: campo 'changed_files' não é inteiro" % raiz)

        caminhos_dos_arquivos = raiz + "/files"
        entradas = 0
        arquivos = []
        for pagina in range(1, MAX_PAGINAS + 1):
            caminho = "%s?per_page=%d&page=%d" % (caminhos_dos_arquivos, POR_PAGINA, pagina)
            itens = self._lista(caminho, "arquivos")
            for item in itens:
                if not isinstance(item, dict):
                    raise RuntimeError("GET %s: 'arquivos' tem item que não é objeto" % caminho)
                arquivos.append(self._texto(item, "arquivos[].", "filename", "GET", caminho))
                anterior = item.get("previous_filename")
                if anterior is not None:
                    if not isinstance(anterior, str):
                        raise RuntimeError("GET %s: campo 'previous_filename' não é texto" % caminho)
                    if anterior:
                        arquivos.append(anterior)
            entradas += len(itens)
            if len(itens) < POR_PAGINA:
                break
        else:
            raise RuntimeError("GET %s: arquivos demais para paginar" % caminhos_dos_arquivos)
        if esperados is not None and esperados != entradas:
            raise RuntimeError("GET %s: lista de arquivos incompleta (changed_files)" % raiz)
        return {
            "aberto": estado == "open",
            "headSha": head_sha,
            "branch": branch,
            "repo": "%s/%s" % (urllib.parse.unquote(dono), urllib.parse.unquote(nome)),
            "numero": numero,
            "arquivos": arquivos,
            "mergeado": dados.get("merged") is True,
        }

    # CI

    def _check_runs(self, base: str) -> list[dict]:
        runs: list[dict] = []
        for pagina in range(1, MAX_PAGINAS + 1):
            caminho = "%s/check-runs?per_page=%d&page=%d" % (base, POR_PAGINA, pagina)
            dados = self._objeto("GET", caminho)
            total = dados.get("total_count")
            itens = dados.get("check_runs")
            if not _inteiro(total) or total < 0:
                raise RuntimeError("GET %s: resposta sem o campo 'total_count'" % caminho)
            if not isinstance(itens, list) or not all(isinstance(i, dict) for i in itens):
                raise RuntimeError("GET %s: resposta sem o campo 'check_runs' (lista de objetos)" % caminho)
            for item in itens:
                estado = self._texto(item, "check_runs[].", "status", "GET", caminho)
                runs.append({"status": estado, "conclusion": item.get("conclusion")})
            if len(runs) >= total:
                return runs
            if not itens:
                raise RuntimeError("GET %s: check-runs incompletos (página vazia antes do total)" % caminho)
        raise RuntimeError("GET %s/check-runs: check-runs demais para paginar" % base)

    def ci(self, repo: str, sha: str) -> str:
        dono, nome = _analisar_repo(repo)
        _validar_sha_completo(sha)
        base = "/repos/%s/%s/commits/%s" % (dono, nome, sha)
        runs = self._check_runs(base)
        caminho = base + "/status"
        dados = self._objeto("GET", caminho)
        total = dados.get("total_count")
        if not _inteiro(total) or total < 0:
            raise RuntimeError("GET %s: resposta sem o campo 'total_count'" % caminho)
        estado = None
        if total > 0:
            # Sem statuses a API devolve "pending"; isso significa "nenhum status", não "pendente".
            estado = dados.get("state")
        if not runs and total == 0:
            return "ausente"
        if any(r["status"] != "completed" for r in runs) or (total > 0 and estado == "pending"):
            return "pendente"
        if any(not isinstance(r["conclusion"], str) or r["conclusion"] not in _CONCLUSOES_VERDES for r in runs):
            return "vermelho"
        if total > 0 and estado != "success":  # failure, error, ausente ou desconhecido
            return "vermelho"
        return "verde"

    # Merge, arquivos e decisões

    def mergear(self, url: str, sha: str) -> bool:
        dono, nome, numero = _analisar_url(url, "pull")
        _validar_sha_completo(sha)
        caminho = "/repos/%s/%s/pulls/%d/merge" % (dono, nome, numero)
        status, _ = self._enviar("PUT", caminho, {"sha": sha, "merge_method": "merge"})
        if status == 200:
            return True
        if status in (405, 409, 422):
            return False
        raise RuntimeError("PUT %s: HTTP %s" % (caminho, status))

    def arquivo(self, repo: str, ref: str, caminho: str) -> str | None:
        dono, nome = _analisar_repo(repo)
        _texto_nao_vazio(ref, "ref")
        trecho = _caminho_de_arquivo(caminho)
        alvo = "/repos/%s/%s/contents/%s?ref=%s" % (dono, nome, trecho, urllib.parse.quote(ref, safe=""))
        status, bruto = self._enviar("GET", alvo, bruto=True)
        if status == 404:
            return None
        if status != 200:
            raise RuntimeError("GET %s: HTTP %s" % (alvo, status))
        try:
            return bruto.decode("utf-8")
        except UnicodeDecodeError:
            raise RuntimeError("GET %s: conteúdo não é UTF-8" % alvo) from None

    def fechar_pr(self, url: str, comentario: str) -> None:
        """Comenta e fecha um PR (ou uma issue de decisão) pela API de issues, que vale para os dois."""
        dono, nome, numero = _analisar_url(url, _TIPOS_DE_URL)
        _texto_nao_vazio(comentario, "comentário")
        raiz = "/repos/%s/%s/issues/%d" % (dono, nome, numero)
        self._objeto("POST", raiz + "/comments", {"body": comentario}, (201,))
        self._objeto("PATCH", raiz, {"state": "closed"})

    def _comentar_e_mudar(self, url: str, comentario: str, estado: str) -> None:
        dono, nome, numero = _analisar_url(url, "issues")
        _texto_nao_vazio(comentario, "comentário")
        raiz = "/repos/%s/%s/issues/%d" % (dono, nome, numero)
        self._objeto("POST", raiz + "/comments", {"body": comentario}, (201,))
        self._objeto("PATCH", raiz, {"state": estado})

    def reabrir_decisao(self, url: str, comentario: str) -> None:
        self._comentar_e_mudar(url, comentario, "open")

    def fechar_decisao(self, url: str, comentario: str) -> None:
        self._comentar_e_mudar(url, comentario, "closed")

    def procurar_decisao(self, repo: str, nonce: str) -> str | None:
        """URL da issue de decisão cujo corpo tem o marcador do `nonce`, ou None."""
        dono, nome = _analisar_repo(repo)
        if not isinstance(nonce, str) or _NONCE.fullmatch(nonce) is None:
            raise ValueError("nonce inválido")
        marcador = MARCADOR_NONCE % nonce
        base = "/repos/%s/%s/issues?labels=%s&state=all&per_page=%d" % (
            dono,
            nome,
            urllib.parse.quote(LABEL_DECISAO, safe=""),
            POR_PAGINA,
        )
        for pagina in range(1, MAX_PAGINAS + 1):
            caminho = "%s&page=%d" % (base, pagina)
            itens = self._lista(caminho, "issues")
            for item in itens:
                if not isinstance(item, dict) or "pull_request" in item:
                    continue
                corpo = item.get("body")
                if isinstance(corpo, str) and marcador in corpo:
                    html_url = self._texto(item, "issues[].", "html_url", "GET", caminho)
                    try:
                        _analisar_url(html_url, "issues")
                    except ValueError:
                        raise RuntimeError("GET %s: campo 'html_url' não é uma URL de issue" % caminho) from None
                    return html_url
            if len(itens) < POR_PAGINA:
                return None
        raise RuntimeError("GET %s: issues demais para paginar" % base)

    def abrir_decisao(self, repo: str, titulo: str, corpo: str) -> str:
        dono, nome = _analisar_repo(repo)
        _texto_nao_vazio(titulo, "título")
        if not isinstance(corpo, str):
            raise ValueError("corpo inválido")
        caminho = "/repos/%s/%s/issues" % (dono, nome)
        dados = self._objeto("POST", caminho, {"title": titulo, "body": corpo, "labels": [LABEL_DECISAO]}, (201,))
        html_url = self._texto(dados, "", "html_url", "POST", caminho)
        try:
            _analisar_url(html_url, "issues")
        except ValueError:
            raise RuntimeError("POST %s: campo 'html_url' não é uma URL de issue" % caminho) from None
        return html_url

    def decisao(self, url: str) -> dict:
        dono, nome, numero = _analisar_url(url, "issues")
        raiz = "/repos/%s/%s/issues/%d" % (dono, nome, numero)
        dados = self._objeto("GET", raiz)
        estado = self._texto(dados, "", "state", "GET", raiz)
        ultimo = ""
        for pagina in range(1, MAX_PAGINAS + 1):
            caminho = "%s/comments?per_page=%d&page=%d" % (raiz, POR_PAGINA, pagina)
            itens = self._lista(caminho, "comentários")
            for item in itens:
                if not isinstance(item, dict):
                    raise RuntimeError("GET %s: 'comentários' tem item que não é objeto" % caminho)
                corpo = item.get("body")
                if not isinstance(corpo, str):
                    raise RuntimeError("GET %s: campo 'body' não é texto" % caminho)
            if itens:
                ultimo = itens[-1]["body"]
            if len(itens) < POR_PAGINA:
                break
        else:
            raise RuntimeError("GET %s/comments: comentários demais para paginar" % raiz)
        return {"fechada": estado == "closed", "ultimoComentario": ultimo}


class ForjaFalsa:
    """Forja em memória para testar o despachante sem rede.

    Ids desconhecidos (PR, CI, decisão) levantam `KeyError`; `arquivo` desconhecido devolve `None`,
    como o 404 da API. `merges` guarda só os merges que deram certo; `chamadas` guarda todas as
    chamadas, inclusive as que falham.
    """

    def __init__(self):
        self.chamadas: list[tuple[str, dict]] = []
        self.merges: list[tuple[str, str]] = []
        self.decisoes: list[tuple[str, str]] = []
        self.fechados: list[tuple[str, str]] = []
        self._prs: dict[str, dict] = {}
        self._ci: dict[tuple[str, str], str] = {}
        self._arquivos: dict[tuple[str, str, str], str] = {}
        self._decisoes: dict[str, dict] = {}
        self._corpos: dict[str, str] = {}
        self._contador = 0

    def _registrar(self, nome: str, **argumentos) -> None:
        self.chamadas.append((nome, argumentos))

    # Auxiliares de teste

    def definir_pr(
        self, url: str, *, head_sha: str, branch: str, arquivos=(), aberto: bool = True, mergeado: bool = False
    ) -> None:
        dono, nome, numero = _analisar_url(url, "pull")
        _validar_sha_completo(head_sha)
        self._prs[url] = {
            "aberto": bool(aberto),
            "headSha": head_sha,
            "branch": branch,
            "repo": "%s/%s" % (urllib.parse.unquote(dono), urllib.parse.unquote(nome)),
            "numero": numero,
            "arquivos": list(arquivos),
            "mergeado": bool(mergeado),
        }

    def definir_ci(self, repo: str, sha: str, resultado: str) -> None:
        _analisar_repo(repo)
        _validar_sha_completo(sha)
        if resultado not in RESULTADOS_CI:
            raise ValueError("resultado de CI desconhecido: %r" % (resultado,))
        self._ci[(repo, sha)] = resultado

    def definir_arquivo(self, repo: str, ref: str, caminho: str, conteudo: str) -> None:
        _analisar_repo(repo)
        _caminho_de_arquivo(caminho)
        self._arquivos[(repo, ref, caminho)] = conteudo

    def definir_decisao(self, url: str, *, fechada: bool, ultimo_comentario: str = "") -> None:
        _analisar_url(url, "issues")
        self._decisoes[url] = {"fechada": bool(fechada), "ultimoComentario": ultimo_comentario}

    # Mesma interface da ForjaGitHub

    def pr(self, url: str) -> dict:
        self._registrar("pr", url=url)
        _analisar_url(url, "pull")
        if url not in self._prs:
            raise KeyError("PR desconhecido: %r" % (url,))
        return copy.deepcopy(self._prs[url])

    def ci(self, repo: str, sha: str) -> str:
        self._registrar("ci", repo=repo, sha=sha)
        _analisar_repo(repo)
        _validar_sha_completo(sha)
        if (repo, sha) not in self._ci:
            raise KeyError("CI desconhecido: %r" % ((repo, sha),))
        return self._ci[(repo, sha)]

    def mergear(self, url: str, sha: str) -> bool:
        self._registrar("mergear", url=url, sha=sha)
        _analisar_url(url, "pull")
        _validar_sha_completo(sha)
        if url not in self._prs:
            raise KeyError("PR desconhecido: %r" % (url,))
        pr = self._prs[url]
        if not pr["aberto"] or pr["headSha"] != sha:
            return False
        pr["aberto"] = False
        pr["mergeado"] = True
        self.merges.append((url, sha))
        return True

    def fechar_pr(self, url: str, comentario: str) -> None:
        self._registrar("fechar_pr", url=url, comentario=comentario)
        _analisar_url(url, _TIPOS_DE_URL)
        _texto_nao_vazio(comentario, "comentário")
        if url in self._prs:
            self._prs[url]["aberto"] = False
        elif url in self._decisoes:
            self._decisoes[url] = {"fechada": True, "ultimoComentario": comentario}
        else:
            raise KeyError("PR ou decisão desconhecida: %r" % (url,))
        self.fechados.append((url, comentario))

    def arquivo(self, repo: str, ref: str, caminho: str) -> str | None:
        self._registrar("arquivo", repo=repo, ref=ref, caminho=caminho)
        _analisar_repo(repo)
        _texto_nao_vazio(ref, "ref")
        _caminho_de_arquivo(caminho)
        return self._arquivos.get((repo, ref, caminho))

    def abrir_decisao(self, repo: str, titulo: str, corpo: str) -> str:
        self._registrar("abrir_decisao", repo=repo, titulo=titulo, corpo=corpo)
        _analisar_repo(repo)
        _texto_nao_vazio(titulo, "título")
        if not isinstance(corpo, str):
            raise ValueError("corpo inválido")
        self._contador += 1
        url = "https://github.com/%s/issues/%d" % (repo, self._contador)
        self.decisoes.append((titulo, corpo))
        self._decisoes[url] = {"fechada": False, "ultimoComentario": ""}
        self._corpos[url] = corpo
        return url

    def _mudar_decisao(self, nome: str, url: str, comentario: str, fechada: bool) -> None:
        self._registrar(nome, url=url, comentario=comentario)
        _analisar_url(url, "issues")
        _texto_nao_vazio(comentario, "comentário")
        if url not in self._decisoes:
            raise KeyError("decisão desconhecida: %r" % (url,))
        self._decisoes[url] = {"fechada": fechada, "ultimoComentario": comentario}

    def reabrir_decisao(self, url: str, comentario: str) -> None:
        self._mudar_decisao("reabrir_decisao", url, comentario, False)

    def fechar_decisao(self, url: str, comentario: str) -> None:
        self._mudar_decisao("fechar_decisao", url, comentario, True)

    def procurar_decisao(self, repo: str, nonce: str) -> str | None:
        self._registrar("procurar_decisao", repo=repo, nonce=nonce)
        _analisar_repo(repo)
        if not isinstance(nonce, str) or _NONCE.fullmatch(nonce) is None:
            raise ValueError("nonce inválido")
        marcador = MARCADOR_NONCE % nonce
        for url, corpo in self._corpos.items():
            if marcador in corpo:
                return url
        return None

    def decisao(self, url: str) -> dict:
        self._registrar("decisao", url=url)
        _analisar_url(url, "issues")
        if url not in self._decisoes:
            raise KeyError("decisão desconhecida: %r" % (url,))
        return copy.deepcopy(self._decisoes[url])
