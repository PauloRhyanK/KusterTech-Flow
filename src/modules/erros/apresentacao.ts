// O quadro "Erros no ar" da página Fábrica (spec 2026-11-26-erros-do-glitchtip, seções 6.3 e 8).
import { chipDoPr } from '@/modules/demandas/apresentacao'
import type { EtapaDefinida } from '@/modules/demandas/model'
import {
  barrinhas,
  corrigidoEm,
  type EstadoNoQuadro,
  estadoNoQuadro,
  LIMIARES_PADRAO,
  type Limiares,
  type Ponto,
} from './model'

const MIN_MS = 60_000
const HORA_MS = 60 * MIN_MS
const LEITURA_VELHA_MS = 30 * MIN_MS
const CORRIGIDOS_DESDE_MS = 7 * 24 * 60 * MIN_MS
const SEM_REPOSITORIO = 'projeto sem repositório'

const ORDEM: Record<EstadoNoQuadro, number> = {
  voltou: 0,
  novo: 1,
  em_correcao: 2,
  na_espera: 3,
  observando: 4,
  no_ar: 5,
  corrigido: 6,
}

export interface ErroComDemanda {
  issueId: string
  projetoGlitchTip: string
  titulo: string
  onde: string | null
  nivel: string
  link: string
  eventos: number
  usuarios: number
  primeiroEm: Date
  ultimoEm: Date
  resolvidoEm: Date | null
  esperaDesde: Date | null
  demandaId: string | null
  demandaAnteriorId: string | null
  serie: Ponto[]
  demanda: {
    encerrada: string | null
    noArEm: Date | null
    etapaAtual: string
    etapas: EtapaDefinida[]
    prs: string[]
  } | null
}

export interface LeituraDoProjeto {
  projetoGlitchTip: string
  ultimoSucessoEm: Date | null
  ultimaFalhaEm: Date | null
  motivo: string | null
}

export interface LinhaDoQuadro {
  issueId: string
  titulo: string
  projeto: string
  onde: string | null
  nivel: string
  eventos: number
  usuarios: number
  ultimoEm: Date
  primeiroEm: Date
  estado: EstadoNoQuadro
  detalhe: string
  demandaId: string | null
  link: string
  barrinhas: { valores: number[]; subindo: boolean }
}

export interface QuadroDeErros {
  configurado: boolean
  /** Todas as linhas do quadro, já na ordem; a tela mostra as 8 primeiras e o resto em "Ver todos". */
  linhas: LinhaDoQuadro[]
  contagem: Record<Exclude<EstadoNoQuadro, 'corrigido'>, number>
  corrigidosEm7Dias: number
  projetosLidos: number
  leitura: { ultimoSucessoEm: Date | null; velha: boolean; motivo: string | null }
  avisos: string[]
}

function detalheDoEstado(
  estado: EstadoNoQuadro,
  e: ErroComDemanda,
  l: Limiares,
  agora: Date,
): string {
  const d = e.demanda
  switch (estado) {
    case 'voltou':
      return 'voltou depois da correção · nova demanda'
    case 'novo':
      return 'demanda aberta, triagem'
    case 'em_correcao': {
      const etapa = d?.etapas.find((x) => x.chave === d.etapaAtual)?.rotulo ?? d?.etapaAtual ?? ''
      const pr = d ? chipDoPr(d.prs) : null
      return [etapa.toLowerCase(), pr].filter(Boolean).join(' · ')
    }
    case 'na_espera':
      return `limite de ${l.porDia} demandas por dia · entra quando abrir vaga`
    case 'observando':
      return `vira demanda com ${l.eventos} eventos ou ativo por ${l.horas} h`
    case 'no_ar': {
      const fim = corrigidoEm({ noArEm: d?.noArEm ?? null, ultimoEm: e.ultimoEm }, l.horasSemErro)
      const faltam = fim ? Math.max(1, Math.ceil((fim.getTime() - agora.getTime()) / HORA_MS)) : 0
      return `no ar · faltam ${faltam} h sem o erro`
    }
    case 'corrigido': {
      const noArEm = d?.noArEm ?? agora
      const horas = Math.floor((agora.getTime() - noArEm.getTime()) / HORA_MS)
      return `no ar há ${horas} h sem o erro voltar`
    }
  }
}

