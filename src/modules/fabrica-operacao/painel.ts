/**
 * O que a tela Operação mostra, montado a partir do estado do motor novo. Função pura: datas entram por
 * parâmetro e os textos saem prontos (desenho aprovado em 2026-11-27-fabrica-operacao-desenho.html).
 */
import type { EstadoDaEtapa } from './etapas'
import { DURACAO_DA_RESERVA_MS } from './reserva'

export interface EtapaNoPainel {
  chave: string
  papel: string
  estado: EstadoDaEtapa
  motivo: string | null
  proximaTentativaEm: Date | null
  /** Início da execução aberta, se houver. */
  execucaoDesde: Date | null
}

export interface DadosDoPainel {
  demandas: { id: string; titulo: string; projeto: string; etapas: EtapaNoPainel[] }[]
  maquinas: { nome: string; ultimoSinalEm: Date | null; tarefa: string | null }[]
  noArHoje: { titulo: string }[]
}

export type Icone = 'lupa' | 'tela' | 'codigo'

export interface Painel {
  situacao: { tipo: 'vazia' | 'andando' | 'travada'; titulo: string; frase: string }
  contadores: { trabalhando: number; conferindo: number; noArHoje: number }
  travadas: {
    demandaId: string
    titulo: string
    etapa: string
    motivo: string | null
    /** Hora em Brasília (`16:40`); null quando a Fábrica não vai tentar de novo sozinha. */
    proximaTentativa: string | null
  }[]
  emAndamento: {
    demandaId: string
    titulo: string
    projeto: string
    progresso: number
    cor: 'trabalhando' | 'conferindo'
    agora: { texto: string; desde: string | null; icone: Icone }
    passos: { nome: string; estado: 'feito' | 'atual' | 'futuro' }[]
  }[]
  maquinas: { nome: string; estado: 'ocupada' | 'livre' | 'sem_sinal'; texto: string }[]
  noArHoje: string[]
}

const FEITAS: readonly EstadoDaEtapa[] = ['mergeada', 'concluida']
const VERIFICADORES = ['revisor', 'qa']

const hora = (d: Date) =>
  d.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  })

function duracao(desde: Date, agora: Date): string {
  const min = Math.floor((agora.getTime() - desde.getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  return min % 60 === 0 ? `há ${h} h` : `há ${h} h ${min % 60} min`
}

const emRecuo = (e: EtapaNoPainel, agora: Date) =>
  e.estado === 'pendente' && e.proximaTentativaEm !== null && e.proximaTentativaEm > agora

function oQueAcontece(e: EtapaNoPainel): { texto: string; icone: Icone } {
  if (e.estado === 'aguardando_gates') {
    return { texto: 'Esperando revisão e testes do PR', icone: 'lupa' }
  }
  if (e.papel === 'revisor') return { texto: 'Revisor conferindo o código', icone: 'lupa' }
  if (e.papel === 'qa') return { texto: 'Testando no navegador', icone: 'tela' }
  const papel = e.papel.charAt(0).toUpperCase() + e.papel.slice(1)
  return { texto: `${papel} fazendo ${e.chave}`, icone: 'codigo' }
}

const conferindo = (e: EtapaNoPainel) =>
  e.estado === 'aguardando_gates' || (e.estado === 'executando' && VERIFICADORES.includes(e.papel))

export function montarPainel(d: DadosDoPainel, agora: Date): Painel {
  const todas = d.demandas.flatMap((dm) => dm.etapas)

  const travadas: Painel['travadas'] = d.demandas
    .flatMap((dm) =>
      dm.etapas
        .filter((e) => e.estado === 'bloqueada' || emRecuo(e, agora))
        .map((e) => ({
          demandaId: dm.id,
          titulo: dm.titulo,
          etapa: e.chave,
          motivo: e.motivo,
          proximaTentativa: e.estado === 'bloqueada' ? null : hora(e.proximaTentativaEm!),
          ordem: e.estado === 'bloqueada' ? 0 : e.proximaTentativaEm!.getTime(),
        })),
    )
    .sort((a, b) => a.ordem - b.ordem)
    .map(({ ordem: _ordem, ...t }) => t)

  const emAndamento: Painel['emAndamento'] = d.demandas.flatMap((dm) => {
    const atual =
      dm.etapas.find((e) => e.estado === 'executando') ??
      dm.etapas.find((e) => e.estado === 'aguardando_gates')
    if (!atual) return []
    const feitas = dm.etapas.filter((e) => FEITAS.includes(e.estado)).length
    return [
      {
        demandaId: dm.id,
        titulo: dm.titulo,
        projeto: dm.projeto,
        progresso: Math.round((feitas / dm.etapas.length) * 100),
        cor: conferindo(atual) ? 'conferindo' : 'trabalhando',
        agora: {
          ...oQueAcontece(atual),
          desde: atual.execucaoDesde ? duracao(atual.execucaoDesde, agora) : null,
        },
        passos: dm.etapas.map((e) => ({
          nome: e.chave,
          estado: FEITAS.includes(e.estado) ? 'feito' : e === atual ? 'atual' : 'futuro',
        })),
      },
    ]
  })

  const maquinas: Painel['maquinas'] = d.maquinas.map((m) => {
    if (m.ultimoSinalEm === null) {
      return { nome: m.nome, estado: 'sem_sinal', texto: 'Nunca se conectou' }
    }
    if (agora.getTime() - m.ultimoSinalEm.getTime() > DURACAO_DA_RESERVA_MS) {
      const ha = duracao(m.ultimoSinalEm, agora)
      return { nome: m.nome, estado: 'sem_sinal', texto: `Sem sinal ${ha}` }
    }
    return m.tarefa
      ? { nome: m.nome, estado: 'ocupada', texto: m.tarefa }
      : { nome: m.nome, estado: 'livre', texto: 'Livre' }
  })

  const n = new Set(travadas.map((t) => t.demandaId)).size
  const situacao: Painel['situacao'] =
    d.demandas.length === 0
      ? {
          tipo: 'vazia',
          titulo: 'Nenhuma demanda no motor novo',
          frase: 'As demandas continuam no motor atual até o piloto começar.',
        }
      : travadas.length > 0
        ? {
            tipo: 'travada',
            titulo: n === 1 ? 'Uma coisa travou' : `${n} coisas travaram`,
            frase: travadas.some((t) => t.proximaTentativa === null)
              ? 'O resto está andando. Uma delas precisa de você.'
              : 'O resto está andando. A Fábrica tenta de novo sozinha.',
          }
        : { tipo: 'andando', titulo: 'Tudo andando', frase: 'Nenhuma etapa travada agora.' }

  return {
    situacao,
    contadores: {
      trabalhando: todas.filter((e) => e.estado === 'executando' && !conferindo(e)).length,
      conferindo: todas.filter(conferindo).length,
      noArHoje: d.noArHoje.length,
    },
    travadas,
    emAndamento,
    maquinas,
    noArHoje: d.noArHoje.map((x) => x.titulo),
  }
}
