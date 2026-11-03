import contextlib
import io
import json
import os
import pathlib
import shutil
import sys
import tempfile
import unittest

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

import capacidade  # noqa: E402
import instalar_maquina  # noqa: E402

SERVICOS_REAIS = RAIZ.parent / "servico"
UNITS = ("fabrica-fila.service", "fabrica-plano@.service")
URL_PADRAO = "https://github.com/PauloRhyanK/KusterTech-Flow.git"
TOKEN_WARREN = "segredo-do-warren-123"
TOKEN_GH = "segredo-do-github-456"


class Executor:
    """`executar` falso: grava cada argv e responde por prefixo; o clone cria o kit com as units reais."""

    def __init__(self, home, *, grupos="devops docker", sudo=0, linger=0, falhas=None):
        self.home = pathlib.Path(home)
        self.chamadas = []
        self.grupos = grupos
        self.sudo = sudo
        self.linger = linger
        self.falhas = falhas or {}

    def __call__(self, argv):
        argv = list(argv)
        self.chamadas.append(argv)
        for prefixo, resposta in self.falhas.items():
            if argv[: len(prefixo)] == list(prefixo):
                return resposta
        if argv[:2] == ["git", "clone"]:
            copiar_units(pathlib.Path(argv[-1]))
            (pathlib.Path(argv[-1]) / ".git").mkdir()
            return 0, ""
        if argv == ["id", "-nG"]:
            return 0, self.grupos + "\n"
        if argv == ["id", "-un"]:
            return 0, "devops\n"
        if argv == ["sudo", "-n", "true"]:
            return self.sudo, ""
        if argv[:4] == ["sudo", "-n", "loginctl", "enable-linger"]:
            return self.linger, ""
        return 0, ""

    def comandos(self):
        return [" ".join(c) for c in self.chamadas]


def copiar_units(kit):
    destino = pathlib.Path(kit) / "fabrica" / "servico"
    destino.mkdir(parents=True, exist_ok=True)
    for unit in UNITS:
        shutil.copyfile(SERVICOS_REAIS / unit, destino / unit)


class Http:
    """`http` falso: devolve (status, corpo) por caminho e guarda os tokens recebidos."""

    def __init__(self, *, health=(200, "ok"), versao=(200, json.dumps({"version": "0.19.3"})), erro=None):
        self.health = health
        self.versao = versao
        self.erro = erro
        self.chamadas = []

    def __call__(self, url, token):
        self.chamadas.append((url, token))
        if self.erro:
            raise self.erro
        return self.versao if url.endswith("/version") else self.health


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = pathlib.Path(self.tmp.name)
        self.fabrica = self.home / "fabrica"
        self.kit = self.fabrica / "kit"
        self.unidades = self.home / ".config" / "systemd" / "user"
        self.escrever_tokens()

    def escrever_tokens(self):
        for nome, valor in ((".warren-token", TOKEN_WARREN), (".warren-gh-token", TOKEN_GH)):
            (self.home / nome).write_text(valor + "\n", encoding="utf-8")

    def preparar_kit_existente(self):
        (self.kit / ".git").mkdir(parents=True)
        copiar_units(self.kit)

    def rodar(self, argv=(), executor=None, http=None):
        executor = executor or Executor(self.home)
        http = http or Http()
        saida, erro = io.StringIO(), io.StringIO()
        codigo = instalar_maquina.main(
            list(argv), executar=executor, home=self.home, http=http, saida=saida, erro=erro
        )
        self.executor, self.http, self.saida, self.erro = executor, http, saida.getvalue(), erro.getvalue()
        return codigo


