// Busca dos relatos de cada sistema conectado (D83): cursor do sistema, relato `segue` vira demanda
// de origem "usuário", `orientado` só é contado. Um sinal novo faz o relato voltar no cursor; o Flow
// o reconhece pelo id e atualiza os sinais.
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { chaveDosSegredos, ErroDeSegredo } from '@/lib/segredos'
import { abrirDemanda, guardarArquivo } from '@/modules/demandas/service'
import {
  anexoDeRelatoVencido,
  inicioDaRetencaoDoRelato,
  LIMITE_POR_ARQUIVO,
} from '@/modules/demandas/transicoes'
import { resumirErroParaLog } from '@/modules/github/model'
import { type AlvoDoSistema, baixarAnexo, buscarPagina } from './cliente'
import { PAGINAS_POR_BUSCA, type RelatoDoFio, type SinalDoFio } from './contrato'
import {
  type AnexoGravado,
  type AnexoParaCopiar,
  anexosParaCopiar,
  caminhoDoAnexo,
  demandaDoRelato,
  INTERVALO_DA_BUSCA_MS,
  relatosNovos,
  sinaisNovos,
} from './model'
import { alvoDoSistema, NAO_DECIFROU_O_TOKEN } from './sistemas'

const TRANSACAO = { maxWait: 15_000, timeout: 15_000 }
const SISTEMAS_AO_MESMO_TEMPO = 4
export const TETO_DA_RECUPERACAO = 20

export interface DependenciasDaBusca {
  buscar?: typeof buscarPagina
  baixar?: typeof baixarAnexo
  chave?: Buffer | null
}

export interface ResumoDoSistema {
  buscou: boolean
  novos: number
  repetidos: number
  orientados: number
  sinaisNovos: number
  falha: string | null
}

type SistemaParaBuscar = {
  id: string
  nome: string
  url: string
  projetoId: string
  repositorioId: string
}

type Gravado = 'novo' | 'orientado' | 'repetido'
type Copia = { demandaId: string; anexos: AnexoParaCopiar[] } | null

