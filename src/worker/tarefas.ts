import { log } from '@/lib/log'
import { modulosAtivos, type ModuloId } from '@/lib/modulos'
import { sincronizarExecucoesWarren } from '@/modules/desenvolvimento/sincronizacao'
import { sincronizarDeployments } from '@/modules/ambientes/deployments'
import { calcularPresencas } from '@/modules/ambientes/presencas'
import { obterFonteGitHub, type FonteGitHub } from '@/modules/github/fonte'
import { processarEventosDeWebhook } from '@/modules/github/eventos'
import { processarFilaDePublicacao } from '@/modules/fila-de-publicacao/worker'
import { INTERVALO_PADRAO_MS, resumirErroParaLog } from '@/modules/github/model'
import { executarCiclo } from '@/modules/github/reconciliacao'
import { arquivarConversasResolvidas, limparParciaisDeConversas } from '@/modules/decidir/worker'
import { limparArquivosDeDemandas, marcarPartesSemPublicacao } from '@/modules/demandas/worker'
import { buscarErrosDoGlitchTip } from '@/modules/erros/service'
import { enviarAndamentoDosRelatos, buscarRelatosDosSistemas } from '@/modules/relatos/worker'
import { tarefaAtualizarFila } from '@/modules/homologacao/fila'
import { detectarRetestes } from '@/modules/homologacao/retestes'
import { executarTarefasGitHub } from '@/modules/homologacao/tarefas-github'
import { calcularComposicoes } from '@/modules/publicacao/composicoes'
import { detectarDivergencias } from '@/modules/publicacao/divergencias'

const INTERVALO_DA_LIMPEZA_DE_ARQUIVOS_MS = 60 * 60_000
const INTERVALO_DA_MARCACAO_DE_PARTES_MS = 10 * 60_000
const INTERVALO_DO_ARQUIVAMENTO_MS = 5 * 60_000
const INTERVALO_DA_LEITURA_DO_GLITCHTIP_MS = 2 * 60_000

export interface TarefaDoWorker {
  nome: string
  modulo: ModuloId
  executar(agora: Date): Promise<void>
}

