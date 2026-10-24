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
    env: process.env.DATABASE_URL_TEST
      ? { DATABASE_URL: process.env.DATABASE_URL_TEST }
      : undefined,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
