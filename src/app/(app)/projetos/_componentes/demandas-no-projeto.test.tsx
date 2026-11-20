import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/app/(app)/projetos/[p]/(detalhe)/configuracao/demandas-actions', () => ({
  definirDemandasDoProjetoAction: vi.fn(async () => ({})),
}))

import { DemandasNoProjeto } from './demandas-no-projeto'

const PADRAO = {
  id: 'm-1',
  nome: 'Padrão',
  etapas: [
    { chave: 'recebida', rotulo: 'Recebida' },
    { chave: 'planejada', rotulo: 'Planejada' },
    { chave: 'desenho', rotulo: 'Desenho' },
    { chave: 'desenvolvida', rotulo: 'Desenvolvida' },
    { chave: 'testada', rotulo: 'Testada' },
    { chave: 'entregue', rotulo: 'Entregue' },
  ],
}

describe('DemandasNoProjeto', () => {
  test('mostra o modelo Padrão com as seis etapas e o nível padrão Aprovar desenho', () => {
    render(
      <DemandasNoProjeto
        projetoId="p-1"
        modeloId="m-1"
        nivelPadrao="aprovar_desenho"
        modelos={[PADRAO]}
      />,
    )

    expect(screen.getByLabelText('Modelo de etapas')).toHaveValue('m-1')
    expect(screen.getByRole('option', { name: 'Padrão' })).toBeInTheDocument()
    expect(
      screen.getByText('Recebida › Planejada › Desenho › Desenvolvida › Testada › Entregue'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Nível padrão das demandas')).toHaveValue('aprovar_desenho')
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
  })
})
