import { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { normalizarNome } from '@/modules/clientes/model'
import {
  type TipoRecurso,
  validarCustoMensal,
  validarHospedagem,
  validarNomeDeRecurso,
  validarTextoOpcional,
} from './model'

const LIMITE_DESCRICAO = 2000
const LIMITE_IDENTIFICADOR = 200
const LIMITE_PROVEDOR = 80
const LIMITE_ENDERECO = 120
const LIMITE_ESPECIFICACAO = 200

export interface DadosDoRecurso {
  nome: string
  identificadorExterno?: string | null
  descricao?: string | null
  hospedadoEmId?: string | null
  provedor?: string | null
  endereco?: string | null
  especificacao?: string | null
  custoMensal?: string | number | null
}

interface DadosValidados {
  nome: string
  nomeNormalizado: string
  identificadorExterno: string | null
  descricao: string | null
  hospedadoEmId: string | null
  provedor: string | null
  endereco: string | null
  especificacao: string | null
  custoMensal: string | null
}

function opcional(valor: string | null | undefined): string | null {
  const aparado = valor?.trim() ?? ''
  return aparado === '' ? null : aparado
}

function validarDados(d: DadosDoRecurso): DadosValidados {
  const nome = validarNomeDeRecurso(d.nome)
  const descricao = opcional(d.descricao)
  if (descricao !== null && descricao.length > LIMITE_DESCRICAO) {
    throw new ErroDeDominio(`A descrição não pode ter mais de ${LIMITE_DESCRICAO} caracteres.`)
  }
  const identificadorExterno = opcional(d.identificadorExterno)
  if (identificadorExterno !== null && identificadorExterno.length > LIMITE_IDENTIFICADOR) {
    throw new ErroDeDominio(
      `O identificador externo não pode ter mais de ${LIMITE_IDENTIFICADOR} caracteres.`,
    )
  }
  return {
    nome,
    nomeNormalizado: normalizarNome(nome),
    identificadorExterno,
    descricao,
    hospedadoEmId: opcional(d.hospedadoEmId),
    provedor: validarTextoOpcional(d.provedor, 'O provedor', LIMITE_PROVEDOR),
    endereco: validarTextoOpcional(d.endereco, 'O endereço', LIMITE_ENDERECO),
    especificacao: validarTextoOpcional(d.especificacao, 'A especificação', LIMITE_ESPECIFICACAO),
    custoMensal: validarCustoMensal(d.custoMensal),
  }
}

// Só os nomes dos campos do erro entram na decisão; nada do erro é registrado.
function traduzirConflito(erro: unknown): never {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
    const campos = JSON.stringify(erro.meta ?? {})
    throw new ErroDeDominio(
      /identificadorExterno|identificador_externo/.test(campos)
        ? 'Já existe um recurso com este identificador externo.'
        : 'Já existe um recurso com este nome.',
    )
  }
  throw erro
}

async function relerHospedeiro(
  tipo: TipoRecurso,
  hospedadoEmId: string | null,
  recursoId: string | null,
): Promise<void> {
  if (hospedadoEmId === null) {
    return
  }
  if (hospedadoEmId === recursoId) {
    throw new ErroDeDominio('Um recurso não pode hospedar a si mesmo.')
  }
  const hospedeiro = await db.recurso.findUnique({
    where: { id: hospedadoEmId },
    select: { tipo: true, arquivadoEm: true },
  })
  if (!hospedeiro) {
    throw new ErroDeDominio('Recurso hospedeiro não encontrado.')
  }
  validarHospedagem(tipo, { tipo: hospedeiro.tipo, arquivado: hospedeiro.arquivadoEm !== null })
}

