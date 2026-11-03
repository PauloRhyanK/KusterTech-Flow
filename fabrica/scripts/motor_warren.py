"""Cliente HTTP do Warren 0.19.3 (token bearer, JSON, eventos em NDJSON)."""

import errno
import http.client
import json
import socket
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from motor import FalhaAntesDoEnvio, FalhaIncerta, MotorOcupado, instante, marcas_de_nonce, procurar_nonce, validar_nonce  # noqa: E402

# Falhas em que a requisição nunca foi escrita: o servidor não pode ter aceitado nada.
_ERRNOS_ANTES = {errno.ECONNREFUSED, errno.EHOSTUNREACH, errno.ENETUNREACH, errno.EADDRNOTAVAIL}


def _classe_da_falha(erro):
    """`FalhaAntesDoEnvio` só quando é certo que nada foi enviado; qualquer dúvida é `FalhaIncerta`.

    O urllib embrulha em URLError as falhas da fase de conexão e envio (`h.request`); as da leitura
    da resposta (`getresponse`, `read`) chegam cruas.
    """
    if isinstance(erro, urllib.error.URLError) and not isinstance(erro, urllib.error.HTTPError):
        razao = erro.reason
        if isinstance(razao, (ConnectionRefusedError, socket.gaierror, TimeoutError)):
            return FalhaAntesDoEnvio
        if isinstance(razao, OSError) and razao.errno in _ERRNOS_ANTES:
            return FalhaAntesDoEnvio
        return FalhaIncerta
    if isinstance(erro, (ConnectionRefusedError, socket.gaierror)):
        return FalhaAntesDoEnvio
    return FalhaIncerta

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
        classe = _classe_da_falha(erro)
        raise classe("%s %s: falha de rede (%s)" % (metodo, caminho, type(erro).__name__)) from erro


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

    def _requisitar(self, metodo: str, caminho: str, corpo: dict | None = None, extras: dict | None = None) -> bytes:
        headers = {
            "Authorization": "Bearer " + self._token,
            "Accept": "application/json",
        }
        if extras:
            headers.update(extras)
        dados = None
        if corpo is not None:
            headers["Content-Type"] = "application/json"
            dados = json.dumps(corpo).encode("utf-8")
        try:
            status, resp_headers, resp_corpo = self._transporte(metodo, self._base + caminho, headers, dados)
        except (urllib.error.URLError, OSError, http.client.HTTPException) as erro:
            classe = erro.__class__ if isinstance(erro, (FalhaAntesDoEnvio, FalhaIncerta)) else _classe_da_falha(erro)
            raise classe("%s %s: falha de rede (%s)" % (metodo, caminho, type(erro).__name__)) from None
        if status == 429:
            raise MotorOcupado(_retry_after(resp_headers))
        if not 200 <= status < 300:
            raise RuntimeError("%s %s: HTTP %s" % (metodo, caminho, status))
        return resp_corpo

    def _json(self, metodo: str, caminho: str, corpo: dict | None = None, extras: dict | None = None) -> dict:
        bruto = self._requisitar(metodo, caminho, corpo, extras)
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
        chave_idempotencia: str | None = None,
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
        # Q1: `Idempotency-Key` (dispatch.ts, idempotency.ts): uma chave repetida em 10 min, no mesmo projeto, devolve
        # o MESMO 201 com o run já criado, sem criar outro. A resposta é lida como a de um despacho novo.
        extras = {"Idempotency-Key": validar_nonce(chave_idempotencia)} if chave_idempotencia is not None else None
        dados = self._json("POST", caminho, corpo, extras)
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

    def _procurar(self, caminho: str, chave: str, campo: str, nonce) -> str | None:
        marcas = marcas_de_nonce(nonce)
        dados = self._json("GET", caminho)
        itens = dados.get(chave)
        if not isinstance(itens, list):
            raise RuntimeError("GET %s: resposta sem a lista %r" % (caminho, chave))
        for item in itens:
            if not isinstance(item, dict):
                raise RuntimeError("GET %s: %r tem item que não é objeto" % (caminho, chave))
            texto = item.get(campo)
            if isinstance(texto, str) and any(m in texto for m in marcas):
                return self._texto(item, chave + "[]", "id", "GET", caminho)
        return None

    def _listar_runs(self, projeto: str, direcao: str, limite: int, offset: int) -> list:
        """GET /runs?project=&sort=started&dir=&limit=&offset= (lifecycle.ts): `{runs, total, limit, offset}`."""
        caminho = "/runs?project=%s&sort=started&dir=%s&limit=%d&offset=%d" % (urllib.parse.quote(projeto, safe=""), direcao, limite, offset)
        dados = self._json("GET", caminho)
        itens = dados.get("runs")
        if not isinstance(itens, list):
            raise RuntimeError("GET %s: resposta sem a lista 'runs'" % caminho)
        return itens

    def procurar_run(self, projeto: str, nonce: str, desde: str | None = None) -> str | None:
        """Q1: o Warren ordena por started_at DESC, id ASC e um run queued tem started_at NULL; sem filtro de estado.

        A busca lê DESC (paginando até os runs iniciados antes de `desde`) e ASC (os NULL, no SQLite), ver `procurar_nonce`.
        `nonce` pode ser a lista de nonces da cadeia (R3); o teto de páginas sem achar levanta `BuscaIncompleta` (R5).
        """
        marcas_de_nonce(nonce)
        if desde is not None:
            instante(desde)
        return procurar_nonce(lambda direcao, limite, offset: self._listar_runs(projeto, direcao, limite, offset), "prompt", nonce, desde)

    def procurar_plano(self, projeto: str, nonce: str) -> str | None:
        """GET /plan-runs?project= devolve TODOS os Plan Runs do projeto, por createdAt ASC e sem limite (plan-runs.ts)."""
        marcas_de_nonce(nonce)
        caminho = "/plan-runs?project=%s" % urllib.parse.quote(projeto, safe="")
        return self._procurar(caminho, "planRuns", "promptTemplate", nonce)

    def procurar_retry(self, projeto: str, run_id: str, nonces: list, desde: str | None = None) -> str | None:
        """R2 (infra-lost-retry.ts): o retry automático tem `retryOf` = original e o MESMO prompt (logo, o mesmo nonce).

        GET /runs devolve o `RunRow` inteiro ao operador, com `retryOf` (lifecycle.ts). O original nunca é a resposta.
        """
        _id(run_id)
        marcas_de_nonce(list(nonces) or ["0" * 32])
        if desde is not None:
            instante(desde)
        return procurar_nonce(
            lambda direcao, limite, offset: self._listar_runs(projeto, direcao, limite, offset),
            "prompt",
            list(nonces) or ["0" * 32],
            desde,
            retry_of=run_id,
            excluir=(run_id,),
        )

    def visao_geral(self) -> dict:
        """GET /ops/overview (ops-overview.ts): o `runs.nonTerminal` é exigido (inteiro >= 0)."""
        caminho = "/ops/overview"
        dados = self._json("GET", caminho)
        runs = dados.get("runs")
        ativos = runs.get("nonTerminal") if isinstance(runs, dict) else None
        if not isinstance(ativos, int) or isinstance(ativos, bool) or ativos < 0:
            raise RuntimeError("GET %s: resposta sem o campo 'runs.nonTerminal' (inteiro >= 0)" % caminho)
        return dados

    def versao(self) -> str:
        """GET /version (meta.ts): `{"version": "0.19.3"}`."""
        versao = self._json("GET", "/version").get("version")
        if not isinstance(versao, str) or not versao.strip():
            raise RuntimeError("GET /version: resposta sem o campo 'version'")
        return versao

    def cancelar_plano(self, plan_run_id: str) -> None:
        self._requisitar("POST", "/plan-runs/%s/cancel" % _id(plan_run_id), {})

    def retomar_plano(self, plan_run_id: str) -> None:
        self._requisitar("POST", "/plan-runs/%s/resume" % _id(plan_run_id), {})
