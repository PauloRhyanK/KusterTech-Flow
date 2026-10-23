import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', '.next', 'tests/integration/**', 'e2e/**'],
  },
})
