import {
  mapearCheck,
  mapearComparacao,
  mapearDeployment,
  mapearExecucao,
  mapearIssue,
  mapearPullParaMerge,
  mapearPullRequest,
  mapearStatusCombinado,
  mapearRepositorio,
} from './fonte'
import type { ExecucaoDaFonte, FonteGitHub, RefRepositorio } from './fonte'
import { ErroDeIntegracao } from './erros'
import checks1a from './fixtures/checks/1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'
import checks1b from './fixtures/checks/1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'
import checks2a from './fixtures/checks/2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'
import checks2b from './fixtures/checks/2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'
import checks3a from './fixtures/checks/3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'
import checks3b from './fixtures/checks/3bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'
import checks4a from './fixtures/checks/4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'
import checks4b from './fixtures/checks/4bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'
import issues_portal from './fixtures/kustertech-exemplo__portal/issues.json'
import pulls_portal from './fixtures/kustertech-exemplo__portal/pulls.json'
import deployments_portal from './fixtures/kustertech-exemplo__portal/deployments.json'
import statuses_portal from './fixtures/kustertech-exemplo__portal/deployment-statuses.json'
import comparacoes_portal from './fixtures/kustertech-exemplo__portal/comparacoes.json'
import decidir_portal from './fixtures/kustertech-exemplo__portal/decidir.json'
import cabeca_portal from './fixtures/kustertech-exemplo__portal/cabeca.json'
import execucoes_portal from './fixtures/kustertech-exemplo__portal/execucoes.json'
import logs_portal from './fixtures/kustertech-exemplo__portal/logs.json'
import cabeca_site from './fixtures/kustertech-exemplo__site/cabeca.json'
import execucoes_site from './fixtures/kustertech-exemplo__site/execucoes.json'
import logs_site from './fixtures/kustertech-exemplo__site/logs.json'
import issues_api from './fixtures/kustertech-exemplo__api/issues.json'
import pulls_api from './fixtures/kustertech-exemplo__api/pulls.json'
import deployments_api from './fixtures/kustertech-exemplo__api/deployments.json'
import statuses_api from './fixtures/kustertech-exemplo__api/deployment-statuses.json'
import comparacoes_api from './fixtures/kustertech-exemplo__api/comparacoes.json'
import issues_site from './fixtures/kustertech-exemplo__site/issues.json'
import pulls_site from './fixtures/kustertech-exemplo__site/pulls.json'
import deployments_site from './fixtures/kustertech-exemplo__site/deployments.json'
import statuses_site from './fixtures/kustertech-exemplo__site/deployment-statuses.json'
import comparacoes_site from './fixtures/kustertech-exemplo__site/comparacoes.json'
import issues_app_mobile from './fixtures/kustertech-exemplo__app-mobile/issues.json'
import pulls_app_mobile from './fixtures/kustertech-exemplo__app-mobile/pulls.json'
import deployments_app_mobile from './fixtures/kustertech-exemplo__app-mobile/deployments.json'
import statuses_app_mobile from './fixtures/kustertech-exemplo__app-mobile/deployment-statuses.json'
import comparacoes_app_mobile from './fixtures/kustertech-exemplo__app-mobile/comparacoes.json'
import checks5a from './fixtures/checks/5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'
import checks5b from './fixtures/checks/5bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'
import checks6a from './fixtures/checks/6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'
import checks6b from './fixtures/checks/6bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'
import issues_automacao from './fixtures/kustertech-exemplo__automacao/issues.json'
import pulls_automacao from './fixtures/kustertech-exemplo__automacao/pulls.json'
import deployments_automacao from './fixtures/kustertech-exemplo__automacao/deployments.json'
import statuses_automacao from './fixtures/kustertech-exemplo__automacao/deployment-statuses.json'
import comparacoes_automacao from './fixtures/kustertech-exemplo__automacao/comparacoes.json'
import issues_automacao_mobile from './fixtures/kustertech-exemplo__automacao-mobile/issues.json'
import pulls_automacao_mobile from './fixtures/kustertech-exemplo__automacao-mobile/pulls.json'
import deployments_automacao_mobile from './fixtures/kustertech-exemplo__automacao-mobile/deployments.json'
import statuses_automacao_mobile from './fixtures/kustertech-exemplo__automacao-mobile/deployment-statuses.json'
import comparacoes_automacao_mobile from './fixtures/kustertech-exemplo__automacao-mobile/comparacoes.json'
import { ARQUIVOS, BINARIOS } from './fixtures/arquivos'
import instalacoes from './fixtures/instalacoes.json'
import repositorios from './fixtures/repositorios.json'

