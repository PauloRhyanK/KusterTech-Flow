import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/lib/db'
import { MOTIVOS, verificacaoAtrasada } from '@/modules/fila-de-publicacao/model'
import { commitNoAr, processarFilaDePublicacao } from '@/modules/fila-de-publicacao/worker'
import { ErroDeIntegracao } from '@/modules/github/erros'
import type { ExecucaoDaFonte, FonteGitHub, RefRepositorio } from '@/modules/github/fonte'
import type { CheckDaFonte } from '@/modules/github/model'
import { limparBanco } from './banco-de-teste'

// 12:00 em São Paulo; o lote padrão (22:00 local) é às 01:00Z do dia seguinte.
const AGORA = new Date('2026-11-19T15:00:00.000Z')
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000)
const sha = (n: number) => n.toString(16).padStart(40, '0')
const PORTAL = 'kustertech-exemplo/portal'
const SITE = 'kustertech-exemplo/site'

// M1 ← M2 ← M3 ← M4 ← M5 em main; X1 sai de M1 e nunca entra em main;
// B1 sai de M1 e entra em main pelo merge M6 (pais M5 e B1).
const M1 = sha(0x101)
const M2 = sha(0x102)
const M3 = sha(0x103)
const M4 = sha(0x104)
const M5 = sha(0x105)
const M6 = sha(0x106)
const X1 = sha(0x1f1)
const B1 = sha(0x1b1)
// R1 é o main depois de um push forçado que apagou M3 em diante: R1 ← M2.
const R1 = sha(0x1e1)
// Outro repositório: S1 ← S2.
const S1 = sha(0x201)
const S2 = sha(0x202)

type Metodo = keyof Omit<FonteGitHub, 'tipo'>

interface Disparo {
  repositorio: string
  workflow: string
  ref: string
  entradas: Record<string, string>
}

