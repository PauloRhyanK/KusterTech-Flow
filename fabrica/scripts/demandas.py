"""Demandas do Flow no lado da Fábrica: estado local, caixa de saída, ordem e a decisão da próxima ação.

O estado vive em `fila-estado.json`, na chave `demandas`:

- `cursor` (o último da busca), `semRotaEm` (quando o Flow respondeu 404 na rota), `itens` (um por demanda) e
  `saida` (o que falta mandar ao Flow, na ordem);
- cada item guarda a `fase` local, a `tentativa`, o run (`runId`, `nonce`, `inicio`), o plano (`prUrl`, `branch`,
  `plano`, `segurado`) e `ultima`, o último retrato da demanda vindo do Flow. A mesma entrega pode chegar de novo
  (o estado de uma demanda pode ser mais novo que o cursor), então nada aqui depende de ver um retrato uma vez só;
- a caixa de saída é gravada antes do envio: o evento já tem o `id` (uuid4 do kit) e o arquivo já está copiado em
  `<raiz>/demandas/<demanda>/<arquivoId>`. Um coordenador reiniciado entre o POST e a marca de enviado reenvia o
  mesmo id e o Flow responde `repetido`.

`proxima_acao` é pura: lê o item e o retrato e devolve o nome da ação; quem age é o `passo` (Tasks 3 a 8).

O `passo` busca as demandas (até `PAGINAS_POR_CICLO` páginas, o `cursor` só avança depois de gravar os itens; o
retrato recém-chegado fica em `recebida` até a decisão, e só então vira `ultima`) e faz a triagem: um run do papel
`produto` (`modelos.produto`), sem vaga de `capacidade.json`. A triagem passa por `despachando` (gravado com o
nonce e o `inicio` antes do POST pago) e `triando` (com `runId`); um coordenador reiniciado em `despachando` acha o
run pelo nonce e, sem ele, repete o POST com a mesma `Idempotency-Key`. O resultado vai para a caixa de saída como
evento `triagem`; resposta fora do formato, run falho e o teto de 30 min viram `triagem_falhou` (spec §9: a
demanda vai para a decisão do Paulo).

O plano (etapa `planejada`) é um run do orquestrador (`modelos.orquestrador`, prompt `nova_spec` com a demanda e a
triagem no contexto) sob a trava de orquestrador do repositório (`capacidade.tomar_orquestrador` com
`demanda:<id>`), sem vaga. `planejando` é gravado com o nonce antes do POST; sem `runId`, o run é achado pelo nonce.
O PR do plano é mergeado pela Fábrica só atrás das guardas (`guardar_merge`), no mesmo head; guarda que falha vira
`travada` para o Paulo (fase `esperando_paulo`; a retomada dele planeja de novo com nonce novo). O PR sem plano cujo
`cobertura.md` marca no cabeçalho `resultado: duplicada` (com `de`) ou `ja_resolvida` trava com o `desfecho` no
evento, e o Flow oferece encerrar em vez de retomar. Toda saída de
`planejando` solta a trava. Em "planejar comigo" nada é despachado (`esperando_sessao`): o plano entregue pela
sessão chega no retrato (`plano.caminho`) e a demanda vai para `plano_no_repo`.

O plano no repositório entra na fila como qualquer outro, mas `aplicar_na_fila` (no `_passo_fila` do coordenador,
entre `fila.enfileirar` e `fila.admitir`) o deixa `segurado` pela demanda até a etapa `desenvolvida`, e marca o
`urgente`. O `passo` acompanha a entrada da fila: `ativo` leva a demanda a `desenvolvendo`; `pausado` vira `travada`
(uma vez, com a pausa do plano) e a volta a `ativo`, `destravada`; `concluido` vira `etapa_concluida` com o marco
`desenvolvida`.

O desenho (etapa `desenho`) é um run do `ux-ui` (`modelos.ux-ui`) com uma vaga (`demanda:<id>`, raia `ux-ui`): um
HTML autocontido em `.fabrica/demandas/<id>/desenho.html`, num PR só com esse arquivo. O HTML do head passa em
`validar_desenho` antes de ir ao Flow (arquivo e `desenho_pronto`, nessa ordem); inválido, o run é refeito uma vez com
o motivo e, na segunda, a demanda fica `travada`. O ajuste pedido refaz no mesmo branch. Aprovado (o Paulo, ou o
nível "vai sozinho" pelo Flow), o PR do desenho é mergeado no head enviado antes de o plano ser solto da fila, e a
demanda volta a `plano_no_repo`. Toda saída de `desenhando` solta a vaga; o run que passou do teto (ou foi superado)
a segura até terminar.

O teste no navegador (etapa `testada`) é um run do `qa` (`modelos.qa`) com uma vaga (`demanda:<id>`, raia `qa`): o
agente sobe o sistema no próprio run (como o README manda), percorre a demanda e abre um PR em rascunho só com
`.fabrica/demandas/<id>/**` (`teste.json` e capturas). `ler_resultado_do_teste` lê o head; com capturas de desktop e
de celular, cada captura e depois o evento `teste` vão à caixa de saída e o PR é fechado sem merge. Sem as duas telas
(ou com o `teste.json` torto), o run é refeito uma vez no mesmo branch e, na segunda, a demanda fica `travada`; o
`nao_subiu` do qa (o projeto não sobe num run) trava com o motivo. Quem decide a correção é o Flow: na primeira falha
volta a etapa para `desenvolvida` e o kit despacha a correção (`frontend`, `modelos.frontend`, a partir do branch
padrão), mergeada atrás das guardas só com CI `verde` e seguida de `etapa_concluida` (`desenvolvida`). Sem CI nenhum,
com `"ciObrigatorioNasSeeds": false` na config do repositório, um run do `revisor` confere o PR no head (o veredito das
seeds, `correcao.revisao`, com a vaga da demanda) e o aprovado mergeia. O reprovado ganha um conserto: um run do
`frontend` no branch do PR, com os achados do revisor (`correcao.conserto`, até 2 por PR em `correcao.consertos`); o
head novo é revisado de novo, e o conserto sem commit conta como rodada. Reprovado depois dos dois consertos, a demanda
trava, e a retomada do Paulo fecha o PR e corrige do zero a partir do branch padrão. Com a config padrão, a demanda
trava para o Paulo revisar e mergear o PR (o merge dele segue sem retomada). Na segunda
falha, o Flow espera o Paulo (`teste_falhou`) e só a retomada dele corrige, com a etapa ainda em `testada`. Cada rodada que falha entra em `rodadas`
(resumo, detalhes e o PR da correção): o teste seguinte confere essas falhas primeiro, a correção as recebe e, da
3ª rodada em diante, roda com o modelo do orquestrador. Nunca há
dois runs da demanda ao mesmo tempo: o run que passou do teto (ou foi superado) segura a vaga até terminar.
"""

import contextlib
import copy
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import capacidade  # noqa: E402
import contratos_externos  # noqa: E402
import despachante  # noqa: E402
import globs  # noqa: E402
import motor as motor_  # noqa: E402
import prompts  # noqa: E402
import publicar  # noqa: E402
import raias  # noqa: E402
import retrato as retrato_  # noqa: E402
from retrato import FORMATO_INSTANTE, FalhaDeEnvio  # noqa: E402

FASES = (
    "nova",
    "despachando",
    "triando",
    "planejando",
    "esperando_sessao",
    "plano_no_repo",
    "desenhando",
    "desenho_enviado",
    "desenvolvendo",
    "testando",
    "corrigindo",
    "esperando_paulo",
    "entregando",
    "encerrada",
)
ACOES = (
    "triar",
    "planejar",
    "esperar_sessao",
    "desenhar",
    "refazer_desenho",
    "mergear_desenho",
    "soltar_plano",
    "acompanhar",
    "testar",
    "corrigir",
    "entregar",
    "encerrar",
    "nada",
    "aguardar_envio",
    "ressincronizar",
)
# como uma demanda termina no Flow: entregue, orientada na triagem, descartada pelo Paulo ("Encerrar demanda") ou
# juntada a outra pela triagem (`juntar`).
# Qualquer `encerrada` não nula (estes ou um valor que o kit não conhece) para a demanda: `proxima_acao` dá
# `encerrar`, os runs em curso viram superados e seguram a vaga até terminar, e o item sai do estado.
ENCERRAMENTOS = ("entregue", "orientada", "descartada", "juntada")
# esperas em que só o Paulo mexe: a Fábrica não faz nada até a espera sair
ESPERAS_DO_PAULO = ("decidir_destino", "aprovar_desenho", "concluir_etapa", "travada", "teste_falhou")
FASES_COM_VAGA = ("desenhando", "testando", "corrigindo")
# o run que não conta mais (passou do teto, foi superado) e ainda segura a vaga da demanda, por fase
RUNS_SUPERADOS = ("desenhoSuperado", "testeSuperado", "correcaoSuperada")

LIMITE_DO_ARQUIVO = 10 * 1024 * 1024  # o mesmo do Flow
# respostas do Flow que reenviar nunca conserta: o item sai da caixa com um aviso, sem esperar a contagem
FALHAS_PERMANENTES = ("HTTP 411", "HTTP 413", "HTTP 415")
# a mesma resposta 4xx (fora de 401, 403, 408 e 429, que se resolvem do lado de cá ou com o tempo) tantas vezes
# seguidas também tira o item; rede, timeout e 5xx nunca tiram
LIMITE_DE_FALHAS_IGUAIS = 5
_HTTP_4XX = re.compile(r"HTTP (4\d\d)")
_4XX_QUE_PASSAM = ("401", "403", "404", "408", "429")
# 404 numa rota da demanda: Flow sem o módulo de demandas (ou a demanda sumiu); nunca descarta, só pausa a saída
FALHA_SEM_ROTA = "HTTP 404"
# a entrega: o pedido de publicação leva a descrição (o título, no máximo) e o `entregue` leva até 20 PRs
LIMITE_DESCRICAO = 200
LIMITE_PRS = 20
# respostas do pedido de publicação que repetir não conserta (as mesmas do coordenador): 404 é Flow sem a fila
# de publicação, 409 e 422 recusa do pedido; o resto (rede, timeout, 5xx) tenta de novo no ciclo seguinte
RECUSAS_DA_PUBLICACAO = (404, 409, 422)
CHAVE_SAIDA_PARADA = "demandas:saida-parada"
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_FEATURE_DA_DEMANDA = re.compile(r"demanda-([0-9a-f]{8})(?:-[a-z0-9]+)*")
_CAMINHO_LOCAL = re.compile(r"demandas/(%s)/(%s)" % (_UUID.pattern, _UUID.pattern))
# o HTML do desenho: `<script`, atributo `on…=` (depois de espaço, aspas ou `/`) e `javascript:`
_SCRIPT_NO_HTML = re.compile(r"<script|[\s\"'/]on[a-z]+\s*=|javascript\s*:", re.IGNORECASE)
# recurso de fora: `src=`/`href=` (e os parentes), `url(` e `@import` apontando para `http:`, `https:` ou `//`
_FORA_DO_HTML = re.compile(
    r"""(?:\b(?:src|href|srcset|action|poster|data|xlink:href)\s*=\s*["']?|url\(\s*["']?|@import\s+(?:url\(\s*)?["']?)\s*(?:https?:|//)""",
    re.IGNORECASE,
)
# o corpo de um `data:…;base64,` (sem `<`, aspas nem parênteses) sai antes da busca: pode terminar em `/on…=` por acaso
# sem espaço na classe: num valor sem aspas, o espaço fecha o atributo (e o que vem depois tem de ser conferido)
_CORPO_BASE64 = re.compile(r";base64,[A-Za-z0-9+/=]*", re.IGNORECASE)


def validar_desenho(dados: bytes) -> str | None:
    """O motivo de o HTML do desenho não ir ao Flow, ou `None` (válido): até 10 MB, UTF-8, sem script, sem recurso de fora.

    O Flow serve o desenho num iframe sem scripts; a conferência aqui é para o kit não mandar o que não abriria igual
    (e para o `ux-ui` refazer com o motivo).
    """
    if not isinstance(dados, (bytes, bytearray)) or len(dados) > LIMITE_DO_ARQUIVO:
        return "maior que 10 MB"
    try:
        texto = bytes(dados).decode("utf-8")
    except UnicodeDecodeError:
        return "não é UTF-8"
    texto = _CORPO_BASE64.sub(";base64,", texto)
    if _SCRIPT_NO_HTML.search(texto):
        return "tem script"
    if _FORA_DO_HTML.search(texto):
        return "carrega recurso de fora"
    return None


def nonce(id_: str, fase: str, tentativa: int) -> str:
    return "demanda:%s:%s:%s" % (id_, fase, tentativa)


def nonce_do_motor(id_: str, fase: str, tentativa: int) -> str:
    """O `nonce` em 32 hex (sha256), o formato que o marcador do prompt e a `Idempotency-Key` do Warren aceitam."""
    return hashlib.sha256(nonce(id_, fase, tentativa).encode("utf-8")).hexdigest()[:32]


def chave(id_: str) -> str:
    return "demanda:%s" % id_


def item_novo() -> dict:
    return {
        "fase": "nova",
        "tentativa": 0,
        "runId": None,
        "nonce": None,
        "inicio": None,
        "prUrl": None,
        "branch": None,
        "plano": None,
        "segurado": False,
        "precisa_ressincronizar": False,
        "ultima": {},
    }


def secao(estado: dict) -> dict:
    """`estado["demandas"]`, criada (ou consertada) com os campos que faltam."""
    sec = estado.get("demandas")
    if not isinstance(sec, dict):
        sec = estado["demandas"] = {}
    sec.setdefault("cursor", None)
    sec.setdefault("semRotaEm", None)
    sec.setdefault("saidaParada", None)
    for nome, tipo in (("itens", dict), ("saida", list)):
        if not isinstance(sec.get(nome), tipo):
            sec[nome] = tipo()
    return sec


def _texto_do_instante(agora) -> str:
    if isinstance(agora, datetime.datetime):
        return agora.astimezone(datetime.timezone.utc).strftime(FORMATO_INSTANTE)
    return agora


def _id_valido(demanda_id) -> str:
    if not isinstance(demanda_id, str) or _UUID.fullmatch(demanda_id) is None:
        raise ValueError("id de demanda inválido")
    return demanda_id


# ---------------------------------------------------------------- ordem e próxima ação


def ordenar(itens: dict) -> list[str]:
    """Os ids na ordem de atendimento: urgente primeiro, depois a mais antiga (`criadaEm` da `ultima`)."""

    def chave_da_ordem(id_):
        it = itens[id_] if isinstance(itens[id_], dict) else {}
        ultima = it.get("ultima") if isinstance(it.get("ultima"), dict) else {}
        criada = ultima.get("criadaEm")
        tem_data = isinstance(criada, str)  # sem `criadaEm` (item torto) vai para o fim
        return (0 if ultima.get("destino") == "urgente" else 1, not tem_data, criada if tem_data else "", id_)

    return sorted(itens, key=chave_da_ordem)


def _retomada_nova(item: dict, demanda: dict) -> bool:
    """Há `retomada` do Paulo depois do início da fase atual (a entrega repetida da mesma retomada não conta)."""
    inicio = item.get("inicio")
    for evento in demanda.get("eventos") or []:
        if isinstance(evento, dict) and evento.get("tipo") == "retomada":
            em = evento.get("em")
            if not isinstance(inicio, str) or (isinstance(em, str) and em > inicio):
                return True
    return False


def _ultimo_ajuste(demanda: dict) -> int:
    """A maior versão do desenho que recebeu pedido de ajuste (0: nenhuma)."""
    versoes = [a.get("versao") for a in demanda.get("ajustes") or [] if isinstance(a, dict)]
    versoes += [
        (e.get("dados") or {}).get("versao")
        for e in demanda.get("eventos") or []
        if isinstance(e, dict) and e.get("tipo") == "ajuste_pedido" and isinstance(e.get("dados"), dict)
    ]
    return max([v for v in versoes if isinstance(v, int) and not isinstance(v, bool)] or [0])


def _passou_do_desenho(demanda: dict) -> bool:
    chaves = [e.get("chave") for e in demanda.get("etapas") or [] if isinstance(e, dict)]
    marcos = [e.get("marco") for e in demanda.get("etapas") or [] if isinstance(e, dict)]
    atual = (demanda.get("etapaAtual") or {}).get("chave")
    if "desenho" not in marcos or atual not in chaves:
        return False
    return chaves.index(atual) > marcos.index("desenho")


def tem_pendente(estado: dict, demanda_id: str) -> bool:
    """Há item da demanda ainda na caixa de saída (o Flow ainda não viu o que o kit já decidiu)."""
    saida = (estado.get("demandas") or {}).get("saida") or []
    return any(isinstance(s, dict) and s.get("demanda") == demanda_id for s in saida)


def proxima_acao(item: dict, demanda: dict, *, pendente: bool = False) -> str:
    """A ação que cabe agora à Fábrica para a demanda (pura: não muda `item` nem `demanda`).

    `item` é o estado local (a `fase`, `segurado`, `inicio`); `demanda` é o retrato do Flow. Um marco que o modelo
    da demanda não tem (sem tela não há `desenho` nem `testada`) nunca aparece em `etapaAtual`, então a fase pula
    sozinha. Enquanto um run da fase anda (`triando`, `planejando`, `desenhando`, `testando`, `corrigindo`,
    `entregando`) a ação é `acompanhar`, para a mesma entrega repetida não despachar de novo.

    `pendente` (de `tem_pendente`): com item da demanda na caixa de saída o retrato está atrasado em relação à
    fase local, e a ação é `aguardar_envio` (nada é despachado). Um item descartado da saída marca
    `precisa_ressincronizar`, e a ação é `ressincronizar`: o `passo` refaz a fase local pelo retrato antes de
    decidir. `item["ultima"]` é o retrato *anterior* a `demanda` (o `passo` só o troca depois de decidir).
    """
    if pendente:
        return "aguardar_envio"
    if item.get("precisa_ressincronizar"):
        return "ressincronizar"
    fase = item.get("fase")
    if demanda.get("encerrada"):
        return "encerrar"
    espera = (demanda.get("espera") or {}).get("tipo")
    marco = (demanda.get("etapaAtual") or {}).get("marco")

    if espera == "teste_falhou":
        return "corrigir" if _retomada_nova(item, demanda) else "nada"
    if espera is None and marco == "testada" and fase == "esperando_paulo" and _retomada_nova(item, demanda):
        # o Flow limpa a espera ao aplicar a retomada: só o retrato anterior diz se era teste falho ou trava
        # (`falhaDoTeste`: o kit viu a segunda falha, ou a retomada dela sem ver a espera)
        anterior = ((item.get("ultima") or {}).get("espera") or {}).get("tipo")
        return "corrigir" if anterior == "teste_falhou" or item.get("falhaDoTeste") else "testar"
    if espera in ESPERAS_DO_PAULO:
        return "nada"
    if fase == "desenho_enviado" and _passou_do_desenho(demanda):
        return "mergear_desenho"

    if marco == "recebida":
        return "triar" if fase == "nova" else "acompanhar"
    if marco == "planejada":
        if espera == "planejar_comigo":
            return "acompanhar" if demanda.get("plano") else "esperar_sessao"
        if fase == "esperando_paulo":
            # o plano travou: só a retomada do Paulo (depois da trava) planeja de novo
            return "planejar" if _retomada_nova(item, demanda) else "nada"
        return "planejar" if fase in ("nova", "triando") else "acompanhar"
    if marco == "desenho" and espera is None:
        plano = demanda.get("plano") or {}
        if plano.get("artefato") and demanda.get("nivel") == "planejar_comigo":
            return "nada"  # o Paulo aprova o artefato
        if fase == "desenhando":
            return "acompanhar"
        versao = (demanda.get("desenho") or {}).get("versao") or 0
        if fase == "esperando_paulo" and item.get("travaDoDesenho"):
            # o desenho travou: só a retomada do Paulo (depois da trava) desenha de novo
            if not _retomada_nova(item, demanda):
                return "nada"
            return "refazer_desenho" if versao else "desenhar"
        if not versao:
            return "desenhar"
        return "refazer_desenho" if _ultimo_ajuste(demanda) >= versao else "nada"
    if marco == "desenvolvida":
        if fase == "testando":
            return "corrigir"  # o teste falhou e o Flow voltou a etapa
        if item.get("segurado"):
            return "soltar_plano"
        return "acompanhar"
    if marco == "testada" and espera is None:
        # a correção depois da segunda falha roda (ou travou) com a etapa ainda em `testada`: nenhum teste junto
        corrigindo = fase == "corrigindo" and (item.get("alvo") == "corrigindo" or item.get("travaDaCorrecao"))
        return "acompanhar" if fase == "testando" or corrigindo else "testar"
    if marco == "entregue":
        return "acompanhar" if fase == "entregando" else "entregar"
    return "nada"  # etapa do Paulo (marco nulo) ou espera que a Fábrica não conhece


# ---------------------------------------------------------------- fila: plano segurado e urgente


def _retrato_atual(it) -> dict:
    """O retrato mais novo do item: o recém-chegado (`recebida`) ou a `ultima`."""
    if not isinstance(it, dict):
        return {}
    for nome in ("recebida", "ultima"):
        if isinstance(it.get(nome), dict) and it[nome]:
            return it[nome]
    return {}


def _chegou_ao_desenvolvimento(demanda: dict) -> bool:
    """A etapa atual é a de marco `desenvolvida` ou uma depois dela. Retrato torto (ou sem o marco): `False`."""
    etapas = [e for e in demanda.get("etapas") or [] if isinstance(e, dict)]
    chaves = [e.get("chave") for e in etapas]
    marcos = [e.get("marco") for e in etapas]
    atual = (demanda.get("etapaAtual") or {}).get("chave") if isinstance(demanda.get("etapaAtual"), dict) else None
    if "desenvolvida" not in marcos or atual not in chaves:
        return False
    return chaves.index(atual) >= marcos.index("desenvolvida")


def _desenho_por_mergear(it) -> bool:
    """O desenho ainda não chegou ao branch padrão (sendo feito, ou enviado e esperando o merge da aprovação)."""
    return isinstance(it, dict) and it.get("fase") in ("desenhando", "desenho_enviado")


def _demanda_da_entrada(entrada: dict, por_caminho: dict, por_prefixo: dict):
    demanda = entrada.get("demanda")
    if isinstance(demanda, str) and _UUID.fullmatch(demanda):
        return demanda
    repo, caminho = entrada.get("repo"), entrada.get("caminho")
    if not isinstance(repo, str) or not isinstance(caminho, str):
        return None
    if (repo.lower(), caminho) in por_caminho:
        return por_caminho[(repo.lower(), caminho)]
    # sem o campo e sem o caminho no retrato (um plano do "planejar comigo"): a feature `demanda-<id8>[-...]`
    feature = entrada.get("feature")
    m = _FEATURE_DA_DEMANDA.fullmatch(feature) if isinstance(feature, str) else None
    return por_prefixo.get((repo.lower(), m.group(1))) if m else None


