import { expect, test, type Page } from '@playwright/test'
import { enviarAlerta } from './support/alertas'
import {
  contarAlertas,
  criarFonteDeAlertasNoBanco,
  criarRecursoNoBanco,
  nomeDeTeste,
} from './support/banco'

async function entrarComoAdmin(page: Page): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL
  const senha = process.env.E2E_ADMIN_SENHA
  if (!email || !senha) {
    throw new Error('E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('token válido cria o alerta (201) e a repetição devolve 200 repetido; a fila mostra uma linha "Recebido 2 vezes" com o recurso', async ({
  page,
  request,
}, testInfo) => {
  const fonte = await criarFonteDeAlertasNoBanco(nomeDeTeste('Fonte webhook'))
  const recurso = await criarRecursoNoBanco({ tipo: 'SERVIDOR', nome: nomeDeTeste('VPS webhook') })
  const titulo = nomeDeTeste('Webhook disco')
  const corpo = {
    chave: `e2e-${testInfo.project.name}-${Date.now()}`,
    titulo,
    severidade: 'alta',
    recurso: recurso.nome,
  }

  const criado = await enviarAlerta(request, fonte.token, corpo)
  expect(criado.status).toBe(201)
  expect(criado.json).toMatchObject({ resultado: 'criado' })
  const repetido = await enviarAlerta(request, fonte.token, corpo)
  expect(repetido.status).toBe(200)
  expect(repetido.json).toMatchObject({ resultado: 'repetido' })

  await entrarComoAdmin(page)
  await page.goto('/infraestrutura/alertas')
  const fila = page.getByRole('list', { name: 'Fila de alertas' })
  const linhas = fila.locator('li', { hasText: titulo })
  await expect(linhas).toHaveCount(1)
  await expect(linhas).toContainText('Recebido 2 vezes')
  await expect(linhas).toContainText(recurso.nome)
})

test('token inválido → 401 e contarAlertas inalterado; corpo sem severidade → 400 com campos ["severidade"]', async ({
  request,
}, testInfo) => {
  const fonte = await criarFonteDeAlertasNoBanco(nomeDeTeste('Fonte webhook inválido'))
  const corpo = {
    chave: `e2e-${testInfo.project.name}-${Date.now()}`,
    titulo: nomeDeTeste('Webhook inválido'),
    severidade: 'alta',
  }
  const antes = await contarAlertas()

  const semToken = await enviarAlerta(request, null, corpo)
  expect(semToken.status).toBe(401)
  expect(semToken.json).toEqual({ erro: 'Token inválido.' })
  const desconhecido = await enviarAlerta(request, 'fa_desconhecido', corpo)
  expect(desconhecido.status).toBe(401)

  const semSeveridade = { chave: corpo.chave, titulo: corpo.titulo }
  const invalido = await enviarAlerta(request, fonte.token, semSeveridade)
  expect(invalido.status).toBe(400)
  expect(invalido.json).toEqual({ erro: 'Corpo inválido.', campos: ['severidade'] })

  expect(await contarAlertas()).toBe(antes)
})
