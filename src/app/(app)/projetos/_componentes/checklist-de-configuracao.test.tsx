import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ItemChecklist } from '@/modules/projetos/model'
import { ChecklistDeConfiguracao } from './checklist-de-configuracao'

describe('ChecklistDeConfiguracao', () => {
  test('pendente com ação mostra Pendente (atencao) e o link; pendente sem ação não mostra link; concluido mostra Concluído (sucesso); indisponivel mostra Ainda não disponível (neutro); nenhum sucesso sem concluido', () => {
    const itens: readonly ItemChecklist[] = [
      {
        chave: 'clientes',
        titulo: 'Clientes',
        descricao: 'Nenhum cliente associado',
        estado: 'pendente',
        acao: {
          rotulo: 'Associar clientes',
          href: '/projetos/p1/configuracao',
        },
      },
      {
        chave: 'github',
        titulo: 'GitHub',
        descricao: 'A integração com o GitHub chega no Incremento 2.',
        estado: 'indisponivel',
      },
    ]

    const { rerender } = render(<ChecklistDeConfiguracao itens={itens} />)

    const lista = screen.getByRole('list', { name: 'Configuração do projeto' })
    expect(lista).toBeInTheDocument()

    // Item pendente com ação
    const badgePendente = screen.getByText('Pendente')
    expect(badgePendente).toBeInTheDocument()
    expect(badgePendente.closest('[data-tom]')).toHaveAttribute('data-tom', 'atencao')

    const linkAcao = screen.getByRole('link', { name: 'Associar clientes' })
    expect(linkAcao).toBeInTheDocument()
    expect(linkAcao).toHaveAttribute('href', '/projetos/p1/configuracao')

    // Item indisponível
    const badgeIndisponivel = screen.getByText('Ainda não disponível')
    expect(badgeIndisponivel).toBeInTheDocument()
    expect(badgeIndisponivel.closest('[data-tom]')).toHaveAttribute('data-tom', 'neutro')

    // Nenhum badge de sucesso até agora
    expect(screen.queryByText('Concluído')).toBeNull()
    expect(document.querySelectorAll('[data-tom="sucesso"]')).toHaveLength(0)

    // Pendente sem ação
    const itensSemAcao: readonly ItemChecklist[] = [
      {
        chave: 'clientes',
        titulo: 'Clientes',
        descricao: 'Nenhum cliente associado',
        estado: 'pendente',
      },
      {
        chave: 'ambientes',
        titulo: 'Ambientes',
        descricao: 'Ambientes e evidências de deploy chegam no Incremento 4.',
        estado: 'indisponivel',
      },
    ]
    rerender(<ChecklistDeConfiguracao itens={itensSemAcao} />)
    expect(screen.queryByRole('link', { name: 'Associar clientes' })).toBeNull()

    // Concluído mostra Concluído com tom sucesso
    const itensComConcluido: readonly ItemChecklist[] = [
      {
        chave: 'clientes',
        titulo: 'Clientes',
        descricao: 'Clientes associados',
        estado: 'concluido',
      },
      {
        chave: 'github',
        titulo: 'GitHub',
        descricao: 'A integração com o GitHub chega no Incremento 2.',
        estado: 'indisponivel',
      },
    ]
    rerender(<ChecklistDeConfiguracao itens={itensComConcluido} />)

    const badgeConcluido = screen.getByText('Concluído')
    expect(badgeConcluido).toBeInTheDocument()
    expect(badgeConcluido.closest('[data-tom]')).toHaveAttribute('data-tom', 'sucesso')
    expect(document.querySelectorAll('[data-tom="sucesso"]')).toHaveLength(1)
  })
})
