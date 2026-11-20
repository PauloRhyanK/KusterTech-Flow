import type { z } from 'zod'
import type { eventoDaFabricaSchema } from './contrato'
import {
  LIMITE_DE_FALHAS_DO_TESTE,
  LIMITE_DE_RECUSAS_DO_DESENHO,
  concluirEtapaAtual,
  esperaOPaulo,
  podeConcluir,
  type Ator,
  type Destino,
  type EstadoDaDemanda,
  type EtapaDefinida,
} from './model'

type EventoDoFio = z.infer<typeof eventoDaFabricaSchema>

export type EventoAplicavel =
  | {
      [K in EventoDoFio['tipo']]: Pick<Extract<EventoDoFio, { tipo: K }>, 'tipo' | 'dados'>
    }[EventoDoFio['tipo']]
  | { tipo: 'destino_decidido'; dados: { destino: Exclude<Destino, 'decisao_do_paulo'> } }
  | { tipo: 'desenho_aprovado'; dados: { versao: number } }
  | { tipo: 'ajuste_pedido'; dados: { versao: number; texto: string } }
  | {
      tipo: 'plano_entregue'
      dados: { plano: string; resumo: string | null; artefato: string | null }
    }
  | { tipo: 'retomada'; dados: Record<string, never> }
  | { tipo: 'etapa_concluida_pelo_paulo'; dados: { chave: string } }

export interface ContextoDaTransicao {
  etapas: readonly EtapaDefinida[]
  temTela: boolean
  capturas: readonly { id: string; tela: 'desktop' | 'celular' }[]
}

export type ResultadoDaTransicao =
  { ok: true; estado: EstadoDaDemanda } | { ok: false; motivo: string }

const ATORES: Record<EventoAplicavel['tipo'], readonly Ator[]> = {
  triagem: ['fabrica'],
  triagem_falhou: ['fabrica'],
  plano_criado: ['fabrica'],
  desenho_pronto: ['fabrica'],
  etapa_concluida: ['fabrica'],
  travada: ['fabrica'],
  destravada: ['fabrica'],
  teste: ['fabrica'],
  entregue: ['fabrica'],
  destino_decidido: ['paulo'],
  desenho_aprovado: ['paulo'],
  ajuste_pedido: ['paulo'],
  plano_entregue: ['sessao', 'paulo'],
  retomada: ['paulo'],
  etapa_concluida_pelo_paulo: ['paulo'],
}

function destravar(e: EstadoDaDemanda): EstadoDaDemanda {
  if (e.espera !== 'travada') return { ...e, espera: null, esperaMotivo: null }
  const antes = e.antesDaTrava
  return {
    ...e,
    espera: antes?.espera ?? null,
    esperaMotivo: antes?.motivo ?? null,
    antesDaTrava: null,
  }
}

const recusa = (motivo: string): ResultadoDaTransicao => ({ ok: false, motivo })
const aceita = (estado: EstadoDaDemanda): ResultadoDaTransicao => ({ ok: true, estado })

