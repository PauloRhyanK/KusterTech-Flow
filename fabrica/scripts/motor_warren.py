"""Cliente HTTP do Warren 0.19.3 (token bearer, JSON, eventos em NDJSON)."""

import http.client
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from motor import MotorOcupado  # noqa: E402

TIMEOUT_REQUISICAO_S = 30
TIMEOUT_EVENTOS_S = 180
RETRY_AFTER_PADRAO = 30
PREFIXO_FILHO = "child_"


class _SemRedirecionamento(urllib.request.HTTPRedirectHandler):
    """Não segue redirecionamentos, para o token nunca sair para outro host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_SemRedirecionamento)


def _abrir(req, timeout):
    return _OPENER.open(req, timeout=timeout)


def _transporte_urllib(metodo, url, headers, corpo):
    """Transporte padrão: `(status, headers, corpo)`; HTTP >= 400 também volta como tupla.

    Falhas de rede, de protocolo ou de timeout viram `RuntimeError` com método, caminho e o
    nome da classe da exceção (nunca o texto dela, que pode conter dados da resposta).
    """
    caminho = urllib.parse.urlsplit(url).path
    timeout = TIMEOUT_EVENTOS_S if caminho.endswith("/events") else TIMEOUT_REQUISICAO_S
    try:
        req = urllib.request.Request(url, data=corpo, headers=dict(headers), method=metodo)
        try:
            with _abrir(req, timeout=timeout) as resposta:
                return resposta.status, dict(resposta.headers), resposta.read()
        except urllib.error.HTTPError as erro:
            try:
                return erro.code, dict(erro.headers or {}), erro.read()
            finally:
                erro.close()
    except (http.client.HTTPException, OSError) as erro:
        raise RuntimeError("%s %s: falha de rede (%s)" % (metodo, caminho, type(erro).__name__)) from erro


def _id(valor) -> str:
    if not isinstance(valor, str) or valor in ("", ".", ".."):
        raise ValueError("id inválido")
    return urllib.parse.quote(valor, safe="")


def _sem_prefixo_de_filho(motivo):
    """`child_oom_killed` -> `oom_killed`. Códigos compostos (`child_seed_not_found:x`) ficam como vieram."""
    if not isinstance(motivo, str) or not motivo:
        return None
    resto = motivo[len(PREFIXO_FILHO) :]
    if motivo.startswith(PREFIXO_FILHO) and resto and ":" not in resto:
        return resto
    return motivo


def _validar_token(token) -> str:
    if not isinstance(token, str):
        raise ValueError("token inválido")
    token = token.strip()
    if not token:
        raise ValueError("token do Warren vazio")
    if not all(33 <= ord(c) <= 126 for c in token):
        raise ValueError("token inválido")
    return token


def _cabecalho(headers: dict, nome: str):
    nome = nome.lower()
    for chave, valor in (headers or {}).items():
        if str(chave).lower() == nome:
            return valor
    return None


def _retry_after(headers: dict) -> int:
    try:
        return int(_cabecalho(headers, "Retry-After"))
    except (TypeError, ValueError):
        return RETRY_AFTER_PADRAO


def _modelo_do_init(evento):
    """O `model` de um evento `system`/`init` (no envelope do Warren ou cru), ou None."""
    if not isinstance(evento, dict):
        return None
    payload = evento.get("payload")
    candidatos = [evento] + ([payload] if isinstance(payload, dict) else [])
    if not any(c.get("kind") == "system" or c.get("type") == "system" for c in candidatos):
        return None
    for candidato in candidatos:
        modelo = candidato.get("model")
        if candidato.get("subtype") == "init" and isinstance(modelo, str) and modelo.strip():
            return modelo
    return None


class MotorWarren:
    def __init__(self, base_url: str, token: str, transporte=None):
        self._token = _validar_token(token)
        self._base = base_url.rstrip("/")
        self._transporte = transporte or _transporte_urllib

    # Camada HTTP. Nenhuma mensagem de erro carrega token nem corpo de resposta.

    def _requisitar(self, metodo: str, caminho: str, corpo: dict | None = None) -> bytes:
        headers = {
            "Authorization": "Bearer " + self._token,
            "Accept": "application/json",
        }
        dados = None
        if corpo is not None:
            headers["Content-Type"] = "application/json"
            dados = json.dumps(corpo).encode("utf-8")
        try:
            status, resp_headers, resp_corpo = self._transporte(metodo, self._base + caminho, headers, dados)
        except (urllib.error.URLError, OSError) as erro:
            raise RuntimeError("%s %s: falha de rede (%s)" % (metodo, caminho, type(erro).__name__)) from None
        if status == 429:
            raise MotorOcupado(_retry_after(resp_headers))
        if not 200 <= status < 300:
            raise RuntimeError("%s %s: HTTP %s" % (metodo, caminho, status))
        return resp_corpo

    def _json(self, metodo: str, caminho: str, corpo: dict | None = None) -> dict:
        bruto = self._requisitar(metodo, caminho, corpo)
        try:
            dados = json.loads(bruto.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise RuntimeError("%s %s: resposta não é JSON" % (metodo, caminho)) from None
        if not isinstance(dados, dict):
            raise RuntimeError("%s %s: resposta não é um objeto JSON" % (metodo, caminho))
        return dados

    @staticmethod
    def _objeto(dados: dict, chave: str, campo: str, metodo: str, caminho: str) -> dict:
        valor = dados.get(chave)
        if not isinstance(valor, dict):
            raise RuntimeError("%s %s: resposta sem o campo %r" % (metodo, caminho, campo))
        return valor

    @staticmethod
    def _texto(objeto: dict, pai: str, chave: str, metodo: str, caminho: str) -> str:
        valor = objeto.get(chave)
        if not isinstance(valor, str) or not valor:
            raise RuntimeError("%s %s: resposta sem o campo %r" % (metodo, caminho, pai + "." + chave))
        return valor

    # Protocolo Motor

    def despachar_plano(
        self,
        *,
        projeto: str,
        plano_seeds: str,
        agente: str,
        modelo: str,
        prompt_template: str,
        max_custo_usd: float,
    ) -> str:
        caminho = "/plan-runs"
        dados = self._json(
            "POST",
            caminho,
            {
                "project": projeto,
                "agent": agente,
                "planId": plano_seeds,
                "promptTemplate": prompt_template,
                "modelOverride": modelo,
                "maxCostUsd": max_custo_usd,
            },
        )
        plan_run = self._objeto(dados, "planRun", "planRun.id", "POST", caminho)
        return self._texto(plan_run, "planRun", "id", "POST", caminho)

    def despachar_run(
        self,
        *,
        projeto: str,
        agente: str,
        modelo: str,
        prompt: str,
        branch_existente: str | None,
        max_custo_usd: float,
    ) -> str:
        caminho = "/runs"
        corpo = {
            "project": projeto,
            "agent": agente,
            "prompt": prompt,
            "modelOverride": modelo,
            "maxCostUsd": max_custo_usd,
        }
        if branch_existente:
            corpo["existingBranch"] = branch_existente
        dados = self._json("POST", caminho, corpo)
        run = self._objeto(dados, "run", "run.id", "POST", caminho)
        return self._texto(run, "run", "id", "POST", caminho)

    def plano(self, plan_run_id: str) -> dict:
        caminho = "/plan-runs/" + _id(plan_run_id)
        dados = self._json("GET", caminho)
        plan_run = self._objeto(dados, "planRun", "planRun.state", "GET", caminho)
        estado = self._texto(plan_run, "planRun", "state", "GET", caminho)
        filhos_brutos = dados.get("children")
        if not isinstance(filhos_brutos, list) or not all(isinstance(f, dict) for f in filhos_brutos):
            raise RuntimeError("GET %s: resposta sem o campo 'children' (lista de objetos)" % caminho)
        runs_brutos = dados.get("runs", [])
        if not isinstance(runs_brutos, list):
            raise RuntimeError("GET %s: campo 'runs' não é uma lista" % caminho)
        runs_por_id = {}
        for run in runs_brutos:
            if not isinstance(run, dict):
                raise RuntimeError("GET %s: 'runs' tem item que não é objeto" % caminho)
            runs_por_id[self._texto(run, "runs[]", "id", "GET", caminho)] = run
        filhos = []
        for filho in filhos_brutos:
            run_id = filho.get("runId")
            if run_id is not None and not isinstance(run_id, str):
                raise RuntimeError("GET %s: campo 'children[].runId' não é texto" % caminho)
            run = runs_por_id.get(run_id) if run_id is not None else None
            motivo_run = run.get("failureReason") if run is not None else None
            if not isinstance(motivo_run, str) or not motivo_run:
                motivo_run = None
            filhos.append(
                {
                    "seedId": self._texto(filho, "children[]", "seedId", "GET", caminho),
                    "estado": self._texto(filho, "children[]", "state", "GET", caminho),
                    "runId": run_id,
                    "prUrl": run.get("prUrl") if run is not None else None,
                    "falha": motivo_run or _sem_prefixo_de_filho(filho.get("failureReason")),
                }
            )
        return {"estado": estado, "falha": plan_run.get("failureReason"), "filhos": filhos}

    def run(self, run_id: str) -> dict:
        caminho = "/runs/" + _id(run_id)
        dados = self._json("GET", caminho)
        run = self._objeto(dados, "run", "run.state", "GET", caminho)
        return {
            "estado": self._texto(run, "run", "state", "GET", caminho),
            "motivoFalha": run.get("failureReason"),
            "prUrl": run.get("prUrl"),
            "custoUsd": run.get("costUsd"),
        }

    def ultimo_texto(self, run_id: str) -> str:
        bruto = self._requisitar("GET", "/runs/%s/events?follow=0" % _id(run_id))
        ultimo = ""
        # O separador do NDJSON é só "\n": splitlines() também quebraria em U+2028, U+2029 e U+0085.
        for linha in bruto.split(b"\n"):
            try:
                evento = json.loads(linha.decode("utf-8", errors="replace"))
            except ValueError:
                continue
            if not isinstance(evento, dict) or evento.get("kind") != "text":
                continue
            payload = evento.get("payload")
            texto = payload.get("text") if isinstance(payload, dict) else None
            if isinstance(texto, str) and texto.strip():
                ultimo = texto
        return ultimo

    def modelo_efetivo(self, run_id: str) -> str | None:
        bruto = self._requisitar("GET", "/runs/%s/events?follow=0" % _id(run_id))
        # Mesmo cuidado de ultimo_texto: o separador do NDJSON é só "\n".
        for linha in bruto.split(b"\n"):
            try:
                evento = json.loads(linha.decode("utf-8", errors="replace"))
            except ValueError:
                continue
            modelo = _modelo_do_init(evento)
            if modelo is not None:
                return modelo
        return None

    def retomar_plano(self, plan_run_id: str) -> None:
        self._requisitar("POST", "/plan-runs/%s/resume" % _id(plan_run_id), {})
