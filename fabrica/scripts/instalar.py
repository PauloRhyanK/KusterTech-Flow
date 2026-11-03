"""Instalador da Fábrica de agentes: copia o kit para um repositório e cria as configurações iniciais.

Local e sem rede. Idempotente: uma segunda execução não cria nem atualiza nada.
Uso: python3 -I fabrica/scripts/instalar.py <destino> [--kit <raiz do kit>]
"""

import argparse
import json
import os
import pathlib
import sys
import tempfile

KIT_PADRAO = pathlib.Path(__file__).resolve().parents[2]

MARCADOR_INICIO = "<!-- fabrica:inicio -->"
MARCADOR_FIM = "<!-- fabrica:fim -->"
AVISO_WARREN = "confira que .warren/config.yaml não liga pr.autoMerge e tem admission.maxConcurrentRuns"
NIVEIS_DE_ESFORCO = ("low", "medium", "high", "xhigh", "max")

ARQ_CONFIG = ".fabrica/config.json"
ARQ_WARREN = ".warren/config.yaml"
ARQ_AGENTS = "AGENTS.md"
ARQ_GITIGNORE = ".gitignore"
IGNORADOS_NOS_RUNS = (".claude/.credentials.json", ".pnpm-store/")
ARQ_SETTINGS = ".claude/settings.json"


def _gravar(caminho: pathlib.Path, dados: bytes) -> None:
    """Grava por arquivo temporário no mesmo diretório e renomeia: nunca deixa um arquivo pela metade."""
    caminho.parent.mkdir(parents=True, exist_ok=True)
    descritor, temporario = tempfile.mkstemp(dir=caminho.parent, prefix=caminho.name + ".", suffix=".tmp")
    try:
        with os.fdopen(descritor, "wb") as arquivo:
            arquivo.write(dados)
        if caminho.exists():
            os.chmod(temporario, caminho.stat().st_mode & 0o7777)
        else:
            os.chmod(temporario, 0o644)
        os.replace(temporario, caminho)
    except BaseException:
        try:
            os.unlink(temporario)
        except OSError:
            pass
        raise


class _Relatorio:
    def __init__(self, destino: pathlib.Path):
        self.destino = destino
        self.criados: list[str] = []
        self.atualizados: list[str] = []
        self.avisos: list[str] = []

    def gravar(self, relativo: str, dados: bytes) -> None:
        """Cria ou atualiza `relativo`; não regrava quando o conteúdo já é esse."""
        caminho = self.destino / relativo
        if self.recusa_link(relativo):
            return
        if caminho.is_file():
            if caminho.read_bytes() == dados:
                return
            _gravar(caminho, dados)
            self.atualizados.append(relativo)
        else:
            _gravar(caminho, dados)
            self.criados.append(relativo)

    def recusa_link(self, relativo: str) -> bool:
        """Arquivo que é link simbólico não é lido nem gravado: avisa e devolve `True`."""
        if not (self.destino / relativo).is_symlink():
            return False
        aviso = "%s é link simbólico; não alterado" % relativo
        if aviso not in self.avisos:
            self.avisos.append(aviso)
        return True

    def resultado(self) -> dict:
        return {"criados": sorted(self.criados), "atualizados": sorted(self.atualizados), "avisos": list(self.avisos)}


# ---------------------------------------------------------------- o kit


def _arquivo_do_kit(kit: pathlib.Path, relativo: str) -> pathlib.Path:
    caminho = kit / "fabrica" / relativo
    if not caminho.is_file():
        raise ValueError("arquivo ausente no kit: %s" % caminho)
    return caminho


def _equipes_do_kit(kit: pathlib.Path) -> list[pathlib.Path]:
    pasta = kit / "fabrica" / "equipes"
    pacotes = sorted(p for p in pasta.glob("*.md") if p.is_file()) if pasta.is_dir() else []
    if not pacotes:
        raise ValueError("sem pacotes de papel (*.md) no kit: %s" % pasta)
    return pacotes


