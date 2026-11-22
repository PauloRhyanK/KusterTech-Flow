"""O atendente do Decidir no lado da Fábrica (só stdlib): uma conversa por vez, um run do Warren por réplica.

O estado vive em `fila-estado.json`, na chave `atendente`:

- `atual` (a conversa em atendimento, ou `None`), `ativaAte` (do Flow: a última mensagem do Paulo + 10 min) e
  `semRotaEm` (quando o Flow respondeu 404 na busca: o atendente fica desligado por `REVER_FLOW_SEM_CONVERSAS_S`);
- `atual` guarda a réplica (`conversaId`, `responderA`), o `projeto` do Warren, a `tentativa`, o `motivo` da nova
  tentativa, `cartaoRecusado`, a `fase`, o run (`nonce`, `runId`, `inicio`), a `conversa` vista (para refazer o
  prompt) e `saida`, a caixa de saída: o corpo pronto, com o `id` (uuid4 do kit), gravado antes do `POST`.

Com `atual` preenchido nada novo é despachado nem buscado. O run passa por `despachando` (gravado com o nonce e o
`inicio` antes do `POST` pago) e `respondendo` (com o `runId`); um coordenador reiniciado em `despachando` acha o run
pelo nonce e, sem ele, repete o `POST` com a mesma `Idempotency-Key`. O run não reserva vaga, mas só sai com a
memória livre acima de `ramMinimaMb` e fora da drenagem. Run perdido por infraestrutura: adota o retry do Warren.
Teto de `TETO_ATENDENTE_S` por réplica (contado do primeiro run, somando as novas tentativas), run falho, PR aberto (o Warren não tem modo de leitura) e a segunda resposta fora
do formato viram `{id, emRespostaA, falha}` para o Flow. Cartão recusado (422): um run novo com o motivo do Flow e,
na segunda, a mesma mensagem sem o cartão, com `id` novo. O motor não cancela run: o que passou do teto pode seguir
no Warren até terminar sozinho.
"""

import datetime
import hashlib
import pathlib
import re
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import capacidade  # noqa: E402
import despachante  # noqa: E402
import motor as motor_  # noqa: E402
import prompts  # noqa: E402
from retrato import FORMATO_INSTANTE, FalhaDeEnvio  # noqa: E402

TETO_ATENDENTE_S = 600
REVER_FLOW_SEM_CONVERSAS_S = 3600
INTERVALO_DO_ATENDENTE_S = 3
PAPEL = "atendente"
FASES = ("despachando", "respondendo", "enviando")

MOTIVO_TETO = "o agente passou de 10 min"
MOTIVO_AGENTE = "o agente falhou: %s"
MOTIVO_FORMATO = "a resposta não veio no formato"
MOTIVO_PR = "o agente abriu um PR; resposta descartada"
MOTIVO_SEM_PROJETO = "o repositório %s não está na fila da Fábrica"
MOTIVO_RUN_SUMIU = "run não encontrado no Warren"
LIMITE_MOTIVO_DO_AGENTE = 150
LIMITE_DA_FALHA = 200  # o mesmo do Flow (`LIMITE_DA_FALHA` em src/modules/decidir/contrato.ts)

AVISO_SEM_ROTA = "Atendente: o Flow ainda não tem o Decidir"
AVISO_MEMORIA = "Atendente: memória livre abaixo do mínimo; a conversa espera"
AVISO_DRENAGEM = "Atendente: o Warren está em drenagem; a conversa espera"
AVISO_SEM_MODELO = "Atendente: configure modelos.atendente (agente, modelo, maxCustoUsd) em fabrica/modelos/config.json do kit"
AVISO_PR = "Atendente: o agente abriu um PR (%s); resposta descartada"
AVISO_RECUSA = "Atendente: o Flow recusou a resposta da conversa %s (%s)"
AVISO_ENVIO = "Atendente: a resposta da conversa %s não chega ao Flow há %d tentativas (%s); sigo tentando"
# falhas de envio seguidas (rede, 5xx, 401, 403) até o aviso; a saída fica e o reenvio segue com o mesmo id
LIMITE_FALHAS_DE_ENVIO = 10

