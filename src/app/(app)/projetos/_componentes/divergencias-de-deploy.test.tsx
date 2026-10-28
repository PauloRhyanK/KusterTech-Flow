import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../[p]/(abas)/publicacoes/actions', () => ({ reconhecerDivergenciaAction: vi.fn() }))

import type { DivergenciaApresentada } from '@/modules/publicacao/queries'
import { DivergenciasDeDeploy } from './divergencias-de-deploy'

function divergencia(o: Partial<DivergenciaApresentada> = {}): DivergenciaApresentada {
  return {
    id: 'dv-1',
    commitCurto: '26d0000',
    origem: 'GITHUB_DEPLOYMENT',
    ocorridaEm: new Date('2026-10-18T12:00:00Z'),
    detectadaEm: new Date('2026-10-28T09:00:00Z'),
    reconhecida: null,
    ...o,
  }
}

describe('DivergenciasDeDeploy', () => {
  test('divergência mostra "Deploy em PROD sem autorização registrada" e nenhum texto com "bloque"', () => {
    const { container } = render(
      <DivergenciasDeDeploy projetoId="p-1" divergencias={[divergencia()]} podeAutorizar />,
    )

    expect(screen.getByText('Deploy em PROD sem autorização registrada')).toBeInTheDocument()
    expect(screen.getByText(/26d0000/)).toBeInTheDocument()
    expect(screen.getByText(/GitHub Deployments/)).toBeInTheDocument()
    expect(screen.getByText(/Detectada em/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reconhecer divergência' })).toBeInTheDocument()
    expect(container.querySelector('#divergencia-dv-1')).not.toBeNull()
    expect(container.textContent?.toLowerCase()).not.toContain('bloque')
  })

  test('reconhecida mostra quem e quando, avisa que não autoriza e não oferece o botão', () => {
    render(
      <DivergenciasDeDeploy
        projetoId="p-1"
        divergencias={[
          divergencia({
            reconhecida: { porNome: 'Admin E2E', em: new Date('2026-10-28T10:00:00Z') },
          }),
        ]}
        podeAutorizar
      />,
    )

    expect(
      screen.getByText(/Reconhecida por Admin E2E em .*\. Reconhecer não autoriza a versão\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconhecer divergência' })).toBeNull()
  })

  test('sem podeAutorizar não mostra o botão; sem divergências mostra o estado vazio', () => {
    const { rerender } = render(
      <DivergenciasDeDeploy projetoId="p-1" divergencias={[divergencia()]} podeAutorizar={false} />,
    )
    expect(screen.queryByRole('button', { name: 'Reconhecer divergência' })).toBeNull()

    rerender(<DivergenciasDeDeploy projetoId="p-1" divergencias={[]} podeAutorizar />)
    expect(screen.getByText('Nenhuma divergência de deploy.')).toBeInTheDocument()
  })
})
