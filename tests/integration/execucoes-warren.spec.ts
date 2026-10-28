import { beforeEach, describe, expect, test, vi } from 'vitest'
import { db } from '@/lib/db'
import { sincronizarExecucoesWarren } from '@/modules/desenvolvimento/sincronizacao'
import { ErroDeIntegracao } from '@/modules/github/erros'
import type { FonteGitHub } from '@/modules/github/fonte'
import { criarFonteFixtures } from '@/modules/github/fonte-fixtures'
import { sincronizarCatalogo, sincronizarRepositorio } from '@/modules/github/reconciliacao'
import { criarTarefasDoCiclo, executarTarefas } from '@/worker/tarefas'
import { limparBanco } from './banco-de-teste'

const t0 = new Date('2026-10-21T10:00:00.000Z')
const INTERVALO = 600_000
const MOTIVO_24H = 'Sem sinal desta execução há mais de 24 h; o Warren não informa se ela terminou.'

async function vincular(nome: string, projetoNome: string) {
  const projeto = await db.projeto.create({
    data: { nome: projetoNome, nomeNormalizado: projetoNome.toLowerCase() },
  })
  const repo = await db.repositorioGitHub.findFirstOrThrow({ where: { nomeCompleto: nome } })
  await db.repositorioGitHub.update({
    where: { id: repo.id },
    data: { projetoId: projeto.id, vinculadoEm: t0 },
  })
  await sincronizarRepositorio(criarFonteFixtures(), repo.id, t0)
  return { projeto, repo }
}

async function prepararAutomacao() {
  const fonte = criarFonteFixtures()
  await sincronizarCatalogo(fonte, t0)
  const { repo } = await vincular('kustertech-exemplo/automacao', 'Automação')
  return { fonte, repo }
}

function fonteQueLe(
  alterar: (caminho: string, texto: string | null) => string | null,
): FonteGitHub {
  const base = criarFonteFixtures()
  return {
    ...base,
    async lerArquivo(repo, caminho) {
      return alterar(caminho, await base.lerArquivo(repo, caminho))
    },
  }
}

function fonteQueLanca(erro: unknown): FonteGitHub {
  return {
    ...criarFonteFixtures(),
    lerArquivo: async () => {
      throw erro
    },
  }
}

async function execucoesPorRun() {
  const lista = await db.execucaoAgente.findMany({
    include: { pullRequest: true },
    orderBy: { runId: 'asc' },
  })
  return new Map(lista.map((e) => [e.runId, e]))
}

beforeEach(async () => {
  await limparBanco()
})

