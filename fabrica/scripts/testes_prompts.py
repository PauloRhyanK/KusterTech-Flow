import json
import pathlib
import sys
import unittest
from unittest import mock

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

from prompts import (  # noqa: E402
    FIM_VEREDITO,
    INICIO_VEREDITO,
    eh_falha_de_cota,
    extrair_veredito,
    prompt_fixer,
    prompt_orquestrador,
    prompt_revisor,
    prompt_template_raia,
)
from raias import PAPEIS_DE_RAIA  # noqa: E402

SHA = "0123456789abcdef0123456789abcdef01234567"


def bloco(obj):
    corpo = obj if isinstance(obj, str) else json.dumps(obj)
    return f"{INICIO_VEREDITO}\n{corpo}\n{FIM_VEREDITO}"


def veredito_valido(**mudancas):
    base = {
        "sha": SHA,
        "resultado": "aprovado",
        "achados": [{"arquivo": "src/a.ts", "motivo": "nome ruim"}],
    }
    base.update(mudancas)
    return base


def raia_referencia():
    return {
        "id": "back-clientes",
        "papel": "backend",
        "verificacao": "pnpm test",
        "arquivos": ["src/modules/clientes/"],
        "criteriosAceite": ["Cliente é criado com CNPJ válido", "Listagem pagina em 20"],
    }


class MarcadoresTest(unittest.TestCase):
    def test_valores_exatos(self):
        self.assertEqual(INICIO_VEREDITO, "FABRICA_VEREDITO_INICIO")
        self.assertEqual(FIM_VEREDITO, "FABRICA_VEREDITO_FIM")


class TemplateRaiaTest(unittest.TestCase):
    def test_cada_papel_tem_seed_id_uma_vez_e_aponta_o_pacote(self):
        for papel in PAPEIS_DE_RAIA:
            with self.subTest(papel=papel):
                texto = prompt_template_raia(papel)
                self.assertEqual(texto.count("{seed_id}"), 1)
                self.assertIn(f".fabrica/equipes/{papel}.md", texto)

    def test_manda_ler_agents_e_a_seed(self):
        texto = prompt_template_raia("backend")
        self.assertIn("AGENTS.md", texto)
        self.assertIn("sd show {seed_id}", texto)

    def test_manda_rodar_verificacao_e_colar_no_pr(self):
        texto = prompt_template_raia("qa").lower()
        self.assertIn("verificação", texto)
        self.assertIn("corpo do pr", texto)

    def test_so_a_seed_da_raia(self):
        self.assertIn("só nessa seed", prompt_template_raia("frontend"))

    def test_nao_tem_outras_chaves_para_nao_quebrar_format(self):
        texto = prompt_template_raia("arquiteto")
        self.assertEqual(texto.replace("{seed_id}", "x").count("{"), 0)
        self.assertEqual(texto.replace("{seed_id}", "x").count("}"), 0)
        self.assertIn("sd-42", texto.format(seed_id="sd-42"))

    def test_papel_desconhecido_levanta(self):
        with self.assertRaises(ValueError):
            prompt_template_raia("../../etc/passwd")

    def test_curto(self):
        for papel in PAPEIS_DE_RAIA:
            self.assertLessEqual(len(prompt_template_raia(papel).splitlines()), 25)


