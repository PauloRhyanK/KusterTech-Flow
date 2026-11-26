// Leitura dos erros do GlitchTip pelo worker (D81; spec 2026-11-26-erros-do-glitchtip, seções 5 e 6).
// Cada projeto do GlitchTip é lido à parte; a falha de um não para os outros.
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { abrirDemanda, TRAVA_DOS_EVENTOS_SQL } from '@/modules/demandas/service'
import { resumirErroParaLog } from '@/modules/github/model'
import { type Buscar, lerIssue, listarIssues } from './cliente'
import {
  acrescentarPonto,
  type Configuracao,
  decidir,
  descricaoDaDemanda,
  entra,
  type IssueLida,
  lerConfiguracao,
  mascarar,
  NAO_CONFIGURADO,
  type Ponto,
  type ProjetoConfigurado,
  tituloDaDemanda,
} from './model'

const HORA_MS = 60 * 60_000
const CONFERIDOS_POR_CICLO = 50
// A espera pela trava do projeto conta no tempo da transação (padrão do Prisma: 5 s).
const TRANSACAO = { maxWait: 15_000, timeout: 15_000 }

export interface ResumoDaBusca {
  projetos: number
  abertas: number
  voltaram: number
  naEspera: number
  atualizados: number
  resolvidos: number
  falhas: number
}

type Resultado = 'aberta' | 'voltou' | 'espera' | 'atualizado'

const buscarPadrao: Buscar = (url, init) => fetch(url, init)

export async function buscarErrosDoGlitchTip(
  agora: Date,
  d: { env?: Record<string, string | undefined>; buscar?: Buscar } = {},
): Promise<ResumoDaBusca> {
  const resumo: ResumoDaBusca = {
    projetos: 0,
    abertas: 0,
    voltaram: 0,
    naEspera: 0,
    atualizados: 0,
    resolvidos: 0,
    falhas: 0,
  }
  const lida = lerConfiguracao(d.env ?? process.env)
  if (!lida.ok) {
    if (lida.motivo !== NAO_CONFIGURADO) {
      log.warn(
        { tarefa: 'buscar-erros-do-glitchtip', motivo: lida.motivo },
        'GlitchTip mal configurado',
      )
    }
    return resumo
  }
  const buscar = d.buscar ?? buscarPadrao
  for (const projeto of lida.config.projetos) {
    resumo.projetos += 1
    try {
      await lerProjeto(lida.config, projeto, buscar, agora, resumo)
    } catch (err) {
      resumo.falhas += 1
      log.error(
        {
          tarefa: 'buscar-erros-do-glitchtip',
          projeto: projeto.slug,
          erro: resumirErroParaLog(err),
        },
        'leitura do GlitchTip falhou',
      )
      await registrarLeitura(projeto.slug, { ultimaFalhaEm: agora, motivo: 'falha interna' })
    }
  }
  return resumo
}

async function lerProjeto(
  config: Configuracao,
  projeto: ProjetoConfigurado,
  buscar: Buscar,
  agora: Date,
  resumo: ResumoDaBusca,
): Promise<void> {
  const repositorio = await db.repositorioGitHub.findFirst({
    where: {
      nomeCompleto: { equals: projeto.repositorio, mode: 'insensitive' },
      projetoId: { not: null },
    },
    select: { id: true, projetoId: true },
  })
  if (!repositorio) {
    resumo.falhas += 1
    await registrarLeitura(projeto.slug, {
      ultimaFalhaEm: agora,
      motivo: 'projeto sem repositório',
    })
    return
  }

  const lista = await listarIssues(config, projeto.slug, buscar)
  if (!lista.ok) {
    resumo.falhas += 1
    await registrarLeitura(projeto.slug, { ultimaFalhaEm: agora, motivo: lista.motivo })
    return
  }
  if (lista.tortas > 0) {
    log.warn(
      { tarefa: 'buscar-erros-do-glitchtip', projeto: projeto.slug, tortas: lista.tortas },
      'issues fora do formato puladas',
    )
  }

  const entram = lista.issues
    .filter((i) => entra(i, agora))
    .sort((a, b) => b.ultimoEm.getTime() - a.ultimoEm.getTime())
  for (const issue of entram) {
    let r: Resultado
    try {
      r = await processarIssue(
        issue,
        projeto.slug,
        { id: repositorio.id, projetoId: repositorio.projetoId! },
        agora,
      )
    } catch (err) {
      // Spec seção 9: a issue fica como está e a próxima leitura tenta de novo; as outras seguem.
      resumo.falhas += 1
      log.error(
        {
          tarefa: 'buscar-erros-do-glitchtip',
          projeto: projeto.slug,
          issue: issue.id,
          erro: resumirErroParaLog(err),
        },
        'issue do GlitchTip não gravada',
      )
      continue
    }
    if (r === 'aberta') resumo.abertas += 1
    else if (r === 'voltou') {
      resumo.abertas += 1
      resumo.voltaram += 1
    } else if (r === 'espera') resumo.naEspera += 1
    else resumo.atualizados += 1
  }

  // Acompanhados que saíram da lista de não resolvidas: resolvidos, ignorados ou apagados?
  const vistos = lista.issues.map((i) => i.id)
  const sumidos = await db.erroDoGlitchTip.findMany({
    where: { projetoGlitchTip: projeto.slug, resolvidoEm: null, issueId: { notIn: vistos } },
    select: { issueId: true },
    orderBy: { ultimoEm: 'desc' },
    take: CONFERIDOS_POR_CICLO,
  })
  for (const s of sumidos) {
    const r = await lerIssue(config, s.issueId, buscar)
    if (!r.ok) continue
    if (r.issue !== null && r.issue.status === 'unresolved') continue
    const { count } = await db.erroDoGlitchTip.updateMany({
      where: { issueId: s.issueId, resolvidoEm: null },
      data: { resolvidoEm: agora },
    })
    resumo.resolvidos += count
  }

  await registrarLeitura(projeto.slug, { ultimoSucessoEm: agora, motivo: null })
}

