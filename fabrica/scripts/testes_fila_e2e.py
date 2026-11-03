"""Ponta a ponta da fila por plano: o coordenador real e dois ou três `Despachante` reais, no mesmo processo.

Motor e forja são os falsos do kit (`MotorFalso`, `ForjaFalsa`); o systemd é o `SystemdFalso` do coordenador,
com um `enable` que lê o `plano.env` gravado e constrói o `Despachante` dele, como o `fabrica-plano@.service`
faria. O `iniciar` também é o real (`Despachante.iniciar`). Os helpers vêm de `testes_coordenador` e
`testes_despachante`.
"""

import copy
import datetime
import json
import pathlib
import sys
import unittest

RAIZ_DOS_SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ_DOS_SCRIPTS))

import capacidade  # noqa: E402
import despachante  # noqa: E402
import testes_coordenador as tc  # noqa: E402
import testes_despachante as td  # noqa: E402

REPO = tc.REPO
RAM_FARTA_MB = 8000
RAM_BAIXA_MB = 1000
VAGAS = 3
RAM_MINIMA_MB = 2048


def ler_env(caminho) -> dict:
    """O `plano.env` do coordenador: `NOME=valor`, comentários com `#`."""
    pares = {}
    for linha in pathlib.Path(caminho).read_text(encoding="utf-8").splitlines():
        if linha and not linha.startswith("#"):
            nome, valor = linha.split("=", 1)
            pares[nome] = valor
    return pares


class SystemdQueLiga(tc.SystemdFalso):
    """`enable --now fabrica-plano@<id>` constrói o despachante do plano a partir do `plano.env`."""

    def __init__(self, ao_ligar):
        super().__init__()
        self._ao_ligar = ao_ligar

    def __call__(self, *args):
        codigo, saida = super().__call__(*args)
        if args[0] == "enable" and codigo == 0:
            self._ao_ligar(args[-1].split("@", 1)[1])
        return codigo, saida


class ExecutarIniciar:
    """`despachante.py iniciar` de verdade: constrói o despachante do ambiente e chama `iniciar()` (sem subprocesso)."""

    def __init__(self, construir):
        self._construir = construir
        self.chamadas = []

    def __call__(self, argv, env):
        self.chamadas.append((list(argv), dict(env)))
        try:
            self._construir(env).iniciar()
        except Exception as exc:  # noqa: BLE001 - o coordenador só quer o código e o texto
            return 1, "%s: %s" % (type(exc).__name__, exc)
        return 0, "estado iniciado"


class BaseE2E(tc.Base):
    def setUp(self):
        super().setUp()
        self.ram = RAM_FARTA_MB
        self.agora_naive = datetime.datetime(2026, 11, 3, 12, 0, 0)
        self.cap = self.raiz / "capacidade.json"
        capacidade.configurar(self.cap, vagas=VAGAS, ram_minima_mb=RAM_MINIMA_MB)
        self.despachantes = {}
        self.systemd = SystemdQueLiga(self._ligar)
        self.executar = ExecutarIniciar(self._construir)
        self.coordenador = self.novo()

    # ------------------------------------------------ montagem

    def _construir(self, env):
        return despachante.Despachante(
            motor=self.motor,
            forja=self.forja,
            raiz=env["FABRICA_RAIZ"],
            repo_dir=env["FABRICA_REPO_DIR"],
            config=copy.deepcopy(td.CONFIG),
            verificar=lambda repo_dir, sha, comando, *, conteiner: {"sha": sha, "codigo": 0, "saida": "ok"},
            agora=lambda: self.agora_naive,
            projeto=env["FABRICA_PROJETO"],
            repo=env["FABRICA_REPO"],
            limpar_residuos=lambda: {"conteineres": 0, "redes": 0, "diretorios": 0, "erros": []},
            segredos=(tc.TOKEN,),
            caminho_plano=env["FABRICA_PLANO"],
            capacidade=env["FABRICA_CAPACIDADE"],
            plano_id=env["FABRICA_PLANO_ID"],
            mem_disponivel=lambda: self.ram,
        )

    def _ligar(self, id_):
        env = ler_env(self.pasta(id_) / "plano.env")
        self.despachantes[id_] = self._construir(env)

    # ------------------------------------------------ rodadas

    def rodada(self, vezes=1):
        """Um ciclo do coordenador e depois um de cada despachante ligado (na ordem dos ids)."""
        for _ in range(vezes):
            self.instante += datetime.timedelta(minutes=1)
            self.agora_naive += datetime.timedelta(minutes=1)
            self.coordenador.ciclo()
            self.rodar_despachantes()

    def rodar_despachantes(self):
        for id_ in sorted(self.despachantes):
            if self.systemd.estados.get(self.unit(id_)) == "active":
                self.despachantes[id_].ciclo()
                self.conferir_limites()

    def conferir_limites(self):
        """O invariante de capacidade: nunca mais raias rodando que vagas, e nenhuma além do que o arquivo reserva."""
        reservadas = sum(len(r) for r in capacidade.ler(self.cap)["reservas"].values())
        self.assertLessEqual(len(self.rodando()), VAGAS)
        self.assertLessEqual(reservadas, VAGAS)

    # ------------------------------------------------ observação

    def rodando(self):
        """Os Plan Runs em andamento no Warren (o que de fato consome RAM)."""
        return {pid: p for pid, p in self.motor._planos.items() if p["estado"] == "running"}

    def despachos(self):
        return [a for nome, a in self.motor.chamadas if nome == "despachar_plano"]

    def reservas(self):
        return capacidade.ler(self.cap)["reservas"]

    def raias_de(self, id_):
        return self.estado_do_plano(id_)["raias"]

    def raias_em(self, id_, situacao):
        return sorted(r for r, v in self.raias_de(id_).items() if v["estado"] == situacao)

    def plan_run_de(self, id_, raia):
        return self.raias_de(id_)[raia]["planRunId"]

    def terminar_raia(self, id_, raia, estado="succeeded"):
        self.motor.definir_plano(self.plan_run_de(id_, raia), estado, [])

    def subir(self, **planos):
        """Publica `feature=[globs por raia]` e roda o coordenador uma vez: os que não colidem entram."""
        ids = {f: self.publicar(f, *grupos) for f, grupos in planos.items()}
        self.coordenador.ciclo()
        return ids


