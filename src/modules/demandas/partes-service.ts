// Escrita das partes de uma demanda a partir dos eventos (spec "demanda até o ar", seções 3, 7.2 e
// 7.3). Tudo roda dentro da transação do `registrarEvento`, depois da trava da linha da demanda;
// cada função confere tudo antes de gravar, porque uma recusa não pode deixar escrita para trás.
import type { Prisma, EstadoDaParte as EstadoNoBanco } from '@prisma/client'
import {
  acumularPrs,
  planejarMudancas,
  validarPartes,
  type EstadoDaParte,
  type Parte,
  type ParteDeclarada,
  type PrDaParte,
} from './partes'
import type { EventoAplicavel } from './transicoes'

type Tx = Prisma.TransactionClient

export type ResultadoDaParte = { ok: true } | { ok: false; motivo: string }
const ok: ResultadoDaParte = { ok: true }
const recusa = (motivo: string): ResultadoDaParte => ({ ok: false, motivo })

const minusculo = (e: EstadoNoBanco) => e.toLowerCase() as EstadoDaParte

/** `exemplo/alfa-crm` → `alfa-crm`, no formato que a Fábrica aceita como chave de parte. */
function chaveDoNome(nome: string): string {
  const limpo = nome
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return limpo === '' ? 'parte' : limpo
}

const nomeDoRepositorio = (nomeCompleto: string) => nomeCompleto.split('/').pop() ?? nomeCompleto

/** A chave livre na demanda para um repositório: o nome; com dono se o nome já está tomado. */
function chaveLivre(nomeCompleto: string, usadas: ReadonlySet<string>): string {
  const [dono = '', nome = nomeCompleto] = nomeCompleto.split('/')
  const simples = chaveDoNome(nome)
  if (!usadas.has(simples)) return simples
  const comDono = chaveDoNome(`${nome}-${dono}`)
  if (!usadas.has(comDono)) return comDono
  let n = 2
  while (usadas.has(`${comDono}-${n}`)) n += 1
  return `${comDono}-${n}`
}

export async function criarParteDeEntrada(
  tx: Tx,
  demanda: { id: string; repositorioId: string },
): Promise<void> {
  const repo = await tx.repositorioGitHub.findUniqueOrThrow({
    where: { id: demanda.repositorioId },
    select: { nomeCompleto: true },
  })
  await tx.parteDaDemanda.create({
    data: {
      demandaId: demanda.id,
      chave: chaveDoNome(nomeDoRepositorio(repo.nomeCompleto)),
      repositorioId: demanda.repositorioId,
      ordem: 1,
      dependeDe: [],
    },
  })
}

type LinhaDaParte = Prisma.ParteDaDemandaGetPayload<{
  include: { repositorio: { select: { nomeCompleto: true } } }
}>

async function carregar(tx: Tx, demandaId: string): Promise<LinhaDaParte[]> {
  return tx.parteDaDemanda.findMany({
    where: { demandaId },
    orderBy: [{ criadaEm: 'asc' }, { ordem: 'asc' }],
    include: { repositorio: { select: { nomeCompleto: true } } },
  })
}

function comoParte(l: LinhaDaParte): Parte {
  return {
    chave: l.chave,
    repositorio: l.repositorio.nomeCompleto,
    objetivo: l.objetivo ?? '',
    ordem: l.ordem,
    dependeDe: l.dependeDe,
    chegaAoAr: l.chegaAoAr === 'VERSAO' ? 'versao' : 'publicacao',
    estado: minusculo(l.estado),
    prs: l.prs as unknown as PrDaParte[],
    commitAlvo: l.commitAlvo,
    commitNoAr: l.commitNoAr,
    motivo: l.motivo,
    feitaEm: l.feitaEm,
    noArEm: l.noArEm,
    temPedido: l.pedidoId !== null,
  }
}

const JA_FEITAS: readonly EstadoNoBanco[] = ['FEITA', 'PUBLICANDO', 'NO_AR', 'NAO_CHEGOU']
const EDITAVEIS_PELA_ENTREGA: readonly EstadoNoBanco[] = [
  'PLANEJANDO',
  'EM_CURSO',
  'FEITA',
  'NAO_CHEGOU',
]

/** v2: a etapa só conclui quando as partes estão prontas (seção 7.2). */
export async function conferirPartesDaEtapa(
  tx: Tx,
  demandaId: string,
  marco: 'desenvolvida' | 'entregue',
): Promise<ResultadoDaParte> {
  const partes = (await carregar(tx, demandaId)).filter((p) => p.estado !== 'DESCARTADA')
  if (partes.length === 0) return recusa('a demanda não tem partes')
  const faltam = partes.filter((p) => !JA_FEITAS.includes(p.estado)).map((p) => p.chave)
  if (faltam.length > 0) return recusa(`Faltam partes feitas: ${faltam.join(', ')}.`)
  if (marco === 'entregue') {
    const semPedido = partes
      .filter((p) => p.chegaAoAr === 'PUBLICACAO' && p.pedidoId === null)
      .map((p) => p.chave)
    if (semPedido.length > 0) {
      return recusa(`Falta pedir a publicação das partes: ${semPedido.join(', ')}.`)
    }
  }
  return ok
}

