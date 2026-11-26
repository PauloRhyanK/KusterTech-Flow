import { randomBytes, randomUUID } from 'node:crypto'
import {
  Prisma,
  type DestinoDaDemanda,
  type NivelDeAcompanhamento,
  type OrigemDaDemanda,
  type QuemConcluiEtapa,
  type TipoDeArquivoDaDemanda,
  type TipoDeDemanda as TipoDeDemandaNoBanco,
} from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import {
  apagarArquivo,
  caminhoDoArquivo,
  exigirArmazenamento,
  gravarParcial,
  promoverParcial,
} from './arquivos'
import { hashDoTokenDaFabrica, validarNomeDaFonteDaFabrica } from '@/modules/fabrica/model'
import { aplicarEventoDeParte, conferirPartesDaEtapa, criarParteDeEntrada } from './partes-service'
import { aplicarEfeitoCruzado, demandasATravar } from './cruzada-service'
import { fecharDemandaSeNoAr } from './partes-no-ar'
import { DESTINOS, NIVEIS, TIPOS, PREFIXO_DO_TOKEN_DE_DEMANDAS } from './contrato'
import {
  LIMITE_DA_DESCRICAO,
  LIMITE_DO_TITULO,
  descricaoDaFilha,
  estadoInicial,
  etapasComNoAr,
  tituloDaFilha,
  validarModelo,
  type Ator,
  type Destino,
  type Espera,
  type EstadoDaDemanda,
  type EtapaDefinida,
  type Marco,
  type Nivel,
  type Origem,
  type QuemConclui,
  type TipoDeDemanda,
} from './model'
import {
  LIMITE_POR_ARQUIVO,
  LIMITE_POR_DEMANDA,
  aplicarEvento,
  avaliarArquivo,
  compararEvento,
  dadosDaRetomada,
  type EventoAplicavel,
} from './transicoes'

type Cliente = Prisma.TransactionClient | typeof db
type TipoDeArquivo = 'anexo' | 'desenho' | 'captura'

/**
 * Chave do fluxo de eventos: quem insere um `EventoDaDemanda` segura a trava compartilhada até o
 * commit; a leitura do cursor da Fábrica pega a exclusiva e só lê sem escritor em andamento.
 * Assim nenhum `seq` menor aparece depois de um cursor maior já entregue.
 */
