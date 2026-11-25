// Dados de teste do escritório, montados pelo modelo real a partir do retrato de exemplo.
import type { RetratoV2 } from '@/modules/fabrica/contrato'
import { type Escritorio, montarEscritorio } from '@/modules/fabrica/escritorio/model'
import exemploV2 from '@/modules/fabrica/retrato-exemplo-v2.json'

export const AGORA = new Date('2026-11-21T02:05:00Z')
export const DEMANDA = '9c44dfa8-3d83-4b05-9c2d-b1351c63af45'

export function retratoDeTeste(): RetratoV2 {
  return structuredClone(exemploV2) as unknown as RetratoV2
}

export function escritorioDeTeste(
  retrato: RetratoV2 = retratoDeTeste(),
  espera: string | null = null,
  esperaDesde: Date | null = null,
): Escritorio {
  return montarEscritorio(
    {
      recebido: { retrato, versaoOriginal: 2, geradoEm: AGORA, recebidoEm: AGORA },
      demandas: [
        {
          id: DEMANDA,
          titulo: 'Suporte por IA no CRM',
          repositorio: 'PauloRhyanK/CAISv2',
          marco: 'desenvolvida',
          espera,
          esperaDesde: espera === null ? null : (esperaDesde ?? AGORA),
        },
      ],
      titulos: { 'CAISv2-d87a': 'Suporte e Tour no kit CAIS' },
      historico: [],
    },
    AGORA,
  )
}