describe('sincronizar-execucoes-warren', () => {
  test('automacao: 5 seeds, seedsLinhasInvalidas 1, seedsEncontrado true, 3 execuções: run_exemplo0001 CONCLUIDA (PR #3, seedId EXEM-a001, agente architect-orchestrator, custo "0.912", fonte seeds-e-pull-request, iniciadaEm 2026-10-20T10:00Z); run_exemplo0002 CONCLUIDA (PR #4, custo "0.538"); run_exemplo0003 EXECUTANDO (sem PR, fonte seeds, agente e custo null); nada para run_exemplo0009 nem run_falso999', async () => {
    const { fonte, repo } = await prepararAutomacao()

    const resumo = await sincronizarExecucoesWarren(fonte, t0, INTERVALO)

    expect(resumo).toEqual({ repositorios: 1, execucoes: 3, falhas: 0 })
    const atual = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(atual.seedsEncontrado).toBe(true)
    expect(atual.seedsLinhasInvalidas).toBe(1)
    expect(atual.warrenLidoEm).toEqual(t0)
    expect(atual.warrenFalhaEm).toBeNull()
    expect(await db.seedDoRepositorio.count()).toBe(5)
    const a001 = await db.seedDoRepositorio.findFirstOrThrow({ where: { seedId: 'EXEM-a001' } })
    expect(a001).toMatchObject({
      planoId: 'pl-ex01',
      planoNome: 'Relatórios — plano de exemplo',
      status: 'EM_ANDAMENTO',
      ausenteDesde: null,
    })
    const a004 = await db.seedDoRepositorio.findFirstOrThrow({ where: { seedId: 'EXEM-a004' } })
    expect(a004.bloqueadaPor).toEqual(['EXEM-a003'])

    const porRun = await execucoesPorRun()
    expect([...porRun.keys()]).toEqual(['run_exemplo0001', 'run_exemplo0002', 'run_exemplo0003'])
    const r1 = porRun.get('run_exemplo0001')!
    expect(r1).toMatchObject({
      estado: 'CONCLUIDA',
      seedId: 'EXEM-a001',
      agente: 'architect-orchestrator',
      papel: 'architect-orchestrator',
      fonte: 'seeds-e-pull-request',
      iniciadaEm: new Date('2026-10-20T10:00:00.000Z'),
    })
    expect(r1.custo?.toString()).toBe('0.912')
    expect(r1.pullRequest?.numero).toBe(3)
    const r2 = porRun.get('run_exemplo0002')!
    expect(r2.estado).toBe('CONCLUIDA')
    expect(r2.pullRequest?.numero).toBe(4)
    expect(r2.custo?.toString()).toBe('0.538')
    const r3 = porRun.get('run_exemplo0003')!
    expect(r3).toMatchObject({
      estado: 'EXECUTANDO',
      fonte: 'seeds',
      agente: null,
      custo: null,
      pullRequestId: null,
    })
    expect(porRun.has('run_exemplo0009')).toBe(false)
    expect(porRun.has('run_falso999')).toBe(false)
  })

  test('segunda leitura em agora + intervalo com os mesmos dados: mesmas contagens e ids, atualizadaEm inalterado; leitura em 2026-10-22T09:00:01Z: run_exemplo0003 SEM_DADOS com "Sem sinal desta execução há mais de 24 h; o Warren não informa se ela terminou." e atualizadaEm novo', async () => {
    const { fonte } = await prepararAutomacao()
    await sincronizarExecucoesWarren(fonte, t0, INTERVALO)
    const antes = await execucoesPorRun()

    const t1 = new Date(t0.getTime() + INTERVALO)
    const segundo = await sincronizarExecucoesWarren(fonte, t1, INTERVALO)

    expect(segundo).toEqual({ repositorios: 1, execucoes: 3, falhas: 0 })
    const depois = await execucoesPorRun()
    expect(await db.seedDoRepositorio.count()).toBe(5)
    for (const [runId, e] of antes) {
      expect(depois.get(runId)!.id).toBe(e.id)
      expect(depois.get(runId)!.atualizadaEm).toEqual(e.atualizadaEm)
      expect(depois.get(runId)!.sincronizadaEm).toEqual(t1)
    }

    const t2 = new Date('2026-10-22T09:00:01.000Z')
    await sincronizarExecucoesWarren(fonte, t2, INTERVALO)
    const r3 = (await execucoesPorRun()).get('run_exemplo0003')!
    expect(r3.estado).toBe('SEM_DADOS')
    expect(r3.motivoDoEstado).toBe(MOTIVO_24H)
    expect(r3.atualizadaEm).toEqual(t2)
    expect((await execucoesPorRun()).get('run_exemplo0001')!.atualizadaEm).toEqual(
      antes.get('run_exemplo0001')!.atualizadaEm,
    )
  })

  test('lerArquivo com ErroDeIntegracao rede: seeds e execuções intactos, warrenFalhaMotivo "Não foi possível falar com o GitHub."; Error("token ghs_123") vira "Falha inesperada na sincronização." e nenhuma coluna contém "ghs_"', async () => {
    const { fonte, repo } = await prepararAutomacao()
    await sincronizarExecucoesWarren(fonte, t0, INTERVALO)
    const execucoesAntes = await execucoesPorRun()
    const t1 = new Date(t0.getTime() + INTERVALO)

    const rede = await sincronizarExecucoesWarren(
      fonteQueLanca(new ErroDeIntegracao('rede')),
      t1,
      INTERVALO,
    )

    expect(rede).toEqual({ repositorios: 1, execucoes: 0, falhas: 1 })
    let atual = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(atual.warrenFalhaEm).toEqual(t1)
    expect(atual.warrenFalhaMotivo).toBe('Não foi possível falar com o GitHub.')
    expect(atual.warrenLidoEm).toEqual(t0)
    expect(await db.seedDoRepositorio.count()).toBe(5)
    expect(await execucoesPorRun()).toEqual(execucoesAntes)

    const erroSilencioso = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const t2 = new Date(t1.getTime() + INTERVALO)
    const inesperado = await sincronizarExecucoesWarren(
      fonteQueLanca(new Error('token ghs_123')),
      t2,
      INTERVALO,
    )
    erroSilencioso.mockRestore()

    expect(inesperado.falhas).toBe(1)
    atual = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(atual.warrenFalhaMotivo).toBe('Falha inesperada na sincronização.')
    expect(atual.warrenFalhaEm).toEqual(t2)
    const tudo = JSON.stringify(
      [
        await db.repositorioGitHub.findMany(),
        await db.seedDoRepositorio.findMany(),
        await db.execucaoAgente.findMany(),
      ],
      (_chave, valor: unknown) => (typeof valor === 'bigint' ? valor.toString() : valor),
    )
    expect(tudo).not.toContain('ghs_')
  })

  test('portal vinculado (sem .seeds, PRs humanos): seedsEncontrado false, 0 seeds, 0 execuções', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    const { repo } = await vincular('kustertech-exemplo/portal', 'Portal')

    const resumo = await sincronizarExecucoesWarren(fonte, t0, INTERVALO)

    expect(resumo).toEqual({ repositorios: 1, execucoes: 0, falhas: 0 })
    const atual = await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })
    expect(atual.seedsEncontrado).toBe(false)
    expect(atual.warrenLidoEm).toEqual(t0)
    expect(await db.seedDoRepositorio.count()).toBe(0)
    expect(await db.execucaoAgente.count()).toBe(0)
  })

  test('não vinculado e removido da instalação não são lidos; lido há 5 min com intervalo 10 min não relê; GitHub sincronizado depois da leitura relê', async () => {
    const fonte = criarFonteFixtures()
    await sincronizarCatalogo(fonte, t0)
    const { repo } = await vincular('kustertech-exemplo/automacao', 'Automação')
    const mobile = await vincular('kustertech-exemplo/automacao-mobile', 'Automação mobile')
    await db.repositorioGitHub.update({
      where: { id: mobile.repo.id },
      data: { removidoDaInstalacaoEm: t0 },
    })

    const primeiro = await sincronizarExecucoesWarren(fonte, t0, INTERVALO)

    expect(primeiro.repositorios).toBe(1)
    const lidos = await db.repositorioGitHub.findMany({ where: { warrenLidoEm: { not: null } } })
    expect(lidos.map((r) => r.nomeCompleto)).toEqual(['kustertech-exemplo/automacao'])

    const em5min = new Date(t0.getTime() + 5 * 60_000)
    expect(await sincronizarExecucoesWarren(fonte, em5min, INTERVALO)).toEqual({
      repositorios: 0,
      execucoes: 0,
      falhas: 0,
    })
    expect(
      (await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })).warrenLidoEm,
    ).toEqual(t0)

    await db.repositorioGitHub.update({
      where: { id: repo.id },
      data: { sincronizadoEm: em5min },
    })
    const relido = await sincronizarExecucoesWarren(fonte, em5min, INTERVALO)
    expect(relido.repositorios).toBe(1)
    expect(
      (await db.repositorioGitHub.findUniqueOrThrow({ where: { id: repo.id } })).warrenLidoEm,
    ).toEqual(em5min)
  })

  test('arquivo sem a linha EXEM-a003: seed com ausenteDesde = agora e run_exemplo0003 SEM_DADOS "As fontes não mencionam mais esta execução."; a linha de volta zera ausenteDesde', async () => {
    const { fonte } = await prepararAutomacao()
    await sincronizarExecucoesWarren(fonte, t0, INTERVALO)
    const semA003 = fonteQueLe((caminho, texto) =>
      caminho === '.seeds/issues.jsonl' && texto !== null
        ? texto
            .split('\n')
            .filter((l) => !l.includes('"EXEM-a003"'))
            .join('\n')
        : texto,
    )
    const t1 = new Date(t0.getTime() + INTERVALO)

    await sincronizarExecucoesWarren(semA003, t1, INTERVALO)

    const seed = await db.seedDoRepositorio.findFirstOrThrow({ where: { seedId: 'EXEM-a003' } })
    expect(seed.ausenteDesde).toEqual(t1)
    const r3 = (await execucoesPorRun()).get('run_exemplo0003')!
    expect(r3.estado).toBe('SEM_DADOS')
    expect(r3.motivoDoEstado).toBe('As fontes não mencionam mais esta execução.')

    const t2 = new Date(t1.getTime() + INTERVALO)
    await sincronizarExecucoesWarren(fonte, t2, INTERVALO)

    const volta = await db.seedDoRepositorio.findFirstOrThrow({ where: { seedId: 'EXEM-a003' } })
    expect(volta.ausenteDesde).toBeNull()
    expect((await execucoesPorRun()).get('run_exemplo0003')!.estado).toBe('EXECUTANDO')
  })

  test('sem fonte: nada é lido', async () => {
    await prepararAutomacao()
    expect(await sincronizarExecucoesWarren(null, t0, INTERVALO)).toEqual({
      repositorios: 0,
      execucoes: 0,
      falhas: 0,
    })
    expect(await db.execucaoAgente.count()).toBe(0)
  })

  test('run que já pertence a outro repositório é ignorado', async () => {
    const { fonte } = await prepararAutomacao()
    await sincronizarExecucoesWarren(fonte, t0, INTERVALO)
    const mobile = await vincular('kustertech-exemplo/automacao-mobile', 'Automação mobile')
    const copiaDoRun = fonteQueLe((caminho, texto) =>
      caminho === '.seeds/issues.jsonl' && texto !== null
        ? texto.replaceAll('run_exemplo1003', 'run_exemplo0003')
        : texto,
    )

    await sincronizarExecucoesWarren(copiaDoRun, new Date(t0.getTime() + INTERVALO), INTERVALO)

    const r3 = (await execucoesPorRun()).get('run_exemplo0003')!
    expect(r3.repositorioId).not.toBe(mobile.repo.id)
  })

  test('falha em sincronizar-execucoes-warren não impede as outras tarefas do ciclo', async () => {
    const executadas: string[] = []
    const tarefas = criarTarefasDoCiclo({
      obterFonte: () => {
        throw new Error('segredo ghs_x')
      },
      intervaloMs: INTERVALO,
    })
    const warren = tarefas.find((t) => t.nome === 'sincronizar-execucoes-warren')!
    const erroSilencioso = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const resultado = await executarTarefas(
      [warren, { nome: 'depois', executar: async () => void executadas.push('depois') }],
      t0,
    )
    erroSilencioso.mockRestore()

    expect(resultado).toEqual([
      { nome: 'sincronizar-execucoes-warren', resultado: 'falha' },
      { nome: 'depois', resultado: 'ok' },
    ])
    expect(executadas).toEqual(['depois'])
  })
})