class PromptRevisorTest(unittest.TestCase):
    def setUp(self):
        self.texto = prompt_revisor(seed_id="sd-42", raia=raia_referencia(), sha=SHA)

    def test_contem_sha_seed_e_pacote(self):
        self.assertIn(SHA, self.texto)
        self.assertIn("sd-42", self.texto)
        self.assertIn(".fabrica/equipes/revisor.md", self.texto)

    def test_sha_preenchido_no_bloco_de_exemplo(self):
        self.assertIn(f'"sha": "{SHA}"', self.texto)
        self.assertNotIn("<sha>", self.texto)
        self.assertNotIn("aprovado ou correcoes", self.texto)

    def test_lista_cada_criterio(self):
        self.assertIn("Cliente é criado com CNPJ válido", self.texto)
        self.assertIn("Listagem pagina em 20", self.texto)

    def test_tem_os_dois_marcadores(self):
        self.assertIn(INICIO_VEREDITO, self.texto)
        self.assertIn(FIM_VEREDITO, self.texto)
        self.assertLess(self.texto.index(INICIO_VEREDITO), self.texto.index(FIM_VEREDITO))

    def test_proibe_commit_e_push(self):
        self.assertIn("Não faça commit nem push", self.texto)

    def test_manda_terminar_com_o_bloco(self):
        self.assertIn("última", self.texto.lower())
        self.assertIn("aprovado", self.texto)
        self.assertIn("correcoes", self.texto)

    def test_raia_sem_criterios_nao_quebra(self):
        raia = raia_referencia()
        del raia["criteriosAceite"]
        texto = prompt_revisor(seed_id="sd-1", raia=raia, sha=SHA)
        self.assertIn(SHA, texto)

    def test_curto(self):
        self.assertLessEqual(len(self.texto.splitlines()), 25)


class PromptFixerTest(unittest.TestCase):
    def chamar(self, saida="ok", motivos=None, achados=None):
        return prompt_fixer(
            seed_id="sd-42",
            motivos=["ci vermelho"] if motivos is None else motivos,
            achados=[{"arquivo": "src/a.ts", "motivo": "falta teste"}] if achados is None else achados,
            saida_verificacao=saida,
        )

    def test_aponta_pacote_e_seed(self):
        texto = self.chamar()
        self.assertIn(".fabrica/equipes/fixer.md", texto)
        self.assertIn("sd-42", texto)
        self.assertIn("só o listado", texto)

    def test_lista_motivos_e_achados(self):
        texto = self.chamar(
            motivos=["ci vermelho", "toca arquivo protegido"],
            achados=[
                {"arquivo": "src/a.ts", "motivo": "falta teste"},
                {"arquivo": "src/b.ts", "motivo": "nome ruim"},
            ],
        )
        for esperado in ("ci vermelho", "toca arquivo protegido", "src/a.ts", "falta teste", "src/b.ts", "nome ruim"):
            self.assertIn(esperado, texto)

    def test_saida_curta_entra_inteira(self):
        self.assertIn("saida-curta-xyz", self.chamar(saida="saida-curta-xyz"))

    def test_saida_longa_fica_com_os_ultimos_4000(self):
        saida = "".join(f"{i:05d}" for i in range(2000))
        self.assertEqual(len(saida), 10000)
        texto = self.chamar(saida=saida)
        self.assertIn(saida[-4000:], texto)
        self.assertNotIn(saida[-4001:], texto)
        self.assertNotIn(saida[:100], texto)

    def test_saida_de_exatos_4000_nao_corta(self):
        saida = "".join(f"{i:04d}" for i in range(1000))
        self.assertEqual(len(saida), 4000)
        self.assertIn(saida, self.chamar(saida=saida))

    def test_parte_colada_tem_no_maximo_4000(self):
        base = len(self.chamar(saida=""))
        longo = len(self.chamar(saida="§" * 50000))
        self.assertLessEqual(longo - base, 4000)
        self.assertEqual(self.chamar(saida="§" * 50000).count("§"), 4000)

    def test_listas_vazias_nao_quebram(self):
        self.assertIn("sd-42", self.chamar(motivos=[], achados=[]))

    def test_curto_sem_a_saida(self):
        self.assertLessEqual(len(self.chamar(saida="").splitlines()), 25)


