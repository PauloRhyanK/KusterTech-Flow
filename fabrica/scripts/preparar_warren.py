"""Aplica o `--model` no adaptador `claude-code` do Warren 0.19.3 (só stdlib).

O Warren 0.19.3 monta o argv do `claude` sem `--model`, então todo run do runtime `claude-code` roda no
modelo padrão da conta. O `ctx.frontmatter.model` que chega ao adaptador já é o modelo efetivo do run
(o `modelOverride` da API vem dobrado nele), como o runtime `pi` usa em `pi-argv.ts`.

`preparar` é idempotente e conservador:

1. lê o arquivo instalado (`sudo -n -u agentops cat`) e confere o sha256 do original exato;
2. com o marcador, nada a fazer; com outro sha, nada é tocado;
3. só segue sem runs não terminais no Warren (o restart mataria os runs);
4. faz backup (`cp -p`, sem sobrescrever um backup que já exista, e só se ele for o original);
5. grava o conteúdo novo num temporário (`tee`), valida o módulo com o `bun` e só então troca (`mv -f`);
6. reinicia o serviço e espera o Warren responder; se ele não voltar, restaura o backup e reinicia de novo.

Todos os comandos são listas de argumentos (sem shell) e os privilegiados usam `sudo -n`. Nenhum token
passa por aqui. Qualquer exceção vira `{"estado": "erro", "detalhe": "Tipo: mensagem curta"}`.
"""

import hashlib
import json
import subprocess
import time

CAMINHO_PADRAO = "/home/agentops/.bun/install/global/node_modules/@os-eco/warren-cli/src/runtime/adapters/claude-code.ts"
SHA_ORIGINAL_0_19_3 = "dcd242f8ebb5b24e9057cc90f13ee4789e8a04ff23c208056fd49893c12c41db"
MARCADOR = "fabrica:model-flag"
ANCORA = '"--dangerously-skip-permissions",'
LINHA_MODEL = (
    '...(typeof ctx.frontmatter?.model === "string" && ctx.frontmatter.model.trim() !== "" '
    '? ["--model", ctx.frontmatter.model.trim()] : []), // ' + MARCADOR
)
SUFIXO_BACKUP = ".fabrica-orig"
# O bun escolhe o loader pela extensão: sem `.ts` o módulo seria lido como JavaScript.
SUFIXO_NOVO = ".fabrica-novo.ts"
BUN_PADRAO = "/home/agentops/.bun/bin/bun"
MODELO_DE_VALIDACAO = "claude-haiku-5-5"
ESPERA_MAXIMA_S = 90
INTERVALO_S = 3
TIMEOUT_COMANDO_S = 60
TIMEOUT_RESTART_S = 120
LIMITE_DETALHE = 300

ESTADOS = ("ja_aplicado", "versao_desconhecida", "aguardando_runs", "aplicado", "erro")


class FalhaDeComando(RuntimeError):
    """Um comando terminou com código diferente de zero."""


def _curto(texto) -> str:
    linhas = str(texto).strip().splitlines()
    return (linhas[0] if linhas else "")[:LIMITE_DETALHE]


def _detalhe_de(exc: BaseException) -> str:
    try:
        mensagem = str(exc)
    except Exception:  # noqa: BLE001 - uma mensagem quebrada não pode derrubar o registro
        mensagem = ""
    return _curto("%s: %s" % (type(exc).__name__, _curto(mensagem)))


