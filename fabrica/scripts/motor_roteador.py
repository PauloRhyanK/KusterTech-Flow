"""Roteador de motores por conta: cada conta é uma instância do Warren, atrás do mesmo Protocol Motor."""

import json

from executores import CONTA_PADRAO
from motor import RecusaDoMotor

SEPARADOR = ":"


class ContaIndisponivel(RecusaDoMotor):
    """A conta não tem motor, ou o projeto não existe na instância dela: nada foi criado."""


class MotorRoteador:
    def __init__(self, motores: dict, padrao: str = CONTA_PADRAO):
        if padrao not in motores:
            raise ValueError("a conta padrão precisa de motor")
        self._motores = dict(motores)
        self._padrao = padrao
        self._git_urls: dict[str, str | None] = {}
        self._projetos_por_conta: dict[tuple[str, str], str] = {}

    def contas(self) -> list[str]:
        return [self._padrao] + [c for c in self._motores if c != self._padrao]

    def _motor(self, conta: str):
        motor = self._motores.get(conta)
        if motor is None:
            raise ContaIndisponivel("conta sem motor: %s" % conta)
        return motor

    def _separar(self, ident: str) -> tuple[str, str]:
        """Conta e id original; um id sem prefixo (inclusive os anteriores ao roteador) é da conta padrão."""
        conta, sep, resto = ident.partition(SEPARADOR)
        if not sep:
            return self._padrao, ident
        if conta not in self._motores:
            raise ContaIndisponivel("conta sem motor: %s" % conta)
        return conta, resto

    def _com_prefixo(self, conta: str, ident):
        if conta == self._padrao or not isinstance(ident, str):
            return ident
        return conta + SEPARADOR + ident

    def _projeto(self, projeto: str, conta: str) -> str:
        """O id do projeto na instância da conta: o recebido vale para a padrão; nas outras, o par pelo gitUrl."""
        if conta == self._padrao:
            return projeto
        chave = (conta, projeto)
        if chave in self._projetos_por_conta:
            return self._projetos_por_conta[chave]
        if projeto not in self._git_urls:
            self._git_urls[projeto] = next(
                (p.get("gitUrl") for p in self._motores[self._padrao].projetos() if p.get("id") == projeto), None
            )
        git_url = self._git_urls[projeto]
        par = None
        if git_url:
            par = next((p.get("id") for p in self._motor(conta).projetos() if p.get("gitUrl") == git_url), None)
        if not par:
            raise ContaIndisponivel("projeto sem par na conta %s" % conta)
        self._projetos_por_conta[chave] = par
        return par

    def despachar_plano(self, *, projeto, conta=None, **resto) -> str:
        conta = conta or self._padrao
        motor = self._motor(conta)
        ident = motor.despachar_plano(projeto=self._projeto(projeto, conta), conta=conta, **resto)
        return self._com_prefixo(conta, ident)

    def despachar_run(self, *, projeto, conta=None, **resto) -> str:
        conta = conta or self._padrao
        motor = self._motor(conta)
        ident = motor.despachar_run(projeto=self._projeto(projeto, conta), conta=conta, **resto)
        return self._com_prefixo(conta, ident)

    def _ler(self, nome: str, ident: str):
        conta, original = self._separar(ident)
        return getattr(self._motor(conta), nome)(original)

    def plano(self, plan_run_id: str) -> dict:
        return self._ler("plano", plan_run_id)

    def run(self, run_id: str) -> dict:
        return self._ler("run", run_id)

    def ultimo_texto(self, run_id: str) -> str:
        return self._ler("ultimo_texto", run_id)

    def eventos_brutos(self, run_id: str) -> bytes:
        return self._ler("eventos_brutos", run_id)

    def retomar_plano(self, plan_run_id: str) -> None:
        return self._ler("retomar_plano", plan_run_id)

    def modelo_efetivo(self, run_id: str) -> str | None:
        return self._ler("modelo_efetivo", run_id)

    def cancelar_plano(self, plan_run_id: str) -> None:
        return self._ler("cancelar_plano", plan_run_id)

    def _em_todas(self, projeto: str):
        """(conta, motor, projeto na conta) das contas onde o projeto existe; as sem par ficam de fora (Review Focus 3)."""
        for conta in self.contas():
            try:
                yield conta, self._motor(conta), self._projeto(projeto, conta)
            except ContaIndisponivel:
                continue

    def _procurar(self, nome: str, projeto: str, *argumentos, **nomeados):
        for conta, motor, local in self._em_todas(projeto):
            achado = getattr(motor, nome)(local, *argumentos, **nomeados)
            if achado is not None:
                return self._com_prefixo(conta, achado)
        return None

    def procurar_run(self, projeto: str, nonce: str, desde: str | None = None) -> str | None:
        return self._procurar("procurar_run", projeto, nonce, desde)

    def procurar_plano(self, projeto: str, nonce: str) -> str | None:
        return self._procurar("procurar_plano", projeto, nonce)

    def planos_do_projeto(self, projeto: str) -> list[dict]:
        planos = []
        for conta, motor, local in self._em_todas(projeto):
            for plano in motor.planos_do_projeto(local):
                planos.append({**plano, "id": self._com_prefixo(conta, plano.get("id"))})
        return planos

    def procurar_retry(self, projeto: str, run_id: str, nonces: list, desde: str | None = None) -> str | None:
        conta, original = self._separar(run_id)
        local = self._projeto(projeto, conta)
        achado = self._motor(conta).procurar_retry(local, original, nonces, desde)
        return self._com_prefixo(conta, achado)

    def visao_geral(self) -> dict:
        return self._motores[self._padrao].visao_geral()

    def versao(self) -> str:
        return self._motores[self._padrao].versao()

    def atualizar_projeto(self, projeto: str) -> None:
        return self._motores[self._padrao].atualizar_projeto(projeto)

    def projetos(self) -> list[dict]:
        return self._motores[self._padrao].projetos()


