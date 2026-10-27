import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { type EstadoIntegracao, estadoDoRepositorio } from '@/modules/github/model'
import { exigirLeituraGlobal, intervaloDaIntegracao } from '@/modules/github/service'
import {
  formatoDeTokenValido,
  hashDoTokenDeEvidencia,
  PREFIXO_DO_TOKEN,
  rotuloDaVersao,
  TIPOS_DE_AMBIENTE,
  type SituacaoEvidencia,
  type TipoAmbiente,
  validarNomeNoGitHub,
  validarUrlDoAmbiente,
} from './model'

const LIMITE_DO_CORPO_EM_BYTES = 16_384
const TOLERANCIA_DE_RELOGIO_MS = 5 * 60_000

export interface AmbienteNaTela {
  tipo: TipoAmbiente
  configurado: boolean
  nomeNoGitHub: string | null
  url: string | null
  tokenCriadoEm: Date | null
}

export interface LeituraDeDeployments {
  repositorio: string
  estado: EstadoIntegracao
  lidoEm: Date | null
  falhaMotivo: string | null
}

function normalizarNome(v: string): string {
  return v.trim().toLowerCase()
}

export async function obterAmbientesDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
): Promise<{
  ambientes: AmbienteNaTela[]
  leituras: LeituraDeDeployments[]
  githubConfigurado: boolean
  repositoriosVinculados: number
}> {
  exigirLeituraGlobal(sujeito)

  const [linhas, repositorios, integracao] = await Promise.all([
    db.ambiente.findMany({ where: { projetoId } }),
    db.repositorioGitHub.findMany({ where: { projetoId }, orderBy: { nomeCompleto: 'asc' } }),
    db.integracaoGitHub.findUnique({ where: { id: 'github' } }),
  ])

  const agora = new Date()
  const intervalo = intervaloDaIntegracao()
  const ambientes = TIPOS_DE_AMBIENTE.map<AmbienteNaTela>((tipo) => {
    const linha = linhas.find((a) => a.tipo === tipo)
    return {
      tipo,
      configurado: linha !== undefined,
      nomeNoGitHub: linha?.nomeNoGitHub ?? null,
      url: linha?.url ?? null,
      tokenCriadoEm: linha?.tokenEvidenciaHash ? (linha.tokenCriadoEm ?? null) : null,
    }
  })
  const leituras = repositorios.map<LeituraDeDeployments>((r) => ({
    repositorio: r.nomeCompleto,
    estado: estadoDoRepositorio(
      {
        sincronizadoEm: r.deploymentsSincronizadosEm,
        ultimaFalhaEm: r.deploymentsFalhaEm,
        removidoDaInstalacaoEm: r.removidoDaInstalacaoEm,
      },
      agora,
      intervalo,
    ),
    lidoEm: r.deploymentsSincronizadosEm,
    falhaMotivo: r.removidoDaInstalacaoEm
      ? 'A Central não tem mais acesso a este repositório.'
      : r.deploymentsFalhaMotivo,
  }))

  return {
    ambientes,
    leituras,
    githubConfigurado: integracao?.configurada ?? false,
    repositoriosVinculados: repositorios.length,
  }
}

export async function contarAmbientesPorProjeto(
  sujeito: Sujeito,
): Promise<ReadonlyMap<string, number>> {
  exigirLeituraGlobal(sujeito)

  const grupos = await db.ambiente.groupBy({ by: ['projetoId'], _count: { _all: true } })
  return new Map(grupos.map((g) => [g.projetoId, g._count._all] as const))
}

async function exigirProjetoAtivo(projetoId: string): Promise<void> {
  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, arquivadoEm: true },
  })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }
  if (projeto.arquivadoEm !== null) {
    throw new ErroDeDominio('Projeto arquivado não recebe ambientes.')
  }
}

