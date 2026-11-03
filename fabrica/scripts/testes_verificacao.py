import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

import verificacao  # noqa: E402
from testes_exportar import (  # noqa: E402
    OID_A,
    OID_B,
    OID_C,
    cat_file_saida,
    git,
    ls_tree_saida,
    proc_bytes,
)

SHA = "a" * 40

ID = "0123456789ab"
IMAGEM = "alpine:3.20"
ORIGINAL_USUARIO = verificacao._usuario
CONTEINER = {"imagem": IMAGEM}
ARVORE_LS = ls_tree_saida(
    (b"100644", "a.txt", OID_A), (b"100755", "sub/run.sh", OID_B), (b"120000", "lnk", OID_C)
)
ARVORE_CAT = cat_file_saida((OID_A, b"a"), (OID_B, b"#!/bin/sh\n"), (OID_C, b"a.txt"))
ROTULOS = ["--label", "fabrica.verif=1", "--label", "fabrica.verif.id=" + ID]
GIT_OPCOES = [
    "git",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.attributesFile=/dev/null",
]


def proc(codigo=0, saida="", erro=""):
    return types.SimpleNamespace(returncode=codigo, stdout=saida, stderr=erro)


class PopenFalso:
    """Faz as vezes de `subprocess.Popen` para `_rodar_limitado`: a saída sai de um arquivo temporário."""

    def __init__(self, codigo, dados: bytes):
        self.returncode = codigo
        self.stdout = tempfile.TemporaryFile()
        self.stdout.write(dados)
        self.stdout.seek(0)

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        pass


class DockerFalso:
    """Executor falso: classifica cada chamada, grava e responde (sucesso por padrão).

    `popen` é o `subprocess.Popen` falso do docker run principal: grava a chamada na mesma lista
    (e em `via_popen`) e devolve a resposta configurada como saída combinada.
    """

    def __init__(self, ls=ARVORE_LS, cat=ARVORE_CAT):
        self.chamadas = []
        self.via_popen = []
        self.respostas = {}
        self.ls = ls
        self.cat = cat

    @staticmethod
    def tipo(argv):
        if argv[0] == "git":
            return argv[len(GIT_OPCOES)]
        assert argv[0] == "docker", argv
        if argv[1] == "network":
            return "rede-" + {"create": "create", "rm": "rm", "ls": "ls"}[argv[2]]
        if argv[1] == "run":
            return "servico" if "-d" in argv else "principal"
        return argv[1]  # kill, rm

    def __call__(self, argv, **kwargs):
        self.chamadas.append((list(argv), dict(kwargs)))
        tipo = self.tipo(argv)
        resposta = self.respostas.get(tipo)
        if isinstance(resposta, list):
            resposta = resposta.pop(0)
        if isinstance(resposta, BaseException):
            raise resposta
        if callable(resposta):
            return resposta(argv, **kwargs)
        if resposta is not None:
            return resposta
        if tipo == "ls-tree":
            return proc_bytes(self.ls)
        if tipo == "cat-file":
            return proc_bytes(self.cat)
        return proc()

    def popen(self, argv, **kwargs):
        self.via_popen.append(list(argv))
        resposta = self(argv, **kwargs)
        dados = (verificacao._texto(resposta.stdout) + verificacao._texto(resposta.stderr)).encode()
        return PopenFalso(resposta.returncode, dados)

    def tipos(self):
        return [self.tipo(argv) for argv, _ in self.chamadas]

    def argv(self, tipo, indice=0):
        return [a for a, _ in self.chamadas if self.tipo(a) == tipo][indice]

    def kwargs(self, tipo, indice=0):
        return [k for a, k in self.chamadas if self.tipo(a) == tipo][indice]


def src_do_principal(fake):
    argv = fake.argv("principal")
    return pathlib.Path(argv[argv.index("-v") + 1].split(":")[0])


