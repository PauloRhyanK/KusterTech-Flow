import copy
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

RAIZ = pathlib.Path(__file__).resolve().parent
RAIZ_DO_REPO = RAIZ.parents[1]
sys.path.insert(0, str(RAIZ))

import despachante  # noqa: E402
import instalar  # noqa: E402
import verificacao  # noqa: E402

MODELOS_REAIS = RAIZ.parent / "modelos"
EQUIPES = ("arquiteto", "backend", "frontend", "qa", "revisor", "fixer", "ux-ui")
INICIO = "<!-- fabrica:inicio -->"
FIM = "<!-- fabrica:fim -->"
AVISO_WARREN = "confira que .warren/config.yaml não liga pr.autoMerge e tem admission.maxConcurrentRuns"

FABLE = "claude-fable-5-1"
OPUS = "claude-opus-5-5"
SONNET = "claude-sonnet-5-5"
HAIKU = "claude-haiku-5-5"

TABELA = {
    "orquestrador": (FABLE, "high", 20),
    "arquiteto": (SONNET, "medium", 15),
    "produto": (HAIKU, "medium", 5),
    "ux-ui": (SONNET, "medium", 10),
    "frontend": (SONNET, "medium", 10),
    "backend": (SONNET, "medium", 10),
    "qa": (SONNET, "medium", 10),
    "revisor": (OPUS, "medium", 5),
    "devops": (SONNET, "medium", 10),
    "seguranca": (SONNET, "medium", 10),
    "fixer": (HAIKU, "medium", 5),
}

SETTINGS_ESPERADO = {
    "modelSettings": {
        FABLE: {"effortLevel": "high"},
        OPUS: {"effortLevel": "medium"},
        SONNET: {"effortLevel": "medium"},
        HAIKU: {"effortLevel": "medium"},
    }
}

PLANO_VALIDO = {
    "versao": 1,
    "faseAtual": "f1",
    "fases": [{"id": "f1", "raias": ["a"]}],
    "raias": [
        {
            "id": "a",
            "papel": "backend",
            "planoSeeds": "pl-000a",
            "dependeDe": [],
            "arquivos": ["src/a/"],
            "verificacao": "pnpm test",
            "criteriosAceite": ["a pronta"],
        }
    ],
}


def escrever(caminho: pathlib.Path, texto: str) -> pathlib.Path:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(texto, encoding="utf-8")
    return caminho


def montar_kit(raiz: pathlib.Path) -> pathlib.Path:
    """Kit falso: os arquivos de texto da Task 9 são inventados; scripts e modelos são os reais."""
    fabrica = raiz / "fabrica"
    escrever(fabrica / "orquestrador.md", "# contrato do orquestrador v1\n")
    for papel in EQUIPES:
        escrever(fabrica / "equipes" / f"{papel}.md", f"# pacote {papel} v1\n")
    escrever(fabrica / "PADROES-COMUNS.md", "# padrões comuns v1\n")
    for nome in ("raias.py", "globs.py"):
        escrever(fabrica / "scripts" / nome, (RAIZ / nome).read_text(encoding="utf-8"))
    shutil.copytree(MODELOS_REAIS, fabrica / "modelos")
    return raiz


def montar_destino(raiz: pathlib.Path, *, ci=True, seeds=True) -> pathlib.Path:
    destino = raiz / "projeto"
    destino.mkdir()
    if ci:
        escrever(destino / ".github" / "workflows" / "ci.yml", "name: ci\n")
    if seeds:
        (destino / ".seeds").mkdir()
    return destino


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = pathlib.Path(tmp.name)
        self.kit = montar_kit(self.tmp / "kit")
        self.destino = montar_destino(self.tmp)

    def instalar(self):
        return instalar.instalar(self.destino, kit=self.kit)

    def ler(self, relativo: str) -> str:
        return (self.destino / relativo).read_text(encoding="utf-8")

    def json(self, relativo: str):
        return json.loads(self.ler(relativo))

    def arquivos_do_destino(self):
        return sorted(str(p.relative_to(self.destino)) for p in self.destino.rglob("*") if p.is_file())

    def esperados_da_instalacao_limpa(self):
        equipes = [f".fabrica/equipes/{papel}.md" for papel in EQUIPES]
        return sorted(
            equipes
            + [
                ".fabrica/orquestrador.md",
                ".fabrica/PADROES-COMUNS.md",
                ".fabrica/raias.py",
                ".fabrica/globs.py",
                ".fabrica/config.json",
                ".warren/config.yaml",
                ".gitignore",
                ".claude/settings.json",
                "AGENTS.md",
            ]
        )


class TestesRequisitos(Base):
    def test_sem_workflows_e_recusado(self):
        outro = self.tmp / "sem-ci"
        outro.mkdir()
        (outro / ".seeds").mkdir()
        with self.assertRaises(ValueError) as ctx:
            instalar.instalar(outro, kit=self.kit)
        self.assertEqual(str(ctx.exception), "sem CI: crie .github/workflows antes")

    def test_pasta_de_workflows_sem_yaml_nao_conta_como_ci(self):
        outro = self.tmp / "sem-yaml"
        (outro / ".github" / "workflows").mkdir(parents=True)
        escrever(outro / ".github" / "workflows" / "leia-me.md", "x")
        escrever(outro / ".github" / "workflows" / "ci.yml.bak", "x")
        (outro / ".github" / "workflows" / "dir.yml").mkdir()
        (outro / ".seeds").mkdir()
        with self.assertRaises(ValueError) as ctx:
            instalar.instalar(outro, kit=self.kit)
        self.assertEqual(str(ctx.exception), "sem CI: crie .github/workflows antes")

    def test_yaml_com_extensao_yaml_conta_como_ci(self):
        outro = self.tmp / "ci-yaml"
        escrever(outro / ".github" / "workflows" / "ci.yaml", "name: ci\n")
        (outro / ".seeds").mkdir()
        resultado = instalar.instalar(outro, kit=self.kit)
        self.assertIn("AGENTS.md", resultado["criados"])

    def test_yml_conta_como_ci(self):
        self.assertIn("AGENTS.md", self.instalar()["criados"])

    def test_sem_seeds_e_recusado(self):
        outro = self.tmp / "sem-seeds-aqui"
        escrever(outro / ".github" / "workflows" / "ci.yml", "name: ci\n")
        with self.assertRaises(ValueError) as ctx:
            instalar.instalar(outro, kit=self.kit)
        self.assertEqual(str(ctx.exception), "sem Seeds: rode sd init")

    def test_seeds_que_e_arquivo_nao_conta(self):
        outro = self.tmp / "seeds-arquivo"
        escrever(outro / ".github" / "workflows" / "ci.yml", "x")
        escrever(outro / ".seeds", "x")
        with self.assertRaises(ValueError) as ctx:
            instalar.instalar(outro, kit=self.kit)
        self.assertEqual(str(ctx.exception), "sem Seeds: rode sd init")

    def test_sem_ci_e_sem_seeds_acusa_o_ci_primeiro(self):
        vazio = self.tmp / "vazio"
        vazio.mkdir()
        with self.assertRaises(ValueError) as ctx:
            instalar.instalar(vazio, kit=self.kit)
        self.assertEqual(str(ctx.exception), "sem CI: crie .github/workflows antes")

    def test_destino_inexistente_ou_arquivo(self):
        for destino in (self.tmp / "nao-existe", escrever(self.tmp / "arquivo", "x")):
            with self.assertRaises(ValueError) as ctx:
                instalar.instalar(destino, kit=self.kit)
            self.assertIn(str(destino), str(ctx.exception))

    def test_recusa_nao_escreve_nada(self):
        outro = self.tmp / "sem-seeds"
        escrever(outro / ".github" / "workflows" / "ci.yml", "x")
        with self.assertRaises(ValueError):
            instalar.instalar(outro, kit=self.kit)
        self.assertEqual(sorted(p.name for p in outro.iterdir()), [".github"])

    def test_aceita_destino_como_string(self):
        self.assertIn("AGENTS.md", instalar.instalar(str(self.destino), kit=str(self.kit))["criados"])


