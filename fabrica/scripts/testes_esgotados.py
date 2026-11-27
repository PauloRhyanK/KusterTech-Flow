import json
import multiprocessing
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import esgotados  # noqa: E402

AGORA = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)


def _marcar_em_processo(caminho, agente, conta, barreira):
    barreira.wait(timeout=30)
    esgotados.marcar(caminho, agente, conta, agora=AGORA)


class MarcarELer(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.caminho = pathlib.Path(self._tmp.name) / "esgotados.json"

    def test_marcar_usa_prazo_padrao_de_60_min(self):
        dados = esgotados.marcar(self.caminho, "claude-code", "padrao", agora=AGORA)
        entrada = dados["claude-code|padrao"]
        self.assertEqual(esgotados.PRAZO_PADRAO_MIN, 60)
        self.assertEqual(datetime.fromisoformat(entrada["ate"]), AGORA + timedelta(minutes=60))
        self.assertEqual(datetime.fromisoformat(entrada["desde"]), AGORA)
        self.assertEqual(esgotados.ler(self.caminho), dados)

    def test_marcar_respeita_ate_informado(self):
        ate = AGORA + timedelta(hours=3)
        dados = esgotados.marcar(self.caminho, "claude-code", "reserva", agora=AGORA, ate=ate)
        self.assertEqual(datetime.fromisoformat(dados["claude-code|reserva"]["ate"]), ate)

    def test_ate_no_passado_ou_sem_fuso_cai_no_padrao(self):
        for ate in (AGORA - timedelta(minutes=5), datetime(2026, 11, 26, 18, 0)):
            dados = esgotados.marcar(self.caminho, "a", "c", agora=AGORA, ate=ate)
            self.assertEqual(
                datetime.fromisoformat(dados["a|c"]["ate"]), AGORA + timedelta(minutes=60)
            )

    def test_vencido_some_de_vigentes(self):
        dados = {
            "a|c": {"ate": (AGORA + timedelta(minutes=1)).isoformat(), "desde": AGORA.isoformat()},
            "b|c": {"ate": (AGORA - timedelta(minutes=1)).isoformat(), "desde": AGORA.isoformat()},
            "x|c": {"ate": "lixo", "desde": AGORA.isoformat()},
        }
        self.assertEqual(esgotados.vigentes(dados, AGORA), {("a", "c")})

    def test_marcar_remove_vencidos_na_mesma_gravacao(self):
        antigo = AGORA - timedelta(hours=2)
        esgotados.marcar(self.caminho, "velho", "c", agora=antigo)
        dados = esgotados.marcar(self.caminho, "novo", "c", agora=AGORA)
        self.assertEqual(list(dados), ["novo|c"])

    def test_arquivo_ausente_vale_vazio(self):
        self.assertEqual(esgotados.ler(self.caminho), {})

    def test_arquivo_ilegivel_vale_vazio(self):
        self.caminho.write_text("{{{", encoding="utf-8")
        self.assertEqual(esgotados.ler(self.caminho), {})
        self.caminho.write_text("[1, 2]", encoding="utf-8")
        self.assertEqual(esgotados.ler(self.caminho), {})
        self.caminho.write_bytes(b"\xff\xfe")
        self.assertEqual(esgotados.ler(self.caminho), {})

    def test_marcar_sobre_arquivo_ilegivel_recomeca(self):
        self.caminho.write_text("{{{", encoding="utf-8")
        dados = esgotados.marcar(self.caminho, "a", "c", agora=AGORA)
        self.assertEqual(list(dados), ["a|c"])
        json.loads(self.caminho.read_text(encoding="utf-8"))

    def test_duas_gravacoes_concorrentes_nao_se_perdem(self):
        ctx = multiprocessing.get_context("fork")
        barreira = ctx.Barrier(2)
        procs = [
            ctx.Process(target=_marcar_em_processo, args=(self.caminho, ag, "c", barreira))
            for ag in ("um", "dois")
        ]
        for p in procs:
            p.start()
        for p in procs:
            p.join(timeout=60)
            self.assertEqual(p.exitcode, 0)
        self.assertEqual(set(esgotados.ler(self.caminho)), {"um|c", "dois|c"})


class RetornoDaCota(unittest.TestCase):
    def test_retorno_em_minutos(self):
        self.assertEqual(
            esgotados.retorno_da_cota("Rate limit hit. Try again in 42 minutes.", AGORA),
            AGORA + timedelta(minutes=42),
        )

    def test_retorno_em_horas(self):
        self.assertEqual(
            esgotados.retorno_da_cota("try again in 2 hours", AGORA), AGORA + timedelta(hours=2)
        )

    def test_retorno_iso(self):
        self.assertEqual(
            esgotados.retorno_da_cota("limit reached, resets 2026-11-26T18:00:00Z", AGORA),
            datetime(2026, 11, 26, 18, 0, tzinfo=timezone.utc),
        )

    def test_retorno_iso_com_deslocamento(self):
        self.assertEqual(
            esgotados.retorno_da_cota("resets 2026-11-26T18:00:00-03:00", AGORA),
            datetime(2026, 11, 26, 21, 0, tzinfo=timezone.utc),
        )

    def test_retorno_no_passado_devolve_none(self):
        self.assertIsNone(esgotados.retorno_da_cota("resets 2026-11-26T10:00:00Z", AGORA))

    def test_retorno_alem_de_7_dias_devolve_none(self):
        self.assertIsNone(esgotados.retorno_da_cota("try again in 20000 minutes", AGORA))
        self.assertIsNone(esgotados.retorno_da_cota("resets 2026-12-30T00:00:00Z", AGORA))

    def test_sem_horario_ou_sem_fuso_devolve_none(self):
        self.assertIsNone(esgotados.retorno_da_cota("usage limit reached", AGORA))
        self.assertIsNone(esgotados.retorno_da_cota("resets at 3pm", AGORA))
        self.assertIsNone(esgotados.retorno_da_cota("resets 2026-11-26T18:00:00", AGORA))
        self.assertIsNone(esgotados.retorno_da_cota(None, AGORA))


if __name__ == "__main__":
    unittest.main()
