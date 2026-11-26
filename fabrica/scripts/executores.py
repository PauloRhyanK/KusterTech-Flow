"""Lista ordenada de executores (agente, modelo, conta) por papel: valida, normaliza e escolhe. Módulo puro."""

import datetime

CONTA_PADRAO = "claude-principal"
AGENTES = ("claude-code", "codex", "antigravity")


def _texto(valor) -> bool:
    return isinstance(valor, str) and bool(valor.strip())


def normalizar_item(item, campo: str) -> dict:
    """Valida um executor `{agente, modelo, conta?}`; `ValueError` nomeia `campo` e o campo inválido."""
    if not isinstance(item, dict):
        raise ValueError(campo)
    if item.get("agente") not in AGENTES:
        raise ValueError(campo + ".agente")
    if not _texto(item.get("modelo")):
        raise ValueError(campo + ".modelo")
    conta = item.get("conta", CONTA_PADRAO)
    if not _texto(conta):
        raise ValueError(campo + ".conta")
    return {"agente": item["agente"], "modelo": item["modelo"], "conta": conta}


def normalizar(entrada: dict, papel: str) -> list[dict]:
    """Lista de executores de `modelos.<papel>`; o formato antigo `{agente, modelo}` vira lista de um item."""
    base = "modelos.%s.executores" % papel
    if not isinstance(entrada, dict):
        raise ValueError("modelos.%s" % papel)
    if "executores" in entrada:
        brutos = entrada["executores"]
        if not isinstance(brutos, list) or not brutos:
            raise ValueError(base)
    else:
        brutos = [{"agente": entrada.get("agente"), "modelo": entrada.get("modelo")}]
    itens = []
    vistos = set()
    for i, bruto in enumerate(brutos):
        campo = "%s[%d]" % (base, i)
        item = normalizar_item(bruto, campo)
        chave = (item["agente"], item["modelo"], item["conta"])
        if chave in vistos:
            raise ValueError(campo)
        vistos.add(chave)
        itens.append(item)
    return itens


def escolher(lista: list[dict], indisponiveis: set[tuple[str, str]]) -> dict | None:
    """Primeiro item cujo par (agente, conta) não está em `indisponiveis`, ou `None`."""
    return next((i for i in lista if (i["agente"], i["conta"]) not in indisponiveis), None)


def proximo_retorno(lista: list[dict], dados: dict, agora: datetime.datetime) -> datetime.datetime | None:
    """Menor `ate` ainda no futuro entre os itens da lista em `dados` (`{"<agente>|<conta>": {"ate": iso}}`)."""
    retornos = []
    for item in lista:
        marca = dados.get("%s|%s" % (item["agente"], item["conta"]))
        try:
            ate = datetime.datetime.fromisoformat(marca["ate"])
        except (TypeError, KeyError, ValueError):
            continue
        if ate.tzinfo is None:
            ate = ate.replace(tzinfo=datetime.timezone.utc)
        if ate > agora:
            retornos.append(ate)
    return min(retornos, default=None)
