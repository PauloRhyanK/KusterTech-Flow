"""Coordenador da fila por plano: acha os planos, admite quem não colide e cuida dos despachantes (só stdlib).

Roda como `fabrica-fila.service`, um laço a cada 60 s. Cada ciclo faz, nesta ordem:

1. prepara o Warren com `preparar_warren` (--model, drop-in, `warren-automerge` e `warren-auto` desligados),
   na mesma cadência do despachante, e marca a drenagem no `capacidade.json` enquanto espera os runs;
2. descobre os planos (`.fabrica/planos/*.json` e o legado `.fabrica/plano.json`) no branch padrão de cada
   repositório de `fila.json`; um plano inválido não entra e gera um aviso por mudança de conteúdo;
3. aplica a fila (`fila.enfileirar` e `fila.admitir`): para cada admitido, clona o repositório, grava o
   `plano.env`, roda `despachante.py iniciar` (só sem `estado.json`) e liga `fabrica-plano@<id>`;
4. observa os ativos: unit `failed` ou parada vira `pausado`, pausa da fábrica no plano também, e um plano
   concluído (`estado.plano_concluido`) tem a unit desligada, as reservas soltas e vira `concluido`;
5. refaz, a partir do `estado.json`, as vagas e a trava de cada plano ocupando (`ativo`, `pausado`) sem unit
   rodando, e limpa as reservas, travas e esperas de quem não está mais ocupando;
6. grava `fila-estado.json` de forma atômica.

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

import capacidade  # noqa: E402
import despachante  # noqa: E402
import estado as est  # noqa: E402
import fila  # noqa: E402
import raias  # noqa: E402
from despachante import ErroDeEntrada  # noqa: E402

ARQ_FILA = "fila.json"
ARQ_FILA_ESTADO = "fila-estado.json"
ARQ_CAPACIDADE = "capacidade.json"
ARQ_TRAVA = "coordenador.lock"
ARQ_LOG = "log.jsonl"
ARQ_COORDENADOR_ENV = "coordenador.env"
DIR_PLANOS = "planos"
DIR_PLANOS_NO_REPO = ".fabrica/planos"
CAMINHO_LEGADO = ".fabrica/plano.json"
KIT_PADRAO = pathlib.Path(__file__).resolve().parents[2]
RAIZ_PADRAO = "~/fabrica"
INTERVALO_PADRAO = 60

CODIGO_ERRO = 1
CODIGO_ENTRADA = 2
CODIGO_TRAVA = 3
MENSAGEM_TRAVA = "outro coordenador está rodando nesta raiz"

VARIAVEIS_REPASSADAS = ("WARREN_API", "WARREN_TOKEN_FILE", "GH_TOKEN_FILE")
LIMITE_AVISOS = 50
AVISOS_NO_STATUS = 10
LIMITE_MENSAGEM = 500
LIMITE_SAIDA = 300
TAMANHO_MINIMO_SEGREDO = 8
FORMATO_INSTANTE = "%Y-%m-%dT%H:%M:%SZ"
UNITS_RODANDO = ("active", "activating", "reloading", "deactivating")
_REPO = re.compile(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+")
# o formato de `fila.id_do_plano`: 4 partes `[a-z0-9]+(-[a-z0-9]+)*` separadas por `--`
_ID = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*(--[a-z0-9]+(-[a-z0-9]+)*){3}")


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


def ler_coordenador_env(raiz) -> dict:
    """`<raiz>/coordenador.env` (o `EnvironmentFile` do `fabrica-fila`): só WARREN_API, WARREN_TOKEN_FILE e GH_TOKEN_FILE.

    Uma `CHAVE=VALOR` por linha, sem expansão; linha vazia ou começando por `#` é ignorada, e aspas em volta do
    valor saem. Ausente vale `{}`; ilegível levanta `ErroDeEntrada`.
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
        if chave in VARIAVEIS_REPASSADAS and valor:
            valores[chave] = valor
    return valores


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


def _atuais(fila_: list) -> dict:
    """A entrada vigente de cada id (a última válida da lista); id fora do formato fica de fora."""
    atuais = {}
    for entrada in fila_:
        if isinstance(entrada, dict) and _id_valido(entrada.get("id")) and entrada.get("estado") in fila.ESTADOS:
            atuais[entrada["id"]] = entrada
    return atuais


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
        self._ciclos = 0
        self._ultimo_preparo = None
        self._sha_revertido = None
        self._repetidos = {}
        self.dados = _padrao_do_estado()
        self._tentados = set()
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
        return status(self.raiz)

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
                dormir(intervalo)
        finally:
            # parado de vez, ninguém soltaria a drenagem; o próximo coordenador a refaz a partir do disco
            with contextlib.suppress(Exception):
                if capacidade.ler(self.capacidade).get("drenagem"):
                    capacidade.definir_drenagem(self.capacidade, None)

    def ciclo(self) -> list[dict]:
        """Os 6 passos, nesta ordem. Devolve os eventos do ciclo.

        `fila.json` ou `fila-estado.json` ilegível levanta `ErroDeEntrada` (o `rodar` deixa sair com 2).
        """
        self.dados = ler_estado(self.raiz)
        self._separar_ids_invalidos()
        self._tentados = set()
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
            self._passo_fila(config, descobertos, falhos, eventos)
            rodando, confiavel = self._passo_observar(eventos)
            self._passo_orfaos(rodando, confiavel, eventos)
        finally:
            self._ciclos += 1
            self._salvar()
        return eventos

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
        self.dados["fila"] = nova
        self._salvar()
        for id_ in fila.admitir(self.dados["fila"]):
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
            if entrada["estado"] not in fila.OCUPANDO:
                continue
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
            # só quem não está ocupando (concluído, removido, desconhecido) perde reservas, trava e espera
            removidos = capacidade.limpar_orfaos(self.capacidade, ocupando)
        except Exception as exc:  # noqa: BLE001
            self._erro_de_etapa("limpar_orfaos", "capacidade", exc)
            return
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


def status(raiz) -> str:
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
        linhas.extend("  %s: %s (entrou em %s)" % (e["id"], e["estado"], e.get("entrouEm")) for e in atuais)
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
        if args.comando in ("registrar", "status", "vagas"):
            # a CLI roda na shell, sem o EnvironmentFile da unit: lê o mesmo coordenador.env
            ambiente = _com_coordenador_env(ambiente, raiz)
        if args.comando == "status":
            print(status(raiz), file=saida)
            return 0
        if args.comando == "vagas":
            print(_vagas(raiz, args.n, args.ram_minima_mb), file=saida)
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
