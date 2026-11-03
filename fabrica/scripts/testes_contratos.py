"""Contratos entre o código do kit e os documentos que os agentes leem (Task 9).

Tudo o que dá para tirar do código é tirado do código: os motivos de acordada, os papéis, as chaves de
`config["modelos"]`, os caminhos permitidos ao orquestrador e as variáveis de ambiente do despachante.
"""

import ast
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest

RAIZ = pathlib.Path(__file__).resolve().parent
KIT = RAIZ.parent
RAIZ_DO_REPO = KIT.parent
sys.path.insert(0, str(RAIZ))

import despachante  # noqa: E402
import estado as est  # noqa: E402
import forja  # noqa: E402
import gates  # noqa: E402
import instalar  # noqa: E402
import preparar_warren  # noqa: E402
import prompts  # noqa: E402
import raias  # noqa: E402
import verificacao  # noqa: E402

EQUIPES = KIT / "equipes"
ORQUESTRADOR = KIT / "orquestrador.md"
PADROES = KIT / "PADROES-COMUNS.md"
README = KIT / "README.md"
UNIT = KIT / "servico" / "fabrica-despachante.service"
CONFIG = json.loads((KIT / "modelos" / "config.json").read_text(encoding="utf-8"))
COMANDO_DE_VALIDACAO = "python3 -I .fabrica/raias.py validar .fabrica/plano.json"
SECOES_DO_FIXER = ("Missão", "Entradas", "Saídas", "Pronto quando", "Proibido", "Skills Superpowers")
SHA_REAL = "0123456789abcdef0123456789abcdef01234567"


def ler(caminho: pathlib.Path) -> str:
    return caminho.read_text(encoding="utf-8")


def _titulo(linha: str, nivel: str) -> str | None:
    if not linha.startswith(nivel + " "):
        return None
    return re.sub(r"^\d+(\.\d+)*\.?\s+", "", linha[len(nivel) + 1 :].strip())


def secao(texto: str, titulo: str, nivel: str = "##") -> str | None:
    """Corpo da seção `titulo` (sem o número opcional), até a próxima seção do mesmo nível ou acima."""
    linhas = texto.splitlines()
    for n, linha in enumerate(linhas):
        if _titulo(linha, nivel) == titulo:
            corpo = []
            for seguinte in linhas[n + 1 :]:
                if any(seguinte.startswith(h + " ") for h in ("#", "##", nivel)):
                    break
                corpo.append(seguinte)
            return "\n".join(corpo)
    return None


def motivos_de_acordar() -> set[str]:
    """Os motivos que o código emite: dicts `{"tipo": "acordar", "motivo": "<x>"}` e `_enfileirar_acordar("<x>", ...)`."""
    motivos = set()
    for nome in ("estado.py", "despachante.py"):
        for no in ast.walk(ast.parse(ler(RAIZ / nome))):
            if isinstance(no, ast.Dict):
                pares = {k.value: v for k, v in zip(no.keys, no.values) if isinstance(k, ast.Constant)}
                tipo, motivo = pares.get("tipo"), pares.get("motivo")
                if (
                    isinstance(tipo, ast.Constant)
                    and tipo.value == "acordar"
                    and isinstance(motivo, ast.Constant)
                    and isinstance(motivo.value, str)
                ):
                    motivos.add(motivo.value)
            elif (
                isinstance(no, ast.Call)
                and isinstance(no.func, ast.Attribute)
                and no.func.attr == "_enfileirar_acordar"
                and no.args
                and isinstance(no.args[0], ast.Constant)
                and isinstance(no.args[0].value, str)
            ):
                motivos.add(no.args[0].value)
    return motivos


def variaveis_do_despachante() -> set[str]:
    texto = ler(RAIZ / "despachante.py")
    return set(re.findall(r'_exigir\(ambiente, "([A-Z_]+)"\)', texto)) | set(
        re.findall(r'ambiente\.get\("([A-Z_]+)"\)', texto)
    )


def montar_destino(pasta: pathlib.Path) -> pathlib.Path:
    destino = pasta / "cliente"
    (destino / ".github" / "workflows").mkdir(parents=True)
    (destino / ".github" / "workflows" / "ci.yml").write_text("name: ci\n", encoding="utf-8")
    (destino / ".seeds").mkdir()
    return destino