class TestesVerificarComFalso(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.dir, ignore_errors=True))
        # tempdir próprio: nada de olhar o /tmp global, que outros processos também usam.
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        for alvo, valor in (
            (verificacao.secrets, {"token_hex": mock.Mock(return_value=ID)}),
            (verificacao, {"_usuario": mock.Mock(return_value="1234:5678")}),
            (tempfile, {"tempdir": str(self.tmp)}),
        ):
            for nome, novo in valor.items():
                patcher = mock.patch.object(alvo, nome, novo)
                patcher.start()
                self.addCleanup(patcher.stop)

    def verificar(self, fake=None, comando="make test", conteiner=None, **kw):
        fake = fake or DockerFalso()
        kw.setdefault("popen", fake.popen)
        r = verificacao.verificar(
            self.dir, SHA, comando, conteiner=CONTEINER if conteiner is None else conteiner, executar=fake, **kw
        )
        return r, fake

    def bases_restantes(self):
        """Diretórios `fabrica-verif-*` que sobraram no tempdir deste teste."""
        return sorted(p.name for p in self.tmp.glob("fabrica-verif-*"))

    # Sequência exata

    def test_sequencia_exata_de_chamadas_e_argumentos(self):
        r, fake = self.verificar(fake=DockerFalso(), comando="pnpm test")
        self.assertEqual(r, {"sha": SHA, "codigo": 0, "saida": ""})
        self.assertEqual(
            fake.tipos(),
            ["fetch", "ls-tree", "cat-file", "rede-create", "principal", "rm", "rede-rm"],
        )
        src = src_do_principal(fake)
        self.assertEqual(fake.argv("fetch"), GIT_OPCOES + ["fetch", "--quiet", "origin"])
        self.assertEqual(fake.argv("rede-create"), ["docker", "network", "create"] + ROTULOS + ["fabrica-verif-" + ID])
        self.assertEqual(
            fake.argv("principal"),
            [
                "docker", "run", "--rm", "--init", "--name", "fabrica-verif-" + ID,
                "--label", "fabrica.verif=1", "--label", "fabrica.verif.id=" + ID,
                "--network", "fabrica-verif-" + ID, "--user", "1234:5678",
                "--add-host", "host.docker.internal:127.0.0.1",
                "--add-host", "gateway.docker.internal:127.0.0.1",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--pids-limit", "512", "--memory", "3g", "--cpus", "2",
                "--tmpfs", "/tmp:rw,exec",
                "-e", "CI=1", "-e", "HOME=/tmp/home", "-e", "LANG=C.UTF-8",
                "-v", "%s:/w" % src, "-w", "/w", IMAGEM, "bash", "-lc",
                'mkdir -p "$HOME" && pnpm test',
            ],
        )  # fmt: skip
        self.assertEqual(fake.argv("rm"), ["docker", "rm", "-f", "-v", "fabrica-verif-" + ID])
        self.assertEqual(fake.argv("rede-rm"), ["docker", "network", "rm", "fabrica-verif-" + ID])
        self.assertEqual(src.name, "src")
        self.assertTrue(src.parent.name.startswith("fabrica-verif-"))
        self.assertFalse(src.parent.exists())

    def test_so_lista_de_argumentos_nunca_shell(self):
        _, fake = self.verificar(comando="echo '$(rm -rf /)'; `x`")
        for argv, kwargs in fake.chamadas:
            self.assertIsInstance(argv, list)
            self.assertFalse(kwargs.get("shell", False))
        self.assertEqual(fake.argv("principal")[-1], 'mkdir -p "$HOME" && echo \'$(rm -rf /)\'; `x`')

    def test_flags_de_isolamento_e_um_unico_volume_so_do_src(self):
        r, fake = self.verificar()
        argv = fake.argv("principal")
        for flag in ("--init", "--rm"):
            self.assertIn(flag, argv)
        self.assertEqual(argv[argv.index("--cap-drop") + 1], "ALL")
        self.assertEqual(argv[argv.index("--security-opt") + 1], "no-new-privileges")
        self.assertEqual(argv[argv.index("--pids-limit") + 1], "512")
        self.assertEqual(argv[argv.index("--network") + 1], "fabrica-verif-" + ID)
        volumes = [argv[i + 1] for i, a in enumerate(argv) if a == "-v"]
        src = src_do_principal(fake)
        self.assertEqual(volumes, ["%s:/w" % src])
        self.assertNotIn("--privileged", argv)
        self.assertNotIn(str(self.dir), " ".join(" ".join(a) for a, _ in fake.chamadas if a[0] == "docker"))
        self.assertNotIn("/var/run/docker.sock", " ".join(argv))
        self.assertNotIn("--pid", argv)
        self.assertNotIn("--net=host", argv)

    def test_limites_configuraveis_e_shell_sh(self):
        cfg = {"imagem": "node:20-alpine", "memoria": "512m", "cpus": "1.5", "pids": 64, "shell": "sh"}
        _, fake = self.verificar(conteiner=cfg, comando="npm test")
        argv = fake.argv("principal")
        self.assertEqual(argv[argv.index("--memory") + 1], "512m")
        self.assertEqual(argv[argv.index("--cpus") + 1], "1.5")
        self.assertEqual(argv[argv.index("--pids-limit") + 1], "64")
        self.assertEqual(argv[-4:], ["node:20-alpine", "sh", "-lc", 'mkdir -p "$HOME" && npm test'])

    def test_container_nao_recebe_nenhuma_variavel_do_pai(self):
        sujo = {
            "GH_TOKEN": "ghp_valor_secreto",
            "GITHUB_TOKEN": "ghp_outro",
            "WARREN_TOKEN_FILE": "/segredo/w",
            "ANTHROPIC_API_KEY": "sk-segredo",
            "AWS_SECRET_ACCESS_KEY": "aws-segredo",
            "HOME": "/home/real",
            "PATH": "/usr/bin:/bin",
        }
        with mock.patch.dict(os.environ, sujo):
            _, fake = self.verificar(conteiner={"imagem": IMAGEM, "env": {"MODO": "teste"}})
        argv = fake.argv("principal")
        pares = [argv[i + 1] for i, a in enumerate(argv) if a == "-e"]
        self.assertEqual(pares, ["CI=1", "HOME=/tmp/home", "LANG=C.UTF-8", "MODO=teste"])
        todos = " ".join(" ".join(a) for a, _ in fake.chamadas if a[0] == "docker")
        for nome, valor in sujo.items():
            if nome in ("PATH", "HOME"):
                continue
            self.assertNotIn(nome, todos)
            self.assertNotIn(valor, todos)
        self.assertNotIn("/home/real", todos)

    def test_docker_roda_com_o_ambiente_do_pai_e_git_com_o_ambiente_endurecido(self):
        _, fake = self.verificar()
        for argv, kwargs in fake.chamadas:
            if argv[0] == "docker":
                self.assertNotIn("env", kwargs)
                self.assertNotIn("cwd", kwargs)
            else:
                self.assertEqual(kwargs["cwd"], self.dir)
                self.assertEqual(kwargs["env"]["GIT_NO_REPLACE_OBJECTS"], "1")
                self.assertEqual(kwargs["env"]["GIT_ATTR_NOSYSTEM"], "1")
                self.assertEqual(kwargs["env"]["GIT_CONFIG_NOSYSTEM"], "1")
                self.assertEqual(kwargs["env"]["GIT_TERMINAL_PROMPT"], "0")

    def test_todo_comando_tem_timeout(self):
        # O principal vai pelo `_rodar_limitado`, que recebe o timeout; os outros, pelo `executar`.
        with mock.patch.object(verificacao, "_rodar_limitado", wraps=verificacao._rodar_limitado) as limitado:
            _, fake = self.verificar(timeout_s=42)
        for argv, kwargs in fake.chamadas:
            if argv not in fake.via_popen:
                self.assertIsInstance(kwargs["timeout"], int, argv)
        self.assertEqual(limitado.call_args.args[1], 42)
        with mock.patch.object(verificacao, "_rodar_limitado", wraps=verificacao._rodar_limitado) as limitado:
            _, fake = self.verificar()
        self.assertEqual(limitado.call_args.args[1], 1800)
        self.assertNotEqual(fake.kwargs("fetch")["timeout"], 1800)

    def test_arquivos_do_commit_chegam_no_src_com_modos_corretos(self):
        vistos = {}

        def principal(argv, **kwargs):
            src = pathlib.Path(argv[argv.index("-v") + 1].split(":")[0])
            vistos["itens"] = sorted(str(p.relative_to(src)) for p in src.rglob("*"))
            vistos["a"] = (src / "a.txt").read_text()
            vistos["modo_a"] = os.stat(src / "a.txt").st_mode & 0o777
            vistos["modo_run"] = os.stat(src / "sub" / "run.sh").st_mode & 0o777
            vistos["link"] = os.readlink(src / "lnk")
            vistos["modo_base"] = os.stat(src.parent).st_mode & 0o777
            vistos["git"] = (src / ".git").exists()
            return proc(0, "ok")

        fake = DockerFalso()
        fake.respostas["principal"] = principal
        self.verificar(fake=fake)
        self.assertEqual(vistos["itens"], ["a.txt", "lnk", "sub", "sub/run.sh"])
        self.assertEqual((vistos["a"], vistos["modo_a"], vistos["modo_run"]), ("a", 0o644, 0o755))
        self.assertEqual(vistos["link"], "a.txt")
        self.assertEqual(vistos["modo_base"], 0o700)
        self.assertFalse(vistos["git"])

    def test_diretorios_distintos_a_cada_chamada(self):
        srcs = []
        for ident in ("aaaaaaaaaaaa", "bbbbbbbbbbbb"):
            with mock.patch.object(verificacao.secrets, "token_hex", return_value=ident):
                _, fake = self.verificar()
            srcs.append(src_do_principal(fake))
            self.assertIn("fabrica-verif-" + ident, fake.argv("principal"))
        self.assertNotEqual(srcs[0], srcs[1])

    # Serviços

    def test_servicos_sobem_antes_do_principal_na_mesma_rede_e_sao_removidos(self):
        cfg = {
            "imagem": IMAGEM,
            "env": {"DATABASE_URL": "postgres://db/teste"},
            "servicos": [
                {"nome": "db", "imagem": "postgres:16", "env": {"POSTGRES_PASSWORD": "teste", "POSTGRES_DB": "t"}},
                {"nome": "cache", "imagem": "redis:7"},
            ],
        }
        _, fake = self.verificar(conteiner=cfg)
        self.assertEqual(
            fake.tipos(),
            ["fetch", "ls-tree", "cat-file", "rede-create", "servico", "servico", "principal", "rm", "rm", "rm", "rede-rm"],
        )
        self.assertEqual(
            fake.argv("servico", 0),
            [
                "docker", "run", "-d", "--rm", "--name", "fabrica-verif-%s-db" % ID,
                "--label", "fabrica.verif=1", "--label", "fabrica.verif.id=" + ID,
                "--network", "fabrica-verif-" + ID, "--network-alias", "db",
                "--pids-limit", "512", "--memory", "3g",
                "-e", "POSTGRES_PASSWORD=teste", "-e", "POSTGRES_DB=t", "postgres:16",
            ],
        )  # fmt: skip
        self.assertEqual(
            fake.argv("servico", 1),
            [
                "docker", "run", "-d", "--rm", "--name", "fabrica-verif-%s-cache" % ID,
                "--label", "fabrica.verif=1", "--label", "fabrica.verif.id=" + ID,
                "--network", "fabrica-verif-" + ID, "--network-alias", "cache",
                "--pids-limit", "512", "--memory", "3g", "redis:7",
            ],
        )  # fmt: skip
        argv = fake.argv("principal")
        self.assertIn("DATABASE_URL=postgres://db/teste", argv)
        self.assertNotIn("POSTGRES_PASSWORD=teste", argv)
        removidos = [fake.argv("rm", i)[-1] for i in range(3)]
        for i in range(3):
            # `-v`: os volumes anônimos de imagens com VOLUME (o Postgres) saem junto com o contêiner.
            self.assertEqual(fake.argv("rm", i)[:4], ["docker", "rm", "-f", "-v"])
            self.assertEqual(len(fake.argv("rm", i)), 5)
        self.assertEqual(
            sorted(removidos),
            sorted(["fabrica-verif-" + ID, "fabrica-verif-%s-db" % ID, "fabrica-verif-%s-cache" % ID]),
        )

    def test_servico_que_falha_ao_subir_aborta_e_limpa(self):
        cfg = {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "postgres:16"}, {"nome": "x", "imagem": "y"}]}
        fake = DockerFalso()
        fake.respostas["servico"] = [proc(125, "", "pull access denied")]
        r, fake = self.verificar(fake=fake, conteiner=cfg)
        self.assertEqual(r["codigo"], 125)
        self.assertIn("serviço db", r["saida"])
        self.assertIn("pull access denied", r["saida"])
        self.assertNotIn("principal", fake.tipos())
        self.assertEqual(fake.tipos().count("servico"), 1)
        self.assertIn("rede-rm", fake.tipos())
        self.assertIn("fabrica-verif-%s-db" % ID, [fake.argv("rm", i)[-1] for i in range(fake.tipos().count("rm"))])

    # Timeout, saída e avisos

    def test_timeout_mata_o_conteiner_e_da_124(self):
        fake = DockerFalso()
        fake.respostas["principal"] = subprocess.TimeoutExpired(["docker"], 5, output="parcial-out ", stderr="parcial-err")
        r, fake = self.verificar(fake=fake, timeout_s=5)
        self.assertEqual(r["codigo"], 124)
        self.assertEqual(r["sha"], SHA)
        self.assertEqual(fake.argv("kill"), ["docker", "kill", "fabrica-verif-" + ID])
        self.assertLess(fake.tipos().index("principal"), fake.tipos().index("kill"))
        self.assertLess(fake.tipos().index("kill"), fake.tipos().index("rm"))
        self.assertTrue(r["saida"].startswith("[tempo esgotado após 5 s]") or "tempo esgotado após 5 s" in r["saida"][:60])
        self.assertIn("parcial-out parcial-err", r["saida"])
        self.assertIn("rede-rm", fake.tipos())
        self.assertFalse(src_do_principal(fake).parent.exists())

    def test_timeout_com_bytes_e_none(self):
        for out, err in ((b"bytes", b"x"), (None, None), ("t", None)):
            fake = DockerFalso()
            fake.respostas["principal"] = subprocess.TimeoutExpired(["docker"], 5, output=out, stderr=err)
            r, _ = self.verificar(fake=fake, timeout_s=5)
            self.assertEqual(r["codigo"], 124)
            self.assertIsInstance(r["saida"], str)

    def test_aviso_de_timeout_fica_no_inicio_mesmo_com_saida_enorme_e_total_4000(self):
        fake = DockerFalso()
        fake.respostas["principal"] = subprocess.TimeoutExpired(["docker"], 5, output="o" * 9000, stderr="e" * 9000)
        r, _ = self.verificar(fake=fake, timeout_s=5)
        self.assertEqual(len(r["saida"]), 4000)
        aviso = "tempo esgotado após 5 s"
        self.assertTrue(r["saida"].startswith(aviso) or r["saida"].startswith("[" + aviso), r["saida"][:60])
        self.assertTrue(r["saida"].endswith("e" * 100))
        self.assertNotIn("o" * 100, r["saida"])

    def test_aviso_de_timeout_vem_antes_dos_outros_avisos(self):
        ls = ls_tree_saida((b"160000", "vendor/sub", OID_A), (b"100644", "a.txt", OID_B))
        fake = DockerFalso(ls=ls, cat=cat_file_saida((OID_B, b"a")))
        fake.respostas["principal"] = subprocess.TimeoutExpired(["docker"], 5, output="parcial")
        r, _ = self.verificar(fake=fake, timeout_s=5)
        self.assertEqual(r["codigo"], 124)
        self.assertTrue(r["saida"].startswith("tempo esgotado após 5 s\nsubmódulo ignorado: vendor/sub\n"), r["saida"])
        self.assertTrue(r["saida"].endswith("parcial"))

    def test_avisos_de_limpeza_e_submodulo_tambem_ficam_no_inicio(self):
        ls = ls_tree_saida((b"160000", "vendor/sub", OID_A), (b"100644", "a.txt", OID_B))
        fake = DockerFalso(ls=ls, cat=cat_file_saida((OID_B, b"a")))
        fake.respostas["principal"] = proc(0, "z" * 9000)
        fake.respostas["network"] = None
        fake.respostas["rede-rm"] = proc(1, "", "network has active endpoints")
        r, _ = self.verificar(fake=fake)
        self.assertEqual(len(r["saida"]), 4000)
        self.assertIn("submódulo ignorado: vendor/sub", r["saida"][:200])
        self.assertIn("erro na limpeza: docker network rm", r["saida"][:300])
        self.assertTrue(r["saida"].endswith("z" * 100))

    def test_saida_sem_aviso_e_cortada_nos_ultimos_4000(self):
        casos = [
            (proc(0, "x" * 1000 + "y" * 4000), "y" * 4000),
            (proc(0, "A" * 3000, "B" * 3000), ("A" * 3000 + "B" * 3000)[-4000:]),
            (proc(0, "z" * 4000), "z" * 4000),
            (proc(0, "w" + "z" * 4000), "z" * 4000),
            (proc(0, "curta\n"), "curta\n"),
            (types.SimpleNamespace(returncode=0, stdout=None, stderr=None), ""),
        ]
        for resposta, esperado in casos:
            fake = DockerFalso()
            fake.respostas["principal"] = resposta
            r, _ = self.verificar(fake=fake)
            self.assertEqual(r["saida"], esperado)

    def test_codigo_do_comando_propaga(self):
        fake = DockerFalso()
        fake.respostas["principal"] = proc(3, "falhou\n", "erro\n")
        r, _ = self.verificar(fake=fake)
        self.assertEqual((r["codigo"], r["saida"]), (3, "falhou\nerro\n"))

    # Limpeza

    def test_limpeza_acontece_quando_um_passo_intermediario_lanca(self):
        passos = ["principal", "servico", "rede-create"]
        for passo in passos:
            fake = DockerFalso()
            fake.respostas[passo] = RuntimeError("boom " + passo)
            cfg = {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "postgres:16"}]}
            antes = self.bases_restantes()
            with self.assertRaises(RuntimeError, msg=passo):
                self.verificar(fake=fake, conteiner=cfg)
            tipos = fake.tipos()
            self.assertIn("rm", tipos, passo)
            self.assertIn("rede-rm", tipos, passo)
            self.assertEqual(self.bases_restantes(), antes, passo)
        # exceção durante a exportação: não há rede, mas a pasta some
        fake = DockerFalso()
        fake.respostas["cat-file"] = RuntimeError("boom")
        antes = self.bases_restantes()
        with self.assertRaises(RuntimeError):
            self.verificar(fake=fake)
        self.assertEqual(self.bases_restantes(), antes)
        self.assertNotIn("rede-create", fake.tipos())
        self.assertNotIn("rede-rm", fake.tipos())

    def test_limpeza_continua_apos_falha_de_um_passo_e_anota_sem_lancar(self):
        fake = DockerFalso()
        fake.respostas["rm"] = OSError("docker sumiu")
        fake.respostas["principal"] = proc(0, "saida")
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 0)
        self.assertIn("erro na limpeza", r["saida"])
        self.assertIn("rede-rm", fake.tipos())
        self.assertTrue(r["saida"].endswith("saida"))

    def test_limpeza_com_timeout_do_docker_e_anotada(self):
        fake = DockerFalso()
        fake.respostas["rede-rm"] = subprocess.TimeoutExpired(["docker"], 60)
        r, _ = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 0)
        self.assertIn("erro na limpeza: docker network", r["saida"])

    def test_diretorio_que_nao_pode_ser_apagado_e_anotado_sem_usar_docker_como_root(self):
        guardadas = []
        reais = shutil.rmtree

        def rmtree_inutil(caminho, *a, **kw):
            guardadas.append(caminho)

        with mock.patch.object(verificacao.shutil, "rmtree", rmtree_inutil):
            r, fake = self.verificar()
        self.assertIn("erro na limpeza: não foi possível apagar o diretório", r["saida"])
        for argv, _ in fake.chamadas:
            self.assertNotIn("/b/src", argv)
            self.assertNotIn("-rf", argv)
        reais(guardadas[0], ignore_errors=True)

    # Falhas antes do contêiner

    def test_falha_no_fetch_devolve_codigo_e_saida_do_git_sem_seguir(self):
        fake = DockerFalso()
        fake.respostas["fetch"] = proc(128, "", "fatal: sem remoto\n")
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r, {"sha": SHA, "codigo": 128, "saida": "fatal: sem remoto\n"})
        self.assertEqual(fake.tipos(), ["fetch"])
        self.assertEqual(self.bases_restantes(), [])

    def test_timeout_do_fetch_da_124_com_aviso_e_corte(self):
        fake = DockerFalso()
        fake.respostas["fetch"] = subprocess.TimeoutExpired(["git"], 9, output=b"o" * 9000, stderr=b"e" * 9000)
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 124)
        self.assertEqual(len(r["saida"]), 4000)
        self.assertIn("git fetch: tempo esgotado", r["saida"][:100])
        self.assertEqual(fake.tipos(), ["fetch"])

    def test_falha_do_git_na_exportacao_devolve_codigo_do_git_e_limpa(self):
        fake = DockerFalso()
        fake.respostas["ls-tree"] = proc_bytes(b"", 128, b"fatal: bad object\n")
        r, fake = self.verificar(fake=fake)
        self.assertEqual((r["codigo"], r["saida"]), (128, "fatal: bad object\n"))
        self.assertNotIn("rede-create", fake.tipos())
        self.assertNotIn("principal", fake.tipos())
        self.assertEqual(self.bases_restantes(), [])

    def test_timeout_do_git_na_exportacao_da_124(self):
        fake = DockerFalso()
        fake.respostas["cat-file"] = subprocess.TimeoutExpired(["git"], 9, output=b"x", stderr=b"y")
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 124)
        self.assertIn("git: tempo esgotado", r["saida"])
        self.assertNotIn("rede-create", fake.tipos())

    def test_export_inseguro_da_codigo_2_sem_docker(self):
        fake = DockerFalso(ls=ls_tree_saida((b"100644", "../fora.txt", OID_A)), cat=cat_file_saida((OID_A, b"x")))
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 2)
        self.assertTrue(r["saida"].startswith("export inválido"))
        self.assertNotIn("rede-create", fake.tipos())
        self.assertEqual(self.bases_restantes(), [])

    def test_docker_inexistente_da_127_e_limpa(self):
        fake = DockerFalso()
        fake.respostas["rede-create"] = FileNotFoundError("docker")
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 127)
        self.assertIn("docker", r["saida"])
        self.assertIn("FileNotFoundError", r["saida"])
        self.assertEqual(self.bases_restantes(), [])

    def test_git_inexistente_da_127(self):
        fake = DockerFalso()
        fake.respostas["fetch"] = FileNotFoundError("git")
        r, _ = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 127)

    def test_falha_ao_criar_a_rede_devolve_o_codigo_do_docker(self):
        fake = DockerFalso()
        fake.respostas["rede-create"] = proc(1, "", "daemon off")
        r, fake = self.verificar(fake=fake)
        self.assertEqual(r["codigo"], 1)
        self.assertIn("daemon off", r["saida"])
        self.assertNotIn("principal", fake.tipos())
        self.assertNotIn("rede-rm", fake.tipos())

    # Validação

    def test_validacao_recusa_antes_de_rodar_qualquer_coisa(self):
        grande = "a" * 201
        casos = {
            "imagem": [
                None, {}, {"imagem": ""}, {"imagem": "-v"}, {"imagem": "--privileged"}, {"imagem": "-x:1"},
                {"imagem": "Alpine"}, {"imagem": "a b"}, {"imagem": "a;b"}, {"imagem": grande}, {"imagem": 5},
                {"imagem": "a\nb"}, {"imagem": "a$b"}, {"imagem": ".x"},
            ],
            "env.TOKEN": [{"imagem": IMAGEM, "env": {"TOKEN": "x"}}],
            "env.GH_TOKEN": [{"imagem": IMAGEM, "env": {"GH_TOKEN": "x"}}],
            "env.MY_SECRET_KEY": [{"imagem": IMAGEM, "env": {"MY_SECRET_KEY": "x"}}],
            "env.DB_PASSWORD": [{"imagem": IMAGEM, "env": {"DB_PASSWORD": "x"}}],
            "env.GITHUB_USER": [{"imagem": IMAGEM, "env": {"GITHUB_USER": "x"}}],
            "env.MY_GH_X": [{"imagem": IMAGEM, "env": {k: "x"}} for k in ("MY_GH_X", "X_GH_", "HIGH_LEVEL", "SIGH_X")],
            "env.substring": [
                {"imagem": IMAGEM, "env": {k: "x"}}
                for k in ("MY_GITHUB_X", "XGITHUB_", "THE_WARREN", "XWARREN", "XANTHROPICX", "MYTOKEN", "XSECRETX", "XPASSWORDX")
            ],
            "rede": [{"imagem": IMAGEM, "rede": r} for r in ("", "host", "bridge", "none", "Internet", "internet ", None, True, 1)],
            "env.WARREN_URL": [{"imagem": IMAGEM, "env": {"WARREN_URL": "x"}}],
            "env.ANTHROPIC_MODEL": [{"imagem": IMAGEM, "env": {"ANTHROPIC_MODEL": "x"}}],
            "env.minuscula": [{"imagem": IMAGEM, "env": {"minuscula": "x"}}],
            "env.1X": [{"imagem": IMAGEM, "env": {"1X": "x"}}],
            "env.A=B": [{"imagem": IMAGEM, "env": {"A=B": "x"}}],
            "env.A": [{"imagem": IMAGEM, "env": {"A": 5}}, {"imagem": IMAGEM, "env": {"A": "a\0b"}}, {"imagem": IMAGEM, "env": []}],
            "memoria": [{"imagem": IMAGEM, "memoria": m} for m in ("", "0", "-1g", "3 g", "3gb", "abc", "3g --privileged", 3)],
            "cpus": [{"imagem": IMAGEM, "cpus": c} for c in ("", "0", "0.0", "-1", "1,5", "abc", "100", "2 --x", 2)],
            "pids": [{"imagem": IMAGEM, "pids": p} for p in (0, -1, 70000, "512", True, 1.5)],
            "shell": [{"imagem": IMAGEM, "shell": s} for s in ("zsh", "", "bash -x", None, "/bin/sh")],
            "servicos": [{"imagem": IMAGEM, "servicos": "db"}, {"imagem": IMAGEM, "servicos": {"nome": "db"}}],
            "servicos[0]": [{"imagem": IMAGEM, "servicos": ["db"]}, {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "x", "extra": 1}]}],
            "servicos[0].nome": [
                {"imagem": IMAGEM, "servicos": [{"nome": n, "imagem": "postgres:16"}]}
                for n in ("-db", "DB", "d b", "db/x", "db:1", "", "a;b", "db\n", "..", None, "a" * 65, "-v")
            ],
            "servicos[0].imagem": [{"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": i}]} for i in ("-x", "", "Postgres", None, "a b")],
            "servicos[0].env.GH_TOKEN": [{"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "x", "env": {"GH_TOKEN": "x"}}]}],
            "servicos[0].env.WARREN_X": [{"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "x", "env": {"WARREN_X": "x"}}]}],
            "servicos[1].nome": [
                {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "x"}, {"nome": "db", "imagem": "y"}]}
            ],
            "desconhecido": [{"imagem": IMAGEM, "volumes": ["/:/host"]}, {"imagem": IMAGEM, "privileged": True}],
        }
        for campo, configs in casos.items():
            for cfg in configs:
                fake = DockerFalso()
                r = verificacao.verificar(self.dir, SHA, "x", conteiner=cfg, executar=fake)
                self.assertEqual(r["codigo"], 2, repr(cfg))
                self.assertTrue(r["saida"].startswith("config de contêiner inválida: "), (cfg, r["saida"]))
                self.assertEqual(fake.chamadas, [], repr(cfg))
        self.assertEqual(self.bases_restantes(), [])

    def test_mensagem_de_validacao_cita_o_campo(self):
        casos = [
            ({"imagem": "-v"}, "imagem"),
            ({"imagem": IMAGEM, "env": {"GH_TOKEN": "x"}}, "env.GH_TOKEN"),
            ({"imagem": IMAGEM, "memoria": "x"}, "memoria"),
            ({"imagem": IMAGEM, "cpus": "x"}, "cpus"),
            ({"imagem": IMAGEM, "pids": 0}, "pids"),
            ({"imagem": IMAGEM, "shell": "zsh"}, "shell"),
            ({"imagem": IMAGEM, "servicos": [{"nome": "-x", "imagem": "y"}]}, "servicos[0].nome"),
        ]
        for cfg, campo in casos:
            r, _ = self.verificar(conteiner=cfg)
            self.assertEqual(r, {"sha": SHA, "codigo": 2, "saida": "config de contêiner inválida: " + campo, "interno": True})

    def test_config_valida_no_limite_e_password_so_em_servico(self):
        cfg = {
            "imagem": "a" * 200,
            "memoria": "1048576k",
            "cpus": "0.5",
            "pids": 1,
            "shell": "sh",
            "env": {"_X1": "v", "LISTA": "a,b", "OUTRO": ""},
            "servicos": [
                {"nome": "db", "imagem": "postgres@sha256:" + "a" * 64, "env": {"POSTGRES_PASSWORD": "fixo", "API_TOKEN": "t", "S_SECRET": "s"}}
            ],
        }
        r, fake = self.verificar(conteiner=cfg)
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("principal", fake.tipos())

    def test_sha_precisa_ter_exatamente_40_hex_minusculos(self):
        ruins = ["", "abc12", "abc1234", "a" * 7, "a" * 39, "g" * 40, "a" * 41, "A" * 40, "--upload-pack=x"]
        ruins += ["-f" + "a" * 38, SHA + "\n", "a b", "main", None, 5]
        for sha in ruins:
            fake = DockerFalso()
            r = verificacao.verificar(self.dir, sha, "x", conteiner=CONTEINER, executar=fake)
            self.assertEqual(r, {"sha": sha, "codigo": 2, "saida": "sha inválido", "interno": True}, repr(sha))
            self.assertEqual(fake.chamadas, [])

    def test_comando_invalido_nao_executa_nada(self):
        for comando in ("", "   \n", None, 5, "echo a\0b", "\0"):
            fake = DockerFalso()
            r = verificacao.verificar(self.dir, SHA, comando, conteiner=CONTEINER, executar=fake)
            self.assertEqual(r, {"sha": SHA, "codigo": 2, "saida": "comando inválido", "interno": True}, repr(comando))
            self.assertEqual(fake.chamadas, [])

    # Rede, usuário, rótulos e limites dos serviços

    def test_usuario_e_uid_gid_do_despachante(self):
        self.assertEqual(ORIGINAL_USUARIO(), "%d:%d" % (os.getuid(), os.getgid()))

    def test_user_vem_do_usuario_do_despachante(self):
        _, fake = self.verificar()
        argv = fake.argv("principal")
        self.assertEqual(argv[argv.index("--user") + 1], "1234:5678")
        self.assertIn("--cap-drop", argv)
        self.assertIn("no-new-privileges", argv)

    def test_comando_ganha_mkdir_do_home_e_o_home_continua_no_tmpfs(self):
        _, fake = self.verificar(comando="pnpm install --frozen-lockfile")
        argv = fake.argv("principal")
        self.assertEqual(argv[-1], 'mkdir -p "$HOME" && pnpm install --frozen-lockfile')
        self.assertIn("HOME=/tmp/home", argv)
        self.assertIn("/tmp:rw,exec", argv)

    def test_rede_internet_e_o_padrao_e_nao_usa_internal(self):
        for cfg in ({"imagem": IMAGEM}, {"imagem": IMAGEM, "rede": "internet"}):
            _, fake = self.verificar(conteiner=cfg)
            self.assertNotIn("--internal", fake.argv("rede-create"))

    def test_rede_isolada_cria_a_rede_com_internal_so_nesse_modo(self):
        _, fake = self.verificar(conteiner={"imagem": IMAGEM, "rede": "isolada"})
        self.assertEqual(
            fake.argv("rede-create"), ["docker", "network", "create"] + ROTULOS + ["--internal", "fabrica-verif-" + ID]
        )

    def test_add_host_neutraliza_os_nomes_do_docker_desktop_nos_dois_modos(self):
        for rede in ("internet", "isolada"):
            _, fake = self.verificar(conteiner={"imagem": IMAGEM, "rede": rede})
            argv = fake.argv("principal")
            hosts = [argv[i + 1] for i, a in enumerate(argv) if a == "--add-host"]
            self.assertEqual(hosts, ["host.docker.internal:127.0.0.1", "gateway.docker.internal:127.0.0.1"], rede)

    def test_rotulos_em_rede_principal_e_servicos(self):
        cfg = {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "postgres:16"}]}
        _, fake = self.verificar(conteiner=cfg)
        for argv in (fake.argv("rede-create"), fake.argv("principal"), fake.argv("servico")):
            pares = [(argv[i], argv[i + 1]) for i, a in enumerate(argv) if a == "--label"]
            self.assertEqual(pares, [("--label", "fabrica.verif=1"), ("--label", "fabrica.verif.id=" + ID)], argv)

    def test_servicos_recebem_pids_e_memoria_mas_mantem_as_capabilities(self):
        cfg = {
            "imagem": IMAGEM,
            "pids": 77,
            "memoria": "256m",
            "servicos": [{"nome": "db", "imagem": "postgres:16"}, {"nome": "q", "imagem": "redis:7"}],
        }
        _, fake = self.verificar(conteiner=cfg)
        for indice in (0, 1):
            argv = fake.argv("servico", indice)
            self.assertEqual(argv[argv.index("--pids-limit") + 1], "77")
            self.assertEqual(argv[argv.index("--memory") + 1], "256m")
            self.assertNotIn("--cap-drop", argv)
            self.assertNotIn("--security-opt", argv)
            self.assertNotIn("--user", argv)

    def test_chaves_de_env_com_gh_no_meio_sao_recusadas_e_nomes_proximos_aceitos(self):
        for chave in ("NIGHT_HOURS", "WEIGHT_KG", "LIGHT_MODE", "HOURS_GH", "GH", "EIGHT", "DAY_OF_WEEK"):
            self.assertNotIn("GH_", chave, "o exemplo do teste precisa realmente não conter GH_")
            r, fake = self.verificar(conteiner={"imagem": IMAGEM, "env": {chave: "v"}})
            self.assertEqual(r["codigo"], 0, chave)
            self.assertIn(chave + "=v", fake.argv("principal"))
        for chave in ("MY_GH_X", "HIGH_LEVEL", "GH_X", "A_GH_"):
            self.assertIn("GH_", chave)
            r, fake = self.verificar(conteiner={"imagem": IMAGEM, "env": {chave: "v"}})
            self.assertEqual((r["codigo"], r["saida"]), (2, "config de contêiner inválida: env." + chave), chave)
            self.assertEqual(fake.chamadas, [])

    def test_servico_aceita_token_senha_e_segredo_mas_nunca_gh_ou_github(self):
        for chave, ok_ in (("DB_PASSWORD", True), ("API_TOKEN", True), ("X_SECRET", True), ("MY_GH_X", False), ("GITHUB_X", False)):
            cfg = {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "x", "env": {chave: "v"}}]}
            r, _ = self.verificar(conteiner=cfg)
            self.assertEqual(r["codigo"] == 0, ok_, chave)

    def test_principal_sempre_vai_pelo_streaming_limitado_com_o_popen_injetado(self):
        # Qualquer `executar` (aqui um wrapper de log, como o da Task 7) não muda o caminho do principal.
        fake = DockerFalso()
        registro = []

        def executar_com_log(argv, **kw):
            registro.append(list(argv))
            return fake(argv, **kw)

        chamado = []
        popen = mock.Mock(name="popen")

        def limitado(argv, timeout_s, **kw):
            chamado.append((list(argv), timeout_s, kw))
            return subprocess.CompletedProcess(argv, 7, b"saida em bytes", b"")

        with mock.patch.object(verificacao, "_rodar_limitado", limitado):
            r = verificacao.verificar(
                self.dir, SHA, "x", conteiner=CONTEINER, executar=executar_com_log, popen=popen, timeout_s=33
            )
        self.assertEqual((r["codigo"], r["saida"]), (7, "saida em bytes"))
        self.assertEqual(len(chamado), 1)
        self.assertEqual(chamado[0][1], 33)
        self.assertIs(chamado[0][2]["popen"], popen)
        self.assertEqual(chamado[0][0][:3], ["docker", "run", "--rm"])
        self.assertNotIn("principal", fake.tipos())
        self.assertFalse([a for a in registro if DockerFalso.tipo(a) == "principal"])
        self.assertIn("rede-create", fake.tipos())
        self.assertIn("rm", fake.tipos())

    def test_executar_falso_qualquer_e_o_principal_passa_pelo_popen_falso(self):
        fake = DockerFalso()
        fake.respostas["principal"] = proc(5, "do popen\n")
        pelo_executar = []

        def executar(argv, **kw):
            pelo_executar.append(list(argv))
            return fake(argv, **kw)

        r = verificacao.verificar(self.dir, SHA, "x", conteiner=CONTEINER, executar=executar, popen=fake.popen)
        self.assertEqual((r["codigo"], r["saida"]), (5, "do popen\n"))
        self.assertEqual(fake.via_popen, [fake.argv("principal")])
        self.assertEqual([DockerFalso.tipo(a) for a in fake.via_popen], ["principal"])
        self.assertNotIn("principal", [DockerFalso.tipo(a) for a in pelo_executar])
        self.assertIn("rede-create", [DockerFalso.tipo(a) for a in pelo_executar])
        kwargs = fake.kwargs("principal")
        self.assertEqual(kwargs["stdout"], subprocess.PIPE)
        self.assertEqual(kwargs["stderr"], subprocess.STDOUT)

    def test_timeout_do_streaming_limitado_tambem_mata_o_conteiner(self):
        fake = DockerFalso()

        def limitado(argv, timeout_s, **kw):
            raise subprocess.TimeoutExpired(argv, timeout_s, output=b"restinho")

        with mock.patch.object(verificacao, "_rodar_limitado", limitado):
            r = verificacao.verificar(
                self.dir, SHA, "x", conteiner=CONTEINER, executar=fake, popen=fake.popen, timeout_s=4
            )
        self.assertEqual(r["codigo"], 124)
        self.assertEqual(fake.argv("kill"), ["docker", "kill", "fabrica-verif-" + ID])
        self.assertTrue(r["saida"].endswith("restinho"))
        self.assertTrue(r["saida"].startswith("tempo esgotado após 4 s"))

    def test_sem_fallback_de_limpeza_com_root(self):
        guardadas = []
        with mock.patch.object(verificacao.shutil, "rmtree", lambda c, *a, **k: guardadas.append(c)):
            _, fake = self.verificar()
        shutil.rmtree(guardadas[0], ignore_errors=True)
        for argv, _ in fake.chamadas:
            self.assertFalse(argv[-3:] == ["rm", "-rf", "/b/src"], argv)


    def test_assinatura_sem_executar_como_e_com_conteiner_obrigatorio(self):
        import inspect

        parametros = inspect.signature(verificacao.verificar).parameters
        self.assertNotIn("executar_como", parametros)
        self.assertIs(parametros["conteiner"].default, inspect.Parameter.empty)
        self.assertEqual(parametros["conteiner"].kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertEqual(parametros["timeout_s"].default, 1800)
        self.assertIs(parametros["executar"].default, subprocess.run)
        self.assertIs(parametros["popen"].default, subprocess.Popen)
        self.assertEqual(parametros["popen"].kind, inspect.Parameter.KEYWORD_ONLY)
        for nome in ("_rodar_em_grupo", "_matar_grupo", "_extrair", "_EXECUTAR_PADRAO"):
            self.assertFalse(hasattr(verificacao, nome), nome)


class TestesF2ErroInterno(unittest.TestCase):
    """F2a: as falhas do próprio verificador (config, export, docker de controle, binário do host) vêm com
    `interno: True`; o código do comando no contêiner (inclusive 2, 125, 126 e 127 do `docker run`) não."""

    setUp = TestesVerificarComFalso.setUp
    verificar = TestesVerificarComFalso.verificar

    def test_falhas_do_verificador_marcam_interno(self):
        casos = {
            "export": DockerFalso(ls=ls_tree_saida((b"100644", "../fora.txt", OID_A)), cat=cat_file_saida((OID_A, b"x"))),
            "git do host": DockerFalso(),
            "docker do host": DockerFalso(),
            "rede": DockerFalso(),
        }
        casos["git do host"].respostas["fetch"] = FileNotFoundError("git")
        casos["docker do host"].respostas["rede-create"] = FileNotFoundError("docker")
        casos["rede"].respostas["rede-create"] = proc(1, "", "Cannot connect to the Docker daemon")
        for nome, fake in casos.items():
            with self.subTest(caso=nome):
                r, _ = self.verificar(fake=fake)
                self.assertIs(r.get("interno"), True, r)
                self.assertNotEqual(r["codigo"], 0)

    def test_servico_que_nao_sobe_marca_interno(self):
        cfg = {"imagem": IMAGEM, "servicos": [{"nome": "db", "imagem": "postgres:16"}]}
        fake = DockerFalso()
        fake.respostas["servico"] = [proc(125, "", "pull access denied")]
        r, _ = self.verificar(fake=fake, conteiner=cfg)
        self.assertIs(r.get("interno"), True)

    def test_codigo_do_comando_e_do_fetch_nao_marca_interno(self):
        for codigo in (0, 1, 2, 125, 126, 127):
            with self.subTest(codigo=codigo):
                fake = DockerFalso()
                fake.respostas["principal"] = proc(codigo, "saida", "")
                r, _ = self.verificar(fake=fake)
                self.assertEqual(r["codigo"], codigo)
                self.assertNotIn("interno", r)
        fake = DockerFalso()
        fake.respostas["fetch"] = proc(128, "", "fatal: sem remoto\n")
        r, _ = self.verificar(fake=fake)
        self.assertNotIn("interno", r)


class TestesRodarLimitado(unittest.TestCase):
    def py(self, codigo):
        return [sys.executable, "-I", "-c", codigo]

    def test_anexar_corta_o_comeco_e_nunca_passa_do_limite(self):
        buffer = bytearray()
        verificacao._anexar(buffer, b"abc", 5)
        self.assertEqual(bytes(buffer), b"abc")
        verificacao._anexar(buffer, b"defg", 5)
        self.assertEqual(bytes(buffer), b"cdefg")
        verificacao._anexar(buffer, b"x" * 100, 5)
        self.assertEqual(bytes(buffer), b"xxxxx")
        verificacao._anexar(buffer, b"", 5)
        self.assertEqual(bytes(buffer), b"xxxxx")
        verificacao._anexar(buffer, b"yz", 0)
        self.assertEqual(bytes(buffer), b"")

    def test_50_mb_deixam_so_o_final_e_o_buffer_nunca_passa_do_limite(self):
        tamanhos = []
        original = verificacao._anexar

        def espiao(buffer, bloco, limite):
            original(buffer, bloco, limite)
            tamanhos.append((len(buffer), len(bloco), limite))

        codigo = "import sys\nfor i in range(50):\n    sys.stdout.write('x' * 1048576)\n    sys.stdout.flush()\nsys.stdout.write('FIM\\n')"
        with mock.patch.object(verificacao, "_anexar", espiao):
            r = verificacao._rodar_limitado(self.py(codigo), 60)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(len(r.stdout), 65536)
        self.assertTrue(r.stdout.endswith(b"xxxxFIM\n"))
        self.assertGreater(len(tamanhos), 100)
        self.assertLessEqual(max(t[0] for t in tamanhos), 65536)
        self.assertLessEqual(max(t[1] for t in tamanhos), 65536)

    def test_stdout_e_stderr_vem_combinados_e_o_codigo_de_saida_e_preservado(self):
        r = verificacao._rodar_limitado(
            self.py("import sys\nprint('para-stdout', flush=True)\nprint('para-stderr', file=sys.stderr, flush=True)\nsys.exit(9)"), 30
        )
        self.assertEqual(r.returncode, 9)
        self.assertIn(b"para-stdout", r.stdout)
        self.assertIn(b"para-stderr", r.stdout)
        self.assertEqual(r.stderr, b"")

    def test_limite_personalizado(self):
        r = verificacao._rodar_limitado(self.py("print('0123456789abcdef')"), 30, limite_bytes=6)
        self.assertEqual(r.stdout, b"bcdef\n")

    def test_timeout_mata_o_cliente_e_levanta_com_o_que_ja_saiu(self):
        capturado = {}

        def popen(*a, **k):
            capturado["proc"] = subprocess.Popen(*a, **k)
            return capturado["proc"]

        inicio = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired) as ctx:
            verificacao._rodar_limitado(
                self.py("import time\nprint('antes', flush=True)\ntime.sleep(60)"), 1.5, popen=popen
            )
        self.assertLess(time.monotonic() - inicio, 20)
        self.assertIn(b"antes", ctx.exception.output)
        self.assertIsNotNone(capturado["proc"].poll())

    def test_popen_injetado_recebe_pipe_combinado_e_stdin_fechado(self):
        chamadas = []

        def popen(*a, **k):
            chamadas.append((a, k))
            return subprocess.Popen(*a, **k)

        verificacao._rodar_limitado(self.py("pass"), 30, popen=popen)
        argv, kwargs = chamadas[0][0][0], chamadas[0][1]
        self.assertEqual(argv[0], sys.executable)
        self.assertIs(kwargs["stdout"], subprocess.PIPE)
        self.assertIs(kwargs["stderr"], subprocess.STDOUT)
        self.assertIs(kwargs["stdin"], subprocess.DEVNULL)

    def test_processo_que_ignora_stdin_nao_trava_e_programa_inexistente_levanta_oserror(self):
        r = verificacao._rodar_limitado(self.py("import sys\nprint(len(sys.stdin.read()))"), 30)
        self.assertEqual(r.stdout.strip(), b"0")
        with self.assertRaises(OSError):
            verificacao._rodar_limitado(["/nao/existe/mesmo"], 5)


