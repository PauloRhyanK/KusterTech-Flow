import { db } from '@/lib/db'
import { temaParaBanco, type Tema } from '@/lib/tema/tema'

export async function definirTemaNoBanco(usuarioId: string, tema: Tema): Promise<void> {
  await db.usuario.update({
    where: { id: usuarioId },
    data: { tema: temaParaBanco(tema) },
    select: { id: true },
  })
}

export async function contarUsuarios(): Promise<number> {
  return db.usuario.count()
}

export async function existeUsuarioPorEmail(email: string): Promise<boolean> {
  const usuario = await db.usuario.findUnique({
    where: { email },
    select: { id: true },
  })
  return Boolean(usuario)
}