export async function cadastrarRecurso(
  sujeito: Sujeito,
  dados: DadosDoRecurso & { tipo: TipoRecurso },
): Promise<{ id: string }> {
  exigirPermissao(sujeito, 'infraestrutura.gerenciar')

  const validados = validarDados(dados)
  await relerHospedeiro(dados.tipo, validados.hospedadoEmId, null)

  try {
    const criado = await db.recurso.create({
      data: { tipo: dados.tipo, ...validados },
      select: { id: true },
    })
    return { id: criado.id }
  } catch (erro) {
    return traduzirConflito(erro)
  }
}

export async function editarRecurso(
  sujeito: Sujeito,
  recursoId: string,
  dados: DadosDoRecurso,
): Promise<void> {
  exigirPermissao(sujeito, 'infraestrutura.gerenciar')

  const validados = validarDados(dados)
  const atual = await db.recurso.findUnique({
    where: { id: recursoId },
    select: { tipo: true, hospedadoEmId: true },
  })
  if (!atual) {
    throw new ErroDeDominio('Recurso não encontrado.')
  }
  // Quem já está hospedado num servidor depois arquivado não é barrado ao editar outros campos.
  if (validados.hospedadoEmId !== atual.hospedadoEmId) {
    await relerHospedeiro(atual.tipo, validados.hospedadoEmId, recursoId)
  }

  try {
    // O tipo não muda depois do cadastro (A14).
    await db.recurso.update({ where: { id: recursoId }, data: validados })
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025') {
      throw new ErroDeDominio('Recurso não encontrado.')
    }
    return traduzirConflito(erro)
  }
}

export async function alternarArquivamentoDeRecurso(
  sujeito: Sujeito,
  recursoId: string,
  arquivar: boolean,
): Promise<void> {
  exigirPermissao(sujeito, 'infraestrutura.gerenciar')

  const recurso = await db.recurso.findUnique({
    where: { id: recursoId },
    select: {
      tipo: true,
      arquivadoEm: true,
      hospedadoEm: { select: { arquivadoEm: true } },
    },
  })
  if (!recurso) {
    throw new ErroDeDominio('Recurso não encontrado.')
  }

  if (arquivar) {
    if (recurso.arquivadoEm !== null) {
      return
    }
    if (recurso.tipo === 'SERVIDOR') {
      const ativos = await db.recurso.count({
        where: { hospedadoEmId: recursoId, arquivadoEm: null },
      })
      if (ativos > 0) {
        throw new ErroDeDominio('Arquive antes os recursos hospedados neste servidor.')
      }
    }
    await db.recurso.updateMany({
      where: { id: recursoId, arquivadoEm: null },
      data: { arquivadoEm: new Date() },
    })
    return
  }

  if (recurso.arquivadoEm === null) {
    return
  }
  if (recurso.hospedadoEm?.arquivadoEm) {
    throw new ErroDeDominio('Desarquive antes o servidor que hospeda este recurso.')
  }
  await db.recurso.update({ where: { id: recursoId }, data: { arquivadoEm: null } })
}

export async function associarProjetoAoRecurso(
  sujeito: Sujeito,
  recursoId: string,
  projetoId: string,
): Promise<void> {
  exigirPermissao(sujeito, 'infraestrutura.gerenciar')

  const recurso = await db.recurso.findUnique({
    where: { id: recursoId },
    select: { arquivadoEm: true },
  })
  if (!recurso) {
    throw new ErroDeDominio('Recurso não encontrado.')
  }
  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { arquivadoEm: true },
  })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }
  if (projeto.arquivadoEm !== null) {
    throw new ErroDeDominio('Projeto arquivado não recebe recursos.')
  }
  if (recurso.arquivadoEm !== null) {
    throw new ErroDeDominio('Recurso arquivado não recebe novos projetos.')
  }

  await db.recursoProjeto.createMany({ data: [{ recursoId, projetoId }], skipDuplicates: true })
}

export async function desassociarProjetoDoRecurso(
  sujeito: Sujeito,
  recursoId: string,
  projetoId: string,
): Promise<void> {
  exigirPermissao(sujeito, 'infraestrutura.gerenciar')

  await db.recursoProjeto.deleteMany({ where: { recursoId, projetoId } })
}
