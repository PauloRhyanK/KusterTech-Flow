import json
import multiprocessing
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import capacidade as cap  # noqa: E402

PADRAO = {
    "vagasConfig": 3,
    "ramMinimaMb": 2048,
    "oomEm": None,
    "reservas": {},
    "orquestrador": {},
    "esperando": {},
    "drenagem": None,
}


def _disputar(caminho, plano, barreira, fila):
    """Processo filho: espera a largada e tenta reservar a única vaga."""
    barreira.wait(timeout=30)
    fila.put((plano, cap.reservar(caminho, plano, "raia", mem_disponivel_mb=None)))


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.caminho = pathlib.Path(self._tmp.name) / "capacidade.json"


class TestesLeitura(Base):
    def test_arquivo_ausente_devolve_o_padrao(self):
        self.assertEqual(cap.ler(self.caminho), PADRAO)

    def test_arquivo_ausente_nao_e_criado_pela_leitura(self):
        cap.ler(self.caminho)
        self.assertFalse(self.caminho.exists())

    def test_arquivo_corrompido_levanta_capacidade_invalida(self):
        self.caminho.write_text("{isso nao e json", encoding="utf-8")
        with self.assertRaises(cap.CapacidadeInvalida):
            cap.ler(self.caminho)

    def test_json_que_nao_e_objeto_levanta_capacidade_invalida(self):
        self.caminho.write_text("[1, 2]", encoding="utf-8")
        with self.assertRaises(cap.CapacidadeInvalida):
            cap.ler(self.caminho)

    def test_tipos_errados_levantam_capacidade_invalida(self):
        for ruim in (
            {"vagasConfig": "3"},
            {"vagasConfig": True},
            {"ramMinimaMb": 1.5},
            {"oomEm": 5},
            {"oomEm": ""},
            {"vagasConfig": 0},
            {"vagasConfig": -1},
            {"ramMinimaMb": -1},
            {"ramMinimaMb": True},
            {"orquestrador": []},
            {"reservas": []},
            {"reservas": {"p": "raia"}},
            {"reservas": {"p": [1]}},
            {"orquestrador": {"r": 1}},
            {"esperando": []},
            {"esperando": {"r": "A"}},
            {"esperando": {"r": [1]}},
            {"esperando": {"Dono/Repo": ["A"], "dono/repo": ["B"]}},
            {"drenagem": 5},
            {"drenagem": ""},
            {"drenagem": {"desde": "x"}},
        ):
            with self.subTest(ruim=ruim):
                self.caminho.write_text(json.dumps(ruim), encoding="utf-8")
                with self.assertRaises(cap.CapacidadeInvalida):
                    cap.ler(self.caminho)

    def test_utf8_invalido_levanta_capacidade_invalida(self):
        self.caminho.write_bytes(b'{"vagasConfig": 3, "oomEm": "\xff\xfe"}')
        with self.assertRaises(cap.CapacidadeInvalida):
            cap.ler(self.caminho)

    def test_chaves_de_orquestrador_sao_normalizadas_para_minusculas_ao_ler(self):
        self.caminho.write_text(
            json.dumps({"orquestrador": {"Dono/Repo": "A"}}), encoding="utf-8"
        )
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "A"})

    def test_chaves_de_orquestrador_que_colidem_levantam_capacidade_invalida(self):
        self.caminho.write_text(
            json.dumps({"orquestrador": {"Dono/Repo": "A", "dono/repo": "A"}}),
            encoding="utf-8",
        )
        with self.assertRaises(cap.CapacidadeInvalida):
            cap.ler(self.caminho)

    def test_tomar_e_soltar_enxergam_trava_escrita_a_mao_em_maiusculas(self):
        self.caminho.write_text(
            json.dumps({"orquestrador": {"Dono/Repo": "A"}}), encoding="utf-8"
        )
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "B"))
        cap.soltar_orquestrador(self.caminho, "DONO/REPO", "B")
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "A"})
        cap.soltar_orquestrador(self.caminho, "dono/repo", "A")
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {})
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "B"))

    def test_raias_duplicadas_na_reserva_sao_normalizadas_ao_ler(self):
        self.caminho.write_text(
            json.dumps({"reservas": {"p": ["b", "a", "b"]}}), encoding="utf-8"
        )
        self.assertEqual(cap.ler(self.caminho)["reservas"], {"p": ["a", "b"]})

    def test_chaves_ausentes_recebem_o_padrao(self):
        self.caminho.write_text(json.dumps({"vagasConfig": 5}), encoding="utf-8")
        esperado = dict(PADRAO, vagasConfig=5)
        self.assertEqual(cap.ler(self.caminho), esperado)

    def test_escrita_sobre_arquivo_corrompido_nao_o_recria(self):
        self.caminho.write_text("{ruim", encoding="utf-8")
        with self.assertRaises(cap.CapacidadeInvalida):
            cap.reservar(self.caminho, "p", "a", mem_disponivel_mb=None)
        self.assertEqual(self.caminho.read_text(encoding="utf-8"), "{ruim")


