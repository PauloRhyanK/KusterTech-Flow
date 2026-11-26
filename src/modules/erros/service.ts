// Leitura dos erros do GlitchTip pelo worker (D81; spec 2026-11-26-erros-do-glitchtip, seções 5 e 6).
// Cada projeto do GlitchTip é lido à parte; a falha de um não para os outros.
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { abrirDemanda, TRAVA_DOS_EVENTOS_SQL } from '@/modules/demandas/service'
import { resumirErroParaLog } from '@/modules/github/model'
import { type Buscar, lerIssue, listarAmbientes, listarIssues } from './cliente'
import {
  acrescentarPonto,
  ambientesParaLer,
  type Configuracao,
  decidir,
  descricaoDaDemanda,
  entra,
  grupoDoErro,
  ignorada,
  type IssueLida,
  lerConfiguracao,
  type Limiares,
  mascarar,
  NAO_CONFIGURADO,
  type Ponto,
  type ProjetoConfigurado,
  tituloDaDemanda,
} from './model'

const DIA_MS = 24 * 60 * 60_000
const CONFERIDOS_POR_CICLO = 50
// A espera pela trava do projeto conta no tempo da transação (padrão do Prisma: 5 s).
const TRANSACAO = { maxWait: 15_000, timeout: 15_000 }

export interface ResumoDaBusca {
  projetos: number
  abertas: number
  voltaram: number
  ligadas: number
  observando: number
  naEspera: number
  atualizados: number
  resolvidos: number
  falhas: number
}

type Resultado =
  'aberta' | 'voltou' | 'ligada' | 'observando' | 'espera' | 'atualizado' | 'ignorada'

const buscarPadrao: Buscar = (url, init) => fetch(url, init)

export async function buscarErrosDoGlitchTip(
  agora: Date,
  d: { env?: Record<string, string | undefined>; buscar?: Buscar } = {},
): Promise<ResumoDaBusca> {
  const resumo: ResumoDaBusca = {
    projetos: 0,
    abertas: 0,
    voltaram: 0,
    ligadas: 0,
    observando: 0,
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

  const ambientes = await listarAmbientes(config, projeto.slug, buscar)
  if (!ambientes.ok) {
    resumo.falhas += 1
    await registrarLeitura(projeto.slug, { ultimaFalhaEm: agora, motivo: ambientes.motivo })
    return
  }
  const plano = ambientesParaLer(ambientes.nomes, config.ambientes)
  if (!plano.ler) {
    // Sem ambiente de produção não há o que ler (spec de triagem, 4).
    await registrarLeitura(projeto.slug, { ultimoSucessoEm: agora, motivo: null })
    return
  }
  const ligadaEm = await ligarFonte(projeto.slug, agora)

  const lista = await listarIssues(config, projeto.slug, buscar, plano.filtro)
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
        { ligadaEm, limiares: config.limiares },
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
    } else if (r === 'ligada') resumo.ligadas += 1
    else if (r === 'observando') resumo.observando += 1
    else if (r === 'espera') resumo.naEspera += 1
    else if (r === 'atualizado') resumo.atualizados += 1
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

/** Decide e grava uma issue sob a trava dos erros (limite do dia e grupos sem corrida). */
function processarIssue(
  issue: IssueLida,
  slug: string,
  repositorio: { id: string; projetoId: string },
  agora: Date,
  regras: { ligadaEm: Date; limiares: Limiares },
): Promise<Resultado> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await travarErros(tx)
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
    if (atual === null && ignorada(issue, regras.ligadaEm)) return 'ignorada'

    const grupo = grupoDoErro(issue)
    const demanda = atual?.demanda ?? null
    const doGrupo = demanda === null ? await demandaAbertaDoGrupo(tx, slug, grupo, issue.id) : null
    const acao = decidir({
      issue,
      demanda,
      demandaDoGrupo: doGrupo,
      abertasNoDia: await abertasNoDia(tx, agora),
      limiares: regras.limiares,
    })

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
      grupo,
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

    switch (acao.tipo) {
      case 'atualizar':
        await gravar({})
        return 'atualizado'
      case 'observar':
        await gravar({ esperaDesde: null })
        return 'observando'
      case 'esperar':
        await gravar({ esperaDesde: atual?.esperaDesde ?? agora })
        return 'espera'
      case 'ligar':
        await gravar({ demandaId: acao.demandaId, esperaDesde: null })
        await registrarLigacao(tx, acao.demandaId, issue, agora)
        return 'ligada'
      case 'abrir': {
        const anterior =
          acao.voltou && demanda?.noArEm ? { id: demanda.id, noArEm: demanda.noArEm } : null
        await gravar({})
        await abrirParaOErro(tx, {
          issue,
          slug,
          grupo,
          repositorio,
          anterior,
          demandaAnteriorId: atual?.demandaAnteriorId ?? null,
          agora,
        })
        return anterior ? 'voltou' : 'aberta'
      }
    }
  }, TRANSACAO)
}