export const TRAVA_DOS_EVENTOS_SQL = Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtext('demanda-eventos'))`

const DEMANDA_NAO_ENCONTRADA = 'Demanda não encontrada.'
const PROJETO_NAO_ENCONTRADO = 'Projeto não encontrado.'

// Enum do banco (MAIÚSCULO) ↔ valor do fio (minúsculo): o único lugar dessa conversão.
const maiusculo = <T extends string>(v: string) => v.toUpperCase() as T
const minusculo = <T extends string>(v: string) => v.toLowerCase() as T

export const doFio = {
  nivel: (v: Nivel) => maiusculo<NivelDeAcompanhamento>(v),
  destino: (v: Destino) => maiusculo<DestinoDaDemanda>(v),
  tipo: (v: TipoDeDemanda) => maiusculo<TipoDeDemandaNoBanco>(v),
  origem: (v: Origem) => maiusculo<OrigemDaDemanda>(v),
  quemConclui: (v: QuemConclui) => maiusculo<QuemConcluiEtapa>(v),
  tipoDeArquivo: (v: TipoDeArquivo) => maiusculo<TipoDeArquivoDaDemanda>(v),
}

export const paraOFio = {
  nivel: (v: NivelDeAcompanhamento) => minusculo<Nivel>(v),
  destino: (v: DestinoDaDemanda) => minusculo<Destino>(v),
  tipo: (v: TipoDeDemandaNoBanco) => minusculo<TipoDeDemanda>(v),
  origem: (v: OrigemDaDemanda) => minusculo<Origem>(v),
  quemConclui: (v: QuemConcluiEtapa) => minusculo<QuemConclui>(v),
  tipoDeArquivo: (v: TipoDeArquivoDaDemanda) => minusculo<TipoDeArquivo>(v),
}

type LinhaDaDemanda = Prisma.DemandaGetPayload<object>

function estadoDaLinha(d: LinhaDaDemanda): EstadoDaDemanda {
  return {
    etapaAtual: d.etapaAtual,
    concluidas: d.concluidas,
    nivel: paraOFio.nivel(d.nivel),
    destino: d.destino ? paraOFio.destino(d.destino) : null,
    espera: d.espera as Espera | null,
    esperaMotivo: d.esperaMotivo,
    recusasDoDesenho: d.recusasDoDesenho,
    falhasDoTeste: d.falhasDoTeste,
    versaoDoDesenho: d.versaoDoDesenho,
    desenhoAprovado: d.desenhoAprovado,
    encerrada: d.encerrada as EstadoDaDemanda['encerrada'],
    antesDaTrava: (d.antesDaTrava ?? null) as EstadoDaDemanda['antesDaTrava'],
  }
}

/** Colunas que vêm do estado; `esperaDesde` só muda quando a espera muda. */
function colunasDoEstado(
  novo: EstadoDaDemanda,
  anterior: EstadoDaDemanda | null,
  esperaDesde: Date | null,
  agora: Date,
) {
  return {
    etapaAtual: novo.etapaAtual,
    concluidas: novo.concluidas,
    nivel: doFio.nivel(novo.nivel),
    destino: novo.destino ? doFio.destino(novo.destino) : null,
    espera: novo.espera,
    esperaMotivo: novo.esperaMotivo,
    esperaDesde:
      novo.espera === null ? null : novo.espera === anterior?.espera ? esperaDesde : agora,
    recusasDoDesenho: novo.recusasDoDesenho,
    falhasDoTeste: novo.falhasDoTeste,
    versaoDoDesenho: novo.versaoDoDesenho,
    desenhoAprovado: novo.desenhoAprovado,
    encerrada: novo.encerrada,
    antesDaTrava: novo.antesDaTrava ?? Prisma.DbNull,
  }
}

function etapaDaLinha(e: {
  chave: string
  nome: string
  rotulo: string
  marco: string | null
  quemConclui: QuemConcluiEtapa
  puladaSemTela: boolean
  esperaEm: NivelDeAcompanhamento[]
}): EtapaDefinida {
  return {
    chave: e.chave,
    nome: e.nome,
    rotulo: e.rotulo,
    marco: e.marco as Marco | null,
    quemConclui: paraOFio.quemConclui(e.quemConclui),
    puladaSemTela: e.puladaSemTela,
    esperaEm: e.esperaEm.map(paraOFio.nivel),
  }
}

function ehUnicoRepetido(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}

async function modeloDoProjetoCom(
  cliente: Cliente,
  projetoId: string,
): Promise<{ modeloId: string; etapas: EtapaDefinida[] }> {
  const projeto = await cliente.projeto.findUnique({
    where: { id: projetoId },
    select: { modeloDeEtapasId: true },
  })
  if (!projeto) throw new ErroDeDominio(PROJETO_NAO_ENCONTRADO)
  const etapas = { orderBy: { ordem: 'asc' as const } }
  const modelo = projeto.modeloDeEtapasId
    ? await cliente.modeloDeEtapas.findUnique({
        where: { id: projeto.modeloDeEtapasId },
        include: { etapas },
      })
    : await cliente.modeloDeEtapas.findFirst({ where: { padrao: true }, include: { etapas } })
  if (!modelo) {
    // Sem o padrão (semeado pela migration) não há como abrir demanda: falha alto.
    throw new Error('Não há modelo de etapas padrão no banco; aplique as migrations.')
  }
  return { modeloId: modelo.id, etapas: modelo.etapas.map(etapaDaLinha) }
}

/** O modelo do projeto, ou o padrão quando o projeto não escolheu um. */
export function modeloDoProjeto(
  projetoId: string,
): Promise<{ modeloId: string; etapas: EtapaDefinida[] }> {
  return modeloDoProjetoCom(db, projetoId)
}

export interface AberturaDeDemanda {
  projetoId: string
  repositorioId: string
  titulo: string
  descricao: string | null
  tipo: TipoDeDemanda | null
  nivel: Nivel | null
  temTela: boolean
  origem: Origem
  fonteId?: string
  chaveDaFonte?: string
  usuarioId?: string
}

/**
 * Grava a demanda com o retrato das etapas do modelo do projeto e o evento `criada`. Com
 * `(fonteId, chaveDaFonte)` já usada devolve a existente (`repetida: true`); a trava por chave
 * faz a repetição simultânea esperar a primeira em vez de bater no índice único.
 */
export async function abrirDemanda(
  tx: Prisma.TransactionClient,
  e: AberturaDeDemanda,
  agora: Date,
): Promise<{ id: string; repetida: boolean }> {
  if (e.fonteId && e.chaveDaFonte) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`demanda-da-fonte:${e.fonteId}:${e.chaveDaFonte}`}))`
    const existente = await tx.demanda.findUnique({
      where: { fonteId_chaveDaFonte: { fonteId: e.fonteId, chaveDaFonte: e.chaveDaFonte } },
      select: { id: true },
    })
    if (existente) return { id: existente.id, repetida: true }
  }

  const projeto = await tx.projeto.findUnique({
    where: { id: e.projetoId },
    select: { nivelPadraoDeDemanda: true },
  })
  if (!projeto) throw new ErroDeDominio(PROJETO_NAO_ENCONTRADO)
  const repositorio = await tx.repositorioGitHub.findUnique({
    where: { id: e.repositorioId },
    select: { projetoId: true },
  })
  if (repositorio?.projetoId !== e.projetoId) {
    throw new ErroDeDominio('O repositório não é deste projeto.')
  }

  const modelo = await modeloDoProjetoCom(tx, e.projetoId)
  const nivel = e.nivel ?? paraOFio.nivel(projeto.nivelPadraoDeDemanda)
  const estado = estadoInicial(modelo.etapas, e.temTela, nivel)

  const demanda = await tx.demanda.create({
    data: {
      projetoId: e.projetoId,
      repositorioId: e.repositorioId,
      titulo: e.titulo,
      descricao: e.descricao,
      tipo: e.tipo ? doFio.tipo(e.tipo) : null,
      temTela: e.temTela,
      origem: doFio.origem(e.origem),
      fonteId: e.fonteId ?? null,
      chaveDaFonte: e.fonteId ? (e.chaveDaFonte ?? null) : null,
      criadaPorId: e.usuarioId ?? null,
      modeloId: modelo.modeloId,
      etapas: modelo.etapas as unknown as Prisma.InputJsonValue,
      prs: [],
      ...colunasDoEstado(estado, null, null, agora),
    },
    select: { id: true },
  })
  await criarParteDeEntrada(tx, { id: demanda.id, repositorioId: e.repositorioId })
  await tx.$executeRaw(TRAVA_DOS_EVENTOS_SQL)
  await tx.eventoDaDemanda.create({
    data: {
      idExterno: randomUUID(),
      demandaId: demanda.id,
      tipo: 'criada',
      origem: e.origem,
      usuarioId: e.usuarioId ?? null,
      fonteId: e.fonteId ?? null,
      dados: { titulo: e.titulo, tipo: e.tipo, nivel, temTela: e.temTela },
      em: agora,
    },
  })
  return { id: demanda.id, repetida: false }
}

