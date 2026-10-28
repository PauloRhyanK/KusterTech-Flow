import { createHmac } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'

// Segredo só de teste: o webServer do Playwright o recebe em GITHUB_WEBHOOK_SECRET.
export const SEGREDO_DE_WEBHOOK_E2E = 'e2e-segredo-de-webhook-somente-teste'

export function assinarCorpo(corpo: string, segredo = SEGREDO_DE_WEBHOOK_E2E): string {
  return 'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex')
}

// `assinatura` omitida → assina com o segredo de teste; `null` → sem o cabeçalho.
export async function enviarWebhook(
  request: APIRequestContext,
  e: { evento: string; deliveryId: string; corpo: string; assinatura?: string | null },
): Promise<APIResponse> {
  const assinatura = e.assinatura === undefined ? assinarCorpo(e.corpo) : e.assinatura
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-github-event': e.evento,
    'x-github-delivery': e.deliveryId,
  }
  if (assinatura !== null) headers['x-hub-signature-256'] = assinatura
  return request.post('/api/github/webhook', { headers, data: e.corpo })
}
