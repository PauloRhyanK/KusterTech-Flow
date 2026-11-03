"""Capacidade global da Fábrica: vagas de raias, RAM mínima e trava de orquestrador por repositório.

O estado fica num único JSON (`~/fabrica/capacidade.json`), compartilhado entre os despachantes
de plano. Toda escrita acontece sob `fcntl.flock` em `<caminho>.lock` e é atômica (temporário no
mesmo diretório + `os.replace`). Só biblioteca padrão; este módulo não importa o despachante.
"""

from __future__ import annotations

import contextlib
import copy
import fcntl
import json
import os
import pathlib

VAGAS_PADRAO = 3
RAM_MINIMA_PADRAO_MB = 2048
VAGAS_APOS_OOM = 2


class CapacidadeInvalida(ValueError):
    """O arquivo de capacidade existe, mas não é um JSON no formato esperado."""


def _padrao() -> dict:
    return {
        "vagasConfig": VAGAS_PADRAO,
        "ramMinimaMb": RAM_MINIMA_PADRAO_MB,
        "oomEm": None,
        "reservas": {},
        "orquestrador": {},
        "esperando": {},
        "drenagem": None,
    }


def _inteiro(valor) -> bool:
    return isinstance(valor, int) and not isinstance(valor, bool)


def _drenagem_valida(valor) -> bool:
    return valor is None or (isinstance(valor, str) and bool(valor))


def _validar(dados, caminho) -> dict:
    """Completa as chaves ausentes com o padrão e confere os tipos; o resto é corrupção."""
    if not isinstance(dados, dict):
        raise CapacidadeInvalida("%s: o conteúdo deve ser um objeto JSON." % caminho)
    resultado = _padrao()
    resultado.update(dados)
    problemas = []
    if not _inteiro(resultado["vagasConfig"]) or resultado["vagasConfig"] < 1:
        problemas.append("vagasConfig deve ser inteiro maior ou igual a 1")
    if not _inteiro(resultado["ramMinimaMb"]) or resultado["ramMinimaMb"] < 0:
        problemas.append("ramMinimaMb deve ser inteiro não negativo")
    oom = resultado["oomEm"]
    if oom is not None and (not isinstance(oom, str) or not oom):
        problemas.append("oomEm deve ser texto não vazio ou nulo")
    reservas = resultado["reservas"]
    if not isinstance(reservas, dict) or not all(
        isinstance(raias, list) and all(isinstance(r, str) for r in raias)
        for raias in reservas.values()
    ):
        problemas.append("reservas deve mapear plano para lista de raias")
    orquestrador = resultado["orquestrador"]
    if not isinstance(orquestrador, dict) or not all(
        isinstance(plano, str) for plano in orquestrador.values()
    ):
        problemas.append("orquestrador deve mapear repositório para plano")
    esperando = resultado["esperando"]
    if not isinstance(esperando, dict) or not all(
        isinstance(planos, list) and all(isinstance(p, str) for p in planos)
        for planos in esperando.values()
    ):
        problemas.append("esperando deve mapear repositório para lista de planos")
    if not _drenagem_valida(resultado["drenagem"]):
        problemas.append("drenagem deve ser texto não vazio ou nulo")
    if problemas:
        raise CapacidadeInvalida("%s: %s." % (caminho, "; ".join(problemas)))
    resultado["reservas"] = {plano: sorted(set(raias)) for plano, raias in reservas.items()}
    normalizado = {repo.lower(): plano for repo, plano in orquestrador.items()}
    if len(normalizado) != len(orquestrador):
        raise CapacidadeInvalida(
            "%s: orquestrador tem repositórios repetidos (maiúsculas e minúsculas)." % caminho
        )
    resultado["orquestrador"] = normalizado
    # a espera é FIFO: sem duplicata, mantendo a ordem de chegada
    fila = {repo.lower(): list(dict.fromkeys(planos)) for repo, planos in esperando.items()}
    if len(fila) != len(esperando):
        raise CapacidadeInvalida(
            "%s: esperando tem repositórios repetidos (maiúsculas e minúsculas)." % caminho
        )
    resultado["esperando"] = fila
    return resultado