export function aplicarEvento(
  estado: EstadoDaDemanda,
  ctx: ContextoDaTransicao,
  evento: EventoAplicavel & { ator: Ator },
): ResultadoDaTransicao {
  if (estado.encerrada) return recusa('A demanda já foi encerrada.')
  if (!ATORES[evento.tipo].includes(evento.ator)) {
    return recusa('Este evento não pode vir deste ator.')
  }
  const atual = ctx.etapas.find((e) => e.chave === estado.etapaAtual)
  if (!atual) return recusa('A etapa atual não existe no modelo.')

  const fabricaComEspera =
    evento.ator === 'fabrica' &&
    estado.espera !== null &&
    evento.tipo !== 'travada' &&
    evento.tipo !== 'destravada' &&
    // estes dois têm recusa própria, com o motivo exato
    !(evento.tipo === 'plano_criado' && estado.espera === 'planejar_comigo') &&
    !(
      evento.tipo === 'desenho_pronto' &&
      (estado.espera === 'aprovar_desenho' || estado.espera === 'planejar_comigo')
    )
  if (fabricaComEspera) return recusa('A demanda está parada e não aceita este evento agora.')

  const concluir = (e: EstadoDaDemanda): ResultadoDaTransicao => {
    const proximo = concluirEtapaAtual(e, ctx.etapas, ctx.temTela)
    return proximo === e ? recusa('A etapa atual não pode ser concluída.') : aceita(proximo)
  }
  const naoE = (marco: string) => recusa(`A etapa atual não é ${marco}.`)

  switch (evento.tipo) {
    case 'triagem': {
      if (atual.marco !== 'recebida' || estado.espera !== null) return naoE('recebida')
      const d = evento.dados
      const base = { ...estado, destino: d.destino }
      if (d.destino === 'orientada') {
        if (!d.resposta?.trim()) return recusa('A orientação precisa de uma resposta.')
        return aceita({ ...base, espera: null, esperaMotivo: null, encerrada: 'orientada' })
      }
      if (d.destino === 'decisao_do_paulo') {
        return aceita({ ...base, espera: 'decidir_destino', esperaMotivo: d.motivo })
      }
      return concluir(base)
    }
    case 'triagem_falhou': {
      if (atual.marco !== 'recebida') return naoE('recebida')
      return aceita({
        ...estado,
        destino: 'decisao_do_paulo',
        espera: 'decidir_destino',
        esperaMotivo: evento.dados.motivo,
      })
    }
    case 'destino_decidido': {
      if (estado.espera !== 'decidir_destino') {
        return recusa('A demanda não espera uma decisão de destino.')
      }
      const base = { ...estado, destino: evento.dados.destino, espera: null, esperaMotivo: null }
      if (evento.dados.destino === 'orientada') return aceita({ ...base, encerrada: 'orientada' })
      return concluir(base)
    }
    case 'plano_criado':
    case 'plano_entregue': {
      if (
        evento.tipo === 'plano_entregue' &&
        atual.marco === 'desenho' &&
        estado.espera === 'planejar_comigo'
      ) {
        return aceita({ ...estado, espera: 'aprovar_desenho', esperaMotivo: null })
      }
      if (atual.marco !== 'planejada') return naoE('planejada')
      if (!podeConcluir(atual, estado.nivel, evento.ator)) {
        return recusa('A etapa de planejamento espera o Paulo.')
      }
      return concluir(estado)
    }
    case 'desenho_pronto': {
      if (atual.marco !== 'desenho') return naoE('desenho')
      if (estado.espera === 'planejar_comigo') {
        return recusa('O desenho agora é planejado com o Paulo.')
      }
      const versao = estado.versaoDoDesenho + 1
      const base = { ...estado, versaoDoDesenho: versao }
      if (esperaOPaulo(atual, estado.nivel)) {
        return aceita({ ...base, espera: 'aprovar_desenho', esperaMotivo: null })
      }
      return concluir({ ...base, desenhoAprovado: versao, espera: null, esperaMotivo: null })
    }
    case 'desenho_aprovado': {
      if (estado.espera !== 'aprovar_desenho' || evento.dados.versao !== estado.versaoDoDesenho) {
        return recusa('Há uma versão mais nova do desenho.')
      }
      return concluir({
        ...estado,
        desenhoAprovado: evento.dados.versao,
        espera: null,
        esperaMotivo: null,
      })
    }
    case 'ajuste_pedido': {
      if (estado.espera !== 'aprovar_desenho' || evento.dados.versao !== estado.versaoDoDesenho) {
        return recusa('Há uma versão mais nova do desenho.')
      }
      const recusas = estado.recusasDoDesenho + 1
      if (recusas >= LIMITE_DE_RECUSAS_DO_DESENHO) {
        return aceita({
          ...estado,
          recusasDoDesenho: recusas,
          nivel: 'planejar_comigo',
          espera: 'planejar_comigo',
          esperaMotivo: `desenho recusado ${LIMITE_DE_RECUSAS_DO_DESENHO} vezes`,
        })
      }
      return aceita({ ...estado, recusasDoDesenho: recusas, espera: null, esperaMotivo: null })
    }
    case 'etapa_concluida': {
      if (atual.marco !== evento.dados.marco || !podeConcluir(atual, estado.nivel, 'fabrica')) {
        return naoE(evento.dados.marco)
      }
      return concluir(estado)
    }
    case 'travada':
      return aceita({
        ...estado,
        antesDaTrava:
          estado.espera === 'travada'
            ? estado.antesDaTrava
            : { espera: estado.espera, motivo: estado.esperaMotivo },
        espera: 'travada',
        esperaMotivo: evento.dados.motivo,
      })
    case 'destravada':
      if (estado.espera !== 'travada') return aceita(estado)
      return aceita(destravar(estado))
    case 'teste': {
      if (atual.marco !== 'testada') return naoE('testada')
      const d = evento.dados
      if (d.resultado === 'passou') {
        const citadas = ctx.capturas.filter((c) => d.capturas.includes(c.id))
        const completo =
          citadas.some((c) => c.tela === 'desktop') && citadas.some((c) => c.tela === 'celular')
        if (!completo) return recusa('O teste precisa de capturas de desktop e celular.')
        return concluir(estado)
      }
      const falhas = estado.falhasDoTeste + 1
      const posicao = ctx.etapas.findIndex((e) => e.marco === 'desenvolvida')
      if (falhas >= LIMITE_DE_FALHAS_DO_TESTE || posicao < 0) {
        return aceita({
          ...estado,
          falhasDoTeste: falhas,
          espera: 'teste_falhou',
          esperaMotivo: d.resumo,
        })
      }
      const volta = ctx.etapas[posicao]!
      const ordem = ctx.etapas.map((e) => e.chave)
      return aceita({
        ...estado,
        falhasDoTeste: falhas,
        etapaAtual: volta.chave,
        concluidas: estado.concluidas.filter((c) => ordem.indexOf(c) < posicao),
        espera: null,
        esperaMotivo: null,
      })
    }
    case 'retomada':
      if (estado.espera !== 'travada' && estado.espera !== 'teste_falhou') {
        return recusa('A demanda não está parada.')
      }
      return aceita(destravar(estado))
    case 'entregue':
      if (atual.marco !== 'entregue') return naoE('entregue')
      return concluir(estado)
    case 'etapa_concluida_pelo_paulo':
      if (
        atual.marco !== null ||
        atual.chave !== evento.dados.chave ||
        !podeConcluir(atual, estado.nivel, 'paulo')
      ) {
        return recusa(`A etapa atual não é ${evento.dados.chave}.`)
      }
      return concluir(estado)
  }
}

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonico(x)]),
    )
  }
  return v
}

