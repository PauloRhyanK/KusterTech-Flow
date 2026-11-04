"""Estado do despachante e decisão das próximas ações (funções puras, só biblioteca padrão).

Toda função pública copia a entrada com `copy.deepcopy` e devolve um estado novo.
Observações malformadas nunca levantam exceção: são ignoradas e viram um aviso.
"""

import copy
import datetime
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import gates  # noqa: E402
import raias  # noqa: E402

TIMEOUT_DE_MERGE = "child_pr_merge_timeout"
OOM = "oom_killed"
MAX_RETOMADAS = 3
MAX_TENTATIVAS_REVISAO = 2
MAX_RECUSAS_DE_MERGE = 3
MAX_FALHAS_ACORDAR = 3
MAX_INTERRUPCOES = 3
TERMINAIS = ("mergeada", "obsoleta")
ESTADOS_DE_GATE = ("em_revisao", "aguardando_gates", "corrigindo")
MOTIVOS_DO_PAULO = ("nova_spec", "fase_concluida")
PREFIXOS_DO_ORQUESTRADOR = (".fabrica/", ".seeds/")
PERGUNTA_DO_ORQUESTRADOR = ".fabrica/pergunta.md"
# F1: CI "ausente" logo depois de um head novo aguarda os checks por até 10 min antes de ir para o humano
ESPERA_CI_AUSENTE = datetime.timedelta(minutes=10)
# F2c: a partir de 2 replanejamentos da raia, a próxima falha dela vai para o Paulo, não para o orquestrador
MAX_REPLANEJAMENTOS = 2


def _raia_nova(plano_seeds=None) -> dict:
    return {
        "estado": "planejada",
        "planRunId": None,
        "retomar": False,
        "retomadas": 0,
        "falha": None,
        "planoSeeds": plano_seeds,
    }


def _seed_nova(raia_id: str) -> dict:
    return {
        "raia": raia_id,
        "estado": "executando",
        "runId": None,
        "pr": None,
        "branch": None,
        "headSha": None,
        "arquivos": [],
        "ci": None,
        "verificacao": None,
        "veredito": None,
        "vereditoAnterior": None,
        "revisaoRunId": None,
        "tentativasRevisao": 0,
        "fixerRunId": None,
        "fixerUsado": False,
        "tentativasMerge": 0,
        "interrupcoes": 0,
        "pendenteHumano": None,
        "motivoHumano": None,
    }


def _texto(valor) -> bool:
    return isinstance(valor, str) and valor != ""


def _inteiro(valor) -> bool:
    return isinstance(valor, int) and not isinstance(valor, bool)


def _lista(valor) -> list:
    return valor if isinstance(valor, list) else []


def _dict(valor) -> dict:
    return valor if isinstance(valor, dict) else {}


def _avisar(estado: dict, mensagem: str) -> None:
    """Acrescenta o aviso uma única vez (as observações se repetem a cada ciclo)."""
    if not isinstance(estado.get("avisos"), list):
        estado["avisos"] = []
    if mensagem not in estado["avisos"]:
        estado["avisos"].append(mensagem)


def _reiniciada(raia: dict, plano_seeds) -> dict:
    """F2c: a raia nova de um replanejamento (planoSeeds novo) leva o contador de replanejamentos + 1."""
    anteriores = raia.get("replanejamentos")
    nova = _raia_nova(plano_seeds)
    nova["replanejamentos"] = (anteriores if _inteiro(anteriores) and anteriores >= 0 else 0) + 1
    return nova


def _raias_do_plano(plano) -> list[tuple[str, object]]:
    """(id, planoSeeds) de cada raia bem formada do plano, na ordem do plano."""
    return [
        (r["id"], r.get("planoSeeds") if _texto(r.get("planoSeeds")) else None)
        for r in _lista(_dict(plano).get("raias"))
        if isinstance(r, dict) and _texto(r.get("id"))
    ]


def _raias(estado: dict) -> dict:
    if not isinstance(estado.get("raias"), dict):
        estado["raias"] = {}
    return estado["raias"]


def _seeds(estado: dict) -> dict:
    if not isinstance(estado.get("seeds"), dict):
        estado["seeds"] = {}
    return estado["seeds"]


def _seed(estado: dict, seed_id, origem: str):
    seed = _seeds(estado).get(seed_id) if isinstance(seed_id, str) else None
    if not isinstance(seed, dict):
        _avisar(estado, f"{origem}: seed desconhecida {seed_id!r}")
        return None
    return seed


def _raia(estado: dict, raia_id, origem: str):
    raia = _raias(estado).get(raia_id) if isinstance(raia_id, str) else None
    if not isinstance(raia, dict):
        _avisar(estado, f"{origem}: raia desconhecida {raia_id!r}")
        return None
    return raia


