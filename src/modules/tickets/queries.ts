// Leituras da tela Tickets: só lê `Relato`, `EnvioDeAndamento` e a demanda ligada.
import type { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { fraseDaDemanda, type PontoAteOAr } from '@/modules/demandas/partes'
import { trilhoDaDemanda } from '@/modules/demandas/apresentacao'
import { paraDemandaNaLista, SELECAO_DA_DEMANDA_NA_LISTA } from '@/modules/demandas/queries'
import type { SinalDoFio } from '@/modules/relatos/contrato'
import { idDoAnexo, type AnexoGravado } from '@/modules/relatos/model'
import {
  agruparTickets,
  chaveDoAutor,
  contarMidias,
  inicioDoPeriodo,
  lerChaveDoAutor,
  lerFiltrosDosTickets,
  LIMITE_DA_LISTA,
  midiasDoTicket,
  montarHistorico,
  quadrosDosTickets,
  resultadoNaTela,
  resumoDoTicket,
  type FiltrosDosTickets,
  type GrupoDeTickets,
  type ItemDoHistorico,
  type MidiaDoTicket,
  type TicketNaLista,
} from './model'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** No detalhe `midias` é a lista de cada mídia, não a contagem da lista. */
export interface TicketDetalhado extends Omit<TicketNaLista, 'midias'> {
  ticket: string | null
  texto: string | null
  transcricao: string | null
  tela: string | null
  versao: string | null
  tipoSugerido: string | null
  idExterno: string
  buscadoEm: Date
  projeto: { nome: string; clientes: string[] }
  midias: MidiaDoTicket[]
  demanda:
    | (NonNullable<TicketNaLista['demanda']> & {
        repositorio: string
        frase: string
        trilho: PontoAteOAr[]
        outrosTickets: number
      })
    | null
  historico: ItemDoHistorico[]
}

export interface TelaDeTickets {
  filtros: FiltrosDosTickets
  quadros: ReturnType<typeof quadrosDosTickets>
  grupos: GrupoDeTickets[]
  total: number
  truncado: boolean
  opcoes: { apps: { id: string; nome: string }[]; autores: { id: string; nome: string }[] }
  semSistemas: boolean
  sistemasDesconectados: string[]
  escolhido: TicketDetalhado | null
}

const NA_LISTA = {
  id: true,
  em: true,
  canal: true,
  resultado: true,
  texto: true,
  transcricao: true,
  assunto: true,
  anexos: true,
  demandaId: true,
  autorIdExterno: true,
  autorNome: true,
  autorPapel: true,
  sistema: { select: { id: true, nome: true } },
  demanda: { select: { id: true, titulo: true } },
} as const

type LinhaDaLista = Prisma.RelatoGetPayload<{ select: typeof NA_LISTA }>

function semMidias(r: LinhaDaLista): Omit<TicketNaLista, 'midias'> {
  return {
    id: r.id,
    em: r.em,
    canal: r.canal,
    sistema: r.sistema,
    autor: {
      id: chaveDoAutor(r.sistema.id, r.autorIdExterno),
      nome: r.autorNome,
      papel: r.autorPapel,
    },
    resumo: resumoDoTicket(r),
    resultado: resultadoNaTela(r),
    demanda: r.demanda,
  }
}

function naLista(r: LinhaDaLista): TicketNaLista {
  return { ...semMidias(r), midias: contarMidias(r.anexos as unknown as AnexoGravado[]) }
}

function ondeDoPeriodo(f: FiltrosDosTickets, agora: Date): Prisma.RelatoWhereInput {
  const inicio = inicioDoPeriodo(f.periodo, agora)
  return inicio ? { em: { gte: inicio } } : {}
}

function ondeDaLista(f: FiltrosDosTickets, agora: Date): Prisma.RelatoWhereInput {
  const e: Prisma.RelatoWhereInput[] = [ondeDoPeriodo(f, agora)]
  if (f.app) e.push({ sistemaId: f.app })
  if (f.canal) e.push({ canal: f.canal })
  const autor = lerChaveDoAutor(f.autor)
  if (autor) e.push({ sistemaId: autor.sistemaId, autorIdExterno: autor.autorIdExterno })
  if (f.demanda) e.push({ demandaId: f.demanda })
  if (f.resultado === 'virou_demanda') e.push({ resultado: 'SEGUE', demandaId: { not: null } })
  if (f.resultado === 'orientado') e.push({ resultado: 'ORIENTADO' })
  if (f.resultado === 'sem_demanda') e.push({ resultado: 'SEGUE', demandaId: null })
  if (f.q) {
    const c = { contains: f.q, mode: 'insensitive' as const }
    e.push({ OR: [{ texto: c }, { transcricao: c }, { assunto: c }] })
  }
  return { AND: e }
}

async function quadrosDoPeriodo(f: FiltrosDosTickets, agora: Date) {
  const base = ondeDoPeriodo(f, agora)
  const [virou, orientados, sem] = await Promise.all([
    db.relato.count({ where: { ...base, resultado: 'SEGUE', demandaId: { not: null } } }),
    db.relato.count({ where: { ...base, resultado: 'ORIENTADO' } }),
    db.relato.count({ where: { ...base, resultado: 'SEGUE', demandaId: null } }),
  ])
  return {
    chegaram: virou + orientados + sem,
    viraramDemanda: virou,
    orientados,
    semDemanda: sem,
  }
}

export async function obterTelaDeTickets(
  sujeito: Sujeito,
  params: Record<string, string | string[] | undefined>,
  agora: Date,
): Promise<TelaDeTickets> {
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  const filtros = lerFiltrosDosTickets(params)
  const conectado = { estado: { not: 'REVOGADO' } } as const
  const onde = ondeDaLista(filtros, agora)
  const [linhas, total, quadros, apps, autores, escolhido] = await Promise.all([
    db.relato.findMany({
      where: onde,
      orderBy: { em: 'desc' },
      take: LIMITE_DA_LISTA + 1,
      select: NA_LISTA,
    }),
    db.relato.count({ where: onde }),
    quadrosDoPeriodo(filtros, agora),
    db.sistemaConectado.findMany({
      where: conectado,
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, estado: true },
    }),
    db.relato.findMany({
      distinct: ['sistemaId', 'autorIdExterno'],
      orderBy: [{ sistemaId: 'asc' }, { autorIdExterno: 'asc' }, { em: 'desc' }],
      select: {
        sistemaId: true,
        autorIdExterno: true,
        autorNome: true,
        sistema: { select: { nome: true } },
      },
    }),
    filtros.t ? obterTicket(sujeito, filtros.t, agora) : null,
  ])
  const truncado = linhas.length > LIMITE_DA_LISTA
  const visiveis = linhas.slice(0, LIMITE_DA_LISTA).map(naLista)
  return {
    filtros,
    quadros,
    grupos: agruparTickets(visiveis, filtros.agrupar, agora),
    total,
    truncado,
    opcoes: {
      apps: apps.map((a) => ({ id: a.id, nome: a.nome })),
      autores: autores
        .map((a) => ({
          id: chaveDoAutor(a.sistemaId, a.autorIdExterno),
          nome: `${a.autorNome} · ${a.sistema.nome}`,
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    },
    semSistemas: apps.length === 0,
    sistemasDesconectados: apps.filter((a) => a.estado === 'DESCONECTADO').map((a) => a.nome),
    escolhido,
  }
}

export async function obterTicket(
  sujeito: Sujeito,
  id: string,
  agora: Date,
): Promise<TicketDetalhado | null> {
  void agora // reservado: o detalhe ainda não depende da hora
  exigirPermissao(sujeito, 'desenvolvimento.ler')
  if (!UUID.test(id)) return null
  const r = await db.relato.findUnique({
    where: { id },
    select: {
      ...NA_LISTA,
      ticket: true,
      tipoSugerido: true,
      versao: true,
      idExterno: true,
      sistemaId: true,
      criadoEm: true,
      sinais: true,
      envios: { orderBy: { criadoEm: 'asc' } },
      sistema: {
        select: {
          id: true,
          nome: true,
          projeto: {
            select: { nome: true, clientes: { select: { cliente: { select: { nome: true } } } } },
          },
        },
      },
      demanda: {
        select: {
          ...SELECAO_DA_DEMANDA_NA_LISTA,
          entregueEm: true,
          repositorio: { select: { nomeCompleto: true } },
          eventos: { orderBy: { seq: 'desc' }, take: 1, select: { em: true } },
        },
      },
    },
  })
  if (!r) return null

  const anexos = r.anexos as unknown as AnexoGravado[]
  const d = r.demanda
  const ids = d ? anexos.map((_, i) => idDoAnexo(`${r.sistemaId}:${r.idExterno}`, i)) : []
  const [arquivos, irmaos] = await Promise.all([
    d && ids.length > 0
      ? db.arquivoDaDemanda.findMany({
          where: { demandaId: d.id, tipo: 'ANEXO', id: { in: ids } },
          select: { id: true, apagadoEm: true },
        })
      : [],
    d ? db.relato.count({ where: { demandaId: d.id, id: { not: r.id } } }) : 0,
  ])

  const base = semMidias(r)
  const naListaDaDemanda = d ? paraDemandaNaLista(d) : null
  const encerradaEm = d?.eventos[0]?.em ?? null
  return {
    ...base,
    ticket: r.ticket,
    texto: r.texto,
    transcricao: r.transcricao,
    // A "tela" do relato é o assunto que o app informou.
    tela: r.assunto,
    versao: r.versao,
    tipoSugerido: r.tipoSugerido,
    idExterno: r.idExterno,
    buscadoEm: r.criadoEm,
    projeto: {
      nome: r.sistema.projeto.nome,
      clientes: r.sistema.projeto.clientes
        .map((c) => c.cliente.nome)
        .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    },
    midias: midiasDoTicket(
      { sistemaId: r.sistemaId, idExterno: r.idExterno, demandaId: r.demandaId, anexos },
      arquivos,
    ),
    demanda:
      d && naListaDaDemanda
        ? {
            id: d.id,
            titulo: d.titulo,
            repositorio: d.repositorio.nomeCompleto,
            frase:
              naListaDaDemanda.partes.length > 0
                ? fraseDaDemanda(naListaDaDemanda.partes).texto
                : '',
            trilho: trilhoDaDemanda(naListaDaDemanda),
            outrosTickets: irmaos,
          }
        : null,
    historico: montarHistorico({
      relato: { em: r.em, criadoEm: r.criadoEm, sinais: r.sinais as unknown as SinalDoFio[] },
      envios: r.envios,
      demanda: d
        ? {
            criadaEm: d.criadaEm,
            entregueEm: d.entregueEm,
            noArEm: d.noArEm,
            encerrada: d.encerrada,
            encerradaEm,
          }
        : null,
    }),
  }
}