function textoOuNulo(v: string | null, maximo: number, campo: string): string | null {
  const t = v?.trim() ?? ''
  if (t === '') return null
  if (t.length > maximo) throw new ErroDeDominio(`${campo} passa de ${maximo} caracteres.`)
  return t
}

export async function criarDemanda(
  sujeito: Sujeito,
  e: {
    projetoId: string
    repositorioId: string | null
    titulo: string
    descricao: string | null
    nivel?: Nivel | null
    temTela: boolean
    anexos: File[]
  },
): Promise<{ id: string }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const titulo = e.titulo.trim()
  if (titulo.length < 1 || titulo.length > LIMITE_DO_TITULO) {
    throw new ErroDeDominio(`O título precisa ter de 1 a ${LIMITE_DO_TITULO} caracteres.`)
  }
  const descricao = textoOuNulo(e.descricao, LIMITE_DA_DESCRICAO, 'A descrição')
  const nivel = e.nivel ?? null
  if (nivel !== null && !NIVEIS.includes(nivel)) throw new ErroDeDominio('Nível inválido.')

  const projeto = await db.projeto.findUnique({
    where: { id: e.projetoId },
    select: { arquivadoEm: true, repositorios: { select: { id: true } } },
  })
  if (!projeto) throw new ErroDeDominio(PROJETO_NAO_ENCONTRADO)
  if (projeto.arquivadoEm !== null) {
    throw new ErroDeDominio('Projeto arquivado não recebe demandas.')
  }
  let repositorioId = e.repositorioId
  if (repositorioId === null) {
    if (projeto.repositorios.length !== 1) {
      throw new ErroDeDominio('Escolha o repositório da demanda.')
    }
    repositorioId = projeto.repositorios[0]!.id
  }

  // Confere os anexos antes de abrir a demanda; o service de arquivo confere de novo sob a trava.
  let usado = 0
  for (const anexo of e.anexos) {
    const a = avaliarArquivo({
      tipo: 'anexo',
      conteudo: anexo.type,
      tamanho: anexo.size,
      usadoNaDemanda: usado,
    })
    if (!a.ok) throw new ErroDeDominio(a.erro)
    usado += anexo.size
  }
  if (e.anexos.length > 0) await exigirArmazenamento()

  const { id } = await db.$transaction((tx) =>
    abrirDemanda(
      tx,
      {
        projetoId: e.projetoId,
        repositorioId,
        titulo,
        descricao,
        tipo: null,
        nivel,
        temTela: e.temTela,
        origem: 'flow',
        usuarioId: sujeito.usuarioId,
      },
      new Date(),
    ),
  )

  for (const anexo of e.anexos) {
    const r = await guardarArquivo({
      demandaId: id,
      arquivoId: randomUUID(),
      tipo: 'anexo',
      nome: anexo.name.slice(0, 100) || 'anexo',
      conteudo: anexo.type,
      tamanhoDeclarado: anexo.size,
      corpo: anexo.stream(),
      tela: null,
      enviadoPor: 'paulo',
      usuarioId: sujeito.usuarioId,
    })
    if (r.status !== 201) throw new ErroDeDominio((r.corpo as { erro: string }).erro)
  }
  return { id }
}

