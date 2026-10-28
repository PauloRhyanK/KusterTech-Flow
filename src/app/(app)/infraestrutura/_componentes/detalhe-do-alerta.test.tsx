import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { AlertaDetalhado } from '@/modules/infra/queries'
import { DetalheDoAlerta } from './detalhe-do-alerta'

vi.mock('@/app/(app)/infraestrutura/actions', () => ({
  reconhecerAlertaAction: vi.fn(),
  registrarResolucaoAction: vi.fn(),
}))

const base: AlertaDetalhado = {
  id: 'a-1',
  titulo: 'Disco quase cheio',
  severidade: 'ALTA',
  estado: 'ATIVO',
  origem: 'MANUAL',
  ocorrencias: 1,
  ultimaOcorrenciaEm: new Date('2026-10-27T13:00:00Z'),
  recurso: { id: 'r-1', nome: 'VPS Produção' },
  detalhe: null,
  primeiraOcorrenciaEm: new Date('2026-10-27T13:00:00Z'),
  origemTexto: 'Registro manual · Admin',
  reconhecido: null,
  resolucao: null,
  projetosAfetados: [{ id: 'p-1', nome: 'Portal' }],
  historico: [{ tipo: 'CRIADO', autor: 'Admin', em: new Date('2026-10-27T13:00:00Z') }],
  podeRegistrarResolucao: true,
}

describe('DetalheDoAlerta', () => {
  test('RECONHECIDO mostra "O alerta foi reconhecido, mas continua ativo na origem."; WEBHOOK não mostra "Registrar resolução"; detalhe com <script> renderizado como texto', () => {
    const { container, rerender } = render(
      <DetalheDoAlerta
        alerta={{
          ...base,
          estado: 'RECONHECIDO',
          origem: 'WEBHOOK',
          origemTexto: 'Webhook · Grafana',
          podeRegistrarResolucao: false,
          detalhe: '<script>alert(1)</script>',
          reconhecido: { por: 'Admin', em: new Date('2026-10-27T14:00:00Z') },
        }}
        podeGerenciar
      />,
    )

    expect(
      screen.getByText('O alerta foi reconhecido, mas continua ativo na origem.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Registrar resolução/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reconhecer' })).toBeNull()
    expect(
      screen.getByText('Este alerta será resolvido quando a fonte informar a resolução.'),
    ).toBeInTheDocument()
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('O impacto nos projetos não está confirmado.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Portal' })).toHaveAttribute(
      'href',
      '/projetos/p-1/saude',
    )

    rerender(<DetalheDoAlerta alerta={base} podeGerenciar />)
    expect(screen.getByRole('button', { name: 'Reconhecer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar resolução' })).toBeInTheDocument()
    expect(screen.getByText('Sem detalhe.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'VPS Produção' })).toHaveAttribute(
      'href',
      '/infraestrutura/recursos/r-1',
    )
  })

  test('sem recurso nem projetos mostra as mensagens de ausência', () => {
    render(
      <DetalheDoAlerta alerta={{ ...base, recurso: null, projetosAfetados: [] }} podeGerenciar />,
    )
    expect(screen.getByText('Sem recurso associado.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum projeto associado.')).toBeInTheDocument()
  })
})
