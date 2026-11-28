// Tarefas do worker do módulo relatos (D83).
import { log } from '@/lib/log'
import { chaveDosSegredos, ErroDeSegredo } from '@/lib/segredos'
import { enfileirarAutomaticos, enviarPendentes } from './andamento'
import { buscarTodos, recuperarAnexosFaltantes } from './busca'

function chaveOuAviso(tarefa: string): Buffer | null {
  try {
    const chave = chaveDosSegredos(process.env)
    if (!chave) log.warn({ tarefa }, 'FLOW_CHAVE_DOS_SEGREDOS ausente; relatos parados')
    return chave
  } catch (err) {
    if (err instanceof ErroDeSegredo) {
      log.warn({ tarefa, motivo: err.message }, 'FLOW_CHAVE_DOS_SEGREDOS inválida; relatos parados')
      return null
    }
    throw err
  }
}

export async function buscarRelatosDosSistemas(agora: Date): Promise<void> {
  const chave = chaveOuAviso('buscar-relatos')
  if (!chave) return
  const resumo = await buscarTodos(agora, { chave })
  if (resumo.novos + resumo.orientados + resumo.sinaisNovos + resumo.falhas > 0) {
    log.info({ tarefa: 'buscar-relatos', ...resumo }, 'relatos buscados')
  }
}

export async function enviarAndamentoDosRelatos(agora: Date): Promise<void> {
  const chave = chaveOuAviso('enviar-andamento')
  if (!chave) return
  const enfileirados = await enfileirarAutomaticos(agora)
  const resumo = await enviarPendentes(agora, { chave })
  if (enfileirados + resumo.enviados + resumo.reagendados + resumo.descartados > 0) {
    log.info({ tarefa: 'enviar-andamento', enfileirados, ...resumo }, 'andamento dos relatos')
  }
}

export async function recuperarAnexosDosRelatos(
  agora: Date,
): Promise<{ copiados: number; falhas: number }> {
  const chave = chaveOuAviso('recuperar-anexos-de-relatos')
  if (!chave) return { copiados: 0, falhas: 0 }
  return recuperarAnexosFaltantes(agora, { chave })
}