def _pedir_humano(estado: dict, seed_id: str, seed: dict, motivo: str) -> None:
    """Marca a seed para `aguardar_humano`: a decisão sai como ação e vira issue para o Paulo."""
    seed["pendenteHumano"] = motivo
    _avisar(estado, f"seed {seed_id!r}: {motivo}")


def _baixar_limite_por_oom(estado: dict, run_id) -> None:
    limite = estado.get("limiteParalelo")
    estado["limiteParalelo"] = min(limite, 2) if _inteiro(limite) else 2
    _avisar(estado, f"run {run_id!r} terminou com oom_killed: limite de paralelismo baixou para 2")


# ---------------------------------------------------------------- criação


def novo_estado(plano: dict, *, projeto: str, repo: str, limite_paralelo: int = 3) -> dict:
    plano = copy.deepcopy(plano)
    return {
        "projeto": projeto,
        "repo": repo,
        "limiteParalelo": limite_paralelo,
        "pausado": None,
        "raias": {id_: _raia_nova(ps) for id_, ps in _raias_do_plano(plano)},
        "seeds": {},
        "orquestrador": {"runId": None, "motivo": None},
        "chavesAcordadas": [],
        "falhasAcordar": 0,
        "runsOom": [],
        "avisos": [],
        "decisoes": [],
    }


def sincronizar_plano(estado: dict, plano: dict) -> dict:
    """Acrescenta as raias novas como `planejada` e preserva as existentes.

    Exceção: uma raia `falhou` cujo `planoSeeds` mudou volta a `planejada` (é a nova tentativa
    que o orquestrador planejou), a chave `raia_falhou:<id>` sai de `chavesAcordadas` e as seeds não
    mergeadas da tentativa anterior saem do estado (ids em `seedsSubstituidas`). Isso só
    vale depois de o orquestrador ter sido acordado por essa falha e sem run dele em curso; senão
    a raia fica `falhou` e o fluxo normal emite `acordar raia_falhou`.
    """
    estado = copy.deepcopy(estado)
    raias_do_estado = _raias(estado)
    for id_, plano_seeds in _raias_do_plano(copy.deepcopy(plano)):
        raia = raias_do_estado.get(id_)
        if not isinstance(raia, dict):
            raias_do_estado[id_] = _raia_nova(plano_seeds)
        elif raia.get("estado") == "planejada":
            raia["planoSeeds"] = plano_seeds
        elif (
            raia.get("estado") == "falhou"
            and plano_seeds is not None
            # sem o planoSeeds antigo não dá para saber se é outro plano: fica falhou
            and _texto(raia.get("planoSeeds"))
            and plano_seeds != raia["planoSeeds"]
            # só depois de o orquestrador ter visto esta falha e terminado o run (replanejou depois dela)
            and _chave("raia_falhou", id_) in _lista(estado.get("chavesAcordadas"))
            and _dict(estado.get("orquestrador")).get("runId") is None
        ):
            raias_do_estado[id_] = _reiniciada(raia, plano_seeds)
            chave = _chave("raia_falhou", id_)
            estado["chavesAcordadas"] = [c for c in _lista(estado.get("chavesAcordadas")) if c != chave]
            raias_do_estado[id_]["seedsSubstituidas"] = _remover_tentativa(estado, id_, avisar=True)
    return estado


def _remover_tentativa(estado: dict, raia_id: str, *, avisar: bool) -> list[str]:
    """Tira do estado as seeds não mergeadas da tentativa anterior da raia e devolve os ids.

    Fora do estado elas nunca mais recebem ação (nem merge), e um id reaproveitado pelo plano novo
    começa limpo. As mergeadas ficam, para a contabilidade.
    """
    seeds = _seeds(estado)
    removidas = []
    for seed_id in list(seeds):
        seed = seeds[seed_id]
        if not isinstance(seed, dict) or seed.get("raia") != raia_id or seed.get("estado") == "mergeada":
            continue
        if avisar and _texto(seed.get("pr")) and seed.get("estado") != "obsoleta":
            _avisar(estado, f"PR {seed['pr']} da tentativa anterior da raia {raia_id} ficou obsoleto; feche-o")
        del seeds[seed_id]
        removidas.append(seed_id)
    return removidas


def substituir_raia(estado: dict, raia_id: str, plano_seeds: str) -> dict:
    """Replanejamento de uma raia `executando`: ela volta a `planejada` com o `planoSeeds` novo.

    As seeds não mergeadas da tentativa anterior saem do estado (ids em `seedsSubstituidas`). Quem
    chama cancela o Plan Run antigo e fecha os PRs dessas seeds antes.
    """
    estado = copy.deepcopy(estado)
    raia = _raia(estado, raia_id, "substituir_raia")
    if raia is None:
        return estado
    if not _texto(plano_seeds):
        _avisar(estado, f"substituir_raia: planoSeeds inválido {plano_seeds!r} para a raia {raia_id!r}")
        return estado
    if raia.get("estado") != "executando":
        _avisar(estado, f"substituir_raia: raia {raia_id!r} não está executando")
        return estado
    _raias(estado)[raia_id] = _reiniciada(raia, plano_seeds)
    _raias(estado)[raia_id]["seedsSubstituidas"] = _remover_tentativa(estado, raia_id, avisar=False)
    return estado


