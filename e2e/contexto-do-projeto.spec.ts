import { expect, test, type Page } from '@playwright/test'
import {
  criarClienteNoBanco,
  criarProjetoNoBanco,
  criarUsuarioNoBanco,
  nomeDeTeste,
} from './support/banco'

function obterAdmin(): { id: string; email: string; senha: string } {
  const id = process.env.E2E_ADMIN_ID
  const email = process.env.E2E_ADMIN_EMAIL
  const senha = process.env.E2E_ADMIN_SENHA
  if (!id || !email || !senha) {
    throw new Error('E2E_ADMIN_ID, E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA não configuradas pelo setup.')
  }
  return { id, email, senha }
}

async function fazerLogin(page: Page, email: string, senha: string): Promise<void> {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('admin: /projetos/<P> mostra seis abas, trilha Projetos › P e checklist com Clientes concluído; /clientes/<A>/projetos/<P> mostra três abas, trilha Clientes › A › P, o mesmo nome, "contexto de A" e "Ver na visão global" com href /projetos/<P>', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const clienteA = await criarClienteNoBanco(nomeDeTeste('Cliente A'))
  const clienteB = await criarClienteNoBanco(nomeDeTeste('Cliente B'))
  const nomeP = nomeDeTeste('Projeto P')
  const projetoP = await criarProjetoNoBanco(nomeP, [clienteA.id, clienteB.id])

  // Visão global (/projetos/<P>)
  await page.goto(`/projetos/${projetoP.id}`)

  // Cabeçalho e trilhas
  await expect(page.getByRole('heading', { level: 1, name: nomeP })).toBeVisible()
  const navTrilhasGlobal = page.getByRole('navigation', { name: 'Trilha de navegação' })
  await expect(navTrilhasGlobal.getByRole('link', { name: 'Projetos' })).toBeVisible()
  await expect(navTrilhasGlobal.getByText(nomeP)).toBeVisible()

  // Seis abas
  const navAbasGlobal = page.getByRole('navigation', { name: 'Seções do projeto' })
  await expect(navAbasGlobal.getByRole('link')).toHaveCount(6)
  await expect(navAbasGlobal.getByRole('link', { name: /^Resumo/ })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(navAbasGlobal.getByRole('link', { name: /Entregas/ })).toBeVisible()
  await expect(navAbasGlobal.getByRole('link', { name: /Homologação/ })).toBeVisible()
  await expect(navAbasGlobal.getByRole('link', { name: /Publicações/ })).toBeVisible()
  await expect(navAbasGlobal.getByRole('link', { name: /Saúde e Erros/ })).toBeVisible()
  await expect(navAbasGlobal.getByRole('link', { name: /Recursos/ })).toBeVisible()

  // Checklist com Clientes concluído
  const listaChecklist = page.getByRole('list', { name: 'Configuração do projeto' })
  await expect(listaChecklist.getByText('Clientes', { exact: true })).toBeVisible()
  await expect(listaChecklist.getByText('Clientes associados')).toBeVisible()
  await expect(listaChecklist.getByText('Concluído')).toBeVisible()

  // Contexto de cliente (/clientes/<A>/projetos/<P>)
  await page.goto(`/clientes/${clienteA.id}/projetos/${projetoP.id}`)

  // Cabeçalho e trilhas: Clientes › A › P
  await expect(page.getByRole('heading', { level: 1, name: nomeP })).toBeVisible()
  const navTrilhasCliente = page.getByRole('navigation', { name: 'Trilha de navegação' })
  await expect(navTrilhasCliente.getByRole('link', { name: 'Clientes' })).toBeVisible()
  await expect(navTrilhasCliente.getByRole('link', { name: clienteA.nome })).toBeVisible()
  await expect(navTrilhasCliente.getByText(nomeP)).toBeVisible()

  // Três abas
  const navAbasCliente = page.getByRole('navigation', { name: 'Seções do projeto' })
  await expect(navAbasCliente.getByRole('link')).toHaveCount(3)
  await expect(navAbasCliente.getByRole('link', { name: /^Resumo/ })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(navAbasCliente.getByRole('link', { name: /Entregas/ })).toBeVisible()
  await expect(navAbasCliente.getByRole('link', { name: /Homologação/ })).toBeVisible()

  // Contexto de A e "Ver na visão global"
  await expect(
    page.getByText(`Você está vendo este projeto no contexto de ${clienteA.nome}.`),
  ).toBeVisible()
  const linkVerGlobal = page.getByRole('link', { name: 'Ver na visão global' })
  await expect(linkVerGlobal).toBeVisible()
  await expect(linkVerGlobal).toHaveAttribute('href', `/projetos/${projetoP.id}`)
})

test('admin: projeto novo sem clientes: checklist com Clientes pendente e link "Associar clientes" → /projetos/<p>/configuracao; GitHub, Milestones e Ambientes pendentes; editar e associar funcionam (UX-03, A13)', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const nomeProjeto = nomeDeTeste('Projeto Sem Clientes')
  const projeto = await criarProjetoNoBanco(nomeProjeto)
  const clienteX = await criarClienteNoBanco(nomeDeTeste('Cliente X'))

  // Abre /projetos/<p>
  await page.goto(`/projetos/${projeto.id}`)
  await expect(page.getByRole('heading', { level: 1, name: nomeProjeto })).toBeVisible()

  // Checklist
  const listaChecklist = page.getByRole('list', { name: 'Configuração do projeto' })
  await expect(listaChecklist.getByText('Nenhum cliente associado')).toBeVisible()
  // Clientes, GitHub (sem repositórios), Ambientes (nenhum) e Milestones (nenhuma criada) pendentes
  await expect(listaChecklist.getByText('Pendente')).toHaveCount(4)
  await expect(listaChecklist.getByText('Nenhum repositório vinculado')).toBeVisible()

  const linkAssociar = listaChecklist.getByRole('link', { name: 'Associar clientes' })
  await expect(linkAssociar).toBeVisible()
  await expect(linkAssociar).toHaveAttribute('href', `/projetos/${projeto.id}/configuracao`)

  // Milestones: pendente com ação para criar
  await expect(listaChecklist.getByText('Nenhuma milestone criada')).toBeVisible()
  await expect(listaChecklist.getByRole('link', { name: 'Criar milestone' })).toHaveAttribute(
    'href',
    `/projetos/${projeto.id}/entregas?nova=1#nova-milestone`,
  )

  // Ambientes: pendente com ação para configurar
  await expect(listaChecklist.getByText('Nenhum ambiente configurado')).toBeVisible()
  await expect(listaChecklist.getByRole('link', { name: 'Configurar ambientes' })).toHaveAttribute(
    'href',
    `/projetos/${projeto.id}/configuracao#ambientes`,
  )
  await expect(listaChecklist.getByText('Ainda não disponível')).toHaveCount(0)

  // Clica em "Associar clientes" e vai para /projetos/<p>/configuracao
  await linkAssociar.click()
  await expect(page).toHaveURL(`/projetos/${projeto.id}/configuracao`)
  await expect(page.getByRole('heading', { level: 1, name: 'Configuração inicial' })).toBeVisible()

  // Associa clienteX
  await page.getByLabel('Cliente').selectOption(clienteX.id)
  await page.getByRole('button', { name: 'Associar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Cliente associado.' })).toBeVisible()

  // Volta para /projetos/<p>
  await page.goto(`/projetos/${projeto.id}`)
  await expect(
    page.getByRole('list', { name: 'Configuração do projeto' }).getByText('Concluído'),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: clienteX.nome })).toBeVisible()
})

