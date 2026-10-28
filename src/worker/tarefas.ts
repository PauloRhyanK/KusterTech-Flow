import { log } from '@/lib/log'
import { sincronizarDeployments } from '@/modules/ambientes/deployments'
import { calcularPresencas } from '@/modules/ambientes/presencas'
import { obterFonteGitHub, type FonteGitHub } from '@/modules/github/fonte'
import { INTERVALO_PADRAO_MS, resumirErroParaLog } from '@/modules/github/model'
import { executarCiclo } from '@/modules/github/reconciliacao'
import { tarefaAtualizarFila } from '@/modules/homologacao/fila'
import { detectarRetestes } from '@/modules/homologacao/retestes'
import { executarTarefasGitHub } from '@/modules/homologacao/tarefas-github'
import { calcularComposicoes } from '@/modules/publicacao/composicoes'

export interface TarefaDoWorker {
  nome: string
  executar(agora: Date): Promise<void>
}

export function criarTarefasDoCiclo(d: {
  obterFonte: () => FonteGitHub | null
  intervaloMs: number
}): readonly TarefaDoWorker[] {
  return [
    {
      nome: 'reconciliar-github',
      async executar(agora) {
        const resultado = await executarCiclo(d.obterFonte(), agora, d.intervaloMs)
        if (resultado.catalogo || resultado.repositorios > 0) {
          log.info(
            { tarefa: 'reconciliar-github', ...resultado },
            'ciclo de reconciliação do GitHub',
          )
        }
      },
    },
    {
      nome: 'sincronizar-deployments',
      async executar(agora) {
        const resumo = await sincronizarDeployments(d.obterFonte(), agora, d.intervaloMs)
        if (resumo.repositorios > 0) {
          log.info({ tarefa: 'sincronizar-deployments', ...resumo }, 'deployments sincronizados')
        }
      },
    },
    {
      nome: 'calcular-presencas',
      async executar(agora) {
        const resumo = await calcularPresencas(d.obterFonte(), agora, d.intervaloMs)
        if (resumo.repositorios > 0) {
          log.info({ tarefa: 'calcular-presencas', ...resumo }, 'presenças calculadas')
        }
      },
    },
    tarefaAtualizarFila,
    {
      nome: 'executar-tarefas-github',
      async executar(agora) {
        const resumo = await executarTarefasGitHub(d.obterFonte(), agora)
        if (resumo.concluidas + resumo.adiadas + resumo.falhas > 0) {
          log.info({ tarefa: 'executar-tarefas-github', ...resumo }, 'tarefas no GitHub executadas')
        }
      },
    },
    {
      nome: 'detectar-retestes',
      async executar(agora) {
        const resumo = await detectarRetestes(agora)
        if (resumo.retestes > 0) {
          log.info({ tarefa: 'detectar-retestes', ...resumo }, 'retestes detectados')
        }
      },
    },
    {
      nome: 'calcular-composicoes',
      async executar(agora) {
        const resumo = await calcularComposicoes(d.obterFonte(), agora)
        if (resumo.calculadas + resumo.revogadas + resumo.falhas > 0) {
          log.info({ tarefa: 'calcular-composicoes', ...resumo }, 'composições calculadas')
        }
      },
    },
  ]
}

export const TAREFAS_DO_CICLO: readonly TarefaDoWorker[] = criarTarefasDoCiclo({
  obterFonte: () => obterFonteGitHub(process.env),
  intervaloMs: Number(process.env.GITHUB_INTERVALO_MS) || INTERVALO_PADRAO_MS,
})

export async function executarTarefas(
  tarefas: readonly TarefaDoWorker[],
  agora: Date,
): Promise<{ nome: string; resultado: 'ok' | 'falha' }[]> {
  const resultados: { nome: string; resultado: 'ok' | 'falha' }[] = []
  for (const tarefa of tarefas) {
    try {
      await tarefa.executar(agora)
      resultados.push({ nome: tarefa.nome, resultado: 'ok' })
    } catch (err) {
      log.error({ tarefa: tarefa.nome, erro: resumirErroParaLog(err) }, 'tarefa do worker falhou')
      resultados.push({ nome: tarefa.nome, resultado: 'falha' })
    }
  }
  return resultados
}
