import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import motor  # noqa: E402
from resumo_de_execucao import resumir  # noqa: E402

INIT = b'{"kind":"state_change","stream":"system","origin":"warren","payload":{"type":"system","subtype":"init","model":"claude-sonnet-5-5"}}\n'


def ev(kind, texto=None, **extra):
    payload = {"text": texto} if texto is not None else {}
    payload.update(extra.pop("payload", {}))
    return (json.dumps({"kind": kind, "payload": payload, **extra}) + "\n").encode()


class ResumirTest(unittest.TestCase):
    def test_resume_texto_e_ferramenta_na_ordem(self):
        bruto = INIT + ev("text", "lendo o catálogo", ts="2026-11-21T01:33:00Z") + ev("tool", "Edit front/a.tsx\n+12 -3", ts="2026-11-21T01:41:00Z")
        r = resumir(bruto)
        self.assertEqual(r["linhas"][-1], {"em": "2026-11-21T01:41:00Z", "tipo": "ferramenta", "texto": "Edit front/a.tsx"})
        self.assertEqual(r["linhas"][-2]["tipo"], "texto")
        self.assertEqual(r["ultimaAcao"], {"texto": "Edit front/a.tsx", "em": "2026-11-21T01:41:00Z"})

    def test_corta_nas_ultimas_30(self):
        bruto = b"".join(ev("text", "linha %d" % i) for i in range(1, 46))
        r = resumir(bruto)
        self.assertEqual(len(r["linhas"]), 30)
        self.assertEqual(r["linhas"][0]["texto"], "linha 16")

    def test_limpa_caminho_absoluto_e_html_fica_texto(self):
        r = resumir(ev("text", "<img src=x onerror=alert(1)> /home/agentops/x/y.py"))
        texto = r["linhas"][0]["texto"]
        self.assertIn("[caminho]", texto)
        self.assertNotIn("/home/agentops", texto)
        self.assertIn("<img", texto)

    def test_linha_invalida_e_ignorada(self):
        r = resumir(b"{quebrado\n" + ev("text", "ok"))
        self.assertEqual([l["texto"] for l in r["linhas"]], ["ok"])

    def test_modelo_do_init(self):
        self.assertEqual(resumir(INIT + ev("text", "oi"))["modelo"], "claude-sonnet-5-5")

    def test_mudanca_de_estado_vira_linha_de_estado(self):
        r = resumir(ev("state_change", payload={"state": "running"}))
        self.assertEqual(r["linhas"], [{"em": None, "tipo": "estado", "texto": "running"}])
        self.assertIsNone(r["ultimaAcao"])

    def test_vazio(self):
        self.assertEqual(resumir(b""), {"ultimaAcao": None, "linhas": [], "modelo": None})


class MotorFalsoEventosTest(unittest.TestCase):
    def test_eventos_brutos_do_motor_falso(self):
        m = motor.MotorFalso()
        m.eventos["r-1"] = b'{"kind":"text","payload":{"text":"oi"}}\n'
        self.assertEqual(m.eventos_brutos("r-1"), m.eventos["r-1"])
        self.assertEqual(m.eventos_brutos("outro"), b"")


if __name__ == "__main__":
    unittest.main()
