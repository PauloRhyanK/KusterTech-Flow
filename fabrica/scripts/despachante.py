"""Despachante da fábrica: observa o Warren e o GitHub, decide com `estado` e executa (só stdlib).

É a única camada operacional do kit e roda sem operação manual: tudo o que precisa do Paulo vira
uma issue de decisão, e fechar a issue é a resposta. A cada ciclo:

1. recarrega o plano (`caminho_plano`, por padrão `.fabrica/plano.json`) do branch padrão (só adota um
   plano válido);
2. aplica os pedidos da caixa `<raiz>/entrada/` e observa a issue de pausa;
3. observa os runs de revisão, do fixer e do orquestrador;
4. trata e conclui o PR do orquestrador que terminou (ou reenfileira a acordada, se o run falhou);
5. sincroniza o plano no estado (sempre: é puro e idempotente);
6. observa os Plan Runs das raias executando, os PRs das seeds e as decisões do Paulo;
7. fecha os PRs que ficaram para trás e confere se o Warren está acessível;
8. executa as ações (replanejamentos, depois `estado.proximas_acoes`), gravando o `estado.json` de
   forma atômica depois de cada uma; uma pausa abre uma issue que, fechada, retoma.

Garantias:

- toda ação paga (e `aguardar_humano`) é anotada em `acaoEmCurso` antes da chamada; se o processo
  morrer no meio, o reinício trata a ação como "despachada sem id" e nunca a repete às cegas;
- uma seed só recebe ação de gate se o PR dela foi lido com sucesso neste ciclo, no repositório
  configurado e aberto; o PR do orquestrador só é mergeado com as guardas e o CI verde;
- o orquestrador nunca entra em cadeia paga: dois runs seguidos sem PR mergeável bloqueiam as
  acordadas até o Paulo responder; um run que falha devolve a mesma acordada (com o contexto);
- logs, avisos e mensagens levam só `Tipo: mensagem` (sem traceback nem `__cause__`), com os
  segredos conhecidos trocados por `***`.
"""

import argparse
import contextlib
import copy
import datetime
import fcntl
import json
import math
import os
import pathlib
import re
import secrets
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import capacidade  # noqa: E402
import estado as est  # noqa: E402
import globs  # noqa: E402
import prompts  # noqa: E402
import raias  # noqa: E402
import verificacao  # noqa: E402
from forja import LABEL_DECISAO  # noqa: E402
from motor import (  # noqa: E402
    MARCADOR_NONCE,
    MOTIVOS_INFRA_PERDIDA,
    FalhaAntesDoEnvio,
    FalhaDeRede,
    FalhaIncerta,
    MotorOcupado,
    RecusaDoMotor,
    instante,
)

ARQ_ESTADO = "estado.json"
ARQ_PLANO = "plano.json"
ARQ_ACORDADAS = "acordadas.jsonl"
ARQ_LOG = "log.jsonl"
ARQ_TRAVA = "despachante.lock"
DIR_ENTRADA = "entrada"
CAMINHO_PLANO = ".fabrica/plano.json"
# `FABRICA_PLANO`: o plano legado ou um `.fabrica/planos/<feature>.json` (fullmatch: nada de `\n` no fim);
# a feature `plano` sob `planos/` colide com o legado e é recusada
PADRAO_CAMINHO_PLANO = re.compile(r"^\.fabrica/(plano|planos/[a-z0-9]+(-[a-z0-9]+)*)\.json$")
CAMINHO_PLANO_PROIBIDO = ".fabrica/planos/plano.json"
# feature de no máximo 41 caracteres (o limite da skill e de `fila.FEATURE_MAX`): `.fabrica/planos/` + 41 + `.json`
TAMANHO_MAXIMO_CAMINHO_PLANO = len(".fabrica/planos/") + 41 + len(".json")
CAMINHO_CONFIG = ".fabrica/config.json"
# `FABRICA_PLANO_ID`: `<dono>--<repo>--<feature>`, só `[a-z0-9-]` (fullmatch: nada de `\n` no fim)
PADRAO_PLANO_ID = re.compile(r"[a-z0-9-]+")
LIMITE_OOM_FILHOS = 200  # chaves de filhos OOM já repassadas à capacidade (as mais novas)
AVISO_CAPACIDADE = (
    "arquivo de capacidade ilegível ou inacessível: nenhuma raia nova é despachada e o orquestrador não é "
    "acordado até ele voltar (veja o log)"
)

WARREN_API_PADRAO = "http://127.0.0.1:8080"
WARREN_TOKEN_PADRAO = "~/.warren-token"
GH_TOKEN_PADRAO = "~/.warren-gh-token"

CODIGO_ERRO = 1
CODIGO_ENTRADA = 2
CODIGO_TRAVA = 3
MENSAGEM_TRAVA = "outro despachante está rodando nesta raiz"
MENSAGEM_PEDIDO = "pedido enfileirado: o despachante em execução vai aplicá-lo no próximo ciclo"

NAO_TERMINAIS_DE_RUN = ("queued", "pending", "dispatched", "running")
TERMINAIS_DE_RUN = ("succeeded", "failed", "cancelled")
ACOES_PAGAS = ("despachar_raia", "revisar", "corrigir", "acordar")
ACOES_COM_INTENCAO = ACOES_PAGAS
ACOES_DE_GATE = ("revisar", "verificar", "corrigir", "mergear")


def permitidos_ao_orquestrador(caminho_plano) -> tuple:
    """O que o orquestrador do plano pode mudar; qualquer outro arquivo (inclusive outro plano) leva o PR ao Paulo."""
    return (
        caminho_plano,
        est.PERGUNTA_DO_ORQUESTRADOR,
        ".fabrica/planejamento/**",
        ".seeds/**",
    )


# o do plano legado (`caminho_plano` padrão)
PERMITIDOS_AO_ORQUESTRADOR = permitidos_ao_orquestrador(CAMINHO_PLANO)
# Valem em todo PR de seed, somados aos `protegidos` da config do cliente: são os gates e as credenciais da própria Fábrica.
# `.github/**` fica na config (o padrão do kit protege), para o dono poder liberar o CI.
PROTEGIDOS_FIXOS = (".warren/**", ".fabrica/**", ".claude/**")
# Ponto único da normalização de papel: `raias.ALIASES_DE_PAPEL` (`ux-engineer` → `ux-ui`).
ALIASES_DE_PAPEL = dict(raias.ALIASES_DE_PAPEL)
PAPEIS_OBRIGATORIOS = ("orquestrador", "revisor", "fixer")
# O Warren reapa como falha o run que não commitou num branch existente; o revisor não commita por desenho,
# então nesses dois motivos vale o veredito dele. Sem veredito válido, continua sendo falha.
MOTIVOS_SEM_COMMIT = ("dropped_commit", "no_changes")

MAX_SEM_RESULTADO = 2
MAX_RECUSAS_DO_MOTOR = 5
MAX_FALHAS_DE_LEITURA = 5
MAX_FALHAS_DE_CANCELAR = 5
MAX_TENTATIVAS_DE_FECHAR = 5
CICLOS_WARREN_FORA = 5
CI_PENDENTE_MAXIMO = datetime.timedelta(hours=2)
RETRY_AFTER_MAXIMO = 900
RETRY_AFTER_PADRAO = 30
LIMITE_AVISOS = 200
LIMITE_MENSAGEM = 500
LIMITE_CONTEXTO = 4000
LIMITE_AVISOS_COMPACTOS = 10
LIMITE_AVISO_COMPACTO = 300
TAMANHO_MINIMO_SEGREDO = 8

SEM_PR = "run do orquestrador terminou sem PR"
TITULO_SEM_PLANO = "[fábrica] orquestrador: sem plano válido"
TITULO_WARREN = "[fábrica] Warren inacessível"
RODAPE_DECISAO = "Feche esta issue com um comentário para responder ao orquestrador."
# Marca os comentários do próprio despachante: nunca valem como resposta do Paulo.
MARCADOR_DESPACHANTE = "<!-- fabrica:despachante -->"
PEDIR_COMENTARIO = "Feche com um comentário dizendo a decisão: a issue foi reaberta pelo despachante."
ALVO_DO_ORQUESTRADOR = "orquestrador"
LIMITE_ENTRADA_APLICADA = 200
LIMITE_COTA_FILHOS = 200
CICLOS_PARA_DESCARTAR_INCERTO = 3
MAX_ADIAMENTOS_DE_REDE = 10
CICLOS_REDE_PARCIAL = 10
CICLOS_LIMPOS_PARA_FECHAR = 3
MAX_BUSCAS_FALHAS = 5
MAX_REABERTURAS_FALHAS = 5
MARGEM_DESDE = datetime.timedelta(minutes=10)
TITULO_WARREN_PARCIAL = "[fábrica] Warren parcialmente inacessível"
PAUSA_DESPACHOS_REJEITADOS = "Warren rejeitando despachos"
# Q2: buscas pelo nonce falhando seguidas (por item) até abrir uma decisão rastreada
MAX_FALHAS_DE_BUSCA_INCERTA = 10
TITULO_DESPACHO_NAO_CONFIRMADO = "[fábrica] despacho não confirmado"
# Q3: fechamentos sem comentário (depois de reabrir) até entregar a decisão ao orquestrador
MAX_FECHAMENTOS_SEM_COMENTARIO = 3
# R2: ciclos com leitura boa em que o retry automático do Warren (infra-lost-retry.ts) é procurado antes do caminho normal
CICLOS_PARA_ACHAR_RETRY = 3
LIMITE_NONCES_DE_RUNS = 100
OBSERVACAO_FECHADA_SEM_COMENTARIO = "decisão fechada %d vezes sem comentário" % MAX_FECHAMENTOS_SEM_COMENTARIO
# Task 7b: o preparar_warren roda na partida e, enquanto o Warren não estiver preparado, a cada 20 ciclos (a cada
# ciclo enquanto espera runs); depois de 2 esperas seguidas, a drenagem segura as ações que criam runs ou mergeiam
CICLOS_PREPARAR_WARREN = 20
ESTADOS_DO_PREPARAR = ("ja_aplicado", "versao_desconhecida", "aguardando_runs", "aplicado", "revertido", "erro")
WARREN_PREPARADO = ("ja_aplicado", "aplicado")
ESTADOS_SEM_MODELO = ("versao_desconhecida", "erro", "revertido")
AVISO_WARREN_SEM_MODELO = "o Warren não aplica modelo por papel; a conferência de modelo efetivo vai acusar a divergência"
AVISO_WARREN_FORA_APOS_ROLLBACK = "Warren fora do ar após rollback"
COR_LABEL_DECISAO = "d93f0b"
DESCRICAO_LABEL_DECISAO = "Decisão pedida pela fábrica de agentes"
AVISO_LABEL_DECISAO = "Não foi possível garantir o label %s no repositório; as decisões abrem sem ele" % LABEL_DECISAO
TITULO_WARREN_ROLLBACK = "[fábrica] Warren fora do ar após rollback"
AVISO_AUTOMERGE = "não foi possível desligar o warren-automerge.service (ele mergeia PRs com check falhando); nova tentativa em 20 ciclos"
AVISO_DROPIN = "não foi possível gravar o drop-in do systemd com WARREN_PLAN_RUN_MERGE_TIMEOUT_MS; nova tentativa em 20 ciclos"
ESPERAS_PARA_DRENAR = 2
DRENAGEM_MAXIMA = datetime.timedelta(minutes=45)
# F13: sem confirmação de restart com o drop-in carregado, o merge timeout do Warren ainda é o padrão (30 min)
DRENAGEM_MAXIMA_SEM_DROPIN = datetime.timedelta(minutes=25)
ESTADOS_COM_DROPIN_CARREGADO = ("ja_aplicado", "aplicado", "versao_desconhecida")
# F8: o warren-automerge desligado ou inexistente libera os merges
AUTOMERGE_DESLIGADO = ("desligado", "ausente", "ja_desligado")
TITULO_AUTOMERGE = "[fábrica] warren-automerge ainda ativo"
MOTIVO_AUTOMERGE = "warren-automerge ainda ativo: ele mergeia PRs sem os gates"
# F6 (N6 e N7): além das 3 leituras boas, só desiste do retry ou do item incerto 5 min depois de vê-lo pela 1ª vez
PISO_PARA_DESISTIR = datetime.timedelta(minutes=5)
# F2: códigos do `docker run` em que o comando nem executou (125: o daemon ou o run falhou; 126: não executável)
CODIGOS_DOCKER_NAO_EXECUTOU = (125, 126)
CODIGO_COMANDO_AUSENTE = 127
# F5: motivos de seed em que o merge é do Paulo
MOTIVOS_MERGE_DO_PAULO = ("toca arquivos protegidos", "merge recusado pelo GitHub")
PAUSA_ENTRE_DRENAGENS = datetime.timedelta(hours=6)
ACOES_SEGURAS_NA_DRENAGEM = ("despachar_raia", "revisar", "corrigir", "acordar", "mergear")

class OutroDespachante(Exception):
    """A trava da raiz já está com outro processo."""


class ErroDeEntrada(Exception):
    """Entrada do operador inválida (CLI sai com 2)."""

    def __init__(self, erros):
        self.erros = [str(e) for e in erros]
        super().__init__("; ".join(self.erros))


class ConfigInvalida(ValueError):
    """A config do cliente (ou o estado em disco) não serve para este despachante."""


class _NaoExecutada(Exception):
    """A ação nem chegou ao motor (config ou prompt): nada foi despachado."""


def _texto(valor) -> bool:
    return isinstance(valor, str) and valor != ""


def _dict(valor) -> dict:
    return valor if isinstance(valor, dict) else {}


def _lista(valor) -> list:
    return valor if isinstance(valor, list) else []


def _inteiro(valor) -> bool:
    return isinstance(valor, int) and not isinstance(valor, bool)


def _cortar(texto, limite: int) -> str:
    texto = str(texto)
    return texto if len(texto) <= limite else texto[: limite - 1] + "…"


def _recusar_constante(nome):
    raise ValueError("constante %s não é JSON estrito" % nome)


def _json_estrito(texto: str):
    return json.loads(texto, parse_constant=_recusar_constante)


def _eh_404(exc: BaseException) -> bool:
    return isinstance(exc, KeyError) or re.search(r"HTTP 404\s*$", str(exc)) is not None


def _eh_falha_de_rede(exc: BaseException) -> bool:
    """Falha na camada de rede (conexão, timeout, DNS); um HTTP >= 400 não é falha de rede."""
    return isinstance(exc, FalhaDeRede) or (isinstance(exc, RuntimeError) and "falha de rede" in str(exc))


def _antes_do_envio(exc: BaseException) -> bool:
    """Só a falha certamente anterior ao envio permite repetir um POST pago; na dúvida, é incerta."""
    if isinstance(exc, FalhaAntesDoEnvio):
        return True
    if isinstance(exc, FalhaIncerta):
        return False
    return _eh_falha_de_rede(exc) and re.search(r"\((ConnectionRefusedError|gaierror)\)", str(exc)) is not None


def _chave_acao(acao: dict) -> str:
    tipo = acao.get("tipo")
    if tipo == "acordar":
        return "acordar:%s:%s" % (acao.get("motivo"), acao.get("alvo"))
    return "%s:%s" % (tipo, acao.get("raia") or acao.get("seed"))


def _com_nonce(texto: str, nonce: str) -> str:
    """O marcador do nonce vai na última linha do texto enviado ao Warren."""
    return texto + "\n" + MARCADOR_NONCE % nonce


def liberar_raias_em_cota(estado: dict) -> list[str]:
    """P2: ao retomar, a raia parada por cota num filho volta a `planejada` para um Plan Run novo."""
    liberadas = []
    for raia_id, raia in _dict(estado.get("raias")).items():
        if isinstance(raia, dict) and raia.get("aguardandoCota"):
            raia.update(estado="planejada", planRunId=None, retomar=False, falha=None)
            raia.pop("aguardandoCota", None)
            liberadas.append(raia_id)
    if liberadas:
        estado["cotaFilhos"] = []
    return liberadas


def papel_normalizado(papel):
    return ALIASES_DE_PAPEL.get(papel, papel)


def _espera_do_retry_after(valor) -> int:
    try:
        return min(max(0, int(valor)), RETRY_AFTER_MAXIMO)
    except OverflowError:
        return RETRY_AFTER_MAXIMO
    except (TypeError, ValueError):
        return RETRY_AFTER_PADRAO


def _veredito_limpo(veredito):
    """Só `sha`, `resultado` e `achados` (`arquivo`, `motivo`): nada que o revisor invente entra no estado."""
    if not isinstance(veredito, dict):
        return None
    return {
        "sha": veredito.get("sha"),
        "resultado": veredito.get("resultado"),
        "achados": [
            {"arquivo": a.get("arquivo"), "motivo": a.get("motivo")}
            for a in _lista(veredito.get("achados"))
            if isinstance(a, dict)
        ],
    }


# ---------------------------------------------------------------- arquivos


def gravar_json_atomico(caminho, dados) -> None:
    """Grava num temporário do mesmo diretório, faz fsync e troca com `os.replace` (JSON estrito)."""
    caminho = pathlib.Path(caminho)
    texto = json.dumps(dados, ensure_ascii=False, indent=1, allow_nan=False) + "\n"
    tmp = caminho.with_name(".%s.%d.tmp" % (caminho.name, os.getpid()))
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as arquivo:
            arquivo.write(texto)
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


def _ler_json(caminho: pathlib.Path):
    """O JSON do arquivo, `None` se ele não existe; ilegível levanta `ValueError` (nunca recria)."""
    try:
        texto = caminho.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    try:
        return _json_estrito(texto)
    except (ValueError, RecursionError):
        raise ValueError("%s ilegível: corrija ou restaure o arquivo" % caminho.name) from None


def _ler_estado(raiz):
    """F10: o `estado.json` da raiz (None se não existe); ilegível ou que não é objeto é entrada inválida (saída 2)."""
    caminho = pathlib.Path(raiz) / ARQ_ESTADO
    try:
        estado = _ler_json(caminho)
    except ValueError:
        estado = []
    if estado is not None and not isinstance(estado, dict):
        raise ErroDeEntrada(["estado.json ilegível em %s: corrija ou restaure o arquivo" % caminho.parent])
    return estado


def _anexar_linha(caminho: pathlib.Path, linha: str) -> None:
    try:
        with open(caminho, "a", encoding="utf-8") as arquivo:
            arquivo.write(linha + "\n")
            arquivo.flush()
    except OSError as erro:
        print("não foi possível gravar %s (%s)" % (caminho.name, type(erro).__name__), file=sys.stderr)


