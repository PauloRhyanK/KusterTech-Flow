import type { APIRequestContext } from '@playwright/test'

function instanteUTC(data: Date): string {
  return data.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// Retrato v1 mínimo e válido pelo contrato; `feature` identifica o plano na página.
export function retratoDeTeste(
  feature: string,
  geradoEm: Date = new Date(),
): Record<string, unknown> {
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
