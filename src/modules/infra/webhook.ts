import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { normalizarNome } from '@/modules/clientes/model'
import { resumirErroParaLog } from '@/modules/github/model'
import {
  type CorpoDeAlerta,
  chaveDedupeDoWebhook,
  estadoDoAlerta,
  hashDoTokenDeAlertas,
  lerCorpoDoAlerta,
} from './model'

export const LIMITE_DO_CORPO_DO_WEBHOOK = 16_384
const TOLERANCIA_DE_FUTURO_MS = 5 * 60_000
const AVISO_SEM_RECURSO =
  'Recurso não encontrado no inventário; o alerta foi registrado sem recurso.'

export type RespostaDoWebhook =
  | { erro: string; campos?: string[] }
  | {
      resultado: 'criado' | 'repetido' | 'reaberto' | 'resolvido' | 'sem-mudanca' | 'ignorado'
      alertaId?: string
      aviso?: string
    }

export interface EntradaDoWebhook {
  authorization: string | null
  contentType: string | null
  contentLength: string | null
  corpo: () => Promise<string>
}

export interface SaidaDoWebhook {
  status: 200 | 201 | 202 | 400 | 401 | 413 | 415 | 500
  corpo: RespostaDoWebhook
}

type Resultado = Extract<RespostaDoWebhook, { resultado: string }>['resultado']

function extrairToken(authorization: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')
  return m?.[1] ?? null
}

async function autenticarFonte(authorization: string | null): Promise<{ id: string } | null> {
  const token = extrairToken(authorization)
  if (token === null) return null
  const fonte = await db.fonteDeAlertas.findUnique({
    where: { tokenHash: hashDoTokenDeAlertas(token) },
    select: { id: true, revogadaEm: true },
  })
  return fonte && fonte.revogadaEm === null ? { id: fonte.id } : null
}

// O recurso do inventário é achado pelo identificador externo e, na falta, pelo nome normalizado.
async function acharRecurso(referencia: string | null): Promise<string | null> {
  if (referencia === null) return null
  const recurso =
    (await db.recurso.findUnique({
      where: { identificadorExterno: referencia },
      select: { id: true },
    })) ??
    (await db.recurso.findUnique({
      where: { nomeNormalizado: normalizarNome(referencia) },
      select: { id: true },
    }))
  return recurso?.id ?? null
}

function maisRecente(a: Date, b: Date): Date {
  return a >= b ? a : b
}

async function gravarNaTransacao(
  fonteId: string,
  d: CorpoDeAlerta,
  ocorridoEm: Date,
  recursoId: string | null,
  agora: Date,
): Promise<{ resultado: Resultado; alertaId?: string }> {
  const chaveDedupe = chaveDedupeDoWebhook(fonteId, d.chave)
  return db.$transaction(async (tx) => {
    // Bloqueia a linha da mesma chave: duas notificações simultâneas se serializam.
    await tx.$queryRaw`SELECT "id" FROM "Alerta" WHERE "chaveDedupe" = ${chaveDedupe} FOR UPDATE`
    const atual = await tx.alerta.findUnique({ where: { chaveDedupe } })
    const transicao = estadoDoAlerta(atual, {
      tipo: d.situacao === 'ativo' ? 'ocorrencia' : 'resolucao-na-origem',
      em: ocorridoEm,
    })
    if ('recusa' in transicao) {
      // Eventos do webhook nunca produzem recusa; se acontecer, é falha de programação.
      throw new Error('Transição inesperada para o webhook.')
    }

    await tx.fonteDeAlertas.update({ where: { id: fonteId }, data: { ultimoUsoEm: agora } })

    const daNotificacao = {
      titulo: d.titulo,
      severidade: d.severidade,
      detalhe: d.detalhe,
    }
    switch (transicao.efeito) {
      case 'criar': {
        const criado = await tx.alerta.create({
          data: {
            chaveDedupe,
            origem: 'WEBHOOK',
            estado: 'ATIVO',
            ...daNotificacao,
            recursoId,
            fonteId,
            primeiraOcorrenciaEm: ocorridoEm,
            ultimaOcorrenciaEm: ocorridoEm,
            ocorrencias: 1,
          },
          select: { id: true },
        })
        await tx.eventoDeAlerta.create({ data: { alertaId: criado.id, tipo: 'CRIADO' } })
        return { resultado: 'criado', alertaId: criado.id }
      }
      case 'repetir':
      case 'reabrir': {
        if (atual === null) throw new Error('Alerta ausente na repetição.')
        const reabrir = transicao.efeito === 'reabrir'
        await tx.alerta.update({
          where: { id: atual.id },
          data: {
            ...daNotificacao,
            ocorrencias: { increment: 1 },
            ultimaOcorrenciaEm: maisRecente(atual.ultimaOcorrenciaEm, ocorridoEm),
            recursoId: atual.recursoId ?? recursoId,
            ...(reabrir
              ? {
                  estado: 'ATIVO',
                  reconhecidoPorId: null,
                  reconhecidoEm: null,
                  resolvidoEm: null,
                  resolvidoPorId: null,
                }
              : {}),
          },
        })
        if (reabrir) {
          await tx.eventoDeAlerta.create({ data: { alertaId: atual.id, tipo: 'REABERTO' } })
        }
        return { resultado: reabrir ? 'reaberto' : 'repetido', alertaId: atual.id }
      }
      case 'resolver': {
        if (atual === null) throw new Error('Alerta ausente na resolução.')
        await tx.alerta.update({
          where: { id: atual.id },
          data: { estado: 'RESOLVIDO_NA_ORIGEM', resolvidoEm: ocorridoEm, resolvidoPorId: null },
        })
        await tx.eventoDeAlerta.create({ data: { alertaId: atual.id, tipo: 'RESOLVIDO' } })
        return { resultado: 'resolvido', alertaId: atual.id }
      }
      case 'ignorar':
        return { resultado: 'ignorado' }
      default:
        return { resultado: 'sem-mudanca', ...(atual ? { alertaId: atual.id } : {}) }
    }
  })
}

