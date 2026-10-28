import {
  mapearCheck,
  mapearComparacao,
  mapearDeployment,
  mapearIssue,
  mapearPullRequest,
  mapearRepositorio,
} from './fonte'
import type { FonteGitHub, RefRepositorio } from './fonte'
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
import instalacoes from './fixtures/instalacoes.json'
import repositorios from './fixtures/repositorios.json'

interface DadosDoRepositorio {
  issues: unknown[]
  pulls: unknown[]
  deployments: { created_at: string; id: number }[]
  statuses: Record<string, unknown[]>
  comparacoes: Record<string, unknown>
}

const POR_REPOSITORIO: Record<string, DadosDoRepositorio> = {
  'kustertech-exemplo/portal': {
    issues: issues_portal,
    pulls: pulls_portal,
    deployments: deployments_portal,
    statuses: statuses_portal,
    comparacoes: comparacoes_portal,
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
  },
  'kustertech-exemplo/app-mobile': {
    issues: issues_app_mobile,
    pulls: pulls_app_mobile,
    deployments: deployments_app_mobile,
    statuses: statuses_app_mobile,
    comparacoes: comparacoes_app_mobile,
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
}

function desdeFiltro<T extends { updated_at: string }>(itens: T[], desde: Date | null): T[] {
  return desde ? itens.filter((i) => new Date(i.updated_at) >= desde) : itens
}

export interface EscritaDaFonte {
  tipo: 'reabrir' | 'criar'
  repositorio: string
  numero: number
}

// `escritas` só existe em memória: as listagens não enxergam o que foi escrito.
export function criarFonteFixtures(
  relogio: () => Date = () => new Date(),
): FonteGitHub & { readonly escritas: readonly EscritaDaFonte[] } {
  const escritas: EscritaDaFonte[] = []
  let contador = 0

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
      return (CHECKS_POR_SHA[sha]?.check_runs ?? []).map(mapearCheck)
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

    async reabrirIssue(repo, numero) {
      const bruto = (dados(repo).issues as { number: number }[]).find((i) => i.number === numero)
      const issue = bruto && mapearIssue({ ...bruto, state: 'open', closed_at: null })
      if (!issue) {
        throw new ErroDeIntegracao('sem-acesso')
      }
      escritas.push({ tipo: 'reabrir', repositorio: repo.nomeCompleto, numero })
      return { ...issue, estado: 'ABERTA', fechadaEm: null, atualizadaEm: relogio() }
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
