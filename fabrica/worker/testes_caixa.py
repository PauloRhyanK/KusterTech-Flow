import json
import pathlib
import tempfile
import unittest

import caixa


class CaixaTest(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.arquivo = self.dir / "caixa.json"

    def test_guarda_sobrevive_a_reabrir_e_remove(self):
        c = caixa.CaixaDeSaida(self.arquivo)
        c.guardar("e1", {"idExterno": "r1", "geracao": 1, "resultado": {"tipo": "sem_pr"}})
        c.guardar("e2", {"idExterno": "r2", "geracao": 1, "resultado": {"tipo": "cancelada"}})
        outra = caixa.CaixaDeSaida(self.arquivo)
        self.assertEqual([e for e, _ in outra.pendentes()], ["e1", "e2"])
        outra.remover("r1")
        self.assertEqual([e for e, _ in caixa.CaixaDeSaida(self.arquivo).pendentes()], ["e2"])

    def test_guardar_o_mesmo_id_nao_duplica(self):
        c = caixa.CaixaDeSaida(self.arquivo)
        envio = {"idExterno": "r1", "geracao": 1, "resultado": {"tipo": "sem_pr"}}
        c.guardar("e1", envio)
        c.guardar("e1", envio)
        self.assertEqual(len(c.pendentes()), 1)

    def test_arquivo_corrompido_e_guardado_de_lado_e_comeca_vazio(self):
        self.arquivo.write_text("{quebrado")
        c = caixa.CaixaDeSaida(self.arquivo)
        self.assertEqual(c.pendentes(), [])
        self.assertTrue(any(p.name.startswith("caixa.json.corrompido") for p in self.dir.iterdir()))

    def test_arquivo_tem_permissao_restrita(self):
        caixa.CaixaDeSaida(self.arquivo).guardar("e1", {"idExterno": "r1"})
        self.assertEqual(self.arquivo.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(self.arquivo.read_text())[0]["execucaoId"], "e1")


if __name__ == "__main__":
    unittest.main()
