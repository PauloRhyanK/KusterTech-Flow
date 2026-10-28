import type { OrigemEvidencia } from '@/modules/ambientes/model'

// Fora dos componentes de cliente: um objeto exportado de um módulo `'use client'` chega vazio ao
// componente de servidor.
export const ORIGEM_DA_EVIDENCIA: Record<OrigemEvidencia, string> = {
  GITHUB_DEPLOYMENT: 'GitHub Deployments',
  ENDPOINT: 'Endpoint de evidência',
  MANUAL: 'Confirmação manual',
}