class TestesKit(Base):
    def test_cada_arquivo_ausente_do_kit_e_recusado_com_o_caminho_e_sem_escrever(self):
        ausentes = [
            "orquestrador.md",
            "PADROES-COMUNS.md",
            "scripts/raias.py",
            "scripts/globs.py",
            "modelos/config.json",
            "modelos/warren-config.yaml",
            "modelos/AGENTS.md",
        ]
        for relativo in ausentes:
            with self.subTest(relativo=relativo):
                caminho = self.kit / "fabrica" / relativo
                conteudo = caminho.read_bytes()
                caminho.unlink()
                try:
                    with self.assertRaises(ValueError) as ctx:
                        self.instalar()
                    self.assertIn(str(caminho), str(ctx.exception))
                    self.assertEqual(self.arquivos_do_destino(), [".github/workflows/ci.yml"])
                finally:
                    caminho.write_bytes(conteudo)

    def test_equipes_ausente_ou_sem_markdown_e_recusada(self):
        equipes = self.kit / "fabrica" / "equipes"
        for papel in EQUIPES:
            (equipes / f"{papel}.md").unlink()
        escrever(equipes / "leia-me.txt", "x")
        with self.assertRaises(ValueError) as ctx:
            self.instalar()
        self.assertIn(str(equipes), str(ctx.exception))
        shutil.rmtree(equipes)
        with self.assertRaises(ValueError) as ctx:
            self.instalar()
        self.assertIn(str(equipes), str(ctx.exception))
        self.assertEqual(self.arquivos_do_destino(), [".github/workflows/ci.yml"])

    def test_config_do_kit_ilegivel_ou_com_esforco_invalido_e_recusada_sem_escrever(self):
        caminho = self.kit / "fabrica" / "modelos" / "config.json"
        original = json.loads(caminho.read_text(encoding="utf-8"))
        ruins = ["{", "[]", json.dumps({"modelos": []})]
        invalido = copy.deepcopy(original)
        invalido["modelos"]["backend"]["esforco"] = "altissimo"
        ruins.append(json.dumps(invalido))
        for texto in ruins:
            with self.subTest(texto=texto[:40]):
                caminho.write_text(texto, encoding="utf-8")
                with self.assertRaises(ValueError) as ctx:
                    self.instalar()
                self.assertIn("config.json", str(ctx.exception))
                self.assertEqual(self.arquivos_do_destino(), [".github/workflows/ci.yml"])

    def test_modelo_de_agents_sem_marcadores_e_recusado(self):
        caminho = self.kit / "fabrica" / "modelos" / "AGENTS.md"
        for texto in ("sem marcadores\n", INICIO + "\nso o inicio\n", FIM + "\n" + INICIO + "\n"):
            with self.subTest(texto=texto):
                caminho.write_text(texto, encoding="utf-8")
                with self.assertRaises(ValueError) as ctx:
                    self.instalar()
                self.assertIn("AGENTS.md", str(ctx.exception))
                self.assertEqual(self.arquivos_do_destino(), [".github/workflows/ci.yml"])


class TestesInstalacaoLimpa(Base):
    def test_cria_tudo_e_so_isso(self):
        resultado = self.instalar()
        self.assertEqual(resultado["criados"], self.esperados_da_instalacao_limpa())
        self.assertEqual(resultado["atualizados"], [])
        self.assertEqual(resultado["avisos"], [])
        self.assertEqual(
            self.arquivos_do_destino(),
            sorted(self.esperados_da_instalacao_limpa() + [".github/workflows/ci.yml"]),
        )

    def test_conteudos_copiados_do_kit(self):
        self.instalar()
        fabrica = self.kit / "fabrica"
        self.assertEqual(self.ler(".fabrica/orquestrador.md"), "# contrato do orquestrador v1\n")
        self.assertEqual(self.ler(".fabrica/PADROES-COMUNS.md"), "# padrões comuns v1\n")
        for papel in EQUIPES:
            self.assertEqual(self.ler(f".fabrica/equipes/{papel}.md"), f"# pacote {papel} v1\n")
        for nome in ("raias.py", "globs.py"):
            self.assertEqual(self.ler(f".fabrica/{nome}"), (fabrica / "scripts" / nome).read_text(encoding="utf-8"))
        self.assertEqual(self.ler(".fabrica/config.json"), (fabrica / "modelos" / "config.json").read_text(encoding="utf-8"))
        self.assertEqual(
            self.ler(".warren/config.yaml"), (fabrica / "modelos" / "warren-config.yaml").read_text(encoding="utf-8")
        )
        self.assertEqual(self.ler("AGENTS.md"), (fabrica / "modelos" / "AGENTS.md").read_text(encoding="utf-8"))
        self.assertEqual(self.json(".claude/settings.json"), SETTINGS_ESPERADO)

    def test_raias_instalado_valida_um_plano_dentro_do_destino(self):
        self.instalar()
        plano = escrever(self.destino / ".fabrica" / "plano.json", json.dumps(PLANO_VALIDO))
        proc = subprocess.run(
            [sys.executable, "-I", "-B", str(self.destino / ".fabrica" / "raias.py"), "validar", str(plano)],
            cwd=self.destino,
            capture_output=True,
            text=True,
        )
        self.assertEqual((proc.returncode, proc.stdout, proc.stderr), (0, "", ""))

    def test_raias_instalado_recusa_um_plano_invalido(self):
        self.instalar()
        ruim = copy.deepcopy(PLANO_VALIDO)
        ruim["raias"][0]["verificacao"] = ""
        plano = escrever(self.destino / ".fabrica" / "plano.json", json.dumps(ruim))
        proc = subprocess.run(
            [sys.executable, "-I", "-B", str(self.destino / ".fabrica" / "raias.py"), "validar", str(plano)],
            cwd=self.destino,
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 1)
        self.assertIn("verificacao vazia", proc.stdout)

    def test_segunda_execucao_nao_cria_nem_atualiza_nada(self):
        self.instalar()
        antes = {p: (self.destino / p).read_bytes() for p in self.arquivos_do_destino()}
        mtimes = {p: (self.destino / p).stat().st_mtime_ns for p in antes}
        segunda = self.instalar()
        self.assertEqual(segunda["criados"], [])
        self.assertEqual(segunda["atualizados"], [])
        self.assertEqual({p: (self.destino / p).read_bytes() for p in self.arquivos_do_destino()}, antes)
        self.assertEqual({p: (self.destino / p).stat().st_mtime_ns for p in antes}, mtimes)

    def test_listas_do_resultado_vem_ordenadas(self):
        resultado = self.instalar()
        self.assertEqual(resultado["criados"], sorted(resultado["criados"]))

    def test_nenhum_arquivo_temporario_sobra(self):
        self.instalar()
        self.instalar()
        for p in self.arquivos_do_destino():
            self.assertNotIn(".tmp", p)
            self.assertNotIn("~", p)


