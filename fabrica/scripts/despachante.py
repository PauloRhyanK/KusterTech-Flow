"""Despachante da fábrica: observa o Warren e o GitHub, decide com `estado` e executa (só stdlib).

É a única camada operacional do kit. A cada ciclo:

1. recarrega `.fabrica/plano.json` do branch padrão (só adota um plano válido);
2. observa os runs de revisão, do fixer e do orquestrador;
3. trata o PR do orquestrador que terminou e o conclui;
4. sincroniza o plano no estado (sempre: é puro e idempotente);
5. observa os Plan Runs das raias executando, os PRs das seeds e as decisões do Paulo;
6. executa `estado.proximas_acoes`, gravando o `estado.json` de forma atômica depois de cada ação.

Garantias:

- toda ação paga (despachar raia, revisor, fixer, orquestrador) é anotada em `acaoEmCurso` antes
  da chamada; se o processo morrer no meio, o reinício trata a ação como "despachada sem id" e
  nunca a repete às cegas;
- uma seed só recebe ação de gate (revisar, verificar, corrigir, mergear) se o PR dela foi lido
  com sucesso neste ciclo, no repositório configurado e aberto;
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
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import estado as est  # noqa: E402
import globs  # noqa: E402
import prompts  # noqa: E402
import raias  # noqa: E402
import verificacao  # noqa: E402
from motor import MotorOcupado  # noqa: E402

ARQ_ESTADO = "estado.json"
ARQ_PLANO = "plano.json"
ARQ_ACORDADAS = "acordadas.jsonl"
ARQ_LOG = "log.jsonl"
ARQ_TRAVA = "despachante.lock"
CAMINHO_PLANO = ".fabrica/plano.json"
CAMINHO_CONFIG = ".fabrica/config.json"

WARREN_API_PADRAO = "http://127.0.0.1:8080"
WARREN_TOKEN_PADRAO = "~/.warren-token"
GH_TOKEN_PADRAO = "~/.warren-gh-token"

CODIGO_ERRO = 1
CODIGO_ENTRADA = 2
CODIGO_TRAVA = 3
MENSAGEM_TRAVA = "outro despachante está rodando nesta raiz"

TERMINAIS_DE_RUN = ("succeeded", "failed", "cancelled")
ACOES_PAGAS = ("despachar_raia", "revisar", "corrigir", "acordar")
ACOES_DE_GATE = ("revisar", "verificar", "corrigir", "mergear")
# O que o orquestrador pode mudar; qualquer outro arquivo leva o PR dele para o Paulo.
PERMITIDOS_AO_ORQUESTRADOR = (
    ".fabrica/plano.json",
    est.PERGUNTA_DO_ORQUESTRADOR,
    ".fabrica/planejamento/**",
    ".seeds/**",
)
# Valem em todo PR de seed, somados aos `protegidos` da config do cliente.
PROTEGIDOS_FIXOS = (".github/**", ".warren/**", ".fabrica/**", ".claude/**")
ALIASES_DE_PAPEL = {"ux-engineer": "ux-ui"}
PAPEIS_OBRIGATORIOS = ("orquestrador", "revisor", "fixer")
LIMITE_MENSAGEM = 500
LIMITE_CONTEXTO = 4000
LIMITE_AVISOS_COMPACTOS = 10
LIMITE_AVISO_COMPACTO = 300
TAMANHO_MINIMO_SEGREDO = 8


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


# ---------------------------------------------------------------- arquivos


def gravar_json_atomico(caminho, dados) -> None:
    """Grava num temporário do mesmo diretório, faz fsync e troca com `os.replace`."""
    caminho = pathlib.Path(caminho)
    texto = json.dumps(dados, ensure_ascii=False, indent=1) + "\n"
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
        return json.loads(texto)
    except (ValueError, RecursionError):
        raise ValueError("%s ilegível: corrija ou restaure o arquivo" % caminho.name) from None


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


def _permitido_ao_orquestrador(caminho) -> bool:
    if not _texto(caminho) or caminho.startswith("/"):
        return False
    if any(parte in ("", ".", "..") for parte in caminho.split("/")):
        return False
    return any(globs.casa_glob(caminho, g) for g in PERMITIDOS_AO_ORQUESTRADOR)


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
    ):
        if not _texto(projeto):
            raise ConfigInvalida("projeto")
        if not _texto(repo):
            raise ConfigInvalida("repo")
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
        conhecidos = {s for s in segredos if isinstance(s, str)} | {s.strip() for s in segredos if isinstance(s, str)}
        # os mais longos primeiro, para um segredo que contém outro ser trocado inteiro
        self._segredos = tuple(sorted((s for s in conhecidos if len(s) >= TAMANHO_MINIMO_SEGREDO), key=len, reverse=True))
        self.raiz.mkdir(parents=True, exist_ok=True)
        self.estado = _ler_json(self.raiz / ARQ_ESTADO)
        if self.estado is not None:
            if not isinstance(self.estado, dict):
                raise ValueError("estado.json ilegível: corrija ou restaure o arquivo")
            if self.estado.get("repo") != repo or self.estado.get("projeto") != projeto:
                raise ConfigInvalida("o estado.json desta raiz é de outro projeto ou repositório")
        self.plano = _dict(_ler_json(self.raiz / ARQ_PLANO))
        self._observadas: set = set()
        self._retry_after = 0

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
        gravar_json_atomico(self.raiz / ARQ_ESTADO, self.estado)

    def _mudar(self, novo: dict) -> None:
        self.estado = novo
        self._salvar()

    def _exigir_estado(self) -> None:
        if self.estado is None:
            raise ErroDeEntrada(["sem estado.json em %s: rode iniciar" % self.raiz])

    # ------------------------------------------------------------ config e plano

    def _modelo(self, papel) -> dict:
        modelos = self.config["modelos"]
        entrada = modelos.get(papel)
        if entrada is None and papel in ALIASES_DE_PAPEL:
            entrada = modelos.get(ALIASES_DE_PAPEL[papel])
        return _validar_modelo(entrada, str(papel))

    def _protegidos(self) -> list[str]:
        return list(dict.fromkeys(list(self.config["protegidos"]) + list(PROTEGIDOS_FIXOS)))

    def _raia_do_plano(self, raia_id):
        return _raias_por_id(self.plano).get(raia_id)

    def _papel_da_raia(self, raia_id):
        return _dict(self._raia_do_plano(raia_id)).get("papel")

    def _mesmo_repo(self, repo) -> bool:
        return isinstance(repo, str) and repo.lower() == self.repo.lower()

    def _ler_plano(self, ref: str):
        """`(plano | None, erros, existe)` do `.fabrica/plano.json` em `ref`."""
        texto = self.forja.arquivo(self.repo, ref, CAMINHO_PLANO)
        if texto is None:
            return None, ["%s ausente em %s" % (CAMINHO_PLANO, ref)], False
        try:
            plano = json.loads(texto)
        except (ValueError, RecursionError):
            return None, ["%s em %s não é JSON válido" % (CAMINHO_PLANO, ref)], True
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
            self._log({"evento": "erro", "etapa": "recarregar_plano", "erro": self._erro(exc)})
            return
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

    def iniciar(self, *, spec: str | None = None) -> None:
        if spec is None:
            plano, erros, _ = self._ler_plano(self.branch)
            if erros:
                raise ErroDeEntrada(erros)
            self._adotar_plano(plano)
            if self.estado is None:
                self._novo_estado()
                self._log({"evento": "iniciar", "plano": True})
            else:
                self._log({"evento": "iniciar", "plano": True, "aviso": "o estado já existia e foi mantido"})
            return

        if not _texto(spec):
            raise ErroDeEntrada(["--spec vazio"])
        try:
            conteudo = self.forja.arquivo(self.repo, self.branch, spec)
        except ValueError:
            raise ErroDeEntrada(["caminho de spec inválido: %r" % spec]) from None
        if conteudo is None:
            raise ErroDeEntrada(["a spec %r não existe no branch %s" % (spec, self.branch)])
        if self.estado is None:
            plano, erros, _ = self._ler_plano(self.branch)
            if plano is not None and not erros:
                self._adotar_plano(plano)
            self._novo_estado()
        self._log({"evento": "iniciar", "spec": spec})
        self._recuperar_acao_interrompida()
        self._enfileirar_acordar("nova_spec", spec, {"spec": spec})
        acao = self._proposta_de_pendente()
        if acao is not None and acao["motivo"] == "nova_spec" and acao["alvo"] == spec:
            self._executar(acao)

    def retomar(self) -> None:
        self._exigir_estado()
        antes = {"pausado": self.estado.get("pausado"), "falhasAcordar": self.estado.get("falhasAcordar")}
        self.estado["pausado"] = None
        self.estado["falhasAcordar"] = 0
        self._salvar()
        self._log({"evento": "retomar", "antes": antes})

    # ------------------------------------------------------------ ciclo

    def ciclo(self) -> list[dict]:
        self._exigir_estado()
        self._observadas = set()
        self._retry_after = 0
        self._recuperar_acao_interrompida()
        self._recarregar_plano()
        self._observar_runs_de_seeds()
        self._observar_orquestrador()
        self._mudar(est.sincronizar_plano(self.estado, self.plano))
        self._observar_planos()
        self._observar_prs()
        self._observar_decisoes()
        return self._agir()

    def rodar(self, *, intervalo: int = 30, ciclos: int | None = None, dormir=time.sleep) -> None:
        self._exigir_estado()
        try:
            residuos = _dict(self._limpar())
            registro = {k: residuos.get(k) for k in ("conteineres", "redes", "diretorios")}
            registro["erros"] = [self._seguro(e) for e in _lista(residuos.get("erros"))]
        except Exception as exc:  # noqa: BLE001
            registro = {"erros": [self._erro(exc)]}
        self._log(dict({"evento": "limpar_residuos"}, **registro))
        feitos = 0
        while ciclos is None or feitos < ciclos:
            feitos += 1
            try:
                self.ciclo()
            except Exception as exc:  # noqa: BLE001 - o laço segue; o estado já está gravado
                self._log({"evento": "erro_no_ciclo", "erro": self._erro(exc)})
            if ciclos is not None and feitos >= ciclos:
                break
            dormir(max(intervalo, self._retry_after))

    # ------------------------------------------------------------ observação

    def _recuperar_acao_interrompida(self) -> None:
        acao = self.estado.get("acaoEmCurso")
        if acao is None:
            return
        tipo = _dict(acao).get("tipo")
        if tipo == "acordar":
            self.estado["pausado"] = "acordar interrompido"
            mensagem = (
                "o despachante parou no meio de acordar %s:%s; confira no Warren se o orquestrador "
                "foi despachado e rode retomar" % (acao.get("motivo"), acao.get("alvo"))
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

    def _ler_run(self, run_id: str):
        try:
            return _dict(self.motor.run(run_id))
        except Exception as exc:  # noqa: BLE001
            self._log({"evento": "erro", "etapa": "observar_run", "runId": run_id, "erro": self._erro(exc)})
            return None

    def _texto_do_run(self, run_id: str, run: dict, *, obrigatorio: bool):
        """O último texto do run, quando ele é necessário (veredito ou cota); `None` se a leitura falhar."""
        if not obrigatorio and run.get("motivoFalha") != "provider_error":
            return ""
        try:
            texto = self.motor.ultimo_texto(run_id)
        except Exception as exc:  # noqa: BLE001
            self._log({"evento": "erro", "etapa": "ultimo_texto", "runId": run_id, "erro": self._erro(exc)})
            return None
        return texto if isinstance(texto, str) else ""

    def _observar_runs_de_seeds(self) -> None:
        for seed_id, seed in list(_dict(self.estado.get("seeds")).items()):
            for campo, papel in (("revisaoRunId", "revisor"), ("fixerRunId", "fixer")):
                run_id = _dict(seed).get(campo)
                if not _texto(run_id):
                    continue
                run = self._ler_run(run_id)
                if run is None or run.get("estado") not in TERMINAIS_DE_RUN:
                    continue
                revisao = campo == "revisaoRunId"
                texto = self._texto_do_run(run_id, run, obrigatorio=revisao)
                if texto is None:
                    continue  # tenta de novo no próximo ciclo, sem gastar tentativa
                veredito = prompts.extrair_veredito(texto) if revisao and run["estado"] == "succeeded" else None
                cota = prompts.eh_falha_de_cota(run.get("motivoFalha"), texto)
                self._mudar(
                    est.registrar_fim_de_run(
                        self.estado,
                        run_id,
                        estado_run=run["estado"],
                        motivo_falha=run.get("motivoFalha"),
                        veredito=veredito,
                        cota=cota,
                    )
                )
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
                self._conferir_modelo(run_id, papel)

    def _observar_orquestrador(self) -> None:
        orquestrador = _dict(self.estado.get("orquestrador"))
        run_id = orquestrador.get("runId")
        if not _texto(run_id):
            return
        run = self._ler_run(run_id)
        if run is None or run.get("estado") not in TERMINAIS_DE_RUN:
            return
        try:
            self._tratar_pr_orquestrador(run_id, run, orquestrador.get("motivo"))
        except Exception as exc:  # noqa: BLE001 - não conclui: o próximo ciclo tenta de novo
            self._log({"evento": "erro", "etapa": "pr_do_orquestrador", "runId": run_id, "erro": self._erro(exc)})
            self._aviso("falha ao tratar o PR do orquestrador (run %s); nova tentativa no próximo ciclo" % run_id)
            return
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
        self._conferir_modelo(run_id, "orquestrador")
        self._mudar(est.concluir_orquestrador(self.estado))
        self._log({"evento": "orquestrador_concluido", "runId": run_id, "estado": run["estado"]})

    def _observar_planos(self) -> None:
        for raia_id, raia in list(_dict(self.estado.get("raias")).items()):
            raia = _dict(raia)
            if raia.get("estado") != "executando" or not _texto(raia.get("planRunId")):
                continue
            try:
                observado = _dict(self.motor.plano(raia["planRunId"]))
            except Exception as exc:  # noqa: BLE001
                self._log({"evento": "erro", "etapa": "observar_plano", "raia": raia_id, "erro": self._erro(exc)})
                continue
            antes = {i: _dict(s).get("estado") for i, s in _dict(self.estado.get("seeds")).items()}
            filhos = observado.get("filhos")
            self._mudar(
                est.registrar_plano(
                    self.estado,
                    raia_id,
                    estado_plano=observado.get("estado"),
                    falha=observado.get("falha"),
                    filhos=filhos,
                )
            )
            depois = _dict(self.estado.get("seeds"))
            papel = self._papel_da_raia(raia_id)
            for filho in _lista(filhos):
                filho = _dict(filho)
                seed_id, run_id = filho.get("seedId"), filho.get("runId")
                agora = _dict(depois.get(seed_id)).get("estado")
                if (
                    _texto(run_id)
                    and papel is not None
                    and antes.get(seed_id) in (None, "executando")
                    and agora not in (None, "executando")
                ):
                    self._conferir_modelo(run_id, papel)

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
                if pr.get("aberto") is not True:
                    self._aviso("seed %s: PR %s está fechado sem merge observado; nenhuma ação" % (seed_id, seed["pr"]))
                    continue
                ci = self.forja.ci(self.repo, pr.get("headSha"))
            except Exception as exc:  # noqa: BLE001 - sem leitura completa, nenhuma ação de gate
                self._log({"evento": "erro", "etapa": "observar_pr", "seed": seed_id, "erro": self._erro(exc)})
                continue
            self._mudar(
                est.registrar_pr(
                    self.estado,
                    seed_id,
                    head_sha=pr.get("headSha"),
                    branch=pr.get("branch"),
                    arquivos=pr.get("arquivos"),
                    ci=ci,
                )
            )
            self._observadas.add(seed_id)

    def _observar_decisoes(self) -> None:
        decisoes = _lista(self.estado.get("decisoes"))
        restantes, mudou = [], False
        for decisao in decisoes:
            if not isinstance(decisao, dict) or not _texto(decisao.get("url")):
                mudou = True
                continue
            try:
                info = _dict(self.forja.decisao(decisao["url"]))
            except Exception as exc:  # noqa: BLE001 - a decisão fica na lista
                self._log({"evento": "erro", "etapa": "observar_decisao", "url": decisao["url"], "erro": self._erro(exc)})
                restantes.append(decisao)
                continue
            if info.get("fechada") is not True:
                restantes.append(decisao)
                continue
            mudou = True
            comentario = info.get("ultimoComentario")
            if _texto(comentario) and comentario.strip():
                self._enfileirar_acordar(
                    "resposta_paulo",
                    decisao["url"],
                    {"pergunta": decisao.get("motivo"), "resposta": comentario},
                    salvar=False,
                )
                self._log({"evento": "decisao_respondida", "url": decisao["url"]})
            else:
                self.estado.setdefault("avisos", [])
                self._log({"evento": "decisao_fechada_sem_comentario", "url": decisao["url"]})
                mensagem = self._seguro("decisão %s fechada sem comentário; o orquestrador não foi acordado" % decisao["url"])
                if mensagem not in self.estado["avisos"]:
                    self.estado["avisos"].append(mensagem)
        if mudou:
            self.estado["decisoes"] = restantes
            self._salvar()

    def _conferir_modelo(self, run_id: str, papel) -> None:
        try:
            configurado = self._modelo(papel)["modelo"]
        except ConfigInvalida:
            return
        try:
            efetivo = self.motor.modelo_efetivo(run_id)
        except Exception as exc:  # noqa: BLE001 - a conferência nunca atrapalha o fluxo
            self._log({"evento": "erro", "etapa": "modelo_efetivo", "runId": run_id, "erro": self._erro(exc)})
            return
        if not _texto(efetivo) or efetivo == configurado:
            return
        self._aviso(
            "papel %s rodou em %s, configurado %s: o Warren não aplicou o modelo (rode preparar-warren)"
            % (papel, _cortar(efetivo, 100), configurado)
        )

    # ------------------------------------------------------------ PR do orquestrador

    def _tratar_pr_orquestrador(self, run_id: str, run: dict, motivo) -> None:
        pr_url = run.get("prUrl")
        if not _texto(pr_url):
            self._enfileirar_acordar("plano_invalido", run_id, {"erro": "run do orquestrador terminou sem PR"})
            return
        pr = _dict(self.forja.pr(pr_url))
        if not self._mesmo_repo(pr.get("repo")):
            self._decidir_humano_orquestrador(pr_url, motivo, ["PR em outro repositório: %s" % pr.get("repo")])
            return
        if pr.get("aberto") is not True:
            self._decidir_humano_orquestrador(pr_url, motivo, ["o PR do orquestrador não está aberto"])
            return
        arquivos = pr.get("arquivos")
        head = pr.get("headSha")
        if not isinstance(arquivos, list) or not _texto(head):
            self._decidir_humano_orquestrador(pr_url, motivo, ["PR do orquestrador ilegível"])
            return
        if est.PERGUNTA_DO_ORQUESTRADOR in arquivos:
            self._abrir_pergunta(pr_url, self.forja.arquivo(self.repo, head, est.PERGUNTA_DO_ORQUESTRADOR))
            return

        motivos = []
        fora = [a for a in arquivos if not _permitido_ao_orquestrador(a)]
        if fora:
            motivos.append("PR fora de .fabrica: " + ", ".join(_cortar(a, 200) for a in fora[:20]))
        # lido no sha do head, que é o que o merge leva (nunca no branch, que pode andar)
        plano_novo, erros, _ = self._ler_plano(head)
        if plano_novo is not None:
            motivos.extend(_mudancas_de_verificacao(self.plano, plano_novo))
        decisao = "humano" if motivos else est.decidir_pr_orquestrador(
            motivo=motivo, arquivos=arquivos, erros_plano=erros
        )
        self._log({"evento": "pr_do_orquestrador", "pr": pr_url, "decisao": decisao, "motivos": motivos})
        if decisao == "mergear":
            if self.forja.mergear(pr_url, head) is True:
                self._log({"evento": "merge_do_orquestrador", "pr": pr_url, "sha": head})
                return
            motivos = ["merge recusado pelo GitHub"]
            decisao = "humano"
        if decisao == "replanejar":
            self._enfileirar_acordar("plano_invalido", run_id, {"erros": erros[:30], "pr": pr_url})
            self._aviso("PR %s do orquestrador tem plano inválido; feche-o depois do replanejamento" % pr_url)
            return
        if decisao != "humano":
            motivos.append("decisão desconhecida %r" % (decisao,))
        self._decidir_humano_orquestrador(pr_url, motivo, motivos)

    def _decidir_humano_orquestrador(self, pr_url: str, motivo, motivos: list[str]) -> None:
        fase = motivo in est.MOTIVOS_DO_PAULO
        if not motivos and not fase:
            motivos = ["o PR do orquestrador precisa de uma decisão do Paulo"]
        if fase:
            motivos = motivos + ["aprovar fase (o orquestrador foi acordado por %s)" % motivo]
        titulo = "[fábrica] orquestrador: " + (
            "aprovar fase" if fase and len(motivos) == 1 else "PR do orquestrador precisa de aprovação"
        )
        corpo = "PR: %s\nMotivo da acordada: %s\n\nMotivos:\n%s\n\n%s" % (
            pr_url,
            motivo,
            "\n".join("- " + m for m in motivos),
            "Mergeie ou feche o PR. Feche esta issue com um comentário para responder ao orquestrador.",
        )
        self._registrar_decisao(titulo, corpo, "; ".join(motivos), pr_url)

    def _abrir_pergunta(self, pr_url: str, conteudo) -> None:
        pergunta = conteudo if _texto(conteudo) else "(%s não foi encontrado no head do PR)" % est.PERGUNTA_DO_ORQUESTRADOR
        corpo = "%s\n\nPR: %s\n\nFeche esta issue com um comentário: ele volta para o orquestrador." % (
            pergunta,
            pr_url,
        )
        self._registrar_decisao(
            "[fábrica] orquestrador: pergunta para o Paulo", corpo, _cortar(pergunta, LIMITE_CONTEXTO), pr_url
        )

    def _registrar_decisao(self, titulo: str, corpo: str, motivo: str, alvo: str) -> None:
        url = self.forja.abrir_decisao(self.repo, titulo, corpo)
        self.estado.setdefault("decisoes", []).append({"url": url, "motivo": self._seguro(motivo, LIMITE_CONTEXTO), "alvo": alvo})
        self._salvar()
        self._log({"evento": "decisao_aberta", "url": url, "alvo": alvo})

    # ------------------------------------------------------------ acordar

    def _enfileirar_acordar(self, motivo: str, alvo: str, contexto: dict, *, salvar: bool = True) -> None:
        if "%s:%s" % (motivo, alvo) in _lista(self.estado.get("chavesAcordadas")):
            return
        pendentes = self.estado.setdefault("acordarPendentes", [])
        if any(p.get("motivo") == motivo and p.get("alvo") == alvo for p in pendentes):
            return
        pendentes.append({"motivo": motivo, "alvo": alvo, "contexto": self._limitar(contexto)})
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
        if self.estado.get("pausado") or _dict(self.estado.get("orquestrador")).get("runId") is not None:
            return None
        pendentes = self.estado.setdefault("acordarPendentes", [])
        chaves = _lista(self.estado.get("chavesAcordadas"))
        for pendente in list(pendentes):
            if "%s:%s" % (pendente.get("motivo"), pendente.get("alvo")) in chaves:
                pendentes.remove(pendente)
                self._salvar()
                continue
            return {
                "tipo": "acordar",
                "motivo": pendente.get("motivo"),
                "alvo": pendente.get("alvo"),
                "contexto": copy.deepcopy(pendente.get("contexto")),
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

    def _agir(self) -> list[dict]:
        if self.estado.get("pausado"):
            return []
        acoes = est.proximas_acoes(self.estado, self.plano, self._protegidos())
        acoes = [a for a in acoes if self._acao_permitida(a)]
        if not any(a.get("tipo") == "acordar" for a in acoes):
            pendente = self._proposta_de_pendente()
            if pendente is not None:
                acoes.append(pendente)
        executadas = []
        for acao in acoes:
            if self.estado.get("pausado"):
                break
            self._executar(acao)
            executadas.append(acao)
        return executadas

    def _executar(self, acao: dict) -> None:
        tipo = acao.get("tipo")
        if tipo in ACOES_PAGAS:
            self.estado["acaoEmCurso"] = {k: v for k, v in acao.items() if k != "contexto"}
            self._salvar()
        erro = None
        try:
            resultado = self._efeito(acao)
        except MotorOcupado as exc:
            try:
                espera = max(0, int(exc.retry_after))
            except (TypeError, ValueError):
                espera = 0
            self._retry_after = max(self._retry_after, espera)
            resultado = {"adiado": True, "retryAfter": espera}
        except _NaoExecutada as exc:
            erro = self._erro(exc)
            resultado = None
            self.estado.pop("acaoEmCurso", None)
            self._aviso("%s %s não executada: %s" % (tipo, acao.get("raia") or acao.get("seed") or "", erro))
        except Exception as exc:  # noqa: BLE001 - vira o resultado "sem id" (nunca repete às cegas)
            erro = self._erro(exc)
            resultado = {"ok": False} if tipo == "mergear" else ({} if tipo != "aguardar_humano" else None)
        if resultado is not None:
            self._aplicar(acao, resultado)
        self.estado.pop("acaoEmCurso", None)
        self._salvar()
        registro = {"evento": "acao", "acao": self._resumo_da_acao(acao), "resultado": self._resumo(resultado)}
        if erro is not None:
            registro["erro"] = erro
        self._log(registro)

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
        self.estado = est.aplicar(self.estado, {k: v for k, v in acao.items() if k != "contexto"}, resultado)
        if tipo == "aguardar_humano" and _texto(resultado.get("url")):
            self.estado.setdefault("decisoes", []).append(
                {"url": resultado["url"], "motivo": self._seguro("; ".join(acao.get("motivos") or []), LIMITE_CONTEXTO), "alvo": acao.get("seed")}
            )
        if tipo == "acordar" and _texto(resultado.get("runId")):
            pendentes = _lista(self.estado.get("acordarPendentes"))
            self.estado["acordarPendentes"] = [
                p for p in pendentes if not (p.get("motivo") == acao.get("motivo") and p.get("alvo") == acao.get("alvo"))
            ]
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

    def _seed_da_acao(self, acao: dict) -> dict:
        seed = _dict(self.estado.get("seeds")).get(acao.get("seed"))
        if not isinstance(seed, dict):
            raise ValueError("seed desconhecida %r" % (acao.get("seed"),))
        return seed

    def _efeito(self, acao: dict) -> dict:
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
            plan_run_id = self.motor.despachar_plano(
                projeto=self.projeto,
                plano_seeds=raia.get("planoSeeds"),
                agente=modelo["agente"],
                modelo=modelo["modelo"],
                prompt_template=template,
                max_custo_usd=modelo["maxCustoUsd"],
            )
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
                prompt = prompts.prompt_fixer(
                    seed_id=acao["seed"],
                    motivos=[m for m in _lista(acao.get("motivos")) if isinstance(m, str)],
                    achados=[a for a in _lista(acao.get("achados")) if isinstance(a, dict)],
                    saida_verificacao=saida if isinstance(saida, str) else "",
                )
            run_id = self.motor.despachar_run(
                projeto=self.projeto,
                agente=modelo["agente"],
                modelo=modelo["modelo"],
                prompt=prompt,
                branch_existente=seed["branch"],
                max_custo_usd=modelo["maxCustoUsd"],
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
            corpo = "Seed: %s\nRaia: %s\nPR: %s\nHead: %s\n\nMotivos:\n%s\n\n%s" % (
                acao["seed"],
                seed.get("raia"),
                seed.get("pr") or "(sem PR)",
                seed.get("headSha") or "-",
                "\n".join("- " + m for m in motivos),
                "Feche esta issue com um comentário para responder ao orquestrador.",
            )
            url = self.forja.abrir_decisao(self.repo, "[fábrica] %s: decisão necessária" % acao["seed"], corpo)
            return {"url": url}

        if tipo == "acordar":
            modelo = self._modelo("orquestrador")
            contexto = acao.get("contexto") if isinstance(acao.get("contexto"), dict) else self._contexto(acao)
            prompt = prompts.prompt_orquestrador(
                motivo=acao.get("motivo"), estado_compacto=compactar(self.estado, self.plano), contexto=contexto
            )
            run_id = self.motor.despachar_run(
                projeto=self.projeto,
                agente=modelo["agente"],
                modelo=modelo["modelo"],
                prompt=prompt,
                branch_existente=None,
                max_custo_usd=modelo["maxCustoUsd"],
            )
            return {"runId": run_id}

        raise _NaoExecutada("tipo de ação desconhecido %r" % (tipo,))


# ---------------------------------------------------------------- arquivo-only (sem motor nem forja)


def retomar(raiz, *, agora=datetime.datetime.now) -> None:
    """Zera `pausado` e `falhasAcordar` direto no `estado.json` (chamado sob a trava)."""
    raiz = pathlib.Path(raiz)
    estado = _ler_json(raiz / ARQ_ESTADO)
    if not isinstance(estado, dict):
        raise ErroDeEntrada(["sem estado.json em %s: rode iniciar" % raiz])
    antes = {"pausado": estado.get("pausado"), "falhasAcordar": estado.get("falhasAcordar")}
    estado["pausado"] = None
    estado["falhasAcordar"] = 0
    gravar_json_atomico(raiz / ARQ_ESTADO, estado)
    _anexar_linha(
        raiz / ARQ_LOG,
        json.dumps({"ts": agora().isoformat(), "evento": "retomar", "antes": antes}, ensure_ascii=False, default=str),
    )


def status(raiz) -> str:
    raiz = pathlib.Path(raiz)
    estado = _ler_json(raiz / ARQ_ESTADO)
    if not isinstance(estado, dict):
        raise ErroDeEntrada(["sem estado.json em %s: rode iniciar" % raiz])
    c = compactar(estado, _dict(_ler_json(raiz / ARQ_PLANO)))
    linhas = [
        "pausado: %s" % (c["pausado"] or "não"),
        "fase atual: %s" % c["faseAtual"],
        "orquestrador: %s" % (_dict(estado.get("orquestrador")).get("runId") or "livre"),
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
    import forja as forja_github
    import motor_warren

    raiz = _exigir(ambiente, "FABRICA_RAIZ")
    repo_dir = _exigir(ambiente, "FABRICA_REPO_DIR")
    projeto = _exigir(ambiente, "FABRICA_PROJETO")
    repo = _exigir(ambiente, "FABRICA_REPO")
    token_warren = _ler_token(ambiente.get("WARREN_TOKEN_FILE") or WARREN_TOKEN_PADRAO)
    token_gh = _ler_token(ambiente.get("GH_TOKEN_FILE") or GH_TOKEN_PADRAO)
    caminho_config = pathlib.Path(repo_dir) / CAMINHO_CONFIG
    try:
        config = json.loads(caminho_config.read_text(encoding="utf-8"))
    except (OSError, ValueError) as erro:
        raise ErroDeEntrada(["não foi possível ler %s (%s)" % (caminho_config, type(erro).__name__)]) from None
    return Despachante(
        motor=motor_warren.MotorWarren(ambiente.get("WARREN_API") or WARREN_API_PADRAO, token_warren),
        forja=forja_github.ForjaGitHub(token_gh),
        raiz=raiz,
        repo_dir=repo_dir,
        config=config,
        projeto=projeto,
        repo=repo,
        segredos=(token_warren, token_gh),
    )


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


def main(argv=None, *, ambiente=None, construir=None, saida=None, erro=None) -> int:
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
        with travar(raiz):
            if args.comando == "retomar":
                retomar(raiz)
                print("despachante retomado", file=saida)
                return 0
            despachante = construir(ambiente)
            if args.comando == "iniciar":
                despachante.iniciar(spec=args.spec)
                print("estado iniciado em %s" % raiz, file=saida)
                return 0
            try:
                despachante.rodar(intervalo=args.intervalo)
            except KeyboardInterrupt:
                print("despachante parado", file=saida)
            return 0
    except OutroDespachante:
        print(MENSAGEM_TRAVA, file=erro)
        return CODIGO_TRAVA
    except ErroDeEntrada as exc:
        for item in exc.erros:
            print(item, file=erro)
        return CODIGO_ENTRADA
    except ConfigInvalida as exc:
        print("config inválida: %s" % exc, file=erro)
        return CODIGO_ENTRADA
    except Exception as exc:  # noqa: BLE001 - nunca imprime traceback
        mensagem = despachante._erro(exc) if despachante is not None else "%s: %s" % (type(exc).__name__, _cortar(exc, LIMITE_MENSAGEM))
        print(mensagem, file=erro)
        return CODIGO_ERRO


if __name__ == "__main__":
    sys.exit(main())