class TestesVagas(Base):
    def test_quarta_reserva_de_outro_plano_e_recusada(self):
        for plano in ("p1", "p2", "p3"):
            self.assertTrue(cap.reservar(self.caminho, plano, "a", mem_disponivel_mb=None))
        self.assertFalse(cap.reservar(self.caminho, "p4", "a", mem_disponivel_mb=None))
        self.assertEqual(sorted(cap.ler(self.caminho)["reservas"]), ["p1", "p2", "p3"])

    def test_reservas_de_um_mesmo_plano_somam_no_total(self):
        self.assertTrue(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=None))
        self.assertTrue(cap.reservar(self.caminho, "p1", "b", mem_disponivel_mb=None))
        self.assertTrue(cap.reservar(self.caminho, "p2", "a", mem_disponivel_mb=None))
        self.assertFalse(cap.reservar(self.caminho, "p1", "c", mem_disponivel_mb=None))

    def test_reservar_repetido_nao_consome_segunda_vaga(self):
        for _ in range(5):
            self.assertTrue(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=None))
        self.assertEqual(cap.ler(self.caminho)["reservas"], {"p1": ["a"]})
        self.assertTrue(cap.reservar(self.caminho, "p2", "a", mem_disponivel_mb=None))
        self.assertTrue(cap.reservar(self.caminho, "p3", "a", mem_disponivel_mb=None))

    def test_reserva_repetida_vale_mesmo_com_tudo_ocupado(self):
        for plano in ("p1", "p2", "p3"):
            cap.reservar(self.caminho, plano, "a", mem_disponivel_mb=None)
        self.assertTrue(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=None))

    def test_ram_abaixo_do_minimo_recusa(self):
        self.assertFalse(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=1500))
        self.assertEqual(cap.ler(self.caminho)["reservas"], {})

    def test_reserva_repetida_da_mesma_raia_com_ram_baixa_continua_valendo(self):
        self.assertTrue(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=4096))
        self.assertTrue(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=100))
        self.assertEqual(cap.ler(self.caminho)["reservas"], {"p1": ["a"]})

    def test_raia_nova_com_ram_baixa_e_recusada(self):
        self.assertTrue(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=4096))
        self.assertFalse(cap.reservar(self.caminho, "p1", "b", mem_disponivel_mb=100))
        self.assertEqual(cap.ler(self.caminho)["reservas"], {"p1": ["a"]})

    def test_ram_exatamente_no_minimo_aceita(self):
        self.assertTrue(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=2048))

    def test_ram_desconhecida_aceita(self):
        self.assertTrue(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=None))

    def test_ram_minima_vem_da_configuracao(self):
        cap.configurar(self.caminho, vagas=3, ram_minima_mb=4096)
        self.assertFalse(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=3000))
        self.assertTrue(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=4096))

    def test_vagas_efetivas_sem_oom_e_a_configurada(self):
        self.assertEqual(cap.vagas_efetivas(cap.ler(self.caminho)), 3)
        self.assertEqual(cap.vagas_efetivas({"vagasConfig": 5, "oomEm": None}), 5)

    def test_oom_limita_a_duas_vagas(self):
        cap.registrar_oom(self.caminho, "2026-11-03T10:00:00Z")
        dados = cap.ler(self.caminho)
        self.assertEqual(dados["oomEm"], "2026-11-03T10:00:00Z")
        self.assertEqual(cap.vagas_efetivas(dados), 2)

    def test_oom_nao_aumenta_vagas_configuradas_menores(self):
        cap.configurar(self.caminho, vagas=1, ram_minima_mb=2048)
        cap.registrar_oom(self.caminho, "agora")
        self.assertEqual(cap.vagas_efetivas(cap.ler(self.caminho)), 1)

    def test_oom_faz_a_terceira_reserva_ser_recusada(self):
        cap.registrar_oom(self.caminho, "agora")
        self.assertTrue(cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=None))
        self.assertTrue(cap.reservar(self.caminho, "p2", "a", mem_disponivel_mb=None))
        self.assertFalse(cap.reservar(self.caminho, "p3", "a", mem_disponivel_mb=None))

    def test_configurar_volta_as_vagas_e_limpa_o_oom(self):
        cap.registrar_oom(self.caminho, "agora")
        cap.configurar(self.caminho, vagas=3, ram_minima_mb=2048)
        dados = cap.ler(self.caminho)
        self.assertIsNone(dados["oomEm"])
        self.assertEqual(cap.vagas_efetivas(dados), 3)

    def test_configurar_preserva_reservas_e_travas(self):
        cap.reservar(self.caminho, "p1", "a", mem_disponivel_mb=None)
        cap.tomar_orquestrador(self.caminho, "dono/repo", "p1")
        cap.configurar(self.caminho, vagas=4, ram_minima_mb=1024)
        dados = cap.ler(self.caminho)
        self.assertEqual(dados["reservas"], {"p1": ["a"]})
        self.assertEqual(dados["orquestrador"], {"dono/repo": "p1"})
        self.assertEqual((dados["vagasConfig"], dados["ramMinimaMb"]), (4, 1024))

    def test_configurar_regrava_arquivo_corrompido_a_partir_dos_padroes(self):
        corrompidos = (
            b"{isso nao e json",
            b'{"oomEm": "\xff"}',
            b'{"reservas": []}',
            b"[1]",
        )
        for conteudo in corrompidos:
            with self.subTest(conteudo=conteudo):
                self.caminho.write_bytes(conteudo)
                cap.configurar(self.caminho, vagas=5, ram_minima_mb=1024)
                esperado = dict(PADRAO, vagasConfig=5, ramMinimaMb=1024)
                self.assertEqual(cap.ler(self.caminho), esperado)

    def test_configurar_arquivo_corrompido_zera_oom_reservas_e_travas(self):
        self.caminho.write_text(
            json.dumps({"vagasConfig": "x", "oomEm": "ontem", "reservas": {"p": ["a"]}}),
            encoding="utf-8",
        )
        cap.configurar(self.caminho, vagas=3, ram_minima_mb=2048)
        self.assertEqual(cap.ler(self.caminho), PADRAO)

    def test_configurar_rejeita_valores_invalidos(self):
        for vagas, ram in (
            (0, 2048),
            (-1, 2048),
            (3, -1),
            ("3", 2048),
            (3, None),
            (True, 2048),
            (3, True),
        ):
            with self.subTest(vagas=vagas, ram=ram):
                with self.assertRaises(ValueError):
                    cap.configurar(self.caminho, vagas=vagas, ram_minima_mb=ram)

    def test_sincronizar_libera_a_vaga(self):
        for plano in ("p1", "p2", "p3"):
            cap.reservar(self.caminho, plano, "a", mem_disponivel_mb=None)
        self.assertFalse(cap.reservar(self.caminho, "p4", "a", mem_disponivel_mb=None))
        cap.sincronizar(self.caminho, "p1", set())
        self.assertNotIn("p1", cap.ler(self.caminho)["reservas"])
        self.assertTrue(cap.reservar(self.caminho, "p4", "a", mem_disponivel_mb=None))

    def test_sincronizar_grava_o_conjunto_ordenado(self):
        cap.sincronizar(self.caminho, "p1", {"b", "a"})
        self.assertEqual(cap.ler(self.caminho)["reservas"], {"p1": ["a", "b"]})
        cap.sincronizar(self.caminho, "p1", {"c"})
        self.assertEqual(cap.ler(self.caminho)["reservas"], {"p1": ["c"]})

    def test_sincronizar_vazio_sem_reserva_nao_cria_chave(self):
        cap.sincronizar(self.caminho, "p1", set())
        self.assertEqual(cap.ler(self.caminho)["reservas"], {})

    def test_sincronizar_nao_mexe_nos_outros_planos(self):
        cap.reservar(self.caminho, "p2", "x", mem_disponivel_mb=None)
        cap.sincronizar(self.caminho, "p1", {"a"})
        self.assertEqual(cap.ler(self.caminho)["reservas"], {"p1": ["a"], "p2": ["x"]})


