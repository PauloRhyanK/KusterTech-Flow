import {
  Bot,
  Building2,
  FolderKanban,
  LayoutDashboard,
  type LucideIcon,
  Server,
  Settings,
} from 'lucide-react'

export interface ItemDeNavegacao {
  rotulo: string
  href: string
  icone: LucideIcon
  descricao: string
}

export const MODULOS: readonly ItemDeNavegacao[] = [
  {
    rotulo: 'Visão Geral',
    href: '/',
    icone: LayoutDashboard,
    descricao: 'Pendências prioritárias; resumos de projetos e infraestrutura',
  },
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
    rotulo: 'Infraestrutura',
    href: '/infraestrutura',
    icone: Server,
    descricao: 'Inventário, recursos, alertas e diagnóstico',
  },
  {
    rotulo: 'Central de Desenvolvimento',
    href: '/desenvolvimento',
    icone: Bot,
    descricao: 'Issues, PRs e execuções de agentes',
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
  const todosOsItens = [...MODULOS, ...ENTRADAS_SECUNDARIAS]
  return todosOsItens.find((item) => {
    if (item.href === '/') {
      return pathname === '/'
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  })
}
