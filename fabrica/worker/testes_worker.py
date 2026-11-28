import pathlib
import subprocess
import tempfile
import threading
import unittest

import caixa
import config as cfg
import flow
import worker
import workspace

FALSO = str(pathlib.Path(__file__).resolve().parent / "claude_falso.py")


def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class FlowFalso:
    def __init__(self, tarefas, sinal="renovado"):
        self.tarefas = list(tarefas)
        self.enviados = []
        self.sinais = 0
        self.resposta_do_sinal = sinal
        self.fora = False

    def pedir_tarefa(self):
        if self.fora:
            raise flow.FlowIndisponivel("fora")
        return self.tarefas.pop(0) if self.tarefas else None

    def sinal(self, execucao_id, geracao):
        self.sinais += 1
        return self.resposta_do_sinal

    def enviar_resultado(self, execucao_id, envio):
        if self.fora:
            raise flow.FlowIndisponivel("fora")
        self.enviados.append((execucao_id, envio))
        return "aplicado"


class GitHubFalso:
    def __init__(self, pr=None, branch=False):
        self.pr = pr
        self.branch = branch
        self.abertos = []

    def branch_existe(self, repo, branch):
        return self.branch

    def branch_padrao(self, repo):
        return "main"

    def pr_aberto_da_branch(self, repo, branch):
        return self.pr

    def abrir_pr(self, repo, branch, base, titulo, corpo):
        self.abertos.append((repo, branch, base, titulo))
        return "https://github.com/dono/repo/pull/9"


def tarefa(**extra):
    t = {
        "execucaoId": "11111111-aaaa-4bbb-8ccc-000000000001",
        "etapaId": "22222222-aaaa-4bbb-8ccc-000000000002",
        "geracao": 1,
        "tipo": "executar",
        "etapaChave": "rodape",
        "tipoDaEtapa": "implementacao",
        "instrucoes": "ESCREVE o rodapé",
        "papel": "engenheiro",
        "repo": "dono/repo",
        "prUrl": None,
        "expiraEm": "2026-11-28T12:02:00Z",
    }
    t.update(extra)
    return t


