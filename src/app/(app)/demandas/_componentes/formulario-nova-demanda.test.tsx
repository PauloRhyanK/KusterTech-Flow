import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/app/(app)/demandas/nova/actions', () => ({
  criarDemandaAction: vi.fn(async () => ({})),
}))

import { criarDemandaAction } from '@/app/(app)/demandas/nova/actions'
import { FormularioNovaDemanda } from './formulario-nova-demanda'

const png = (nome: string, bytes = 2048) =>
  new File([new Uint8Array(bytes)], nome, { type: 'image/png' })

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
    expect(campo).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/webm,audio/ogg',
    )
    expect(campo).toHaveAttribute('multiple')
  })

  test('anexar mostra cada arquivo com o tamanho e deixa remover', async () => {
    render(<FormularioNovaDemanda projetos={PROJETOS} />)
    await userEvent.upload(screen.getByLabelText('Anexos'), [png('tela.png'), png('outra.png')])

    expect(screen.getByText('tela.png')).toBeInTheDocument()
    expect(screen.getAllByText('2 KB')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Remover tela.png' }))
    expect(screen.queryByText('tela.png')).toBeNull()
    expect(screen.getByText('outra.png')).toBeInTheDocument()
  })

  test('arquivo fora da regra é avisado na hora e não entra', async () => {
    render(<FormularioNovaDemanda projetos={PROJETOS} />)
    const pdf = new File(['x'], 'proposta.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Anexos'), pdf, { applyAccept: false })

    expect(screen.getByText(/proposta\.pdf: só imagem/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remover proposta.pdf' })).toBeNull()
  })

  test('colar uma imagem nos detalhes vira anexo', () => {
    render(<FormularioNovaDemanda projetos={PROJETOS} />)
    fireEvent.paste(screen.getByLabelText('Detalhes (opcional)'), {
      clipboardData: { files: [png('colada.png')], getData: () => '' },
    })
    expect(screen.getByText('colada.png')).toBeInTheDocument()
  })

  test('colar texto que traz imagem de prévia (planilha) cola só o texto', () => {
    render(<FormularioNovaDemanda projetos={PROJETOS} />)
    fireEvent.paste(screen.getByLabelText('Detalhes (opcional)'), {
      clipboardData: { files: [png('previa.png')], getData: () => 'A1\tB1' },
    })
    expect(screen.queryByText('previa.png')).toBeNull()
  })

  test('arrastar arquivos para a área de anexos', () => {
    render(<FormularioNovaDemanda projetos={PROJETOS} />)
    fireEvent.drop(screen.getByTestId('zona-de-anexos'), {
      dataTransfer: { files: [png('arrastada.png')] },
    })
    expect(screen.getByText('arrastada.png')).toBeInTheDocument()
  })

  test('criar envia os anexos escolhidos', async () => {
    render(<FormularioNovaDemanda projetos={PROJETOS} />)
    await userEvent.type(screen.getByLabelText('O que você quer'), 'Nova tela')
    await userEvent.upload(screen.getByLabelText('Anexos'), png('tela.png'))
    await userEvent.click(screen.getByRole('button', { name: 'Criar demanda' }))

    await waitFor(() => expect(criarDemandaAction).toHaveBeenCalled())
    const form = vi.mocked(criarDemandaAction).mock.calls.at(-1)![1] as FormData
    expect((form.getAll('anexos') as File[]).map((f) => f.name)).toEqual(['tela.png'])
  })
})