class TestesSemCi(Base):
    def setUp(self):
        super().setUp()
        for arquivo in (self.destino / ".github" / "workflows").glob("*"):
            arquivo.unlink()

    def test_sem_a_opcao_continua_recusando(self):
        with self.assertRaises(ValueError):
            self.instalar()

    def test_com_a_opcao_instala_e_desliga_o_ci_nas_seeds(self):
        instalar.instalar(self.destino, kit=self.kit, sem_ci=True)
        config = json.loads(self.ler(".fabrica/config.json"))
        self.assertIs(config["ciObrigatorioNasSeeds"], False)

    def test_a_config_continua_valida_e_igual_no_resto(self):
        instalar.instalar(self.destino, kit=self.kit, sem_ci=True)
        config = json.loads(self.ler(".fabrica/config.json"))
        padrao = json.loads((self.kit / "fabrica" / "modelos" / "config.json").read_text(encoding="utf-8"))
        config.pop("ciObrigatorioNasSeeds")
        self.assertEqual(config, padrao)

    def test_ainda_exige_seeds(self):
        shutil.rmtree(self.destino / ".seeds")
        with self.assertRaises(ValueError):
            instalar.instalar(self.destino, kit=self.kit, sem_ci=True)

    def test_opcao_na_cli(self):
        saida, erro = io.StringIO(), io.StringIO()
        codigo = instalar.main([str(self.destino), "--kit", str(self.kit), "--sem-ci"], saida=saida, erro=erro)
        self.assertEqual(codigo, 0, erro.getvalue())
        self.assertIs(json.loads(self.ler(".fabrica/config.json"))["ciObrigatorioNasSeeds"], False)


class TestesGitignore(Base):
    def gitignore(self):
        return (self.destino / ".gitignore").read_text(encoding="utf-8")

    def test_acrescenta_sem_apagar_o_que_existe(self):
        (self.destino / ".gitignore").write_text("node_modules/", encoding="utf-8")
        self.instalar()
        self.assertEqual(self.gitignore(), "node_modules/\n.claude/.credentials.json\n.pnpm-store/\n")

    def test_e_idempotente(self):
        self.instalar()
        primeira = self.gitignore()
        resultado = self.instalar()
        self.assertEqual(self.gitignore(), primeira)
        self.assertNotIn(".gitignore", resultado["atualizados"])

    def test_so_acrescenta_o_que_falta(self):
        (self.destino / ".gitignore").write_text(".pnpm-store/\n", encoding="utf-8")
        self.instalar()
        self.assertEqual(self.gitignore(), ".pnpm-store/\n.claude/.credentials.json\n")

    def test_nao_utf8_avisa_e_nao_altera(self):
        (self.destino / ".gitignore").write_bytes(b"\xff\xfe")
        resultado = self.instalar()
        self.assertEqual((self.destino / ".gitignore").read_bytes(), b"\xff\xfe")
        self.assertTrue(any(".gitignore" in a for a in resultado["avisos"]))


class TestesAtualizacao(Base):
    def test_mudanca_no_kit_sobrescreve_e_lista_em_atualizados(self):
        self.instalar()
        fabrica = self.kit / "fabrica"
        escrever(fabrica / "orquestrador.md", "# contrato v2\n")
        escrever(fabrica / "equipes" / "qa.md", "# qa v2\n")
        escrever(fabrica / "PADROES-COMUNS.md", "# padrões v2\n")
        escrever(fabrica / "scripts" / "globs.py", (fabrica / "scripts" / "globs.py").read_text(encoding="utf-8") + "\n# v2\n")
        resultado = self.instalar()
        self.assertEqual(resultado["criados"], [])
        self.assertEqual(
            resultado["atualizados"],
            [".fabrica/PADROES-COMUNS.md", ".fabrica/equipes/qa.md", ".fabrica/globs.py", ".fabrica/orquestrador.md"],
        )
        self.assertEqual(self.ler(".fabrica/orquestrador.md"), "# contrato v2\n")
        self.assertEqual(self.ler(".fabrica/equipes/qa.md"), "# qa v2\n")
        self.assertEqual(self.ler(".fabrica/equipes/backend.md"), "# pacote backend v1\n")

    def test_edicao_local_de_um_arquivo_do_kit_e_desfeita(self):
        self.instalar()
        escrever(self.destino / ".fabrica" / "equipes" / "backend.md", "editado por fora\n")
        resultado = self.instalar()
        self.assertEqual(resultado["atualizados"], [".fabrica/equipes/backend.md"])
        self.assertEqual(self.ler(".fabrica/equipes/backend.md"), "# pacote backend v1\n")

    def test_arquivo_novo_no_kit_vai_para_criados(self):
        self.instalar()
        escrever(self.kit / "fabrica" / "equipes" / "devops.md", "# devops\n")
        resultado = self.instalar()
        self.assertEqual(resultado["criados"], [".fabrica/equipes/devops.md"])
        self.assertEqual(resultado["atualizados"], [])

    def test_arquivo_apagado_do_destino_e_recriado_como_criado(self):
        self.instalar()
        (self.destino / ".fabrica" / "raias.py").unlink()
        resultado = self.instalar()
        self.assertEqual(resultado["criados"], [".fabrica/raias.py"])
        self.assertEqual(resultado["atualizados"], [])

    def test_so_markdown_de_equipes_e_copiado(self):
        escrever(self.kit / "fabrica" / "equipes" / "rascunho.txt", "x")
        (self.kit / "fabrica" / "equipes" / "subpasta").mkdir()
        escrever(self.kit / "fabrica" / "equipes" / "subpasta" / "x.md", "x")
        self.instalar()
        self.assertEqual(
            sorted(p.name for p in (self.destino / ".fabrica" / "equipes").iterdir()),
            sorted(f"{papel}.md" for papel in EQUIPES),
        )


class TestesPermissoes(Base):
    def test_arquivos_novos_nascem_legiveis_e_atualizacao_preserva_o_modo(self):
        self.instalar()
        for relativo in self.esperados_da_instalacao_limpa():
            self.assertEqual((self.destino / relativo).stat().st_mode & 0o777, 0o644, relativo)
        alvo = self.destino / ".fabrica" / "raias.py"
        alvo.chmod(0o755)
        escrever(self.kit / "fabrica" / "scripts" / "raias.py", (self.kit / "fabrica" / "scripts" / "raias.py").read_text(encoding="utf-8") + "\n# v2\n")
        self.assertEqual(self.instalar()["atualizados"], [".fabrica/raias.py"])
        self.assertEqual(alvo.stat().st_mode & 0o777, 0o755)