# ---------------------------------------------------------------- observações


def _nova_tentativa(seeds: dict, seed_id: str, seed: dict) -> dict:
    """Seed zerada para uma nova tentativa: só a raia e o runId sobrevivem."""
    nova = _seed_nova(seed.get("raia"))
    nova["runId"] = seed.get("runId")
    seeds[seed_id] = nova
    return nova


def _registrar_filho(estado: dict, raia_id: str, filho) -> None:
    if not isinstance(filho, dict) or not _texto(filho.get("seedId")):
        _avisar(estado, f"raia {raia_id!r}: filho malformado ignorado: {filho!r}")
        return
    seed_id = filho["seedId"]
    if filho.get("falha") == OOM:
        run_id = filho.get("runId")
        if not isinstance(estado.get("runsOom"), list):
            estado["runsOom"] = []
        if run_id not in estado["runsOom"]:
            if _texto(run_id):
                estado["runsOom"].append(run_id)
            _baixar_limite_por_oom(estado, run_id)
    obs = filho.get("estado")
    if obs == "pending":
        return
    if obs not in ("dispatched", "running", "pr_open", "merged", "failed"):
        _avisar(estado, f"seed {seed_id!r}: estado do Warren desconhecido {obs!r}")
        return
    seeds = _seeds(estado)
    if not isinstance(seeds.get(seed_id), dict):
        seeds[seed_id] = _seed_nova(raia_id)
    seed = seeds[seed_id]
    atual = seed.get("estado")
    if atual in TERMINAIS:
        return  # mergeada ou obsoleta: nada que o Warren diga muda a seed
    run_id = filho.get("runId")
    run_novo = _texto(run_id) and run_id != seed.get("runId")
    if _texto(run_id):
        seed["runId"] = run_id
    if obs in ("dispatched", "running"):
        if run_novo:
            # o Warren redespachou a seed: nada da tentativa anterior vale para a nova
            _nova_tentativa(seeds, seed_id, seed)
    elif obs == "pr_open":
        url = filho.get("prUrl")
        if not _texto(url):
            if atual == "executando":
                _avisar(estado, f"seed {seed_id!r}: pr_open sem prUrl")
            return
        if url != seed.get("pr"):
            # PR novo: reinicia os campos da tentativa, qualquer que seja o estado
            seed = _nova_tentativa(seeds, seed_id, seed)
            seed["estado"] = "em_revisao"
            seed["pr"] = url
    elif obs == "merged":
        seed["estado"] = "mergeada"
    elif obs == "failed":
        seed["estado"] = "falhou"


def registrar_plano(
    estado: dict, raia_id: str, *, estado_plano: str, falha: str | None, filhos: list[dict]
) -> dict:
    """`filhos`: `{"seedId", "estado", "runId", "prUrl"}` e, opcional, `"falha"` (failureReason)."""
    estado = copy.deepcopy(estado)
    filhos = copy.deepcopy(filhos)
    raia = _raia(estado, raia_id, "registrar_plano")
    if raia is None:
        return estado
    if raia.get("estado") != "executando":
        _avisar(estado, f"registrar_plano: raia {raia_id!r} não está executando")
        return estado
    if not isinstance(filhos, list):
        _avisar(estado, f"raia {raia_id!r}: filhos malformados")
        filhos = []
    for filho in filhos:
        _registrar_filho(estado, raia_id, filho)

    if estado_plano == "succeeded":
        raia["estado"] = "concluida"
        raia["retomar"] = False
    elif estado_plano == "failed" and falha == TIMEOUT_DE_MERGE:
        raia["falha"] = falha
        retomadas = raia.get("retomadas")
        if _inteiro(retomadas) and retomadas < MAX_RETOMADAS:
            raia["retomar"] = True
        else:
            raia["estado"] = "falhou"
            raia["retomar"] = False
    elif estado_plano in ("failed", "cancelled"):
        raia["estado"] = "falhou"
        raia["falha"] = falha if falha is not None else estado_plano
        raia["retomar"] = False
    return estado


