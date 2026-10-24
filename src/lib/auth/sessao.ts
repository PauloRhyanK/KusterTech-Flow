import { createHash, randomBytes } from 'node:crypto'
import type { Papel as PapelPrisma } from '@prisma/client'
import { cookies } from 'next/headers'
import { PERMISSOES, type Papel, type PapelAtribuido, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'

export const NOME_COOKIE = 'flow_sessao'
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60_000
const INTERVALO_RENOVACAO_MS = 24 * 60 * 60_000

export interface SessaoAtual {
  sessaoId: string
  usuario: {
    id: string
    nome: string
    email: string
  }
  sujeito: Sujeito
}

type VerificarPapelBancoParaDominio = PapelPrisma extends Papel ? true : never
type VerificarPapelDominioParaBanco = Papel extends PapelPrisma ? true : never
const _garantiaDeParidadeDePapel: [VerificarPapelBancoParaDominio, VerificarPapelDominioParaBanco] =
  [true, true]
void _garantiaDeParidadeDePapel

export function converterPapelDoBanco(papel: PapelPrisma): Papel {
  if (Object.prototype.hasOwnProperty.call(PERMISSOES, papel)) {
    return papel
  }
  throw new Error(`Papel desconhecido no banco: ${String(papel)}`)
}

export function gerarToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function criarSessao(
  usuarioId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; expiraEm: Date }> {
  const token = gerarToken()
  const tokenHash = hashDoToken(token)
  const agora = new Date()
  const expiraEm = new Date(agora.getTime() + DURACAO_SESSAO_MS)

  await db.sessao.create({
    data: {
      usuarioId,
      tokenHash,
      criadaEm: agora,
      ultimoUsoEm: agora,
      expiraEm,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  })

  return { token, expiraEm }
}

export async function obterSessaoPorToken(
  token: string,
  agora: Date = new Date(),
): Promise<SessaoAtual | null> {
  if (!token) {
    return null
  }

  const tokenHash = hashDoToken(token)
  const sessao = await db.sessao.findUnique({
    where: { tokenHash },
    include: {
      usuario: {
        include: {
          papeis: true,
        },
      },
    },
  })

  if (!sessao) {
    return null
  }

  if (sessao.expiraEm.getTime() <= agora.getTime()) {
    return null
  }

  if (!sessao.usuario.ativo) {
    return null
  }

  if (agora.getTime() - sessao.ultimoUsoEm.getTime() > INTERVALO_RENOVACAO_MS) {
    await db.sessao.update({
      where: { id: sessao.id },
      data: {
        ultimoUsoEm: agora,
        expiraEm: new Date(agora.getTime() + DURACAO_SESSAO_MS),
      },
    })
  }

  const papeis: PapelAtribuido[] = sessao.usuario.papeis.map((atribuicao) => ({
    papel: converterPapelDoBanco(atribuicao.papel),
    clienteId: atribuicao.clienteId,
  }))

  return {
    sessaoId: sessao.id,
    usuario: {
      id: sessao.usuario.id,
      nome: sessao.usuario.nome,
      email: sessao.usuario.email,
    },
    sujeito: {
      usuarioId: sessao.usuario.id,
      papeis,
    },
  }
}

export async function encerrarSessaoPorToken(token: string): Promise<void> {
  if (!token) {
    return
  }

  const tokenHash = hashDoToken(token)
  await db.sessao.deleteMany({
    where: { tokenHash },
  })
}

export async function obterSessao(): Promise<SessaoAtual | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(NOME_COOKIE)?.value
  if (!token) {
    return null
  }
  return obterSessaoPorToken(token)
}

export function opcoesDoCookie(expiraEm: Date): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
  expires: Date
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiraEm,
  }
}
