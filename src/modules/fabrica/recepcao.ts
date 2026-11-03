import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { resumirErroParaLog } from '@/modules/github/model'
import { retratoV1Schema } from './contrato'
import {
  decidirGravacaoDoRetrato,
  extrairTokenDaFabrica,
  hashDoTokenDaFabrica,
  LIMITE_DO_CORPO_DO_RETRATO,
} from './model'

export type RespostaDaRecepcao = { erro: string } | { resultado: 'gravado' | 'descartado' }

export interface EntradaDaRecepcao {
  authorization: string | null
  contentType: string | null
  contentLength: string | null
  corpo: () => Promise<string>
}

export interface SaidaDaRecepcao {
  status: 200 | 400 | 401 | 413 | 415 | 500
  corpo: RespostaDaRecepcao
}

const CORPO_INVALIDO: SaidaDaRecepcao = { status: 400, corpo: { erro: 'Corpo inválido.' } }

async function autenticarFonte(authorization: string | null): Promise<{ id: string } | null> {
  const token = extrairTokenDaFabrica(authorization)
  if (token === null) return null
  const fonte = await db.fonteDaFabrica.findUnique({
    where: { tokenHash: hashDoTokenDaFabrica(token) },
    select: { id: true, revogadaEm: true },
  })
  return fonte && fonte.revogadaEm === null ? { id: fonte.id } : null
}

function ehConflitoDeUnicidade(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}

// Atualiza só se o guardado não for mais novo; sem linha ainda, cria. Atômico sem transação:
// a corrida na criação cai no P2002 e a segunda tentativa vira atualização condicional.
async function gravarSeForMaisNovo(
  fonteId: string,
  geradoEm: Date,
  conteudo: Prisma.InputJsonValue,
  agora: Date,
): Promise<'gravado' | 'descartado'> {
  const atualizar = () =>
    db.retratoDaFabrica.updateMany({
      where: { fonteId, geradoEm: { lte: geradoEm } },
      data: { geradoEm, recebidoEm: agora, conteudo },
    })
  if ((await atualizar()).count > 0) return 'gravado'

  const existe = await db.retratoDaFabrica.findUnique({
    where: { fonteId },
    select: { fonteId: true },
  })
  if (existe) return 'descartado'
  try {
    await db.retratoDaFabrica.create({
      data: { fonteId, geradoEm, recebidoEm: agora, conteudo },
    })
    return 'gravado'
  } catch (erro) {
    if (!ehConflitoDeUnicidade(erro)) throw erro
    return (await atualizar()).count > 0 ? 'gravado' : 'descartado'
  }
}

// Sem sessão: o token da fonte é a autorização. Nenhuma escrita antes de autenticar e validar o corpo.
export async function receberRetratoDaFabrica(
  e: EntradaDaRecepcao,
  agora: Date,
): Promise<SaidaDaRecepcao> {
  try {
    const fonte = await autenticarFonte(e.authorization)
    if (fonte === null) return { status: 401, corpo: { erro: 'Token inválido.' } }

    if (!(e.contentType ?? '').toLowerCase().includes('application/json')) {
      return { status: 415, corpo: { erro: 'Envie o corpo como application/json.' } }
    }

    const corpoGrande: SaidaDaRecepcao = { status: 413, corpo: { erro: 'Corpo maior que 256 KB.' } }
    if (e.contentLength !== null && Number(e.contentLength) > LIMITE_DO_CORPO_DO_RETRATO) {
      return corpoGrande
    }
    const texto = await e.corpo()
    if (Buffer.byteLength(texto, 'utf8') > LIMITE_DO_CORPO_DO_RETRATO) return corpoGrande

    let json: unknown
    try {
      json = JSON.parse(texto)
    } catch {
      return CORPO_INVALIDO
    }
    const lido = retratoV1Schema.safeParse(json)
    if (!lido.success) return CORPO_INVALIDO

    const geradoEm = new Date(lido.data.geradoEm)
    const guardado = await db.retratoDaFabrica.findUnique({
      where: { fonteId: fonte.id },
      select: { geradoEm: true },
    })
    const decisao = decidirGravacaoDoRetrato(guardado?.geradoEm ?? null, geradoEm, agora)
    if (decisao === 'futuro') return CORPO_INVALIDO

    await db.fonteDaFabrica.update({ where: { id: fonte.id }, data: { ultimoUsoEm: agora } })
    if (decisao === 'descartar') return { status: 200, corpo: { resultado: 'descartado' } }

    const resultado = await gravarSeForMaisNovo(fonte.id, geradoEm, lido.data, agora)
    return { status: 200, corpo: { resultado } }
  } catch (erro) {
    log.error({ erro: resumirErroParaLog(erro) }, 'recepção do retrato da Fábrica falhou')
    return { status: 500, corpo: { erro: 'Falha ao registrar o retrato.' } }
  }
}