class _Iteravel:
    """Faz as vezes de `os.scandir(fd)` com uma lista já lida (suporta `with`)."""

    def __init__(self, entradas):
        self.entradas = entradas

    def __enter__(self):
        return iter(self.entradas)

    def __exit__(self, *args):
        return False


class TestesLiberarDiretorios(unittest.TestCase):
    def setUp(self):
        base = tempfile.TemporaryDirectory()
        self.addCleanup(self._limpar, base)
        self.base = pathlib.Path(base.name).resolve()

    def _limpar(self, base):
        for pasta, diretorios, _ in os.walk(base.name):
            for d in diretorios:
                try:
                    os.chmod(os.path.join(pasta, d), 0o700)
                except OSError:
                    pass
        base.cleanup()

    def modo(self, caminho):
        return os.stat(caminho).st_mode & 0o777

    def test_symlink_para_diretorio_fora_nao_tem_o_modo_do_alvo_alterado(self):
        fora = self.base / "fora"
        (fora / "dentro").mkdir(parents=True)
        (fora / "dentro" / "f").write_text("x")
        os.chmod(fora / "dentro", 0o500)
        os.chmod(fora, 0o500)
        src = self.base / "base" / "src"
        src.mkdir(parents=True)
        os.symlink(fora, src / "link-abs")
        os.symlink("../../fora", src / "link-rel")
        os.symlink(fora / "dentro", src / "link-fundo")
        os.symlink("link-abs", src / "link-de-link")
        os.symlink("nao-existe", src / "link-quebrado")
        os.symlink(".", src / "link-ciclo")
        verificacao._liberar_diretorios(str(self.base / "base"))
        self.assertEqual(self.modo(fora), 0o500)
        self.assertEqual(self.modo(fora / "dentro"), 0o500)
        self.assertTrue(os.path.islink(src / "link-abs"))

    def test_libera_diretorios_sem_permissao_e_o_rmtree_consegue_apagar(self):
        raiz = self.base / "base"
        (raiz / "src" / "a" / "b").mkdir(parents=True)
        (raiz / "src" / "a" / "b" / "f").write_text("x")
        (raiz / "src" / "c").mkdir()
        (raiz / "src" / "c" / "g").write_text("y")
        os.chmod(raiz / "src" / "a" / "b", 0o000)
        os.chmod(raiz / "src" / "a", 0o500)
        os.chmod(raiz / "src" / "c", 0o555)
        os.chmod(raiz / "src", 0o500)
        os.chmod(raiz, 0o500)
        verificacao._liberar_diretorios(str(raiz))
        self.assertEqual(self.modo(raiz), 0o700)
        self.assertEqual(self.modo(raiz / "src" / "a" / "b"), 0o700)
        self.assertEqual(self.modo(raiz / "src" / "c"), 0o700)
        shutil.rmtree(raiz)
        self.assertFalse(raiz.exists())

    def test_base_que_e_symlink_ou_nao_existe_nao_faz_nada(self):
        alvo = self.base / "alvo"
        alvo.mkdir()
        os.chmod(alvo, 0o500)
        os.symlink(alvo, self.base / "base-link")
        verificacao._liberar_diretorios(str(self.base / "base-link"))
        self.assertEqual(self.modo(alvo), 0o500)
        verificacao._liberar_diretorios(str(self.base / "nao-existe"))

    def test_nunca_tenta_abrir_um_symlink(self):
        raiz = self.base / "base"
        (raiz / "src" / "real").mkdir(parents=True)
        os.symlink(self.base, raiz / "src" / "link")
        abertos = []
        original = os.open

        def espiao(caminho, *a, **k):
            abertos.append(os.fsdecode(caminho))
            return original(caminho, *a, **k)

        with mock.patch.object(verificacao.os, "open", espiao):
            verificacao._liberar_diretorios(str(raiz))
        self.assertIn("real", abertos)
        self.assertNotIn("link", abertos)

    def test_symlink_trocado_depois_da_listagem_nao_e_seguido(self):
        # Corrida simulada: o diretório vira symlink entre a listagem e a abertura.
        fora = self.base / "fora"
        fora.mkdir()
        os.chmod(fora, 0o500)
        raiz = self.base / "base"
        (raiz / "src" / "alvo").mkdir(parents=True)
        original = os.scandir

        def scandir_com_troca(fd):
            entradas = list(original(fd))
            if os.path.samestat(os.fstat(fd), os.stat(raiz / "src")) and not os.path.islink(raiz / "src" / "alvo"):
                (raiz / "src" / "alvo").rmdir()
                os.symlink(fora, raiz / "src" / "alvo")
            return _Iteravel(entradas)

        with mock.patch.object(verificacao.os, "scandir", scandir_com_troca):
            verificacao._liberar_diretorios(str(raiz))
        self.assertEqual(self.modo(fora), 0o500)

    def test_usa_descritores_e_nao_chmod_por_caminho(self):
        raiz = self.base / "base"
        (raiz / "src" / "a").mkdir(parents=True)
        os.chmod(raiz / "src" / "a", 0o500)
        chamadas = []
        original = os.chmod

        def espiao(caminho, modo, *a, **k):
            chamadas.append(caminho)
            return original(caminho, modo, *a, **k)

        with mock.patch.object(verificacao.os, "chmod", espiao):
            verificacao._liberar_diretorios(str(raiz))
        self.assertEqual(chamadas, [])
        self.assertEqual(self.modo(raiz / "src" / "a"), 0o700)

    # Y: diretório sem leitura (000) recebe 0700 só pelo descritor, nunca por nome

    O_PATH_SIMULADO = 1 << 40

    def simular_o_path(self, pilha, registro, negar=()):
        """Simula o ramo Linux (O_PATH + /proc/self/fd) neste host, traduzindo para chamadas reais.

        `negar`: nomes cujo primeiro `open` comum falha com EACCES, como um diretório 000 no Linux.
        """
        open_real, chmod_real = os.open, os.chmod
        negados = set()

        def espiao_open(caminho, flags, modo=0o777, *, dir_fd=None):
            nome = os.fsdecode(caminho)
            if flags & self.O_PATH_SIMULADO:
                registro.append(("open-o_path", nome, flags & ~self.O_PATH_SIMULADO))
                return open_real(caminho, (flags & ~self.O_PATH_SIMULADO) | os.O_RDONLY, modo, dir_fd=dir_fd)
            if nome.startswith("/proc/self/fd/"):
                registro.append(("open-proc", flags))
                return os.dup(int(nome.rsplit("/", 1)[1]))
            if nome in negar and nome not in negados:
                negados.add(nome)
                raise PermissionError(13, "Permission denied", nome)
            return open_real(caminho, flags, modo, dir_fd=dir_fd)

        def espiao_chmod(caminho, modo, **k):
            registro.append(("chmod", os.fsdecode(caminho), k))
            if os.fsdecode(caminho).startswith("/proc/self/fd/"):
                return os.fchmod(int(os.fsdecode(caminho).rsplit("/", 1)[1]), modo)
            return chmod_real(caminho, modo, **k)

        pilha.enter_context(mock.patch.object(verificacao.os, "O_PATH", self.O_PATH_SIMULADO, create=True))
        pilha.enter_context(mock.patch.object(verificacao.os, "open", espiao_open))
        pilha.enter_context(mock.patch.object(verificacao.os, "chmod", espiao_chmod))

    def test_ramo_o_path_da_0700_pelo_descritor_e_nunca_pelo_nome(self):
        import contextlib

        raiz = self.base / "base"
        (raiz / "src" / "d" / "e").mkdir(parents=True)
        (raiz / "src" / "d" / "e" / "f").write_text("x")
        os.chmod(raiz / "src" / "d", 0o500)
        registro = []
        with contextlib.ExitStack() as pilha:
            self.simular_o_path(pilha, registro, negar=("d",))
            verificacao._liberar_diretorios(str(raiz))
        self.assertEqual(self.modo(raiz / "src" / "d"), 0o700)
        self.assertEqual(self.modo(raiz / "src" / "d" / "e"), 0o700)
        self.assertIn(("open-o_path", "d", os.O_DIRECTORY | os.O_NOFOLLOW), registro)
        chmods = [r for r in registro if r[0] == "chmod"]
        self.assertEqual(len(chmods), 1, registro)
        self.assertTrue(chmods[0][1].startswith("/proc/self/fd/"), chmods)
        self.assertIn(("open-proc", os.O_RDONLY | os.O_DIRECTORY), registro)

    def test_diretorio_sem_leitura_trocado_por_symlink_nao_tem_o_alvo_alterado(self):
        import contextlib

        for ramo in ("nativo", "o_path"):
            for funcao in (verificacao._liberar_diretorios, verificacao._remover_por_fd):
                caso = "%s/%s" % (ramo, funcao.__name__)
                base = pathlib.Path(tempfile.mkdtemp(dir=self.base))
                fora = base / "fora"
                (fora / "dentro").mkdir(parents=True)
                os.chmod(fora, 0o500)
                raiz = base / "base"
                (raiz / "src" / "d").mkdir(parents=True)
                (raiz / "src" / "d" / "f").write_text("x")
                os.chmod(raiz / "src" / "d", 0o000)
                trocas = []
                open_atual = os.open

                with contextlib.ExitStack() as pilha:
                    registro = []
                    if ramo == "o_path":
                        self.simular_o_path(pilha, registro)
                    open_ramo = os.open

                    def open_com_troca(caminho, flags, modo=0o777, *, dir_fd=None):
                        try:
                            return open_ramo(caminho, flags, modo, dir_fd=dir_fd)
                        except PermissionError:
                            # Corrida: entre o EACCES e o chmod, o 000 vira symlink para fora.
                            if os.fsdecode(caminho) == "d" and not trocas:
                                trocas.append(1)
                                os.rename(raiz / "src" / "d", raiz / "src" / "d-velho")
                                os.symlink(fora, raiz / "src" / "d")
                            raise

                    pilha.enter_context(mock.patch.object(verificacao.os, "open", open_com_troca))
                    funcao(str(raiz))
                self.assertIs(os.open, open_atual)
                self.assertEqual(trocas, [1], caso)
                self.assertEqual(self.modo(fora), 0o500, caso)
                self.assertTrue((fora / "dentro").is_dir(), caso)
                self.assertTrue(os.path.islink(raiz / "src" / "d"), caso)
                os.chmod(fora, 0o700)


