import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { autorizar, exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { filtrarIssuesVisiveisNoCliente, issueVisivelNoCliente } from '@/modules/entregas/queries'
import { type EstadoIntegracao, estadoDoRepositorio } from '@/modules/github/model'
import { exigirLeituraGlobal, intervaloDaIntegracao } from '@/modules/github/service'
import type { Contexto } from '@/modules/projetos/model'
import { obterProjeto } from '@/modules/projetos/service'
import { implantacaoDasIssues } from './implantacao'
import {
  evidenciaVigente,
  type EvidenciaParaEstado,
  formatoDeTokenValido,
  type ImplantacaoNoAmbiente,
  hashDoTokenDeEvidencia,
  type OrigemEvidencia,
  PREFIXO_DO_TOKEN,
  rotuloDaVersao,
  TIPOS_DE_AMBIENTE,
  type SituacaoEvidencia,
  type TipoAmbiente,
  validarNomeNoGitHub,
  validarShaDeCommit,
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

export interface SituacaoNoAmbiente {
  tipo: TipoAmbiente
  repositorio: string
  vigente: {
    rotulo: string
    commitCurto: string
    origem: OrigemEvidencia
    ocorridaEm: Date
    autor: string | null
  } | null
  ultimoDeploy: { situacao: 'FALHA' | 'EM_ANDAMENTO'; rotulo: string; ocorridaEm: Date } | null
}

export interface VersaoNaLista {
  id: string
  rotulo: string
  commitCurto: string
  repositorio: string
  vigenteEm: TipoAmbiente[]
  ultimaEvidencia: {
    tipo: TipoAmbiente
    origem: OrigemEvidencia
    situacao: SituacaoEvidencia
    ocorridaEm: Date
    autor: string | null
  }
}

const LIMITE_DE_VERSOES = 50

function normalizarNome(v: string): string {
  return v.trim().toLowerCase()
}

function leiturasDeDeployments(
  repositorios: readonly {
    nomeCompleto: string
    deploymentsSincronizadosEm: Date | null
    deploymentsFalhaEm: Date | null
    deploymentsFalhaMotivo: string | null
    removidoDaInstalacaoEm: Date | null
  }[],
): LeituraDeDeployments[] {
  const agora = new Date()
  const intervalo = intervaloDaIntegracao()
  return repositorios.map<LeituraDeDeployments>((r) => ({
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
  const leituras = leiturasDeDeployments(repositorios)

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

function ehConflitoDeUnicidade(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}

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
  const gravar = () =>
    db.$transaction(async (tx) => {
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
  try {
    // Dois pipelines com o mesmo commit novo podem criar a Versao ao mesmo tempo: a segunda tentativa a reutiliza.
    const criada = await gravar().catch((erro: unknown) =>
      ehConflitoDeUnicidade(erro) ? gravar() : Promise.reject(erro),
    )
    return responder('criada', {
      status: 201,
      corpo: { id: criada.id, versaoId: criada.versaoId, duplicada: false },
    } as const)
  } catch (erro) {
    // Dois pedidos com o mesmo idExterno ao mesmo tempo: o segundo reconhece o primeiro.
    if (ehConflitoDeUnicidade(erro)) {
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

interface EvidenciaDaLista extends EvidenciaParaEstado {
  tipo: TipoAmbiente
  repositorioId: string
  commitSha: string
  autor: string | null
}

function maisRecenteQue(a: EvidenciaParaEstado, b: EvidenciaParaEstado): boolean {
  const porOcorrencia = a.ocorridaEm.getTime() - b.ocorridaEm.getTime()
  return porOcorrencia !== 0 ? porOcorrencia > 0 : a.registradaEm > b.registradaEm
}

function maisRecenteDe<T extends EvidenciaParaEstado>(lista: readonly T[]): T | null {
  return lista.reduce<T | null>((m, e) => (m === null || maisRecenteQue(e, m) ? e : m), null)
}

export async function listarVersoesDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  filtros: { repositorioId: string | null },
): Promise<{
  ambientesConfigurados: TipoAmbiente[]
  repositorios: { id: string; nomeCompleto: string }[]
  situacoes: SituacaoNoAmbiente[]
  versoes: VersaoNaLista[]
  total: number
  leituras: LeituraDeDeployments[]
}> {
  exigirLeituraGlobal(sujeito)

  const [ambientes, todosRepositorios] = await Promise.all([
    db.ambiente.findMany({ where: { projetoId } }),
    db.repositorioGitHub.findMany({ where: { projetoId }, orderBy: { nomeCompleto: 'asc' } }),
  ])
  const repositorios = todosRepositorios.filter(
    (r) => filtros.repositorioId === null || r.id === filtros.repositorioId,
  )
  const configurados = TIPOS_DE_AMBIENTE.filter((t) => ambientes.some((a) => a.tipo === t))

  const linhas =
    ambientes.length === 0 || repositorios.length === 0
      ? []
      : await db.evidenciaDeploy.findMany({
          where: {
            ambienteId: { in: ambientes.map((a) => a.id) },
            versao: { repositorioId: { in: repositorios.map((r) => r.id) } },
          },
          include: {
            versao: { select: { rotulo: true, commitSha: true, repositorioId: true } },
            autor: { select: { nome: true } },
          },
        })
  const tipoDoAmbiente = new Map(ambientes.map((a) => [a.id, a.tipo] as const))
  const evidencias = linhas.map<EvidenciaDaLista>((l) => ({
    versaoId: l.versaoId,
    rotulo: l.versao.rotulo,
    origem: l.origem,
    situacao: l.situacao,
    ocorridaEm: l.ocorridaEm,
    registradaEm: l.registradaEm,
    tipo: tipoDoAmbiente.get(l.ambienteId) as TipoAmbiente,
    repositorioId: l.versao.repositorioId,
    commitSha: l.versao.commitSha,
    autor: l.autor?.nome ?? null,
  }))

  const vigentePorVersao = new Map<string, Set<TipoAmbiente>>()
  const situacoes: SituacaoNoAmbiente[] = []
  for (const tipo of configurados) {
    for (const repo of repositorios) {
      const doPar = evidencias.filter((e) => e.tipo === tipo && e.repositorioId === repo.id)
      const vigente = evidenciaVigente(doPar) as EvidenciaDaLista | null
      const posterior = maisRecenteDe(
        doPar.filter(
          (e) => e.situacao !== 'SUCESSO' && (vigente === null || maisRecenteQue(e, vigente)),
        ),
      )
      if (vigente) {
        const tipos = vigentePorVersao.get(vigente.versaoId) ?? new Set<TipoAmbiente>()
        vigentePorVersao.set(vigente.versaoId, tipos.add(tipo))
      }
      situacoes.push({
        tipo,
        repositorio: repo.nomeCompleto,
        vigente: vigente && {
          rotulo: vigente.rotulo,
          commitCurto: vigente.commitSha.slice(0, 7),
          origem: vigente.origem,
          ocorridaEm: vigente.ocorridaEm,
          autor: vigente.origem === 'MANUAL' ? vigente.autor : null,
        },
        ultimoDeploy:
          posterior && posterior.situacao !== 'SUCESSO'
            ? {
                situacao: posterior.situacao,
                rotulo: posterior.rotulo,
                ocorridaEm: posterior.ocorridaEm,
              }
            : null,
      })
    }
  }

  const nomeDoRepositorio = new Map(repositorios.map((r) => [r.id, r.nomeCompleto] as const))
  const porVersao = Map.groupBy(evidencias, (e) => e.versaoId)
  const todasAsVersoes = [...porVersao.entries()]
    .map(([id, doGrupo]) => ({ id, ultima: maisRecenteDe(doGrupo) as EvidenciaDaLista }))
    .sort((a, b) =>
      maisRecenteQue(a.ultima, b.ultima) ? -1 : maisRecenteQue(b.ultima, a.ultima) ? 1 : 0,
    )
  const versoes = todasAsVersoes
    .slice(0, LIMITE_DE_VERSOES)
    .map<VersaoNaLista>(({ id, ultima }) => ({
      id,
      rotulo: ultima.rotulo,
      commitCurto: ultima.commitSha.slice(0, 7),
      repositorio: nomeDoRepositorio.get(ultima.repositorioId) ?? '',
      vigenteEm: TIPOS_DE_AMBIENTE.filter((t) => vigentePorVersao.get(id)?.has(t)),
      ultimaEvidencia: {
        tipo: ultima.tipo,
        origem: ultima.origem,
        situacao: ultima.situacao,
        ocorridaEm: ultima.ocorridaEm,
        autor: ultima.origem === 'MANUAL' ? ultima.autor : null,
      },
    }))

  return {
    ambientesConfigurados: configurados,
    repositorios: todosRepositorios.map((r) => ({ id: r.id, nomeCompleto: r.nomeCompleto })),
    situacoes,
    versoes,
    total: todasAsVersoes.length,
    leituras: leiturasDeDeployments(repositorios),
  }
}

export interface DadosDeDeployManual {
  tipo: TipoAmbiente
  repositorioId: string
  commitSha: string
  rotulo: string
  ocorridaEm: Date | null
}

export async function registrarDeployManual(
  sujeito: Sujeito,
  projetoId: string,
  dados: DadosDeDeployManual,
  agora: Date,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const commitSha = validarShaDeCommit(dados.commitSha)
  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, arquivadoEm: true },
  })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }
  if (projeto.arquivadoEm !== null) {
    throw new ErroDeDominio('Projeto arquivado não recebe evidências.')
  }
  const ambiente = await db.ambiente.findUnique({
    where: { projetoId_tipo: { projetoId, tipo: dados.tipo } },
    select: { id: true },
  })
  if (!ambiente) {
    throw new ErroDeDominio('Configure o ambiente antes de registrar um deploy.')
  }
  const repositorio = await db.repositorioGitHub.findFirst({
    where: { id: dados.repositorioId, projetoId, removidoDaInstalacaoEm: null },
    select: { id: true },
  })
  if (!repositorio) {
    throw new ErroDeDominio('Repositório não vinculado a este projeto.')
  }
  const ocorridaEm = dados.ocorridaEm ?? agora
  if (ocorridaEm.getTime() > agora.getTime() + TOLERANCIA_DE_RELOGIO_MS) {
    throw new ErroDeDominio('A data do deploy não pode estar no futuro.')
  }

  const gravar = () =>
    db.$transaction(async (tx) => {
      const versao = await tx.versao.upsert({
        where: { repositorioId_commitSha: { repositorioId: repositorio.id, commitSha } },
        create: {
          projetoId,
          repositorioId: repositorio.id,
          commitSha,
          rotulo: rotuloDaVersao({ informado: dados.rotulo, ref: null, commitSha }),
        },
        update: {},
      })
      await tx.evidenciaDeploy.create({
        data: {
          ambienteId: ambiente.id,
          versaoId: versao.id,
          origem: 'MANUAL',
          situacao: 'SUCESSO',
          ocorridaEm,
          registradaEm: agora,
          autorId: sujeito.usuarioId,
          detalhe: 'Registro manual',
        },
      })
    })
  // Dois registros do mesmo commit novo podem criar a Versao ao mesmo tempo: o segundo a reutiliza.
  await gravar().catch((erro: unknown) =>
    ehConflitoDeUnicidade(erro) ? gravar() : Promise.reject(erro),
  )
}

export interface ImplantacaoNaTela extends ImplantacaoNoAmbiente {
  tipo: TipoAmbiente
  commitCurto: string | null
  confirmadaPor: { nome: string; em: Date } | null
  autorDoDeploy: string | null
}

export interface ImplantacaoDaIssueNaTela {
  ambientes: ImplantacaoNaTela[]
  nenhumConfigurado: boolean
  leituras: LeituraDeDeployments[]
  podeConfirmar: boolean
}

// Global exige a visão global; no contexto de cliente, `projetos.ler` com o cliente e o projeto
// associado a ele (a mesma regra da leitura de entregas).
async function autorizarLeituraDeImplantacao(
  sujeito: Sujeito,
  projetoId: string,
  contexto: Contexto,
): Promise<void> {
  if (contexto.tipo === 'global') {
    exigirLeituraGlobal(sujeito)
    const projeto = await db.projeto.findUnique({ where: { id: projetoId }, select: { id: true } })
    if (!projeto) {
      throw new ErroDeDominio('Projeto não encontrado.')
    }
    return
  }
  exigirPermissao(sujeito, 'projetos.ler', { clienteId: contexto.clienteId })
  await obterProjeto(sujeito, projetoId, contexto)
}

async function implantacoesNaTela(
  projetoId: string,
  issueIds: readonly string[],
  tipo: TipoAmbiente,
  contexto: Contexto,
): Promise<Map<string, ImplantacaoNaTela>> {
  const lidas = await implantacaoDasIssues(projetoId, issueIds, tipo)
  const global = contexto.tipo === 'global'
  return new Map(
    [...lidas].map(([issueId, l]) => [
      issueId,
      {
        configurado: l.configurado,
        estado: l.estado,
        // O motivo cita PRs e o cliente não vê dado técnico (invariante 10).
        motivo: global ? l.motivo : '',
        versao: l.versao,
        origem: global ? l.origem : null,
        ocorridaEm: l.ocorridaEm,
        tipo,
        commitCurto: global ? (l.commitSha?.slice(0, 7) ?? null) : null,
        confirmadaPor: l.confirmadaPor,
        autorDoDeploy: global ? l.autorDoDeploy : null,
      } satisfies ImplantacaoNaTela,
    ]),
  )
}

export async function obterImplantacaoDaIssue(
  sujeito: Sujeito,
  projetoId: string,
  issueId: string,
  contexto: Contexto,
): Promise<ImplantacaoDaIssueNaTela> {
  await autorizarLeituraDeImplantacao(sujeito, projetoId, contexto)

  const issue = await db.issueGitHub.findFirst({
    where: { id: issueId, repositorio: { projetoId } },
    include: { repositorio: true },
  })
  const visivel =
    issue !== null &&
    (contexto.tipo === 'global' ||
      (await issueVisivelNoCliente(projetoId, issueId, contexto.clienteId)))
  if (!issue || !visivel) {
    throw new ErroDeDominio('Issue não encontrada.')
  }

  const ambientes: ImplantacaoNaTela[] = []
  for (const tipo of TIPOS_DE_AMBIENTE) {
    const lida = (await implantacoesNaTela(projetoId, [issueId], tipo, contexto)).get(issueId)
    if (lida) {
      ambientes.push(lida)
    }
  }

  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { arquivadoEm: true },
  })
  const global = contexto.tipo === 'global'
  return {
    ambientes,
    nenhumConfigurado: ambientes.every((a) => !a.configurado),
    leituras: global ? leiturasDeDeployments([issue.repositorio]) : [],
    podeConfirmar:
      global && projeto?.arquivadoEm === null && autorizar(sujeito, 'projetos.gerenciar'),
  }
}

export async function listarPresencaEmQA(
  sujeito: Sujeito,
  projetoId: string,
  issueIds: readonly string[],
  contexto: Contexto,
): Promise<Map<string, ImplantacaoNaTela>> {
  await autorizarLeituraDeImplantacao(sujeito, projetoId, contexto)

  const ids =
    contexto.tipo === 'global'
      ? issueIds
      : await filtrarIssuesVisiveisNoCliente(projetoId, issueIds, contexto.clienteId)
  return implantacoesNaTela(projetoId, ids, 'QA', contexto)
}

export async function confirmarPresencaManual(
  sujeito: Sujeito,
  projetoId: string,
  dados: { issueId: string; versaoId: string; tipo: TipoAmbiente },
  agora: Date,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const projeto = await db.projeto.findUnique({
    where: { id: projetoId },
    select: { arquivadoEm: true },
  })
  if (!projeto) {
    throw new ErroDeDominio('Projeto não encontrado.')
  }
  if (projeto.arquivadoEm !== null) {
    throw new ErroDeDominio('Projeto arquivado não recebe confirmações.')
  }

  await db.$transaction(async (tx) => {
    const issue = await tx.issueGitHub.findFirst({
      where: { id: dados.issueId, repositorio: { projetoId, removidoDaInstalacaoEm: null } },
      select: { id: true, repositorioId: true },
    })
    const versao = issue
      ? await tx.versao.findFirst({
          where: { id: dados.versaoId, repositorioId: issue.repositorioId },
          select: { id: true },
        })
      : null
    if (!issue || !versao) {
      throw new ErroDeDominio('Issue não encontrada.')
    }

    // A versão precisa continuar vigente no ambiente escolhido (invariante 8).
    const ambiente = await tx.ambiente.findUnique({
      where: { projetoId_tipo: { projetoId, tipo: dados.tipo } },
      select: { id: true },
    })
    const evidencias = ambiente
      ? await tx.evidenciaDeploy.findMany({
          where: { ambienteId: ambiente.id, versao: { repositorioId: issue.repositorioId } },
          include: { versao: { select: { rotulo: true } } },
        })
      : []
    const vigente = evidenciaVigente(
      evidencias.map<EvidenciaParaEstado>((e) => ({
        versaoId: e.versaoId,
        rotulo: e.versao.rotulo,
        origem: e.origem,
        situacao: e.situacao,
        ocorridaEm: e.ocorridaEm,
        registradaEm: e.registradaEm,
      })),
    )
    if (vigente?.versaoId !== versao.id) {
      throw new ErroDeDominio(
        `A versão em ${dados.tipo} mudou desde que a página foi aberta. Confira de novo.`,
      )
    }

    const linha = await tx.presencaIssueVersao.findUnique({
      where: { issueId_versaoId: { issueId: issue.id, versaoId: versao.id } },
      select: { issueId: true },
    })
    if (!linha) {
      throw new ErroDeDominio(
        'A presença desta issue ainda não foi calculada; aguarde o próximo ciclo do worker.',
      )
    }

    const { count } = await tx.presencaIssueVersao.updateMany({
      where: {
        issueId: issue.id,
        versaoId: versao.id,
        estado: 'VERIFICACAO_NECESSARIA',
        confirmadaPorId: null,
      },
      data: {
        estado: 'CONFIRMACAO_MANUAL',
        motivo: 'Presença confirmada manualmente.',
        confirmadaPorId: sujeito.usuarioId,
        calculadaEm: agora,
      },
    })
    if (count === 0) {
      throw new ErroDeDominio('Esta issue não precisa de confirmação manual nesta versão.')
    }
  })
}