def aplicar_na_fila(estado_demandas: dict, fila_: list[dict]) -> list[dict]:
    """Uma cópia da fila com o plano de cada demanda segurado até a etapa `desenvolvida` (pura).

    `estado_demandas` é a seção `demandas` do `fila-estado.json`. Só as entradas `aguardando` ligadas a uma demanda
    mudam: pelo campo `demanda` (o uuid, vindo do plano), pelo `caminho` igual ao `plano.caminho` do retrato no
    mesmo repositório ou, sem os dois, pela feature `demanda-<id8>` de uma demanda conhecida do mesmo repositório (a
    ligação fica gravada em `demanda`). Enquanto a etapa atual da demanda está antes de
    `desenvolvida`, `segurado: True` e `seguradoPor: "demanda"`; ao chegar lá (ou depois), `segurado: False`, mas só
    se quem segurou foi a demanda: o segurado pelo Paulo (sem `seguradoPor`) nunca é solto aqui. A demanda que o kit
    não conhece (ou de retrato torto) segura. `urgente` é `destino == "urgente"`.
    """
    sec = estado_demandas if isinstance(estado_demandas, dict) else {}
    itens = sec.get("itens") if isinstance(sec.get("itens"), dict) else {}
    retratos = {id_: _retrato_atual(it) for id_, it in itens.items()}
    por_caminho = {}
    for id_, demanda in retratos.items():
        plano = demanda.get("plano") if isinstance(demanda.get("plano"), dict) else {}
        repo, caminho = demanda.get("repositorio"), plano.get("caminho")
        if isinstance(repo, str) and isinstance(caminho, str) and caminho:
            por_caminho.setdefault((repo.lower(), caminho), id_)
    # o prefixo de 8 caracteres só liga quando é de uma demanda só, no mesmo repositório
    prefixos = {}
    for id_, demanda in retratos.items():
        if isinstance(demanda.get("repositorio"), str) and _UUID.fullmatch(str(id_)):
            prefixos.setdefault((demanda["repositorio"].lower(), id_[:8]), set()).add(id_)
    por_prefixo = {chave_: next(iter(ids)) for chave_, ids in prefixos.items() if len(ids) == 1}
    nova = copy.deepcopy(fila_) if isinstance(fila_, list) else []
    for entrada in nova:
        if not isinstance(entrada, dict) or entrada.get("estado") != "aguardando":
            continue
        id_ = _demanda_da_entrada(entrada, por_caminho, por_prefixo)
        if id_ is None:
            continue
        demanda = retratos.get(id_) or {}
        entrada["demanda"] = id_
        if not _chegou_ao_desenvolvimento(demanda) or _desenho_por_mergear(itens.get(id_)):
            if entrada.get("segurado") is not True:
                entrada.update(segurado=True, seguradoPor="demanda")
        elif entrada.get("seguradoPor") == "demanda":
            entrada["segurado"] = False
            entrada.pop("seguradoPor")
        entrada["urgente"] = demanda.get("destino") == "urgente"
    return nova


def _entrada_da_demanda(fila_, id_: str, it: dict, demanda: dict):
    """A entrada mais recente da fila do plano da demanda (pelo `demanda`, ou pelo caminho no mesmo repositório)."""
    caminho = it.get("plano")
    repo = demanda.get("repositorio")
    achada = None
    for entrada in fila_ if isinstance(fila_, list) else []:
        if not isinstance(entrada, dict) or not isinstance(entrada.get("id"), str):
            continue
        if entrada.get("demanda") == id_ or (
            "demanda" not in entrada
            and isinstance(caminho, str)
            and entrada.get("caminho") == caminho
            and isinstance(repo, str)
            and str(entrada.get("repo")).lower() == repo.lower()
        ):
            achada = entrada
    return achada


def _itens(estado: dict) -> dict:
    sec = estado.get("demandas") if isinstance(estado, dict) else None
    itens = sec.get("itens") if isinstance(sec, dict) else None
    return itens if isinstance(itens, dict) else {}


def _no_prazo(agora, inicio, teto_s: int, *ci_pendente) -> bool:
    """Ainda dentro do teto da fase + `FOLGA_DO_RUN_SUPERADO_S` (e do teto do CI pendente + a folga, se houver)?

    Sem `agora`, sempre (o chamador não pediu prazo). `inicio` ilegível já venceu, como no acompanhamento das fases.
    """
    if agora is None:
        return True
    agora = agora if isinstance(agora, datetime.datetime) else _instante(agora)
    base = _instante(inicio)
    if agora is None or base is None:
        return False
    fim = base + datetime.timedelta(seconds=teto_s + FOLGA_DO_RUN_SUPERADO_S)
    for desde in ci_pendente:
        desde = _instante(desde)
        if desde is not None:
            fim = max(fim, desde + datetime.timedelta(seconds=CI_PENDENTE_MAXIMO_S + FOLGA_DO_RUN_SUPERADO_S))
    return agora <= fim


def _ci_pendente(it: dict) -> list:
    return [it.get("ciPendenteDesde")] + [_dados(it, nome).get("ciPendenteDesde") for nome in ("desenho", "teste", "correcao")]


def _segura_a_trava(it: dict):
    """`(fase, inicio, teto, ci)` de quem segura a trava de orquestrador (`planejando`, ou o run superado do plano);
    senão `None`."""
    if it.get("fase") == "planejando" and it.get("alvo") == "planejando":
        return "planejando", it.get("inicio"), TETO_PLANO_S, [it.get("ciPendenteDesde")]
    if isinstance(it.get("runSuperado"), dict):
        return "runSuperado", it["runSuperado"].get("inicio"), TETO_PLANO_S, []
    return None


def _revisao_em_curso(it: dict):
    """A revisão da correção sem CI (`correcao.revisao`) com o run despachado e ainda não visto terminar; senão `None`."""
    c = it.get("correcao") if isinstance(it.get("correcao"), dict) else {}
    rev = c.get("revisao")
    return rev if isinstance(rev, dict) and rev.get("emCurso") and (rev.get("runId") or rev.get("nonce")) else None


def _seguram_a_vaga(it: dict) -> list:
    """`(fase, inicio, teto, ci)` de cada coisa que segura a vaga da demanda: a fase com vaga e os runs superados."""
    seguram = []
    if it.get("fase") in FASES_COM_VAGA and (it.get("runId") or it.get("alvo") == it.get("fase")):
        seguram.append((it["fase"], it.get("inicio"), TETO_RUN_S, _ci_pendente(it)))
        rev = _revisao_em_curso(it)
        if rev is not None:  # o revisor da correção sem CI começa depois do run da correção: vale o teto dele
            seguram.append(("revisao", rev.get("inicio"), TETO_RUN_S, []))
    for campo in RUNS_SUPERADOS:
        if isinstance(it.get(campo), dict):
            seguram.append((campo, it[campo].get("inicio"), TETO_RUN_S, []))
    return seguram


def chaves_do_orquestrador(estado: dict, agora=None) -> set[str]:
    """As chaves `demanda:<id>` que seguram a trava de orquestrador: em `planejando` ou com run superado vivo.

    O coordenador as soma aos `ativos` de `capacidade.limpar_orfaos` (senão a limpeza solta a trava do plano). Com
    `agora`, a chave vence no teto do plano + 30 min (ou do CI pendente + 30 min), as mesmas contas das fases: quando
    o passo das demandas não roda (Flow sem a rota, Central desligada, passo quebrado), a trava não fica presa.
    """
    chaves = set()
    for id_, it in _itens(estado).items():
        segura = _segura_a_trava(it) if isinstance(it, dict) else None
        if segura is not None and _no_prazo(agora, segura[1], segura[2], *segura[3]):
            chaves.add(chave(id_))
    return chaves


def _run_superado_vivo(it: dict) -> bool:
    return any(isinstance(it.get(campo), dict) for campo in RUNS_SUPERADOS)


def chaves_ocupando(estado: dict, agora=None) -> set[str]:
    """As chaves de vaga (`demanda:<id>`) das fases que reservam vaga e têm run vivo (ou o POST em curso), mais as do
    run superado (desenho, teste ou correção), que segura a vaga até terminar. O coordenador as soma aos `ativos` de
    `limpar_orfaos`. Com `agora`, cada uma vence no teto do run + 30 min (ou do CI pendente + 30 min)."""
    chaves = set()
    for id_, it in _itens(estado).items():
        if isinstance(it, dict) and any(_no_prazo(agora, inicio, teto, *ci) for _, inicio, teto, ci in _seguram_a_vaga(it)):
            chaves.add(chave(id_))
    return chaves


def chaves_vencidas(estado: dict, agora) -> list[tuple]:
    """`(demanda, fase, inicio)` de cada trava ou vaga de demanda que passou do prazo em `agora` (para o aviso)."""
    vencidas = []
    for id_, it in sorted(_itens(estado).items()):
        if not isinstance(it, dict):
            continue
        segura = _segura_a_trava(it)
        if segura is not None and not _no_prazo(agora, segura[1], segura[2], *segura[3]):
            vencidas.append((id_, segura[0], segura[1]))
        vagas = _seguram_a_vaga(it)
        if vagas and not any(_no_prazo(agora, inicio, teto, *ci) for _, inicio, teto, ci in vagas):
            vencidas.append((id_, vagas[0][0], vagas[0][1]))
    return vencidas


# ---------------------------------------------------------------- caixa de saída


def _gravar_bytes_atomico(caminho: pathlib.Path, dados: bytes) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = caminho.with_name(".%s.%d.tmp" % (caminho.name, os.getpid()))
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as arquivo:
            arquivo.write(dados)
            arquivo.flush()
            os.fsync(arquivo.fileno())
        os.replace(tmp, caminho)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    with contextlib.suppress(OSError):
        fd_dir = os.open(caminho.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd_dir)
        finally:
            os.close(fd_dir)


def enfileirar_evento(estado: dict, demanda_id: str, tipo: str, dados: dict, *, agora) -> str:
    """Põe o evento na caixa de saída com um id novo (uuid4) e devolve o id.

    O id tem de estar no disco antes do POST: `esvaziar_saida` salva antes do primeiro envio, e quem enfileira e
    não esvazia no mesmo ciclo salva por conta própria. Nunca enfileire de novo o mesmo evento: reenviar é a saída.
    """
    id_ = str(uuid.uuid4())
    evento = {"id": id_, "em": _texto_do_instante(agora), "tipo": tipo, "dados": dados}
    secao(estado)["saida"].append({"demanda": _id_valido(demanda_id), "evento": evento})
    return id_


def enfileirar_arquivo(estado: dict, raiz, demanda_id: str, *, tipo: str, nome: str, conteudo: str, dados: bytes, tela) -> str:
    """Copia os bytes para `<raiz>/demandas/<demanda>/<arquivoId>` (atômico) e só então põe o arquivo na saída.

    Acima de `LIMITE_DO_ARQUIVO` o Flow recusaria: `ValueError` e nada entra na saída.
    """
    _id_valido(demanda_id)
    if not isinstance(dados, bytes) or len(dados) > LIMITE_DO_ARQUIVO:
        raise ValueError("arquivo acima de %d bytes" % LIMITE_DO_ARQUIVO)
    id_ = str(uuid.uuid4())
    relativo = "demandas/%s/%s" % (demanda_id, id_)
    _gravar_bytes_atomico(pathlib.Path(raiz) / relativo, dados)
    arquivo = {"id": id_, "tipo": tipo, "nome": nome, "conteudo": conteudo, "tela": tela, "caminho": relativo}
    secao(estado)["saida"].append({"demanda": demanda_id, "arquivo": arquivo})
    return id_


class _ArquivoSumido(Exception):
    pass


