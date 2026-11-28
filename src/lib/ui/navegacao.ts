import type { ModuloId } from '@/lib/modulos'
import {
  Bot,
  Building2,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  MessageSquareMore,
  Rocket,
  Server,
  Settings,
  Ticket,
} from 'lucide-react'

export interface ItemDeNavegacao {
  rotulo: string
  href: string
  icone: LucideIcon
  descricao: string
  /** O item só aparece com este módulo ativo. */
  modulo?: ModuloId
}

export interface GrupoDeNavegacao {
  rotulo: string
  itens: readonly ItemDeNavegacao[]
}

export const GRUPOS_DE_NAVEGACAO: readonly GrupoDeNavegacao[] = [
  {
    rotulo: 'Trabalho',
    itens: [
      {
        rotulo: 'Início',
        href: '/',
        icone: LayoutDashboard,
        descricao: 'O que espera você e o resumo dos projetos',
      },
      {
        rotulo: 'Decidir',
        href: '/decidir',
        icone: MessageSquareMore,
        descricao: 'O que espera uma resposta sua, um item por vez',
        modulo: 'decidir',
      },
      {
        rotulo: 'Demandas',
        href: '/demandas',
        icone: Inbox,
        descricao: 'Demandas dos projetos',
      },
      {
        rotulo: 'Tickets',
        href: '/tickets',
        icone: Ticket,
        descricao: 'O que os usuários mandaram pelos apps',
        modulo: 'tickets',
      },
      {
        rotulo: 'Publicação',
        href: '/publicacao',
        icone: Rocket,
        descricao: 'Fila de publicação dos projetos',
      },
      {
        rotulo: 'Fábrica',
        href: '/fabrica',
        icone: Bot,
        descricao: 'Agentes, fila e execuções',
      },
    ],
  },
  {
    rotulo: 'Cadastro',
    itens: [
      {
        rotulo: 'Clientes',
        href: '/clientes',
        icone: Building2,
        descricao: 'Acompanhamento dos clientes e seus projetos',
      },
      {
        rotulo: 'Projetos',
        href: '/projetos',
        icone: FolderKanban,
        descricao: 'Gestão global de projetos, entregas e homologações',
      },
      {
        rotulo: 'Máquinas',
        href: '/maquinas',
        icone: Server,
        descricao: 'Inventário, recursos e diagnóstico',
      },
    ],
  },
]

export const ENTRADAS_SECUNDARIAS: readonly ItemDeNavegacao[] = [
  {
    rotulo: 'Configurações',
    href: '/configuracoes',
    icone: Settings,
    descricao: 'Integrações, parâmetros e permissões administrativas',
  },
]

export function itemAtivo(pathname: string): ItemDeNavegacao | undefined {
  const todosOsItens = [...GRUPOS_DE_NAVEGACAO.flatMap((g) => g.itens), ...ENTRADAS_SECUNDARIAS]
  return todosOsItens.find((item) => {
    if (item.href === '/') {
      return pathname === '/'
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  })
}