function criarFonteFalsa() {
  const pais = new Map<string, string[]>([
    [M1, []],
    [M2, [M1]],
    [M3, [M2]],
    [M4, [M3]],
    [M5, [M4]],
    [X1, [M1]],
    [B1, [M1]],
    [M6, [M5, B1]],
    [R1, [M2]],
    [S1, []],
    [S2, [S1]],
  ])
  const cabecas = new Map<string, string>([
    [PORTAL, M4],
    [SITE, S2],
  ])
  const execucoes = new Map<string, ExecucaoDaFonte[]>()
  const checks = new Map<string, CheckDaFonte[]>()
  const logs = new Map<bigint, string>()
  const disparos: Disparo[] = []
  const chamadas: { metodo: Metodo; args: unknown[] }[] = []
  let proximoId = 9000
  let relogio = AGORA
  let falhar: (metodo: Metodo, args: unknown[]) => boolean = () => false
  /** cria: o GitHub cria a execução; perde: cria e a resposta se perde; nada: não cria;
   * recusa: o GitHub recusa o disparo (workflow inexistente) e não cria. */
  let aoDisparar: 'cria' | 'perde' | 'nada' | 'recusa' = 'cria'

  const ancestrais = (c: string): Set<string> => {
    if (!pais.has(c)) throw new ErroDeIntegracao('commit-desconhecido')
    const s = new Set<string>()
    const pendentes = [c]
    while (pendentes.length > 0) {
      const atual = pendentes.pop()!
      if (s.has(atual)) continue
      s.add(atual)
      pendentes.push(...(pais.get(atual) ?? []))
    }
    return s
  }
  const registrar = (metodo: Metodo, args: unknown[]) => {
    chamadas.push({ metodo, args })
    if (falhar(metodo, args)) throw new ErroDeIntegracao('rede')
  }
  const lista = (repo: RefRepositorio) => execucoes.get(repo.nomeCompleto) ?? []
  const naoUsado = async (): Promise<never> => {
    throw new Error('não usado neste teste')
  }

  const fonte: FonteGitHub = {
    tipo: 'fixtures',
    listarRepositorios: naoUsado,
    listarIssuesAtualizadas: naoUsado,
    listarPullRequestsAtualizados: naoUsado,
    listarDeployments: naoUsado,
    lerArquivo: naoUsado,
    reabrirIssue: naoUsado,
    criarIssue: naoUsado,
    lerIssue: naoUsado,
    listarComentariosDaIssue: naoUsado,
    comentarEFecharIssue: naoUsado,
    lerPullRequestParaMerge: naoUsado,
    lerStatusCombinado: naoUsado,
    mergearPullRequest: naoUsado,
    async listarChecks(repo, s) {
      registrar('listarChecks', [repo.nomeCompleto, s])
      return checks.get(s) ?? []
    },
    async compararCommits(repo, base, cabeca) {
      registrar('compararCommits', [repo.nomeCompleto, base, cabeca])
      if (base === cabeca) return { status: 'identical', commits: [], truncada: false }
      const daBase = ancestrais(base)
      const daCabeca = ancestrais(cabeca)
      const commits = [...daCabeca].filter((c) => !daBase.has(c))
      const status = daCabeca.has(base) ? 'ahead' : daBase.has(cabeca) ? 'behind' : 'diverged'
      return { status, commits, truncada: false }
    },
    async lerCabecaDoBranchPadrao(repo) {
      registrar('lerCabecaDoBranchPadrao', [repo.nomeCompleto])
      return { branch: 'main', sha: cabecas.get(repo.nomeCompleto)! }
    },
    async dispararWorkflow(repo, workflow, ref, entradas) {
      registrar('dispararWorkflow', [repo.nomeCompleto, workflow, ref, entradas])
      disparos.push({ repositorio: repo.nomeCompleto, workflow, ref, entradas })
      if (aoDisparar === 'nada') return
      if (aoDisparar === 'recusa') throw new ErroDeIntegracao('sem-acesso')
      const id = BigInt(proximoId++)
      const commit = Object.values(entradas)[0] ?? ''
      execucoes.set(repo.nomeCompleto, [
        {
          id,
          status: 'in_progress',
          conclusao: null,
          urlHtml: `https://github.com/${repo.nomeCompleto}/actions/runs/${id}`,
          titulo: `publicar ${commit}`,
          criadaEm: relogio,
          atualizadaEm: relogio,
        },
        ...lista(repo),
      ])
      if (aoDisparar === 'perde') throw new ErroDeIntegracao('rede')
    },
    async listarExecucoesDoWorkflow(repo, workflow, desde) {
      registrar('listarExecucoesDoWorkflow', [repo.nomeCompleto, workflow, desde])
      return lista(repo).filter((e) => e.criadaEm >= desde)
    },
    async lerExecucao(repo, id) {
      registrar('lerExecucao', [repo.nomeCompleto, id])
      return lista(repo).find((e) => e.id === id) ?? null
    },
    async lerFimDoLog(repo, id, limite) {
      registrar('lerFimDoLog', [repo.nomeCompleto, id, limite])
      return (logs.get(id) ?? '').slice(-limite)
    },
  }

  return {
    fonte,
    disparos,
    chamadas,
    checks,
    logs,
    set relogio(d: Date) {
      relogio = d
    },
    set falhar(f: (metodo: Metodo, args: unknown[]) => boolean) {
      falhar = f
    },
    set aoDisparar(m: 'cria' | 'perde' | 'nada' | 'recusa') {
      aoDisparar = m
    },
    avancarMain(repositorio: string, commit: string) {
      cabecas.set(repositorio, commit)
    },
    execucaoDe(repositorio: string, commit: string) {
      return execucoes.get(repositorio)?.find((e) => e.titulo === `publicar ${commit}`)
    },
    concluir(repositorio: string, commit: string, conclusao: 'success' | 'failure') {
      const e = execucoes.get(repositorio)?.find((x) => x.titulo === `publicar ${commit}`)
      if (!e) throw new Error(`sem execução de ${commit}`)
      e.status = 'completed'
      e.conclusao = conclusao
    },
    remover(repositorio: string, commit: string) {
      execucoes.set(
        repositorio,
        (execucoes.get(repositorio) ?? []).filter((x) => x.titulo !== `publicar ${commit}`),
      )
    },
  }
}

type FonteFalsa = ReturnType<typeof criarFonteFalsa>

let portalId: string
let siteId: string
let usuarioId: string
let f: FonteFalsa

async function criarRepositorio(nome: string, githubId: number) {
  const projeto = await db.projeto.create({
    data: { nome: `Projeto ${githubId}`, nomeNormalizado: `projeto-${githubId}` },
  })
  const repo = await db.repositorioGitHub.create({
    data: {
      githubId: BigInt(githubId),
      instalacaoId: BigInt(900001),
      nomeCompleto: nome,
      urlHtml: `https://github.com/${nome}`,
      privado: false,
      projetoId: projeto.id,
      vinculadoEm: AGORA,
      catalogadoEm: AGORA,
    },
  })
  await db.configuracaoDePublicacao.create({
    data: { repositorioId: repo.id, workflow: 'deploy.yml' },
  })
  return repo.id
}