def _ler_local(raiz, caminho) -> bytes:
    if not isinstance(caminho, str) or _CAMINHO_LOCAL.fullmatch(caminho) is None:
        raise _ArquivoSumido()
    try:
        fd = os.open(pathlib.Path(raiz) / caminho, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as arquivo:
            dados = arquivo.read(LIMITE_DO_ARQUIVO + 1)
    except OSError:
        raise _ArquivoSumido() from None
    if len(dados) > LIMITE_DO_ARQUIVO:
        raise _ArquivoSumido()
    return dados


def _apagar_local(raiz, caminho) -> None:
    if isinstance(caminho, str) and _CAMINHO_LOCAL.fullmatch(caminho):
        with contextlib.suppress(OSError):
            os.unlink(pathlib.Path(raiz) / caminho)


class _ItemTorto(Exception):
    pass


def _enviar(item, cliente, raiz) -> str:
    if not isinstance(item, dict) or not isinstance(item.get("demanda"), str):
        raise _ItemTorto()
    if isinstance(item.get("evento"), dict) and isinstance(item["evento"].get("id"), str):
        return cliente.enviar_evento(item["demanda"], item["evento"])
    a = item.get("arquivo")
    if not isinstance(a, dict) or not all(isinstance(a.get(k), str) for k in ("id", "tipo", "nome", "conteudo")):
        raise _ItemTorto()
    dados = _ler_local(raiz, a.get("caminho"))
    return cliente.enviar_arquivo(item["demanda"], id_=a["id"], tipo=a["tipo"], nome=a["nome"], conteudo=a["conteudo"], dados=dados, tela=a.get("tela"))


def _descricao(item) -> str:
    if not isinstance(item, dict):
        return "item torto"
    if isinstance(item.get("evento"), dict):
        return "evento %s" % item["evento"].get("tipo")
    a = item.get("arquivo") if isinstance(item.get("arquivo"), dict) else {}
    return "arquivo %s (%s)" % (a.get("nome"), a.get("tipo"))


def _falha_conta(motivo: str) -> bool:
    m = _HTTP_4XX.fullmatch(motivo)
    return m is not None and m.group(1) not in _4XX_QUE_PASSAM


def _aviso(item, motivo: str) -> dict:
    demanda = str(item.get("demanda")) if isinstance(item, dict) else "?"
    mensagem = "demanda %s: %s descartado (%s)" % (demanda[:8], _descricao(item), motivo)
    return {"evento": "aviso", "chave": "demandas:recusa:%s" % demanda, "mensagem": mensagem[:300]}


def _aviso_de_parada(sec: dict, motivo: str, mensagem: str) -> list[dict]:
    """Um aviso por parada da saída: repete só quando o motivo muda; um envio bem-sucedido limpa a marca."""
    if sec.get("saidaParada") == motivo:
        return []
    sec["saidaParada"] = motivo
    return [{"evento": "aviso", "chave": CHAVE_SAIDA_PARADA, "mensagem": mensagem[:300]}]


def esvaziar_saida(estado: dict, cliente, raiz, *, salvar) -> list[dict]:
    """Manda a caixa de saída na ordem e devolve os eventos de aviso.

    Antes do primeiro envio, `salvar()`: um id gerado neste ciclo fica no disco antes do POST, e um coordenador que
    cai no meio do POST reenvia o mesmo id. Depois, por item:

    - `aplicado`/`repetido` tiram o item (e apagam o arquivo local, só depois de salvar);
    - `recusado` (409/422), cópia local sumida, item torto, `FALHAS_PERMANENTES` e a mesma 4xx (fora de 401, 403,
      404, 408 e 429) `LIMITE_DE_FALHAS_IGUAIS` vezes seguidas tiram o item com um aviso
      `demandas:recusa:<demanda>` e marcam `precisa_ressincronizar` no item da demanda (a fase local já contava
      com o evento que o Flow não aplicou);
    - `HTTP 404` (Flow sem o módulo, ou a demanda sumiu) pausa a saída com um aviso `demandas:saida-parada`, sem
      contar para o descarte;
    - qualquer outra `FalhaDeEnvio` para no primeiro e deixa o resto para o ciclo seguinte; a mesma falha
      `LIMITE_DE_FALHAS_IGUAIS` vezes seguidas (5xx, 401, 403, rede) dá um aviso `demandas:saida-parada`.

    `salvar()` roda depois de cada item.
    """
    sec = secao(estado)
    saida = sec["saida"]
    avisos = []
    if saida:
        salvar()
    while saida:
        item = saida[0]
        motivo = None
        try:
            resultado = _enviar(item, cliente, raiz)
        except _ItemTorto:
            motivo = "item torto na caixa de saída"
        except _ArquivoSumido:
            motivo = "cópia local do arquivo sumiu"
        except FalhaDeEnvio as falha:
            texto = str(falha)
            anterior = item.get("falha") or {}
            vezes = anterior.get("vezes", 0) + 1 if anterior.get("motivo") == texto else 1
            if texto in FALHAS_PERMANENTES or (_falha_conta(texto) and vezes >= LIMITE_DE_FALHAS_IGUAIS):
                motivo = texto
            else:
                item["falha"] = {"motivo": texto, "vezes": vezes}
                if texto == FALHA_SEM_ROTA:
                    avisos += _aviso_de_parada(
                        sec, texto, "caixa de saída das demandas pausada: o Flow respondeu 404 (sem o módulo de demandas, ou a demanda %s sumiu)" % item["demanda"][:8]
                    )
                elif vezes >= LIMITE_DE_FALHAS_IGUAIS:
                    avisos += _aviso_de_parada(
                        sec, texto, "caixa de saída das demandas parada: %s %d vezes seguidas em %s da demanda %s" % (texto, vezes, _descricao(item), item["demanda"][:8])
                    )
                salvar()
                break
        else:
            sec["saidaParada"] = None
            if resultado == "recusado":
                recusa = getattr(cliente, "ultima_recusa", None)
                motivo = "recusado pelo Flow: %s" % recusa if recusa else "recusado pelo Flow"
        if motivo is not None:
            avisos.append(_aviso(item, motivo))
            alvo = sec["itens"].get(item.get("demanda")) if isinstance(item, dict) else None
            if isinstance(alvo, dict):
                alvo["precisa_ressincronizar"] = True
        saida.pop(0)
        salvar()
        if isinstance(item, dict) and isinstance(item.get("arquivo"), dict):
            _apagar_local(raiz, item["arquivo"].get("caminho"))
    return avisos


# ---------------------------------------------------------------- passo: busca e triagem

PAGINAS_POR_CICLO = 5
REVER_FLOW_SEM_DEMANDAS_S = 3600
REVER_BUSCA_RECUSADA_S = 15 * 60  # 4xx na busca (fora de 404, 408 e 429): repetir a cada ciclo não conserta
TETO_TRIAGEM_S = 1800
PAPEL_DA_TRIAGEM = "produto"
CHAVE_SEM_ROTA = "demandas:sem-rota"
CHAVE_BUSCA = "demandas:busca"
AVISO_SEM_ROTA = "Demandas: o Flow não tem a rota de demandas (404); a Fábrica tenta de novo em 1 h"
MOTIVO_SEM_FORMATO = "a triagem não respondeu no formato"
MOTIVO_TETO_TRIAGEM = "a triagem passou de 30 min"
MOTIVO_AGENTE = "o agente falhou: %s"
MOTIVO_RUN_SUMIU = "run não encontrado no Warren"
MOTIVO_TRIAGEM_RECUSADA = "o Flow recusou a triagem da Fábrica"
LIMITE_MOTIVO_DO_AGENTE = 200
PAPEL_DO_PLANO = "orquestrador"
CI_PENDENTE_MAXIMO_S = 2 * 3600
TENTATIVAS_SEM_PR = 2  # a primeira e uma nova tentativa
CAMINHO_CONFIG_DO_REPO = ".fabrica/config.json"
PERMITIDOS_AO_PLANO = (".fabrica/planejamento/**", ".seeds/**")  # além do próprio plano da demanda
MOTIVO_FORA = "o plano mexe fora de .fabrica: %s"
CAMINHO_DA_PERGUNTA = ".fabrica/pergunta.md"  # o orquestrador pergunta ao Paulo em vez de planejar
MOTIVO_PERGUNTA = "o orquestrador perguntou (responda ao tentar de novo): %s"
MOTIVO_PROTEGIDO = "o plano mexe em caminho protegido: %s"
MOTIVO_SEM_PLANO = "o PR não traz o plano %s"
# o orquestrador concluiu que não há plano a fazer: marca no cabeçalho do `cobertura.md` da demanda (orquestrador.md,
# "Demanda sem plano"); a trava leva o `desfecho` e o Flow oferece encerrar em vez de retomar
CAMINHO_DA_COBERTURA = ".fabrica/planejamento/demanda-%s/cobertura.md"
RESULTADOS_SEM_PLANO = ("duplicada", "ja_resolvida")
MOTIVO_DUPLICADA = "o orquestrador concluiu que a demanda é duplicada da %s: não há plano a fazer"
MOTIVO_DUPLICADA_SEM_DE = "o orquestrador concluiu que a demanda é duplicada de outra: não há plano a fazer"
MOTIVO_JA_RESOLVIDA = "o orquestrador concluiu que o que a demanda pede já está resolvido: não há plano a fazer"
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
MOTIVO_PLANO_INVALIDO = "o plano não passa em validar_plano: %s"
MOTIVO_PLANO_DE_OUTRA = 'o plano não traz "demanda": "%s"'
MOTIVO_PLANO_ILEGIVEL = "o plano do PR não é um JSON legível"
MOTIVO_CONFIG_ILEGIVEL = "a .fabrica/config.json do repositório está ilegível"
MOTIVO_CI_PENDENTE = "o CI do plano não terminou em 2 h"
MOTIVO_CI_VERMELHO = "o CI do plano está vermelho"
MOTIVO_CI_OBRIGATORIO = "o repositório exige CI no plano e o head não tem CI"
MOTIVO_SEM_PR = "o orquestrador terminou sem PR do plano 2 vezes"
MOTIVO_LINK_INVALIDO = "o run do plano devolveu um link de PR inválido"
MOTIVO_PR_FECHADO = "o PR do plano foi fechado sem merge"
MOTIVO_OUTRO_REPO = "o PR do plano está em outro repositório"
MOTIVO_MERGE_RECUSADO = "o GitHub recusou o merge do plano"
MOTIVO_PLANEJAR_COMIGO = "planejar comigo: o PR do plano vai para o Paulo"
MOTIVO_PLANO_RECUSADO = "o Flow recusou o plano criado pela Fábrica"
MOTIVO_NIVEL = "o nível da demanda não deixa a Fábrica mergear o plano"
MOTIVO_TETO_PLANO = "o plano passou de 2 h sem PR"
MOTIVO_ERRO_REPETIDO = "o plano parou: o mesmo erro %d ciclos seguidos (%s)"
MOTIVO_PLANO_PAUSADO = "plano pausado"
MOTIVO_DESENVOLVIDA_RECUSADA = "o Flow recusou a conclusão do desenvolvimento"
DIR_PLANOS = "planos"  # `<raiz>/planos/<id do plano>/estado.json`, a pasta de cada plano do coordenador
# só nestes níveis a Fábrica planeja sem sessão e mergeia o PR do plano; qualquer outro (ausente, nulo, desconhecido)
# espera o Paulo, como "planejar comigo"
NIVEIS_SEM_SESSAO = ("vai_sozinho", "aprovar_desenho")
TETO_PLANO_S = 2 * 3600  # do despacho até o PR; com o PR, vale o teto do CI pendente
# o motor não cancela run: o que passou do teto (ou foi superado) segura a trava até terminar, ou até esta folga
FOLGA_DO_RUN_SUPERADO_S = 1800
LIMITE_ERROS_DO_PLANO = 5
PAPEL_DO_DESENHO = "ux-ui"
TETO_RUN_S = 2 * 3600  # do despacho do run do desenho até o PR (como o plano)
MOTIVO_TETO_RUN = "o agente passou de 2 h"
MOTIVO_NAO_AUTOCONTIDO = "o desenho gerado não é autocontido: %s"
MOTIVO_SEM_DESENHO = "o PR não traz %s"
MOTIVO_DESENHO_FORA = "o PR do desenho mexe fora de %s: %s"
MOTIVO_DESENHO_SEM_PR = "o ux-ui terminou sem PR do desenho 2 vezes"
MOTIVO_LINK_DO_DESENHO = "o run do desenho devolveu um link de PR inválido"
MOTIVO_PR_DO_DESENHO_FECHADO = "o PR do desenho foi fechado sem merge"
MOTIVO_DESENHO_OUTRO_REPO = "o PR do desenho está em outro repositório"
MOTIVO_DESENHO_MUDOU = "o PR do desenho mudou depois do envio"
MOTIVO_CI_DO_DESENHO = "o PR do desenho está com o CI vermelho"
MOTIVO_CI_DO_DESENHO_PENDENTE = "o CI do desenho não terminou em 2 h"
MOTIVO_MERGE_DO_DESENHO = "o GitHub recusou o merge do desenho"
MOTIVO_DESENHO_RECUSADO = "o Flow recusou o desenho enviado pela Fábrica"
MOTIVO_ERRO_DO_DESENHO = "o desenho parou: o mesmo erro %d ciclos seguidos (%s)"
PAPEL_DO_TESTE = "qa"
PAPEL_DA_CORRECAO = "frontend"
LIMITE_RODADAS = 10  # rodadas do teste guardadas no item
COMENTARIO_DO_TESTE = "Evidência enviada ao Flow."
RESULTADOS_DO_TESTE = ("passou", "falhou", "nao_subiu")  # `nao_subiu` é do kit: o qa não subiu o sistema no run
CAPTURAS_POR_TELA = 10
ASSINATURA_PNG = b"\x89PNG\r\n\x1a\n"
_CAPTURA = re.compile(r"(desktop|celular)-\d{2}\.png")
MOTIVO_SEM_CAPTURAS = "o teste não trouxe capturas de desktop e celular"
MOTIVO_NAO_SUBIU = "o qa não subiu o sistema no run: %s"
MOTIVO_TESTE_FORA = "o PR do teste mexe fora de %s/: %s"
MOTIVO_TESTE_SEM_PR = "o qa terminou sem PR do teste 2 vezes"
MOTIVO_LINK_DO_TESTE = "o run do teste devolveu um link de PR inválido"
MOTIVO_PR_DO_TESTE_FECHADO = "o PR do teste foi fechado"
MOTIVO_TESTE_OUTRO_REPO = "o PR do teste está em outro repositório"
MOTIVO_TESTE_RECUSADO = "o Flow recusou o teste enviado pela Fábrica"
MOTIVO_ERRO_DO_TESTE = "o teste parou: o mesmo erro %d ciclos seguidos (%s)"
# contra o quê o qa testou (obrigatório no `passou` e no `falhou`): a porta de mentira (mocks, dublê) ou o back-end real
CONTRAS_DO_TESTE = ("simulacao", "real")
FRASE_DO_CONTRA = {"simulacao": "Testado contra a simulação do back-end.", "real": "Testado contra o back-end real."}
# a entrega que não publica sozinha: o Paulo decide pela trava (Retomar publica, Encerrar não publica)
CAUDA_DA_PUBLICACAO = "Retomar publica mesmo assim; Encerrar não publica."
MOTIVO_SO_SIMULACAO = "Testado só contra a simulação do back-end. Publicar assim pode expor algo que não funciona."
MOTIVO_TESTE_NAO_PUBLICAR = "O teste pede para não publicar: %s."
MOTIVO_RELATORIO_NAO_PUBLICAR = "O relatório final pede para não publicar: %s."
MOTIVO_CONTRATO_MUDOU = "O back-end mudou: %s."
MOTIVO_SEM_MOTIVO_DE_NAO_PUBLICAR = "sem motivo escrito"
MOTIVO_CONTRATOS_TORTOS = "A lista contratosExternos da .fabrica/config.json está torta (%s): não dá para conferir o contrato."
CAMINHO_DO_RELATORIO_FINAL = ".fabrica/planejamento/%s/relatorio-final.md"
# a marca do relatório final (linhas soltas, como o orquestrador.md pede): `publicar: false` e `motivoDeNaoPublicar: …`
_PUBLICAR_FALSE = re.compile(r"^[ \t]*publicar:[ \t]*false[ \t]*$", re.IGNORECASE | re.MULTILINE)
_MOTIVO_DE_NAO_PUBLICAR = re.compile(r"^[ \t]*motivoDeNaoPublicar:[ \t]*(.+?)[ \t]*$", re.MULTILINE)
LIMITE_MOTIVO_DE_NAO_PUBLICAR = 200
# o Decidir do Flow oferece o merge pelo cartão nas travas da correção com PR aberto pelo texto destes motivos
# (`MOTIVOS_DA_CORRECAO_COM_PR` em src/modules/decidir/model.ts): mudou um texto aqui, muda lá
MOTIVO_CORRECAO_SEM_PR = "o frontend terminou sem PR da correção 2 vezes"
MOTIVO_LINK_DA_CORRECAO = "o run da correção devolveu um link de PR inválido"
MOTIVO_PR_DA_CORRECAO_FECHADO = "o PR da correção foi fechado sem merge"
MOTIVO_CORRECAO_OUTRO_REPO = "o PR da correção está em outro repositório"
MOTIVO_CORRECAO_JA_MERGEADA = "o PR da correção já estava mergeado antes de o kit conferir"
MOTIVO_CORRECAO_SEM_CI = "PR de correção sem CI: revise e faça o merge"
# sem CI, com `ciObrigatorioNasSeeds: false` na config do repositório, quem confere a correção é o revisor da Fábrica
# (o mesmo veredito das seeds); os motivos vão ao Paulo, que não é técnico
PAPEL_DA_REVISAO = "revisor"
TENTATIVAS_DA_REVISAO = 2  # a revisão e uma nova, quando a primeira não deixa veredito válido
LIMITE_ACHADO_DA_REVISAO = 160
MOTIVO_REVISAO_REPROVOU = "O revisor da Fábrica reprovou a correção: %s"
MOTIVO_REVISAO_SEM_MOTIVO = "ele não escreveu o porquê"
MOTIVO_REVISAO_SEM_VEREDITO = "O revisor da Fábrica não conseguiu avaliar a correção, nem na segunda tentativa"
MOTIVO_TETO_DA_REVISAO = "O revisor da Fábrica passou de 2 h sem avaliar a correção"
# reprovada, a Fábrica conserta o mesmo PR (um run do `frontend` no branch dele, com os achados) até 2 vezes; depois
# disso, trava com o mesmo começo do `MOTIVO_REVISAO_REPROVOU` (o Decidir oferece o merge pelo cartão por ele)
CONSERTOS_DA_CORRECAO = 2
# o GitHub recusa o merge do PR da correção quando o `.seeds/` conflita (ele ignora o `merge=union`): o kit traz o
# branch padrão para o PR (`atualizar_branch`) até estas vezes antes de travar
ATUALIZACOES_DA_CORRECAO = 3
MOTIVO_REVISAO_REPROVOU_DEPOIS_DOS_CONSERTOS = MOTIVO_REVISAO_REPROVOU % "%s (mesmo depois de dois consertos da Fábrica)"
COMENTARIO_DA_CORRECAO_REFEITA = "A Fábrica refaz a correção a partir do branch padrão: este PR foi reprovado mesmo depois dos consertos."
# capturas enviadas por run de teste: o teste e o reteste da primeira falha (80 MB) deixam a demanda abaixo dos
# 100 MB do Flow, com espaço para o desenho
LIMITE_CAPTURAS_POR_TESTE = 40 * 1024 * 1024
NOTA_CAPTURAS_DE_FORA = " (%d capturas ficaram de fora (limite de 40 MB por teste))"
MOTIVO_CORRECAO_PROTEGIDO = "o PR da correção mexe em caminho protegido: %s"
MOTIVO_CORRECAO_CONTRATO = "o PR da correção muda a cópia de um contrato externo e ela não bate com a origem: %s"
MOTIVO_CI_DA_CORRECAO = "o PR da correção do teste está com o CI vermelho"
MOTIVO_CI_DA_CORRECAO_PENDENTE = "o CI da correção do teste não terminou em 2 h"
MOTIVO_MERGE_DA_CORRECAO = "o GitHub recusou o merge da correção"
MOTIVO_CORRECAO_RECUSADA = "o Flow recusou a conclusão da correção do teste"
MOTIVO_ERRO_DA_CORRECAO = "a correção parou: o mesmo erro %d ciclos seguidos (%s)"


def _instante(valor):
    try:
        return datetime.datetime.strptime(valor, FORMATO_INSTANTE).replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


def _modelo(modelos, papel: str) -> dict | None:
    """`modelos.<papel>` validado como no despachante; ausente ou torto: `None`."""
    try:
        return despachante._validar_modelo(despachante._dict(modelos).get(papel), papel)
    except Exception:  # noqa: BLE001 - sem modelo, a fase espera com um aviso
        return None


def _marco(demanda: dict):
    return (demanda.get("etapaAtual") or {}).get("marco")


def _permitido_ao_plano(caminho, caminho_do_plano: str) -> bool:
    """O PR do plano da demanda só pode tocar o próprio plano, `.fabrica/planejamento/**` e `.seeds/**`."""
    if not isinstance(caminho, str) or not caminho or caminho.startswith("/"):
        return False
    if any(parte in ("", ".", "..") for parte in caminho.split("/")):
        return False
    return caminho in (caminho_do_plano, CAMINHO_DA_PERGUNTA) or any(globs.casa_glob(caminho, g) for g in PERMITIDOS_AO_PLANO)


def _titulo_da_pergunta(texto) -> str:
    """A primeira linha com texto da pergunta, sem as marcas de título do Markdown."""
    for linha in (texto if isinstance(texto, str) else "").splitlines():
        limpa = linha.strip().lstrip("#").strip()
        if limpa:
            return limpa[:200]
    return "veja %s no PR" % CAMINHO_DA_PERGUNTA


def desfecho_da_cobertura(texto, demanda_id: str) -> dict | None:
    """O `resultado` (e o `de`, na duplicada) do cabeçalho `---` do `cobertura.md`; sem marca válida, None.

    O `de` só vale como o uuid completo de outra demanda; fora disso vai None (o Flow encerra sem o link).
    """
    linhas = (texto if isinstance(texto, str) else "").lstrip("\ufeff").splitlines()
    if not linhas or linhas[0].strip() != "---":
        return None
    campos = {}
    for linha in linhas[1:]:
        if linha.strip() == "---":
            break
        chave, sep, valor = linha.partition(":")
        if sep:
            # o exemplo do roteiro comenta as linhas; aspas (YAML) e caixa não mudam o valor
            campos[chave.strip().lower()] = valor.split("#", 1)[0].strip().strip("\"'").strip().lower()
    else:
        return None
    resultado = campos.get("resultado")
    if resultado not in RESULTADOS_SEM_PLANO:
        return None
    de = campos.get("de") if resultado == "duplicada" else None
    if not (isinstance(de, str) and _UUID.fullmatch(de) and de != demanda_id):
        de = None
    return {"resultado": resultado, "de": de}


def motivo_do_desfecho(desfecho: dict) -> str:
    if desfecho["resultado"] == "ja_resolvida":
        return MOTIVO_JA_RESOLVIDA
    return MOTIVO_DUPLICADA % desfecho["de"][:8] if desfecho["de"] else MOTIVO_DUPLICADA_SEM_DE


def _resposta_da_retomada(item: dict, demanda: dict) -> str:
    """A `resposta` da retomada mais recente do Paulo depois do início da fase atual (sem ela, vazia)."""
    inicio = item.get("inicio")
    resposta = ""
    for evento in demanda.get("eventos") or []:
        if isinstance(evento, dict) and evento.get("tipo") == "retomada":
            em = evento.get("em")
            if not isinstance(inicio, str) or (isinstance(em, str) and em > inicio):
                dados = evento.get("dados") if isinstance(evento.get("dados"), dict) else {}
                resposta = dados.get("resposta") if isinstance(dados.get("resposta"), str) else ""
    return resposta


def _ainda_no_planejamento(demanda: dict) -> bool:
    """A demanda está na etapa `planejada`, sem espera e aberta (o plano ainda pode entrar pela Fábrica)."""
    return _marco(demanda) == "planejada" and not demanda.get("espera") and not demanda.get("encerrada")


def _versao_do_desenho(demanda: dict) -> int:
    versao = (demanda.get("desenho") or {}).get("versao") if isinstance(demanda.get("desenho"), dict) else None
    return versao if isinstance(versao, int) and not isinstance(versao, bool) and versao >= 0 else 0


def _ainda_no_desenho(demanda: dict) -> bool:
    """A demanda está na etapa `desenho`, sem espera e aberta (o desenho ainda pode entrar pela Fábrica)."""
    return _marco(demanda) == "desenho" and not demanda.get("espera") and not demanda.get("encerrada")


def _dados_do_desenho(it: dict) -> dict:
    """`it["desenho"]`: o PR (`prUrl`, `branch`, `headSha`), a `versao` enviada, a `base` do run e o `invalido`."""
    d = it.get("desenho")
    if not isinstance(d, dict):
        d = it["desenho"] = {}
    return d


def _ajustes(demanda: dict) -> list[dict]:
    """Os ajustes pedidos (`ajustes` do retrato; sem eles, os eventos `ajuste_pedido`), do mais antigo ao mais novo."""
    ajustes = [a for a in demanda.get("ajustes") or [] if isinstance(a, dict)]
    if not ajustes:
        ajustes = [
            e["dados"]
            for e in demanda.get("eventos") or []
            if isinstance(e, dict) and e.get("tipo") == "ajuste_pedido" and isinstance(e.get("dados"), dict)
        ]
    return ajustes


def _dados(it: dict, nome: str) -> dict:
    """`it[nome]` (`teste` ou `correcao`), criado se faltar ou estiver torto."""
    d = it.get(nome)
    if not isinstance(d, dict):
        d = it[nome] = {}
    return d


def _resumo_do_teste(valor) -> str | None:
    if not isinstance(valor, str):
        return None
    limpo = prompts._CONTROLE.sub("", valor).strip()
    return prompts._cortar_utf16(limpo, prompts.LIMITE_RESUMO_DO_TESTE).strip() or None


def ler_resultado_do_teste(forja, repo: str, sha: str, id_: str) -> dict | None:
    """O `teste.json` e as capturas do head do PR do teste: `{"resultado", "resumo", "detalhes", "capturas": [{"caminho",
    "tela", "dados"}]}` (as capturas em ordem de caminho, até 10 por tela). O `resumo` vai ao Flow (é o que o Paulo lê);
    o `detalhes` (opcional, `None` se faltar) fica no kit e vai só para a correção. `contra` (`simulacao` ou `real`) diz
    contra o quê o qa testou; `publicar` (opcional, `True` se faltar) e `motivoDeNaoPublicar` seguram a entrega.

    `teste.json` ausente, fora de UTF-8/JSON, com `resultado` desconhecido, sem `resumo`, sem `contra` válido (no
    `passou` e no `falhou`) ou com `publicar` que não é booleano → `None`. Captura fora do nome
    `desktop-NN.png`/`celular-NN.png`, que não é PNG ou acima de 10 MB fica de fora (o Flow a recusaria).
    """
    pasta = prompts.pasta_da_demanda(_id_valido(id_))
    bruto = forja.arquivo_bruto(repo, sha, pasta + "/teste.json")
    try:
        teste = json.loads(bytes(bruto).decode("utf-8")) if isinstance(bruto, (bytes, bytearray)) else None
    except (UnicodeDecodeError, ValueError, RecursionError):
        teste = None
    if not isinstance(teste, dict) or teste.get("resultado") not in RESULTADOS_DO_TESTE:
        return None
    resumo = _resumo_do_teste(teste.get("resumo"))
    if resumo is None:
        return None
    contra = teste.get("contra")
    if teste["resultado"] != "nao_subiu" and contra not in CONTRAS_DO_TESTE:
        return None
    publicar_ = teste.get("publicar", True)
    if not isinstance(publicar_, bool):
        return None
    motivo = _resumo_do_teste(teste.get("motivoDeNaoPublicar"))
    prefixo = pasta + "/capturas/"
    capturas, por_tela = [], {"desktop": 0, "celular": 0}
    for caminho in sorted(c for c in forja.listar(repo, sha, pasta + "/capturas") or [] if isinstance(c, str)):
        m = _CAPTURA.fullmatch(caminho[len(prefixo):]) if caminho.startswith(prefixo) else None
        if m is None or por_tela[m.group(1)] >= CAPTURAS_POR_TELA:
            continue
        dados = forja.arquivo_bruto(repo, sha, caminho)
        if not isinstance(dados, (bytes, bytearray)) or len(dados) > LIMITE_DO_ARQUIVO or not bytes(dados).startswith(ASSINATURA_PNG):
            continue
        por_tela[m.group(1)] += 1
        capturas.append({"caminho": caminho, "tela": m.group(1), "dados": bytes(dados)})
    return {
        "resultado": teste["resultado"],
        "resumo": resumo,
        "detalhes": _resumo_do_teste(teste.get("detalhes")),
        "contra": contra if contra in CONTRAS_DO_TESTE else None,
        "publicar": publicar_,
        "motivoDeNaoPublicar": motivo[:LIMITE_MOTIVO_DE_NAO_PUBLICAR] if motivo else None,
        "capturas": capturas,
    }


def _capturas_no_limite(capturas: list[dict]) -> tuple[list[dict], int]:
    """As capturas que cabem em `LIMITE_CAPTURAS_POR_TESTE` (a primeira de cada tela sempre entra; depois, em ordem de
    caminho, enquanto couber) e quantas ficaram de fora. A ordem de saída é a de entrada."""
    escolhidas, total, telas = set(), 0, set()
    for i, c in enumerate(capturas):
        if c["tela"] not in telas:
            telas.add(c["tela"])
            escolhidas.add(i)
            total += len(c["dados"])
    for i, c in enumerate(capturas):
        if i not in escolhidas and total + len(c["dados"]) <= LIMITE_CAPTURAS_POR_TESTE:
            escolhidas.add(i)
            total += len(c["dados"])
    return [c for i, c in enumerate(capturas) if i in escolhidas], len(capturas) - len(escolhidas)


def _na_pasta(caminho, pasta: str) -> bool:
    if not isinstance(caminho, str) or not caminho.startswith(pasta + "/"):
        return False
    return not any(parte in ("", ".", "..") for parte in caminho.split("/"))


def _ainda_na_triagem(demanda: dict) -> bool:
    """A demanda ainda espera a triagem da Fábrica: na etapa `recebida`, sem espera e aberta."""
    return _marco(demanda) == "recebida" and not demanda.get("espera") and not demanda.get("encerrada")


class _Passo:
    def __init__(self, estado, *, cliente, motor, forja, capacidade_path, projetos, modelos, agora, salvar, raiz=None, mem_disponivel_mb=None, publicacao=None, pedir_publicacao=None, atualizar_branch=None):
        self.estado = estado
        self.atualizar_branch = atualizar_branch
        self.raiz = pathlib.Path(raiz) if raiz is not None else None
        self.sec = secao(estado)
        self.cliente = cliente
        self.motor = motor
        self.forja = forja
        self.capacidade = capacidade_path
        self.projetos = {str(k).lower(): v for k, v in (projetos or {}).items()}
        self.modelo_da_triagem = _modelo(modelos, PAPEL_DA_TRIAGEM)
        self.modelo_do_plano = _modelo(modelos, PAPEL_DO_PLANO)
        self.modelo_do_desenho = _modelo(modelos, PAPEL_DO_DESENHO)
        self.modelo_do_teste = _modelo(modelos, PAPEL_DO_TESTE)
        self.modelo_da_correcao = _modelo(modelos, PAPEL_DA_CORRECAO)
        self.modelo_da_revisao = _modelo(modelos, PAPEL_DA_REVISAO)
        self.mem_disponivel_mb = mem_disponivel_mb
        self.publicacao = publicacao if isinstance(publicacao, dict) and publicacao.get("url") and publicacao.get("token_file") else None
        self.pedir_publicacao = pedir_publicacao or publicar.pedir
        self.agora = agora if isinstance(agora, datetime.datetime) else motor_.instante(agora)
        self.agora_texto = _texto_do_instante(self.agora)
        self.salvar = salvar or (lambda: None)
        self.eventos = []
        self._avisados = set()

    def aviso(self, chave_: str, mensagem: str) -> None:
        if chave_ not in self._avisados:
            self._avisados.add(chave_)
            self.eventos.append({"evento": "aviso", "chave": chave_, "mensagem": mensagem[:300]})

    def erro(self, id_, exc) -> None:
        self.eventos.append({"evento": "erro", "etapa": "demandas", "alvo": id_, "erro": "%s: %s" % (type(exc).__name__, exc)})

    # ------------------------------------------------------------ busca

    def buscar(self) -> bool:
        """Lê as páginas novas; `False` = Flow sem a rota (o passo fica desligado até `REVER_FLOW_SEM_DEMANDAS_S`)."""
        sem_rota = _instante(self.sec.get("semRotaEm"))
        if sem_rota is not None and (self.agora - sem_rota).total_seconds() < REVER_FLOW_SEM_DEMANDAS_S:
            return False
        recusada = _instante(self.sec.get("buscaRecusadaEm"))
        if recusada is not None and (self.agora - recusada).total_seconds() < REVER_BUSCA_RECUSADA_S:
            return True  # recusa que repetir não conserta (401, 403…): uma tentativa a cada 15 min
        itens = self.sec["itens"]
        for _ in range(PAGINAS_POR_CICLO):
            try:
                resposta = self.cliente.buscar(self.sec["cursor"])
            except FalhaDeEnvio as falha:
                if falha.codigo is not None and 400 <= falha.codigo < 500 and falha.codigo not in (404, 408, 429):
                    self.sec["buscaRecusadaEm"] = self.agora_texto
                    self.salvar()
                    self.aviso(CHAVE_BUSCA, "Demandas: o Flow recusou a busca (%s); tento de novo a cada 15 min" % falha)
                else:
                    self.aviso(CHAVE_BUSCA, "Demandas: a busca no Flow falhou (%s)" % falha)
                return True  # segue com as demandas que já tem
            if resposta is None:
                primeira = self.sec.get("semRotaEm") is None
                self.sec["semRotaEm"] = self.agora_texto
                self.salvar()
                if primeira:
                    self.aviso(CHAVE_SEM_ROTA, AVISO_SEM_ROTA)
                return False
            self.sec["semRotaEm"] = None
            self.sec.pop("buscaRecusadaEm", None)
            for demanda in resposta["demandas"]:
                if not isinstance(itens.get(demanda["id"]), dict):
                    itens[demanda["id"]] = item_novo()
                itens[demanda["id"]]["recebida"] = demanda
            self.salvar()  # os itens no disco antes do cursor: uma queda aqui relê a mesma página
            self.sec["cursor"] = resposta["cursor"]
            self.salvar()
            if not resposta["mais"]:
                break
        return True

    # ------------------------------------------------------------ decisão

    def decidir(self) -> None:
        itens = self.sec["itens"]
        vista = {
            id_: {"ultima": it.get("recebida") or it.get("ultima")}
            for id_, it in itens.items()
            if isinstance(it, dict) and _UUID.fullmatch(str(id_))
        }
        for id_ in ordenar(vista):
            it = itens[id_]
            demanda = it.get("recebida") or it.get("ultima")
            if not isinstance(demanda, dict) or not demanda:
                continue
            try:
                self.largar_triagem_superada(id_, it, demanda)
                self.largar_plano_superado(id_, it, demanda)
                self.seguir_run_superado(id_, it)
                self.largar_desenho_superado(id_, it, demanda)
                self.largar_teste_superado(id_, it, demanda)
                self.largar_correcao_superada(id_, it, demanda)
                self.seguir_desenho_superado(id_, it)
                self.seguir_teste(id_, it, demanda)
                self.seguir_correcao_sem_ci(id_, it, demanda)
                self.adotar_plano_da_sessao(id_, it, demanda)
                self.seguir_desenvolvimento(id_, it, demanda)
                self.reabrir_separada(id_, it)
                acao = proxima_acao(it, demanda, pendente=tem_pendente(self.estado, id_))
                if acao == "aguardar_envio":
                    continue  # o retrato está atrasado: decide de novo quando a saída esvaziar
                self.agir(id_, it, demanda, acao)
            except Exception as exc:  # noqa: BLE001 - uma demanda não derruba as outras; o próximo ciclo refaz
                self.erro(id_, exc)
                continue
            if it.get("recebida") is not None:
                it["ultima"] = it.pop("recebida")
                self.salvar()

    def agir(self, id_: str, it: dict, demanda: dict, acao: str) -> None:
        if acao == "ressincronizar":
            self.ressincronizar(id_, it, demanda)
        elif acao == "triar":
            self.triar(id_, it, demanda)
        elif acao == "acompanhar" and it.get("alvo") == "triando":
            if it.get("fase") == "despachando":
                self.retomar_triagem(id_, it, demanda)
            elif it.get("fase") == "triando" and it.get("runId"):
                self.acompanhar_triagem(id_, it, demanda)
        elif acao == "planejar":
            self.contando_erros(id_, it, lambda: self.planejar(id_, it, demanda))
        elif acao == "esperar_sessao":
            self.esperar_sessao(id_, it)
        elif acao == "acompanhar" and it.get("alvo") == "planejando" and it.get("fase") == "planejando":
            self.contando_erros(id_, it, lambda: self.acompanhar_plano(id_, it, demanda))
        elif acao in ("desenhar", "refazer_desenho"):
            self.desenhar(id_, it, demanda)
        elif acao == "acompanhar" and it.get("alvo") == "desenhando" and it.get("fase") == "desenhando":
            self.contando_erros(id_, it, lambda: self.acompanhar_desenho(id_, it, demanda), campo="erroDoDesenho", travar=self.travar_desenho_por_erro(id_, it))
        elif acao == "mergear_desenho":
            self.contando_erros(id_, it, lambda: self.mergear_desenho(id_, it, demanda), campo="erroDoDesenho", travar=self.travar_merge_por_erro(id_, it))
        elif acao == "soltar_plano":
            # quem solta a entrada da fila é `aplicar_na_fila` (no `_passo_fila`); aqui só a marca local
            it["segurado"] = False
            self.salvar()
        elif acao == "testar":
            self.testar(id_, it, demanda)
        elif acao == "acompanhar" and it.get("alvo") == "testando" and it.get("fase") == "testando":
            self.contando_erros(id_, it, lambda: self.acompanhar_teste(id_, it, demanda), campo="erroDoTeste", travar=self.travar_teste_por_erro(id_, it))
        elif acao == "corrigir":
            self.corrigir(id_, it, demanda)
        elif acao == "acompanhar" and it.get("fase") == "corrigindo":
            self.contando_erros(id_, it, lambda: self.acompanhar_correcao(id_, it, demanda), campo="erroDaCorrecao", travar=self.travar_correcao_por_erro(id_, it))
        elif acao == "entregar":
            self.entregar(id_, it, demanda)
        elif acao == "encerrar":
            self.encerrar(id_, it)

    def largar_triagem_superada(self, id_: str, it: dict, demanda: dict) -> None:
        """O Paulo decidiu (ou encerrou) a demanda com a triagem no meio: o run segue no Warren, mas não conta mais."""
        em_curso = it.get("alvo") == "triando" and (it.get("fase") == "despachando" or (it.get("fase") == "triando" and it.get("runId")))
        if em_curso and not _ainda_na_triagem(demanda):
            it.update(fase="triando", runId=None, alvo=None)
            it.pop("retryEsperado", None)
            self.salvar()
            self.eventos.append({"evento": "demanda_triagem_superada", "id": id_})

    def reabrir_separada(self, id_: str, it: dict) -> None:
        """O Paulo separou a demanda antes de o kit ver a junção: ela volta `recebida`, sem triagem, e é triada de novo.

        Só com retrato novo (`recebida`: o guardado é o de antes da junção), nada da demanda na caixa de saída, sem
        ressincronização pendente (a recusa do `juntar` segue por `ressincronizar`) e com a triagem local terminada.
        O sinal é o `juntando` (ainda sem recusa) ou o evento `separada` no retrato.
        """
        novo = it.get("recebida")
        if not isinstance(novo, dict) or not _ainda_na_triagem(novo):
            return
        if it.get("precisa_ressincronizar") or tem_pendente(self.estado, id_):
            return
        if it.get("fase") != "triando" or it.get("runId"):
            return
        separada = any(isinstance(e, dict) and e.get("tipo") == "separada" for e in novo.get("eventos") or [])
        if not separada and not (it.get("juntando") and not it.get("juntarRecusado")):
            return
        for campo in ("juntando", "juntarRecusado", "triagem", "triagemRecusada"):
            it.pop(campo, None)
        # tentativa nova: a chave de idempotência da triagem anterior devolveria o run antigo
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        it.update(fase="nova", alvo=None, tentativa=tentativa + 1)
        self.salvar()
        self.eventos.append({"evento": "demanda_separada", "id": id_})

    def ressincronizar(self, id_: str, it: dict, demanda: dict) -> None:
        """Um evento da demanda saiu da caixa sem o Flow aplicar: refaz a fase local pelo retrato.

        Na triagem: depois de um `juntar` (`juntando`), a demanda ainda `recebida` recebe a triagem guardada (uma vez
        só, `juntarRecusado`). Fora disso, a demanda ainda `recebida` com a triagem já decidida vai para a decisão do
        Paulo com um `triagem_falhou` (uma vez só; recusado de novo, fica onde está, com o aviso da recusa). Nas outras etapas,
        só limpa a marca (as Tasks 4 a 8 refazem as suas fases).
        """
        it["precisa_ressincronizar"] = False
        terminada = it.get("fase") == "triando" and not it.get("runId")
        if _ainda_na_triagem(demanda) and terminada and it.get("juntando") and not it.get("juntarRecusado") and isinstance(it.get("triagem"), dict):
            # o Flow recusou o `juntar` (ou o `ligar_erros` antes dele, com a junção ainda por vir no retrato):
            # a demanda recebe a triagem guardada, uma vez só; recusada também, cai no ramo de baixo
            it["juntarRecusado"] = True
            enfileirar_evento(self.estado, id_, "triagem", it["triagem"], agora=self.agora_texto)
        elif _ainda_na_triagem(demanda) and terminada and not it.get("triagemRecusada"):
            it["triagemRecusada"] = True
            enfileirar_evento(self.estado, id_, "triagem_falhou", {"motivo": MOTIVO_TRIAGEM_RECUSADA}, agora=self.agora_texto)
        elif _ainda_no_planejamento(demanda) and it.get("fase") == "plano_no_repo" and not it.get("planoRecusado"):
            # o plano está no repositório, mas o Flow não aplicou o `plano_criado`: a demanda vai para o Paulo
            it["planoRecusado"] = True
            url = it.get("prUrl") if isinstance(it.get("prUrl"), str) else None
            enfileirar_evento(self.estado, id_, "travada", {"motivo": MOTIVO_PLANO_RECUSADO, "url": url}, agora=self.agora_texto)
        elif _ainda_no_planejamento(demanda) and it.get("fase") == "esperando_paulo":
            # a trava do plano não pegou no Flow: nada se replaneja sozinho (sem retomada), só o aviso
            self.aviso("demandas:plano:%s" % id_, "Demandas: o Flow recusou a trava do plano da demanda %s; confira a demanda" % id_[:8])
        elif _marco(demanda) == "desenho" and not demanda.get("encerrada") and it.get("fase") == "desenho_enviado":
            d = _dados_do_desenho(it)
            enviada = d.get("versao") if isinstance(d.get("versao"), int) else 0
            if _versao_do_desenho(demanda) < enviada and (demanda.get("espera") or {}).get("tipo") != "planejar_comigo":
                # o Flow não aplicou o arquivo ou o `desenho_pronto`: a demanda vai para o Paulo (uma vez por versão)
                if not it.get("desenhoRecusado"):
                    it.update(desenhoRecusado=True, fase="esperando_paulo", inicio=self.agora_texto, travaDoDesenho=True)
                    enfileirar_evento(self.estado, id_, "travada", {"motivo": MOTIVO_DESENHO_RECUSADO, "url": d.get("prUrl")}, agora=self.agora_texto)
                else:
                    self.aviso_do_desenho(id_)
        elif it.get("fase") == "desenho_enviado" and _passou_do_desenho(demanda) and not demanda.get("encerrada") and not it.get("travaDoDesenho"):
            # o `desenho_pronto` (ou o arquivo) recusado com a etapa já adiante: o merge só vale para a versão aprovada
            self.versao_aprovada_e_a_enviada(id_, it, demanda)
        elif it.get("travaDoDesenho") and not demanda.get("encerrada") and (
            (_marco(demanda) == "desenho" and it.get("fase") == "esperando_paulo") or it.get("fase") == "desenho_enviado"
        ):
            # a trava do desenho (ou do merge dele) não pegou no Flow: nada se refaz sozinho, só o aviso
            self.aviso_do_desenho(id_)
        elif self.teste_sem_resposta_do_flow(it, demanda):
            # o Flow não aplicou uma captura ou o `teste`: a demanda vai para o Paulo (uma vez); a retomada testa de novo
            if not it.get("testeRecusado"):
                it.update(testeRecusado=True, fase="esperando_paulo", inicio=self.agora_texto, travaDoTeste=True)
                enfileirar_evento(self.estado, id_, "travada", {"motivo": MOTIVO_TESTE_RECUSADO, "url": _dados(it, "teste").get("prUrl")}, agora=self.agora_texto)
            else:
                self.aviso_do_teste(id_)
        elif it.get("travaDoTeste") and it.get("fase") == "esperando_paulo" and _marco(demanda) == "testada" and not demanda.get("encerrada"):
            self.aviso_do_teste(id_)  # a trava do teste não pegou no Flow: nada se refaz sozinho, só o aviso
        elif it.get("fase") == "corrigindo" and not demanda.get("encerrada") and _marco(demanda) in ("desenvolvida", "testada"):
            c = _dados(it, "correcao")
            if c.get("mergeado") and _marco(demanda) == "desenvolvida" and not it.get("correcaoRecusada"):
                # a correção está no branch padrão, mas o Flow não aplicou a conclusão: a demanda vai para o Paulo (uma vez)
                it.update(correcaoRecusada=True, travaDaCorrecao=True, inicio=self.agora_texto)
                enfileirar_evento(self.estado, id_, "travada", {"motivo": MOTIVO_CORRECAO_RECUSADA, "url": c.get("prUrl")}, agora=self.agora_texto)
            else:
                self.aviso_do_teste(id_)
        elif it.get("travaDaPublicacao") and _marco(demanda) == "entregue" and not demanda.get("encerrada"):
            # a trava da publicação não pegou no Flow: nada se publica sozinho (sem retomada), só o aviso
            self.aviso("demandas:entrega:%s" % id_, "Demandas: o Flow recusou a trava da publicação da demanda %s; confira a demanda" % id_[:8])
        elif it.get("fase") == "entregando" and _marco(demanda) == "entregue" and not demanda.get("encerrada"):
            # o Flow não aplicou o `entregue`: mandar de novo seria recusado outra vez; só o aviso
            self.aviso("demandas:entrega:%s" % id_, "Demandas: o Flow recusou a entrega da demanda %s; confira a demanda" % id_[:8])
        elif _marco(demanda) == "desenvolvida" and it.get("fase") in ("plano_no_repo", "desenvolvendo") and not demanda.get("encerrada"):
            if it.get("desenvolvida"):
                # o plano terminou, mas o Flow não aplicou a conclusão: a demanda vai para o Paulo (uma vez)
                if not it.get("desenvolvidaRecusada"):
                    it["desenvolvidaRecusada"] = True
                    enfileirar_evento(self.estado, id_, "travada", {"motivo": MOTIVO_DESENVOLVIDA_RECUSADA, "url": None}, agora=self.agora_texto)
            else:
                # `travada`/`destravada` da pausa recusados: mandar de novo seria recusado outra vez; só o aviso
                self.aviso(
                    "demandas:desenvolvimento:%s" % id_,
                    "Demandas: o Flow recusou o aviso de pausa (ou de retomada) do plano da demanda %s; confira a demanda" % id_[:8],
                )
        self.salvar()

    # ------------------------------------------------------------ entrega

    def prs_do_plano(self, id_: str, it: dict, demanda: dict) -> list[str]:
        """Os PRs mergeados das seeds do plano da demanda (até `LIMITE_PRS`); plano ilegível ou sumido: nenhum."""
        entrada = _entrada_da_demanda(self.estado.get("fila"), id_, it, demanda)
        plano_id = entrada["id"] if entrada is not None else it.get("planoNaFila")
        if self.raiz is None or not isinstance(plano_id, str) or not plano_id:
            return []
        estado = retrato_.ler_planos(self.raiz / DIR_PLANOS, [plano_id])[plano_id]["estado"]
        seeds = estado.get("seeds") if isinstance(estado, dict) and isinstance(estado.get("seeds"), dict) else {}
        prs = []
        for seed in seeds.values():
            pr = seed.get("pr") if isinstance(seed, dict) and seed.get("estado") == "mergeada" else None
            if retrato_.url_do_github(pr) and pr not in prs:
                prs.append(pr)
        return prs[:LIMITE_PRS]

    def pedir_a_publicacao(self, id_: str, it: dict, demanda: dict) -> bool:
        """Pede a publicação da demanda ao Flow (uma vez: a marca `pedida` vai ao disco logo depois). `False`: falha
        transitória, o pedido e o `entregue` esperam o ciclo seguinte. Sem token, ou sem a fila de publicação
        (`404`), ou com recusa definitiva: segue só com o `entregue` (os dois últimos com um aviso)."""
        if self.publicacao is not None:
            titulo = demanda.get("titulo") if isinstance(demanda.get("titulo"), str) else ""
            publicacao = demanda.get("publicacao") if isinstance(demanda.get("publicacao"), dict) else {}
            try:
                self.pedir_publicacao(
                    repo=demanda["repositorio"],
                    descricao=(titulo.strip() or "demanda %s" % id_[:8])[:LIMITE_DESCRICAO],
                    url=self.publicacao["url"],
                    token_file=self.publicacao["token_file"],
                    modo=publicacao.get("modo"),
                    demanda=id_,
                )
            except FalhaDeEnvio as falha:
                if falha.codigo not in RECUSAS_DA_PUBLICACAO:
                    self.aviso("demandas:publicacao-envio", "Demandas: o pedido de publicação da demanda %s falhou (%s); tenta no próximo ciclo" % (id_[:8], falha))
                    return False
                self.aviso(
                    "demandas:publicacao:%s" % id_,
                    "Demandas: o Flow recusou o pedido de publicação da demanda %s (%s); confira a publicação no projeto" % (id_[:8], falha),
                )
        it["pedida"] = True
        self.salvar()  # a marca no disco antes do evento: um reinício não pede duas vezes
        return True

    def entregar(self, id_: str, it: dict, demanda: dict) -> None:
        """A etapa `entregue`: pede a publicação (com o modo da demanda) e envia o `entregue` com os PRs, uma vez.

        Só chega aqui depois do teste no navegador (ou sem ele, nas demandas sem tela): o Flow só põe a demanda na
        etapa `entregue` depois da `testada`. O evento e a fase `entregando` vão ao disco juntos. Antes do pedido,
        `publicacao_liberada` pode levar a demanda ao Paulo em vez de publicar."""
        if not it.get("pedida"):
            if self.publicacao is not None and not self.publicacao_liberada(id_, it, demanda):
                return
            if not self.pedir_a_publicacao(id_, it, demanda):
                return
        enfileirar_evento(self.estado, id_, "entregue", {"prs": self.prs_do_plano(id_, it, demanda)}, agora=self.agora_texto)
        it.update(fase="entregando", inicio=self.agora_texto)
        self.salvar()
        self.eventos.append({"evento": "demanda_entregue", "id": id_})

    def publicacao_liberada(self, id_: str, it: dict, demanda: dict) -> bool:
        """A entrega pode pedir a publicação sozinha? Não quando a cópia de um contrato externo não bate com a origem,
        quando o relatório final do plano ou o `teste.json` trazem `publicar: false`, ou quando o último teste rodou só
        contra a simulação do back-end: a demanda vai ao Paulo numa `travada` (uma vez). A retomada dele depois da trava
        publica mesmo assim (`publicacaoLiberada`); Encerrar não publica (a demanda sai como `descartada`)."""
        if it.get("publicacaoLiberada"):
            return True
        if it.get("travaDaPublicacao"):
            if not _retomada_nova(it, demanda):
                return False  # o Paulo ainda não decidiu
            it.update(publicacaoLiberada=True, travaDaPublicacao=False)
            self.salvar()
            return True
        motivo = self.motivo_para_nao_publicar(id_, it, demanda)
        if motivo is None:
            return True
        cabe = 300 - len(CAUDA_DA_PUBLICACAO) - 1
        motivo = (motivo if len(motivo) <= cabe else motivo[: cabe - 1].rstrip() + "…") + " " + CAUDA_DA_PUBLICACAO
        enfileirar_evento(self.estado, id_, "travada", {"motivo": motivo, "url": None}, agora=self.agora_texto)
        it.update(fase="esperando_paulo", inicio=self.agora_texto, travaDaPublicacao=True)
        self.salvar()
        self.eventos.append({"evento": "demanda_publicacao_segurada", "id": id_, "motivo": motivo})
        return False

    def motivo_para_nao_publicar(self, id_: str, it: dict, demanda: dict):
        """O primeiro motivo para não publicar sozinho (o contrato, o relatório final, o teste), ou `None`."""
        repo = demanda["repositorio"]
        ref = self.forja.branch_padrao(repo)
        contratos, torto = self.contratos_do_repo(repo, ref)
        if torto is not None:
            return MOTIVO_CONTRATOS_TORTOS % torto
        divergencias = contratos_externos.conferir(self.forja, repo, ref, contratos)
        if divergencias:
            return MOTIVO_CONTRATO_MUDOU % "; ".join(divergencias).rstrip(".")
        relatorio = self.relatorio_final(id_, it, demanda, ref)
        if isinstance(relatorio, str) and _PUBLICAR_FALSE.search(relatorio):
            m = _MOTIVO_DE_NAO_PUBLICAR.search(relatorio)
            texto = _resumo_do_teste(m.group(1)) if m else None
            return MOTIVO_RELATORIO_NAO_PUBLICAR % (texto or MOTIVO_SEM_MOTIVO_DE_NAO_PUBLICAR)[:LIMITE_MOTIVO_DE_NAO_PUBLICAR].rstrip(".")
        t = it.get("teste") if isinstance(it.get("teste"), dict) else {}
        if t.get("enviado") and t.get("publicar") is False:
            return MOTIVO_TESTE_NAO_PUBLICAR % (t.get("motivoDeNaoPublicar") or MOTIVO_SEM_MOTIVO_DE_NAO_PUBLICAR).rstrip(".")
        if t.get("enviado") and t.get("contra") == "simulacao":
            return MOTIVO_SO_SIMULACAO
        return None

    def relatorio_final(self, id_: str, it: dict, demanda: dict, ref: str):
        """O `relatorio-final.md` do plano da demanda no branch padrão (a pasta é a da feature do plano na fila)."""
        entrada = _entrada_da_demanda(self.estado.get("fila"), id_, it, demanda)
        feature = entrada.get("feature") if isinstance(entrada, dict) else None
        if not isinstance(feature, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", feature):
            return None
        return self.forja.arquivo(demanda["repositorio"], ref, CAMINHO_DO_RELATORIO_FINAL % feature)

    def contratos_do_repo(self, repo: str, ref: str | None = None):
        """`(contratosExternos, None)` da `.fabrica/config.json` do branch padrão (ausente: `[]`), ou `([], motivo)`
        quando a config ou a lista estão tortas."""
        bruto = self.forja.arquivo(repo, ref or self.forja.branch_padrao(repo), CAMINHO_CONFIG_DO_REPO)
        if bruto is None:
            return [], None
        try:
            config = json.loads(bruto)
        except ValueError:
            return [], "config ilegível"
        if not isinstance(config, dict):
            return [], "config ilegível"
        try:
            return contratos_externos.validar(config.get("contratosExternos")), None
        except ValueError as exc:
            return [], str(exc)

    def encerrar(self, id_: str, it: dict) -> None:
        """A demanda acabou (entregue ou orientada) e a saída dela esvaziou (quem decide é `proxima_acao`): o item sai
        do estado e `<raiz>/demandas/<id>/` é apagada. Com run superado ainda vivo o item fica, segurando a vaga."""
        if _run_superado_vivo(it) or isinstance(it.get("runSuperado"), dict):
            return
        id_ = _id_valido(id_)
        if self.raiz is not None:
            shutil.rmtree(self.raiz / "demandas" / id_, ignore_errors=True)
        capacidade.sincronizar(self.capacidade, chave(id_), set())
        del self.sec["itens"][id_]
        self.salvar()
        self.eventos.append({"evento": "demanda_encerrada", "id": id_})

    # ------------------------------------------------------------ desenvolvimento

    def pausa_do_plano(self, id_do_plano: str) -> str:
        """O motivo da pausa da fábrica no `estado.json` do plano; sem ele (unit parada ou falha): "plano pausado"."""
        if self.raiz is not None:
            with contextlib.suppress(Exception):
                pausa = despachante._dict(despachante._ler_json(self.raiz / DIR_PLANOS / id_do_plano / despachante.ARQ_ESTADO)).get("pausado")
                if isinstance(pausa, str) and pausa.strip():
                    return pausa.strip()[:300]
        return MOTIVO_PLANO_PAUSADO

    def seguir_desenvolvimento(self, id_: str, it: dict, demanda: dict) -> None:
        """A entrada da fila do plano da demanda: `ativo` → `desenvolvendo`; `pausado` → `travada` (uma vez) e de volta
        a `ativo` → `destravada`; `concluido` → `etapa_concluida {marco: "desenvolvida"}` (uma vez).

        Roda antes de `proxima_acao`: com a demanda `travada` pela pausa, a ação é `nada`, mas a volta do plano ainda
        tem de chegar ao Flow.
        """
        fase = it.get("fase")
        if fase not in ("plano_no_repo", "desenvolvendo") or it.get("desenvolvida") or demanda.get("encerrada"):
            return
        entrada = _entrada_da_demanda(self.estado.get("fila"), id_, it, demanda)
        situacao = entrada.get("estado") if entrada is not None else None
        if situacao not in ("ativo", "pausado", "concluido"):
            return
        if fase == "plano_no_repo":
            it.update(fase="desenvolvendo", planoNaFila=entrada["id"])
            self.salvar()
            self.eventos.append({"evento": "demanda_desenvolvendo", "id": id_, "plano": entrada["id"]})
        if situacao == "pausado":
            if not it.get("travadaPelaPausa"):
                it["travadaPelaPausa"] = True
                enfileirar_evento(self.estado, id_, "travada", {"motivo": self.pausa_do_plano(entrada["id"]), "url": None}, agora=self.agora_texto)
                self.salvar()
                self.eventos.append({"evento": "demanda_plano_pausado", "id": id_, "plano": entrada["id"]})
            return
        if it.get("travadaPelaPausa"):
            it["travadaPelaPausa"] = False
            enfileirar_evento(self.estado, id_, "destravada", {}, agora=self.agora_texto)
            self.salvar()
            self.eventos.append({"evento": "demanda_plano_retomado", "id": id_, "plano": entrada["id"]})
        if situacao == "concluido":
            it["desenvolvida"] = True
            if _marco(demanda) == "desenvolvida":  # o Paulo pode ter concluído a etapa: o Flow recusaria
                enfileirar_evento(self.estado, id_, "etapa_concluida", {"marco": "desenvolvida"}, agora=self.agora_texto)
            self.salvar()
            self.eventos.append({"evento": "demanda_desenvolvida", "id": id_, "plano": entrada["id"]})

    # ------------------------------------------------------------ triagem

    def desde(self, it: dict):
        inicio = _instante(it.get("inicio"))
        return _texto_do_instante(inicio - despachante.MARGEM_DESDE) if inicio is not None else None

    def estourou(self, it: dict) -> bool:
        inicio = _instante(it.get("inicio"))
        return inicio is None or (self.agora - inicio).total_seconds() > TETO_TRIAGEM_S

    def projeto_de(self, demanda: dict):
        """O projeto do Warren do repositório da demanda; fora de `fila.json`: `None`, com um aviso por repositório."""
        repo = demanda.get("repositorio")
        projeto = self.projetos.get(str(repo).lower())
        if projeto is None:
            self.aviso("demandas:sem-projeto:%s" % repo, "Demandas: %s não tem projeto do Warren em fila.json" % repo)
        return projeto

    def sem_modelo(self, papel: str) -> None:
        self.aviso("demandas:modelo:%s" % papel, "Demandas: configure modelos.%s (agente, modelo, maxCustoUsd) em fabrica/modelos/config.json do kit" % papel)

    def triar(self, id_: str, it: dict, demanda: dict) -> None:
        projeto = self.projeto_de(demanda)
        if projeto is None:
            return
        if self.modelo_da_triagem is None:
            self.sem_modelo(PAPEL_DA_TRIAGEM)
            return
        if capacidade.ler(self.capacidade).get("drenagem"):
            return  # o Warren vai reiniciar: espera o próximo ciclo (a triagem não ocupa vaga, mas é um run)
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        it.update(fase="despachando", alvo="triando", projeto=projeto, nonce=nonce_do_motor(id_, "triagem", tentativa), inicio=self.agora_texto, runId=None)
        it.pop("retryEsperado", None)
        self.salvar()  # antes do POST pago: um coordenador que morra daqui em diante acha o run pelo nonce
        self.despachar_triagem(id_, it, demanda)

    def despachar_triagem(self, id_: str, it: dict, demanda: dict) -> None:
        modelo = self.modelo_da_triagem
        run_id = self.motor.despachar_run(
            projeto=it["projeto"],
            agente=modelo["agente"],
            modelo=modelo["modelo"],
            prompt=despachante._com_nonce(prompts.prompt_triagem(demanda=demanda), it["nonce"]),
            branch_existente=None,
            max_custo_usd=modelo["maxCustoUsd"],
            chave_idempotencia=it["nonce"],
        )
        self.com_run(id_, it, run_id)

    def com_run(self, id_: str, it: dict, run_id: str) -> None:
        it.update(fase="triando", runId=run_id)
        self.salvar()
        self.eventos.append({"evento": "demanda_triagem", "id": id_, "runId": run_id})

    def retomar_triagem(self, id_: str, it: dict, demanda: dict) -> None:
        """`despachando` herdado (o POST pode ter criado o run): adota pelo nonce ou repete com a mesma chave."""
        try:
            run_id = self.motor.procurar_run(it["projeto"], it["nonce"], self.desde(it))
        except Exception:
            if self.estourou(it):
                self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)
                return
            raise
        if run_id is not None:
            self.com_run(id_, it, run_id)
        elif self.estourou(it):
            self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)
        elif self.modelo_da_triagem is not None:
            self.despachar_triagem(id_, it, demanda)

    def acompanhar_triagem(self, id_: str, it: dict, demanda: dict) -> None:
        try:
            run = self.motor.run(it["runId"])
        except Exception as exc:
            if despachante._eh_404(exc):
                self.falhou(id_, it, MOTIVO_AGENTE % MOTIVO_RUN_SUMIU)
            elif self.estourou(it):
                self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)
            else:
                raise
            return
        run = despachante._dict(run)
        situacao = run.get("estado")
        if situacao == "failed" and run.get("motivoFalha") in motor_.MOTIVOS_INFRA_PERDIDA and not it.get("retryDe"):
            if self.esperar_retry(id_, it, run):
                return
        if situacao == "succeeded":
            texto = self.motor.ultimo_texto(it["runId"])
            triagem = prompts.extrair_triagem(texto)
            if triagem is None:
                self.falhou(id_, it, MOTIVO_SEM_FORMATO)
            else:
                self.concluir(id_, it, "triagem", triagem, cruzamento=prompts.extrair_cruzamento(texto, demanda.get("candidatas")))
        elif situacao in despachante.TERMINAIS_DE_RUN:
            self.falhou(id_, it, MOTIVO_AGENTE % despachante.motivo_do_run_falho(run)[:LIMITE_MOTIVO_DO_AGENTE])
        elif self.estourou(it):
            self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)

    def esperar_retry(self, id_: str, it: dict, run: dict) -> bool:
        """R2 (como nos consertos): adota o retry do Warren ou espera; `False` = o Warren não refez, vale o run falho."""
        original = it["runId"]
        resultado, valor = despachante.esperar_retry_do_item(
            it, motor=self.motor, projeto=it["projeto"], nonces=[it["nonce"]], desde=self.desde(it), agora=self.agora, salvar=self.salvar
        )
        if resultado == "desistir":
            return False
        if resultado == "adotado":
            self.eventos.append({"evento": "demanda_retry_adotado", "id": id_, "original": original, "runId": valor})
        elif self.estourou(it):
            self.falhou(id_, it, MOTIVO_TETO_TRIAGEM)
        elif resultado == "busca_falhou":
            self.erro(id_, valor)
        return True

    def concluir(self, id_: str, it: dict, tipo: str, dados: dict, *, cruzamento: dict | None = None) -> None:
        """Os eventos vão para a caixa de saída e a triagem fecha no mesmo `salvar` (`triando` sem `runId`).

        Com o `cruzamento` da triagem (`prompts.extrair_cruzamento`), a ordem é: `ligar_erros`, se houver; depois
        `juntar`, que vem no lugar da triagem (guardada em `it["triagem"]` com `juntando`, para a ressincronização
        mandá-la se o Flow recusar a junção), ou `dividir` seguido da `triagem`, ou só a `triagem`.
        """
        c = cruzamento or {}
        enviados = []
        if tipo == "triagem" and c.get("ligarErros"):
            enviados.append(("ligar_erros", c["ligarErros"]))
        if tipo == "triagem" and c.get("juntar"):
            enviados.append(("juntar", c["juntar"]))
            it["juntando"] = True
        else:
            if tipo == "triagem" and c.get("dividir"):
                enviados.append(("dividir", c["dividir"]))
            enviados.append((tipo, dados))
        for tipo_, dados_ in enviados:
            enfileirar_evento(self.estado, id_, tipo_, dados_, agora=self.agora_texto)
        if tipo == "triagem":
            it["triagem"] = dados  # o retrato do Flow não traz a triagem; o plano a leva no contexto
        it.update(fase="triando", runId=None)
        it.pop("retryEsperado", None)
        self.salvar()
        evento = {"evento": "demanda_%s" % tipo, "id": id_, "destino": dados.get("destino"), "motivo": dados.get("motivo")}
        cruzados = [t for t, _ in enviados if t != tipo]
        if cruzados:
            evento["cruzamento"] = cruzados
        self.eventos.append(evento)

    def falhou(self, id_: str, it: dict, motivo: str) -> None:
        self.concluir(id_, it, "triagem_falhou", {"motivo": motivo[:300]})

    # ------------------------------------------------------------ plano

    def largar_plano_superado(self, id_: str, it: dict, demanda: dict) -> None:
        """O Paulo mexeu na demanda (encerrou, parou ou passou da etapa) com o plano no meio: solta a trava, o run não conta."""
        if it.get("alvo") == "planejando" and it.get("fase") == "planejando" and not _ainda_no_planejamento(demanda):
            # `esperando_paulo` com `inicio` novo: a retomada do Paulo (se a etapa ainda for a do plano) planeja de novo.
            # O run segue no Warren (o motor não cancela run): a trava fica até ele terminar (`seguir_run_superado`).
            tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
            self.sair_do_planejamento(id_, it, vivo=True, fase="esperando_paulo", alvo=None, inicio=self.agora_texto, tentativa=tentativa + 1)
            self.eventos.append({"evento": "demanda_plano_superado", "id": id_})

    def seguir_run_superado(self, id_: str, it: dict) -> None:
        """O run do plano que não conta mais: solta a trava quando ele termina (ou some), ou passada a folga do teto."""
        sup = it.get("runSuperado")
        if not isinstance(sup, dict):
            return
        inicio = _instante(sup.get("inicio"))
        terminou = inicio is None or (self.agora - inicio).total_seconds() > TETO_PLANO_S + FOLGA_DO_RUN_SUPERADO_S
        if not terminou:
            try:
                run_id = sup.get("runId") or self.motor.procurar_run(sup.get("projeto"), sup.get("nonce"), self.desde(sup))
                if run_id is None:
                    terminou = True  # o POST não criou o run
                else:
                    sup["runId"] = run_id
                    terminou = despachante._dict(self.motor.run(run_id)).get("estado") in despachante.TERMINAIS_DE_RUN
            except Exception as exc:  # noqa: BLE001 - busca falha não solta; o 404 é run sumido
                terminou = despachante._eh_404(exc)
                if not terminou:
                    self.erro(id_, exc)
        if terminou:
            if isinstance(it.get("repo"), str):
                capacidade.soltar_orquestrador(self.capacidade, it["repo"], chave(id_))
            it.pop("runSuperado", None)
            self.salvar()
            self.eventos.append({"evento": "demanda_trava_do_plano_solta", "id": id_, "runId": sup.get("runId")})
        else:
            self.salvar()

    def contando_erros(self, id_: str, it: dict, acao, *, campo: str = "erroDoPlano", travar=None) -> None:
        """O mesmo erro `LIMITE_ERROS_DO_PLANO` ciclos seguidos vira `travada`; um ciclo sem erro zera.

        `travar(vezes, texto)` trava e devolve `True`, ou `False` se a fase já não é a do erro (sem ele: a do plano).
        """
        try:
            acao()
        except Exception as exc:
            texto = ("%s: %s" % (type(exc).__name__, exc))[:200]
            anterior = it.get(campo) if isinstance(it.get(campo), dict) else {}
            vezes = (anterior.get("vezes") or 0) + 1 if anterior.get("erro") == texto else 1
            it[campo] = {"erro": texto, "vezes": vezes}
            if vezes >= LIMITE_ERROS_DO_PLANO and (travar or self.travar_plano_por_erro(id_, it))(vezes, texto):
                it.pop(campo, None)
                self.salvar()
                self.erro(id_, exc)
                return
            self.salvar()
            raise
        if it.pop(campo, None) is not None:
            self.salvar()

    def travar_plano_por_erro(self, id_: str, it: dict):
        def travar(vezes, texto):
            if it.get("fase") != "planejando" or it.get("alvo") != "planejando":
                return False
            self.travar_plano(id_, it, MOTIVO_ERRO_REPETIDO % (vezes, texto), it.get("prUrl"), vivo=not it.get("prUrl"))
            return True

        return travar

    def adotar_plano_da_sessao(self, id_: str, it: dict, demanda: dict) -> None:
        """"Planejar comigo": o plano entregue pela sessão (`POST /api/demandas/<id>/plano`) chega no retrato."""
        caminho = (demanda.get("plano") or {}).get("caminho") if isinstance(demanda.get("plano"), dict) else None
        if it.get("fase") == "esperando_sessao" and isinstance(caminho, str) and caminho:
            prurl = demanda["plano"].get("prUrl")
            it.update(fase="plano_no_repo", plano=caminho, prUrl=prurl if isinstance(prurl, str) else None)
            self.salvar()
            self.eventos.append({"evento": "demanda_plano_da_sessao", "id": id_, "plano": caminho})

    def esperar_sessao(self, id_: str, it: dict) -> None:
        """"Planejar comigo": a Fábrica não despacha nada; o plano vem da sessão do Paulo."""
        if it.get("fase") != "esperando_sessao":
            it.update(fase="esperando_sessao", runId=None, alvo=None)
            self.salvar()
            self.eventos.append({"evento": "demanda_esperando_sessao", "id": id_})

    def planejar(self, id_: str, it: dict, demanda: dict) -> None:
        if isinstance(it.get("pergunta"), str):
            # a retomada responde a pergunta do orquestrador: a troca vai no contexto de todo planejamento seguinte
            conversa = [c for c in it.get("conversa") or [] if isinstance(c, dict)]
            conversa.append({"pergunta": it.pop("pergunta"), "resposta": _resposta_da_retomada(it, demanda)})
            it["conversa"] = conversa[-prompts.LIMITE_CONVERSA :]
            self.salvar()
        nivel = demanda.get("nivel")
        if nivel not in NIVEIS_SEM_SESSAO:
            if nivel != "planejar_comigo":
                self.aviso("demandas:nivel:%s" % id_, "Demandas: a demanda %s tem nível %r; o plano espera o Paulo" % (id_[:8], nivel))
            self.esperar_sessao(id_, it)  # nunca planeja sozinho fora dos níveis da lista
            return
        if isinstance(it.get("runSuperado"), dict):
            return  # o run anterior ainda vive no Warren: um orquestrador por vez no repositório
        projeto = self.projeto_de(demanda)
        if projeto is None:
            return
        if self.modelo_do_plano is None:
            self.sem_modelo(PAPEL_DO_PLANO)
            return
        if capacidade.ler(self.capacidade).get("drenagem"):
            return
        repo = demanda["repositorio"]
        if not capacidade.tomar_orquestrador(self.capacidade, repo, chave(id_)):
            return  # outro plano do repositório tem a trava: o próximo ciclo tenta de novo (na espera FIFO)
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        it.update(fase="planejando", alvo="planejando", projeto=projeto, repo=repo, semPr=0, prUrl=None, runId=None)
        it.pop("ciPendenteDesde", None)
        self.novo_run_do_plano(id_, it, demanda, tentativa)

    def novo_run_do_plano(self, id_: str, it: dict, demanda: dict, tentativa: int) -> None:
        it.update(tentativa=tentativa, nonce=nonce_do_motor(id_, "plano", tentativa), inicio=self.agora_texto, runId=None)
        self.salvar()  # antes do POST pago: um coordenador que morra daqui em diante acha o run pelo nonce
        self.despachar_plano(id_, it, demanda)

    def despachar_plano(self, id_: str, it: dict, demanda: dict) -> None:
        modelo = self.modelo_do_plano
        prompt = prompts.prompt_plano_da_demanda(demanda=demanda, triagem=it.get("triagem") or {}, conversa=it.get("conversa"))
        run_id = self.motor.despachar_run(
            projeto=it["projeto"],
            agente=modelo["agente"],
            modelo=modelo["modelo"],
            prompt=despachante._com_nonce(prompt, it["nonce"]),
            branch_existente=None,
            max_custo_usd=modelo["maxCustoUsd"],
            chave_idempotencia=it["nonce"],
        )
        it["runId"] = run_id
        self.salvar()
        self.eventos.append({"evento": "demanda_plano", "id": id_, "runId": run_id})

    def acompanhar_plano(self, id_: str, it: dict, demanda: dict) -> None:
        if it.get("prUrl"):
            self.guardar_merge(id_, it, demanda)
            return
        inicio = _instante(it.get("inicio"))
        if inicio is None or (self.agora - inicio).total_seconds() > TETO_PLANO_S:
            self.travar_plano(id_, it, MOTIVO_TETO_PLANO, None, vivo=True)
        elif it.get("runId"):
            self.acompanhar_run_do_plano(id_, it, demanda)
        else:
            self.retomar_plano(id_, it, demanda)

    def retomar_plano(self, id_: str, it: dict, demanda: dict) -> None:
        """Sem `runId` (o POST pode ter criado o run): adota pelo nonce ou repete com a mesma chave."""
        if not capacidade.tomar_orquestrador(self.capacidade, it["repo"], chave(id_), em_curso=True):
            return
        run_id = self.motor.procurar_run(it["projeto"], it["nonce"], self.desde(it))
        if run_id is not None:
            it["runId"] = run_id
            self.salvar()
        elif self.modelo_do_plano is not None:
            self.despachar_plano(id_, it, demanda)

    def acompanhar_run_do_plano(self, id_: str, it: dict, demanda: dict) -> None:
        try:
            run = despachante._dict(self.motor.run(it["runId"]))
        except Exception as exc:
            if not despachante._eh_404(exc):
                raise
            run = {"estado": "failed", "prUrl": None}  # o run sumiu do Warren: conta como sem PR
        if run.get("estado") not in despachante.TERMINAIS_DE_RUN:
            return
        pr_url = run.get("prUrl")
        if isinstance(pr_url, str) and pr_url:
            it["prUrl"] = pr_url
            self.salvar()
            self.guardar_merge(id_, it, demanda)
            return
        sem_pr = (it.get("semPr") if isinstance(it.get("semPr"), int) else 0) + 1
        it["semPr"] = sem_pr
        if sem_pr >= TENTATIVAS_SEM_PR or self.modelo_do_plano is None:
            self.travar_plano(id_, it, MOTIVO_SEM_PR, None)
        else:
            self.novo_run_do_plano(id_, it, demanda, it["tentativa"] + 1)

    def config_do_repo(self, repo: str):
        """`(protegidos, ciObrigatorioNoPlano, ciObrigatorioNasSeeds)` da `.fabrica/config.json` do branch padrão, nunca
        do head do PR (que poderia reescrevê-la para passar). Ausente: sem protegidos extras, CI opcional no plano e
        obrigatório nas seeds (o padrão do despachante); ilegível: `None`."""
        bruto = self.forja.arquivo(repo, self.forja.branch_padrao(repo), CAMINHO_CONFIG_DO_REPO)
        if bruto is None:
            return [], False, True
        try:
            config = json.loads(bruto)
        except ValueError:
            return None
        if not isinstance(config, dict):
            return None
        protegidos = config.get("protegidos", [])
        obrigatorio = config.get("ciObrigatorioNoPlano", False)
        nas_seeds = config.get("ciObrigatorioNasSeeds", True)
        if not isinstance(protegidos, list) or not all(isinstance(g, str) and g for g in protegidos):
            return None
        if not isinstance(obrigatorio, bool) or not isinstance(nas_seeds, bool):
            return None
        return protegidos, obrigatorio, nas_seeds

    def motivo_do_plano(self, id_: str, repo: str, head: str, caminho: str):
        """O plano no head passa em `validar_plano` e é desta demanda; senão, o motivo."""
        bruto = self.forja.arquivo(repo, head, caminho)
        try:
            plano = json.loads(bruto) if isinstance(bruto, str) else None
        except ValueError:
            plano = None
        if not isinstance(plano, dict):
            return MOTIVO_PLANO_ILEGIVEL
        erros = raias.validar_plano(plano)
        if erros:
            return MOTIVO_PLANO_INVALIDO % erros[0]
        if plano.get("demanda") != id_:
            return MOTIVO_PLANO_DE_OUTRA % id_
        return None

    def guardar_merge(self, id_: str, it: dict, demanda: dict) -> None:
        """As guardas do merge do PR do plano, sempre no mesmo head: arquivos, config do repositório, plano e CI."""
        url = it["prUrl"]
        repo = it.get("repo") or demanda["repositorio"]
        caminho = prompts.caminho_do_plano_da_demanda(id_)
        try:
            pr = despachante._dict(self.forja.pr(url))
        except ValueError:  # o link que o run devolveu não é de um PR
            self.travar_plano(id_, it, MOTIVO_LINK_INVALIDO, None)
            return
        if pr.get("mergeado") is True:
            self.plano_criado(id_, it, caminho, url)  # mergeado num ciclo que caiu antes de gravar (ou pelo Paulo)
            return
        if pr.get("aberto") is not True:
            self.travar_plano(id_, it, MOTIVO_PR_FECHADO, url)
            return
        if str(pr.get("repo")).lower() != str(repo).lower():
            self.travar_plano(id_, it, MOTIVO_OUTRO_REPO, url)
            return
        if demanda.get("nivel") not in NIVEIS_SEM_SESSAO:
            motivo = MOTIVO_PLANEJAR_COMIGO if demanda.get("nivel") == "planejar_comigo" else MOTIVO_NIVEL
            self.travar_plano(id_, it, motivo, url)
            return
        arquivos, head = pr.get("arquivos"), pr.get("headSha")
        if not isinstance(arquivos, list) or not isinstance(head, str) or not head:
            raise RuntimeError("PR do plano ilegível")
        fora = [a for a in arquivos if not _permitido_ao_plano(a, caminho)]
        if fora:
            self.travar_plano(id_, it, MOTIVO_FORA % fora[0], url)
            return
        if CAMINHO_DA_PERGUNTA in arquivos:
            texto = self.forja.arquivo(repo, head, CAMINHO_DA_PERGUNTA)
            texto = texto[: prompts.LIMITE_PERGUNTA] if isinstance(texto, str) else ""
            self.travar_plano(id_, it, MOTIVO_PERGUNTA % _titulo_da_pergunta(texto), url)
            it["pergunta"] = texto or "(a pergunta está em %s no PR %s)" % (CAMINHO_DA_PERGUNTA, url)
            self.salvar()
            return
        if caminho not in arquivos:
            cobertura = CAMINHO_DA_COBERTURA % id_[:8]
            desfecho = desfecho_da_cobertura(self.forja.arquivo(repo, head, cobertura), id_) if cobertura in arquivos else None
            if desfecho is not None:
                self.travar_plano(id_, it, motivo_do_desfecho(desfecho), url, desfecho=desfecho)
            else:
                self.travar_plano(id_, it, MOTIVO_SEM_PLANO % caminho, url)
            return
        config = self.config_do_repo(repo)
        if config is None:
            self.travar_plano(id_, it, MOTIVO_CONFIG_ILEGIVEL, url)
            return
        protegidos, ci_obrigatorio, _ = config
        protegido = next((a for a in arquivos if any(globs.casa_glob(a, g) for g in protegidos)), None)
        if protegido is not None:
            self.travar_plano(id_, it, MOTIVO_PROTEGIDO % protegido, url)
            return
        motivo = self.motivo_do_plano(id_, repo, head, caminho)
        if motivo is not None:
            self.travar_plano(id_, it, motivo, url)
            return
        ci = self.forja.ci(repo, head)
        if ci == "pendente":
            desde = _instante(it.get("ciPendenteDesde"))
            if desde is None:
                it["ciPendenteDesde"] = self.agora_texto
                self.salvar()
            elif (self.agora - desde).total_seconds() > CI_PENDENTE_MAXIMO_S:
                self.travar_plano(id_, it, MOTIVO_CI_PENDENTE, url)
            return
        if ci == "ausente" and ci_obrigatorio:
            self.travar_plano(id_, it, MOTIVO_CI_OBRIGATORIO, url)
            return
        if ci not in ("verde", "ausente"):
            self.travar_plano(id_, it, MOTIVO_CI_VERMELHO, url)
            return
        if self.forja.mergear(url, head) is True:  # o GitHub recusa se o head andou desde a leitura
            self.plano_criado(id_, it, caminho, url)
        else:
            self.travar_plano(id_, it, MOTIVO_MERGE_RECUSADO, url)

    def sair_do_planejamento(self, id_: str, it: dict, *, vivo: bool = False, **campos) -> None:
        """Toda saída de `planejando`: solta a trava do orquestrador e grava (soltar duas vezes não faz mal).

        `vivo`: o run pode ainda estar rodando (superado, ou passou do teto). O motor não cancela run, então a trava
        fica com a demanda em `runSuperado` até o run terminar (`seguir_run_superado`); o resultado dele não conta.
        """
        if vivo and not it.get("prUrl") and (it.get("runId") or it.get("nonce")):
            it["runSuperado"] = {"runId": it.get("runId"), "nonce": it.get("nonce"), "projeto": it.get("projeto"), "inicio": it.get("inicio")}
        elif isinstance(it.get("repo"), str):
            capacidade.soltar_orquestrador(self.capacidade, it["repo"], chave(id_))
        it.update(runId=None, **campos)
        it.pop("ciPendenteDesde", None)
        self.salvar()

    def plano_criado(self, id_: str, it: dict, caminho: str, url: str) -> None:
        enfileirar_evento(self.estado, id_, "plano_criado", {"plano": caminho, "prUrl": url}, agora=self.agora_texto)
        self.sair_do_planejamento(id_, it, fase="plano_no_repo", alvo=None, plano=caminho, tentativa=0)
        self.eventos.append({"evento": "demanda_plano_criado", "id": id_, "plano": caminho, "prUrl": url})

    def travar_plano(self, id_: str, it: dict, motivo: str, url, *, vivo: bool = False, desfecho: dict | None = None) -> None:
        """`travada` para o Paulo; a retomada dele (depois do novo `inicio`) planeja de novo com um nonce novo.

        `desfecho`: o orquestrador concluiu que não há plano (duplicada, já resolvida); vai no evento para o Flow.
        """
        dados = {"motivo": motivo[:300], "url": url}
        if desfecho is not None:
            dados["desfecho"] = desfecho
        enfileirar_evento(self.estado, id_, "travada", dados, agora=self.agora_texto)
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        self.sair_do_planejamento(id_, it, vivo=vivo, fase="esperando_paulo", alvo=None, prUrl=url, inicio=self.agora_texto, tentativa=tentativa + 1)
        self.eventos.append({"evento": "demanda_plano_travado", "id": id_, "motivo": motivo})


    # ------------------------------------------------------------ desenho

    def aviso_do_desenho(self, id_: str) -> None:
        self.aviso("demandas:desenho:%s" % id_, "Demandas: o Flow recusou o desenho (ou a trava dele) da demanda %s; confira a demanda" % id_[:8])

    def desenhar(self, id_: str, it: dict, demanda: dict) -> None:
        """Um run do `ux-ui` (vaga `demanda:<id>` na raia `ux-ui`) para a versão seguinte do desenho.

        Sem vaga (ou com o run superado ainda vivo) espera o ciclo seguinte. O ajuste e a retomada reaproveitam o branch
        do PR anterior. O nonce é `versão + tentativa`, com a `tentativa` subindo a cada run: nunca repete na demanda.
        """
        if _run_superado_vivo(it):
            return  # o run anterior ainda vive no Warren: nunca dois runs da demanda
        d = _dados_do_desenho(it)
        versao = _versao_do_desenho(demanda)
        if it.get("fase") == "desenho_enviado" and isinstance(d.get("versao"), int) and versao < d["versao"]:
            return  # o retrato ainda não tem a versão que o kit mandou (a busca não trouxe a demanda de novo)
        projeto = self.projeto_de(demanda)
        if projeto is None:
            return
        if self.modelo_do_desenho is None:
            self.sem_modelo(PAPEL_DO_DESENHO)
            return
        if capacidade.ler(self.capacidade).get("drenagem"):
            return
        if not capacidade.reservar(self.capacidade, chave(id_), PAPEL_DO_DESENHO, mem_disponivel_mb=self.mem_disponivel_mb):
            return  # sem vaga: o próximo ciclo tenta de novo (a urgente vem primeiro na ordem)
        d.update(base=versao, invalido=None, semPr=0, terminou=False)
        d.pop("ciPendenteDesde", None)
        it.update(fase="desenhando", alvo="desenhando", projeto=projeto, repo=demanda["repositorio"], desenho=d, travaDoDesenho=False, desenhoRecusado=False)
        it.pop("erroDoDesenho", None)
        self.novo_run_do_desenho(id_, it, demanda)

    def novo_run_do_desenho(self, id_: str, it: dict, demanda: dict) -> None:
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        base = it["desenho"]["base"]
        it.update(nonce=nonce_do_motor(id_, "desenho", base + tentativa), tentativa=tentativa + 1, inicio=self.agora_texto, runId=None)
        it["desenho"]["terminou"] = False
        self.salvar()  # antes do POST pago: um coordenador que morra daqui em diante acha o run pelo nonce
        self.despachar_desenho(id_, it, demanda)

    def despachar_desenho(self, id_: str, it: dict, demanda: dict) -> None:
        modelo = self.modelo_do_desenho
        d = it["desenho"]
        prompt = prompts.prompt_desenho(demanda=demanda, triagem=it.get("triagem") or {}, ajustes=_ajustes(demanda), motivo_invalido=d.get("invalido"))
        run_id = self.motor.despachar_run(
            projeto=it["projeto"],
            agente=modelo["agente"],
            modelo=modelo["modelo"],
            prompt=despachante._com_nonce(prompt, it["nonce"]),
            branch_existente=d.get("branch") if isinstance(d.get("branch"), str) and d.get("branch") else None,
            max_custo_usd=modelo["maxCustoUsd"],
            chave_idempotencia=it["nonce"],
        )
        it["runId"] = run_id
        self.salvar()
        self.eventos.append({"evento": "demanda_desenho", "id": id_, "runId": run_id})

    def acompanhar_desenho(self, id_: str, it: dict, demanda: dict) -> None:
        d = _dados_do_desenho(it)
        inicio = _instante(it.get("inicio"))
        if inicio is None or (self.agora - inicio).total_seconds() > TETO_RUN_S:
            self.travar_desenho(id_, it, MOTIVO_TETO_RUN, d.get("prUrl"), vivo=True)
            return
        if not it.get("runId"):
            # o POST pode ter criado o run: adota pelo nonce ou repete com a mesma chave
            run_id = self.motor.procurar_run(it["projeto"], it["nonce"], self.desde(it))
            if run_id is not None:
                it["runId"] = run_id
                self.salvar()
            elif self.modelo_do_desenho is not None:
                self.despachar_desenho(id_, it, demanda)
            return
        try:
            run = despachante._dict(self.motor.run(it["runId"]))
        except Exception as exc:
            if not despachante._eh_404(exc):
                raise
            run = {"estado": "failed", "prUrl": None}  # o run sumiu do Warren: conta como sem PR
        if run.get("estado") not in despachante.TERMINAIS_DE_RUN:
            return
        if not d.get("terminou"):
            d["terminou"] = True  # daqui em diante a vaga não espera mais o run
            self.salvar()
        pr_url = run.get("prUrl") or self.pr_que_andou(d)
        if isinstance(pr_url, str) and pr_url:
            self.conferir_desenho(id_, it, demanda, pr_url)
            return
        d["semPr"] = (d.get("semPr") if isinstance(d.get("semPr"), int) else 0) + 1
        if d["semPr"] >= TENTATIVAS_SEM_PR or self.modelo_do_desenho is None:
            self.travar_desenho(id_, it, MOTIVO_DESENHO_SEM_PR, d.get("prUrl"))
        else:
            self.novo_run_do_desenho(id_, it, demanda)

    def pr_que_andou(self, dados: dict):
        """O PR já conhecido, se o run rodou no branch dele e o head andou desde a última conferência; senão `None`.

        Num branch que já tem PR, o Warren devolve o run sem `prUrl`: o trabalho está no head do mesmo PR. Um run que
        termina em `no_changes` depois de outro que já empurrou também cai aqui, pelo head que mudou.
        """
        url, branch, visto = dados.get("prUrl"), dados.get("branch"), dados.get("headSha")
        if not (isinstance(url, str) and url and isinstance(branch, str) and branch and isinstance(visto, str)):
            return None
        try:
            pr = despachante._dict(self.forja.pr(url))
        except ValueError:
            return None
        head = pr.get("headSha")
        return url if pr.get("branch") == branch and isinstance(head, str) and head and head != visto else None

    def conferir_desenho(self, id_: str, it: dict, demanda: dict, pr_url: str) -> None:
        """O PR do run: só o `desenho.html`, e o HTML do head passa em `validar_desenho`; inválido refaz uma vez."""
        d = it["desenho"]
        repo = it.get("repo") or demanda["repositorio"]
        caminho = prompts.caminho_do_desenho(id_)
        try:
            pr = despachante._dict(self.forja.pr(pr_url))
        except ValueError:  # o link que o run devolveu não é de um PR
            self.travar_desenho(id_, it, MOTIVO_LINK_DO_DESENHO, d.get("prUrl"))
            return
        if str(pr.get("repo")).lower() != str(repo).lower():
            self.travar_desenho(id_, it, MOTIVO_DESENHO_OUTRO_REPO, pr_url)
            return
        if pr.get("aberto") is not True:
            self.travar_desenho(id_, it, MOTIVO_PR_DO_DESENHO_FECHADO, pr_url)
            return
        arquivos, head, branch = pr.get("arquivos"), pr.get("headSha"), pr.get("branch")
        if not isinstance(arquivos, list) or not isinstance(head, str) or not head or not isinstance(branch, str) or not branch:
            raise RuntimeError("PR do desenho ilegível")
        d.update(prUrl=pr_url, branch=branch, headSha=head)
        self.salvar()
        fora = [a for a in arquivos if a != caminho]
        if fora:
            self.travar_desenho(id_, it, MOTIVO_DESENHO_FORA % (caminho, str(fora[0])[:200]), pr_url)
            return
        dados = self.forja.arquivo_bruto(repo, head, caminho)
        motivo = MOTIVO_SEM_DESENHO % caminho if dados is None else validar_desenho(dados)
        if motivo is None:
            self.enviar_desenho(id_, it, bytes(dados))
        elif d.get("invalido") is None:
            d["invalido"] = motivo  # refaz uma vez, no mesmo branch, com o motivo no prompt
            d["semPr"] = 0
            self.novo_run_do_desenho(id_, it, demanda)
        else:
            self.travar_desenho(id_, it, MOTIVO_NAO_AUTOCONTIDO % motivo, pr_url)

    def enviar_desenho(self, id_: str, it: dict, dados: bytes) -> None:
        """O arquivo e o `desenho_pronto` vão à caixa de saída (nessa ordem) e a vaga é solta, no mesmo `salvar`."""
        d = it["desenho"]
        arquivo_id = enfileirar_arquivo(self.estado, self.raiz, id_, tipo="desenho", nome="desenho.html", conteudo="text/html", dados=dados, tela=None)
        enfileirar_evento(self.estado, id_, "desenho_pronto", {"arquivoId": arquivo_id}, agora=self.agora_texto)
        d["versao"] = (d.get("base") if isinstance(d.get("base"), int) else 0) + 1
        self.sair_do_desenho(id_, it, fase="desenho_enviado")
        self.eventos.append({"evento": "demanda_desenho_pronto", "id": id_, "versao": d["versao"], "prUrl": d.get("prUrl")})

    def sair_do_desenho(self, id_: str, it: dict, *, vivo: bool = False, **campos) -> None:
        """Toda saída de `desenhando`: solta a vaga e grava. `vivo`: o run pode estar rodando (o motor não cancela run);
        a vaga fica com a demanda em `desenhoSuperado` até ele terminar (`seguir_desenho_superado`)."""
        d = _dados_do_desenho(it)
        if vivo and not d.get("terminou") and (it.get("runId") or it.get("nonce")):
            it["desenhoSuperado"] = {"runId": it.get("runId"), "nonce": it.get("nonce"), "projeto": it.get("projeto"), "inicio": it.get("inicio")}
        else:
            capacidade.sincronizar(self.capacidade, chave(id_), set())
        it.update(runId=None, alvo=None, **campos)
        self.salvar()

    def travar_desenho(self, id_: str, it: dict, motivo: str, url, *, vivo: bool = False) -> None:
        """`travada` para o Paulo; a retomada dele (depois do novo `inicio`) desenha de novo com um nonce novo."""
        enfileirar_evento(self.estado, id_, "travada", {"motivo": motivo[:300], "url": url}, agora=self.agora_texto)
        self.sair_do_desenho(id_, it, vivo=vivo, fase="esperando_paulo", inicio=self.agora_texto, travaDoDesenho=True)
        self.eventos.append({"evento": "demanda_desenho_travado", "id": id_, "motivo": motivo})

    def travar_desenho_por_erro(self, id_: str, it: dict):
        def travar(vezes, texto):
            if it.get("fase") != "desenhando" or it.get("alvo") != "desenhando":
                return False
            self.travar_desenho(id_, it, MOTIVO_ERRO_DO_DESENHO % (vezes, texto), _dados_do_desenho(it).get("prUrl"), vivo=True)
            return True

        return travar

    def largar_desenho_superado(self, id_: str, it: dict, demanda: dict) -> None:
        """O Paulo mexeu na demanda (encerrou, travou ou passou da etapa) com o desenho no meio: o run não conta mais."""
        if it.get("alvo") == "desenhando" and it.get("fase") == "desenhando" and not _ainda_no_desenho(demanda):
            fase = "plano_no_repo" if _passou_do_desenho(demanda) and not demanda.get("encerrada") else "esperando_paulo"
            self.sair_do_desenho(id_, it, vivo=True, fase=fase, inicio=self.agora_texto)
            self.eventos.append({"evento": "demanda_desenho_superado", "id": id_})

    def seguir_desenho_superado(self, id_: str, it: dict) -> None:
        for campo in RUNS_SUPERADOS:
            self.seguir_superado(id_, it, campo)

    def seguir_superado(self, id_: str, it: dict, campo: str) -> None:
        """O run (desenho, teste ou correção) que não conta mais: solta a vaga quando ele termina (ou some), ou passada
        a folga do teto. Enquanto ele vive, nenhuma fase da demanda despacha outro run (`_run_superado_vivo`)."""
        sup = it.get(campo)
        if not isinstance(sup, dict):
            return
        inicio = _instante(sup.get("inicio"))
        terminou = inicio is None or (self.agora - inicio).total_seconds() > TETO_RUN_S + FOLGA_DO_RUN_SUPERADO_S
        if not terminou:
            try:
                run_id = sup.get("runId") or self.motor.procurar_run(sup.get("projeto"), sup.get("nonce"), self.desde(sup))
                if run_id is None:
                    terminou = True  # o POST não criou o run
                else:
                    sup["runId"] = run_id
                    terminou = despachante._dict(self.motor.run(run_id)).get("estado") in despachante.TERMINAIS_DE_RUN
            except Exception as exc:  # noqa: BLE001 - busca falha não solta; o 404 é run sumido
                terminou = despachante._eh_404(exc)
                if not terminou:
                    self.erro(id_, exc)
        if terminou:
            it.pop(campo, None)
            # nenhum run novo reservou a vaga (toda fase com vaga espera o superado), e nenhum outro superado a segura
            if not (it.get("fase") in FASES_COM_VAGA and it.get("alvo") == it.get("fase")) and not _run_superado_vivo(it):
                capacidade.sincronizar(self.capacidade, chave(id_), set())
            self.salvar()
            self.eventos.append({"evento": "demanda_vaga_solta", "id": id_, "campo": campo, "runId": sup.get("runId")})
        else:
            self.salvar()

    def mergear_desenho(self, id_: str, it: dict, demanda: dict) -> None:
        """O Paulo aprovou (ou o nível dispensou): o PR do desenho entra no branch padrão, no head que foi enviado, antes
        de o plano ser solto da fila. Trava (CI vermelho, PR mudado ou fechado) espera a retomada do Paulo."""
        if it.get("travaDoDesenho") and not _retomada_nova(it, demanda):
            return
        d = _dados_do_desenho(it)
        url, head = d.get("prUrl"), d.get("headSha")
        plano = demanda.get("plano") if isinstance(demanda.get("plano"), dict) else {}
        if not isinstance(url, str) or not isinstance(head, str):
            self.desenho_no_repo(id_, it, merge=False)
            return
        if demanda.get("nivel") == "planejar_comigo" and plano.get("artefato"):
            # o desenho aprovado é o artefato da sessão; o do kit foi recusado: o PR dele fica para o Paulo
            self.aviso(
                "demandas:desenho:%s" % id_,
                "Demandas: o desenho da demanda %s foi aprovado pelo artefato da sessão; o PR do desenho do kit não é mergeado" % id_[:8],
            )
            self.desenho_no_repo(id_, it, merge=False)
            return
        if not self.versao_aprovada_e_a_enviada(id_, it, demanda):
            return
        repo = it.get("repo") or demanda["repositorio"]
        pr = despachante._dict(self.forja.pr(url))
        if pr.get("mergeado") is True:
            self.desenho_no_repo(id_, it, merge=True)  # mergeado num ciclo que caiu antes de gravar (ou pelo Paulo)
            return
        if pr.get("aberto") is not True:
            self.travar_merge(id_, it, MOTIVO_PR_DO_DESENHO_FECHADO, url)
            return
        if pr.get("headSha") != head:
            self.travar_merge(id_, it, MOTIVO_DESENHO_MUDOU, url)
            return
        ci = self.forja.ci(repo, head)
        if ci == "pendente":
            desde = _instante(d.get("ciPendenteDesde"))
            if desde is None:
                d["ciPendenteDesde"] = self.agora_texto
                self.salvar()
            elif (self.agora - desde).total_seconds() > CI_PENDENTE_MAXIMO_S:
                self.travar_merge(id_, it, MOTIVO_CI_DO_DESENHO_PENDENTE, url)
            return
        if ci not in ("verde", "ausente"):
            self.travar_merge(id_, it, MOTIVO_CI_DO_DESENHO, url)
            return
        if self.forja.mergear(url, head) is True:  # o GitHub recusa se o head andou desde a leitura
            self.desenho_no_repo(id_, it, merge=True)
        else:
            self.travar_merge(id_, it, MOTIVO_MERGE_DO_DESENHO, url)

    def versao_aprovada_e_a_enviada(self, id_: str, it: dict, demanda: dict) -> bool:
        """Só mergeia o que o Paulo aprovou: `desenho.aprovada` do retrato igual à versão que o kit enviou. A etapa
        concluída sem aprovar, ou uma versão que o Flow nunca recebeu, vai a `plano_no_repo` sem merge, com um aviso."""
        enviada = _dados_do_desenho(it).get("versao")
        aprovada = (demanda.get("desenho") or {}).get("aprovada") if isinstance(demanda.get("desenho"), dict) else None
        if isinstance(enviada, int) and not isinstance(aprovada, bool) and aprovada == enviada:
            return True
        self.aviso(
            "demandas:desenho:%s" % id_,
            "Demandas: a etapa do desenho da demanda %s passou sem a aprovação da versão %s enviada (aprovada: %s); o PR do desenho não é mergeado"
            % (id_[:8], enviada, aprovada),
        )
        self.desenho_no_repo(id_, it, merge=False)
        return False

    def desenho_no_repo(self, id_: str, it: dict, *, merge: bool) -> None:
        """Fim do desenho: a demanda volta a `plano_no_repo` e o acompanhamento do desenvolvimento começa."""
        d = _dados_do_desenho(it)
        d.pop("ciPendenteDesde", None)
        d["mergeado"] = merge  # o teste no navegador compara com o desenho só se ele chegou ao branch padrão
        it.update(fase="plano_no_repo", travaDoDesenho=False, desenho=d)
        self.salvar()
        self.eventos.append({"evento": "demanda_desenho_mergeado" if merge else "demanda_desenho_sem_merge", "id": id_, "prUrl": d.get("prUrl")})

    def travar_merge(self, id_: str, it: dict, motivo: str, url) -> None:
        """`travada` com a demanda já em `desenvolvida`: a fase fica `desenho_enviado` e a retomada tenta o merge de novo."""
        enfileirar_evento(self.estado, id_, "travada", {"motivo": motivo[:300], "url": url}, agora=self.agora_texto)
        d = _dados_do_desenho(it)
        d.pop("ciPendenteDesde", None)
        it.update(travaDoDesenho=True, inicio=self.agora_texto, desenho=d)
        self.salvar()
        self.eventos.append({"evento": "demanda_desenho_travado", "id": id_, "motivo": motivo})

    def travar_merge_por_erro(self, id_: str, it: dict):
        def travar(vezes, texto):
            if it.get("fase") != "desenho_enviado":
                return False
            self.travar_merge(id_, it, MOTIVO_ERRO_DO_DESENHO % (vezes, texto), _dados_do_desenho(it).get("prUrl"))
            return True

        return travar

    # ------------------------------------------------------------ teste no navegador

    def aviso_do_teste(self, id_: str) -> None:
        self.aviso("demandas:teste:%s" % id_, "Demandas: o Flow recusou o teste (ou a trava, ou a correção) da demanda %s; confira a demanda" % id_[:8])

    def teste_sem_resposta_do_flow(self, it: dict, demanda: dict) -> bool:
        """O `teste` foi enviado e o retrato segue em `testada`, sem espera e sem retomada depois do envio."""
        t = it.get("teste") if isinstance(it.get("teste"), dict) else {}
        return (
            it.get("fase") == "testando"
            and bool(t.get("enviado"))
            and _marco(demanda) == "testada"
            and not demanda.get("encerrada")
            and not demanda.get("espera")
            and not _retomada_nova({"inicio": t.get("enviadoEm")}, demanda)
        )

    def testar(self, id_: str, it: dict, demanda: dict) -> None:
        """Um run do `qa` (vaga `demanda:<id>` na raia `qa`): sobe o sistema no próprio run, percorre a demanda num
        navegador e devolve um PR em rascunho com o `teste.json` e as capturas. Sem vaga (ou com um run superado da
        demanda ainda vivo) espera o ciclo seguinte."""
        if _run_superado_vivo(it):
            return  # o run anterior ainda vive no Warren: nunca dois runs da demanda
        projeto = self.projeto_de(demanda)
        if projeto is None:
            return
        if self.modelo_do_teste is None:
            self.sem_modelo(PAPEL_DO_TESTE)
            return
        if capacidade.ler(self.capacidade).get("drenagem"):
            return
        if not capacidade.reservar(self.capacidade, chave(id_), PAPEL_DO_TESTE, mem_disponivel_mb=self.mem_disponivel_mb):
            return
        it.update(
            fase="testando",
            alvo="testando",
            projeto=projeto,
            repo=demanda["repositorio"],
            teste={"semPr": 0, "terminou": False, "refeito": False},
            travaDoTeste=False,
            testeRecusado=False,
            falhaDoTeste=False,
        )
        it.pop("erroDoTeste", None)
        self.novo_run_do_teste(id_, it, demanda)

    def novo_run_do_teste(self, id_: str, it: dict, demanda: dict) -> None:
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        it.update(nonce=nonce_do_motor(id_, "teste", tentativa), tentativa=tentativa + 1, inicio=self.agora_texto, runId=None)
        it["teste"]["terminou"] = False
        self.salvar()  # antes do POST pago: um coordenador que morra daqui em diante acha o run pelo nonce
        self.despachar_teste(id_, it, demanda)

    def despachar_teste(self, id_: str, it: dict, demanda: dict) -> None:
        modelo = self.modelo_do_teste
        t = it["teste"]
        d = it.get("desenho") if isinstance(it.get("desenho"), dict) else {}
        desenho = prompts.caminho_do_desenho(id_) if d.get("mergeado") is True else None
        prompt = prompts.prompt_teste_no_navegador(demanda=demanda, desenho=desenho, refazer=bool(t.get("refeito")), rodadas=it.get("rodadas"))
        branch = t.get("branch") if t.get("refeito") and isinstance(t.get("branch"), str) and t.get("branch") else None
        run_id = self.motor.despachar_run(
            projeto=it["projeto"],
            agente=modelo["agente"],
            modelo=modelo["modelo"],
            prompt=despachante._com_nonce(prompt, it["nonce"]),
            branch_existente=branch,
            max_custo_usd=modelo["maxCustoUsd"],
            chave_idempotencia=it["nonce"],
        )
        it["runId"] = run_id
        self.salvar()
        self.eventos.append({"evento": "demanda_teste", "id": id_, "runId": run_id})

    def acompanhar_teste(self, id_: str, it: dict, demanda: dict) -> None:
        t = _dados(it, "teste")
        inicio = _instante(it.get("inicio"))
        if inicio is None or (self.agora - inicio).total_seconds() > TETO_RUN_S:
            self.travar_teste(id_, it, MOTIVO_TETO_RUN, t.get("prUrl"), vivo=True)
            return
        if not it.get("runId"):
            # o POST pode ter criado o run: adota pelo nonce ou repete com a mesma chave
            run_id = self.motor.procurar_run(it["projeto"], it["nonce"], self.desde(it))
            if run_id is not None:
                it["runId"] = run_id
                self.salvar()
            elif self.modelo_do_teste is not None:
                self.despachar_teste(id_, it, demanda)
            return
        try:
            run = despachante._dict(self.motor.run(it["runId"]))
        except Exception as exc:
            if not despachante._eh_404(exc):
                raise
            run = {"estado": "failed", "prUrl": None}  # o run sumiu do Warren: conta como sem PR
        if run.get("estado") not in despachante.TERMINAIS_DE_RUN:
            return
        if not t.get("terminou"):
            t["terminou"] = True  # daqui em diante a vaga não espera mais o run
            self.salvar()
        pr_url = run.get("prUrl") or (self.pr_que_andou(t) if t.get("refeito") else None)
        if isinstance(pr_url, str) and pr_url:
            self.conferir_teste(id_, it, demanda, pr_url)
            return
        t["semPr"] = (t.get("semPr") if isinstance(t.get("semPr"), int) else 0) + 1
        if t["semPr"] >= TENTATIVAS_SEM_PR or self.modelo_do_teste is None:
            self.travar_teste(id_, it, MOTIVO_TESTE_SEM_PR, t.get("prUrl"))
        else:
            self.novo_run_do_teste(id_, it, demanda)

    def conferir_teste(self, id_: str, it: dict, demanda: dict, pr_url: str) -> None:
        """O PR do run: só `.fabrica/demandas/<id>/**`, com o `teste.json` e capturas das duas telas; sem elas, refaz uma
        vez no mesmo branch e, na segunda, trava. `nao_subiu` trava com o motivo do qa."""
        t = it["teste"]
        repo = it.get("repo") or demanda["repositorio"]
        pasta = prompts.pasta_da_demanda(id_)
        try:
            pr = despachante._dict(self.forja.pr(pr_url))
        except ValueError:  # o link que o run devolveu não é de um PR
            self.travar_teste(id_, it, MOTIVO_LINK_DO_TESTE, t.get("prUrl"))
            return
        if str(pr.get("repo")).lower() != str(repo).lower():
            self.travar_teste(id_, it, MOTIVO_TESTE_OUTRO_REPO, pr_url)
            return
        if pr.get("aberto") is not True:
            self.travar_teste(id_, it, MOTIVO_PR_DO_TESTE_FECHADO, pr_url)
            return
        arquivos, head, branch = pr.get("arquivos"), pr.get("headSha"), pr.get("branch")
        if not isinstance(arquivos, list) or not isinstance(head, str) or not head or not isinstance(branch, str) or not branch:
            raise RuntimeError("PR do teste ilegível")
        t.update(prUrl=pr_url, branch=branch, headSha=head)
        self.salvar()
        fora = [a for a in arquivos if not _na_pasta(a, pasta)]
        if fora:
            self.travar_teste(id_, it, MOTIVO_TESTE_FORA % (pasta, str(fora[0])[:200]), pr_url)
            return
        resultado = ler_resultado_do_teste(self.forja, repo, head, id_)
        if resultado is not None and resultado["resultado"] == "nao_subiu":
            self.travar_teste(id_, it, MOTIVO_NAO_SUBIU % resultado["resumo"][:250], pr_url)
            return
        telas = {c["tela"] for c in resultado["capturas"]} if resultado is not None else set()
        if {"desktop", "celular"} <= telas:
            self.enviar_teste(id_, it, resultado)
        elif not t.get("refeito"):
            t.update(refeito=True, semPr=0)  # refaz uma vez, no mesmo branch, com o motivo no prompt
            self.novo_run_do_teste(id_, it, demanda)
        else:
            self.travar_teste(id_, it, MOTIVO_SEM_CAPTURAS, pr_url)

    def enviar_teste(self, id_: str, it: dict, resultado: dict) -> None:
        """Cada captura e depois o `teste` vão à caixa de saída, a vaga é solta e o PR em rascunho é fechado."""
        t = it["teste"]
        capturas, de_fora = _capturas_no_limite(resultado["capturas"])
        ids = [
            enfileirar_arquivo(
                self.estado, self.raiz, id_, tipo="captura", nome=c["caminho"].rsplit("/", 1)[-1], conteudo="image/png", dados=c["dados"], tela=c["tela"]
            )
            for c in capturas
        ]
        resumo = original = resultado["resumo"]
        # o Paulo lê no Flow contra o quê o teste rodou; a nota e a frase sempre cabem no limite do `resumo`
        sufixo = (NOTA_CAPTURAS_DE_FORA % de_fora if de_fora else "") + (
            "\n\n" + FRASE_DO_CONTRA[resultado["contra"]] if resultado.get("contra") in FRASE_DO_CONTRA else ""
        )
        if sufixo:
            resumo = prompts._cortar_utf16(resumo, prompts.LIMITE_RESUMO_DO_TESTE - len(sufixo.encode("utf-16-le")) // 2) + sufixo
        resultado = dict(resultado, resumo=resumo)
        dados = {"resultado": resultado["resultado"], "resumo": resumo, "capturas": ids}
        enfileirar_evento(self.estado, id_, "teste", dados, agora=self.agora_texto)
        t.update(
            enviado=True,
            enviadoEm=self.agora_texto,
            resultado=resultado["resultado"],
            resumo=resultado["resumo"],
            detalhes=resultado.get("detalhes"),
            contra=resultado.get("contra"),
            publicar=resultado.get("publicar", True),
            motivoDeNaoPublicar=resultado.get("motivoDeNaoPublicar"),
            fecharPr=True,
        )
        if resultado["resultado"] == "falhou":
            self.registrar_rodada(it, dict(resultado, resumo=original))  # a rodada guarda o texto do qa
        self.sair_do_teste(id_, it, fase="testando")
        self.eventos.append({"evento": "demanda_teste_enviado", "id": id_, "resultado": resultado["resultado"], "prUrl": t.get("prUrl")})
        self.fechar_pr_do_teste(id_, it)

    def fechar_pr_do_teste(self, id_: str, it: dict) -> None:
        """O PR em rascunho do teste nunca é mergeado: fecha com um comentário, depois do envio (repete se falhar)."""
        t = it.get("teste") if isinstance(it.get("teste"), dict) else {}
        if not t.get("fecharPr") or not isinstance(t.get("prUrl"), str):
            return
        try:
            self.forja.fechar_pr(t["prUrl"], COMENTARIO_DO_TESTE)
        except Exception as exc:  # noqa: BLE001 - o ciclo seguinte tenta de novo; o teste já está na saída
            self.erro(id_, exc)
            return
        t.pop("fecharPr", None)
        self.salvar()

    def seguir_teste(self, id_: str, it: dict, demanda: dict) -> None:
        """Antes da decisão: fecha o PR do teste que ficou aberto e reconhece a segunda falha (o Flow espera o Paulo).

        A segunda falha é a espera `teste_falhou` no retrato, ou (sem o kit ver a espera) a etapa ainda `testada`, sem
        espera, com uma retomada depois do envio do `teste` falho. A fase vai a `esperando_paulo` com o `inicio` no
        envio, e `falhaDoTeste` diz a `proxima_acao` que a retomada é para corrigir.
        """
        t = it.get("teste")
        if not isinstance(t, dict):
            return
        self.fechar_pr_do_teste(id_, it)
        if it.get("fase") != "testando" or it.get("alvo") or not t.get("enviado") or t.get("resultado") != "falhou":
            return
        if demanda.get("encerrada") or _marco(demanda) != "testada" or it.get("precisa_ressincronizar"):
            return
        espera = (demanda.get("espera") or {}).get("tipo")
        if espera == "teste_falhou" or (espera is None and _retomada_nova({"inicio": t.get("enviadoEm")}, demanda)):
            it.update(fase="esperando_paulo", inicio=t.get("enviadoEm") or self.agora_texto, falhaDoTeste=True)
            self.salvar()
            self.eventos.append({"evento": "demanda_teste_falhou_de_novo", "id": id_})

    def sair_do_teste(self, id_: str, it: dict, *, vivo: bool = False, **campos) -> None:
        """Toda saída do run do teste: solta a vaga e grava. `vivo`: o run pode estar rodando; a vaga fica com a demanda
        em `testeSuperado` até ele terminar (`seguir_superado`)."""
        t = _dados(it, "teste")
        if vivo and not t.get("terminou") and (it.get("runId") or it.get("nonce")):
            it["testeSuperado"] = {"runId": it.get("runId"), "nonce": it.get("nonce"), "projeto": it.get("projeto"), "inicio": it.get("inicio")}
        else:
            capacidade.sincronizar(self.capacidade, chave(id_), set())
        it.update(runId=None, alvo=None, **campos)
        self.salvar()

    def travar_teste(self, id_: str, it: dict, motivo: str, url, *, vivo: bool = False) -> None:
        """`travada` para o Paulo; a retomada dele (depois do novo `inicio`) testa de novo com um nonce novo."""
        enfileirar_evento(self.estado, id_, "travada", {"motivo": motivo[:300], "url": url}, agora=self.agora_texto)
        self.sair_do_teste(id_, it, vivo=vivo, fase="esperando_paulo", inicio=self.agora_texto, travaDoTeste=True)
        self.eventos.append({"evento": "demanda_teste_travado", "id": id_, "motivo": motivo})

    def travar_teste_por_erro(self, id_: str, it: dict):
        def travar(vezes, texto):
            if it.get("fase") != "testando" or it.get("alvo") != "testando":
                return False
            self.travar_teste(id_, it, MOTIVO_ERRO_DO_TESTE % (vezes, texto), _dados(it, "teste").get("prUrl"), vivo=True)
            return True

        return travar

    def largar_teste_superado(self, id_: str, it: dict, demanda: dict) -> None:
        """O Paulo mexeu na demanda (encerrou, travou ou passou da etapa) com o teste no meio: o run não conta mais."""
        em_curso = it.get("alvo") == "testando" and it.get("fase") == "testando"
        if em_curso and not (_marco(demanda) == "testada" and not demanda.get("espera") and not demanda.get("encerrada")):
            self.sair_do_teste(id_, it, vivo=True, fase="esperando_paulo", inicio=self.agora_texto)
            self.eventos.append({"evento": "demanda_teste_superado", "id": id_})

    def registrar_rodada(self, it: dict, resultado: dict) -> None:
        """A rodada que falhou entra em `rodadas` (o teste seguinte confere essas falhas primeiro, e a correção sabe o
        que já foi tentado). Fica só as `LIMITE_RODADAS` mais recentes."""
        rodadas = [r for r in (it.get("rodadas") or []) if isinstance(r, dict)]
        rodadas.append(
            {
                "resumo": prompts._cortar_utf16(resultado.get("resumo") or "", prompts.LIMITE_TEXTO_DA_RODADA),
                "detalhes": prompts._cortar_utf16(resultado["detalhes"], prompts.LIMITE_TEXTO_DA_RODADA) if resultado.get("detalhes") else None,
                "correcao": None,
            }
        )
        it["rodadas"] = rodadas[-LIMITE_RODADAS:]

    # ------------------------------------------------------------ correção do teste

    def corrigir(self, id_: str, it: dict, demanda: dict) -> None:
        """Um run do `frontend` (vaga `demanda:<id>` na raia `frontend`) a partir do branch padrão, com o resumo do
        teste falho. O Flow já decidiu que cabe a correção (a primeira falha, ou a retomada do Paulo na segunda)."""
        if _run_superado_vivo(it):
            return
        projeto = self.projeto_de(demanda)
        if projeto is None:
            return
        if self.modelo_da_correcao is None:
            self.sem_modelo(PAPEL_DA_CORRECAO)
            return
        if capacidade.ler(self.capacidade).get("drenagem"):
            return
        if not capacidade.reservar(self.capacidade, chave(id_), PAPEL_DA_CORRECAO, mem_disponivel_mb=self.mem_disponivel_mb):
            return
        teste = it.get("teste") if isinstance(it.get("teste"), dict) else {}
        resumo = teste.get("resumo") or (demanda.get("espera") or {}).get("motivo") or ""
        if teste.get("detalhes"):  # o `resumo` é o do Paulo; o técnico vai junto para quem corrige
            resumo = "%s\n\n%s" % (resumo, teste["detalhes"])
        it.update(
            fase="corrigindo",
            alvo="corrigindo",
            projeto=projeto,
            repo=demanda["repositorio"],
            correcao={"semPr": 0, "terminou": False, "resumo": resumo},
            travaDaCorrecao=False,
            falhaDoTeste=False,
            correcaoRecusada=False,
        )
        it.pop("erroDaCorrecao", None)
        self.novo_run_da_correcao(id_, it, demanda)

    def novo_run_da_correcao(self, id_: str, it: dict, demanda: dict) -> None:
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        it.update(nonce=nonce_do_motor(id_, "correcao", tentativa), tentativa=tentativa + 1, inicio=self.agora_texto, runId=None)
        it["correcao"]["terminou"] = False
        self.salvar()  # antes do POST pago
        self.despachar_correcao(id_, it, demanda)

    def despachar_correcao(self, id_: str, it: dict, demanda: dict) -> None:
        """O POST do run da correção (a partir do branch padrão) ou, com `correcao.conserto`, do conserto no branch do PR."""
        c = it["correcao"]
        rodadas = [r for r in (it.get("rodadas") or []) if isinstance(r, dict)]
        rodada = max(len(rodadas), 1)
        modelo = self.modelo_da_correcao
        if rodada >= prompts.RODADA_QUE_MUDA_DE_ABORDAGEM and self.modelo_do_plano is not None:
            modelo = self.modelo_do_plano  # o mesmo remendo voltou duas vezes: o modelo do orquestrador procura a causa
        conserto = c.get("conserto") if isinstance(c.get("conserto"), dict) else None
        if conserto is None:
            prompt = prompts.prompt_correcao_do_teste(demanda=demanda, resumo=c.get("resumo") or "", historico=rodadas[:-1], rodada=rodada)
            branch = None
        else:
            prompt = prompts.prompt_conserto_da_correcao(demanda=demanda, resumo=c.get("resumo") or "", achados=conserto.get("achados") or [], pr_url=c["prUrl"])
            branch = conserto["branch"]
        run_id = self.motor.despachar_run(
            projeto=it["projeto"],
            agente=modelo["agente"],
            modelo=modelo["modelo"],
            prompt=despachante._com_nonce(prompt, it["nonce"]),
            branch_existente=branch,
            max_custo_usd=modelo["maxCustoUsd"],
            chave_idempotencia=it["nonce"],
        )
        it["runId"] = run_id
        self.salvar()
        self.eventos.append({"evento": "demanda_correcao" if conserto is None else "demanda_conserto_da_correcao", "id": id_, "runId": run_id})

    def acompanhar_correcao(self, id_: str, it: dict, demanda: dict) -> None:
        c = _dados(it, "correcao")
        if it.get("travaDaCorrecao"):
            self.retomar_correcao(id_, it, demanda)
            return
        if it.get("alvo") != "corrigindo":
            return  # mergeada: o Flow volta (ou já está) em `testada`
        conserto = c.get("conserto") if isinstance(c.get("conserto"), dict) else None
        if c.get("prUrl") and conserto is None:
            self.conferir_correcao(id_, it, demanda)  # o run terminou: vale o teto do CI pendente
            return
        if conserto is not None and c.get("terminou"):
            self.fim_do_conserto(id_, it, demanda)  # o conserto terminou e o seguinte esperava a vaga (ou a drenagem)
            return
        inicio = _instante(it.get("inicio"))
        if inicio is None or (self.agora - inicio).total_seconds() > TETO_RUN_S:
            self.travar_correcao(id_, it, MOTIVO_TETO_RUN, c.get("prUrl"), vivo=True)
            return
        if not it.get("runId"):
            run_id = self.motor.procurar_run(it["projeto"], it["nonce"], self.desde(it))
            if run_id is not None:
                it["runId"] = run_id
                self.salvar()
            elif self.modelo_da_correcao is not None:
                self.despachar_correcao(id_, it, demanda)
            return
        try:
            run = despachante._dict(self.motor.run(it["runId"]))
        except Exception as exc:
            if not despachante._eh_404(exc):
                raise
            run = {"estado": "failed", "prUrl": None}
        if run.get("estado") not in despachante.TERMINAIS_DE_RUN:
            return
        if not c.get("terminou"):
            c["terminou"] = True
            self.salvar()
        if conserto is not None:
            self.fim_do_conserto(id_, it, demanda)
            return
        pr_url = run.get("prUrl")
        if isinstance(pr_url, str) and pr_url:
            c["prUrl"] = pr_url
            self.salvar()
            self.conferir_correcao(id_, it, demanda)
            return
        c["semPr"] = (c.get("semPr") if isinstance(c.get("semPr"), int) else 0) + 1
        if c["semPr"] >= TENTATIVAS_SEM_PR or self.modelo_da_correcao is None:
            self.travar_correcao(id_, it, MOTIVO_CORRECAO_SEM_PR, None)
        else:
            self.novo_run_da_correcao(id_, it, demanda)

    def retomar_correcao(self, id_: str, it: dict, demanda: dict) -> None:
        """A correção travou: só a retomada do Paulo (depois da trava) mexe. Com o merge feito, manda a conclusão de
        novo; com o PR reprovado pelo revisor mesmo depois dos consertos (`correcao.consertosEsgotados`), fecha o PR
        com um comentário e corrige do zero a partir do branch padrão (`refazer_correcao`); com outro PR, confere o
        mesmo PR (o Paulo pode ter consertado o CI); sem PR, corrige do zero."""
        if not _retomada_nova(it, demanda):
            return
        c = _dados(it, "correcao")
        if c.get("mergeado"):
            it.update(travaDaCorrecao=False, inicio=self.agora_texto)
            self.correcao_mergeada(id_, it, demanda)
        elif c.get("prUrl") and c.get("consertosEsgotados"):
            self.refazer_correcao(id_, it, demanda)
        elif c.get("prUrl"):
            c.pop("ciPendenteDesde", None)
            c.pop("revisao", None)  # sem CI, o revisor confere de novo (o Paulo pode ter mexido no PR)
            c.pop("conserto", None)  # o conserto que travou (teto, erro) não volta: o revisor confere o head atual
            it.update(travaDaCorrecao=False, alvo="corrigindo", inicio=self.agora_texto)
            self.salvar()
            self.conferir_correcao(id_, it, demanda)
        else:
            self.corrigir(id_, it, demanda)  # sem vaga, a trava (e a retomada) ficam para o ciclo seguinte

    def refazer_correcao(self, id_: str, it: dict, demanda: dict) -> None:
        """A retomada depois da trava dos consertos: revisar o mesmo head de novo daria a mesma reprovação. O PR aberto
        é fechado com `COMENTARIO_DA_CORRECAO_REFEITA` (mergeado pelo Paulo, vale como em `merge_da_correcao_vale`) e
        a correção recomeça do zero, a partir do branch padrão, com o resumo do teste. Sem vaga, `corrigir` não mexe
        no estado: a retomada (com o PR já fechado) é refeita no ciclo seguinte."""
        c = it["correcao"]
        repo = it.get("repo") or demanda["repositorio"]
        pr = despachante._dict(self.forja.pr(c["prUrl"]))
        if pr.get("mergeado") is True and str(pr.get("repo")).lower() == str(repo).lower() and self.merge_da_correcao_vale(repo, c, pr):
            it.update(travaDaCorrecao=False, inicio=self.agora_texto)
            self.correcao_mergeada(id_, it, demanda)
            return
        if pr.get("aberto") is True:
            self.forja.fechar_pr(c["prUrl"], COMENTARIO_DA_CORRECAO_REFEITA)
            self.eventos.append({"evento": "demanda_correcao_refeita", "id": id_, "prUrl": c["prUrl"]})
        self.corrigir(id_, it, demanda)

    def conferir_correcao(self, id_: str, it: dict, demanda: dict) -> None:
        """As guardas do merge do PR da correção, no mesmo head: o repositório da demanda, nada em
        `despachante.PROTEGIDOS_FIXOS` nem nos `protegidos` da `.fabrica/config.json` do branch padrão, e CI `verde`.
        CI vermelho (ou pendente acima de 2 h) trava com a URL. Sem CI nenhum, trava para o Paulo revisar e mergear,
        a não ser que a config do repositório traga `"ciObrigatorioNasSeeds": false`: aí o revisor da Fábrica confere
        o PR no head (`revisar_correcao`) e o veredito aprovado mergeia, como nas seeds; o reprovado é consertado no
        mesmo PR (`consertar`) e o head novo passa por aqui de novo. Já mergeado só vale como em
        `merge_da_correcao_vale`."""
        c = it["correcao"]
        url = c["prUrl"]
        repo = it.get("repo") or demanda["repositorio"]
        try:
            pr = despachante._dict(self.forja.pr(url))
        except ValueError:
            self.travar_correcao(id_, it, MOTIVO_LINK_DA_CORRECAO, None)
            return
        if str(pr.get("repo")).lower() != str(repo).lower():
            self.travar_correcao(id_, it, MOTIVO_CORRECAO_OUTRO_REPO, url)
            return
        head = pr.get("headSha")
        if pr.get("mergeado") is True:
            if self.merge_da_correcao_vale(repo, c, pr):
                self.correcao_mergeada(id_, it, demanda)
            else:
                self.travar_correcao(id_, it, MOTIVO_CORRECAO_JA_MERGEADA, url)
            return
        if pr.get("aberto") is not True:
            self.travar_correcao(id_, it, MOTIVO_PR_DA_CORRECAO_FECHADO, url)
            return
        arquivos = pr.get("arquivos")
        if not isinstance(arquivos, list) or not isinstance(head, str) or not head:
            raise RuntimeError("PR da correção ilegível")
        if c.get("headSha") != head:
            c["headSha"] = head
            c.pop("ciPendenteDesde", None)
            self.salvar()
        config = self.config_do_repo(repo)
        if config is None:
            self.travar_correcao(id_, it, MOTIVO_CONFIG_ILEGIVEL, url)
            return
        # os fixos (`.fabrica/**`, `.claude/**`, `.warren/**`, como nos PRs de seed) e os do branch padrão
        protegidos = list(despachante.PROTEGIDOS_FIXOS) + list(config[0])
        protegido = next((a for a in arquivos if not isinstance(a, str) or any(globs.casa_glob(a, g) for g in protegidos)), None)
        if protegido is not None:
            self.travar_correcao(id_, it, MOTIVO_CORRECAO_PROTEGIDO % str(protegido)[:200], url)
            return
        # a cópia de um contrato externo só muda para ficar idêntica à origem (`contratosExternos`)
        contratos, torto = self.contratos_do_repo(repo)
        if torto is not None:
            self.travar_correcao(id_, it, MOTIVO_CONTRATOS_TORTOS % torto, url)
            return
        tocados = set(contratos_externos.arquivos(contratos)) & {a for a in arquivos if isinstance(a, str)}
        divergencias = contratos_externos.conferir(self.forja, repo, head, contratos, so=tocados) if tocados else []
        if divergencias:
            self.travar_correcao(id_, it, (MOTIVO_CORRECAO_CONTRATO % "; ".join(divergencias))[:300], url)
            return
        ci = self.forja.ci(repo, head)
        if ci == "pendente":
            desde = _instante(c.get("ciPendenteDesde"))
            if desde is None:
                c["ciPendenteDesde"] = self.agora_texto
                self.salvar()
            elif (self.agora - desde).total_seconds() > CI_PENDENTE_MAXIMO_S:
                self.travar_correcao(id_, it, MOTIVO_CI_DA_CORRECAO_PENDENTE, url)
            return
        if ci == "ausente":
            # código de produto sem CI nenhum só entra sozinho com `ciObrigatorioNasSeeds: false` e o veredito do
            # revisor; senão o Paulo revisa e mergeia. Mergeado por ele, a demanda segue (`seguir_correcao_sem_ci`)
            c["semCi"] = True
            if config[2] is not False:
                self.travar_correcao(id_, it, MOTIVO_CORRECAO_SEM_CI, url)
            else:
                self.revisar_correcao(id_, it, demanda, pr)
            return
        if ci != "verde":
            self.travar_correcao(id_, it, MOTIVO_CI_DA_CORRECAO, url)
            return
        if self.forja.mergear(url, head) is True:  # o GitHub recusa se o head andou desde a leitura
            self.correcao_mergeada(id_, it, demanda)
        elif not self.atualizar_branch_da_correcao(id_, it, demanda, pr):
            self.travar_correcao(id_, it, MOTIVO_MERGE_DA_CORRECAO, url)

    def atualizar_branch_da_correcao(self, id_: str, it: dict, demanda: dict, pr: dict) -> bool:
        """O GitHub recusou o merge: traz o branch padrão para o PR, sem gastar run (como `_atualizar_branch_da_seed` do
        despachante). O código da correção não muda: a revisão aprovada continua valendo no head novo
        (`revisao.head`); com CI, o ciclo seguinte espera o CI do head novo. Conflito de verdade, sem clone ou depois de
        `ATUALIZACOES_DA_CORRECAO` vezes: `False`, e a recusa trava como antes."""
        c = it["correcao"]
        vezes = c.get("atualizacoesDoBranch") if isinstance(c.get("atualizacoesDoBranch"), int) else 0
        branch = pr.get("branch")
        if self.atualizar_branch is None or vezes >= ATUALIZACOES_DA_CORRECAO or not isinstance(branch, str) or not branch:
            return False
        repo = it.get("repo") or demanda["repositorio"]
        try:
            novo = self.atualizar_branch(repo, branch, self.forja.branch_padrao(repo))
        except Exception:  # noqa: BLE001 - sem atualizar, a recusa segue o caminho de sempre
            novo = None
        if not isinstance(novo, str) or not novo:
            return False
        c["atualizacoesDoBranch"] = vezes + 1
        c["headSha"] = novo
        c.pop("ciPendenteDesde", None)
        rev = c.get("revisao")
        if isinstance(rev, dict) and isinstance(rev.get("veredito"), dict):
            rev["head"] = novo
        self.salvar()
        self.eventos.append({"evento": "demanda_branch_da_correcao_atualizado", "id": id_, "sha": novo})
        return True

    def revisar_correcao(self, id_: str, it: dict, demanda: dict, pr: dict) -> None:
        """A correção sem CI num repositório com `ciObrigatorioNasSeeds: false`: um run do `revisor` (`modelos.revisor`)
        no branch do PR, com o veredito das seeds (`prompts.extrair_veredito`) no head observado.

        `correcao.revisao` guarda `sha`, `branch`, `nonce`, `inicio`, `runId`, `emCurso` e `falhas`, gravados antes do
        POST pago (sem `runId`, o run é achado pelo nonce). Aprovado no mesmo sha: merge nesse head. Reprovado: o
        conserto no mesmo branch, com os achados (`consertar`, até `CONSERTOS_DA_CORRECAO` vezes; depois, a trava com o
        primeiro achado). Run falho ou sem veredito válido (ou de outro sha): revisa mais uma vez e, na segunda,
        trava. O head que andou descarta a revisão (o run dela ainda vivo vira `correcaoSuperada` e segura a vaga), salvo
        quando só ganhou arquivos de controle do Warren (`revisao.head`): aí o veredito do `sha` revisado vale."""
        c = it["correcao"]
        url, head = c["prUrl"], pr["headSha"]
        rev = c.get("revisao") if isinstance(c.get("revisao"), dict) else None
        if rev is not None and head not in (rev.get("sha"), rev.get("head")):
            repo = it.get("repo") or demanda["repositorio"]
            if self.so_controle_do_warren(repo, rev.get("sha"), head):
                # o Warren empurra `chore(warren): seeds state` ao fechar o run do revisor: o código revisado é o mesmo
                rev["head"] = head
                self.salvar()
            else:
                self.largar_revisao(it)
                rev = None
        if rev is None:
            self.nova_revisao(id_, it, demanda, pr, falhas=0)
            return
        if rev.get("emCurso"):
            run = self.run_da_revisao(id_, it, demanda, rev)
            if run is None:
                return
            texto = self.motor.ultimo_texto(rev["runId"])
            # o revisor não commita: o Warren pode dar o run como falho por isso, e o veredito dele ainda vale
            valido = run.get("estado") == "succeeded" or (run.get("estado") == "failed" and run.get("motivoFalha") in despachante.MOTIVOS_SEM_COMMIT)
            rev.update(emCurso=False, veredito=despachante._veredito_limpo(prompts.extrair_veredito(texto)) if valido else None)
            self.salvar()
        veredito = rev.get("veredito") if isinstance(rev.get("veredito"), dict) else None
        if veredito is None or veredito.get("sha") != rev.get("sha"):
            falhas = (rev.get("falhas") if isinstance(rev.get("falhas"), int) else 0) + 1
            if falhas >= TENTATIVAS_DA_REVISAO:
                self.travar_correcao(id_, it, MOTIVO_REVISAO_SEM_VEREDITO, url)
            else:
                self.nova_revisao(id_, it, demanda, pr, falhas=falhas)
            return
        if veredito.get("resultado") != "aprovado":
            self.consertar(id_, it, demanda, veredito.get("achados"), sha=head, branch=rev["branch"])
            return
        if self.forja.mergear(url, head) is True:  # o GitHub recusa se o head andou desde a leitura
            self.correcao_mergeada(id_, it, demanda)
        elif not self.atualizar_branch_da_correcao(id_, it, demanda, pr):
            self.travar_correcao(id_, it, MOTIVO_MERGE_DA_CORRECAO, url)

    def consertar(self, id_: str, it: dict, demanda: dict, achados, *, sha: str, branch: str) -> None:
        """O revisor reprovou o PR da correção no head `sha`: um run do `frontend` (`modelos.frontend`) no mesmo branch,
        com os achados (`prompts.prompt_conserto_da_correcao`), até `CONSERTOS_DA_CORRECAO` vezes por PR
        (`correcao.consertos`). Passadas as rodadas (ou sem o modelo), trava com o primeiro achado.

        `correcao.conserto` guarda `sha` (o head reprovado), `branch` e `achados`; o run usa os campos do run da
        correção (`nonce` de `"conserto"`, `inicio`, `runId`, `correcao.terminou`), gravados antes do POST pago (sem
        `runId`, o run é achado pelo nonce). A vaga passa do revisor ao conserto (`passar_a_vaga`); com drenagem, um
        run superado vivo ou sem vaga, espera o ciclo seguinte (a revisão reprovada, ou o conserto terminado, fica no
        estado e decide de novo)."""
        c = it["correcao"]
        achados = [a for a in achados if isinstance(a, dict)] if isinstance(achados, list) else []
        consertos = c.get("consertos") if isinstance(c.get("consertos"), int) else 0
        if consertos >= CONSERTOS_DA_CORRECAO or self.modelo_da_correcao is None:
            if self.modelo_da_correcao is None:
                self.sem_modelo(PAPEL_DA_CORRECAO)
            motivos = (a.get("motivo") for a in achados)
            achado = next((m for m in motivos if isinstance(m, str) and m.strip()), None)
            achado = " ".join(achado.split())[:LIMITE_ACHADO_DA_REVISAO] if achado else MOTIVO_REVISAO_SEM_MOTIVO
            esgotados = consertos >= CONSERTOS_DA_CORRECAO
            if esgotados:
                c["consertosEsgotados"] = True  # a retomada do Paulo refaz a correção do zero (`refazer_correcao`)
            c.pop("conserto", None)
            self.travar_correcao(id_, it, (MOTIVO_REVISAO_REPROVOU_DEPOIS_DOS_CONSERTOS if esgotados else MOTIVO_REVISAO_REPROVOU) % achado, c["prUrl"])
            return
        if _run_superado_vivo(it) or capacidade.ler(self.capacidade).get("drenagem"):
            return
        if not self.passar_a_vaga(id_, PAPEL_DA_CORRECAO):
            return
        c.pop("revisao", None)
        c.update(consertos=consertos + 1, conserto={"sha": sha, "branch": branch, "achados": achados}, terminou=False)
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        it.update(nonce=nonce_do_motor(id_, "conserto", tentativa), tentativa=tentativa + 1, inicio=self.agora_texto, runId=None)
        self.salvar()  # antes do POST pago
        self.despachar_correcao(id_, it, demanda)

    def fim_do_conserto(self, id_: str, it: dict, demanda: dict) -> None:
        """O run do conserto terminou. Com código novo no PR (o head andou além dos arquivos de controle do Warren), ou
        com o PR fechado ou mergeado, as guardas conferem o PR de novo (head novo, revisão nova). Sem commit novo (o
        agente não mudou nada, ou o run falhou antes), a rodada conta como falha: conserta de novo ou, passadas as
        rodadas, trava (`consertar`)."""
        c = it["correcao"]
        conserto = c["conserto"]
        repo = it.get("repo") or demanda["repositorio"]
        pr = despachante._dict(self.forja.pr(c["prUrl"]))
        head, sha = pr.get("headSha"), conserto.get("sha")
        mudou = not isinstance(head, str) or not head or (head != sha and not self.so_controle_do_warren(repo, sha, head))
        if pr.get("aberto") is not True or mudou:
            c.pop("conserto", None)
            self.salvar()
            self.conferir_correcao(id_, it, demanda)
            return
        self.consertar(id_, it, demanda, conserto.get("achados"), sha=sha, branch=conserto.get("branch"))

    def so_controle_do_warren(self, repo: str, base, head: str) -> bool:
        """`head` descende de `base` e só mudou arquivos de controle do Warren (como em `_herdar_gates_do_head`)."""
        if not isinstance(base, str) or not base:
            return False
        try:
            arquivos = self.forja.arquivos_entre(repo, base, head)
        except Exception as exc:  # noqa: BLE001 - sem a comparação, a revisão é refeita
            self.erro(None, exc)
            return False
        return bool(arquivos) and all(despachante._so_controle(a) for a in arquivos)

    def run_da_revisao(self, id_: str, it: dict, demanda: dict, rev: dict):
        """O run da revisão em curso, quando terminou (404 conta como falho); senão `None`: adota pelo nonce ou repete
        o POST com a mesma chave, e passado o teto trava (o run vivo segura a vaga em `correcaoSuperada`)."""
        inicio = _instante(rev.get("inicio"))
        if inicio is None or (self.agora - inicio).total_seconds() > TETO_RUN_S:
            self.travar_correcao(id_, it, MOTIVO_TETO_DA_REVISAO, it["correcao"]["prUrl"])
            return None
        if not rev.get("runId"):
            run_id = self.motor.procurar_run(it["projeto"], rev["nonce"], self.desde(rev))
            if run_id is not None:
                rev["runId"] = run_id
                self.salvar()
            elif self.modelo_da_revisao is not None:
                self.despachar_revisao(id_, it, demanda)
            return None
        try:
            run = despachante._dict(self.motor.run(rev["runId"]))
        except Exception as exc:
            if not despachante._eh_404(exc):
                raise
            run = {"estado": "failed"}
        return run if run.get("estado") in despachante.TERMINAIS_DE_RUN else None

    def largar_revisao(self, it: dict) -> None:
        """A revisão de outro head não vale: sai do estado; o run dela ainda vivo vira `correcaoSuperada` (a vaga fica
        com ele até terminar, e a revisão nova espera)."""
        rev = it["correcao"].get("revisao")
        vivo = _revisao_em_curso(it) is not None
        if vivo and rev.get("runId"):
            try:
                vivo = despachante._dict(self.motor.run(rev["runId"])).get("estado") not in despachante.TERMINAIS_DE_RUN
            except Exception as exc:
                if not despachante._eh_404(exc):
                    raise
                vivo = False
        if vivo:
            it["correcaoSuperada"] = {"runId": rev.get("runId"), "nonce": rev.get("nonce"), "projeto": it.get("projeto"), "inicio": rev.get("inicio")}
        it["correcao"].pop("revisao", None)
        self.salvar()

    def nova_revisao(self, id_: str, it: dict, demanda: dict, pr: dict, *, falhas: int) -> None:
        """Despacha o revisor no head do PR. Sem `modelos.revisor`, trava para o Paulo como sem a config; sem vaga, com
        drenagem ou com um run superado vivo, espera o ciclo seguinte (a fase segue em `corrigindo`)."""
        if self.modelo_da_revisao is None:
            self.sem_modelo(PAPEL_DA_REVISAO)
            self.travar_correcao(id_, it, MOTIVO_CORRECAO_SEM_CI, it["correcao"]["prUrl"])
            return
        if _run_superado_vivo(it) or capacidade.ler(self.capacidade).get("drenagem"):
            return
        branch = pr.get("branch")
        if not isinstance(branch, str) or not branch:
            raise RuntimeError("PR da correção sem branch")
        if not self.passar_a_vaga(id_, PAPEL_DA_REVISAO):
            return
        tentativa = it.get("tentativa") if isinstance(it.get("tentativa"), int) else 0
        it["correcao"]["revisao"] = {
            "sha": pr["headSha"],
            "branch": branch,
            "nonce": nonce_do_motor(id_, "revisao", tentativa),
            "inicio": self.agora_texto,
            "runId": None,
            "emCurso": True,
            "falhas": falhas,
        }
        it["tentativa"] = tentativa + 1
        self.salvar()  # antes do POST pago
        self.despachar_revisao(id_, it, demanda)

    def passar_a_vaga(self, id_: str, papel: str) -> bool:
        """A vaga da demanda passa entre a correção (ou o conserto) e o revisor, cujo run já terminou: `papel` toma o
        lugar do outro, sem reservar nada a mais; sem nenhum dos dois (a retomada do Paulo depois de uma trava que a
        soltou), reserva uma nova."""
        reservas = capacidade.ler(self.capacidade)["reservas"].get(chave(id_), [])
        if papel in reservas:
            return True
        outros = set(reservas) & {PAPEL_DA_CORRECAO, PAPEL_DA_REVISAO}
        if outros:
            capacidade.sincronizar(self.capacidade, chave(id_), (set(reservas) - outros) | {papel})
            return True
        return capacidade.reservar(self.capacidade, chave(id_), papel, mem_disponivel_mb=self.mem_disponivel_mb)

    def despachar_revisao(self, id_: str, it: dict, demanda: dict) -> None:
        c = it["correcao"]
        rev, modelo = c["revisao"], self.modelo_da_revisao
        prompt = prompts.prompt_revisor_da_correcao(demanda=demanda, resumo=c.get("resumo") or "", sha=rev["sha"], pr_url=c["prUrl"])
        run_id = self.motor.despachar_run(
            projeto=it["projeto"],
            agente=modelo["agente"],
            modelo=modelo["modelo"],
            prompt=despachante._com_nonce(prompt, rev["nonce"]),
            branch_existente=rev["branch"],
            max_custo_usd=modelo["maxCustoUsd"],
            chave_idempotencia=rev["nonce"],
        )
        rev["runId"] = run_id
        self.salvar()
        self.eventos.append({"evento": "demanda_revisao_da_correcao", "id": id_, "runId": run_id, "sha": rev["sha"]})

    def merge_da_correcao_vale(self, repo: str, c: dict, pr: dict) -> bool:
        """O PR da correção (o `prUrl` que o run devolveu) mergeado conta só se o kit já o viu aberto (`headSha`
        gravado): no head conferido (o ciclo caiu antes de gravar o merge) ou, com outro head (o Paulo pôs um commit
        a mais antes de mergear), com o PR entrando no branch padrão."""
        head, visto = pr.get("headSha"), c.get("headSha")
        if not isinstance(visto, str) or not visto:
            return False
        if isinstance(head, str) and head == visto:
            return True
        base = pr.get("base")
        return isinstance(base, str) and bool(base) and base == self.forja.branch_padrao(repo)

    def seguir_correcao_sem_ci(self, id_: str, it: dict, demanda: dict) -> None:
        """A correção travou por não ter CI: quando o Paulo mergeia o PR, a demanda segue sem precisar da retomada
        (`destravada` e, na etapa `desenvolvida`, a conclusão). Roda antes de `proxima_acao`, que com a trava dá
        `nada`. PR ainda aberto (ou fechado sem merge): nada; a retomada do Paulo confere de novo."""
        c = it.get("correcao") if isinstance(it.get("correcao"), dict) else {}
        if not (it.get("fase") == "corrigindo" and it.get("travaDaCorrecao") and c.get("semCi") and not c.get("mergeado")):
            return
        if demanda.get("encerrada") or (demanda.get("espera") or {}).get("tipo") != "travada" or not isinstance(c.get("prUrl"), str):
            return
        repo = it.get("repo") or demanda["repositorio"]
        pr = despachante._dict(self.forja.pr(c["prUrl"]))
        if pr.get("mergeado") is not True or str(pr.get("repo")).lower() != str(repo).lower():
            return
        if not self.merge_da_correcao_vale(repo, c, pr):
            return
        enfileirar_evento(self.estado, id_, "destravada", {}, agora=self.agora_texto)
        c.pop("semCi", None)
        it.update(travaDaCorrecao=False, inicio=self.agora_texto)
        self.correcao_mergeada(id_, it, demanda)

    def correcao_mergeada(self, id_: str, it: dict, demanda: dict) -> None:
        """A correção no branch padrão: na etapa `desenvolvida` (primeira falha) vai `etapa_concluida` e o Flow volta a
        `testada`; na `testada` (retomada da segunda falha) o ciclo seguinte já testa de novo."""
        c = _dados(it, "correcao")
        c["mergeado"] = True
        c.pop("ciPendenteDesde", None)
        rodadas = it.get("rodadas")
        if isinstance(rodadas, list) and rodadas and isinstance(rodadas[-1], dict) and c.get("prUrl"):
            rodadas[-1]["correcao"] = c["prUrl"]
        if _marco(demanda) == "desenvolvida" and not demanda.get("encerrada"):
            enfileirar_evento(self.estado, id_, "etapa_concluida", {"marco": "desenvolvida"}, agora=self.agora_texto)
        self.sair_da_correcao(id_, it)
        self.eventos.append({"evento": "demanda_correcao_mergeada", "id": id_, "prUrl": c.get("prUrl")})

    def sair_da_correcao(self, id_: str, it: dict, *, vivo: bool = False, **campos) -> None:
        """Toda saída do run da correção: solta a vaga e grava (`vivo`: como em `sair_do_teste`, em `correcaoSuperada`).
        O revisor da correção sem CI ainda em curso vira `correcaoSuperada` em qualquer saída: segura a vaga até terminar."""
        c = _dados(it, "correcao")
        rev = _revisao_em_curso(it)
        if rev is not None:
            it["correcaoSuperada"] = {"runId": rev.get("runId"), "nonce": rev.get("nonce"), "projeto": it.get("projeto"), "inicio": rev.get("inicio")}
            c.pop("revisao", None)
        elif vivo and not c.get("terminou") and (it.get("runId") or it.get("nonce")):
            it["correcaoSuperada"] = {"runId": it.get("runId"), "nonce": it.get("nonce"), "projeto": it.get("projeto"), "inicio": it.get("inicio")}
        else:
            capacidade.sincronizar(self.capacidade, chave(id_), set())
        it.update(runId=None, alvo=None, **campos)
        self.salvar()

    def travar_correcao(self, id_: str, it: dict, motivo: str, url, *, vivo: bool = False) -> None:
        """`travada` para o Paulo, com a fase em `corrigindo`; a retomada dele segue de onde parou (`retomar_correcao`)."""
        enfileirar_evento(self.estado, id_, "travada", {"motivo": motivo[:300], "url": url}, agora=self.agora_texto)
        _dados(it, "correcao").pop("ciPendenteDesde", None)
        self.sair_da_correcao(id_, it, vivo=vivo, travaDaCorrecao=True, inicio=self.agora_texto)
        self.eventos.append({"evento": "demanda_correcao_travada", "id": id_, "motivo": motivo})

    def travar_correcao_por_erro(self, id_: str, it: dict):
        def travar(vezes, texto):
            if it.get("fase") != "corrigindo" or it.get("travaDaCorrecao"):
                return False
            self.travar_correcao(id_, it, MOTIVO_ERRO_DA_CORRECAO % (vezes, texto), _dados(it, "correcao").get("prUrl"), vivo=True)
            return True

        return travar

    def largar_correcao_superada(self, id_: str, it: dict, demanda: dict) -> None:
        """O Paulo mexeu na demanda (encerrou, travou ou passou da etapa) com a correção no meio: o run não conta mais,
        e a retomada dele segue como numa trava da correção."""
        em_curso = it.get("alvo") == "corrigindo" and it.get("fase") == "corrigindo"
        if em_curso and (demanda.get("encerrada") or demanda.get("espera") or _marco(demanda) not in ("desenvolvida", "testada")):
            self.sair_da_correcao(id_, it, vivo=True, travaDaCorrecao=True, inicio=self.agora_texto)
            self.eventos.append({"evento": "demanda_correcao_superada", "id": id_})


def passo(estado: dict, *, cliente, motor, forja, capacidade_path, projetos: dict, modelos: dict, raiz, agora, mem_disponivel_mb, salvar, publicacao=None, pedir_publicacao=None, atualizar_branch=None) -> list[dict]:
    """Um ciclo das demandas: busca no Flow e triagem. Muta `estado["demandas"]` e devolve os eventos de log.

    `cliente` é o `ClienteDoFlow`; `projetos` mapeia o repositório (`fila.json`) para o projeto do Warren (repositório
    fora dele: a demanda espera, com um aviso por repositório); `modelos` é o `modelos` de
    `<kit>/fabrica/modelos/config.json`. A triagem não reserva vaga. A caixa de saída é esvaziada por quem chama
    (`esvaziar_saida`), depois. `salvar` grava o `fila-estado.json` (antes de cada POST pago e a cada transição).
    `forja` lê e mergeia o PR do plano. `estado["fila"]` é a fila do coordenador: o `passo` acompanha a entrada do
    plano da demanda (lendo a pausa em `<raiz>/planos/<id>/estado.json`). `mem_disponivel_mb` vai à reserva de vaga
    do desenho (`capacidade.reservar`); `publicacao` (`{"url", "token_file"}`, a rota já derivada por
    `publicar.url_da_rota`; `None` desliga o pedido) e `pedir_publicacao` (padrão `publicar.pedir`) são da entrega; o HTML do desenho é copiado para `<raiz>/demandas/<id>/` antes da saída.
    `atualizar_branch(repo, branch, padrao)` traz o branch padrão para o PR da correção que o GitHub recusou
    (`atualizar_branch.atualizar` num clone do repositório; devolve o head novo ou `None`); `None` desliga.
    """
    p = _Passo(
        estado,
        cliente=cliente,
        motor=motor,
        forja=forja,
        capacidade_path=capacidade_path,
        projetos=projetos,
        modelos=modelos,
        agora=agora,
        salvar=salvar,
        raiz=raiz,
        mem_disponivel_mb=mem_disponivel_mb,
        publicacao=publicacao,
        pedir_publicacao=pedir_publicacao,
        atualizar_branch=atualizar_branch,
    )
    if p.buscar():
        p.decidir()
    return p.eventos
