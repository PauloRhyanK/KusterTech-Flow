"""Coordenador da fila por plano: acha os planos, admite quem não colide e cuida dos despachantes (só stdlib).

Roda como `fabrica-fila.service`, um laço a cada 60 s. Cada ciclo faz, nesta ordem:

1. prepara o Warren com `preparar_warren` (--model, drop-in, `warren-automerge` e `warren-auto` desligados),
   na mesma cadência do despachante, e marca a drenagem no `capacidade.json` enquanto espera os runs;
2. descobre os planos (`.fabrica/planos/*.json` e o legado `.fabrica/plano.json`) no branch padrão de cada
   repositório de `fila.json`; um plano inválido não entra e gera um aviso por mudança de conteúdo;
3. lê a caixa de entrada (`<raiz>/entrada/*.json`, gravada por `segurar`, `soltar` e `remover` da CLI) antes da
   fila: um plano segurado não é admitido, mesmo com vaga e trava livres; pedido torto ou desatualizado vira
   aviso e o arquivo é apagado. Um `remover` (de plano `aguardando`, `admitindo`, `ativo` ou `pausado`) desliga
   a unit, cancela os Plan Runs vivos (os do `estado.json` e os do projeto no Warren que apontam para os planos
   Seeds do plano), espera o run do orquestrador terminar, fecha os PRs do orquestrador e, com a unit já
   desligada, as issues de pausa e de decisão (comentário fixo), marca `removido` e solta reservas e trava.
   Warren ou GitHub fora deixa o pedido na caixa e o ciclo seguinte refaz as etapas, todas idempotentes. Nunca
   apaga código, branch, PR de seed nem a pasta do plano; `--manter-arquivo` impede o mesmo plano de reentrar;
4. aplica a fila (`fila.enfileirar`, `demandas.aplicar_na_fila` e `fila.admitir`): o plano de uma demanda do
   Flow fica `segurado` até a etapa `desenvolvida` da demanda (no mesmo ciclo em que é descoberto) e o urgente é
   visto primeiro na admissão, sem vaga reservada; para cada admitido, clona o repositório, grava o `plano.env`,
   roda `despachante.py iniciar` (só sem `estado.json`) e liga `fabrica-plano@<id>`;
5. observa os ativos: unit `failed` ou parada vira `pausado`, pausa da fábrica no plano também, e um plano
   concluído (`estado.plano_concluido`) tem a unit desligada, as reservas soltas e vira `concluido`;
6. com `FABRICA_CENTRAL_URL`, cuida das demandas do Flow (`demandas.passo` e depois `demandas.esvaziar_saida`):
   busca, triagem, plano, desenho, acompanhamento do plano na fila, teste no navegador e entrega (com o pedido de
   publicação, se houver `FABRICA_PUBLICACAO_TOKEN_FILE`). Uma falha aqui vira um aviso e nunca muda a fila nem
   para o ciclo; os planos de demanda saem do pedido de publicação por seed. Logo depois, o atendente do Decidir
   (`atendente.passo`): uma conversa por vez, um run por réplica, a resposta devolvida ao Flow. Entre os ciclos,
   enquanto há conversa ativa (`atendente.ativo`), só o atendente roda de novo, a cada `INTERVALO_DO_ATENDENTE_S`;
7. refaz, a partir do `estado.json`, as vagas e a trava de cada plano ocupando (`ativo`, `pausado`) sem unit
   rodando, e limpa as reservas, travas e esperas de quem não está mais ocupando (nem de um conserto nem de uma
   demanda em curso: `demanda:<id>` segura a trava do plano e a vaga do desenho, do teste e da correção);
8. envia o retrato da Fábrica à Central (`retrato.py`), se `FABRICA_CENTRAL_URL` estiver definida: o envio roda
   mesmo quando um passo anterior falhou e nunca muda a fila nem para o ciclo. A resposta traz os pedidos de
   conserto de publicação, atendidos por `consertos.py` com um run `fixer` numa vaga (o estado volta no retrato
   seguinte);
9. grava `fila-estado.json` de forma atômica.

Tudo é idempotente pelo `fila-estado.json` e pelo `estado.json` de cada plano: um coordenador reiniciado no
meio não admite duas vezes nem roda `iniciar` de novo. Os tokens só vêm de arquivos e nunca são gravados.
"""

import argparse
import contextlib
import copy
import datetime
import fcntl
import functools
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import atendente  # noqa: E402
import capacidade  # noqa: E402
import consertos  # noqa: E402
import contratos_externos  # noqa: E402
import conversas_flow  # noqa: E402
import demandas  # noqa: E402
import demandas_flow  # noqa: E402
import despachante  # noqa: E402
import estado as est  # noqa: E402
import fila  # noqa: E402
import motor as motor_  # noqa: E402
import publicar  # noqa: E402
import raias  # noqa: E402
import resumo_de_execucao  # noqa: E402
import retrato  # noqa: E402
from despachante import ErroDeEntrada  # noqa: E402

ARQ_FILA = "fila.json"
ARQ_FILA_ESTADO = "fila-estado.json"
ARQ_CAPACIDADE = "capacidade.json"
ARQ_TRAVA = "coordenador.lock"
ARQ_LOG = "log.jsonl"
ARQ_COORDENADOR_ENV = "coordenador.env"
DIR_PLANOS = "planos"
DIR_ENTRADA = "entrada"
DIR_PLANOS_NO_REPO = ".fabrica/planos"
CAMINHO_LEGADO = ".fabrica/plano.json"
KIT_PADRAO = pathlib.Path(__file__).resolve().parents[2]
RAIZ_PADRAO = "~/fabrica"
INTERVALO_PADRAO = 60
LIMITE_ENTRADA_APLICADA = 200
COMANDOS_DA_CAIXA = ("segurar", "soltar", "remover")
REMOVIVEIS = ("aguardando", "admitindo", "ativo", "pausado")
COMENTARIO_REMOCAO = "Plano removido da fila pelo coordenador."
UNIT_INEXISTENTE = ("not loaded", "does not exist")

CODIGO_ERRO = 1
CODIGO_ENTRADA = 2
CODIGO_TRAVA = 3
MENSAGEM_TRAVA = "outro coordenador está rodando nesta raiz"

