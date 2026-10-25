import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import {
  consultarBloqueio,
  POLITICA_TENTATIVAS,
  registrarFalhaPersistida,
} from '@/lib/auth/tentativas'
import { db } from '@/lib/db'
import { autenticar, criarUsuario, normalizarEmail } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

let usuarioPauloId = ''
let clienteAcmeId = ''
let clienteBetaId = ''

beforeEach(async () => {
  await limparBanco()

  const acme = await db.cliente.create({
    data: {
      nome: 'Acme',
      nomeNormalizado: 'acme',
    },
  })
  clienteAcmeId = acme.id

  const beta = await db.cliente.create({
    data: {
      nome: 'Beta',
      nomeNormalizado: 'beta',
    },
  })
  clienteBetaId = beta.id

  const criado = await criarUsuario({
    email: 'paulo@exemplo.com',
    nome: 'Paulo',
    senha: 'senha-forte-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  usuarioPauloId = criado.id
})

afterAll(async () => {
  await db.$disconnect()
})

describe('autenticação e usuários (integração)', () => {
  test('autentica com e-mail em maiúsculas e espaços', async () => {
    expect(normalizarEmail(' Paulo@Exemplo.com ')).toBe('paulo@exemplo.com')
    const resultado = await autenticar({
      email: ' Paulo@Exemplo.com ',
      senha: 'senha-forte-123',
      ip: '1.1.1.1',
    })
    expect(resultado).toEqual({ ok: true, usuarioId: usuarioPauloId })
  })

  test('senha errada devolve credenciais e não revela se o e-mail existe', async () => {
    const a = await autenticar({ email: 'paulo@exemplo.com', senha: 'x', ip: '1.1.1.1' })
    const b = await autenticar({ email: 'ninguem@exemplo.com', senha: 'x', ip: '1.1.1.1' })
    expect(a).toEqual({ ok: false, motivo: 'credenciais' })
    expect(b).toEqual(a)
  })

  test('quinta falha bloqueia a conta por 15 minutos e a sexta tentativa correta é recusada', async () => {
    const t0 = new Date('2026-10-23T12:00:00Z')
    const bloqueadoAteEsperado = new Date(t0.getTime() + POLITICA_TENTATIVAS.bloqueioMs)

    for (let i = 0; i < POLITICA_TENTATIVAS.maxPorConta; i++) {
      const falha = await autenticar(
        { email: 'paulo@exemplo.com', senha: 'errada', ip: `10.0.0.${i + 1}` },
        t0,
      )
      expect(falha).toEqual({ ok: false, motivo: 'credenciais' })
    }

    const sextaComSenhaCerta = await autenticar(
      { email: 'paulo@exemplo.com', senha: 'senha-forte-123', ip: '10.0.0.99' },
      t0,
    )
    expect(sextaComSenhaCerta).toEqual({
      ok: false,
      motivo: 'bloqueado',
      bloqueadoAte: bloqueadoAteEsperado,
    })

    // Conta inexistente também sofre o mesmo bloqueio por conta sem revelar se existe
    for (let i = 0; i < POLITICA_TENTATIVAS.maxPorConta; i++) {
      await autenticar(
        { email: 'inexistente@exemplo.com', senha: 'errada', ip: `10.1.0.${i + 1}` },
        t0,
      )
    }
    const bloqueioInexistente = await autenticar(
      { email: 'inexistente@exemplo.com', senha: 'errada', ip: '10.1.0.99' },
      t0,
    )
    expect(bloqueioInexistente).toEqual({
      ok: false,
      motivo: 'bloqueado',
      bloqueadoAte: bloqueadoAteEsperado,
    })

    // Após 15 minutos, o bloqueio expira e a senha certa autentica
    const aposBloqueio = await autenticar(
      { email: 'paulo@exemplo.com', senha: 'senha-forte-123', ip: '10.0.0.99' },
      bloqueadoAteEsperado,
    )
    expect(aposBloqueio).toEqual({ ok: true, usuarioId: usuarioPauloId })
  })

  test('vigésima falha por IP bloqueia o IP para qualquer conta', async () => {
    const t0 = new Date('2026-10-23T13:00:00Z')
    const ip = '203.0.113.50'

    for (let i = 0; i < POLITICA_TENTATIVAS.maxPorIp; i++) {
      const falha = await autenticar({ email: `conta-${i}@exemplo.com`, senha: 'errada', ip }, t0)
      expect(falha).toEqual({ ok: false, motivo: 'credenciais' })
    }

    const tentativa21 = await autenticar(
      { email: 'paulo@exemplo.com', senha: 'senha-forte-123', ip },
      t0,
    )
    expect(tentativa21).toEqual({
      ok: false,
      motivo: 'bloqueado',
      bloqueadoAte: new Date(t0.getTime() + POLITICA_TENTATIVAS.bloqueioMs),
    })
  })

  test('usuário inativo não autentica', async () => {
    await db.usuario.update({
      where: { id: usuarioPauloId },
      data: { ativo: false },
    })

    const resultado = await autenticar({
      email: 'paulo@exemplo.com',
      senha: 'senha-forte-123',
      ip: '1.1.1.1',
    })
    expect(resultado).toEqual({ ok: false, motivo: 'credenciais' })
  })

  test('criarUsuario rejeita senha curta, rejeita e-mail repetido e deduplica papéis', async () => {
    await expect(
      criarUsuario({
        email: 'curta@exemplo.com',
        nome: 'Curta',
        senha: '11-caracter',
        papeis: [{ papel: 'TESTADOR', clienteId: null }],
      }),
    ).rejects.toThrow(/12 caracteres/)

    await expect(
      criarUsuario({
        email: ' PAULO@Exemplo.com ',
        nome: 'Paulo Duplicado',
        senha: 'senha-forte-123',
        papeis: [{ papel: 'ADMIN', clienteId: null }],
      }),
    ).rejects.toThrow(/Já existe/)

    const novo = await criarUsuario({
      email: ' Maria@Exemplo.com ',
      nome: 'Maria',
      senha: 'senha-muito-forte-123',
      papeis: [
        { papel: 'ADMIN', clienteId: null },
        { papel: 'ADMIN', clienteId: null },
        { papel: 'APROVADOR', clienteId: clienteAcmeId },
        { papel: 'APROVADOR', clienteId: clienteAcmeId },
        { papel: 'APROVADOR', clienteId: clienteBetaId },
      ],
    })

    const papeisGravados = await db.usuarioPapel.findMany({
      where: { usuarioId: novo.id },
    })
    expect(papeisGravados).toHaveLength(3)
  })

  test('sucesso de login limpa a chave da conta e não a do IP', async () => {
    const t0 = new Date('2026-10-23T14:00:00Z')
    const ip = '198.51.100.7'

    for (let i = 0; i < 4; i++) {
      await autenticar({ email: 'paulo@exemplo.com', senha: 'errada', ip }, t0)
    }

    const antesConta = await db.tentativaLogin.findUnique({
      where: { chave: 'conta:paulo@exemplo.com' },
    })
    const antesIp = await db.tentativaLogin.findUnique({
      where: { chave: `ip:${ip}` },
    })
    expect(antesConta?.contagem).toBe(4)
    expect(antesIp?.contagem).toBe(4)

    const sucesso = await autenticar(
      { email: 'paulo@exemplo.com', senha: 'senha-forte-123', ip },
      t0,
    )
    expect(sucesso.ok).toBe(true)

    const depoisConta = await db.tentativaLogin.findUnique({
      where: { chave: 'conta:paulo@exemplo.com' },
    })
    const depoisIp = await db.tentativaLogin.findUnique({
      where: { chave: `ip:${ip}` },
    })
    expect(depoisConta).toBeNull()
    expect(depoisIp?.contagem).toBe(4)
  })

  test('persistência preserva bloqueio ativo ao abrir nova janela', async () => {
    const t0 = new Date('2026-10-23T15:00:00Z')
    const chave = 'conta:bloqueio-janela@exemplo.com'

    for (let i = 0; i < 4; i++) {
      await registrarFalhaPersistida(chave, POLITICA_TENTATIVAS.maxPorConta, t0)
    }
    const quintaEm = new Date(t0.getTime() + 14 * 60_000)
    await registrarFalhaPersistida(chave, POLITICA_TENTATIVAS.maxPorConta, quintaEm)

    const bloqueadoAteEsperado = new Date(quintaEm.getTime() + POLITICA_TENTATIVAS.bloqueioMs)

    const aposJanelaInicialMasAindaBloqueado = new Date(t0.getTime() + 16 * 60_000)
    await registrarFalhaPersistida(
      chave,
      POLITICA_TENTATIVAS.maxPorConta,
      aposJanelaInicialMasAindaBloqueado,
    )

    const consulta = await consultarBloqueio([chave], aposJanelaInicialMasAindaBloqueado)
    expect(consulta).toEqual({
      bloqueado: true,
      bloqueadoAte: bloqueadoAteEsperado,
    })
  })

  test('10 chamadas concorrentes a registrarFalhaPersistida na mesma chave resultam em contagem 10', async () => {
    const t0 = new Date('2026-10-23T16:00:00Z')
    const chave = 'conta:concorrente@exemplo.com'

    await Promise.all(
      Array.from({ length: 10 }, () =>
        registrarFalhaPersistida(chave, POLITICA_TENTATIVAS.maxPorConta, t0),
      ),
    )

    const registro = await db.tentativaLogin.findUnique({ where: { chave } })
    expect(registro?.contagem).toBe(10)
    expect(registro?.bloqueadoAte).toEqual(new Date(t0.getTime() + POLITICA_TENTATIVAS.bloqueioMs))
  })

  test('10 chamadas concorrentes a autenticar com senha errada deixam a conta com contagem 10 e bloqueada', async () => {
    const t0 = new Date('2026-10-23T17:00:00Z')

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        autenticar({ email: 'paulo@exemplo.com', senha: 'errada', ip: `192.0.2.${i + 1}` }, t0),
      ),
    )

    const registroConta = await db.tentativaLogin.findUnique({
      where: { chave: 'conta:paulo@exemplo.com' },
    })
    expect(registroConta?.contagem).toBe(10)
    expect(registroConta?.bloqueadoAte).toEqual(
      new Date(t0.getTime() + POLITICA_TENTATIVAS.bloqueioMs),
    )

    const bloqueadoDepois = await autenticar(
      { email: 'paulo@exemplo.com', senha: 'senha-forte-123', ip: '192.0.2.99' },
      t0,
    )
    expect(bloqueadoDepois).toEqual({
      ok: false,
      motivo: 'bloqueado',
      bloqueadoAte: new Date(t0.getTime() + POLITICA_TENTATIVAS.bloqueioMs),
    })
  })
})
