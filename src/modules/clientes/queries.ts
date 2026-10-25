import type { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { clientesVisiveis } from './model'
import { type ClienteResumo, listarClientes, obterCliente } from './service'

export async function listarClientesParaTela(
  sujeito: Sujeito,
  busca?: string,
): Promise<(ClienteResumo & { totalDeProjetos: number })[]> {
  const clientes = await listarClientes(sujeito, busca ? { busca } : undefined)

  if (clientes.length === 0) {
    return []
  }

  const contagens = await db.projetoCliente.groupBy({
    by: ['clienteId'],
    where: {
      clienteId: { in: clientes.map((c) => c.id) },
    },
    _count: { clienteId: true },
  })

  const mapaContagens = new Map(contagens.map((item) => [item.clienteId, item._count.clienteId]))

  return clientes.map((cliente) => ({
    ...cliente,
    totalDeProjetos: mapaContagens.get(cliente.id) ?? 0,
  }))
}

export async function obterClienteComProjetos(
  sujeito: Sujeito,
  clienteId: string,
): Promise<
  ClienteResumo & {
    projetos: {
      id: string
      nome: string
      descricao: string | null
      arquivadoEm: Date | null
    }[]
  }
> {
  const cliente = await obterCliente(sujeito, clienteId)

  const vinculos = await db.projetoCliente.findMany({
    where: { clienteId },
    select: {
      projeto: {
        select: {
          id: true,
          nome: true,
          descricao: true,
          arquivadoEm: true,
        },
      },
    },
    orderBy: {
      projeto: {
        nome: 'asc',
      },
    },
  })

  return {
    ...cliente,
    projetos: vinculos.map((v) => v.projeto),
  }
}

export async function listarClientesParaSelecao(
  sujeito: Sujeito,
): Promise<{ id: string; nome: string }[]> {
  exigirPermissao(sujeito, 'clientes.ler')

  const visibilidade = clientesVisiveis(sujeito)
  const where: Prisma.ClienteWhereInput = {
    arquivadoEm: null,
  }

  if (visibilidade !== 'todos') {
    where.id = { in: [...visibilidade] }
  }

  return db.cliente.findMany({
    where,
    orderBy: { nome: 'asc' },
    select: {
      id: true,
      nome: true,
    },
  })
}
