"""Worker da Fábrica 2.0: pega uma tarefa do Flow, roda o agente numa cópia isolada, entrega e avisa.

Ordem de cada ciclo: (1) reenvia a caixa de saída; (2) pede uma tarefa; (3) executa com heartbeat;
(4) grava o resultado na caixa e só então envia. O agente nunca recebe credencial: o worker faz o
commit, o push e abre o PR depois que ele termina. Merge não existe aqui (é do Flow, pelos gates).

    python3 -I -B fabrica/worker/worker.py      # lê a configuração do ambiente (config.py)
"""
import os
import pathlib
import signal
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import adaptador_claude  # noqa: E402
import caixa as caixa_  # noqa: E402
import config as config_  # noqa: E402
import flow as flow_  # noqa: E402
import gates_do_pr  # noqa: E402
import github as github_  # noqa: E402
import workspace as workspace_  # noqa: E402

LIMITE_DO_MOTIVO = 500

REGRAS_DE_ESCRITA = (
    "Regras da Fábrica: trabalhe só nesta pasta. Não rode git commit nem git push: a Fábrica entrega o que "
    "você deixar na pasta. Siga o AGENTS.md/CLAUDE.md do repositório. Rode as verificações do escopo antes "
    "de terminar e corrija o que falhar."
)
REGRAS_DE_LEITURA = "Regras da Fábrica: só leia e analise; não altere arquivos."


def montar_pedido(tarefa: dict) -> str:
    regras = REGRAS_DE_ESCRITA if tarefa["tipoDaEtapa"] == "implementacao" else REGRAS_DE_LEITURA
    partes = [tarefa["instrucoes"].strip()]
    if tarefa.get("correcao"):
        partes.append(
            "Correção pedida pela revisão e pelos testes da Fábrica (o PR desta etapa já existe; corrija nele):\n"
            + tarefa["correcao"].strip()
        )
    return "\n\n".join([*partes, regras])


def _motivo(texto: str) -> str:
    """Cabe no limite do Flow, que conta unidades UTF-16 (um emoji vale 2)."""
    texto = texto or "falha sem descrição"
    saida, unidades = [], 0
    for c in texto:
        unidades += 2 if ord(c) > 0xFFFF else 1
        if unidades > LIMITE_DO_MOTIVO:
            break
        saida.append(c)
    return "".join(saida)


