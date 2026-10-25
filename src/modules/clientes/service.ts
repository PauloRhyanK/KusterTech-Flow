import { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { clientesVisiveis, normalizarNome, validarNomeDeCliente } from './model'

export interface ClienteResumo {
  id: string
  nome: string
  observacoes: string | null
  arquivadoEm: Date | null
  criadoEm: Date
}

export async function listarClientes(
  sujeito: Sujeito,
  filtro?: { busca?: string },
): Promise<ClienteResumo[]> {
  exigirPermissao(sujeito, 'clientes.ler')

  const visibilidade = clientesVisiveis(sujeito)
  const where: Prisma.ClienteWhereInput = {}

  if (visibilidade !== 'todos') {
    where.id = { in: [...visibilidade] }
  }

  if (filtro?.busca) {
    const buscaNormalizada = normalizarNome(filtro.busca).slice(0, 120)
    if (buscaNormalizada.length > 0) {
      where.nomeNormalizado = { contains: buscaNormalizada }
    }
  }

  return db.cliente.findMany({
    where,
    orderBy: { nome: 'asc' },
    select: {
      id: true,
      nome: true,
      observacoes: true,
      arquivadoEm: true,
      criadoEm: true,
    },
  })
}

export async function obterCliente(sujeito: Sujeito, clienteId: string): Promise<ClienteResumo> {
  exigirPermissao(sujeito, 'clientes.ler', { clienteId })

  const cliente = await db.cliente.findUnique({
    where: { id: clienteId },
    select: {
      id: true,
      nome: true,
      observacoes: true,
      arquivadoEm: true,
      criadoEm: true,
    },
  })

  if (!cliente) {
    throw new ErroDeDominio('Cliente não encontrado.')
  }

  return cliente
}

function validarObservacoes(observacoes?: string | null): string | null {
  if (observacoes === undefined || observacoes === null) {
    return null
  }
  const aparadas = observacoes.trim()
  if (!aparadas) {
    return null
  }
  if (aparadas.length > 2000) {
    throw new ErroDeDominio('As observações não podem ter mais de 2000 caracteres.')
  }
  return aparadas
}

export async function criarCliente(
  sujeito: Sujeito,
  dados: { nome: string; observacoes?: string | null },
): Promise<{ id: string }> {
  exigirPermissao(sujeito, 'clientes.gerenciar')

  const nomeValido = validarNomeDeCliente(dados.nome)
  const observacoes = validarObservacoes(dados.observacoes)
  const nomeNormalizado = normalizarNome(nomeValido)

  try {
    const criado = await db.cliente.create({
      data: {
        nome: nomeValido,
        nomeNormalizado,
        observacoes,
      },
      select: { id: true },
    })

    return { id: criado.id }
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      throw new ErroDeDominio('Já existe um cliente com este nome.')
    }
    throw erro
  }
}

export async function editarCliente(
  sujeito: Sujeito,
  clienteId: string,
  dados: { nome: string; observacoes?: string | null },
): Promise<void> {
  exigirPermissao(sujeito, 'clientes.gerenciar')

  const nomeValido = validarNomeDeCliente(dados.nome)
  const observacoes = validarObservacoes(dados.observacoes)
  const nomeNormalizado = normalizarNome(nomeValido)

  try {
    await db.cliente.update({
      where: { id: clienteId },
      data: {
        nome: nomeValido,
        nomeNormalizado,
        observacoes,
      },
    })
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      if (erro.code === 'P2025') {
        throw new ErroDeDominio('Cliente não encontrado.')
      }
      if (erro.code === 'P2002') {
        throw new ErroDeDominio('Já existe um cliente com este nome.')
      }
    }
    throw erro
  }
}

export async function arquivarCliente(sujeito: Sujeito, clienteId: string): Promise<void> {
  exigirPermissao(sujeito, 'clientes.gerenciar')

  try {
    const cliente = await db.cliente.findUnique({
      where: { id: clienteId },
      select: { id: true, arquivadoEm: true },
    })

    if (!cliente) {
      throw new ErroDeDominio('Cliente não encontrado.')
    }

    if (cliente.arquivadoEm === null) {
      await db.cliente.update({
        where: { id: clienteId },
        data: { arquivadoEm: new Date() },
      })
    }
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025') {
      throw new ErroDeDominio('Cliente não encontrado.')
    }
    throw erro
  }
}

export async function desarquivarCliente(sujeito: Sujeito, clienteId: string): Promise<void> {
  exigirPermissao(sujeito, 'clientes.gerenciar')

  try {
    const cliente = await db.cliente.findUnique({
      where: { id: clienteId },
      select: { id: true, arquivadoEm: true },
    })

    if (!cliente) {
      throw new ErroDeDominio('Cliente não encontrado.')
    }

    if (cliente.arquivadoEm !== null) {
      await db.cliente.update({
        where: { id: clienteId },
        data: { arquivadoEm: null },
      })
    }
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025') {
      throw new ErroDeDominio('Cliente não encontrado.')
    }
    throw erro
  }
}