/** Demanda aberta (não encerrada) de outro erro do mesmo grupo e projeto. */
async function demandaAbertaDoGrupo(
  tx: Prisma.TransactionClient,
  slug: string,
  grupo: string,
  issueId: string,
): Promise<string | null> {
  const outro = await tx.erroDoGlitchTip.findFirst({
    where: {
      projetoGlitchTip: slug,
      grupo,
      issueId: { not: issueId },
      demanda: { encerrada: null },
    },
    select: { demandaId: true },
    orderBy: { criadoEm: 'asc' },
  })
  return outro?.demandaId ?? null
}

/** Demandas de origem GlitchTip criadas nas últimas 24 h, somando os projetos. */
function abertasNoDia(tx: Prisma.TransactionClient, agora: Date): Promise<number> {
  return tx.eventoDaDemanda.count({
    where: {
      tipo: 'criada',
      em: { gt: new Date(agora.getTime() - DIA_MS) },
      demanda: { origem: 'GLITCHTIP' },
    },
  })
}

/**
 * Abre a demanda do erro (já gravado) e liga a ela os parecidos do grupo que estavam sem demanda;
 * a descrição lista todos. Quando o erro voltou, avisa a demanda anterior.
 */
async function abrirParaOErro(
  tx: Prisma.TransactionClient,
  e: {
    issue: IssueLida
    slug: string
    grupo: string
    repositorio: { id: string; projetoId: string }
    anterior: { id: string; noArEm: Date } | null
    demandaAnteriorId: string | null
    agora: Date
    usuarioId?: string
  },
): Promise<string> {
  const parecidos = e.anterior
    ? []
    : await tx.erroDoGlitchTip.findMany({
        where: {
          projetoGlitchTip: e.slug,
          grupo: e.grupo,
          issueId: { not: e.issue.id },
          demandaId: null,
          resolvidoEm: null,
        },
        select: { issueId: true, titulo: true, link: true },
        orderBy: { ultimoEm: 'desc' },
      })
  const aberta = await abrirDemanda(
    tx,
    {
      projetoId: e.repositorio.projetoId,
      repositorioId: e.repositorio.id,
      titulo: tituloDaDemanda(e.issue),
      descricao: descricaoDaDemanda(e.issue, e.anterior, parecidos),
      tipo: 'defeito',
      nivel: null,
      temTela: false,
      origem: 'glitchtip',
      ...(e.usuarioId ? { usuarioId: e.usuarioId } : {}),
    },
    e.agora,
  )
  await tx.erroDoGlitchTip.update({
    where: { issueId: e.issue.id },
    data: {
      demandaId: aberta.id,
      demandaAnteriorId: e.anterior ? e.anterior.id : e.demandaAnteriorId,
      esperaDesde: null,
    },
  })
  if (parecidos.length > 0) {
    await tx.erroDoGlitchTip.updateMany({
      where: { issueId: { in: parecidos.map((p) => p.issueId) } },
      data: { demandaId: aberta.id, esperaDesde: null },
    })
  }
  if (e.anterior) {
    // Origem `glitchtip`: o aviso fica no Flow; eventos de origem `flow` seguem para a Fábrica.
    await tx.$executeRaw(TRAVA_DOS_EVENTOS_SQL)
    await tx.eventoDaDemanda.create({
      data: {
        idExterno: randomUUID(),
        demandaId: e.anterior.id,
        tipo: 'erro-voltou',
        origem: 'glitchtip',
        dados: { demandaNova: aberta.id },
        em: e.agora,
      },
    })
  }
  return aberta.id
}

