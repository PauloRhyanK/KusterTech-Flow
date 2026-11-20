import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SessaoAtual } from '@/lib/auth/sessao'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { obterDemandasDoProjeto, obterFormularioDeDemanda } from '@/modules/demandas/queries'
import { definirDemandasDoProjeto } from '@/modules/demandas/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

const { obterSessaoMock } = vi.hoisted(() => ({
  obterSessaoMock: vi.fn<() => Promise<SessaoAtual | null>>(),
}))
vi.mock('@/lib/auth/sessao', () => ({ obterSessao: obterSessaoMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

class Redirecionou extends Error {
  constructor(public destino: string) {
    super(destino)
  }
}
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionou(destino)
  },
  notFound: () => {
    throw new Error('notFound')
  },
}))

import { definirDemandasDoProjetoAction } from '@/app/(app)/projetos/[p]/(detalhe)/configuracao/demandas-actions'
import { criarDemandaAction } from '@/app/(app)/demandas/nova/actions'

const AGORA = new Date('2026-11-20T15:00:00.000Z')

let admin: Sujeito
let projetoId: string
let repositorioId: string
let dir: string
const dirAnterior = process.env.FLOW_ARQUIVOS_DIR

function sessaoDe(sujeito: Sujeito): SessaoAtual {
  return {
    sessaoId: 'ses-formulario',
    usuario: { id: sujeito.usuarioId, nome: 'Admin', email: 'a@local.test', tema: 'sistema' },
    sujeito,
  }
}

beforeEach(async () => {
  await limparBanco()
  dir = await mkdtemp(join(tmpdir(), 'flow-formulario-'))
  process.env.FLOW_ARQUIVOS_DIR = dir
  const usuario = await criarUsuario({
    email: 'admin-formulario-demanda@local.test',
    nome: 'Admin Formulário',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
  obterSessaoMock.mockResolvedValue(sessaoDe(admin))
  const projeto = await db.projeto.create({
    data: { nome: 'Projeto Alfa', nomeNormalizado: 'projeto-alfa' },
  })
  projetoId = projeto.id
  const repositorio = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(8301),
      instalacaoId: BigInt(900003),
      nomeCompleto: 'kustertech-exemplo/alfa',
      urlHtml: 'https://github.com/kustertech-exemplo/alfa',
      privado: false,
      projetoId,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    },
  })
  repositorioId = repositorio.id
})

afterEach(async () => {
  if (dirAnterior === undefined) delete process.env.FLOW_ARQUIVOS_DIR
  else process.env.FLOW_ARQUIVOS_DIR = dirAnterior
  await rm(dir, { recursive: true, force: true })
})

afterAll(async () => {
  await db.$disconnect()
})

function formulario(campos: Record<string, string>, anexos: File[] = []): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  for (const a of anexos) f.append('anexos', a)
  return f
}

const imagem = (nome: string) => new File([new Uint8Array([1, 2, 3])], nome, { type: 'image/png' })

const BASE = {
  projetoId: '',
  repositorioId: '',
  titulo: 'Trocar o botão',
  nivel: 'aprovar_desenho',
  temTela: 'sim',
}

test('action com título vazio → erro "Informe o que você quer."; com 4 anexos → "Envie até 3 anexos."; válida → demanda criada e redirect', async () => {
  const base = { ...BASE, projetoId, repositorioId }

  const vazio = await criarDemandaAction({}, formulario({ ...base, titulo: '   ' }))
  expect(vazio).toEqual({ erro: 'Informe o que você quer.' })

  const muitos = await criarDemandaAction(
    {},
    formulario(
      base,
      [1, 2, 3, 4].map((n) => imagem(`a${n}.png`)),
    ),
  )
  expect(muitos).toEqual({ erro: 'Envie até 3 anexos.' })
  expect(await db.demanda.count()).toBe(0)

  let destino = ''
  try {
    await criarDemandaAction({}, formulario(base, [imagem('captura.png')]))
  } catch (e) {
    if (!(e instanceof Redirecionou)) throw e
    destino = e.destino
  }
  const criada = await db.demanda.findFirstOrThrow({ include: { arquivos: true } })
  expect(destino).toBe(`/demandas/${criada.id}`)
  expect(criada.titulo).toBe('Trocar o botão')
  expect(criada.repositorioId).toBe(repositorioId)
  expect(criada.nivel).toBe('APROVAR_DESENHO')
  expect(criada.temTela).toBe(true)
  expect(criada.arquivos).toHaveLength(1)
})

test('sem sessão a action manda para /entrar', async () => {
  obterSessaoMock.mockResolvedValue(null)
  await expect(
    criarDemandaAction({}, formulario({ ...BASE, projetoId, repositorioId })),
  ).rejects.toMatchObject({ destino: '/entrar' })
})

test('definirDemandasDoProjeto pela action sem projetos.gerenciar → ErroDeAutorizacao', async () => {
  const modelo = await db.modeloDeEtapas.findFirstOrThrow({ where: { padrao: true } })
  const semPermissao: Sujeito = {
    usuarioId: '00000000-0000-0000-0000-000000000000',
    papeis: [{ papel: 'APROVADOR', clienteId: null }],
  }
  await expect(
    definirDemandasDoProjeto(semPermissao, projetoId, {
      modeloId: modelo.id,
      nivelPadrao: 'vai_sozinho',
    }),
  ).rejects.toBeInstanceOf(ErroDeAutorizacao)
  await expect(obterFormularioDeDemanda(semPermissao)).rejects.toBeInstanceOf(ErroDeAutorizacao)

  // A action traduz a recusa em mensagem, sem gravar.
  obterSessaoMock.mockResolvedValue(sessaoDe(semPermissao))
  const r = await definirDemandasDoProjetoAction(
    {},
    formulario({ projetoId, modeloId: modelo.id, nivelPadrao: 'vai_sozinho' }),
  )
  expect(r.erro).toBe('Sem permissão para gerenciar as demandas deste projeto.')
  const p = await db.projeto.findUniqueOrThrow({ where: { id: projetoId } })
  expect(p.nivelPadraoDeDemanda).toBe('APROVAR_DESENHO')
})

test('a action de configuração grava o modelo e o nível, e as queries devolvem o que o formulário usa', async () => {
  const modelo = await db.modeloDeEtapas.findFirstOrThrow({ where: { padrao: true } })
  const r = await definirDemandasDoProjetoAction(
    {},
    formulario({ projetoId, modeloId: modelo.id, nivelPadrao: 'vai_sozinho' }),
  )
  expect(r.sucesso).toBe('Configuração de demandas salva.')

  const config = await obterDemandasDoProjeto(admin, projetoId)
  expect(config.modeloId).toBe(modelo.id)
  expect(config.nivelPadrao).toBe('vai_sozinho')
  expect(config.modelos[0]!.etapas.map((e) => e.chave)).toHaveLength(6)

  const form = await obterFormularioDeDemanda(admin)
  expect(form.projetos).toEqual([
    {
      id: projetoId,
      nome: 'Projeto Alfa',
      nivelPadrao: 'vai_sozinho',
      repositorios: [{ id: repositorioId, nomeCompleto: 'kustertech-exemplo/alfa' }],
    },
  ])
})
