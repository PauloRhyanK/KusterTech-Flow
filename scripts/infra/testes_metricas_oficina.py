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

STAT = """cpu  4705 150 1120 16250 520 0 30 0 0 0
cpu0 2350 75 560 8125 260 0 15 0 0 0
intr 12345
"""
PS = "\n".join(
    json.dumps(o)
    for o in (
        {"Names": "loja-web-1", "State": "running", "Status": "Up 2 hours",
         "CreatedAt": "2026-11-18 08:00:00 -0300 -03"},
        {"Names": "loja-job-1", "State": "exited", "Status": "Exited (137) 3 minutes ago",
         "CreatedAt": "2026-11-18 09:40:00 -0300 -03"},
    )
)
STATS = json.dumps({"Name": "loja-web-1", "MemUsage": "212MiB / 7.6GiB", "CPUPerc": "1.50%"})
UNIDADES = """actions.runner.acme-loja.vps-runner.service loaded active running GitHub Actions Runner
actions.runner.acme-loja.vps-runner-2.service loaded active running GitHub Actions Runner
actions.runner.acme-loja.vps-runner-3.service loaded inactive dead GitHub Actions Runner
"""
DF = "\n".join(
    json.dumps({"Type": t, "Size": s})
    for t, s in (("Images", "1.5GB"), ("Containers", "512kB"), ("Local Volumes", "2GB"), ("Build Cache", "0B"))
)


class Painel(unittest.TestCase):
    def test_ler_cpu_separa_ocupado_do_total(self):
        # total = user+nice+system+idle+iowait+irq+softirq+steal; ocupado = total - idle - iowait
        self.assertEqual(mo.ler_cpu(STAT), (4705 + 150 + 1120 + 30, 4705 + 150 + 1120 + 16250 + 520 + 30))

    def test_ler_cpu_sem_linha_cpu_levanta(self):
        with self.assertRaises(ValueError):
            mo.ler_cpu("")

    def test_uso_de_cpu_entre_duas_leituras(self):
        self.assertEqual(mo.uso_de_cpu((100, 1000), (160, 1100)), 60.0)

    def test_uso_de_cpu_sem_leitura_anterior_e_none(self):
        self.assertIsNone(mo.uso_de_cpu(None, (160, 1100)))

    def test_uso_de_cpu_com_contador_que_voltou_e_none(self):
        self.assertIsNone(mo.uso_de_cpu((5000, 90000), (160, 1100)))

    def test_uso_de_cpu_sem_tempo_decorrido_e_none(self):
        self.assertIsNone(mo.uso_de_cpu((100, 1000), (100, 1000)))

    def test_ler_containers_junta_ps_e_stats_pelo_nome(self):
        web = mo.ler_containers(PS, STATS)[0]
        self.assertEqual(
            web,
            {"nome": "loja-web-1", "estado": "rodando", "codigoDeSaida": None,
             "memoriaBytes": 212 * 1024**2, "cpuPct": 1.5, "desde": "2026-11-18T08:00:00-03:00"},
        )

    def test_container_parado_tem_memoria_e_cpu_nulos_e_codigo_de_saida(self):
        job = mo.ler_containers(PS, STATS)[1]
        self.assertEqual(job["estado"], "parado")
        self.assertEqual(job["codigoDeSaida"], 137)
        self.assertIsNone(job["memoriaBytes"])
        self.assertIsNone(job["cpuPct"])

    def test_ler_containers_com_saida_vazia_devolve_lista_vazia(self):
        self.assertEqual(mo.ler_containers("", ""), [])

    def test_ler_containers_sem_stats_deixa_memoria_nula(self):
        self.assertIsNone(mo.ler_containers(PS, "")[0]["memoriaBytes"])

    def test_ler_runners_conta_servicos_no_ar_e_ocupados(self):
        self.assertEqual(mo.ler_runners(UNIDADES, 1), {"noAr": 2, "ocupados": 1, "total": 3})

    def test_ler_runners_ocupados_nunca_passam_dos_no_ar(self):
        self.assertEqual(mo.ler_runners(UNIDADES, 9)["ocupados"], 2)

    def test_fabrica_ativa_so_com_active(self):
        self.assertTrue(mo.fabrica_ativa("active\n"))
        self.assertFalse(mo.fabrica_ativa("inactive\n"))
        self.assertFalse(mo.fabrica_ativa(""))

    def test_somar_docker_df_soma_os_tamanhos(self):
        self.assertEqual(mo.somar_docker_df(DF), 1_500_000_000 + 512_000 + 2_000_000_000)

    def test_classificar_disco_poe_o_resto_em_outros_e_nunca_negativo(self):
        donos = mo.classificar_disco({"docker": 10, "fabrica": 5, "runners": 3, "backups": 2}, 25)
        self.assertEqual([d["nome"] for d in donos], ["docker", "fabrica", "runners", "backups", "outros"])
        self.assertEqual(donos[-1]["bytes"], 5)
        self.assertEqual(mo.classificar_disco({"docker": 30}, 25)[-1]["bytes"], 0)

    def test_retrato_gravado_passa_por_json_loads_e_tem_as_chaves_do_contrato(self):
        retrato = mo.montar_retrato(
            "2026-11-18T10:00:00-03:00", "2026-11-10T08:15:00-03:00",
            mo.ler_containers(PS, STATS), True, mo.ler_runners(UNIDADES, 0),
        )
        with tempfile.TemporaryDirectory() as tmp:
            arq = pathlib.Path(tmp) / "retrato.json"
            mo.gravar_json(arq, retrato)
            lido = json.loads(arq.read_text(encoding="utf-8"))
            self.assertFalse(arq.with_suffix(".tmp").exists())
        self.assertEqual(set(lido), {"em", "ligadaDesde", "containers", "servicos"})
        self.assertEqual(set(lido["servicos"]), {"fabrica", "runners"})
        self.assertEqual(lido["servicos"]["fabrica"], "ativa")

    def test_data_com_fuso_numerico(self):
        self.assertRegex(mo.agora_iso(), r"[+-]\d\d:\d\d$")

    def test_coletar_sem_fontes_do_linux_nao_quebra_e_guarda_o_estado_da_cpu(self):
        with tempfile.TemporaryDirectory() as tmp:
            antigo = mo.DIR_ESTADO
            mo.DIR_ESTADO = pathlib.Path(tmp)
            try:
                a = mo.coletar("2026-11-18T10:00:00-03:00")
            finally:
                mo.DIR_ESTADO = antigo
        self.assertIn("discoLivreBytes", a)
        self.assertIn("discoTotalBytes", a)
        self.assertIn("cpuUsoPct", a)


if __name__ == "__main__":
    unittest.main()
