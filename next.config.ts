import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Nova demanda aceita três anexos de 10 MB (mais o corpo do formulário).
  experimental: { serverActions: { bodySizeLimit: '31mb' } },
  // Imagem enxuta: o servidor sai em .next/standalone com só as dependências usadas.
  output: 'standalone',
  outputFileTracingExcludes: {
    '*': [
      // Dados de exemplo só dos testes; o rastreio os pegaria pelo caminho montado em leitor.ts.
      './src/modules/oficina/exemplos/**',
      // O produto não usa next/image; o sharp só pesaria na imagem.
      'node_modules/.pnpm/@img*/**',
      'node_modules/.pnpm/sharp@*/**',
    ],
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default nextConfig