def _ler_arquivo(caminho: pathlib.Path) -> dict:
    try:
        texto = caminho.read_text(encoding="utf-8")
    except FileNotFoundError:
        return _padrao()
    except (OSError, UnicodeDecodeError) as erro:
        raise CapacidadeInvalida("%s: não foi possível ler (%s)." % (caminho, erro)) from erro
    try:
        dados = json.loads(texto)
    except ValueError as erro:
        raise CapacidadeInvalida("%s: JSON ilegível (%s)." % (caminho, erro)) from erro
    return _validar(dados, caminho)


def _gravar_atomico(caminho: pathlib.Path, dados: dict) -> None:
    texto = json.dumps(dados, ensure_ascii=False, indent=1, allow_nan=False) + "\n"
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


@contextlib.contextmanager
def _transacao(caminho, *, recriar_se_corrompido=False):
    """Trava `<caminho>.lock` (bloqueante), lê o estado e grava de volta se o bloco o alterou.

    Com `recriar_se_corrompido`, um arquivo corrompido vira o padrão e é sempre regravado.
    """
    caminho = pathlib.Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(caminho.with_name(caminho.name + ".lock"), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        corrompido = False
        try:
            dados = _ler_arquivo(caminho)
        except CapacidadeInvalida:
            if not recriar_se_corrompido:
                raise
            dados = _padrao()
            corrompido = True
        original = copy.deepcopy(dados)
        yield dados
        if corrompido or dados != original or not caminho.exists():
            _gravar_atomico(caminho, dados)
    finally:
        os.close(fd)


def ler(caminho) -> dict:
    """O estado atual; arquivo ausente vale o padrão e arquivo corrompido levanta `CapacidadeInvalida`."""
    return _ler_arquivo(pathlib.Path(caminho))


def configurar(caminho, *, vagas: int, ram_minima_mb: int) -> None:
    """Define vagas e RAM mínima e limpa o `oomEm`: o comando do Paulo para subir as vagas de volta.

    Se o arquivo estiver corrompido, regrava a partir dos padrões (sem reservas nem travas).
    """
    if not _inteiro(vagas) or vagas < 1:
        raise ValueError("vagas deve ser um inteiro maior ou igual a 1.")
    if not _inteiro(ram_minima_mb) or ram_minima_mb < 0:
        raise ValueError("ram_minima_mb deve ser um inteiro não negativo.")
    with _transacao(caminho, recriar_se_corrompido=True) as dados:
        dados["vagasConfig"] = vagas
        dados["ramMinimaMb"] = ram_minima_mb
        dados["oomEm"] = None


def definir_drenagem(caminho, desde: str | None) -> None:
    """Marca (instante) ou limpa (`None`) a drenagem do Warren pedida pelo coordenador.

    Enquanto ela está marcada, os despachantes de plano não criam runs nem mergeiam: o coordenador
    espera os runs ativos acabarem para reiniciar o Warren sem matar trabalho pago.
    """
    if not _drenagem_valida(desde):
        raise ValueError("desde deve ser texto não vazio ou None.")
    with _transacao(caminho) as dados:
        dados["drenagem"] = desde


def vagas_efetivas(dados: dict) -> int:
    """Vagas em uso pela regra: no máximo 2 depois de um OOM, `vagasConfig` caso contrário."""
    if dados.get("oomEm"):
        return min(dados["vagasConfig"], VAGAS_APOS_OOM)
    return dados["vagasConfig"]


def reservar(caminho, plano: str, raia: str, *, mem_disponivel_mb: int | None) -> bool:
    """Reserva uma vaga para a raia nova. Idempotente; recusa sem vaga ou com pouca RAM."""
    with _transacao(caminho) as dados:
        reservas = dados["reservas"]
        if raia in reservas.get(plano, []):
            return True
        if sum(len(raias) for raias in reservas.values()) >= vagas_efetivas(dados):
            return False
        if mem_disponivel_mb is not None and mem_disponivel_mb < dados["ramMinimaMb"]:
            return False
        reservas[plano] = sorted([*reservas.get(plano, []), raia])
        return True


def sincronizar(caminho, plano: str, ocupadas: set[str]) -> None:
    """Grava as raias realmente ocupadas do plano; conjunto vazio libera a chave."""
    with _transacao(caminho) as dados:
        if ocupadas:
            dados["reservas"][plano] = sorted(ocupadas)
        else:
            dados["reservas"].pop(plano, None)


def registrar_oom(caminho, agora: str) -> None:
    """Marca o OOM: daqui em diante `vagas_efetivas` não passa de 2 até o `configurar`."""
    with _transacao(caminho) as dados:
        dados["oomEm"] = agora


def tomar_orquestrador(caminho, repo: str, plano: str, *, em_curso: bool = False) -> bool:
    """Toma a trava de orquestrador do repositório; True se já era do plano ou se ele pôde tomá-la.

    A espera é FIFO por repositório: com a trava livre, só toma o primeiro da espera (ou qualquer um,
    com a espera vazia), e quem toma sai dela. Recusado, o plano entra no fim da espera, uma vez só.
    Com `em_curso` (o plano já tem run ou PR do orquestrador: é o dono de fato), a trava livre é tomada
    fora da ordem da espera, e a recusa não entra na espera.
    """
    chave = repo.lower()
    with _transacao(caminho) as dados:
        dono = dados["orquestrador"].get(chave)
        fila = dados["esperando"].get(chave, [])
        if dono == plano or (dono is None and (em_curso or not fila or fila[0] == plano)):
            dados["orquestrador"][chave] = plano
            restante = [p for p in fila if p != plano]
            if restante:
                dados["esperando"][chave] = restante
            else:
                dados["esperando"].pop(chave, None)
            return True
        if not em_curso and plano not in fila:
            dados["esperando"][chave] = [*fila, plano]
        return False


def desistir_orquestrador(caminho, repo: str, plano: str) -> None:
    """Tira o plano da espera do repositório (ele não quer mais acordar agora); a trava não muda."""
    chave = repo.lower()
    with _transacao(caminho) as dados:
        fila = dados["esperando"].get(chave)
        if fila is None or plano not in fila:
            return
        restante = [p for p in fila if p != plano]
        if restante:
            dados["esperando"][chave] = restante
        else:
            del dados["esperando"][chave]


def soltar_orquestrador(caminho, repo: str, plano: str) -> None:
    """Solta a trava do repositório, somente se for do plano; a espera não muda."""
    chave = repo.lower()
    with _transacao(caminho) as dados:
        if dados["orquestrador"].get(chave) == plano:
            del dados["orquestrador"][chave]


def limpar_orfaos(caminho, ativos: set[str]) -> list[str]:
    """Remove reservas, travas e lugares na espera de planos fora de `ativos`; devolve os ids removidos."""
    with _transacao(caminho) as dados:
        removidos = {plano for plano in dados["reservas"] if plano not in ativos}
        removidos |= {plano for plano in dados["orquestrador"].values() if plano not in ativos}
        removidos |= {p for planos in dados["esperando"].values() for p in planos if p not in ativos}
        fila = {repo: [p for p in planos if p in ativos] for repo, planos in dados["esperando"].items()}
        dados["esperando"] = {repo: planos for repo, planos in fila.items() if planos}
        for plano in removidos:
            dados["reservas"].pop(plano, None)
        dados["orquestrador"] = {
            repo: plano for repo, plano in dados["orquestrador"].items() if plano in ativos
        }
        return sorted(removidos)


def mem_disponivel_mb(meminfo: str = "/proc/meminfo") -> int | None:
    """`MemAvailable` em MB, ou `None` quando o arquivo falta ou não tem um valor legível."""
    try:
        with open(meminfo, encoding="utf-8") as arquivo:
            for linha in arquivo:
                if linha.startswith("MemAvailable:"):
                    return int(linha.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        return None
    return None
