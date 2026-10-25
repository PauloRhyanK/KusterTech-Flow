import { ErroDeDominio } from '@/lib/erros'

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
  estado: 'concluido' | 'pendente' | 'indisponivel'
  acao?: { rotulo: string; href: string }
}

export function calcularChecklist(
  contagens: ContagensDoProjeto,
  hrefConfiguracao: string | null,
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
    {
      chave: 'github',
      titulo: 'GitHub',
      descricao: 'A integração com o GitHub chega no Incremento 2.',
      estado: 'indisponivel',
    },
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
      { rotulo: 'Entregas', href: `/projetos/${projetoId}/entregas`, disponivel: false },
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
      disponivel: false,
    },
    {
      rotulo: 'Homologação',
      href: `/clientes/${contexto.clienteId}/projetos/${projetoId}/homologacao`,
      disponivel: false,
    },
  ]
}