class TestesOrquestrador(Base):
    def test_trava_livre_e_tomada(self):
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "A"))
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "A"})

    def test_trava_do_proprio_plano_e_idempotente(self):
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "A"))
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "A"))

    def test_outro_plano_no_mesmo_repositorio_nao_toma(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "A")
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "B"))
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "A"})

    def test_repositorio_e_comparado_em_minusculas(self):
        cap.tomar_orquestrador(self.caminho, "Dono/Repo", "A")
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "B"))
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "A"})

    def test_repositorio_diferente_toma(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "A")
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/outro", "B"))

    def test_soltar_de_outro_plano_nao_solta(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "A")
        cap.soltar_orquestrador(self.caminho, "dono/repo", "B")
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "A"})

    def test_soltar_do_dono_libera_para_o_outro(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "A")
        cap.soltar_orquestrador(self.caminho, "Dono/Repo", "A")
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {})
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "B"))

    def test_soltar_sem_trava_nao_falha(self):
        cap.soltar_orquestrador(self.caminho, "dono/repo", "A")
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {})


class TestesEsperaDoOrquestrador(Base):
    def espera(self, repo="dono/repo"):
        return cap.ler(self.caminho)["esperando"].get(repo)

    def test_fifo_de_tres_planos(self):
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "A"))
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "B"))
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "C"))
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "B"))  # entra uma vez só
        self.assertEqual(self.espera(), ["B", "C"])
        cap.soltar_orquestrador(self.caminho, "dono/repo", "A")
        self.assertEqual(self.espera(), ["B", "C"])  # soltar não mexe na espera
        # com a trava livre, só o primeiro da espera toma
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "C"))
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "Dono/Repo", "A"))
        self.assertEqual(self.espera(), ["B", "C", "A"])
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {})
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "B"))
        self.assertEqual(self.espera(), ["C", "A"])
        cap.soltar_orquestrador(self.caminho, "dono/repo", "B")
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "A"))
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "C"))
        cap.soltar_orquestrador(self.caminho, "dono/repo", "C")
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "A"))
        self.assertIsNone(self.espera())
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "A"})

    def test_espera_vazia_deixa_qualquer_um_tomar(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "A")
        cap.soltar_orquestrador(self.caminho, "dono/repo", "A")
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "B"))

    def test_espera_e_por_repositorio(self):
        cap.tomar_orquestrador(self.caminho, "dono/r1", "A")
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/r1", "B"))
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/r2", "C"))
        self.assertEqual(cap.ler(self.caminho)["esperando"], {"dono/r1": ["B"]})

    def test_dono_que_reafirma_nao_entra_na_espera(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "A")
        cap.tomar_orquestrador(self.caminho, "dono/repo", "B")
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "A"))
        self.assertEqual(self.espera(), ["B"])

    def test_espera_escrita_a_mao_e_normalizada_ao_ler(self):
        self.caminho.write_text(json.dumps({"esperando": {"Dono/Repo": ["B", "C", "B"]}}), encoding="utf-8")
        self.assertEqual(cap.ler(self.caminho)["esperando"], {"dono/repo": ["B", "C"]})
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "C"))
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "B"))

    def test_desistir_tira_da_espera_sem_mexer_na_trava(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "A")
        cap.tomar_orquestrador(self.caminho, "dono/repo", "B")
        cap.tomar_orquestrador(self.caminho, "dono/repo", "C")
        cap.desistir_orquestrador(self.caminho, "Dono/Repo", "B")
        self.assertEqual(self.espera(), ["C"])
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "A"})
        cap.desistir_orquestrador(self.caminho, "dono/repo", "A")  # o dono não está na espera: nada muda
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "A"})
        cap.desistir_orquestrador(self.caminho, "dono/repo", "C")
        self.assertIsNone(self.espera())
        self.assertEqual(cap.ler(self.caminho)["esperando"], {})
        cap.desistir_orquestrador(self.caminho, "dono/repo", "C")  # idempotente
        cap.desistir_orquestrador(self.caminho, "dono/outro", "C")
        self.assertEqual(cap.ler(self.caminho)["esperando"], {})

    def test_primeiro_que_desiste_deixa_o_seguinte_tomar(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "A")
        cap.tomar_orquestrador(self.caminho, "dono/repo", "B")
        cap.tomar_orquestrador(self.caminho, "dono/repo", "C")
        cap.soltar_orquestrador(self.caminho, "dono/repo", "A")
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "C"))
        cap.desistir_orquestrador(self.caminho, "dono/repo", "B")
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "C"))

    def test_em_curso_toma_a_trava_livre_fora_da_ordem(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "X")
        cap.tomar_orquestrador(self.caminho, "dono/repo", "B")
        cap.tomar_orquestrador(self.caminho, "dono/repo", "A")
        cap.soltar_orquestrador(self.caminho, "dono/repo", "X")
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "A"))
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "A", em_curso=True))
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "A"})
        self.assertEqual(self.espera(), ["B"])

    def test_em_curso_nao_toma_trava_de_outro_nem_entra_na_espera(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "B")
        self.assertFalse(cap.tomar_orquestrador(self.caminho, "dono/repo", "A", em_curso=True))
        self.assertEqual(cap.ler(self.caminho)["orquestrador"], {"dono/repo": "B"})
        self.assertIsNone(self.espera())
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "B", em_curso=True))

    def test_orfao_sai_da_espera(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "vivo")
        cap.tomar_orquestrador(self.caminho, "dono/repo", "morto")
        cap.tomar_orquestrador(self.caminho, "dono/repo", "outro")
        cap.tomar_orquestrador(self.caminho, "dono/r2", "x")
        cap.tomar_orquestrador(self.caminho, "dono/r2", "morto")
        self.assertEqual(sorted(cap.limpar_orfaos(self.caminho, {"vivo", "outro", "x"})), ["morto"])
        self.assertEqual(cap.ler(self.caminho)["esperando"], {"dono/repo": ["outro"]})
        cap.soltar_orquestrador(self.caminho, "dono/repo", "vivo")
        self.assertTrue(cap.tomar_orquestrador(self.caminho, "dono/repo", "outro"))

    def test_orfao_so_na_espera_sai_e_a_espera_vazia_some(self):
        cap.tomar_orquestrador(self.caminho, "dono/repo", "vivo")
        cap.tomar_orquestrador(self.caminho, "dono/repo", "morto")
        self.assertEqual(cap.limpar_orfaos(self.caminho, {"vivo"}), ["morto"])
        self.assertEqual(cap.ler(self.caminho)["esperando"], {})