class TestesInstalacao(Base):
    def test_primeira_instalacao_clona_e_liga_a_fila(self):
        self.assertEqual(self.rodar(), 0, self.erro)
        comandos = self.executor.comandos()
        self.assertEqual(comandos[0], "git clone --branch main %s %s" % (URL_PADRAO, self.kit))
        for unit in UNITS:
            self.assertEqual(
                (self.unidades / unit).read_bytes(), (SERVICOS_REAIS / unit).read_bytes(), unit
            )
        self.assertTrue((self.fabrica / "planos").is_dir())
        self.assertEqual(json.loads((self.fabrica / "fila.json").read_text()), {"repos": []})
        dados = json.loads((self.fabrica / "capacidade.json").read_text())
        self.assertEqual((dados["vagasConfig"], dados["ramMinimaMb"]), (3, 2048))

    def test_ordem_dos_comandos(self):
        self.assertEqual(self.rodar(), 0, self.erro)
        comandos = self.executor.comandos()
        esperado = [
            "git clone --branch main %s %s" % (URL_PADRAO, self.kit),
            "systemctl --user daemon-reload",
            "id -un",
            "sudo -n loginctl enable-linger devops",
            "id -nG",
            "sudo -n true",
            "systemctl --user enable --now fabrica-fila",
        ]
        self.assertEqual(comandos, esperado)

    def test_atualiza_o_kit_existente_no_branch_indicado(self):
        self.preparar_kit_existente()
        self.assertEqual(self.rodar(["--branch", "feat/fila", "--kit-url", "https://exemplo/k.git"]), 0, self.erro)
        comandos = self.executor.comandos()
        kit = str(self.kit)
        self.assertEqual(
            comandos[:3],
            [
                "git -C %s fetch origin" % kit,
                "git -C %s checkout feat/fila" % kit,
                "git -C %s reset --hard origin/feat/fila" % kit,
            ],
        )
        self.assertFalse(any(c.startswith("git clone") for c in comandos))

    def test_kit_url_nova_so_vale_no_clone(self):
        self.assertEqual(self.rodar(["--kit-url", "https://exemplo/k.git"]), 0, self.erro)
        self.assertEqual(self.executor.comandos()[0], "git clone --branch main https://exemplo/k.git %s" % self.kit)

    def test_checa_o_warren_com_o_token_sem_expo_lo(self):
        self.assertEqual(self.rodar(), 0, self.erro)
        self.assertEqual(
            self.http.chamadas,
            [("http://127.0.0.1:8080/health", TOKEN_WARREN), ("http://127.0.0.1:8080/version", TOKEN_WARREN)],
        )
        for texto in (self.saida, self.erro, "\n".join(self.executor.comandos())):
            self.assertNotIn(TOKEN_WARREN, texto)
            self.assertNotIn(TOKEN_GH, texto)

    def test_reexecucao_e_idempotente(self):
        self.assertEqual(self.rodar(), 0, self.erro)
        (self.fabrica / "fila.json").write_text(json.dumps({"repos": ["a/b"]}), encoding="utf-8")
        capacidade.configurar(self.fabrica / "capacidade.json", vagas=5, ram_minima_mb=4096)
        fila_antes = (self.fabrica / "fila.json").read_bytes()
        cap_antes = (self.fabrica / "capacidade.json").read_bytes()
        unit_antes = (self.unidades / UNITS[0]).stat().st_mtime_ns
        self.assertEqual(self.rodar(), 0, self.erro)
        self.assertEqual((self.fabrica / "fila.json").read_bytes(), fila_antes)
        self.assertEqual((self.fabrica / "capacidade.json").read_bytes(), cap_antes)
        self.assertEqual((self.unidades / UNITS[0]).stat().st_mtime_ns, unit_antes)
        self.assertIn("git -C %s fetch origin" % self.kit, self.executor.comandos())

    def test_nao_sobrescreve_arquivos_existentes_mesmo_ilegiveis(self):
        self.fabrica.mkdir(parents=True)
        (self.fabrica / "fila.json").write_text("lixo", encoding="utf-8")
        (self.fabrica / "capacidade.json").write_text("{}", encoding="utf-8")
        self.assertEqual(self.rodar(), 0, self.erro)
        self.assertEqual((self.fabrica / "fila.json").read_text(), "lixo")
        self.assertEqual((self.fabrica / "capacidade.json").read_text(), "{}")

    def test_unit_desatualizada_e_substituida(self):
        self.preparar_kit_existente()
        self.unidades.mkdir(parents=True)
        (self.unidades / UNITS[0]).write_text("antiga", encoding="utf-8")
        self.assertEqual(self.rodar(), 0, self.erro)
        self.assertEqual((self.unidades / UNITS[0]).read_bytes(), (SERVICOS_REAIS / UNITS[0]).read_bytes())