def registrar_pr(
    estado: dict, seed_id: str, *, head_sha: str, branch: str, arquivos: list[str], ci: str | None, agora=None
) -> dict:
    """`agora` (datetime): F1, a hora em que o head foi visto pela primeira vez vai para `headVistoEm`."""
    estado = copy.deepcopy(estado)
    seed = _seed(estado, seed_id, "registrar_pr")
    if seed is None:
        return estado
    if _texto(head_sha):
        anterior = seed.get("headSha")
        if _texto(anterior) and anterior != head_sha:
            seed["tentativasMerge"] = 0  # head novo: as recusas eram do head antigo
            seed["interrupcoes"] = 0
        if anterior != head_sha or not _texto(seed.get("headVistoEm")):
            seed["headVistoEm"] = agora.isoformat() if isinstance(agora, datetime.datetime) else None
        seed["headSha"] = head_sha
    else:
        # sem head legível nenhum gate vale e nenhuma ação é emitida para a seed
        seed["headSha"] = None
        _avisar(estado, f"seed {seed_id!r}: head SHA ilegível {head_sha!r}")
    seed["branch"] = copy.deepcopy(branch)
    seed["arquivos"] = copy.deepcopy(arquivos)
    seed["ci"] = copy.deepcopy(ci)
    return estado


def registrar_verificacao(estado: dict, seed_id: str, verificacao: dict) -> dict:
    estado = copy.deepcopy(estado)
    seed = _seed(estado, seed_id, "registrar_verificacao")
    if seed is not None:
        seed["verificacao"] = copy.deepcopy(verificacao)
    return estado


def _contar_interrupcao(estado: dict, seed_id: str, seed: dict, motivo_falha) -> None:
    """OOM repetido na mesma seed vai para o Paulo; a cota não conta (já pausa tudo)."""
    if motivo_falha != OOM:
        return
    n = seed.get("interrupcoes")
    n = (n if _inteiro(n) and n >= 0 else MAX_INTERRUPCOES - 1) + 1
    seed["interrupcoes"] = n
    if n >= MAX_INTERRUPCOES:
        _pedir_humano(estado, seed_id, seed, "OOM repetido no fixer/revisor")


def registrar_fim_de_run(
    estado: dict,
    run_id: str,
    *,
    estado_run: str,
    motivo_falha: str | None,
    veredito: dict | None,
    cota: bool,
) -> dict:
    estado = copy.deepcopy(estado)
    veredito = copy.deepcopy(veredito)
    # cota e OOM são do ambiente, não da seed: o run é refeito, sem gastar tentativa
    interrompido = estado_run != "succeeded" and (bool(cota) or motivo_falha == OOM)
    achou = _texto(run_id) and _dict(estado.get("orquestrador")).get("runId") == run_id
    for seed_id, seed in _seeds(estado).items():
        if not isinstance(seed, dict) or not _texto(run_id):
            continue
        if seed.get("revisaoRunId") == run_id:
            achou = True
            seed["revisaoRunId"] = None
            if interrompido:
                tentativas = seed.get("tentativasRevisao")
                if _inteiro(tentativas) and tentativas > 0:
                    seed["tentativasRevisao"] = tentativas - 1
                _contar_interrupcao(estado, seed_id, seed, motivo_falha)
            elif (
                estado_run == "succeeded"
                and isinstance(veredito, dict)
                and seed.get("estado") in ESTADOS_DE_GATE
                # F4: só vale o veredito do sha pedido na revisão; outro sha é revisão sem veredito válido
                and _texto(seed.get("revisaoSha"))
                and veredito.get("sha") == seed.get("revisaoSha")
            ):
                seed["veredito"] = veredito
                seed["estado"] = "aguardando_gates"
        elif seed.get("fixerRunId") == run_id:
            achou = True
            seed["fixerRunId"] = None
            if interrompido:
                # o fixer volta a ser emitido: devolve o veredito que o motivou
                seed["fixerUsado"] = False
                seed["veredito"] = seed.get("vereditoAnterior")
                _contar_interrupcao(estado, seed_id, seed, motivo_falha)
            elif estado_run == "succeeded":
                seed["veredito"] = None  # o head mudou: o próximo ciclo pede revisão nova
            elif seed.get("estado") not in TERMINAIS:
                seed["estado"] = "falhou"
                # os achados que o fixer não resolveu vão para o orquestrador
                seed["veredito"] = seed.get("vereditoAnterior")
                _avisar(estado, f"seed {seed_id!r}: fixer terminou em {estado_run!r}")
            seed["vereditoAnterior"] = None
    if not achou:
        _avisar(estado, f"registrar_fim_de_run: run desconhecido {run_id!r}")
    if motivo_falha == OOM:
        _baixar_limite_por_oom(estado, run_id)
    if cota:  # pausar é o lado seguro: qualquer valor verdadeiro pausa
        estado["pausado"] = "cota"
        _avisar(estado, f"run {run_id!r} bateu cota do provedor: despachante pausado")
    return estado


