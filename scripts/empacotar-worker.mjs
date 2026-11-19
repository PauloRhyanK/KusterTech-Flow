// Empacota o worker e os scripts de operação em arquivos únicos para a imagem de produção.
// Saída: dist/worker.mjs, dist/scripts/criar-admin.mjs e dist/scripts/importar-cadastro.mjs.
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const raiz = resolve(import.meta.dirname, '..')

await rm(resolve(raiz, 'dist'), { recursive: true, force: true })

await build({
  absWorkingDir: raiz,
  entryPoints: {
    worker: 'src/worker/main.ts',
    'scripts/criar-admin': 'scripts/criar-admin.ts',
    'scripts/importar-cadastro': 'scripts/importar-cadastro.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: { '@': './src' },
  // Módulos nativos ou com arquivos próprios em tempo de execução ficam fora do pacote.
  external: ['@prisma/client', '@node-rs/argon2', 'pg'],
  // Dependências CommonJS empacotadas (ex.: pino) usam `require`.
  banner: {
    js: "import { createRequire as __criarRequire } from 'node:module'; const require = __criarRequire(import.meta.url);",
  },
  logLevel: 'info',
})
