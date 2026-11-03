"""Cliente HTTP do Warren 0.19.3 (token bearer, JSON, eventos em NDJSON)."""

import json
import urllib.error
import urllib.parse
import urllib.request

from motor import MotorOcupado

TIMEOUT_REQUISICAO_S = 30
TIMEOUT_EVENTOS_S = 180
RETRY_AFTER_PADRAO = 30


class _SemRedirecionamento(urllib.request.HTTPRedirectHandler):
    """Não segue redirecionamentos, para o token nunca sair para outro host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_SemRedirecionamento)


def _abrir(req, timeout):
    return _OPENER.open(req, timeout=timeout)


def _transporte_urllib(metodo, url, headers, corpo):
    """Transporte padrão: `(status, headers, corpo)`; HTTP >= 400 também volta como tupla."""
    caminho = urllib.parse.urlsplit(url).path
    timeout = TIMEOUT_EVENTOS_S if caminho.endswith("/events") else TIMEOUT_REQUISICAO_S
    req = urllib.request.Request(url, data=corpo, headers=dict(headers), method=metodo)
    try:
        with _abrir(req, timeout=timeout) as resposta:
            return resposta.status, dict(resposta.headers), resposta.read()
    except urllib.error.HTTPError as erro:
        try:
            return erro.code, dict(erro.headers or {}), erro.read()
        finally:
            erro.close()


def _id(valor: str) -> str:
    return urllib.parse.quote(valor, safe="")


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


class MotorWarren:
    def __init__(self, base_url: str, token: str, transporte=None):
        if not token:
            raise ValueError("token do Warren vazio")
        self._base = base_url.rstrip("/")
        self._token = token
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
        pr_por_run = {r["id"]: r.get("prUrl") for r in runs_brutos if isinstance(r, dict) and "id" in r}
        filhos = []
        for filho in filhos_brutos:
            run_id = filho.get("runId")
            filhos.append(
                {
                    "seedId": self._texto(filho, "children[]", "seedId", "GET", caminho),
                    "estado": self._texto(filho, "children[]", "state", "GET", caminho),
                    "runId": run_id,
                    "prUrl": pr_por_run.get(run_id) if run_id is not None else None,
                    "falha": filho.get("failureReason"),
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
        for linha in bruto.decode("utf-8", errors="replace").splitlines():
            try:
                evento = json.loads(linha)
            except ValueError:
                continue
            if not isinstance(evento, dict) or evento.get("kind") != "text":
                continue
            payload = evento.get("payload")
            texto = payload.get("text") if isinstance(payload, dict) else None
            if isinstance(texto, str):
                ultimo = texto
        return ultimo

    def retomar_plano(self, plan_run_id: str) -> None:
        self._requisitar("POST", "/plan-runs/%s/resume" % _id(plan_run_id), {})