_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_INSTANTE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


def nonce_do_motor(conversa_id: str, responder_a: str, tentativa: int) -> str:
    """32 hex (sha256): o formato que o marcador do prompt e a `Idempotency-Key` do Warren aceitam."""
    texto = "atendente:%s:%s:%s" % (conversa_id, responder_a, tentativa)
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()[:32]


def _instante(valor):
    try:
        return datetime.datetime.strptime(valor, FORMATO_INSTANTE).replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


def _texto_do_instante(agora: datetime.datetime) -> str:
    return agora.astimezone(datetime.timezone.utc).strftime(FORMATO_INSTANTE)


def _agora(agora) -> datetime.datetime:
    return agora if isinstance(agora, datetime.datetime) else motor_.instante(agora)


def _instante_valido(valor):
    return valor if isinstance(valor, str) and _INSTANTE.fullmatch(valor) and _instante(valor) else None


def _atual_valido(atual):
    if not isinstance(atual, dict) or atual.get("fase") not in FASES or not isinstance(atual.get("conversa"), dict):
        return None
    for campo in ("conversaId", "responderA"):
        if not isinstance(atual.get(campo), str) or _UUID.fullmatch(atual[campo]) is None:
            return None
    return atual


def _contagem(valor) -> int:
    return valor if isinstance(valor, int) and not isinstance(valor, bool) and valor >= 0 else 0


def secao(estado: dict) -> dict:
    """`estado["atendente"]`, criada (ou consertada): o que não vale volta ao padrão."""
    sec = estado.get("atendente")
    if not isinstance(sec, dict):
        sec = estado["atendente"] = {}
    sec["atual"] = _atual_valido(sec.get("atual"))
    if sec["atual"] is not None:
        sec["atual"]["tentativa"] = _contagem(sec["atual"].get("tentativa"))
    sec["ativaAte"] = _instante_valido(sec.get("ativaAte"))
    sec["semRotaEm"] = _instante_valido(sec.get("semRotaEm"))
    return sec


def ativo(estado: dict, agora) -> bool:
    """Há conversa em atendimento, ou o Paulo escreveu há pouco (`ativaAte` no futuro)? Não muda o estado."""
    sec = estado.get("atendente") if isinstance(estado, dict) else None
    if not isinstance(sec, dict):
        return False
    if _atual_valido(sec.get("atual")) is not None:
        return True
    ate = _instante(_instante_valido(sec.get("ativaAte")))
    return ate is not None and ate > _agora(agora)


def proximo_passo(atual, *, agora) -> str:
    """Puro: o que fazer com a conversa em atendimento."""
    if not isinstance(atual, dict):
        return "buscar"
    if isinstance(atual.get("saida"), dict):
        return "enviar"
    if atual.get("fase") == "despachando":
        return "retomar_despacho"
    if atual.get("fase") == "respondendo":
        return "acompanhar"
    return "buscar"


def _modelo(modelos) -> dict | None:
    try:
        return despachante._validar_modelo(despachante._dict(modelos).get(PAPEL), PAPEL)
    except Exception:  # noqa: BLE001 - sem modelo, a conversa espera com um aviso
        return None