class WorkerTest(unittest.TestCase):
    def setUp(self):
        base = pathlib.Path(tempfile.mkdtemp())
        self.remoto = base / "remoto.git"
        git("init", "-q", "--bare", "-b", "main", str(self.remoto), cwd=base)
        semente = base / "semente"
        git("clone", "-q", str(self.remoto), str(semente), cwd=base)
        (semente / "LEIA.md").write_text("oi\n")
        git("add", "LEIA.md", cwd=semente)
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "inicio", cwd=semente)
        git("push", "-q", "origin", "main", cwd=semente)
        self.config = cfg.Config(
            flow_url="http://flow", token_do_worker="fw_x", token_do_github="ghs_x", raiz=base / "raiz",
            claude=FALSO, intervalo_do_sinal_s=0.2, url_do_repo=str(self.remoto),
        )
        self.caixa = caixa.CaixaDeSaida(base / "raiz" / "caixa.json")

    def worker(self, flow_falso, gh=None):
        return worker.Worker(flow_falso, self.caixa, gh or GitHubFalso(), workspace.Workspace(self.config.raiz), self.config)

    def test_implementacao_com_mudanca_entrega_branch_e_pr(self):
        f, gh = FlowFalso([tarefa()]), GitHubFalso()
        self.assertEqual(self.worker(f, gh).ciclo(), "executou")
        execucao, envio = f.enviados[0]
        self.assertEqual(envio["resultado"], {"tipo": "pr_aberto", "prUrl": "https://github.com/dono/repo/pull/9"})
        self.assertEqual(envio["idExterno"], f"{execucao}:1")
        self.assertEqual(gh.abertos[0][:3], ("dono/repo", "fabrica/22222222", "main"))
        self.assertIn("feito.txt", git("show", "--name-only", "--format=", "fabrica/22222222", cwd=self.remoto))
        self.assertEqual(self.caixa.pendentes(), [])
        self.assertFalse((self.config.raiz / "trabalho" / execucao).exists())

    def test_implementacao_sem_mudanca_e_sem_pr(self):
        f, gh = FlowFalso([tarefa(instrucoes="nada a fazer")]), GitHubFalso()
        self.worker(f, gh).ciclo()
        self.assertEqual(f.enviados[0][1]["resultado"], {"tipo": "sem_pr"})
        self.assertEqual(gh.abertos, [])

    def test_leitura_nunca_entrega(self):
        f, gh = FlowFalso([tarefa(tipoDaEtapa="leitura", papel="revisor", instrucoes="ESCREVE")]), GitHubFalso()
        self.worker(f, gh).ciclo()
        self.assertEqual(f.enviados[0][1]["resultado"], {"tipo": "sem_pr"})
        self.assertEqual(gh.abertos, [])
        self.assertNotIn("fabrica/22222222", git("branch", "--list", cwd=self.remoto))

    def test_reconciliar_acha_o_pr_sem_rodar_o_agente(self):
        f = FlowFalso([tarefa(tipo="reconciliar", geracao=2, instrucoes="DEMORA")])
        self.worker(f, GitHubFalso(pr="https://github.com/dono/repo/pull/5")).ciclo()
        self.assertEqual(f.enviados[0][1], {
            "idExterno": "11111111-aaaa-4bbb-8ccc-000000000001:2",
            "geracao": 2,
            "resultado": {"tipo": "pr_aberto", "prUrl": "https://github.com/dono/repo/pull/5"},
        })

    def test_reconciliar_com_branch_sem_pr_abre_o_pr(self):
        f, gh = FlowFalso([tarefa(tipo="reconciliar", geracao=2)]), GitHubFalso(branch=True)
        self.worker(f, gh).ciclo()
        self.assertEqual(f.enviados[0][1]["resultado"]["tipo"], "pr_aberto")
        self.assertEqual(len(gh.abertos), 1)

    def test_reconciliar_sem_pr_e_falha_tecnica(self):
        f = FlowFalso([tarefa(tipo="reconciliar", geracao=2)])
        self.worker(f).ciclo()
        self.assertEqual(f.enviados[0][1]["resultado"]["tipo"], "falha_tecnica")

    def test_sinal_obsoleto_cancela(self):
        f = FlowFalso([tarefa(instrucoes="DEMORA")], sinal="obsoleto")
        self.worker(f).ciclo()
        self.assertEqual(f.enviados[0][1]["resultado"], {"tipo": "cancelada"})
        self.assertGreaterEqual(f.sinais, 1)

    def test_reserva_perdida_depois_do_agente_nao_entrega(self):
        f, gh = FlowFalso([tarefa()]), GitHubFalso()
        w = self.worker(f, gh)
        original = w.rodar

        def rodar_e_perder_a_reserva(comando, cwd, ambiente, prazo, cancelar):
            saida = original(comando, cwd, ambiente, prazo, cancelar)
            cancelar.set()  # o heartbeat recebeu "obsoleto" logo depois do agente terminar
            return saida

        w.rodar = rodar_e_perder_a_reserva
        w.ciclo()
        self.assertEqual(f.enviados[0][1]["resultado"], {"tipo": "cancelada"})
        self.assertEqual(gh.abertos, [])
        self.assertNotIn("fabrica/22222222", git("branch", "--list", cwd=self.remoto))

    def test_resultado_recusado_sai_da_caixa_e_nao_trava_o_worker(self):
        f = FlowFalso([tarefa(instrucoes="nada")])

        def recusa(*a):
            raise flow.ResultadoRecusado("HTTP 422")

        f.enviar_resultado = recusa
        w = self.worker(f)
        w.ciclo()
        self.assertEqual(self.caixa.pendentes(), [])
        self.assertEqual(w.ciclo(), "sem_tarefa")

    def test_motivo_cabe_no_limite_do_flow_em_unidades_utf16(self):
        m = worker._motivo("😀" * 400)
        self.assertLessEqual(len(m.encode("utf-16-le")) // 2, 500)
        self.assertEqual(worker._motivo(""), "falha sem descrição")

    def test_limite_de_uso_e_erro_de_modelo(self):
        f = FlowFalso([tarefa(instrucoes="LIMITE"), tarefa(instrucoes="MODELO", geracao=2)])
        w = self.worker(f)
        w.ciclo()
        w.ciclo()
        self.assertEqual(f.enviados[0][1]["resultado"]["tipo"], "limite_de_uso")
        self.assertIsNotNone(f.enviados[0][1]["resultado"]["retornoEm"])
        self.assertEqual(f.enviados[1][1]["resultado"]["tipo"], "erro_de_configuracao")

    def test_flow_fora_no_envio_guarda_e_reenvia_antes_de_pedir_tarefa(self):
        f = FlowFalso([tarefa(instrucoes="nada")])
        w = self.worker(f)
        original = f.enviar_resultado

        def cai(*a):
            raise flow.FlowIndisponivel("fora")

        f.enviar_resultado = cai
        w.ciclo()
        self.assertEqual(len(self.caixa.pendentes()), 1)
        f.enviar_resultado = original
        self.assertEqual(w.ciclo(), "sem_tarefa")
        self.assertEqual(len(f.enviados), 1)
        self.assertEqual(self.caixa.pendentes(), [])

    def test_flow_fora_nao_pega_tarefa(self):
        f = FlowFalso([tarefa()])
        f.fora = True
        self.assertEqual(self.worker(f).ciclo(), "flow_indisponivel")

    def test_erro_inesperado_vira_falha_tecnica(self):
        f = FlowFalso([tarefa(repo="dono/repo")])
        self.config.url_do_repo = "/caminho/que/nao/existe.git"
        self.worker(f).ciclo()
        r = f.enviados[0][1]["resultado"]
        self.assertEqual(r["tipo"], "falha_tecnica")
        self.assertLessEqual(len(r["motivo"]), 500)

    def _branch_no_remoto(self):
        semente = pathlib.Path(tempfile.mkdtemp()) / "s"
        git("clone", "-q", str(self.remoto), str(semente), cwd=semente.parent)
        git("checkout", "-qb", "fabrica/22222222", cwd=semente)
        (semente / ".fabrica").mkdir()
        (semente / ".fabrica" / "config.json").write_text('{"verificacao": {"imagem": "node:22"}}')
        git("add", "-A", cwd=semente)
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "etapa", cwd=semente)
        git("push", "-q", "origin", "fabrica/22222222", cwd=semente)
        return git("rev-parse", "HEAD", cwd=semente)

    def test_verificar_devolve_a_evidencia(self):
        sha = self._branch_no_remoto()
        f = FlowFalso([tarefa(finalidade="verificar", sha=sha, verificacao="pnpm test", papel="verificador")])
        w = self.worker(f)
        w.verificador = lambda repo_dir, s, comando, *, conteiner: {"sha": s, "codigo": 0, "saida": ""}
        w.ciclo()
        self.assertEqual(f.enviados[0][1]["resultado"], {"tipo": "verificacao", "sha": sha, "codigo": 0})

    def test_revisar_sem_veredito_e_saida_invalida(self):
        sha = self._branch_no_remoto()
        f = FlowFalso([tarefa(finalidade="revisar", sha=sha, papel="revisor", prUrl="https://github.com/dono/repo/pull/9")])
        self.worker(f).ciclo()
        self.assertEqual(f.enviados[0][1]["resultado"]["tipo"], "saida_invalida")

    def test_correcao_vai_no_pedido(self):
        p = worker.montar_pedido(tarefa(instrucoes="Faça o rodapé.", correcao="CI vermelho; revisão: falta teste"))
        self.assertIn("CI vermelho; revisão: falta teste", p)
        self.assertNotIn("Correção", worker.montar_pedido(tarefa(correcao=None)))

    def test_pedido_leva_as_regras_de_entrega(self):
        p = worker.montar_pedido(tarefa(instrucoes="Faça o rodapé."))
        self.assertTrue(p.startswith("Faça o rodapé."))
        self.assertIn("git push", p)
        self.assertIn("não altere", worker.montar_pedido(tarefa(tipoDaEtapa="leitura")).lower())


if __name__ == "__main__":
    unittest.main()