class Worker:
    def __init__(self, flow, caixa, github, workspace, config, rodar=adaptador_claude.rodar, verificador=None):
        self.flow = flow
        self.caixa = caixa
        self.github = github
        self.workspace = workspace
        self.config = config
        self.rodar = rodar
        self.verificador = verificador  # None: o `verificacao.verificar` do kit (Docker)
        self.parar = threading.Event()
        self._cancelar_atual: threading.Event | None = None

    # ------------------------------------------------------------ ciclo

    def _enviar(self, execucao_id: str, envio: dict) -> None:
        """Qualquer resposta final (ou recusa definitiva) encerra o item; Flow fora mantém na caixa."""
        try:
            self.flow.enviar_resultado(execucao_id, envio)
        except flow_.ResultadoRecusado as erro:
            print(f"resultado {envio['idExterno']} recusado pelo Flow: {erro}", file=sys.stderr)
        self.caixa.remover(envio["idExterno"])

    def _reenviar_caixa(self) -> None:
        for execucao_id, envio in self.caixa.pendentes():
            self._enviar(execucao_id, envio)

    def ciclo(self) -> str:
        try:
            self._reenviar_caixa()
            tarefa = self.flow.pedir_tarefa()
        except flow_.FlowIndisponivel:
            return "flow_indisponivel"
        if tarefa is None:
            return "sem_tarefa"

        cancelar = threading.Event()
        self._cancelar_atual = cancelar
        fim_do_sinal = threading.Event()
        batimento = threading.Thread(target=self._sinalizar, args=(tarefa, cancelar, fim_do_sinal), daemon=True)
        batimento.start()
        try:
            resultado = self.executar(tarefa, cancelar)
        except Exception as erro:  # noqa: BLE001 - qualquer imprevisto vira falha técnica, sem detalhe sensível
            resultado = {"tipo": "falha_tecnica", "motivo": _motivo(f"erro no worker: {type(erro).__name__}: {erro}")}
        finally:
            fim_do_sinal.set()
            batimento.join(timeout=5)
            self._cancelar_atual = None

        envio = {"idExterno": f"{tarefa['execucaoId']}:{tarefa['geracao']}", "geracao": tarefa["geracao"], "resultado": resultado}
        try:
            self.caixa.guardar(tarefa["execucaoId"], envio)
        except OSError as erro:  # disco cheio: segue para o envio direto; a reconciliação cobre a perda
            print(f"caixa de saída indisponível: {type(erro).__name__}", file=sys.stderr)
        try:
            self._enviar(tarefa["execucaoId"], envio)
        except flow_.FlowIndisponivel:
            pass  # fica na caixa; o próximo ciclo reenvia
        return "executou"

    def _sinalizar(self, tarefa: dict, cancelar: threading.Event, fim: threading.Event) -> None:
        while not fim.wait(self.config.intervalo_do_sinal_s):
            try:
                if self.flow.sinal(tarefa["execucaoId"], tarefa["geracao"]) == "obsoleto":
                    cancelar.set()  # a reserva não é mais nossa: para já
                    return
            except flow_.FlowIndisponivel:
                continue  # Flow fora: segue trabalhando no que já foi autorizado

    # ------------------------------------------------------------ execução

    def executar(self, tarefa: dict, cancelar: threading.Event) -> dict:
        repo = tarefa["repo"]
        branch = f"fabrica/{tarefa['etapaId'][:8]}"
        if tarefa["tipo"] == "reconciliar":
            # nunca roda o agente de novo: confere o que ficou no GitHub
            pr = self.github.pr_aberto_da_branch(repo, branch)
            if pr:
                return {"tipo": "pr_aberto", "prUrl": pr}
            if tarefa["tipoDaEtapa"] == "implementacao" and self.github.branch_existe(repo, branch):
                # caiu entre o push e a abertura do PR: termina a entrega sem rodar o agente
                base = self.github.branch_padrao(repo)
                return {"tipo": "pr_aberto", "prUrl": self._abrir_pr(tarefa, branch, base)}
            return {"tipo": "falha_tecnica", "motivo": "reconciliação: nada entregue pela execução anterior"}

        base = self.github.branch_padrao(repo)
        url = self.config.url_do_repo.format(repo=repo)
        cabecalho = workspace_.cabecalho_do_token(self.config.token_do_github)
        finalidade = tarefa.get("finalidade", "executar")
        if finalidade == "verificar":
            return gates_do_pr.verificar(tarefa, self.workspace, url, base, cabecalho, self.verificador)
        if finalidade == "revisar":
            return gates_do_pr.revisar(
                tarefa, self.workspace, url, base, cabecalho, self.rodar, self.config.claude,
                self.config.modelo("revisor"), self.config.prazo_s, cancelar,
            )
        copia = self.workspace.preparar(url, repo, branch, base, tarefa["execucaoId"], cabecalho)
        try:
            implementacao = tarefa["tipoDaEtapa"] == "implementacao"
            comando = adaptador_claude.montar_comando(
                self.config.claude,
                montar_pedido(tarefa),
                self.config.modelo(tarefa["papel"]),
                "escrita" if implementacao else "leitura",
            )
            saida = self.rodar(
                comando, str(copia.agente), adaptador_claude.ambiente_do_agente(dict(os.environ)),
                self.config.prazo_s, cancelar,
            )
            falha = gates_do_pr.resultado_de_falha(saida)
            if falha is not None:
                if "motivo" in falha:
                    falha["motivo"] = _motivo(falha["motivo"])
                return falha
            if not implementacao or not self.workspace.tem_mudancas(copia):
                return {"tipo": "sem_pr"}
            if cancelar.is_set():  # a reserva deixou de ser nossa: outro worker reconcilia
                return {"tipo": "cancelada"}
            self.workspace.entregar(copia, branch, f"fabrica: {tarefa['etapaChave']}", url, cabecalho)
            if cancelar.is_set():
                return {"tipo": "cancelada"}  # a branch ficou; quem reconcilia abre o PR
            return {"tipo": "pr_aberto", "prUrl": self._abrir_pr(tarefa, branch, base)}
        finally:
            self.workspace.limpar(copia)

    def _abrir_pr(self, tarefa: dict, branch: str, base: str) -> str:
        return self.github.abrir_pr(
            tarefa["repo"], branch, base, f"fabrica: {tarefa['etapaChave']}",
            f"Etapa `{tarefa['etapaChave']}` entregue pela Fábrica 2.0.\n\n{tarefa['instrucoes'].strip()[:2000]}",
        )


def main() -> int:
    config = config_.do_ambiente()
    w = Worker(
        flow_.ClienteFlow(config.flow_url, config.token_do_worker),
        caixa_.CaixaDeSaida(config.raiz / "caixa.json"),
        github_.GitHub(config.token_do_github),
        workspace_.Workspace(config.raiz),
        config,
    )

    def encerrar(*_):
        w.parar.set()
        if w._cancelar_atual is not None:
            w._cancelar_atual.set()  # cancela a execução atual; o resultado `cancelada` vai à caixa

    w.workspace.limpar_tudo()
    signal.signal(signal.SIGTERM, encerrar)
    signal.signal(signal.SIGINT, encerrar)
    while not w.parar.is_set():
        if w.ciclo() != "executou":
            w.parar.wait(config.intervalo_s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
