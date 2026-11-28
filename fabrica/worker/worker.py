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
    return f"{tarefa['instrucoes'].strip()}\n\n{regras}"


def _motivo(texto: str) -> str:
    return (texto or "falha sem descrição")[:LIMITE_DO_MOTIVO]


class Worker:
    def __init__(self, flow, caixa, github, workspace, config, rodar=adaptador_claude.rodar):
        self.flow = flow
        self.caixa = caixa
        self.github = github
        self.workspace = workspace
        self.config = config
        self.rodar = rodar
        self.parar = threading.Event()
        self._cancelar_atual: threading.Event | None = None

    # ------------------------------------------------------------ ciclo

    def _reenviar_caixa(self) -> None:
        for execucao_id, envio in self.caixa.pendentes():
            self.flow.enviar_resultado(execucao_id, envio)  # qualquer resposta final encerra o item
            self.caixa.remover(envio["idExterno"])

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
        self.caixa.guardar(tarefa["execucaoId"], envio)
        try:
            self.flow.enviar_resultado(tarefa["execucaoId"], envio)
            self.caixa.remover(envio["idExterno"])
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
            return {"tipo": "falha_tecnica", "motivo": "reconciliação: nenhum PR aberto da branch da etapa"}

        base = self.github.branch_padrao(repo)
        url = self.config.url_do_repo.format(repo=repo)
        cabecalho = workspace_.cabecalho_do_token(self.config.token_do_github)
        pasta = self.workspace.preparar(url, repo, branch, base, tarefa["execucaoId"], cabecalho)
        try:
            implementacao = tarefa["tipoDaEtapa"] == "implementacao"
            comando = adaptador_claude.montar_comando(
                self.config.claude,
                montar_pedido(tarefa),
                self.config.modelo(tarefa["papel"]),
                "escrita" if implementacao else "leitura",
            )
            saida = self.rodar(
                comando, str(pasta), adaptador_claude.ambiente_do_agente(dict(os.environ)), self.config.prazo_s, cancelar
            )
            if saida.tipo == "cancelada":
                return {"tipo": "cancelada"}
            if saida.tipo == "limite_de_uso":
                return {"tipo": "limite_de_uso", "retornoEm": saida.retorno_em}
            if saida.tipo in ("erro_de_configuracao", "falha_tecnica"):
                return {"tipo": saida.tipo, "motivo": _motivo(saida.motivo)}
            if not implementacao or not self.workspace.tem_mudancas(pasta):
                return {"tipo": "sem_pr"}
            self.workspace.entregar(pasta, branch, f"fabrica: {tarefa['etapaChave']}", url, cabecalho)
            pr = self.github.abrir_pr(
                repo, branch, base, f"fabrica: {tarefa['etapaChave']}",
                f"Etapa `{tarefa['etapaChave']}` entregue pela Fábrica 2.0.\n\n{tarefa['instrucoes'].strip()[:2000]}",
            )
            return {"tipo": "pr_aberto", "prUrl": pr}
        finally:
            self.workspace.limpar(pasta)


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

    signal.signal(signal.SIGTERM, encerrar)
    signal.signal(signal.SIGINT, encerrar)
    while not w.parar.is_set():
        if w.ciclo() != "executou":
            w.parar.wait(config.intervalo_s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
