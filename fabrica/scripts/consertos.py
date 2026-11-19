"""Consertos de publicação (só stdlib): o Flow pede, a Fábrica roda um run `fixer` no Warren e conta o resultado.

O pedido chega na resposta do `POST /api/fabrica/estado` (`ler_da_resposta`); o estado de cada conserto fica em
`fila-estado.json`, em `consertos` (`{id: {...}}`), e volta ao Flow no retrato seguinte (`para_o_retrato`).

Um conserto passa por `despachando` (gravado antes do POST pago) → `em_curso` (com `runId`) → `com_pr` ou
`desistiu`. O run ocupa uma vaga de `capacidade.json` como uma raia, na chave `conserto:<id>` e raia `fixer`, até
sair de `em_curso`. O nonce do prompt e a `Idempotency-Key` são o id do conserto sem hífens (32 hex): um
coordenador reiniciado em `despachando` acha o run pelo nonce e, sem ele, repete o POST com a mesma chave. Um id
encerrado vai para `consertosEncerrados` e nunca é atendido de novo. Um run perdido por infraestrutura
(`sandbox_run_lost`, `preempted`) é refeito pelo Warren: o conserto adota o retry e segue `em_curso` com a vaga. O motor não cancela run: no teto de 1 h o
conserto `desistiu` e a vaga é solta, mas o run pode seguir no Warren até terminar sozinho.
"""

import datetime
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import capacidade  # noqa: E402
import despachante  # noqa: E402
import motor as motor_  # noqa: E402
import prompts  # noqa: E402
import retrato  # noqa: E402

TETO_S = 3600
PAPEL = "fixer"
RAIA = "fixer"
LIMITE_LOG = 4000
LIMITE_MOTIVO = 300
LIMITE_ENCERRADOS = 200
EM_ANDAMENTO = ("despachando", "em_curso")
FINAIS = ("com_pr", "desistiu")
FORMATO_INSTANTE = "%Y-%m-%dT%H:%M:%SZ"
CHAVE_AVISO_MODELO = "conserto:modelo"
AVISO_SEM_MODELO = (
    "Consertos de publicação parados: configure modelos.fixer (agente, modelo, maxCustoUsd) em "
    "fabrica/modelos/config.json do kit"
)
MOTIVO_SEM_PROJETO = "repositório sem projeto do Warren em fila.json"
MOTIVO_TETO = "teto de 1 h"
MOTIVO_RUN_SUMIU = "run não encontrado no Warren"
# R2, como no despachante: o Warren refaz sozinho, uma vez, um run perdido por infraestrutura (mesmo prompt e nonce,
# `retryOf` = original). O conserto espera esse retry com a vaga presa, por 3 buscas boas e no mínimo 5 min.
MARGEM_DESDE = despachante.MARGEM_DESDE
BUSCAS_PARA_ACHAR_RETRY = despachante.CICLOS_PARA_ACHAR_RETRY
PISO_PARA_DESISTIR = despachante.PISO_PARA_DESISTIR