class PromptOrquestradorTest(unittest.TestCase):
    ESTADO = {"seeds": {"sd-1": {"estado": "falhou", "nota": "não concluída"}}, "paralelismo": 3}
    CONTEXTO = {"observação": "ação necessária", "n": 2}

    def setUp(self):
        self.texto = prompt_orquestrador(
            motivo="raia falhou: oom_killed", estado_compacto=self.ESTADO, contexto=self.CONTEXTO
        )

    def test_aponta_o_roteiro_e_o_motivo(self):
        self.assertIn(".fabrica/orquestrador.md", self.texto)
        self.assertIn("raia falhou: oom_killed", self.texto)

    def test_inclui_os_dois_json_indentados_sem_escapar_unicode(self):
        self.assertIn(json.dumps(self.ESTADO, indent=2, ensure_ascii=False), self.texto)
        self.assertIn(json.dumps(self.CONTEXTO, indent=2, ensure_ascii=False), self.texto)
        self.assertIn("observação", self.texto)
        self.assertIn("não concluída", self.texto)
        self.assertNotIn("\\u", self.texto)

    def test_curto_com_json_pequeno(self):
        texto = prompt_orquestrador(motivo="m", estado_compacto={}, contexto={})
        self.assertLessEqual(len(texto.splitlines()), 25)