def _esforcos_do_modelo(config: dict, caminho: pathlib.Path) -> tuple[dict, list[str]]:
    """Esforço por modelo (o maior entre os papéis que o usam) e os avisos dos empates desiguais."""
    modelos = config.get("modelos") if isinstance(config, dict) else None
    if not isinstance(modelos, dict):
        raise ValueError("config.json do kit inválido (modelos): %s" % caminho)
    por_modelo: dict[str, dict[str, str]] = {}
    for papel, entrada in modelos.items():
        if not isinstance(entrada, dict):
            raise ValueError("config.json do kit inválido (modelos.%s): %s" % (papel, caminho))
        if "esforco" not in entrada:
            continue
        esforco, modelo = entrada["esforco"], entrada.get("modelo")
        if esforco not in NIVEIS_DE_ESFORCO or not isinstance(modelo, str) or not modelo:
            raise ValueError("config.json do kit inválido (modelos.%s.esforco): %s" % (papel, caminho))
        por_modelo.setdefault(modelo, {})[papel] = esforco
    efetivos, avisos = {}, []
    for modelo, papeis in por_modelo.items():
        efetivo = max(papeis.values(), key=NIVEIS_DE_ESFORCO.index)
        efetivos[modelo] = efetivo
        if len(set(papeis.values())) > 1:
            detalhe = ", ".join("%s=%s" % (p, e) for p, e in papeis.items())
            avisos.append("o modelo %s tem papéis com esforços diferentes (%s); vale o maior (%s)" % (modelo, detalhe, efetivo))
    return efetivos, avisos


def _carregar_kit(kit: pathlib.Path) -> dict:
    """Lê e valida tudo do kit antes de escrever qualquer coisa no destino."""
    copias = {".fabrica/orquestrador.md": _arquivo_do_kit(kit, "orquestrador.md")}
    for pacote in _equipes_do_kit(kit):
        copias[".fabrica/equipes/" + pacote.name] = pacote
    copias[".fabrica/PADROES-COMUNS.md"] = _arquivo_do_kit(kit, "PADROES-COMUNS.md")
    copias[".fabrica/raias.py"] = _arquivo_do_kit(kit, "scripts/raias.py")
    copias[".fabrica/globs.py"] = _arquivo_do_kit(kit, "scripts/globs.py")
    caminho_config = _arquivo_do_kit(kit, "modelos/config.json")
    config_bytes = caminho_config.read_bytes()
    try:
        config = json.loads(config_bytes.decode("utf-8"))
    except ValueError:
        raise ValueError("config.json do kit não é JSON: %s" % caminho_config) from None
    efetivos, avisos_de_esforco = _esforcos_do_modelo(config, caminho_config)
    warren = _arquivo_do_kit(kit, "modelos/warren-config.yaml").read_bytes()
    caminho_agents = _arquivo_do_kit(kit, "modelos/AGENTS.md")
    try:
        bloco = caminho_agents.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise ValueError("AGENTS.md do kit não é UTF-8: %s" % caminho_agents) from None
    if _posicoes_do_bloco(bloco, "AGENTS.md do kit: " + str(caminho_agents)) is None:
        raise ValueError("AGENTS.md do kit sem os marcadores fabrica:inicio/fabrica:fim: %s" % caminho_agents)
    return {
        "copias": copias,
        "config": config_bytes,
        "warren": warren,
        "bloco": bloco.strip("\n"),
        "esforcos": efetivos,
        "avisos_de_esforco": avisos_de_esforco,
    }


# ---------------------------------------------------------------- o destino


def _tem_ci(destino: pathlib.Path) -> bool:
    pasta = destino / ".github" / "workflows"
    if not pasta.is_dir():
        return False
    return any(p.is_file() for padrao in ("*.yml", "*.yaml") for p in pasta.glob(padrao))


def _validar_destino(destino: pathlib.Path, *, sem_ci: bool = False) -> None:
    if not destino.is_dir():
        raise ValueError("destino não é uma pasta: %s" % destino)
    if not sem_ci and not _tem_ci(destino):
        raise ValueError("sem CI: crie .github/workflows antes")
    if not (destino / ".seeds").is_dir():
        raise ValueError("sem Seeds: rode sd init")


def _validar_caminhos(destino: pathlib.Path, arquivos: list[str]) -> None:
    """Tudo ou nada, antes de gravar: nenhum diretório do caminho é link, tudo fica dentro do destino e os tipos batem.

    Um arquivo que é link simbólico não é erro aqui: `_Relatorio.recusa_link` o recusa com aviso.
    """
    base = destino.resolve()
    pastas = set()
    for relativo in arquivos:
        partes = pathlib.PurePosixPath(relativo).parts
        for n in range(1, len(partes)):
            pastas.add("/".join(partes[:n]))
    for relativo in sorted(pastas):
        caminho = destino / relativo
        if caminho.is_symlink():
            raise ValueError("pasta do destino é link simbólico: %s" % caminho)
        if caminho.exists() and not caminho.is_dir():
            raise ValueError("esperava uma pasta, mas é um arquivo: %s" % caminho)
        if not caminho.resolve(strict=False).is_relative_to(base):
            raise ValueError("pasta do destino fica fora do destino: %s" % caminho)
    for relativo in arquivos:
        caminho = destino / relativo
        if caminho.is_symlink():
            continue
        if caminho.exists() and not caminho.is_file():
            raise ValueError("esperava um arquivo, mas é uma pasta: %s" % caminho)


