import { hash, hashSync, verify } from '@node-rs/argon2'

const PARAMETROS_ARGON2 = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

// Hash calculado na carga do módulo sobre uma string fixa (não é segredo);
// usado para igualar o custo de CPU quando o e-mail não existe ou o usuário está inativo.
export const HASH_FICTICIO: string = hashSync(
  'kustertech-flow-tempo-constante-ficticio',
  PARAMETROS_ARGON2,
)

export async function hashSenha(senha: string): Promise<string> {
  return hash(senha, PARAMETROS_ARGON2)
}

export async function verificarSenha(senha: string, hashArmazenado: string): Promise<boolean> {
  try {
    return await verify(hashArmazenado, senha)
  } catch {
    return false
  }
}
