import type { ItemDaFila, SituacaoDasFontes } from '@/modules/desenvolvimento/queries'

export const SEM_EXECUCOES: SituacaoDasFontes['execucoesPorEstado'] = {
  NA_FILA: 0,
  AGUARDANDO_CAPACIDADE: 0,
  AGUARDANDO_DEPENDENCIA: 0,
  EXECUTANDO: 0,
  INTERVENCAO_NECESSARIA: 0,
  CONCLUIDA: 0,
  SEM_DADOS: 0,
}

export function fontesDeTeste(sobrepor: Partial<SituacaoDasFontes> = {}): SituacaoDasFontes {
  return {
    githubConfigurado: true,
    github: 'conectada',
    githubSincronizadoEm: new Date('2026-10-21T10:00:00Z'),
    repositorios: [
      {
        repositorio: 'kustertech-exemplo/automacao',
        situacao: 'lido',
        lidoEm: new Date('2026-10-21T10:00:00Z'),
        falhaMotivo: null,
        linhasInvalidas: 0,
      },
    ],
    execucoesPorEstado: { ...SEM_EXECUCOES, EXECUTANDO: 1, CONCLUIDA: 2 },
    ...sobrepor,
  }
}

export function itemDeTeste(sobrepor: Partial<ItemDaFila> = {}): ItemDaFila {
  return {
    tipo: 'pull-request',
    id: 'pr-1',
    origem: 'github',
    projeto: { id: 'p-1', nome: 'Automação' },
    repositorio: 'kustertech-exemplo/automacao',
    referencia: 'PR #4',
    titulo: 'Ajustar filtro de clientes (Task 2)',
    estado: { texto: 'Mergeado', tom: 'neutro' },
    checks: null,
    situacao: 'encerrado',
    motivo: null,
    abertaPeloWarren: true,
    href: 'https://github.com/kustertech-exemplo/automacao/pull/4',
    externo: true,
    atualizadoEm: new Date('2026-10-19T15:00:00Z'),
    ...sobrepor,
  }
}
