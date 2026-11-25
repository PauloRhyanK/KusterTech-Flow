import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { GrupoDeDemandas, LinhaDeDemanda } from '@/modules/demandas/apresentacao'
import { ListaDeDemandas, QuadrosAteOAr } from './lista-de-demandas'

const linha = (id: string, parcial: Partial<LinhaDeDemanda> = {}): LinhaDeDemanda => ({
  id,
  href: `/demandas/${id}`,
  titulo: `Demanda ${id}`,
  projeto: 'Projeto Alfa',
  partes: [{ chave: 'back', texto: 'em curso', tom: 'andando' }],
  trilho: ['cheio', 'cheio', 'andando', 'vazio'],
  estado: { texto: 'Desenvolvendo', tom: 'execucao' },
  idade: '1 d',
  ...parcial,
})

const grupos: GrupoDeDemandas[] = [
  {
    chave: 'espera_voce',
    titulo: 'Espera você',
    contagem: '1',
    linhas: [
      linha('a', {
        titulo: 'Tela de funil de vendas',
        estado: { texto: 'Aprovar desenho', tom: 'atencao' },
        idade: '3 h',
      }),
    ],
  },
  {
    chave: 'nao_chegou',
    titulo: 'Não chegou ao ar',
    contagem: '1',
    linhas: [
      linha('n', {
        titulo: 'Modo editor com IA',
        partes: [
          { chave: 'back', texto: 'planejando', tom: 'neutro' },
          { chave: 'front', texto: 'dispensada', tom: 'nao' },
        ],
        trilho: ['cheio', 'cheio', 'andando', 'vermelho'],
        estado: { texto: 'Falta a parte do back', tom: 'erro' },
      }),
    ],
  },
  { chave: 'a_caminho', titulo: 'A caminho', contagem: '1', linhas: [linha('b')] },
  {
    chave: 'no_ar',
    titulo: 'No ar',
    contagem: '1',
    linhas: [linha('c', { estado: { texto: 'No ar · c5c01ba', tom: 'sucesso' }, idade: 'hoje' })],
  },
]

describe('ListaDeDemandas', () => {
  test('os quatro grupos na ordem, sem parágrafo de descrição; a linha tem chips, trilho e frase', () => {
    const { container } = render(<ListaDeDemandas grupos={grupos} />)
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'Espera você',
      'Não chegou ao ar',
      'A caminho',
      'No ar',
    ])
    expect(container.querySelectorAll('p')).toHaveLength(0)

    const falta = screen.getByRole('link', { name: /Modo editor com IA/ })
    expect(within(falta).getByText('back · planejando')).toBeVisible()
    expect(within(falta).getByText('front · dispensada')).toBeVisible()
    expect(within(falta).getByText('Falta a parte do back')).toHaveClass('text-erro')
    expect(falta.querySelectorAll('[data-ponto]')).toHaveLength(4)
    expect(screen.getByText('No ar · c5c01ba')).toHaveClass('text-sucesso')

    const link = screen.getByRole('link', { name: /Tela de funil de vendas/ })
    expect(link).toHaveAttribute('href', '/demandas/a')
    expect(within(link).getByText('Projeto Alfa')).toBeVisible()
    expect(within(link).getByText('Aprovar desenho')).toBeVisible()
    expect(within(link).getByText('3 h')).toBeVisible()
  })

  test('mostra o grupo "Orientadas hoje" quando vem com linhas', () => {
    render(
      <ListaDeDemandas
        grupos={[
          ...grupos,
          {
            chave: 'orientadas_hoje',
            titulo: 'Orientadas hoje',
            contagem: '1',
            linhas: [
              linha('o', {
                titulo: 'Como exportar o relatório',
                estado: { texto: 'Orientada', tom: 'neutro' },
              }),
            ],
          },
        ]}
        filtrada
      />,
    )
    expect(screen.getByRole('heading', { name: 'Orientadas hoje' })).toBeVisible()
    const link = screen.getByRole('link', { name: /Como exportar o relatório/ })
    expect(link).toHaveAttribute('href', '/demandas/o')
    expect(within(link).getByText('Orientada')).toBeVisible()
  })

  test('grupo vazio não aparece; tudo vazio mostra o estado vazio', () => {
    const { rerender } = render(
      <ListaDeDemandas
        grupos={grupos.map((g) => (g.chave === 'no_ar' ? { ...g, linhas: [] } : g))}
      />,
    )
    expect(screen.queryByRole('heading', { name: 'No ar' })).not.toBeInTheDocument()
    rerender(<ListaDeDemandas grupos={grupos.map((g) => ({ ...g, linhas: [] }))} />)
    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma demanda nos últimos 30 dias')
    rerender(<ListaDeDemandas grupos={grupos.map((g) => ({ ...g, linhas: [] }))} filtrada />)
    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma demanda neste filtro')
  })

  test('QuadrosAteOAr: quatro números grandes que levam ao grupo', () => {
    render(
      <QuadrosAteOAr
        quadros={[
          { chave: 'no_ar', numero: 2, rotulo: 'No ar', meta: 'conferidas no site' },
          { chave: 'a_caminho', numero: 3, rotulo: 'A caminho', meta: 'Fábrica trabalhando' },
          {
            chave: 'nao_chegou',
            numero: 4,
            rotulo: 'Não chegou ao ar',
            meta: 'feita, mas falta algo',
          },
          { chave: 'espera_voce', numero: 1, rotulo: 'Espera você', meta: 'há 4 d' },
        ]}
      />,
    )
    const quadros = screen.getAllByRole('link')
    expect(quadros.map((q) => q.textContent)).toEqual([
      '2No arconferidas no site',
      '3A caminhoFábrica trabalhando',
      '4Não chegou ao arfeita, mas falta algo',
      '1Espera vocêhá 4 d',
    ])
    expect(quadros[2]).toHaveAttribute('href', '#grupo-nao_chegou')
  })
})