FLAGS_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def aninhar(raiz, niveis, fora=None):
    """`niveis` diretórios `a` encadeados sob `raiz`, criados por descritor (sem caminho longo).

    A cada 100 níveis há um arquivo, um diretório `000` com conteúdo e, se `fora` for dado, um
    symlink para ele. O nível 1000 fica `000` e os demais `0o500` depois de preenchidos, como um
    comando hostil deixaria.
    """
    fd = os.open(raiz, FLAGS_DIR)
    try:
        for nivel in range(1, niveis + 1):
            os.mkdir("a", dir_fd=fd)
            filho = os.open("a", FLAGS_DIR, dir_fd=fd)
            if nivel % 100 == 0:
                arquivo = os.open("f", os.O_WRONLY | os.O_CREAT, 0o644, dir_fd=filho)
                os.write(arquivo, b"x")
                os.close(arquivo)
                os.mkdir("z", dir_fd=filho)
                interno = os.open("z", FLAGS_DIR, dir_fd=filho)
                os.mkdir("dentro", dir_fd=interno)
                os.fchmod(interno, 0o000)
                os.close(interno)
                if fora is not None:
                    os.symlink(str(fora), "l", dir_fd=filho)
            os.fchmod(fd, 0o000 if nivel == 1000 else 0o500)
            os.close(fd)
            fd = filho
    finally:
        os.close(fd)