test('testador de A: /clientes/<A>/projetos/<P> abre sem "Ver na visão global" nem "Configuração"; /projetos/<P> → Sem permissão; /clientes/<B>/projetos/<P> → Sem permissão; /clientes/<A>/projetos/<Q> → Registro não encontrado', async ({
  page,
}) => {
  const clienteA = await criarClienteNoBanco(nomeDeTeste('Cliente A'))
  const clienteB = await criarClienteNoBanco(nomeDeTeste('Cliente B'))
  const nomeP = nomeDeTeste('Projeto P')
  const projetoP = await criarProjetoNoBanco(nomeP, [clienteA.id, clienteB.id])
  const nomeQ = nomeDeTeste('Projeto Q')
  const projetoQ = await criarProjetoNoBanco(nomeQ, [clienteB.id])

  const emailTestador = `testador_${Math.random().toString(36).slice(2, 8)}@kustertech.com`
  const senhaTestador = 'SenhaForte123!'
  await criarUsuarioNoBanco({
    email: emailTestador,
    nome: 'Testador Escopado A',
    senha: senhaTestador,
    papel: 'TESTADOR',
    clienteId: clienteA.id,
  })

  await fazerLogin(page, emailTestador, senhaTestador)

  // /clientes/<A>/projetos/<P> abre sem "Ver na visão global" nem "Configuração"
  await page.goto(`/clientes/${clienteA.id}/projetos/${projetoP.id}`)
  await expect(page.getByRole('heading', { level: 1, name: nomeP })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver na visão global' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Configuração' })).toHaveCount(0)

  // /projetos/<P> → Sem permissão
  await page.goto(`/projetos/${projetoP.id}`)
  await expect(page.getByText('Sem permissão para esta área.')).toBeVisible()

  // /clientes/<B>/projetos/<P> → Sem permissão
  await page.goto(`/clientes/${clienteB.id}/projetos/${projetoP.id}`)
  await expect(page.getByText('Sem permissão para esta área.')).toBeVisible()

  // /clientes/<A>/projetos/<Q> → Registro não encontrado
  await page.goto(`/clientes/${clienteA.id}/projetos/${projetoQ.id}`)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Registro não encontrado' }),
  ).toBeVisible()
  await expect(
    page.getByText('Este registro não existe ou não está disponível para você.'),
  ).toBeVisible()
})

test('no mobile (390 px), as abas cabem sem rolagem horizontal da página e são navegáveis por teclado; a aba ativa tem aria-current', async ({
  page,
}) => {
  const { email, senha } = obterAdmin()
  await fazerLogin(page, email, senha)

  const clienteMobile = await criarClienteNoBanco(nomeDeTeste('Cliente Mobile'))
  const nomeMobile = nomeDeTeste('Projeto Mobile')
  const projetoMobile = await criarProjetoNoBanco(nomeMobile, [clienteMobile.id])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/projetos/${projetoMobile.id}`)

  // Verifica que a página não tem rolagem horizontal
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)

  // Aba ativa tem aria-current
  const navAbas = page.getByRole('navigation', { name: 'Seções do projeto' })
  const linkResumo = navAbas.getByRole('link', { name: /^Resumo/ })
  await expect(linkResumo).toHaveAttribute('aria-current', 'page')

  // Navegação por teclado: foca a aba ativa, aperta Tab para próxima e Enter para navegar
  await linkResumo.focus()
  await page.keyboard.press('Tab')
  const linkEntregas = navAbas.getByRole('link', { name: /Entregas/ })
  await expect(linkEntregas).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/projetos/${projetoMobile.id}/entregas`)
  await expect(navAbas.getByRole('link', { name: /Entregas/ })).toHaveAttribute(
    'aria-current',
    'page',
  )
})
