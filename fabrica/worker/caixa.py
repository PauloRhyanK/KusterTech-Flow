"""Caixa de saída do worker: o resultado é gravado em disco antes de ir ao Flow.

Se o worker cair entre terminar a execução e o Flow confirmar, o próximo ciclo reenvia; o Flow
responde `repetido` para o mesmo `idExterno`, então reenviar nunca duplica efeito.
"""
import json
import os
import pathlib
import time


class CaixaDeSaida:
    def __init__(self, arquivo):
        self.arquivo = pathlib.Path(arquivo)
        self._itens = self._ler()

    def _ler(self) -> list[dict]:
        if not self.arquivo.exists():
            return []
        try:
            itens = json.loads(self.arquivo.read_text())
            if isinstance(itens, list) and all(isinstance(i, dict) for i in itens):
                return itens
        except ValueError:
            pass
        # guarda de lado para análise e segue; a reconciliação cobre o que se perdeu
        self.arquivo.rename(self.arquivo.with_name(f"{self.arquivo.name}.corrompido-{int(time.time())}"))
        return []

    def _gravar(self) -> None:
        self.arquivo.parent.mkdir(parents=True, exist_ok=True)
        temporario = self.arquivo.with_name(self.arquivo.name + ".tmp")
        fd = os.open(temporario, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(self._itens, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporario, self.arquivo)

    def guardar(self, execucao_id: str, envio: dict) -> None:
        if any(i["envio"].get("idExterno") == envio.get("idExterno") for i in self._itens):
            return
        self._itens.append({"execucaoId": execucao_id, "envio": envio})
        self._gravar()

    def pendentes(self) -> list[tuple[str, dict]]:
        return [(i["execucaoId"], i["envio"]) for i in self._itens]

    def remover(self, id_externo: str) -> None:
        self._itens = [i for i in self._itens if i["envio"].get("idExterno") != id_externo]
        self._gravar()