/** JSON com as chaves em ordem, para comparar dados sem depender da ordem. */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(canonico(valor))
}

export function compararEvento(
  guardado: { tipo: string; dados: unknown },
  novo: { tipo: string; dados: unknown },
): 'repetido' | 'conflito' {
  return guardado.tipo === novo.tipo && jsonCanonico(guardado.dados) === jsonCanonico(novo.dados)
    ? 'repetido'
    : 'conflito'
}

export const LIMITE_POR_ARQUIVO = 10 * 1024 * 1024
export const LIMITE_POR_DEMANDA = 100 * 1024 * 1024
export const RETENCAO_DAS_CAPTURAS_MS = 90 * 24 * 60 * 60_000

export const CONTEUDOS_ACEITOS: Record<'anexo' | 'desenho' | 'captura', readonly string[]> = {
  anexo: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'audio/mpeg',
    'audio/mp4',
    'audio/webm',
    'audio/ogg',
  ],
  desenho: ['text/html', 'image/png', 'image/jpeg', 'image/webp'],
  captura: ['image/png', 'image/jpeg', 'image/webp'],
}

export function avaliarArquivo(e: {
  tipo: 'anexo' | 'desenho' | 'captura'
  conteudo: string
  tamanho: number
  usadoNaDemanda: number
}): { ok: true } | { ok: false; status: 413 | 415; erro: string } {
  if (!CONTEUDOS_ACEITOS[e.tipo].includes(e.conteudo)) {
    return { ok: false, status: 415, erro: 'Tipo de arquivo não aceito.' }
  }
  if (e.tamanho > LIMITE_POR_ARQUIVO) {
    return { ok: false, status: 413, erro: 'Arquivo maior que 10 MB.' }
  }
  if (e.usadoNaDemanda + e.tamanho > LIMITE_POR_DEMANDA) {
    return { ok: false, status: 413, erro: 'A demanda passaria de 100 MB.' }
  }
  return { ok: true }
}

export function capturaVencida(
  arquivo: { tipo: string; apagadoEm: Date | null },
  entregueEm: Date | null,
  agora: Date,
): boolean {
  if (arquivo.tipo !== 'captura' || arquivo.apagadoEm || !entregueEm) return false
  return agora.getTime() - entregueEm.getTime() > RETENCAO_DAS_CAPTURAS_MS
}
