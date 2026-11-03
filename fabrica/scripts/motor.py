"""Interface do motor de execução (Warren) e o motor falso em memória."""

import copy
import datetime
import re
import typing

_CAMPOS_RUN = ("estado", "motivoFalha", "prUrl", "custoUsd")
# Marcador do nonce na última linha do texto de um POST pago (prompt ou promptTemplate).
MARCADOR_NONCE = "<!-- fabrica:nonce=%s -->"
_NONCE = re.compile(r"[0-9a-f]{32}")
# Busca pelo nonce em GET /runs (Warren 0.19.3, runs-queries.ts): ORDER BY started_at <dir>, id ASC, sem filtro de
# estado; um run queued tem started_at NULL (runs.ts), que no SQLite (padrão) fica por último em DESC e primeiro
# em ASC, e no Postgres o contrário. Por isso a busca lê as duas direções, em páginas de 100 (limit <= 500).
PAGINA_DA_BUSCA = 100
MAX_PAGINAS_DA_BUSCA = 20
# Janela de deduplicação do `Idempotency-Key` em POST /runs (idempotency.ts): 10 min por (projeto, chave).
JANELA_IDEMPOTENCIA = datetime.timedelta(minutes=10)
_DIALETOS = ("sqlite", "postgres")
_NAO_TERMINAIS_DE_RUN = ("queued", "pending", "dispatched", "running")
# R2: causas de falha que o Warren refaz sozinho, UMA vez, num run novo com o mesmo prompt e `retryOf` apontando para
# o original (runs/retry/infra-lost-retry.ts, INFRA_LOST_RUN_FAILURE_REASONS); filhos de Plan Run ficam de fora.
MOTIVOS_INFRA_PERDIDA = ("sandbox_run_lost", "preempted")


def validar_nonce(nonce) -> str:
    if not isinstance(nonce, str) or _NONCE.fullmatch(nonce) is None:
        raise ValueError("nonce inválido")
    return nonce


def instante(valor) -> datetime.datetime:
    """`datetime` com fuso de um texto ISO 8601 (`Z` aceito); `ValueError` se não for um."""
    if not isinstance(valor, str) or not valor:
        raise ValueError("instante inválido")
    try:
        momento = datetime.datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("instante inválido") from None
    return momento if momento.tzinfo is not None else momento.replace(tzinfo=datetime.timezone.utc)