class TestesPerfis(unittest.TestCase):
    def test_todo_papel_de_raia_revisor_e_fixer_tem_perfil(self):
        for papel in (*raias.PAPEIS_DE_RAIA, "revisor", "fixer", "orquestrador"):
            with self.subTest(papel=papel):
                self.assertTrue((EQUIPES / (papel + ".md")).is_file(), papel)
        self.assertTrue(ORQUESTRADOR.is_file())

    def test_alias_aponta_para_um_perfil_existente(self):
        for alias, canonico in raias.ALIASES_DE_PAPEL.items():
            with self.subTest(alias=alias):
                self.assertTrue((EQUIPES / (canonico + ".md")).is_file())

    def test_toda_chave_de_modelos_tem_perfil(self):
        for papel in CONFIG["modelos"]:
            with self.subTest(papel=papel):
                self.assertTrue((EQUIPES / (papel + ".md")).is_file(), papel)

    def test_padroes_comuns_existe_e_e_citado_com_link_que_resolve(self):
        self.assertTrue(PADROES.is_file())
        perfis = sorted(EQUIPES.glob("*.md"))
        self.assertGreaterEqual(len(perfis), 11)
        for perfil in perfis:
            with self.subTest(perfil=perfil.name):
                texto = ler(perfil)
                self.assertIn("../PADROES-COMUNS.md", texto)
                self.assertTrue((perfil.parent / "../PADROES-COMUNS.md").resolve().is_file())
        self.assertIn("PADROES-COMUNS.md", ler(ORQUESTRADOR))

    def test_fixer_curto_com_as_seis_secoes(self):
        texto = ler(EQUIPES / "fixer.md")
        self.assertLessEqual(len(texto.splitlines()), 40)
        for titulo in SECOES_DO_FIXER:
            with self.subTest(secao=titulo):
                self.assertIsNotNone(secao(texto, titulo), titulo)
        self.assertIn(".fabrica/equipes/<papel da raia>.md", texto)
        self.assertIn("PADROES-COMUNS.md", texto)


class TestesRevisor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.texto = ler(EQUIPES / "revisor.md")
        cls.formato = secao(cls.texto, "Formato do veredito na Fábrica")

    def test_secao_do_formato_no_fim(self):
        self.assertIsNotNone(self.formato)
        self.assertGreater(self.texto.index("Formato do veredito na Fábrica"), self.texto.index("Exercício de avaliação"))

    def test_marcadores_sozinhos_na_linha(self):
        linhas = [linha.strip() for linha in self.formato.splitlines()]
        self.assertIn(prompts.INICIO_VEREDITO, linhas)
        self.assertIn(prompts.FIM_VEREDITO, linhas)
        for campo in ("sha", "resultado", "achados", "arquivo", "motivo", "aprovado", "correcoes"):
            self.assertIn(campo, self.formato)

    def test_exemplo_aceito_e_seguro(self):
        veredito = prompts.extrair_veredito(self.formato)
        self.assertIsNotNone(veredito)
        self.assertEqual(veredito["sha"], "0" * 40)
        self.assertEqual(veredito["resultado"], "correcoes")
        self.assertTrue(veredito["achados"])
        for achado in veredito["achados"]:
            self.assertNotEqual(achado["arquivo"], prompts.ARQUIVO_EXEMPLO)
            self.assertNotEqual(achado["motivo"], prompts.MOTIVO_EXEMPLO)
            self.assertTrue(achado["arquivo"].strip() and achado["motivo"].strip())

    def test_exemplo_copiado_vale_como_veredito_ausente(self):
        veredito = prompts.extrair_veredito(self.texto)
        resultado = gates.avaliar_merge(
            head_sha=SHA_REAL,
            ci="verde",
            verificacao={"sha": SHA_REAL, "codigo": 0},
            veredito=veredito,
            arquivos=["src/a.ts"],
            protegidos=[],
        )
        self.assertEqual(resultado["decisao"], "aguardar")
        self.assertIn("revisao", resultado["faltando"])