class TestesConfigJsonDoProjeto(Base):
    def test_config_existente_nao_e_sobrescrita_nem_listada(self):
        escrever(self.destino / ".fabrica" / "config.json", '{"meu": "config"}\n')
        resultado = self.instalar()
        self.assertEqual(self.ler(".fabrica/config.json"), '{"meu": "config"}\n')
        self.assertNotIn(".fabrica/config.json", resultado["criados"])
        self.assertNotIn(".fabrica/config.json", resultado["atualizados"])
        self.assertEqual(resultado["avisos"], [])

    def test_config_existente_continua_intocada_apos_mudanca_no_modelo(self):
        self.instalar()
        escrever(self.destino / ".fabrica" / "config.json", '{"limiteParalelo": 1}\n')
        modelo = self.kit / "fabrica" / "modelos" / "config.json"
        modelo.write_text(modelo.read_text(encoding="utf-8").replace('"limiteParalelo": 3', '"limiteParalelo": 9'), encoding="utf-8")
        self.instalar()
        self.assertEqual(self.ler(".fabrica/config.json"), '{"limiteParalelo": 1}\n')


class TestesWarrenConfig(Base):
    def test_ausente_e_criado_sem_aviso(self):
        resultado = self.instalar()
        self.assertIn(".warren/config.yaml", resultado["criados"])
        self.assertNotIn(AVISO_WARREN, resultado["avisos"])

    def test_existente_nao_e_tocado_e_gera_o_aviso(self):
        escrever(self.destino / ".warren" / "config.yaml", "pr:\n  autoMerge:\n    method: squash\n")
        resultado = self.instalar()
        self.assertEqual(self.ler(".warren/config.yaml"), "pr:\n  autoMerge:\n    method: squash\n")
        self.assertIn(AVISO_WARREN, resultado["avisos"])
        self.assertEqual(resultado["avisos"].count(AVISO_WARREN), 1)
        self.assertNotIn(".warren/config.yaml", resultado["criados"] + resultado["atualizados"])

    def test_existente_vazio_tambem_nao_e_tocado(self):
        escrever(self.destino / ".warren" / "config.yaml", "")
        resultado = self.instalar()
        self.assertEqual(self.ler(".warren/config.yaml"), "")
        self.assertIn(AVISO_WARREN, resultado["avisos"])

    def test_segunda_execucao_com_o_modelo_ja_instalado_repete_o_aviso(self):
        self.instalar()
        self.assertIn(AVISO_WARREN, self.instalar()["avisos"])


class TestesAgentsMd(Base):
    def bloco(self):
        return (self.kit / "fabrica" / "modelos" / "AGENTS.md").read_text(encoding="utf-8").strip("\n")

    def test_existente_com_texto_proprio_mantem_o_texto_e_ganha_um_bloco(self):
        escrever(self.destino / "AGENTS.md", "# Meu projeto\n\nRegra minha.\n")
        resultado = self.instalar()
        texto = self.ler("AGENTS.md")
        self.assertTrue(texto.startswith("# Meu projeto\n\nRegra minha.\n"))
        self.assertEqual(texto.count(INICIO), 1)
        self.assertEqual(texto.count(FIM), 1)
        self.assertIn(self.bloco(), texto)
        self.assertEqual(texto, "# Meu projeto\n\nRegra minha.\n\n" + self.bloco() + "\n")
        self.assertIn("AGENTS.md", resultado["atualizados"])
        self.assertNotIn("AGENTS.md", resultado["criados"])

    def test_rodar_de_novo_nao_duplica_nem_muda_nada(self):
        escrever(self.destino / "AGENTS.md", "# Meu projeto\n\nRegra minha.\n")
        self.instalar()
        primeiro = self.ler("AGENTS.md")
        segunda = self.instalar()
        self.assertEqual(self.ler("AGENTS.md"), primeiro)
        self.assertEqual(self.ler("AGENTS.md").count(INICIO), 1)
        self.assertNotIn("AGENTS.md", segunda["atualizados"] + segunda["criados"])

    def test_sem_quebra_de_linha_no_fim_ainda_separa_o_bloco(self):
        escrever(self.destino / "AGENTS.md", "so uma linha")
        self.instalar()
        self.assertEqual(self.ler("AGENTS.md"), "so uma linha\n\n" + self.bloco() + "\n")

    def test_arquivo_vazio_recebe_so_o_bloco(self):
        escrever(self.destino / "AGENTS.md", "")
        self.instalar()
        self.assertEqual(self.ler("AGENTS.md"), self.bloco() + "\n")

    def test_bloco_antigo_e_substituido_no_lugar_preservando_antes_e_depois(self):
        antigo = INICIO + "\nregras velhas\n" + FIM
        escrever(self.destino / "AGENTS.md", "ANTES\n\n" + antigo + "\n\nDEPOIS\n")
        resultado = self.instalar()
        self.assertEqual(self.ler("AGENTS.md"), "ANTES\n\n" + self.bloco() + "\n\nDEPOIS\n")
        self.assertNotIn("regras velhas", self.ler("AGENTS.md"))
        self.assertEqual(resultado["atualizados"].count("AGENTS.md"), 1)

    def test_bloco_igual_ao_do_modelo_nao_conta_como_atualizado(self):
        escrever(self.destino / "AGENTS.md", "ANTES\n\n" + self.bloco() + "\n\nDEPOIS\n")
        resultado = self.instalar()
        self.assertEqual(self.ler("AGENTS.md"), "ANTES\n\n" + self.bloco() + "\n\nDEPOIS\n")
        self.assertNotIn("AGENTS.md", resultado["atualizados"])
        self.assertNotIn("AGENTS.md", resultado["criados"])

    def test_mudanca_no_modelo_atualiza_o_bloco_instalado(self):
        escrever(self.destino / "AGENTS.md", "# meu\n")
        self.instalar()
        modelo = self.kit / "fabrica" / "modelos" / "AGENTS.md"
        modelo.write_text(INICIO + "\nregra nova\n" + FIM + "\n", encoding="utf-8")
        resultado = self.instalar()
        self.assertEqual(self.ler("AGENTS.md"), "# meu\n\n" + INICIO + "\nregra nova\n" + FIM + "\n")
        self.assertIn("AGENTS.md", resultado["atualizados"])

    def test_texto_com_barra_e_dolar_no_modelo_nao_e_interpretado(self):
        modelo = self.kit / "fabrica" / "modelos" / "AGENTS.md"
        modelo.write_text(INICIO + "\n\\1 $1 \\g<0>\n" + FIM + "\n", encoding="utf-8")
        escrever(self.destino / "AGENTS.md", INICIO + "\nx\n" + FIM + "\n")
        self.instalar()
        self.assertEqual(self.ler("AGENTS.md"), INICIO + "\n\\1 $1 \\g<0>\n" + FIM + "\n")

    def test_marcadores_quebrados_deixam_o_arquivo_intocado_e_avisam(self):
        casos = [
            INICIO + "\nsem fim\n",
            "sem inicio\n" + FIM + "\n",
            FIM + "\nfora de ordem\n" + INICIO + "\n",
            INICIO + "\na\n" + FIM + "\n" + INICIO + "\nb\n" + FIM + "\n",
        ]
        for texto in casos:
            with self.subTest(texto=texto):
                escrever(self.destino / "AGENTS.md", texto)
                resultado = self.instalar()
                self.assertEqual(self.ler("AGENTS.md"), texto)
                self.assertNotIn("AGENTS.md", resultado["atualizados"] + resultado["criados"])
                avisos = [a for a in resultado["avisos"] if "AGENTS.md" in a]
                self.assertEqual(len(avisos), 1, resultado["avisos"])

    def test_agents_md_nao_utf8_fica_intocado_e_avisa(self):
        (self.destino / "AGENTS.md").write_bytes(b"\xff\xfe\x00 nao e utf-8")
        resultado = self.instalar()
        self.assertEqual((self.destino / "AGENTS.md").read_bytes(), b"\xff\xfe\x00 nao e utf-8")
        self.assertEqual(len([a for a in resultado["avisos"] if "AGENTS.md" in a]), 1)

    def test_fim_de_linha_crlf_do_projeto_e_preservado_no_texto_proprio(self):
        (self.destino / "AGENTS.md").write_bytes(b"# meu\r\n\r\nregra\r\n")
        self.instalar()
        dados = (self.destino / "AGENTS.md").read_bytes()
        self.assertTrue(dados.startswith(b"# meu\r\n\r\nregra\r\n"))
        self.assertEqual(dados.count(INICIO.encode()), 1)
        self.assertEqual(dados.count(b"\n"), dados.count(b"\r\n"))

    def test_bloco_existente_em_crlf_e_substituido_sem_misturar_fins_de_linha(self):
        (self.destino / "AGENTS.md").write_bytes(("a\r\n" + INICIO + "\r\nvelho\r\n" + FIM + "\r\nb\r\n").encode())
        self.instalar()
        dados = (self.destino / "AGENTS.md").read_bytes()
        self.assertEqual(dados.count(b"\n"), dados.count(b"\r\n"))
        self.assertNotIn(b"velho", dados)
        antes = dados
        self.instalar()
        self.assertEqual((self.destino / "AGENTS.md").read_bytes(), antes)