class ExtrairVereditoTest(unittest.TestCase):
    def test_bloco_valido(self):
        v = veredito_valido()
        self.assertEqual(extrair_veredito(f"Revisei.\n\n{bloco(v)}\n"), v)

    def test_aprovado_e_correcoes_aceitos_com_achados_vazios(self):
        for resultado in ("aprovado", "correcoes"):
            with self.subTest(resultado=resultado):
                v = veredito_valido(resultado=resultado, achados=[])
                self.assertEqual(extrair_veredito(bloco(v)), v)

    def test_sem_bloco(self):
        self.assertIsNone(extrair_veredito("Tudo certo, aprovado."))
        self.assertIsNone(extrair_veredito(""))

    def test_json_quebrado(self):
        self.assertIsNone(extrair_veredito(bloco('{"sha": "abc", "resultado": ')))

    def test_resultado_invalido(self):
        self.assertIsNone(extrair_veredito(bloco(veredito_valido(resultado="ok"))))
        self.assertIsNone(extrair_veredito(bloco(veredito_valido(resultado="Aprovado"))))
        self.assertIsNone(extrair_veredito(bloco(veredito_valido(resultado=["aprovado"]))))
        self.assertIsNone(extrair_veredito(bloco(veredito_valido(resultado=None))))

    def test_resultado_ausente(self):
        v = veredito_valido()
        del v["resultado"]
        self.assertIsNone(extrair_veredito(bloco(v)))

    def test_sha_ausente_vazio_ou_nao_texto(self):
        v = veredito_valido()
        del v["sha"]
        self.assertIsNone(extrair_veredito(bloco(v)))
        for sha in ("", 123, None, ["a"]):
            with self.subTest(sha=sha):
                self.assertIsNone(extrair_veredito(bloco(veredito_valido(sha=sha))))

    def test_valido_depois_invalido_vale_o_ultimo(self):
        texto = bloco(veredito_valido()) + "\nretifico:\n" + bloco(veredito_valido(resultado="ok"))
        self.assertIsNone(extrair_veredito(texto))

    def test_invalido_depois_valido_vale_o_ultimo(self):
        valido = veredito_valido(resultado="correcoes")
        texto = bloco(veredito_valido(resultado="ok")) + "\nretifico:\n" + bloco(valido)
        self.assertEqual(extrair_veredito(texto), valido)

    def test_dois_validos_devolve_o_ultimo(self):
        primeiro = veredito_valido(sha="a" * 40)
        segundo = veredito_valido(sha="b" * 40)
        self.assertEqual(extrair_veredito(bloco(primeiro) + bloco(segundo)), segundo)

    def test_achados_invalidos(self):
        casos = {
            "sem motivo": [{"arquivo": "a.ts"}],
            "sem arquivo": [{"motivo": "x"}],
            "motivo nao texto": [{"arquivo": "a.ts", "motivo": 3}],
            "arquivo nao texto": [{"arquivo": None, "motivo": "x"}],
            "item nao dict": ["a.ts: x"],
            "um bom e um ruim": [{"arquivo": "a.ts", "motivo": "x"}, {"arquivo": "b.ts"}],
        }
        for nome, achados in casos.items():
            with self.subTest(nome):
                self.assertIsNone(extrair_veredito(bloco(veredito_valido(achados=achados))))

    def test_achados_ausente_ou_nao_lista(self):
        v = veredito_valido()
        del v["achados"]
        self.assertIsNone(extrair_veredito(bloco(v)))
        for achados in ({}, "nenhum", None, {"arquivo": "a", "motivo": "b"}):
            with self.subTest(achados=achados):
                self.assertIsNone(extrair_veredito(bloco(veredito_valido(achados=achados))))

    def test_json_nao_objeto(self):
        for corpo in ("[]", '[{"sha": "a"}]', '"texto"', "42", "null", "true"):
            with self.subTest(corpo=corpo):
                self.assertIsNone(extrair_veredito(bloco(corpo)))

    def test_marcadores_desbalanceados(self):
        v = json.dumps(veredito_valido())
        casos = [
            f"{INICIO_VEREDITO}\n{v}",
            f"{v}\n{FIM_VEREDITO}",
            f"{FIM_VEREDITO}\n{v}\n{INICIO_VEREDITO}",
            INICIO_VEREDITO,
            FIM_VEREDITO,
            INICIO_VEREDITO + FIM_VEREDITO,
            bloco(veredito_valido()) + "\n" + INICIO_VEREDITO + "\n",
        ]
        for texto in casos:
            with self.subTest(texto=texto[:40]):
                self.assertIsNone(extrair_veredito(texto))

    def test_inicio_repetido_usa_o_ultimo(self):
        v = veredito_valido()
        self.assertEqual(extrair_veredito(f"{INICIO_VEREDITO}\nlixo\n{bloco(v)}"), v)

    def test_entrada_nao_texto(self):
        for entrada in (None, 123, b"bytes", ["x"], {"sha": "a"}):
            with self.subTest(entrada=entrada):
                self.assertIsNone(extrair_veredito(entrada))

    def test_json_muito_aninhado_nao_levanta(self):
        self.assertIsNone(extrair_veredito(bloco("[" * 100000 + "]" * 100000)))

    def test_recursion_error_do_json_vira_none(self):
        # Em Python mais antigo o json levanta RecursionError em aninhamento profundo.
        with mock.patch("prompts.json.loads", side_effect=RecursionError):
            self.assertIsNone(extrair_veredito(bloco(veredito_valido())))

    def test_exemplo_do_prompt_do_revisor_e_um_veredito_valido(self):
        texto = prompt_revisor(seed_id="sd-1", raia=raia_referencia(), sha=SHA)
        self.assertEqual(
            extrair_veredito(texto), {"sha": SHA, "resultado": "aprovado", "achados": []}
        )

    def test_json_em_bloco_de_codigo_dentro_dos_marcadores(self):
        v = veredito_valido()
        corpo = json.dumps(v, indent=2)
        casos = {
            "json": f"```json\n{corpo}\n```",
            "simples": f"```\n{corpo}\n```",
            "maiusculo": f"```JSON\n{corpo}\n```",
            "com espaco": f"  ```json  \n{corpo}\n  ```  ",
        }
        for nome, envolvido in casos.items():
            with self.subTest(nome):
                texto = f"Pronto.\n{INICIO_VEREDITO}\n{envolvido}\n{FIM_VEREDITO}\n"
                self.assertEqual(extrair_veredito(texto), v)

    def test_marcadores_decorados(self):
        v = veredito_valido()
        corpo = json.dumps(v)
        casos = {
            "negrito": f"**{INICIO_VEREDITO}**\n{corpo}\n**{FIM_VEREDITO}**",
            "crase": f"`{INICIO_VEREDITO}`\n{corpo}\n`{FIM_VEREDITO}`",
            "negrito e bloco": f"**{INICIO_VEREDITO}**\n```json\n{corpo}\n```\n**{FIM_VEREDITO}**",
            "bloco em volta de tudo": f"```\n{INICIO_VEREDITO}\n{corpo}\n{FIM_VEREDITO}\n```",
        }
        for nome, texto in casos.items():
            with self.subTest(nome):
                self.assertEqual(extrair_veredito(texto), v)

    def test_json_invalido_dentro_de_bloco_de_codigo_continua_none(self):
        invalidos = [
            '```json\n{"sha": "abc", "resultado": \n```',
            "```json\n" + json.dumps(veredito_valido(resultado="ok")) + "\n```",
            "```json\n" + json.dumps(veredito_valido(achados=[{"arquivo": "a"}])) + "\n```",
            "```json\nnão é json\n```",
            "```json\n```",
            "```",
        ]
        for corpo in invalidos:
            with self.subTest(corpo=corpo[:30]):
                self.assertIsNone(extrair_veredito(f"{INICIO_VEREDITO}\n{corpo}\n{FIM_VEREDITO}"))

    def test_decoracao_nao_salva_json_invalido(self):
        self.assertIsNone(extrair_veredito(f"**{INICIO_VEREDITO}**\n{{\n**{FIM_VEREDITO}**"))

    def test_prompt_do_revisor_manda_json_cru(self):
        texto = prompt_revisor(seed_id="sd-1", raia=raia_referencia(), sha=SHA)
        self.assertIn("JSON cru, sem bloco de código nem formatação", texto)
        self.assertIn("cada marcador sozinho na sua linha", texto)
        self.assertIn('"resultado": "correcoes"', texto)
        linhas = texto.splitlines()
        self.assertIn(INICIO_VEREDITO, linhas)
        self.assertIn(FIM_VEREDITO, linhas)

    def test_espacos_em_volta_do_json(self):
        v = veredito_valido()
        texto = f"{INICIO_VEREDITO}\n\n   {json.dumps(v, indent=2)}   \n\n{FIM_VEREDITO}"
        self.assertEqual(extrair_veredito(texto), v)


