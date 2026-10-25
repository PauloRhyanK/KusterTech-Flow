import type { Sujeito } from '@/lib/auth/autorizar'
import { ErroDeDominio } from '@/lib/erros'

export function normalizarNome(nome: string): string {
  return nome
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function validarNomeDeCliente(nome: string): string {
  const aparado = nome.trim()
  if (!aparado) {
    throw new ErroDeDominio('O nome é obrigatório.')
  }
  if (aparado.length > 120) {
    throw new ErroDeDominio('O nome não pode ter mais de 120 caracteres.')
  }
  return aparado
}

export type Visibilidade = 'todos' | readonly string[]

export function clientesVisiveis(sujeito: Sujeito): Visibilidade {
  const temAcessoGlobal = sujeito.papeis.some(
    (atribuicao) => atribuicao.papel === 'ADMIN' || atribuicao.clienteId === null,
  )

  if (temAcessoGlobal) {
    return 'todos'
  }

  const distintos: string[] = []
  for (const atribuicao of sujeito.papeis) {
    if (atribuicao.clienteId && !distintos.includes(atribuicao.clienteId)) {
      distintos.push(atribuicao.clienteId)
    }
  }

  return distintos
}

export function podeVerVisaoGlobal(sujeito: Sujeito): boolean {
  return clientesVisiveis(sujeito) === 'todos'
}

export function idsVisiveis(sujeito: Sujeito): readonly string[] | null {
  const visibilidade = clientesVisiveis(sujeito)
  if (visibilidade === 'todos') {
    return null
  }
  return visibilidade
}
