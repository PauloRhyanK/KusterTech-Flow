import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/app/(app)/demandas/nova/actions', () => ({
  criarDemandaAction: vi.fn(async () => ({})),
}))

import { FormularioNovaDemanda } from './formulario-nova-demanda'

const PROJETOS = [
  {
    id: 'p-alfa',
    nome: 'Projeto Alfa',
    nivelPadrao: 'aprovar_desenho' as const,
    repositorios: [{ id: 'r-1', nomeCompleto: 'kustertech-exemplo/alfa' }],
  },
  {
    id: 'p-beta',
    nome: 'Projeto Beta',
    nivelPadrao: 'vai_sozinho' as const,
    repositorios: [
      { id: 'r-2', nomeCompleto: 'kustertech-exemplo/beta-api' },
      { id: 'r-3', nomeCompleto: 'kustertech-exemplo/beta-web' },
    ],
  },
]

describe('FormularioNovaDemanda', () => {
  test('começa com Aprovar desenho e Sim marcados; trocar para um projeto com nivelPadrao VAI_SOZINHO marca Vai sozinho', async () => {
    render(<FormularioNovaDemanda projetos={PROJETOS} />)

    expect(screen.getByLabelText('Projeto')).toHaveValue('p-alfa')
    expect(screen.getByRole('radio', { name: 'Aprovar desenho' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Sim' })).toBeChecked()
    expect(screen.getByLabelText('O que você quer')).toHaveAttribute('placeholder', 'Título curto')
    expect(screen.getByLabelText('Detalhes (opcional)')).toHaveAttribute(
      'placeholder',
      'Escreva, cole imagem ou anexe um áudio',
    )
    expect(screen.getByRole('button', { name: 'Criar demanda' })).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Projeto'), 'p-beta')

    expect(screen.getByRole('radio', { name: 'Vai sozinho' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Aprovar desenho' })).not.toBeChecked()
  })

  test('o campo Repositório só aparece para projeto com dois repositórios', async () => {
    render(<FormularioNovaDemanda projetos={PROJETOS} />)

    expect(screen.queryByLabelText('Repositório')).toBeNull()

    await userEvent.selectOptions(screen.getByLabelText('Projeto'), 'p-beta')

    const repo = screen.getByLabelText('Repositório')
    expect(repo).toHaveValue('r-2')
    expect(screen.getByRole('option', { name: 'kustertech-exemplo/beta-web' })).toBeInTheDocument()
  })

  test('o campo de arquivo aceita imagem e áudio', () => {
    render(<FormularioNovaDemanda projetos={PROJETOS} />)
    const campo = screen.getByLabelText('Anexos')
    expect(campo).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,audio/*')
    expect(campo).toHaveAttribute('multiple')
  })
})