export function montarQuadro(
  e: {
    configurado: boolean
    erros: ErroComDemanda[]
    leituras: LeituraDoProjeto[]
    slugs: string[]
    limiares?: Limiares
  },
  agora: Date,
): QuadroDeErros {
  const limiares = e.limiares ?? LIMIARES_PADRAO
  const linhas: LinhaDoQuadro[] = []
  let corrigidosEm7Dias = 0
  for (const erro of e.erros) {
    const corrigido = corrigidoEm(
      { noArEm: erro.demanda?.noArEm ?? null, ultimoEm: erro.ultimoEm },
      limiares.horasSemErro,
    )
    const desde = corrigido ? agora.getTime() - corrigido.getTime() : -1
    if (desde >= 0 && desde <= CORRIGIDOS_DESDE_MS) corrigidosEm7Dias += 1
    const estado = estadoNoQuadro(
      {
        resolvidoEm: erro.resolvidoEm,
        esperaDesde: erro.esperaDesde,
        ultimoEm: erro.ultimoEm,
        voltou: erro.demandaAnteriorId !== null,
        demanda: erro.demanda && {
          encerrada: erro.demanda.encerrada,
          noArEm: erro.demanda.noArEm,
          naPrimeiraEtapa: erro.demanda.etapaAtual === erro.demanda.etapas[0]?.chave,
        },
      },
      agora,
      limiares.horasSemErro,
    )
    if (estado === null) continue
    linhas.push({
      issueId: erro.issueId,
      titulo: erro.titulo,
      projeto: erro.projetoGlitchTip,
      onde: erro.onde,
      nivel: erro.nivel,
      eventos: erro.eventos,
      usuarios: erro.usuarios,
      ultimoEm: erro.ultimoEm,
      primeiroEm: erro.primeiroEm,
      estado,
      detalhe: detalheDoEstado(estado, erro, limiares, agora),
      demandaId: erro.demandaId,
      link: erro.link,
      barrinhas: barrinhas(erro.serie, agora),
    })
  }
  linhas.sort(
    (a, b) => ORDEM[a.estado] - ORDEM[b.estado] || b.ultimoEm.getTime() - a.ultimoEm.getTime(),
  )

  const contagem = { voltou: 0, novo: 0, em_correcao: 0, na_espera: 0, observando: 0, no_ar: 0 }
  for (const l of linhas) if (l.estado !== 'corrigido') contagem[l.estado] += 1

  const porSlug = new Map(e.leituras.map((l) => [l.projetoGlitchTip, l]))
  const avisos: string[] = []
  const lidos: (LeituraDoProjeto | undefined)[] = []
  for (const slug of e.slugs) {
    const l = porSlug.get(slug)
    if (l?.motivo === SEM_REPOSITORIO) avisos.push(`${SEM_REPOSITORIO}: ${slug}`)
    else lidos.push(l)
  }
  const sucessos = lidos.map((l) => l?.ultimoSucessoEm ?? null)
  const ultimoSucessoEm = sucessos.some((s) => s === null)
    ? null
    : (sucessos as Date[]).reduce<Date | null>(
        (min, s) => (min === null || s.getTime() < min.getTime() ? s : min),
        null,
      )
  const velha =
    e.configurado &&
    lidos.length > 0 &&
    (ultimoSucessoEm === null || agora.getTime() - ultimoSucessoEm.getTime() > LEITURA_VELHA_MS)
  const comFalha = lidos
    .filter((l): l is LeituraDoProjeto => !!l?.motivo && l.ultimaFalhaEm !== null)
    .sort((a, b) => b.ultimaFalhaEm!.getTime() - a.ultimaFalhaEm!.getTime())

  return {
    configurado: e.configurado,
    linhas,
    contagem,
    corrigidosEm7Dias,
    projetosLidos: e.leituras.filter((l) => l.ultimoSucessoEm !== null).length,
    leitura: { ultimoSucessoEm, velha, motivo: comFalha[0]?.motivo ?? null },
    avisos,
  }
}

/** A aba Erros da Fábrica: conta os novos e os que voltaram, e avisa quando a leitura está velha. */
export function rotuloDaAba(q: QuadroDeErros): { rotulo: string; contador: number } {
  return {
    rotulo: q.leitura.velha ? 'Erros · sem leitura' : 'Erros',
    contador: q.contagem.novo + q.contagem.voltou,
  }
}