async function contarBytes(corpo: ReadableStream<Uint8Array>, limite: number): Promise<number> {
  const leitor = corpo.getReader()
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) return total
    total += value.byteLength
    if (total > limite) {
      await leitor.cancel()
      return total
    }
  }
}

type ArquivoGuardado = { status: 200 | 201 | 409 | 413 | 415; corpo: object }

const ARQUIVO_DIFERENTE = 'Arquivo com o mesmo id e conteúdo diferente.'

function mesmoArquivo(
  existente: { demandaId: string; tipo: TipoDeArquivoDaDemanda; tamanho: number },
  e: { demandaId: string; arquivoId: string; tipo: TipoDeArquivo },
  tamanho: number,
): ArquivoGuardado {
  const igual =
    existente.demandaId === e.demandaId &&
    existente.tipo === doFio.tipoDeArquivo(e.tipo) &&
    existente.tamanho === tamanho
  return igual
    ? { status: 200, corpo: { id: e.arquivoId } }
    : { status: 409, corpo: { erro: ARQUIVO_DIFERENTE } }
}

async function usadoNaDemanda(cliente: Cliente, demandaId: string): Promise<number> {
  const soma = await cliente.arquivoDaDemanda.aggregate({
    where: { demandaId, apagadoEm: null },
    _sum: { tamanho: true },
  })
  return soma._sum.tamanho ?? 0
}

/**
 * O corpo vai para um `.parcial` com id novo **fora de transação** (um envio lento não segura
 * conexão nem trava), com limite `min(10 MB, 100 MB − usado)` lido sem a trava. Depois, numa
 * transação curta sob a trava da demanda, tudo é conferido de novo (id, soma, tamanho real) e só
 * então o `.parcial` vira o arquivo e a linha é gravada: a garantia dos 100 MB vem dessa conferência.
 */
export async function guardarArquivo(e: {
  demandaId: string
  arquivoId: string
  tipo: TipoDeArquivo
  nome: string
  conteudo: string
  tamanhoDeclarado: number | null
  corpo: ReadableStream<Uint8Array>
  tela: 'desktop' | 'celular' | null
  enviadoPor: Ator
  fonteId?: string
  usuarioId?: string
}): Promise<ArquivoGuardado> {
  caminhoDoArquivo(e.demandaId, e.arquivoId) // ids que não são uuid saem já aqui
  const demanda = await db.demanda.findUnique({
    where: { id: e.demandaId },
    select: { id: true },
  })
  if (!demanda) throw new ErroDeDominio(DEMANDA_NAO_ENCONTRADA)

  const anterior = await db.arquivoDaDemanda.findUnique({ where: { id: e.arquivoId } })
  if (anterior) {
    const tamanho = e.tamanhoDeclarado ?? (await contarBytes(e.corpo, LIMITE_POR_ARQUIVO))
    return mesmoArquivo(anterior, e, tamanho)
  }

  const usadoSemTrava = await usadoNaDemanda(db, e.demandaId)
  const declarado = avaliarArquivo({
    tipo: e.tipo,
    conteudo: e.conteudo,
    tamanho: e.tamanhoDeclarado ?? 0,
    usadoNaDemanda: usadoSemTrava,
  })
  if (!declarado.ok) return { status: declarado.status, corpo: { erro: declarado.erro } }

  const limite = Math.max(0, Math.min(LIMITE_POR_ARQUIVO, LIMITE_POR_DEMANDA - usadoSemTrava))
  const tempId = randomUUID()
  const gravado = await gravarParcial(e.demandaId, tempId, e.corpo, limite)
  if (!gravado.ok) {
    const passou = avaliarArquivo({
      tipo: e.tipo,
      conteudo: e.conteudo,
      tamanho: limite + 1,
      usadoNaDemanda: usadoSemTrava,
    })
    return {
      status: 413,
      corpo: { erro: passou.ok ? 'A demanda passaria de 100 MB.' : passou.erro },
    }
  }

  let promovido = false
  try {
    const r = await db.$transaction(async (tx): Promise<ArquivoGuardado> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demanda:' || ${e.demandaId}))`
      const existente = await tx.arquivoDaDemanda.findUnique({ where: { id: e.arquivoId } })
      if (existente) return mesmoArquivo(existente, e, gravado.tamanho)

      const real = avaliarArquivo({
        tipo: e.tipo,
        conteudo: e.conteudo,
        tamanho: gravado.tamanho,
        usadoNaDemanda: await usadoNaDemanda(tx, e.demandaId),
      })
      if (!real.ok) return { status: real.status, corpo: { erro: real.erro } }

      await promoverParcial(e.demandaId, tempId, e.arquivoId)
      promovido = true
      await tx.arquivoDaDemanda.create({
        data: {
          id: e.arquivoId,
          demandaId: e.demandaId,
          tipo: doFio.tipoDeArquivo(e.tipo),
          nome: e.nome,
          conteudo: e.conteudo,
          tamanho: gravado.tamanho,
          tela: e.tela,
          enviadoPor: e.enviadoPor,
          fonteId: e.fonteId ?? null,
          usuarioId: e.usuarioId ?? null,
        },
      })
      return { status: 201, corpo: { id: e.arquivoId } }
    })
    return r
  } catch (erro) {
    // A linha não foi gravada: o arquivo promovido não pode ficar sem dono.
    if (promovido) await apagarArquivo(e.demandaId, e.arquivoId)
    throw erro
  } finally {
    // Recusa, repetição ou erro: o `.parcial` não fica no volume.
    if (!promovido) await apagarArquivo(e.demandaId, tempId)
  }
}

