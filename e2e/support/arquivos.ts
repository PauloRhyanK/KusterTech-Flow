import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Arquivos das demandas (desenhos, capturas, anexos) numa pasta temporária, fora do repositório.
// O servidor roda em produção, onde a pasta precisa existir antes da primeira gravação.
export const PASTA_DOS_ARQUIVOS_E2E = join(tmpdir(), 'flow-e2e-arquivos')

export function prepararPastaDosArquivos(): void {
  mkdirSync(PASTA_DOS_ARQUIVOS_E2E, { recursive: true })
}
