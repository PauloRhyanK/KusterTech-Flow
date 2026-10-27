import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { AbasDaMilestone } from './abas-da-milestone'

const rotas = {
  issues: '/projetos/p-1/entregas/milestones/m-1',
  homologacao: '/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
}

describe('AbasDaMilestone', () => {
  test('aba homologacao ativa tem aria-current=page e a outra não', () => {
    render(<AbasDaMilestone rotas={rotas} ativa="homologacao" />)
    expect(screen.getByRole('navigation', { name: 'Seções da milestone' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Homologação' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Issues' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Homologação' })).toHaveAttribute(
      'href',
      '/projetos/p-1/entregas/milestones/m-1?aba=homologacao',
    )
  })
})
