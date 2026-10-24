import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    passWithNoTests: true,
    reporters: ['verbose'],
    projects: [
      {
        resolve: {
          alias,
        },
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['node_modules', '.next', 'tests/integration/**', 'e2e/**'],
          environment: 'node',
        },
      },
      {
        resolve: {
          alias,
        },
        test: {
          name: 'componentes',
          include: ['src/**/*.test.tsx'],
          exclude: ['node_modules', '.next', 'tests/integration/**', 'e2e/**'],
          environment: 'jsdom',
          setupFiles: ['./tests/support/testing-library.ts'],
        },
      },
    ],
  },
})