async function gravarRelato(
  s: SistemaParaBuscar,
  r: RelatoDoFio,
  agora: Date,
): Promise<{ como: Gravado; sinaisNovos: number; copiar: Copia }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`relato:${s.id}:${r.id}`}))`
    const existente = await tx.relato.findUnique({
      where: { sistemaId_idExterno: { sistemaId: s.id, idExterno: r.id } },
      select: { id: true, resultado: true, demandaId: true, sinais: true },
    })
    const sinais = r.sinais as unknown as Prisma.InputJsonValue
    if (existente) {
      const novos = sinaisNovos((existente.sinais ?? []) as SinalDoFio[], r.sinais)
      // Um orientado que voltou como `segue` vira demanda agora.
      const virouDemanda = existente.resultado === 'ORIENTADO' && r.resultado === 'segue'
      const demandaId =
        virouDemanda && !existente.demandaId ? await abrir(tx, s, r, agora) : existente.demandaId
      const segue = virouDemanda ? camposDoSegue(s, r) : null
      await tx.relato.update({
        where: { id: existente.id },
        data: {
          sinais,
          ...(segue ? { ...segue, resultado: 'SEGUE' as const, demandaId } : {}),
        },
      })
      const copiar = segue && demandaId && !existente.demandaId ? copiaDe(s, r, demandaId) : null
      return { como: 'repetido', sinaisNovos: novos.length, copiar }
    }
    const base = {
      sistemaId: s.id,
      idExterno: r.id,
      ticket: r.ticket,
      canal: r.canal === 'whatsapp' ? ('WHATSAPP' as const) : ('SISTEMA' as const),
      em: new Date(r.em),
      autorIdExterno: r.autor.id,
      autorNome: r.autor.nome,
      autorPapel: r.autor.papel,
      assunto: r.contexto.tela,
      versao: r.contexto.versao,
      plataforma: r.contexto.plataforma,
      aparelho: r.contexto.aparelho,
      sinais,
    }
    if (r.resultado === 'orientado') {
      await tx.relato.create({ data: { ...base, resultado: 'ORIENTADO' } })
      return { como: 'orientado', sinaisNovos: 0, copiar: null }
    }
    const demandaId = await abrir(tx, s, r, agora)
    await tx.relato.create({
      data: { ...base, ...camposDoSegue(s, r), resultado: 'SEGUE', demandaId },
    })
    return { como: 'novo', sinaisNovos: 0, copiar: copiaDe(s, r, demandaId) }
  }, TRANSACAO)
}

function anexosGravados(s: SistemaParaBuscar, r: RelatoDoFio): AnexoGravado[] {
  return r.anexos.map((a) => ({
    tipo: a.tipo,
    bytes: a.bytes,
    caminho: caminhoDoAnexo(s.url, a.url),
  }))
}

function copiaDe(s: SistemaParaBuscar, r: RelatoDoFio, demandaId: string): Copia {
  const anexos = anexosParaCopiar(`${s.id}:${r.id}`, anexosGravados(s, r))
  return anexos.length > 0 ? { demandaId, anexos } : null
}

/**
 * Copia os anexos do relato para a demanda (spec dos relatos §4), fora da transação: o que não
 * baixa ou não é aceito fica só no sistema de origem, com aviso no log, sem travar a busca.
 */
async function copiarAnexos(
  alvo: AlvoDoSistema,
  copia: NonNullable<Copia>,
  baixar: typeof baixarAnexo,
): Promise<{ copiados: number; falhas: number }> {
  const resumo = { copiados: 0, falhas: 0 }
  for (const a of copia.anexos) {
    try {
      const b = await baixar(alvo, a.url, LIMITE_POR_ARQUIVO)
      if (!b.ok) {
        log.warn({ demandaId: copia.demandaId, motivo: b.motivo }, 'Anexo do relato não baixou.')
        resumo.falhas++
        continue
      }
      const g = await guardarArquivo({
        demandaId: copia.demandaId,
        arquivoId: a.arquivoId,
        tipo: 'anexo',
        nome: a.nome,
        conteudo: b.conteudo,
        tamanhoDeclarado: b.bytes.byteLength,
        corpo: new Response(new Uint8Array(b.bytes)).body!,
        tela: null,
        enviadoPor: 'flow',
      })
      if (g.status !== 201 && g.status !== 200) {
        log.warn(
          { demandaId: copia.demandaId, status: g.status },
          'Anexo do relato não foi aceito na demanda.',
        )
        resumo.falhas++
      } else resumo.copiados++
    } catch (erro) {
      log.warn(
        { demandaId: copia.demandaId, erro: resumirErroParaLog(erro) },
        'Falha ao copiar anexo do relato.',
      )
      resumo.falhas++
    }
  }
  return resumo
}

function camposDoSegue(s: SistemaParaBuscar, r: RelatoDoFio) {
  return {
    texto: r.texto || null,
    transcricao: r.transcricao,
    tipoSugerido: r.tipo,
    anexos: anexosGravados(s, r) as unknown as Prisma.InputJsonValue,
  }
}

async function abrir(
  tx: Prisma.TransactionClient,
  s: SistemaParaBuscar,
  r: RelatoDoFio,
  agora: Date,
): Promise<string> {
  const { titulo, descricao } = demandaDoRelato(r, s.nome)
  const { id } = await abrirDemanda(
    tx,
    {
      projetoId: s.projetoId,
      repositorioId: s.repositorioId,
      titulo,
      descricao,
      tipo: null,
      nivel: null,
      temTela: false,
      origem: 'usuario',
    },
    agora,
  )
  return id
}

const resumoVazio = (): ResumoDoSistema => ({
  buscou: false,
  novos: 0,
  repetidos: 0,
  orientados: 0,
  sinaisNovos: 0,
  falha: null,
})

async function registrarFalha(
  id: string,
  motivo: string,
  extra: Prisma.SistemaConectadoUpdateInput = {},
) {
  await db.sistemaConectado.update({ where: { id }, data: { ultimoErro: motivo, ...extra } })
}

/** Busca um sistema; a trava pela linha garante uma busca por intervalo, mesmo com dois workers. */
export async function buscarSistema(
  sistemaId: string,
  agora: Date,
  deps: DependenciasDaBusca = {},
): Promise<ResumoDoSistema> {
  const resumo = resumoVazio()
  const limite = new Date(agora.getTime() - INTERVALO_DA_BUSCA_MS + 1_000)
  const travou = await db.$executeRaw`
    UPDATE "SistemaConectado" SET "ultimaTentativaEm" = ${agora}
     WHERE id = ${sistemaId} AND estado = 'ATIVO'
       AND ("ultimaTentativaEm" IS NULL OR "ultimaTentativaEm" <= ${limite})`
  if (travou === 0) return resumo
  resumo.buscou = true

  const s = await db.sistemaConectado.findUniqueOrThrow({
    where: { id: sistemaId },
    include: { projeto: { select: { arquivadoEm: true } } },
  })
  if (s.projeto.arquivadoEm) {
    resumo.falha = 'O projeto do sistema está arquivado.'
    await registrarFalha(s.id, resumo.falha)
    return resumo
  }
  const chave = deps.chave === undefined ? chaveDosSegredos(process.env) : deps.chave
  let alvo
  try {
    if (!chave) throw new ErroDeSegredo(NAO_DECIFROU_O_TOKEN)
    alvo = alvoDoSistema(s, chave)
  } catch {
    resumo.falha = NAO_DECIFROU_O_TOKEN
    await registrarFalha(s.id, resumo.falha)
    return resumo
  }

  const buscar = deps.buscar ?? buscarPagina
  let cursor = s.cursor
  for (let pagina = 0; pagina < PAGINAS_POR_BUSCA; pagina++) {
    const r = await buscar(alvo, cursor)
    if (!r.ok) {
      if (r.falha.tipo === 'token_recusado') {
        resumo.falha = 'O sistema recusou o token.'
        await registrarFalha(s.id, resumo.falha, { estado: 'DESCONECTADO' })
      } else {
        resumo.falha = r.falha.motivo
        await registrarFalha(s.id, resumo.falha)
      }
      return resumo
    }
    // O cursor só anda depois da página inteira gravada: se cair no meio, a próxima busca repete
    // a página e os já gravados são reconhecidos pelo id.
    for (const relato of relatosNovos(r.relatos)) {
      const g = await gravarRelato(s, relato, agora)
      if (g.como === 'novo') resumo.novos++
      else if (g.como === 'orientado') resumo.orientados++
      else resumo.repetidos++
      resumo.sinaisNovos += g.sinaisNovos
      if (g.copiar) await copiarAnexos(alvo, g.copiar, deps.baixar ?? baixarAnexo)
    }
    cursor = r.cursor
    await db.sistemaConectado.update({ where: { id: s.id }, data: { cursor } })
    if (!r.mais) break
  }
  await db.sistemaConectado.update({
    where: { id: s.id },
    data: { ultimaBuscaOkEm: agora, ultimoErro: null },
  })
  return resumo
}

/** Todos os sistemas ativos vencidos, até 4 ao mesmo tempo; a falha de um não para os outros. */
export async function buscarTodos(
  agora: Date,
  deps: DependenciasDaBusca = {},
): Promise<{
  sistemas: number
  novos: number
  orientados: number
  sinaisNovos: number
  falhas: number
}> {
  const total = { sistemas: 0, novos: 0, orientados: 0, sinaisNovos: 0, falhas: 0 }
  const limite = new Date(agora.getTime() - INTERVALO_DA_BUSCA_MS + 1_000)
  const vencidos = await db.sistemaConectado.findMany({
    where: {
      estado: 'ATIVO',
      OR: [{ ultimaTentativaEm: null }, { ultimaTentativaEm: { lte: limite } }],
    },
    select: { id: true },
    orderBy: { ultimaTentativaEm: { sort: 'asc', nulls: 'first' } },
  })
  for (let i = 0; i < vencidos.length; i += SISTEMAS_AO_MESMO_TEMPO) {
    const lote = vencidos.slice(i, i + SISTEMAS_AO_MESMO_TEMPO)
    const resultados = await Promise.allSettled(lote.map((s) => buscarSistema(s.id, agora, deps)))
    for (const [j, r] of resultados.entries()) {
      if (r.status === 'fulfilled') {
        if (!r.value.buscou) continue
        total.sistemas++
        total.novos += r.value.novos
        total.orientados += r.value.orientados
        total.sinaisNovos += r.value.sinaisNovos
        if (r.value.falha) total.falhas++
      } else {
        total.sistemas++
        total.falhas++
        const erro = resumirErroParaLog(r.reason)
        log.error(
          { tarefa: 'buscar-relatos', sistemaId: lote[j]!.id, erro },
          'busca de relatos falhou',
        )
        await registrarFalha(lote[j]!.id, 'Erro inesperado na busca; veja o log do worker.').catch(
          () => undefined,
        )
      }
    }
  }
  return total
}

/**
 * Copia os anexos de relatos que chegaram antes da cópia existir (ou cuja cópia nunca rodou):
 * relato `segue` com demanda, sistema ativo e nenhuma linha de arquivo para o id derivado. Linha
 * apagada pela retenção também conta como existente. Nunca altera a demanda; `guardarArquivo`
 * aceita demanda no ar ou encerrada. Teto de 20 arquivos por rodada; falha tenta de novo na próxima.
 */
export async function recuperarAnexosFaltantes(
  agora: Date,
  deps: { baixar?: typeof baixarAnexo; chave?: Buffer | null } = {},
): Promise<{ copiados: number; falhas: number }> {
  const total = { copiados: 0, falhas: 0 }
  const chave = deps.chave === undefined ? chaveDosSegredos(process.env) : deps.chave
  if (!chave) return total
  const baixar = deps.baixar ?? baixarAnexo
  const relatos = await db.relato.findMany({
    where: {
      resultado: 'SEGUE',
      demandaId: { not: null },
      sistema: { estado: 'ATIVO', tokenCifrado: { not: null } },
    },
    orderBy: { em: 'asc' },
    select: {
      sistemaId: true,
      idExterno: true,
      demandaId: true,
      anexos: true,
      sistema: { select: { id: true, nome: true, url: true, tokenCifrado: true } },
      demanda: {
        select: {
          noArEm: true,
          encerrada: true,
          eventos: { orderBy: { seq: 'desc' }, take: 1, select: { em: true } },
        },
      },
    },
  })
  const candidatos = relatos.flatMap((r) => {
    if (!r.demandaId || !r.demanda || !Array.isArray(r.anexos)) return []
    const inicio = inicioDaRetencaoDoRelato({
      noArEm: r.demanda.noArEm,
      encerrada: r.demanda.encerrada,
      encerradaEm: r.demanda.eventos[0]?.em ?? null,
    })
    if (anexoDeRelatoVencido(inicio, agora)) return []
    const anexos = anexosParaCopiar(
      `${r.sistemaId}:${r.idExterno}`,
      r.anexos as unknown as AnexoGravado[],
    )
    return anexos.length > 0 ? [{ r, demandaId: r.demandaId, anexos }] : []
  })
  if (candidatos.length === 0) return total
  const existentes = new Set(
    (
      await db.arquivoDaDemanda.findMany({
        where: { id: { in: candidatos.flatMap((c) => c.anexos.map((a) => a.arquivoId)) } },
        select: { id: true },
      })
    ).map((a) => a.id),
  )
  let restante = TETO_DA_RECUPERACAO
  for (const c of candidatos) {
    if (restante <= 0) break
    const faltam = c.anexos.filter((a) => !existentes.has(a.arquivoId)).slice(0, restante)
    if (faltam.length === 0) continue
    let alvo: AlvoDoSistema
    try {
      alvo = alvoDoSistema(c.r.sistema, chave)
    } catch {
      log.warn(
        { sistemaId: c.r.sistemaId },
        'Token do sistema não decifrou; anexos não recuperados.',
      )
      continue
    }
    restante -= faltam.length
    const r = await copiarAnexos(alvo, { demandaId: c.demandaId, anexos: faltam }, baixar)
    total.copiados += r.copiados
    total.falhas += r.falhas
  }
  return total
}