def remover_a_forca(caminho):
    """Limpeza dos próprios testes, independente do código testado (o `rm` do sistema é iterativo)."""
    subprocess.run(["chmod", "-R", "u+rwx", str(caminho)], capture_output=True)
    subprocess.run(["rm", "-rf", str(caminho)], capture_output=True)


def baixar_limite_de_fds(caso, limite=256):
    try:
        import resource
    except ImportError:
        caso.skipTest("sem o módulo resource")
    mole, dura = resource.getrlimit(resource.RLIMIT_NOFILE)
    try:
        resource.setrlimit(resource.RLIMIT_NOFILE, (limite, dura))
    except (ValueError, OSError):
        caso.skipTest("não foi possível baixar RLIMIT_NOFILE")
    caso.addCleanup(resource.setrlimit, resource.RLIMIT_NOFILE, (mole, dura))


class ContadorDeFds:
    """Espia `os.open`/`os.close` e guarda o máximo de descritores abertos ao mesmo tempo."""

    def __init__(self):
        self.abertos = set()
        self.maximo = 0
        self.open_original = os.open
        self.close_original = os.close

    def open(self, *a, **k):
        fd = self.open_original(*a, **k)
        self.abertos.add(fd)
        self.maximo = max(self.maximo, len(self.abertos))
        return fd

    def close(self, fd):
        self.abertos.discard(fd)
        return self.close_original(fd)


