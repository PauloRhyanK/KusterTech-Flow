"""Interface do motor de execução (Warren) e o motor falso em memória."""

import copy
import typing

_CAMPOS_RUN = ("estado", "motivoFalha", "prUrl", "custoUsd")


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


class MotorFalso:
    """Motor em memória para testar o despachante sem rede."""

    def __init__(self):
        self.chamadas: list[tuple[str, dict]] = []
        self._planos: dict[str, dict] = {}
        self._runs: dict[str, dict] = {}
        self._textos: dict[str, str] = {}
        self._lotado: int | None = None
        self._contador = 0

    def _registrar(self, nome: str, **argumentos) -> None:
        self.chamadas.append((nome, argumentos))

    def _checar_lotacao(self) -> None:
        if self._lotado is not None:
            retry_after, self._lotado = self._lotado, None
            raise MotorOcupado(retry_after)

    def _novo_id(self, prefixo: str) -> str:
        self._contador += 1
        return "%s-%d" % (prefixo, self._contador)

    # Auxiliares de teste

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
        plan_run_id = self._novo_id("plano")
        self.definir_plano(plan_run_id, "running", [])
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
        run_id = self._novo_id("run")
        self.definir_run(run_id)
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
