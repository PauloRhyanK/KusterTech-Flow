import fs from 'node:fs'
import path from 'node:path'

// Pasta que o Flow do E2E lê como `/oficina` (OFICINA_DIR no webServer do Playwright).
export const PASTA_DA_OFICINA = path.resolve('e2e', 'resultados', 'oficina')
// Identificador externo da máquina local no E2E (FLOW_MAQUINA_LOCAL).
export const MAQUINA_LOCAL_E2E = 'oficina-e2e'

export type CenarioDaOficina = 'completa' | 'vazia' | 'com-aviso'

const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA
const GB = 1024 ** 3
const MB = 1024 ** 2

function linhas(objetos: unknown[]): string {
  return objetos.map((o) => JSON.stringify(o)).join('\n') + '\n'
}

function metricas(agora: number): string {
  const amostras: unknown[] = []
  // Uma amostra a cada 10 min nos últimos 7 dias, e a mais recente há 30 s.
  for (let t = agora - 7 * DIA + 10 * MIN; t < agora - MIN; t += 10 * MIN) {
    const fase = (t / DIA) * 2 * Math.PI
    amostras.push({
      em: new Date(t).toISOString(),
      memTotalMb: 8192,
      memDisponivelMb: Math.round(4000 + 1500 * Math.sin(fase)),
      swapUsadaMb: 200,
      carga1: 1.2,
      discoUsoPct: 58,
      jobsCi: 0,
      vagas: 5,
      raias: 2,
      cpuUsoPct: 40,
      discoLivreBytes: Math.round((48 + 4 * Math.cos(fase / 3)) * GB),
      discoTotalBytes: 120 * GB,
    })
  }
  amostras.push({
    em: new Date(agora - 30_000).toISOString(),
    memTotalMb: 8192,
    memDisponivelMb: 3277,
    swapUsadaMb: 410,
    carga1: 2.5,
    discoUsoPct: 59,
    jobsCi: 2,
    vagas: 5,
    raias: 2,
    cpuUsoPct: 62,
    discoLivreBytes: 49 * GB,
    discoTotalBytes: 120 * GB,
  })
  return linhas(amostras)
}

function retrato(agora: number): unknown {
  const desde = (ms: number) => new Date(agora - ms).toISOString()
  const rodando = (nome: string, memoriaBytes: number, cpuPct: number, ha: number) => ({
    nome,
    estado: 'rodando',
    codigoDeSaida: null,
    memoriaBytes,
    cpuPct,
    desde: desde(ha),
  })
  return {
    em: desde(30_000),
    ligadaDesde: desde(12 * DIA),
    containers: [
      rodando('flow-web', 212 * MB, 1, 3 * DIA),
      rodando('fabrica-verificacao-a41c', 2.1 * GB, 148, 6 * MIN),
      rodando('flow-postgres', 164 * MB, 0, 3 * DIA),
      {
        nome: 'runner-3-job',
        estado: 'parado',
        codigoDeSaida: 1,
        memoriaBytes: null,
        cpuPct: null,
        desde: desde(HORA),
      },
      rodando('fabrica-verificacao-b7e2', 1.4 * GB, 71, 2 * MIN),
      rodando('flow-worker', 131 * MB, 0, 3 * DIA),
      rodando('runner-1', 96 * MB, 0, 2 * DIA),
      rodando('runner-2', 88 * MB, 0, 2 * DIA),
      rodando('runner-4', 80 * MB, 0, 2 * DIA),
      {
        nome: 'backup-noturno',
        estado: 'parado',
        codigoDeSaida: 0,
        memoriaBytes: null,
        cpuPct: null,
        desde: desde(20 * HORA),
      },
    ],
    servicos: { fabrica: 'ativa', runners: { noAr: 4, ocupados: 2, total: 4 } },
  }
}

function limpezas(agora: number): string {
  return linhas(
    Array.from({ length: 7 }, (_, i) => {
      const ok = i !== 2
      const antes = (46 - i) * GB
      const liberado = ok ? 3.2 * GB : 0
      return {
        // A mais recente há 1 min, para cair em "hoje"; as outras, um dia antes cada.
        em: new Date(agora - MIN - i * DIA).toISOString(),
        ok,
        livreAntesBytes: antes,
        livreDepoisBytes: antes + liberado,
        liberadoBytes: liberado,
      }
    }),
  )
}

function discoPorDono(agora: number): unknown {
  return {
    em: new Date(agora - 20 * MIN).toISOString(),
    donos: [
      { nome: 'docker', bytes: 31 * GB },
      { nome: 'fabrica', bytes: 17 * GB },
      { nome: 'runners', bytes: 11 * GB },
      { nome: 'backups', bytes: 6 * GB },
      { nome: 'outros', bytes: 6 * GB },
    ],
  }
}

// Grava os arquivos da oficina do cenário pedido, com datas relativas a agora.
// 'vazia' é a pasta sem nenhum arquivo, como a oficina não montada.
export function prepararPastaDaOficina(cenario: CenarioDaOficina): string {
  fs.rmSync(PASTA_DA_OFICINA, { recursive: true, force: true })
  fs.mkdirSync(PASTA_DA_OFICINA, { recursive: true })
  if (cenario === 'vazia') return PASTA_DA_OFICINA

  const agora = Date.now()
  const gravar = (nome: string, conteudo: string) =>
    fs.writeFileSync(path.join(PASTA_DA_OFICINA, nome), conteudo)
  gravar('metricas.jsonl', metricas(agora))
  gravar('retrato.json', JSON.stringify(retrato(agora)))
  gravar('limpezas.jsonl', limpezas(agora))
  gravar('disco-por-dono.json', JSON.stringify(discoPorDono(agora)))
  if (cenario === 'com-aviso') {
    gravar(
      'alertas.jsonl',
      linhas([
        {
          em: new Date(agora - 20 * MIN).toISOString(),
          origem: 'oficina',
          tipo: 'backup',
          severidade: 'media',
          mensagem: 'Backup da noite não terminou',
        },
      ]),
    )
  }
  return PASTA_DA_OFICINA
}
