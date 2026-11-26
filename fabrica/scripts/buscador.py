"""O buscador de demandas com IA no lado da Fábrica (só stdlib): uma busca por vez, duas chamadas ao CLI.

O Flow guarda a busca (pergunta + lote); o coordenador chama `passo` a cada `INTERVALO_DO_BUSCADOR_S`:

1. pega a busca pendente (`GET /api/fabrica/buscas`), com uma ficha curta de cada demanda do lote;
2. etapa 1: o modelo lê as fichas e escolhe até 10 candidatas (ou explica que nenhuma trata do pedido);
3. etapa 2: lê o texto completo só das candidatas e diz quais tratam do pedido, com relevância e motivo;
4. responde (`POST .../respostas`) com o resumo, os itens, o modelo, os tokens e o custo somados.

O CLI roda sem ferramentas, sem sessão gravada, sem MCP e com `--max-budget-usd`; cada chamada tem teto de
`TETO_DA_CHAMADA_S`. Toda falha vira `{id, falha}` para o Flow, com o custo já gasto. O corpo pronto (com o `id`
uuid4) fica em `estado["buscador"]["atual"]` antes do `POST`: se o envio falhar, o passo seguinte reenvia o mesmo
`id`, e o Flow reconhece a repetição. Spec: docs/superpowers/specs/2026-11-26-demandas-busca-com-ia-design.md.
"""

import datetime
import json
import pathlib
import shutil
import subprocess
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import despachante  # noqa: E402
from retrato import FORMATO_INSTANTE, FalhaDeEnvio  # noqa: E402

PAPEL = "buscador"
INTERVALO_DO_BUSCADOR_S = 10
TETO_DA_CHAMADA_S = 60
REVER_FLOW_SEM_BUSCAS_S = 3600
LIMITE_DO_RESUMO = 1500
LIMITE_DO_MOTIVO = 600
LIMITE_DA_FALHA = 200
AVISO_SEM_MODELO = "Buscador: configure modelos.buscador (agente, modelo, maxCustoUsd)."
FORA_DO_FORMATO = "resposta do modelo fora do formato"

SISTEMA = (
    "Você ajuda o Paulo a achar demandas de software já registradas. Responda só com o JSON pedido, em "
    "português do Brasil. Use apenas os ids fornecidos; nunca invente um id."
)

SCHEMA_DA_ETAPA_1 = {
    "type": "object",
    "properties": {
        "candidatas": {"type": "array", "items": {"type": "string"}, "maxItems": 10},
        "resumo": {"type": "string"},
    },
    "required": ["candidatas", "resumo"],
    "additionalProperties": False,
}

