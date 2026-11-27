"""Baseline da Fábrica 2.0 (M0): mede a operação atual por coorte, só leitura.

Fontes: o Postgres do Flow (demandas, eventos, intervalos com custo) e os `estado.json` dos planos na oficina.
Campo sem dado fica `None` ("indisponível"), nunca zero. Custo é o equivalente estimado pelo Warren, não cobrança.
Só os intervalos `tipo = 'custo'` (um por execução de plano) entram no custo: `parte` e `etapa` são intervalos de
tempo e somá-los duplicaria o gasto. Execuções fora de plano (triagem, atendente, busca) não têm intervalo de custo.

Uso na oficina:
    python3 -I -B baseline.py --desde 2026-11-27T03:00:00Z [--ate ...] [--conteiner kustertech-flow-postgres-1]
        [--planos ~/fabrica/planos] [--json saida.json]
"""
import argparse
import datetime
import json
import pathlib
import subprocess
import sys


def fracao(parte, total):
    return round(parte / total, 4) if total else None


def resumo_de_demandas(demandas, eventos):
    ids = {d["id"] for d in demandas}
    no_ar = sum(1 for d in demandas if d.get("noArEm"))
    encerradas_sem_ar = sum(1 for d in demandas if d.get("encerrada") and not d.get("noArEm"))
    da_coorte = [e for e in eventos if e.get("demandaId") in ids]
    travas = [e for e in da_coorte if e.get("tipo") == "travada"]
    testes = [e for e in da_coorte if e.get("tipo") == "teste"]
    primeiro_teste = {}
    for e in testes:  # os eventos chegam em ordem de `seq`
        primeiro_teste.setdefault(e["demandaId"], e.get("resultado"))
    passaram = sum(1 for r in primeiro_teste.values() if r == "passou")
    return {
        "criadas": len(demandas),
        "noAr": no_ar,
        "encerradasSemAr": encerradas_sem_ar,
        "abertas": len(demandas) - no_ar - encerradas_sem_ar,
        "taxaNoAr": fracao(no_ar, len(demandas)),
        "travas": len(travas),
        "demandasComTrava": len({e["demandaId"] for e in travas}),
        "testes": {"total": len(testes), "falharam": sum(1 for e in testes if e.get("resultado") == "falhou")},
        "testesDePrimeira": {
            "demandas": len(primeiro_teste),
            "passaram": passaram,
            "taxa": fracao(passaram, len(primeiro_teste)),
        },
    }


def resumo_de_custo(intervalos):
    por_tipo, por_papel = {}, {}
    total, com_custo = 0.0, 0
    for i in intervalos:
        valor = float(i["custoUsd"]) if i.get("custoUsd") is not None else None
        for chave, grupos in ((i.get("tipo"), por_tipo), (i.get("papel"), por_papel)):
            grupo = grupos.setdefault(chave or "desconhecido", {"execucoes": 0, "comCusto": 0, "usd": 0.0})
            grupo["execucoes"] += 1
            if valor is not None:
                grupo["comCusto"] += 1
                grupo["usd"] = round(grupo["usd"] + valor, 4)
        if valor is not None:
            total += valor
            com_custo += 1
    return {
        "totalUsd": round(total, 4) if com_custo else None,
        "porTipo": por_tipo,
        "porPapel": por_papel,
        "cobertura": fracao(com_custo, len(intervalos)),
    }


def _dicionario(valor):
    return valor if isinstance(valor, dict) else {}


def resumo_de_planos(estados):
    raias = seeds = com_fixer = replanejamentos = 0
    for estado in estados:
        for raia in _dicionario(estado.get("raias")).values():
            raias += 1
            n = _dicionario(raia).get("replanejamentos")
            replanejamentos += n if isinstance(n, int) and n > 0 else 0
        for seed in _dicionario(estado.get("seeds")).values():
            seed = _dicionario(seed)
            seeds += 1
            usados = seed.get("fixersUsados")
            if (isinstance(usados, int) and usados >= 1) or seed.get("fixerUsado") is True:
                com_fixer += 1
    sem_fixer = fracao(seeds - com_fixer, seeds)
    return {
        "planos": len(estados),
        "raias": raias,
        "replanejamentos": replanejamentos,
        "seeds": seeds,
        "seedsComFixer": com_fixer,
        "seedsSemFixer": sem_fixer,
    }


def _v(valor):
    if valor is None:
        return "indisponível"
    if isinstance(valor, float) and valor <= 1:
        return f"{valor * 100:.1f}%"
    return str(valor)