class _Passo:
    def __init__(self, estado, *, cliente, motor, capacidade_path, projetos, modelos, agora, mem_disponivel_mb, salvar):
        self.sec = secao(estado)
        self.cliente = cliente
        self.motor = motor
        self.capacidade = capacidade_path
        self.projetos = {str(k).lower(): v for k, v in (projetos or {}).items()}
        self.modelo = _modelo(modelos)
        self.agora = _agora(agora)
        self.agora_texto = _texto_do_instante(self.agora)
        self.mem_disponivel_mb = mem_disponivel_mb
        self.salvar = salvar or (lambda: None)
        self.eventos = []

    @property
    def atual(self):
        return self.sec["atual"]

    def aviso(self, chave: str, mensagem: str) -> None:
        self.eventos.append({"evento": "aviso", "chave": chave, "mensagem": mensagem[:300]})

    def erro(self, exc) -> None:
        alvo = self.atual.get("conversaId") if isinstance(self.atual, dict) else None
        self.eventos.append({"evento": "erro", "etapa": "atendente", "alvo": alvo, "erro": "%s: %s" % (type(exc).__name__, exc)})

    def rodar(self) -> None:
        sem_rota = _instante(self.sec["semRotaEm"])
        if sem_rota is not None and (self.agora - sem_rota).total_seconds() < REVER_FLOW_SEM_CONVERSAS_S:
            return
        acao = proximo_passo(self.atual, agora=self.agora)
        if acao == "enviar":
            self.enviar()
        elif acao == "retomar_despacho":
            self.retomar_despacho()
        elif acao == "acompanhar":
            self.acompanhar()
        else:
            if self.atual is not None:
                self.sec["atual"] = None
                self.salvar()
            self.buscar()

    # ------------------------------------------------------------ tempo

    def desde(self):
        inicio = _instante(self.atual.get("inicio"))
        return _texto_do_instante(inicio - despachante.MARGEM_DESDE) if inicio is not None else None

    def estourou(self) -> bool:
        """A réplica passou de `TETO_ATENDENTE_S` desde o primeiro run (ou o `inicio` é ilegível)?"""
        inicio = _instante(self.atual.get("inicio"))
        return inicio is None or (self.agora - inicio).total_seconds() > TETO_ATENDENTE_S

    # ------------------------------------------------------------ busca e despacho

    def pode_despachar(self) -> bool:
        """Modelo, drenagem e memória (o run não reserva vaga, mas também usa a máquina)."""
        if self.modelo is None:
            self.aviso("atendente:modelo", AVISO_SEM_MODELO)
            return False
        cap = capacidade.ler(self.capacidade)
        if cap.get("drenagem"):
            self.aviso("atendente:drenagem", AVISO_DRENAGEM)
            return False
        minima = cap.get("ramMinimaMb") or 0
        if self.mem_disponivel_mb is not None and self.mem_disponivel_mb < minima:
            self.aviso("atendente:memoria", AVISO_MEMORIA)
            return False
        return True

    def buscar(self) -> None:
        resposta = self.cliente.buscar_conversas()
        if resposta is None:
            primeira = self.sec["semRotaEm"] is None
            self.sec["semRotaEm"] = self.agora_texto
            self.salvar()
            if primeira:
                self.aviso("atendente:sem-rota", AVISO_SEM_ROTA)
            return
        self.sec["semRotaEm"] = None
        self.sec["ativaAte"] = _instante_valido(resposta.get("ativaAte"))
        self.salvar()
        conversas = resposta.get("conversas") or []
        if not conversas:
            return
        conversa = conversas[0]
        base = {
            "conversaId": conversa["id"],
            "responderA": conversa["responderA"],
            "projeto": None,
            "tentativa": 0,
            "motivo": None,
            "cartaoRecusado": False,
            "fase": "despachando",
            "nonce": None,
            "runId": None,
            "inicio": None,
            "conversa": conversa,
            "saida": None,
        }
        projeto = self.projetos.get(str(conversa["repositorio"]).lower())
        if projeto is None:
            self.sec["atual"] = base
            self.falhou(MOTIVO_SEM_PROJETO % conversa["repositorio"])
            return
        if not self.pode_despachar():
            return
        self.sec["atual"] = dict(base, projeto=projeto)
        self.preparar(0, None)

    def preparar(self, tentativa: int, motivo) -> None:
        """`despachando` com o nonce e o início no disco antes do `POST` pago; depois, o `POST`.

        O teto é da réplica: a nova tentativa (formato, cartão) guarda o `inicio` do primeiro run.
        """
        a = self.atual
        inicio = a.get("inicio") if tentativa > 0 and _instante(a.get("inicio")) is not None else self.agora_texto
        a.update(
            fase="despachando",
            tentativa=tentativa,
            motivo=motivo,
            nonce=nonce_do_motor(a["conversaId"], a["responderA"], tentativa),
            inicio=inicio,
            runId=None,
            saida=None,
        )
        a.pop("retryEsperado", None)
        a.pop("retryDe", None)
        self.salvar()
        if self.pode_despachar():
            self.despachar()

    def despachar(self) -> None:
        a = self.atual
        prompt = prompts.prompt_atendente(conversa=a["conversa"], motivo=a.get("motivo"))
        run_id = self.motor.despachar_run(
            projeto=a["projeto"],
            agente=self.modelo["agente"],
            modelo=self.modelo["modelo"],
            prompt=despachante._com_nonce(prompt, a["nonce"]),
            branch_existente=None,
            max_custo_usd=self.modelo["maxCustoUsd"],
            chave_idempotencia=a["nonce"],
        )
        self.com_run(run_id)

    def com_run(self, run_id: str) -> None:
        a = self.atual
        a.update(fase="respondendo", runId=run_id)
        self.salvar()
        self.eventos.append({"evento": "atendente_run", "conversaId": a["conversaId"], "responderA": a["responderA"], "runId": run_id, "tentativa": a["tentativa"]})

    def retomar_despacho(self) -> None:
        """`despachando` herdado (o `POST` pode ter criado o run): adota pelo nonce ou repete com a mesma chave."""
        try:
            run_id = self.motor.procurar_run(self.atual["projeto"], self.atual["nonce"], self.desde())
        except Exception:
            if self.estourou():
                self.falhou(MOTIVO_TETO)
                return
            raise
        if run_id is not None:
            self.com_run(run_id)
        elif self.estourou():
            self.falhou(MOTIVO_TETO)
        elif self.pode_despachar():
            self.despachar()

    # ------------------------------------------------------------ acompanhamento

    def acompanhar(self) -> None:
        a = self.atual
        try:
            run = self.motor.run(a["runId"])
        except Exception as exc:
            if despachante._eh_404(exc):
                self.falhou(MOTIVO_AGENTE % MOTIVO_RUN_SUMIU)
            elif self.estourou():
                self.falhou(MOTIVO_TETO)
            else:
                raise
            return
        run = despachante._dict(run)
        situacao = run.get("estado")
        if situacao == "failed" and run.get("motivoFalha") in motor_.MOTIVOS_INFRA_PERDIDA and not a.get("retryDe"):
            if self.esperar_retry():
                return
        if situacao == "succeeded":
            pr = run.get("prUrl")
            if pr:
                self.aviso("atendente:pr", AVISO_PR % pr)
                self.falhou(MOTIVO_PR)
                return
            acoes = (a["conversa"].get("item") or {}).get("acoes") or []
            try:
                texto = self.motor.ultimo_texto(a["runId"])
            except Exception:
                if self.estourou():
                    self.falhou(MOTIVO_TETO)
                    return
                raise
            lida = prompts.extrair_resposta_do_atendente(texto, acoes)
            if lida is not None:
                self.pronta(dict(id=str(uuid.uuid4()), emRespostaA=a["responderA"], **lida))
            elif a["tentativa"] == 0:
                self.preparar(1, MOTIVO_FORMATO)
            else:
                self.falhou(MOTIVO_FORMATO)
        elif situacao in despachante.TERMINAIS_DE_RUN:
            self.falhou(MOTIVO_AGENTE % despachante.motivo_do_run_falho(run)[:LIMITE_MOTIVO_DO_AGENTE])
        elif self.estourou():
            self.falhou(MOTIVO_TETO)

    def esperar_retry(self) -> bool:
        """Adota o retry do Warren ou espera (`despachante.esperar_retry_do_item`); `False` = vale o run falho."""
        a = self.atual
        original = a["runId"]
        resultado, valor = despachante.esperar_retry_do_item(
            a, motor=self.motor, projeto=a["projeto"], nonces=[a["nonce"]], desde=self.desde(), agora=self.agora, salvar=self.salvar
        )
        if resultado == "desistir":
            return False
        if resultado == "adotado":
            self.eventos.append({"evento": "atendente_retry_adotado", "conversaId": a["conversaId"], "original": original, "runId": valor})
        elif self.estourou():
            self.falhou(MOTIVO_TETO)
        elif resultado == "busca_falhou":
            self.erro(valor)
        return True

    # ------------------------------------------------------------ caixa de saída

    def falhou(self, motivo: str) -> None:
        self.pronta({"id": str(uuid.uuid4()), "emRespostaA": self.atual["responderA"], "falha": motivo[:LIMITE_DA_FALHA]})

    def pronta(self, saida: dict) -> None:
        """A saída vai para o disco antes do `POST`; um coordenador reiniciado reenvia o mesmo `id`."""
        a = self.atual
        a.update(fase="enviando", saida=saida, runId=None)
        a.pop("retryEsperado", None)
        self.salvar()
        self.enviar()

    def enviar(self) -> None:
        a = self.atual
        saida = a["saida"]
        try:
            resultado = self.cliente.responder(a["conversaId"], saida)
        except FalhaDeEnvio as exc:
            # a saída fica: sai no ciclo seguinte com o mesmo id; passado o limite, um aviso só
            falhas = a["falhasDeEnvio"] = _contagem(a.get("falhasDeEnvio")) + 1
            self.salvar()
            self.erro(exc)
            if falhas == LIMITE_FALHAS_DE_ENVIO:
                self.aviso("atendente:envio", AVISO_ENVIO % (a["conversaId"], falhas, exc))
            return
        a.pop("falhasDeEnvio", None)
        if resultado == "recusado":
            motivo_do_cartao = getattr(self.cliente, "ultimo_motivo_do_cartao", None)
            if motivo_do_cartao and saida.get("cartao") is not None:
                if not a.get("cartaoRecusado"):
                    a["cartaoRecusado"] = True
                    self.preparar(a["tentativa"] + 1, motivo_do_cartao)
                else:
                    # a outra foi recusada (nada gravado no Flow): a mesma mensagem, sem o cartão e com id novo
                    self.pronta(dict(saida, id=str(uuid.uuid4()), cartao=None))
                return
            erro = getattr(self.cliente, "ultima_recusa", None) or "sem motivo"
            self.aviso("atendente:recusa", AVISO_RECUSA % (a["conversaId"], erro))
        self.eventos.append(
            {"evento": "atendente_resposta", "conversaId": a["conversaId"], "emRespostaA": saida.get("emRespostaA"), "resultado": resultado, "falha": saida.get("falha")}
        )
        self.sec["atual"] = None
        self.salvar()


