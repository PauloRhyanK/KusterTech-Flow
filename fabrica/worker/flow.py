"""Cliente HTTP do worker para a API de operação do Flow (só biblioteca padrão).

Só três chamadas: pedir tarefa, sinal (heartbeat) e resultado. Qualquer falha de rede, 401, 5xx ou
resposta inesperada vira `FlowIndisponivel`; a mensagem nunca leva o token nem o texto da exceção.
"""
import json
import urllib.error
import urllib.request

TIMEOUT_S = 30


class FlowIndisponivel(Exception):
    pass


def _transporte_urllib(metodo, url, headers, corpo):
    req = urllib.request.Request(url, data=corpo, headers=dict(headers), method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()


class ClienteFlow:
    def __init__(self, base_url: str, token: str, transporte=None):
        self.base = base_url.rstrip("/")
        self._token = token
        self._transporte = transporte or _transporte_urllib

    def _post(self, caminho: str, corpo: dict | None, aceitos: tuple[int, ...]) -> tuple[int, dict]:
        headers = {"Authorization": f"Bearer {self._token}", "Accept": "application/json"}
        dados = None
        if corpo is not None:
            headers["Content-Type"] = "application/json"
            dados = json.dumps(corpo).encode()
        try:
            status, _, bruto = self._transporte("POST", self.base + caminho, headers, dados)
        except Exception as erro:  # noqa: BLE001 - rede: só o nome da classe sai daqui
            raise FlowIndisponivel(f"POST {caminho}: {type(erro).__name__}") from None
        if status not in aceitos:
            raise FlowIndisponivel(f"POST {caminho}: HTTP {status}")
        try:
            resposta = json.loads(bruto or b"{}")
        except ValueError:
            raise FlowIndisponivel(f"POST {caminho}: resposta não é JSON") from None
        if not isinstance(resposta, dict):
            raise FlowIndisponivel(f"POST {caminho}: resposta inesperada")
        return status, resposta

    def pedir_tarefa(self) -> dict | None:
        _, r = self._post("/api/fabrica/operacao/tarefas", None, (200,))
        tarefa = r.get("tarefa")
        return tarefa if isinstance(tarefa, dict) else None

    def sinal(self, execucao_id: str, geracao: int) -> str:
        status, _ = self._post(
            f"/api/fabrica/operacao/execucoes/{execucao_id}/sinal", {"geracao": geracao}, (200, 409)
        )
        return "renovado" if status == 200 else "obsoleto"

    def enviar_resultado(self, execucao_id: str, envio: dict) -> str:
        _, r = self._post(f"/api/fabrica/operacao/execucoes/{execucao_id}/resultado", envio, (200, 409))
        resultado = r.get("resultado")
        if resultado not in ("aplicado", "repetido", "conflito", "obsoleto"):
            raise FlowIndisponivel("resultado inesperado")
        return resultado