export type ResultadoDoRegistro =
  | { resultado: 'aplicado' | 'repetido'; estado: EstadoDaDemanda }
  | { resultado: 'conflito' }
  | { resultado: 'recusado'; motivo: string }

/** Campos que vêm dos dados do evento aplicado, não do estado. */
function colunasDoEvento(evento: EventoAplicavel, demanda: LinhaDaDemanda, agora: Date) {
  switch (evento.tipo) {
    case 'triagem':
      return {
        triagem: evento.dados as unknown as Prisma.InputJsonValue,
        tipo: demanda.tipo ?? doFio.tipo(evento.dados.tipo),
      }
    case 'plano_criado':
      return { planoCaminho: evento.dados.plano, planoPrUrl: evento.dados.prUrl }
    case 'plano_entregue':
      return {
        planoCaminho: evento.dados.plano,
        ...(evento.dados.artefato ? { artefatoUrl: evento.dados.artefato } : {}),
      }
    // `Demanda.prs` fica como está (as partes guardam os PRs); a entrega v1 marca `entregueEm`.
    case 'entregue':
      return { entregueEm: agora }
    default:
      return {}
  }
}

interface RegistroDeEvento {
  demandaId: string
  idExterno: string
  evento: EventoAplicavel & { ator: Ator }
  origem: 'fabrica' | 'paulo' | 'sessao' | 'flow'
  em: Date
  usuarioId?: string
  fonteId?: string
  /** Grava `Demanda.tipo` na mesma transação (a decisão do Paulo na triagem que falhou). */
  tipo?: TipoDeDemanda
  /** O contrato que a Fábrica falou; no 2, concluir etapa confere as partes (seção 7.2). */
  contrato?: 1 | 2
}

/**
 * Trava a linha da demanda, confere o `idExterno` (repetido ou conflito), aplica a transição pura e
 * grava o estado e um único `EventoDaDemanda` na mesma transação. Recusado não grava nada.
 */
export async function registrarEvento(e: RegistroDeEvento): Promise<ResultadoDoRegistro> {
  try {
    return await db.$transaction((tx) => registrarEventoNa(tx, e))
  } catch (erro) {
    // O mesmo idExterno gravado ao mesmo tempo em outra demanda: o índice único decide.
    if (ehUnicoRepetido(erro)) return { resultado: 'conflito' }
    throw erro
  }
}