class TestesOrfaos(Base):
    def test_remove_reservas_e_travas_de_planos_fora_dos_ativos(self):
        cap.reservar(self.caminho, "vivo", "a", mem_disponivel_mb=None)
        cap.reservar(self.caminho, "morto", "a", mem_disponivel_mb=None)
        cap.tomar_orquestrador(self.caminho, "dono/r1", "vivo")
        cap.tomar_orquestrador(self.caminho, "dono/r2", "morto")
        cap.tomar_orquestrador(self.caminho, "dono/r3", "fantasma")
        removidos = cap.limpar_orfaos(self.caminho, {"vivo"})
        self.assertEqual(sorted(removidos), ["fantasma", "morto"])
        dados = cap.ler(self.caminho)
        self.assertEqual(dados["reservas"], {"vivo": ["a"]})
        self.assertEqual(dados["orquestrador"], {"dono/r1": "vivo"})

    def test_plano_que_aparece_nos_dois_lugares_sai_uma_vez(self):
        cap.reservar(self.caminho, "morto", "a", mem_disponivel_mb=None)
        cap.tomar_orquestrador(self.caminho, "dono/r", "morto")
        self.assertEqual(cap.limpar_orfaos(self.caminho, set()), ["morto"])

    def test_nada_a_remover_devolve_lista_vazia(self):
        cap.reservar(self.caminho, "vivo", "a", mem_disponivel_mb=None)
        self.assertEqual(cap.limpar_orfaos(self.caminho, {"vivo"}), [])
        self.assertEqual(cap.limpar_orfaos(self.caminho, {"vivo", "outro"}), [])