const URL_DE_PR = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/

function prDaUrl(url: string, repositorio: string, mergeCommit: string | null): PrDaParte | null {
  const m = URL_DE_PR.exec(url)
  if (!m) return null
  return {
    url,
    repositorio: repositorio || `${m[1]}/${m[2]}`,
    numero: Number(m[3]),
    estado: 'mergeado',
    mergeCommit,
  }
}

export async function aplicarEventoDeParte(
  tx: Tx,
  demanda: { id: string; repositorioId: string },
  evento: EventoAplicavel,
  agora: Date,
): Promise<ResultadoDaParte> {
  switch (evento.tipo) {
    case 'plano_criado': {
      const entrada = (await carregar(tx, demanda.id)).find((p) => p.estado !== 'DESCARTADA')
      if (!entrada) return ok
      await tx.parteDaDemanda.update({
        where: { id: entrada.id },
        data: {
          planoCaminho: evento.dados.plano,
          planoPrUrl: evento.dados.prUrl,
          ...(entrada.estado === 'PLANEJANDO' || entrada.estado === 'NAO_CHEGOU'
            ? { estado: 'EM_CURSO', motivo: null }
            : {}),
        },
      })
      return ok
    }
    case 'partes_planejadas':
      return planejarPartes(tx, demanda, evento.dados.partes)
    case 'parte_planejada': {
      const d = evento.dados
      const parte = (await carregar(tx, demanda.id)).find((p) => p.chave === d.parte)
      if (!parte || parte.estado === 'DESCARTADA') return recusa(`Parte desconhecida: ${d.parte}.`)
      const volta = parte.estado === 'PLANEJANDO' || parte.estado === 'NAO_CHEGOU'
      await tx.parteDaDemanda.update({
        where: { id: parte.id },
        data: {
          planoCaminho: d.plano,
          planoPrUrl: d.prUrl,
          ...(volta ? { estado: 'EM_CURSO', motivo: null } : {}),
        },
      })
      return ok
    }
    case 'parte_feita':
      return registrarParteFeita(tx, demanda.id, evento.dados, agora)
    case 'entregue':
      return registrarEntregaV1(tx, demanda, evento.dados.prs, agora)
    case 'encerrada_pelo_paulo':
      await tx.parteDaDemanda.updateMany({
        where: { demandaId: demanda.id, estado: { notIn: ['NO_AR', 'DESCARTADA'] } },
        data: { estado: 'DESCARTADA' },
      })
      return ok
    default:
      return ok
  }
}

async function planejarPartes(
  tx: Tx,
  demanda: { id: string; repositorioId: string },
  declaradas: readonly ParteDeclarada[],
): Promise<ResultadoDaParte> {
  const linhas = (await carregar(tx, demanda.id)).filter((p) => p.estado !== 'DESCARTADA')
  const entrada = linhas.find((p) => p.repositorioId === demanda.repositorioId) ?? linhas[0]
  if (!entrada) return recusa('A demanda não tem parte de entrada.')
  const erros = validarPartes(declaradas, entrada.chave)
  if (erros.length > 0) return recusa(erros.join('; '))

  const repositorios = new Map<string, string>()
  for (const nome of new Set(declaradas.map((d) => d.repositorio))) {
    const r = await tx.repositorioGitHub.findFirst({
      where: { nomeCompleto: { equals: nome, mode: 'insensitive' }, projetoId: { not: null } },
      select: { id: true },
    })
    if (!r) return recusa(`cadastre ${nome} no Flow`)
    repositorios.set(nome, r.id)
  }

  const plano = planejarMudancas(linhas.map(comoParte), declaradas)
  if (!plano.ok) return recusa(plano.motivo)

  for (const d of plano.criar) {
    await tx.parteDaDemanda.create({
      data: {
        demandaId: demanda.id,
        chave: d.chave,
        repositorioId: repositorios.get(d.repositorio)!,
        objetivo: d.objetivo,
        ordem: d.ordem,
        dependeDe: d.dependeDe,
        chegaAoAr: d.chegaAoAr === 'versao' ? 'VERSAO' : 'PUBLICACAO',
      },
    })
  }
  for (const d of plano.atualizar) {
    await tx.parteDaDemanda.update({
      where: { demandaId_chave: { demandaId: demanda.id, chave: d.chave } },
      data: { objetivo: d.objetivo, ordem: d.ordem, dependeDe: d.dependeDe },
    })
  }
  if (plano.remover.length > 0) {
    await tx.parteDaDemanda.deleteMany({
      where: { demandaId: demanda.id, chave: { in: plano.remover } },
    })
  }
  return ok
}

