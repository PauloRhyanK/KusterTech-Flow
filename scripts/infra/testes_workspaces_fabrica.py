"""Testes da regra que decide quais workspaces do Warren a limpeza da oficina pode apagar.

Rodar: python3 -I scripts/infra/testes_workspaces_fabrica.py
"""

import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import workspaces_fabrica as wf  # noqa: E402


def _plano(raiz: pathlib.Path, plano: str, seeds: dict) -> None:
    pasta = raiz / plano
    pasta.mkdir(parents=True)
    (pasta / "estado.json").write_text(json.dumps({"seeds": seeds}), encoding="utf-8")


class Decidir(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name)
        self.planos = base / "planos"
        self.workspaces = base / "workspaces"
        self.workspaces.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def _ws(self, *nomes):
        for nome in nomes:
            (self.workspaces / nome).mkdir()

    def _decidir(self, pausados=("telas-crm-cais",)):
        return {d["workspace"]: d for d in wf.decidir(self.planos, self.workspaces, pausados)}

    def test_pr_mergeado_pode_apagar(self):
        _plano(self.planos, "pk--flow--x--1", {"S-1": {"runId": "run_a", "estado": "mergeada"}})
        self._ws("local-run_a")
        d = self._decidir()["local-run_a"]
        self.assertTrue(d["apagar"])
        self.assertEqual(d["plano"], "pk--flow--x--1")

    def test_pr_fechado_obsoleto_pode_apagar(self):
        _plano(self.planos, "pk--flow--x--1", {"S-1": {"runId": "run_b", "estado": "obsoleta"}})
        self._ws("local-run_b")
        self.assertTrue(self._decidir()["local-run_b"]["apagar"])

    def test_seed_em_andamento_fica(self):
        for estado in ("em_revisao", "aguardando_gates", "corrigindo", "falhou", "executando"):
            with self.subTest(estado=estado):
                self.tearDown()
                self.setUp()
                _plano(self.planos, "pk--flow--x--1", {"S-1": {"runId": "run_c", "estado": estado}})
                self._ws("local-run_c")
                self.assertFalse(self._decidir()["local-run_c"]["apagar"])

    def test_plano_pausado_nunca_apaga(self):
        _plano(
            self.planos,
            "pk--caisv2--telas-crm-cais--461d19",
            {"S-1": {"runId": "run_d", "estado": "mergeada"}},
        )
        self._ws("local-run_d")
        d = self._decidir()["local-run_d"]
        self.assertFalse(d["apagar"])
        self.assertIn("pausado", d["motivo"])

    def test_workspace_sem_dono_fica(self):
        _plano(self.planos, "pk--flow--x--1", {})
        self._ws("local-run_zz", "outra-coisa")
        decisoes = self._decidir()
        self.assertFalse(decisoes["local-run_zz"]["apagar"])
        self.assertNotIn("outra-coisa", decisoes)

    def test_estado_ilegivel_nao_apaga_nada(self):
        pasta = self.planos / "pk--flow--x--1"
        pasta.mkdir(parents=True)
        (pasta / "estado.json").write_text("{quebrado", encoding="utf-8")
        _plano(self.planos, "pk--flow--y--2", {"S-1": {"runId": "run_e", "estado": "mergeada"}})
        self._ws("local-run_e")
        # com qualquer estado.json ilegível não dá para saber de quem é o run: nada é apagado
        self.assertFalse(self._decidir()["local-run_e"]["apagar"])

    def test_run_em_dois_planos_com_um_ativo_fica(self):
        _plano(self.planos, "pk--a--1", {"S-1": {"runId": "run_f", "estado": "mergeada"}})
        _plano(self.planos, "pk--b--2", {"S-9": {"runId": "run_f", "estado": "em_revisao"}})
        self._ws("local-run_f")
        self.assertFalse(self._decidir()["local-run_f"]["apagar"])


if __name__ == "__main__":
    unittest.main()