def concluir_orquestrador(estado: dict) -> dict:
    """Encerra o run do orquestrador: limpa `runId` e guarda o motivo em `ultimoMotivo`."""
    estado = copy.deepcopy(estado)
    orquestrador = _dict(estado.get("orquestrador"))
    if orquestrador.get("runId") is None and "runId" in orquestrador:
        return estado
    estado["orquestrador"] = {
        "runId": None,
        "motivo": None,
        "ultimoMotivo": orquestrador.get("motivo"),
    }
    return estado


# ---------------------------------------------------------------- decisão


def _chave(motivo, alvo) -> str:
    return f"{motivo}:{alvo}"


def _ci_ausente_recente(seed: dict, agora) -> bool:
    """F1: o head foi visto há menos de 10 min (relógio e marca legíveis e do mesmo tipo; senão, False)."""
    if not isinstance(agora, datetime.datetime) or not _texto(seed.get("headVistoEm")):
        return False
    try:
        decorrido = agora - datetime.datetime.fromisoformat(seed["headVistoEm"])
    except (TypeError, ValueError):
        return False
    return datetime.timedelta(0) <= decorrido < ESPERA_CI_AUSENTE


def _acoes_da_seed(seed_id: str, seed: dict, protegidos, agora=None, ci_opcional=False) -> list[dict]:
    head = seed.get("headSha")
    r = gates.avaliar_merge(
        head_sha=head,
        ci=seed.get("ci"),
        verificacao=seed.get("verificacao"),
        veredito=seed.get("veredito"),
        arquivos=seed.get("arquivos"),
        protegidos=protegidos,
        ci_ausente_recente=_ci_ausente_recente(seed, agora),
        ci_opcional=ci_opcional,
    )
    decisao = r["decisao"]
    if decisao == "mergear":
        return [{"tipo": "mergear", "seed": seed_id, "sha": head}]
    if decisao == "humano":
        return [{"tipo": "aguardar_humano", "seed": seed_id, "motivos": list(r["motivos"])}]
    if decisao == "corrigir":
        if seed.get("fixerUsado") is False:
            achados = _dict(seed.get("veredito")).get("achados")
            return [
                {
                    "tipo": "corrigir",
                    "seed": seed_id,
                    "sha": head,
                    "motivos": list(r["motivos"]),
                    "achados": copy.deepcopy(achados) if isinstance(achados, list) else [],
                }
            ]
        return [{"tipo": "acordar", "motivo": "gate_falhou_apos_fixer", "alvo": seed_id}]
    if decisao != "aguardar":
        return [{"tipo": "aguardar_humano", "seed": seed_id, "motivos": [f"decisão desconhecida {decisao!r}"]}]
    acoes = []
    if "revisao" in r["faltando"]:
        tentativas = seed.get("tentativasRevisao")
        if not (_inteiro(tentativas) and tentativas < MAX_TENTATIVAS_REVISAO):
            return [{"tipo": "aguardar_humano", "seed": seed_id, "motivos": ["revisor sem veredito válido"]}]
        acoes.append({"tipo": "revisar", "seed": seed_id, "sha": head})
    if "verificacao" in r["faltando"]:
        acoes.append({"tipo": "verificar", "seed": seed_id, "sha": head})
    return acoes


def _fase_atual(plano: dict):
    """(id, ids de raia) da fase atual, ou (None, []) se ela não existir."""
    for fase in _lista(plano.get("fases")):
        if isinstance(fase, dict) and fase.get("id") == plano.get("faseAtual"):
            return fase["id"], [i for i in _lista(fase.get("raias")) if isinstance(i, str)]
    return None, []