interface DadosDoRepositorio {
  issues: unknown[]
  pulls: unknown[]
  deployments: { created_at: string; id: number }[]
  statuses: Record<string, unknown[]>
  comparacoes: Record<string, unknown>
  cabeca?: { branch: string; sha: string }
  execucoes?: unknown[]
  logs?: Record<string, string>
}

const POR_REPOSITORIO: Record<string, DadosDoRepositorio> = {
  'kustertech-exemplo/portal': {
    issues: issues_portal,
    pulls: pulls_portal,
    deployments: deployments_portal,
    statuses: statuses_portal,
    comparacoes: comparacoes_portal,
    cabeca: cabeca_portal,
    execucoes: execucoes_portal,
    logs: logs_portal,
  },
  'kustertech-exemplo/api': {
    issues: issues_api,
    pulls: pulls_api,
    deployments: deployments_api,
    statuses: statuses_api,
    comparacoes: comparacoes_api,
  },
  'kustertech-exemplo/site': {
    issues: issues_site,
    pulls: pulls_site,
    deployments: deployments_site,
    statuses: statuses_site,
    comparacoes: comparacoes_site,
    cabeca: cabeca_site,
    execucoes: execucoes_site,
    logs: logs_site,
  },
  'kustertech-exemplo/app-mobile': {
    issues: issues_app_mobile,
    pulls: pulls_app_mobile,
    deployments: deployments_app_mobile,
    statuses: statuses_app_mobile,
    comparacoes: comparacoes_app_mobile,
  },
  'kustertech-exemplo/automacao': {
    issues: issues_automacao,
    pulls: pulls_automacao,
    deployments: deployments_automacao,
    statuses: statuses_automacao,
    comparacoes: comparacoes_automacao,
  },
  'kustertech-exemplo/automacao-mobile': {
    issues: issues_automacao_mobile,
    pulls: pulls_automacao_mobile,
    deployments: deployments_automacao_mobile,
    statuses: statuses_automacao_mobile,
    comparacoes: comparacoes_automacao_mobile,
  },
}

const CHECKS_POR_SHA: Record<string, { check_runs: unknown[] }> = {
  '1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': checks1a,
  '1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': checks1b,
  '2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': checks2a,
  '2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': checks2b,
  '3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': checks3a,
  '3bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': checks3b,
  '4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': checks4a,
  '4bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': checks4b,
  '5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': checks5a,
  '5bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': checks5b,
  '6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': checks6a,
  '6bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': checks6b,
}

function desdeFiltro<T extends { updated_at: string }>(itens: T[], desde: Date | null): T[] {
  return desde ? itens.filter((i) => new Date(i.updated_at) >= desde) : itens
}

export type EscritaDaFonte =
  | {
      tipo: 'reabrir' | 'criar' | 'comentar' | 'fechar' | 'mergear'
      repositorio: string
      numero: number
    }
  | { tipo: 'disparar'; repositorio: string; workflow: string; commit: string }

export interface ExecucaoRegistrada {
  id: bigint
  commit: string
  status: string
  conclusao: string | null
}