let sequencia = 0
async function pedir(
  repositorioId: string,
  commit: string | null,
  o: { modo?: 'IMEDIATO' | 'LOTE'; usuario?: boolean; criadoEm?: Date } = {},
) {
  sequencia += 1
  const p = await db.pedidoDePublicacao.create({
    data: {
      repositorioId,
      commit,
      modo: o.modo ?? 'IMEDIATO',
      usuarioId: o.usuario ? usuarioId : null,
      criadoEm: o.criadoEm ?? new Date(AGORA.getTime() - 60_000 + sequencia),
    },
  })
  return p.id
}

const pedido = (id: string) => db.pedidoDePublicacao.findUniqueOrThrow({ where: { id } })
const config = (repositorioId: string) =>
  db.configuracaoDePublicacao.findUniqueOrThrow({ where: { repositorioId } })
const ciclo = (agora: Date = AGORA) => {
  f.relogio = agora
  return processarFilaDePublicacao(f.fonte, agora)
}

/** Publica `commit` no portal do começo ao fim e devolve o id do pedido. */
async function publicar(repositorioId: string, repositorio: string, commit: string, em: Date) {
  const id = await pedir(repositorioId, commit, { criadoEm: new Date(em.getTime() - 1000) })
  await ciclo(em)
  f.concluir(repositorio, commit, 'success')
  await ciclo(new Date(em.getTime() + 60_000))
  expect((await pedido(id)).estado).toBe('PUBLICADO')
  return id
}

beforeEach(async () => {
  await limparBanco()
  sequencia = 0
  f = criarFonteFalsa()
  portalId = await criarRepositorio(PORTAL, 5001)
  siteId = await criarRepositorio(SITE, 5002)
  const usuario = await db.usuario.create({
    data: { email: 'admin-fila@local.test', nome: 'Admin', senhaHash: 'hash' },
  })
  usuarioId = usuario.id
})

afterAll(async () => {
  await db.$disconnect()
})

