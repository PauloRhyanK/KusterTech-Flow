import { describe, expect, test } from 'vitest'
import { casaGlob, globsSobrepoem } from './globs'

// Casos portados de fabrica/scripts/testes_raias.py (42), mais os da 2.0 no fim.
const CASOS: readonly [
  nome: 'casaGlob' | 'globsSobrepoem',
  a: string,
  b: string,
  esperado: boolean,
][] = [
  ['casaGlob', 'src/a/b.ts', 'src/**', true],
  ['casaGlob', 'src/a/b.ts', 'src/*.ts', false],
  ['casaGlob', 'src/b.ts', 'src/*.ts', true],
  ['casaGlob', 'src/a/b.ts', 'src/a/', true],
  ['casaGlob', 'src/ab/b.ts', 'src/a/', false],
  ['casaGlob', '.env.local', '.env*', true],
  ['casaGlob', 'a.ts', '?.ts', true],
  ['casaGlob', 'ab.ts', '?.ts', false],
  ['casaGlob', 'a/b', 'a?b', false],
  ['casaGlob', 'a.ts', 'a.ts', true],
  ['casaGlob', 'axts', 'a.ts', false],
  ['globsSobrepoem', 'src/clientes/', 'src/clientes/**', true],
  ['globsSobrepoem', 'src/**', 'src/a/x.ts', true],
  ['globsSobrepoem', 'prisma/schema.prisma', 'prisma/', true],
  ['globsSobrepoem', 'src/x/', 'src/x/y.ts', true],
  ['casaGlob', 'src/a.tsx', 'src/*.ts', false],
  ['casaGlob', 'xsrc/a.ts', 'src/*.ts', false],
  ['casaGlob', 'a.ts.bak', 'a.ts', false],
  ['casaGlob', 'xsrc/a/b.ts', 'src/a/', false],
  ['casaGlob', 'src/a/x.ts', 'src/*/', true],
  ['casaGlob', 'src/a/b/x.ts', 'src/*/', true],
  ['casaGlob', 'src/x.ts', 'src/*/', false],
  ['casaGlob', 'src/clientes/x.ts', '**/clientes/', true],
  ['casaGlob', 'a/b/clientes/x.ts', '**/clientes/', true],
  ['casaGlob', 'clientes/x.ts', '**/clientes/', true],
  ['casaGlob', 'src/meus-clientes/x.ts', '**/clientes/', false],
  ['casaGlob', 'src/projetos/x.ts', '**/clientes/', false],
  ['globsSobrepoem', 'src/a/x.ts', 'src/*/', true],
  ['globsSobrepoem', 'src/*/', 'src/a/x.ts', true],
  ['globsSobrepoem', 'src/clientes/x.ts', '**/clientes/', true],
  ['globsSobrepoem', '**/clientes/', 'src/clientes/x.ts', true],
  ['globsSobrepoem', 'src/x.ts', 'src/*/', false],
  ['globsSobrepoem', 'src/projetos/x.ts', '**/clientes/', false],
  ['globsSobrepoem', 'src/x/y/', 'src/x/', true],
  ['globsSobrepoem', 'src/x/', 'src/x/y/', true],
  ['globsSobrepoem', 'src/x/y/**', 'src/x/**', true],
  ['globsSobrepoem', 'src/x/**', 'src/x/y/**', true],
  ['globsSobrepoem', 'src/a?.ts', 'src/ab.ts', true],
  ['globsSobrepoem', 'src/ab.ts', 'src/a?.ts', true],
  ['globsSobrepoem', 'src/a?.ts', 'src/b.ts', false],
  ['globsSobrepoem', 'src/clientes/', 'src/projetos/', false],
  ['globsSobrepoem', 'a.ts', 'b.ts', false],
  ['casaGlob', 'x/auth/y.ts', '**/auth/**', true],
  ['globsSobrepoem', 'src/a/**', 'src/**', true],
  ['globsSobrepoem', 'src/a/**', 'src/b/**', false],
  // revisão independente: o Python percorre por caractere e o `.` dele casa `\r`
  ['casaGlob', 'a😀', 'a?', true],
  ['casaGlob', 'a\rb', 'a**', true],
]

const FUNCOES = { casaGlob, globsSobrepoem }

describe('globs (port do kit)', () => {
  test.each(CASOS)('%s(%j, %j) é %s', (nome, a, b, esperado) => {
    expect(FUNCOES[nome](a, b)).toBe(esperado)
  })
})