class FalhaDeCotaTest(unittest.TestCase):
    def test_429(self):
        self.assertTrue(eh_falha_de_cota("provider_error", "HTTP 429 Too Many Requests"))

    def test_quota_e_rate_limit(self):
        for texto in ("Quota exceeded", "QUOTA", "rate limit hit", "Rate-Limit", "rate_limited", "ratelimit"):
            with self.subTest(texto=texto):
                self.assertTrue(eh_falha_de_cota("provider_error", texto))

    def test_provider_error_sem_sinal_de_cota(self):
        self.assertFalse(eh_falha_de_cota("provider_error", "boom"))
        self.assertFalse(eh_falha_de_cota("provider_error", ""))

    def test_mensagens_de_limite_do_claude_code(self):
        casos = [
            "Claude AI usage limit reached|1730000000",
            "5-hour limit reached ∙ resets 3pm",
            "Individual quota reached",
            "Usage Limit Reached",
            "usage limit exceeded for this account",
        ]
        for texto in casos:
            with self.subTest(texto=texto):
                self.assertTrue(eh_falha_de_cota("provider_error", texto))
                self.assertFalse(eh_falha_de_cota("timed_out", texto))

    def test_quotation_nao_e_cota(self):
        self.assertFalse(eh_falha_de_cota("provider_error", "quotation marks"))
        self.assertFalse(eh_falha_de_cota("provider_error", "unquoted"))
        self.assertTrue(eh_falha_de_cota("provider_error", "(quota)"))

    def test_429_precisa_ser_palavra(self):
        self.assertFalse(eh_falha_de_cota("provider_error", "erro 14290 no stack"))
        self.assertTrue(eh_falha_de_cota("provider_error", "status=429."))

    def test_outro_motivo_nunca_e_cota(self):
        self.assertFalse(eh_falha_de_cota("timed_out", "quota"))
        self.assertFalse(eh_falha_de_cota("oom_killed", "429 rate limit"))
        self.assertFalse(eh_falha_de_cota(None, "quota 429"))

    def test_texto_nao_str_nao_levanta(self):
        self.assertFalse(eh_falha_de_cota("provider_error", None))
        self.assertFalse(eh_falha_de_cota("provider_error", 429))


if __name__ == "__main__":
    unittest.main()