function ehConflitoDeUnicidade(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}

// Sem sessão: o token da fonte é a autorização. Nenhuma escrita antes de autenticar e validar o corpo.
export async function receberAlertaDoWebhook(
  e: EntradaDoWebhook,
  agora: Date,
): Promise<SaidaDoWebhook> {
  try {
    const fonte = await autenticarFonte(e.authorization)
    if (fonte === null) {
      return { status: 401, corpo: { erro: 'Token inválido.' } }
    }

    if (!(e.contentType ?? '').toLowerCase().includes('application/json')) {
      return { status: 415, corpo: { erro: 'Envie o corpo como application/json.' } }
    }

    const corpoGrande: SaidaDoWebhook = { status: 413, corpo: { erro: 'Corpo maior que 16 KB.' } }
    const declarado = Number(e.contentLength)
    if (e.contentLength !== null && declarado > LIMITE_DO_CORPO_DO_WEBHOOK) {
      return corpoGrande
    }
    const texto = await e.corpo()
    if (Buffer.byteLength(texto, 'utf8') > LIMITE_DO_CORPO_DO_WEBHOOK) {
      return corpoGrande
    }

    let json: unknown
    try {
      json = JSON.parse(texto)
    } catch {
      return { status: 400, corpo: { erro: 'Corpo inválido.', campos: [] } }
    }
    const lido = lerCorpoDoAlerta(json)
    if (!lido.ok) {
      return { status: 400, corpo: { erro: 'Corpo inválido.', campos: lido.campos } }
    }
    const dados = lido.dados

    const ocorridoEm =
      dados.ocorridoEm === null ||
      dados.ocorridoEm.getTime() > agora.getTime() + TOLERANCIA_DE_FUTURO_MS
        ? agora
        : dados.ocorridoEm
    const recursoId = await acharRecurso(dados.recurso)

    let gravado: { resultado: Resultado; alertaId?: string }
    try {
      gravado = await gravarNaTransacao(fonte.id, dados, ocorridoEm, recursoId, agora)
    } catch (erro) {
      if (!ehConflitoDeUnicidade(erro)) throw erro
      // Criação concorrente da mesma chave: a segunda tentativa encontra o alerta e conta como repetição.
      gravado = await gravarNaTransacao(fonte.id, dados, ocorridoEm, recursoId, agora)
    }

    const semRecurso =
      dados.recurso !== null &&
      recursoId === null &&
      (gravado.resultado === 'criado' ||
        gravado.resultado === 'repetido' ||
        gravado.resultado === 'reaberto')
    const status =
      gravado.resultado === 'criado' ? 201 : gravado.resultado === 'ignorado' ? 202 : 200
    return {
      status,
      corpo: { ...gravado, ...(semRecurso ? { aviso: AVISO_SEM_RECURSO } : {}) },
    }
  } catch (erro) {
    log.error({ erro: resumirErroParaLog(erro) }, 'webhook de alertas falhou')
    return { status: 500, corpo: { erro: 'Falha ao registrar o alerta.' } }
  }
}
