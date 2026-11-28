"""Configuração do worker, lida do ambiente. Tokens ficam em arquivos (0600), nunca em variáveis do agente."""
import dataclasses
import json
import os
import pathlib

MODELOS_PADRAO = {"engenheiro": "sonnet", "revisor": "opus", "qa": "sonnet", "_": "sonnet"}


@dataclasses.dataclass
class Config:
    flow_url: str
    token_do_worker: str
    token_do_github: str
    raiz: pathlib.Path
    claude: str = "claude"
    modelos: dict = dataclasses.field(default_factory=lambda: dict(MODELOS_PADRAO))
    prazo_s: int = 3600
    intervalo_s: float = 30
    intervalo_do_sinal_s: float = 30
    url_do_repo: str = "https://github.com/{repo}.git"
    # isolamento (M2c): o agente roda como este usuário, via sudo, numa pasta fora da home do worker
    usuario_do_agente: str | None = None
    pasta_do_agente: pathlib.Path | None = None

    def modelo(self, papel: str) -> str:
        return self.modelos.get(papel) or self.modelos["_"]


def _ler(arquivo: str) -> str:
    return pathlib.Path(arquivo).expanduser().read_text().strip()


def do_ambiente(env=os.environ) -> Config:
    modelos = dict(MODELOS_PADRAO)
    if env.get("FABRICA_MODELOS"):
        modelos.update(json.loads(env["FABRICA_MODELOS"]))
    return Config(
        flow_url=env["FABRICA_FLOW_URL"],
        token_do_worker=_ler(env["FABRICA_WORKER_TOKEN_ARQUIVO"]),
        token_do_github=_ler(env["FABRICA_GITHUB_TOKEN_ARQUIVO"]),
        raiz=pathlib.Path(env.get("FABRICA_RAIZ", "~/fabrica-2")).expanduser(),
        claude=env.get("FABRICA_CLAUDE", "claude"),
        modelos=modelos,
        prazo_s=int(env.get("FABRICA_PRAZO_S", "3600")),
        usuario_do_agente=env.get("FABRICA_USUARIO_DO_AGENTE") or None,
        pasta_do_agente=pathlib.Path(env["FABRICA_PASTA_DO_AGENTE"]) if env.get("FABRICA_PASTA_DO_AGENTE") else None,
    )
