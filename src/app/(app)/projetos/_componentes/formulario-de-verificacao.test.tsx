import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../[p]/(abas)/publicacoes/actions', () => ({ registrarVerificacaoAction: vi.fn() }))

import { FormularioDeVerificacao } from './formulario-de-verificacao'

describe('FormularioDeVerificacao', () => {
  test('com podeAutorizar mostra o campo, o botão e a região de status montada', () => {
    render(<FormularioDeVerificacao projetoId="p-1" versaoId="v-1" podeAutorizar />)

    expect(screen.getByLabelText('O que foi verificado em produção')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar verificação' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  test('sem podeAutorizar não renderiza nada', () => {
    const { container } = render(
      <FormularioDeVerificacao projetoId="p-1" versaoId="v-1" podeAutorizar={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
