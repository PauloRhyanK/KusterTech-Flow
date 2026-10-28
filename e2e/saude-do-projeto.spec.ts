import { expect, test, type Page } from '@playwright/test'
import {
  criarAlertaNoBanco,
  criarClienteNoBanco,
  criarProjetoNoBanco,
  criarRecursoNoBanco,
  criarUsuarioNoBanco,
  liberarRepositoriosNoBanco,
  nomeDeTeste,
  repositoriosDoProjetoE2E,
  vincularNoBanco,
} from './support/banco'

function obterAdmin(): { email: string; senha: string } {
  const email = process.env.E2E_ADMIN_EMAIL
  const senha = process.env.E2E_ADMIN_SENHA
  if (!email || !senha) {
    throw new Error('E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { email, senha }
}

async function fazerLogin(page: Page, email: string, senha: string): Promise<void> {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function entrarComoAdmin(page: Page): Promise<void> {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)
}

test.beforeEach(async ({}, testInfo) => {
  await liberarRepositoriosNoBanco(repositoriosDoProjetoE2E(testInfo.project.name))
})

test('projeto com recurso associado e sem alertas: aba Recursos lista o recurso com "Sem dados"; Saúde e Erros e Resumo mostram "Sem dados"; nenhum badge de sucesso', async ({
  page,
}, testInfo) => {
  const [repoUm] = repositoriosDoProjetoE2E(testInfo.project.name)
  await entrarComoAdmin(page)
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Saúde Vazia'))
  await vincularNoBanco(projeto.id, repoUm)
  const recurso = await criarRecursoNoBanco({
    tipo: 'CONTAINER',
    nome: nomeDeTeste('Container Saúde'),
    projetosIds: [projeto.id],
  })

  await page.goto(`/projetos/${projeto.id}/recursos`)
  const lista = page.getByRole('list', { name: 'Recursos do projeto' })
  const linha = lista.locator('li', { hasText: recurso.nome })
  await expect(linha.getByRole('link', { name: recurso.nome })).toHaveAttribute(
    'href',
    `/infraestrutura/recursos/${recurso.id}`,
  )
  await expect(linha.locator('[data-tom="neutro"]')).toHaveText('Sem dados')
  await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)

  await page.goto(`/projetos/${projeto.id}/saude`)
  await expect(page.getByText('Nenhum alerta não resolvido para este projeto.')).toBeVisible()
  await expect(page.getByText('Isso não confirma que o projeto está saudável.')).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Erros da aplicação' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Métricas' })).toBeVisible()
  await expect(page.locator('[data-tom="sucesso"]')).toHaveCount(0)

  await page.goto(`/projetos/${projeto.id}`)
  const secao = page.locator('section', {
    has: page.getByRole('heading', { level: 2, name: 'Saúde' }),
  })
  await expect(secao.locator('[data-tom="neutro"]')).toHaveText('Sem dados')
  await expect(secao.getByRole('link', { name: 'Ver saúde e erros' })).toHaveAttribute(
    'href',
    `/projetos/${projeto.id}/saude`,
  )
  // O Resumo tem o checklist de configuração ("Concluído" em sucesso); a saúde não pode ter.
  await expect(secao.locator('[data-tom="sucesso"]')).toHaveCount(0)
})

test('alerta do recurso aparece na aba Saúde e Erros e no Resumo como "1 alerta não resolvido"; o link aponta para /infraestrutura/alertas/<id do banco>', async ({
  page,
}, testInfo) => {
  const [repoUm] = repositoriosDoProjetoE2E(testInfo.project.name)
  await entrarComoAdmin(page)
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Saúde Alerta'))
  await vincularNoBanco(projeto.id, repoUm)
  const recurso = await criarRecursoNoBanco({
    tipo: 'CONTAINER',
    nome: nomeDeTeste('Container Alerta'),
    projetosIds: [projeto.id],
  })
  const titulo = nomeDeTeste('Alerta do recurso')
  const alerta = await criarAlertaNoBanco({
    titulo,
    severidade: 'ALTA',
    recursoId: recurso.id,
  })

  await page.goto(`/projetos/${projeto.id}/saude`)
  await expect(page.getByRole('link', { name: titulo })).toHaveAttribute(
    'href',
    `/infraestrutura/alertas/${alerta.id}`,
  )

  await page.goto(`/projetos/${projeto.id}`)
  const secao = page.locator('section', {
    has: page.getByRole('heading', { level: 2, name: 'Saúde' }),
  })
  await expect(secao.getByText('1 alerta não resolvido')).toBeVisible()
  await secao.getByRole('link', { name: 'Ver saúde e erros' }).click()
  await expect(page).toHaveURL(new RegExp(`/projetos/${projeto.id}/saude$`))
  await expect(page.getByRole('link', { name: titulo })).toHaveAttribute(
    'href',
    `/infraestrutura/alertas/${alerta.id}`,
  )
})

test('TESTADOR com clienteId null vê o Resumo sem a seção Saúde e "Sem permissão para esta área." nas abas Recursos e Saúde e Erros; admin no contexto de cliente não vê a seção Saúde', async ({
  page,
  browser,
}, testInfo) => {
  const [repoUm] = repositoriosDoProjetoE2E(testInfo.project.name)
  await entrarComoAdmin(page)
  const cliente = await criarClienteNoBanco(nomeDeTeste('Cliente Saúde'))
  const projeto = await criarProjetoNoBanco(nomeDeTeste('Projeto Saúde Acesso'), [cliente.id])
  await vincularNoBanco(projeto.id, repoUm)

  await page.goto(`/clientes/${cliente.id}/projetos/${projeto.id}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Próximas ações' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Saúde' })).toHaveCount(0)

  const emailTestador = `e2e+testador-saude-${Date.now()}@local.test`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Saúde',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: null,
  })

  const contexto = await browser.newContext()
  try {
    const paginaTestador = await contexto.newPage()
    await fazerLogin(paginaTestador, emailTestador, senhaTestador)

    await paginaTestador.goto(`/projetos/${projeto.id}`)
    await expect(
      paginaTestador.getByRole('heading', { level: 2, name: 'Próximas ações' }),
    ).toBeVisible()
    await expect(paginaTestador.getByRole('heading', { level: 2, name: 'Saúde' })).toHaveCount(0)

    for (const aba of ['recursos', 'saude']) {
      await paginaTestador.goto(`/projetos/${projeto.id}/${aba}`)
      await expect(paginaTestador.getByText('Sem permissão para esta área.')).toBeVisible()
    }
  } finally {
    await contexto.close()
  }
})