export async function salvarAmbiente(
  sujeito: Sujeito,
  projetoId: string,
  tipo: TipoAmbiente,
  dados: { nomeNoGitHub: string; url: string },
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const nomeNoGitHub = validarNomeNoGitHub(dados.nomeNoGitHub)
  const url = validarUrlDoAmbiente(dados.url)
  await exigirProjetoAtivo(projetoId)

  await db.$transaction(async (tx) => {
    const ambientes = await tx.ambiente.findMany({ where: { projetoId } })
    if (
      nomeNoGitHub !== null &&
      ambientes.some(
        (a) =>
          a.tipo !== tipo &&
          a.nomeNoGitHub !== null &&
          normalizarNome(a.nomeNoGitHub) === normalizarNome(nomeNoGitHub),
      )
    ) {
      throw new ErroDeDominio('Outro ambiente deste projeto já usa este nome do GitHub.')
    }

    const atual = ambientes.find((a) => a.tipo === tipo)
    await tx.ambiente.upsert({
      where: { projetoId_tipo: { projetoId, tipo } },
      create: { projetoId, tipo, nomeNoGitHub, url },
      update: { nomeNoGitHub, url },
    })

    // Um nome novo relê o histórico de deployments dos repositórios do projeto.
    const mudouDeNome =
      nomeNoGitHub !== null &&
      (atual?.nomeNoGitHub == null ||
        normalizarNome(atual.nomeNoGitHub) !== normalizarNome(nomeNoGitHub))
    if (mudouDeNome) {
      await tx.repositorioGitHub.updateMany({
        where: { projetoId },
        data: { cursorDeployments: null, sincronizacaoSolicitadaEm: new Date() },
      })
    }
  })
}

export async function gerarTokenDeEvidencia(
  sujeito: Sujeito,
  projetoId: string,
  tipo: TipoAmbiente,
): Promise<string> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  await exigirProjetoAtivo(projetoId)

  const token = `${PREFIXO_DO_TOKEN}${randomBytes(32).toString('base64url')}`
  const { count } = await db.ambiente.updateMany({
    where: { projetoId, tipo },
    data: { tokenEvidenciaHash: hashDoTokenDeEvidencia(token), tokenCriadoEm: new Date() },
  })
  if (count === 0) {
    throw new ErroDeDominio('Salve o ambiente antes de gerar o token.')
  }
  return token
}

export async function revogarTokenDeEvidencia(
  sujeito: Sujeito,
  projetoId: string,
  tipo: TipoAmbiente,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  await exigirProjetoAtivo(projetoId)

  await db.ambiente.updateMany({
    where: { projetoId, tipo },
    data: { tokenEvidenciaHash: null, tokenCriadoEm: null },
  })
}

// Autentica o token de um ambiente; ausente, malformado, desconhecido e revogado são iguais.
export async function autenticarTokenDeEvidencia(
  token: string,
): Promise<{ ambienteId: string } | null> {
  if (!formatoDeTokenValido(token)) {
    return null
  }
  const ambiente = await db.ambiente.findUnique({
    where: { tokenEvidenciaHash: hashDoTokenDeEvidencia(token) },
    select: { id: true },
  })
  return ambiente ? { ambienteId: ambiente.id } : null
}

export type RespostaDoEndpoint =
  | { status: 200 | 201; corpo: { id: string; versaoId: string; duplicada: boolean } }
  | { status: 400 | 401 | 413 | 422; corpo: { erro: string; campos?: string[] } }

export const LIMITE_DO_CORPO_DO_ENDPOINT = LIMITE_DO_CORPO_EM_BYTES

const SITUACOES: Record<'sucesso' | 'falha' | 'em_andamento', SituacaoEvidencia> = {
  sucesso: 'SUCESSO',
  falha: 'FALHA',
  em_andamento: 'EM_ANDAMENTO',
}

const corpoSchema = z.strictObject({
  repositorio: z
    .string()
    .max(140)
    .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/),
  commitSha: z.string().regex(/^[0-9a-fA-F]{40}$/),
  versao: z.string().trim().min(1).max(60).optional(),
  situacao: z.enum(['sucesso', 'falha', 'em_andamento']).default('sucesso'),
  ocorridaEm: z.iso.datetime({ offset: true }).optional(),
  idExterno: z.string().min(1).max(120).optional(),
  ambiente: z
    .string()
    .transform((v) => v.toUpperCase())
    .pipe(z.enum(TIPOS_DE_AMBIENTE))
    .optional(),
  origem: z.string().max(200).optional(),
})

const naoAutorizado = { status: 401, corpo: { erro: 'Token de evidência inválido.' } } as const

function extrairToken(autorizacao: string | null): string | null {
  const m = /^Bearer (\S+)$/.exec(autorizacao ?? '')
  return m?.[1] ?? null
}

function camposInvalidos(erro: z.ZodError): string[] {
  const campos = erro.issues.map((i) =>
    i.code === 'unrecognized_keys' ? 'campo desconhecido' : i.path.join('.'),
  )
  return [...new Set(campos)]
}