SCHEMA_DA_ETAPA_2 = {
    "type": "object",
    "properties": {
        "resumo": {"type": "string"},
        "itens": {
            "type": "array",
            "maxItems": 10,
            "items": {
                "type": "object",
                "properties": {
                    "demandaId": {"type": "string"},
                    "relevancia": {"enum": ["alta", "media", "baixa"]},
                    "motivo": {"type": "string"},
                },
                "required": ["demandaId", "relevancia", "motivo"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["resumo", "itens"],
    "additionalProperties": False,
}


class FalhaDaChamada(Exception):
    """A chamada ao modelo falhou; o texto é curto e vai para o Flow como `falha`."""


def _binario_padrao() -> str:
    return shutil.which("claude") or str(pathlib.Path.home() / ".local" / "bin" / "claude")


def _inteiro(v) -> int:
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else 0


def rodar_claude(prompt, schema, *, modelo, max_custo_usd, timeout_s=TETO_DA_CHAMADA_S, binario=None, executar=subprocess.run):
    """Uma chamada ao CLI `claude -p` com saída estruturada. Devolve a saída, o custo e os tokens."""
    argv = [
        binario or _binario_padrao(),
        "-p",
        "--model",
        modelo,
        "--output-format",
        "json",
        "--json-schema",
        json.dumps(schema),
        "--tools",
        "",
        "--no-session-persistence",
        "--max-budget-usd",
        str(max_custo_usd),
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--system-prompt",
        SISTEMA,
    ]
    try:
        feito = executar(argv, input=prompt, capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        raise FalhaDaChamada("passou de %d s" % timeout_s) from None
    except (FileNotFoundError, PermissionError):
        raise FalhaDaChamada("CLI claude não encontrado") from None
    try:
        dados = json.loads(feito.stdout)
    except (ValueError, TypeError):
        raise FalhaDaChamada("resposta ilegível") from None
    if not isinstance(dados, dict):
        raise FalhaDaChamada("resposta ilegível")
    if dados.get("is_error"):
        motivo = dados.get("result")
        raise FalhaDaChamada((motivo.strip() if isinstance(motivo, str) and motivo.strip() else "erro do CLI")[:LIMITE_DA_FALHA])
    saida = dados.get("structured_output")
    if not isinstance(saida, dict):
        raise FalhaDaChamada("sem saída estruturada")
    uso = dados.get("usage") if isinstance(dados.get("usage"), dict) else {}
    custo = dados.get("total_cost_usd")
    return {
        "saida": saida,
        "custoUsd": float(custo) if isinstance(custo, (int, float)) and not isinstance(custo, bool) and custo >= 0 else 0.0,
        "tokensEntrada": sum(_inteiro(uso.get(k)) for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")),
        "tokensSaida": _inteiro(uso.get("output_tokens")),
    }


def _modelo(modelos):
    try:
        return despachante._validar_modelo(despachante._dict(modelos).get(PAPEL), PAPEL)
    except Exception:  # noqa: BLE001 - sem modelo, as buscas esperam com um aviso
        return None


def _texto(v, limite):
    return v.strip()[:limite] if isinstance(v, str) and v.strip() else None


def _prompt_da_etapa_1(busca):
    fichas = json.dumps(busca["fichas"], ensure_ascii=False, separators=(",", ":"))
    return (
        "Pedido do Paulo: %s\n\n"
        "Abaixo, uma ficha por demanda (JSON). Escolha até %d demandas que tratam do pedido, no todo ou em parte, "
        "da mais para a menos relevante, e ponha os ids em `candidatas`. O Paulo quer saber também o que já cobre "
        "só um pedaço do pedido: inclua toda demanda que faça parte do caminho (mesmo canal, mesma tela, mesmo "
        "fluxo ou a mesma peça que o pedido precisaria). Na dúvida, inclua: a etapa seguinte confere o texto "
        "completo. Só deixe `candidatas` vazia se nenhuma ficha tiver relação; aí explique em `resumo`, em uma ou "
        "duas frases, citando títulos e nunca ids.\n\nFichas:\n%s"
    ) % (busca["pergunta"], busca["candidatas"], fichas)


def _prompt_da_etapa_2(busca, textos):
    blocos = "\n\n".join("### %s — %s\n%s" % (t["id"], t["titulo"], t["texto"]) for t in textos)
    return (
        "Pedido do Paulo: %s\n\nTexto completo das demandas candidatas:\n\n%s\n\n"
        "Para cada candidata que de fato trata do pedido, devolva em `itens` o id (`demandaId`), a relevância "
        "(alta: resolve o pedido; media: cobre parte dele; baixa: só uma peça ou a mesma área) e o motivo em uma "
        "frase, dizendo que parte do pedido ela cobre. Em `resumo`, responda em até três frases, citando títulos e "
        "nunca ids: já existe algo assim? o que já está coberto e por qual demanda? o que ainda falta?"
    ) % (busca["pergunta"], blocos)


def _candidatas(saida, busca):
    lista = saida.get("candidatas")
    if not isinstance(lista, list):
        raise FalhaDaChamada(FORA_DO_FORMATO)
    do_lote = {f["id"] for f in busca["fichas"]}
    escolhidas = []
    for i in lista:
        if isinstance(i, str) and i in do_lote and i not in escolhidas:
            escolhidas.append(i)
    return escolhidas[: busca["candidatas"]]


def _itens(saida, candidatas):
    lista = saida.get("itens")
    if not isinstance(lista, list):
        raise FalhaDaChamada(FORA_DO_FORMATO)
    itens, vistos = [], set()
    for i in lista:
        if not isinstance(i, dict):
            continue
        demanda, motivo = i.get("demandaId"), _texto(i.get("motivo"), LIMITE_DO_MOTIVO)
        if demanda in candidatas and demanda not in vistos and i.get("relevancia") in ("alta", "media", "baixa") and motivo:
            vistos.add(demanda)
            itens.append({"demandaId": demanda, "relevancia": i["relevancia"], "motivo": motivo})
    return itens


def _executar_busca(busca, cliente, modelo, chamar):
    """As duas etapas. Devolve o corpo do `POST` (resposta ou falha), sempre com o gasto somado."""
    gasto = {"modelo": modelo["modelo"], "tokensEntrada": 0, "tokensSaida": 0, "custoUsd": 0.0}

    def uma(prompt, schema):
        r = chamar(prompt, schema, modelo=modelo["modelo"], max_custo_usd=modelo["maxCustoUsd"])
        gasto["tokensEntrada"] += r["tokensEntrada"]
        gasto["tokensSaida"] += r["tokensSaida"]
        gasto["custoUsd"] = round(gasto["custoUsd"] + r["custoUsd"], 6)
        return r["saida"]

    corpo = {"id": str(uuid.uuid4())}
    try:
        primeira = uma(_prompt_da_etapa_1(busca), SCHEMA_DA_ETAPA_1)
        candidatas = _candidatas(primeira, busca)
        if not candidatas:
            resumo = _texto(primeira.get("resumo"), LIMITE_DO_RESUMO) or "Nenhuma demanda trata disso."
            return dict(corpo, resumo=resumo, itens=[], **gasto)
        textos = cliente.textos(busca["id"], candidatas)
        segunda = uma(_prompt_da_etapa_2(busca, textos), SCHEMA_DA_ETAPA_2)
        itens = _itens(segunda, candidatas)
        resumo = _texto(segunda.get("resumo"), LIMITE_DO_RESUMO) or "Encontrei %d demandas relacionadas." % len(itens)
        return dict(corpo, resumo=resumo, itens=itens, **gasto)
    except FalhaDaChamada as exc:
        return dict(corpo, falha=(str(exc) or "falha do modelo")[:LIMITE_DA_FALHA], **gasto)
    except FalhaDeEnvio as exc:
        return dict(corpo, falha=("o Flow não entregou os textos: %s" % exc)[:LIMITE_DA_FALHA], **gasto)


def _instante(valor):
    try:
        return datetime.datetime.strptime(valor, FORMATO_INSTANTE).replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


def _enviar(secao, cliente, salvar):
    atual = secao["atual"]
    try:
        resultado = cliente.responder(atual["buscaId"], atual["corpo"])
    except FalhaDeEnvio as exc:
        return [{"evento": "erro", "mensagem": "Buscador: a resposta não chegou ao Flow (%s); tento de novo." % exc}]
    secao["atual"] = None
    salvar()
    return [{"evento": "buscador_respondida", "buscaId": atual["buscaId"], "resultado": resultado}]


def ligado(estado, modelos, agora) -> bool:
    """Vale rodar entre ciclos? Com o modelo configurado e sem o Flow ter dito, na última hora, que não tem a rota."""
    if _modelo(modelos) is None:
        return False
    secao = estado.get("buscador") if isinstance(estado.get("buscador"), dict) else {}
    desde = _instante(secao.get("semRotaEm"))
    return desde is None or (agora - desde).total_seconds() >= REVER_FLOW_SEM_BUSCAS_S


def passo(estado, *, cliente, modelos, agora, salvar, chamar=rodar_claude):
    """Um passo do buscador. Nunca levanta: avisos, erros e respostas viram eventos."""
    secao = estado.get("buscador")
    if not isinstance(secao, dict):
        secao = estado["buscador"] = {"atual": None, "semRotaEm": None}
    secao.setdefault("atual", None)
    secao.setdefault("semRotaEm", None)
    try:
        if isinstance(secao["atual"], dict):
            return _enviar(secao, cliente, salvar)
        modelo = _modelo(modelos)
        if modelo is None:
            return [{"evento": "aviso", "chave": "buscador:modelo", "mensagem": AVISO_SEM_MODELO}]
        desde = _instante(secao["semRotaEm"])
        if desde is not None and (agora - desde).total_seconds() < REVER_FLOW_SEM_BUSCAS_S:
            return []
        busca = cliente.buscar()
        if busca is None:
            secao["semRotaEm"] = agora.strftime(FORMATO_INSTANTE)
            salvar()
            return []
        secao["semRotaEm"] = None
        if not busca:
            return []
        corpo = _executar_busca(busca, cliente, modelo, chamar)
        secao["atual"] = {"buscaId": busca["id"], "corpo": corpo}
        salvar()
        return _enviar(secao, cliente, salvar)
    except Exception as exc:  # noqa: BLE001 - o buscador nunca derruba o ciclo do coordenador
        return [{"evento": "erro", "mensagem": "Buscador: %s" % (str(exc) or type(exc).__name__)[:LIMITE_DA_FALHA]}]
