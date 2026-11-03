"""Estado do despachante e decisão das próximas ações (funções puras, só biblioteca padrão).

Toda função pública copia a entrada com `copy.deepcopy` e devolve um estado novo.
Observações malformadas nunca levantam exceção: são ignoradas e viram um aviso.
"""

import copy
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import gates  # noqa: E402
import raias  # noqa: E402

TIMEOUT_DE_MERGE = "child_pr_merge_timeout"
MAX_RETOMADAS = 3
MAX_TENTATIVAS_REVISAO = 2
ESTADOS_DE_GATE = ("em_revisao", "aguardando_gates", "corrigindo")
MOTIVOS_DO_PAULO = ("nova_spec", "fase_concluida")
PREFIXOS_DO_ORQUESTRADOR = (".fabrica/", ".seeds/")


def _raia_nova() -> dict:
    return {"estado": "planejada", "planRunId": None, "retomar": False, "retomadas": 0, "falha": None}


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
        "revisaoRunId": None,
        "tentativasRevisao": 0,
        "fixerRunId": None,
        "fixerUsado": False,
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


def _ids_de_raia(plano) -> list[str]:
    return [
        r["id"]
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


def _bloquear(seed: dict, motivo: str) -> None:
    seed["estado"] = "bloqueada_humano"
    seed["motivoHumano"] = motivo


# ---------------------------------------------------------------- criação


def novo_estado(plano: dict, *, projeto: str, repo: str, limite_paralelo: int = 3) -> dict:
    plano = copy.deepcopy(plano)
    return {
        "projeto": projeto,
        "repo": repo,
        "limiteParalelo": limite_paralelo,
        "pausado": None,
        "raias": {id_: _raia_nova() for id_ in _ids_de_raia(plano)},
        "seeds": {},
        "orquestrador": {"runId": None, "motivo": None},
        "chavesAcordadas": [],
        "avisos": [],
        "decisoes": [],
    }


def sincronizar_plano(estado: dict, plano: dict) -> dict:
    """Acrescenta como `planejada` as raias novas do plano; as existentes ficam como estão."""
    estado = copy.deepcopy(estado)
    raias_do_estado = _raias(estado)
    for id_ in _ids_de_raia(copy.deepcopy(plano)):
        if id_ not in raias_do_estado:
            raias_do_estado[id_] = _raia_nova()
    return estado


# ---------------------------------------------------------------- observações


def _registrar_filho(estado: dict, raia_id: str, filho) -> None:
    if not isinstance(filho, dict) or not _texto(filho.get("seedId")):
        _avisar(estado, f"raia {raia_id!r}: filho malformado ignorado: {filho!r}")
        return
    seed_id = filho["seedId"]
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
    if _texto(filho.get("runId")):
        seed["runId"] = filho["runId"]
    atual = seed.get("estado")
    if atual == "mergeada":
        return  # terminal: nada no Warren desfaz um merge
    if obs in ("dispatched", "running"):
        # só a seed recém-vista, a que já executava ou a que falhou e foi redespachada
        if atual in ("executando", "falhou"):
            seed["estado"] = "executando"
    elif obs == "pr_open":
        if atual == "executando":
            if not _texto(filho.get("prUrl")):
                _avisar(estado, f"seed {seed_id!r}: pr_open sem prUrl")
                return
            seed["estado"] = "em_revisao"
            seed["pr"] = filho["prUrl"]
    elif obs == "merged":
        seed["estado"] = "mergeada"
    elif obs == "failed":
        seed["estado"] = "falhou"


def registrar_plano(
    estado: dict, raia_id: str, *, estado_plano: str, falha: str | None, filhos: list[dict]
) -> dict:
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
    estado: dict, seed_id: str, *, head_sha: str, branch: str, arquivos: list[str], ci: str | None
) -> dict:
    estado = copy.deepcopy(estado)
    seed = _seed(estado, seed_id, "registrar_pr")
    if seed is None:
        return estado
    if _texto(head_sha):
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
    achou = False
    for seed_id, seed in _seeds(estado).items():
        if not isinstance(seed, dict) or not _texto(run_id):
            continue
        if seed.get("revisaoRunId") == run_id:
            achou = True
            seed["revisaoRunId"] = None
            if (
                estado_run == "succeeded"
                and isinstance(veredito, dict)
                and seed.get("estado") in ESTADOS_DE_GATE
            ):
                seed["veredito"] = veredito
                seed["estado"] = "aguardando_gates"
        elif seed.get("fixerRunId") == run_id:
            achou = True
            seed["fixerRunId"] = None
            if estado_run == "succeeded":
                seed["veredito"] = None  # o head mudou: o próximo ciclo pede revisão nova
            elif seed.get("estado") != "mergeada":
                seed["estado"] = "falhou"
                _avisar(estado, f"seed {seed_id!r}: fixer terminou em {estado_run!r}")
    if not achou:
        _avisar(estado, f"registrar_fim_de_run: run desconhecido {run_id!r}")
    if motivo_falha == "oom_killed":
        limite = estado.get("limiteParalelo")
        estado["limiteParalelo"] = min(limite, 2) if _inteiro(limite) else 2
        _avisar(estado, f"run {run_id!r} terminou com oom_killed: limite de paralelismo baixou para 2")
    if cota:  # pausar é o lado seguro: qualquer valor verdadeiro pausa
        estado["pausado"] = "cota"
        _avisar(estado, f"run {run_id!r} bateu cota do provedor: despachante pausado")
    return estado


