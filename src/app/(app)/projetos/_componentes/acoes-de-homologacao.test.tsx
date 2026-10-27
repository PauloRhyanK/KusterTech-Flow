import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AcaoDeHomologacao } from '@/modules/homologacao/model'

const registrar = vi.fn()
vi.mock('../acoes-de-homologacao', () => ({
  registrarAcaoDeHomologacaoAction: (...args: unknown[]) => registrar(...args),
}))

import { AcoesDeHomologacao } from './acoes-de-homologacao'

const base = {
  projetoId: '11111111-1111-4111-8111-111111111111',
  clienteId: '22222222-2222-4222-8222-222222222222',
  clienteNome: 'Acme',
  milestoneId: '33333333-3333-4333-8333-333333333333',
  milestoneTitulo: 'Release 1',
  issueId: '44444444-4444-4444-8444-444444444444',
  issueNumero: 1,
  repositorio: 'kustertech-exemplo/portal',
  itemId: '55555555-5555-4555-8555-555555555555',
  ultimoEventoId: '66666666-6666-4666-8666-666666666666',
  versao: { id: '77777777-7777-4777-8777-777777777777', rotulo: 'E2E qa-1' },
  recusa: null as string | null,
  podeEscolherVisibilidade: false,
}

function renderizar(acoes: AcaoDeHomologacao[], extra: Partial<typeof base> = {}) {
  return render(<AcoesDeHomologacao {...base} {...extra} acoes={acoes} />)
}

beforeEach(() => {
  registrar.mockReset()
  registrar.mockResolvedValue({})
})

describe('AcoesDeHomologacao', () => {
  test('testador vê "Solicitar correção" e "Comentário", não vê "Testado e aprovado" nem a escolha de visibilidade', async () => {
    renderizar(['SOLICITAR_CORRECAO', 'COMENTAR'])
    const grupo = screen.getByRole('group', { name: 'Ações de homologação' })
    expect(grupo).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Solicitar correção' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Comentário' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Testado e aprovado' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Comentário' }))
    expect(screen.getByLabelText('Comentário')).toBeInTheDocument()
    expect(screen.queryByLabelText('Interna (só a equipe)')).toBeNull()
  })

  test('quem tem visão global escolhe a visibilidade do comentário, com "Interna" como padrão', async () => {
    renderizar(['COMENTAR'], { podeEscolherVisibilidade: true })
    await userEvent.click(screen.getByRole('button', { name: 'Comentário' }))
    expect(screen.getByLabelText('Interna (só a equipe)')).toBeChecked()
    expect(screen.getByLabelText('Compartilhável com o cliente')).not.toBeChecked()
  })

  test('"Revisar solicitação" mostra cliente, milestone, issue e versão antes de "Confirmar solicitação de correção"', async () => {
    renderizar(['SOLICITAR_CORRECAO', 'COMENTAR'])
    await userEvent.click(screen.getByRole('button', { name: 'Solicitar correção' }))
    expect(screen.queryByRole('button', { name: 'Confirmar solicitação de correção' })).toBeNull()
    await userEvent.type(
      screen.getByLabelText('O que precisa ser corrigido'),
      'O botão de salvar não responde.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Revisar solicitação' }))
    expect(
      screen.getByText(
        'Você vai solicitar correção da issue #1 (kustertech-exemplo/portal) para Acme, na milestone Release 1, versão E2E qa-1.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Confirmar solicitação de correção' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar e editar' })).toBeInTheDocument()
    expect(registrar).not.toHaveBeenCalled()
  })

  test('aprovação e disponibilização passam por painel de contexto antes do botão de confirmação', async () => {
    renderizar(['DISPONIBILIZAR', 'APROVAR', 'COMENTAR'])
    await userEvent.click(screen.getByRole('button', { name: 'Disponibilizar ao cliente' }))
    expect(
      screen.getByText('Disponibilizar a issue #1 para teste de Acme na versão E2E qa-1?'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar disponibilização' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Testado e aprovado' }))
    expect(screen.queryByRole('button', { name: 'Confirmar aprovação' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Revisar aprovação' }))
    expect(
      screen.getByText(
        'Você vai registrar Testado e aprovado na issue #1 (kustertech-exemplo/portal) para Acme, na milestone Release 1, versão E2E qa-1.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar aprovação' })).toBeInTheDocument()
  })

  test('envia os campos ocultos vistos na tela ao confirmar', async () => {
    renderizar(['APROVAR', 'COMENTAR'])
    await userEvent.click(screen.getByRole('button', { name: 'Testado e aprovado' }))
    await userEvent.click(screen.getByRole('button', { name: 'Revisar aprovação' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar aprovação' }))
    expect(registrar).toHaveBeenCalledTimes(1)
    const dados = registrar.mock.calls[0]![1] as FormData
    expect(Object.fromEntries(dados.entries())).toMatchObject({
      acao: 'APROVAR',
      itemId: base.itemId,
      clienteId: base.clienteId,
      milestoneId: base.milestoneId,
      issueId: base.issueId,
      versaoId: base.versao.id,
      ultimoEventoId: base.ultimoEventoId,
      projetoId: base.projetoId,
    })
  })

  test('erro da action aparece em role=alert e o botão segue habilitado com aria-busy', async () => {
    registrar.mockResolvedValue({ erro: 'Esta issue já está aprovada para este cliente.' })
    renderizar(['COMENTAR'])
    await userEvent.click(screen.getByRole('button', { name: 'Comentário' }))
    await userEvent.type(screen.getByLabelText('Comentário'), 'Funciona no meu teste.')
    const enviar = screen.getByRole('button', { name: 'Registrar comentário' })
    expect(enviar).toHaveAttribute('aria-busy', 'false')
    await userEvent.click(enviar)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta issue já está aprovada para este cliente.',
    )
    expect(screen.getByRole('button', { name: 'Registrar comentário' })).toBeEnabled()
  })

  test('recusa do servidor aparece como nota de status; sem recusa a nota não existe', () => {
    const { unmount } = renderizar(['COMENTAR'], {
      recusa: 'Há uma correção solicitada. A aprovação volta a ficar disponível no reteste.',
    })
    expect(
      screen.getByText(
        'Há uma correção solicitada. A aprovação volta a ficar disponível no reteste.',
      ),
    ).toBeInTheDocument()
    unmount()
    renderizar(['COMENTAR'])
    expect(screen.queryByText(/correção solicitada/)).toBeNull()
  })
})
