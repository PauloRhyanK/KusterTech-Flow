"""Prepara o Warren 0.19.3 para a fábrica, sem passo manual (só stdlib).

1. **`--model` no adaptador `claude-code`.** O Warren 0.19.3 monta o argv do `claude` sem `--model`, então todo
   run do runtime `claude-code` roda no modelo padrão da conta. O `ctx.frontmatter.model` que chega ao adaptador
   já é o modelo efetivo do run (o `modelOverride` da API vem dobrado nele), como o runtime `pi` usa em `pi-argv.ts`.
2. **Drop-in do systemd** com `WARREN_PLAN_RUN_MERGE_TIMEOUT_MS=10800000`: o despachante precisa de tempo para o
   ciclo revisor → fixer → gates antes de o Plan Run falhar por merge timeout (padrão de 30 min).
3. **`warren-automerge.service` desligado**: ele mergeia PRs com check falhando e foi substituído pelo despachante.

`preparar` é idempotente e conservador:

- lê o adaptador instalado e confere o sha256 do original exato; com outro sha, o adaptador não é tocado;
- o patch e o drop-in entram no MESMO restart, e um restart só acontece com o banco do Warren acessível e zero runs
  não terminais, conferidos duas vezes: antes de preparar e imediatamente antes do `mv` e do restart;
- o patch é validado com o `bun` num temporário e trocado com `mv -f`; uma marca de pendência gravada antes do `mv`
  só sai depois de o Warren responder, e um patch no disco que o processo ainda não carregou (a marca, ou o arquivo
  mais novo que a última subida do serviço) leva a um novo restart, pelos mesmos gates;
- se o Warren não voltar, tudo o que esta chamada mudou é revertido, o serviço é reiniciado de novo e conferido;
  o estado "revertido" suspende as tentativas até o arquivo mudar (`sha_revertido`) ou o despachante reiniciar.

Todos os comandos são listas de argumentos (sem shell), com `sudo -n` (como `agentops` no que é do Warren, como
root no systemd). Nenhum token passa por aqui. Qualquer exceção vira `{"estado": "erro", "detalhe": "Tipo: msg"}`.
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
SUFIXO_PENDENTE = ".fabrica-pendente"
BUN_PADRAO = "/home/agentops/.bun/bin/bun"
MODELO_DE_VALIDACAO = "claude-haiku-5-5"
DROPIN_CONTEUDO = "# gerado pela fábrica de agentes\n[Service]\nEnvironment=WARREN_PLAN_RUN_MERGE_TIMEOUT_MS=10800000\n"
SERVICO_AUTOMERGE = "warren-automerge.service"
ESPERA_MAXIMA_S = 90
INTERVALO_S = 3
TIMEOUT_COMANDO_S = 60
TIMEOUT_RESTART_S = 120
LIMITE_DETALHE = 300

ESTADOS = ("ja_aplicado", "versao_desconhecida", "aguardando_runs", "aplicado", "revertido", "erro")
ESTADOS_DROPIN = ("ok", "alterado", "erro")
ESTADOS_AUTOMERGE = ("desligado", "ausente", "ja_desligado", "erro")
_HABILITADO = ("enabled", "enabled-runtime", "linked", "linked-runtime", "alias")
_ATIVO = ("active", "activating", "reloading", "refreshing")


class FalhaDeComando(RuntimeError):
    """Um comando terminou com código diferente de zero."""


def caminho_dropin(servico: str) -> str:
    return "/etc/systemd/system/%s.d/fabrica.conf" % servico


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
    servico_automerge: str = SERVICO_AUTOMERGE,
    sha_revertido: str | None = None,
) -> dict:
    """`{"estado", "detalhe", "dropin", "automerge", "sha"}` (+ `warrenVoltou` depois de um rollback). Nunca lança."""
    preparo = _Preparo(
        executar=executar,
        visao_geral=visao_geral,
        versao=versao,
        caminho=caminho,
        usuario=usuario,
        bun=bun,
        servico=servico,
        dormir=dormir,
        sha_esperado=sha_esperado,
        servico_automerge=servico_automerge,
        sha_revertido=sha_revertido,
    )
    try:
        return preparo.rodar()
    except Exception as exc:  # noqa: BLE001 - o despachante só registra; nunca traceback
        return preparo.resultado("erro", _detalhe_de(exc))


class _Preparo:
    def __init__(self, *, executar, visao_geral, versao, caminho, usuario, bun, servico, dormir, sha_esperado, servico_automerge, sha_revertido):
        self.executar = executar
        self.visao_geral = visao_geral
        self.versao = versao
        self.caminho = caminho
        self.usuario = usuario
        self.bun = bun
        self.servico = servico
        self.dormir = dormir
        self.sha_esperado = sha_esperado
        self.servico_automerge = servico_automerge
        self.sha_revertido = sha_revertido
        self.backup = caminho + SUFIXO_BACKUP
        self.novo = caminho + SUFIXO_NOVO
        self.pendente = caminho + SUFIXO_PENDENTE
        self.dropin = caminho_dropin(servico)
        self.extra = {"dropin": "erro", "automerge": "erro", "sha": None}
        self._subida = None

    def resultado(self, estado: str, detalhe: str, **mais) -> dict:
        return dict({"estado": estado, "detalhe": _curto(detalhe)}, **self.extra, **mais)

    # ---------------------------------------------------------------- comandos

    def comando(self, *argv, entrada=None, timeout=TIMEOUT_COMANDO_S, root=False):
        """Roda e devolve o `CompletedProcess` sem checar o código: como `usuario`, ou como root com `root`."""
        prefixo = ["sudo", "-n"] if root else ["sudo", "-n", "-u", self.usuario]
        return self.executar(prefixo + list(argv), input=entrada, capture_output=True, timeout=timeout, cwd="/")

    def exigir(self, nome: str, *argv, **opcoes):
        resultado = self.comando(*argv, **opcoes)
        if resultado.returncode != 0:
            erro = resultado.stderr.decode("utf-8", "replace") if isinstance(resultado.stderr, bytes) else resultado.stderr
            raise FalhaDeComando("%s falhou (código %s): %s" % (nome, resultado.returncode, _curto(erro or "")))
        return resultado

    def tentar(self, *argv, **opcoes) -> None:
        """Limpeza que não pode esconder o erro original."""
        try:
            self.comando(*argv, **opcoes)
        except Exception:  # noqa: BLE001
            pass

    @staticmethod
    def saida(resultado) -> str:
        bruto = resultado.stdout
        texto = bruto.decode("utf-8", "replace") if isinstance(bruto, bytes) else str(bruto or "")
        linhas = texto.strip().splitlines()
        return linhas[0].strip() if linhas else ""

    def ler(self, alvo: str, root: bool = False) -> bytes:
        saida = self.exigir("cat", "cat", alvo, root=root).stdout
        if not isinstance(saida, bytes):
            raise FalhaDeComando("cat %s não devolveu bytes" % alvo)
        return saida

    def existe(self, alvo: str, root: bool = False) -> bool:
        return self.comando("test", "-e", alvo, root=root).returncode == 0

    # ---------------------------------------------------------------- consultas

    def desligar_automerge(self) -> str:
        unit = self.servico_automerge
        try:
            carga = self.comando("systemctl", "show", unit, "-P", "LoadState", root=True)
            if carga.returncode != 0:
                return "erro"
            if self.saida(carga) == "not-found":
                return "ausente"
            habilitado = self.saida(self.comando("systemctl", "is-enabled", unit, root=True)) in _HABILITADO
            ativo = self.saida(self.comando("systemctl", "is-active", unit, root=True)) in _ATIVO
            if not habilitado and not ativo:
                return "ja_desligado"
            return "desligado" if self.comando("systemctl", "disable", "--now", unit, root=True).returncode == 0 else "erro"
        except Exception:  # noqa: BLE001 - uma falha aqui vira aviso, nunca erro do patch
            return "erro"

    def ler_dropin(self):
        """`(conteúdo anterior ou None, igual ao esperado)`."""
        if not self.existe(self.dropin, root=True):
            return None, False
        atual = self.ler(self.dropin, root=True)
        return atual, atual == DROPIN_CONTEUDO.encode("utf-8")

    def subida(self):
        """A última subida do serviço (epoch), ou None se ilegível."""
        if self._subida is None:
            resultado = self.comando("systemctl", "show", self.servico, "-P", "ActiveEnterTimestamp", "--timestamp=unix", root=True)
            texto = self.saida(resultado)
            if resultado.returncode != 0 or not texto.startswith("@"):
                return None
            try:
                self._subida = int(texto[1:])
            except ValueError:
                return None
        return self._subida

    def mais_novo_que_o_servico(self, alvo: str, root: bool) -> bool:
        """O arquivo mudou depois da última subida do serviço (o processo não o carregou). Na dúvida, False."""
        try:
            subida = self.subida()
            if subida is None:
                return False
            resultado = self.comando("stat", "-c", "%Y", alvo, root=root)
            if resultado.returncode != 0:
                return False
            return int(self.saida(resultado)) > subida
        except Exception:  # noqa: BLE001
            return False

    def motivo_para_esperar(self):
        """None só com o banco do Warren acessível e zero runs não terminais; senão, o motivo para esperar."""
        try:
            visao = self.visao_geral()
        except Exception as exc:  # noqa: BLE001
            return "visão geral do Warren ilegível (%s)" % _detalhe_de(exc)
        if not isinstance(visao, dict):
            return "visão geral do Warren em formato inesperado"
        servicos = visao.get("services")
        if not isinstance(servicos, dict) or servicos.get("dbReachable") is not True:
            # ops-overview.ts: com o banco fora, o Warren devolve nonTerminal 0 (degradado), que não vale
            return "banco do Warren inacessível na visão geral (services.dbReachable); a contagem de runs não vale"
        runs = visao.get("runs")
        ativos = runs.get("nonTerminal") if isinstance(runs, dict) else None
        if not isinstance(ativos, int) or isinstance(ativos, bool):
            return "visão geral sem runs.nonTerminal válido"
        if ativos != 0:
            return "%d runs não terminais no Warren; o restart fica para depois" % ativos
        return None

    def reiniciar(self) -> bool:
        try:
            return self.comando("systemctl", "restart", self.servico, timeout=TIMEOUT_RESTART_S, root=True).returncode == 0
        except Exception:  # noqa: BLE001 - restart sem confirmação é tratado como Warren fora
            return False

    def esperar(self) -> bool:
        for _ in range(ESPERA_MAXIMA_S // INTERVALO_S):
            self.dormir(INTERVALO_S)
            try:
                resposta = self.versao()
            except Exception:  # noqa: BLE001 - ainda subindo
                continue
            if isinstance(resposta, str) and resposta.strip():
                return True
        return False

    # ---------------------------------------------------------------- fluxo

    def rodar(self) -> dict:
        self.extra["automerge"] = self.desligar_automerge()
        conteudo = self.ler(self.caminho)
        sha = hashlib.sha256(conteudo).hexdigest()
        self.extra["sha"] = sha
        marcado = MARCADOR.encode("utf-8") in conteudo
        try:
            dropin_anterior, dropin_igual = self.ler_dropin()
            dropin_legivel = True
        except Exception:  # noqa: BLE001 - o drop-in ilegível não é gravado às cegas
            dropin_anterior, dropin_igual, dropin_legivel = None, False, False
        self.extra["dropin"] = "ok" if dropin_igual else "erro"

        if self.sha_revertido is not None and sha == self.sha_revertido:
            return self.resultado("revertido", "um rollback anterior suspendeu as tentativas até o arquivo mudar ou o despachante reiniciar")

        aplicar = not marcado and sha == self.sha_esperado
        texto_novo = aplicar_patch(conteudo.decode("utf-8")) if aplicar else None
        recarregar_patch = marcado and (self.existe(self.pendente) or self.mais_novo_que_o_servico(self.caminho, False))
        mexe_patch = aplicar or recarregar_patch
        gravar_dropin = dropin_legivel and not dropin_igual
        recarregar_dropin = dropin_igual and not mexe_patch and self.mais_novo_que_o_servico(self.dropin, True)
        estado_sem_patch = "ja_aplicado" if marcado else "versao_desconhecida"

        if not (mexe_patch or gravar_dropin or recarregar_dropin):
            if marcado:
                return self.resultado("ja_aplicado", "o adaptador claude-code já tem o --model (%s), carregado" % MARCADOR)
            return self.resultado("versao_desconhecida", "sha256 %s não é o do original esperado; o adaptador não foi tocado" % sha[:12])

        # gate A: o restart mataria runs, e o overview degradado (banco fora) não conta
        motivo = self.motivo_para_esperar()
        if motivo:
            return self.resultado("aguardando_runs", motivo)

        if aplicar:
            if self.existe(self.backup):
                if hashlib.sha256(self.ler(self.backup)).hexdigest() != self.sha_esperado:
                    return self.resultado("erro", "o backup %s já existe e não é o original; nada foi tocado" % self.backup)
            else:
                self.exigir("cp", "cp", "-p", self.caminho, self.backup)
            try:
                self.exigir("tee", "tee", self.novo, entrada=texto_novo.encode("utf-8"))
                validacao = self.comando(self.bun, "-e", script_de_validacao(self.novo))
                if validacao.returncode != 0:
                    self.tentar("rm", "-f", self.novo)
                    return self.resultado(
                        "erro", "a validação do módulo novo com o bun falhou (código %s); o original está intacto" % validacao.returncode
                    )
                self.exigir("chmod", "chmod", "--reference=" + self.caminho, self.novo)
            except Exception:
                self.tentar("rm", "-f", self.novo)
                raise

        # gate C: rechecagem imediatamente antes do mv e do restart
        motivo = self.motivo_para_esperar()
        if motivo:
            if aplicar:
                self.tentar("rm", "-f", self.novo)
            return self.resultado("aguardando_runs", "rechecagem antes do restart: " + motivo)

        if mexe_patch:
            # a marca só sai depois de o Warren responder: uma morte daqui em diante leva a outro restart
            try:
                self.exigir("tee", "tee", self.pendente, entrada=b"pendente\n")
                if aplicar:
                    self.exigir("mv", "mv", "-f", self.novo, self.caminho)
            except Exception:
                if aplicar:
                    self.tentar("rm", "-f", self.novo)
                    self.tentar("rm", "-f", self.pendente)
                raise

        dropin_escrito = False
        # daemon-reload antes de todo restart com o drop-in no lugar: um drop-in gravado e não recarregado também entra
        if gravar_dropin or dropin_igual:
            try:
                if gravar_dropin:
                    self.exigir("mkdir", "mkdir", "-p", self.dropin.rsplit("/", 1)[0], root=True)
                    self.exigir("tee", "tee", self.dropin, entrada=DROPIN_CONTEUDO.encode("utf-8"), root=True)
                    dropin_escrito = True
                self.exigir("daemon-reload", "systemctl", "daemon-reload", root=True)
                if gravar_dropin:
                    self.extra["dropin"] = "alterado"
            except Exception:  # noqa: BLE001 - o drop-in falho é aviso; o patch segue
                self.extra["dropin"] = "erro"
        if not mexe_patch and self.extra["dropin"] == "erro":
            return self.resultado(estado_sem_patch, "o drop-in do systemd falhou; nada a reiniciar")

        if not self.reiniciar():
            return self.reverter("o restart do %s falhou" % self.servico, mexe_patch, dropin_escrito, dropin_anterior)
        if not self.esperar():
            return self.reverter(
                "o Warren não respondeu em %d s depois do restart" % ESPERA_MAXIMA_S, mexe_patch, dropin_escrito, dropin_anterior
            )
        if mexe_patch:
            self.tentar("rm", "-f", self.pendente)
            return self.resultado("aplicado", "--model carregado no adaptador claude-code; Warren de volta")
        return self.resultado(estado_sem_patch, "drop-in do systemd carregado; Warren de volta")

    def reverter(self, motivo: str, patch: bool, dropin_escrito: bool, dropin_anterior) -> dict:
        """Desfaz o que esta chamada mudou, reinicia de novo e confere se o Warren voltou."""
        notas = []
        if patch:
            try:
                self.exigir("mv (restaurar)", "mv", "-f", self.backup, self.caminho)
            except Exception as exc:  # noqa: BLE001 - segue para o restart
                notas.append("backup não restaurado (%s)" % _detalhe_de(exc))
            self.tentar("rm", "-f", self.pendente)
        if dropin_escrito:
            try:
                if dropin_anterior is None:
                    self.exigir("rm (drop-in)", "rm", "-f", self.dropin, root=True)
                else:
                    self.exigir("tee (drop-in)", "tee", self.dropin, entrada=dropin_anterior, root=True)
                self.exigir("daemon-reload", "systemctl", "daemon-reload", root=True)
            except Exception as exc:  # noqa: BLE001
                notas.append("drop-in não restaurado (%s)" % _detalhe_de(exc))
            self.extra["dropin"] = "erro"
        self.reiniciar()
        voltou = self.esperar()
        try:
            self.extra["sha"] = hashlib.sha256(self.ler(self.caminho)).hexdigest()
        except Exception:  # noqa: BLE001
            pass
        partes = [motivo, "mudanças revertidas e %s reiniciado de novo" % self.servico] + notas
        partes.append("o Warren voltou" if voltou else "o Warren continua fora do ar")
        return self.resultado("revertido", "; ".join(partes), warrenVoltou=voltou)