class TestesVagasEntrePlanos(BaseE2E):
    def test_dois_planos_do_mesmo_repo_rodam_juntos_e_a_quarta_raia_espera(self):
        ids = self.subir(x=[["src/x/a/**"], ["src/x/b/**"]], y=[["src/y/a/**"], ["src/y/b/**"]])
        x, y = ids["x"], ids["y"]
        self.assertEqual(self.estados(), {x: "ativo", y: "ativo"})
        self.assertEqual(sorted(self.despachantes), sorted([x, y]))
        for _ in range(4):
            self.rodar_despachantes()
        # 4 raias no total, 3 vagas: três rodam e a quarta espera
        self.assertEqual(len(self.despachos()), 3)
        self.assertEqual(len(self.rodando()), 3)
        self.assertEqual(sorted(len(r) for r in self.reservas().values()), [1, 2])
        esperando = self.raias_em(x, "planejada") + self.raias_em(y, "planejada")
        self.assertEqual(len(esperando), 1)
        # uma raia termina: a vaga só volta depois do `sincronizar` do plano dono
        dono = x if self.raias_em(x, "executando") == ["raia-0", "raia-1"] else y
        outro = y if dono == x else x
        self.terminar_raia(dono, "raia-0")
        self.rodar_despachantes()
        self.assertEqual(self.raias_em(dono, "concluida"), ["raia-0"])
        self.assertEqual(len(self.despachos()), 4)
        self.assertEqual(len(self.rodando()), 3)
        self.assertEqual(self.raias_em(outro, "planejada"), [])
        self.assertEqual(sum(len(r) for r in self.reservas().values()), 3)
        for _ in range(3):
            self.rodar_despachantes()
        self.assertEqual(len(self.despachos()), 4)

    def test_plano_que_colide_espera_e_nao_e_ligado(self):
        ids = self.subir(x=[["src/x/a/**"], ["src/x/b/**"]], y=[["src/y/a/**"]])
        z = self.publicar("z", ["src/x/a/novo/**"])
        self.rodada(2)
        self.assertEqual(self.estados(), {ids["x"]: "ativo", ids["y"]: "ativo", z: "aguardando"})
        self.assertNotIn(z, self.iniciados())
        self.assertNotIn(self.unit(z), self.ligados())
        self.assertNotIn(z, self.despachantes)
        self.assertFalse((self.pasta(z) / "estado.json").exists())


