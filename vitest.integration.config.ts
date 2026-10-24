import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/integration/**/*.spec.ts'],
    fileParallelism: false,
    globalSetup: ['./tests/integration/setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