_REPO = re.compile(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+")
_COMMIT = re.compile(r"[0-9a-fA-F]{40}")
# um marcador de nonce dentro do log mandado pelo Flow faria a busca achar este run por outro conserto
_MARCADOR_NO_LOG = re.compile(r"fabrica:nonce=", re.IGNORECASE)


def chave(id_: str) -> str:
    return "conserto:%s" % id_


def nonce(id_: str) -> str:
    return id_.replace("-", "")


def _texto_do_instante(momento: datetime.datetime) -> str:
    return momento.astimezone(datetime.timezone.utc).strftime(FORMATO_INSTANTE)


def _instante(valor):
    try:
        return datetime.datetime.strptime(valor, FORMATO_INSTANTE).replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- entrada


def ler_da_resposta(resposta) -> list[dict]:
    """Os pedidos válidos da resposta do Flow, sem repetir id; item torto fica de fora, sem exceção."""
    itens = resposta.get("consertos") if isinstance(resposta, dict) else None
    lidos, vistos = [], set()
    for item in itens if isinstance(itens, list) else []:
        if not isinstance(item, dict):
            continue
        id_, repo, commit, url = item.get("id"), item.get("repositorio"), item.get("commit"), item.get("execucaoUrl")
        if not isinstance(id_, str) or retrato.ID_DO_CONSERTO.fullmatch(id_.lower()) is None:
            continue
        if not isinstance(repo, str) or _REPO.fullmatch(repo) is None or repo.split("/")[1] in (".", ".."):
            continue
        if not isinstance(commit, str) or _COMMIT.fullmatch(commit) is None:
            continue
        if url is not None and not retrato.url_do_github(url):
            continue
        id_ = id_.lower()
        if id_ in vistos:
            continue
        vistos.add(id_)
        trecho = item.get("trechoDoLog")
        lidos.append(
            {
                "id": id_,
                "repositorio": repo,
                "commit": commit.lower(),
                "execucaoUrl": url,
                "trechoDoLog": trecho[-LIMITE_LOG:] if isinstance(trecho, str) else "",
            }
        )
    return lidos


def ler_modelo(kit) -> dict | None:
    """`modelos.fixer` de `<kit>/fabrica/modelos/config.json`, validado como no despachante; senão `None`."""
    try:
        config = despachante._ler_json(pathlib.Path(kit) / "fabrica" / "modelos" / "config.json")
        return despachante._validar_modelo(despachante._dict(despachante._dict(config).get("modelos")).get(PAPEL), PAPEL)
    except Exception:  # noqa: BLE001 - ausente, ilegível ou torto: sem modelo, nada é despachado
        return None


# ---------------------------------------------------------------- estado


def _atuais(estado: dict) -> dict:
    """Os consertos legíveis do estado (o `fila-estado.json` pode ter sido editado à mão)."""
    bruto = estado.get("consertos")
    if not isinstance(bruto, dict):
        return {}
    return {
        id_: c
        for id_, c in bruto.items()
        if isinstance(id_, str)
        and retrato.ID_DO_CONSERTO.fullmatch(id_) is not None
        and isinstance(c, dict)
        and c.get("estado") in EM_ANDAMENTO + FINAIS
    }


def chaves_ocupando(estado: dict) -> set[str]:
    """As chaves de vaga (`conserto:<id>`) dos consertos que seguram uma vaga: `despachando` e `em_curso`."""
    return {chave(id_) for id_, c in _atuais(estado).items() if c["estado"] in EM_ANDAMENTO}


def para_o_retrato(estado: dict) -> list[dict]:
    """O campo `consertos` do retrato: no máximo 20, os em andamento primeiro e depois os mais recentes."""
    itens = sorted(
        _atuais(estado).items(),
        key=lambda par: (par[1]["estado"] in FINAIS, -(_instante(par[1].get("em")) or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)).timestamp(), par[0]),
    )
    return [
        {
            "id": id_,
            "estado": "em_curso" if c["estado"] == "despachando" else c["estado"],
            "runId": c.get("runId"),
            "prUrl": c.get("prUrl"),
            "motivo": c.get("motivo"),
            "em": c.get("em"),
        }
        for id_, c in itens[: retrato.LIMITE_CONSERTOS]
    ]


# ---------------------------------------------------------------- passo