class TestesDrenagem(Base):
    """Ruling da Task 6: o coordenador avisa os despachantes de plano que o Warren está drenando."""

    def test_padrao_e_sem_drenagem(self):
        self.assertIsNone(cap.ler(self.caminho)["drenagem"])

    def test_definir_e_limpar(self):
        cap.definir_drenagem(self.caminho, "2026-11-03T12:00:00Z")
        self.assertEqual(cap.ler(self.caminho)["drenagem"], "2026-11-03T12:00:00Z")
        cap.definir_drenagem(self.caminho, None)
        self.assertIsNone(cap.ler(self.caminho)["drenagem"])

    def test_nao_mexe_no_resto(self):
        cap.reservar(self.caminho, "p", "a", mem_disponivel_mb=None)
        cap.tomar_orquestrador(self.caminho, "dono/r", "p")
        cap.definir_drenagem(self.caminho, "2026-11-03T12:00:00Z")
        dados = cap.ler(self.caminho)
        self.assertEqual(dados["reservas"], {"p": ["a"]})
        self.assertEqual(dados["orquestrador"], {"dono/r": "p"})

    def test_valor_invalido_levanta_value_error_e_nao_grava(self):
        for ruim in ("", 5, {"desde": "x"}):
            with self.subTest(ruim=ruim):
                with self.assertRaises(ValueError):
                    cap.definir_drenagem(self.caminho, ruim)
        self.assertFalse(self.caminho.exists())

    def test_arquivo_corrompido_levanta_e_nao_e_recriado(self):
        self.caminho.write_text("{ruim", encoding="utf-8")
        with self.assertRaises(cap.CapacidadeInvalida):
            cap.definir_drenagem(self.caminho, None)
        self.assertEqual(self.caminho.read_text(encoding="utf-8"), "{ruim")

    def test_configurar_e_limpar_orfaos_preservam_a_drenagem(self):
        cap.definir_drenagem(self.caminho, "2026-11-03T12:00:00Z")
        cap.configurar(self.caminho, vagas=3, ram_minima_mb=2048)
        cap.limpar_orfaos(self.caminho, set())
        self.assertEqual(cap.ler(self.caminho)["drenagem"], "2026-11-03T12:00:00Z")