@contextlib.contextmanager
def travar(raiz):
    """Trava exclusiva e não bloqueante em `<raiz>/despachante.lock` (um despachante por raiz)."""
    raiz = pathlib.Path(raiz)
    raiz.mkdir(parents=True, exist_ok=True)
    fd = os.open(raiz / ARQ_TRAVA, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise OutroDespachante(MENSAGEM_TRAVA) from None
        yield
    finally:
        os.close(fd)


def enfileirar_pedido(raiz, pedido: dict) -> pathlib.Path:
    """Grava um pedido (`iniciar --spec` ou `retomar`) na caixa de entrada, de forma atômica."""
    pasta = pathlib.Path(raiz) / DIR_ENTRADA
    pasta.mkdir(parents=True, exist_ok=True)
    caminho = pasta / ("%020d-%s.json" % (time.time_ns(), secrets.token_hex(4)))
    gravar_json_atomico(caminho, pedido)
    return caminho


# ---------------------------------------------------------------- funções puras


def compactar(estado: dict, plano: dict) -> dict:
    """Estado compacto para o prompt do orquestrador: nada de saídas longas."""
    estado = _dict(estado)
    raias_ = {}
    for id_, raia in _dict(estado.get("raias")).items():
        if isinstance(raia, dict):
            raias_[id_] = {
                "estado": raia.get("estado"),
                "retomadas": raia.get("retomadas"),
                "falha": raia.get("falha"),
            }
    seeds = {}
    for id_, seed in _dict(estado.get("seeds")).items():
        if not isinstance(seed, dict) or seed.get("estado") in est.TERMINAIS:
            continue
        motivos = [
            _cortar(m, LIMITE_AVISO_COMPACTO)
            for m in (seed.get("motivoHumano"), seed.get("pendenteHumano"))
            if _texto(m)
        ]
        seeds[id_] = {"estado": seed.get("estado"), "pr": seed.get("pr"), "motivos": motivos}
    avisos = [_cortar(a, LIMITE_AVISO_COMPACTO) for a in _lista(estado.get("avisos"))[-LIMITE_AVISOS_COMPACTOS:]]
    return {
        "faseAtual": _dict(plano).get("faseAtual"),
        "pausado": estado.get("pausado"),
        "raias": raias_,
        "seeds": seeds,
        "avisos": avisos,
    }


def _permitido_ao_orquestrador(caminho, caminho_plano=CAMINHO_PLANO) -> bool:
    if not _texto(caminho) or caminho.startswith("/"):
        return False
    if any(parte in ("", ".", "..") for parte in caminho.split("/")):
        return False
    return any(globs.casa_glob(caminho, g) for g in permitidos_ao_orquestrador(caminho_plano))


def _plano_id_valido(plano_id) -> bool:
    return isinstance(plano_id, str) and PADRAO_PLANO_ID.fullmatch(plano_id) is not None


def _caminho_plano_valido(caminho) -> bool:
    return (
        isinstance(caminho, str)
        and caminho != CAMINHO_PLANO_PROIBIDO
        and len(caminho) <= TAMANHO_MAXIMO_CAMINHO_PLANO
        and PADRAO_CAMINHO_PLANO.fullmatch(caminho) is not None
    )


def _raias_por_id(plano) -> dict:
    return {
        r["id"]: r
        for r in _lista(_dict(plano).get("raias"))
        if isinstance(r, dict) and _texto(r.get("id"))
    }


def _mudancas_de_verificacao(antigo, novo) -> list[str]:
    """Raias cujo comando de verificação muda, ou raias novas com comando que o plano não tinha."""
    antigas = _raias_por_id(antigo)
    conhecidos = [r.get("verificacao") for r in antigas.values()]
    mudancas = []
    for id_, raia in _raias_por_id(novo).items():
        comando = raia.get("verificacao")
        if id_ in antigas:
            if comando != antigas[id_].get("verificacao"):
                mudancas.append(
                    "raia %s muda a verificacao de %s para %s"
                    % (id_, _cortar(repr(antigas[id_].get("verificacao")), 200), _cortar(repr(comando), 200))
                )
        elif comando not in conhecidos:
            mudancas.append("raia nova %s com verificacao nova %s" % (id_, _cortar(repr(comando), 200)))
    return mudancas


def _mudancas_de_fase(antigo, novo) -> list[str]:
    """F3: `faseAtual` mudada, fase removida ou fases reordenadas no plano novo; tudo isso é homologação do Paulo."""
    def ids(plano):
        return [f.get("id") for f in _lista(_dict(plano).get("fases")) if isinstance(f, dict)]

    antigas, novas = ids(antigo), ids(novo)
    mudancas = []
    if _dict(antigo).get("faseAtual") != _dict(novo).get("faseAtual"):
        mudancas.append(
            "aprovar mudança de fase: faseAtual de %s para %s"
            % (_cortar(repr(_dict(antigo).get("faseAtual")), 100), _cortar(repr(_dict(novo).get("faseAtual")), 100))
        )
    removidas = [f for f in antigas if f not in novas]
    if removidas:
        mudancas.append("aprovar mudança de fase: fases removidas " + ", ".join(_cortar(repr(f), 100) for f in removidas[:20]))
    comuns = [f for f in novas if f in antigas]
    if comuns != [f for f in antigas if f in novas]:
        mudancas.append("aprovar mudança de fase: fases reordenadas (%s)" % ", ".join(_cortar(repr(f), 100) for f in comuns[:20]))
    return mudancas


def _validar_modelo(entrada, papel: str) -> dict:
    campo = "modelos.%s" % papel
    if not isinstance(entrada, dict):
        raise ConfigInvalida(campo)
    custo = entrada.get("maxCustoUsd")
    if not _texto(entrada.get("agente")):
        raise ConfigInvalida(campo + ".agente")
    if not _texto(entrada.get("modelo")):
        raise ConfigInvalida(campo + ".modelo")
    if (
        isinstance(custo, bool)
        or not isinstance(custo, (int, float))
        or not math.isfinite(custo)
        or custo <= 0
    ):
        raise ConfigInvalida(campo + ".maxCustoUsd")
    return {"agente": entrada["agente"], "modelo": entrada["modelo"], "maxCustoUsd": custo}


def _validar_config(config) -> dict:
    if not isinstance(config, dict):
        raise ConfigInvalida("config")
    protegidos = config.get("protegidos")
    if not isinstance(protegidos, list) or not all(_texto(p) for p in protegidos):
        raise ConfigInvalida("protegidos")
    modelos = config.get("modelos")
    if not isinstance(modelos, dict):
        raise ConfigInvalida("modelos")
    for papel in PAPEIS_OBRIGATORIOS:
        _validar_modelo(modelos.get(papel), papel)
    config.setdefault("branchPadrao", "main")
    if not _texto(config["branchPadrao"]):
        raise ConfigInvalida("branchPadrao")
    config.setdefault("limiteParalelo", 3)
    limite = config["limiteParalelo"]
    if not _inteiro(limite) or not 1 <= limite <= 32:
        raise ConfigInvalida("limiteParalelo")
    if not isinstance(config.setdefault("ciObrigatorioNoPlano", False), bool):
        raise ConfigInvalida("ciObrigatorioNoPlano")
    if not isinstance(config.setdefault("ciObrigatorioNasSeeds", True), bool):
        raise ConfigInvalida("ciObrigatorioNasSeeds")
    try:
        verificacao._validar_conteiner(config.get("verificacao"))
    except verificacao._ConfigInvalida as erro:
        raise ConfigInvalida("verificacao.%s" % erro) from None
    return config


# ---------------------------------------------------------------- despachante


class Despachante:
    def __init__(
        self,
        *,
        motor,
        forja,
        raiz,
        repo_dir,
        config: dict,
        verificar=verificacao.verificar,
        agora=datetime.datetime.now,
        projeto: str,
        repo: str,
        limpar_residuos=verificacao.limpar_residuos,
        segredos=(),
        preparar_warren=None,
        caminho_plano: str = CAMINHO_PLANO,
        capacidade: str | None = None,
        plano_id: str | None = None,
        mem_disponivel=capacidade.mem_disponivel_mb,
    ):
        if not _texto(projeto):
            raise ConfigInvalida("projeto")
        if not _texto(repo):
            raise ConfigInvalida("repo")
        if not _caminho_plano_valido(caminho_plano):
            raise ConfigInvalida("caminho_plano")
        self.caminho_plano = caminho_plano
        # vagas globais e trava de orquestrador por repositório; sem os dois, nada do módulo é chamado
        if (capacidade is None) != (plano_id is None):
            raise ConfigInvalida("capacidade e plano_id vêm juntos")
        if capacidade is not None and (not _texto(capacidade) or not _plano_id_valido(plano_id)):
            raise ConfigInvalida("capacidade")
        self.capacidade = capacidade
        self.plano_id = plano_id
        self._mem_disponivel = mem_disponivel
        self._capacidade_sincronizada = False
        self._acordar_recusado = False
        self.motor = motor
        self.forja = forja
        self.raiz = pathlib.Path(raiz)
        self.repo_dir = pathlib.Path(repo_dir)
        self.config = _validar_config(copy.deepcopy(config))
        self.projeto = projeto
        self.repo = repo
        self.branch = self.config["branchPadrao"]
        self._verificar = verificar
        self._agora = agora
        self._limpar = limpar_residuos
        # sem preparar injetado (testes, ou outro motor) nada é tocado no Warren; o `construir` liga o real
        self._preparar_warren = preparar_warren
        # E: o sha do adaptador depois de um rollback; só em memória (um reinício do despachante libera nova tentativa)
        self._sha_revertido = None
        conhecidos = {s for s in segredos if isinstance(s, str)} | {s.strip() for s in segredos if isinstance(s, str)}
        # os mais longos primeiro, para um segredo que contém outro ser trocado inteiro
        self._segredos = tuple(sorted((s for s in conhecidos if len(s) >= TAMANHO_MINIMO_SEGREDO), key=len, reverse=True))
        self.raiz.mkdir(parents=True, exist_ok=True)
        self.estado = _ler_estado(self.raiz)
        if self.estado is not None:
            if self.estado.get("repo") != repo or self.estado.get("projeto") != projeto:
                raise ConfigInvalida("o estado.json desta raiz é de outro projeto ou repositório")
        self.plano = _dict(_ler_json(self.raiz / ARQ_PLANO))
        self._observadas: set = set()
        self._retry_after = 0
        self._leituras = {"ok": 0, "falhas": 0}
        self._falhas_do_ciclo: list = []
        self._rede_do_ciclo: set = set()
        self._ja_cancelados: set = set()
        self._repetidos: dict = {}
        self.trava_externa = False
        self._travado = False

    # ------------------------------------------------------------ registro

    def _seguro(self, texto, limite: int = LIMITE_MENSAGEM) -> str:
        texto = str(texto)
        for segredo in self._segredos:
            texto = texto.replace(segredo, "***")
        return _cortar(texto, limite)

    def _erro(self, exc: BaseException) -> str:
        try:
            mensagem = str(exc)
        except Exception:  # noqa: BLE001 - uma mensagem quebrada não pode derrubar o registro
            mensagem = ""
        return self._seguro("%s: %s" % (type(exc).__name__, mensagem))

    def _log(self, registro: dict) -> None:
        linha = json.dumps(dict({"ts": self._agora().isoformat()}, **registro), ensure_ascii=False, default=str)
        for segredo in self._segredos:
            linha = linha.replace(segredo, "***").replace(json.dumps(segredo)[1:-1], "***")
        _anexar_linha(self.raiz / ARQ_LOG, linha)

    def _log_repetivel(self, chave: str, registro: dict) -> None:
        """Registra uma linha que se repetiria a cada ciclo só quando a situação muda."""
        assinatura = json.dumps(registro, sort_keys=True, ensure_ascii=False, default=str)
        if self._repetidos.get(chave) == assinatura:
            return
        self._repetidos[chave] = assinatura
        self._log(registro)

    def _esquecer(self, chave: str) -> None:
        self._repetidos.pop(chave, None)

    def _erro_de_etapa(self, etapa: str, alvo, exc: BaseException) -> None:
        self._log_repetivel("%s:%s" % (etapa, alvo), {"evento": "erro", "etapa": etapa, "alvo": alvo, "erro": self._erro(exc)})

    def _aviso(self, mensagem: str) -> None:
        mensagem = self._seguro(mensagem)
        avisos = self.estado.setdefault("avisos", [])
        if not isinstance(avisos, list):
            avisos = self.estado["avisos"] = []
        if mensagem not in avisos:
            avisos.append(mensagem)
            self._salvar()
            self._log({"evento": "aviso", "mensagem": mensagem})

    def _salvar(self) -> None:
        avisos = self.estado.get("avisos")
        if isinstance(avisos, list) and len(avisos) > LIMITE_AVISOS:
            self.estado["avisos"] = avisos[-LIMITE_AVISOS:]
        gravar_json_atomico(self.raiz / ARQ_ESTADO, self.estado)

    def _mudar(self, novo: dict) -> None:
        self.estado = novo
        self._salvar()

    def _exigir_estado(self) -> None:
        if self.estado is None:
            raise ErroDeEntrada(["sem estado.json em %s: rode iniciar" % self.raiz])

    @contextlib.contextmanager
    def _sob_trava(self):
        """`rodar` e `iniciar` tomam a trava da raiz, a menos que quem chamou já a tenha (o `main`)."""
        if self.trava_externa or self._travado:
            yield
            return
        with travar(self.raiz):
            self._travado = True
            try:
                yield
            finally:
                self._travado = False

    def _orq(self) -> dict:
        orquestrador = self.estado.get("orquestrador")
        if not isinstance(orquestrador, dict):
            orquestrador = self.estado["orquestrador"] = {"runId": None, "motivo": None}
        return orquestrador

    def _bloqueado(self) -> bool:
        return bool(self._orq().get("bloqueio"))

    # ------------------------------------------------------------ config e plano

    def _modelo(self, papel) -> dict:
        modelos = self.config["modelos"]
        entrada = modelos.get(papel_normalizado(papel))
        if entrada is None:
            entrada = modelos.get(papel)
        return _validar_modelo(entrada, str(papel_normalizado(papel)))

    def _papeis_sem_modelo(self, plano) -> list[str]:
        faltando = []
        for raia in _raias_por_id(plano).values():
            papel = raia.get("papel")
            try:
                self._modelo(papel)
            except ConfigInvalida:
                faltando.append(str(papel))
        return sorted(set(faltando))

    def _exigir_papeis(self, plano) -> None:
        """Só em `iniciar`: no `rodar` um papel sem modelo vira decisão (nunca loop de reinício)."""
        faltando = self._papeis_sem_modelo(plano)
        if faltando:
            raise ConfigInvalida(
                "o plano usa papéis sem modelo em config['modelos']: %s" % ", ".join(sorted(set(faltando)))
            )

    def _motivo_nao_despachavel(self, raia: dict):
        try:
            self._modelo(raia.get("papel"))
            prompts.prompt_template_raia(raia.get("papel"))
        except (ConfigInvalida, ValueError) as exc:
            return self._seguro(str(exc))
        return None

    def _protegidos(self) -> list[str]:
        return list(dict.fromkeys(list(self.config["protegidos"]) + list(PROTEGIDOS_FIXOS)))

    def _raia_do_plano(self, raia_id):
        return _raias_por_id(self.plano).get(raia_id)

    def _papel_da_raia(self, raia_id):
        return _dict(self._raia_do_plano(raia_id)).get("papel")

    def _mesmo_repo(self, repo) -> bool:
        return isinstance(repo, str) and repo.lower() == self.repo.lower()

    def _ler_plano(self, ref: str):
        """`(plano | None, erros, existe)` do plano (`caminho_plano`) em `ref` (JSON estrito)."""
        texto = self.forja.arquivo(self.repo, ref, self.caminho_plano)
        if texto is None:
            return None, ["%s ausente em %s" % (self.caminho_plano, ref)], False
        try:
            plano = _json_estrito(texto)
        except (ValueError, RecursionError):
            return None, ["%s em %s não é JSON válido" % (self.caminho_plano, ref)], True
        return plano, raias.validar_plano(plano), True

    def _adotar_plano(self, plano: dict) -> None:
        if plano != self.plano:
            gravar_json_atomico(self.raiz / ARQ_PLANO, plano)
            self.plano = copy.deepcopy(plano)
            self._log({"evento": "plano", "faseAtual": plano.get("faseAtual"), "raias": sorted(_raias_por_id(plano))})

    def _recarregar_plano(self) -> None:
        try:
            plano, erros, existe = self._ler_plano(self.branch)
        except Exception as exc:  # noqa: BLE001 - segue com o plano anterior
            self._erro_de_etapa("recarregar_plano", self.branch, exc)
            return
        self._esquecer("recarregar_plano:%s" % self.branch)
        if not existe:
            return
        if erros:
            self._aviso(
                "plano do branch %s inválido; mantido o anterior: %s" % (self.branch, "; ".join(erros[:3]))
            )
            return
        self._adotar_plano(plano)

    # ------------------------------------------------------------ iniciar e retomar

    def _novo_estado(self) -> None:
        self.estado = est.novo_estado(
            self.plano, projeto=self.projeto, repo=self.repo, limite_paralelo=self.config["limiteParalelo"]
        )
        self.estado["acordarPendentes"] = []
        self._salvar()

    def iniciar(self, *, spec: str | None = None) -> str:
        with self._sob_trava():
            if spec is None:
                plano, erros, _ = self._ler_plano(self.branch)
                if erros:
                    raise ErroDeEntrada(erros)
                self._exigir_papeis(plano)
                self._adotar_plano(plano)
                if self.estado is None:
                    self._novo_estado()
                    self._log({"evento": "iniciar", "plano": True})
                    return "estado iniciado em %s" % self.raiz
                self._log({"evento": "iniciar", "plano": True, "aviso": "o estado já existia e foi mantido"})
                return "o estado já existia em %s e foi mantido" % self.raiz
            if self.estado is None:
                self._validar_spec(spec)
                plano, erros, _ = self._ler_plano(self.branch)
                if plano is not None and not erros:
                    self._adotar_plano(plano)
                self._novo_estado()
            self._recuperar_acao_interrompida()
            return self._iniciar_spec(spec, executar=True)

    def _validar_spec(self, spec) -> None:
        if not _texto(spec):
            raise ErroDeEntrada(["--spec vazio"])
        try:
            conteudo = self.forja.arquivo(self.repo, self.branch, spec)
        except ValueError:
            raise ErroDeEntrada(["caminho de spec inválido: %r" % spec]) from None
        if conteudo is None:
            raise ErroDeEntrada(["a spec %r não existe no branch %s" % (spec, self.branch)])

    def _iniciar_spec(self, spec: str, *, executar: bool) -> str:
        chave = "nova_spec:%s" % spec
        pendentes = _lista(self.estado.get("acordarPendentes"))
        if chave in _lista(self.estado.get("chavesAcordadas")) or any(
            p.get("motivo") == "nova_spec" and p.get("alvo") == spec for p in pendentes
        ):
            return "spec já iniciada: %s" % spec
        self._validar_spec(spec)
        self._log({"evento": "iniciar", "spec": spec})
        self._enfileirar_acordar("nova_spec", spec, {"spec": spec})
        if executar and not self._drenando():
            acao = self._proposta_de_pendente()
            if (
                acao is not None
                and acao["motivo"] == "nova_spec"
                and acao["alvo"] == spec
                and self._liberada_pela_capacidade(acao)
            ):
                self._executar(acao)
                if chave in _lista(self.estado.get("chavesAcordadas")):
                    return "orquestrador acordado com a spec %s" % spec
        return "spec %s registrada: o orquestrador será acordado quando estiver livre" % spec

    def retomar(self) -> None:
        self._exigir_estado()
        antes = {"pausado": self.estado.get("pausado"), "falhasAcordar": self.estado.get("falhasAcordar")}
        self.estado["pausado"] = None
        self.estado["falhasAcordar"] = 0
        self.estado["adiamentosRede"] = {}
        liberadas = liberar_raias_em_cota(self.estado)
        if liberadas:
            antes["raiasLiberadas"] = liberadas
        self._salvar()  # a issue de pausa, se houver, é fechada pelo ciclo (_observar_pausa)
        self._log({"evento": "retomar", "antes": antes})

    # ------------------------------------------------------------ ciclo

    def ciclo(self) -> list[dict]:
        """Um ciclo. Quem chama tem a trava da raiz (`rodar` a toma); duas instâncias soltas não se enxergam."""
        self._exigir_estado()
        self._observadas = set()
        self._retry_after = 0
        self._leituras = {"ok": 0, "falhas": 0}
        self._falhas_do_ciclo = []
        self._rede_do_ciclo = set()
        self._ja_cancelados = set()
        self._capacidade_sincronizada = False
        self._acordar_recusado = False
        self._recuperar_acao_interrompida()
        self._recuperar_decisoes_pendentes()
        self._recarregar_plano()
        self._consumir_entrada()
        self._observar_pausa()
        self._observar_runs_de_seeds()
        self._observar_orquestrador()
        self._sincronizar()
        self._observar_planos()
        self._sincronizar_capacidade()
        self._observar_prs()
        self._observar_decisoes()
        # Q2: as falhas da busca pelo nonce entram na contabilidade do ciclo, por isso antes de _contabilizar_warren
        self._resolver_incertos()
        self._contabilizar_falhas_de_leitura()
        self._contabilizar_warren()
        self._fechar_prs()
        # a acordada que terminou neste ciclo solta a trava antes de _agir: quem espera passa na frente
        self._cuidar_da_trava()
        executadas = self._agir()
        self._sincronizar_capacidade()
        self._cuidar_da_trava()
        self._desistir_sem_demanda()
        self._garantir_decisao_de_bloqueio()
        self._garantir_decisao_de_pausa()
        return executadas

    def rodar(self, *, intervalo: int = 30, ciclos: int | None = None, dormir=time.sleep) -> None:
        with self._sob_trava():
            # M9: o estado em disco é o que vale depois de tomar a trava
            self.estado = _ler_estado(self.raiz)
            if self.estado is not None and (self.estado.get("repo") != self.repo or self.estado.get("projeto") != self.projeto):
                raise ConfigInvalida("o estado.json desta raiz é de outro projeto ou repositório")
            self.plano = _dict(_ler_json(self.raiz / ARQ_PLANO))
            self._exigir_estado()
            try:
                residuos = _dict(self._limpar())
                registro = {k: residuos.get(k) for k in ("conteineres", "redes", "diretorios")}
                registro["erros"] = [self._seguro(e) for e in _lista(residuos.get("erros"))]
            except Exception as exc:  # noqa: BLE001
                registro = {"erros": [self._erro(exc)]}
            self._log(dict({"evento": "limpar_residuos"}, **registro))
            self._garantir_label_de_decisao()
            feitos = 0
            while ciclos is None or feitos < ciclos:
                if feitos == 0 or self._preparar_agora(feitos):
                    self._preparar_o_warren()
                feitos += 1
                try:
                    self.ciclo()
                except Exception as exc:  # noqa: BLE001 - o laço segue; o estado já está gravado
                    self._log({"evento": "erro_no_ciclo", "erro": self._erro(exc)})
                if ciclos is not None and feitos >= ciclos:
                    break
                dormir(max(intervalo, self._retry_after))

    def _garantir_label_de_decisao(self) -> None:
        """Uma vez por partida: o label das issues de decisão existe. Falhar vira aviso e não impede a partida."""
        try:
            self.forja.garantir_label(self.repo, LABEL_DECISAO, COR_LABEL_DECISAO, DESCRICAO_LABEL_DECISAO)
        except Exception as exc:  # noqa: BLE001 - o label é conveniência; as decisões abrem sem ele
            self._erro_de_etapa("garantir_label", LABEL_DECISAO, exc)
            self._aviso(AVISO_LABEL_DECISAO)

    # ------------------------------------------------------------ preparar_warren (Task 7b)

    def _preparar_ligado(self) -> bool:
        return self._preparar_warren is not None and bool(_dict(self.config.get("warren")).get("prepararAutomatico", True))

    def _warren_preparado(self) -> bool:
        preparado = _dict(self.estado.get("warrenPreparado"))
        return (
            preparado.get("estado") in WARREN_PREPARADO and preparado.get("dropin") != "erro" and preparado.get("automerge") != "erro"
        )

    def _preparar_agora(self, feitos: int) -> bool:
        """D: a cada ciclo enquanto espera runs; senão, a cada 20 ciclos enquanto não estiver preparado."""
        if _dict(self.estado.get("warrenPreparado")).get("estado") == "aguardando_runs":
            return True
        return feitos % CICLOS_PREPARAR_WARREN == 0 and not self._warren_preparado()

    def _drenando(self) -> bool:
        if self._preparar_ligado() and _texto(_dict(self.estado.get("drenagemWarren")).get("desde")):
            return True
        return self._drenagem_do_coordenador()

    def _drenagem_do_coordenador(self) -> bool:
        """Com capacidade global, o coordenador da fila prepara o Warren e marca a drenagem no capacidade.json.

        Arquivo ilegível não drena: a reserva e a trava já recusam com ele, e o erro vai para o log. Uma drenagem
        mais velha que `DRENAGEM_MAXIMA` (ou com instante ilegível) é de um coordenador que morreu: é ignorada,
        com um aviso por `desde`.
        """
        if self.capacidade is None:
            return False
        try:
            desde = capacidade.ler(self.capacidade).get("drenagem")
        except (capacidade.CapacidadeInvalida, OSError) as exc:
            self._erro_de_etapa("drenagem_do_coordenador", self.plano_id, exc)
            return False
        if not _texto(desde):
            return False
        try:
            inicio = datetime.datetime.strptime(desde, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            self._aviso("drenagem global ilegível (%s), ignorada" % _cortar(desde, 60))
            return False
        if self._agora().astimezone(datetime.timezone.utc) - inicio >= DRENAGEM_MAXIMA:
            self._aviso("drenagem global vencida desde %s" % desde)
            return False
        return True

    def _preparar_o_warren(self) -> None:
        """Prepara o Warren (`preparar_warren.preparar`: --model, drop-in e automerge), se a config deixar.

        "versao_desconhecida", "erro" e "revertido" geram um aviso único; "aguardando_runs" volta no próximo ciclo e,
        repetido, liga a drenagem; "revertido" com o Warren fora gera um aviso a cada vez e uma decisão rastreada.
        """
        if not self._preparar_ligado():
            return
        try:
            try:
                resultado = self._preparar_warren(sha_revertido=self._sha_revertido)
            except Exception as exc:  # noqa: BLE001 - o preparar não lança, mas o laço não pode cair por ele
                resultado = {"estado": "erro", "detalhe": self._erro(exc)}
            if not isinstance(resultado, dict) or resultado.get("estado") not in ESTADOS_DO_PREPARAR:
                resultado = {"estado": "erro", "detalhe": "resultado inválido do preparar_warren"}
            estado = resultado["estado"]
            registro = {"estado": estado, "detalhe": self._seguro(resultado.get("detalhe") or "")}
            for chave in ("dropin", "automerge"):
                if _texto(resultado.get(chave)):
                    registro[chave] = self._seguro(resultado[chave], 40)
            if estado == "revertido":
                if _texto(resultado.get("sha")):
                    self._sha_revertido = resultado["sha"]
            else:
                self._sha_revertido = None
            anterior = _dict(self.estado.get("warrenPreparado"))
            seguidas = (anterior.get("esperasSeguidas") if _inteiro(anterior.get("esperasSeguidas")) else 0) + 1 if estado == "aguardando_runs" else 0
            # F13: o drop-in só conta como carregado com um resultado que o confirma (sem restart pendente nem rollback)
            carregado = anterior.get("dropinCarregado") is True
            if estado in ESTADOS_COM_DROPIN_CARREGADO and registro.get("dropin") in ("ok", "alterado"):
                carregado = True
            elif registro.get("dropin") == "erro":
                carregado = False
            self.estado["warrenPreparado"] = dict(
                registro, em=self._agora().isoformat(), esperasSeguidas=seguidas, dropinCarregado=carregado
            )
            self._salvar()
            self._log(dict({"evento": "preparar_warren"}, **registro))
            self._atualizar_drenagem(estado, seguidas)
            if estado in ESTADOS_SEM_MODELO:
                self._aviso(AVISO_WARREN_SEM_MODELO)
            elif estado in WARREN_PREPARADO:
                self._retirar_aviso(AVISO_WARREN_SEM_MODELO)
            if registro.get("automerge") == "erro":
                self._aviso(AVISO_AUTOMERGE)
                self._garantir_decisao_de_automerge()
            if registro.get("dropin") == "erro":
                self._aviso(AVISO_DROPIN)
            if estado == "revertido" and resultado.get("warrenVoltou") is False:
                self._warren_fora_apos_rollback(registro["detalhe"])
        except Exception as exc:  # noqa: BLE001 - tenta de novo depois
            self._erro_de_etapa("preparar_warren", "warren", exc)

    def _merges_suspensos(self) -> bool:
        """F8: com o warren-automerge ainda ativo, os merges ficam segurados (os despachos seguem)."""
        return self._preparar_ligado() and _dict(self.estado.get("warrenPreparado")).get("automerge") == "erro"

    def _garantir_decisao_de_automerge(self) -> None:
        corpo = (
            "%s. O despachante não conseguiu desligar o `warren-automerge.service` e segura os merges (os despachos "
            "seguem) até o desligamento dar certo; ele tenta de novo a cada 20 ciclos. Confira o `sudo -n` do usuário "
            "do despachante ou desligue o serviço à mão (`sudo systemctl disable --now warren-automerge.service`). "
            "Esta issue é fechada sozinha quando o preparo informar o automerge desligado ou ausente." % MOTIVO_AUTOMERGE
        )
        try:
            url = self._abrir_decisao_rastreada(MOTIVO_AUTOMERGE, "warren", TITULO_AUTOMERGE, corpo, tipo="automerge")
            self._log({"evento": "automerge_ativo", "url": url})
        except Exception as exc:  # noqa: BLE001 - a intenção gravada fica para a recuperação
            self._erro_de_etapa("automerge_ativo", self.repo, exc)

    def _retirar_aviso(self, mensagem: str) -> None:
        avisos = self.estado.get("avisos")
        if isinstance(avisos, list) and mensagem in avisos:
            self.estado["avisos"] = [a for a in avisos if a != mensagem]
            self._salvar()

    def _warren_fora_apos_rollback(self, detalhe: str) -> None:
        """E: aviso a cada ocorrência (não deduplicado) e uma decisão rastreada, que fecha quando o Warren volta."""
        avisos = self.estado.setdefault("avisos", [])
        if not isinstance(avisos, list):
            avisos = self.estado["avisos"] = []
        avisos.append(AVISO_WARREN_FORA_APOS_ROLLBACK)
        self._salvar()
        self._log({"evento": "aviso", "mensagem": AVISO_WARREN_FORA_APOS_ROLLBACK})
        corpo = (
            "O despachante aplicou a preparação do Warren (o --model no adaptador claude-code e o drop-in do systemd), "
            "o Warren não voltou depois do restart, a mudança foi revertida e ele continua fora do ar: %s. Novas tentativas "
            "automáticas ficam suspensas até o despachante reiniciar ou o arquivo do adaptador mudar. Esta issue é fechada "
            "sozinha quando o Warren voltar a responder." % detalhe
        )
        try:
            url = self._abrir_decisao_rastreada(AVISO_WARREN_FORA_APOS_ROLLBACK, "warren", TITULO_WARREN_ROLLBACK, corpo, tipo="warren_rollback")
            self._log({"evento": "warren_fora_apos_rollback", "url": url})
        except Exception as exc:  # noqa: BLE001 - a intenção fica gravada e é recuperada no próximo ciclo
            self._erro_de_etapa("warren_rollback", self.repo, exc)

    @staticmethod
    def _instante(valor):
        try:
            return datetime.datetime.fromisoformat(valor) if _texto(valor) else None
        except ValueError:
            return None

    def _atualizar_drenagem(self, estado: str, seguidas: int) -> None:
        """D: drenagem limitada a 45 min (F13: 25 min sem o drop-in carregado); depois do teto, só de novo depois de 6 h."""
        agora = self._agora()
        carregado = _dict(self.estado.get("warrenPreparado")).get("dropinCarregado") is True
        teto = DRENAGEM_MAXIMA if carregado else DRENAGEM_MAXIMA_SEM_DROPIN
        drenagem = _dict(self.estado.get("drenagemWarren"))
        desde = self._instante(drenagem.get("desde"))
        proxima = self._instante(drenagem.get("proxima"))
        if estado != "aguardando_runs":
            if desde is not None:
                self.estado["drenagemWarren"] = {"desde": None, "proxima": drenagem.get("proxima")}
                self._salvar()
                self._log({"evento": "drenagem_warren", "acao": "fim", "estado": estado})
            return
        if desde is not None:
            if agora - desde >= teto:
                volta = agora + PAUSA_ENTRE_DRENAGENS
                self.estado["drenagemWarren"] = {"desde": None, "proxima": volta.isoformat()}
                self._salvar()
                self._log({"evento": "drenagem_warren", "acao": "teto", "desde": drenagem.get("desde")})
                self._aviso(
                    "drenagem do Warren para o restart do preparo expirou depois de %d min com runs ativos (desde %s); "
                    "despachos retomados, nova drenagem a partir de %s"
                    % (teto.total_seconds() // 60, drenagem.get("desde"), volta.isoformat())
                )
            return
        if seguidas >= ESPERAS_PARA_DRENAR and (proxima is None or agora >= proxima):
            self.estado["drenagemWarren"] = {"desde": agora.isoformat(), "proxima": None}
            self._salvar()
            self._log({"evento": "drenagem_warren", "acao": "inicio"})

    # ------------------------------------------------------------ entrada e pausa

    def _consumir_entrada(self) -> None:
        pasta = self.raiz / DIR_ENTRADA
        if not pasta.is_dir():
            return
        pedidos = sorted(
            p for p in pasta.iterdir() if p.name.endswith(".json") and not p.name.startswith(".") and p.is_file()
        )
        aplicados = _lista(self.estado.get("entradaAplicada"))
        for caminho in pedidos:
            if caminho.name in aplicados:
                self._apagar_pedido(caminho)
                continue
            try:
                pedido = _json_estrito(caminho.read_text(encoding="utf-8"))
                if not isinstance(pedido, dict):
                    raise ValueError("não é um objeto")
            except (OSError, ValueError, RecursionError):
                self._aviso("pedido inválido em %s/%s descartado" % (DIR_ENTRADA, caminho.name))
                self._marcar_pedido(caminho)
                continue
            comando = pedido.get("comando")
            try:
                if comando == "retomar":
                    self.retomar()
                elif comando == "iniciar" and _texto(pedido.get("spec")):
                    try:
                        self._log({"evento": "pedido", "resultado": self._iniciar_spec(pedido["spec"], executar=False)})
                    except ErroDeEntrada as exc:
                        self._aviso("pedido iniciar --spec %s recusado: %s" % (pedido["spec"], exc))
                else:
                    self._aviso("pedido desconhecido em %s/%s descartado: %r" % (DIR_ENTRADA, caminho.name, comando))
            except Exception as exc:  # noqa: BLE001 - o pedido fica para o próximo ciclo
                self._erro_de_etapa("pedido", caminho.name, exc)
                continue
            self._log({"evento": "pedido_aplicado", "arquivo": caminho.name, "comando": comando})
            self._marcar_pedido(caminho)

    def _marcar_pedido(self, caminho: pathlib.Path) -> None:
        """M7: o nome do pedido aplicado fica registrado; se o arquivo não sair, ele nunca é reaplicado."""
        aplicados = _lista(self.estado.get("entradaAplicada")) + [caminho.name]
        self.estado["entradaAplicada"] = aplicados[-LIMITE_ENTRADA_APLICADA:]
        self._salvar()
        self._apagar_pedido(caminho)

    def _apagar_pedido(self, caminho: pathlib.Path) -> None:
        try:
            caminho.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            self._aviso("não foi possível apagar o pedido %s/%s (%s); ele não será reaplicado" % (DIR_ENTRADA, caminho.name, type(exc).__name__))

    def _observar_pausa(self) -> None:
        pausa = _dict(self.estado.get("decisaoPausa"))
        if not _texto(pausa.get("url")):
            return
        if not self.estado.get("pausado"):
            # retomado por outro caminho: a issue de pausa não vale mais
            self._fechar_depois(pausa["url"], "Despachante retomado; issue fechada pelo despachante.", decisao=True)
            self.estado["decisaoPausa"] = None
            self._salvar()
            return
        try:
            info = _dict(self.forja.decisao(pausa["url"]))
        except Exception as exc:  # noqa: BLE001
            self._erro_de_etapa("observar_pausa", pausa["url"], exc)
            if _eh_falha_de_rede(exc):
                return
            falhas = (pausa.get("falhas") if _inteiro(pausa.get("falhas")) else 0) + 1
            if _eh_404(exc) or falhas >= MAX_FALHAS_DE_LEITURA:
                # M6: a issue sumiu ou não se lê: uma nova é aberta no fim do ciclo
                self.estado["decisaoPausa"] = None
                self._aviso("issue de pausa %s ilegível; outra será aberta" % pausa["url"])
            else:
                self.estado["decisaoPausa"] = dict(pausa, falhas=falhas)
            self._salvar()
            return
        if info.get("fechada") is True:
            self.estado["decisaoPausa"] = None
            self.retomar()
            self._log({"evento": "pausa_respondida", "url": pausa["url"]})

    def _garantir_decisao_de_pausa(self) -> None:
        motivo = self.estado.get("pausado")
        if not motivo or _texto(_dict(self.estado.get("decisaoPausa")).get("url")):
            return
        corpo = "O despachante pausou: %s\n\nAvisos recentes:\n%s\n\n%s" % (
            motivo,
            "\n".join("- " + a for a in _lista(self.estado.get("avisos"))[-LIMITE_AVISOS_COMPACTOS:]) or "- (nenhum)",
            "Feche esta issue (com ou sem comentário) para retomar o despachante.",
        )
        try:
            url = self._abrir_decisao_rastreada(
                motivo, "despachante", "[fábrica] despachante pausado: %s" % _cortar(motivo, 80), corpo, tipo="pausa"
            )
        except Exception as exc:  # noqa: BLE001 - tenta de novo no próximo ciclo
            self._erro_de_etapa("decisao_de_pausa", motivo, exc)
            return
        self._log({"evento": "pausa_aberta", "url": url, "motivo": motivo})

    def _garantir_decisao_de_bloqueio(self) -> None:
        bloqueio = _dict(self._orq().get("bloqueio"))
        if not bloqueio or _texto(bloqueio.get("url")):
            return
        erros = [str(e) for e in _lista(bloqueio.get("erros"))][:20] or ["(sem detalhe)"]
        motivo = "o orquestrador não produziu um plano válido %d vezes seguidas: %s" % (MAX_SEM_RESULTADO, "; ".join(erros))
        corpo = "%s\n\nAs acordadas do orquestrador ficam suspensas até esta issue ser respondida.\n\n%s" % (
            motivo,
            RODAPE_DECISAO,
        )
        try:
            url = self._abrir_decisao_rastreada(motivo, ALVO_DO_ORQUESTRADOR, TITULO_SEM_PLANO, corpo, tipo="bloqueio")
        except Exception as exc:  # noqa: BLE001 - tenta de novo no próximo ciclo
            self._erro_de_etapa("decisao_de_bloqueio", "orquestrador", exc)
            return
        if isinstance(self._orq().get("bloqueio"), dict):
            self._orq()["bloqueio"]["url"] = url
            self._salvar()

    # ------------------------------------------------------------ observação

    def _recuperar_acao_interrompida(self) -> None:
        acao = self.estado.get("acaoEmCurso")
        if acao is None:
            return
        tipo = _dict(acao).get("tipo")
        if tipo in ACOES_PAGAS and _texto(_dict(acao).get("nonce")):
            # P1: o despacho pode ter sido aceito antes da queda: procura pelo nonce em vez de adivinhar
            nonce = acao.get("nonce")
            sem_nonce = {k: v for k, v in acao.items() if k not in ("nonce", "nonceRaiz", "desde")}
            self.estado.pop("acaoEmCurso", None)
            self._registrar_incerto(sem_nonce, nonce, acao.get("desde") if _texto(acao.get("desde")) else None)
            return
        if tipo == "acordar":
            self.estado["pausado"] = "acordar interrompido"
            mensagem = (
                "o despachante parou no meio de acordar %s:%s; confira no Warren se o orquestrador "
                "foi despachado e feche a issue de pausa para retomar" % (acao.get("motivo"), acao.get("alvo"))
            )
        elif tipo in ("aguardar_humano", "cancelar_raia"):
            # aguardar_humano: a intenção com nonce acha ou abre a issue; cancelar_raia: o próximo
            # ciclo refaz a substituição (o plan run cancelado não faz a raia falhar)
            mensagem = "ação %s %s interrompida por reinício: refeita no próximo ciclo" % (
                tipo,
                acao.get("raia") or acao.get("seed"),
            )
        else:
            self.estado = est.aplicar(self.estado, acao, {})
            mensagem = "ação %s %s interrompida por reinício: tratada como despacho sem id" % (
                tipo,
                acao.get("raia") or acao.get("seed"),
            )
        self.estado.pop("acaoEmCurso", None)
        self._salvar()
        self._aviso(mensagem)

    def _contar_falha_de_leitura(self, chave: str) -> int:
        contadores = self.estado.get("falhasLeitura")
        if not isinstance(contadores, dict):
            contadores = self.estado["falhasLeitura"] = {}
        n = contadores.get(chave)
        n = (n if _inteiro(n) else 0) + 1
        contadores[chave] = n
        return n

    def _zerar_falha_de_leitura(self, chave: str) -> None:
        contadores = _dict(self.estado.get("falhasLeitura"))
        if chave in contadores:
            del contadores[chave]
            self._salvar()

    @staticmethod
    def _run_sintetico() -> dict:
        return {"estado": "failed", "motivoFalha": "run_ilegivel", "prUrl": None, "_sintetico": True}

    def _ler_run(self, run_id: str, *, somente=None):
        """O run normalizado; `None` numa falha passageira; um run `failed` sintético se ele sumiu.

        Falha de rede nunca conta para o run (é queda do Warren). Um 404 é uma resposta do Warren:
        o run sumiu. Outras falhas contam só no fim do ciclo, e só se alguma leitura deu certo.
        """
        perdidos = _lista(self.estado.get("runsPerdidos"))
        if run_id in perdidos:
            self.estado["runsPerdidos"] = [r for r in perdidos if r != run_id]
            self._salvar()
            return self._run_sintetico()
        if somente is not None:
            return None
        try:
            run = _dict(self.motor.run(run_id))
        except Exception as exc:  # noqa: BLE001
            self._erro_de_etapa("observar_run", run_id, exc)
            self._leituras["falhas"] += 1
            if _eh_falha_de_rede(exc):
                self._rede_do_ciclo.add(run_id)
                return None
            # P4: um 404 só vale num ciclo com alguma leitura boa (um proxy errado também responde 404)
            self._falhas_do_ciclo.append(("run404" if _eh_404(exc) else "run", run_id, None))
            return None
        self._leituras["ok"] += 1
        self._esquecer("observar_run:%s" % run_id)
        self._zerar_falha_de_leitura(run_id)
        estado_run = run.get("estado")
        if estado_run not in NAO_TERMINAIS_DE_RUN + TERMINAIS_DE_RUN:
            self._aviso("run %s em estado desconhecido %r: tratado como failed" % (run_id, estado_run))
            run["estado"] = "failed"
        return run

    def _texto_do_run(self, run_id: str, run: dict, *, obrigatorio: bool):
        """O último texto do run, quando ele é necessário (veredito ou cota); `None` se a leitura falhar."""
        if run.get("_sintetico") or (not obrigatorio and run.get("motivoFalha") != "provider_error"):
            return ""
        try:
            texto = self.motor.ultimo_texto(run_id)
        except Exception as exc:  # noqa: BLE001
            self._erro_de_etapa("ultimo_texto", run_id, exc)
            return None
        return texto if isinstance(texto, str) else ""

    def _observar_runs_de_seeds(self, somente=None) -> None:
        for seed_id, seed in list(_dict(self.estado.get("seeds")).items()):
            for campo, papel in (("revisaoRunId", "revisor"), ("fixerRunId", "fixer")):
                run_id = _dict(seed).get(campo)
                if not _texto(run_id) or (somente is not None and run_id not in somente):
                    continue
                run = self._ler_run(run_id, somente=somente)
                if run is None or run.get("estado") not in TERMINAIS_DE_RUN:
                    continue
                if self._infra_perdida(run_id, run):
                    situacao, novo = self._retry_do_warren(run_id, papel, seed_id)
                    if situacao == "adotado":
                        _dict(self.estado["seeds"][seed_id])[campo] = novo
                        self._salvar()
                        continue
                    if situacao == "esperar":
                        continue
                revisao = campo == "revisaoRunId"
                texto = self._texto_do_run(run_id, run, obrigatorio=revisao)
                if texto is None:
                    continue  # tenta de novo no próximo ciclo, sem gastar tentativa
                veredito = None
                estado_run, motivo_falha = run["estado"], run.get("motivoFalha")
                sem_commit = revisao and estado_run == "failed" and motivo_falha in MOTIVOS_SEM_COMMIT
                if revisao and (estado_run == "succeeded" or sem_commit):
                    veredito = _veredito_limpo(prompts.extrair_veredito(texto))
                if sem_commit and veredito is not None:
                    estado_run, motivo_falha = "succeeded", None
                cota = prompts.eh_falha_de_cota(motivo_falha, texto)
                self._mudar(
                    est.registrar_fim_de_run(
                        self.estado,
                        run_id,
                        estado_run=estado_run,
                        motivo_falha=motivo_falha,
                        veredito=veredito,
                        cota=cota,
                    )
                )
                if run.get("motivoFalha") == est.OOM:
                    self._notar_oom()
                self._log(
                    {
                        "evento": "fim_de_run",
                        "papel": papel,
                        "seed": seed_id,
                        "runId": run_id,
                        "estado": run["estado"],
                        "motivoFalha": run.get("motivoFalha"),
                        "veredito": _dict(veredito).get("resultado"),
                        "cota": cota,
                    }
                )
                self._esquecer_nonces(run_id)
                if not run.get("_sintetico"):
                    self._conferir_modelo(run_id, papel)

    def _infra_perdida(self, run_id: str, run: dict) -> bool:
        """R2: run `failed` por perda de infraestrutura, que o Warren refaz sozinho; um retry adotado não ganha outro."""
        return (
            run.get("estado") == "failed"
            and run.get("motivoFalha") in MOTIVOS_INFRA_PERDIDA
            and not run.get("_sintetico")
            and not _texto(self._nonces_do_run(run_id).get("retryDe"))
        )

    def _retry_do_warren(self, run_id: str, papel: str, alvo) -> tuple:
        """R2: procura o retry automático do Warren (`retryOf` ou o nonce) por até 3 leituras boas.

        Devolve ("adotado", id), ("esperar", None) ou ("desistir", None): no último caso vale o caminho de hoje.
        A busca que falha não gasta leitura boa; na 10ª falha seguida abre uma decisão rastreada (como Q2).
        """
        esperados = self.estado.get("retriesEsperados")
        if not isinstance(esperados, dict):
            esperados = self.estado["retriesEsperados"] = {}
        item = esperados.get(run_id)
        if not isinstance(item, dict):
            desde = (datetime.datetime.now(datetime.timezone.utc) - MARGEM_DESDE).strftime("%Y-%m-%dT%H:%M:%SZ")
            item = esperados[run_id] = {
                "papel": papel,
                "alvo": alvo,
                "buscas": 0,
                "falhasBusca": 0,
                "desde": desde,
                "vistoEm": self._agora_utc(),
                "nonces": [n for n in _lista(self._nonces_do_run(run_id).get("nonces")) if _texto(n)],
            }
            self._salvar()
            self._aviso("run %s (%s) falhou por infra perdida: procurando o retry automático do Warren" % (run_id, papel))
        chave = "retry:%s" % run_id
        try:
            achado = self.motor.procurar_retry(self.projeto, run_id, list(item["nonces"]), item.get("desde") if _texto(item.get("desde")) else None)
        except Exception as exc:  # noqa: BLE001 - sem leitura boa, nada conta para o item; a falha conta para o ciclo
            self._erro_de_etapa("procurar_retry", run_id, exc)
            self._leituras["falhas"] += 1
            if _eh_falha_de_rede(exc):
                self._rede_do_ciclo.add(run_id)
            falhas = (item.get("falhasBusca") if _inteiro(item.get("falhasBusca")) else 0) + 1
            item["falhasBusca"] = falhas
            self._salvar()
            if falhas >= MAX_FALHAS_DE_BUSCA_INCERTA:
                self._garantir_decisao_de_incerto(
                    chave, falhas, "O run %s (%s, %s) falhou por infra perdida e o Warren deve tê-lo refeito sozinho" % (run_id, papel, alvo)
                )
            return ("esperar", None)
        self._leituras["ok"] += 1
        item["falhasBusca"] = 0
        if _texto(achado) and achado != run_id:
            esperados.pop(run_id, None)
            self._lembrar_nonces(achado, item["nonces"], retry_de=run_id)
            self._esquecer_nonces(run_id)
            self._salvar()
            self._log({"evento": "retry_adotado", "original": run_id, "runId": achado, "papel": papel, "alvo": alvo})
            self._aviso("run %s (%s) foi refeito pelo Warren como %s: adotado como continuação" % (run_id, papel, achado))
            self._fechar_decisao_de_incerto(chave, "O retry %s do run %s foi achado no Warren; issue fechada pelo despachante." % (achado, run_id))
            return ("adotado", achado)
        item["buscas"] = (item.get("buscas") if _inteiro(item.get("buscas")) else 0) + 1
        if item["buscas"] < CICLOS_PARA_ACHAR_RETRY or not self._passou_o_piso(item):
            self._salvar()
            return ("esperar", None)
        esperados.pop(run_id, None)
        self._salvar()
        self._log({"evento": "retry_nao_encontrado", "runId": run_id, "papel": papel, "alvo": alvo})
        self._fechar_decisao_de_incerto(chave, "O Warren não refez o run %s; o despachante segue o caminho normal." % run_id)
        return ("desistir", None)

    def _passou_o_piso(self, item: dict) -> bool:
        """F6: 5 min desde que a falha ou a incerteza foi vista (`vistoEm`); sem marca legível, ela começa agora."""
        try:
            return instante(self._agora_utc()) - instante(item.get("vistoEm")) >= PISO_PARA_DESISTIR
        except ValueError:
            item["vistoEm"] = self._agora_utc()
            return False

    def _observar_orquestrador(self, somente=None) -> None:
        orquestrador = self._orq()
        run_id = orquestrador.get("runId")
        if not _texto(run_id) or (somente is not None and run_id not in somente):
            return
        run = self._ler_run(run_id, somente=somente)
        if run is None or run.get("estado") not in TERMINAIS_DE_RUN:
            return
        if self._infra_perdida(run_id, run):
            situacao, novo = self._retry_do_warren(run_id, "orquestrador", orquestrador.get("motivo"))
            if situacao == "adotado":
                self._orq()["runId"] = novo
                self._salvar()
                return
            if situacao == "esperar":
                return
        if run["estado"] == "succeeded":
            try:
                resultado = self._tratar_pr_orquestrador(run_id, run, orquestrador.get("motivo"))
            except Exception as exc:  # noqa: BLE001 - não conclui: o próximo ciclo tenta de novo
                self._erro_de_etapa("pr_do_orquestrador", run_id, exc)
                resultado = self._falha_ao_tratar(run_id, run, orquestrador.get("motivo"), exc)
                if resultado is None:
                    return
            if resultado["r"] == "esperar":
                return
            self._contar_resultado_do_orquestrador(run_id, resultado)
        else:
            self._reenfileirar_acordada(run_id, run)
        texto = self._texto_do_run(run_id, run, obrigatorio=False) or ""
        self._mudar(
            est.registrar_fim_de_run(
                self.estado,
                run_id,
                estado_run=run["estado"],
                motivo_falha=run.get("motivoFalha"),
                veredito=None,
                cota=prompts.eh_falha_de_cota(run.get("motivoFalha"), texto),
            )
        )
        if run.get("motivoFalha") == est.OOM:
            self._notar_oom()
        self._esquecer_nonces(run_id)
        if not run.get("_sintetico"):
            self._conferir_modelo(run_id, "orquestrador")
        self._concluir_orquestrador()
        self._log({"evento": "orquestrador_concluido", "runId": run_id, "estado": run["estado"]})

    def _falha_ao_tratar(self, run_id: str, run: dict, motivo, exc: BaseException):
        """Até a 5ª falha seguida o PR é tratado de novo no ciclo seguinte; depois vai para o Paulo."""
        orquestrador = self._orq()
        n = orquestrador.get("falhasTratar")
        n = (n if _inteiro(n) and n >= 0 else 0) + 1
        orquestrador["falhasTratar"] = n
        self._salvar()
        if n < MAX_FALHAS_DE_LEITURA:
            self._aviso("falha ao tratar o PR do orquestrador (run %s); nova tentativa no próximo ciclo" % run_id)
            return None
        alvo = run.get("prUrl") if _texto(run.get("prUrl")) else run_id
        motivos = ["não foi possível tratar o PR do orquestrador em %d ciclos seguidos: %s" % (n, self._erro(exc))]
        try:
            url = self._decidir_humano_orquestrador(alvo, motivo, motivos)
        except Exception as falha:  # noqa: BLE001 - nem a decisão abriu: tenta tudo de novo depois
            self._erro_de_etapa("decisao_pr_do_orquestrador", run_id, falha)
            return None
        return self._sem_resultado(url, motivos)

    def _contar_resultado_do_orquestrador(self, run_id: str, resultado: dict) -> None:
        orquestrador = self._orq()
        if orquestrador.get("contadoRunId") == run_id:
            return  # um reinício depois de contar este run não conta de novo
        orquestrador["contadoRunId"] = run_id
        n = orquestrador.get("semResultadoSeguidos")
        n = n if _inteiro(n) and n >= 0 else 0
        if resultado["r"] == "merge":
            n = 0
        elif resultado["r"] == "sem_resultado":
            n += 1
        orquestrador["semResultadoSeguidos"] = n
        self.estado["falhasAcordar"] = 0  # o run terminou bem: a cadeia de falhas acabou
        if resultado["r"] == "sem_resultado":
            if n >= MAX_SEM_RESULTADO:
                url = resultado.get("decisao")
                orquestrador["bloqueio"] = {"url": url, "erros": list(resultado.get("erros") or [])[:20]}
                for decisao in _lista(self.estado.get("decisoes")):
                    if isinstance(decisao, dict) and url is not None and decisao.get("url") == url:
                        decisao["tipo"] = "bloqueio"
                # durante o bloqueio, nenhum plano_invalido espera na fila
                self.estado["acordarPendentes"] = [
                    p for p in _lista(self.estado.get("acordarPendentes")) if _dict(p).get("motivo") != "plano_invalido"
                ]
                self._aviso("orquestrador sem resultado %d vezes seguidas: acordadas suspensas até a resposta do Paulo" % n)
            elif resultado.get("acordar"):
                contexto = dict(resultado.get("contexto") or {})
                contexto["runId"] = run_id
                anterior = _dict(orquestrador.get("acordada"))
                if _texto(anterior.get("motivo")):
                    contexto["acordadaAnterior"] = copy.deepcopy(anterior)
                self._enfileirar_acordar(
                    "plano_invalido", ALVO_DO_ORQUESTRADOR, contexto, salvar=False, repetir=True, atualizar=True
                )
        self._salvar()

    def _reenfileirar_acordada(self, run_id: str, run: dict) -> None:
        """Run do orquestrador que não terminou `succeeded`: a mesma acordada volta para a fila."""
        orquestrador = self._orq()
        if orquestrador.get("contadoRunId") == run_id:
            return
        orquestrador["contadoRunId"] = run_id
        acordada = _dict(orquestrador.get("acordada"))
        if _texto(acordada.get("motivo")):
            self._enfileirar_acordar(
                acordada["motivo"], acordada.get("alvo"), _dict(acordada.get("contexto")), repetir=True, salvar=False
            )
        falhas = self.estado.get("falhasAcordar")
        falhas = (falhas if _inteiro(falhas) and falhas >= 0 else 0) + 1
        self.estado["falhasAcordar"] = falhas
        if falhas >= est.MAX_FALHAS_ACORDAR and not self.estado.get("pausado"):
            self.estado["pausado"] = "orquestrador falhou %d vezes seguidas" % falhas
        self._salvar()
        self._aviso(
            "run %s do orquestrador terminou %s (%s): acordada %s:%s de volta à fila (falha %d)"
            % (run_id, run.get("estado"), run.get("motivoFalha"), acordada.get("motivo"), acordada.get("alvo"), falhas)
        )

    def _concluir_orquestrador(self) -> None:
        antes = self._orq()
        manter = {k: antes[k] for k in ("semResultadoSeguidos", "bloqueio", "contadoRunId") if k in antes}
        novo = est.concluir_orquestrador(self.estado)
        _dict(novo.get("orquestrador")).update(manter)
        self._mudar(novo)

    def _observar_planos(self) -> None:
        for raia_id, raia in list(_dict(self.estado.get("raias")).items()):
            raia = _dict(raia)
            plan_run_id = raia.get("planRunId")
            if raia.get("estado") != "executando" or not _texto(plan_run_id):
                continue
            try:
                observado = _dict(self.motor.plano(plan_run_id))
            except Exception as exc:  # noqa: BLE001
                self._erro_de_etapa("observar_plano", raia_id, exc)
                self._leituras["falhas"] += 1
                if _eh_falha_de_rede(exc):
                    self._rede_do_ciclo.add(plan_run_id)
                else:
                    self._falhas_do_ciclo.append(("plano404" if _eh_404(exc) else "plano", plan_run_id, raia_id))
                continue
            self._leituras["ok"] += 1
            self._esquecer("observar_plano:%s" % raia_id)
            self._zerar_falha_de_leitura(plan_run_id)
            filhos = observado.get("filhos")
            for filho in _lista(filhos):
                filho = _dict(filho)
                if filho.get("falha") == est.OOM:
                    # com ou sem runId, e qualquer que seja o limite local: a chave do filho evita repetir
                    self._notar_oom("%s:%s:%s:%s" % (raia_id, plan_run_id, filho.get("seedId"), filho.get("runId") or ""))
            seeds = _dict(self.estado.get("seeds"))
            for filho in _lista(filhos):
                filho = _dict(filho)
                seed_id = filho.get("seedId")
                seed = _dict(seeds.get(seed_id))
                if (
                    seed.get("estado") == "mergeada"
                    and _texto(filho.get("prUrl"))
                    and filho.get("prUrl") != seed.get("pr")
                    and _texto(seed.get("planRunId"))
                    and seed.get("planRunId") != plan_run_id
                ):
                    del seeds[seed_id]
                    self._esquecer_tentativa(seed_id, "Nova tentativa da seed %s" % seed_id)
                    self._log({"evento": "seed_reiniciada", "seed": seed_id, "pr": filho.get("prUrl")})
            antes = copy.deepcopy(_dict(self.estado.get("seeds")))
            estado_plano, falha = observado.get("estado"), observado.get("falha")
            if estado_plano in ("failed", "cancelled") and self._substituicao_pendente(raia_id):
                # L1: o cancelamento é a substituição em curso, não uma falha da raia
                self._ja_cancelados.add(raia_id)
                estado_plano, falha = "running", None
            else:
                cota = self._cota_em_filho(raia_id, filhos) if estado_plano in ("failed", "cancelled") else None
                if cota == "ilegivel":
                    continue  # P2: sem ler o texto do filho não dá para decidir; tenta no próximo ciclo
                if cota == "cota":
                    # P2: a raia não falha; ao retomar ela volta a planejada e ganha um Plan Run novo
                    estado_plano, falha = "running", None
            self._mudar(
                est.registrar_plano(
                    self.estado,
                    raia_id,
                    estado_plano=estado_plano,
                    falha=falha,
                    filhos=filhos,
                )
            )
            depois = _dict(self.estado.get("seeds"))
            self._guardar_tentativas_reiniciadas(antes, depois)
            for seed_id, anterior in antes.items():
                anterior, atual = _dict(anterior), _dict(depois.get(seed_id))
                if not atual:
                    continue
                if (atual.get("runId") != anterior.get("runId") and atual.get("estado") == "executando") or (
                    _texto(atual.get("pr")) and atual.get("pr") != anterior.get("pr")
                ):
                    self._esquecer_tentativa(seed_id, "Nova tentativa da seed %s" % seed_id)
            for filho in _lista(filhos):
                seed = _dict(depois.get(_dict(filho).get("seedId")))
                if seed and seed.get("planRunId") != plan_run_id:
                    seed["planRunId"] = plan_run_id
                    self._salvar()
            papel = self._papel_da_raia(raia_id)
            for filho in _lista(filhos):
                filho = _dict(filho)
                seed_id, run_id = filho.get("seedId"), filho.get("runId")
                agora = _dict(depois.get(seed_id)).get("estado")
                if (
                    _texto(run_id)
                    and papel is not None
                    and _dict(antes.get(seed_id)).get("estado") in (None, "executando")
                    and agora not in (None, "executando")
                ):
                    self._conferir_modelo(run_id, papel)

    def _aviso_de_plano_ilegivel(self, plan_run_id: str, raia_id: str) -> None:
        self._aviso(
            "Plan Run %s da raia %s ilegível no Warren (404 ou %d falhas seguidas); o despachante segue tentando"
            % (plan_run_id, raia_id, MAX_FALHAS_DE_LEITURA)
        )

    def _cota_em_filho(self, raia_id: str, filhos):
        """`"cota"`, `"ilegivel"` (o texto de um filho com provider_error não se leu) ou None.

        O resume do Warren só aceita merge timeouts (resume.ts responde 409 aos outros): a cota não
        usa retomar_plano. A raia fica `aguardandoCota` e volta a `planejada` quando o despachante retoma.
        """
        vistos = self.estado.get("cotaFilhos")
        if not isinstance(vistos, list):
            vistos = self.estado["cotaFilhos"] = []
        ilegiveis = _lista(self.estado.get("textosIlegiveis"))
        resultado = None
        for filho in _lista(filhos):
            filho = _dict(filho)
            run_id = filho.get("runId")
            if filho.get("falha") != "provider_error" or not _texto(run_id) or run_id in ilegiveis:
                continue
            if run_id in vistos:
                resultado = "cota"
                continue
            try:
                texto = self.motor.ultimo_texto(run_id)
            except Exception as exc:  # noqa: BLE001 - sem o texto não dá para afirmar cota
                self._erro_de_etapa("ultimo_texto", run_id, exc)
                if not _eh_falha_de_rede(exc):
                    self._leituras["falhas"] += 1
                    self._falhas_do_ciclo.append(("texto", run_id, raia_id))
                return "ilegivel"
            self._zerar_falha_de_leitura(run_id)
            if not prompts.eh_falha_de_cota("provider_error", texto if isinstance(texto, str) else ""):
                continue
            resultado = "cota"
            vistos.append(run_id)
            self.estado["cotaFilhos"] = vistos[-LIMITE_COTA_FILHOS:]
            raia = _dict(_dict(self.estado.get("raias")).get(raia_id))
            raia["aguardandoCota"] = True
            self.estado["pausado"] = "cota"
            self._salvar()
            self._aviso("filho %s da raia %s bateu cota do provedor: despachante pausado; a raia recomeça depois do retomar" % (run_id, raia_id))
        return resultado

    def _sincronizar(self) -> None:
        """`sincronizar_plano` a cada ciclo; PRs das seeds tiradas do estado (I5) são fechados."""
        antes = _dict(self.estado.get("seeds"))
        novo = est.sincronizar_plano(self.estado, self.plano)
        depois = _dict(novo.get("seeds"))
        self.estado = novo
        for seed_id, seed in antes.items():
            if seed_id in depois:
                continue
            if _texto(_dict(seed).get("pr")):
                self._fechar_depois(
                    seed["pr"], "PR fechado pelo despachante: a raia %s foi replanejada." % _dict(seed).get("raia")
                )
            self._esquecer_tentativa(seed_id, "A raia %s foi replanejada" % _dict(seed).get("raia"))
        self._salvar()

    def _contabilizar_falhas_de_leitura(self) -> None:
        """Falhas por id só contam num ciclo em que alguma leitura do Warren deu certo (I1)."""
        falhas, self._falhas_do_ciclo = self._falhas_do_ciclo, []
        if not falhas or self._leituras["ok"] == 0:
            return
        perdidos = []
        for tipo, ident, raia_id in falhas:
            if tipo == "run404":
                _dict(self.estado.get("falhasLeitura")).pop(ident, None)
                perdidos.append(ident)
                self._aviso("run %s ilegível no Warren (404): tratado como failed" % ident)
                continue
            if tipo == "plano404":
                self._aviso_de_plano_ilegivel(ident, raia_id)
                continue
            n = self._contar_falha_de_leitura(ident)
            if n < MAX_FALHAS_DE_LEITURA:
                continue
            if tipo == "plano":
                self._aviso_de_plano_ilegivel(ident, raia_id)
                continue
            if tipo == "texto":
                # P2: o texto do filho não se lê: a raia segue o caminho normal (sem afirmar cota)
                _dict(self.estado.get("falhasLeitura")).pop(ident, None)
                self.estado["textosIlegiveis"] = (_lista(self.estado.get("textosIlegiveis")) + [ident])[-LIMITE_COTA_FILHOS:]
                self._aviso("texto do run %s ilegível no Warren (%d falhas seguidas): sem verificar cota" % (ident, MAX_FALHAS_DE_LEITURA))
                continue
            _dict(self.estado.get("falhasLeitura")).pop(ident, None)
            perdidos.append(ident)
            self._aviso("run %s ilegível no Warren (%d falhas seguidas): tratado como failed" % (ident, MAX_FALHAS_DE_LEITURA))
        self._salvar()
        if perdidos:
            lista = self.estado.get("runsPerdidos")
            self.estado["runsPerdidos"] = list(dict.fromkeys(_lista(lista) + perdidos))
            self._salvar()
            self._observar_runs_de_seeds(somente=set(perdidos))
            self._observar_orquestrador(somente=set(perdidos))

    def _esquecer_tentativa(self, seed_id: str, motivo: str) -> None:
        """P3: a chave de acordar e as decisões da tentativa anterior da seed não valem para a nova."""
        chave = "gate_falhou_apos_fixer:%s" % seed_id
        chaves = _lista(self.estado.get("chavesAcordadas"))
        if chave in chaves:
            self.estado["chavesAcordadas"] = [c for c in chaves if c != chave]
        restantes = []
        for decisao in _lista(self.estado.get("decisoes")):
            if isinstance(decisao, dict) and decisao.get("tipo", "seed") == "seed" and decisao.get("alvo") == seed_id:
                if _texto(decisao.get("url")):
                    self._fechar_depois(decisao["url"], "%s; decisão encerrada pelo despachante." % motivo, decisao=True)
            else:
                restantes.append(decisao)
        self.estado["decisoes"] = restantes
        self._salvar()

    def _guardar_tentativas_reiniciadas(self, antes: dict, depois: dict) -> None:
        """Um redespacho zera a seed; guarda a revisão e a verificação para o caso de o PR e o head voltarem iguais."""
        guardadas = self.estado.get("tentativasAnteriores")
        if not isinstance(guardadas, dict):
            guardadas = self.estado["tentativasAnteriores"] = {}
        mudou = False
        for seed_id, anterior in antes.items():
            anterior, atual = _dict(anterior), _dict(depois.get(seed_id))
            if (
                _texto(anterior.get("pr"))
                and _texto(anterior.get("headSha"))
                and anterior.get("estado") not in est.TERMINAIS
                and atual.get("estado") == "executando"
                and atual.get("pr") is None
            ):
                guardadas[seed_id] = {
                    k: copy.deepcopy(anterior.get(k))
                    for k in ("pr", "headSha", "estado", "veredito", "verificacao", "revisaoRunId", "revisaoSha", "tentativasRevisao")
                }
                mudou = True
        if mudou:
            self._salvar()

    def _restaurar_tentativa(self, seed_id: str) -> None:
        guardadas = _dict(self.estado.get("tentativasAnteriores"))
        anterior = guardadas.pop(seed_id, None)
        if not isinstance(anterior, dict):
            return
        seed = _dict(_dict(self.estado.get("seeds")).get(seed_id))
        if (
            seed.get("pr") == anterior.get("pr")
            and seed.get("headSha") == anterior.get("headSha")
            and seed.get("revisaoRunId") is None
            and seed.get("veredito") is None
            and seed.get("verificacao") is None
        ):
            for chave in ("veredito", "verificacao", "revisaoRunId", "revisaoSha", "tentativasRevisao"):
                seed[chave] = anterior.get(chave)
            if seed.get("estado") == "em_revisao" and anterior.get("estado") == "aguardando_gates":
                seed["estado"] = "aguardando_gates"
            self._log({"evento": "tentativa_preservada", "seed": seed_id, "headSha": seed.get("headSha")})
        self._salvar()

    def _observar_prs(self) -> None:
        for seed_id, seed in list(_dict(self.estado.get("seeds")).items()):
            seed = _dict(seed)
            if seed.get("estado") not in est.ESTADOS_DE_GATE or not _texto(seed.get("pr")):
                continue
            try:
                pr = _dict(self.forja.pr(seed["pr"]))
                if not self._mesmo_repo(pr.get("repo")):
                    self._aviso(
                        "seed %s: PR %s é do repositório %s, não de %s; nenhuma ação"
                        % (seed_id, seed["pr"], pr.get("repo"), self.repo)
                    )
                    continue
                if pr.get("mergeado") is True:
                    # o Warren vai informar o merge do filho; até lá, nenhuma ação
                    self._log_repetivel("pr_mergeado:%s" % seed_id, {"evento": "pr_mergeado", "seed": seed_id, "pr": seed["pr"]})
                    continue
                if pr.get("aberto") is not True:
                    self._aviso("seed %s: PR %s está fechado sem merge observado; nenhuma ação" % (seed_id, seed["pr"]))
                    continue
                ci = self.forja.ci(self.repo, pr.get("headSha"))
            except Exception as exc:  # noqa: BLE001 - sem leitura completa, nenhuma ação de gate
                self._erro_de_etapa("observar_pr", seed_id, exc)
                continue
            self._esquecer("observar_pr:%s" % seed_id)
            self._mudar(
                est.registrar_pr(
                    self.estado,
                    seed_id,
                    head_sha=pr.get("headSha"),
                    branch=pr.get("branch"),
                    arquivos=pr.get("arquivos"),
                    ci=ci,
                    agora=self._agora(),
                )
            )
            self._restaurar_tentativa(seed_id)
            self._observadas.add(seed_id)

    def _observar_decisoes(self) -> None:
        decisoes = _lista(self.estado.get("decisoes"))
        restantes, recriar, mudou = [], [], False
        for decisao in decisoes:
            if not isinstance(decisao, dict) or not _texto(decisao.get("url")):
                mudou = True
                continue
            if decisao.get("tipo") == "warren_rollback":
                # E: fecha sozinha quando o Warren volta a responder
                try:
                    self.motor.versao()
                except Exception:  # noqa: BLE001 - ainda fora: a decisão fica
                    restantes.append(decisao)
                    continue
                mudou = True
                self._fechar_depois(decisao["url"], "O Warren voltou a responder; issue fechada pelo despachante.", decisao=True)
                continue
            if decisao.get("tipo") == "config":
                # P10: se o despachante está rodando, a config voltou a valer
                mudou = True
                self._fechar_depois(decisao["url"], "A config voltou a ser válida; issue fechada pelo despachante.", decisao=True)
                continue
            if decisao.get("tipo") == "automerge":
                # F8: fecha sozinha quando o preparo informa o automerge desligado ou ausente; sem preparo
                # (FABRICA_PREPARAR_WARREN=0) o dono do preparo é o coordenador: a decisão fica como está
                if self._preparar_warren is None or self._merges_suspensos():
                    restantes.append(decisao)
                    continue
                mudou = True
                self._fechar_depois(decisao["url"], "O warren-automerge foi desligado; merges retomados. Issue fechada pelo despachante.", decisao=True)
                continue
            if decisao.get("tipo", "seed") == "seed" and self._seed_resolvida(decisao):
                # F5: a seed foi mergeada, ficou obsoleta ou saiu do estado: a decisão acabou e não acorda ninguém
                mudou = True
                self._fechar_depois(
                    decisao["url"], "A seed %s foi mergeada ou saiu do plano; decisão encerrada pelo despachante." % decisao.get("alvo"), decisao=True
                )
                self._log({"evento": "decisao_resolvida", "url": decisao["url"], "alvo": decisao.get("alvo")})
                continue
            if decisao.get("tipo") == "orquestrador" and self._pr_mergeado(decisao.get("alvo")):
                # F9: o merge do Paulo é a aprovação: a decisão fecha sem acordar o orquestrador
                mudou = True
                self._fechar_depois(
                    decisao["url"], "O PR %s foi mergeado: a aprovação está registrada. Issue fechada pelo despachante." % decisao.get("alvo"), decisao=True
                )
                self.estado["prsOrquestrador"] = [u for u in _lista(self.estado.get("prsOrquestrador")) if u != decisao.get("alvo")]
                self._log({"evento": "decisao_aprovada_por_merge", "url": decisao["url"], "pr": decisao.get("alvo")})
                continue
            try:
                info = _dict(self.forja.decisao(decisao["url"]))
            except Exception as exc:  # noqa: BLE001 - a decisão fica na lista
                self._erro_de_etapa("observar_decisao", decisao["url"], exc)
                if not _eh_falha_de_rede(exc) and _eh_404(exc):
                    # P6: a issue sumiu: uma nova, rastreada, com o mesmo motivo e alvo
                    mudou = True
                    recriar.append((decisao, "A issue anterior (%s) sumiu." % decisao["url"]))
                    continue
                restantes.append(decisao)
                continue
            if info.get("fechada") is not True:
                if decisao.pop("falhasReabrir", None) is not None:
                    mudou = True
                restantes.append(decisao)
                continue
            orquestrador = self._orq()
            comentario = info.get("ultimoComentario")
            respondida = _texto(comentario) and comentario.strip() and MARCADOR_DESPACHANTE not in comentario
            de_bloqueio = decisao.get("tipo") == "bloqueio" or _dict(orquestrador.get("bloqueio")).get("url") == decisao["url"]
            observacao = None
            if not respondida and not de_bloqueio:
                fechada_em = info.get("fechadaEm") if _texto(info.get("fechadaEm")) else None
                if self._leitura_velha(decisao, fechada_em, comentario):
                    restantes.append(decisao)
                    continue
                fechamentos = (decisao.get("fechamentosSemComentario") if _inteiro(decisao.get("fechamentosSemComentario")) else 0) + 1
                if fechamentos < MAX_FECHAMENTOS_SEM_COMENTARIO:
                    # I4: sem comentário não há decisão; a issue é reaberta e continua acompanhada
                    try:
                        self.forja.reabrir_decisao(decisao["url"], PEDIR_COMENTARIO + "\n\n" + MARCADOR_DESPACHANTE)
                        # Q3: a hora da nossa reabertura e o closed_at que vimos separam a leitura velha de um fechamento novo
                        decisao.update(reabertaEm=self._agora_utc(), fechadaEmVista=fechada_em, fechamentosSemComentario=fechamentos)
                        decisao.pop("falhasReabrir", None)
                        mudou = True
                        self._log({"evento": "decisao_reaberta", "url": decisao["url"], "vezes": fechamentos})
                    except Exception as exc:  # noqa: BLE001 - tenta reabrir de novo no próximo ciclo
                        self._erro_de_etapa("reabrir_decisao", decisao["url"], exc)
                        falhas = (decisao.get("falhasReabrir") if _inteiro(decisao.get("falhasReabrir")) else 0) + 1
                        decisao["falhasReabrir"] = falhas
                        mudou = True
                        if falhas >= MAX_REABERTURAS_FALHAS:
                            recriar.append((decisao, "A issue anterior (%s) não pôde ser reaberta." % decisao["url"]))
                            continue
                    restantes.append(decisao)
                    continue
                # Q3: fechada pela 3ª vez sem comentário: a decisão sai da lista e o orquestrador decide
                observacao = OBSERVACAO_FECHADA_SEM_COMENTARIO
            mudou = True
            if de_bloqueio:
                orquestrador["bloqueio"] = None
                orquestrador["semResultadoSeguidos"] = 0
            orquestrador["semResultadoSeguidos"] = 0
            contexto = {"pergunta": decisao.get("motivo"), "resposta": comentario if respondida else "", "alvo": decisao.get("alvo")}
            if observacao is not None:
                contexto["observacao"] = observacao
            self._enfileirar_acordar("resposta_paulo", decisao["url"], contexto, salvar=False)
            self._log({"evento": "decisao_respondida", "url": decisao["url"], "comComentario": bool(respondida), "observacao": observacao})
            if decisao.get("tipo") == "incerto":
                self._manter_incerto_apos_resposta(decisao.get("alvo"))
            alvo = decisao.get("alvo")
            acompanhados = _lista(self.estado.get("prsOrquestrador"))
            if alvo in acompanhados:
                self._fechar_depois(alvo, "Decisão %s respondida; PR fechado pelo despachante." % decisao["url"])
                self.estado["prsOrquestrador"] = [u for u in acompanhados if u != alvo]
        if mudou:
            self.estado["decisoes"] = restantes
            self._salvar()
        for decisao, nota in recriar:
            self._recriar_decisao(decisao, nota)

    def _seed_resolvida(self, decisao: dict) -> bool:
        """F5: a seed da decisão não existe mais, é terminal ou já é outra tentativa (outro PR).

        Toda decisão de seed nasce com o campo `pr` (`_registrar_intencao`); sem ele, não é decisão de seed."""
        if "pr" not in decisao:
            return False
        seed = _dict(self.estado.get("seeds")).get(decisao.get("alvo"))
        if not isinstance(seed, dict) or seed.get("estado") in est.TERMINAIS:
            return True
        return seed.get("pr") != decisao.get("pr")

    def _pr_mergeado(self, url) -> bool:
        """F9: o PR do orquestrador foi mergeado (pelo Paulo); na dúvida (leitura falha), False."""
        if not _texto(url) or "/pull/" not in url:
            return False
        try:
            pr = _dict(self.forja.pr(url))
        except Exception as exc:  # noqa: BLE001 - segue o caminho de hoje
            self._erro_de_etapa("pr_da_decisao", url, exc)
            return False
        return pr.get("mergeado") is True and self._mesmo_repo(pr.get("repo"))

    def _agora_utc(self) -> str:
        momento = self._agora()
        if momento.tzinfo is None:
            momento = momento.astimezone()  # relógio local (datetime.now): converte para UTC pelo fuso da máquina
        return momento.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    @staticmethod
    def _leitura_velha(decisao: dict, fechada_em, comentario) -> bool:
        """Q3/R4: depois da nossa reabertura, uma leitura com closed_at <= o closed_at que vimos ao reabrir é velha e
        é ignorada; closed_at maior é o Paulo fechando de novo. Sem closed_at visto, vale `reabertaEm` (o nosso relógio).
        Sem closed_at na leitura, vale P8 (último comentário nosso)."""
        reaberta = decisao.get("reabertaEm")
        if not _texto(reaberta):
            return False
        regra_do_marcador = bool(_texto(comentario) and MARCADOR_DESPACHANTE in comentario)
        vista = decisao.get("fechadaEmVista")
        if _texto(vista):
            # R4: com o closed_at visto na reabertura, só o relógio do GitHub contra ele mesmo decide
            try:
                return not instante(fechada_em) > instante(vista)
            except ValueError:
                return regra_do_marcador
        try:
            return not instante(fechada_em) > instante(reaberta)  # fallback: a hora da nossa reabertura
        except ValueError:
            return regra_do_marcador

    def _recriar_decisao(self, decisao: dict, nota: str) -> None:
        tipo, alvo = decisao.get("tipo", "seed"), decisao.get("alvo")
        titulo = decisao.get("titulo") or "[fábrica] decisão necessária: %s" % alvo
        corpo = "%s\n\n%s\n\n%s" % (decisao.get("motivo") or "", nota, RODAPE_DECISAO)
        try:
            url = self._abrir_decisao_rastreada(decisao.get("motivo") or "", alvo, titulo, corpo, tipo=tipo, pr=decisao.get("pr"))
            self._log({"evento": "decisao_recriada", "anterior": decisao.get("url"), "url": url})
        except Exception as exc:  # noqa: BLE001 - a intenção gravada fica para a recuperação
            self._erro_de_etapa("recriar_decisao", decisao.get("url"), exc)

    def _fechar_depois(self, url: str, comentario: str, *, decisao: bool = False) -> None:
        fila = self.estado.get("prsParaFechar")
        if not isinstance(fila, list):
            fila = self.estado["prsParaFechar"] = []
        if not any(_dict(item).get("url") == url for item in fila):
            item = {"url": url, "comentario": self._seguro(comentario, 2000) + "\n\n" + MARCADOR_DESPACHANTE, "tentativas": 0}
            if decisao or "/issues/" in url:
                item["decisao"] = True
            fila.append(item)

    def _fechar_prs(self) -> None:
        fila = _lista(self.estado.get("prsParaFechar"))
        if not fila:
            return
        restantes = []
        for item in fila:
            item = _dict(item)
            url = item.get("url")
            if not _texto(url):
                continue
            try:
                comentario = item.get("comentario") or "Fechado pelo despachante.\n\n" + MARCADOR_DESPACHANTE
                if item.get("decisao"):
                    self.forja.fechar_decisao(url, comentario)
                    self._log({"evento": "fechado", "url": url})
                    continue
                pr = _dict(self.forja.pr(url))
                if pr.get("aberto") is not True or pr.get("mergeado") is True or not self._mesmo_repo(pr.get("repo")):
                    continue
                self.forja.fechar_pr(url, comentario)
                self._log({"evento": "fechado", "url": url})
            except Exception as exc:  # noqa: BLE001 - tenta de novo nos próximos ciclos
                tentativas = (item.get("tentativas") if _inteiro(item.get("tentativas")) else 0) + 1
                self._erro_de_etapa("fechar", url, exc)
                if tentativas < MAX_TENTATIVAS_DE_FECHAR:
                    restantes.append(dict(item, tentativas=tentativas))
                else:
                    self._aviso("não foi possível fechar %s depois de %d tentativas" % (url, tentativas))
        self.estado["prsParaFechar"] = restantes
        self._salvar()

    def _contabilizar_warren(self) -> None:
        fora = self.estado.get("warrenFora")
        if not isinstance(fora, dict):
            fora = self.estado["warrenFora"] = {"ciclos": 0, "url": None}
        ciclos = fora.get("ciclos") if _inteiro(fora.get("ciclos")) else 0
        if self._leituras["ok"] > 0:
            fora["ciclos"] = 0
            if _texto(fora.get("url")):
                # P4: histerese: a issue só fecha depois de 3 ciclos seguidos sem nenhuma falha
                limpos = fora.get("limpos") if _inteiro(fora.get("limpos")) else 0
                fora["limpos"] = limpos + 1 if self._leituras["falhas"] == 0 else 0
                if fora["limpos"] >= CICLOS_LIMPOS_PARA_FECHAR:
                    self._fechar_depois(fora["url"], "O Warren voltou a responder; issue fechada pelo despachante.", decisao=True)
                    self.estado["warrenFora"] = {"ciclos": 0, "url": None}
                    self._aviso("o Warren voltou depois de ficar inacessível")
            self._contabilizar_rede_parcial()
            self._salvar()
            return
        if self._leituras["falhas"] == 0:
            return
        fora["ciclos"] = ciclos + 1
        fora["limpos"] = 0
        self._salvar()
        if fora["ciclos"] >= CICLOS_WARREN_FORA and not _texto(fora.get("url")):
            corpo = (
                "Nenhuma leitura do Warren deu certo em %d ciclos seguidos. O despachante continua "
                "tentando; esta issue é fechada sozinha quando ele voltar." % fora["ciclos"]
            )
            try:
                url = self._abrir_decisao_rastreada("Warren inacessível", "warren", TITULO_WARREN, corpo, tipo="warren")
                self._log({"evento": "warren_inacessivel", "url": url})
                self._aviso("Warren inacessível há %d ciclos: issue %s aberta" % (fora["ciclos"], url))
            except Exception as exc:  # noqa: BLE001
                self._erro_de_etapa("warren_inacessivel", self.repo, exc)

    def _contabilizar_rede_parcial(self) -> None:
        """P4: Warren respondendo, mas ids ou ações com falha de rede seguida: uma decisão em 10 ciclos."""
        contadores = self.estado.get("falhasDeRede")
        if not isinstance(contadores, dict):
            contadores = self.estado["falhasDeRede"] = {}
        for ident in [i for i in contadores if i not in self._rede_do_ciclo]:
            del contadores[ident]
        for ident in self._rede_do_ciclo:
            contadores[ident] = (contadores.get(ident) if _inteiro(contadores.get(ident)) else 0) + 1
        graves = sorted(i for i, n in contadores.items() if _inteiro(n) and n >= CICLOS_REDE_PARCIAL)
        graves += sorted(c for c, n in _dict(self.estado.get("adiamentosRede")).items() if _inteiro(n) and n >= MAX_ADIAMENTOS_DE_REDE)
        parcial = self.estado.get("warrenParcial")
        if not isinstance(parcial, dict):
            parcial = self.estado["warrenParcial"] = {"url": None, "limpos": 0}
        if graves and not _texto(parcial.get("url")):
            lista = ", ".join(graves[:20])
            corpo = (
                "O Warren responde, mas estes runs, Plan Runs ou despachos falham na rede há %d ciclos seguidos: %s. "
                "Nada foi tratado como falho; esta issue é fechada sozinha quando eles voltarem." % (CICLOS_REDE_PARCIAL, lista)
            )
            try:
                self._abrir_decisao_rastreada(
                    "Warren parcialmente inacessível: %s" % lista, "warren", "%s: %s" % (TITULO_WARREN_PARCIAL, _cortar(lista, 120)), corpo, tipo="warren_parcial"
                )
            except Exception as exc:  # noqa: BLE001
                self._erro_de_etapa("warren_parcial", self.repo, exc)
        if _texto(parcial.get("url")):
            limpos = parcial.get("limpos") if _inteiro(parcial.get("limpos")) else 0
            parcial["limpos"] = limpos + 1 if not self._rede_do_ciclo and self._leituras["falhas"] == 0 and not graves else 0
            if parcial["limpos"] >= CICLOS_LIMPOS_PARA_FECHAR:
                self._fechar_depois(parcial["url"], "Os runs voltaram a responder; issue fechada pelo despachante.", decisao=True)
                self.estado["warrenParcial"] = {"url": None, "limpos": 0}

    def _conferir_modelo(self, run_id: str, papel) -> None:
        try:
            configurado = self._modelo(papel)["modelo"]
        except ConfigInvalida:
            return
        try:
            efetivo = self.motor.modelo_efetivo(run_id)
        except Exception as exc:  # noqa: BLE001 - a conferência nunca atrapalha o fluxo
            self._erro_de_etapa("modelo_efetivo", run_id, exc)
            return
        if not _texto(efetivo) or efetivo == configurado:
            return
        papel = papel_normalizado(papel)
        efetivo = _cortar(efetivo, 100)
        chave = "%s|%s|%s" % (papel, configurado, efetivo)
        vistos = self.estado.get("modelosDivergentes")
        if not isinstance(vistos, list):
            vistos = self.estado["modelosDivergentes"] = []
        if chave in vistos:
            return
        vistos.append(chave)
        self._aviso(
            "papel %s rodou em %s, configurado %s: o patch de modelo no Warren é aplicado automaticamente; estado atual: %s"
            % (papel, efetivo, configurado, _dict(self.estado.get("warrenPreparado")).get("estado") or "não verificado")
        )

    # ------------------------------------------------------------ PR do orquestrador

    def _tratar_pr_orquestrador(self, run_id: str, run: dict, motivo) -> dict:
        """Efeito do run `succeeded`; devolve `{"r": merge | sem_resultado | neutro | esperar, ...}`."""
        pr_url = run.get("prUrl")
        if not _texto(pr_url):
            return {"r": "sem_resultado", "erros": [SEM_PR], "contexto": {"erro": SEM_PR}, "acordar": True}
        pr = _dict(self.forja.pr(pr_url))
        self._substituir_prs_do_orquestrador(pr_url)
        orquestrador = self._orq()
        if not self._mesmo_repo(pr.get("repo")):
            motivos = ["PR em outro repositório: %s" % pr.get("repo")]
            return self._sem_resultado(self._decidir_humano_orquestrador(pr_url, motivo, motivos), motivos)
        if pr.get("mergeado") is True:
            marca = _dict(orquestrador.get("mergeEmCurso"))
            if marca.get("pr") == pr_url and marca.get("sha") == pr.get("headSha"):
                self._log({"evento": "merge_do_orquestrador", "pr": pr_url, "sha": marca["sha"], "recuperado": True})
                return {"r": "merge"}
            self._aviso("PR %s do orquestrador foi mergeado fora do despachante" % pr_url)
            return {"r": "neutro"}
        if pr.get("aberto") is not True:
            motivos = ["o PR do orquestrador não está aberto"]
            return self._sem_resultado(self._decidir_humano_orquestrador(pr_url, motivo, motivos), motivos)
        arquivos = pr.get("arquivos")
        head = pr.get("headSha")
        if not isinstance(arquivos, list) or not _texto(head):
            motivos = ["PR do orquestrador ilegível"]
            return self._sem_resultado(self._decidir_humano_orquestrador(pr_url, motivo, motivos), motivos)
        if est.PERGUNTA_DO_ORQUESTRADOR in arquivos:
            self._abrir_pergunta(pr_url, self.forja.arquivo(self.repo, head, est.PERGUNTA_DO_ORQUESTRADOR))
            return {"r": "neutro"}

        motivos = []
        fora = [a for a in arquivos if not _permitido_ao_orquestrador(a, self.caminho_plano)]
        if fora:
            motivos.append("PR fora de .fabrica: " + ", ".join(_cortar(a, 200) for a in fora[:20]))
        # lido no sha do head, que é o que o merge leva (nunca no branch, que pode andar)
        plano_novo, erros, _ = self._ler_plano(head)
        if plano_novo is not None:
            motivos.extend(_mudancas_de_verificacao(self.plano, plano_novo))
            faltando = self._papeis_sem_modelo(plano_novo) if not erros else []
            if faltando:
                motivos.append("o plano novo usa papéis sem modelo em config['modelos']: %s" % ", ".join(faltando))
        # F3: qualquer mudança de fase é homologação do Paulo, qualquer que seja o motivo da acordada
        fase = _mudancas_de_fase(self.plano, plano_novo) if plano_novo is not None and not erros else []
        decisao = "humano" if motivos else est.decidir_pr_orquestrador(
            motivo=motivo, arquivos=arquivos, erros_plano=erros
        )
        if decisao == "mergear" and fase:
            decisao = "humano"
        self._log_repetivel(
            "pr_do_orquestrador:%s" % pr_url,
            {"evento": "pr_do_orquestrador", "pr": pr_url, "decisao": decisao, "motivos": motivos + fase},
        )
        if decisao == "mergear":
            return self._mergear_pr_orquestrador(pr_url, head, motivo)
        if decisao == "replanejar":
            self._fechar_depois(
                pr_url,
                "PR fechado pelo despachante: plano inválido; o orquestrador vai replanejar.\n\n"
                + "\n".join("- " + str(e) for e in erros[:20]),
            )
            return {
                "r": "sem_resultado",
                "erros": list(erros[:20]),
                "contexto": {"erros": erros[:30], "pr": pr_url},
                "acordar": True,
            }
        if decisao != "humano":
            motivos.append("decisão desconhecida %r" % (decisao,))
        url = self._decidir_humano_orquestrador(pr_url, motivo, motivos, fase)
        return self._sem_resultado(url, motivos) if motivos else {"r": "neutro", "decisao": url}

    @staticmethod
    def _sem_resultado(url, motivos) -> dict:
        return {"r": "sem_resultado", "decisao": url, "erros": list(motivos)}

    def _mergear_pr_orquestrador(self, pr_url: str, head: str, motivo) -> dict:
        orquestrador = self._orq()
        if self._merges_suspensos():
            return {"r": "esperar"}  # F8: o merge espera o warren-automerge ser desligado
        ci = self.forja.ci(self.repo, head)
        if ci == "pendente":
            agora = self._agora()
            try:
                desde = datetime.datetime.fromisoformat(orquestrador.get("ciPendenteDesde"))
                espera = agora - desde
            except (TypeError, ValueError):  # ausente, corrompido ou com fuso misturado: recomeça a contar
                orquestrador["ciPendenteDesde"] = agora.isoformat()
                self._salvar()
                return {"r": "esperar"}
            if espera < CI_PENDENTE_MAXIMO:
                return {"r": "esperar"}
            url = self._decidir_humano_orquestrador(pr_url, motivo, ["CI pendente há mais de 2 h no head %s" % head])
            return {"r": "neutro", "decisao": url}
        # K: "ausente" é aceitável (workflows com filtro de caminho não rodam para .fabrica/**)
        if ci == "ausente" and self.config.get("ciObrigatorioNoPlano") is not True:
            ci = "verde"
        if ci != "verde":
            motivos = ["CI %s no head %s" % (ci, head)]
            return self._sem_resultado(self._decidir_humano_orquestrador(pr_url, motivo, motivos), motivos)
        orquestrador["mergeEmCurso"] = {"pr": pr_url, "sha": head}
        self._salvar()
        if self.forja.mergear(pr_url, head) is True:
            self._log({"evento": "merge_do_orquestrador", "pr": pr_url, "sha": head})
            return {"r": "merge"}
        motivos = ["merge recusado pelo GitHub"]
        return self._sem_resultado(self._decidir_humano_orquestrador(pr_url, motivo, motivos), motivos)

    def _substituir_prs_do_orquestrador(self, novo: str) -> None:
        acompanhados = _lista(self.estado.get("prsOrquestrador"))
        antigos = [u for u in acompanhados if u != novo]
        for url in antigos:
            self._fechar_depois(url, "PR substituído pelo PR %s do orquestrador; fechado pelo despachante." % novo)
            # M10: a decisão vinculada ao PR substituído também fecha e sai da lista
            restantes = []
            for decisao in _lista(self.estado.get("decisoes")):
                if isinstance(decisao, dict) and decisao.get("alvo") == url and _texto(decisao.get("url")):
                    self._fechar_depois(
                        decisao["url"], "O PR %s foi substituído pelo PR %s; decisão encerrada." % (url, novo), decisao=True
                    )
                else:
                    restantes.append(decisao)
            self.estado["decisoes"] = restantes
        if antigos:
            self.estado["prsOrquestrador"] = [u for u in acompanhados if u == novo]
            self._salvar()

    def _acompanhar_pr(self, url: str) -> None:
        acompanhados = self.estado.get("prsOrquestrador")
        if not isinstance(acompanhados, list):
            acompanhados = self.estado["prsOrquestrador"] = []
        if url not in acompanhados:
            acompanhados.append(url)
            self._salvar()

    def _decisao_aberta(self, tipo: str, alvo, pr=None):
        if tipo == "pausa":
            return _dict(self.estado.get("decisaoPausa")).get("url") or None
        if tipo == "warren":
            return _dict(self.estado.get("warrenFora")).get("url") or None
        if tipo == "warren_parcial":
            return _dict(self.estado.get("warrenParcial")).get("url") or None
        for decisao in _lista(self.estado.get("decisoes")):
            if (
                isinstance(decisao, dict)
                and decisao.get("tipo", "seed") == tipo
                and decisao.get("alvo") == alvo
                and (tipo != "seed" or decisao.get("pr") == pr)
                and _texto(decisao.get("url"))
            ):
                return decisao["url"]
        return None

    def _procurar_intencao(self, intencao: dict):
        """URL achada, None (não existe) ou "" (5 buscas falharam: abrir mesmo assim)."""
        try:
            return self.forja.procurar_decisao(self.repo, intencao["nonce"], intencao.get("desde"))
        except Exception:
            n = (intencao.get("falhasBusca") if _inteiro(intencao.get("falhasBusca")) else 0) + 1
            intencao["falhasBusca"] = n
            self._salvar()
            if n >= MAX_BUSCAS_FALHAS:
                return ""
            raise

    def _abrir_intencao(self, intencao: dict, duplicata_possivel: bool) -> str:
        corpo = intencao.get("corpo") or ""
        if duplicata_possivel:
            corpo += "\n\nPossível duplicata após reinício: a busca pela issue anterior desta decisão falhou."
        return self.forja.abrir_decisao(
            self.repo, intencao.get("titulo") or "[fábrica] decisão", corpo + "\n\n" + MARCADOR_NONCE % intencao["nonce"]
        )

    def _abrir_decisao_rastreada(self, motivo, alvo, titulo: str, corpo: str, *, tipo: str = "seed", pr=None) -> str:
        """Toda issue de decisão nasce aqui: intenção com nonce gravada antes, issue com o marcador, registro.

        Uma queda em qualquer passo é resolvida por `_recuperar_decisoes_pendentes` (procura pelo nonce):
        nem perda nem duplicata. Uma decisão do mesmo tipo e alvo já aberta é reaproveitada.
        """
        existente = self._decisao_aberta(tipo, alvo, pr)
        if existente:
            return existente
        pendentes = self.estado.get("decisoesPendentes")
        if not isinstance(pendentes, list):
            pendentes = self.estado["decisoesPendentes"] = []
        intencao = next(
            (
                i
                for i in pendentes
                if isinstance(i, dict) and i.get("tipo") == tipo and i.get("alvo") == alvo and (tipo != "seed" or i.get("pr") == pr)
            ),
            None,
        )
        duplicata = False
        if intencao is None:
            desde = datetime.datetime.now(datetime.timezone.utc) - MARGEM_DESDE
            intencao = {
                "nonce": uuid.uuid4().hex,
                "tipo": tipo,
                "alvo": alvo,
                "motivo": self._seguro(motivo, LIMITE_CONTEXTO),
                "titulo": self._seguro(titulo, 200),
                "corpo": self._seguro(corpo, 60000),
                "desde": desde.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            if tipo == "seed":
                intencao["pr"] = pr
            pendentes.append(intencao)
            self._salvar()
        else:
            achada = self._procurar_intencao(intencao)
            if achada:
                self._registrar_intencao(intencao, achada)
                return achada
            duplicata = achada == ""
        url = self._abrir_intencao(intencao, duplicata)
        self._registrar_intencao(intencao, url)
        return url

    def _registrar_intencao(self, intencao: dict, url: str) -> None:
        tipo, alvo = intencao.get("tipo"), intencao.get("alvo")
        if tipo == "pausa":
            self.estado["decisaoPausa"] = {"url": url, "motivo": intencao.get("motivo")}
        elif tipo == "warren":
            fora = self.estado.get("warrenFora")
            if not isinstance(fora, dict):
                fora = self.estado["warrenFora"] = {"ciclos": CICLOS_WARREN_FORA, "url": None}
            fora["url"] = url
        elif tipo == "warren_parcial":
            parcial = self.estado.get("warrenParcial")
            if not isinstance(parcial, dict):
                parcial = self.estado["warrenParcial"] = {"url": None, "limpos": 0}
            parcial["url"] = url
        elif self._decisao_aberta(tipo, alvo, intencao.get("pr")) is None:
            entrada = {"url": url, "motivo": intencao.get("motivo"), "alvo": alvo, "titulo": intencao.get("titulo")}
            if tipo != "seed":
                entrada["tipo"] = tipo
            else:
                entrada["pr"] = intencao.get("pr")
            self.estado.setdefault("decisoes", []).append(entrada)
            if tipo == "bloqueio" and isinstance(self._orq().get("bloqueio"), dict):
                self._orq()["bloqueio"]["url"] = url
        # P7: o alvo já fica marcado; uma resposta que chega na janela de uma queda não reabre a necessidade
        if tipo == "seed":
            seed = _dict(self.estado.get("seeds")).get(alvo)
            if isinstance(seed, dict) and seed.get("estado") not in est.TERMINAIS and seed.get("pr") == intencao.get("pr"):
                seed.update(estado="bloqueada_humano", motivoHumano=intencao.get("motivo"), pendenteHumano=None)
        elif tipo == "raia":
            registro = self.estado.get("raiasBloqueadas")
            if not isinstance(registro, dict):
                registro = self.estado["raiasBloqueadas"] = {}
            registro[alvo] = intencao.get("motivo")
        self.estado["decisoesPendentes"] = [
            i for i in _lista(self.estado.get("decisoesPendentes")) if _dict(i).get("nonce") != intencao.get("nonce")
        ]
        self._salvar()
        self._log({"evento": "decisao_aberta", "url": url, "tipo": tipo, "alvo": alvo})

    def _intencao_obsoleta(self, intencao: dict) -> bool:
        tipo = intencao.get("tipo")
        if tipo == "pausa":
            return not self.estado.get("pausado")
        if tipo == "warren":
            ciclos = _dict(self.estado.get("warrenFora")).get("ciclos")
            return not (_inteiro(ciclos) and ciclos >= CICLOS_WARREN_FORA)
        if tipo == "bloqueio":
            return not self._bloqueado()
        if tipo == "warren_parcial":
            return not _dict(self.estado.get("warrenParcial")).get("url") and not any(
                _inteiro(n) and n >= CICLOS_REDE_PARCIAL for n in _dict(self.estado.get("falhasDeRede")).values()
            ) and not any(_inteiro(n) and n >= MAX_ADIAMENTOS_DE_REDE for n in _dict(self.estado.get("adiamentosRede")).values())
        if tipo == "seed":
            seed = _dict(self.estado.get("seeds")).get(intencao.get("alvo"))
            return not isinstance(seed, dict) or seed.get("pr") != intencao.get("pr")
        if tipo == "incerto":
            return intencao.get("alvo") not in self._chaves_incertas()
        return False

    def _recuperar_decisoes_pendentes(self) -> None:
        for intencao in list(_lista(self.estado.get("decisoesPendentes"))):
            if not isinstance(intencao, dict) or not _texto(intencao.get("nonce")):
                continue
            try:
                url = self._procurar_intencao(intencao)
                if self._intencao_obsoleta(intencao):
                    if url:
                        self.forja.fechar_decisao(url, "Situação resolvida; issue fechada pelo despachante.\n\n" + MARCADOR_DESPACHANTE)
                    self.estado["decisoesPendentes"] = [
                        i for i in _lista(self.estado.get("decisoesPendentes")) if _dict(i).get("nonce") != intencao["nonce"]
                    ]
                    self._salvar()
                    continue
                if not url:
                    url = self._abrir_intencao(intencao, url == "")
                self._registrar_intencao(intencao, url)
            except Exception as exc:  # noqa: BLE001 - fica para o próximo ciclo
                self._erro_de_etapa("decisao_pendente", intencao.get("nonce"), exc)

    def _decidir_humano_orquestrador(self, pr_url: str, motivo, motivos: list[str], mudancas_de_fase=()) -> str:
        fase = motivo in est.MOTIVOS_DO_PAULO
        so_fase = not motivos  # F3: sem outro motivo, o título diz que é homologação de fase
        motivos = list(motivos) + list(mudancas_de_fase)
        if not motivos and not fase:
            motivos = ["o PR do orquestrador precisa de uma decisão do Paulo"]
        if fase:
            motivos = motivos + ["aprovar fase (o orquestrador foi acordado por %s)" % motivo]
        if fase and so_fase:
            titulo = "aprovar fase"
        elif mudancas_de_fase and so_fase:
            titulo = "aprovar mudança de fase"
        else:
            titulo = "PR do orquestrador precisa de aprovação"
        titulo = "[fábrica] orquestrador: " + titulo
        corpo = "PR: %s\nMotivo da acordada: %s\n\nMotivos:\n%s\n\n%s" % (
            pr_url,
            motivo,
            "\n".join("- " + m for m in motivos),
            "Para aprovar, mergeie o PR: o merge é a aprovação, esta issue é fechada pelo despachante e o orquestrador "
            "não é acordado. Para recusar ou pedir outra coisa, feche esta issue com um comentário: ele volta para o "
            "orquestrador, e um PR ainda aberto quando a issue fechar é fechado pelo despachante.",
        )
        self._acompanhar_pr(pr_url)
        return self._abrir_decisao_rastreada("; ".join(motivos), pr_url, titulo, corpo, tipo="orquestrador")

    def _abrir_pergunta(self, pr_url: str, conteudo) -> str:
        pergunta = conteudo if _texto(conteudo) else "(%s não foi encontrado no head do PR)" % est.PERGUNTA_DO_ORQUESTRADOR
        corpo = "%s\n\nPR: %s\n\nFeche esta issue com um comentário: ele volta para o orquestrador." % (
            pergunta,
            pr_url,
        )
        self._acompanhar_pr(pr_url)
        return self._abrir_decisao_rastreada(
            _cortar(pergunta, LIMITE_CONTEXTO), pr_url, "[fábrica] orquestrador: pergunta para o Paulo", corpo, tipo="pergunta"
        )

    # ------------------------------------------------------------ acordar

    def _enfileirar_acordar(
        self, motivo: str, alvo, contexto: dict, *, salvar: bool = True, repetir: bool = False, atualizar: bool = False
    ) -> None:
        if not repetir and "%s:%s" % (motivo, alvo) in _lista(self.estado.get("chavesAcordadas")):
            return
        pendentes = self.estado.get("acordarPendentes")
        if not isinstance(pendentes, list):
            pendentes = self.estado["acordarPendentes"] = []
        for existente in pendentes:
            if isinstance(existente, dict) and existente.get("motivo") == motivo and existente.get("alvo") == alvo:
                if atualizar:
                    existente["contexto"] = self._limitar(contexto)
                    if salvar:
                        self._salvar()
                return
        pendente = {"motivo": motivo, "alvo": alvo, "contexto": self._limitar(contexto)}
        if repetir:
            pendente["repetir"] = True
        pendentes.append(pendente)
        if salvar:
            self._salvar()

    def _limitar(self, valor):
        if isinstance(valor, str):
            return self._seguro(valor, LIMITE_CONTEXTO)
        if isinstance(valor, dict):
            return {k: self._limitar(v) for k, v in valor.items()}
        if isinstance(valor, list):
            return [self._limitar(v) for v in valor]
        return copy.deepcopy(valor)

    def _proposta_de_pendente(self):
        """A primeira acordada da fila; com o orquestrador bloqueado (A), só as respostas do Paulo passam."""
        if self.estado.get("pausado") or self._orq().get("runId") is not None or self._orquestrador_incerto():
            return None
        bloqueado = self._bloqueado()
        pendentes = self.estado.get("acordarPendentes")
        if not isinstance(pendentes, list):
            pendentes = self.estado["acordarPendentes"] = []
        chaves = _lista(self.estado.get("chavesAcordadas"))
        # as respostas do Paulo passam na frente das outras acordadas
        ordem = sorted(pendentes, key=lambda p: 0 if _dict(p).get("motivo") == "resposta_paulo" else 1)
        for pendente in ordem:
            if not isinstance(pendente, dict):
                pendentes.remove(pendente)
                continue
            if not pendente.get("repetir") and "%s:%s" % (pendente.get("motivo"), pendente.get("alvo")) in chaves:
                pendentes.remove(pendente)
                self._salvar()
                continue
            if bloqueado and pendente.get("motivo") != "resposta_paulo":
                continue
            return {
                "tipo": "acordar",
                "motivo": pendente.get("motivo"),
                "alvo": pendente.get("alvo"),
                "contexto": copy.deepcopy(_dict(pendente.get("contexto"))),
            }
        return None

    def _contexto(self, acao: dict) -> dict:
        motivo, alvo = acao.get("motivo"), acao.get("alvo")
        if motivo == "raia_falhou":
            raia = _dict(_dict(self.estado.get("raias")).get(alvo))
            seeds = {
                i: {"estado": s.get("estado"), "pr": s.get("pr")}
                for i, s in _dict(self.estado.get("seeds")).items()
                if isinstance(s, dict) and s.get("raia") == alvo
            }
            return {"raia": alvo, "falha": raia.get("falha"), "retomadas": raia.get("retomadas"), "seeds": seeds}
        if motivo == "gate_falhou_apos_fixer":
            seed = _dict(_dict(self.estado.get("seeds")).get(alvo))
            verif = _dict(seed.get("verificacao"))
            return self._limitar(
                {
                    "seed": alvo,
                    "pr": seed.get("pr"),
                    "headSha": seed.get("headSha"),
                    "ci": seed.get("ci"),
                    "veredito": seed.get("veredito"),
                    "verificacao": {"codigo": verif.get("codigo"), "saida": str(verif.get("saida") or "")[-2000:]},
                }
            )
        if motivo == "fase_concluida":
            return {"fase": alvo}
        return {"alvo": alvo}

    # ------------------------------------------------------------ ações

    def _acao_permitida(self, acao: dict) -> bool:
        if acao.get("tipo") in ACOES_DE_GATE:
            return acao.get("seed") in self._observadas
        return True

    def _substituicao_pendente(self, raia_id: str) -> bool:
        raia = _dict(_dict(self.estado.get("raias")).get(raia_id))
        novo = _dict(self._raia_do_plano(raia_id)).get("planoSeeds")
        return (
            raia.get("estado") == "executando"
            and _texto(novo)
            and _texto(raia.get("planoSeeds"))
            and novo != raia["planoSeeds"]
        )

    def _acoes_de_substituicao(self) -> list[dict]:
        """Raias `executando` cujo `planoSeeds` mudou no plano: é um replanejamento."""
        acoes = []
        for raia_id, raia in _dict(self.estado.get("raias")).items():
            raia = _dict(raia)
            novo = _dict(self._raia_do_plano(raia_id)).get("planoSeeds")
            if raia.get("estado") == "executando" and _texto(novo) and _texto(raia.get("planoSeeds")) and novo != raia["planoSeeds"]:
                acoes.append({"tipo": "cancelar_raia", "raia": raia_id, "planoSeeds": novo})
        return acoes

    def _cancelar_raia(self, acao: dict) -> None:
        raia_id = acao["raia"]
        raia = _dict(_dict(self.estado.get("raias")).get(raia_id))
        plan_run_id = raia.get("planRunId")
        falhas = self.estado.get("falhasCancelar")
        if not isinstance(falhas, dict):
            falhas = self.estado["falhasCancelar"] = {}

        def falhou(exc) -> bool:
            """Conta a falha; True quando já são 5 e a substituição segue assim mesmo."""
            n = (falhas.get(raia_id) if _inteiro(falhas.get(raia_id)) else 0) + 1
            falhas[raia_id] = n
            self._salvar()
            self._erro_de_etapa("cancelar_raia", raia_id, exc)
            return n >= MAX_FALHAS_DE_CANCELAR

        sementes = {
            i: s
            for i, s in _dict(self.estado.get("seeds")).items()
            if isinstance(s, dict) and s.get("raia") == raia_id and s.get("estado") not in est.TERMINAIS and _texto(s.get("pr"))
        }
        mergeadas = set()
        try:
            # M2: uma seed cujo PR já está mergeado vira mergeada (não some da contabilidade)
            for seed_id, seed in sementes.items():
                if _dict(self.forja.pr(seed["pr"])).get("mergeado") is True:
                    mergeadas.add(seed_id)
        except Exception as exc:  # noqa: BLE001
            if _eh_falha_de_rede(exc) or not falhou(exc):
                return
        self.estado["acaoEmCurso"] = dict(acao)
        self._salvar()
        try:
            if _texto(plan_run_id) and raia_id not in self._ja_cancelados:
                self.motor.cancelar_plano(plan_run_id)
        except MotorOcupado as exc:
            self._retry_after = max(self._retry_after, _espera_do_retry_after(exc.retry_after))
            self.estado.pop("acaoEmCurso", None)
            self._salvar()
            return
        except Exception as exc:  # noqa: BLE001
            if _eh_falha_de_rede(exc) or not falhou(exc):
                self.estado.pop("acaoEmCurso", None)
                self._salvar()
                return
            self._aviso(
                "não foi possível cancelar o Plan Run %s da raia %s (%s); a raia foi replanejada assim mesmo"
                % (plan_run_id, raia_id, self._erro(exc))
            )
        falhas.pop(raia_id, None)
        for seed_id in mergeadas:
            self.estado["seeds"][seed_id]["estado"] = "mergeada"
        abertos = [s["pr"] for i, s in sementes.items() if i not in mergeadas]
        # Q4: os PRs da tentativa antiga entram na fila de fechamento ANTES de qualquer gravação da substituição
        for url in abertos:
            self._fechar_depois(
                url, "PR fechado pelo despachante: a raia %s foi replanejada (planoSeeds %s)." % (raia_id, acao["planoSeeds"])
            )
        self.estado = est.substituir_raia(self.estado, raia_id, acao["planoSeeds"])
        for seed_id in _lista(_dict(_dict(self.estado.get("raias")).get(raia_id)).get("seedsSubstituidas")):
            self._esquecer_tentativa(seed_id, "A raia %s foi replanejada" % raia_id)
        self.estado.pop("acaoEmCurso", None)
        self._salvar()
        self._log({"evento": "acao", "acao": dict(acao), "resultado": {"cancelado": plan_run_id, "prsFechados": abertos}})

    def _raia_da_acordada(self, acao: dict):
        if acao.get("motivo") == "raia_falhou":
            return acao.get("alvo")
        if acao.get("motivo") == "gate_falhou_apos_fixer":
            return _dict(_dict(self.estado.get("seeds")).get(acao.get("alvo"))).get("raia")
        return None

    def _no_teto_de_replanejamento(self, acao: dict) -> bool:
        if acao.get("tipo") != "acordar":
            return False
        raia = _dict(_dict(self.estado.get("raias")).get(self._raia_da_acordada(acao)))
        n = raia.get("replanejamentos")
        return _inteiro(n) and n >= est.MAX_REPLANEJAMENTOS

    def _escalar_teto_de_replanejamento(self, acao: dict) -> bool:
        """F2c: decisão rastreada para o Paulo no lugar da acordada; a chave fica gasta (como se tivesse acordado)."""
        chave = "%s:%s" % (acao.get("motivo"), acao.get("alvo"))
        raia_id = self._raia_da_acordada(acao)
        n = _dict(_dict(self.estado.get("raias")).get(raia_id)).get("replanejamentos")
        motivo = "a raia %s falhou de novo (%s) depois de %d replanejamentos do orquestrador" % (raia_id, chave, n)
        corpo = (
            "%s. Para limitar o custo, o despachante não acorda o orquestrador outra vez para esta raia.\n\nContexto:\n%s\n\n"
            "Decida o que fazer (por exemplo: replanejar de outro jeito, tirar a raia da fase ou corrigir a verificação) e %s"
            % (motivo, json.dumps(self._contexto(acao), ensure_ascii=False, indent=1, default=str)[:4000], RODAPE_DECISAO[0].lower() + RODAPE_DECISAO[1:])
        )
        try:
            url = self._abrir_decisao_rastreada(
                motivo, chave, "[fábrica] raia %s: falhou depois de %d replanejamentos" % (raia_id, n), corpo, tipo="replanejamento"
            )
        except Exception as exc:  # noqa: BLE001 - a intenção gravada fica para a recuperação
            self._erro_de_etapa("teto_de_replanejamento", chave, exc)
            return False
        chaves = self.estado.setdefault("chavesAcordadas", [])
        if isinstance(chaves, list) and chave not in chaves:
            chaves.append(chave)
        self._salvar()
        self._log({"evento": "teto_de_replanejamento", "chave": chave, "raia": raia_id, "replanejamentos": n, "url": url})
        return True

    def _plano_despachavel(self) -> dict:
        """O plano sem as raias que não podem ser despachadas (elas não seguram vaga) e a escalada delas."""
        plano = copy.deepcopy(self.plano)
        bloqueadas = {}
        for raia in _raias_por_id(plano).values():
            motivo = self._motivo_nao_despachavel(raia)
            if motivo is not None:
                bloqueadas[raia["id"]] = motivo
        registro = self.estado.get("raiasBloqueadas")
        if not isinstance(registro, dict):
            registro = self.estado["raiasBloqueadas"] = {}
        for raia_id in [r for r in registro if r not in bloqueadas]:
            del registro[raia_id]
        for raia_id, motivo in bloqueadas.items():
            if raia_id in registro or _dict(_dict(self.estado.get("raias")).get(raia_id)).get("estado") != "planejada":
                continue
            corpo = "A raia %s do plano não pode ser despachada: %s\n\nAs outras raias seguem.\n\n%s" % (
                raia_id,
                motivo,
                RODAPE_DECISAO,
            )
            try:
                self._abrir_decisao_rastreada(
                    motivo, raia_id, "[fábrica] raia %s: não pode ser despachada" % raia_id, corpo, tipo="raia"
                )
            except Exception as exc:  # noqa: BLE001 - tenta de novo no próximo ciclo
                self._erro_de_etapa("raia_bloqueada", raia_id, exc)
                continue
            registro[raia_id] = motivo
            self._salvar()
        if bloqueadas:
            plano["raias"] = [r for r in _lista(plano.get("raias")) if not (isinstance(r, dict) and r.get("id") in bloqueadas)]
        return plano

    def _agir(self) -> list[dict]:
        if self.estado.get("pausado"):
            return []
        executadas = []
        for acao in self._acoes_de_substituicao():
            self._cancelar_raia(acao)
            executadas.append(acao)
        # I3: com a substituição ainda pendente, a tentativa antiga não recebe gate nem retomar
        pendentes = {a["raia"] for a in self._acoes_de_substituicao()}
        seeds = _dict(self.estado.get("seeds"))
        acoes = est.proximas_acoes(
            self.estado,
            self._plano_despachavel(),
            self._protegidos(),
            agora=self._agora(),
            ci_opcional=self.config["ciObrigatorioNasSeeds"] is False,
        )
        incertas = self._chaves_incertas()
        orquestrador_incerto = self._orquestrador_incerto()
        acoes = [
            a
            for a in acoes
            if self._acao_permitida(a)
            and not (a.get("tipo") in ACOES_DE_GATE and _dict(seeds.get(a.get("seed"))).get("raia") in pendentes)
            and not (a.get("tipo") == "retomar_raia" and a.get("raia") in pendentes)
            and _chave_acao(a) not in incertas
            and not (a.get("tipo") == "acordar" and orquestrador_incerto)
            and not (a.get("tipo") == "verificar" and self._verificacao_em_decisao(a.get("seed")))
        ]
        # F2c: a raia já replanejada 2 vezes não acorda o orquestrador de novo: a falha vai para o Paulo
        no_teto = [a for a in acoes if self._no_teto_de_replanejamento(a)]
        for acao in no_teto:
            if self._escalar_teto_de_replanejamento(acao):
                executadas.append({"tipo": "decidir_replanejamento", "motivo": acao.get("motivo"), "alvo": acao.get("alvo")})
        acoes = [a for a in acoes if a not in no_teto]
        if self._bloqueado():
            acoes = [a for a in acoes if a.get("tipo") != "acordar"]
        if not any(a.get("tipo") == "acordar" for a in acoes):
            pendente = self._proposta_de_pendente()
            if pendente is not None:
                acoes.append(pendente)
        if self._drenando():
            # D: o Warren drena para o restart do preparo; o merge também sai (dispararia o próximo filho do plan run)
            acoes = [a for a in acoes if a.get("tipo") not in ACOES_SEGURAS_NA_DRENAGEM]
        if self._merges_suspensos():
            acoes = [a for a in acoes if a.get("tipo") != "mergear"]
        for acao in acoes:
            if self.estado.get("pausado"):
                break
            if not self._liberada_pela_capacidade(acao):
                continue  # sem vaga ou sem a trava: fica para o próximo ciclo, antes de gravar a intenção
            self._executar(acao)
            executadas.append(acao)
        return executadas

    # ------------------------------------------------------------ capacidade global

    def _erro_de_capacidade(self, etapa: str, alvo, exc: BaseException) -> None:
        self._erro_de_etapa("capacidade_" + etapa, alvo, exc)
        self._aviso(AVISO_CAPACIDADE)

    def _capacidade_ok(self) -> None:
        self._retirar_aviso(AVISO_CAPACIDADE)

    def _liberada_pela_capacidade(self, acao: dict) -> bool:
        """Raia nova precisa de vaga; `acordar` precisa da trava do repositório. Sem `capacidade`, tudo passa."""
        if self.capacidade is None:
            return True
        tipo = acao.get("tipo")
        if tipo == "despachar_raia":
            return self._reservar_vaga(acao.get("raia"))
        if tipo == "acordar":
            return self._tomar_orquestrador()
        return True

    def _reservar_vaga(self, raia_id) -> bool:
        if not self._capacidade_sincronizada:
            # as reservas do plano são refeitas pelo 1º sincronizar do ciclo; sem ele, nada de vaga nova
            return False
        try:
            reservada = capacidade.reservar(
                self.capacidade, self.plano_id, raia_id, mem_disponivel_mb=self._mem_disponivel()
            )
        except (capacidade.CapacidadeInvalida, OSError) as exc:
            self._erro_de_capacidade("reservar", raia_id, exc)
            return False
        self._capacidade_ok()
        if not reservada:
            # uma linha por raia enquanto ela espera
            self._log_repetivel("sem_vaga:%s" % raia_id, {"evento": "sem_vaga", "raia": raia_id})
            return False
        self._esquecer("sem_vaga:%s" % raia_id)
        return True

    def _tomar_orquestrador(self) -> bool:
        try:
            tomada = capacidade.tomar_orquestrador(self.capacidade, self.repo, self.plano_id)
        except (capacidade.CapacidadeInvalida, OSError) as exc:
            self._erro_de_capacidade("tomar_orquestrador", self.repo, exc)
            return False
        self._capacidade_ok()
        if not tomada:
            self._acordar_recusado = True
            self._log_repetivel("orquestrador_ocupado", {"evento": "orquestrador_ocupado", "repo": self.repo})
            return False
        self._esquecer("orquestrador_ocupado")
        return True

    def _raias_ocupadas(self) -> set:
        """As raias que seguram vaga (`estado.raias_ocupadas`, a mesma regra do coordenador)."""
        return est.raias_ocupadas(self.estado)

    def _sincronizar_capacidade(self) -> None:
        if self.capacidade is None:
            return
        self._enviar_oom()
        try:
            capacidade.sincronizar(self.capacidade, self.plano_id, self._raias_ocupadas())
        except (capacidade.CapacidadeInvalida, OSError) as exc:
            self._erro_de_capacidade("sincronizar", self.plano_id, exc)
            return
        self._capacidade_sincronizada = True
        self._capacidade_ok()

    def _registro_de_oom(self) -> dict:
        registro = self.estado.get("oomCapacidade")
        if isinstance(registro, str):  # formato antigo: só o instante pendente
            registro = {"pendente": registro}
        if not isinstance(registro, dict):
            registro = {}
        registro = {
            "pendente": registro.get("pendente") if _texto(registro.get("pendente")) else None,
            "filhos": [c for c in _lista(registro.get("filhos")) if _texto(c)],
        }
        self.estado["oomCapacidade"] = registro
        return registro

    def _notar_oom(self, chave: str | None = None) -> None:
        """O OOM fica anotado no estado até chegar ao arquivo de capacidade (que pode estar ilegível agora).

        `chave` identifica o filho do Plan Run: o mesmo filho visto de novo não registra outro OOM.
        """
        if self.capacidade is None:
            return
        registro = self._registro_de_oom()
        if chave is not None:
            if chave in registro["filhos"]:
                return
            registro["filhos"] = (registro["filhos"] + [chave])[-LIMITE_OOM_FILHOS:]
        registro["pendente"] = self._agora_utc()
        self._salvar()
        self._enviar_oom()

    def _enviar_oom(self) -> None:
        if self.estado.get("oomCapacidade") is None:
            return
        registro = self._registro_de_oom()
        pendente = registro["pendente"]
        if pendente is None:
            return
        try:
            capacidade.registrar_oom(self.capacidade, pendente)
        except (capacidade.CapacidadeInvalida, OSError) as exc:
            self._erro_de_capacidade("registrar_oom", self.plano_id, exc)
            return
        registro["pendente"] = None
        self._salvar()
        self._log({"evento": "oom_registrado_na_capacidade", "oomEm": pendente})

    def _orquestrador_em_curso(self) -> bool:
        """Run, acordar incerto ou em curso, ou PR do orquestrador esperando gates ou o Paulo.

        As acordadas na fila não contam: a trava é solta ao fim de cada acordada, mesmo com o
        plano pausado ou bloqueado, e quem espera na fila do repositório passa na frente.
        """
        self._orq()  # normaliza o `orquestrador` do estado, como antes
        return est.orquestrador_em_curso(self.estado)

    def _cuidar_da_trava(self) -> None:
        """Sem orquestrador em curso, solta a trava; com ele, reafirma (um arquivo recriado a esqueceu)."""
        if self.capacidade is None:
            return
        try:
            if not self._orquestrador_em_curso():
                capacidade.soltar_orquestrador(self.capacidade, self.repo, self.plano_id)
                return
            # quem tem run ou PR em curso é o dono de fato: toma a trava livre fora da ordem da espera
            dono = None
            for _ in range(2):  # a trava pode ter sido solta entre a recusa e a leitura do dono
                if capacidade.tomar_orquestrador(self.capacidade, self.repo, self.plano_id, em_curso=True):
                    self._esquecer("trava_em_conflito")
                    return
                dono = capacidade.ler(self.capacidade)["orquestrador"].get(self.repo.lower())
                if dono is not None:
                    break
        except (capacidade.CapacidadeInvalida, OSError) as exc:
            self._erro_de_capacidade("trava_do_orquestrador", self.repo, exc)
            return
        # não há como desfazer o run em curso: registra o conflito; nada novo acorda sem a trava
        self._log_repetivel("trava_em_conflito", {"evento": "trava_em_conflito", "dono": dono})

    def _desistir_sem_demanda(self) -> None:
        """A espera reflete a demanda atual: sem um `acordar` pronto e recusado pela trava neste ciclo, sai dela."""
        if self.capacidade is None or self._acordar_recusado:
            return
        try:
            capacidade.desistir_orquestrador(self.capacidade, self.repo, self.plano_id)
        except (capacidade.CapacidadeInvalida, OSError) as exc:
            self._erro_de_capacidade("desistir_orquestrador", self.repo, exc)

    def _executar(self, acao: dict) -> None:
        tipo = acao.get("tipo")
        if tipo == "acordar" and not isinstance(acao.get("contexto"), dict):
            acao["contexto"] = self._contexto(acao)
        nonce = raiz = desde = None
        if tipo in ACOES_COM_INTENCAO:
            # P1: o nonce vai para acaoEmCurso antes do envio e na última linha do texto enviado.
            # Q1: o nonce-raiz da cadeia é a Idempotency-Key; `desde` limita a busca pelo nonce (hora da ação, com margem)
            nonce = uuid.uuid4().hex
            raiz = self._nonce_raiz(acao, nonce)
            desde = (datetime.datetime.now(datetime.timezone.utc) - MARGEM_DESDE).strftime("%Y-%m-%dT%H:%M:%SZ")
            self._anexar_a_cadeia(_chave_acao(acao), nonce, desde)  # R3: gravado junto com acaoEmCurso
            self.estado["acaoEmCurso"] = dict(copy.deepcopy(acao), nonce=nonce, nonceRaiz=raiz, desde=desde)
            self._salvar()
        erro = None
        repetivel = False
        try:
            resultado = self._efeito(acao, nonce, raiz)
        except MotorOcupado as exc:
            espera = _espera_do_retry_after(exc.retry_after)
            self._retry_after = max(self._retry_after, espera)
            resultado = {"adiado": True, "retryAfter": espera}
        except _NaoExecutada as exc:
            erro = self._erro(exc)
            resultado = None
            repetivel = True
            self.estado.pop("acaoEmCurso", None)
            self._aviso("%s %s não executada: %s" % (tipo, acao.get("raia") or acao.get("seed") or "", erro))
        except Exception as exc:  # noqa: BLE001 - vira o resultado "sem id" (nunca repete às cegas)
            erro = self._erro(exc)
            if tipo in ACOES_PAGAS and _eh_falha_de_rede(exc) and not _antes_do_envio(exc):
                # P1: o Warren pode ter aceitado: a ação fica incerta e é procurada pelo nonce
                self._registrar_incerto(acao, nonce, desde)
                resultado = None
            elif _eh_falha_de_rede(exc) and tipo != "aguardar_humano":
                # o pedido não chegou ao serviço: tenta de novo, sem marcar falha nem gastar tentativa
                resultado = {"adiado": True, "rede": True}
                if tipo in ACOES_PAGAS:
                    self._contar_adiamento(_chave_acao(acao))
            else:
                resultado = {"ok": False} if tipo == "mergear" else ({} if tipo != "aguardar_humano" else None)
        nonces = self._cadeia(_chave_acao(acao), nonce, desde)[0] if nonce else []
        if resultado is not None and resultado.get("adiado") is not True and tipo in ACOES_PAGAS:
            self._encerrar_cadeia(_chave_acao(acao))
        if resultado is not None:
            self._aplicar(acao, resultado)
            if nonce and _texto(resultado.get("runId")):
                self._lembrar_nonces(resultado["runId"], nonces)
        self.estado.pop("acaoEmCurso", None)
        self._salvar()
        registro = {"evento": "acao", "acao": self._resumo_da_acao(acao), "resultado": self._resumo(resultado)}
        if erro is not None:
            registro["erro"] = erro
        chave = "acao:%s:%s" % (tipo, acao.get("raia") or acao.get("seed") or acao.get("alvo"))
        if repetivel:
            self._log_repetivel(chave, registro)
        else:
            self._esquecer(chave)
            self._log(registro)

    def _registrar_incerto(self, acao: dict, nonce: str, desde: str | None = None) -> None:
        incertos = self.estado.get("despachosIncertos")
        if not isinstance(incertos, list):
            incertos = self.estado["despachosIncertos"] = []
        chave = _chave_acao(acao)
        nonces, desde = self._cadeia(chave, nonce, desde)  # R3: a busca casa qualquer nonce da cadeia
        incertos.append(
            {
                "acao": copy.deepcopy(acao),
                "nonce": nonce,
                "nonces": nonces,
                "chave": chave,
                "ciclos": 0,
                "desde": desde,
                "falhasBusca": 0,
                "vistoEm": self._agora_utc(),
            }
        )
        self._salvar()
        self._aviso("despacho %s incerto (falha de rede depois do envio): procurando pelo nonce" % _chave_acao(acao))

    def _nonce_raiz(self, acao: dict, nonce: str) -> str:
        """Q1: o primeiro nonce da cadeia da ação é a `Idempotency-Key` de todo POST dela, até o Warren dar o id."""
        raizes = self.estado.get("noncesRaiz")
        if not isinstance(raizes, dict):
            raizes = self.estado["noncesRaiz"] = {}
        chave = _chave_acao(acao)
        if not _texto(raizes.get(chave)):
            raizes[chave] = nonce
        return raizes[chave]

    def _anexar_a_cadeia(self, chave: str, nonce: str, desde: str | None) -> dict:
        """R3: a cadeia guarda TODOS os nonces dos POSTs da ação (a chave repetida devolve o run do 1º) e o `desde` do 1º."""
        cadeias = self.estado.get("cadeias")
        if not isinstance(cadeias, dict):
            cadeias = self.estado["cadeias"] = {}
        cadeia = cadeias.get(chave)
        if not isinstance(cadeia, dict) or not isinstance(cadeia.get("nonces"), list):
            cadeia = cadeias[chave] = {"nonces": [], "desde": desde}
        if nonce not in cadeia["nonces"]:
            cadeia["nonces"].append(nonce)
        if not _texto(cadeia.get("desde")):
            cadeia["desde"] = desde
        return cadeia

    def _cadeia(self, chave: str, nonce: str, desde: str | None) -> tuple[list, str | None]:
        """Os nonces da cadeia da chave (o atual incluído) e o `desde` do primeiro POST."""
        cadeia = _dict(_dict(self.estado.get("cadeias")).get(chave))
        nonces = [n for n in _lista(cadeia.get("nonces")) if _texto(n)]
        if _texto(nonce) and nonce not in nonces:
            nonces.append(nonce)
        return nonces, (cadeia.get("desde") if _texto(cadeia.get("desde")) else desde)

    def _encerrar_cadeia(self, chave: str) -> None:
        """A ação ganhou um id (ou um resultado final): a próxima vez é outra cadeia, com outra chave."""
        _dict(self.estado.get("adiamentosRede")).pop(chave, None)
        _dict(self.estado.get("noncesRaiz")).pop(chave, None)
        _dict(self.estado.get("cadeias")).pop(chave, None)

    def _lembrar_nonces(self, run_id, nonces: list, retry_de: str | None = None) -> None:
        """R2: os nonces do run pago ficam guardados por id, para achar o retry automático do Warren pelo prompt."""
        if not _texto(run_id):
            return
        registro = self.estado.get("noncesDosRuns")
        if not isinstance(registro, dict):
            registro = self.estado["noncesDosRuns"] = {}
        registro[run_id] = {"nonces": [n for n in nonces if _texto(n)], "retryDe": retry_de}
        while len(registro) > LIMITE_NONCES_DE_RUNS:
            del registro[next(iter(registro))]

    def _nonces_do_run(self, run_id) -> dict:
        return _dict(_dict(self.estado.get("noncesDosRuns")).get(run_id))

    def _esquecer_nonces(self, run_id) -> None:
        _dict(self.estado.get("noncesDosRuns")).pop(run_id, None)

    def _garantir_decisao_de_incerto(self, chave: str, falhas: int, situacao: str | None = None) -> None:
        if self._decisao_aberta("incerto", chave):
            return
        motivo = "não foi possível confirmar o despacho de %s" % chave
        situacao = situacao or "O despacho %s ficou incerto (a resposta do Warren se perdeu depois do envio)" % chave
        corpo = (
            "%s e a busca pelo nonce falhou %d vezes seguidas. O despachante não refaz o despacho enquanto a busca "
            "não voltar. Confira no Warren se o run existe e feche esta issue com um comentário dizendo o que fazer; "
            "a resposta acorda o orquestrador com o contexto (o despacho continua sem ser refeito até a busca voltar).\n\n%s"
            % (situacao, falhas, RODAPE_DECISAO)
        )
        try:
            url = self._abrir_decisao_rastreada(motivo, chave, "%s: %s" % (TITULO_DESPACHO_NAO_CONFIRMADO, chave), corpo, tipo="incerto")
            self._aviso("%s: issue %s aberta" % (motivo, url))
        except Exception as exc:  # noqa: BLE001 - a intenção gravada fica para a recuperação
            self._erro_de_etapa("despacho_nao_confirmado", chave, exc)

    def _fechar_decisao_de_incerto(self, chave: str, comentario: str) -> None:
        url = self._decisao_aberta("incerto", chave)
        if not url:
            return
        self.estado["decisoes"] = [
            d for d in _lista(self.estado.get("decisoes")) if not (isinstance(d, dict) and d.get("tipo") == "incerto" and d.get("alvo") == chave)
        ]
        self._fechar_depois(url, comentario, decisao=True)

    def _manter_incerto_apos_resposta(self, chave) -> None:
        """R1 (regra Q2): a resposta do Paulo acorda o orquestrador com o contexto, mas NÃO solta o item: ele segue
        incerto, com as falhas de busca zeradas, e só é refeito depois de 3 buscas boas que não o acharem (P1)."""
        for item in _lista(self.estado.get("despachosIncertos")):
            if isinstance(item, dict) and item.get("chave") == chave:
                item["falhasBusca"] = 0
                item["ciclos"] = 0
        for run_id, item in _dict(self.estado.get("retriesEsperados")).items():
            if isinstance(item, dict) and "retry:%s" % run_id == chave:
                item["falhasBusca"] = 0
        self._log({"evento": "despacho_incerto_respondido", "chave": chave})

    def _contar_adiamento(self, chave: str) -> None:
        contadores = self.estado.get("adiamentosRede")
        if not isinstance(contadores, dict):
            contadores = self.estado["adiamentosRede"] = {}
        n = (contadores.get(chave) if _inteiro(contadores.get(chave)) else 0) + 1
        contadores[chave] = n
        if n >= MAX_ADIAMENTOS_DE_REDE and not self.estado.get("pausado"):
            self.estado["pausado"] = PAUSA_DESPACHOS_REJEITADOS
            self._aviso("%s: %d adiamentos de rede seguidos para %s; despachante pausado" % (PAUSA_DESPACHOS_REJEITADOS, n, chave))
        self._salvar()

    def _chaves_incertas(self) -> set:
        return {_dict(i).get("chave") for i in _lista(self.estado.get("despachosIncertos"))}

    def _orquestrador_incerto(self) -> bool:
        return any(str(c).startswith("acordar:") for c in self._chaves_incertas())

    def _resolver_incertos(self) -> None:
        """P1/Q1: procura cada despacho incerto pelo nonce (inclusive na fila do Warren); achado vira o resultado.

        Não achado em 3 leituras boas: o item sai e a ação é refeita com a MESMA Idempotency-Key (nonce-raiz) e um
        nonce novo no texto; isso não é rejeição, só a FalhaAntesDoEnvio conta para a pausa (Q1c). Q2: as falhas da
        busca contam por item (as de rede também no ciclo); na 10ª seguida abre uma decisão rastreada e o item fica
        incerto, sem redespacho, até a busca voltar ou o Paulo responder.
        """
        incertos = _lista(self.estado.get("despachosIncertos"))
        if not incertos:
            return
        restantes = []
        for item in incertos:
            item = _dict(item)
            acao, nonce, chave = _dict(item.get("acao")), item.get("nonce"), item.get("chave")
            tipo = acao.get("tipo")
            nonces = [n for n in _lista(item.get("nonces")) if _texto(n)] or [nonce]
            try:
                if tipo == "despachar_raia":
                    achado = self.motor.procurar_plano(self.projeto, nonces)
                else:
                    achado = self.motor.procurar_run(self.projeto, nonces, item.get("desde") if _texto(item.get("desde")) else None)
            except Exception as exc:  # noqa: BLE001 - sem leitura, nada conta para o item; a falha conta para o ciclo
                self._erro_de_etapa("procurar_despacho", chave, exc)
                self._leituras["falhas"] += 1
                if _eh_falha_de_rede(exc):
                    self._rede_do_ciclo.add(chave)
                falhas = (item.get("falhasBusca") if _inteiro(item.get("falhasBusca")) else 0) + 1
                item["falhasBusca"] = falhas
                restantes.append(item)
                if falhas >= MAX_FALHAS_DE_BUSCA_INCERTA:
                    self._garantir_decisao_de_incerto(chave, falhas)
                continue
            self._leituras["ok"] += 1
            item["falhasBusca"] = 0
            if achado:
                campo = "planRunId" if tipo == "despachar_raia" else "runId"
                self._encerrar_cadeia(chave)
                self._aplicar(acao, {campo: achado})
                if campo == "runId":
                    self._lembrar_nonces(achado, nonces)
                self._log({"evento": "despacho_incerto_achado", "acao": self._resumo_da_acao(acao), campo: achado})
                self._fechar_decisao_de_incerto(chave, "O despacho %s foi confirmado no Warren (%s); issue fechada pelo despachante." % (chave, achado))
                continue
            item["ciclos"] = (item.get("ciclos") if _inteiro(item.get("ciclos")) else 0) + 1
            if item["ciclos"] < CICLOS_PARA_DESCARTAR_INCERTO or not self._passou_o_piso(item):
                restantes.append(item)
                continue
            self._log({"evento": "despacho_incerto_descartado", "acao": self._resumo_da_acao(acao)})
            self._fechar_decisao_de_incerto(chave, "O Warren não registrou o despacho %s; ele será refeito pelo despachante." % chave)
        self.estado["despachosIncertos"] = restantes
        self._salvar()

    @staticmethod
    def _resumo_da_acao(acao: dict) -> dict:
        return {k: acao[k] for k in ("tipo", "raia", "seed", "sha", "motivo", "alvo") if k in acao}

    @staticmethod
    def _resumo(resultado):
        if not isinstance(resultado, dict):
            return resultado
        if "verificacao" in resultado:
            v = _dict(resultado["verificacao"])
            return {"verificacao": {"sha": v.get("sha"), "codigo": v.get("codigo")}}
        return copy.deepcopy(resultado)

    def _aplicar(self, acao: dict, resultado: dict) -> None:
        tipo = acao.get("tipo")
        anterior = dict(self._orq())
        falhas_antes = self.estado.get("falhasAcordar")
        self.estado = est.aplicar(self.estado, {k: v for k, v in acao.items() if k not in ("contexto", "nonce")}, resultado)
        if tipo == "acordar" and _texto(resultado.get("runId")):
            orquestrador = self._orq()
            for chave in ("semResultadoSeguidos", "bloqueio"):
                if chave in anterior:
                    orquestrador[chave] = anterior[chave]
            orquestrador["acordada"] = {
                "motivo": acao.get("motivo"),
                "alvo": acao.get("alvo"),
                "contexto": copy.deepcopy(_dict(acao.get("contexto"))),
            }
            # só um run do orquestrador que termina bem zera a cadeia de falhas
            self.estado["falhasAcordar"] = falhas_antes if _inteiro(falhas_antes) else 0
            pendentes = _lista(self.estado.get("acordarPendentes"))
            self.estado["acordarPendentes"] = [
                p for p in pendentes if not (p.get("motivo") == acao.get("motivo") and p.get("alvo") == acao.get("alvo"))
            ]
            if not self._acordada_registrada(resultado["runId"]):  # Q5: a recuperação reaplica; a linha não se repete
                _anexar_linha(
                    self.raiz / ARQ_ACORDADAS,
                    json.dumps(
                        {
                            "ts": self._agora().isoformat(),
                            "motivo": acao.get("motivo"),
                            "alvo": acao.get("alvo"),
                            "runId": resultado["runId"],
                        },
                        ensure_ascii=False,
                    ),
                )

    def _acordada_registrada(self, run_id) -> bool:
        caminho = self.raiz / ARQ_ACORDADAS
        if not caminho.exists():
            return False
        for linha in caminho.read_text(encoding="utf-8").splitlines():
            try:
                registro = json.loads(linha)
            except ValueError:
                continue
            if isinstance(registro, dict) and registro.get("runId") == run_id:
                return True
        return False

    def _verificacao_nao_executou(self, raia_id, comando: str, resultado):
        """F2: o comando nem rodou. Docker (125/126) ou o próprio verificador (`interno`) pausam a fábrica; o comando
        ausente na imagem (127) abre uma decisão da raia. Nos dois casos nada vai ao fixer nem ao orquestrador."""
        if not isinstance(resultado, dict) or not _inteiro(resultado.get("codigo")):
            return None
        codigo = resultado["codigo"]
        linhas = [linha.strip() for linha in str(resultado.get("saida") or "").splitlines() if linha.strip()]
        detalhe = _cortar(linhas[-1], 160) if linhas else "(sem saída)"
        if resultado.get("interno") is True or codigo in CODIGOS_DOCKER_NAO_EXECUTOU:
            self.estado["pausado"] = self._seguro("verificação não executou: código %d: %s" % (codigo, detalhe), 200)
            self._salvar()
            self._aviso("verificação da raia %s não executou (código %d): despachante pausado" % (raia_id, codigo))
            return {"adiado": True, "naoExecutou": codigo}
        if codigo != CODIGO_COMANDO_AUSENTE:
            return None
        motivo = "o comando de verificação da raia %s não existe na imagem: %s" % (raia_id, comando)
        corpo = (
            "%s\n\nSaída (fim):\n%s\n\nA verificação roda num contêiner novo, sem `node_modules`, com usuário não root e "
            "`HOME=/tmp/home` (veja \"Comando de verificação\" em `.fabrica/orquestrador.md`): o comando precisa instalar as "
            "dependências, por exemplo `corepack pnpm install --frozen-lockfile && corepack pnpm test`. As seeds da raia "
            "esperam esta decisão; nada foi ao fixer nem ao orquestrador. Corrija a imagem em `.fabrica/config.json` ou peça "
            "ao orquestrador outro comando, e %s"
            % (motivo, _cortar(str(resultado.get("saida") or ""), 1500), RODAPE_DECISAO[0].lower() + RODAPE_DECISAO[1:])
        )
        try:
            url = self._abrir_decisao_rastreada(
                motivo, raia_id, "[fábrica] raia %s: comando de verificação não existe na imagem" % raia_id, corpo, tipo="verificacao"
            )
        except Exception as exc:  # noqa: BLE001 - a intenção gravada fica para a recuperação; a verificação espera
            self._erro_de_etapa("comando_ausente", raia_id, exc)
            url = None
        return {"adiado": True, "naoExecutou": codigo, "decisao": url}

    def _verificacao_em_decisao(self, seed_id) -> bool:
        """F2b: a raia da seed tem uma decisão de comando de verificação aberta: a verificação espera o Paulo."""
        raia_id = _dict(_dict(self.estado.get("seeds")).get(seed_id)).get("raia")
        return self._decisao_aberta("verificacao", raia_id) is not None

    def _seed_da_acao(self, acao: dict) -> dict:
        seed = _dict(self.estado.get("seeds")).get(acao.get("seed"))
        if not isinstance(seed, dict):
            raise ValueError("seed desconhecida %r" % (acao.get("seed"),))
        return seed

    def _tratar_recusa_do_motor(self, raia_id, exc: RecusaDoMotor) -> None:
        """Warren recusou o despacho (a cópia dele pode nem ter o plano): atualiza a cópia e tenta no próximo ciclo.

        Nada foi criado, então repetir é seguro. Depois do teto, a recusa segue como falha da raia.
        """
        raia = _dict(_dict(self.estado.get("raias")).get(raia_id))
        recusas = (raia.get("recusasDoMotor") if _inteiro(raia.get("recusasDoMotor")) else 0) + 1
        if recusas > MAX_RECUSAS_DO_MOTOR:
            return
        raia["recusasDoMotor"] = recusas
        try:
            self.motor.atualizar_projeto(self.projeto)
        except Exception as erro:  # noqa: BLE001 - a próxima tentativa ainda pode dar certo
            self._erro_de_etapa("atualizar_projeto", self.projeto, erro)
        raise _NaoExecutada(str(exc)) from None

    def _efeito(self, acao: dict, nonce: str | None = None, raiz: str | None = None) -> dict:
        tipo = acao.get("tipo")
        if tipo == "despachar_raia":
            raia = self._raia_do_plano(acao.get("raia"))
            if raia is None:
                raise _NaoExecutada("raia %r fora do plano" % (acao.get("raia"),))
            try:
                modelo = self._modelo(raia.get("papel"))
                template = prompts.prompt_template_raia(raia.get("papel"))
            except (ConfigInvalida, ValueError) as exc:
                raise _NaoExecutada(str(exc)) from None
            try:
                plan_run_id = self.motor.despachar_plano(
                    projeto=self.projeto,
                    plano_seeds=raia.get("planoSeeds"),
                    agente=modelo["agente"],
                    modelo=modelo["modelo"],
                    prompt_template=_com_nonce(template, nonce) if nonce else template,
                    max_custo_usd=modelo["maxCustoUsd"],
                )
            except RecusaDoMotor as exc:
                self._tratar_recusa_do_motor(acao.get("raia"), exc)
                raise
            return {"planRunId": plan_run_id}

        if tipo in ("revisar", "corrigir"):
            seed = self._seed_da_acao(acao)
            if not _texto(seed.get("branch")):
                raise ValueError("seed sem branch de PR")
            if tipo == "revisar":
                modelo = self._modelo("revisor")
                prompt = prompts.prompt_revisor(
                    seed_id=acao["seed"], raia=_dict(self._raia_do_plano(seed.get("raia"))), sha=acao.get("sha")
                )
            else:
                modelo = self._modelo("fixer")
                saida = _dict(seed.get("verificacao")).get("saida")
                try:
                    prompt = prompts.prompt_fixer(
                        seed_id=acao["seed"],
                        papel=self._papel_da_raia(seed.get("raia")),
                        motivos=[m for m in _lista(acao.get("motivos")) if isinstance(m, str)],
                        achados=[a for a in _lista(acao.get("achados")) if isinstance(a, dict)],
                        saida_verificacao=saida if isinstance(saida, str) else "",
                    )
                except ValueError as exc:
                    raise _NaoExecutada(str(exc)) from None
            run_id = self.motor.despachar_run(
                projeto=self.projeto,
                agente=modelo["agente"],
                modelo=modelo["modelo"],
                prompt=_com_nonce(prompt, nonce) if nonce else prompt,
                branch_existente=seed["branch"],
                max_custo_usd=modelo["maxCustoUsd"],
                chave_idempotencia=raiz,
            )
            return {"runId": run_id}

        if tipo == "verificar":
            seed = self._seed_da_acao(acao)
            comando = _dict(self._raia_do_plano(seed.get("raia"))).get("verificacao")
            if not _texto(comando):
                raise ValueError("raia sem comando de verificação no plano")
            resultado = self._verificar(
                self.repo_dir, acao.get("sha"), comando, conteiner=copy.deepcopy(self.config["verificacao"])
            )
            if isinstance(resultado, dict) and isinstance(resultado.get("saida"), str):
                # F7: a saída vai para o estado, os prompts e as issues: os segredos conhecidos saem aqui
                resultado = dict(resultado, saida=self._seguro(resultado["saida"], max(len(resultado["saida"]), LIMITE_MENSAGEM)))
            nao_executou = self._verificacao_nao_executou(seed.get("raia"), comando, resultado)
            if nao_executou is not None:
                return nao_executou
            return {"verificacao": resultado}

        if tipo == "mergear":
            seed = self._seed_da_acao(acao)
            if acao.get("sha") != seed.get("headSha") or not _texto(seed.get("pr")):
                raise ValueError("merge fora do head observado")
            return {"ok": self.forja.mergear(seed["pr"], acao["sha"]) is True}

        if tipo == "retomar_raia":
            raia = _dict(_dict(self.estado.get("raias")).get(acao.get("raia")))
            if not _texto(raia.get("planRunId")):
                raise ValueError("raia sem planRunId")
            self.motor.retomar_plano(raia["planRunId"])
            return {}

        if tipo == "aguardar_humano":
            seed = self._seed_da_acao(acao)
            motivos = [m for m in _lista(acao.get("motivos")) if isinstance(m, str)] or ["decisão humana necessária"]
            rodape = RODAPE_DECISAO
            if _texto(seed.get("pr")) and any(m.startswith(MOTIVOS_MERGE_DO_PAULO) for m in motivos):
                # F5: arquivo protegido ou merge recusado: o merge é do Paulo, e o merge dele resolve a decisão
                rodape = (
                    "Revise e mergeie ou feche o PR %s: o merge é seu. Mergeado o PR, esta issue é fechada pelo despachante "
                    "sem acordar o orquestrador. Se fechar o PR sem merge, feche também esta issue com um comentário dizendo "
                    "o que fazer: ele volta para o orquestrador." % seed["pr"]
                )
            corpo = "Seed: %s\nRaia: %s\nPR: %s\nHead: %s\n\nMotivos:\n%s\n\n%s" % (
                acao["seed"],
                seed.get("raia"),
                seed.get("pr") or "(sem PR)",
                seed.get("headSha") or "-",
                "\n".join("- " + m for m in motivos),
                rodape,
            )
            url = self._abrir_decisao_rastreada(
                "; ".join(motivos), acao["seed"], "[fábrica] %s: decisão necessária" % acao["seed"], corpo, tipo="seed", pr=seed.get("pr")
            )
            return {"url": url}

        if tipo == "acordar":
            modelo = self._modelo("orquestrador")
            prompt = prompts.prompt_orquestrador(
                motivo=acao.get("motivo"),
                estado_compacto=compactar(self.estado, self.plano),
                contexto=_dict(acao.get("contexto")),
                caminho_plano=self.caminho_plano,
            )
            run_id = self.motor.despachar_run(
                projeto=self.projeto,
                agente=modelo["agente"],
                modelo=modelo["modelo"],
                prompt=_com_nonce(prompt, nonce) if nonce else prompt,
                branch_existente=None,
                max_custo_usd=modelo["maxCustoUsd"],
                chave_idempotencia=raiz,
            )
            return {"runId": run_id}

        raise _NaoExecutada("tipo de ação desconhecido %r" % (tipo,))


# ---------------------------------------------------------------- arquivo-only (sem motor nem forja)


def retomar(raiz, *, agora=datetime.datetime.now) -> None:
    """Zera `pausado` e `falhasAcordar` direto no `estado.json` (chamado sob a trava).

    A issue de pausa, se houver, é fechada pelo próximo ciclo do despachante.
    """
    raiz = pathlib.Path(raiz)
    estado = _ler_estado(raiz)
    if not isinstance(estado, dict):
        raise ErroDeEntrada(["sem estado.json em %s: rode iniciar" % raiz])
    antes = {"pausado": estado.get("pausado"), "falhasAcordar": estado.get("falhasAcordar")}
    estado["pausado"] = None
    estado["falhasAcordar"] = 0
    estado["adiamentosRede"] = {}
    liberadas = liberar_raias_em_cota(estado)
    if liberadas:
        antes["raiasLiberadas"] = liberadas
    gravar_json_atomico(raiz / ARQ_ESTADO, estado)
    _anexar_linha(
        raiz / ARQ_LOG,
        json.dumps({"ts": agora().isoformat(), "evento": "retomar", "antes": antes}, ensure_ascii=False, default=str),
    )


def status(raiz) -> str:
    raiz = pathlib.Path(raiz)
    estado = _ler_estado(raiz)
    if not isinstance(estado, dict):
        raise ErroDeEntrada(["sem estado.json em %s: rode iniciar" % raiz])
    plano = _dict(_ler_json(raiz / ARQ_PLANO))
    c = compactar(estado, plano)
    orquestrador = _dict(estado.get("orquestrador"))
    linhas = [
        "pausado: %s" % (c["pausado"] or "não"),
        "fase atual: %s" % c["faseAtual"],
        "concluído: %s" % ("sim" if est.plano_concluido(estado, plano) else "não"),
        "orquestrador: %s%s"
        % (orquestrador.get("runId") or "livre", " (bloqueado até a resposta do Paulo)" if orquestrador.get("bloqueio") else ""),
        "raias:",
    ]
    for id_, raia in c["raias"].items():
        extra = ", falha %s" % raia["falha"] if raia["falha"] else ""
        linhas.append("  %s: %s (retomadas %s%s)" % (id_, raia["estado"], raia["retomadas"], extra))
    linhas.append("seeds:")
    for id_, seed in c["seeds"].items():
        motivos = " — " + "; ".join(seed["motivos"]) if seed["motivos"] else ""
        linhas.append("  %s: %s %s%s" % (id_, seed["estado"], seed["pr"] or "-", motivos))
    linhas.append("decisões abertas: %d" % len(_lista(estado.get("decisoes"))))
    linhas.append("acordadas na fila: %d" % len(_lista(estado.get("acordarPendentes"))))
    linhas.append("avisos:")
    linhas.extend("  - " + a for a in c["avisos"])
    return "\n".join(linhas)


# ---------------------------------------------------------------- CLI


def _exigir(ambiente, nome: str) -> str:
    valor = ambiente.get(nome)
    if not _texto(valor):
        raise ErroDeEntrada(["defina %s" % nome])
    return valor


def _ler_token(caminho: str) -> str:
    try:
        return pathlib.Path(caminho).expanduser().read_text(encoding="utf-8").strip()
    except OSError as erro:
        raise ErroDeEntrada(["não foi possível ler o token em %s (%s)" % (caminho, type(erro).__name__)]) from None


def construir(ambiente) -> Despachante:
    """O despachante real: Warren e GitHub com os tokens lidos dos arquivos do ambiente."""
    import functools

    import forja as forja_github
    import motor_warren
    import preparar_warren

    raiz = _exigir(ambiente, "FABRICA_RAIZ")
    repo_dir = _exigir(ambiente, "FABRICA_REPO_DIR")
    projeto = _exigir(ambiente, "FABRICA_PROJETO")
    repo = _exigir(ambiente, "FABRICA_REPO")
    caminho_plano = ambiente.get("FABRICA_PLANO")
    if caminho_plano is None:
        caminho_plano = CAMINHO_PLANO
    elif not _caminho_plano_valido(caminho_plano):
        raise ErroDeEntrada(
            [
                "FABRICA_PLANO inválido: %r; use .fabrica/plano.json ou .fabrica/planos/<feature>.json "
                "(feature de até 41 caracteres, a-z e 0-9 em partes separadas por um só -, e nunca `plano`)"
                % _cortar(caminho_plano, 200)
            ]
        )
    caminho_capacidade = ambiente.get("FABRICA_CAPACIDADE")
    plano_id = ambiente.get("FABRICA_PLANO_ID")
    if (caminho_capacidade is None) != (plano_id is None):
        raise ErroDeEntrada(["defina FABRICA_CAPACIDADE e FABRICA_PLANO_ID juntos (ou nenhum dos dois)"])
    if caminho_capacidade is not None:
        if not _texto(caminho_capacidade):
            raise ErroDeEntrada(["FABRICA_CAPACIDADE vazio"])
        if not _plano_id_valido(plano_id):
            raise ErroDeEntrada(
                ["FABRICA_PLANO_ID inválido: %r; use <dono>--<repo>--<feature>, só a-z, 0-9 e -" % _cortar(str(plano_id), 200)]
            )
    # o coordenador da fila prepara o Warren; os despachantes de plano rodam com FABRICA_PREPARAR_WARREN=0
    sem_preparo = ambiente.get("FABRICA_PREPARAR_WARREN") == "0"
    token_warren = _ler_token(ambiente.get("WARREN_TOKEN_FILE") or WARREN_TOKEN_PADRAO)
    token_gh = _ler_token(ambiente.get("GH_TOKEN_FILE") or GH_TOKEN_PADRAO)
    caminho_config = pathlib.Path(repo_dir) / CAMINHO_CONFIG
    try:
        config = _json_estrito(caminho_config.read_text(encoding="utf-8"))
    except (OSError, ValueError) as erro:
        # Q6: config ilegível é ConfigInvalida: no `rodar`, decisão best-effort e saída 2 (sem parada silenciosa)
        raise ConfigInvalida("config.json ilegível (%s)" % type(erro).__name__) from None
    motor = motor_warren.MotorWarren(ambiente.get("WARREN_API") or WARREN_API_PADRAO, token_warren)
    return Despachante(
        motor=motor,
        forja=forja_github.ForjaGitHub(token_gh),
        raiz=raiz,
        repo_dir=repo_dir,
        config=config,
        projeto=projeto,
        repo=repo,
        segredos=(token_warren, token_gh),
        preparar_warren=None
        if sem_preparo
        else functools.partial(preparar_warren.preparar, visao_geral=motor.visao_geral, versao=motor.versao),
        caminho_plano=caminho_plano,
        capacidade=caminho_capacidade,
        plano_id=plano_id,
    )


def _forja_do_ambiente(ambiente):
    import forja as forja_github

    return forja_github.ForjaGitHub(_ler_token(ambiente.get("GH_TOKEN_FILE") or GH_TOKEN_PADRAO))


def decidir_config_invalida(ambiente, raiz, exc, abrir_forja=_forja_do_ambiente) -> str | None:
    """P10: antes de sair com 2, abre (uma vez) uma decisão rastreada sobre a config. Nunca lança."""
    try:
        repo = ambiente.get("FABRICA_REPO")
        caminho = pathlib.Path(raiz) / ARQ_ESTADO
        estado = _ler_json(caminho)
        if not _texto(repo) or not isinstance(estado, dict) or estado.get("repo") != repo:
            return None
        campo = _cortar(str(exc), 200)
        alvo = "config:%s" % campo
        for decisao in _lista(estado.get("decisoes")):
            if isinstance(decisao, dict) and decisao.get("tipo") == "config" and decisao.get("alvo") == alvo:
                return decisao.get("url")
        pendentes = estado.setdefault("decisoesPendentes", [])
        intencao = next((i for i in pendentes if isinstance(i, dict) and i.get("tipo") == "config" and i.get("alvo") == alvo), None)
        forja_ = abrir_forja(ambiente)
        url = None
        if intencao is None:
            desde = datetime.datetime.now(datetime.timezone.utc) - MARGEM_DESDE
            intencao = {
                "nonce": uuid.uuid4().hex,
                "tipo": "config",
                "alvo": alvo,
                "motivo": "config inválida: %s" % campo,
                "titulo": "[fábrica] config inválida: %s" % _cortar(campo, 80),
                "corpo": (
                    "O despachante não sobe: `.fabrica/config.json` inválida (%s). Corrija a config e reinicie o "
                    "serviço; esta issue é fechada pelo despachante quando ele voltar." % campo
                ),
                "desde": desde.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            pendentes.append(intencao)
            gravar_json_atomico(caminho, estado)
        else:
            url = forja_.procurar_decisao(repo, intencao["nonce"], intencao.get("desde"))
        if not url:
            url = forja_.abrir_decisao(repo, intencao["titulo"], intencao["corpo"] + "\n\n" + MARCADOR_NONCE % intencao["nonce"])
        estado.setdefault("decisoes", []).append(
            {"url": url, "motivo": intencao["motivo"], "alvo": alvo, "titulo": intencao["titulo"], "tipo": "config"}
        )
        estado["decisoesPendentes"] = [i for i in pendentes if _dict(i).get("nonce") != intencao["nonce"]]
        gravar_json_atomico(caminho, estado)
        return url
    except Exception:  # noqa: BLE001 - best-effort: a saída com 2 acontece de qualquer jeito
        return None


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="despachante.py", description="Despachante da fábrica de agentes")
    sub = parser.add_subparsers(dest="comando", required=True)
    iniciar = sub.add_parser("iniciar", help="cria o estado; com --spec acorda o orquestrador")
    iniciar.add_argument("--spec", help="caminho da spec no repositório do cliente")
    rodar = sub.add_parser("rodar", help="repete o ciclo")
    rodar.add_argument("--intervalo", type=int, default=30, help="segundos entre ciclos (padrão 30)")
    sub.add_parser("status", help="resumo do estado")
    sub.add_parser("retomar", help="zera a pausa e as falhas de acordar")
    return parser


def main(argv=None, *, ambiente=None, construir=None, saida=None, erro=None, abrir_forja=None) -> int:
    ambiente = os.environ if ambiente is None else ambiente
    saida = saida or sys.stdout
    erro = erro or sys.stderr
    construir = construir or globals()["construir"]
    args = _parser().parse_args(argv)
    despachante = None
    try:
        raiz = _exigir(ambiente, "FABRICA_RAIZ")
        if args.comando == "status":
            print(status(raiz), file=saida)
            return 0
        if args.comando == "rodar" and args.intervalo < 1:
            raise ErroDeEntrada(["--intervalo deve ser pelo menos 1"])
        spec = getattr(args, "spec", None)
        if args.comando == "iniciar" and spec is not None and not _texto(spec):
            raise ErroDeEntrada(["--spec vazio"])
        try:
            with travar(raiz):
                if args.comando == "retomar":
                    retomar(raiz)
                    print("despachante retomado", file=saida)
                    return 0
                despachante = construir(ambiente)
                despachante.trava_externa = True  # este processo já tem a trava da raiz
                if args.comando == "iniciar":
                    print(despachante.iniciar(spec=spec), file=saida)
                    return 0
                try:
                    despachante.rodar(intervalo=args.intervalo)
                except KeyboardInterrupt:
                    print("despachante parado", file=saida)
                return 0
        except OutroDespachante:
            # o despachante em execução aplica retomar e iniciar --spec: nada de parar o serviço
            if args.comando == "retomar" or (args.comando == "iniciar" and spec is not None):
                pedido = {"comando": args.comando}
                if spec is not None:
                    pedido["spec"] = spec
                enfileirar_pedido(raiz, pedido)
                print(MENSAGEM_PEDIDO, file=saida)
                return 0
            print(MENSAGEM_TRAVA, file=erro)
            return CODIGO_TRAVA
    except ErroDeEntrada as exc:
        for item in exc.erros:
            print(item, file=erro)
        return CODIGO_ENTRADA
    except ConfigInvalida as exc:
        print("config inválida: %s" % exc, file=erro)
        if args.comando == "rodar" and _texto(ambiente.get("FABRICA_RAIZ")):
            decidir_config_invalida(ambiente, ambiente["FABRICA_RAIZ"], exc, abrir_forja or _forja_do_ambiente)
        return CODIGO_ENTRADA
    except Exception as exc:  # noqa: BLE001 - nunca imprime traceback
        mensagem = despachante._erro(exc) if despachante is not None else "%s: %s" % (type(exc).__name__, _cortar(exc, LIMITE_MENSAGEM))
        print(mensagem, file=erro)
        return CODIGO_ERRO


if __name__ == "__main__":
    sys.exit(main())
