"""Testes da coleta e do relatório de desempenho da oficina.

Rodar: python3 -I scripts/infra/testes_metricas_oficina.py
"""

import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import metricas_oficina as mo  # noqa: E402

MEMINFO = """MemTotal:        8000000 kB
MemAvailable:    2048000 kB
SwapTotal:       6000000 kB
SwapFree:        5000000 kB
"""
PSI = """some avg10=1.50 avg60=2.25 avg300=0.10 total=2161
full avg10=0.50 avg60=0.75 avg300=0.00 total=1959
"""


class Leitura(unittest.TestCase):
    def test_meminfo_em_mb(self):
        m = mo.ler_meminfo(MEMINFO)
        self.assertEqual(m["memTotalMb"], 7812)
        self.assertEqual(m["memDisponivelMb"], 2000)
        self.assertEqual(m["swapUsadaMb"], 976)

    def test_psi_avg60(self):
        self.assertEqual(mo.ler_psi(PSI), {"some": 2.25, "full": 0.75})

    def test_psi_cpu_sem_linha_full(self):
        self.assertEqual(mo.ler_psi(PSI.splitlines()[0]), {"some": 2.25, "full": None})

    def test_vmstat_oom(self):
        self.assertEqual(mo.ler_oom("pgfault 9\noom_kill 3\n"), 3)

    def test_capacidade(self):
        dados = {"vagasConfig": 5, "oomEm": None, "reservas": {"a": ["x", "y"], "b": ["z"]}}
        self.assertEqual(mo.ler_capacidade(dados), {"vagas": 5, "raias": 3, "oomEm": None})


class Alertas(unittest.TestCase):
    def test_oom_novo_gera_alerta(self):
        anterior = {"oomKills": 1, "bootId": "b1"}
        atual = {"oomKills": 2, "bootId": "b1", "raias": 4, "vagas": 5}
        alertas = mo.alertas(anterior, atual)
        self.assertEqual([a["tipo"] for a in alertas], ["oom"])
        self.assertIn("4", alertas[0]["mensagem"])

    def test_reboot_zera_contador_sem_alerta(self):
        self.assertEqual(mo.alertas({"oomKills": 5, "bootId": "b1"}, {"oomKills": 0, "bootId": "b2"}), [])

    def test_sem_anterior_sem_alerta(self):
        self.assertEqual(mo.alertas(None, {"oomKills": 7, "bootId": "b1"}), [])


class Relatorio(unittest.TestCase):
    def _amostras(self):
        base = {"memDisponivelMb": 3000, "swapUsadaMb": 0, "psiMem": {"some": 0.0, "full": 0.0},
                "psiCpu": {"some": 1.0, "full": None}, "psiIo": {"some": 0.0, "full": 0.0},
                "carga1": 1.0, "jobsCi": 0, "oomKills": 0, "bootId": "b1"}
        linhas = []
        for i in range(10):
            linhas.append({**base, "em": "2026-11-18T10:%02d:00-03:00" % i, "raias": 1})
        for i in range(10):
            linhas.append({**base, "em": "2026-11-18T11:%02d:00-03:00" % i, "raias": 4,
                           "memDisponivelMb": 400 + i, "swapUsadaMb": 900,
                           "psiMem": {"some": 12.0, "full": 4.0}, "oomKills": 1 if i >= 5 else 0})
        return linhas

    def test_agrupa_por_raias_ocupadas(self):
        r = mo.resumir(self._amostras())
        self.assertEqual(sorted(r["porRaias"]), [1, 4])
        quatro = r["porRaias"][4]
        self.assertEqual(quatro["amostras"], 10)
        self.assertEqual(quatro["memDisponivelMbP5"], 400)
        self.assertEqual(quatro["swapUsadaMbMax"], 900)
        self.assertEqual(quatro["psiMemSomeMedia"], 12.0)
        self.assertEqual(r["oomKills"], 1)

    def test_oom_soma_entre_boots(self):
        linhas = [
            {"em": "a", "raias": 1, "oomKills": 2, "bootId": "b1"},
            {"em": "b", "raias": 1, "oomKills": 3, "bootId": "b1"},
            {"em": "c", "raias": 1, "oomKills": 1, "bootId": "b2"},
        ]
        self.assertEqual(mo.resumir(linhas)["oomKills"], 2)

    def test_vazio(self):
        self.assertEqual(mo.resumir([])["amostras"], 0)


class Arquivo(unittest.TestCase):
    def test_podar_mantem_recentes(self):
        with tempfile.TemporaryDirectory() as tmp:
            arq = pathlib.Path(tmp) / "m.jsonl"
            arq.write_text(
                json.dumps({"em": "2026-01-01T00:00:00-03:00"}) + "\n"
                + json.dumps({"em": "2026-11-18T00:00:00-03:00"}) + "\nlixo\n",
                encoding="utf-8",
            )
            removidas = mo.podar(arq, dias=30, agora="2026-11-18T12:00:00-03:00")
            self.assertEqual(removidas, 2)
            self.assertEqual(len(arq.read_text(encoding="utf-8").splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