class TestesConcorrencia(Base):
    def test_dois_processos_disputam_uma_vaga_e_um_so_vence(self):
        ctx = multiprocessing.get_context("spawn")
        for rodada in range(20):
            caminho = pathlib.Path(self._tmp.name) / ("cap-%d.json" % rodada)
            cap.configurar(caminho, vagas=1, ram_minima_mb=0)
            barreira = ctx.Barrier(2)
            fila = ctx.Queue()
            procs = [
                ctx.Process(target=_disputar, args=(str(caminho), plano, barreira, fila))
                for plano in ("A", "B")
            ]
            for proc in procs:
                proc.start()
            resultados = dict(fila.get(timeout=60) for _ in procs)
            for proc in procs:
                proc.join(timeout=60)
                self.assertEqual(proc.exitcode, 0)
            with self.subTest(rodada=rodada):
                self.assertEqual(sorted(resultados.values()), [False, True])
                reservas = cap.ler(caminho)["reservas"]
                self.assertEqual(len(reservas), 1)
                vencedor = [p for p, ok in resultados.items() if ok][0]
                self.assertEqual(reservas, {vencedor: ["raia"]})


class TestesMemoria(Base):
    def _meminfo(self, texto):
        arquivo = pathlib.Path(self._tmp.name) / "meminfo"
        arquivo.write_text(texto, encoding="utf-8")
        return arquivo

    def test_le_memavailable_em_mb(self):
        arquivo = self._meminfo(
            "MemTotal:       16384000 kB\n"
            "MemFree:         1000000 kB\n"
            "MemAvailable:    3145728 kB\n"
            "Buffers:           10000 kB\n"
        )
        self.assertEqual(cap.mem_disponivel_mb(str(arquivo)), 3072)

    def test_arquivo_ausente_devolve_none(self):
        self.assertIsNone(cap.mem_disponivel_mb(str(pathlib.Path(self._tmp.name) / "nada")))

    def test_sem_memavailable_devolve_none(self):
        arquivo = self._meminfo("MemTotal: 100 kB\nMemFree: 50 kB\n")
        self.assertIsNone(cap.mem_disponivel_mb(str(arquivo)))

    def test_valor_ilegivel_devolve_none(self):
        arquivo = self._meminfo("MemAvailable: muito kB\n")
        self.assertIsNone(cap.mem_disponivel_mb(str(arquivo)))


if __name__ == "__main__":
    unittest.main()