def aplicar_patch(texto: str) -> str:
    """Insere a linha do `--model` logo depois da âncora, no `argv` de `buildSpawnCommand`, com a mesma indentação.

    `ValueError` se o marcador já estiver presente, se a âncora não aparecer exatamente uma vez ou se ela não
    estiver dentro do `argv: [ ... ]` de `buildSpawnCommand`.
    """
    if MARCADOR in texto:
        raise ValueError("o marcador %s já está presente" % MARCADOR)
    ocorrencias = texto.count(ANCORA)
    if ocorrencias != 1:
        raise ValueError("a âncora %s aparece %d vezes (esperado: 1)" % (ANCORA, ocorrencias))
    linhas = texto.split("\n")
    (indice,) = [i for i, linha in enumerate(linhas) if ANCORA in linha]
    inicio = next((i for i, linha in enumerate(linhas) if "buildSpawnCommand(" in linha), None)
    if inicio is None or inicio > indice:
        raise ValueError("a âncora não está em buildSpawnCommand")
    abertura = next((i for i in range(inicio, indice) if linhas[i].strip() == "argv: ["), None)
    if abertura is None or any(linhas[i].strip().startswith("]") for i in range(abertura + 1, indice)):
        raise ValueError("a âncora não está no argv de buildSpawnCommand")
    linha = linhas[indice]
    if linha.strip().rstrip("\r") != ANCORA:
        raise ValueError("a linha da âncora tem outro conteúdo")
    indentacao = linha[: len(linha) - len(linha.lstrip())]
    fim = "\r" if linha.endswith("\r") else ""
    linhas.insert(indice + 1, indentacao + LINHA_MODEL + fim)
    return "\n".join(linhas)


def script_de_validacao(caminho_novo: str) -> str:
    """Script do `bun -e`: sai com 0 só se o `--model` aparece com o modelo e some sem ele, sem mexer no resto."""
    return "\n".join(
        [
            "const MODELO = %s;" % json.dumps(MODELO_DE_VALIDACAO),
            "const contexto = (frontmatter) => ({",
            '  runId: "x",',
            '  prompt: "p",',
            '  workspacePath: "/tmp/fabrica-validacao",',
            "  pendingMessages: [],",
            "  frontmatter,",
            "});",
            "(async () => {",
            "  const m = await import(%s);" % json.dumps(caminho_novo),
            "  const com = m.claudeCodeAdapter.buildSpawnCommand(contexto({ model: MODELO })).argv;",
            "  const sem = m.claudeCodeAdapter.buildSpawnCommand(contexto({})).argv;",
            "  const vazio = m.claudeCodeAdapter.buildSpawnCommand(contexto({ model: \"  \" })).argv;",
            '  const i = com.indexOf("--model");',
            "  const resto = com.filter((_, k) => k !== i && k !== i + 1);",
            "  const ok =",
            "    i >= 0 &&",
            "    com[i + 1] === MODELO &&",
            '    com.filter((a) => a === "--model").length === 1 &&',
            '    !sem.includes("--model") &&',
            '    !vazio.includes("--model") &&',
            '    sem.includes("--dangerously-skip-permissions") &&',
            "    JSON.stringify(resto) === JSON.stringify(sem);",
            '  // frontmatter: {} sem --model; frontmatter: { model: MODELO } com "--model" MODELO',
            "  process.exit(ok ? 0 : 1);",
            "})().catch(() => process.exit(1));",
            "",
        ]
    )


def preparar(
    *,
    executar=subprocess.run,
    visao_geral,
    versao,
    caminho: str = CAMINHO_PADRAO,
    usuario: str = "agentops",
    bun: str = BUN_PADRAO,
    servico: str = "warren.service",
    dormir=time.sleep,
    sha_esperado: str = SHA_ORIGINAL_0_19_3,
) -> dict:
    """`{"estado": um de ESTADOS, "detalhe": str}`. Nunca lança."""
    try:
        return _preparar(
            executar=executar,
            visao_geral=visao_geral,
            versao=versao,
            caminho=caminho,
            usuario=usuario,
            bun=bun,
            servico=servico,
            dormir=dormir,
            sha_esperado=sha_esperado,
        )
    except Exception as exc:  # noqa: BLE001 - o despachante só registra; nunca traceback
        return {"estado": "erro", "detalhe": _detalhe_de(exc)}


def _resultado(estado: str, detalhe: str) -> dict:
    return {"estado": estado, "detalhe": _curto(detalhe)}


