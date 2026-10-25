import { Prisma } from '@prisma/client'
import {
  exigirPermissao,
  type Papel,
  type PapelAtribuido,
  type Sujeito,
} from '@/lib/auth/autorizar'
import { converterPapelDoBanco } from '@/lib/auth/papel'
import { HASH_FICTICIO, hashSenha, verificarSenha } from '@/lib/auth/senha'
import {
  consultarBloqueio,
  limparTentativas,
  POLITICA_TENTATIVAS,
  registrarFalhaPersistida,
} from '@/lib/auth/tentativas'
import { db } from '@/lib/db'
import { ehTema, temaParaBanco, type Tema } from '@/lib/tema/tema'

const TAMANHO_MINIMO_SENHA = 12
const TAMANHO_MAXIMO_SENHA = 1024
const TAMANHO_MAXIMO_EMAIL = 254
const FORMATO_MINIMO_EMAIL = /^[^\s@]+@[^\s@]+$/

export type ResultadoAutenticacao =
  | { ok: true; usuarioId: string }
  | { ok: false; motivo: 'credenciais' }
  | { ok: false; motivo: 'bloqueado'; bloqueadoAte: Date }

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function emailValido(email: string): boolean {
  const normalizado = normalizarEmail(email)
  return (
    normalizado.length > 0 &&
    normalizado.length <= TAMANHO_MAXIMO_EMAIL &&
    FORMATO_MINIMO_EMAIL.test(normalizado)
  )
}

function deduplicarPapeis(papeis: readonly PapelAtribuido[]): PapelAtribuido[] {
  const vistos = new Set<string>()
  const unicos: PapelAtribuido[] = []

  for (const atribuicao of papeis) {
    const chave = JSON.stringify([atribuicao.papel, atribuicao.clienteId])
    if (!vistos.has(chave)) {
      vistos.add(chave)
      unicos.push({
        papel: atribuicao.papel,
        clienteId: atribuicao.clienteId,
      })
    }
  }

  return unicos
}

export async function criarUsuario(dados: {
  email: string
  nome: string
  senha: string
  papeis: PapelAtribuido[]
}): Promise<{ id: string }> {
  const email = normalizarEmail(dados.email)
  const nome = dados.nome.trim()

  if (!email) {
    throw new Error('O e-mail é obrigatório.')
  }

  if (email.length > TAMANHO_MAXIMO_EMAIL) {
    throw new Error(`O e-mail não pode ter mais de ${TAMANHO_MAXIMO_EMAIL} caracteres.`)
  }

  if (!emailValido(email)) {
    throw new Error('Formato de e-mail inválido.')
  }

  if (!nome) {
    throw new Error('O nome é obrigatório.')
  }

  if (dados.senha.length < TAMANHO_MINIMO_SENHA) {
    throw new Error(`A senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`)
  }

  const papeisUnicos = deduplicarPapeis(dados.papeis)
  const senhaHash = await hashSenha(dados.senha)

  try {
    const criado = await db.usuario.create({
      data: {
        email,
        nome,
        senhaHash,
        papeis: {
          create: papeisUnicos.map((item) => ({
            papel: item.papel,
            clienteId: item.clienteId,
          })),
        },
      },
      select: { id: true },
    })

    return { id: criado.id }
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      throw new Error('Já existe um usuário com este e-mail.')
    }
    throw erro
  }
}