def markdown(dados):
    j, d, c, p = dados["janela"], dados["demandas"], dados["custo"], dados["planos"]
    linhas = [
        f"# Baseline da Fábrica — {j['desde']} a {j['ate']}",
        "",
        "## Demandas criadas na janela",
        f"- Criadas: {d['criadas']} · no ar: {d['noAr']} ({_v(d['taxaNoAr'])}) · "
        f"encerradas sem ar: {d['encerradasSemAr']} · abertas: {d['abertas']}",
        f"- Travas: {d['travas']} em {d['demandasComTrava']} demandas",
        f"- Testes no navegador: {d['testes']['total']} ({d['testes']['falharam']} falharam); "
        f"aprovados de primeira: {d['testesDePrimeira']['passaram']}/{d['testesDePrimeira']['demandas']} "
        f"({_v(d['testesDePrimeira']['taxa'])})",
        "",
        "## Custo equivalente estimado (não é cobrança)",
        f"- Total: {_v(c['totalUsd'])} USD · execuções de plano com custo: {_v(c['cobertura'])} "
        "(execuções fora de plano não entram)",
    ]
    total = c["totalUsd"] or 0
    for titulo, grupos in (("Por tipo de intervalo", c["porTipo"]), ("Por papel", c["porPapel"])):
        linhas.append(f"- {titulo}:")
        for nome, g in sorted(grupos.items(), key=lambda kv: -kv[1]["usd"]):
            parte = f" ({_v(fracao(g['usd'], total))})" if total else ""
            linhas.append(f"  - {nome}: {g['execucoes']} execuções, {g['comCusto']} com custo, US$ {g['usd']}{parte}")
    linhas += [
        "",
        "## Planos na oficina (todos os planos presentes, sem filtro de janela)",
        f"- Planos: {p['planos']} · raias: {p['raias']} · replanejamentos: {p['replanejamentos']}",
        f"- Seeds: {p['seeds']} · com fixer: {p['seedsComFixer']} · sem fixer: {_v(p['seedsSemFixer'])}",
        "",
        "Coorte = demandas criadas na janela; as ainda abertas contam como abertas, não como falha.",
    ]
    return "\n".join(linhas) + "\n"


def _instante(texto):
    valor = datetime.datetime.fromisoformat(texto.replace("Z", "+00:00"))
    if valor.tzinfo is None:
        raise argparse.ArgumentTypeError("informe o fuso (ex.: Z ou -03:00)")
    return valor.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _consulta(conteiner, sql):
    comando = ["docker", "exec", "-i", conteiner, "sh", "-c", 'psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
    saida = subprocess.run(comando, input=sql, capture_output=True, text=True, check=True).stdout.strip()
    return json.loads(saida or "[]")


def coletar(conteiner, desde, ate, pasta_planos):
    def entre(coluna):  # desde/ate já validados e normalizados por _instante
        return f"{coluna} >= '{desde}'::timestamptz AND {coluna} < '{ate}'::timestamptz"

    demandas = _consulta(conteiner, f"""SELECT coalesce(json_agg(json_build_object('id', id, 'noArEm', "noArEm",
        'encerrada', encerrada) ORDER BY "criadaEm"), '[]') FROM "Demanda" WHERE {entre('"criadaEm"')};""")
    eventos = _consulta(conteiner, f"""SELECT coalesce(json_agg(json_build_object('demandaId', e."demandaId", 'tipo', e.tipo,
        'resultado', e.dados->>'resultado') ORDER BY e.seq), '[]') FROM "EventoDaDemanda" e JOIN "Demanda" d ON d.id = e."demandaId"
        WHERE {entre('d."criadaEm"')};""")
    intervalos = _consulta(conteiner, f"""SELECT coalesce(json_agg(json_build_object('tipo', tipo, 'papel', papel,
        'custoUsd', "custoUsd")), '[]') FROM "IntervaloDaFabrica" WHERE tipo = 'custo' AND {entre('inicio')};""")
    estados = []
    for arquivo in sorted(pathlib.Path(pasta_planos).expanduser().glob("*/estado.json")):
        try:
            estados.append(json.loads(arquivo.read_text()))
        except (OSError, ValueError):
            continue
    return {
        "janela": {"desde": desde, "ate": ate},
        "demandas": resumo_de_demandas(demandas, eventos),
        "custo": resumo_de_custo(intervalos),
        "planos": resumo_de_planos(estados),
    }


def main(argv=None):
    agora = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--desde", type=_instante, required=True)
    p.add_argument("--ate", type=_instante, default=agora)
    p.add_argument("--conteiner", default="kustertech-flow-postgres-1")
    p.add_argument("--planos", default="~/fabrica/planos")
    p.add_argument("--json")
    a = p.parse_args(argv)
    dados = coletar(a.conteiner, a.desde, a.ate, a.planos)
    if a.json:
        pathlib.Path(a.json).write_text(json.dumps(dados, ensure_ascii=False, indent=2) + "\n")
    sys.stdout.write(markdown(dados))
    return 0


if __name__ == "__main__":
    sys.exit(main())
