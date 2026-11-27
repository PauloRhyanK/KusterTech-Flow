import datetime
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import executores  # noqa: E402

AGORA = datetime.datetime(2026, 11, 26, 12, 0, tzinfo=datetime.timezone.utc)


def item(agente="claude-code", modelo="m", conta="claude-principal"):
    return {"agente": agente, "modelo": modelo, "conta": conta}


class TestesNormalizar(unittest.TestCase):
    def test_constantes(self):
        self.assertEqual(executores.CONTA_PADRAO, "claude-principal")
        self.assertEqual(executores.AGENTES, ("claude-code", "codex", "antigravity"))

    def test_formato_antigo_vira_lista_de_um(self):
        entrada = {"agente": "claude-code", "modelo": "m", "maxCustoUsd": 1}
        self.assertEqual(executores.normalizar(entrada, "qa"), [item()])

    def test_lista_mantem_ordem_e_conta(self):
        lista = [
            item("antigravity", "g", "gemini"),
            item("claude-code", "s", "claude-principal"),
            item("claude-code", "s", "claude-reserva"),
        ]
        self.assertEqual(executores.normalizar({"executores": lista}, "qa"), lista)

    def test_conta_ausente_usa_a_padrao(self):
        entrada = {"executores": [{"agente": "codex", "modelo": "m"}]}
        self.assertEqual(
            executores.normalizar(entrada, "qa"), [item("codex", "m", "claude-principal")]
        )

    def test_agente_desconhecido_recusa(self):
        entrada = {"executores": [item("gpt-cli")]}
        with self.assertRaises(ValueError) as ctx:
            executores.normalizar(entrada, "qa")
        self.assertIn("modelos.qa.executores[0].agente", str(ctx.exception))

    def test_modelo_vazio_recusa(self):
        entrada = {"executores": [item(), item(modelo=" ")]}
        with self.assertRaises(ValueError) as ctx:
            executores.normalizar(entrada, "qa")
        self.assertIn("executores[1].modelo", str(ctx.exception))

    def test_conta_invalida_recusa(self):
        entrada = {"executores": [item(conta="")]}
        with self.assertRaises(ValueError) as ctx:
            executores.normalizar(entrada, "qa")
        self.assertIn("executores[0].conta", str(ctx.exception))

    def test_lista_vazia_recusa(self):
        with self.assertRaises(ValueError) as ctx:
            executores.normalizar({"executores": []}, "qa")
        self.assertIn("modelos.qa.executores", str(ctx.exception))

    def test_item_repetido_recusa(self):
        entrada = {"executores": [item(), item("codex"), item()]}
        with self.assertRaises(ValueError) as ctx:
            executores.normalizar(entrada, "qa")
        self.assertIn("executores[2]", str(ctx.exception))

    def test_mesmo_agente_em_contas_diferentes_vale(self):
        entrada = {"executores": [item(), item(conta="claude-reserva")]}
        self.assertEqual(len(executores.normalizar(entrada, "qa")), 2)

    def test_sem_agente_nem_executores_recusa(self):
        with self.assertRaises(ValueError) as ctx:
            executores.normalizar({"modelo": "m"}, "qa")
        self.assertIn("executores[0].agente", str(ctx.exception))

    def test_entrada_que_nao_e_objeto_recusa(self):
        with self.assertRaises(ValueError):
            executores.normalizar("x", "qa")


class TestesEscolher(unittest.TestCase):
    def test_primeiro_disponivel(self):
        lista = [item(), item(conta="claude-reserva")]
        self.assertEqual(executores.escolher(lista, set()), lista[0])

    def test_pula_indisponivel(self):
        lista = [item(), item(conta="claude-reserva")]
        esgotados = {("claude-code", "claude-principal")}
        self.assertEqual(executores.escolher(lista, esgotados), lista[1])

    def test_sem_opcao_devolve_none(self):
        lista = [item()]
        self.assertIsNone(executores.escolher(lista, {("claude-code", "claude-principal")}))


class TestesProximoRetorno(unittest.TestCase):
    def test_menor_retorno_da_lista(self):
        lista = [item(), item(conta="claude-reserva")]
        dados = {
            "claude-code|claude-principal": {"ate": "2026-11-26T14:00:00+00:00"},
            "claude-code|claude-reserva": {"ate": "2026-11-26T13:00:00+00:00"},
            "codex|outra": {"ate": "2026-11-26T12:10:00+00:00"},
        }
        self.assertEqual(
            executores.proximo_retorno(lista, dados, AGORA),
            datetime.datetime(2026, 11, 26, 13, 0, tzinfo=datetime.timezone.utc),
        )

    def test_sem_marcacao_devolve_none(self):
        self.assertIsNone(executores.proximo_retorno([item()], {}, AGORA))

    def test_vencido_e_ilegivel_sao_ignorados(self):
        dados = {"claude-code|claude-principal": {"ate": "2026-11-26T11:00:00Z"}}
        self.assertIsNone(executores.proximo_retorno([item()], dados, AGORA))
        dados = {"claude-code|claude-principal": {"ate": "lixo"}}
        self.assertIsNone(executores.proximo_retorno([item()], dados, AGORA))


if __name__ == "__main__":
    unittest.main()
