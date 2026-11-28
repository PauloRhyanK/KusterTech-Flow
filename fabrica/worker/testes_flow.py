import json
import unittest

import flow


class TransporteFalso:
    def __init__(self, respostas):
        self.respostas = list(respostas)
        self.chamadas = []

    def __call__(self, metodo, url, headers, corpo):
        self.chamadas.append((metodo, url, headers, json.loads(corpo) if corpo else None))
        r = self.respostas.pop(0)
        if isinstance(r, Exception):
            raise r
        status, dados = r
        return status, {}, json.dumps(dados).encode()


def cliente(*respostas):
    t = TransporteFalso(respostas)
    return flow.ClienteFlow("http://flow.local/", "fw_abc", transporte=t), t


class ClienteFlowTest(unittest.TestCase):
    def test_pedir_tarefa_manda_token_e_devolve_a_tarefa(self):
        c, t = cliente((200, {"tarefa": {"execucaoId": "e1"}}))
        self.assertEqual(c.pedir_tarefa(), {"execucaoId": "e1"})
        metodo, url, headers, corpo = t.chamadas[0]
        self.assertEqual((metodo, url), ("POST", "http://flow.local/api/fabrica/operacao/tarefas"))
        self.assertEqual(headers["Authorization"], "Bearer fw_abc")

    def test_sem_tarefa_devolve_none(self):
        c, _ = cliente((200, {"tarefa": None}))
        self.assertIsNone(c.pedir_tarefa())

    def test_sinal_renovado_e_obsoleto(self):
        c, t = cliente((200, {"resultado": "renovado"}), (409, {"resultado": "obsoleto"}))
        self.assertEqual(c.sinal("e1", 2), "renovado")
        self.assertEqual(c.sinal("e1", 2), "obsoleto")
        self.assertEqual(t.chamadas[0][1], "http://flow.local/api/fabrica/operacao/execucoes/e1/sinal")
        self.assertEqual(t.chamadas[0][3], {"geracao": 2})

    def test_resultado_aplicado_repetido_conflito(self):
        envio = {"idExterno": "r1", "geracao": 1, "resultado": {"tipo": "sem_pr"}}
        c, t = cliente(
            (200, {"resultado": "aplicado"}), (200, {"resultado": "repetido"}), (409, {"resultado": "conflito"})
        )
        self.assertEqual(c.enviar_resultado("e1", envio), "aplicado")
        self.assertEqual(c.enviar_resultado("e1", envio), "repetido")
        self.assertEqual(c.enviar_resultado("e1", envio), "conflito")
        self.assertEqual(t.chamadas[0][3], envio)

    def test_rede_5xx_401_e_corpo_invalido_viram_flow_indisponivel(self):
        for r in (OSError("rede"), (500, {"erro": "x"}), (401, {"erro": "x"}), (422, {"erro": "x"})):
            with self.subTest(r=r):
                c, _ = cliente(r)
                with self.assertRaises(flow.FlowIndisponivel):
                    c.pedir_tarefa()

    def test_token_nunca_aparece_na_mensagem_de_erro(self):
        c, _ = cliente(OSError("Bearer fw_abc falhou"))
        with self.assertRaises(flow.FlowIndisponivel) as ctx:
            c.pedir_tarefa()
        self.assertNotIn("fw_abc", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
