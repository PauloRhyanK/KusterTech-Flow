import { randomUUID } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import type { SessaoAtual } from '@/lib/auth/sessao'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const { obterSessaoMock, redirectMock, notFoundMock } = vi.hoisted(() => ({
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
  redirectMock: vi.fn((destino: string) => {
    throw new Error(`REDIRECT:${destino}`)
  }),
  notFoundMock: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))
vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('next/navigation', () => ({ redirect: redirectMock, notFound: notFoundMock }))

import PaginaDosTickets from '@/app/(app)/tickets/page'
import PaginaDoTicket from '@/app/(app)/tickets/[id]/page'

const semPermissao: Sujeito = {
  usuarioId: '00000000-0000-0000-0000-000000000000',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}
let admin: Sujeito
let projetoId: string
let repositorioId: string

function sessaoDe(sujeito: Sujeito): SessaoAtual {
  return {
    sessaoId: 'ses-tickets',
    usuario: { id: sujeito.usuarioId, nome: 'Admin', email: 'a@local.test', tema: 'sistema' },
    sujeito,
  }
}

async function renderizar(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await PaginaDosTickets({ searchParams: Promise.resolve(params) }))
}

async function sistema(nome: string, estado?: 'DESCONECTADO') {
  return db.sistemaConectado.create({
    data: {
      projetoId,
      repositorioId,
      url: 'https://app.exemplo.com/v1',
      nome,
      ...(estado ? { estado } : {}),
    } as never,
  })
}

function dadosDoRelato(sistemaId: string, n: number, extra: object = {}) {
  return {
    sistemaId,
    idExterno: `r-${n}`,
    resultado: 'SEGUE',
    canal: 'SISTEMA',
    em: new Date(Date.now() - 3_600_000 - n * 1000),
    autorIdExterno: 'u1',
    autorNome: 'Ana',
    autorPapel: 'cliente',
    texto: 'O botão não funciona',
    ...extra,
  } as never
}

beforeEach(async () => {
  vi.clearAllMocks()
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-tickets-pagina@local.test',
    nome: 'Admin Tickets',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  obterSessaoMock.mockResolvedValue(sessaoDe(admin))
  projetoId = (
    await db.projeto.create({ data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto-alfa' } })
  ).id
  repositorioId = (
    await db.repositorioGitHub.create({
      data: {
        githubId: BigInt(8401),
        instalacaoId: BigInt(900004),
        nomeCompleto: 'kustertech-exemplo/alfa',
        urlHtml: 'https://github.com/kustertech-exemplo/alfa',
        privado: false,
        projetoId,
        vinculadoEm: new Date(),
        catalogadoEm: new Date(),
      },
    })
  ).id
})

afterAll(async () => {
  await db.$disconnect()
})

test('sem sessão redireciona para /entrar', async () => {
  obterSessaoMock.mockResolvedValue(null)
  await expect(renderizar()).rejects.toThrow('REDIRECT:/entrar')
})

test('sem desenvolvimento.ler mostra sem permissão', async () => {
  obterSessaoMock.mockResolvedValue(sessaoDe(semPermissao))
  const html = await renderizar()
  expect(html).toMatch(/permiss/i)
  expect(html).not.toContain('Nenhum app conectado')
})

test('sem app conectado mostra o estado vazio com link para os sistemas', async () => {
  const html = await renderizar()
  expect(html).toContain('Nenhum app conectado')
  expect(html).toContain('href="/configuracoes/sistemas"')
})

test('lista sem escolha mostra "Escolha um ticket"; com t renderiza o detalhe ao lado', async () => {
  const s = await sistema('App Alfa')
  const r = await db.relato.create({ data: dadosDoRelato(s.id, 1) })
  const sem = await renderizar()
  expect(sem).toContain('Escolha um ticket')
  expect(sem).toContain('O botão não funciona')
  const com = await renderizar({ t: r.id })
  expect(com).not.toContain('Escolha um ticket')
  expect(com).toContain('Voltar à lista')
})

test('t que não acha ticket vale como sem seleção: lista visível, detalhe só no desktop', async () => {
  const s = await sistema('App Alfa')
  await db.relato.create({ data: dadosDoRelato(s.id, 1) })
  const html = await renderizar({ t: randomUUID() })
  expect(html).not.toContain('Voltar à lista')
  expect(html).toContain('Escolha um ticket')
  expect(html.split('hidden min-w-0 lg:block')).toHaveLength(2)
  expect(html).not.toContain('class="hidden min-w-0 lg:block"><ul')
  expect(html).toContain('O botão não funciona')
})

test('filtro sem resultado mostra "Nada com estes filtros" e link Limpar', async () => {
  const s = await sistema('App Alfa')
  await db.relato.create({ data: dadosDoRelato(s.id, 1) })
  const html = await renderizar({ q: 'zzzinexistente' })
  expect(html).toContain('Nada com estes filtros')
  expect(html).toContain('href="/tickets"')
  expect(html).toContain('Limpar')
})

test('avisa de sistema desconectado', async () => {
  await sistema('App Alfa')
  await sistema('App Beta', 'DESCONECTADO')
  const html = await renderizar()
  expect(html).toContain('App Beta')
  expect(html).toMatch(/desconectad/i)
})

test('mostra "mostrando os 300 mais recentes" quando truncado', async () => {
  const s = await sistema('App Alfa')
  await db.relato.createMany({
    data: Array.from({ length: 301 }, (_, i) => dadosDoRelato(s.id, i)),
  })
  const html = await renderizar()
  expect(html).toContain('mostrando os 300 mais recentes')
})

test('/tickets/<id> inexistente chama notFound; existente renderiza em página', async () => {
  await expect(
    PaginaDoTicket({ params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }),
  ).rejects.toThrow('NOT_FOUND')
  expect(notFoundMock).toHaveBeenCalled()
  const s = await sistema('App Alfa')
  const r = await db.relato.create({ data: dadosDoRelato(s.id, 1) })
  const html = renderToStaticMarkup(await PaginaDoTicket({ params: Promise.resolve({ id: r.id }) }))
  expect(html).toContain('O botão não funciona')
})