def proximas_acoes(
    estado: dict, plano: dict, protegidos: list[str], agora=None, ci_opcional=False, resolver_travas=False
) -> list[dict]:
    """Ações na ordem: 1 seeds, 2 retomar, 3 despachar, 4 fixer que não resolveu, 5 raia falhou, 6 fase concluída.

    `agora` (datetime) liga a janela de 10 min do CI "ausente" (F1); sem ele, "ausente" vai para o humano.
    """
    estado = copy.deepcopy(estado)
    plano = _dict(copy.deepcopy(plano))
    protegidos = copy.deepcopy(protegidos)
    if estado.get("pausado"):
        return []
    acoes: list[dict] = []
    raias_do_estado = {i: r for i, r in _raias(estado).items() if isinstance(r, dict)}

    # 1. seeds: decisões humanas pendentes e gates dos PRs
    for seed_id, seed in _seeds(estado).items():
        if not isinstance(seed, dict):
            continue
        pendente = seed.get("pendenteHumano")
        # a trava vai ao orquestrador; o `acordar` repetido é descartado no fim e o vigia do despachante decide quando
        # chamar o Paulo, depois de dar tempo ao que o orquestrador fez
        vai_ao_orquestrador = resolver_travas is True
        if pendente and seed.get("estado") not in TERMINAIS + ("bloqueada_humano",):
            if vai_ao_orquestrador:
                acoes.append({"tipo": "acordar", "motivo": "seed_parada", "alvo": seed_id})
                continue
            motivo = pendente if _texto(pendente) else "decisão humana necessária"
            acoes.append({"tipo": "aguardar_humano", "seed": seed_id, "motivos": [motivo]})
            continue
        if (
            seed.get("estado") in ESTADOS_DE_GATE
            and seed.get("revisaoRunId") is None
            and seed.get("fixerRunId") is None
            and _texto(seed.get("headSha"))
        ):
            raia_falhou = _dict(raias_do_estado.get(seed.get("raia"))).get("estado") == "falhou"
            for a in _acoes_da_seed(seed_id, seed, protegidos, agora, ci_opcional):
                # raia falha: quem decide o destino do PR é o orquestrador
                if raia_falhou and a["tipo"] == "mergear":
                    continue
                if vai_ao_orquestrador and a["tipo"] == "aguardar_humano" and a["motivos"] == ["revisor sem veredito válido"]:
                    a = {"tipo": "acordar", "motivo": "seed_parada", "alvo": seed_id}
                acoes.append(a)

    executando = [i for i, r in raias_do_estado.items() if r.get("estado") == "executando"]

    # 2. retomar raias depois do timeout de merge
    for id_ in executando:
        if raias_do_estado[id_].get("retomar") is True:
            acoes.append({"tipo": "retomar_raia", "raia": id_})

    # 3. raias novas, até o limite de paralelismo
    limite = estado.get("limiteParalelo")
    vagas = limite - len(executando) if _inteiro(limite) else 0
    if vagas > 0:
        concluidas = {i for i, r in raias_do_estado.items() if r.get("estado") == "concluida"}
        prontas = [
            i
            for i in raias.raias_prontas(plano, concluidas, set(executando))
            if i in raias_do_estado and raias_do_estado[i].get("estado") == "planejada"
        ]
        acoes.extend({"tipo": "despachar_raia", "raia": i} for i in prontas[:vagas])

    # 4. fixer que não resolveu: sem PR novo para os gates, quem decide é o orquestrador
    for seed_id, seed in _seeds(estado).items():
        if (
            isinstance(seed, dict)
            and seed.get("estado") == "falhou"
            and seed.get("fixerUsado") is True
            and not seed.get("pendenteHumano")
            and _texto(seed.get("pr"))
            and _dict(raias_do_estado.get(seed.get("raia"))).get("estado") == "executando"
        ):
            acoes.append({"tipo": "acordar", "motivo": "gate_falhou_apos_fixer", "alvo": seed_id})

    # 5. raias que falharam
    for id_, raia in raias_do_estado.items():
        if raia.get("estado") == "falhou":
            acoes.append({"tipo": "acordar", "motivo": "raia_falhou", "alvo": id_})

    # 6. fase atual concluída
    fase_id, membros = _fase_atual(plano)
    if membros and all(
        raias_do_estado.get(m, {}).get("estado") == "concluida" for m in membros
    ):
        acoes.append({"tipo": "acordar", "motivo": "fase_concluida", "alvo": fase_id})

    # um só orquestrador: no máximo um `acordar`, nunca com outro em curso nem repetido
    orquestrador_livre = _dict(estado.get("orquestrador")).get("runId") is None
    chaves = _lista(estado.get("chavesAcordadas"))
    final, acordou = [], False
    for acao in acoes:
        if acao["tipo"] == "acordar":
            if acordou or not orquestrador_livre or _chave(acao["motivo"], acao["alvo"]) in chaves:
                continue
            acordou = True
        final.append(acao)
    return final


def _vazia(valor) -> bool:
    """Lista vazia ou ausente; qualquer outro valor (inclusive um tipo errado) conta como não vazia."""
    return valor is None or valor == []