class TestesRequisitos(Base):
    def test_falta_de_requisitos_sai_com_2_e_lista_tudo(self):
        executor = Executor(self.home, grupos="devops", sudo=1)
        (self.home / ".warren-token").unlink()
        (self.home / ".warren-gh-token").unlink()
        codigo = self.rodar(executor=executor)
        self.assertEqual(codigo, 2)
        linhas = [l for l in self.erro.splitlines() if l.startswith("- ")]
        texto = "\n".join(linhas)
        self.assertIn("docker", texto)
        self.assertIn("sudo", texto)
        self.assertIn(str(self.home / ".warren-token"), texto)
        self.assertIn(str(self.home / ".warren-gh-token"), texto)
        self.assertGreaterEqual(len(linhas), 4)
        self.assertNotIn("systemctl --user enable --now fabrica-fila", executor.comandos())

    def test_warren_fora_do_ar(self):
        self.assertEqual(self.rodar(http=Http(erro=OSError("recusou"))), 2)
        self.assertIn("Warren", self.erro)
        self.assertIn("http://127.0.0.1:8080/health", self.erro)
        self.assertNotIn("systemctl --user enable --now fabrica-fila", self.executor.comandos())

    def test_health_com_status_de_erro(self):
        self.assertEqual(self.rodar(http=Http(health=(503, "x"))), 2)
        self.assertIn("/health", self.erro)

    def test_versao_errada(self):
        http = Http(versao=(200, json.dumps({"version": "0.20.0"})))
        self.assertEqual(self.rodar(http=http), 2)
        self.assertIn("0.20.0", self.erro)
        self.assertIn("0.19.3", self.erro)

    def test_versao_sem_json(self):
        self.assertEqual(self.rodar(http=Http(versao=(200, "<html>"))), 2)
        self.assertIn("/version", self.erro)

    def test_token_vazio_conta_como_ilegivel(self):
        (self.home / ".warren-gh-token").write_text("\n", encoding="utf-8")
        self.assertEqual(self.rodar(), 2)
        self.assertIn(str(self.home / ".warren-gh-token"), self.erro)

    def test_sem_token_do_warren_nao_chama_o_warren(self):
        (self.home / ".warren-token").unlink()
        http = Http()
        self.assertEqual(self.rodar(http=http), 2)
        self.assertEqual(http.chamadas, [])

    def test_linger_que_falha_entra_na_lista(self):
        self.assertEqual(self.rodar(executor=Executor(self.home, linger=1)), 2)
        self.assertIn("linger", self.erro)

    def test_requisitos_faltando_ainda_deixam_o_kit_e_as_units_instalados(self):
        self.assertEqual(self.rodar(executor=Executor(self.home, grupos="devops")), 2)
        self.assertTrue((self.unidades / UNITS[0]).is_file())
        self.assertTrue((self.fabrica / "fila.json").is_file())

    def test_mensagens_nao_vazam_token(self):
        self.assertEqual(self.rodar(http=Http(erro=OSError("falhou com " + TOKEN_WARREN))), 2)
        self.assertNotIn(TOKEN_WARREN, self.erro + self.saida)


class TestesErros(Base):
    def test_falha_do_git_sai_com_1_sem_traceback(self):
        executor = Executor(self.home, falhas={("git", "clone"): (128, "fatal: repositório não encontrado")})
        self.assertEqual(self.rodar(executor=executor), 1)
        self.assertIn("git clone", self.erro)
        self.assertIn("repositório não encontrado", self.erro)
        self.assertNotIn("Traceback", self.erro)

    def test_falha_do_daemon_reload_sai_com_1(self):
        executor = Executor(self.home, falhas={("systemctl", "--user", "daemon-reload"): (1, "sem barramento")})
        self.assertEqual(self.rodar(executor=executor), 1)
        self.assertIn("daemon-reload", self.erro)

    def test_falha_ao_ligar_a_fila_sai_com_1(self):
        falhas = {("systemctl", "--user", "enable"): (1, "unit não encontrada")}
        self.assertEqual(self.rodar(executor=Executor(self.home, falhas=falhas)), 1)
        self.assertIn("fabrica-fila", self.erro)

    def test_unit_ausente_no_kit_sai_com_1(self):
        self.preparar_kit_existente()
        (self.kit / "fabrica" / "servico" / UNITS[1]).unlink()
        self.assertEqual(self.rodar(), 1)
        self.assertIn(UNITS[1], self.erro)
        self.assertNotIn("Traceback", self.erro)

    def test_erro_inesperado_sai_com_1_sem_traceback(self):
        def quebra(argv):
            raise RuntimeError("estourou")

        saida, erro = io.StringIO(), io.StringIO()
        codigo = instalar_maquina.main([], executar=quebra, home=self.home, http=Http(), saida=saida, erro=erro)
        self.assertEqual(codigo, 1)
        self.assertIn("estourou", erro.getvalue())
        self.assertNotIn("Traceback", erro.getvalue())

    def test_argumento_invalido_sai_com_2(self):
        with self.assertRaises(SystemExit) as contexto, contextlib.redirect_stderr(io.StringIO()):
            instalar_maquina.main(["--nada"], executar=Executor(self.home), home=self.home, http=Http())
        self.assertEqual(contexto.exception.code, 2)


class TestesTransportes(unittest.TestCase):
    def test_executar_real_devolve_codigo_e_saida(self):
        codigo, saida = instalar_maquina.executar_real([sys.executable, "-c", "print('oi')"])
        self.assertEqual((codigo, saida.strip()), (0, "oi"))

    def test_executar_real_com_programa_inexistente(self):
        codigo, saida = instalar_maquina.executar_real(["programa-que-nao-existe-fabrica"])
        self.assertEqual(codigo, 127)
        self.assertTrue(saida)


if __name__ == "__main__":
    unittest.main()