def _texto(valor) -> bool:
    return isinstance(valor, str) and bool(valor.strip())


def do_ambiente(ambiente, motor_padrao, ler_token):
    """A única fábrica de roteador: `(MotorRoteador, tokens)`.

    Sem `FABRICA_CONTAS_FILE`, só a conta padrão (o `motor_padrao` já construído). Com ele, um JSON
    `{"<conta>": {"api": url, "tokenFile": caminho}}` dá uma instância do Warren por conta; `tokens` leva o de
    todas as contas, para o chamador redigi-los. `ValueError` descreve um arquivo inválido, sem o conteúdo dele.
    """
    import motor_warren

    padrao_token = ler_token(ambiente.get("WARREN_TOKEN_FILE") or "~/.warren-token")
    tokens = [padrao_token]
    motores = {CONTA_PADRAO: motor_padrao}
    caminho = ambiente.get("FABRICA_CONTAS_FILE")
    if caminho:
        try:
            with open(caminho, encoding="utf-8") as arquivo:
                contas = json.load(arquivo)
        except (OSError, ValueError) as erro:
            raise ValueError("FABRICA_CONTAS_FILE ilegível (%s)" % type(erro).__name__) from None
        if not isinstance(contas, dict):
            raise ValueError("FABRICA_CONTAS_FILE: esperado um objeto {conta: {api, tokenFile}}")
        for conta, dados in contas.items():
            if not _texto(conta) or SEPARADOR in conta:
                raise ValueError("FABRICA_CONTAS_FILE: nome de conta inválido")
            if not isinstance(dados, dict) or not _texto(dados.get("api")) or not _texto(dados.get("tokenFile")):
                raise ValueError("FABRICA_CONTAS_FILE: conta %s precisa de api e tokenFile" % conta)
            token = ler_token(dados["tokenFile"])
            if conta == CONTA_PADRAO:
                continue  # a padrão já é o motor_padrao
            tokens.append(token)
            motores[conta] = motor_warren.MotorWarren(dados["api"], token)
    return MotorRoteador(motores), tokens