// `escritas` só existe em memória: as listagens não enxergam o que foi escrito.
// As execuções e os logs vêm das fixtures e não dependem de `desde` nem do disparo: o resultado é
// o mesmo em qualquer ordem de chamadas. Os testes mudam o cenário com `registrarExecucao`/`registrarLog`.
export function criarFonteFixtures(relogio: () => Date = () => new Date()): FonteGitHub & {
  readonly escritas: readonly EscritaDaFonte[]
  registrarExecucao(repositorio: string, execucao: ExecucaoRegistrada): void
  registrarLog(repositorio: string, execucaoId: bigint, texto: string): void
  /** Um comentário que já está na issue (postado antes de o processo cair). */
  registrarComentario(repositorio: string, numero: number, corpo: string): void
} {
  const escritas: EscritaDaFonte[] = []
  const decidir = decidir_portal as unknown as {
    issues: { number: number }[]
    pulls: { pull: { number: number; head: { sha: string } }; files: unknown[] }[]
    checks: Record<string, unknown[]>
  }
  const pullDaFixture = (repo: RefRepositorio, numero: number) => {
    dados(repo)
    return repo.nomeCompleto === 'kustertech-exemplo/portal'
      ? decidir.pulls.find((p) => p.pull.number === numero)
      : undefined
  }
  const extras = new Map<string, ExecucaoDaFonte[]>()
  const logsExtras = new Map<string, string>()
  const comentarios = new Map<string, string[]>()
  const comentar = (repositorio: string, numero: number, corpo: string) => {
    const chave = `${repositorio}#${numero}`
    comentarios.set(chave, [...(comentarios.get(chave) ?? []), corpo])
  }
  let contador = 0

  const execucoesDe = (repo: RefRepositorio): ExecucaoDaFonte[] => [
    ...(extras.get(repo.nomeCompleto) ?? []),
    ...(dados(repo).execucoes ?? []).map(mapearExecucao),
  ]

  const dados = (repo: RefRepositorio) => {
    const d = POR_REPOSITORIO[repo.nomeCompleto]
    if (!d) {
      throw new ErroDeIntegracao('sem-acesso')
    }
    return d
  }

  return {
    tipo: 'fixtures',
    escritas,
    registrarExecucao(repositorio, e) {
      const agora = relogio().toISOString()
      const execucao = mapearExecucao({
        id: Number(e.id),
        status: e.status,
        conclusion: e.conclusao,
        html_url: `https://github.com/${repositorio}/actions/runs/${e.id}`,
        display_title: `publicar ${e.commit}`,
        created_at: agora,
        updated_at: agora,
      })
      extras.set(repositorio, [execucao, ...(extras.get(repositorio) ?? [])])
    },
    registrarLog(repositorio, execucaoId, texto) {
      logsExtras.set(`${repositorio}#${execucaoId}`, texto)
    },
    registrarComentario(repositorio, numero, corpo) {
      comentar(repositorio, numero, corpo)
    },
    async listarRepositorios() {
      const instalacaoId = BigInt(instalacoes[0]!.id)
      return repositorios.repositories.map((r) => mapearRepositorio(r, instalacaoId))
    },
    async listarIssuesAtualizadas(repo, desde) {
      const itens = dados(repo).issues as { updated_at: string }[]
      return desdeFiltro(itens, desde).flatMap((b) => mapearIssue(b) ?? [])
    },
    async listarPullRequestsAtualizados(repo, desde) {
      const itens = dados(repo).pulls as { updated_at: string }[]
      return desdeFiltro(itens, desde).map(mapearPullRequest)
    },
    async listarChecks(repo, sha) {
      dados(repo)
      const brutos = CHECKS_POR_SHA[sha]?.check_runs ?? decidir.checks[sha] ?? []
      return brutos.map(mapearCheck)
    },
    async listarDeployments(repo, desde) {
      const d = dados(repo)
      return d.deployments
        .filter((x) => desde === null || new Date(x.created_at) >= desde)
        .map((x) => mapearDeployment(x, d.statuses[String(x.id)]?.[0] ?? null))
    },
    async compararCommits(repo, base, cabeca) {
      const d = dados(repo)
      if (base === cabeca) {
        return { status: 'identical', commits: [], truncada: false }
      }
      const bruto = d.comparacoes[`${base}...${cabeca}`]
      if (bruto === undefined) {
        throw new ErroDeIntegracao('commit-desconhecido')
      }
      return mapearComparacao(bruto)
    },
    async lerArquivo(repo, caminho) {
      dados(repo)
      return ARQUIVOS[repo.nomeCompleto]?.[caminho] ?? null
    },
    async lerArquivoBinario(repo, caminho) {
      dados(repo)
      const texto = BINARIOS[repo.nomeCompleto]?.[caminho]
      return texto === undefined ? null : new TextEncoder().encode(texto)
    },
    async lerCabecaDoBranchPadrao(repo) {
      const cabeca = dados(repo).cabeca
      if (!cabeca) {
        throw new ErroDeIntegracao('sem-acesso')
      }
      return { ...cabeca }
    },
    async dispararWorkflow(repo, workflow, _ref, entradas) {
      dados(repo)
      escritas.push({
        tipo: 'disparar',
        repositorio: repo.nomeCompleto,
        workflow,
        commit: entradas.commit ?? '',
      })
    },
    async listarExecucoesDoWorkflow(repo) {
      return execucoesDe(repo)
    },
    async lerExecucao(repo, id) {
      return execucoesDe(repo).find((e) => e.id === id) ?? null
    },
    async lerFimDoLog(repo, execucaoId, limite) {
      const texto =
        logsExtras.get(`${repo.nomeCompleto}#${execucaoId}`) ??
        (dados(repo).logs as Record<string, string> | undefined)?.[String(execucaoId)] ??
        ''
      return limite > 0 ? texto.slice(-limite) : ''
    },

    async reabrirIssue(repo, numero) {
      const bruto = (dados(repo).issues as { number: number }[]).find((i) => i.number === numero)
      const issue = bruto && mapearIssue({ ...bruto, state: 'open', closed_at: null })
      if (!issue) {
        throw new ErroDeIntegracao('sem-acesso')
      }
      escritas.push({ tipo: 'reabrir', repositorio: repo.nomeCompleto, numero })
      return { ...issue, estado: 'ABERTA', fechadaEm: null, atualizadaEm: relogio() }
    },
    async lerIssue(repo, numero) {
      const d = dados(repo)
      const bruto =
        (d.issues as { number: number }[]).find((i) => i.number === numero) ??
        (repo.nomeCompleto === 'kustertech-exemplo/portal'
          ? decidir.issues.find((i) => i.number === numero)
          : undefined)
      return bruto ? mapearIssue(bruto) : null
    },
    async listarComentariosDaIssue(repo, numero) {
      dados(repo)
      return (comentarios.get(`${repo.nomeCompleto}#${numero}`) ?? []).map((corpo, i) => ({
        id: BigInt(i + 1),
        corpo,
      }))
    },
    async comentarEFecharIssue(repo, numero, comentario, opcoes) {
      dados(repo)
      if (!opcoes.jaComentado) {
        escritas.push({ tipo: 'comentar', repositorio: repo.nomeCompleto, numero })
        comentar(repo.nomeCompleto, numero, comentario)
      }
      if (numero === 4999) {
        throw new ErroDeIntegracao('rede', undefined, { comentado: true })
      }
      escritas.push({ tipo: 'fechar', repositorio: repo.nomeCompleto, numero })
      return { comentado: true, fechada: true }
    },
    async lerPullRequestParaMerge(repo, numero) {
      const p = pullDaFixture(repo, numero)
      return p ? mapearPullParaMerge(p.pull, p.files) : null
    },
    async lerStatusCombinado(repo) {
      dados(repo)
      return mapearStatusCombinado({ state: 'success', total_count: 0 })
    },
    async mergearPullRequest(repo, numero, head) {
      const p = pullDaFixture(repo, numero)
      if (!p) {
        throw new ErroDeIntegracao('sem-acesso')
      }
      if (numero === 4998) {
        throw new ErroDeIntegracao('sem-permissao')
      }
      if (p.pull.head.sha !== head) {
        return { resultado: 'recusado', motivo: 'head_mudou' }
      }
      escritas.push({ tipo: 'mergear', repositorio: repo.nomeCompleto, numero })
      return { resultado: 'mergeado' }
    },
    async criarIssue(repo) {
      dados(repo)
      const agora = relogio()
      const numero = 100_000 + (Math.floor(agora.getTime() / 1000) % 800_000) + contador
      contador += 1
      escritas.push({ tipo: 'criar', repositorio: repo.nomeCompleto, numero })
      return {
        numero,
        githubId: repo.githubId * BigInt(1_000_000) + BigInt(numero),
        urlHtml: `https://github.com/${repo.nomeCompleto}/issues/${numero}`,
      }
    },
  }
}
