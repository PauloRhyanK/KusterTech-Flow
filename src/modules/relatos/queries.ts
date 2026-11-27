// Leituras da tela Configurações › Sistemas conectados. Nunca devolve o token, nem cifrado.
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ehDeHoje } from '@/modules/demandas/apresentacao'
import { situacaoDoSistema } from './model'

const DIA_MS = 24 * 60 * 60_000

export interface SistemaNaLista {
  id: string
  nome: string
  projeto: string
  host: string
  relatosHoje: number
  demandasHoje: number
  situacao: { texto: string; tom: 'neutro' | 'erro' }
}

export interface TelaDeSistemas {
  quadros: { relatosHoje: number; viraramDemanda: number; orientadosNaHora: number }
  sistemas: SistemaNaLista[]
}

const hostDe = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export async function obterSistemasConectados(
  sujeito: Sujeito,
  agora: Date,
): Promise<TelaDeSistemas> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  const sistemas = await db.sistemaConectado.findMany({
    where: { estado: { not: 'REVOGADO' } },
    select: {
      id: true,
      nome: true,
      url: true,
      estado: true,
      ultimaBuscaOkEm: true,
      criadoEm: true,
      projeto: { select: { nome: true } },
      relatos: {
        // Folga de um dia: o "hoje" é pelo calendário de São Paulo, conferido abaixo.
        where: { em: { gte: new Date(agora.getTime() - DIA_MS) } },
        select: { em: true, resultado: true, demandaId: true },
      },
    },
  })
  const quadros = { relatosHoje: 0, viraramDemanda: 0, orientadosNaHora: 0 }
  const linhas = sistemas.map((s) => {
    const deHoje = s.relatos.filter((r) => ehDeHoje(r.em, agora))
    const demandas = deHoje.filter((r) => r.resultado === 'SEGUE' && r.demandaId).length
    quadros.relatosHoje += deHoje.length
    quadros.viraramDemanda += demandas
    quadros.orientadosNaHora += deHoje.filter((r) => r.resultado === 'ORIENTADO').length
    const situacao = situacaoDoSistema(s, agora)
    return {
      alerta: situacao.alerta,
      linha: {
        id: s.id,
        nome: s.nome,
        projeto: s.projeto.nome,
        host: hostDe(s.url),
        relatosHoje: deHoje.length,
        demandasHoje: demandas,
        situacao: { texto: situacao.texto, tom: situacao.tom },
      },
    }
  })
  linhas.sort(
    (a, b) =>
      Number(b.alerta) - Number(a.alerta) || a.linha.nome.localeCompare(b.linha.nome, 'pt-BR'),
  )
  return { quadros, sistemas: linhas.map((l) => l.linha) }
}

export interface SistemaParaEditar {
  id: string
  nome: string
  url: string
  projetoId: string
  repositorioId: string
  estado: 'ATIVO' | 'DESCONECTADO' | 'REVOGADO'
  ultimoErro: string | null
}

export async function obterSistemaParaEditar(
  sujeito: Sujeito,
  id: string,
): Promise<SistemaParaEditar | null> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  return db.sistemaConectado.findUnique({
    where: { id },
    select: {
      id: true,
      nome: true,
      url: true,
      projetoId: true,
      repositorioId: true,
      estado: true,
      ultimoErro: true,
    },
  })
}

export interface ProjetoParaSistema {
  id: string
  nome: string
  repositorios: { id: string; nome: string }[]
}

/** Projetos ativos com repositório ligado: só eles podem receber as demandas de um sistema. */
export async function obterProjetosParaSistemas(sujeito: Sujeito): Promise<ProjetoParaSistema[]> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  const projetos = await db.projeto.findMany({
    where: { arquivadoEm: null, repositorios: { some: {} } },
    orderBy: { nome: 'asc' },
    select: {
      id: true,
      nome: true,
      repositorios: { select: { id: true, nomeCompleto: true }, orderBy: { nomeCompleto: 'asc' } },
    },
  })
  return projetos.map((p) => ({
    id: p.id,
    nome: p.nome,
    repositorios: p.repositorios.map((r) => ({ id: r.id, nome: r.nomeCompleto })),
  }))
}