def plano_concluido(estado: dict, plano: dict) -> bool:
    """O plano terminou: última fase com as raias concluídas, homologada, e nada em curso nem aberto.

    "Homologada" é a acordada `fase_concluida:<faseAtual>` já em `chavesAcordadas`; o orquestrador
    precisa estar livre (`runId` None), sem acordadas na fila, decisões abertas, intenções de decisão
    (`decisoesPendentes`) nem PR ou issue esperando o fechamento (`prsParaFechar`, que o despachante
    esvazia mesmo quando desiste depois de `MAX_TENTATIVAS_DE_FECHAR`). Entrada malformada é `False`.
    """
    if not isinstance(estado, dict) or not isinstance(plano, dict):
        return False
    fases = _lista(plano.get("fases"))
    ultima = fases[-1] if fases else None
    fase_id = plano.get("faseAtual")
    if not isinstance(ultima, dict) or not _texto(fase_id) or ultima.get("id") != fase_id:
        return False
    membros = [i for i in _lista(ultima.get("raias")) if isinstance(i, str)]
    raias_do_estado = estado.get("raias")
    if not membros or not isinstance(raias_do_estado, dict):
        return False
    if not all(_dict(raias_do_estado.get(m)).get("estado") == "concluida" for m in membros):
        return False
    if _chave("fase_concluida", fase_id) not in _lista(estado.get("chavesAcordadas")):
        return False
    orquestrador = estado.get("orquestrador")
    if not isinstance(orquestrador, dict) or orquestrador.get("runId") is not None:
        return False
    return all(_vazia(estado.get(c)) for c in ("acordarPendentes", "decisoes", "decisoesPendentes", "prsParaFechar"))


def raias_ocupadas(estado: dict) -> set:
    """As raias que seguram vaga: `executando`, a de um `despachar_raia` em curso e as de um incerto.

    Função pura (o despachante e o coordenador usam a mesma regra); entrada malformada dá o que for legível.
    """
    estado = _dict(estado)
    ocupadas = {raia_id for raia_id, raia in _dict(estado.get("raias")).items() if _dict(raia).get("estado") == "executando"}
    acoes = [_dict(estado.get("acaoEmCurso"))]
    acoes += [_dict(_dict(item).get("acao")) for item in _lista(estado.get("despachosIncertos"))]
    for acao in acoes:
        if acao.get("tipo") == "despachar_raia" and _texto(acao.get("raia")):
            ocupadas.add(acao["raia"])
    return ocupadas


def orquestrador_em_curso(estado: dict) -> bool:
    """Run do orquestrador, acordar incerto ou em curso, ou PR do orquestrador esperando gates ou o Paulo.

    As acordadas na fila não contam: a trava é solta ao fim de cada acordada. Função pura.
    """
    estado = _dict(estado)
    incertos = {_dict(item).get("chave") for item in _lista(estado.get("despachosIncertos"))}
    return (
        _dict(estado.get("orquestrador")).get("runId") is not None
        or any(str(c).startswith("acordar:") for c in incertos)
        or _dict(estado.get("acaoEmCurso")).get("tipo") == "acordar"
        or bool(_lista(estado.get("prsOrquestrador")))
    )


# ---------------------------------------------------------------- aplicação


def _verificacao_do_head(verificacao, sha) -> bool:
    return (
        isinstance(verificacao, dict)
        and _texto(sha)
        and verificacao.get("sha") == sha
        and _inteiro(verificacao.get("codigo"))
    )