class TestesLimpezaProfunda(unittest.TestCase):
    """W: árvores mais fundas que o limite de recursão do Python, criadas pelo comando não confiável."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(remover_a_forca, self.tmp)
        self.fora = self.tmp / "fora"
        (self.fora / "dentro").mkdir(parents=True)
        (self.fora / "dentro" / "segredo").write_text("nao apagar")
        os.chmod(self.fora, 0o500)
        self.addCleanup(os.chmod, self.fora, 0o700)

    def base_funda(self, niveis=2000):
        """`base/src` com `niveis` diretórios encadeados (o padrão é o do ruling W)."""
        base = pathlib.Path(tempfile.mkdtemp(prefix="fabrica-verif-", dir=self.tmp))
        (base / "src").mkdir()
        aninhar(base / "src", niveis, fora=self.fora)
        return base

    def assertFora_intacto(self):
        self.assertEqual(os.stat(self.fora).st_mode & 0o777, 0o500)
        self.assertEqual((self.fora / "dentro" / "segredo").read_text(), "nao apagar")

    def limpar(self, base):
        avisos = []
        verificacao._limpar(DockerFalso(), "fabrica-verif-x", {"rede": False, "servicos": []}, "r", str(base), avisos)
        return avisos

    def test_limpar_remove_2000_niveis_sem_excecao(self):
        base = self.base_funda()
        self.assertEqual(self.limpar(base), [])
        self.assertFalse(os.path.lexists(base))
        self.assertFora_intacto()

    def test_limpar_remove_2000_niveis_com_limite_de_256_descritores(self):
        base = self.base_funda()
        baixar_limite_de_fds(self, 256)
        self.assertEqual(self.limpar(base), [])
        self.assertFalse(os.path.lexists(base))
        self.assertFora_intacto()

    def test_liberacao_e_remocao_iterativas_com_poucos_descritores_abertos(self):
        for funcao in (verificacao._liberar_diretorios, verificacao._remover_por_fd):
            base = self.base_funda(300)
            contador = ContadorDeFds()
            with mock.patch.object(verificacao.os, "open", contador.open), mock.patch.object(
                verificacao.os, "close", contador.close
            ):
                funcao(str(base))
            self.assertLessEqual(contador.maximo, 3, funcao.__name__)
            self.assertEqual(contador.abertos, set(), funcao.__name__)
            if funcao is verificacao._liberar_diretorios:
                # tudo liberado: o rm comum consegue apagar sem chmod
                subprocess.run(["rm", "-rf", str(base)], capture_output=True)
            self.assertFalse(os.path.lexists(base), funcao.__name__)
        self.assertFora_intacto()

    def test_remocao_por_fd_sozinha_apaga_1100_niveis_sem_seguir_symlink(self):
        # 1.100 já passa do limite de recursão (1.000); o macOS fica lento com árvores fundas.
        base = self.base_funda(1100)
        baixar_limite_de_fds(self, 256)
        verificacao._remover_por_fd(str(base))
        self.assertFalse(os.path.lexists(base))
        self.assertFora_intacto()

    def test_rmtree_que_lanca_cai_na_remocao_por_fd(self):
        for erro in (RecursionError("fundo demais"), OSError(24, "Too many open files")):
            base = self.base_funda(50)
            with mock.patch.object(verificacao.shutil, "rmtree", side_effect=erro) as rmtree:
                self.assertEqual(self.limpar(base), [], erro)
            rmtree.assert_called_once_with(str(base))
            self.assertFalse(os.path.lexists(base), erro)
        self.assertFora_intacto()

    def test_rmtree_so_depois_da_liberacao(self):
        base = self.base_funda(5)
        ordem = []
        liberar, rmtree = verificacao._liberar_diretorios, verificacao.shutil.rmtree
        with mock.patch.object(
            verificacao, "_liberar_diretorios", lambda b: (ordem.append("liberar"), liberar(b))
        ), mock.patch.object(verificacao.shutil, "rmtree", lambda b: (ordem.append("rmtree"), rmtree(b))):
            self.assertEqual(self.limpar(base), [])
        self.assertEqual(ordem, ["liberar", "rmtree"])
        self.assertFalse(os.path.lexists(base))

    def test_limpar_nunca_lanca_exception_e_anota(self):
        base = self.base_funda(3)
        for erro in (RecursionError("x"), RuntimeError("x"), MemoryError()):
            with mock.patch.object(verificacao, "_liberar_diretorios", side_effect=erro):
                avisos = self.limpar(base)
            self.assertIn("erro na limpeza: diretório temporário (%s)" % type(erro).__name__, avisos)
            self.assertIn("erro na limpeza: não foi possível apagar o diretório temporário", avisos)

    def test_limpar_nao_engole_base_exception(self):
        base = self.base_funda(3)
        with mock.patch.object(verificacao, "_liberar_diretorios", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.limpar(base)

    def test_verificar_nao_lanca_quando_o_comando_deixa_1100_niveis(self):
        def principal(argv, **kwargs):
            src = argv[argv.index("-v") + 1].split(":")[0]
            aninhar(src, 1100, fora=self.fora)
            return proc(1, "falhou")

        fake = DockerFalso()
        fake.respostas["principal"] = principal
        with mock.patch.object(tempfile, "tempdir", str(self.tmp)):
            r = verificacao.verificar(self.tmp, SHA, "x", conteiner=CONTEINER, executar=fake, popen=fake.popen)
        self.assertEqual((r["codigo"], r["saida"]), (1, "falhou"))
        self.assertEqual(list(self.tmp.glob("fabrica-verif-*")), [])
        self.assertFora_intacto()

    def test_arvore_que_muda_no_meio_para_a_travessia_sem_sair_de_base(self):
        # O diretório em visita é movido para fora: o `..` dele deixa de ser o pai guardado.
        for funcao in (verificacao._liberar_diretorios, verificacao._remover_por_fd):
            base = pathlib.Path(tempfile.mkdtemp(prefix="fabrica-verif-", dir=self.tmp))
            (base / "src" / "a").mkdir(parents=True)
            (base / "src" / "z").mkdir()
            vitima = self.tmp / "vizinho"
            (vitima / "z").mkdir(parents=True)
            (vitima / "z" / "segredo").write_text("nao apagar")
            os.chmod(vitima / "z", 0o500)
            original = os.scandir

            def scandir_que_move(fd):
                entradas = list(original(fd))
                if (base / "src" / "a").exists() and os.path.samestat(os.fstat(fd), os.stat(base / "src" / "a")):
                    os.rename(base / "src" / "a", vitima / "a")
                return _Iteravel(entradas)

            with mock.patch.object(verificacao.os, "scandir", scandir_que_move):
                funcao(str(base))
            self.assertEqual((vitima / "z" / "segredo").read_text(), "nao apagar", funcao.__name__)
            self.assertEqual(os.stat(vitima / "z").st_mode & 0o777, 0o500, funcao.__name__)
            remover_a_forca(vitima)
            remover_a_forca(base)

    def test_remocao_por_fd_nao_segue_symlinks_nem_trocados_no_meio(self):
        base = pathlib.Path(tempfile.mkdtemp(prefix="fabrica-verif-", dir=self.tmp))
        src = base / "src"
        (src / "alvo").mkdir(parents=True)
        os.symlink(self.fora, src / "link-abs")
        os.symlink("../../fora/dentro", src / "link-rel")
        original = os.scandir

        def scandir_com_troca(fd):
            entradas = list(original(fd))
            if os.path.samestat(os.fstat(fd), os.stat(src)) and not os.path.islink(src / "alvo"):
                (src / "alvo").rmdir()
                os.symlink(self.fora / "dentro", src / "alvo")
            return _Iteravel(entradas)

        with mock.patch.object(verificacao.os, "scandir", scandir_com_troca):
            verificacao._remover_por_fd(str(base))
        self.assertFora_intacto()
        self.assertTrue((self.fora / "dentro").is_dir())

    def test_base_symlink_nao_e_seguida_pela_remocao(self):
        os.symlink(self.fora, self.tmp / "fabrica-verif-link")
        verificacao._remover_por_fd(str(self.tmp / "fabrica-verif-link"))
        self.assertTrue(os.path.islink(self.tmp / "fabrica-verif-link"))
        self.assertFora_intacto()


class TestesLimparResiduos(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        patcher = mock.patch.object(tempfile, "tempdir", str(self.tmp))
        patcher.start()
        self.addCleanup(patcher.stop)

    def diretorio(self, nome, idade_s):
        caminho = self.tmp / nome
        caminho.mkdir()
        (caminho / "src").mkdir()
        (caminho / "src" / "f").write_text("x")
        os.chmod(caminho / "src", 0o500)
        instante = time.time() - idade_s
        os.utime(caminho, (instante, instante))
        return caminho

    def test_remove_conteineres_redes_e_diretorios_antigos_com_contagens(self):
        fake = DockerFalso()
        fake.respostas["ps"] = proc(0, "c1\nc2\nc3\n")
        fake.respostas["rede-ls"] = proc(0, "n1\nn2\n")
        velho = self.diretorio("fabrica-verif-velho", 3 * 3600)
        quase = self.diretorio("fabrica-verif-quase", 2 * 3600 - 60)
        novo = self.diretorio("fabrica-verif-novo", 5)
        outro = self.diretorio("outro-nome", 10 * 3600)
        arquivo = self.tmp / "fabrica-verif-arquivo"
        arquivo.write_text("x")
        os.utime(arquivo, (time.time() - 9 * 3600,) * 2)
        alvo = self.tmp / "alvo-do-link"
        alvo.mkdir()
        os.symlink(alvo, self.tmp / "fabrica-verif-link")
        os.utime(self.tmp / "fabrica-verif-link", (time.time() - 9 * 3600,) * 2, follow_symlinks=False)
        r = verificacao.limpar_residuos(executar=fake)
        self.assertEqual(r, {"conteineres": 3, "redes": 2, "diretorios": 1, "erros": []})
        self.assertEqual(
            [argv for argv, _ in fake.chamadas],
            [
                ["docker", "ps", "-aq", "--filter", "label=fabrica.verif=1"],
                ["docker", "rm", "-f", "-v", "c1", "c2", "c3"],
                ["docker", "network", "ls", "-q", "--filter", "label=fabrica.verif=1"],
                ["docker", "network", "rm", "n1", "n2"],
            ],
        )
        self.assertFalse(velho.exists())
        for ficou in (quase, novo, outro, arquivo, alvo):
            self.assertTrue(ficou.exists(), ficou)
        self.assertTrue(os.path.islink(self.tmp / "fabrica-verif-link"))

    def test_sem_residuos_nao_chama_remocao(self):
        fake = DockerFalso()
        fake.respostas["ps"] = proc(0, "")
        fake.respostas["rede-ls"] = proc(0, "\n")
        r = verificacao.limpar_residuos(executar=fake)
        self.assertEqual(r, {"conteineres": 0, "redes": 0, "diretorios": 0, "erros": []})
        self.assertEqual(fake.tipos(), ["ps", "rede-ls"])

    def test_docker_ausente_nao_lanca_e_ainda_limpa_diretorios(self):
        fake = DockerFalso()
        fake.respostas["ps"] = FileNotFoundError("docker")
        fake.respostas["rede-ls"] = subprocess.TimeoutExpired(["docker"], 1)
        velho = self.diretorio("fabrica-verif-velho", 5 * 3600)
        r = verificacao.limpar_residuos(executar=fake)
        self.assertEqual((r["conteineres"], r["redes"], r["diretorios"]), (0, 0, 1))
        self.assertEqual(len(r["erros"]), 2)
        self.assertFalse(velho.exists())

    def test_falha_de_listagem_ou_remocao_vira_erro_sem_contar(self):
        fake = DockerFalso()
        fake.respostas["ps"] = proc(0, "c1\n")
        fake.respostas["rm"] = proc(1, "", "boom")
        fake.respostas["rede-ls"] = proc(1, "", "daemon off")
        r = verificacao.limpar_residuos(executar=fake)
        self.assertEqual((r["conteineres"], r["redes"]), (0, 0))
        self.assertEqual(len(r["erros"]), 2)

    def test_diretorio_antigo_com_2000_niveis_e_removido_sem_excecao(self):
        self.addCleanup(remover_a_forca, self.tmp)
        fora = self.tmp / "fora"
        fora.mkdir()
        os.chmod(fora, 0o500)
        self.addCleanup(os.chmod, fora, 0o700)
        velho = self.tmp / "fabrica-verif-fundo"
        velho.mkdir()
        aninhar(velho, 2000, fora=fora)
        os.utime(velho, (time.time() - 3 * 3600,) * 2)
        fake = DockerFalso()
        fake.respostas["ps"] = proc(0, "")
        fake.respostas["rede-ls"] = proc(0, "")
        r = verificacao.limpar_residuos(executar=fake)
        self.assertEqual(r, {"conteineres": 0, "redes": 0, "diretorios": 1, "erros": []})
        self.assertFalse(os.path.lexists(velho))
        self.assertEqual(os.stat(fora).st_mode & 0o777, 0o500)

    def test_nunca_lanca_exception_e_segue_para_o_proximo_diretorio(self):
        primeiro = self.diretorio("fabrica-verif-a", 3 * 3600)
        segundo = self.diretorio("fabrica-verif-b", 3 * 3600)
        real = verificacao._apagar_diretorio

        def apagar(caminho):
            if os.path.basename(caminho) == "fabrica-verif-a":
                raise RecursionError("fundo demais")
            return real(caminho)

        fake = DockerFalso()
        fake.respostas["ps"] = proc(0, "")
        fake.respostas["rede-ls"] = proc(0, "")
        with mock.patch.object(verificacao, "_apagar_diretorio", apagar):
            r = verificacao.limpar_residuos(executar=fake)
        self.assertEqual(r["diretorios"], 1)
        self.assertEqual(r["erros"], ["diretório fabrica-verif-a (RecursionError)"])
        self.assertTrue(primeiro.exists())
        self.assertFalse(segundo.exists())

    def test_nunca_lanca_com_tempdir_quebrado_ou_listagem_estranha(self):
        fake = DockerFalso()
        fake.respostas["ps"] = types.SimpleNamespace(returncode=0, stdout=12345, stderr="")
        fake.respostas["rede-ls"] = proc(0, "")
        with mock.patch.object(verificacao.tempfile, "gettempdir", side_effect=FileNotFoundError("sem tmp")):
            r = verificacao.limpar_residuos(executar=fake)
        self.assertEqual((r["conteineres"], r["redes"], r["diretorios"]), (0, 0, 0))
        self.assertEqual(len(r["erros"]), 2, r["erros"])

    def test_nao_engole_base_exception(self):
        self.diretorio("fabrica-verif-a", 3 * 3600)
        fake = DockerFalso()
        fake.respostas["ps"] = proc(0, "")
        fake.respostas["rede-ls"] = proc(0, "")
        with mock.patch.object(verificacao, "_apagar_diretorio", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                verificacao.limpar_residuos(executar=fake)

    def test_assinatura_so_com_executar_nomeado(self):
        import inspect

        parametros = inspect.signature(verificacao.limpar_residuos).parameters
        self.assertEqual(list(parametros), ["executar"])
        self.assertEqual(parametros["executar"].kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertIs(parametros["executar"].default, subprocess.run)


def docker_real():
    """Imagem local com `sh` (busybox), ou `None` se o Docker não estiver disponível.

    Nunca baixa imagens: sem rede nos testes, só usa o que já existe no host.
    """
    try:
        if subprocess.run(["docker", "info"], capture_output=True, timeout=20).returncode != 0:
            return None
        for imagem in ("alpine:3.20", "node:26.5.1-alpine", "postgres:16-alpine"):
            achou = subprocess.run(["docker", "image", "inspect", imagem], capture_output=True, timeout=20)
            if achou.returncode == 0:
                return imagem
    except (OSError, subprocess.TimeoutExpired):
        return None
    return None


IMAGEM_REAL = docker_real()


def imagem_local_com_volume(imagem="postgres:16-alpine"):
    """`imagem` se ela já existir no host e declarar VOLUME; `None` caso contrário (nunca baixa)."""
    if not IMAGEM_REAL:
        return None
    try:
        achou = subprocess.run(
            ["docker", "image", "inspect", "-f", "{{len .Config.Volumes}}", imagem], capture_output=True, text=True, timeout=20
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return imagem if achou.returncode == 0 and achou.stdout.strip() not in ("", "0") else None


IMAGEM_COM_VOLUME = imagem_local_com_volume()


def ids_com_rotulo(tipo, ident):
    """Contêineres (`ps`) ou redes (`network`) com o rótulo do id desta chamada."""
    comando = ["docker", "ps", "-aq"] if tipo == "ps" else ["docker", "network", "ls", "-q"]
    return subprocess.run(
        comando + ["--filter", "label=fabrica.verif.id=" + ident], capture_output=True, text=True
    ).stdout.split()


@unittest.skipUnless(IMAGEM_REAL, "Docker ou imagem local indisponível (os testes nunca baixam imagens)")
class TestesVerificarComDockerReal(unittest.TestCase):
    """Docker de verdade, com repositório local. Cada teste só confere e remove o que ele mesmo criou."""

    def setUp(self):
        base = tempfile.TemporaryDirectory()
        self.addCleanup(base.cleanup)
        patcher = mock.patch.dict(
            os.environ, {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"}
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.base = pathlib.Path(base.name).resolve()
        # tempdir próprio: os diretórios deste teste não se misturam com os de ninguém.
        self.tmp = self.base / "tmp"
        self.tmp.mkdir()
        patcher = mock.patch.object(tempfile, "tempdir", str(self.tmp))
        patcher.start()
        self.addCleanup(patcher.stop)
        # ids próprios (aleatórios), para conferir e limpar só pelo rótulo do id.
        self.ids = []
        original = secrets.token_hex

        def gerar(n):
            self.ids.append(original(n))
            return self.ids[-1]

        patcher = mock.patch.object(verificacao.secrets, "token_hex", gerar)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.remover_por_rotulo)
        self.origem = self.base / "origem"
        self.origem.mkdir()
        git(self.origem, "init", "--quiet", "-b", "main")
        self.clone = self.base / "clone"
        self.cfg = {"imagem": IMAGEM_REAL, "shell": "sh"}
        self.sha_ok = self.commitar({"teste.sh": "exit 0\n", "a.txt": "a"})
        git(self.base, "clone", "--quiet", str(self.origem), str(self.clone))

    def remover_por_rotulo(self):
        for ident in self.ids:
            for cid in ids_com_rotulo("ps", ident):
                subprocess.run(["docker", "rm", "-f", cid], capture_output=True)
            for nid in ids_com_rotulo("network", ident):
                subprocess.run(["docker", "network", "rm", nid], capture_output=True)

    def commitar(self, arquivos):
        for nome, conteudo in arquivos.items():
            caminho = self.origem / nome
            caminho.parent.mkdir(parents=True, exist_ok=True)
            caminho.write_text(conteudo)
            git(self.origem, "add", nome)
        git(self.origem, "commit", "--quiet", "-m", "c")
        return git(self.origem, "rev-parse", "HEAD")

    def verificar(self, sha, comando, **kw):
        return verificacao.verificar(self.clone, sha, comando, conteiner=kw.pop("conteiner", self.cfg), **kw)

    def assertSemResiduos(self):
        self.assertTrue(self.ids, "nenhuma chamada foi feita")
        for ident in self.ids:
            self.assertEqual(ids_com_rotulo("ps", ident), [], ident)
            self.assertEqual(ids_com_rotulo("network", ident), [], ident)
        self.assertEqual(list(self.tmp.glob("fabrica-verif-*")), [])

    def test_commit_com_teste_que_falha_da_1_e_o_que_passa_da_0(self):
        sha_falha = self.commitar({"teste.sh": "echo falhando; exit 1\n"})
        r = self.verificar(sha_falha, "test -f teste.sh && sh teste.sh")
        self.assertEqual(r["codigo"], 1, r)
        self.assertIn("falhando", r["saida"])
        r = self.verificar(self.sha_ok, "test -f teste.sh && sh teste.sh")
        self.assertEqual(r["codigo"], 0, r)
        self.assertSemResiduos()

    def test_grava_arquivo_e_cria_diretorio_em_w_como_o_usuario_do_despachante(self):
        comando = "echo oi > /w/novo.txt && mkdir /w/novo_dir && echo x > /w/novo_dir/f && id -u && stat -c %u /w/novo.txt"
        r = self.verificar(self.sha_ok, comando)
        self.assertEqual(r["codigo"], 0, r)
        self.assertEqual(r["saida"].split(), [str(os.getuid()), str(os.getuid())])
        self.assertSemResiduos()

    def test_home_existe_e_e_gravavel_no_tmpfs(self):
        r = self.verificar(self.sha_ok, 'echo x > "$HOME/f" && cat "$HOME/f" && echo "$HOME"')
        self.assertEqual(r["codigo"], 0, r)
        self.assertEqual(r["saida"].split(), ["x", "/tmp/home"])

    def test_nao_ganha_capabilities_nem_privilegios(self):
        r = self.verificar(self.sha_ok, "grep -E 'CapEff|NoNewPrivs' /proc/self/status")
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("CapEff:\t0000000000000000", r["saida"])
        self.assertIn("NoNewPrivs:\t1", r["saida"])

    def test_adulterar_o_teste_numa_chamada_nao_afeta_a_seguinte(self):
        sha_falha = self.commitar({"teste.sh": "exit 1\n"})
        r = self.verificar(self.sha_ok, "echo 'exit 0' > teste.sh; echo x > sujeira.txt; sh teste.sh")
        self.assertEqual(r["codigo"], 0, r)
        r = self.verificar(sha_falha, "test ! -e sujeira.txt && sh teste.sh")
        self.assertEqual(r["codigo"], 1, r)
        self.assertSemResiduos()

    def test_processo_setsid_deixado_pelo_comando_nao_sobrevive(self):
        r = self.verificar(self.sha_ok, "setsid sh -c 'sleep 300' >/dev/null 2>&1 & setsid sh -c 'sleep 300' & echo iniciado")
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("iniciado", r["saida"])
        self.assertSemResiduos()

    def test_timeout_real_da_124_e_remove_o_conteiner(self):
        inicio = time.monotonic()
        r = self.verificar(self.sha_ok, "sleep 120", timeout_s=3)
        self.assertEqual(r["codigo"], 124, r)
        self.assertIn("tempo esgotado", r["saida"])
        self.assertLess(time.monotonic() - inicio, 60)
        self.assertSemResiduos()

    def test_comando_nao_ve_o_repositorio_nem_os_segredos_do_pai(self):
        segredos = {"GH_TOKEN": "ghp_segredo_gh", "ANTHROPIC_API_KEY": "sk-segredo", "WARREN_TOKEN_FILE": "/segredo/w"}
        comando = "env; test ! -e /w/.git && test ! -e '%s' && test ! -e '%s' && echo isolado" % (self.clone, self.origem)
        with mock.patch.dict(os.environ, segredos):
            r = self.verificar(self.sha_ok, comando)
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("isolado", r["saida"])
        for nome, valor in segredos.items():
            self.assertNotIn(nome, r["saida"])
            self.assertNotIn(valor, r["saida"])
        self.assertIn("CI=1", r["saida"])
        self.assertIn("LANG=C.UTF-8", r["saida"])
        self.assertSemResiduos()

    def test_nomes_do_docker_desktop_apontam_para_127_0_0_1(self):
        r = self.verificar(self.sha_ok, "grep -E 'host.docker.internal|gateway.docker.internal' /etc/hosts")
        self.assertEqual(r["codigo"], 0, r)
        for nome in ("host.docker.internal", "gateway.docker.internal"):
            self.assertRegex(r["saida"], r"127\.0\.0\.1\s+" + nome.replace(".", r"\."))

    def test_rede_isolada_funciona_e_e_removida(self):
        r = self.verificar(self.sha_ok, "echo ok", conteiner=dict(self.cfg, rede="isolada"))
        self.assertEqual(r["codigo"], 0, r)
        self.assertIn("ok", r["saida"])
        self.assertSemResiduos()

    def test_comando_nao_consegue_alterar_o_repositorio_do_host(self):
        antes = git(self.clone, "rev-parse", "HEAD")
        r = self.verificar(self.sha_ok, "echo x > /w/novo.txt; exit 0")
        self.assertEqual(r["codigo"], 0, r)
        self.assertEqual(git(self.clone, "rev-parse", "HEAD"), antes)
        self.assertEqual(git(self.clone, "status", "--porcelain"), "")

    def test_diretorios_sem_permissao_criados_no_conteiner_sao_removidos(self):
        comando = "mkdir -p d/e && echo x > d/e/f && chmod 000 d/e/f && chmod 000 d/e && chmod 555 d && touch g"
        r = self.verificar(self.sha_ok, comando)
        self.assertEqual(r["codigo"], 0, r)
        self.assertNotIn("erro na limpeza", r["saida"])
        self.assertSemResiduos()

    def test_saida_enorme_passa_pelo_streaming_e_e_cortada_em_4000_com_a_cauda(self):
        r = self.verificar(self.sha_ok, "head -c 3000000 /dev/zero | tr '\\0' x; echo; echo FIM")
        self.assertEqual(r["codigo"], 0, r)
        self.assertEqual(len(r["saida"]), 4000)
        self.assertTrue(r["saida"].endswith("xxx\nFIM\n"))

    @unittest.skipUnless(IMAGEM_COM_VOLUME, "sem imagem local com VOLUME (postgres:16-alpine); nunca baixa")
    def test_servico_com_volume_nao_deixa_volume_anonimo(self):
        # X: o Postgres declara VOLUME; `docker rm -f` sem `-v` deixaria um volume anônimo sem rótulo.
        criados = []

        def executar(argv, **kw):
            resultado = subprocess.run(argv, **kw)
            if argv[:3] == ["docker", "run", "-d"] and resultado.returncode == 0:
                nome = argv[argv.index("--name") + 1]
                formato = '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}'
                montagens = subprocess.run(["docker", "inspect", "-f", formato, nome], capture_output=True, text=True)
                criados.extend(montagens.stdout.split())
            return resultado

        def remover_os_meus():
            # Só os volumes que este teste criou (pelo id lido do próprio serviço), nunca os alheios.
            for volume in criados:
                if subprocess.run(["docker", "volume", "inspect", volume], capture_output=True).returncode == 0:
                    subprocess.run(["docker", "volume", "rm", "-f", volume], capture_output=True)

        self.addCleanup(remover_os_meus)
        antes = set(subprocess.run(["docker", "volume", "ls", "-q"], capture_output=True, text=True).stdout.split())
        cfg = dict(
            self.cfg,
            servicos=[{"nome": "db", "imagem": IMAGEM_COM_VOLUME, "env": {"POSTGRES_PASSWORD": "teste"}}],
        )
        r = self.verificar(self.sha_ok, "sh teste.sh", conteiner=cfg, executar=executar)
        self.assertEqual(r["codigo"], 0, r)
        self.assertEqual(len(criados), 1, criados)
        self.assertNotIn(criados[0], antes)
        depois = set(subprocess.run(["docker", "volume", "ls", "-q"], capture_output=True, text=True).stdout.split())
        self.assertEqual((depois - antes) & set(criados), set())
        self.assertNotEqual(subprocess.run(["docker", "volume", "inspect", criados[0]], capture_output=True).returncode, 0)
        self.assertSemResiduos()

    def test_exportacao_ignora_gitattributes_e_replace_do_repositorio(self):
        (self.origem / "tests").mkdir()
        sha = self.commitar(
            {".gitattributes": "tests/ export-ignore\n* text eol=crlf\n", "tests/falha.sh": "exit 1\n", "v.txt": "um\ndois\n"}
        )
        r = self.verificar(sha, "sh tests/falha.sh")
        self.assertEqual(r["codigo"], 1, r)
        r = self.verificar(sha, "test \"$(wc -c < v.txt)\" = 8")
        self.assertEqual(r["codigo"], 0, r)

    def test_hooks_plantados_no_repo_nao_rodam_no_fetch(self):
        marcador = self.base / "marcador.txt"
        for nome in ("reference-transaction", "post-checkout", "post-merge"):
            hook = self.clone / ".git" / "hooks" / nome
            hook.write_text("#!/bin/sh\necho executou >> '%s'\n" % marcador)
            hook.chmod(0o755)
        sha = self.commitar({"b.txt": "b"})
        r = self.verificar(sha, "test -f b.txt")
        self.assertEqual(r["codigo"], 0, r)
        self.assertFalse(marcador.exists())

    def test_sem_remoto_origin_o_fetch_falha_com_codigo_do_git(self):
        sem_remoto = self.base / "sem"
        sem_remoto.mkdir()
        git(sem_remoto, "init", "--quiet")
        r = verificacao.verificar(sem_remoto, self.sha_ok, "true", conteiner=self.cfg)
        self.assertNotEqual(r["codigo"], 0)
        self.assertTrue(r["saida"])
        self.assertEqual(self.ids, [])
        self.assertEqual(list(self.tmp.glob("fabrica-verif-*")), [])


if __name__ == "__main__":
    unittest.main()
