import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'

function instanteUTC(data: Date): string {
  return data.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// O estado de um pedido de conserto contado de volta pela Fábrica (campo opcional do retrato).
export interface ConsertoDoRetrato {
  id: string
  estado: 'em_curso' | 'com_pr' | 'desistiu'
  runId?: string | null
  prUrl?: string | null
  motivo?: string | null
}

// Retrato v1 mínimo e válido pelo contrato; `feature` identifica o plano na página. Com
// `consertos`, o retrato leva o campo opcional dos pedidos de conserto de publicação.
export function retratoDeTeste(
  feature: string,
  geradoEm: Date = new Date(),
  consertos?: readonly ConsertoDoRetrato[],
): Record<string, unknown> {
  const extra =
    consertos === undefined
      ? {}
      : {
          consertos: consertos.map((c) => ({
            id: c.id,
            estado: c.estado,
            runId: c.runId ?? null,
            prUrl: c.prUrl ?? null,
            motivo: c.motivo ?? null,
            em: instanteUTC(geradoEm),
          })),
        }
  return {
    versao: 1,
    geradoEm: instanteUTC(geradoEm),
    vagas: {
      efetivas: 2,
      configuradas: 3,
      ocupadas: 1,
      ramMinimaMb: 2048,
      memDisponivelMb: 5120,
      oomEm: null,
    },
    drenagem: null,
    warren: { preparo: 'pronto', em: null },
    planos: [
      {
        id: 'plano-e2e',
        repo: 'kustertech-exemplo/automacao',
        feature,
        estado: 'ativo',
        entrouEm: instanteUTC(geradoEm),
        faseAtual: 'fase-1',
        fases: [{ id: 'fase-1', raias: [{ id: 'contrato-retrato', estado: 'executando' }] }],
        pausado: null,
        decisoes: [
          {
            titulo: 'Homologar o painel da Fábrica',
            url: 'https://github.com/kustertech-exemplo/automacao/issues/7',
          },
        ],
        orquestradorAtivo: true,
      },
    ],
    avisos: [],
    ...extra,
  }
}

// Retrato v2 (escritório da Fábrica): dois planos, um esperando o Paulo (decisão aberta), com uma execução
// de frontend que tem linhas para a tela do agente.
export function retratoV2DeTeste(
  feature: string,
  geradoEm: Date = new Date(),
): Record<string, unknown> {
  const agora = instanteUTC(geradoEm)
  const ha = (min: number) => instanteUTC(new Date(geradoEm.getTime() - min * 60_000))
  const raia = (
    id: string,
    situacao: string | null,
    inicio: string | null,
    fim: string | null,
  ) => ({
    id,
    estado: situacao === 'mergeada' ? 'concluida' : situacao ? 'executando' : 'planejada',
    papel: 'frontend',
    dependeDe: [],
    criterios: ['Primeiro critério', 'Segundo critério'],
    seedId: situacao ? `seed-${id}` : null,
    inicio,
    fim,
    prUrl: null,
    situacao,
    criteriosVeredito:
      situacao === 'mergeada'
        ? [
            { indice: 0, cumprido: true },
            { indice: 1, cumprido: true },
          ]
        : null,
  })
  const plano = (id: string, nome: string, decisoes: unknown[]) => ({
    id,
    repo: 'kustertech-exemplo/automacao',
    feature: nome,
    estado: 'ativo',
    entrouEm: ha(60),
    faseAtual: 'fase-1',
    fases: [
      {
        id: 'fase-1',
        raias: [
          raia('base', 'mergeada', ha(50), ha(20)),
          raia('tela', 'executando', ha(15), null),
          raia('ajuste', null, null, null),
        ],
      },
    ],
    pausado: null,
    decisoes,
    orquestradorAtivo: false,
    demanda: null,
  })
  return {
    ...retratoDeTeste(feature, geradoEm),
    versao: 2,
    planos: [
      plano('kustertech-exemplo--automacao--esperando--aaa111', `${feature} (espera)`, [
        {
          titulo: 'Aprovar a fase',
          url: 'https://github.com/kustertech-exemplo/automacao/issues/8',
        },
      ]),
      plano('kustertech-exemplo--automacao--andando--bbb222', feature, []),
    ],
    execucoes: [
      {
        runId: 'run-e2e-tela',
        papel: 'frontend',
        planoId: 'kustertech-exemplo--automacao--andando--bbb222',
        raia: 'tela',
        demanda: null,
        estado: 'running',
        inicio: ha(15),
        custoUsd: 0.42,
        modelo: 'claude-sonnet-5-5',
        ultimaAcao: { texto: 'Edit src/tela.tsx', em: agora },
        linhas: [
          { em: ha(10), tipo: 'texto', texto: 'lendo o catálogo do kit' },
          { em: agora, tipo: 'ferramenta', texto: 'Edit src/tela.tsx' },
        ],
      },
    ],
  }
}

// Envia um retrato ao endpoint da Fábrica; sem token, omite o cabeçalho Authorization.
export async function enviarRetratoDaFabrica(
  request: APIRequestContext,
  token: string | null,
  corpo: unknown,
): Promise<{ status: number; json: unknown }> {
  const resposta = await request.post('/api/fabrica/estado', {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    data: corpo,
  })
  return { status: resposta.status(), json: await resposta.json() }
}

// Um evento da Fábrica para uma demanda (`POST /api/fabrica/demandas/<id>/eventos`), com id novo.
export async function eventoDaFabrica(
  request: APIRequestContext,
  token: string,
  demandaId: string,
  tipo: string,
  dados: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const resposta = await request.post(`/api/fabrica/demandas/${demandaId}/eventos`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { id: randomUUID(), em: instanteUTC(new Date()), tipo, dados },
  })
  return { status: resposta.status(), json: await resposta.json() }
}

// Um arquivo da Fábrica (desenho ou captura) em `POST /api/fabrica/demandas/<id>/arquivos`.
// `query` leva `tipo`, `nome` e, nas capturas, `tela`; o `id` do arquivo é gerado aqui.
export async function arquivoDaFabrica(
  request: APIRequestContext,
  token: string,
  demandaId: string,
  query: { tipo: 'desenho' | 'captura'; nome: string; tela?: 'desktop' | 'celular' },
  corpo: Buffer,
  conteudo: string,
): Promise<{ status: number; id: string }> {
  const id = randomUUID()
  const params = new URLSearchParams({ id, ...query })
  const resposta = await request.post(`/api/fabrica/demandas/${demandaId}/arquivos?${params}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': conteudo },
    data: corpo,
  })
  return { status: resposta.status(), id }
}