class TestesSettingsDoClaude(Base):
    def settings(self):
        return self.destino / ".claude" / "settings.json"

    def test_ausente_e_criado_com_o_conteudo_exato(self):
        resultado = self.instalar()
        self.assertEqual(self.json(".claude/settings.json"), SETTINGS_ESPERADO)
        self.assertIn(".claude/settings.json", resultado["criados"])
        self.assertEqual(resultado["avisos"], [])

    def test_existente_mantem_outras_chaves_e_acrescenta_so_o_que_falta(self):
        original = {"permissions": {"allow": ["Bash(ls)"]}, "modelSettings": {SONNET: {"effortLevel": "medium"}}, "outra": [1, 2]}
        escrever(self.settings(), json.dumps(original))
        resultado = self.instalar()
        esperado = copy.deepcopy(original)
        esperado["modelSettings"].update({FABLE: {"effortLevel": "high"}, OPUS: {"effortLevel": "medium"}, HAIKU: {"effortLevel": "medium"}})
        self.assertEqual(self.json(".claude/settings.json"), esperado)
        self.assertIn(".claude/settings.json", resultado["atualizados"])
        self.assertNotIn(".claude/settings.json", resultado["criados"])
        self.assertEqual(resultado["avisos"], [])

    def test_existente_sem_modelsettings_ganha_o_bloco_completo(self):
        escrever(self.settings(), json.dumps({"permissions": {"deny": ["x"]}}))
        self.instalar()
        self.assertEqual(self.json(".claude/settings.json"), dict(SETTINGS_ESPERADO, permissions={"deny": ["x"]}))

    def test_entrada_existente_com_valor_diferente_nao_e_sobrescrita_e_avisa_uma_vez_por_entrada(self):
        original = {"modelSettings": {FABLE: {"effortLevel": "low"}, OPUS: {"effortLevel": "max"}, SONNET: {"effortLevel": "medium"}}}
        escrever(self.settings(), json.dumps(original))
        resultado = self.instalar()
        dados = self.json(".claude/settings.json")
        self.assertEqual(dados["modelSettings"][FABLE], {"effortLevel": "low"})
        self.assertEqual(dados["modelSettings"][OPUS], {"effortLevel": "max"})
        self.assertEqual(dados["modelSettings"][HAIKU], {"effortLevel": "medium"})
        avisos = [a for a in resultado["avisos"] if "settings.json" in a]
        self.assertEqual(len(avisos), 2, avisos)
        self.assertEqual(len([a for a in avisos if FABLE in a]), 1)
        self.assertEqual(len([a for a in avisos if OPUS in a]), 1)
        self.assertFalse([a for a in avisos if SONNET in a])

    def test_entrada_existente_com_outro_formato_nao_e_mexida_e_avisa(self):
        original = {"modelSettings": {FABLE: {"effortLevel": "high", "extra": 1}, OPUS: "medium", SONNET: {}}}
        escrever(self.settings(), json.dumps(original))
        resultado = self.instalar()
        dados = self.json(".claude/settings.json")["modelSettings"]
        self.assertEqual(dados[FABLE], {"effortLevel": "high", "extra": 1})
        self.assertEqual(dados[OPUS], "medium")
        self.assertEqual(dados[SONNET], {})
        avisos = [a for a in resultado["avisos"] if "settings.json" in a]
        self.assertEqual(len(avisos), 2, avisos)
        self.assertFalse([a for a in avisos if FABLE in a])

    def test_so_diferencas_sem_nada_a_acrescentar_nao_reescrevem_o_arquivo(self):
        original = "{\n\"modelSettings\": {\"%s\": {\"effortLevel\": \"low\"}, \"%s\": {\"effortLevel\": \"medium\"}, \"%s\": {\"effortLevel\": \"medium\"}, \"%s\": {\"effortLevel\": \"medium\"}}\n}\n" % (FABLE, OPUS, SONNET, HAIKU)
        escrever(self.settings(), original)
        resultado = self.instalar()
        self.assertEqual(self.ler(".claude/settings.json"), original)
        self.assertNotIn(".claude/settings.json", resultado["atualizados"] + resultado["criados"])
        self.assertEqual(len([a for a in resultado["avisos"] if "settings.json" in a]), 1)

    def test_json_invalido_fica_intocado_e_avisa(self):
        for texto in ("{", "", "// comentario\n{}", "{'a': 1}", '{"modelSettings": {},}'):
            with self.subTest(texto=texto):
                escrever(self.settings(), texto)
                resultado = self.instalar()
                self.assertEqual(self.ler(".claude/settings.json"), texto)
                self.assertNotIn(".claude/settings.json", resultado["atualizados"] + resultado["criados"])
                self.assertEqual(len([a for a in resultado["avisos"] if "settings.json" in a]), 1)

    def test_json_que_nao_e_objeto_ou_modelsettings_que_nao_e_objeto_ficam_intocados_e_avisam(self):
        for texto in ("[]", "null", "5", '"x"', '{"modelSettings": []}', '{"modelSettings": null}', '{"modelSettings": "x"}'):
            with self.subTest(texto=texto):
                escrever(self.settings(), texto)
                resultado = self.instalar()
                self.assertEqual(self.ler(".claude/settings.json"), texto)
                self.assertNotIn(".claude/settings.json", resultado["atualizados"] + resultado["criados"])
                self.assertEqual(len([a for a in resultado["avisos"] if "settings.json" in a]), 1)

    def test_segunda_execucao_e_idempotente(self):
        escrever(self.settings(), json.dumps({"modelSettings": {OPUS: {"effortLevel": "high"}}}))
        self.instalar()
        depois = self.ler(".claude/settings.json")
        segunda = self.instalar()
        self.assertEqual(self.ler(".claude/settings.json"), depois)
        self.assertNotIn(".claude/settings.json", segunda["atualizados"] + segunda["criados"])

    def test_esforcos_diferentes_para_o_mesmo_modelo_valem_o_maior_com_aviso(self):
        caminho = self.kit / "fabrica" / "modelos" / "config.json"
        dados = json.loads(caminho.read_text(encoding="utf-8"))
        dados["modelos"]["backend"]["esforco"] = "high"
        dados["modelos"]["qa"]["esforco"] = "low"
        caminho.write_text(json.dumps(dados), encoding="utf-8")
        resultado = self.instalar()
        self.assertEqual(self.json(".claude/settings.json")["modelSettings"][SONNET], {"effortLevel": "high"})
        avisos = [a for a in resultado["avisos"] if SONNET in a]
        self.assertEqual(len(avisos), 1, resultado["avisos"])
        for papel in ("backend", "qa"):
            self.assertIn(papel, avisos[0])

    def test_ordem_dos_niveis_de_esforco(self):
        for niveis, vence in (
            (("low", "medium"), "medium"),
            (("medium", "high"), "high"),
            (("high", "xhigh"), "xhigh"),
            (("xhigh", "max"), "max"),
            (("max", "low"), "max"),
        ):
            with self.subTest(niveis=niveis):
                caminho = self.kit / "fabrica" / "modelos" / "config.json"
                dados = json.loads(caminho.read_text(encoding="utf-8"))
                dados["modelos"]["backend"]["esforco"] = niveis[0]
                dados["modelos"]["qa"]["esforco"] = niveis[1]
                for papel in ("arquiteto", "ux-ui", "frontend", "devops", "seguranca"):
                    dados["modelos"][papel]["esforco"] = niveis[0]
                caminho.write_text(json.dumps(dados), encoding="utf-8")
                pasta = self.tmp / ("d-" + "-".join(niveis))
                pasta.mkdir()
                destino = montar_destino(pasta)
                instalar.instalar(destino, kit=self.kit)
                efetivo = json.loads((destino / ".claude" / "settings.json").read_text(encoding="utf-8"))
                self.assertEqual(efetivo["modelSettings"][SONNET], {"effortLevel": vence})

    def test_kit_sem_nenhum_esforco_nao_cria_settings(self):
        caminho = self.kit / "fabrica" / "modelos" / "config.json"
        dados = json.loads(caminho.read_text(encoding="utf-8"))
        for entrada in dados["modelos"].values():
            del entrada["esforco"]
        caminho.write_text(json.dumps(dados), encoding="utf-8")
        resultado = self.instalar()
        self.assertFalse(self.settings().exists())
        self.assertNotIn(".claude/settings.json", resultado["criados"])

    def test_papel_sem_esforco_nao_gera_entrada(self):
        caminho = self.kit / "fabrica" / "modelos" / "config.json"
        dados = json.loads(caminho.read_text(encoding="utf-8"))
        for papel in ("produto", "fixer"):
            del dados["modelos"][papel]["esforco"]
        caminho.write_text(json.dumps(dados), encoding="utf-8")
        resultado = self.instalar()
        self.assertNotIn(HAIKU, self.json(".claude/settings.json")["modelSettings"])
        self.assertEqual(resultado["avisos"], [])


