// Busca dos relatos de cada sistema conectado (D83): cursor do sistema, relato `segue` vira demanda
// de origem "usuário", `orientado` só é contado. Um sinal novo faz o relato voltar no cursor; o Flow
// o reconhece pelo id e atualiza os sinais.
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { chaveDosSegredos, ErroDeSegredo } from '@/lib/segredos'
import { abrirDemanda } from '@/modules/demandas/service'
import { resumirErroParaLog } from '@/modules/github/model'
import { buscarPagina } from './cliente'
import { PAGINAS_POR_BUSCA, type RelatoDoFio, type SinalDoFio } from './contrato'
import {
  caminhoDoAnexo,
  demandaDoRelato,
  INTERVALO_DA_BUSCA_MS,
  relatosNovos,
  sinaisNovos,
} from './model'
import { alvoDoSistema, NAO_DECIFROU_O_TOKEN } from './sistemas'

const TRANSACAO = { maxWait: 15_000, timeout: 15_000 }
const SISTEMAS_AO_MESMO_TEMPO = 4

export interface DependenciasDaBusca {
  buscar?: typeof buscarPagina
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

async function gravarRelato(
  s: SistemaParaBuscar,
  r: RelatoDoFio,
  agora: Date,
): Promise<{ como: Gravado; sinaisNovos: number }> {
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
      await tx.relato.update({
        where: { id: existente.id },
        data: {
          sinais,
          ...(virouDemanda
            ? { ...camposDoSegue(s, r), resultado: 'SEGUE' as const, demandaId }
            : {}),
        },
      })
      return { como: 'repetido', sinaisNovos: novos.length }
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
      sinais,
    }
    if (r.resultado === 'orientado') {
      await tx.relato.create({ data: { ...base, resultado: 'ORIENTADO' } })
      return { como: 'orientado', sinaisNovos: 0 }
    }
    const demandaId = await abrir(tx, s, r, agora)
    await tx.relato.create({
      data: { ...base, ...camposDoSegue(s, r), resultado: 'SEGUE', demandaId },
    })
    return { como: 'novo', sinaisNovos: 0 }
  }, TRANSACAO)
}

function camposDoSegue(s: SistemaParaBuscar, r: RelatoDoFio) {
  return {
    texto: r.texto || null,
    transcricao: r.transcricao,
    tipoSugerido: r.tipo,
    anexos: r.anexos.map((a) => ({
      tipo: a.tipo,
      bytes: a.bytes,
      caminho: caminhoDoAnexo(s.url, a.url),
    })) as unknown as Prisma.InputJsonValue,
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