def instante_de_run(valor):
    """`startedAt` de um run do Warren (ISO, como `runs.ts` grava; milissegundos aceitos); None se nulo ou ilegível."""
    if isinstance(valor, bool) or valor is None:
        return None
    if isinstance(valor, (int, float)):
        try:
            segundos = valor / 1000 if valor > 1e11 else valor
            return datetime.datetime.fromtimestamp(segundos, datetime.timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    try:
        return instante(valor)
    except ValueError:
        return None


def marcas_de_nonce(nonces) -> list[str]:
    """Os marcadores de um nonce ou de uma cadeia de nonces (lista não vazia de hex de 32); `ValueError` se inválido."""
    if isinstance(nonces, str):
        nonces = [nonces]
    if not isinstance(nonces, list) or not nonces:
        raise ValueError("nonce inválido")
    return [MARCADOR_NONCE % validar_nonce(n) for n in nonces]


class BuscaIncompleta(RuntimeError):
    """R5: a busca bateu no teto de páginas sem achar o nonce: é uma busca FALHA, não um "não encontrado"."""


def procurar_nonce(listar, campo: str, nonce, desde=None, *, retry_of=None, excluir=()):
    """Acha o id do run cujo `campo` leva o marcador de um dos nonces da cadeia, enxergando os runs ainda na fila.

    `listar(direcao, limite, offset)` devolve uma página de GET /runs na ordem do Warren. DESC traz os iniciados
    mais recentes (e, no Postgres, os queued na frente); a paginação para na primeira página com um run iniciado
    antes de `desde` (a hora da ação, com margem), ou numa única página sem `desde`. ASC traz, no SQLite, os
    queued (NULL) primeiro: para na primeira página que já mostra um run iniciado. Há um teto de páginas: se ele
    for atingido numa direção sem achar nada, a busca é incompleta e levanta `BuscaIncompleta` (R5).

    `nonce` é um texto ou a lista de nonces da cadeia (R3). Com `retry_of`, um run cujo `retryOf` é esse id também
    casa (R2). Ids em `excluir` nunca são a resposta (o run original de um retry leva o mesmo nonce).
    """
    marcas = marcas_de_nonce(nonce)
    corte = instante(desde) if desde is not None else None
    excluidos = set(excluir)
    incompleta = False
    for direcao in ("desc", "asc"):
        completa = False
        for pagina in range(MAX_PAGINAS_DA_BUSCA):
            itens = listar(direcao, PAGINA_DA_BUSCA, pagina * PAGINA_DA_BUSCA)
            parar = len(itens) < PAGINA_DA_BUSCA
            for item in itens:
                if not isinstance(item, dict):
                    raise RuntimeError("GET /runs: 'runs' tem item que não é objeto")
                ident = item.get("id")
                texto = item.get(campo)
                casa = (isinstance(texto, str) and any(m in texto for m in marcas)) or (
                    retry_of is not None and item.get("retryOf") == retry_of
                )
                if casa and ident not in excluidos:
                    if not isinstance(ident, str) or not ident:
                        raise RuntimeError("GET /runs: resposta sem o campo 'runs[].id'")
                    return ident
                inicio = instante_de_run(item.get("startedAt"))
                if inicio is None:
                    continue
                if direcao == "asc" or (corte is not None and inicio < corte):
                    parar = True
            if parar or (direcao == "desc" and corte is None):
                completa = True
                break
        incompleta = incompleta or not completa
    if incompleta:
        raise BuscaIncompleta("GET /runs: limite de %d páginas atingido sem achar o nonce" % MAX_PAGINAS_DA_BUSCA)
    return None


class FalhaDeRede(RuntimeError):
    """Falha na camada de rede (conexão recusada, timeout, DNS): distinta de um HTTP >= 400."""


class FalhaAntesDoEnvio(FalhaDeRede):
    """A requisição não foi escrita (conexão recusada, nome não resolvido, timeout de conexão): repetir é seguro."""


class FalhaIncerta(FalhaDeRede):
    """A requisição pode ter chegado (timeout de leitura, conexão derrubada): o serviço pode ter aceitado."""


class MotorOcupado(Exception):
    """O motor recusou o despacho por falta de cota ou de vaga (HTTP 429)."""

    def __init__(self, retry_after: int = 30):
        super().__init__("motor ocupado, tentar de novo em %s s" % retry_after)
        self.retry_after = retry_after


@typing.runtime_checkable
class Motor(typing.Protocol):
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
        """Devolve o `planRunId`."""
        ...

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
        """Devolve o `runId`. Com `chave_idempotencia` (nonce), um POST repetido devolve o run já criado."""
        ...

    def plano(self, plan_run_id: str) -> dict:
        """`{"estado", "falha", "filhos": [{"seedId", "estado", "runId", "prUrl", "falha"}]}`."""
        ...

    def run(self, run_id: str) -> dict:
        """`{"estado", "motivoFalha", "prUrl", "custoUsd"}`."""
        ...

    def ultimo_texto(self, run_id: str) -> str: ...

    def retomar_plano(self, plan_run_id: str) -> None: ...

    def modelo_efetivo(self, run_id: str) -> str | None:
        """O modelo que o run usou de fato (evento `system`/`init`), ou None se não houver."""
        ...

    def cancelar_plano(self, plan_run_id: str) -> None:
        """Cancela o Plan Run (replanejamento de uma raia em execução)."""
        ...

    def procurar_run(self, projeto: str, nonce: str, desde: str | None = None) -> str | None:
        """O `runId` cujo prompt tem o marcador do nonce (ou de um nonce da lista, R3), inclusive na fila; `desde`
        (ISO) limita a paginação. `BuscaIncompleta` se o teto de páginas for atingido sem achar (R5)."""
        ...

    def procurar_plano(self, projeto: str, nonce: str) -> str | None:
        """O `planRunId` cujo promptTemplate tem o marcador do nonce (ou de um da lista), entre os Plan Runs do projeto."""
        ...

    def procurar_retry(self, projeto: str, run_id: str, nonces: list, desde: str | None = None) -> str | None:
        """R2: o run que o Warren criou sozinho para substituir `run_id` (perda de infraestrutura): `retryOf == run_id`
        ou um run DIFERENTE do original com um dos nonces no prompt. `nonces` pode ser vazia (estado antigo)."""
        ...

    def visao_geral(self) -> dict:
        """GET /ops/overview: `{"runs": {"nonTerminal": int, ...}, ...}` (o preparar_warren só reinicia com 0)."""
        ...

    def versao(self) -> str:
        """GET /version: a versão do Warren; responder é o sinal de que ele está de pé."""
        ...


class MotorFalso:
    """Motor em memória para testar o despachante sem rede."""

    def __init__(self):
        self.chamadas: list[tuple[str, dict]] = []
        self._planos: dict[str, dict] = {}
        self._runs: dict[str, dict] = {}
        self._textos: dict[str, str] = {}
        self._modelos: dict[str, str] = {}
        self._lotado: int | None = None
        self._falha_de_despacho: tuple[str, int] | None = None
        self._textos_enviados: dict[str, tuple[str, str]] = {}
        self._contador = 0
        # Q1: a listagem de GET /runs como o Warren a ordena, a fila e a janela de idempotência
        self.agora = lambda: datetime.datetime.now(datetime.timezone.utc)
        self.dialeto = "sqlite"
        self._momentos: dict[str, dict] = {}
        self._fila = False
        self._idempotencia: dict[tuple[str, str], tuple[datetime.datetime, str]] = {}
        # R2: como o Warren, um run direto que falha por infra perdida ganha UM retry automático (desligável, como
        # quando o orçamento acabou ou houve cancel). R3: o run só aparece na listagem depois do atraso
        # (spawn/dispatch.ts: `runs.create` vem depois de `refreshProject`).
        self.retry_infra_perdida = True
        self.atraso_de_visibilidade = datetime.timedelta(0)
        self._retries: dict[str, str] = {}

    def _registrar(self, nome: str, **argumentos) -> None:
        self.chamadas.append((nome, argumentos))

    def _checar_lotacao(self) -> None:
        if self._lotado is not None:
            retry_after, self._lotado = self._lotado, None
            raise MotorOcupado(retry_after)

    def _falhar_antes(self) -> None:
        if self._falha_de_despacho and self._falha_de_despacho[0] == "antes" and self._falha_de_despacho[1] > 0:
            modo, vezes = self._falha_de_despacho
            self._falha_de_despacho = (modo, vezes - 1)
            raise FalhaAntesDoEnvio("POST /x: falha de rede (ConnectionRefusedError)")

    def _falhar_depois(self) -> None:
        if self._falha_de_despacho and self._falha_de_despacho[0] == "incerta" and self._falha_de_despacho[1] > 0:
            modo, vezes = self._falha_de_despacho
            self._falha_de_despacho = (modo, vezes - 1)
            raise FalhaIncerta("POST /x: falha de rede (TimeoutError)")

    def _novo_id(self, prefixo: str) -> str:
        self._contador += 1
        return "%s-%d" % (prefixo, self._contador)

    # Auxiliares de teste

    def falhar_despacho(self, modo: str, vezes: int = 1) -> None:
        """Os próximos `vezes` despachos falham na rede: `antes` (nada é criado) ou `incerta` (cria e falha)."""
        if modo not in ("antes", "incerta"):
            raise ValueError("modo inválido")
        self._falha_de_despacho = (modo, vezes)

    def lotar(self, retry_after: int = 30) -> None:
        """A próxima chamada de despacho levanta `MotorOcupado`."""
        self._lotado = retry_after

    def enfileirar(self, ativo: bool = True) -> None:
        """Com `ativo`, os próximos runs nascem `queued` (started_at NULL) até `iniciar_run`."""
        self._fila = bool(ativo)

    def iniciar_run(self, run_id: str) -> None:
        """O run sai da fila: ganha `startedAt` e passa a `running`."""
        momento = self._momentos.get(run_id)
        if momento is None:
            raise KeyError("run desconhecido: %r" % run_id)
        if momento["iniciadoEm"] is None:
            momento["iniciadoEm"] = self.agora()
        if self._runs.get(run_id, {}).get("estado") == "queued":
            self._runs[run_id]["estado"] = "running"

    def iniciar_historico(self, quantidade: int, *, projeto: str, ha=datetime.timedelta(0), na_fila: bool = False) -> None:
        """`quantidade` runs alheios do projeto já iniciados há `ha` (antes dos nossos na ordem DESC); com `na_fila`,
        runs alheios ainda `queued` (started_at NULL), com ids `fila-…`, que vêm antes dos nossos `run-…` no id ASC."""
        base = self.agora() - ha
        for i in range(quantidade):
            momento = base + datetime.timedelta(milliseconds=i)
            ident = ("fila-%04d" if na_fila else "hist-%04d") % (len(self._momentos) + 1)
            self._momentos[ident] = {
                "projeto": projeto,
                "prompt": "run alheio %d" % i,
                "criadoEm": base,
                "iniciadoEm": None if na_fila else momento,
                "retryOf": None,
            }
            self._runs[ident] = {"estado": "queued" if na_fila else "running", "motivoFalha": None, "prUrl": None, "custoUsd": 0.0}

    def _listar_runs(self, projeto: str, direcao: str, limite: int, offset: int) -> list[dict]:
        """Uma página de GET /runs?project=&sort=started&dir=: ORDER BY started_at <dir>, id ASC, NULL por dialeto."""
        if self.dialeto not in _DIALETOS:
            raise ValueError("dialeto desconhecido: %r" % (self.dialeto,))
        desc = direcao == "desc"

        def chave(par):
            ident, momento = par
            inicio = momento["iniciadoEm"]
            # SQLite: NULL é o menor valor (ASC primeiro, DESC último); Postgres: NULL é o maior (o contrário)
            nulo_no_fim = (desc and self.dialeto == "sqlite") or (not desc and self.dialeto == "postgres")
            grupo = (1 if nulo_no_fim else 0) if inicio is None else (0 if nulo_no_fim else 1)
            tempo = inicio.timestamp() if inicio is not None else 0.0
            return (grupo, -tempo if desc else tempo, ident)

        agora = self.agora()
        pares = sorted(
            (
                p
                for p in self._momentos.items()
                if p[1]["projeto"] == projeto and p[1]["criadoEm"] + self.atraso_de_visibilidade <= agora
            ),
            key=chave,
        )
        return [
            {
                "id": ident,
                "prompt": momento["prompt"],
                "startedAt": momento["iniciadoEm"].strftime("%Y-%m-%dT%H:%M:%S.%fZ") if momento["iniciadoEm"] else None,
                "state": self._runs.get(ident, {}).get("estado"),
                "failureReason": self._runs.get(ident, {}).get("motivoFalha"),
                "retryOf": momento.get("retryOf"),
            }
            for ident, momento in pares[offset : offset + limite]
        ]

    def retry_de(self, run_id: str) -> str | None:
        """O id do retry automático que o Warren falso criou para `run_id`, se houver."""
        return self._retries.get(run_id)

    def _retry_automatico(self, run_id: str) -> None:
        """infra-lost-retry.ts: run direto, failed por infra perdida, que não é retry nem já tem um: ganha UM retry."""
        run = self._runs.get(run_id) or {}
        momento = self._momentos.get(run_id)
        if (
            not self.retry_infra_perdida
            or momento is None
            or run.get("estado") != "failed"
            or run.get("motivoFalha") not in MOTIVOS_INFRA_PERDIDA
            or momento.get("retryOf") is not None
            or run_id in self._retries
        ):
            return
        novo = self._novo_id("run")
        agora = self.agora()
        self._runs[novo] = {"estado": "queued" if self._fila else "running", "motivoFalha": None, "prUrl": None, "custoUsd": 0.0}
        self._textos_enviados[novo] = (momento["projeto"], momento["prompt"])
        self._momentos[novo] = {
            "projeto": momento["projeto"],
            "prompt": momento["prompt"],
            "criadoEm": agora,
            "iniciadoEm": None if self._fila else agora,
            "retryOf": run_id,
        }
        self._retries[run_id] = novo

    def definir_plano(self, plan_run_id: str, estado: str, filhos: list[dict], falha: str | None = None) -> None:
        self._planos[plan_run_id] = {
            "estado": estado,
            "falha": falha,
            "filhos": [
                {
                    "seedId": filho["seedId"],
                    "estado": filho["estado"],
                    "runId": filho.get("runId"),
                    "prUrl": filho.get("prUrl"),
                    "falha": filho.get("falha"),
                }
                for filho in filhos
            ],
        }

    def definir_run(self, run_id: str, **campos) -> None:
        desconhecidos = sorted(set(campos) - set(_CAMPOS_RUN))
        if desconhecidos:
            raise ValueError("campos de run desconhecidos: %s" % ", ".join(desconhecidos))
        atual = self._runs.setdefault(
            run_id, {"estado": "running", "motivoFalha": None, "prUrl": None, "custoUsd": 0.0}
        )
        atual.update(campos)
        self._retry_automatico(run_id)

    def definir_texto(self, run_id: str, texto: str) -> None:
        self._textos[run_id] = texto

    def definir_modelo_efetivo(self, run_id: str, modelo: str) -> None:
        self._modelos[run_id] = modelo

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
        self._registrar(
            "despachar_plano",
            projeto=projeto,
            plano_seeds=plano_seeds,
            agente=agente,
            modelo=modelo,
            prompt_template=prompt_template,
            max_custo_usd=max_custo_usd,
        )
        self._checar_lotacao()
        self._falhar_antes()
        plan_run_id = self._novo_id("plano")
        self.definir_plano(plan_run_id, "running", [])
        self._textos_enviados[plan_run_id] = (projeto, prompt_template)
        self._falhar_depois()
        return plan_run_id

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
        self._registrar(
            "despachar_run",
            projeto=projeto,
            agente=agente,
            modelo=modelo,
            prompt=prompt,
            branch_existente=branch_existente,
            max_custo_usd=max_custo_usd,
            chave_idempotencia=chave_idempotencia,
        )
        if chave_idempotencia is not None:
            validar_nonce(chave_idempotencia)
        self._checar_lotacao()
        self._falhar_antes()
        agora = self.agora()
        entrada = self._idempotencia.get((projeto, chave_idempotencia)) if chave_idempotencia else None
        if entrada is not None and entrada[0] > agora:
            # chave repetida dentro da janela: o Warren devolve o 201 guardado, sem criar nada
            run_id = entrada[1]
        else:
            run_id = self._novo_id("run")
            self.definir_run(run_id, estado="queued" if self._fila else "running")
            self._textos_enviados[run_id] = (projeto, prompt)
            self._momentos[run_id] = {"projeto": projeto, "prompt": prompt, "criadoEm": agora, "iniciadoEm": None if self._fila else agora, "retryOf": None}
            if chave_idempotencia:
                self._idempotencia[(projeto, chave_idempotencia)] = (agora + JANELA_IDEMPOTENCIA, run_id)
        self._falhar_depois()
        return run_id

    def plano(self, plan_run_id: str) -> dict:
        self._registrar("plano", plan_run_id=plan_run_id)
        if plan_run_id not in self._planos:
            raise KeyError("plano desconhecido: %r" % plan_run_id)
        return copy.deepcopy(self._planos[plan_run_id])

    def run(self, run_id: str) -> dict:
        self._registrar("run", run_id=run_id)
        if run_id not in self._runs:
            raise KeyError("run desconhecido: %r" % run_id)
        return copy.deepcopy(self._runs[run_id])

    def ultimo_texto(self, run_id: str) -> str:
        self._registrar("ultimo_texto", run_id=run_id)
        return self._textos.get(run_id, "")

    def retomar_plano(self, plan_run_id: str) -> None:
        self._registrar("retomar_plano", plan_run_id=plan_run_id)

    def modelo_efetivo(self, run_id: str) -> str | None:
        self._registrar("modelo_efetivo", run_id=run_id)
        return self._modelos.get(run_id)

    def cancelar_plano(self, plan_run_id: str) -> None:
        self._registrar("cancelar_plano", plan_run_id=plan_run_id)
        if plan_run_id not in self._planos:
            raise KeyError("plano desconhecido: %r" % plan_run_id)
        self._planos[plan_run_id]["estado"] = "cancelled"

    def _procurar(self, nome: str, projeto: str, nonce, prefixo: str) -> str | None:
        self._registrar(nome, projeto=projeto, nonce=nonce)
        marcas = marcas_de_nonce(nonce)
        for ident, (proj, texto) in self._textos_enviados.items():
            if ident.startswith(prefixo) and proj == projeto and any(m in texto for m in marcas):
                return ident
        return None

    def procurar_run(self, projeto: str, nonce: str, desde: str | None = None) -> str | None:
        self._registrar("procurar_run", projeto=projeto, nonce=nonce, desde=desde)
        return procurar_nonce(lambda direcao, limite, offset: self._listar_runs(projeto, direcao, limite, offset), "prompt", nonce, desde)

    def procurar_plano(self, projeto: str, nonce: str) -> str | None:
        return self._procurar("procurar_plano", projeto, nonce, "plano-")

    def visao_geral(self) -> dict:
        self._registrar("visao_geral")
        ativos = sum(1 for run in self._runs.values() if run.get("estado") in _NAO_TERMINAIS_DE_RUN)
        return {"runs": {"nonTerminal": ativos, "total": len(self._runs)}, "services": {"dbReachable": True}}

    def versao(self) -> str:
        self._registrar("versao")
        return "0.19.3"

    def procurar_retry(self, projeto: str, run_id: str, nonces: list, desde: str | None = None) -> str | None:
        self._registrar("procurar_retry", projeto=projeto, run_id=run_id, nonces=nonces, desde=desde)
        if not isinstance(run_id, str) or not run_id:
            raise ValueError("run_id inválido")
        return procurar_nonce(
            lambda direcao, limite, offset: self._listar_runs(projeto, direcao, limite, offset),
            "prompt",
            list(nonces) or ["0" * 32],
            desde,
            retry_of=run_id,
            excluir=(run_id,),
        )