/** O `registrarEvento` dentro de uma transação de quem chama (ela trava a linha da demanda). */
export async function registrarEventoNa(
  tx: Prisma.TransactionClient,
  e: RegistroDeEvento,
): Promise<ResultadoDoRegistro> {
  // O `juntar` trava também a demanda de destino, em ordem de id (sem travar em cruz).
  const travadas = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Demanda" WHERE "id" IN (${Prisma.join(demandasATravar(e.demandaId, e.evento))})
    ORDER BY "id" FOR UPDATE`
  if (!travadas.some((t) => t.id === e.demandaId)) throw new ErroDeDominio(DEMANDA_NAO_ENCONTRADA)
  const demanda = await tx.demanda.findUniqueOrThrow({ where: { id: e.demandaId } })
  const estado = estadoDaLinha(demanda)

  const guardado = await tx.eventoDaDemanda.findUnique({
    where: { idExterno: e.idExterno },
    select: { demandaId: true, tipo: true, dados: true },
  })
  if (guardado) {
    if (guardado.demandaId !== e.demandaId) return { resultado: 'conflito' }
    return compararEvento(guardado, e.evento) === 'repetido'
      ? { resultado: 'repetido', estado }
      : { resultado: 'conflito' }
  }

  let desenhoId: string | null = null
  if (e.evento.tipo === 'desenho_pronto') {
    const desenho = await tx.arquivoDaDemanda.findFirst({
      where: {
        id: e.evento.dados.arquivoId,
        demandaId: e.demandaId,
        tipo: 'DESENHO',
        apagadoEm: null,
      },
      select: { id: true, versao: true },
    })
    if (!desenho) return { resultado: 'recusado', motivo: 'Arquivo do desenho não encontrado.' }
    // Cada versão tem o seu arquivo; reaproveitar um deixaria a versão anterior sem arquivo.
    if (desenho.versao !== null) {
      return { resultado: 'recusado', motivo: 'Este arquivo já é uma versão do desenho.' }
    }
    desenhoId = desenho.id
  }

  const capturas = await tx.arquivoDaDemanda.findMany({
    where: { demandaId: e.demandaId, tipo: 'CAPTURA', apagadoEm: null, tela: { not: null } },
    select: { id: true, tela: true },
  })
  // Demanda aberta antes da regra "até o ar": o snapshot ganha a etapa "No ar" no fim (gravado
  // junto com o evento), senão o `entregue` do kit v1 seria recusado.
  const salvas = demanda.etapas as unknown as EtapaDefinida[]
  const etapas = salvas.length > 0 ? etapasComNoAr(salvas) : salvas
  const r = aplicarEvento(
    estado,
    {
      etapas,
      temTela: demanda.temTela,
      capturas: capturas.map((c) => ({ id: c.id, tela: c.tela as 'desktop' | 'celular' })),
      artefato: demanda.artefatoUrl,
    },
    e.evento,
  )
  if (!r.ok) return { resultado: 'recusado', motivo: r.motivo }

  const agora = new Date()
  if (
    e.contrato === 2 &&
    e.evento.tipo === 'etapa_concluida' &&
    (e.evento.dados.marco === 'desenvolvida' || e.evento.dados.marco === 'entregue')
  ) {
    const prontas = await conferirPartesDaEtapa(tx, e.demandaId, e.evento.dados.marco)
    if (!prontas.ok) return { resultado: 'recusado', motivo: prontas.motivo }
  }
  const nasPartes = await aplicarEventoDeParte(tx, demanda, e.evento, agora)
  if (!nasPartes.ok) return { resultado: 'recusado', motivo: nasPartes.motivo }
  const cruzado = await aplicarEfeitoCruzado(tx, demanda, e.evento, agora)
  if (!cruzado.ok) return { resultado: 'recusado', motivo: cruzado.motivo }
  await tx.demanda.update({
    where: { id: e.demandaId },
    data: {
      ...colunasDoEstado(r.estado, estado, demanda.esperaDesde, agora),
      ...colunasDoEvento(e.evento, demanda, agora),
      ...cruzado.colunas,
      ...(e.tipo ? { tipo: doFio.tipo(e.tipo) } : {}),
      ...(etapas.length !== salvas.length
        ? { etapas: etapas as unknown as Prisma.InputJsonValue }
        : {}),
    },
  })
  await tx.$executeRaw(TRAVA_DOS_EVENTOS_SQL)
  await tx.eventoDaDemanda.create({
    data: {
      idExterno: e.idExterno,
      demandaId: e.demandaId,
      tipo: e.evento.tipo,
      origem: e.origem,
      usuarioId: e.usuarioId ?? null,
      fonteId: e.fonteId ?? null,
      dados: e.evento.dados as unknown as Prisma.InputJsonValue,
      em: e.em,
    },
  })
  if (desenhoId) {
    await tx.arquivoDaDemanda.update({
      where: { id: desenhoId },
      data: { versao: r.estado.versaoDoDesenho },
    })
  }
  // Entrou na etapa "No ar" com todas as partes já no ar: fecha na mesma transação.
  if (
    !r.estado.encerrada &&
    r.estado.etapaAtual !== estado.etapaAtual &&
    etapas.find((x) => x.chave === r.estado.etapaAtual)?.marco === 'no_ar'
  ) {
    await fecharDemandaSeNoAr(tx, e.demandaId, agora)
  }
  return { resultado: 'aplicado', estado: r.estado }
}

async function decisaoDoPaulo(
  sujeito: Sujeito,
  demandaId: string,
  evento: EventoAplicavel,
  tipo?: TipoDeDemanda,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  const r = await registrarEvento({
    tipo,
    demandaId,
    idExterno: randomUUID(),
    evento: { ...evento, ator: 'paulo' },
    origem: 'paulo',
    em: new Date(),
    usuarioId: sujeito.usuarioId,
  })
  if (r.resultado === 'recusado') throw new ErroDeDominio(r.motivo)
  if (r.resultado === 'conflito') throw new Error('idExterno novo em conflito.')
}

// A versão 0 é o artefato do Claude no "planejar comigo"; a transição só a aceita com o artefato.
function exigirVersao(versao: number): void {
  if (!Number.isInteger(versao) || versao < 0) throw new ErroDeDominio('Versão inválida.')
}

export async function aprovarDesenho(
  sujeito: Sujeito,
  demandaId: string,
  versao: number,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  exigirVersao(versao)
  await decisaoDoPaulo(sujeito, demandaId, {
    tipo: 'desenho_aprovado',
    dados: versao === 0 ? { versao, peloArtefato: true } : { versao },
  })
}

export async function pedirAjuste(
  sujeito: Sujeito,
  demandaId: string,
  versao: number,
  texto: string,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  exigirVersao(versao)
  const t = texto.trim()
  if (t.length < 1 || t.length > 500) {
    throw new ErroDeDominio('O ajuste precisa ter de 1 a 500 caracteres.')
  }
  await decisaoDoPaulo(sujeito, demandaId, { tipo: 'ajuste_pedido', dados: { versao, texto: t } })
}

export async function decidirDestino(
  sujeito: Sujeito,
  demandaId: string,
  destino: Exclude<Destino, 'decisao_do_paulo'>,
  extras: { nivel?: Nivel; tipo?: TipoDeDemanda; escopo?: string } = {},
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  if (!DESTINOS.includes(destino) || (destino as Destino) === 'decisao_do_paulo') {
    throw new ErroDeDominio('Destino inválido.')
  }
  if (extras.nivel !== undefined && !NIVEIS.includes(extras.nivel)) {
    throw new ErroDeDominio('Nível inválido.')
  }
  if (extras.tipo !== undefined && !TIPOS.includes(extras.tipo)) {
    throw new ErroDeDominio('Tipo inválido.')
  }
  const escopo = extras.escopo?.trim()
  if (extras.escopo !== undefined && (escopo!.length < 1 || escopo!.length > 500)) {
    throw new ErroDeDominio('O escopo pode ter até 500 caracteres.')
  }
  await decisaoDoPaulo(
    sujeito,
    demandaId,
    {
      tipo: 'destino_decidido',
      dados: {
        destino,
        ...(extras.nivel ? { nivel: extras.nivel } : {}),
        ...(escopo ? { escopo } : {}),
      },
    },
    extras.tipo,
  )
}

export async function retomarDemanda(
  sujeito: Sujeito,
  demandaId: string,
  resposta?: string,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  const r = dadosDaRetomada(resposta)
  if (!r.ok) throw new ErroDeDominio(r.motivo)
  await decisaoDoPaulo(sujeito, demandaId, { tipo: 'retomada', dados: r.dados })
}

/** O Paulo desiste da demanda: ela fica encerrada como `descartada` e a Fábrica para nela. */
export async function encerrarDemanda(sujeito: Sujeito, demandaId: string): Promise<void> {
  await decisaoDoPaulo(sujeito, demandaId, { tipo: 'encerrada_pelo_paulo', dados: {} })
}

const TESTE_JA_DECIDIDO = 'A demanda não espera mais a decisão do teste.'

/**
 * O teste falhou duas vezes e o Paulo entrega o que funciona: a demanda segue o caminho do teste
 * que passa (a testada é concluída e a Fábrica faz a entrega) e o que faltou vira uma demanda nova
 * no mesmo projeto e repositório, aberta como qualquer demanda da tela. Tudo numa transação, com a
 * linha da demanda travada: o segundo clique encontra a demanda fora de `teste_falhou` e é recusado
 * sem abrir outra filha.
 */
export async function entregarOQueFunciona(
  sujeito: Sujeito,
  demandaId: string,
): Promise<{ filhaId: string }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  const agora = new Date()
  return db.$transaction(async (tx) => {
    const travada = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Demanda" WHERE "id" = ${demandaId} FOR UPDATE`
    if (travada.length === 0) throw new ErroDeDominio(DEMANDA_NAO_ENCONTRADA)
    const d = await tx.demanda.findUniqueOrThrow({
      where: { id: demandaId },
      select: {
        titulo: true,
        projetoId: true,
        repositorioId: true,
        temTela: true,
        espera: true,
        esperaMotivo: true,
        encerrada: true,
        projeto: { select: { arquivadoEm: true } },
      },
    })
    if (d.encerrada || d.espera !== 'teste_falhou') throw new ErroDeDominio(TESTE_JA_DECIDIDO)
    if (d.projeto.arquivadoEm !== null) {
      throw new ErroDeDominio('Projeto arquivado não recebe demandas.')
    }
    // O resumo do último teste (o que vai para o Paulo); a espera guarda o mesmo texto.
    const teste = await tx.eventoDaDemanda.findFirst({
      where: { demandaId, tipo: 'teste' },
      orderBy: { seq: 'desc' },
      select: { dados: true },
    })
    const resumo = (teste?.dados as { resumo?: unknown } | null)?.resumo
    const { id: filhaId } = await abrirDemanda(
      tx,
      {
        projetoId: d.projetoId,
        repositorioId: d.repositorioId,
        titulo: tituloDaFilha(d.titulo),
        descricao: descricaoDaFilha(
          typeof resumo === 'string' ? resumo : d.esperaMotivo,
          demandaId,
        ),
        tipo: null,
        nivel: null,
        temTela: d.temTela,
        origem: 'flow',
        usuarioId: sujeito.usuarioId,
      },
      agora,
    )
    const r = await registrarEventoNa(tx, {
      demandaId,
      idExterno: randomUUID(),
      evento: { tipo: 'entrega_parcial', dados: { filha: filhaId }, ator: 'paulo' },
      origem: 'paulo',
      em: agora,
      usuarioId: sujeito.usuarioId,
    })
    if (r.resultado === 'recusado') throw new ErroDeDominio(r.motivo)
    if (r.resultado === 'conflito') throw new Error('idExterno novo em conflito.')
    return { filhaId }
  })
}

