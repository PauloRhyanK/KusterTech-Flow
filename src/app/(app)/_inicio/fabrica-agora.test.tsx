import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Inicio, PlanoNoInicio } from '@/modules/inicio/queries'
import { FabricaAgora } from './fabrica-agora'
import { FaixaDeRaias } from './faixa-de-raias'

const AGORA = new Date('2026-11-19T12:00:00Z')

function plano(extra: Partial<PlanoNoInicio> = {}): PlanoNoInicio {
  return {
    id: 'p1',
    repo: 'o/portal',
    feature: 'telas-crm',
    estado: 'ativo',
    faseAtual: 'f2',
    indiceDaFase: 2,
    totalDeFases: 4,
    raias: { concluidas: 3, executando: 2, falharam: 1, planejadas: 4, total: 10 },
    decisoes: 0,
    pausado: null,
    nomeDoProjeto: 'Projeto Alfa',
    ...extra,
  }
}

function fabrica(extra: Partial<NonNullable<Inicio['fabrica']>> = {}): Inicio['fabrica'] {
  return {
    planos: [plano()],
    vagas: {
      efetivas: 5,
      configuradas: 5,
      ocupadas: 3,
      ramMinimaMb: 2048,
      memDisponivelMb: 2970,
      oomEm: null,
    },
    recebidoEm: new Date('2026-11-19T11:59:20Z'),
    desatualizado: false,
    ...extra,
  }
}

describe('FabricaAgora', () => {
  it('sem retrato mostra o texto fixo e o link para configurar', () => {
    render(<FabricaAgora fabrica={null} falhou={false} agora={AGORA} />)
    expect(screen.getByText('A Fábrica ainda não enviou dados.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Configurar o envio' })).toHaveAttribute(
      'href',
      '/configuracoes/fabrica',
    )
  })

  it('falha na leitura não diz que a Fábrica nunca enviou', () => {
    render(<FabricaAgora fabrica={null} falhou agora={AGORA} />)
    expect(screen.getByText('Não foi possível ler o retrato da Fábrica agora.')).toBeVisible()
    expect(screen.queryByText('A Fábrica ainda não enviou dados.')).toBeNull()
  })

  it('uma linha por plano com projeto, feature, fase, raias, estado; rodapé de vagas e link', () => {
    render(<FabricaAgora fabrica={fabrica()} falhou={false} agora={AGORA} />)

    const linha = within(screen.getByRole('list', { name: 'Planos em curso' })).getByRole(
      'listitem',
    )
    expect(within(linha).getByText('Projeto Alfa · telas-crm')).toBeVisible()
    expect(linha).toHaveTextContent(
      'Fase 2 de 4 · 3 de 10 raias concluídas · 2 executando · 1 falhou',
    )
    expect(within(linha).getByText('Ativo')).toHaveAttribute('data-tom', 'execucao')
    expect(within(linha).getByRole('img')).toHaveAttribute(
      'aria-label',
      '3 de 10 raias concluídas, 2 executando, 1 falharam',
    )
    expect(screen.getByText('Vagas: 3 de 5 ocupadas · memória disponível 2,9 GB')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Abrir a Fábrica' })).toHaveAttribute(
      'href',
      '/fabrica',
    )
    expect(screen.getByText('retrato de há menos de 1 min')).toBeVisible()
  })

  it('plano com decisão aberta mostra "Aguarda decisão"; sem planos em curso, o texto vazio', () => {
    const { rerender } = render(
      <FabricaAgora
        fabrica={fabrica({ planos: [plano({ decisoes: 1, nomeDoProjeto: null })] })}
        falhou={false}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('Aguarda decisão')).toHaveAttribute('data-tom', 'atencao')
    expect(screen.getByText('o/portal · telas-crm')).toBeVisible()

    rerender(<FabricaAgora fabrica={fabrica({ planos: [] })} falhou={false} agora={AGORA} />)
    expect(screen.getByText('Nenhum plano em curso.')).toBeVisible()
  })

  it('retrato desatualizado destaca a idade', () => {
    render(
      <FabricaAgora
        fabrica={fabrica({ recebidoEm: new Date('2026-11-19T11:50:00Z'), desatualizado: true })}
        falhou={false}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('retrato de há 10 min')).toHaveClass('text-atencao')
  })
})

describe('FaixaDeRaias', () => {
  it('segmentos proporcionais com os tokens de cada estado', () => {
    render(
      <FaixaDeRaias
        raias={{ concluidas: 2, executando: 1, falharam: 1, planejadas: 0, total: 4 }}
      />,
    )
    const faixa = screen.getByRole('img')
    expect(faixa).toHaveAttribute('aria-label', '2 de 4 raias concluídas, 1 executando, 1 falharam')
    const segmentos = [...faixa.children] as HTMLElement[]
    expect(segmentos.map((s) => s.className.match(/bg-[\w-]+/)?.[0])).toEqual([
      'bg-context-active',
      'bg-execucao',
      'bg-erro',
    ])
    expect(segmentos[0]).toHaveStyle({ flexGrow: '2' })
  })
})
