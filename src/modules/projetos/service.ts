import { Prisma } from '@prisma/client'
import { ErroDeAutorizacao, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { idsVisiveis, normalizarNome, podeVerVisaoGlobal } from '@/modules/clientes/model'
import { type Contexto, validarNomeDeProjeto } from './model'

export interface ProjetoResumo {
  id: string
  nome: string
  descricao: string | null
  arquivadoEm: Date | null
  criadoEm: Date
  clientes: {
    id: string
    nome: string
    arquivadoEm: Date | null
  }[]
}

function validarDescricao(descricao?: string | null): string | null {
  if (descricao === undefined || descricao === null) {
    return null
  }
  const aparada = descricao.trim()
  if (!aparada) {
    return null
  }
  if (aparada.length > 2000) {
    throw new ErroDeDominio('A descrição não pode ter mais de 2000 caracteres.')
  }
  return aparada
}

function selecaoDeProjeto(ids: readonly string[] | null) {
  return {
    id: true,
    nome: true,
    descricao: true,
    arquivadoEm: true,
    criadoEm: true,
    clientes: {
      where: ids === null ? undefined : { clienteId: { in: [...ids] } },
      select: {
        cliente: {
          select: {
            id: true,
            nome: true,
            arquivadoEm: true,
          },
        },
      },
      orderBy: {
        cliente: {
          nome: 'asc' as const,
        },
      },
    },
  }
}

export async function listarProjetos(
  sujeito: Sujeito,
  filtro?: { busca?: string },
): Promise<ProjetoResumo[]> {
  exigirPermissao(sujeito, 'projetos.ler')

  if (!podeVerVisaoGlobal(sujeito)) {
    throw new ErroDeAutorizacao('projetos.ler')
  }

  const where: Prisma.ProjetoWhereInput = {}

  if (filtro?.busca) {
    const buscaNormalizada = normalizarNome(filtro.busca).slice(0, 120)
    if (buscaNormalizada.length > 0) {
      where.nomeNormalizado = { contains: buscaNormalizada }
    }
  }

  const projetos = await db.projeto.findMany({
    where,
    orderBy: { nome: 'asc' },
    select: selecaoDeProjeto(null),
  })

  return projetos.map((p) => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    arquivadoEm: p.arquivadoEm,
    criadoEm: p.criadoEm,
    clientes: p.clientes.map((c) => c.cliente),
  }))
}

export async function obterProjeto(
  sujeito: Sujeito,
  projetoId: string,
  contexto: Contexto,
): Promise<ProjetoResumo> {
  if (contexto.tipo === 'global') {
    exigirPermissao(sujeito, 'projetos.ler')

    if (!podeVerVisaoGlobal(sujeito)) {
      throw new ErroDeAutorizacao('projetos.ler')
    }

    const projeto = await db.projeto.findUnique({
      where: { id: projetoId },
      select: selecaoDeProjeto(null),
    })

    if (!projeto) {
      throw new ErroDeDominio('Projeto não encontrado.')
    }

    return {
      id: projeto.id,
      nome: projeto.nome,
      descricao: projeto.descricao,
      arquivadoEm: projeto.arquivadoEm,
      criadoEm: projeto.criadoEm,
      clientes: projeto.clientes.map((c) => c.cliente),
    }
  }

  // Contexto de cliente
  exigirPermissao(sujeito, 'clientes.ler', { clienteId: contexto.clienteId })

  const ids = idsVisiveis(sujeito)

  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: selecaoDeProjeto(ids),
  })

  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }

  const associadoAoCliente = projeto.clientes.some((c) => c.cliente.id === contexto.clienteId)

  if (!associadoAoCliente) {
    if (podeVerVisaoGlobal(sujeito)) {
      throw new ErroDeDominio('Projeto não associado a este cliente.')
    }
    throw new ErroDeDominio('Projeto não encontrado.')
  }

  return {
    id: projeto.id,
    nome: projeto.nome,
    descricao: projeto.descricao,
    arquivadoEm: projeto.arquivadoEm,
    criadoEm: projeto.criadoEm,
    clientes: projeto.clientes.map((c) => c.cliente),
  }
}

