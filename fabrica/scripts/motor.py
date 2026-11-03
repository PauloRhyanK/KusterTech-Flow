"""Interface do motor de execução (Warren) e o motor falso em memória."""

import copy
import re
import typing

_CAMPOS_RUN = ("estado", "motivoFalha", "prUrl", "custoUsd")
# Marcador do nonce na última linha do texto de um POST pago (prompt ou promptTemplate).
MARCADOR_NONCE = "<!-- fabrica:nonce=%s -->"
_NONCE = re.compile(r"[0-9a-f]{32}")


def validar_nonce(nonce) -> str:
    if not isinstance(nonce, str) or _NONCE.fullmatch(nonce) is None:
        raise ValueError("nonce inválido")
    return nonce


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
    ) -> str:
        """Devolve o `runId`."""
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

    def procurar_run(self, projeto: str, nonce: str) -> str | None:
        """O `runId` cujo prompt tem o marcador do nonce, entre os runs recentes do projeto."""
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
    ) -> str:
        self._registrar(
            "despachar_run",
            projeto=projeto,
            agente=agente,
            modelo=modelo,
            prompt=prompt,
            branch_existente=branch_existente,
            max_custo_usd=max_custo_usd,
        )
        self._checar_lotacao()
        self._falhar_antes()
        run_id = self._novo_id("run")
        self.definir_run(run_id)
        self._textos_enviados[run_id] = (projeto, prompt)
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

    def procurar_run(self, projeto: str, nonce: str) -> str | None:
        return self._procurar("procurar_run", projeto, nonce, "run-")

    def procurar_plano(self, projeto: str, nonce: str) -> str | None:
        return self._procurar("procurar_plano", projeto, nonce, "plano-")