def aplicar(estado: dict, acao: dict, resultado: dict) -> dict:
    """Registra o efeito de uma ação executada; `{"adiado": True}` não muda nada."""
    estado = copy.deepcopy(estado)
    acao = copy.deepcopy(acao)
    resultado = copy.deepcopy(resultado)
    if isinstance(resultado, dict) and resultado.get("adiado") is True:
        return estado
    if not isinstance(acao, dict):
        _avisar(estado, f"aplicar: ação malformada {acao!r}")
        return estado
    if not isinstance(resultado, dict):
        _avisar(estado, f"aplicar: resultado malformado para {acao.get('tipo')!r}")
        return estado
    tipo = acao.get("tipo")

    if tipo in ("despachar_raia", "retomar_raia"):
        raia = _raia(estado, acao.get("raia"), f"aplicar {tipo}")
        if raia is None:
            return estado
        if tipo == "retomar_raia":
            raia["retomar"] = False
            retomadas = raia.get("retomadas")
            raia["retomadas"] = (retomadas if _inteiro(retomadas) else MAX_RETOMADAS) + 1
        elif raia.get("estado") != "planejada":
            _avisar(estado, f"raia {acao['raia']!r} despachada de novo fora de planejada")
        elif _texto(resultado.get("planRunId")):
            raia["estado"] = "executando"
            raia["planRunId"] = resultado["planRunId"]
        else:
            # o despacho pode ter acontecido: falhar e acordar é melhor que despachar de novo.
            # Com a capacidade global, a vaga segue esta regra: a raia sai de `executando` e a vaga é
            # solta, mesmo que o Plan Run exista (vale também para o cancelamento que falhou de vez).
            raia["estado"] = "falhou"
            raia["falha"] = "despacho sem planRunId"
            _avisar(estado, f"raia {acao['raia']!r}: despacho sem planRunId")
        return estado

    if tipo == "acordar":
        chave = _chave(acao.get("motivo"), acao.get("alvo"))
        if _texto(resultado.get("runId")):
            if not isinstance(estado.get("chavesAcordadas"), list):
                estado["chavesAcordadas"] = []
            if chave not in estado["chavesAcordadas"]:
                estado["chavesAcordadas"].append(chave)
            estado["orquestrador"] = {"runId": resultado["runId"], "motivo": acao.get("motivo")}
            estado["falhasAcordar"] = 0
            return estado
        # sem runId a chave não é gasta: o próximo ciclo tenta de novo, até a pausa
        falhas = estado.get("falhasAcordar")
        falhas = (falhas if _inteiro(falhas) and falhas >= 0 else MAX_FALHAS_ACORDAR - 1) + 1
        estado["falhasAcordar"] = falhas
        _avisar(estado, f"acordar {chave}: despacho sem runId (falha {falhas})")
        if falhas >= MAX_FALHAS_ACORDAR:
            estado["pausado"] = "acordar falhou"
            _avisar(estado, f"acordar falhou {falhas} vezes seguidas: despachante pausado")
        return estado

    if tipo not in ("revisar", "verificar", "corrigir", "mergear", "aguardar_humano"):
        _avisar(estado, f"aplicar: tipo de ação desconhecido {tipo!r}")
        return estado
    seed_id = acao.get("seed")
    seed = _seed(estado, seed_id, f"aplicar {tipo}")
    if seed is None:
        return estado

    if tipo == "revisar":
        if _texto(resultado.get("runId")):
            seed["revisaoRunId"] = resultado["runId"]
            seed["revisaoSha"] = acao.get("sha") if _texto(acao.get("sha")) else None
            tentativas = seed.get("tentativasRevisao")
            seed["tentativasRevisao"] = (tentativas if _inteiro(tentativas) else MAX_TENTATIVAS_REVISAO) + 1
        else:
            _pedir_humano(estado, seed_id, seed, "despacho da revisão sem runId")
    elif tipo == "corrigir":
        if _texto(resultado.get("runId")):
            seed["fixerRunId"] = resultado["runId"]
            seed["fixerUsado"] = True
            seed["vereditoAnterior"] = seed.get("veredito")
            seed["veredito"] = None
            seed["tentativasRevisao"] = 0
            seed["estado"] = "corrigindo"
        else:
            seed["fixerUsado"] = True
            _pedir_humano(estado, seed_id, seed, "despacho do fixer sem runId")
    elif tipo == "verificar":
        verificacao = resultado.get("verificacao")
        if _verificacao_do_head(verificacao, acao.get("sha")):
            return registrar_verificacao(estado, seed_id, verificacao)
        _pedir_humano(estado, seed_id, seed, "verificação com resultado inválido")
    elif tipo == "mergear":
        if resultado.get("ok") is True:
            seed["estado"] = "mergeada"
        else:
            recusas = seed.get("tentativasMerge")
            recusas = (recusas if _inteiro(recusas) and recusas >= 0 else MAX_RECUSAS_DE_MERGE - 1) + 1
            seed["tentativasMerge"] = recusas
            if recusas >= MAX_RECUSAS_DE_MERGE:
                _pedir_humano(
                    estado, seed_id, seed, f"merge recusado pelo GitHub {MAX_RECUSAS_DE_MERGE} vezes"
                )
    elif tipo == "aguardar_humano":
        motivos = [m for m in _lista(acao.get("motivos")) if isinstance(m, str)]
        seed["estado"] = "bloqueada_humano"
        seed["motivoHumano"] = "; ".join(motivos) or "decisão humana necessária"
        seed["pendenteHumano"] = None
    return estado


# ---------------------------------------------------------------- PR do orquestrador


def _caminho_do_orquestrador(caminho) -> bool:
    if not isinstance(caminho, str) or not caminho.startswith(PREFIXOS_DO_ORQUESTRADOR):
        return False
    partes = caminho.split("/")
    return all(p not in ("", ".", "..") for p in partes[1:])


def decidir_pr_orquestrador(*, motivo: str, arquivos: list[str], erros_plano: list[str], fase_sozinha: bool = False) -> str:
    """`humano`, `replanejar` ou `mergear` para o PR aberto pelo orquestrador.

    `fase_sozinha` (`homologacaoDeFase: false` na config): o PR de `fase_concluida` não vai para o Paulo.
    """
    if not isinstance(arquivos, list) or not arquivos:
        return "humano"
    if PERGUNTA_DO_ORQUESTRADOR in arquivos:
        return "humano"  # o orquestrador fez uma pergunta ao Paulo: nunca mergear
    if not all(_caminho_do_orquestrador(a) for a in arquivos):
        return "humano"
    if not isinstance(erros_plano, list):
        return "humano"
    if erros_plano:
        return "replanejar"
    if motivo in MOTIVOS_DO_PAULO and not (fase_sozinha is True and motivo == "fase_concluida"):
        return "humano"
    return "mergear"