class TestesOrquestrador(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.texto = ler(ORQUESTRADOR)
        cls.entrada = secao(cls.texto, "Entrada de cada acordada")

    def test_tamanho(self):
        self.assertLessEqual(len(self.texto.splitlines()), 260)

    def test_secoes_obrigatorias(self):
        for titulo in ("Faz / nunca faz", "Entrada de cada acordada", "Saída", "Partição", "Orçamento"):
            with self.subTest(secao=titulo):
                self.assertIsNotNone(secao(self.texto, titulo), titulo)

    def test_extracao_dos_motivos_ve_o_codigo(self):
        motivos = motivos_de_acordar()
        self.assertTrue(set(est.MOTIVOS_DO_PAULO) <= motivos, motivos)
        self.assertIn("resposta_paulo", motivos)
        self.assertIn("plano_invalido", motivos)

    def test_cita_todo_motivo_de_acordada_do_codigo(self):
        for motivo in sorted(motivos_de_acordar()):
            with self.subTest(motivo=motivo):
                self.assertIsNotNone(secao(self.entrada, "`%s`" % motivo, "###"), motivo)

    def test_regra_de_fase_concluida(self):
        corpo = secao(self.entrada, "`fase_concluida`", "###")
        self.assertIn("faseAtual", corpo)
        self.assertIn("só avança", corpo)
        self.assertIn("sem replanejar", corpo)
        self.assertIn(".fabrica/plano.json", corpo)

    def test_saida(self):
        saida = secao(self.texto, "Saída")
        self.assertIn(COMANDO_DE_VALIDACAO, saida)
        for caminho in despachante.PERMITIDOS_AO_ORQUESTRADOR:
            with self.subTest(caminho=caminho):
                self.assertIn(caminho, saida)
        self.assertIn("planoSeeds", saida)
        self.assertIn("verificacao", saida)
        self.assertIn("sd create", saida)
        self.assertIn("sd plan", saida)

    def test_planejamento_previo(self):
        self.assertIn("fabrica-*", self.texto)
        self.assertIn("não replaneja do zero", self.texto)

    def test_principios_do_architect_orchestrator(self):
        for trecho in (
            "filtro de valor",
            "existência",
            "P0",
            "P3",
            "bloqueadores",
            "admissão",
            "responsabilidade de negócio",
            "orçamento de escopo",
            "NO-OP com evidência",
            "nunca invente",
        ):
            with self.subTest(trecho=trecho):
                self.assertIn(trecho.lower(), self.texto.lower())


class TestesInstaladorComOKitReal(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.destino = montar_destino(pathlib.Path(self._tmp.name))
        self.resultado = instalar.instalar(self.destino, kit=RAIZ_DO_REPO)

    def test_instala_todos_os_arquivos_do_kit(self):
        self.assertEqual(self.resultado["avisos"], [])
        for perfil in sorted(EQUIPES.glob("*.md")):
            with self.subTest(perfil=perfil.name):
                instalado = self.destino / ".fabrica" / "equipes" / perfil.name
                self.assertEqual(instalado.read_bytes(), perfil.read_bytes())
                self.assertTrue((instalado.parent / "../PADROES-COMUNS.md").resolve().is_file())
        for origem, destino in (
            (ORQUESTRADOR, ".fabrica/orquestrador.md"),
            (PADROES, ".fabrica/PADROES-COMUNS.md"),
            (RAIZ / "raias.py", ".fabrica/raias.py"),
            (RAIZ / "globs.py", ".fabrica/globs.py"),
        ):
            self.assertEqual((self.destino / destino).read_bytes(), origem.read_bytes(), destino)

    def test_todo_pacote_citado_pelos_prompts_existe_instalado(self):
        textos = [prompts.prompt_template_raia(p) for p in (*raias.PAPEIS_DE_RAIA, *raias.ALIASES_DE_PAPEL)]
        textos += [
            prompts.prompt_fixer(seed_id="s", papel=p, motivos=[], achados=[], saida_verificacao="")
            for p in (*raias.PAPEIS_DE_RAIA, *raias.ALIASES_DE_PAPEL)
        ]
        textos.append(prompts.prompt_revisor(seed_id="s", raia={}, sha=SHA_REAL))
        textos.append(prompts.prompt_orquestrador(motivo="m", estado_compacto={}, contexto={}))
        textos.append(ler(self.destino / "AGENTS.md"))
        citados = {c for t in textos for c in re.findall(r"\.fabrica/[A-Za-z0-9_./-]+\.md", t)}
        self.assertIn(".fabrica/orquestrador.md", citados)
        self.assertIn(".fabrica/equipes/fixer.md", citados)
        for caminho in sorted(citados):
            with self.subTest(caminho=caminho):
                self.assertTrue((self.destino / caminho).is_file(), caminho)

    def test_comando_de_validacao_funciona_instalado_e_aceita_o_alias(self):
        plano = {
            "versao": 1,
            "faseAtual": "f1",
            "fases": [{"id": "f1", "raias": ["telas"]}],
            "raias": [
                {
                    "id": "telas",
                    "papel": "ux-engineer",
                    "planoSeeds": "pl-00aa",
                    "dependeDe": [],
                    "arquivos": ["docs/telas/"],
                    "verificacao": "pnpm test",
                    "criteriosAceite": ["guia de telas pronto"],
                }
            ],
        }
        (self.destino / ".fabrica" / "plano.json").write_text(json.dumps(plano), encoding="utf-8")
        argv = [sys.executable] + COMANDO_DE_VALIDACAO.split()[1:]
        feito = subprocess.run(argv, cwd=self.destino, capture_output=True, text=True, timeout=60)
        self.assertEqual((feito.returncode, feito.stdout, feito.stderr), (0, "", ""))
        plano["raias"][0]["papel"] = "designer"
        (self.destino / ".fabrica" / "plano.json").write_text(json.dumps(plano), encoding="utf-8")
        feito = subprocess.run(argv, cwd=self.destino, capture_output=True, text=True, timeout=60)
        self.assertEqual(feito.returncode, 1)
        self.assertIn("papel inválido", feito.stdout)


class TestesOperacao(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.readme = ler(README)
        cls.unit = ler(UNIT)

    def test_unit_de_usuario(self):
        linhas = [linha.strip() for linha in self.unit.splitlines()]
        for esperada in (
            "[Unit]",
            "[Service]",
            "[Install]",
            "ExecStart=/usr/bin/python3 -I %h/fabrica/kit/fabrica/scripts/despachante.py rodar --intervalo 30",
            "EnvironmentFile=%h/fabrica/despachante.env",
            "Restart=always",
            "RestartSec=15",
            "RestartPreventExitStatus=%d" % despachante.CODIGO_ENTRADA,
            "WantedBy=default.target",
        ):
            self.assertIn(esperada, linhas)
        self.assertFalse(any(linha.startswith("User=") for linha in linhas))

    def test_unit_documenta_as_variaveis_sem_segredo(self):
        comentarios = "\n".join(linha for linha in self.unit.splitlines() if linha.startswith("#"))
        variaveis = variaveis_do_despachante()
        self.assertTrue({"FABRICA_RAIZ", "WARREN_TOKEN_FILE", "GH_TOKEN_FILE"} <= variaveis, variaveis)
        for nome in sorted(variaveis):
            with self.subTest(variavel=nome):
                self.assertIn(nome, comentarios)
        self.assertNotRegex(self.unit, r"(?m)^\s*#?\s*(WARREN_TOKEN|GH_TOKEN)=")
        self.assertNotRegex(self.unit, r"gh[pousr]_[A-Za-z0-9]{10,}")

    def test_readme_tabela_de_modelos_igual_a_config(self):
        linhas = {}
        for linha in self.readme.splitlines():
            if linha.startswith("|"):
                celulas = [c.strip() for c in linha.strip().strip("|").split("|")]
                linhas[celulas[0]] = celulas
        for papel, entrada in CONFIG["modelos"].items():
            with self.subTest(papel=papel):
                celulas = linhas.get("`%s`" % papel)
                self.assertIsNotNone(celulas, papel)
                self.assertEqual(
                    celulas[1:4], ["`%s`" % entrada["modelo"], entrada["esforco"], str(entrada["maxCustoUsd"])]
                )

    def test_readme_operacao(self):
        for trecho in (
            "python3 -I fabrica/scripts/instalar.py",
            "sd init",
            "iniciar --spec",
            " status",
            " retomar",
            "journalctl --user -u fabrica-despachante",
            forja.LABEL_DECISAO,
            preparar_warren.SERVICO_AUTOMERGE,
            "WARREN_PLAN_RUN_MERGE_TIMEOUT_MS=10800000",
            "~/.warren-gh-token",
            "Checks",
            "Commit statuses",
            "Issues",
            "0.19.3",
            ".claude/settings.json",
            '"rede"',
            "isolada",
            "fabrica-*",
        ):
            with self.subTest(trecho=trecho):
                self.assertIn(trecho, self.readme)
        self.assertIn("WARREN_PLAN_RUN_MERGE_TIMEOUT_MS=10800000", preparar_warren.DROPIN_CONTEUDO)

    def test_readme_exemplo_de_verificacao_passa_no_validador(self):
        (bloco,) = re.findall(r"```json\n(.*?)```", self.readme, re.S)
        conteiner = json.loads("{" + textwrap.dedent(bloco) + "}")["verificacao"]
        normalizado = verificacao._validar_conteiner(conteiner)
        self.assertEqual(normalizado["servicos"][0]["nome"], "postgres")
        self.assertEqual(set(conteiner) - set(normalizado), set())

    def test_ponteiros_para_o_readme(self):
        claude = ler(RAIZ_DO_REPO / "CLAUDE.md")
        agents = ler(RAIZ_DO_REPO / ".agents" / "README.md")
        self.assertIn("fabrica/README.md", secao(claude, "Como trabalhar"))
        self.assertIn("fabrica/README.md", "\n".join(agents.splitlines()[:5]))

    def test_spec_e_plano_atualizados(self):
        spec = ler(RAIZ_DO_REPO / "docs/superpowers/specs/2026-11-02-fabrica-de-agentes-design.md")
        plano = ler(RAIZ_DO_REPO / "docs/superpowers/plans/2026-11-02-fabrica-de-agentes.md")
        self.assertIsNotNone(secao(spec, "Atualizações de 03/11/2026"))
        adendo = secao(plano, "Adendo de 03/11/2026")
        self.assertIsNotNone(adendo)
        self.assertLessEqual(len([linha for linha in adendo.splitlines() if linha.strip()]), 15)
        self.assertIn("7b", adendo)


if __name__ == "__main__":
    unittest.main()