export async function autenticar(
  entrada: { email: string; senha: string; ip: string },
  agora: Date = new Date(),
): Promise<ResultadoAutenticacao> {
  const email = normalizarEmail(entrada.email)

  if (!emailValido(email) || entrada.senha.length > TAMANHO_MAXIMO_SENHA) {
    return { ok: false, motivo: 'credenciais' }
  }

  const ip = entrada.ip.trim() || 'desconhecido'
  const chaveConta = `conta:${email}`
  const chaveIp = `ip:${ip}`

  const bloqueio = await consultarBloqueio([chaveConta, chaveIp], agora)
  if (bloqueio.bloqueado && bloqueio.bloqueadoAte) {
    return {
      ok: false,
      motivo: 'bloqueado',
      bloqueadoAte: bloqueio.bloqueadoAte,
    }
  }

  const usuario = await db.usuario.findUnique({
    where: { email },
  })

  const usuarioAtivo = usuario && usuario.ativo ? usuario : null
  const hashAlvo = usuarioAtivo ? usuarioAtivo.senhaHash : HASH_FICTICIO
  const senhaCorreta = await verificarSenha(entrada.senha, hashAlvo)

  if (!usuarioAtivo || !senhaCorreta) {
    await db.$transaction(async (tx) => {
      await registrarFalhaPersistida(chaveConta, POLITICA_TENTATIVAS.maxPorConta, agora, tx)
      await registrarFalhaPersistida(chaveIp, POLITICA_TENTATIVAS.maxPorIp, agora, tx)
    })

    return { ok: false, motivo: 'credenciais' }
  }

  await limparTentativas([chaveConta])
  return { ok: true, usuarioId: usuarioAtivo.id }
}

/**
 * Exceção documentada à regra de `exigirPermissao` (A16): o tema é uma preferência do próprio
 * usuário autenticado, então a função não consulta papéis. Quem chama deve obter o `sujeito` da
 * sessão atual; o único registro alterado é o do `sujeito.usuarioId`, nunca o de outro usuário.
 */
export async function definirTema(sujeito: Sujeito, tema: Tema): Promise<void> {
  if (!ehTema(tema)) {
    throw new Error('Tema inválido.')
  }

  await db.usuario.update({
    where: { id: sujeito.usuarioId },
    data: { tema: temaParaBanco(tema) },
    select: { id: true },
  })
}

export interface UsuarioResumo {
  id: string
  nome: string
  email: string
  ativo: boolean
  papeis: readonly PapelAtribuido[]
  criadoEm: Date
}

export interface DadosNovoUsuario {
  email: string
  nome: string
  senha: string
  papel: Papel
}

export async function listarUsuarios(sujeito: Sujeito): Promise<UsuarioResumo[]> {
  exigirPermissao(sujeito, 'usuarios.gerenciar')

  const usuarios = await db.usuario.findMany({
    orderBy: { nome: 'asc' },
    select: {
      id: true,
      nome: true,
      email: true,
      ativo: true,
      criadoEm: true,
      papeis: {
        select: {
          papel: true,
          clienteId: true,
        },
      },
    },
  })

  return usuarios.map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    ativo: u.ativo,
    criadoEm: u.criadoEm,
    papeis: u.papeis.map((p) => ({
      papel: converterPapelDoBanco(p.papel),
      clienteId: p.clienteId,
    })),
  }))
}

export async function criarUsuarioComoAdmin(
  sujeito: Sujeito,
  dados: DadosNovoUsuario,
): Promise<{ id: string }> {
  exigirPermissao(sujeito, 'usuarios.gerenciar')

  return criarUsuario({
    email: dados.email,
    nome: dados.nome,
    senha: dados.senha,
    papeis: [{ papel: dados.papel, clienteId: null }],
  })
}

export async function alterarAtivo(
  sujeito: Sujeito,
  usuarioId: string,
  ativo: boolean,
): Promise<void> {
  exigirPermissao(sujeito, 'usuarios.gerenciar')

  if (sujeito.usuarioId === usuarioId && !ativo) {
    throw new Error('Você não pode desativar a própria conta.')
  }

  const usuario = await db.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true },
  })

  if (!usuario) {
    throw new Error('Usuário não encontrado.')
  }

  await db.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id: usuarioId },
      data: { ativo },
    })

    if (!ativo) {
      await tx.sessao.deleteMany({
        where: { usuarioId },
      })
    }
  })
}
