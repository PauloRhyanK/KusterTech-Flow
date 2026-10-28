import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { enviarAlerta } from './support/alertas'
import {
  contarAlertas,
  criarFonteDeAlertasNoBanco,
  criarProjetoNoBanco,
  criarRecursoNoBanco,
  liberarRepositoriosNoBanco,
  nomeDeTeste,
  obterAlertasPorChaveNoBanco,
  repositoriosDoProjetoE2E,
  vincularNoBanco,
} from './support/banco'

function obterAdmin(): { email: string; senha: string } {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_SENHA: senha } = process.env
  if (!email || !senha) {
    throw new Error('E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

async function entrarComoAdmin(page: Page): Promise<void> {
  const { email, senha } = obterAdmin()
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function capturar(page: Page, projeto: string, nomeArquivo: string): Promise<void> {
  const caminho = path.join('e2e', 'capturas', projeto, nomeArquivo)
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  await page.screenshot({ path: caminho, fullPage: true })
}

async function semRolagemHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
}

test.beforeEach(async ({}, testInfo) => {
  await liberarRepositoriosNoBanco(repositoriosDoProjetoE2E(testInfo.project.name))
})

test('Jornada D: alerta no projeto, mesmo registro na Infraestrutura, recurso, servidor e reconhecer ≠ resolver', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000)
  const projeto = testInfo.project.name
  const mobile = projeto === 'mobile'
  const [repoUm] = repositoriosDoProjetoE2E(projeto)

  const p1 = await criarProjetoNoBanco(nomeDeTeste('Projeto D1'))
  const p2 = await criarProjetoNoBanco(nomeDeTeste('Projeto D2'))
  await vincularNoBanco(p1.id, repoUm)
  const vps = await criarRecursoNoBanco({
    tipo: 'SERVIDOR',
    nome: nomeDeTeste('VPS'),
    urlBeszel: 'https://beszel.exemplo.test/vps',
  })
  const container = await criarRecursoNoBanco({
    tipo: 'CONTAINER',
    nome: nomeDeTeste('Container D'),
    hospedadoEmId: vps.id,
    urlGlitchTip: 'https://glitchtip.exemplo.test/app',
    urlHostDocker: 'https://docker.exemplo.test/app',
    projetosIds: [p1.id, p2.id],
  })
  const nomeDaFonte = nomeDeTeste('Fonte Jornada D')
  const fonte = await criarFonteDeAlertasNoBanco(nomeDaFonte)
  const titulo = nomeDeTeste('Alerta Jornada D')
  const corpo = {
    chave: `jornada-d-${projeto}-${Date.now()}`,
    titulo,
    severidade: 'alta',
    recurso: container.nome,
  }

  const visitar = async (url: string) => {
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    if (mobile) expect(await semRolagemHorizontal(page)).toBe(true)
  }
  const linkDoAlerta = (alertaId: string) =>
    page
      .getByRole('link', { name: titulo })
      .and(page.locator(`[href="/infraestrutura/alertas/${alertaId}"]`))

  let alertaId = ''

  await test.step('1. O webhook registra o alerta (201)', async () => {
    const r = await enviarAlerta(request, fonte.token, corpo)
    expect(r.status).toBe(201)
    expect(r.json).toMatchObject({ resultado: 'criado' })
    alertaId = (r.json as { alertaId: string }).alertaId
    expect(alertaId).not.toBe('')
  })

  await entrarComoAdmin(page)

  await test.step('2. Resumo de P1 → Saúde → Ver saúde e erros lista o alerta', async () => {
    await visitar(`/projetos/${p1.id}`)
    const secao = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: 'Saúde' }),
    })
    await expect(secao.getByText('1 alerta não resolvido')).toBeVisible()
    await secao.getByRole('link', { name: 'Ver saúde e erros' }).click()
    await expect(page).toHaveURL(new RegExp(`/projetos/${p1.id}/saude$`))
    await expect(linkDoAlerta(alertaId)).toBeVisible()
    if (mobile) expect(await semRolagemHorizontal(page)).toBe(true)
    await capturar(page, projeto, 'd1-saude-do-projeto.png')
  })

  await test.step('3. O alerta: origem, ocorrências, recurso e projetos potencialmente afetados', async () => {
    await linkDoAlerta(alertaId).click()
    await expect(page).toHaveURL(new RegExp(`/infraestrutura/alertas/${alertaId}$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByText(`Webhook · ${nomeDaFonte}`)).toBeVisible()
    await expect(page.getByText('Recebido 1 vez')).toBeVisible()
    await expect(page.getByRole('link', { name: container.nome })).toBeVisible()
    const afetados = page.getByRole('list', { name: 'Projetos potencialmente afetados' })
    await expect(afetados.getByRole('link', { name: p1.nome })).toBeVisible()
    await expect(afetados.getByRole('link', { name: p2.nome })).toBeVisible()
    await expect(page.getByText('O impacto nos projetos não está confirmado.')).toBeVisible()
    if (mobile) expect(await semRolagemHorizontal(page)).toBe(true)
    await capturar(page, projeto, 'd2-alerta.png')
  })

  await test.step('4. O container: hospedagem, ferramentas e o mesmo link do alerta', async () => {
    await page.getByRole('link', { name: container.nome }).click()
    await expect(page).toHaveURL(new RegExp(`/infraestrutura/recursos/${container.id}$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('link', { name: vps.nome })).toBeVisible()
    await expect(page.getByText('Prévia de logs indisponível.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'GlitchTip' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Host Docker' })).toBeVisible()
    await expect(page.getByRole('link', { name: `GitHub · ${repoUm}` })).toBeVisible()
    const prioritarios = page.getByRole('list', { name: 'Problemas prioritários do recurso' })
    await expect(prioritarios.getByRole('link', { name: titulo })).toHaveAttribute(
      'href',
      `/infraestrutura/alertas/${alertaId}`,
    )
    await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)
    if (mobile) expect(await semRolagemHorizontal(page)).toBe(true)
    await capturar(page, projeto, 'd3-container.png')
  })

  await test.step('5. A VPS: métricas sem dados, Beszel e recursos hospedados', async () => {
    await page.getByRole('link', { name: vps.nome }).first().click()
    await expect(page).toHaveURL(new RegExp(`/infraestrutura/recursos/${vps.id}$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    for (const metrica of ['CPU', 'Memória', 'Disco']) {
      await expect(
        page
          .locator('div', { has: page.getByText(metrica, { exact: true }) })
          .filter({
            has: page.getByText('Sem dados', { exact: true }),
          })
          .first(),
      ).toBeVisible()
    }
    await expect(page.getByRole('link', { name: 'Beszel' })).toBeVisible()
    const hospedados = page.getByRole('list', { name: 'Recursos hospedados' })
    await expect(hospedados.getByRole('link', { name: container.nome })).toBeVisible()
    await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)
    if (mobile) expect(await semRolagemHorizontal(page)).toBe(true)
    await capturar(page, projeto, 'd4-servidor.png')
  })

  await test.step('6. Segundo contexto: P2 lista o mesmo registro; a repetição soma ocorrências', async () => {
    await visitar(`/projetos/${p2.id}/saude`)
    await expect(linkDoAlerta(alertaId)).toBeVisible()

    const repetido = await enviarAlerta(request, fonte.token, corpo)
    expect(repetido.status).toBe(200)
    expect(repetido.json).toMatchObject({ resultado: 'repetido', alertaId })
    const gravados = await obterAlertasPorChaveNoBanco(corpo.chave)
    expect(gravados).toHaveLength(1)
    expect(gravados[0]?.ocorrencias).toBe(2)

    for (const url of [
      `/projetos/${p1.id}/saude`,
      `/projetos/${p2.id}/saude`,
      `/infraestrutura/recursos/${container.id}`,
    ]) {
      await visitar(url)
      const linha = page.locator('li', { has: linkDoAlerta(alertaId) })
      await expect(linha).toContainText('Recebido 2 vezes')
    }
  })

  await test.step('7. Reconhecer não resolve; só a fonte resolve', async () => {
    await visitar(`/infraestrutura/alertas/${alertaId}`)
    await page.getByRole('button', { name: 'Reconhecer' }).click()
    await expect(page.getByText('Reconhecido', { exact: true }).first()).toBeVisible()
    await expect(
      page.getByText('O alerta foi reconhecido, mas continua ativo na origem.'),
    ).toBeVisible()
    await visitar(`/projetos/${p1.id}/saude`)
    await expect(linkDoAlerta(alertaId)).toBeVisible()
    await visitar(`/infraestrutura/alertas/${alertaId}`)
    await capturar(page, projeto, 'd5-alerta-reconhecido.png')

    const resolvido = await enviarAlerta(request, fonte.token, {
      ...corpo,
      situacao: 'resolvido',
    })
    expect(resolvido.status).toBe(200)
    expect(resolvido.json).toMatchObject({ resultado: 'resolvido' })
    await visitar(`/infraestrutura/alertas/${alertaId}`)
    await expect(page.getByText('Resolvido na origem', { exact: true }).first()).toBeVisible()
    await visitar(`/projetos/${p1.id}/saude`)
    await expect(page.getByText('Nenhum alerta não resolvido para este projeto.')).toBeVisible()
    await visitar(`/projetos/${p1.id}`)
    const secao = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: 'Saúde' }),
    })
    await expect(secao.locator('[data-tom="neutro"]')).toHaveText('Sem dados')
  })

  await test.step('8. Token inválido → 401 e nada é gravado', async () => {
    const antes = await contarAlertas()
    const r = await enviarAlerta(request, 'fa_invalido', corpo)
    expect(r.status).toBe(401)
    expect(await contarAlertas()).toBe(antes)
  })
})
