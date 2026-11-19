import { afterAll, beforeEach, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import exemplo from '@/modules/fabrica/retrato-exemplo.json'
import { receberRetratoDaFabrica } from '@/modules/fabrica/recepcao'
import { criarFonteDaFabrica } from '@/modules/fabrica/service'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo } from '@/modules/github/reconciliacao'
import { obterInicio } from '@/modules/inicio/queries'
import { criarProjeto } from '@/modules/projetos/service'
import { criarUsuario } from '@/modules/usuarios/service'
import { limparBanco } from './banco-de-teste'

// O retrato de exemplo foi gerado às 21:40; um minuto depois ele ainda está em dia.
const AGORA = new Date('2026-11-03T21:41:00Z')

let admin: Sujeito

beforeEach(async () => {
  await limparBanco()
  const usuario = await criarUsuario({
    email: 'admin-inicio@local.test',
    nome: 'Admin Início',
    senha: 'senha-super-segura-123',
    papeis: [{ papel: 'ADMIN', clienteId: null }],
  })
  admin = { usuarioId: usuario.id, papeis: [{ papel: 'ADMIN', clienteId: null }] }
})

afterAll(async () => {
  await db.$disconnect()
})

async function gravarRetrato(): Promise<void> {
  const { token } = await criarFonteDaFabrica(admin, 'Máquina de agentes')
  const texto = JSON.stringify(exemplo)
  const resposta = await receberRetratoDaFabrica(
    {
      authorization: `Bearer ${token}`,
      contentType: 'application/json',
      contentLength: String(Buffer.byteLength(texto)),
      corpo: async () => texto,
    },
    AGORA,
  )
  expect(resposta.status).toBe(200)
}

async function repositorioIndisponivel(): Promise<{ projetoId: string }> {
  await sincronizarCatalogo(criarFonteFixtures(), AGORA)
  const projeto = await criarProjeto(admin, { nome: 'Projeto Portal' })
  const repositorio = await db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto: 'kustertech-exemplo/portal' },
  })
  await db.repositorioGitHub.update({
    where: { id: repositorio.id },
    data: {
      projetoId: projeto.id,
      vinculadoEm: AGORA,
      sincronizadoEm: new Date(AGORA.getTime() - 20 * 60_000),
      ultimaFalhaEm: new Date(AGORA.getTime() - 60_000),
    },
  })
  return { projetoId: projeto.id }
}

test('com um retrato com uma decisão e um repositório indisponível, obterInicio devolve decisão → integração', async () => {
  await gravarRetrato()
  const { projetoId } = await repositorioIndisponivel()

  const inicio = await obterInicio(admin, AGORA)

  expect(inicio.escopo).toBe('total')
  expect(inicio.espera.fontesComFalha).toEqual([])
  expect(inicio.espera.itens.map((i) => [i.tipo, i.titulo, i.href])).toEqual([
    [
      'decisao',
      'Homologar o painel da Fábrica',
      'https://github.com/PauloRhyanK/kustertech-flow/issues/147',
    ],
    ['integracao', 'GitHub — Projeto Portal', `/projetos/${projetoId}/configuracao#repositorios`],
  ])
  expect(inicio.fabrica).toMatchObject({
    desatualizado: false,
    planos: [
      { id: 'painel-fabrica', estado: 'ativo' },
      { id: 'outro-plano', estado: 'aguardando' },
    ],
  })
  expect(inicio.cadastro).toEqual({ clientes: 0, projetos: 1, repositorios: 1, maquinas: 0 })
  expect(inicio.oficina).toBeNull()
  expect(inicio.seusProjetos).toBeNull()
})