describe('processarFilaDePublicacao', () => {
  test('primeiro pedido do repositório em main → publicado; vira o no ar', async () => {
    const id = await pedir(portalId, M2)

    const r1 = await ciclo()
    expect(r1.disparados).toBe(1)
    expect(f.disparos).toEqual([
      { repositorio: PORTAL, workflow: 'deploy.yml', ref: 'main', entradas: { commit: M2 } },
    ])
    const publicando = await pedido(id)
    expect(publicando.estado).toBe('PUBLICANDO')
    expect(publicando.disparoTentadoEm).toEqual(AGORA)
    expect(publicando.iniciadoEm).toEqual(AGORA)
    expect(publicando.execucaoId).toBe(f.execucaoDe(PORTAL, M2)!.id)
    expect(publicando.execucaoUrl).toBe(f.execucaoDe(PORTAL, M2)!.urlHtml)

    await ciclo(minutos(1))
    expect((await pedido(id)).estado).toBe('PUBLICANDO')

    f.concluir(PORTAL, M2, 'success')
    const r3 = await ciclo(minutos(2))
    expect(r3.publicados).toBe(1)
    const publicado = await pedido(id)
    expect(publicado.estado).toBe('PUBLICADO')
    expect(publicado.concluidoEm).toEqual(minutos(2))
    expect(await commitNoAr(portalId)).toBe(M2)
  })

  test('commitNoAr ignora publicações anteriores a baseRedefinidaEm', async () => {
    await publicar(portalId, PORTAL, M2, AGORA)
    expect(await commitNoAr(portalId)).toBe(M2)
    await db.configuracaoDePublicacao.update({
      where: { repositorioId: portalId },
      data: { baseRedefinidaEm: minutos(5) },
    })
    expect(await commitNoAr(portalId)).toBeNull()
  })

  test('pedido de base antiga → RECUSADO "base antiga: não contém a última publicação" ainda na fila, sem esperar a vez', async () => {
    await publicar(portalId, PORTAL, M3, AGORA)
    const m4 = await pedir(portalId, M4, { criadoEm: minutos(9) })
    await ciclo(minutos(10))
    expect((await pedido(m4)).estado).toBe('PUBLICANDO')

    // B1 entrou em main pelo merge M6, mas não contém M3 (o no ar).
    f.avancarMain(PORTAL, M6)
    const b1 = await pedir(portalId, B1, { criadoEm: minutos(10) })
    const x1 = await pedir(portalId, X1, { criadoEm: minutos(10) })
    const m1 = await pedir(portalId, M1, { criadoEm: minutos(10) })
    const r = await ciclo(minutos(11))
    expect(r.recusados).toBe(2)
    expect(r.dispensados).toBe(1)

    expect((await pedido(m4)).estado).toBe('PUBLICANDO')
    const antigo = await pedido(b1)
    expect(antigo.estado).toBe('RECUSADO')
    expect(antigo.motivo).toBe('base antiga: não contém a última publicação')
    expect(antigo.concluidoEm).toEqual(minutos(11))
    expect((await pedido(x1)).motivo).toBe(MOTIVOS.foraDeMain)
    expect((await pedido(m1)).estado).toBe('DISPENSADO')
    expect((await pedido(m1)).motivo).toBe(MOTIVOS.jaNoAr)
  })

  test('fusão: três pedidos imediatos na fila → um disparo, do commit mais novo; os outros PUBLICADO com atendidoPorId', async () => {
    const a = await pedir(portalId, M2)
    const b = await pedir(portalId, M4)
    const c = await pedir(portalId, M3)

    await ciclo()
    expect(f.disparos.map((d) => d.entradas.commit)).toEqual([M4])
    expect((await pedido(b)).estado).toBe('PUBLICANDO')
    for (const id of [a, c]) {
      const p = await pedido(id)
      expect(p.estado).toBe('PUBLICANDO')
      expect(p.atendidoPorId).toBe(b)
    }

    f.concluir(PORTAL, M4, 'success')
    const r = await ciclo(minutos(1))
    expect(r.publicados).toBe(1)
    for (const id of [a, c]) {
      const p = await pedido(id)
      expect(p.estado).toBe('PUBLICADO')
      expect(p.atendidoPorId).toBe(b)
    }
    expect((await pedido(b)).estado).toBe('PUBLICADO')
    expect(await commitNoAr(portalId)).toBe(M4)
    expect(f.disparos).toHaveLength(1)
  })

  test('um por vez por repositório e dois projetos em paralelo: dois repositórios disparam no mesmo ciclo; o segundo pedido do mesmo repositório espera o primeiro terminar', async () => {
    const p1 = await pedir(portalId, M2)
    const s1 = await pedir(siteId, S2)
    const r = await ciclo()
    expect(r.repositorios).toBe(2)
    expect(r.disparados).toBe(2)
    expect(f.disparos.map((d) => d.repositorio).sort()).toEqual([PORTAL, SITE])

    const p2 = await pedir(portalId, M3, { criadoEm: minutos(1) })
    await ciclo(minutos(2))
    expect((await pedido(p2)).estado).toBe('NA_FILA')
    expect((await pedido(p2)).atendidoPorId).toBeNull()
    expect(f.disparos).toHaveLength(2)

    f.concluir(PORTAL, M2, 'success')
    await ciclo(minutos(3))
    expect((await pedido(p1)).estado).toBe('PUBLICADO')
    expect((await pedido(p2)).estado).toBe('PUBLICANDO')
    expect(
      f.disparos.filter((d) => d.repositorio === PORTAL).map((d) => d.entradas.commit),
    ).toEqual([M2, M3])
    expect((await pedido(s1)).estado).toBe('PUBLICANDO')
  })

  test('Review Focus 2: disparo aceito e resposta perdida (fonte lança rede depois de registrar) → ciclo seguinte acha a execução pelo commit; fonte.disparos.length === 1', async () => {
    const id = await pedir(portalId, M2)
    f.aoDisparar = 'perde'
    await ciclo()
    const depois = await pedido(id)
    expect(depois.estado).toBe('PUBLICANDO')
    expect(depois.disparoTentadoEm).toEqual(AGORA)

    f.aoDisparar = 'cria'
    await ciclo(minutos(1))
    expect(f.disparos).toHaveLength(1)
    expect((await pedido(id)).execucaoId).toBe(f.execucaoDe(PORTAL, M2)!.id)

    f.concluir(PORTAL, M2, 'success')
    await ciclo(minutos(2))
    expect((await pedido(id)).estado).toBe('PUBLICADO')
    expect(f.disparos).toHaveLength(1)
  })

  test('Review Focus 2: sem execução 10 min depois de disparoTentadoEm → FALHOU "a execução não foi encontrada depois do disparo"; nenhum segundo disparo', async () => {
    const id = await pedir(portalId, M2)
    f.aoDisparar = 'nada'
    await ciclo()
    await ciclo(minutos(5))
    expect((await pedido(id)).estado).toBe('PUBLICANDO')
    const r = await ciclo(minutos(11))
    expect(r.falhas).toBe(1)
    const falhou = await pedido(id)
    expect(falhou.estado).toBe('FALHOU')
    expect(falhou.motivo).toBe(MOTIVOS.execucaoNaoEncontrada)
    expect(f.disparos).toHaveLength(1)
    // A busca olhou desde 1 min antes do disparo.
    const busca = f.chamadas.find((c) => c.metodo === 'listarExecucoesDoWorkflow')
    expect(busca?.args[2]).toEqual(minutos(-1))
  })

  test('execução que some no GitHub → FALHOU "a execução sumiu ou foi cancelada no GitHub"', async () => {
    const id = await pedir(portalId, M2)
    await ciclo()
    f.remover(PORTAL, M2)
    await ciclo(minutos(1))
    const p = await pedido(id)
    expect(p.estado).toBe('FALHOU')
    expect(p.motivo).toBe(MOTIVOS.execucaoSumiu)
  })

  test('GitHub fora ao verificar → pedido continua VERIFICANDO e o ciclo seguinte termina a verificação', async () => {
    const a = await pedir(portalId, M2)
    const b = await pedir(portalId, M3)
    // A comparação entre os dois pedidos (para juntar) falha.
    f.falhar = (m, args) => m === 'compararCommits' && args[1] !== M4 && args[2] !== M4
    await ciclo()
    expect(f.disparos).toHaveLength(0)
    const verificando = await pedido(b)
    expect(verificando.estado).toBe('VERIFICANDO')
    expect(verificando.verificandoDesde).toEqual(AGORA)
    expect((await pedido(a)).estado).toBe('NA_FILA')

    f.falhar = () => false
    await ciclo(minutos(1))
    expect(f.disparos.map((d) => d.entradas.commit)).toEqual([M3])
    expect((await pedido(b)).estado).toBe('PUBLICANDO')
    expect((await pedido(a)).atendidoPorId).toBe(b)
  })

  test('GitHub fora ao ler a cabeça → pedido da vez VERIFICANDO, nada dispara e o outro repositório segue', async () => {
    const a = await pedir(portalId, M2)
    await pedir(siteId, S2)
    f.falhar = (m, args) => m === 'lerCabecaDoBranchPadrao' && args[0] === PORTAL
    await ciclo()
    expect((await pedido(a)).estado).toBe('VERIFICANDO')
    expect(f.disparos.map((d) => d.repositorio)).toEqual([SITE])
  })

  test('GitHub fora desde o primeiro ciclo → VERIFICANDO desde a primeira tentativa; 31 min depois a verificação está atrasada; quando volta, publica', async () => {
    const id = await pedir(portalId, M2)
    f.falhar = () => true
    await ciclo()
    const primeiro = await pedido(id)
    expect(primeiro.estado).toBe('VERIFICANDO')
    expect(primeiro.verificandoDesde).toEqual(AGORA)

    await ciclo(minutos(10))
    await ciclo(minutos(31))
    const atrasado = await pedido(id)
    expect(atrasado.estado).toBe('VERIFICANDO')
    expect(atrasado.verificandoDesde).toEqual(AGORA)
    expect(verificacaoAtrasada(atrasado.verificandoDesde!, minutos(31))).toBe(true)
    expect(f.disparos).toHaveLength(0)

    f.falhar = () => false
    await ciclo(minutos(32))
    expect((await pedido(id)).estado).toBe('PUBLICANDO')
    expect(f.disparos.map((d) => d.entradas.commit)).toEqual([M2])
  })

  test('push forçado em main depois da pré-verificação → o pedido já verificado é RECUSADO "o commit não está em main" antes do disparo', async () => {
    await publicar(portalId, PORTAL, M2, AGORA)
    await db.configuracaoDePublicacao.update({
      where: { repositorioId: portalId },
      data: { pausado: true },
    })
    const id = await pedir(portalId, M3, { criadoEm: minutos(5) })
    await ciclo(minutos(6))
    expect((await pedido(id)).verificadoContra).toBe(M2)

    f.avancarMain(PORTAL, R1)
    await db.configuracaoDePublicacao.update({
      where: { repositorioId: portalId },
      data: { pausado: false },
    })
    const r = await ciclo(minutos(7))
    expect(r.recusados).toBe(1)
    const recusado = await pedido(id)
    expect(recusado.estado).toBe('RECUSADO')
    expect(recusado.motivo).toBe(MOTIVOS.foraDeMain)
    expect(f.disparos).toHaveLength(1)
  })

  test('disparo recusado pelo GitHub → 10 min depois FALHOU e o conserto leva a mensagem do GitHub no trecho do log', async () => {
    const id = await pedir(portalId, M2)
    f.aoDisparar = 'recusa'
    await ciclo()
    expect((await pedido(id)).estado).toBe('PUBLICANDO')
    await ciclo(minutos(11))
    const falhou = await pedido(id)
    expect(falhou.estado).toBe('FALHOU')
    expect(falhou.motivo).toBe(MOTIVOS.execucaoNaoEncontrada)
    const conserto = await db.pedidoDeConserto.findUniqueOrThrow({ where: { pedidoId: id } })
    expect(conserto.trechoDoLog).toContain(MOTIVOS.execucaoNaoEncontrada)
    expect(conserto.trechoDoLog).toContain(new ErroDeIntegracao('sem-acesso').message)
    expect(f.disparos).toHaveLength(1)
  })

  test('falha da execução → FALHOU, fila CONSERTANDO, PedidoDeConserto ABERTO com trecho do log e link; outro repositório segue publicando', async () => {
    const a = await pedir(portalId, M2)
    const b = await pedir(portalId, M3)
    await pedir(siteId, S1)
    await ciclo()
    const execucao = f.execucaoDe(PORTAL, M3)!
    f.logs.set(execucao.id, 'x'.repeat(5000) + 'Error: build quebrou')
    f.concluir(PORTAL, M3, 'failure')
    f.concluir(SITE, S1, 'success')
    await pedir(siteId, S2, { criadoEm: minutos(1) })

    const r = await ciclo(minutos(2))
    expect(r.falhas).toBe(1)
    expect(r.consertosAbertos).toBe(1)
    expect((await pedido(b)).estado).toBe('FALHOU')
    expect((await pedido(a)).estado).toBe('FALHOU')
    const cfg = await config(portalId)
    expect(cfg.situacao).toBe('CONSERTANDO')
    expect(cfg.situacaoDesde).toEqual(minutos(2))
    const conserto = await db.pedidoDeConserto.findUniqueOrThrow({ where: { pedidoId: b } })
    expect(conserto.estado).toBe('ABERTO')
    expect(conserto.commit).toBe(M3)
    expect(conserto.execucaoUrl).toBe(execucao.urlHtml)
    expect(conserto.trechoDoLog).toHaveLength(4000)
    expect(conserto.trechoDoLog.endsWith('Error: build quebrou')).toBe(true)

    // O site seguiu: S1 publicado e S2 disparado.
    expect(f.disparos.filter((d) => d.repositorio === SITE).map((d) => d.entradas.commit)).toEqual([
      S1,
      S2,
    ])

    // Com a fila consertando, um pedido comum do portal não sai.
    await pedir(portalId, M4, { criadoEm: minutos(3) })
    await ciclo(minutos(4))
    expect(f.disparos.filter((d) => d.repositorio === PORTAL)).toHaveLength(1)
  })

  test('log ilegível de vez (job que nunca rodou, logs expirados) → FALHOU e conserto ABERTO sem trecho, sem ficar PUBLICANDO', async () => {
    const id = await pedir(portalId, M2)
    await ciclo()
    const execucao = f.execucaoDe(PORTAL, M2)!
    f.concluir(PORTAL, M2, 'failure')
    f.falhar = (metodo) => metodo === 'lerFimDoLog'

    const r = await ciclo(minutos(2))
    expect(r.falhas).toBe(1)
    expect(r.consertosAbertos).toBe(1)
    expect((await pedido(id)).estado).toBe('FALHOU')
    expect((await config(portalId)).situacao).toBe('CONSERTANDO')
    const conserto = await db.pedidoDeConserto.findUniqueOrThrow({ where: { pedidoId: id } })
    expect(conserto.estado).toBe('ABERTO')
    expect(conserto.execucaoUrl).toBe(execucao.urlHtml)
    expect(conserto.trechoDoLog).toBe('')
  })

  test('falha de novo com a fila consertando → fila PARADO "a publicação seguinte falhou de novo"', async () => {
    await pedir(portalId, M2)
    await ciclo()
    f.concluir(PORTAL, M2, 'failure')
    await ciclo(minutos(1))
    const conserto = await db.pedidoDeConserto.findFirstOrThrow({
      where: { repositorioId: portalId },
    })
    const correcao = await db.pedidoDePublicacao.create({
      data: {
        repositorioId: portalId,
        commit: M3,
        modo: 'IMEDIATO',
        consertoId: conserto.id,
        criadoEm: minutos(2),
      },
    })
    await ciclo(minutos(3))
    expect((await pedido(correcao.id)).estado).toBe('PUBLICANDO')
    f.concluir(PORTAL, M3, 'failure')
    const r = await ciclo(minutos(4))
    expect(r.parados).toBe(1)
    const cfg = await config(portalId)
    expect(cfg.situacao).toBe('PARADO')
    expect(cfg.situacaoMotivo).toBe(MOTIVOS.falhouDeNovo)
  })

  test('conserto ABERTO há 31 min → DESISTIU "a Fábrica não pegou o conserto em 30 min" e fila PARADO', async () => {
    await pedir(portalId, M2)
    await ciclo()
    f.concluir(PORTAL, M2, 'failure')
    await ciclo(minutos(1))
    await ciclo(minutos(30))
    expect((await config(portalId)).situacao).toBe('CONSERTANDO')

    const r = await ciclo(minutos(32))
    expect(r.parados).toBe(1)
    const conserto = await db.pedidoDeConserto.findFirstOrThrow({
      where: { repositorioId: portalId },
    })
    expect(conserto.estado).toBe('DESISTIU')
    expect(conserto.motivo).toBe(MOTIVOS.semFabrica)
    expect(conserto.encerradoEm).toEqual(minutos(32))
    const cfg = await config(portalId)
    expect(cfg.situacao).toBe('PARADO')
    expect(cfg.situacaoMotivo).toBe(MOTIVOS.semFabrica)
  })

  test('lote: pedidos LOTE esperam; na hora do lote, uma publicação só do mais novo, loteEm igual para todos, ultimoLoteEm gravado; o ciclo seguinte não refaz o lote', async () => {
    const a = await pedir(portalId, M2, { modo: 'LOTE' })
    const b = await pedir(portalId, M3, { modo: 'LOTE' })
    await ciclo()
    await ciclo(minutos(60 * 9))
    expect(f.disparos).toHaveLength(0)
    expect((await pedido(a)).estado).toBe('NA_FILA')

    const hora = new Date('2026-11-20T01:00:00.000Z') // 22:00 em São Paulo
    const r = await ciclo(new Date(hora.getTime() + 60_000))
    expect(r.disparados).toBe(1)
    expect(f.disparos.map((d) => d.entradas.commit)).toEqual([M3])
    for (const id of [a, b]) expect((await pedido(id)).loteEm).toEqual(hora)
    expect((await pedido(a)).atendidoPorId).toBe(b)
    expect((await config(portalId)).ultimoLoteEm).toEqual(hora)

    f.concluir(PORTAL, M3, 'success')
    await ciclo(new Date(hora.getTime() + 2 * 60_000))
    const c = await pedir(portalId, M4, {
      modo: 'LOTE',
      criadoEm: new Date(hora.getTime() + 3 * 60_000),
    })
    await ciclo(new Date(hora.getTime() + 4 * 60_000))
    expect(f.disparos).toHaveLength(1)
    expect((await pedido(c)).estado).toBe('NA_FILA')
  })

  test('pausado ou pausa geral → nada dispara, mas pedidos continuam entrando e sendo pré-verificados', async () => {
    await publicar(portalId, PORTAL, M2, AGORA)
    await db.configuracaoDePublicacao.update({
      where: { repositorioId: portalId },
      data: { pausado: true },
    })
    const bom = await pedir(portalId, M3, { criadoEm: minutos(5) })
    const fora = await pedir(portalId, X1, { criadoEm: minutos(5) })
    await ciclo(minutos(6))
    expect(f.disparos).toHaveLength(1)
    expect((await pedido(bom)).estado).toBe('NA_FILA')
    expect((await pedido(bom)).verificadoContra).toBe(M2)
    expect((await pedido(fora)).estado).toBe('RECUSADO')

    await db.configuracaoDePublicacao.update({
      where: { repositorioId: portalId },
      data: { pausado: false },
    })
    await db.pausaGeralDePublicacao.create({ data: { id: 1, pausadaEm: minutos(6) } })
    const s = await pedir(siteId, S1, { criadoEm: minutos(6) })
    await ciclo(minutos(7))
    expect(f.disparos).toHaveLength(1)
    expect((await pedido(s)).verificadoContra).toBe('inicio')

    await db.pausaGeralDePublicacao.update({ where: { id: 1 }, data: { pausadaEm: null } })
    await ciclo(minutos(8))
    expect(f.disparos.map((d) => d.entradas.commit).sort()).toEqual([M2, M3, S1].sort())
  })

  test('automatico false → pedido da fonte espera; pedido do usuário publica e atende os anteriores', async () => {
    await db.configuracaoDePublicacao.update({
      where: { repositorioId: portalId },
      data: { automatico: false },
    })
    const daFonte = await pedir(portalId, M2)
    await ciclo()
    expect(f.disparos).toHaveLength(0)

    const doUsuario = await pedir(portalId, M3, { usuario: true, criadoEm: minutos(1) })
    await ciclo(minutos(2))
    expect(f.disparos.map((d) => d.entradas.commit)).toEqual([M3])
    expect((await pedido(doUsuario)).estado).toBe('PUBLICANDO')
    expect((await pedido(daFonte)).atendidoPorId).toBe(doUsuario)
  })

  test('checks do commit gravados (SUCESSO/FALHA/SEM_CHECKS) e FALHA não impede publicar', async () => {
    f.checks.set(M2, [{ status: 'completed', conclusao: 'success' }])
    f.checks.set(M3, [{ status: 'completed', conclusao: 'failure' }])
    f.checks.set(S1, [{ status: 'in_progress', conclusao: null }])
    const a = await pedir(portalId, M2)
    const b = await pedir(portalId, M3)
    const c = await pedir(portalId, M4)
    const s = await pedir(siteId, S1)
    await db.configuracaoDePublicacao.update({
      where: { repositorioId: portalId },
      data: { automatico: false },
    })
    await ciclo()
    expect((await pedido(a)).checks).toBe('SUCESSO')
    expect((await pedido(b)).checks).toBe('FALHA')
    expect((await pedido(c)).checks).toBe('SEM_CHECKS')
    expect((await pedido(s)).checks).toBe('PENDENTE')

    // PENDENTE é relido; SUCESSO não.
    f.checks.set(S1, [{ status: 'completed', conclusao: 'success' }])
    const antes = f.chamadas.filter((x) => x.metodo === 'listarChecks').length
    await ciclo(minutos(1))
    expect((await pedido(s)).checks).toBe('SUCESSO')
    const lidas = f.chamadas.filter((x) => x.metodo === 'listarChecks').length - antes
    expect(lidas).toBe(1)

    // FALHA não impede publicar.
    await db.pedidoDePublicacao.deleteMany({ where: { id: { in: [a, c] } } })
    await db.configuracaoDePublicacao.update({
      where: { repositorioId: portalId },
      data: { automatico: true },
    })
    await ciclo(minutos(2))
    expect((await pedido(b)).estado).toBe('PUBLICANDO')
  })

  test('repositório desvinculado do projeto → pendentes CANCELADO "o repositório saiu do projeto"', async () => {
    const a = await pedir(portalId, M2)
    const b = await pedir(portalId, null)
    await db.repositorioGitHub.update({ where: { id: portalId }, data: { projetoId: null } })
    await ciclo()
    for (const id of [a, b]) {
      const p = await pedido(id)
      expect(p.estado).toBe('CANCELADO')
      expect(p.motivo).toBe(MOTIVOS.repositorioDesvinculado)
      expect(p.concluidoEm).toEqual(AGORA)
    }
    expect(f.disparos).toHaveLength(0)
  })

  test('commit null (Publicar agora) → resolvido para a cabeça de main antes da verificação', async () => {
    const id = await pedir(portalId, null, { usuario: true })
    await ciclo()
    const p = await pedido(id)
    expect(p.commit).toBe(M4)
    expect(p.estado).toBe('PUBLICANDO')
    expect(f.disparos.map((d) => d.entradas.commit)).toEqual([M4])
  })

  test('sem fonte → nada do GitHub roda, sem erro', async () => {
    const id = await pedir(portalId, M2)
    const r = await processarFilaDePublicacao(null, AGORA)
    expect(r.disparados).toBe(0)
    expect((await pedido(id)).estado).toBe('NA_FILA')
  })
})