export async function concluirEtapaPeloPaulo(
  sujeito: Sujeito,
  demandaId: string,
  chave: string,
): Promise<void> {
  await decisaoDoPaulo(sujeito, demandaId, { tipo: 'etapa_concluida_pelo_paulo', dados: { chave } })
}

/** Modelo e nível padrão do projeto; as demandas existentes seguem com o retrato que já têm. */
export async function definirDemandasDoProjeto(
  sujeito: Sujeito,
  projetoId: string,
  e: { modeloId: string; nivelPadrao: Nivel },
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  if (!NIVEIS.includes(e.nivelPadrao)) throw new ErroDeDominio('Nível inválido.')
  const modelo = await db.modeloDeEtapas.findUnique({
    where: { id: e.modeloId },
    select: { id: true },
  })
  if (!modelo) throw new ErroDeDominio('Modelo de etapas não encontrado.')
  const { count } = await db.projeto.updateMany({
    where: { id: projetoId },
    data: { modeloDeEtapasId: modelo.id, nivelPadraoDeDemanda: doFio.nivel(e.nivelPadrao) },
  })
  if (count === 0) throw new ErroDeDominio(PROJETO_NAO_ENCONTRADO)
}

export async function criarModeloDeEtapas(
  sujeito: Sujeito,
  nome: string,
  etapas: EtapaDefinida[],
): Promise<{ id: string }> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  const n = nome.trim()
  if (n.length < 1 || n.length > 80) {
    throw new ErroDeDominio('O nome do modelo precisa ter de 1 a 80 caracteres.')
  }
  const erros = validarModelo(etapas)
  if (erros.length > 0) throw new ErroDeDominio(erros[0]!)
  try {
    return await db.modeloDeEtapas.create({
      data: {
        nome: n,
        etapas: {
          create: etapas.map((et, i) => ({
            ordem: i + 1,
            chave: et.chave,
            nome: et.nome,
            rotulo: et.rotulo,
            marco: et.marco,
            quemConclui: doFio.quemConclui(et.quemConclui),
            puladaSemTela: et.puladaSemTela,
            esperaEm: et.esperaEm.map(doFio.nivel),
          })),
        },
      },
      select: { id: true },
    })
  } catch (erro) {
    if (ehUnicoRepetido(erro)) throw new ErroDeDominio('Já existe um modelo com este nome.')
    throw erro
  }
}

