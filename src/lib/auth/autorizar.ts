export type Papel = 'ADMIN' | 'APROVADOR' | 'TESTADOR'

export type Acao =
  | 'usuarios.gerenciar'
  | 'configuracoes.gerenciar'
  | 'clientes.ler'
  | 'clientes.gerenciar'
  | 'projetos.ler'
  | 'projetos.gerenciar'
  | 'homologacao.disponibilizar'
  | 'homologacao.comentar'
  | 'homologacao.solicitar_correcao'
  | 'homologacao.aprovar'
  | 'publicacao.autorizar'

export interface PapelAtribuido {
  papel: Papel
  clienteId: string | null
}

export interface Sujeito {
  usuarioId: string
  papeis: readonly PapelAtribuido[]
}

export interface Escopo {
  clienteId?: string
}

export const TODAS_AS_ACOES: readonly Acao[] = [
  'usuarios.gerenciar',
  'configuracoes.gerenciar',
  'clientes.ler',
  'clientes.gerenciar',
  'projetos.ler',
  'projetos.gerenciar',
  'homologacao.disponibilizar',
  'homologacao.comentar',
  'homologacao.solicitar_correcao',
  'homologacao.aprovar',
  'publicacao.autorizar',
]

export const ACOES_COM_CLIENTE_OBRIGATORIO: readonly Acao[] = [
  'homologacao.disponibilizar',
  'homologacao.comentar',
  'homologacao.solicitar_correcao',
  'homologacao.aprovar',
]

export const PERMISSOES: Record<Papel, readonly Acao[]> = {
  ADMIN: TODAS_AS_ACOES,
  APROVADOR: [
    'clientes.ler',
    'projetos.ler',
    'homologacao.comentar',
    'homologacao.solicitar_correcao',
    'homologacao.aprovar',
  ],
  TESTADOR: [
    'clientes.ler',
    'projetos.ler',
    'homologacao.comentar',
    'homologacao.solicitar_correcao',
  ],
}

export function autorizar(sujeito: Sujeito, acao: Acao, escopo?: Escopo): boolean {
  const exigeCliente = ACOES_COM_CLIENTE_OBRIGATORIO.includes(acao)
  const clienteAlvo = escopo?.clienteId

  return sujeito.papeis.some((atribuicao) => {
    if (!PERMISSOES[atribuicao.papel].includes(acao)) {
      return false
    }

    if (atribuicao.papel === 'ADMIN') {
      return true
    }

    if (exigeCliente && !clienteAlvo) {
      return false
    }

    if (clienteAlvo !== undefined) {
      return atribuicao.clienteId === null || atribuicao.clienteId === clienteAlvo
    }

    return true
  })
}

export class ErroDeAutorizacao extends Error {
  readonly acao: Acao
  readonly escopo?: Escopo

  constructor(acao: Acao, escopo?: Escopo) {
    super(
      escopo?.clienteId
        ? `Acesso negado para a ação "${acao}" no cliente "${escopo.clienteId}".`
        : `Acesso negado para a ação "${acao}".`,
    )
    this.name = 'ErroDeAutorizacao'
    this.acao = acao
    this.escopo = escopo
  }
}

export function exigirPermissao(sujeito: Sujeito, acao: Acao, escopo?: Escopo): void {
  if (!autorizar(sujeito, acao, escopo)) {
    throw new ErroDeAutorizacao(acao, escopo)
  }
}