async function registrarParteFeita(
  tx: Tx,
  demandaId: string,
  d: {
    parte: string
    prs: { url: string; numero: number; mergeCommit: string }[]
    commit: string
    pendencias: string[]
  },
  agora: Date,
): Promise<ResultadoDaParte> {
  const linhas = await carregar(tx, demandaId)
  const parte = linhas.find((p) => p.chave === d.parte)
  if (!parte || parte.estado === 'DESCARTADA') return recusa(`Parte desconhecida: ${d.parte}.`)
  if (d.pendencias.length > 0) return recusa('parte com pendência: planeje-a na demanda')

  const novos: PrDaParte[] = d.prs.map((p) => ({
    url: p.url,
    repositorio: parte.repositorio.nomeCompleto,
    numero: p.numero,
    estado: 'mergeado',
    mergeCommit: p.mergeCommit,
  }))
  const prs = acumularPrs(parte.prs as unknown as PrDaParte[], novos)
  const vira = parte.estado !== 'FEITA' && EDITAVEIS_PELA_ENTREGA.includes(parte.estado)
  const grava = EDITAVEIS_PELA_ENTREGA.includes(parte.estado)
  await tx.parteDaDemanda.update({
    where: { id: parte.id },
    data: {
      prs: prs as unknown as Prisma.InputJsonValue,
      ...(grava ? { commitAlvo: d.commit } : {}),
      ...(vira ? { estado: 'FEITA', feitaEm: agora, motivo: null } : {}),
    },
  })

  const depois = linhas
    .filter((p) => p.estado !== 'DESCARTADA')
    .map((p) => (p.id === parte.id && vira ? 'FEITA' : p.estado))
  if (depois.every((e) => JA_FEITAS.includes(e))) {
    await tx.demanda.updateMany({
      where: { id: demandaId, entregueEm: null },
      data: { entregueEm: agora },
    })
  }
  return ok
}

/** Contrato 1: os PRs entram na parte do repositório de cada URL; a de entrada fica `feita`. */
async function registrarEntregaV1(
  tx: Tx,
  demanda: { id: string; repositorioId: string },
  urls: readonly string[],
  agora: Date,
): Promise<ResultadoDaParte> {
  const linhas = await carregar(tx, demanda.id)
  const abertas = linhas.filter((p) => p.estado !== 'DESCARTADA')
  const entrada = abertas.find((p) => p.repositorioId === demanda.repositorioId) ?? abertas[0]
  const usadas = new Set(linhas.map((p) => p.chave))
  let ordem = linhas.reduce((m, p) => Math.max(m, p.ordem), 0)
  const foraDoCadastro: PrDaParte[] = []
  const porRepositorio = new Map<string, { id: string; prs: PrDaParte[] }>()

  for (const url of urls) {
    const m = URL_DE_PR.exec(url)
    if (!m) continue
    const nome = `${m[1]}/${m[2]}`
    let alvo = [...porRepositorio.entries()].find(
      ([n]) => n.toLowerCase() === nome.toLowerCase(),
    )?.[1]
    if (!alvo) {
      const existente = abertas.find(
        (p) => p.repositorio.nomeCompleto.toLowerCase() === nome.toLowerCase(),
      )
      if (existente) {
        alvo = { id: existente.id, prs: existente.prs as unknown as PrDaParte[] }
      } else {
        const repo = await tx.repositorioGitHub.findFirst({
          where: { nomeCompleto: { equals: nome, mode: 'insensitive' }, projetoId: { not: null } },
          select: { id: true, nomeCompleto: true },
        })
        if (!repo) {
          // Fora do cadastro: o PR não se perde, vai para a parte de entrada com o repositório da URL.
          const pr = prDaUrl(url, nome, null)
          if (pr && entrada) {
            foraDoCadastro.push(pr)
          }
          continue
        }
        const chave = chaveLivre(repo.nomeCompleto, usadas)
        usadas.add(chave)
        ordem += 1
        const criada = await tx.parteDaDemanda.create({
          data: {
            demandaId: demanda.id,
            chave,
            repositorioId: repo.id,
            ordem,
            dependeDe: [],
            estado: 'FEITA',
            feitaEm: agora,
            motivo: 'parte criada pela entrega, sem plano',
          },
        })
        alvo = { id: criada.id, prs: [] }
      }
      porRepositorio.set(nome, alvo)
    }
    const pr = prDaUrl(url, nome, null)
    if (pr) alvo.prs = acumularPrs(alvo.prs, [pr])
  }
  if (entrada && foraDoCadastro.length > 0) {
    const dela = [...porRepositorio.values()].find((a) => a.id === entrada.id)
    if (dela) dela.prs = acumularPrs(dela.prs, foraDoCadastro)
    else {
      porRepositorio.set(entrada.id, {
        id: entrada.id,
        prs: acumularPrs(entrada.prs as unknown as PrDaParte[], foraDoCadastro),
      })
    }
  }
  for (const a of porRepositorio.values()) {
    await tx.parteDaDemanda.update({
      where: { id: a.id },
      data: { prs: a.prs as unknown as Prisma.InputJsonValue },
    })
  }
  if (entrada && EDITAVEIS_PELA_ENTREGA.includes(entrada.estado) && entrada.estado !== 'FEITA') {
    await tx.parteDaDemanda.update({
      where: { id: entrada.id },
      data: { estado: 'FEITA', feitaEm: agora, motivo: null },
    })
  }
  return ok
}
