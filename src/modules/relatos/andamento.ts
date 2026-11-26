// Caixa de saída do andamento (D83): um envio por relato e estado (chave única), reenviado sempre
// com a mesma mensagem até o sistema responder 2xx. O sistema não avisa duas vezes a mesma coisa.
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { chaveDosSegredos } from '@/lib/segredos'
import type { Destino, Encerramento, EtapaDefinida } from '@/modules/demandas/model'
import { paraOFio } from '@/modules/demandas/service'
import { type AlvoDoSistema, enviarAndamento } from './cliente'
import type { EstadoDoAndamento } from './contrato'
import {
  andamentoDaDemanda,
  MENSAGEM_AUTOMATICA,
  proximaTentativa,
  proximoAndamento,
} from './model'
import { alvoDoSistema } from './sistemas'

const DIA_MS = 24 * 60 * 60_000
const ENVIOS_POR_CICLO = 50

/** Varre os relatos `segue` com demanda e enfileira o próximo aviso automático de cada um. */
export async function enfileirarAutomaticos(agora: Date): Promise<number> {
  const relatos = await db.relato.findMany({
    where: {
      resultado: 'SEGUE',
      sistema: { estado: { not: 'REVOGADO' } },
      demanda: {
        OR: [
          { encerrada: null },
          { atualizadaEm: { gte: new Date(agora.getTime() - 7 * DIA_MS) } },
        ],
      },
    },
    select: {
      id: true,
      envios: { select: { estado: true } },
      demanda: { select: { encerrada: true, destino: true, concluidas: true, etapas: true } },
    },
  })
  const novos: { relatoId: string; estado: string; mensagem: string; origem: string }[] = []
  for (const r of relatos) {
    if (!r.demanda) continue
    const atual = andamentoDaDemanda({
      encerrada: r.demanda.encerrada as Encerramento | null,
      destino: r.demanda.destino ? (paraOFio.destino(r.demanda.destino) as Destino) : null,
      concluidas: r.demanda.concluidas,
      etapas: r.demanda.etapas as unknown as EtapaDefinida[],
    })
    const proximo = proximoAndamento(
      atual,
      r.envios.map((e) => e.estado as EstadoDoAndamento),
    )
    if (proximo) {
      novos.push({
        relatoId: r.id,
        estado: proximo,
        mensagem: MENSAGEM_AUTOMATICA[proximo],
        origem: 'automatico',
      })
    }
  }
  if (novos.length === 0) return 0
  const { count } = await db.envioDeAndamento.createMany({
    data: novos.map((n) => ({ ...n, proximaTentativaEm: agora, criadoEm: agora })),
    skipDuplicates: true,
  })
  return count
}

export interface ResumoDoEnvio {
  enviados: number
  reagendados: number
  descartados: number
}

/** Envia os pendentes vencidos, do mais antigo; reenvio usa o mesmo estado e a mesma mensagem. */
export async function enviarPendentes(
  agora: Date,
  deps: { enviar?: typeof enviarAndamento; chave?: Buffer | null } = {},
): Promise<ResumoDoEnvio> {
  const resumo: ResumoDoEnvio = { enviados: 0, reagendados: 0, descartados: 0 }
  const chave = deps.chave === undefined ? chaveDosSegredos(process.env) : deps.chave
  if (!chave) return resumo
  const enviar = deps.enviar ?? enviarAndamento
  const pendentes = await db.envioDeAndamento.findMany({
    where: { situacao: 'PENDENTE', proximaTentativaEm: { lte: agora } },
    orderBy: { criadoEm: 'asc' },
    take: ENVIOS_POR_CICLO,
    include: {
      relato: {
        select: {
          idExterno: true,
          sistema: { select: { id: true, url: true, tokenCifrado: true, estado: true } },
        },
      },
    },
  })
  const alvos = new Map<string, AlvoDoSistema | null>()
  const desconectados = new Set<string>()
  for (const envio of pendentes) {
    const s = envio.relato.sistema
    if (s.estado === 'REVOGADO') {
      await db.envioDeAndamento.update({
        where: { id: envio.id },
        data: { situacao: 'DESCARTADO', ultimoErro: 'Sistema revogado.' },
      })
      resumo.descartados++
      continue
    }
    if (s.estado === 'DESCONECTADO' || desconectados.has(s.id)) continue
    if (!alvos.has(s.id)) {
      try {
        alvos.set(s.id, alvoDoSistema(s, chave))
      } catch {
        log.warn({ tarefa: 'enviar-andamento', sistemaId: s.id }, 'token do sistema não decifrou')
        alvos.set(s.id, null)
      }
    }
    const alvo = alvos.get(s.id)
    if (!alvo) continue
    const r = await enviar(alvo, envio.relato.idExterno, {
      estado: envio.estado as EstadoDoAndamento,
      mensagem: envio.mensagem,
    })
    if (r.resultado === 'enviado') {
      await db.envioDeAndamento.update({
        where: { id: envio.id },
        data: { situacao: 'ENVIADO', enviadoEm: agora, ultimoErro: null },
      })
      resumo.enviados++
    } else if (r.resultado === 'descartar') {
      await db.envioDeAndamento.update({
        where: { id: envio.id },
        data: { situacao: 'DESCARTADO', ultimoErro: r.motivo },
      })
      resumo.descartados++
    } else if (r.resultado === 'token_recusado') {
      // O envio continua pendente, sem contar tentativa: volta quando alguém salvar um token novo.
      desconectados.add(s.id)
      await db.sistemaConectado.update({
        where: { id: s.id },
        data: { estado: 'DESCONECTADO', ultimoErro: 'O sistema recusou o token.' },
      })
    } else {
      const quando = proximaTentativa(envio.tentativas, envio.criadoEm, agora)
      await db.envioDeAndamento.update({
        where: { id: envio.id },
        data: quando
          ? { tentativas: { increment: 1 }, proximaTentativaEm: quando, ultimoErro: r.motivo }
          : { situacao: 'DESCARTADO', ultimoErro: 'Não entregue em 7 dias.' },
      })
      if (quando) resumo.reagendados++
      else resumo.descartados++
    }
  }
  return resumo
}