class TestesModelos(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = json.loads((MODELOS_REAIS / "config.json").read_text(encoding="utf-8"))

    def test_config_json_do_modelo_passa_no_validador_do_despachante(self):
        validada = despachante._validar_config(copy.deepcopy(self.config))
        self.assertEqual(validada["limiteParalelo"], 3)
        self.assertEqual(validada["branchPadrao"], "main")
        self.assertIs(validada["ciObrigatorioNoPlano"], False)

    def test_config_json_do_modelo_aceita_o_construtor_do_despachante(self):
        d = despachante.Despachante(
            motor=object(),
            forja=object(),
            raiz=pathlib.Path("."),
            repo_dir=pathlib.Path("."),
            config=copy.deepcopy(self.config),
            projeto="p",
            repo="acme/app",
        )
        self.assertEqual(d._modelo("backend")["modelo"], SONNET)

    def test_bloco_verificacao_passa_no_validador_do_conteiner(self):
        normalizado = verificacao._validar_conteiner(self.config["verificacao"])
        self.assertEqual(normalizado["imagem"], "node:22-bookworm")
        self.assertEqual(self.config["verificacao"]["env"], {})
        self.assertEqual(self.config["verificacao"]["servicos"], [])
        self.assertEqual(
            self.config["verificacao"],
            {"imagem": "node:22-bookworm", "shell": "bash", "rede": "internet", "memoria": "3g", "cpus": "2", "pids": 512, "env": {}, "servicos": []},
        )

    def test_tabela_de_modelos_do_paulo(self):
        self.assertEqual(set(self.config["modelos"]), set(TABELA))
        self.assertEqual(len(self.config["modelos"]), 11)
        for papel, (modelo, esforco, custo) in TABELA.items():
            with self.subTest(papel=papel):
                self.assertEqual(
                    self.config["modelos"][papel],
                    {"agente": "claude-code", "modelo": modelo, "esforco": esforco, "maxCustoUsd": custo},
                )

    def test_papeis_obrigatorios_do_despachante_estao_na_tabela(self):
        for papel in despachante.PAPEIS_OBRIGATORIOS:
            self.assertIn(papel, self.config["modelos"])

    def test_chaves_de_nivel_superior(self):
        self.assertEqual(
            set(self.config),
            {"limiteParalelo", "branchPadrao", "ciObrigatorioNoPlano", "warren", "protegidos", "modelos", "verificacao"},
        )
        self.assertEqual(self.config["warren"], {"prepararAutomatico": True})
        self.assertEqual(self.config["limiteParalelo"], 3)
        self.assertEqual(self.config["branchPadrao"], "main")
        self.assertIs(self.config["ciObrigatorioNoPlano"], False)

    def test_protegidos(self):
        self.assertEqual(
            self.config["protegidos"],
            [
                "**/migrations/**",
                ".github/**",
                ".warren/**",
                ".claude/**",
                ".fabrica/orquestrador.md",
                ".fabrica/equipes/**",
                ".fabrica/config.json",
                "**/auth/**",
                ".env*",
            ],
        )

    def test_esforco_so_usa_niveis_conhecidos(self):
        for papel, entrada in self.config["modelos"].items():
            self.assertIn(entrada["esforco"], instalar.NIVEIS_DE_ESFORCO, papel)

    def test_papeis_de_raia_do_raias_tem_modelo_ou_alias(self):
        import raias

        for papel in raias.PAPEIS_DE_RAIA:
            self.assertIn(despachante.papel_normalizado(papel), self.config["modelos"], papel)

    def test_agents_md_do_modelo(self):
        linhas = (MODELOS_REAIS / "AGENTS.md").read_text(encoding="utf-8").splitlines()
        texto = "\n".join(linhas)
        self.assertLessEqual(len(linhas), 20)
        self.assertEqual(linhas[0], INICIO)
        self.assertEqual(linhas[-1], FIM)
        self.assertEqual(texto.count(INICIO), 1)
        self.assertEqual(texto.count(FIM), 1)
        for trecho in (
            ".fabrica/PADROES-COMUNS.md",
            ".fabrica/equipes/<papel>.md",
            "seed delimita",
            "git push",
            "main",
            "mergear",
            ".fabrica/equipes/revisor.md",
            "veredito",
            "PR",
            "verificação",
        ):
            self.assertIn(trecho, texto)

    def test_warren_config_do_modelo(self):
        linhas = (MODELOS_REAIS / "warren-config.yaml").read_text(encoding="utf-8").splitlines()
        self.assertTrue(linhas[0].startswith("#"))
        self.assertIn("despachante", linhas[0] + linhas[1])
        ativas = [linha for linha in linhas if linha.strip() and not linha.lstrip().startswith("#")]
        self.assertEqual(ativas, ["defaultBranch: main", "maxCostUsd: 20", "admission:", "  maxConcurrentRuns: 3"])
        self.assertFalse([linha for linha in ativas if linha.startswith("pr") or "autoMerge" in linha])


def fotografia(raiz: pathlib.Path) -> list:
    """Tudo sob `raiz` sem seguir links: caminho, tipo e, para arquivos, o conteúdo; para links, o alvo."""
    itens = []
    for pasta, nomes, arquivos in os.walk(raiz, followlinks=False):
        for nome in nomes + arquivos:
            caminho = pathlib.Path(pasta) / nome
            if caminho.is_symlink():
                itens.append((str(caminho), "link", os.readlink(caminho)))
            elif caminho.is_dir():
                itens.append((str(caminho), "pasta", None))
            else:
                itens.append((str(caminho), "arquivo", caminho.read_bytes()))
    return sorted(itens)


class TestesPastaComLink(Base):
    """A: um diretório que é link simbólico dentro do destino nunca leva a gravação para fora (ou para dentro de outro lugar)."""

    def setUp(self):
        super().setUp()
        self.fora = self.tmp / "fora"
        self.fora.mkdir()

    def preparar(self, relativo: str, alvo=None):
        link = self.destino / relativo
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(self.fora if alvo is None else alvo, target_is_directory=True)

    def exigir_recusa(self, relativo: str):
        antes_destino, antes_fora = fotografia(self.destino), fotografia(self.fora)
        with self.assertRaises(ValueError) as ctx:
            self.instalar()
        self.assertIn(str(self.destino / relativo), str(ctx.exception))
        self.assertEqual(fotografia(self.fora), antes_fora)
        self.assertEqual(list(self.fora.iterdir()), [])
        self.assertEqual(fotografia(self.destino), antes_destino)

    def test_cada_pasta_de_destino_como_link_e_recusada_sem_gravar_nada(self):
        for relativo in (".fabrica", ".warren", ".claude"):
            with self.subTest(relativo=relativo):
                self.preparar(relativo)
                self.exigir_recusa(relativo)
                (self.destino / relativo).unlink()

    def test_equipes_como_link_dentro_de_uma_pasta_real_e_recusada(self):
        self.preparar(".fabrica/equipes")
        self.exigir_recusa(".fabrica/equipes")

    def test_link_para_dentro_do_proprio_destino_tambem_e_recusado(self):
        (self.destino / "outra").mkdir()
        self.preparar(".claude", self.destino / "outra")
        self.exigir_recusa(".claude")
        self.assertEqual(list((self.destino / "outra").iterdir()), [])

    def test_link_quebrado_e_recusado(self):
        self.preparar(".warren", self.tmp / "nao-existe")
        self.exigir_recusa(".warren")
        self.assertFalse((self.tmp / "nao-existe").exists())

    def test_link_de_pasta_com_destino_dado_por_link_continua_valido(self):
        # o próprio destino pode ser um link: só os componentes abaixo dele contam
        atalho = self.tmp / "atalho"
        atalho.symlink_to(self.destino, target_is_directory=True)
        self.assertIn("AGENTS.md", instalar.instalar(atalho, kit=self.kit)["criados"])
        self.assertTrue((self.destino / ".fabrica" / "orquestrador.md").is_file())


class TestesArquivoComLink(Base):
    """B: um arquivo que é link simbólico é recusado com aviso; os demais seguem."""

    def aviso(self, relativo):
        return "%s é link simbólico; não alterado" % relativo

    def test_agents_md_link_para_outro_arquivo_nao_e_alterado(self):
        escrever(self.destino / "CLAUDE.md", "# regras do claude\n")
        (self.destino / "AGENTS.md").symlink_to("CLAUDE.md")
        resultado = self.instalar()
        self.assertEqual(self.ler("CLAUDE.md"), "# regras do claude\n")
        self.assertTrue((self.destino / "AGENTS.md").is_symlink())
        self.assertEqual(os.readlink(self.destino / "AGENTS.md"), "CLAUDE.md")
        self.assertIn(self.aviso("AGENTS.md"), resultado["avisos"])
        self.assertNotIn("AGENTS.md", resultado["criados"] + resultado["atualizados"])
        self.assertIn(".fabrica/orquestrador.md", resultado["criados"])
        self.assertIn(".claude/settings.json", resultado["criados"])

    def test_cada_arquivo_gerenciado_como_link_e_recusado_e_o_alvo_fica_igual(self):
        alvo = escrever(self.tmp / "alvo.txt", "conteudo do alvo\n")
        for relativo in (
            "AGENTS.md",
            ".claude/settings.json",
            ".fabrica/config.json",
            ".warren/config.yaml",
            ".fabrica/orquestrador.md",
            ".fabrica/equipes/qa.md",
            ".fabrica/raias.py",
        ):
            with self.subTest(relativo=relativo):
                shutil.rmtree(self.destino / ".fabrica", ignore_errors=True)
                shutil.rmtree(self.destino / ".warren", ignore_errors=True)
                shutil.rmtree(self.destino / ".claude", ignore_errors=True)
                (self.destino / "AGENTS.md").unlink(missing_ok=True)
                link = self.destino / relativo
                link.parent.mkdir(parents=True, exist_ok=True)
                link.symlink_to(alvo)
                resultado = self.instalar()
                self.assertEqual(alvo.read_text(encoding="utf-8"), "conteudo do alvo\n")
                self.assertTrue(link.is_symlink())
                self.assertEqual(os.readlink(link), str(alvo))
                self.assertEqual(resultado["avisos"].count(self.aviso(relativo)), 1, resultado["avisos"])
                self.assertNotIn(relativo, resultado["criados"] + resultado["atualizados"])
                outros = [r for r in self.esperados_da_instalacao_limpa() if r != relativo]
                for outro in outros:
                    self.assertTrue((self.destino / outro).exists(), outro)

    def test_link_quebrado_nao_cria_o_alvo(self):
        (self.destino / "AGENTS.md").symlink_to(self.tmp / "nao-existe.md")
        resultado = self.instalar()
        self.assertFalse((self.tmp / "nao-existe.md").exists())
        self.assertTrue((self.destino / "AGENTS.md").is_symlink())
        self.assertIn(self.aviso("AGENTS.md"), resultado["avisos"])

    def test_link_de_arquivo_para_uma_pasta_tambem_e_so_aviso(self):
        (self.destino / "AGENTS.md").symlink_to(self.tmp, target_is_directory=True)
        resultado = self.instalar()
        self.assertIn(self.aviso("AGENTS.md"), resultado["avisos"])
        self.assertTrue((self.destino / ".fabrica" / "orquestrador.md").is_file())

    def test_warren_config_link_nao_e_tocado_e_o_aviso_e_o_do_link(self):
        alvo = escrever(self.tmp / "w.yaml", "x: 1\n")
        (self.destino / ".warren").mkdir()
        (self.destino / ".warren" / "config.yaml").symlink_to(alvo)
        resultado = self.instalar()
        self.assertEqual(alvo.read_text(encoding="utf-8"), "x: 1\n")
        self.assertIn(self.aviso(".warren/config.yaml"), resultado["avisos"])

    def test_segunda_execucao_continua_sem_criar_nem_atualizar(self):
        escrever(self.destino / "CLAUDE.md", "# c\n")
        (self.destino / "AGENTS.md").symlink_to("CLAUDE.md")
        self.instalar()
        segunda = self.instalar()
        self.assertEqual((segunda["criados"], segunda["atualizados"]), ([], []))


class TestesTiposDeDestino(Base):
    """C: tipos errados nos caminhos de destino são ValueError antes de gravar qualquer coisa."""

    def exigir_recusa(self, relativo: str):
        antes = fotografia(self.destino)
        with self.assertRaises(ValueError) as ctx:
            self.instalar()
        self.assertIn(str(self.destino / relativo), str(ctx.exception))
        self.assertEqual(fotografia(self.destino), antes)

    def test_pasta_esperada_que_e_arquivo(self):
        for relativo in (".fabrica", ".warren", ".claude"):
            with self.subTest(relativo=relativo):
                escrever(self.destino / relativo, "sou um arquivo\n")
                self.exigir_recusa(relativo)
                (self.destino / relativo).unlink()

    def test_equipes_que_e_arquivo(self):
        escrever(self.destino / ".fabrica" / "equipes", "sou um arquivo\n")
        self.exigir_recusa(".fabrica/equipes")

    def test_arquivo_esperado_que_e_pasta(self):
        for relativo in (
            "AGENTS.md",
            ".fabrica/config.json",
            ".warren/config.yaml",
            ".claude/settings.json",
            ".fabrica/raias.py",
            ".fabrica/equipes/qa.md",
        ):
            with self.subTest(relativo=relativo):
                shutil.rmtree(self.destino / ".fabrica", ignore_errors=True)
                shutil.rmtree(self.destino / ".warren", ignore_errors=True)
                shutil.rmtree(self.destino / ".claude", ignore_errors=True)
                shutil.rmtree(self.destino / "AGENTS.md", ignore_errors=True)
                (self.destino / relativo).mkdir(parents=True)
                self.exigir_recusa(relativo)

    def test_pastas_e_arquivos_corretos_continuam_aceitos(self):
        (self.destino / ".fabrica" / "equipes").mkdir(parents=True)
        (self.destino / ".claude").mkdir()
        escrever(self.destino / "AGENTS.md", "# meu\n")
        self.assertIn(".fabrica/orquestrador.md", self.instalar()["criados"])


class TestesCliComOserror(Base):
    def test_oserror_sai_com_2_e_mensagem_curta_sem_traceback(self):
        saida, erro = io.StringIO(), io.StringIO()
        falha = PermissionError(13, "Permission denied", "/projeto/.fabrica")
        with mock.patch.object(instalar, "instalar", side_effect=falha):
            codigo = instalar.main([str(self.destino), "--kit", str(self.kit)], saida=saida, erro=erro)
        self.assertEqual(codigo, 2)
        self.assertEqual(saida.getvalue(), "")
        self.assertIn("Permission denied", erro.getvalue())
        self.assertIn("/projeto/.fabrica", erro.getvalue())
        self.assertNotIn("Traceback", erro.getvalue())
        self.assertEqual(len(erro.getvalue().splitlines()), 1)

    @unittest.skipIf(os.geteuid() == 0, "root ignora permissões")
    def test_destino_sem_permissao_de_escrita_sai_com_2(self):
        self.destino.chmod(0o555)
        self.addCleanup(self.destino.chmod, 0o755)
        proc = subprocess.run(
            [sys.executable, "-I", "-B", str(RAIZ / "instalar.py"), str(self.destino), "--kit", str(self.kit)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 2)
        self.assertNotIn("Traceback", proc.stderr)
        self.assertIn("Permission denied", proc.stderr)


class TestesCli(Base):
    def executar(self, *argumentos):
        saida, erro = io.StringIO(), io.StringIO()
        codigo = instalar.main(list(argumentos), saida=saida, erro=erro)
        return codigo, saida.getvalue(), erro.getvalue()

    def test_sucesso_imprime_resumo_e_sai_com_zero(self):
        escrever(self.destino / ".warren" / "config.yaml", "x: 1\n")
        codigo, saida, erro = self.executar(str(self.destino), "--kit", str(self.kit))
        self.assertEqual((codigo, erro), (0, ""))
        self.assertIn(".fabrica/orquestrador.md", saida)
        self.assertIn("AGENTS.md", saida)
        self.assertIn(AVISO_WARREN, saida)
        self.assertIn("criados", saida)

    def test_segunda_execucao_mostra_nada_a_fazer(self):
        self.executar(str(self.destino), "--kit", str(self.kit))
        codigo, saida, _ = self.executar(str(self.destino), "--kit", str(self.kit))
        self.assertEqual(codigo, 0)
        self.assertNotIn(".fabrica/orquestrador.md", saida)

    def test_value_error_sai_com_2_e_a_mensagem_no_erro(self):
        outro = self.tmp / "sem-nada"
        outro.mkdir()
        codigo, saida, erro = self.executar(str(outro), "--kit", str(self.kit))
        self.assertEqual(codigo, 2)
        self.assertEqual(saida, "")
        self.assertIn("sem CI: crie .github/workflows antes", erro)

    def test_kit_padrao_e_a_raiz_do_repositorio_do_script(self):
        self.assertEqual(instalar.KIT_PADRAO, RAIZ_DO_REPO)
        self.assertTrue((instalar.KIT_PADRAO / "fabrica" / "scripts" / "instalar.py").is_file())

    def test_sem_destino_e_erro_de_uso_do_argparse(self):
        with self.assertRaises(SystemExit) as ctx:
            instalar.main([], saida=io.StringIO(), erro=io.StringIO())
        self.assertEqual(ctx.exception.code, 2)

    def test_processo_real_com_python_dash_i(self):
        proc = subprocess.run(
            [sys.executable, "-I", "-B", str(RAIZ / "instalar.py"), str(self.destino), "--kit", str(self.kit)],
            capture_output=True,
            text=True,
            cwd=self.tmp,
        )
        self.assertEqual((proc.returncode, proc.stderr), (0, ""))
        self.assertTrue((self.destino / ".fabrica" / "orquestrador.md").is_file())
        proc = subprocess.run(
            [sys.executable, "-I", "-B", str(RAIZ / "instalar.py"), str(self.tmp / "nao-existe"), "--kit", str(self.kit)],
            capture_output=True,
            text=True,
            cwd=self.tmp,
        )
        self.assertEqual(proc.returncode, 2)
        self.assertIn("nao-existe", proc.stderr)
        self.assertNotIn("Traceback", proc.stderr)


if __name__ == "__main__":
    unittest.main()
