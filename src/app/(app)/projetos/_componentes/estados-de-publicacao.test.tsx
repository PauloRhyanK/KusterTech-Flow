import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { estadosDePublicacao } from '@/modules/publicacao/model'
import { EstadosDaPublicacao } from './estados-de-publicacao'

describe('EstadosDaPublicacao', () => {
  test('quatro termos e textos, nenhum "bloque"', () => {
    const estados = estadosDePublicacao({
      qa: { estados: ['APROVADA', 'PENDENTE_DE_TESTE'], correcoesBloqueadoras: 0 },
      autorizacao: null,
      deploy: { tipo: 'evidencia', situacao: 'SUCESSO', origem: 'GITHUB_DEPLOYMENT' },
      divergente: true,
      verificacao: null,
    })

    const { container } = render(<EstadosDaPublicacao estados={estados} />)

    const termos = screen.getAllByRole('term').map((t) => t.textContent)
    expect(termos).toEqual([
      'Homologação QA',
      'Autorização PROD',
      'Deploy em PROD',
      'Verificação em produção',
    ])
    const definicoes = screen.getAllByRole('definition').map((d) => d.textContent)
    expect(definicoes).toEqual([
      'QA aprovado em 1 de 2',
      'Não autorizada para PROD',
      'Em PROD sem autorização registrada',
      'Não verificada em produção',
    ])
    expect(container.textContent?.toLowerCase()).not.toContain('bloque')
  })

  test('cada estado leva o tom do seu código', () => {
    const estados = estadosDePublicacao({
      qa: { estados: ['APROVADA'], correcoesBloqueadoras: 0 },
      autorizacao: { criadaEm: new Date(), revogadaEm: null },
      deploy: { tipo: 'evidencia', situacao: 'SUCESSO', origem: 'GITHUB_DEPLOYMENT' },
      divergente: false,
      verificacao: { origem: 'MANUAL' },
    })

    render(<EstadosDaPublicacao estados={estados} />)

    for (const texto of [
      'QA aprovado',
      'Autorizada para PROD',
      'Em PROD',
      'Verificada manualmente em produção',
    ]) {
      expect(within(screen.getByText(texto)).queryByRole('link')).toBeNull()
      expect(screen.getByText(texto)).toHaveAttribute('data-tom', 'sucesso')
    }
  })

  test('estado sem dado não usa o tom de sucesso', () => {
    const estados = estadosDePublicacao({
      qa: { estados: [], correcoesBloqueadoras: 0 },
      autorizacao: null,
      deploy: null,
      divergente: false,
      verificacao: null,
    })

    render(<EstadosDaPublicacao estados={estados} />)

    for (const d of screen.getAllByRole('definition')) {
      expect(d.querySelector('[data-tom="sucesso"]')).toBeNull()
    }
  })
})

describe('EstadosDaPublicacao nas páginas de milestone e issue', () => {
  test('os quatro estados variam de forma independente (D68)', () => {
    const estados = estadosDePublicacao({
      qa: { estados: ['APROVADA'], correcoesBloqueadoras: 0 },
      autorizacao: null,
      deploy: { tipo: 'presenca', estado: 'PRESENCA_CONFIRMADA' },
      divergente: true,
      verificacao: { origem: 'ENDPOINT' },
    })

    render(<EstadosDaPublicacao estados={estados} />)

    const definicoes = screen.getAllByRole('definition').map((d) => d.textContent)
    expect(definicoes).toEqual([
      'QA aprovado',
      'Não autorizada para PROD',
      'Em PROD sem autorização registrada',
      'Verificada em produção por evidência',
    ])
  })
})
