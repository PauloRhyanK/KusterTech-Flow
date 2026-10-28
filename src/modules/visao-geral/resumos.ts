import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { idsVisiveis, podeVerVisaoGlobal } from '@/modules/clientes/model'
import { estadoDoRepositorio } from '@/modules/github/model'
import { intervaloDaIntegracao } from '@/modules/github/service'
import { obterResumoDeInfraestrutura } from '@/modules/infra/queries'
import { calcularChecklist } from '@/modules/projetos/model'
import {
  indicadoresDeInfraestrutura,
  indicadoresDeProjetos,
  type DadosDoResumoDeProjetos,
  type Indicador,
} from './model'

const ID_INTEGRACAO = 'github'

export interface ResumoDeProjetos {
  escopo: 'global' | 'cliente'
  indicadores: Indicador[]
  link: { rotulo: 'Ver projetos' | 'Ver clientes'; href: '/projetos' | '/clientes' }
}

async function dadosDoGitHub(agora: Date): Promise<NonNullable<DadosDoResumoDeProjetos['github']>> {
  const [integracao, repositorios] = await Promise.all([
    db.integracaoGitHub.findUnique({ where: { id: ID_INTEGRACAO } }),
    db.repositorioGitHub.findMany({
      where: { projeto: { arquivadoEm: null } },
      select: { sincronizadoEm: true, ultimaFalhaEm: true, removidoDaInstalacaoEm: true },
    }),
  ])
  const intervalo = intervaloDaIntegracao()
  let semDadosRecentes = 0
  let indisponiveis = 0
  let maisAntiga: Date | null = null
  for (const r of repositorios) {
    const estado = estadoDoRepositorio(r, agora, intervalo)
    if (estado === 'sem-dados-recentes') semDadosRecentes++
    if (estado === 'indisponivel') indisponiveis++
    if (r.sincronizadoEm && (maisAntiga === null || r.sincronizadoEm < maisAntiga)) {
      maisAntiga = r.sincronizadoEm
    }
  }
  return {
    configurada: integracao?.configurada === true,
    vinculados: repositorios.length,
    semDadosRecentes,
    indisponiveis,
    sincronizacaoMaisAntiga: maisAntiga,
  }
}

export async function obterResumoDeProjetos(
  sujeito: Sujeito,
  agora: Date,
): Promise<ResumoDeProjetos> {
  exigirPermissao(sujeito, 'projetos.ler')

  if (!podeVerVisaoGlobal(sujeito)) {
    const clientes = idsVisiveis(sujeito) ?? []
    const [projetosAtivos, homologacoesEmAndamento] = await Promise.all([
      db.projeto.count({
        where: { arquivadoEm: null, clientes: { some: { clienteId: { in: [...clientes] } } } },
      }),
      db.homologacao.count({
        where: {
          estado: 'EM_ANDAMENTO',
          clienteId: { in: [...clientes] },
          milestone: { arquivadaEm: null, projeto: { arquivadoEm: null } },
        },
      }),
    ])
    return {
      escopo: 'cliente',
      indicadores: indicadoresDeProjetos({
        escopo: 'cliente',
        projetosAtivos,
        configuracaoIncompleta: null,
        milestonesAtivas: null,
        homologacoesEmAndamento,
        github: null,
      }),
      link: { rotulo: 'Ver clientes', href: '/clientes' },
    }
  }

  const [projetos, milestonesAtivas, homologacoesEmAndamento, github] = await Promise.all([
    db.projeto.findMany({
      where: { arquivadoEm: null },
      select: {
        _count: {
          select: {
            clientes: true,
            repositorios: true,
            ambientes: true,
            milestones: { where: { arquivadaEm: null } },
          },
        },
      },
    }),
    db.milestone.count({ where: { arquivadaEm: null, projeto: { arquivadoEm: null } } }),
    db.homologacao.count({
      where: {
        estado: 'EM_ANDAMENTO',
        milestone: { arquivadaEm: null, projeto: { arquivadoEm: null } },
      },
    }),
    dadosDoGitHub(agora),
  ])
  // Só o item "pendente" interessa; o estado da integração não o altera.
  const configuracaoIncompleta = projetos.filter((p) =>
    calcularChecklist(p._count, null, 'nao-configurada').some((i) => i.estado === 'pendente'),
  ).length

  return {
    escopo: 'global',
    indicadores: indicadoresDeProjetos({
      escopo: 'global',
      projetosAtivos: projetos.length,
      configuracaoIncompleta,
      milestonesAtivas,
      homologacoesEmAndamento,
      github,
    }),
    link: { rotulo: 'Ver projetos', href: '/projetos' },
  }
}

// O 8 entrega os números (`obterResumoDeInfraestrutura`); aqui eles viram indicadores com fonte explícita.
export async function obterIndicadoresDeInfraestrutura(sujeito: Sujeito): Promise<{
  indicadores: Indicador[]
  link: { rotulo: 'Abrir Infraestrutura'; href: '/infraestrutura' }
}> {
  const resumo = await obterResumoDeInfraestrutura(sujeito)
  return {
    indicadores: indicadoresDeInfraestrutura(resumo),
    link: { rotulo: 'Abrir Infraestrutura', href: '/infraestrutura' },
  }
}
