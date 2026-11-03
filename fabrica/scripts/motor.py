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


def procurar_nonce(listar, campo: str, nonce: str, desde=None):
    """Acha o id do run cujo `campo` leva o marcador do nonce, enxergando os runs ainda na fila.

    `listar(direcao, limite, offset)` devolve uma página de GET /runs na ordem do Warren. DESC traz os iniciados
    mais recentes (e, no Postgres, os queued na frente); a paginação para na primeira página com um run iniciado
    antes de `desde` (a hora da ação, com margem), ou numa única página sem `desde`. ASC traz, no SQLite, os
    queued (NULL) primeiro: para na primeira página que já mostra um run iniciado. Há um teto de páginas.
    """
    marca = MARCADOR_NONCE % validar_nonce(nonce)
    corte = instante(desde) if desde is not None else None
    for direcao in ("desc", "asc"):
        for pagina in range(MAX_PAGINAS_DA_BUSCA):
            itens = listar(direcao, PAGINA_DA_BUSCA, pagina * PAGINA_DA_BUSCA)
            parar = len(itens) < PAGINA_DA_BUSCA
            for item in itens:
                if not isinstance(item, dict):
                    raise RuntimeError("GET /runs: 'runs' tem item que não é objeto")
                texto = item.get(campo)
                if isinstance(texto, str) and marca in texto:
                    ident = item.get("id")
                    if not isinstance(ident, str) or not ident:
                        raise RuntimeError("GET /runs: resposta sem o campo 'runs[].id'")
                    return ident
                inicio = instante_de_run(item.get("startedAt"))
                if inicio is None:
                    continue
                if direcao == "asc" or (corte is not None and inicio < corte):
                    parar = True
            if parar or (direcao == "desc" and corte is None):
                break
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
        """O `runId` cujo prompt tem o marcador do nonce, inclusive na fila; `desde` (ISO) limita a paginação."""
        ...

    def procurar_plano(self, projeto: str, nonce: str) -> str | None:
        """O `planRunId` cujo promptTemplate tem o marcador do nonce, entre os Plan Runs do projeto."""
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

    def iniciar_historico(self, quantidade: int, *, projeto: str, ha=datetime.timedelta(0)) -> None:
        """`quantidade` runs alheios do projeto já iniciados há `ha` (antes dos nossos na ordem DESC)."""
        base = self.agora() - ha
        for i in range(quantidade):
            momento = base + datetime.timedelta(milliseconds=i)
            ident = "hist-%04d" % (len(self._momentos) + 1)
            self._momentos[ident] = {"projeto": projeto, "prompt": "run alheio %d" % i, "criadoEm": momento, "iniciadoEm": momento}
            self._runs[ident] = {"estado": "running", "motivoFalha": None, "prUrl": None, "custoUsd": 0.0}

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

        pares = sorted((p for p in self._momentos.items() if p[1]["projeto"] == projeto), key=chave)
        return [
            {
                "id": ident,
                "prompt": momento["prompt"],
                "startedAt": momento["iniciadoEm"].strftime("%Y-%m-%dT%H:%M:%S.%fZ") if momento["iniciadoEm"] else None,
                "state": self._runs.get(ident, {}).get("estado"),
            }
            for ident, momento in pares[offset : offset + limite]
        ]

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
            self._momentos[run_id] = {"projeto": projeto, "prompt": prompt, "criadoEm": agora, "iniciadoEm": None if self._fila else agora}
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

    def _procurar(self, nome: str, projeto: str, nonce: str, prefixo: str) -> str | None:
        self._registrar(nome, projeto=projeto, nonce=nonce)
        marca = MARCADOR_NONCE % validar_nonce(nonce)
        for ident, (proj, texto) in self._textos_enviados.items():
            if ident.startswith(prefixo) and proj == projeto and marca in texto:
                return ident
        return None

    def procurar_run(self, projeto: str, nonce: str, desde: str | None = None) -> str | None:
        self._registrar("procurar_run", projeto=projeto, nonce=nonce, desde=desde)
        return procurar_nonce(lambda direcao, limite, offset: self._listar_runs(projeto, direcao, limite, offset), "prompt", nonce, desde)

    def procurar_plano(self, projeto: str, nonce: str) -> str | None:
        return self._procurar("procurar_plano", projeto, nonce, "plano-")