class _Passo:
    def __init__(self, estado, *, motor, capacidade_path, projetos, modelo, agora, mem_disponivel_mb, salvar):
        self.estado = estado
        self.motor = motor
        self.capacidade = capacidade_path
        self.projetos = {str(k).lower(): v for k, v in (projetos or {}).items()}
        self.modelo = modelo
        self.agora = agora
        self.agora_texto = _texto_do_instante(agora)
        self.mem = mem_disponivel_mb
        self._salvar = salvar or (lambda: None)
        self.eventos = []
        self.atuais = _atuais(estado)
        encerrados = estado.get("consertosEncerrados")
        self.encerrados = [i for i in encerrados if isinstance(i, str)] if isinstance(encerrados, list) else []

    def salvar(self) -> None:
        if self.atuais or "consertos" in self.estado:
            self.estado["consertos"] = self.atuais
        if self.encerrados or "consertosEncerrados" in self.estado:
            self.estado["consertosEncerrados"] = self.encerrados[-LIMITE_ENCERRADOS:]
        self._salvar()

    def evento(self, id_, estado, **extra) -> None:
        self.eventos.append(dict({"evento": "conserto", "id": id_, "estado": estado}, **extra))

    def erro(self, id_, exc) -> None:
        self.eventos.append({"evento": "erro", "etapa": "conserto", "alvo": id_, "erro": "%s: %s" % (type(exc).__name__, exc)})

    def desde(self, c: dict):
        """O corte da busca pelo nonce: o primeiro despacho, menos a margem (como no despachante)."""
        inicio = _instante(c.get("inicio"))
        return _texto_do_instante(inicio - MARGEM_DESDE) if inicio is not None else None

    def estourou(self, c: dict) -> bool:
        inicio = _instante(c.get("inicio"))
        return inicio is None or (self.agora - inicio).total_seconds() > TETO_S

    # ------------------------------------------------------------ transições

    def mudar(self, id_: str, c: dict, estado: str, **campos) -> None:
        c.update(campos, estado=estado, em=self.agora_texto)
        self.salvar()
        if estado in FINAIS:
            try:
                capacidade.sincronizar(self.capacidade, chave(id_), set())
            except (capacidade.CapacidadeInvalida, OSError) as exc:
                self.erro(id_, exc)  # a limpeza de órfãos do coordenador solta a vaga depois
        self.evento(id_, estado, **{k: v for k, v in campos.items() if k in ("runId", "prUrl", "motivo")})

    def despachar(self, id_: str, c: dict) -> None:
        texto = prompts.prompt_conserto(
            repositorio=c["repositorio"],
            commit=c["commit"],
            execucao_url=c.get("execucaoUrl"),
            trecho_do_log=_MARCADOR_NO_LOG.sub("fabrica:nonce (removido)=", c.get("trechoDoLog") or ""),
        )
        run_id = self.motor.despachar_run(
            projeto=c["projeto"],
            agente=self.modelo["agente"],
            modelo=self.modelo["modelo"],
            prompt=despachante._com_nonce(texto, nonce(id_)),
            branch_existente=None,
            max_custo_usd=self.modelo["maxCustoUsd"],
            chave_idempotencia=nonce(id_),
        )
        self.mudar(id_, c, "em_curso", runId=run_id)

    def novo(self, pedido: dict) -> None:
        id_ = pedido["id"]
        base = {k: pedido[k] for k in ("id", "repositorio", "commit", "execucaoUrl", "trechoDoLog")}
        base.update(runId=None, prUrl=None, motivo=None)
        projeto = self.projetos.get(pedido["repositorio"].lower())
        if projeto is None:
            self.atuais[id_] = dict(base, estado="desistiu", em=self.agora_texto, motivo=MOTIVO_SEM_PROJETO)
            self.salvar()
            self.evento(id_, "desistiu", motivo=MOTIVO_SEM_PROJETO)
            return
        if capacidade.ler(self.capacidade).get("drenagem"):
            return  # o Warren vai reiniciar: espera o próximo ciclo
        if not capacidade.reservar(self.capacidade, chave(id_), RAIA, mem_disponivel_mb=self.mem):
            return  # sem vaga ou sem RAM: espera o próximo ciclo
        c = self.atuais[id_] = dict(base, projeto=projeto, estado="despachando", inicio=self.agora_texto, em=self.agora_texto)
        self.salvar()  # antes do POST pago: um coordenador que morra daqui em diante acha o run pelo nonce
        self.despachar(id_, c)

    def retomar(self, id_: str, c: dict) -> None:
        """`despachando` herdado (o POST pode ter criado o run): adota pelo nonce ou repete com a mesma chave."""
        try:
            run_id = self.motor.procurar_run(c["projeto"], nonce(id_), self.desde(c))
        except Exception:
            if self.estourou(c):
                self.mudar(id_, c, "desistiu", motivo=MOTIVO_TETO)
                return
            raise
        if run_id is not None:
            self.mudar(id_, c, "em_curso", runId=run_id)
        elif self.estourou(c):
            self.mudar(id_, c, "desistiu", motivo=MOTIVO_TETO)
        elif self.modelo is not None:
            self.despachar(id_, c)

    def acompanhar(self, id_: str, c: dict) -> None:
        try:
            run = self.motor.run(c["runId"])
        except Exception as exc:
            if despachante._eh_404(exc):
                self.mudar(id_, c, "desistiu", motivo=MOTIVO_RUN_SUMIU)
            elif self.estourou(c):
                self.mudar(id_, c, "desistiu", motivo=MOTIVO_TETO)
            else:
                raise
            return
        run = despachante._dict(run)
        situacao = run.get("estado")
        if situacao == "failed" and run.get("motivoFalha") in motor_.MOTIVOS_INFRA_PERDIDA and not c.get("retryDe"):
            if self.esperar_retry(id_, c, run):
                return
        if situacao in despachante.TERMINAIS_DE_RUN:
            if retrato.url_do_github(run.get("prUrl")):
                self.mudar(id_, c, "com_pr", prUrl=run["prUrl"])
            else:
                motivo = run.get("motivoFalha")
                motivo = motivo if isinstance(motivo, str) and motivo.strip() else "o run terminou (%s) sem abrir PR" % situacao
                self.mudar(id_, c, "desistiu", motivo=motivo[:LIMITE_MOTIVO])
        elif self.estourou(c):
            self.mudar(id_, c, "desistiu", motivo=MOTIVO_TETO)

    def esperar_retry(self, id_: str, c: dict, run: dict) -> bool:
        """R2: adota o retry do Warren (segue `em_curso`, com a vaga) ou espera; `False` = não houve retry."""
        original = c["runId"]
        espera = c.get("retryEsperado")
        if not isinstance(espera, dict):
            espera = c["retryEsperado"] = {"buscas": 0, "vistoEm": self.agora_texto}
            self.salvar()
            self.eventos.append({"evento": "conserto_retry_esperado", "id": id_, "runId": original, "motivoFalha": run.get("motivoFalha")})
        try:
            achado = self.motor.procurar_retry(c["projeto"], original, [nonce(id_)], self.desde(c))
        except Exception as exc:  # noqa: BLE001 - busca falha não conta; o teto ainda vale
            if self.estourou(c):
                self.mudar(id_, c, "desistiu", motivo=MOTIVO_TETO)
            else:
                self.erro(id_, exc)
            return True
        if isinstance(achado, str) and achado and achado != original:
            c.pop("retryEsperado", None)
            c.update(runId=achado, retryDe=original, em=self.agora_texto)
            self.salvar()
            self.eventos.append({"evento": "conserto_retry_adotado", "id": id_, "original": original, "runId": achado})
            return True
        espera["buscas"] = (espera.get("buscas") if isinstance(espera.get("buscas"), int) else 0) + 1
        visto = _instante(espera.get("vistoEm"))
        if visto is None:
            espera["vistoEm"] = self.agora_texto
            visto = self.agora
        if espera["buscas"] < BUSCAS_PARA_ACHAR_RETRY or self.agora - visto < PISO_PARA_DESISTIR:
            self.salvar()
            if self.estourou(c):
                self.mudar(id_, c, "desistiu", motivo=MOTIVO_TETO)
            return True
        c.pop("retryEsperado", None)
        return False  # o Warren não refez: vale o run falho

    # ------------------------------------------------------------ ciclo

    def rodar(self, abertos) -> list[dict]:
        pedidos = {p["id"]: p for p in abertos} if abertos is not None else None
        if pedidos is not None:
            for id_ in sorted(self.atuais):
                if self.atuais[id_]["estado"] in FINAIS and id_ not in pedidos:
                    del self.atuais[id_]
                    self.encerrados = [i for i in self.encerrados if i != id_] + [id_]
                    self.salvar()
                    self.eventos.append({"evento": "conserto_esquecido", "id": id_})
        for id_, c in sorted(self.atuais.items()):
            try:
                if c["estado"] == "despachando":
                    self.retomar(id_, c)
                elif c["estado"] == "em_curso":
                    self.acompanhar(id_, c)
            except Exception as exc:  # noqa: BLE001 - um conserto não derruba os outros; o próximo ciclo tenta de novo
                self.erro(id_, exc)
        if not pedidos:
            return self.eventos
        novos = [p for p in pedidos.values() if p["id"] not in self.atuais and p["id"] not in self.encerrados]
        if novos and self.modelo is None:
            self.eventos.append({"evento": "aviso", "chave": CHAVE_AVISO_MODELO, "mensagem": AVISO_SEM_MODELO})
            return self.eventos
        for pedido in novos:
            try:
                self.novo(pedido)
            except Exception as exc:  # noqa: BLE001 - fica `despachando` (ou nem entra): o próximo ciclo refaz
                self.erro(pedido["id"], exc)
        return self.eventos


def passo(estado: dict, abertos, *, motor, capacidade_path, projetos: dict, modelo, agora, mem_disponivel_mb, salvar=None) -> list[dict]:
    """Um ciclo dos consertos: muta `estado["consertos"]` e devolve os eventos de log.

    `abertos` é a lista de `ler_da_resposta`; `None` (envio falhou ou resposta ilegível) só acompanha os que já
    estão em andamento, sem atender novos nem esquecer os finais. `projetos` mapeia o repositório (`fila.json`)
    para o projeto do Warren; `modelo` é o `modelos.fixer` (`None`: nada novo é despachado e sai um evento
    `aviso`). `salvar` grava o `fila-estado.json` (chamado antes de cada POST pago e a cada transição).
    """
    return _Passo(
        estado,
        motor=motor,
        capacidade_path=capacidade_path,
        projetos=projetos,
        modelo=modelo,
        agora=agora,
        mem_disponivel_mb=mem_disponivel_mb,
        salvar=salvar,
    ).rodar(abertos)
