"""Métricas de desempenho da oficina: coleta por minuto e relatório por raias ocupadas.

A pergunta que responde: com N raias da Fábrica rodando, a máquina aguenta? Para isso cada
amostra junta a pressão de recursos (RAM disponível, swap, PSI de memória/CPU/IO, carga, OOM
kills do kernel) com a ocupação (raias reservadas em ~/fabrica/capacidade.json e jobs de CI).

Uso:
    metricas_oficina.py coletar              # uma amostra em metricas.jsonl (timer, por minuto)
    metricas_oficina.py retrato              # retrato.json: contêineres, Fábrica e runners (por minuto)
    metricas_oficina.py disco                # disco-por-dono.json: quem ocupa o disco (por hora)
    metricas_oficina.py relatorio [--dias 7] [--json]
    metricas_oficina.py podar [--dias 30]

Arquivos em OFICINA_DIR_ESTADO (padrão /var/lib/oficina): metricas.jsonl (uma amostra JSON por
linha), alertas.jsonl (OOM novo vira alerta), retrato.json, disco-por-dono.json e cpu.estado
(contadores de CPU da amostra anterior). Os formatos são os lidos pelo KusterTech Flow
(src/modules/oficina/contrato.ts).
Só biblioteca padrão.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys

DIR_ESTADO = pathlib.Path(os.environ.get("OFICINA_DIR_ESTADO", "/var/lib/oficina"))
USUARIO = os.environ.get("OFICINA_USUARIO", "devops")
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


def ler_cpu(stat: str) -> tuple[int, int]:
    """(ocupado, total) em ticks, da linha agregada "cpu " de /proc/stat."""
    for linha in stat.splitlines():
        if linha.startswith("cpu "):
            v = [int(x) for x in linha.split()[1:9]]
            total = sum(v)
            return total - v[3] - v[4], total  # tira idle e iowait
    raise ValueError("sem linha cpu")


def uso_de_cpu(antes: tuple[int, int] | None, depois: tuple[int, int]) -> float | None:
    """% de CPU ocupada entre duas leituras; None sem leitura anterior ou com contador que voltou."""
    if antes is None:
        return None
    ocupado, total = depois[0] - antes[0], depois[1] - antes[1]
    if total <= 0 or ocupado < 0:
        return None
    return round(100 * ocupado / total, 1)


_UNIDADES = {
    "b": 1, "kb": 1000, "mb": 1000**2, "gb": 1000**3, "tb": 1000**4,
    "kib": 1024, "mib": 1024**2, "gib": 1024**3, "tib": 1024**4,
}


def _bytes(texto: str) -> int | None:
    """"212MiB" (docker stats) ou "1.5GB" (docker system df) em bytes."""
    m = re.fullmatch(r"\s*([\d.]+)\s*([A-Za-z]+)\s*", texto or "")
    if not m or m.group(2).lower() not in _UNIDADES:
        return None
    return int(float(m.group(1)) * _UNIDADES[m.group(2).lower()])


def _linhas_json(texto: str) -> list[dict]:
    objetos = []
    for linha in (texto or "").splitlines():
        try:
            o = json.loads(linha)
        except ValueError:
            continue
        if isinstance(o, dict):
            objetos.append(o)
    return objetos


def ler_containers(ps_json: str, stats_json: str) -> list[dict]:
    """Junta `docker ps -a --format json` e `docker stats --no-stream --format json` pelo nome."""
    stats = {o.get("Name"): o for o in _linhas_json(stats_json)}
    saida = []
    for o in _linhas_json(ps_json):
        nome = (o.get("Names") or "").split(",")[0]
        rodando = o.get("State") == "running"
        st = stats.get(nome) if rodando else None
        codigo = re.match(r"Exited \((\d+)\)", o.get("Status") or "")
        cpu = (st or {}).get("CPUPerc", "").rstrip("%")
        try:
            cpu_pct = float(cpu)
        except ValueError:
            cpu_pct = None
        try:
            desde = dt.datetime.strptime(" ".join((o.get("CreatedAt") or "").split()[:3]), "%Y-%m-%d %H:%M:%S %z")
        except ValueError:
            continue  # sem data válida o contrato não aceita o contêiner
        saida.append({
            "nome": nome,
            "estado": "rodando" if rodando else "parado",
            "codigoDeSaida": None if rodando or not codigo else int(codigo.group(1)),
            "memoriaBytes": _bytes(((st or {}).get("MemUsage") or "").split("/")[0]),
            "cpuPct": cpu_pct,
            "desde": desde.isoformat(timespec="seconds"),
        })
    return saida


def ler_runners(unidades: str, workers: int) -> dict:
    """`systemctl list-units --all --plain --no-legend 'actions.runner.*'` e nº de Runner.Worker."""
    total = no_ar = 0
    for linha in unidades.splitlines():
        partes = linha.split()
        if len(partes) >= 3 and partes[0].startswith("actions.runner.") and partes[0].endswith(".service"):
            total += 1
            no_ar += partes[2] == "active"
    return {"noAr": no_ar, "ocupados": min(workers, no_ar), "total": total}


def fabrica_ativa(saida: str) -> bool:
    """Saída de `systemctl --user is-active fabrica-fila`."""
    return saida.strip() == "active"


def somar_docker_df(texto: str) -> int:
    """Soma dos tamanhos de `docker system df --format json` (imagens, contêineres, volumes, cache)."""
    return sum(_bytes(o.get("Size")) or 0 for o in _linhas_json(texto))


DONOS = ("docker", "fabrica", "runners", "backups")


def classificar_disco(tamanhos: dict[str, int], usado: int) -> list[dict]:
    """Donos conhecidos que foram medidos, mais "outros" = usado - soma (nunca negativo)."""
    donos = [{"nome": n, "bytes": tamanhos[n]} for n in DONOS if n in tamanhos]
    donos.append({"nome": "outros", "bytes": max(0, usado - sum(d["bytes"] for d in donos))})
    return donos


def montar_retrato(em: str, ligada_desde: str, containers: list[dict], fabrica: bool, runners: dict) -> dict:
    return {
        "em": em,
        "ligadaDesde": ligada_desde,
        "containers": containers,
        "servicos": {"fabrica": "ativa" if fabrica else "parada", "runners": runners},
    }


def agora_iso() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def gravar_json(arquivo: pathlib.Path, dado: dict) -> None:
    """Grava em <arquivo>.tmp e renomeia, para a tela nunca ler um arquivo pela metade."""
    tmp = arquivo.with_suffix(".tmp")
    tmp.write_text(json.dumps(dado, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, arquivo)


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


def _executar(comando: list[str], timeout: int = 20) -> str:
    """Saída padrão do comando; vazia se falhar, demorar demais ou não existir."""
    try:
        r = subprocess.run(comando, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError) as erro:
        print("falhou: %s (%s)" % (" ".join(comando), erro), file=sys.stderr)
        return ""
    return r.stdout


def _cpu_uso() -> float | None:
    """Uso de CPU desde a amostra anterior; os contadores ficam em cpu.estado."""
    try:
        atual = ler_cpu(_ler("/proc/stat"))
    except ValueError:
        return None
    arquivo = DIR_ESTADO / "cpu.estado"
    try:
        ocupado, total = arquivo.read_text(encoding="utf-8").split()
        anterior: tuple[int, int] | None = (int(ocupado), int(total))
    except (OSError, ValueError):
        anterior = None
    try:
        arquivo.write_text("%d %d\n" % atual, encoding="utf-8")
    except OSError:
        pass
    return uso_de_cpu(anterior, atual)


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
    amostra["discoLivreBytes"] = st.f_bavail * st.f_frsize
    amostra["discoTotalBytes"] = st.f_blocks * st.f_frsize
    amostra["cpuUsoPct"] = _cpu_uso()
    amostra["jobsCi"] = _jobs_ci()
    try:
        amostra.update(ler_capacidade(json.loads(CAPACIDADE.read_text(encoding="utf-8"))))
    except (OSError, ValueError):
        amostra.update(vagas=None, raias=None, oomEm=None)
    return amostra


def retrato(agora: str | None = None) -> dict | None:
    """Contêineres, Fábrica e runners. None se não der para saber desde quando a máquina está ligada."""
    try:
        subida = float(_ler("/proc/uptime").split()[0])
    except (IndexError, ValueError):
        print("sem /proc/uptime: retrato não gravado", file=sys.stderr)
        return None
    em = agora or agora_iso()
    ligada = dt.datetime.fromisoformat(em) - dt.timedelta(seconds=subida)
    containers = ler_containers(
        _executar(["docker", "ps", "-a", "--format", "json"]),
        _executar(["docker", "stats", "--no-stream", "--format", "json"]),
    )
    # Fábrica: unit de usuário do devops, consultada pelo próprio systemd (um processo
    # "coordenador.py" também aparece em comandos manuais como `coordenador.py status`).
    ativa = _executar(["systemctl", "--user", "--machine=%s@" % USUARIO, "is-active", "fabrica-fila"])
    if not ativa.strip():
        print("não consegui consultar a fabrica-fila: tratada como parada", file=sys.stderr)
    runners = ler_runners(
        _executar(["systemctl", "list-units", "--all", "--plain", "--no-legend", "actions.runner.*"]),
        _jobs_ci(),
    )
    return montar_retrato(em, ligada.isoformat(timespec="seconds"), containers, fabrica_ativa(ativa), runners)


def _du(caminhos: list[str]) -> int | None:
    """Soma de `du -sb`; None se nenhum caminho puder ser medido."""
    soma, algum = 0, False
    for caminho in caminhos:
        saida = _executar(["du", "-sb", caminho], timeout=300).split()
        if saida and saida[0].isdigit():
            soma, algum = soma + int(saida[0]), True
    return soma if algum else None


def disco(agora: str | None = None) -> dict:
    """Quem ocupa o disco. Dono que não pôde ser medido fica de fora e cai em "outros"."""
    casa = pathlib.Path(os.environ.get("OFICINA_CASA", "~%s" % USUARIO)).expanduser()
    workspaces = os.environ.get("OFICINA_WORKSPACES", "/home/agentops/.warren/data/local/workspaces")
    medidos = {
        "docker": somar_docker_df(_executar(["docker", "system", "df", "--format", "json"], timeout=60)) or None,
        "fabrica": _du([str(casa / "fabrica"), workspaces]),
        "runners": _du([str(p) for p in sorted(casa.glob("actions-runner*"))]),
        "backups": _du([str(casa / "backups")]),
    }
    st = os.statvfs("/")
    usado = (st.f_blocks - st.f_bfree) * st.f_frsize
    return {
        "em": agora or agora_iso(),
        "donos": classificar_disco({k: v for k, v in medidos.items() if v is not None}, usado),
    }


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
    if comando == "retrato":
        DIR_ESTADO.mkdir(parents=True, exist_ok=True)
        dado = retrato()
        if dado is None:
            return 1
        gravar_json(DIR_ESTADO / "retrato.json", dado)
        return 0
    if comando == "disco":
        DIR_ESTADO.mkdir(parents=True, exist_ok=True)
        gravar_json(DIR_ESTADO / "disco-por-dono.json", disco())
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