async function registrarLigacao(
  tx: Prisma.TransactionClient,
  demandaId: string,
  issue: { id: string; titulo: string; link: string },
  agora: Date,
): Promise<void> {
  await tx.$executeRaw(TRAVA_DOS_EVENTOS_SQL)
  await tx.eventoDaDemanda.create({
    data: {
      idExterno: randomUUID(),
      demandaId,
      tipo: 'erro-ligado',
      origem: 'glitchtip',
      dados: { issueId: issue.id, titulo: mascarar(issue.titulo), link: issue.link },
      em: agora,
    },
  })
}

/**
 * Botão "Virar demanda" da aba Erros: abre na hora, fora do limite do dia. Se o erro já tem
 * demanda aberta, devolve a mesma; se um parecido tem, liga a ela.
 */
export async function virarDemanda(
  sujeito: Sujeito,
  issueId: string,
  agora: Date,
): Promise<{ id: string }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await travarErros(tx)
    const erro = await tx.erroDoGlitchTip.findUnique({
      where: { issueId },
      include: {
        demanda: { select: { id: true, encerrada: true } },
        repositorio: { select: { id: true, projetoId: true } },
      },
    })
    if (!erro) throw new ErroDeDominio('Erro não encontrado.')
    if (erro.demanda && erro.demanda.encerrada === null) return { id: erro.demanda.id }
    if (!erro.repositorio.projetoId) throw new ErroDeDominio('O repositório não tem projeto.')

    const doGrupo = await demandaAbertaDoGrupo(tx, erro.projetoGlitchTip, erro.grupo, issueId)
    if (doGrupo) {
      await tx.erroDoGlitchTip.update({
        where: { issueId },
        data: { demandaId: doGrupo, esperaDesde: null },
      })
      await registrarLigacao(tx, doGrupo, erro, agora)
      return { id: doGrupo }
    }
    const issue: IssueLida = {
      id: erro.issueId,
      titulo: erro.titulo,
      onde: erro.onde,
      nivel: erro.nivel,
      status: 'unresolved',
      eventos: erro.eventos,
      usuarios: erro.usuarios,
      primeiroEm: erro.primeiroEm,
      ultimoEm: erro.ultimoEm,
      link: erro.link,
    }
    const id = await abrirParaOErro(tx, {
      issue,
      slug: erro.projetoGlitchTip,
      grupo: erro.grupo,
      repositorio: { id: erro.repositorio.id, projetoId: erro.repositorio.projetoId },
      anterior: null,
      demandaAnteriorId: erro.demandaAnteriorId,
      agora,
      usuarioId: sujeito.usuarioId,
    })
    return { id }
  }, TRANSACAO)
}

/** Primeira leitura de um projeto: guarda quando a fonte foi ligada (o backlog fica de fora). */
async function ligarFonte(slug: string, agora: Date): Promise<Date> {
  const l = await db.leituraDoGlitchTip.upsert({
    where: { projetoGlitchTip: slug },
    create: { projetoGlitchTip: slug, ligadaEm: agora },
    update: {},
    select: { ligadaEm: true },
  })
  return l.ligadaEm
}

async function travarErros(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('erros-glitchtip'))`
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
