import { ErroDeDominio } from '@/lib/erros'
import type { EstadoIntegracao } from '@/modules/github/model'

export function validarNomeDeProjeto(nome: string): string {
  const aparado = nome.trim()
  if (!aparado) {
    throw new ErroDeDominio('O nome é obrigatório.')
  }
  if (aparado.length > 120) {
    throw new ErroDeDominio('O nome não pode ter mais de 120 caracteres.')
  }
  return aparado
}

export interface ContagensDoProjeto {
  clientes: number
  repositorios: number
  ambientes: number
  milestones: number
}

export interface ItemChecklist {
  chave: 'clientes' | 'github' | 'ambientes' | 'milestones'
  titulo: string
  descricao: string
  estado: 'concluido' | 'pendente' | 'falha' | 'indisponivel'
  acao?: { rotulo: string; href: string }
}

function calcularItemGitHub(
  repositorios: number,
  hrefConfiguracao: string | null,
  estadoGitHub: EstadoIntegracao,
): ItemChecklist {
  const base = { chave: 'github', titulo: 'GitHub' } as const
  const acaoPara = (rotulo: string) =>
    hrefConfiguracao !== null ? { acao: { rotulo, href: `${hrefConfiguracao}#repositorios` } } : {}

  if (repositorios === 0) {
    return {
      ...base,
      descricao: 'Nenhum repositório vinculado',
      estado: 'pendente',
      ...acaoPara('Vincular repositórios'),
    }
  }
  if (estadoGitHub === 'indisponivel') {
    return {
      ...base,
      descricao: 'Integração indisponível; os dados podem estar desatualizados.',
      estado: 'falha',
      ...acaoPara('Ver repositórios'),
    }
  }
  return {
    ...base,
    descricao:
      repositorios === 1 ? '1 repositório vinculado' : `${repositorios} repositórios vinculados`,
    estado: 'concluido',
  }
}

export function calcularChecklist(
  contagens: ContagensDoProjeto,
  hrefConfiguracao: string | null,
  estadoGitHub: EstadoIntegracao,
): readonly ItemChecklist[] {
  const itemClientes: ItemChecklist =
    contagens.clientes > 0
      ? {
          chave: 'clientes',
          titulo: 'Clientes',
          descricao: 'Clientes associados',
          estado: 'concluido',
        }
      : {
          chave: 'clientes',
          titulo: 'Clientes',
          descricao: 'Nenhum cliente associado',
          estado: 'pendente',
          ...(hrefConfiguracao !== null
            ? {
                acao: {
                  rotulo: 'Associar clientes',
                  href: hrefConfiguracao,
                },
              }
            : {}),
        }

  return [
    itemClientes,
    calcularItemGitHub(contagens.repositorios, hrefConfiguracao, estadoGitHub),
    {
      chave: 'ambientes',
      titulo: 'Ambientes',
      descricao: 'Ambientes e evidências de deploy chegam no Incremento 4.',
      estado: 'indisponivel',
    },
    {
      chave: 'milestones',
      titulo: 'Milestones',
      descricao: 'Milestones e entregas chegam no Incremento 3.',
      estado: 'indisponivel',
    },
  ]
}

export type Contexto = { tipo: 'global' } | { tipo: 'cliente'; clienteId: string }

export interface Aba {
  rotulo: string
  href: string
  disponivel: boolean
}

export function abasDoContexto(projetoId: string, contexto: Contexto): readonly Aba[] {
  if (contexto.tipo === 'global') {
    return [
      { rotulo: 'Resumo', href: `/projetos/${projetoId}`, disponivel: true },
      { rotulo: 'Entregas', href: `/projetos/${projetoId}/entregas`, disponivel: true },
      { rotulo: 'Homologação', href: `/projetos/${projetoId}/homologacao`, disponivel: false },
      { rotulo: 'Saúde e Erros', href: `/projetos/${projetoId}/saude`, disponivel: false },
      { rotulo: 'Recursos', href: `/projetos/${projetoId}/recursos`, disponivel: false },
    ]
  }

  return [
    {
      rotulo: 'Resumo',
      href: `/clientes/${contexto.clienteId}/projetos/${projetoId}`,
      disponivel: true,
    },
    {
      rotulo: 'Entregas',
      href: `/clientes/${contexto.clienteId}/projetos/${projetoId}/entregas`,
      disponivel: true,
    },
    {
      rotulo: 'Homologação',
      href: `/clientes/${contexto.clienteId}/projetos/${projetoId}/homologacao`,
      disponivel: false,
    },
  ]
}

export interface ItemDeTrilha {
  rotulo: string
  href?: string
}

export function trilhasDoProjeto(
  projeto: { id: string; nome: string },
  contexto: Contexto,
  cliente: { id: string; nome: string } | null,
  ...complemento: ItemDeTrilha[]
): ItemDeTrilha[] {
  if (contexto.tipo === 'cliente' && cliente) {
    return [
      { rotulo: 'Clientes', href: '/clientes' },
      { rotulo: cliente.nome, href: `/clientes/${cliente.id}` },
      { rotulo: projeto.nome, href: `/clientes/${cliente.id}/projetos/${projeto.id}` },
      ...complemento,
    ]
  }
  return [
    { rotulo: 'Projetos', href: '/projetos' },
    { rotulo: projeto.nome, href: `/projetos/${projeto.id}` },
    ...complemento,
  ]
}

export interface RotasDoProjeto {
  resumo: string
  entregas: string
  milestone(id: string, aba?: 'issues' | 'homologacao'): string
  issue(id: string, milestoneId?: string): string
}

export function rotasDoProjeto(projetoId: string, contexto: Contexto): RotasDoProjeto {
  const base =
    contexto.tipo === 'global'
      ? `/projetos/${projetoId}`
      : `/clientes/${contexto.clienteId}/projetos/${projetoId}`
  return {
    resumo: base,
    entregas: `${base}/entregas`,
    milestone: (id, aba) =>
      `${base}/entregas/milestones/${id}${aba === 'homologacao' ? '?aba=homologacao' : ''}`,
    issue: (id, milestoneId) =>
      `${base}/entregas/issues/${id}${milestoneId ? `?milestone=${milestoneId}` : ''}`,
  }
}