VARIAVEIS_REPASSADAS = ("WARREN_API", "WARREN_TOKEN_FILE", "GH_TOKEN_FILE")
# envio do retrato à Central: leitura própria, fora de VARIAVEIS_REPASSADAS (não vai para o plano.env)
VARIAVEL_CENTRAL_URL = "FABRICA_CENTRAL_URL"
VARIAVEL_CENTRAL_TOKEN = "FABRICA_CENTRAL_TOKEN_FILE"
# Escritório da Fábrica: liga o retrato v2 (papel, critérios, horários e execuções). Só depois do Flow que o aceita.
VARIAVEL_CENTRAL_V2 = "FABRICA_CENTRAL_RETRATO_V2"
V1_DEPOIS_DE_RECUSA = datetime.timedelta(hours=1)
# teto de tempo por ciclo para ler o Warren das execuções ativas; o que passar sai sem linhas neste ciclo
ORCAMENTO_DAS_EXECUCOES_S = 20
AVISO_FLOW_SEM_V2 = "Central: o Flow ainda não aceita o retrato v2; vai o v1 por 1 h"
# fase da demanda em curso → papel da execução no escritório
PAPEL_DA_FASE_DA_DEMANDA = {"triando": "produto", "planejando": "orquestrador", "desenhando": "ux-ui", "testando": "qa", "corrigindo": "frontend"}
# pedido de publicação ao Flow (token de uma fonte de publicação): sem ele o passo fica desligado
VARIAVEL_PUBLICACAO_TOKEN = "FABRICA_PUBLICACAO_TOKEN_FILE"
LIMITE_DESCRICAO = 200
# respostas do Flow ao pedido de publicação que não mudam se repetidas (sem projeto, não configurada, inválido)
RECUSAS_DEFINITIVAS = (404, 409, 422)
LIMITE_AVISOS = 50
AVISO_FLOW_SEM_CONSERTOS = (
    "Central: o Flow recusou o retrato com os consertos (HTTP 400) e o recebeu sem os consertos; "
    "é um Flow sem suporte a consertos? Os consertos encerrados saem do estado"
)
AVISOS_NO_STATUS = 10
LIMITE_MENSAGEM = 500
LIMITE_SAIDA = 300
TAMANHO_MINIMO_SEGREDO = 8
FORMATO_INSTANTE = "%Y-%m-%dT%H:%M:%SZ"
UNITS_RODANDO = ("active", "activating", "reloading", "deactivating")
_REPO = re.compile(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+")
# o formato de `fila.id_do_plano`: 4 partes `[a-z0-9]+(-[a-z0-9]+)*` separadas por `--`
_ID = retrato.ID_DO_PLANO


class OutroCoordenador(Exception):
    """A trava da raiz já está com outro coordenador."""


# ---------------------------------------------------------------- arquivos


@contextlib.contextmanager
def travar(raiz):
    """Trava exclusiva e não bloqueante em `<raiz>/coordenador.lock` (o mesmo idioma de `despachante.travar`)."""
    raiz = pathlib.Path(raiz)
    raiz.mkdir(parents=True, exist_ok=True)
    fd = os.open(raiz / ARQ_TRAVA, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise OutroCoordenador(MENSAGEM_TRAVA) from None
        yield
    finally:
        os.close(fd)


def _repo_valido(repo) -> bool:
    return isinstance(repo, str) and _REPO.fullmatch(repo) is not None and repo.split("/")[1] not in (".", "..")


def ler_config(raiz) -> dict:
    """`fila.json`: `{"repos": [{"repo", "projeto"}]}`. Ausente, ilegível ou torto é entrada inválida (saída 2)."""
    caminho = pathlib.Path(raiz) / ARQ_FILA
    try:
        dados = despachante._ler_json(caminho)
    except (OSError, ValueError, UnicodeDecodeError, RecursionError):
        raise ErroDeEntrada(["%s ilegível: corrija ou restaure o arquivo" % caminho]) from None
    if dados is None:
        raise ErroDeEntrada(["%s não existe: rode o instalar_maquina.py ou crie {\"repos\": []}" % caminho])
    repos = dados.get("repos") if isinstance(dados, dict) else None
    if not isinstance(repos, list):
        raise ErroDeEntrada(["%s: deve ser um objeto com a lista repos" % caminho])
    vistos = set()
    for posicao, item in enumerate(repos):
        if not isinstance(item, dict) or not _repo_valido(item.get("repo")):
            raise ErroDeEntrada(["%s: repos[%d] sem repo no formato dono/nome" % (caminho, posicao)])
        if not isinstance(item.get("projeto"), str) or not item["projeto"]:
            raise ErroDeEntrada(["%s: repos[%d] sem projeto do Warren" % (caminho, posicao)])
        if item["repo"].lower() in vistos:
            raise ErroDeEntrada(["%s: repositório repetido: %s" % (caminho, item["repo"])])
        vistos.add(item["repo"].lower())
    return dados


def _ler_variaveis_do_env(raiz) -> dict:
    """Todas as `CHAVE=VALOR` não vazias de `<raiz>/coordenador.env`; ausente vale `{}`, ilegível levanta `ErroDeEntrada`.

    Uma por linha, sem expansão; linha vazia ou começando por `#` é ignorada, e aspas em volta do valor saem.
    """
    caminho = pathlib.Path(raiz) / ARQ_COORDENADOR_ENV
    try:
        texto = caminho.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    except (OSError, UnicodeDecodeError):
        raise ErroDeEntrada(["%s ilegível: corrija ou apague o arquivo" % caminho]) from None
    valores = {}
    for linha in texto.splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = (parte.strip() for parte in linha.split("=", 1))
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "'\"":
            valor = valor[1:-1]
        if valor:
            valores[chave] = valor
    return valores


def ler_coordenador_env(raiz) -> dict:
    """`<raiz>/coordenador.env` (o `EnvironmentFile` do `fabrica-fila`): só WARREN_API, WARREN_TOKEN_FILE e GH_TOKEN_FILE.

    Ausente vale `{}`; ilegível levanta `ErroDeEntrada`. As variáveis da Central têm `configuracao_central`.
    """
    return {chave: valor for chave, valor in _ler_variaveis_do_env(raiz).items() if chave in VARIAVEIS_REPASSADAS}


def configuracao_central(ambiente, raiz):
    """`{"url", "token_file"}` do envio à Central, ou `None` (envio desligado) sem `FABRICA_CENTRAL_URL`.

    O ambiente vale mais que o `coordenador.env`; arquivo ilegível conta como sem as variáveis. Nunca levanta:
    o `token_file` pode vir `None`, e o envio avisa. Só o caminho do token é lido aqui, nunca o token.
    """
    try:
        arquivo = _ler_variaveis_do_env(raiz)
    except ErroDeEntrada:
        arquivo = {}
    chaves = (VARIAVEL_CENTRAL_URL, VARIAVEL_CENTRAL_TOKEN, VARIAVEL_PUBLICACAO_TOKEN, VARIAVEL_CENTRAL_V2)
    valores = {chave: (ambiente.get(chave) or arquivo.get(chave) or None) for chave in chaves}
    if not valores[VARIAVEL_CENTRAL_URL]:
        return None
    configuracao = {"url": valores[VARIAVEL_CENTRAL_URL], "token_file": valores[VARIAVEL_CENTRAL_TOKEN]}
    if valores[VARIAVEL_PUBLICACAO_TOKEN]:
        configuracao["publicacao_token_file"] = valores[VARIAVEL_PUBLICACAO_TOKEN]
    if str(valores[VARIAVEL_CENTRAL_V2] or "").strip().lower() in ("1", "true", "sim"):
        configuracao["retrato_v2"] = True
    return configuracao


def _com_coordenador_env(ambiente, raiz) -> dict:
    """O ambiente do processo completado pelo `coordenador.env` (o ambiente tem precedência)."""
    resultado = dict(ambiente)
    for chave, valor in ler_coordenador_env(raiz).items():
        if not resultado.get(chave):
            resultado[chave] = valor
    return resultado


def _padrao_do_estado() -> dict:
    return {"fila": [], "avisos": [], "chaves": {}, "warren": {}}


def ler_estado(raiz) -> dict:
    """`fila-estado.json`; ausente vale o padrão. Ilegível levanta `ErroDeEntrada` e o arquivo nunca é recriado."""
    caminho = pathlib.Path(raiz) / ARQ_FILA_ESTADO
    try:
        dados = despachante._ler_json(caminho)
    except (OSError, ValueError, UnicodeDecodeError, RecursionError):
        dados = []
    if dados is None:
        return _padrao_do_estado()
    if not isinstance(dados, dict) or not isinstance(dados.get("fila", []), list):
        raise ErroDeEntrada(["%s ilegível: corrija ou restaure o arquivo (a fila não é recriada)" % caminho])
    resultado = _padrao_do_estado()
    resultado.update(dados)
    for chave, tipo in (("avisos", list), ("chaves", dict), ("warren", dict)):
        if not isinstance(resultado[chave], tipo):
            resultado[chave] = _padrao_do_estado()[chave]
    if not isinstance(resultado.get("central", {}), dict):
        del resultado["central"]
    if not isinstance(resultado.get("publicacao", {}), dict):
        del resultado["publicacao"]
    if not isinstance(resultado.get("consertos", {}), dict):
        resultado["consertos"] = {}
    if not isinstance(resultado.get("consertosEncerrados", []), list):
        resultado["consertosEncerrados"] = []
    if "entradaAplicada" in resultado:
        aplicados = resultado["entradaAplicada"]
        resultado["entradaAplicada"] = [n for n in aplicados if isinstance(n, str)] if isinstance(aplicados, list) else []
    return resultado


def _gravar_texto_atomico(caminho: pathlib.Path, texto: str) -> None:
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


def _instante(valor):
    try:
        return datetime.datetime.strptime(valor, FORMATO_INSTANTE).replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


def _git_url_do_repo(url: str, repo: str) -> bool:
    """`gitUrl` aponta para `repo` no GitHub? Sem diferenciar caixa e sem o `.git` do fim."""
    url = url.strip().lower().rstrip("/")
    if url.endswith(".git"):
        url = url[: -len(".git")]
    alvo = repo.lower()
    return url.endswith("github.com/" + alvo) or url.endswith("github.com:" + alvo)


def _id_valido(id_) -> bool:
    """Só um id neste formato vira nome de unit ou caminho: o fila-estado.json pode ter sido editado à mão."""
    return isinstance(id_, str) and _ID.fullmatch(id_) is not None


def _soltar_recusado(entrada: dict) -> str:
    """O plano segurado pela demanda só sai da espera pelo Flow (a etapa chega ao desenvolvimento) ou por `remover`."""
    id_ = entrada.get("id")
    return (
        "pedido soltar de %s recusado: o plano espera a demanda %s chegar ao desenvolvimento (aprove o desenho ou "
        "conclua a etapa no Flow); para tirá-lo da fila, coordenador.py remover %s" % (id_, str(entrada.get("demanda"))[:8], id_)
    )


def _atuais(fila_: list) -> dict:
    """A entrada vigente de cada id (a última válida da lista); id fora do formato fica de fora."""
    return retrato.vigentes(fila_)


# ---------------------------------------------------------------- coordenador


class Coordenador:
    def __init__(
        self,
        *,
        raiz,
        forja,
        motor,
        systemd,
        executar,
        preparar_warren,
        kit=KIT_PADRAO,
        agora=lambda: datetime.datetime.now(datetime.timezone.utc),
        clonar=None,
        ambiente=None,
        segredos=(),
        central=None,
        enviar=None,
        pedir_publicacao=None,
        cliente_do_flow=None,
        cliente_das_conversas=None,
    ):
        self.raiz = pathlib.Path(raiz)
        self.forja = forja
        self.motor = motor
        self.systemd = systemd
        self.executar = executar
        self.preparar_warren = preparar_warren
        self.kit = pathlib.Path(kit)
        self._agora = agora
        if clonar is None:
            caminho = (ambiente or {}).get("GH_TOKEN_FILE") or despachante.GH_TOKEN_PADRAO
            clonar = functools.partial(_clonar, token_file=os.path.abspath(os.path.expanduser(caminho)))
        self.clonar = clonar
        ambiente = ambiente or {}
        self.ambiente = {k: ambiente[k] for k in VARIAVEIS_REPASSADAS if isinstance(ambiente.get(k), str) and ambiente[k]}
        conhecidos = {s.strip() for s in segredos if isinstance(s, str)} | {s for s in segredos if isinstance(s, str)}
        self._segredos = tuple(sorted((s for s in conhecidos if len(s) >= TAMANHO_MINIMO_SEGREDO), key=len, reverse=True))
        self.capacidade = self.raiz / ARQ_CAPACIDADE
        self.central = central  # {"url", "token_file"} ou None (envio desligado)
        self._v1_ate = None  # depois de o Flow recusar o v2 (400), vai o v1 até este instante
        self._relogio = time.monotonic
        self._prazo_das_execucoes = None
        self._enviar = enviar or retrato.enviar
        self._pedir_publicacao = pedir_publicacao or publicar.pedir
        self._cliente_do_flow = cliente_do_flow or demandas_flow.ClienteDoFlow  # (url da Central, token_file) → cliente
        self._cliente_das_conversas = cliente_das_conversas or conversas_flow.ClienteDasConversas  # idem, rotas do Decidir
        self._ciclos = 0
        self._ultimo_preparo = None
        self._sha_revertido = None
        self._repetidos = {}
        self.dados = _padrao_do_estado()
        self._tentados = set()
        self._removendo = set()  # remoção pedida e ainda não concluída: nem admitido nem observado neste ciclo
        self._postas_de_lado = []  # entradas com id fora do formato: ficam no arquivo, fora de toda decisão
        self._config = None

    # ------------------------------------------------------------ registro

    def _seguro(self, texto, limite: int = LIMITE_MENSAGEM) -> str:
        texto = str(texto)
        for segredo in self._segredos:
            texto = texto.replace(segredo, "***")
        return despachante._cortar(texto, limite)

    def _erro(self, exc: BaseException) -> str:
        try:
            mensagem = str(exc)
        except Exception:  # noqa: BLE001
            mensagem = ""
        return self._seguro("%s: %s" % (type(exc).__name__, mensagem))

    def _agora_texto(self) -> str:
        return self._agora().astimezone(datetime.timezone.utc).strftime(FORMATO_INSTANTE)

    def _log(self, registro: dict) -> None:
        linha = json.dumps(dict({"ts": self._agora_texto()}, **registro), ensure_ascii=False, default=str)
        for segredo in self._segredos:
            linha = linha.replace(segredo, "***").replace(json.dumps(segredo)[1:-1], "***")
        self.raiz.mkdir(parents=True, exist_ok=True)
        despachante._anexar_linha(self.raiz / ARQ_LOG, linha)

    def _log_repetivel(self, chave: str, registro: dict) -> None:
        assinatura = json.dumps(registro, sort_keys=True, ensure_ascii=False, default=str)
        if self._repetidos.get(chave) != assinatura:
            self._repetidos[chave] = assinatura
            self._log(registro)

    def _erro_de_etapa(self, etapa: str, alvo, exc: BaseException) -> None:
        self._log_repetivel("%s:%s" % (etapa, alvo), {"evento": "erro", "etapa": etapa, "alvo": alvo, "erro": self._erro(exc)})

    def _aviso(self, chave: str, mensagem: str, assinatura=None) -> None:
        """Um aviso por situação: repete só quando a assinatura (por padrão, a mensagem) muda."""
        mensagem = self._seguro(mensagem)
        assinatura = mensagem if assinatura is None else assinatura
        if self.dados["chaves"].get(chave) == assinatura:
            return
        self.dados["chaves"][chave] = assinatura
        self.dados["avisos"] = (self.dados["avisos"] + [{"em": self._agora_texto(), "mensagem": mensagem}])[-LIMITE_AVISOS:]
        self._log({"evento": "aviso", "mensagem": mensagem})
        self._salvar()

    def _esquecer(self, chave: str) -> None:
        if self.dados["chaves"].pop(chave, None) is not None:
            self._salvar()

    def _salvar(self) -> None:
        self.raiz.mkdir(parents=True, exist_ok=True)
        despachante.gravar_json_atomico(self.raiz / ARQ_FILA_ESTADO, dict(self.dados, fila=self.dados["fila"] + self._postas_de_lado))

    def status(self) -> str:
        return status(self.raiz, self.central)

    # ------------------------------------------------------------ registrar

    def registrar(self, repo: str) -> str:
        """Acha o projeto do Warren pelo `gitUrl` e grava o repositório em `fila.json`. Idempotente."""
        if not _repo_valido(repo):
            raise ErroDeEntrada(["repositório fora do formato dono/nome: %r" % despachante._cortar(str(repo), 200)])
        try:
            self.forja.branch_padrao(repo)
        except Exception as exc:  # noqa: BLE001 - a mensagem diz o que conferir
            raise ErroDeEntrada(["sem acesso ao repositório %s no GitHub (%s)" % (repo, self._erro(exc))]) from None
        achados = [p for p in self.motor.projetos() if _git_url_do_repo(p["gitUrl"], repo)]
        if not achados:
            raise ErroDeEntrada(
                [
                    "crie o projeto no Warren: nenhum projeto tem o gitUrl https://github.com/%s.git; crie-o no Warren "
                    "e rode registrar de novo" % repo
                ]
            )
        if len({p["id"] for p in achados}) > 1:
            raise ErroDeEntrada(["mais de um projeto do Warren aponta para %s: %s" % (repo, ", ".join(p["id"] for p in achados))])
        projeto = achados[0]["id"]
        caminho = self.raiz / ARQ_FILA
        if caminho.exists():
            dados = ler_config(self.raiz)
        else:
            dados = {"repos": []}
        repos = [r for r in dados["repos"] if r["repo"].lower() != repo.lower()]
        anterior = [r for r in dados["repos"] if r["repo"].lower() == repo.lower()]
        if anterior and anterior[0]["projeto"] == projeto:
            return "repositório %s já registrado (projeto %s)" % (anterior[0]["repo"], projeto)
        dados["repos"] = repos + [{"repo": anterior[0]["repo"] if anterior else repo, "projeto": projeto}]
        self.raiz.mkdir(parents=True, exist_ok=True)
        despachante.gravar_json_atomico(caminho, dados)
        return "repositório %s registrado (projeto %s)" % (repo, projeto)

    def pedir(self, comando: str, id_: str, **opcoes) -> str:
        """Valida o pedido contra o `fila-estado.json` atual e o grava na caixa; o próximo ciclo o aplica."""
        if comando not in COMANDOS_DA_CAIXA:
            raise ErroDeEntrada(["comando desconhecido: %r" % despachante._cortar(str(comando), 100)])
        entrada = _atuais(ler_estado(self.raiz)["fila"]).get(id_)
        if entrada is None:
            raise ErroDeEntrada(["plano desconhecido na fila: %r" % despachante._cortar(str(id_), 200)])
        if comando == "segurar" and entrada.get("estado") != "aguardando":
            raise ErroDeEntrada(["só quem aguarda pode ser segurado: %s está %s" % (id_, entrada.get("estado"))])
        if comando == "soltar" and not entrada.get("segurado"):
            raise ErroDeEntrada(["%s não está segurado" % id_])
        if comando == "soltar" and entrada.get("seguradoPor") == "demanda":
            raise ErroDeEntrada([_soltar_recusado(entrada)])
        if comando == "remover":
            return self._pedir_remocao(entrada, manter_arquivo=bool(opcoes.get("manter_arquivo")), simular=bool(opcoes.get("simular")))
        despachante.enfileirar_pedido(self.raiz, {"comando": comando, "id": id_, **opcoes})
        return "pedido %s de %s gravado; aplicado no próximo ciclo" % (comando, id_)

    def _pedir_remocao(self, entrada: dict, *, manter_arquivo: bool, simular: bool) -> str:
        """Valida a remoção; com `simular`, só lê e devolve as etapas que rodariam (nada é gravado)."""
        id_ = entrada["id"]
        if entrada.get("estado") == "removido":
            return "%s já está removido" % id_
        if entrada.get("estado") not in REMOVIVEIS:
            raise ErroDeEntrada(["só sai da fila um plano aguardando, admitindo, ativo ou pausado: %s está %s" % (id_, entrada.get("estado"))])
        repo, caminho = entrada["repo"], entrada["caminho"]
        if not manter_arquivo and self.forja.arquivo(repo, self.forja.branch_padrao(repo), caminho) is not None:
            raise ErroDeEntrada(["o arquivo %s continua no branch padrão: apague-o ou use --manter-arquivo" % caminho])
        if simular:
            return self._simular_remocao(entrada, manter_arquivo)
        despachante.enfileirar_pedido(self.raiz, {"comando": "remover", "id": id_, "manterArquivo": manter_arquivo})
        return "pedido remover de %s gravado; aplicado no próximo ciclo" % id_

    def _simular_remocao(self, entrada: dict, manter_arquivo: bool) -> str:
        id_ = entrada["id"]
        etapas = []
        if entrada["estado"] != "aguardando":
            etapas.append("desligar e desabilitar %s" % self._unit(id_))
        try:
            estado, plano = self._ler_para_remover(entrada)
        except (OSError, ValueError, UnicodeDecodeError, RecursionError):
            estado, plano = None, None
            etapas.append("estado.json ilegível: Plan Runs, PRs e issues ficam para conferência manual")
        if estado is not None:
            try:
                alvos = self._alvos_da_remocao(entrada, estado, plano)
            except Exception as exc:  # noqa: BLE001 - a simulação só mostra o que não deu para ler
                etapas.append("não foi possível ler o Warren ou o GitHub agora: %s" % self._erro(exc))
            else:
                etapas.extend("cancelar o Plan Run %s" % p for p in alvos["planos"])
                if alvos["runOrquestrador"]:
                    etapas.append("esperar o run do orquestrador %s terminar" % alvos["runOrquestrador"])
                etapas.extend("fechar o PR do orquestrador %s" % u for u in alvos["prs"])
                etapas.extend("fechar a issue %s" % u for u in alvos["issues"])
                etapas.extend("%s (404): ignorado" % nome for nome in alvos["ausentes"])
        etapas.append("marcar %s como removido%s e soltar as reservas e a trava" % (id_, " (o arquivo fica, sem reentrar)" if manter_arquivo else ""))
        return "simulação: remover %s (nada foi gravado)\n%s" % (id_, "\n".join("  - %s" % e for e in etapas))

    # ------------------------------------------------------------ caixa de entrada

    def _passo_entrada(self, eventos: list) -> None:
        pasta = self.raiz / DIR_ENTRADA
        if not pasta.is_dir():
            return
        pedidos = sorted(p for p in pasta.iterdir() if p.name.endswith(".json") and not p.name.startswith(".") and p.is_file())
        for caminho in pedidos:
            chave = "entrada:%s" % caminho.name
            if caminho.name in self.dados.get("entradaAplicada", []):
                self._descartar(caminho, chave)  # já aplicado e o arquivo não saiu: só tenta apagar de novo
                continue
            try:
                pedido = despachante._json_estrito(caminho.read_text(encoding="utf-8"))
                if not isinstance(pedido, dict):
                    raise ValueError("não é um objeto")
            except (OSError, ValueError, RecursionError):
                self._aviso(chave, "pedido inválido em %s/%s descartado" % (DIR_ENTRADA, caminho.name))
                self._descartar(caminho, chave)
                continue
            comando, id_ = pedido.get("comando"), pedido.get("id")
            if comando not in COMANDOS_DA_CAIXA or not isinstance(id_, str):
                self._aviso(chave, "pedido desconhecido em %s/%s descartado: %r" % (DIR_ENTRADA, caminho.name, comando))
                self._descartar(caminho, chave)
                continue
            try:
                if comando == "remover":
                    if not self._remover(pedido, chave, eventos):
                        self._removendo.add(id_)  # o pedido fica: o ciclo seguinte refaz as etapas
                        continue
                else:
                    self._segurar(id_, comando == "segurar", chave, eventos)
            except Exception as exc:  # noqa: BLE001 - o pedido fica para o próximo ciclo
                self._erro_de_etapa("pedido", caminho.name, exc)
                if comando == "remover":
                    self._removendo.add(id_)
                continue
            self._descartar(caminho, chave)

    # ------------------------------------------------------------ remover

    def _ler_para_remover(self, entrada: dict):
        """`(estado, plano)` do plano; `(None, None)` para quem aguarda sem `estado.json` (nada a desfazer).

        `estado.json` ausente (fora de `aguardando`), ilegível ou que não é um objeto levanta `ValueError`;
        um `plano.json` ilegível vale `None` (só deixa de achar os Plan Runs pelos planos Seeds).
        """
        pasta = self._pasta(entrada["id"])
        if entrada["estado"] == "aguardando" and not (pasta / despachante.ARQ_ESTADO).exists():
            return None, None
        estado = despachante._ler_json(pasta / despachante.ARQ_ESTADO)
        if not isinstance(estado, dict):
            raise ValueError("estado.json ausente ou não é um objeto")
        try:
            plano = despachante._ler_json(pasta / despachante.ARQ_PLANO)
        except (OSError, ValueError, UnicodeDecodeError, RecursionError):
            plano = None
        return estado, plano if isinstance(plano, dict) else None

    @staticmethod
    def _ou_ausente(nome: str, ausentes: list, ler):
        """`ler()`, ou `None` quando o Warren ou o GitHub responde 404 (anotado em `ausentes`).

        Só o 404 explícito (`despachante._eh_404`) ou o 410 Gone (issue apagada no GitHub) vira "nada a fazer"; falha de rede, timeout e outro HTTP levantam.
        """
        try:
            return ler()
        except Exception as exc:  # noqa: BLE001 - o que não é 404 sobe para o chamador
            if despachante._eh_falha_de_rede(exc) or not (despachante._eh_404(exc) or re.search(r"HTTP 410\s*$", str(exc))):
                raise
            ausentes.append(nome)
            return None

    def _alvos_da_remocao(self, entrada: dict, estado: dict, plano) -> dict:
        """Só leituras: os Plan Runs vivos, o run do orquestrador em curso, os PRs do orquestrador e as issues abertas.

        Plan Run, run, PR ou issue com 404 fica de fora e entra em `ausentes` ("Plan Run X", "issue URL"...).
        """
        ausentes = []
        projeto = {r["repo"].lower(): r["projeto"] for r in (self._config or ler_config(self.raiz))["repos"]}.get(entrada["repo"].lower())
        projeto = projeto or (estado.get("projeto") if despachante._texto(estado.get("projeto")) else None)
        estados_dos_planos = {}
        seeds = {r.get("planoSeeds") for r in despachante._lista(despachante._dict(plano).get("raias")) if isinstance(r, dict)}
        seeds.discard(None)
        if projeto and seeds:
            for item in self.motor.planos_do_projeto(projeto):
                if item.get("planId") in seeds:
                    estados_dos_planos[item["id"]] = item.get("estado")
        for raia in despachante._dict(estado.get("raias")).values():
            plan_run = despachante._dict(raia).get("planRunId")
            if despachante._texto(plan_run) and plan_run not in estados_dos_planos:
                lido = self._ou_ausente("Plan Run %s não encontrado" % plan_run, ausentes, lambda p=plan_run: self.motor.plano(p))
                if lido is not None:
                    estados_dos_planos[plan_run] = lido.get("estado")
        planos = sorted(i for i, e in estados_dos_planos.items() if e not in motor_.TERMINAIS_DE_PLANO)
        orquestrador = despachante._dict(estado.get("orquestrador"))
        prs = [u for u in despachante._lista(estado.get("prsOrquestrador")) if despachante._texto(u)]
        run_vivo = None
        if despachante._texto(orquestrador.get("runId")):
            run_id = orquestrador["runId"]
            run = self._ou_ausente("run do orquestrador %s não encontrado" % run_id, ausentes, lambda: self.motor.run(run_id))
            if run is not None and run.get("estado") not in despachante.TERMINAIS_DE_RUN:
                run_vivo = run_id
            elif run is not None and despachante._texto(run.get("prUrl")):
                prs.append(run["prUrl"])
        issues = [despachante._dict(estado.get("decisaoPausa")).get("url")]
        issues += [despachante._dict(d).get("url") for d in despachante._lista(estado.get("decisoes"))]
        issues.append(despachante._dict(orquestrador.get("bloqueio")).get("url"))
        prs_abertos = []
        for url in dict.fromkeys(prs):
            lido = self._ou_ausente("PR %s não encontrado" % url, ausentes, lambda u=url: self.forja.pr(u))
            if lido is not None and lido.get("aberto"):
                prs_abertos.append(url)
        abertas = []
        for url in dict.fromkeys(i for i in issues if despachante._texto(i)):
            lido = self._ou_ausente("issue %s não encontrada" % url, ausentes, lambda u=url: self.forja.decisao(u))
            if lido is not None and not lido.get("fechada"):
                abertas.append(url)
        return {"planos": planos, "runOrquestrador": run_vivo, "prs": prs_abertos, "issues": abertas, "ausentes": ausentes}

    def _remover(self, pedido: dict, chave: str = "", eventos=None) -> bool:
        """Aplica um pedido de remoção. True: concluiu (ou não há o que fazer) e o pedido sai da caixa.

        Etapas, cada uma idempotente: desliga a unit, cancela os Plan Runs vivos, espera o run do orquestrador,
        fecha os PRs do orquestrador e as issues do plano (depois da unit desligada), marca `removido` e solta as
        reservas e a trava. Uma falha no Warren ou no GitHub devolve False: o ciclo seguinte refaz tudo.
        """
        id_ = pedido["id"]
        chave = chave or "remover:%s" % id_
        entrada = _atuais(self.dados["fila"]).get(id_)
        if entrada is None:
            self._aviso(chave, "pedido remover de %s recusado: plano desconhecido" % id_)
            return True
        if entrada.get("estado") == "removido":
            return True  # pedido repetido: sem efeito
        if entrada.get("estado") not in REMOVIVEIS:
            self._aviso(chave, "pedido remover de %s recusado: o plano está %s" % (id_, entrada.get("estado")))
            return True
        manter_arquivo = pedido.get("manterArquivo") is True
        progresso = "remover:%s" % id_
        if entrada["estado"] != "aguardando":
            unit = self._unit(id_)
            codigo, saida = self.systemd("disable", "--now", unit)
            if codigo != 0 and not any(t in (saida or "") for t in UNIT_INEXISTENTE):
                self._aviso(
                    progresso,
                    "%s: systemctl --user disable --now %s saiu com %s, remoção adiada: %s" % (id_, unit, codigo, self._seguro(saida, LIMITE_SAIDA)),
                )
                return False
        try:
            estado, plano = self._ler_para_remover(entrada)
        except (OSError, ValueError, UnicodeDecodeError, RecursionError):
            estado, plano = None, None
            self._aviso(
                "removido:%s:ilegivel" % id_,
                "%s removido com estado.json ilegível: confira à mão os Plan Runs no Warren e os PRs do orquestrador" % id_,
            )
        if estado is not None:
            try:
                alvos = self._alvos_da_remocao(entrada, estado, plano)
                ausentes = alvos["ausentes"]
                for plan_run in alvos["planos"]:
                    self._ou_ausente("Plan Run %s não encontrado" % plan_run, ausentes, lambda p=plan_run: self.motor.cancelar_plano(p))
                if alvos["runOrquestrador"]:
                    self._aviso(progresso, "%s: esperando o run do orquestrador terminar para remover" % id_)
                    return False
                for url in alvos["prs"]:
                    self._ou_ausente("PR %s não encontrado" % url, ausentes, lambda u=url: self.forja.fechar_pr(u, COMENTARIO_REMOCAO))
                for url in alvos["issues"]:
                    self._ou_ausente("issue %s não encontrada" % url, ausentes, lambda u=url: self.forja.fechar_decisao(u, COMENTARIO_REMOCAO))
                for nome in dict.fromkeys(ausentes):
                    self._aviso("remover:%s:404:%s" % (id_, nome), "%s: %s (404), ignorado na remoção" % (id_, nome))
            except Exception as exc:  # noqa: BLE001 - Warren ou GitHub fora: o ciclo seguinte refaz
                self._aviso(progresso, "não foi possível remover %s agora, tento de novo no próximo ciclo: %s" % (id_, self._erro(exc)))
                return False
        capacidade.sincronizar(self.capacidade, id_, set())
        capacidade.soltar_orquestrador(self.capacidade, entrada["repo"], id_)
        self.dados["fila"] = fila.remover(self.dados["fila"], id_, manter_arquivo=manter_arquivo)
        self._salvar()
        for velha in (progresso, "unit:%s" % id_, "pausa:%s" % id_, "admitir:%s" % id_, "ocupacao:%s" % id_):
            self._esquecer(velha)
        self._log({"evento": "removido", "id": id_, "manterArquivo": manter_arquivo})
        self._aviso("removido:%s" % id_, "%s removido da fila" % id_)
        if eventos is not None:
            eventos.append({"evento": "removido", "id": id_})
        return True

    def _segurar(self, id_: str, valor: bool, chave: str, eventos: list) -> None:
        comando = "segurar" if valor else "soltar"
        entrada = _atuais(self.dados["fila"]).get(id_)
        if entrada is None:
            self._aviso(chave, "pedido %s de %s recusado: plano desconhecido" % (comando, id_))
            return
        if valor and entrada.get("segurado") and entrada.get("seguradoPor") != "demanda":
            return  # já segurado pelo Paulo: nada a fazer, nem aviso (o da demanda passa a ser do Paulo)
        if valor and entrada.get("estado") != "aguardando":
            self._aviso(chave, "pedido segurar de %s recusado: o plano está %s" % (id_, entrada.get("estado")))
            return
        if not valor and not entrada.get("segurado"):
            self._aviso(chave, "pedido soltar de %s recusado: o plano não está segurado" % id_)
            return
        if not valor and entrada.get("seguradoPor") == "demanda":
            self._aviso(chave, _soltar_recusado(entrada))
            return
        self.dados["fila"] = fila.segurar(self.dados["fila"], id_, valor)
        self._salvar()
        if valor:
            self._aviso(chave, "%s segurado na fila (coordenador.py soltar %s para liberar)" % (id_, id_))
        else:
            self._aviso(chave, "%s solto na fila" % id_)
        self._log({"evento": "segurado" if valor else "solto", "id": id_})
        eventos.append({"evento": "segurado" if valor else "solto", "id": id_})

    def _descartar(self, caminho: pathlib.Path, chave: str) -> None:
        """Marca o pedido como concluído (nunca é reaplicado, mesmo se o arquivo não sair) e apaga o arquivo."""
        aplicados = self.dados.get("entradaAplicada", [])
        if caminho.name not in aplicados:
            self.dados["entradaAplicada"] = (aplicados + [caminho.name])[-LIMITE_ENTRADA_APLICADA:]
            self._salvar()
        try:
            caminho.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            self._aviso("%s:apagar" % chave, "não foi possível apagar o pedido %s/%s (%s)" % (DIR_ENTRADA, caminho.name, type(exc).__name__))
            return
        self._esquecer(chave)

    # ------------------------------------------------------------ laço

    def rodar(self, *, intervalo: int = INTERVALO_PADRAO, ciclos: int | None = None, dormir=time.sleep) -> None:
        feitos = 0
        try:
            while ciclos is None or feitos < ciclos:
                try:
                    self.ciclo()
                except ErroDeEntrada:
                    raise  # fila.json ou fila-estado.json ilegível: saída 2, como na partida
                except Exception as exc:  # noqa: BLE001 - o erro vai para o log (quando muda) e o laço continua
                    self._log_repetivel("erro_no_ciclo", {"evento": "erro_no_ciclo", "erro": self._erro(exc)})
                else:
                    self._repetidos.pop("erro_no_ciclo", None)
                feitos += 1
                if ciclos is not None and feitos >= ciclos:
                    break
                self._esperar(intervalo, dormir)
        finally:
            # parado de vez, ninguém soltaria a drenagem; o próximo coordenador a refaz a partir do disco
            with contextlib.suppress(Exception):
                if capacidade.ler(self.capacidade).get("drenagem"):
                    capacidade.definir_drenagem(self.capacidade, None)

    def _esperar(self, intervalo: int, dormir, relogio=time.monotonic) -> None:
        """O intervalo entre ciclos: com conversa ativa, o atendente roda a cada `INTERVALO_DO_ATENDENTE_S`.

        Conta o tempo dormido mais o gasto nos passos (em segundos inteiros): um passo lento ao Flow não estica o
        ciclo. Sem conversa ativa, dorme o resto do intervalo de uma vez. Só o atendente roda aqui: demandas,
        consertos, publicação, órfãos e o retrato esperam o ciclo seguinte, no horário de sempre.
        """
        passado = 0
        while passado < intervalo:
            restante = intervalo - passado
            if not self._atendente_ativo():
                dormir(restante)
                return
            pausa = min(atendente.INTERVALO_DO_ATENDENTE_S, restante)
            dormir(pausa)
            antes = relogio()
            self._passo_atendente()
            passado += pausa + int(max(0, relogio() - antes))

    def _atendente_ativo(self) -> bool:
        """Conversa ativa com o atendente ligado? Nunca levanta (um estado torto vale "não")."""
        try:
            return bool((self.central or {}).get("url")) and atendente.ativo(self.dados, self._agora())
        except Exception:  # noqa: BLE001
            return False

    def ciclo(self) -> list[dict]:
        """Os passos, nesta ordem. Devolve os eventos do ciclo.

        `fila.json` ou `fila-estado.json` ilegível levanta `ErroDeEntrada` (o `rodar` deixa sair com 2).
        """
        self.dados = ler_estado(self.raiz)
        self._separar_ids_invalidos()
        self._tentados = set()
        self._removendo = set()
        self._config = None  # só o fila.json lido neste ciclo vale para os consertos
        eventos: list[dict] = []
        try:
            config = self._config = ler_config(self.raiz)
            if self._ciclos == 0:
                try:
                    self._limpar_drenagem_herdada()
                except Exception as exc:  # noqa: BLE001
                    self._erro_de_etapa("drenagem_herdada", "capacidade", exc)
            self._passo_preparar(eventos)
            descobertos, falhos = self._passo_descobrir(config)
            self._passo_entrada(eventos)
            self._passo_fila(config, descobertos, falhos, eventos)
            rodando, confiavel = self._passo_observar(eventos)
            self._passo_demandas()
            self._passo_atendente()
            self._passo_publicar()
            self._passo_orfaos(rodando, confiavel, eventos)
        finally:
            self._ciclos += 1
            self._passo_central()
            self._salvar()
        return eventos

    # ------------------------------------------------------------ 7. Central

    def _retrato(self, com_consertos: bool = True, versao: int = 1) -> bytes:
        """O retrato do ciclo, já cortado, em JSON. `FalhaDeEnvio` se não dá para montar ou se não cabe."""
        try:
            cap = capacidade.ler(self.capacidade)
        except capacidade.CapacidadeInvalida:
            raise retrato.FalhaDeEnvio("capacidade.json inválido: nada enviado") from None
        planos = retrato.ler_planos(self.raiz / DIR_PLANOS, _atuais(self.dados["fila"]))
        completo = retrato.montar(
            agora=self._agora_texto(),
            fila_estado=self.dados,
            capacidade=cap,
            planos=planos,
            mem_disponivel_mb=capacidade.mem_disponivel_mb(),
            consertos=consertos.para_o_retrato(self.dados) if com_consertos else None,
            versao=versao,
            execucoes=self._execucoes(planos) if versao >= 2 else None,
        )
        cortado = retrato.ajustar(completo)
        if cortado is None:
            raise retrato.FalhaDeEnvio("retrato não cabe nos limites: nada enviado")
        return retrato.serializar(cortado)

    def _execucao(self, run_id, papel, **extra) -> dict:
        """Uma execução ativa para o retrato v2. Falha do Warren num run não derruba o retrato: sai sem linhas."""
        item = dict({"runId": run_id, "papel": papel, "linhas": [], "ultimaAcao": None, "modelo": None, "custoUsd": None}, **extra)
        if self._prazo_das_execucoes is not None and self._relogio() >= self._prazo_das_execucoes:
            return item  # o orçamento do ciclo acabou: sem chamar o Warren
        with contextlib.suppress(Exception):
            item.update(resumo_de_execucao.resumir(self.motor.eventos_brutos(run_id), segredos=self._segredos))
        with contextlib.suppress(Exception):
            run = self.motor.run(run_id)
            item["estado"], item["custoUsd"] = run.get("estado"), run.get("custoUsd")
        return item

    def _execucoes(self, planos: dict) -> list:
        """As execuções ativas do ciclo: raias (código, revisor e conserto), orquestrador e runs de demanda.
        As leituras do Warren param no orçamento do ciclo (ORCAMENTO_DAS_EXECUCOES_S)."""
        self._prazo_das_execucoes = self._relogio() + ORCAMENTO_DAS_EXECUCOES_S
        saida = []
        for plano_id, lidos in (planos or {}).items():
            estado, plano = (lidos or {}).get("estado") or {}, (lidos or {}).get("plano") or {}
            papeis = {r.get("id"): r.get("papel") for r in plano.get("raias") or [] if isinstance(r, dict)}
            demanda = plano.get("demanda")
            comum = {"planoId": plano_id, "demanda": demanda if isinstance(demanda, str) else None}
            for seed in (estado.get("seeds") or {}).values():
                if not isinstance(seed, dict):
                    continue
                raia, situacao = seed.get("raia"), seed.get("estado")
                if situacao == "executando" and seed.get("runId"):
                    saida.append(self._execucao(seed["runId"], papeis.get(raia), raia=raia, inicio=seed.get("inicio"), **comum))
                elif situacao == "em_revisao" and seed.get("revisaoRunId"):
                    saida.append(self._execucao(seed["revisaoRunId"], "revisor", raia=raia, **comum))
                elif situacao == "corrigindo" and seed.get("fixerRunId"):
                    saida.append(self._execucao(seed["fixerRunId"], "fixer", raia=raia, **comum))
                elif situacao == "corrigindo" and seed.get("revisaoRunId"):
                    # depois do fixer o despachante chama o revisor de novo sem sair de `corrigindo`
                    saida.append(self._execucao(seed["revisaoRunId"], "revisor", raia=raia, **comum))
            orquestrador = (estado.get("orquestrador") or {}).get("runId")
            if orquestrador:
                saida.append(self._execucao(orquestrador, "orquestrador", raia=None, **comum))
        itens = ((self.dados.get("demandas") or {}).get("itens") or {})
        for demanda_id, item in itens.items():
            if isinstance(item, dict) and item.get("runId") and item.get("fase") in PAPEL_DA_FASE_DA_DEMANDA:
                saida.append(self._execucao(item["runId"], PAPEL_DA_FASE_DA_DEMANDA[item["fase"]], raia=None, planoId=None, demanda=demanda_id, inicio=item.get("inicio")))
        return saida

    def _passo_central(self) -> None:
        """Envia o retrato (sem URL, só acompanha os consertos em andamento). Nada daqui muda a fila, para o ciclo ou deixa uma exceção escapar.

        Roda no `finally` do ciclo, então envia mesmo quando um passo falhou. A falha vira um aviso só quando a
        categoria muda (um envio bom zera isso); a categoria nunca traz o token nem o texto da exceção.
        """
        if not self.central:
            # envio desligado com conserto em andamento: segue acompanhando o run (teto de 1 h e a vaga)
            with contextlib.suppress(Exception):
                self._passo_consertos(None)
            return
        with contextlib.suppress(Exception):
            resposta, sem_consertos = None, False
            destino = {"url": self.central.get("url"), "token_file": self.central.get("token_file")}
            try:
                versao = 2 if self.central.get("retrato_v2") and not (self._v1_ate and self._agora() < self._v1_ate) else 1
                corpo = self._retrato(versao=versao)
                if versao == 2:
                    try:
                        resposta = self._enviar(corpo, **destino)
                    except retrato.FalhaDeEnvio as exc:
                        if exc.codigo != 400:
                            raise
                        # Flow de antes do escritório: o esquema estrito só conhece o v1. Vai o v1 já, e por 1 h.
                        self._v1_ate = self._agora() + V1_DEPOIS_DE_RECUSA
                        self._aviso("central:v2", AVISO_FLOW_SEM_V2)
                        versao, corpo = 1, self._retrato()
                if versao == 1:
                    try:
                        resposta = self._enviar(corpo, **destino)
                    except retrato.FalhaDeEnvio as exc:
                        if exc.codigo != 400 or "consertos" not in json.loads(corpo):
                            raise
                        # Flow de antes dos consertos (rollback): o esquema estrito recusa o campo. Vai uma vez sem ele.
                        resposta, sem_consertos = self._enviar(self._retrato(com_consertos=False), **destino), True
                falha = None
            except retrato.FalhaDeEnvio as exc:
                falha = str(exc)
            except Exception as exc:  # noqa: BLE001 - inclusive ErroDeEntrada, que encerraria o serviço
                falha = "falha inesperada (%s)" % type(exc).__name__
            self.dados["central"] = {"em": self._agora_texto(), "resultado": "enviado" if falha is None else "falhou: %s" % falha}
            if falha is None:
                self._esquecer("central:envio")
                if sem_consertos:
                    self._aviso("central:consertos", AVISO_FLOW_SEM_CONSERTOS)
                elif "consertos" in json.loads(corpo):
                    self._esquecer("central:consertos")
            else:
                self._aviso("central:envio", "Central: envio do retrato falhou (%s)" % falha)
            if sem_consertos:
                # esse Flow não conhece consertos: nada a reportar; os finais saem do estado, os em curso seguem até o fim
                resposta = resposta if isinstance(resposta, dict) else {}
            self._passo_consertos(resposta if falha is None else None)

    def _passo_publicar(self) -> None:
        """Pede ao Flow a publicação depois do merge de uma seed: um pedido por plano por ciclo. Nunca levanta.

        O plano de uma demanda (entrada com `demanda`) fica de fora: a demanda pede a publicação uma vez, na entrega.

        Desligado sem `FABRICA_CENTRAL_URL` e `FABRICA_PUBLICACAO_TOKEN_FILE`. A primeira leitura de um plano só
        grava as seeds já mergeadas (linha de base). Falha transitória (rede, timeout, 5xx) não marca a seed como
        vista (tenta no ciclo seguinte) e encerra o passo; o aviso sai só quando a categoria muda, e um ciclo sem
        falha o zera. Recusa definitiva (`RECUSAS_DEFINITIVAS`) marca as seeds como vistas, avisa e segue para o
        próximo plano. Nada daqui muda a fila nem para o ciclo.
        """
        central = self.central or {}
        if not central.get("url") or not central.get("publicacao_token_file"):
            return
        with contextlib.suppress(Exception):
            try:
                url = publicar.url_da_rota(central["url"])
            except retrato.FalhaDeEnvio as exc:
                self._aviso("publicacao:envio", "Publicação: pedido ao Flow falhou (%s)" % exc)
                return
            publicacao = self.dados.get("publicacao")
            vistas = publicacao.get("vistas") if isinstance(publicacao, dict) else None
            vistas = {k: [n for n in v if isinstance(n, str)] for k, v in vistas.items() if isinstance(v, list)} if isinstance(vistas, dict) else {}
            falha = None
            planos = {id_: e for id_, e in _atuais(self.dados["fila"]).items() if not e.get("demanda")}
            lidos = retrato.ler_planos(self.raiz / DIR_PLANOS, planos)
            for id_ in planos:  # linha de base primeiro: a primeira falha abaixo não deixa plano sem ela
                if id_ not in vistas and lidos[id_]["estado"] is not None:
                    vistas[id_] = publicar.seeds_novas([], lidos[id_]["estado"])
            for id_, entrada in planos.items():
                novas = publicar.seeds_novas(vistas[id_], lidos[id_]["estado"]) if id_ in vistas else []
                if not novas:
                    continue
                feature = entrada.get("feature") if isinstance(entrada.get("feature"), str) and entrada.get("feature") else id_
                descricao = retrato._cortar("%s · %s" % (feature, novas[0]), LIMITE_DESCRICAO)
                segura = self._contrato_segura_a_publicacao(entrada.get("repo"))
                if segura is not None:
                    # as seeds não contam como vistas: com a cópia consertada, o pedido sai num ciclo seguinte
                    self._aviso("publicacao:contrato:%s" % id_, "Publicação: %s não foi pedida: %s" % (feature, segura))
                    continue
                self._esquecer("publicacao:contrato:%s" % id_)
                try:
                    self._pedir_publicacao(repo=entrada.get("repo"), descricao=descricao, url=url, token_file=central["publicacao_token_file"])
                except retrato.FalhaDeEnvio as exc:
                    if exc.codigo in RECUSAS_DEFINITIVAS:
                        # resposta determinística (sem projeto, publicação não configurada, pedido inválido):
                        # repetir só gravaria outra recusa no Flow; as seeds contam como vistas e o passo segue
                        self._aviso(
                            "publicacao:recusa",
                            "Publicação: o Flow recusou o pedido de %s (%s); confira a publicação no projeto" % (feature, exc),
                        )
                    else:
                        falha = str(exc)
                except Exception as exc:  # noqa: BLE001 - só a classe, nunca o texto
                    falha = "falha inesperada (%s)" % type(exc).__name__
                if falha is not None:
                    break  # uma falha transitória custa no máximo um timeout por ciclo; os outros planos esperam o próximo
                vistas[id_] = vistas[id_] + novas
                self.dados["publicacao"] = {"vistas": vistas}
                self._salvar()  # já gravado: queda depois do POST não repete o pedido
            self.dados["publicacao"] = {"vistas": vistas}
            if falha is None:
                self._esquecer("publicacao:envio")
            else:
                self._aviso("publicacao:envio", "Publicação: pedido ao Flow falhou (%s)" % falha)
            self._salvar()

    def _contrato_segura_a_publicacao(self, repo):
        """O motivo para não pedir a publicação (a cópia de um contrato externo não bate com a origem, ou a lista
        `contratosExternos` está torta), ou `None`. Falha de leitura sobe e vira a falha transitória do passo."""
        if not isinstance(repo, str):
            return None
        ref = self.forja.branch_padrao(repo)
        bruto = self.forja.arquivo(repo, ref, ".fabrica/config.json")
        try:
            config = json.loads(bruto) if isinstance(bruto, str) else {}
        except ValueError:
            config = {}
        try:
            contratos = contratos_externos.validar(config.get("contratosExternos") if isinstance(config, dict) else None)
        except ValueError as exc:
            return "a lista contratosExternos da .fabrica/config.json está torta (%s)" % exc
        divergencias = contratos_externos.conferir(self.forja, repo, ref, contratos)
        return ("o back-end mudou: " + "; ".join(divergencias)) if divergencias else None

    def _modelos_do_kit(self) -> dict:
        """`modelos` de `<kit>/fabrica/modelos/config.json`; ausente ou torto vale `{}` (cada fase avisa o papel sem modelo)."""
        try:
            config = despachante._ler_json(self.kit / "fabrica" / "modelos" / "config.json")
        except Exception:  # noqa: BLE001
            return {}
        modelos = despachante._dict(config).get("modelos")
        return modelos if isinstance(modelos, dict) else {}

    def _passo_demandas(self) -> None:
        """As demandas do Flow (`demandas.passo`) e depois a caixa de saída (`demandas.esvaziar_saida`). Nunca levanta.

        Só com `FABRICA_CENTRAL_URL` e com o `fila.json` lido neste ciclo. Os avisos vão pelo `_aviso` (repetem só
        quando a mensagem muda); a busca boa esquece o aviso da busca, a rota de volta o do 404 e a saída andando o
        da saída parada. Uma exceção inesperada (do cliente, da busca ou de uma fase) vira o aviso `demandas:passo`
        e o log, e nunca muda a fila nem para o ciclo: a caixa de saída vai mesmo assim.
        """
        central = self.central or {}
        if self._config is None or not central.get("url"):
            return
        with contextlib.suppress(Exception):
            cliente = None
            try:
                cliente = self._cliente_do_flow(central["url"], central.get("token_file"))
                publicacao = None
                if central.get("publicacao_token_file"):
                    with contextlib.suppress(retrato.FalhaDeEnvio):  # URL recusada: o `_passo_publicar` já avisa
                        publicacao = {"url": publicar.url_da_rota(central["url"]), "token_file": central["publicacao_token_file"]}
                eventos = demandas.passo(
                    self.dados,
                    cliente=cliente,
                    motor=self.motor,
                    forja=self.forja,
                    capacidade_path=self.capacidade,
                    projetos={r["repo"].lower(): r["projeto"] for r in self._config["repos"]},
                    modelos=self._modelos_do_kit(),
                    raiz=self.raiz,
                    agora=self._agora(),
                    mem_disponivel_mb=capacidade.mem_disponivel_mb(),
                    salvar=self._salvar,
                    publicacao=publicacao,
                    pedir_publicacao=self._pedir_publicacao,
                    atualizar_branch=self._atualizar_branch_de_demanda,
                )
            except Exception as exc:  # noqa: BLE001 - só a classe no aviso; o texto vai ao log, sem segredo
                self._falha_das_demandas("passo", exc)
                eventos = []
            else:
                self._esquecer("demandas:passo")
                self._esquecer_avisos_das_demandas(eventos)
            if cliente is not None:
                try:
                    eventos = eventos + demandas.esvaziar_saida(self.dados, cliente, self.raiz, salvar=self._salvar)
                except Exception as exc:  # noqa: BLE001
                    self._falha_das_demandas("saida", exc)
                else:
                    self._esquecer("demandas:saida")
                    if demandas.secao(self.dados).get("saidaParada") is None:
                        self._esquecer(demandas.CHAVE_SAIDA_PARADA)
            for evento in eventos:
                if evento.get("evento") == "aviso":
                    self._aviso(evento["chave"], evento["mensagem"])
                elif evento.get("evento") == "erro":
                    self._log_repetivel("demandas:%s" % evento.get("alvo"), evento)
                else:
                    self._log(evento)
            self._salvar()

    def _passo_atendente(self) -> None:
        """O atendente do Decidir (`atendente.passo`), no ciclo e entre os ciclos. Nunca levanta nem muda a fila.

        Só com `FABRICA_CENTRAL_URL` e um `fila.json` já lido (entre ciclos, o do último ciclo). Os avisos vão pelo
        `_aviso`; os de situação (memória, drenagem, modelo, Flow sem a rota, envio que não chega, passo que
        falhou) saem das chaves quando a situação some, e os de episódio (PR aberto, recusa) quando não se repetem:
        um episódio seguinte avisa de novo. Os erros vão ao log pelo `_log_repetivel`; uma exceção inesperada do
        passo (do cliente, da busca, do motor) vira também o aviso `atendente:passo`, que o passo bom esquece.
        """
        central = self.central or {}
        if self._config is None or not central.get("url"):
            return
        with contextlib.suppress(Exception):
            modelos, mem, falhou = {}, None, False
            try:
                modelos = self._modelos_do_kit()
                mem = capacidade.mem_disponivel_mb()
                cliente = self._cliente_das_conversas(central["url"], central.get("token_file"))
                eventos = atendente.passo(
                    self.dados,
                    cliente=cliente,
                    motor=self.motor,
                    capacidade_path=self.capacidade,
                    projetos={r["repo"].lower(): r["projeto"] for r in self._config["repos"]},
                    modelos=modelos,
                    agora=self._agora(),
                    mem_disponivel_mb=mem,
                    salvar=self._salvar,
                )
            except Exception as exc:  # noqa: BLE001 - só a classe no aviso; o texto vai ao log, sem segredo
                self._erro_de_etapa("atendente", "passo", exc)
                self._aviso("atendente:passo", "Atendente: o passo falhou (%s); tento de novo no próximo passo" % type(exc).__name__)
                eventos, falhou = [], True
            for evento in eventos:
                if evento.get("evento") == "aviso":
                    self._aviso(evento["chave"], evento["mensagem"])
                elif evento.get("evento") == "erro":
                    self._log_repetivel("atendente:%s" % evento.get("alvo"), evento)
                else:
                    self._log(evento)
            self._esquecer_avisos_do_atendente({e.get("chave") for e in eventos if e.get("evento") == "aviso"}, modelos, mem, falhou)
            self._salvar()

    def _esquecer_avisos_do_atendente(self, emitidos: set, modelos: dict, mem, falhou: bool = False) -> None:
        sec = atendente.secao(self.dados)
        try:
            cap = capacidade.ler(self.capacidade)
        except Exception:  # noqa: BLE001 - sem a capacidade, os avisos dela ficam
            cap = None
        atual = sec["atual"]
        resolvidos = {
            "atendente:modelo": atendente._modelo(modelos) is not None,
            "atendente:drenagem": cap is not None and not cap.get("drenagem"),
            "atendente:memoria": cap is not None and (mem is None or mem >= (cap.get("ramMinimaMb") or 0)),
            "atendente:sem-rota": sec["semRotaEm"] is None,
            "atendente:envio": atual is None or not atual.get("falhasDeEnvio"),
            "atendente:passo": not falhou,
        }
        for chave in [c for c in self.dados["chaves"] if c.startswith("atendente:") and c not in emitidos]:
            if resolvidos.get(chave, True):  # PR aberto e recusa: avisos de um episódio só
                self._esquecer(chave)

    def _falha_das_demandas(self, etapa: str, exc: BaseException) -> None:
        """`etapa`: `passo` (busca e fases) ou `saida` (a caixa de saída); cada uma com o seu aviso."""
        self._erro_de_etapa("demandas", etapa, exc)
        nome = "o passo" if etapa == "passo" else "o envio da caixa de saída"
        self._aviso("demandas:%s" % etapa, "Demandas: %s falhou (%s); tento de novo no próximo ciclo" % (nome, type(exc).__name__))

    def _esquecer_avisos_das_demandas(self, eventos: list) -> None:
        """Depois de um passo sem exceção: a busca que voltou, a rota que voltou e as demandas que saíram do estado
        levam os avisos delas (a próxima falha do mesmo tipo avisa de novo)."""
        sec = demandas.secao(self.dados)
        if demandas.CHAVE_BUSCA not in {e.get("chave") for e in eventos} and sec.get("buscaRecusadaEm") is None:
            self._esquecer(demandas.CHAVE_BUSCA)
        if sec.get("semRotaEm") is None:
            self._esquecer(demandas.CHAVE_SEM_ROTA)
        for chave in [c for c in self.dados["chaves"] if c.startswith("demandas:")]:
            ultima = chave.rsplit(":", 1)[-1]
            if demandas._UUID.fullmatch(ultima) and ultima not in sec["itens"]:
                self._esquecer(chave)

    def _passo_consertos(self, resposta) -> None:
        """Atende os pedidos de conserto da resposta; sem resposta legível, só acompanha os que estão em andamento."""
        if self._config is None:
            return  # fila.json não foi lido neste ciclo: sem ele, todo repositório pareceria fora da fila
        abertos = consertos.ler_da_resposta(resposta) if isinstance(resposta, dict) else None
        if abertos is None and not consertos.chaves_ocupando(self.dados):
            return
        modelo = consertos.ler_modelo(self.kit)
        eventos = consertos.passo(
            self.dados,
            abertos,
            motor=self.motor,
            capacidade_path=self.capacidade,
            projetos={r["repo"].lower(): r["projeto"] for r in self._config["repos"]},
            modelo=modelo,
            agora=self._agora(),
            mem_disponivel_mb=capacidade.mem_disponivel_mb(),
            salvar=self._salvar,
        )
        if modelo is not None:
            self._esquecer(consertos.CHAVE_AVISO_MODELO)
        for evento in eventos:
            if evento.get("evento") == "aviso":
                self._aviso(evento["chave"], evento["mensagem"])
            elif evento.get("evento") == "erro":
                self._log_repetivel("%s:%s" % (evento["etapa"], evento["alvo"]), evento)
            else:
                self._log(evento)

    def _separar_ids_invalidos(self) -> None:
        validas, self._postas_de_lado = [], []
        for entrada in self.dados["fila"]:
            if isinstance(entrada, dict) and _id_valido(entrada.get("id")):
                validas.append(entrada)
            else:
                self._postas_de_lado.append(entrada)
        self.dados["fila"] = validas
        for entrada in self._postas_de_lado:
            if isinstance(entrada, dict) and "id" in entrada:
                id_ = repr(entrada["id"])[:120]
                self._aviso(
                    "id_invalido:%s" % id_,
                    "entrada da fila com id inválido %s ignorada; corrija ou remova a entrada em fila-estado.json" % id_,
                )

    # ------------------------------------------------------------ 1. Warren

    def _limpar_drenagem_herdada(self) -> None:
        """Ao partir: a drenagem do disco é de um coordenador que morreu; solta antes do primeiro preparo."""
        warren = self.dados["warren"]
        drenagem = despachante._dict(warren.get("drenagem"))
        if drenagem.get("desde"):
            warren["drenagem"] = {"desde": None, "proxima": drenagem.get("proxima")}
            warren["esperasSeguidas"] = 0
            self._log({"evento": "drenagem_warren", "acao": "herdada", "desde": drenagem.get("desde")})
            self._salvar()
        if capacidade.ler(self.capacidade).get("drenagem"):
            capacidade.definir_drenagem(self.capacidade, None)

    def _pronto(self) -> bool:
        preparado = despachante._dict(self.dados["warren"].get("preparado"))
        desligados = despachante._dict(preparado.get("desligados"))
        return (
            preparado.get("estado") in despachante.WARREN_PREPARADO
            and preparado.get("dropin") != "erro"
            and preparado.get("automerge") != "erro"
            and "erro" not in desligados.values()
        )

    def _preparar_agora(self) -> bool:
        if self.preparar_warren is None:
            return False
        if self._ultimo_preparo is None or not self._pronto():
            return True
        return self._ciclos - self._ultimo_preparo >= despachante.CICLOS_PREPARAR_WARREN

    def _passo_preparar(self, eventos: list) -> None:
        if self._preparar_agora():
            self._ultimo_preparo = self._ciclos
            try:
                self._preparar(eventos)
            except Exception as exc:  # noqa: BLE001 - tenta de novo no próximo ciclo
                self._erro_de_etapa("preparar_warren", "warren", exc)
        try:
            self._sincronizar_drenagem()
        except Exception as exc:  # noqa: BLE001
            self._erro_de_etapa("drenagem", "capacidade", exc)

    def _preparar(self, eventos: list) -> None:
        try:
            resultado = self.preparar_warren(sha_revertido=self._sha_revertido)
        except Exception as exc:  # noqa: BLE001 - o preparar não lança, mas o laço não cai por ele
            resultado = {"estado": "erro", "detalhe": self._erro(exc)}
        if not isinstance(resultado, dict) or resultado.get("estado") not in despachante.ESTADOS_DO_PREPARAR:
            resultado = {"estado": "erro", "detalhe": "resultado inválido do preparar_warren"}
        estado = resultado["estado"]
        registro = {"estado": estado, "detalhe": self._seguro(resultado.get("detalhe") or "")}
        for chave in ("dropin", "automerge"):
            if despachante._texto(resultado.get(chave)):
                registro[chave] = self._seguro(resultado[chave], 40)
        desligados = resultado.get("desligados")
        if isinstance(desligados, dict):
            registro["desligados"] = {self._seguro(k, 80): self._seguro(v, 40) for k, v in desligados.items()}
        if estado == "revertido":
            if despachante._texto(resultado.get("sha")):
                self._sha_revertido = resultado["sha"]
        else:
            self._sha_revertido = None
        warren = self.dados["warren"]
        seguidas = (warren.get("esperasSeguidas") if despachante._inteiro(warren.get("esperasSeguidas")) else 0) + 1 if estado == "aguardando_runs" else 0
        carregado = warren.get("dropinCarregado") is True
        if estado in despachante.ESTADOS_COM_DROPIN_CARREGADO and registro.get("dropin") in ("ok", "alterado"):
            carregado = True
        elif registro.get("dropin") == "erro":
            carregado = False
        warren.update(preparado=dict(registro, em=self._agora_texto()), esperasSeguidas=seguidas, dropinCarregado=carregado)
        self._log(dict({"evento": "preparar_warren"}, **registro))
        eventos.append(dict({"evento": "preparar_warren"}, **registro))
        self._atualizar_drenagem(estado, seguidas)
        self._avisos_do_preparo(estado, registro)

    def _avisos_do_preparo(self, estado: str, registro: dict) -> None:
        if estado in despachante.ESTADOS_SEM_MODELO:
            self._aviso("warren:modelo", "%s (%s: %s)" % (despachante.AVISO_WARREN_SEM_MODELO, estado, registro["detalhe"]), assinatura=estado)
        elif estado in despachante.WARREN_PREPARADO:
            self._esquecer("warren:modelo")
        for servico, resultado in sorted(despachante._dict(registro.get("desligados")).items()):
            chave = "warren:desligar:%s" % servico
            if resultado == "erro":
                self._aviso(
                    chave,
                    "não foi possível desligar o %s; o coordenador tenta de novo a cada ciclo "
                    "(confira o sudo -n ou rode `sudo systemctl disable --now %s`)" % (servico, servico),
                )
            else:
                self._esquecer(chave)
        if registro.get("dropin") == "erro":
            self._aviso("warren:dropin", despachante.AVISO_DROPIN.replace("20 ciclos", "ciclo"))
        else:
            self._esquecer("warren:dropin")

    def _atualizar_drenagem(self, estado: str, seguidas: int) -> None:
        """Como o despachante: 2 esperas seguidas ligam; teto de 45 min (25 sem o drop-in carregado); 6 h até a próxima."""
        agora = self._agora().astimezone(datetime.timezone.utc)
        warren = self.dados["warren"]
        teto = despachante.DRENAGEM_MAXIMA if warren.get("dropinCarregado") is True else despachante.DRENAGEM_MAXIMA_SEM_DROPIN
        drenagem = despachante._dict(warren.get("drenagem"))
        desde = _instante(drenagem.get("desde"))
        proxima = _instante(drenagem.get("proxima"))
        if estado != "aguardando_runs":
            if desde is not None:
                warren["drenagem"] = {"desde": None, "proxima": drenagem.get("proxima")}
                self._log({"evento": "drenagem_warren", "acao": "fim", "estado": estado})
            return
        if desde is not None:
            if agora - desde >= teto:
                volta = (agora + despachante.PAUSA_ENTRE_DRENAGENS).strftime(FORMATO_INSTANTE)
                warren["drenagem"] = {"desde": None, "proxima": volta}
                self._log({"evento": "drenagem_warren", "acao": "teto", "desde": drenagem.get("desde")})
                self._aviso(
                    "warren:drenagem:%s" % drenagem.get("desde"),
                    "drenagem do Warren para o restart do preparo expirou depois de %d min com runs ativos (desde %s); "
                    "despachos retomados, nova drenagem a partir de %s" % (teto.total_seconds() // 60, drenagem.get("desde"), volta),
                )
            return
        if seguidas >= despachante.ESPERAS_PARA_DRENAR and (proxima is None or agora >= proxima):
            warren["drenagem"] = {"desde": agora.strftime(FORMATO_INSTANTE), "proxima": None}
            self._log({"evento": "drenagem_warren", "acao": "inicio"})

    def _sincronizar_drenagem(self) -> None:
        """O `capacidade.json` mostra aos despachantes de plano a drenagem que o coordenador decidiu."""
        desejada = None
        if self.preparar_warren is not None:
            desejada = despachante._dict(self.dados["warren"].get("drenagem")).get("desde") or None
        if capacidade.ler(self.capacidade).get("drenagem") != desejada:
            capacidade.definir_drenagem(self.capacidade, desejada)

    # ------------------------------------------------------------ 2. descobrir

    def _analisar(self, caminho: str, texto: str):
        """`(plano, erros)` de um arquivo de plano do branch padrão."""
        if fila.feature_do_caminho(caminho) is None:
            return None, [
                "nome de arquivo inválido: use .fabrica/planos/<feature>.json, feature de até 41 caracteres, a-z e 0-9 "
                "em partes separadas por um só - (nunca plano)"
            ]
        try:
            plano = despachante._json_estrito(texto)
        except (ValueError, RecursionError):
            return None, ["não é JSON válido"]
        erros = raias.validar_plano(plano)
        if not erros and not fila.arquivos_do_plano(plano):
            erros = ["nenhuma raia declara arquivos"]
        return plano, erros

    def _passo_descobrir(self, config: dict):
        descobertos, falhos = [], set()
        for item in config["repos"]:
            repo = item["repo"]
            try:
                achados, invalidos = self._descobrir_repo(repo)
            except Exception as exc:  # noqa: BLE001 - quem aguarda neste repositório não é removido
                falhos.add(repo.lower())
                self._erro_de_etapa("descobrir", repo, exc)
                continue
            descobertos.extend(achados)
            prefixo = "invalido:%s:" % repo.lower()
            for chave in [c for c in self.dados["chaves"] if c.startswith(prefixo) and c not in invalidos]:
                self._esquecer(chave)
        return descobertos, falhos

    def _descobrir_repo(self, repo: str):
        ref = self.forja.branch_padrao(repo)
        caminhos = [c for c in (self.forja.listar(repo, ref, DIR_PLANOS_NO_REPO) or []) if c.endswith(".json")]
        caminhos.append(CAMINHO_LEGADO)
        achados, invalidos = [], set()
        for caminho in caminhos:
            texto = self.forja.arquivo(repo, ref, caminho)
            if texto is None:
                continue
            plano, erros = self._analisar(caminho, texto)
            if erros:
                chave = "invalido:%s:%s" % (repo.lower(), caminho)
                invalidos.add(chave)
                self._aviso(
                    chave,
                    "plano inválido em %s:%s (%s), fora da fila: %s" % (repo, caminho, ref, "; ".join(erros[:3])),
                    assinatura=hashlib.sha256(texto.encode("utf-8")).hexdigest(),
                )
                continue
            achados.append({"repo": repo, "caminho": caminho, "plano": plano})
        return achados, invalidos

    # ------------------------------------------------------------ 3. fila e admissão

    def _passo_fila(self, config: dict, descobertos: list, falhos: set, eventos: list) -> None:
        anterior = self.dados["fila"]
        nova = fila.enfileirar(anterior, descobertos, self._agora_texto())
        for i, entrada in enumerate(anterior):
            # quem estava num repositório que não deu para listar fica como estava (não vira `removido`)
            if isinstance(entrada, dict) and isinstance(entrada.get("repo"), str) and entrada["repo"].lower() in falhos:
                nova[i] = copy.deepcopy(entrada)
        for entrada in nova[len(anterior) :]:
            eventos.append({"evento": "enfileirado", "id": entrada["id"]})
            self._log({"evento": "enfileirado", "id": entrada["id"], "caminho": entrada["caminho"]})
        for i, entrada in enumerate(anterior):
            if isinstance(entrada, dict) and entrada.get("estado") == "aguardando" and nova[i].get("estado") == "removido":
                self._log({"evento": "removido", "id": entrada.get("id")})
        # o plano de uma demanda espera a etapa `desenvolvida` (antes do `admitir`, no mesmo ciclo da descoberta)
        segurados_antes = {e.get("id") for e in nova if isinstance(e, dict) and e.get("seguradoPor") == "demanda"}
        nova = demandas.aplicar_na_fila(self.dados.get("demandas") or {}, nova)
        for entrada in nova:
            if isinstance(entrada, dict) and entrada.get("estado") == "aguardando":
                pela_demanda = entrada.get("seguradoPor") == "demanda"
                if pela_demanda != (entrada.get("id") in segurados_antes):
                    evento = "segurado_pela_demanda" if pela_demanda else "solto_pela_demanda"
                    self._log({"evento": evento, "id": entrada.get("id"), "demanda": entrada.get("demanda")})
        self.dados["fila"] = nova
        self._salvar()
        for id_ in fila.admitir(self.dados["fila"]):
            if id_ in self._removendo:
                continue
            self._tentar_admitir(_atuais(self.dados["fila"])[id_], eventos)

    def _tentar_admitir(self, entrada: dict, eventos: list) -> bool:
        """Admite e marca `ativo`; uma falha vira aviso e fica para o próximo ciclo (`aguardando` ou `admitindo`)."""
        id_ = entrada["id"]
        self._tentados.add(id_)
        try:
            projeto = {r["repo"].lower(): r["projeto"] for r in self._config["repos"]}.get(entrada["repo"].lower())
            if projeto is None:
                raise RuntimeError("repositório %s não está mais em fila.json" % entrada["repo"])
            self._admitir(entrada, projeto)
        except Exception as exc:  # noqa: BLE001 - o próximo ciclo tenta de novo
            self._aviso("admitir:%s" % id_, "não foi possível admitir %s, tento de novo no próximo ciclo: %s" % (id_, self._erro(exc)))
            return False
        self._esquecer("admitir:%s" % id_)
        self._marcar(id_, "ativo")
        self._log({"evento": "admitido", "id": id_})
        eventos.append({"evento": "admitido", "id": id_})
        return True

    def _pasta(self, id_: str) -> pathlib.Path:
        return self.raiz / DIR_PLANOS / id_

    def _atualizar_branch_de_demanda(self, repo: str, branch: str, padrao: str, *, atualizar=None):
        """O `atualizar_branch` das demandas: traz `padrao` para `branch` pelo clone de um plano do mesmo repositório
        (`atualizar_branch.atualizar`). Sem clone, `None`."""
        import atualizar_branch

        for entrada in self.dados.get("fila") or []:
            if not isinstance(entrada, dict) or str(entrada.get("repo", "")).lower() != str(repo).lower():
                continue
            repo_dir = self._pasta(str(entrada.get("id"))) / "repo"
            if (repo_dir / ".git").exists():
                return (atualizar or atualizar_branch.atualizar)(repo_dir, branch, padrao)
        return None

    def _unit(self, id_: str) -> str:
        return "fabrica-plano@%s" % id_

    def _ambiente_do_plano(self, entrada: dict, projeto: str) -> dict:
        pasta = self._pasta(entrada["id"])
        variaveis = {
            "FABRICA_RAIZ": str(pasta),
            "FABRICA_REPO_DIR": str(pasta / "repo"),
            "FABRICA_PROJETO": projeto,
            "FABRICA_REPO": entrada["repo"],
            "FABRICA_PLANO": entrada["caminho"],
            "FABRICA_CAPACIDADE": str(self.capacidade),
            "FABRICA_PLANO_ID": entrada["id"],
            "FABRICA_PREPARAR_WARREN": "0",
        }
        variaveis.update(self.ambiente)
        for nome, valor in variaveis.items():
            if not valor or any(c in valor for c in "\n\r\0"):
                raise RuntimeError("valor inválido para %s no plano.env" % nome)
        return variaveis

    def _admitir(self, entrada: dict, projeto: str) -> None:
        """Pasta, clone, `plano.env`, `iniciar` (só sem estado.json) e `enable --now`. Cada passo é idempotente."""
        id_ = entrada["id"]
        pasta = self._pasta(id_)
        pasta.mkdir(parents=True, exist_ok=True)
        repo_dir = pasta / "repo"
        if not (repo_dir / ".git").exists():
            if repo_dir.exists():
                raise RuntimeError("%s existe sem .git: apague a pasta para clonar de novo" % repo_dir)
            self.clonar(entrada["repo"], repo_dir)
            if not (repo_dir / ".git").exists():
                raise RuntimeError("o clone de %s não criou %s" % (entrada["repo"], repo_dir / ".git"))
        variaveis = self._ambiente_do_plano(entrada, projeto)
        texto = "# gerado pelo coordenador da fila: só caminhos e nomes, nunca um token\n"
        texto += "".join("%s=%s\n" % (k, v) for k, v in variaveis.items())
        _gravar_texto_atomico(pasta / "plano.env", texto)
        if not (pasta / despachante.ARQ_ESTADO).exists():
            argv = [sys.executable, "-I", str(self.kit / "fabrica" / "scripts" / "despachante.py"), "iniciar"]
            codigo, saida = self.executar(argv, dict(variaveis))
            if codigo != 0:
                raise RuntimeError("despachante.py iniciar saiu com %s: %s" % (codigo, self._seguro(saida, LIMITE_SAIDA)))
            if not (pasta / despachante.ARQ_ESTADO).exists():
                raise RuntimeError("despachante.py iniciar não criou o estado.json")
            self._log({"evento": "iniciar", "id": id_})
        # gravado antes do enable: um coordenador que morra daqui em diante acha a unit pela entrada `admitindo`
        self._marcar(id_, "admitindo")
        codigo, saida = self.systemd("enable", "--now", self._unit(id_))
        if codigo != 0:
            raise RuntimeError("systemctl --user enable --now %s saiu com %s: %s" % (self._unit(id_), codigo, self._seguro(saida, LIMITE_SAIDA)))

    # ------------------------------------------------------------ 4. ativos

    def _ler_do_plano(self, id_: str, nome: str):
        dados = despachante._ler_json(self._pasta(id_) / nome)
        return dados if isinstance(dados, dict) else None

    def _passo_observar(self, eventos: list):
        """Devolve `(ids com unit rodando, se o systemd respondeu por todos)`."""
        rodando, confiavel = set(), True
        for id_, entrada in sorted(_atuais(self.dados["fila"]).items()):
            if entrada["estado"] not in fila.OCUPANDO or id_ in self._removendo:
                continue  # remoção em curso: a unit já foi desligada de propósito
            try:
                if not self._observar(id_, entrada, rodando, eventos):
                    confiavel = False
            except Exception as exc:  # noqa: BLE001 - um plano não derruba os outros
                confiavel = False
                self._erro_de_etapa("observar", id_, exc)
        return rodando, confiavel

    def _marcar(self, id_: str, estado: str) -> None:
        if _atuais(self.dados["fila"])[id_]["estado"] != estado:
            self.dados["fila"] = fila.marcar(self.dados["fila"], id_, estado)
            self._salvar()
            self._log({"evento": "estado", "id": id_, "estado": estado})

    def _observar(self, id_: str, entrada: dict, rodando: set, eventos: list) -> bool:
        unit = self._unit(id_)
        estado_do_plano, plano = None, None
        try:
            estado_do_plano = self._ler_do_plano(id_, despachante.ARQ_ESTADO)
            plano = self._ler_do_plano(id_, despachante.ARQ_PLANO)
        except (OSError, ValueError) as exc:
            self._erro_de_etapa("ler_estado_do_plano", id_, exc)
        codigo, saida = self.systemd("is-active", unit)
        situacao = (saida or "").strip().split("\n")[0].strip()
        # o plano.json adotado precisa ser o da entrada: um PR mergeado pode ter trazido fases novas ao main
        if est.plano_concluido(estado_do_plano, plano) and fila.hash_do_plano(plano) == entrada.get("hash"):
            causa = self._causa(unit) if situacao == "failed" else None
            codigo, saida = self.systemd("disable", "--now", unit)
            if codigo != 0:
                raise RuntimeError("systemctl --user disable --now %s saiu com %s: %s" % (unit, codigo, self._seguro(saida, LIMITE_SAIDA)))
            self._marcar(id_, "concluido")
            capacidade.sincronizar(self.capacidade, id_, set())
            capacidade.soltar_orquestrador(self.capacidade, entrada["repo"], id_)
            for chave in ("unit:%s" % id_, "pausa:%s" % id_):
                self._esquecer(chave)
            if causa is not None:
                self._aviso("concluido:%s" % id_, "plano %s concluído; a unit estava failed: %s" % (id_, causa))
            eventos.append({"evento": "concluido", "id": id_})
            return True
        if entrada["estado"] == "admitindo" and situacao == "inactive":
            if id_ not in self._tentados:
                self._tentar_admitir(entrada, eventos)  # a unit não subiu: refaz a admissão (idempotente)
            return True
        if situacao == "active":
            rodando.add(id_)
            self._esquecer("unit:%s" % id_)
            pausa = despachante._dict(estado_do_plano).get("pausado")
            if pausa:
                self._aviso("pausa:%s" % id_, "%s pausado pela fábrica: %s (feche a issue de pausa para retomar)" % (id_, pausa))
                self._marcar(id_, "pausado")
            else:
                self._esquecer("pausa:%s" % id_)
                self._marcar(id_, "ativo")
            return True
        if situacao in UNITS_RODANDO:
            rodando.add(id_)  # reiniciando: o despachante refaz o sincronizar quando voltar
            return True
        if situacao == "failed":
            causa = self._causa(unit)
            self._aviso(
                "unit:%s" % id_,
                "%s pausado: o serviço %s falhou (journalctl --user -u %s): %s" % (id_, unit, unit, causa),
                assinatura="failed",
            )
            self._marcar(id_, "pausado")
            return True
        if situacao == "inactive":
            self._aviso(
                "unit:%s" % id_,
                "%s pausado: o serviço %s está parado; para retomar, rode systemctl --user start %s" % (id_, unit, unit),
                assinatura="inactive",
            )
            self._marcar(id_, "pausado")
            return True
        self._erro_de_etapa("is_active", id_, RuntimeError("estado desconhecido da unit: %r" % situacao))
        return False

    def _causa(self, unit: str) -> str:
        _, detalhe = self.systemd("status", "--no-pager", "--lines=20", unit)
        return " | ".join(linha.strip() for linha in (detalhe or "").strip().splitlines()[-5:]) or "sem detalhe"

    # ------------------------------------------------------------ 5. órfãos

    def _passo_orfaos(self, rodando: set, confiavel: bool, eventos: list) -> None:
        if not confiavel:
            return  # sem a resposta do systemd para todos, nada é solto
        atuais = _atuais(self.dados["fila"])
        ocupando = {i for i, e in atuais.items() if e["estado"] in fila.OCUPANDO}
        # `admitindo` fica como está: a unit pode estar subindo (ou ter subido antes de o coordenador morrer)
        for id_ in sorted(i for i in ocupando - set(rodando) if atuais[i]["estado"] != "admitindo"):
            try:
                self._refazer_ocupacao(id_, atuais[id_])
            except Exception as exc:  # noqa: BLE001 - um plano não derruba os outros
                self._erro_de_etapa("refazer_ocupacao", id_, exc)
        try:
            # só quem não está ocupando (concluído, removido, desconhecido) perde reservas, trava e espera; um
            # conserto em andamento segura a vaga dele (`conserto:<id>`) como um plano, e uma demanda (`demanda:<id>`)
            # segura a trava do plano e a vaga do desenho, do teste e da correção (mesmo com o passo de demandas
            # desligado ou falhando neste ciclo: as chaves vêm do `fila-estado.json`) até o teto da fase + 30 min;
            # depois disso, sem o passo das demandas para soltá-las, saem aqui com um aviso
            agora = self._agora()
            ativos = ocupando | consertos.chaves_ocupando(self.dados)
            ativos |= demandas.chaves_do_orquestrador(self.dados, agora) | demandas.chaves_ocupando(self.dados, agora)
            vencidas = demandas.chaves_vencidas(self.dados, agora)
            removidos = capacidade.limpar_orfaos(self.capacidade, ativos)
        except Exception as exc:  # noqa: BLE001
            self._erro_de_etapa("limpar_orfaos", "capacidade", exc)
            return
        for demanda, fase, inicio in vencidas:
            if demandas.chave(demanda) in removidos:
                self._aviso(
                    "demandas:vencida:%s:%s" % (fase, demanda),
                    "Demandas: a demanda %s (%s desde %s) passou do teto da fase sem o passo das demandas a acompanhar; "
                    "a trava e a vaga dela foram soltas" % (demanda[:8], fase, inicio),
                )
        if removidos:
            self._log({"evento": "orfaos", "planos": removidos})
            eventos.append({"evento": "orfaos", "planos": removidos})


    def _refazer_ocupacao(self, id_: str, entrada: dict) -> None:
        """Plano ocupando sem unit rodando: o que ele segura vem do `estado.json`, como no despachante.

        Os Plan Runs e o PR do orquestrador continuam vivos no Warren e no GitHub com a unit parada, então
        as vagas são refeitas (raias `executando`, despacho em curso e incertos) e a trava fica enquanto há
        orquestrador em curso. Feito sob a trava do despachante: com ela ocupada, um despachante vivo cuida
        disso. `estado.json` ausente ou ilegível: nada muda (avisa uma vez).
        """
        pasta = self._pasta(id_)
        try:
            with despachante.travar(pasta):
                try:
                    estado = despachante._ler_json(pasta / despachante.ARQ_ESTADO)
                except (OSError, ValueError, UnicodeDecodeError, RecursionError):
                    estado = None
                if not isinstance(estado, dict):
                    self._aviso(
                        "ocupacao:%s" % id_,
                        "%s parado com estado.json ausente ou ilegível: as vagas e a trava dele ficam como estão "
                        "até a unit voltar (corrija o estado.json ou remova o plano)" % id_,
                        assinatura="ilegivel",
                    )
                    return
                self._esquecer("ocupacao:%s" % id_)
                capacidade.sincronizar(self.capacidade, id_, est.raias_ocupadas(estado))
                repo = entrada["repo"]
                if not est.orquestrador_em_curso(estado):
                    capacidade.soltar_orquestrador(self.capacidade, repo, id_)
                    capacidade.desistir_orquestrador(self.capacidade, repo, id_)
                elif not capacidade.tomar_orquestrador(self.capacidade, repo, id_, em_curso=True):
                    dono = capacidade.ler(self.capacidade)["orquestrador"].get(repo.lower())
                    self._log_repetivel("trava_em_conflito:%s" % id_, {"evento": "trava_em_conflito", "id": id_, "dono": dono})
        except despachante.OutroDespachante:
            return


# ---------------------------------------------------------------- status


def _segurado(entrada: dict) -> str:
    if not entrada.get("segurado"):
        return ""
    if entrada.get("seguradoPor") == "demanda":
        return " (segurado pela demanda %s)" % str(entrada.get("demanda"))[:8]
    return " (segurado)"


def _linha_das_demandas(dados: dict, central) -> str:
    if not central:
        return "demandas: desligado"
    sec = dados.get("demandas") if isinstance(dados.get("demandas"), dict) else {}
    if sec.get("semRotaEm"):
        return "demandas: Flow sem a rota (tenta de novo 1 h depois de %s)" % sec["semRotaEm"]
    itens = [it for it in (sec.get("itens") if isinstance(sec.get("itens"), dict) else {}).values() if isinstance(it, dict)]

    def esperando(it):
        retrato_ = demandas._retrato_atual(it)
        return it.get("fase") == "esperando_paulo" or isinstance(retrato_.get("espera"), dict)

    return "demandas: %d em curso (%d esperando o Paulo), cursor %s" % (len(itens), sum(1 for it in itens if esperando(it)), sec.get("cursor"))


def _linha_do_atendente(dados: dict, central) -> str:
    if not central:
        return "atendente: desligado"
    sec = dados.get("atendente") if isinstance(dados.get("atendente"), dict) else {}
    if isinstance(sec.get("semRotaEm"), str) and sec["semRotaEm"]:
        return "atendente: Flow sem o Decidir (tenta de novo 1 h depois de %s)" % sec["semRotaEm"]
    atual = atendente._atual_valido(sec.get("atual"))
    if atual is None:
        return "atendente: ocioso"
    return "atendente: conversa %s, %s (tentativa %s)" % (atual["conversaId"][:8], atual["fase"], atendente._contagem(atual.get("tentativa")))


def status(raiz, central=None) -> str:
    raiz = pathlib.Path(raiz)
    linhas = []
    try:
        dados = ler_estado(raiz)
    except ErroDeEntrada as exc:
        dados = _padrao_do_estado()
        linhas.append(exc.erros[0])
    atuais = sorted(_atuais(dados["fila"]).values(), key=lambda e: (str(e.get("entrouEm")), e["id"]))
    if atuais:
        linhas.append("fila:")
        linhas.extend("  %s: %s%s (entrou em %s)" % (e["id"], e["estado"], _segurado(e), e.get("entrouEm")) for e in atuais)
    else:
        linhas.append("fila vazia")
    try:
        cap = capacidade.ler(raiz / ARQ_CAPACIDADE)
    except capacidade.CapacidadeInvalida as exc:
        linhas.append("capacidade: %s" % exc)
    else:
        oom = ", OOM em %s" % cap["oomEm"] if cap["oomEm"] else ""
        linhas.append(
            "vagas efetivas: %d (configuradas %d, RAM mínima %d MB%s)" % (capacidade.vagas_efetivas(cap), cap["vagasConfig"], cap["ramMinimaMb"], oom)
        )
        linhas.append("reservas:" if cap["reservas"] else "reservas: nenhuma")
        linhas.extend("  %s: %s" % (plano, ", ".join(r)) for plano, r in sorted(cap["reservas"].items()))
        linhas.append("travas de orquestrador:" if cap["orquestrador"] else "travas de orquestrador: nenhuma")
        linhas.extend("  %s: %s" % (repo, plano) for repo, plano in sorted(cap["orquestrador"].items()))
        linhas.append("drenagem do Warren: %s" % ("desde %s" % cap["drenagem"] if cap["drenagem"] else "não"))
    preparado = despachante._dict(dados["warren"].get("preparado"))
    if preparado:
        linhas.append("preparo do Warren: %s em %s" % (preparado.get("estado"), preparado.get("em")))
    if central:
        linhas.append("envio à Central: ligado")
        ultimo = despachante._dict(dados.get("central"))
        if ultimo:
            linhas.append("último envio à Central: %s %s" % (ultimo.get("em"), ultimo.get("resultado")))
    else:
        linhas.append("envio à Central: desligado (defina %s e %s em coordenador.env)" % (VARIAVEL_CENTRAL_URL, VARIAVEL_CENTRAL_TOKEN))
    linhas.append(_linha_das_demandas(dados, central))
    linhas.append(_linha_do_atendente(dados, central))
    avisos = [a for a in dados["avisos"] if isinstance(a, dict)][-AVISOS_NO_STATUS:]
    linhas.append("avisos:" if avisos else "avisos: nenhum")
    linhas.extend("  - [%s] %s" % (a.get("em"), a.get("mensagem")) for a in avisos)
    return "\n".join(linhas)


# ---------------------------------------------------------------- efeitos reais


def _systemd(*args):
    resultado = subprocess.run(["systemctl", "--user", *args], capture_output=True, text=True, timeout=120)
    return resultado.returncode, (resultado.stdout or "") + (resultado.stderr or "")


def _executar(argv, env):
    resultado = subprocess.run(argv, env={**os.environ, **env}, capture_output=True, text=True, timeout=900)
    return resultado.returncode, (resultado.stdout or "") + (resultado.stderr or "")


HOST_DO_HELPER = "https://github.com"


def helper_de_credencial(token_file: str) -> str:
    """O `credential.helper` que lê o token do arquivo na hora: só o caminho (absoluto) fica no `.git/config`."""
    caminho = os.path.abspath(os.path.expanduser(str(token_file)))
    if any(c in caminho for c in "'\n\r\0"):
        raise ErroDeEntrada(["o caminho do GH_TOKEN_FILE não pode ter aspa simples nem quebra de linha: %r" % caminho])
    return (
        "!f() { test \"$1\" = get || exit 0; echo username=x-access-token; "
        "printf 'password=%%s\\n' \"$(cat '%s')\"; }; f" % caminho
    )


def _clonar(repo, destino, *, token_file, base="https://github.com/", rodar=subprocess.run):
    """Clona num temporário ao lado e troca de nome no fim: `repo/` nunca fica pela metade.

    Autentica pelo helper local em `credential.https://github.com.helper` (só o GitHub recebe o token; o
    `credential.helper` vazio antes zera os helpers globais), passado ao próprio clone com `-c` e regravado no
    `.git/config` depois: nenhum token em argv, ambiente ou URL.
    """
    helper = helper_de_credencial(token_file)
    destino = pathlib.Path(destino)
    tmp = destino.with_name(".repo.clonando")
    shutil.rmtree(tmp, ignore_errors=True)
    url = "%s%s.git" % (base, repo)
    chave = "credential.%s.helper" % HOST_DO_HELPER
    comandos = [
        ["git", "clone", "--quiet", "-c", "credential.helper=", "-c", "%s=%s" % (chave, helper), url, str(tmp)],
        ["git", "-C", str(tmp), "config", "--local", "--unset-all", "credential.helper"],
        ["git", "-C", str(tmp), "config", "--local", "--add", "credential.helper", ""],
        ["git", "-C", str(tmp), "config", "--local", "--unset-all", chave],
        ["git", "-C", str(tmp), "config", "--local", "--add", chave, helper],
    ]
    for posicao, argv in enumerate(comandos):
        resultado = rodar(argv, capture_output=True, text=True, timeout=1800)
        # `--unset-all` sem nada para tirar sai com 5
        if resultado.returncode != 0 and not (posicao in (1, 3) and resultado.returncode == 5):
            shutil.rmtree(tmp, ignore_errors=True)
            raise RuntimeError(
                "git %s saiu com %d: %s" % (argv[1] if posicao == 0 else "config", resultado.returncode, despachante._cortar(resultado.stderr or "", LIMITE_SAIDA))
            )
    os.replace(tmp, destino)


def construir(ambiente, raiz) -> Coordenador:
    """O coordenador real: Warren e GitHub com os tokens lidos dos arquivos do ambiente."""
    import forja as forja_github
    import motor_warren
    import preparar_warren

    token_warren = despachante._ler_token(ambiente.get("WARREN_TOKEN_FILE") or despachante.WARREN_TOKEN_PADRAO)
    caminho_gh = os.path.abspath(os.path.expanduser(ambiente.get("GH_TOKEN_FILE") or despachante.GH_TOKEN_PADRAO))
    token_gh = despachante._ler_token(caminho_gh)
    helper_de_credencial(caminho_gh)  # aspa simples no caminho: saída 2 já na partida
    try:
        motor = motor_warren.MotorWarren(ambiente.get("WARREN_API") or despachante.WARREN_API_PADRAO, token_warren)
        forja = forja_github.ForjaGitHub(token_gh)
    except ValueError as exc:
        raise ErroDeEntrada(["token inválido (%s)" % type(exc).__name__]) from None
    return Coordenador(
        raiz=raiz,
        forja=forja,
        motor=motor,
        systemd=_systemd,
        executar=_executar,
        preparar_warren=functools.partial(preparar_warren.preparar, visao_geral=motor.visao_geral, versao=motor.versao),
        kit=KIT_PADRAO,
        clonar=functools.partial(_clonar, token_file=caminho_gh),
        ambiente=ambiente,
        segredos=(token_warren, token_gh),
        central=configuracao_central(ambiente, raiz),
    )


# ---------------------------------------------------------------- CLI


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="coordenador.py", description="Coordenador da fila por plano da fábrica de agentes")
    parser.add_argument("--raiz", default=RAIZ_PADRAO, help="pasta da fila (padrão ~/fabrica)")
    sub = parser.add_subparsers(dest="comando", required=True)
    rodar = sub.add_parser("rodar", help="repete o ciclo a cada 60 s")
    rodar.add_argument("--intervalo", type=int, default=INTERVALO_PADRAO, help="segundos entre ciclos (padrão 60)")
    rodar.add_argument("--ciclos", type=int, default=None, help=argparse.SUPPRESS)
    sub.add_parser("status", help="fila, vagas, reservas, travas e avisos")
    registrar = sub.add_parser("registrar", help="registra um repositório (dono/repo) na fila")
    registrar.add_argument("repo")
    for nome, ajuda in (("segurar", "segura um plano aguardando (não é admitido até soltar)"), ("soltar", "solta um plano segurado")):
        sub.add_parser(nome, help=ajuda).add_argument("id")
    remover = sub.add_parser("remover", help="tira um plano aguardando, ativo ou pausado da fila (aplicado no próximo ciclo)")
    remover.add_argument("id")
    remover.add_argument("--manter-arquivo", action="store_true", help="o arquivo do plano fica no branch padrão sem reentrar")
    remover.add_argument("--simular", action="store_true", help="só mostra as etapas, sem gravar nada")
    vagas = sub.add_parser("vagas", help="define as vagas (e limpa o OOM)")
    vagas.add_argument("n", type=int)
    vagas.add_argument("--ram-minima-mb", type=int, default=None)
    return parser


def _vagas(raiz: pathlib.Path, n: int, ram_minima_mb) -> str:
    if n < 1:
        raise ErroDeEntrada(["vagas deve ser pelo menos 1"])
    if ram_minima_mb is None:
        try:
            ram_minima_mb = capacidade.ler(raiz / ARQ_CAPACIDADE)["ramMinimaMb"]
        except capacidade.CapacidadeInvalida:
            ram_minima_mb = capacidade.RAM_MINIMA_PADRAO_MB
    if ram_minima_mb < 0:
        raise ErroDeEntrada(["--ram-minima-mb não pode ser negativo"])
    capacidade.configurar(raiz / ARQ_CAPACIDADE, vagas=n, ram_minima_mb=ram_minima_mb)
    return "vagas: %d, RAM mínima: %d MB (OOM limpo)" % (n, ram_minima_mb)


def _soltar_drenagem(raiz: pathlib.Path) -> None:
    """Antes de sair com 2: sem coordenador, ninguém soltaria a drenagem dos despachantes."""
    with contextlib.suppress(Exception):
        if capacidade.ler(raiz / ARQ_CAPACIDADE).get("drenagem"):
            capacidade.definir_drenagem(raiz / ARQ_CAPACIDADE, None)


def main(argv=None, *, ambiente=None, construir=None, saida=None, erro=None, dormir=time.sleep) -> int:
    ambiente = os.environ if ambiente is None else ambiente
    saida = saida or sys.stdout
    erro = erro or sys.stderr
    construir = construir or globals()["construir"]
    args = _parser().parse_args(argv)
    raiz = pathlib.Path(args.raiz).expanduser()
    try:
        if args.comando in ("registrar", "status", "vagas", *COMANDOS_DA_CAIXA):
            # a CLI roda na shell, sem o EnvironmentFile da unit: lê o mesmo coordenador.env
            ambiente = _com_coordenador_env(ambiente, raiz)
        if args.comando == "status":
            print(status(raiz, configuracao_central(ambiente, raiz)), file=saida)
            return 0
        if args.comando == "vagas":
            print(_vagas(raiz, args.n, args.ram_minima_mb), file=saida)
            return 0
        if args.comando == "remover":
            print(construir(ambiente, raiz).pedir("remover", args.id, manter_arquivo=args.manter_arquivo, simular=args.simular), file=saida)
            return 0
        if args.comando in COMANDOS_DA_CAIXA:
            print(construir(ambiente, raiz).pedir(args.comando, args.id), file=saida)
            return 0
        if args.comando == "registrar":
            print(construir(ambiente, raiz).registrar(args.repo), file=saida)
            return 0
        if args.intervalo < 1:
            raise ErroDeEntrada(["--intervalo deve ser pelo menos 1"])
        try:
            with travar(raiz):
                try:
                    ler_config(raiz)
                    ler_estado(raiz)
                    coordenador = construir(ambiente, raiz)
                except ErroDeEntrada:
                    _soltar_drenagem(raiz)
                    raise
                try:
                    coordenador.rodar(intervalo=args.intervalo, ciclos=args.ciclos, dormir=dormir)
                except KeyboardInterrupt:
                    print("coordenador parado", file=saida)
                return 0
        except OutroCoordenador:
            print(MENSAGEM_TRAVA, file=erro)
            return CODIGO_TRAVA
    except ErroDeEntrada as exc:
        for item in exc.erros:
            print(item, file=erro)
        return CODIGO_ENTRADA
    except Exception as exc:  # noqa: BLE001 - nunca imprime traceback
        print("%s: %s" % (type(exc).__name__, despachante._cortar(str(exc), LIMITE_MENSAGEM)), file=erro)
        return CODIGO_ERRO


def _parar(*_):
    raise KeyboardInterrupt


if __name__ == "__main__":
    import signal

    signal.signal(signal.SIGTERM, _parar)  # systemctl stop: o rodar solta a drenagem antes de sair
    sys.exit(main())
