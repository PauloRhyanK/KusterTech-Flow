"""Métricas de desempenho da oficina: coleta por minuto e relatório por raias ocupadas.

A pergunta que responde: com N raias da Fábrica rodando, a máquina aguenta? Para isso cada
amostra junta a pressão de recursos (RAM disponível, swap, PSI de memória/CPU/IO, carga, OOM
kills do kernel) com a ocupação (raias reservadas em ~/fabrica/capacidade.json e jobs de CI).

Uso:
    metricas_oficina.py coletar              # uma amostra em metricas.jsonl (timer, por minuto)
    metricas_oficina.py relatorio [--dias 7] [--json]
    metricas_oficina.py podar [--dias 30]

Arquivos em OFICINA_DIR_ESTADO (padrão /var/lib/oficina): metricas.jsonl (uma amostra JSON por
linha) e alertas.jsonl (OOM novo vira alerta, no formato lido pelo KusterTech Flow).
Só biblioteca padrão.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import sys

DIR_ESTADO = pathlib.Path(os.environ.get("OFICINA_DIR_ESTADO", "/var/lib/oficina"))
CAPACIDADE = pathlib.Path(
    os.environ.get("OFICINA_CAPACIDADE", "/home/devops/fabrica/capacidade.json")
)


# --- leitura (funções puras sobre o texto dos arquivos do kernel) --------------------------------


def ler_meminfo(texto: str) -> dict:
    kb = {}
    for linha in texto.splitlines():
        partes = linha.split()
        if len(partes) >= 2 and partes[0].endswith(":"):
            kb[partes[0][:-1]] = int(partes[1])
    return {
        "memTotalMb": kb.get("MemTotal", 0) // 1024,
        "memDisponivelMb": kb.get("MemAvailable", 0) // 1024,
        "swapUsadaMb": (kb.get("SwapTotal", 0) - kb.get("SwapFree", 0)) // 1024,
    }


def ler_psi(texto: str) -> dict:
    """avg60 (% do tempo com tarefas travadas no último minuto) das linhas some e full."""
    psi = {"some": None, "full": None}
    for linha in texto.splitlines():
        tipo, *campos = linha.split()
        valores = dict(c.split("=", 1) for c in campos if "=" in c)
        if tipo in psi and "avg60" in valores:
            psi[tipo] = float(valores["avg60"])
    return psi


def ler_oom(vmstat: str) -> int:
    for linha in vmstat.splitlines():
        nome, _, valor = linha.partition(" ")
        if nome == "oom_kill":
            return int(valor)
    return 0


def ler_capacidade(dados: dict) -> dict:
    reservas = dados.get("reservas") or {}
    return {
        "vagas": dados.get("vagasConfig"),
        "raias": sum(len(r) for r in reservas.values()),
        "oomEm": dados.get("oomEm"),
    }


# --- coleta ----------------------------------------------------------------------------------------


def _ler(caminho: str) -> str:
    try:
        return pathlib.Path(caminho).read_text(encoding="utf-8")
    except OSError:
        return ""


def _jobs_ci() -> int:
    total = 0
    for comm in pathlib.Path("/proc").glob("[0-9]*/comm"):
        try:
            if comm.read_text(encoding="utf-8").strip() == "Runner.Worker":
                total += 1
        except OSError:
            continue
    return total


def coletar(agora: str | None = None) -> dict:
    amostra = {"em": agora or dt.datetime.now().astimezone().isoformat(timespec="seconds")}
    amostra.update(ler_meminfo(_ler("/proc/meminfo")))
    amostra["psiMem"] = ler_psi(_ler("/proc/pressure/memory"))
    amostra["psiCpu"] = ler_psi(_ler("/proc/pressure/cpu"))
    amostra["psiIo"] = ler_psi(_ler("/proc/pressure/io"))
    carga = _ler("/proc/loadavg").split()
    amostra["carga1"] = float(carga[0]) if carga else None
    amostra["oomKills"] = ler_oom(_ler("/proc/vmstat"))
    amostra["bootId"] = _ler("/proc/sys/kernel/random/boot_id").strip()
    st = os.statvfs("/")
    amostra["discoUsoPct"] = round(100 * (1 - st.f_bavail / st.f_blocks)) if st.f_blocks else None
    amostra["jobsCi"] = _jobs_ci()
    try:
        amostra.update(ler_capacidade(json.loads(CAPACIDADE.read_text(encoding="utf-8"))))
    except (OSError, ValueError):
        amostra.update(vagas=None, raias=None, oomEm=None)
    return amostra


def alertas(anterior: dict | None, atual: dict) -> list[dict]:
    """OOM kill novo desde a amostra anterior (no mesmo boot) vira alerta."""
    if not anterior or anterior.get("bootId") != atual.get("bootId"):
        return []
    novos = atual.get("oomKills", 0) - anterior.get("oomKills", 0)
    if novos <= 0:
        return []
    return [
        {
            "em": atual.get("em"),
            "origem": "oficina",
            "tipo": "oom",
            "severidade": "alta",
            "mensagem": "%d OOM kill(s) na oficina com %s raias ocupadas de %s vagas"
            % (novos, atual.get("raias"), atual.get("vagas")),
        }
    ]


def _ultima(arquivo: pathlib.Path) -> dict | None:
    try:
        with arquivo.open("rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 4096))
            linhas = f.read().decode("utf-8", "replace").splitlines()
        return json.loads(linhas[-1]) if linhas else None
    except (OSError, ValueError):
        return None


def _anexar(arquivo: pathlib.Path, registro: dict) -> None:
    with arquivo.open("a", encoding="utf-8") as f:
        f.write(json.dumps(registro, ensure_ascii=False) + "\n")


# --- relatório -------------------------------------------------------------------------------------


def _media(valores):
    valores = [v for v in valores if v is not None]
    return round(sum(valores) / len(valores), 2) if valores else None


def _percentil(valores, p):
    valores = sorted(v for v in valores if v is not None)
    return valores[min(len(valores) - 1, int(len(valores) * p))] if valores else None


def _oom_no_periodo(amostras: list[dict]) -> int:
    total, boot, ultimo = 0, None, 0
    for a in amostras:
        valor = a.get("oomKills") or 0
        if a.get("bootId") != boot:
            # boot novo: o contador do kernel recomeça do zero, então tudo dele conta; no primeiro
            # boot visto, o valor inicial é anterior ao período e não conta
            if boot is not None:
                total += valor
            boot, ultimo = a.get("bootId"), valor
            continue
        total += max(0, valor - ultimo)
        ultimo = valor
    return total


def resumir(amostras: list[dict]) -> dict:
    grupos: dict = {}
    for a in amostras:
        grupos.setdefault(a.get("raias"), []).append(a)
    por_raias = {}
    for raias, grupo in sorted(grupos.items(), key=lambda kv: (kv[0] is None, kv[0])):
        por_raias[raias] = {
            "amostras": len(grupo),
            "memDisponivelMbP5": _percentil([g.get("memDisponivelMb") for g in grupo], 0.05),
            "memDisponivelMbMedia": _media([g.get("memDisponivelMb") for g in grupo]),
            "swapUsadaMbMax": max((g.get("swapUsadaMb") or 0) for g in grupo),
            "psiMemSomeMedia": _media([(g.get("psiMem") or {}).get("some") for g in grupo]),
            "psiMemFullMax": max(((g.get("psiMem") or {}).get("full") or 0) for g in grupo),
            "psiCpuSomeMedia": _media([(g.get("psiCpu") or {}).get("some") for g in grupo]),
            "psiIoSomeMedia": _media([(g.get("psiIo") or {}).get("some") for g in grupo]),
            "carga1Media": _media([g.get("carga1") for g in grupo]),
            "jobsCiMedia": _media([g.get("jobsCi") for g in grupo]),
        }
    return {
        "amostras": len(amostras),
        "de": amostras[0].get("em") if amostras else None,
        "ate": amostras[-1].get("em") if amostras else None,
        "oomKills": _oom_no_periodo(amostras),
        "porRaias": por_raias,
    }


def _carregar(arquivo: pathlib.Path, desde: dt.datetime | None = None) -> list[dict]:
    amostras = []
    try:
        linhas = arquivo.read_text(encoding="utf-8").splitlines()
    except OSError:
        return amostras
    for linha in linhas:
        try:
            a = json.loads(linha)
            if desde is None or dt.datetime.fromisoformat(a["em"]) >= desde:
                amostras.append(a)
        except (ValueError, KeyError, TypeError):
            continue
    return amostras


def podar(arquivo, dias: int, agora: str | None = None) -> int:
    """Mantém só as amostras dos últimos `dias`; linhas ilegíveis também saem. Devolve as removidas."""
    arquivo = pathlib.Path(arquivo)
    corte = (dt.datetime.fromisoformat(agora) if agora else dt.datetime.now().astimezone()) - dt.timedelta(days=dias)
    try:
        linhas = arquivo.read_text(encoding="utf-8").splitlines()
    except OSError:
        return 0
    manter = []
    for linha in linhas:
        try:
            if dt.datetime.fromisoformat(json.loads(linha)["em"]) >= corte:
                manter.append(linha)
        except (ValueError, KeyError, TypeError):
            continue
    tmp = arquivo.with_suffix(".tmp")
    tmp.write_text("".join(l + "\n" for l in manter), encoding="utf-8")
    os.replace(tmp, arquivo)
    return len(linhas) - len(manter)


def _imprimir(r: dict) -> None:
    print("Amostras: %d (%s a %s)   OOM kills no período: %d" % (r["amostras"], r["de"], r["ate"], r["oomKills"]))
    cab = "%6s %8s %10s %10s %9s %10s %10s %9s %8s %7s"
    print(cab % ("raias", "minutos", "RAM p5 MB", "RAM méd", "swap max", "PSI mem %", "mem full", "PSI cpu", "PSI io", "jobs CI"))
    for raias, g in r["porRaias"].items():
        print(cab % (raias, g["amostras"], g["memDisponivelMbP5"], g["memDisponivelMbMedia"],
                     g["swapUsadaMbMax"], g["psiMemSomeMedia"], g["psiMemFullMax"],
                     g["psiCpuSomeMedia"], g["psiIoSomeMedia"], g["jobsCiMedia"]))
    print("\nLeitura: RAM p5 abaixo de ~1000 MB, PSI mem acima de ~10% ou qualquer OOM com N raias")
    print("indica que N vagas é demais para esta máquina.")


def main(argv: list[str]) -> int:
    comando = argv[0] if argv else ""
    dias = int(argv[argv.index("--dias") + 1]) if "--dias" in argv else None
    arquivo = DIR_ESTADO / "metricas.jsonl"
    if comando == "coletar":
        DIR_ESTADO.mkdir(parents=True, exist_ok=True)
        anterior = _ultima(arquivo)
        atual = coletar()
        _anexar(arquivo, atual)
        for alerta in alertas(anterior, atual):
            _anexar(DIR_ESTADO / "alertas.jsonl", alerta)
        return 0
    if comando == "relatorio":
        desde = dt.datetime.now().astimezone() - dt.timedelta(days=dias or 7)
        r = resumir(_carregar(arquivo, desde))
        print(json.dumps(r, ensure_ascii=False, indent=1)) if "--json" in argv else _imprimir(r)
        return 0
    if comando == "podar":
        print("removidas:", podar(arquivo, dias or 30))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