# ---------------------------------------------------------------- decisão


def _chave(motivo: str, alvo: str) -> str:
    return f"{motivo}:{alvo}"


def _acoes_da_seed(seed_id: str, seed: dict, protegidos) -> list[dict]:
    head = seed.get("headSha")
    r = gates.avaliar_merge(
        head_sha=head,
        ci=seed.get("ci"),
        verificacao=seed.get("verificacao"),
        veredito=seed.get("veredito"),
        arquivos=seed.get("arquivos"),
        protegidos=protegidos,
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


def proximas_acoes(estado: dict, plano: dict, protegidos: list[str]) -> list[dict]:
    estado = copy.deepcopy(estado)
    plano = _dict(copy.deepcopy(plano))
    protegidos = copy.deepcopy(protegidos)
    if estado.get("pausado"):
        return []
    acoes: list[dict] = []

    # 1. seeds com PR: gates
    for seed_id, seed in _seeds(estado).items():
        if (
            isinstance(seed, dict)
            and seed.get("estado") in ESTADOS_DE_GATE
            and seed.get("revisaoRunId") is None
            and seed.get("fixerRunId") is None
            and _texto(seed.get("headSha"))
        ):
            acoes.extend(_acoes_da_seed(seed_id, seed, protegidos))

    raias_do_estado = {i: r for i, r in _raias(estado).items() if isinstance(r, dict)}
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

    # 4. raias que falharam
    for id_, raia in raias_do_estado.items():
        if raia.get("estado") == "falhou":
            acoes.append({"tipo": "acordar", "motivo": "raia_falhou", "alvo": id_})

    # 5. fase atual concluída
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
            # o despacho pode ter acontecido: falhar e acordar é melhor que despachar de novo
            raia["estado"] = "falhou"
            raia["falha"] = "despacho sem planRunId"
            _avisar(estado, f"raia {acao['raia']!r}: despacho sem planRunId")
        return estado

    if tipo == "acordar":
        chave = _chave(acao.get("motivo"), acao.get("alvo"))
        if not isinstance(estado.get("chavesAcordadas"), list):
            estado["chavesAcordadas"] = []
        if chave not in estado["chavesAcordadas"]:
            estado["chavesAcordadas"].append(chave)
        if _texto(resultado.get("runId")):
            estado["orquestrador"] = {"runId": resultado["runId"], "motivo": acao.get("motivo")}
        else:
            _avisar(estado, f"acordar {chave}: despacho sem runId")
        return estado

    if tipo not in ("revisar", "verificar", "corrigir", "mergear", "aguardar_humano"):
        _avisar(estado, f"aplicar: tipo de ação desconhecido {tipo!r}")
        return estado
    seed = _seed(estado, acao.get("seed"), f"aplicar {tipo}")
    if seed is None:
        return estado

    if tipo == "revisar":
        if _texto(resultado.get("runId")):
            seed["revisaoRunId"] = resultado["runId"]
            tentativas = seed.get("tentativasRevisao")
            seed["tentativasRevisao"] = (tentativas if _inteiro(tentativas) else MAX_TENTATIVAS_REVISAO) + 1
        else:
            _bloquear(seed, "despacho da revisão sem runId")
    elif tipo == "corrigir":
        if _texto(resultado.get("runId")):
            seed["fixerRunId"] = resultado["runId"]
            seed["fixerUsado"] = True
            seed["veredito"] = None
            seed["tentativasRevisao"] = 0
            seed["estado"] = "corrigindo"
        else:
            seed["fixerUsado"] = True
            _bloquear(seed, "despacho do fixer sem runId")
    elif tipo == "verificar":
        verificacao = resultado.get("verificacao")
        if _verificacao_do_head(verificacao, acao.get("sha")):
            return registrar_verificacao(estado, acao["seed"], verificacao)
        _bloquear(seed, "verificação com resultado inválido")
    elif tipo == "mergear":
        if resultado.get("ok") is True:
            seed["estado"] = "mergeada"
    elif tipo == "aguardar_humano":
        motivos = [m for m in _lista(acao.get("motivos")) if isinstance(m, str)]
        _bloquear(seed, "; ".join(motivos) or "decisão humana necessária")
    return estado


# ---------------------------------------------------------------- PR do orquestrador


def _caminho_do_orquestrador(caminho) -> bool:
    if not isinstance(caminho, str) or not caminho.startswith(PREFIXOS_DO_ORQUESTRADOR):
        return False
    partes = caminho.split("/")
    return all(p not in ("", ".", "..") for p in partes[1:])


def decidir_pr_orquestrador(*, motivo: str, arquivos: list[str], erros_plano: list[str]) -> str:
    """`humano`, `replanejar` ou `mergear` para o PR aberto pelo orquestrador."""
    if not isinstance(arquivos, list) or not arquivos:
        return "humano"
    if not all(_caminho_do_orquestrador(a) for a in arquivos):
        return "humano"
    if not isinstance(erros_plano, list):
        return "humano"
    if erros_plano:
        return "replanejar"
    if motivo in MOTIVOS_DO_PAULO:
        return "humano"
    return "mergear"