def passo(estado: dict, *, cliente, motor, capacidade_path, projetos: dict, modelos: dict, agora, mem_disponivel_mb, salvar) -> list[dict]:
    """Um ciclo do atendente: envia a saída pronta, acompanha o run ou busca a próxima conversa. Devolve os eventos.

    `cliente` é o `ClienteDasConversas`; `projetos` mapeia o repositório (`fila.json`) para o projeto do Warren;
    `modelos` é o `modelos` de `<kit>/fabrica/modelos/config.json` (papel `atendente`). Nunca levanta: falha de envio,
    de busca ou do motor vira evento `erro` e o ciclo seguinte refaz a partir do estado gravado.
    """
    p = None
    try:
        p = _Passo(
            estado,
            cliente=cliente,
            motor=motor,
            capacidade_path=capacidade_path,
            projetos=projetos,
            modelos=modelos,
            agora=agora,
            mem_disponivel_mb=mem_disponivel_mb,
            salvar=salvar,
        )
        p.rodar()
    except Exception as exc:  # noqa: BLE001 - o atendente não derruba o ciclo do coordenador
        if p is None:
            return [{"evento": "erro", "etapa": "atendente", "alvo": None, "erro": "%s: %s" % (type(exc).__name__, exc)}]
        p.erro(exc)
    return p.eventos