export function criarTarefasDoCiclo(d: {
  obterFonte: () => FonteGitHub | null
  intervaloMs: number
  ativos?: ReadonlySet<ModuloId>
}): readonly TarefaDoWorker[] {
  const ativos = d.ativos ?? modulosAtivos()
  // Em memória do processo: depois de reiniciar, a limpeza roda no primeiro ciclo.
  let ultimaLimpezaDeArquivos: number | null = null
  let ultimaMarcacaoDePartes: number | null = null
  let ultimoArquivamento: number | null = null
  let ultimaLimpezaDeConversas: number | null = null
  let ultimaLeituraDoGlitchTip: number | null = null
  const tarefas: readonly TarefaDoWorker[] = [
    {
      nome: 'processar-eventos-de-webhook',
      modulo: 'github',
      async executar(agora) {
        // Só marca repositórios e catálogo; a reconciliação seguinte lê o estado atual do GitHub.
        const resumo = await processarEventosDeWebhook(agora)
        if (resumo.processados + resumo.falhas + resumo.removidos > 0) {
          log.info({ tarefa: 'processar-eventos-de-webhook', ...resumo }, 'eventos de webhook')
        }
      },
    },
    {
      nome: 'reconciliar-github',
      modulo: 'github',
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
      nome: 'sincronizar-execucoes-warren',
      modulo: 'desenvolvimento',
      async executar(agora) {
        // Os repositórios lidos e as contagens saem no log da própria sincronização.
        await sincronizarExecucoesWarren(d.obterFonte(), agora, d.intervaloMs)
      },
    },
    {
      nome: 'processar-fila-de-publicacao',
      modulo: 'fila-de-publicacao',
      async executar(agora) {
        const { repositorios, ...contagens } = await processarFilaDePublicacao(
          d.obterFonte(),
          agora,
        )
        if (Object.values(contagens).some((n) => n > 0)) {
          log.info(
            { tarefa: 'processar-fila-de-publicacao', repositorios, ...contagens },
            'fila de publicação processada',
          )
        }
      },
    },
    {
      nome: 'sincronizar-deployments',
      modulo: 'ambientes',
      async executar(agora) {
        const resumo = await sincronizarDeployments(d.obterFonte(), agora, d.intervaloMs)
        if (resumo.repositorios > 0) {
          log.info({ tarefa: 'sincronizar-deployments', ...resumo }, 'deployments sincronizados')
        }
      },
    },
    {
      nome: 'calcular-presencas',
      modulo: 'ambientes',
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
      modulo: 'homologacao',
      async executar(agora) {
        const resumo = await executarTarefasGitHub(d.obterFonte(), agora)
        if (resumo.concluidas + resumo.adiadas + resumo.falhas > 0) {
          log.info({ tarefa: 'executar-tarefas-github', ...resumo }, 'tarefas no GitHub executadas')
        }
      },
    },
    {
      nome: 'detectar-retestes',
      modulo: 'homologacao',
      async executar(agora) {
        const resumo = await detectarRetestes(agora)
        if (resumo.retestes > 0) {
          log.info({ tarefa: 'detectar-retestes', ...resumo }, 'retestes detectados')
        }
      },
    },
    {
      nome: 'calcular-composicoes',
      modulo: 'publicacao',
      async executar(agora) {
        const resumo = await calcularComposicoes(d.obterFonte(), agora)
        if (resumo.calculadas + resumo.revogadas + resumo.falhas > 0) {
          log.info({ tarefa: 'calcular-composicoes', ...resumo }, 'composições calculadas')
        }
      },
    },
    {
      nome: 'detectar-divergencias',
      modulo: 'publicacao',
      async executar(agora) {
        const resumo = await detectarDivergencias(agora)
        if (resumo.novas > 0) {
          log.info(
            { tarefa: 'detectar-divergencias', ...resumo },
            'divergências de deploy detectadas',
          )
        }
      },
    },
    {
      nome: 'limpar-arquivos-de-demandas',
      modulo: 'demandas',
      async executar(agora) {
        if (
          ultimaLimpezaDeArquivos !== null &&
          agora.getTime() - ultimaLimpezaDeArquivos < INTERVALO_DA_LIMPEZA_DE_ARQUIVOS_MS
        ) {
          return
        }
        const resumo = await limparArquivosDeDemandas(agora)
        ultimaLimpezaDeArquivos = agora.getTime()
        if (resumo.capturas + resumo.parciais + resumo.anexosDeRelatos > 0) {
          log.info(
            { tarefa: 'limpar-arquivos-de-demandas', ...resumo },
            'arquivos de demandas limpos',
          )
        }
      },
    },
    {
      nome: 'marcar-partes-sem-publicacao',
      modulo: 'demandas',
      async executar(agora) {
        if (
          ultimaMarcacaoDePartes !== null &&
          agora.getTime() - ultimaMarcacaoDePartes < INTERVALO_DA_MARCACAO_DE_PARTES_MS
        ) {
          return
        }
        const marcadas = await marcarPartesSemPublicacao(agora)
        ultimaMarcacaoDePartes = agora.getTime()
        if (marcadas > 0) {
          log.info({ tarefa: 'marcar-partes-sem-publicacao', marcadas }, 'partes sem publicação')
        }
      },
    },
    {
      nome: 'decidir:arquivar',
      modulo: 'decidir',
      async executar(agora) {
        if (
          ultimoArquivamento !== null &&
          agora.getTime() - ultimoArquivamento < INTERVALO_DO_ARQUIVAMENTO_MS
        ) {
          return
        }
        const encerradas = await arquivarConversasResolvidas(agora)
        ultimoArquivamento = agora.getTime()
        let parciais = 0
        if (
          ultimaLimpezaDeConversas === null ||
          agora.getTime() - ultimaLimpezaDeConversas >= INTERVALO_DA_LIMPEZA_DE_ARQUIVOS_MS
        ) {
          parciais = await limparParciaisDeConversas(agora)
          ultimaLimpezaDeConversas = agora.getTime()
        }
        if (encerradas + parciais > 0) {
          log.info(
            { tarefa: 'decidir:arquivar', encerradas, parciais },
            'conversas do Decidir arquivadas',
          )
        }
      },
    },
    {
      nome: 'buscar-erros-do-glitchtip',
      modulo: 'erros',
      async executar(agora) {
        if (
          ultimaLeituraDoGlitchTip !== null &&
          agora.getTime() - ultimaLeituraDoGlitchTip < INTERVALO_DA_LEITURA_DO_GLITCHTIP_MS
        ) {
          return
        }
        ultimaLeituraDoGlitchTip = agora.getTime()
        const resumo = await buscarErrosDoGlitchTip(agora)
        const { projetos, ...contagens } = resumo
        if (Object.values(contagens).some((n) => n > 0)) {
          log.info(
            { tarefa: 'buscar-erros-do-glitchtip', projetos, ...contagens },
            'erros do GlitchTip lidos',
          )
        }
      },
    },
    {
      nome: 'buscar-relatos',
      modulo: 'relatos',
      // A cada tique; a trava de 60 s por sistema é do banco.
      executar: buscarRelatosDosSistemas,
    },
    {
      nome: 'enviar-andamento',
      modulo: 'relatos',
      executar: enviarAndamentoDosRelatos,
    },
  ]
  return tarefas.filter((t) => ativos.has(t.modulo))
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