/** Decide e grava uma issue sob a trava do projeto do GlitchTip (teto e repetição sem corrida). */
function processarIssue(
  issue: IssueLida,
  slug: string,
  repositorio: { id: string; projetoId: string },
  agora: Date,
): Promise<Resultado> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await travarProjeto(tx, slug)
    const atual = await tx.erroDoGlitchTip.findUnique({
      where: { issueId: issue.id },
      select: {
        serie: true,
        esperaDesde: true,
        demandaId: true,
        demandaAnteriorId: true,
        demanda: { select: { id: true, encerrada: true, noArEm: true } },
      },
    })
    const abertasNaUltimaHora = await tx.eventoDaDemanda.count({
      where: {
        tipo: 'criada',
        em: { gt: new Date(agora.getTime() - HORA_MS) },
        demanda: { origem: 'GLITCHTIP', erros: { some: { projetoGlitchTip: slug } } },
      },
    })
    const demanda = atual?.demanda ?? null
    const acao = decidir({ issue, demanda, abertasNaUltimaHora })

    const comum = {
      projetoGlitchTip: slug,
      repositorioId: repositorio.id,
      titulo: mascarar(issue.titulo),
      onde: issue.onde ? mascarar(issue.onde) : null,
      nivel: issue.nivel,
      link: issue.link,
      eventos: issue.eventos,
      usuarios: issue.usuarios,
      primeiroEm: issue.primeiroEm,
      ultimoEm: issue.ultimoEm,
      resolvidoEm: null,
      serie: acrescentarPonto(
        (atual?.serie as unknown as Ponto[] | undefined) ?? [],
        issue.eventos,
        agora,
      ) as unknown as Prisma.InputJsonValue,
    }
    const gravar = (extra: Partial<Prisma.ErroDoGlitchTipUncheckedCreateInput>) =>
      tx.erroDoGlitchTip.upsert({
        where: { issueId: issue.id },
        create: { issueId: issue.id, ...comum, ...extra },
        update: { ...comum, ...extra },
      })

    if (acao.tipo === 'atualizar') {
      await gravar({})
      return 'atualizado'
    }
    if (acao.tipo === 'esperar') {
      await gravar({ esperaDesde: atual?.esperaDesde ?? agora })
      return 'espera'
    }

    const anterior =
      acao.voltou && demanda?.noArEm ? { id: demanda.id, noArEm: demanda.noArEm } : null
    const aberta = await abrirDemanda(
      tx,
      {
        projetoId: repositorio.projetoId,
        repositorioId: repositorio.id,
        titulo: tituloDaDemanda(issue),
        descricao: descricaoDaDemanda(issue, anterior),
        tipo: 'defeito',
        nivel: null,
        temTela: false,
        origem: 'glitchtip',
      },
      agora,
    )
    await gravar({
      demandaId: aberta.id,
      demandaAnteriorId: anterior ? anterior.id : (atual?.demandaAnteriorId ?? null),
      esperaDesde: null,
    })
    if (anterior) {
      // Origem `glitchtip`: o aviso fica no Flow; eventos de origem `flow` seguem para a Fábrica.
      await tx.$executeRaw(TRAVA_DOS_EVENTOS_SQL)
      await tx.eventoDaDemanda.create({
        data: {
          idExterno: randomUUID(),
          demandaId: anterior.id,
          tipo: 'erro-voltou',
          origem: 'glitchtip',
          dados: { demandaNova: aberta.id },
          em: agora,
        },
      })
      return 'voltou'
    }
    return 'aberta'
  }, TRANSACAO)
}

async function travarProjeto(tx: Prisma.TransactionClient, slug: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erros-glitchtip:${slug}`}))`
}

async function registrarLeitura(
  slug: string,
  dados: { ultimoSucessoEm?: Date; ultimaFalhaEm?: Date; motivo: string | null },
): Promise<void> {
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await travarProjeto(tx, slug)
    await tx.leituraDoGlitchTip.upsert({
      where: { projetoGlitchTip: slug },
      create: { projetoGlitchTip: slug, ...dados },
      update: dados,
    })
  })
}