// O token é devolvido só aqui; no banco fica apenas o hash (o mesmo hash da Fábrica).
export async function criarFonteDeDemandas(
  sujeito: Sujeito,
  nome: string,
): Promise<{ id: string; token: string }> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  const validado = validarNomeDaFonteDaFabrica(nome)
  if (!validado.ok) throw new ErroDeDominio(validado.erro)

  const token = `${PREFIXO_DO_TOKEN_DE_DEMANDAS}${randomBytes(32).toString('base64url')}`
  const criada = await db.fonteDeDemandas.create({
    data: {
      nome: validado.nome,
      tokenHash: hashDoTokenDaFabrica(token),
      criadaPorId: sujeito.usuarioId,
    },
    select: { id: true },
  })
  return { id: criada.id, token }
}

export async function revogarFonteDeDemandas(sujeito: Sujeito, fonteId: string): Promise<void> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  const { count } = await db.fonteDeDemandas.updateMany({
    where: { id: fonteId, revogadaEm: null },
    data: { revogadaEm: new Date() },
  })
  if (count > 0) return

  const existe = await db.fonteDeDemandas.findUnique({
    where: { id: fonteId },
    select: { id: true },
  })
  throw new ErroDeDominio(existe ? 'Esta fonte já foi revogada.' : 'Fonte não encontrada.')
}

export async function listarFontesDeDemandas(sujeito: Sujeito) {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  return db.fonteDeDemandas.findMany({
    orderBy: { criadoEm: 'desc' },
    select: { id: true, nome: true, criadoEm: true, ultimoUsoEm: true, revogadaEm: true },
  })
}