export async function registrarEvidenciaPorToken(
  autorizacao: string | null,
  corpo: string,
  agora: Date,
): Promise<RespostaDoEndpoint> {
  const token = extrairToken(autorizacao)
  const autenticado = token === null ? null : await autenticarTokenDeEvidencia(token)
  if (autenticado === null) {
    return naoAutorizado
  }
  const { ambienteId } = autenticado
  const responder = <R extends RespostaDoEndpoint>(resultado: string, resposta: R): R => {
    log.info({ ambienteId, resultado }, 'Evidência de deploy recebida.')
    return resposta
  }

  if (Buffer.byteLength(corpo, 'utf8') > LIMITE_DO_CORPO_EM_BYTES) {
    return responder('corpo-grande', {
      status: 413,
      corpo: { erro: 'Corpo grande demais.' },
    } as const)
  }

  let json: unknown
  try {
    json = JSON.parse(corpo)
  } catch {
    return responder('corpo-invalido', {
      status: 400,
      corpo: { erro: 'Corpo inválido.' },
    } as const)
  }
  const parse = corpoSchema.safeParse(json)
  if (!parse.success) {
    return responder('corpo-invalido', {
      status: 400,
      corpo: { erro: 'Corpo inválido.', campos: camposInvalidos(parse.error) },
    } as const)
  }
  const dados = parse.data

  const ambiente = await db.ambiente.findUniqueOrThrow({
    where: { id: ambienteId },
    include: { projeto: { select: { arquivadoEm: true } } },
  })
  if (dados.ambiente !== undefined && dados.ambiente !== ambiente.tipo) {
    return responder('ambiente-diferente', {
      status: 422,
      corpo: { erro: 'O token não pertence ao ambiente informado.' },
    } as const)
  }

  const repositorio = await db.repositorioGitHub.findFirst({
    where: {
      nomeCompleto: { equals: dados.repositorio, mode: 'insensitive' },
      projetoId: ambiente.projetoId,
      removidoDaInstalacaoEm: null,
    },
    select: { id: true },
  })
  if (!repositorio) {
    return responder('repositorio-nao-vinculado', {
      status: 422,
      corpo: { erro: 'Repositório não vinculado ao projeto deste ambiente.' },
    } as const)
  }
  if (ambiente.projeto.arquivadoEm !== null) {
    return responder('projeto-arquivado', {
      status: 422,
      corpo: { erro: 'Projeto arquivado não recebe evidências.' },
    } as const)
  }

  const ocorridaEm = dados.ocorridaEm ? new Date(dados.ocorridaEm) : agora
  if (ocorridaEm.getTime() > agora.getTime() + TOLERANCIA_DE_RELOGIO_MS) {
    return responder('data-no-futuro', {
      status: 422,
      corpo: { erro: 'A data do deploy não pode estar no futuro.' },
    } as const)
  }

  const idExterno = dados.idExterno === undefined ? null : `${ambienteId}:${dados.idExterno}`
  const duplicadaDe = async () =>
    idExterno === null
      ? null
      : db.evidenciaDeploy.findUnique({
          where: { origem_idExterno: { origem: 'ENDPOINT', idExterno } },
          select: { id: true, versaoId: true },
        })

  const existente = await duplicadaDe()
  if (existente) {
    return responder('duplicada', {
      status: 200,
      corpo: { id: existente.id, versaoId: existente.versaoId, duplicada: true },
    } as const)
  }

  const commitSha = dados.commitSha.toLowerCase()
  try {
    const criada = await db.$transaction(async (tx) => {
      const versao = await tx.versao.upsert({
        where: { repositorioId_commitSha: { repositorioId: repositorio.id, commitSha } },
        create: {
          projetoId: ambiente.projetoId,
          repositorioId: repositorio.id,
          commitSha,
          rotulo: rotuloDaVersao({ informado: dados.versao, ref: null, commitSha }),
        },
        update: {},
      })
      return tx.evidenciaDeploy.create({
        data: {
          ambienteId,
          versaoId: versao.id,
          origem: 'ENDPOINT',
          situacao: SITUACOES[dados.situacao],
          ocorridaEm,
          registradaEm: agora,
          idExterno,
          detalhe: dados.origem ?? 'Endpoint de evidência',
        },
        select: { id: true, versaoId: true },
      })
    })
    return responder('criada', {
      status: 201,
      corpo: { id: criada.id, versaoId: criada.versaoId, duplicada: false },
    } as const)
  } catch (erro) {
    // Dois pedidos com o mesmo idExterno ao mesmo tempo: o segundo reconhece o primeiro.
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      const concorrente = await duplicadaDe()
      if (concorrente) {
        return responder('duplicada', {
          status: 200,
          corpo: { id: concorrente.id, versaoId: concorrente.versaoId, duplicada: true },
        } as const)
      }
    }
    throw erro
  }
}
