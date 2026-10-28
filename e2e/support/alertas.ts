import type { APIRequestContext } from '@playwright/test'

// Envia uma notificação ao webhook de alertas; sem token, omite o cabeçalho Authorization.
export async function enviarAlerta(
  request: APIRequestContext,
  token: string | null,
  corpo: unknown,
): Promise<{ status: number; json: unknown }> {
  const resposta = await request.post('/api/alertas', {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    data: corpo,
  })
  return { status: resposta.status(), json: await resposta.json() }
}
