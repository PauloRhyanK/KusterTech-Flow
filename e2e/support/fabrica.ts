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