def _preparar(*, executar, visao_geral, versao, caminho, usuario, bun, servico, dormir, sha_esperado) -> dict:
    backup = caminho + SUFIXO_BACKUP
    novo = caminho + SUFIXO_NOVO

    def rodar(nome, *argv, entrada=None, timeout=TIMEOUT_COMANDO_S, privilegiado=False):
        """Roda e devolve o `CompletedProcess` sem checar o código (`nome` é o rótulo usado por `exigir`)."""
        prefixo = ["sudo", "-n"] if privilegiado else ["sudo", "-n", "-u", usuario]
        return executar(prefixo + list(argv), input=entrada, capture_output=True, timeout=timeout, cwd="/")

    def exigir(nome, *argv, entrada=None, timeout=TIMEOUT_COMANDO_S, privilegiado=False):
        resultado = rodar(nome, *argv, entrada=entrada, timeout=timeout, privilegiado=privilegiado)
        if resultado.returncode != 0:
            erro = resultado.stderr.decode("utf-8", "replace") if isinstance(resultado.stderr, bytes) else resultado.stderr
            raise FalhaDeComando("%s falhou (código %s): %s" % (nome, resultado.returncode, _curto(erro or "")))
        return resultado

    def ler(alvo) -> bytes:
        saida = exigir("cat", "cat", alvo).stdout
        if not isinstance(saida, bytes):
            raise FalhaDeComando("cat %s não devolveu bytes" % alvo)
        return saida

    def apagar_novo():
        try:
            rodar("rm", "rm", "-f", novo)
        except Exception:  # noqa: BLE001 - o temporário fora do lugar é inofensivo; o erro original vale mais
            pass

    def reiniciar() -> bool:
        try:
            return rodar("systemctl", "systemctl", "restart", servico, timeout=TIMEOUT_RESTART_S, privilegiado=True).returncode == 0
        except Exception:  # noqa: BLE001 - restart sem confirmação é tratado como Warren fora
            return False

    def restaurar(motivo: str) -> dict:
        exigir("mv (restaurar)", "mv", "-f", backup, caminho)
        reiniciar()
        return _resultado("erro", "%s; o original foi restaurado e o %s reiniciado de novo" % (motivo, servico))

    # 1-2: o arquivo instalado
    conteudo = ler(caminho)
    sha = hashlib.sha256(conteudo).hexdigest()
    if MARCADOR.encode("utf-8") in conteudo:
        return _resultado("ja_aplicado", "o adaptador claude-code já tem o --model (%s)" % MARCADOR)
    if sha != sha_esperado:
        return _resultado("versao_desconhecida", "sha256 %s não é o do original esperado; nada foi tocado" % sha[:12])
    texto_novo = aplicar_patch(conteudo.decode("utf-8"))

    # 3: o restart mataria runs em andamento
    visao = visao_geral()
    runs = visao.get("runs") if isinstance(visao, dict) else None
    ativos = runs.get("nonTerminal") if isinstance(runs, dict) else None
    if not isinstance(ativos, int) or isinstance(ativos, bool) or ativos < 0:
        raise ValueError("visao_geral sem runs.nonTerminal válido")
    if ativos > 0:
        return _resultado("aguardando_runs", "%d runs não terminais no Warren; o patch fica para depois" % ativos)

    # 4: backup do original, sem sobrescrever um que já exista
    if rodar("test", "test", "-e", backup).returncode == 0:
        if hashlib.sha256(ler(backup)).hexdigest() != sha_esperado:
            return _resultado("erro", "o backup %s já existe e não é o original; nada foi tocado" % backup)
    else:
        exigir("cp", "cp", "-p", caminho, backup)

    # 5-6: temporário, validação com o bun e troca atômica
    try:
        exigir("tee", "tee", novo, entrada=texto_novo.encode("utf-8"))
        validacao = rodar("bun", bun, "-e", script_de_validacao(novo))
        if validacao.returncode != 0:
            apagar_novo()
            return _resultado("erro", "a validação do módulo novo com o bun falhou (código %s); o original está intacto" % validacao.returncode)
        exigir("mv", "mv", "-f", novo, caminho)
    except Exception:
        apagar_novo()
        raise

    # 7-8: restart e espera
    if not reiniciar():
        return restaurar("o restart do %s falhou" % servico)
    for _ in range(ESPERA_MAXIMA_S // INTERVALO_S):
        dormir(INTERVALO_S)
        try:
            resposta = versao()
        except Exception:  # noqa: BLE001 - ainda subindo
            continue
        if isinstance(resposta, str) and resposta.strip():
            return _resultado("aplicado", "--model aplicado no adaptador claude-code; Warren %s de volta" % resposta.strip())
    return restaurar("o Warren não respondeu em %d s depois do restart" % ESPERA_MAXIMA_S)