export async function criarProjeto(
  sujeito: Sujeito,
  dados: {
    nome: string
    descricao?: string | null
    clientesIds?: string[]
  },
): Promise<{ id: string }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const nomeValido = validarNomeDeProjeto(dados.nome)
  const descricao = validarDescricao(dados.descricao)
  const nomeNormalizado = normalizarNome(nomeValido)
  const clientesIdsUnicos = [...new Set(dados.clientesIds ?? [])]

  try {
    return await db.$transaction(async (tx) => {
      if (clientesIdsUnicos.length > 0) {
        const clientesEncontrados = await tx.cliente.findMany({
          where: { id: { in: clientesIdsUnicos } },
          select: { id: true, arquivadoEm: true },
        })

        if (clientesEncontrados.length !== clientesIdsUnicos.length) {
          throw new ErroDeDominio('Cliente não encontrado.')
        }

        const clienteArquivado = clientesEncontrados.find((c) => c.arquivadoEm !== null)
        if (clienteArquivado) {
          throw new ErroDeDominio('Cliente arquivado não pode ser associado.')
        }
      }

      const criado = await tx.projeto.create({
        data: {
          nome: nomeValido,
          nomeNormalizado,
          descricao,
        },
        select: { id: true },
      })

      if (clientesIdsUnicos.length > 0) {
        await tx.projetoCliente.createMany({
          data: clientesIdsUnicos.map((clienteId) => ({
            projetoId: criado.id,
            clienteId,
          })),
        })
      }

      return { id: criado.id }
    })
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      throw new ErroDeDominio('Já existe um projeto com este nome.')
    }
    throw erro
  }
}

export async function editarProjeto(
  sujeito: Sujeito,
  projetoId: string,
  dados: { nome: string; descricao?: string | null },
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const nomeValido = validarNomeDeProjeto(dados.nome)
  const descricao = validarDescricao(dados.descricao)
  const nomeNormalizado = normalizarNome(nomeValido)

  try {
    await db.projeto.update({
      where: { id: projetoId },
      data: {
        nome: nomeValido,
        nomeNormalizado,
        descricao,
      },
    })
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      if (erro.code === 'P2025') {
        throw new ErroDeDominio('Projeto não encontrado.')
      }
      if (erro.code === 'P2002') {
        throw new ErroDeDominio('Já existe um projeto com este nome.')
      }
    }
    throw erro
  }
}

export async function arquivarProjeto(sujeito: Sujeito, projetoId: string): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, arquivadoEm: true },
  })

  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }

  if (projeto.arquivadoEm === null) {
    try {
      await db.projeto.update({
        where: { id: projetoId },
        data: { arquivadoEm: new Date() },
      })
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025') {
        throw new ErroDeDominio('Projeto não encontrado.')
      }
      throw erro
    }
  }
}

export async function desarquivarProjeto(sujeito: Sujeito, projetoId: string): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, arquivadoEm: true },
  })

  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }

  if (projeto.arquivadoEm !== null) {
    try {
      await db.projeto.update({
        where: { id: projetoId },
        data: { arquivadoEm: null },
      })
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025') {
        throw new ErroDeDominio('Projeto não encontrado.')
      }
      throw erro
    }
  }
}

export async function associarCliente(
  sujeito: Sujeito,
  projetoId: string,
  clienteId: string,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true },
  })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }

  const cliente = await db.cliente.findUnique({
    where: { id: clienteId },
    select: { id: true, arquivadoEm: true },
  })
  if (!cliente) {
    throw new ErroDeDominio('Cliente não encontrado.')
  }
  if (cliente.arquivadoEm !== null) {
    throw new ErroDeDominio('Cliente arquivado não pode ser associado.')
  }

  try {
    await db.projetoCliente.create({
      data: {
        projetoId,
        clienteId,
      },
    })
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      throw new ErroDeDominio('Cliente já associado a este projeto.')
    }
    throw erro
  }
}

export async function desassociarCliente(
  sujeito: Sujeito,
  projetoId: string,
  clienteId: string,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  try {
    await db.$transaction(async (tx) => {
      const emMilestone = await tx.milestoneCliente.findFirst({
        where: { clienteId, milestone: { projetoId } },
        select: { milestoneId: true },
      })
      if (emMilestone) {
        throw new ErroDeDominio(
          'Este cliente está em milestones do projeto. Remova-o das milestones antes de desassociá-lo.',
        )
      }
      await tx.projetoCliente.delete({
        where: {
          projetoId_clienteId: {
            projetoId,
            clienteId,
          },
        },
      })
    })
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025') {
      throw new ErroDeDominio('Cliente não está associado a este projeto.')
    }
    throw erro
  }
}
