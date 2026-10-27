import type { Papel } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { temaParaBanco, type Tema } from '@/lib/tema/tema'
import { normalizarNome, validarNomeDeCliente } from '@/modules/clientes/model'
import { validarNomeDeProjeto } from '@/modules/projetos/model'
import { criarUsuario } from '@/modules/usuarios/service'

export function nomeDeTeste(base: string): string {
  const sufixo = process.env.E2E_SUFIXO || 'teste'
  const idUnico = Math.random().toString(36).slice(2, 8)
  return `E2E ${base} ${sufixo}-${idUnico}`
}

export async function criarUsuarioNoBanco(dados: {
  email: string
  nome: string
  senha: string
  papel: Papel
  clienteId?: string | null
}): Promise<{ id: string }> {
  return criarUsuario({
    email: dados.email,
    nome: dados.nome,
    senha: dados.senha,
    papeis: [{ papel: dados.papel, clienteId: dados.clienteId ?? null }],
  })
}

export async function criarClienteNoBanco(
  nome: string,
  observacoes?: string | null,
): Promise<{ id: string; nome: string }> {
  const nomeValido = validarNomeDeCliente(nome)
  const nomeNormalizado = normalizarNome(nomeValido)
  return db.cliente.create({
    data: {
      nome: nomeValido,
      nomeNormalizado,
      observacoes: observacoes?.trim() || null,
    },
    select: { id: true, nome: true },
  })
}

export async function criarProjetoNoBanco(
  nome: string,
  clientesIds?: string[],
): Promise<{ id: string; nome: string }> {
  const nomeValido = validarNomeDeProjeto(nome)
  const nomeNormalizado = normalizarNome(nomeValido)
  return db.projeto.create({
    data: {
      nome: nomeValido,
      nomeNormalizado,
      clientes:
        clientesIds && clientesIds.length > 0
          ? {
              create: clientesIds.map((clienteId) => ({ clienteId })),
            }
          : undefined,
    },
    select: { id: true, nome: true },
  })
}

export async function associarNoBanco(projetoId: string, clienteId: string): Promise<void> {
  await db.projetoCliente.create({
    data: {
      projetoId,
      clienteId,
    },
  })
}

export async function contarClientes(): Promise<number> {
  return db.cliente.count()
}

export async function contarProjetos(): Promise<number> {
  return db.projeto.count()
}

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

export function repositoriosDoProjetoE2E(projectName: string): [string, string] {
  return projectName === 'mobile'
    ? ['kustertech-exemplo/site', 'kustertech-exemplo/app-mobile']
    : ['kustertech-exemplo/portal', 'kustertech-exemplo/api']
}

export async function vincularNoBanco(projetoId: string, nomeCompleto: string): Promise<void> {
  const agora = new Date()
  await db.repositorioGitHub.updateMany({
    where: { nomeCompleto },
    data: { projetoId, vinculadoEm: agora, sincronizacaoSolicitadaEm: agora },
  })
}

// Desvincula e devolve a situação de sincronização ao estado de recém-catalogado, para que
// um teste anterior (por exemplo, o que força a última sincronização para o passado) não
// contamine o seguinte. Issues e PRs ficam: o próximo ciclo do worker os reconcilia.
export async function liberarRepositoriosNoBanco(nomes: readonly string[]): Promise<void> {
  await db.repositorioGitHub.updateMany({
    where: { nomeCompleto: { in: [...nomes] } },
    data: {
      projetoId: null,
      vinculadoEm: null,
      sincronizadoEm: null,
      sincronizacaoSolicitadaEm: null,
      ultimaFalhaEm: null,
      ultimaFalhaMotivo: null,
      falhasConsecutivas: 0,
      cursorIssues: null,
      cursorPullRequests: null,
    },
  })
}

export async function definirSituacaoDoRepositorio(
  nomeCompleto: string,
  situacao: {
    sincronizadoEm?: Date | null
    ultimaFalhaEm?: Date | null
    ultimaFalhaMotivo?: string | null
  },
): Promise<void> {
  await db.repositorioGitHub.updateMany({ where: { nomeCompleto }, data: situacao })
}

export async function obterRepositorioNoBanco(
  nomeCompleto: string,
): Promise<{ id: string; projetoId: string | null }> {
  return db.repositorioGitHub.findFirstOrThrow({
    where: { nomeCompleto },
    select: { id: true, projetoId: true },
  })
}

export async function contarIssues(): Promise<number> {
  return db.issueGitHub.count()
}

export async function obterIssueNoBanco(
  nomeCompleto: string,
  numero: number,
): Promise<{ id: string }> {
  return db.issueGitHub.findFirstOrThrow({
    where: { numero, repositorio: { nomeCompleto } },
    select: { id: true },
  })
}