def _posicoes_do_bloco(texto: str, origem: str) -> tuple[int, int] | None:
    """(início, fim) do bloco da fábrica em `texto`, `None` se não há, ValueError se os marcadores estão quebrados."""
    abre, fecha = texto.count(MARCADOR_INICIO), texto.count(MARCADOR_FIM)
    if abre == 0 and fecha == 0:
        return None
    if abre != 1 or fecha != 1:
        raise ValueError("%s: marcadores fabrica:inicio/fabrica:fim em número diferente de um par" % origem)
    inicio, fim = texto.index(MARCADOR_INICIO), texto.index(MARCADOR_FIM)
    if fim < inicio:
        raise ValueError("%s: marcador fabrica:fim vem antes de fabrica:inicio" % origem)
    return inicio, fim + len(MARCADOR_FIM)


def _instalar_gitignore(relatorio: _Relatorio) -> None:
    """Acrescenta o que os runs deixam no workspace: credenciais do agente e o store do pnpm nunca entram em commit."""
    if relatorio.recusa_link(ARQ_GITIGNORE):
        return
    caminho = relatorio.destino / ARQ_GITIGNORE
    if not caminho.exists():
        relatorio.gravar(ARQ_GITIGNORE, ("\n".join(IGNORADOS_NOS_RUNS) + "\n").encode("utf-8"))
        return
    try:
        atual = caminho.read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        relatorio.avisos.append(".gitignore não é UTF-8; não foi alterado: acrescente %s" % ", ".join(IGNORADOS_NOS_RUNS))
        return
    linhas = {linha.strip() for linha in atual.splitlines()}
    faltando = [item for item in IGNORADOS_NOS_RUNS if item not in linhas]
    if faltando:
        separador = "" if not atual or atual.endswith("\n") else "\n"
        _gravar(caminho, (atual + separador + "\n".join(faltando) + "\n").encode("utf-8"))
        relatorio.atualizados.append(ARQ_GITIGNORE)


def _instalar_agents(relatorio: _Relatorio, bloco: str) -> None:
    caminho = relatorio.destino / ARQ_AGENTS
    if relatorio.recusa_link(ARQ_AGENTS):
        return
    if not caminho.exists():
        relatorio.gravar(ARQ_AGENTS, (bloco + "\n").encode("utf-8"))
        return
    try:
        atual = caminho.read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        relatorio.avisos.append("AGENTS.md não é UTF-8; não foi alterado: acrescente o bloco da fábrica à mão")
        return
    try:
        posicoes = _posicoes_do_bloco(atual, "AGENTS.md")
    except ValueError as erro:
        relatorio.avisos.append("%s; não foi alterado: ajuste os marcadores e rode de novo" % erro)
        return
    quebra = "\r\n" if "\r\n" in atual else "\n"
    bloco = bloco.replace("\n", quebra)
    if posicoes is not None:
        novo = atual[: posicoes[0]] + bloco + atual[posicoes[1] :]
    elif not atual:
        novo = bloco + quebra
    else:
        separador = "" if atual.endswith("\n") else quebra
        novo = atual + separador + quebra + bloco + quebra
    if novo != atual:
        _gravar(caminho, novo.encode("utf-8"))
        relatorio.atualizados.append(ARQ_AGENTS)