class TestesConclusaoELiberacao(BaseE2E):
    def montar(self):
        ids = self.subir(x=[["src/x/a/**"], ["src/x/b/**"]], y=[["src/y/a/**"]])
        self.x, self.y = ids["x"], ids["y"]
        self.z = self.publicar("z", ["src/x/a/novo/**"])
        self.rodada(3)
        self.assertEqual(len(self.rodando()), 3)
        self.assertEqual(self.estados()[self.z], "aguardando")

    def acordar_orquestrador_da_fase(self):
        """x termina as duas raias; o despachante acorda o orquestrador de `fase_concluida`."""
        self.terminar_raia(self.x, "raia-0")
        self.terminar_raia(self.x, "raia-1")
        self.rodada()
        self.assertEqual(self.raias_em(self.x, "concluida"), ["raia-0", "raia-1"])
        orquestrador = self.estado_do_plano(self.x)["orquestrador"]
        self.assertEqual(orquestrador["motivo"], "fase_concluida")
        self.assertTrue(orquestrador["runId"])
        self.assertEqual(capacidade.ler(self.cap)["orquestrador"], {REPO: self.x})
        return orquestrador["runId"]

    def entregar_pr_da_fase(self, run_id):
        caminho = ".fabrica/planos/x.json"
        self.motor.definir_run(run_id, estado="succeeded", prUrl=td.PR_ORQ)
        self.forja.definir_pr(td.PR_ORQ, head_sha=td.H3, branch="warren/orq", arquivos=[caminho])
        self.forja.definir_ci(REPO, td.H3, "verde")
        self.forja.definir_arquivo(REPO, td.H3, caminho, self.forja.arquivo(REPO, "main", caminho))

    def test_plano_so_conclui_depois_do_merge_da_homologacao_e_entao_o_colidente_entra(self):
        self.montar()
        run_id = self.acordar_orquestrador_da_fase()
        # todas as raias concluídas, mas o orquestrador ainda trabalha: o plano não pode sair
        self.rodada(2)
        self.assertEqual(self.estados()[self.x], "ativo")
        self.assertEqual(self.systemd.estados[self.unit(self.x)], "active")
        # o PR de fase_concluida espera o merge do Paulo
        self.entregar_pr_da_fase(run_id)
        self.rodada(3)
        self.assertEqual(self.estado_do_plano(self.x)["prsOrquestrador"], [td.PR_ORQ])
        self.assertTrue(self.estado_do_plano(self.x)["decisoes"])
        self.assertEqual(self.estados()[self.x], "ativo")
        self.assertEqual(self.estados()[self.z], "aguardando")
        self.assertNotIn(("disable", "--now", self.unit(self.x)), self.systemd.chamadas)
        self.assertEqual(capacidade.ler(self.cap)["orquestrador"], {REPO: self.x})
        # o Paulo mergeia: a decisão fecha, a trava solta e o plano conclui
        self.assertTrue(self.forja.mergear(td.PR_ORQ, td.H3))
        self.rodada()  # o despachante fecha a decisão depois do coordenador deste ciclo
        self.assertEqual(self.estado_do_plano(self.x)["decisoes"], [])
        self.assertEqual(self.estados()[self.x], "ativo")
        self.rodada()
        self.assertEqual(self.estados()[self.x], "concluido")
        self.assertIn(("disable", "--now", self.unit(self.x)), self.systemd.chamadas)
        self.assertNotIn(self.x, self.reservas())
        self.assertEqual(capacidade.ler(self.cap)["orquestrador"], {})
        # a admissão vem antes da observação: o colidente entra no ciclo seguinte
        self.assertEqual(self.estados()[self.z], "aguardando")
        self.rodada()
        self.assertEqual(self.estados()[self.z], "ativo")
        self.assertEqual(self.estados()[self.y], "ativo")
        self.assertIn(self.unit(self.z), self.ligados())
        self.assertEqual(self.iniciados().count(self.z), 1)
        # z roda de verdade: a raia dele ocupa a vaga que x liberou
        self.rodada(2)
        self.assertEqual(self.raias_em(self.z, "executando"), ["raia-0"])
        self.assertEqual(sorted(self.reservas()), sorted([self.y, self.z]))
        self.assertEqual(len(self.rodando()), 2)

    def test_coordenador_reiniciado_no_meio_nao_repete_a_admissao(self):
        self.montar()
        iniciados = list(self.iniciados())
        self.coordenador = self.novo()
        self.rodada(2)
        self.assertEqual(self.iniciados(), iniciados)
        self.assertEqual(len(self.despachos()), 3)
        self.assertEqual(self.estados()[self.z], "aguardando")


class TestesMemoriaBaixa(BaseE2E):
    def test_com_pouca_ram_nada_novo_e_despachado_e_o_que_roda_continua(self):
        ids = self.subir(x=[["src/x/a/**"], ["src/x/b/**"]], y=[["src/y/a/**"], ["src/y/b/**"]])
        x, y = ids["x"], ids["y"]
        for _ in range(3):
            self.rodar_despachantes()
        self.assertEqual(len(self.despachos()), 3)
        em_curso = {x: self.raias_em(x, "executando"), y: self.raias_em(y, "executando")}
        dono = x if len(em_curso[x]) == 2 else y
        outro = y if dono == x else x
        # uma raia termina e a RAM cai: a vaga existe, mas a máquina não aguenta mais uma
        self.ram = RAM_BAIXA_MB
        self.terminar_raia(dono, "raia-0")
        for _ in range(4):
            self.rodada()
        self.assertEqual(len(self.despachos()), 3)
        self.assertEqual(self.raias_em(outro, "planejada"), ["raia-1"])
        self.assertEqual(self.raias_em(dono, "executando"), ["raia-1"])
        self.assertEqual(self.raias_em(outro, "executando"), ["raia-0"])
        self.assertEqual(len(self.rodando()), 2)
        self.assertEqual(self.estados(), {x: "ativo", y: "ativo"})
        # a RAM volta: a raia que esperava é despachada
        self.ram = RAM_FARTA_MB
        self.rodada(2)
        self.assertEqual(len(self.despachos()), 4)
        self.assertEqual(len(self.rodando()), 3)
        self.assertEqual(self.raias_em(outro, "planejada"), [])


if __name__ == "__main__":
    unittest.main()