def _instalar_settings(relatorio: _Relatorio, esforcos: dict) -> None:
    if not esforcos:
        return
    caminho = relatorio.destino / ARQ_SETTINGS
    if relatorio.recusa_link(ARQ_SETTINGS):
        return
    desejado = {modelo: {"effortLevel": nivel} for modelo, nivel in esforcos.items()}
    if not caminho.exists():
        dados = {"modelSettings": desejado}
        relatorio.gravar(ARQ_SETTINGS, (json.dumps(dados, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
        return
    try:
        atual = json.loads(caminho.read_bytes().decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        atual = None
    if not isinstance(atual, dict):
        relatorio.avisos.append(
            ".claude/settings.json não é um objeto JSON válido; não foi alterado: acrescente modelSettings à mão"
        )
        return
    existentes = atual.get("modelSettings", {})
    if not isinstance(existentes, dict):
        relatorio.avisos.append(".claude/settings.json tem modelSettings que não é um objeto; não foi alterado")
        return
    faltam = {}
    for modelo, entrada in desejado.items():
        if modelo not in existentes:
            faltam[modelo] = entrada
        elif not (isinstance(existentes[modelo], dict) and existentes[modelo].get("effortLevel") == entrada["effortLevel"]):
            relatorio.avisos.append(
                ".claude/settings.json: modelSettings.%s já existe com %s e foi mantido (a fábrica pede %s)"
                % (modelo, json.dumps(existentes[modelo], ensure_ascii=False), json.dumps(entrada))
            )
    if not faltam:
        return
    existentes = dict(existentes)
    existentes.update(faltam)
    atual["modelSettings"] = existentes
    _gravar(caminho, (json.dumps(atual, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    relatorio.atualizados.append(ARQ_SETTINGS)


def instalar(destino, *, kit, sem_ci: bool = False) -> dict:
    """Instala o kit em `destino`. `{"criados", "atualizados", "avisos"}`; `ValueError` se algo falta.

    Com `sem_ci`, aceita repositório sem workflows e grava `ciObrigatorioNasSeeds: false` numa config nova.
    """
    destino, kit = pathlib.Path(destino), pathlib.Path(kit)
    _validar_destino(destino, sem_ci=sem_ci)
    conteudo = _carregar_kit(kit)
    if sem_ci:
        config = json.loads(conteudo["config"].decode("utf-8"))
        config["ciObrigatorioNasSeeds"] = False
        conteudo["config"] = (json.dumps(config, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    _validar_caminhos(destino, [*conteudo["copias"], ARQ_CONFIG, ARQ_WARREN, ARQ_AGENTS, ARQ_SETTINGS])
    relatorio = _Relatorio(destino)
    for relativo, origem in conteudo["copias"].items():
        relatorio.gravar(relativo, origem.read_bytes())
    if not relatorio.recusa_link(ARQ_CONFIG) and not (destino / ARQ_CONFIG).exists():
        relatorio.gravar(ARQ_CONFIG, conteudo["config"])
    if not relatorio.recusa_link(ARQ_WARREN):
        if (destino / ARQ_WARREN).exists():
            relatorio.avisos.append(AVISO_WARREN)
        else:
            relatorio.gravar(ARQ_WARREN, conteudo["warren"])
    _instalar_agents(relatorio, conteudo["bloco"])
    _instalar_gitignore(relatorio)
    relatorio.avisos.extend(conteudo["avisos_de_esforco"])
    _instalar_settings(relatorio, conteudo["esforcos"])
    return relatorio.resultado()


# ---------------------------------------------------------------- CLI


def _imprimir(resultado: dict, saida) -> None:
    for chave in ("criados", "atualizados", "avisos"):
        itens = resultado[chave]
        print("%s: %d" % (chave, len(itens)), file=saida)
        for item in itens:
            print("  - " + item, file=saida)


def main(argv=None, *, saida=None, erro=None) -> int:
    saida = sys.stdout if saida is None else saida
    erro = sys.stderr if erro is None else erro
    parser = argparse.ArgumentParser(prog="instalar.py", description="Instala a Fábrica de agentes em um repositório.")
    parser.add_argument("destino", help="raiz do repositório do projeto")
    parser.add_argument("--kit", default=str(KIT_PADRAO), help="raiz do kit (padrão: o repositório deste script)")
    parser.add_argument(
        "--sem-ci", action="store_true", help="aceita repositório sem CI: as seeds mergeiam só com revisão e verificação"
    )
    args = parser.parse_args(argv)
    try:
        resultado = instalar(pathlib.Path(args.destino), kit=pathlib.Path(args.kit), sem_ci=args.sem_ci)
    except ValueError as falha:
        print(str(falha), file=erro)
        return 2
    except OSError as falha:
        print("%s: %s" % (type(falha).__name__, falha), file=erro)
        return 2
    _imprimir(resultado, saida)
    return 0


if __name__ == "__main__":
    sys.exit(main())
