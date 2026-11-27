import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { LinhaDoQuadro, QuadroDeErros } from '@/modules/erros/apresentacao'
import { ErrosNoAr } from './quadro-de-erros'

const agora = new Date('2026-11-26T15:30:00.000Z')
const MIN = 60_000

function linha(p: Partial<LinhaDoQuadro> = {}): LinhaDoQuadro {
  return {
    issueId: '17',
    titulo: "TypeError: Cannot read properties of undefined (reading 'itens')",
    projeto: 'app-vendas',
    onde: 'pedidos/fechar.ts in calcularTotal',
    nivel: 'error',
    eventos: 48,
    usuarios: 9,
    ultimoEm: new Date(agora.getTime() - MIN),
    primeiroEm: new Date(agora.getTime() - 60 * MIN),
    estado: 'voltou',
    detalhe: 'voltou depois da correção · nova demanda',
    demandaId: 'd1',
    link: 'https://erros.exemplo.com/minha-org/issues/17',
    barrinhas: { valores: [0, 1, 2, 3, 9], subindo: true },
    ...p,
  }
}

function quadro(p: Partial<QuadroDeErros> = {}): QuadroDeErros {
  return {
    configurado: true,
    linhas: [linha()],
    contagem: { voltou: 1, novo: 0, em_correcao: 0, na_espera: 0, observando: 0, no_ar: 0 },
    corrigidosEm7Dias: 0,
    projetosLidos: 4,
    leitura: { ultimoSucessoEm: new Date(agora.getTime() - 2 * MIN), velha: false, motivo: null },
    avisos: [],
    ...p,
  }
}

describe('Erros no ar', () => {
  test('cada erro mostra volume, estado e os links da demanda e do GlitchTip', () => {
    render(<ErrosNoAr quadro={quadro()} agora={agora} />)
    const secao = screen.getByRole('region', { name: 'Erros no ar' })
    expect(within(secao).getByText('GlitchTip lido há 2 min')).toBeInTheDocument()
    expect(within(secao).getByText(/48 eventos · 9 usuários/)).toBeInTheDocument()
    expect(within(secao).getByText('Voltou')).toBeInTheDocument()
    expect(within(secao).getByRole('link', { name: 'Demanda' })).toHaveAttribute(
      'href',
      '/demandas/d1',
    )
    const detalhes = within(secao).getByRole('link', { name: /Detalhes/ })
    expect(detalhes).toHaveAttribute('href', 'https://erros.exemplo.com/minha-org/issues/17')
    expect(detalhes).toHaveAttribute('target', '_blank')
    expect(detalhes).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('na espera não tem link de demanda', () => {
    render(
      <ErrosNoAr
        quadro={quadro({ linhas: [linha({ estado: 'na_espera', demandaId: null })] })}
        agora={agora}
      />,
    )
    expect(screen.queryByRole('link', { name: 'Demanda' })).not.toBeInTheDocument()
    expect(screen.getByText('Na espera')).toBeInTheDocument()
  })

  test('no ar mostra quanto falta para contar como corrigido', () => {
    const l = linha({ estado: 'no_ar', detalhe: 'no ar · faltam 22 h sem o erro' })
    render(
      <ErrosNoAr
        quadro={quadro({
          linhas: [l],
          contagem: { voltou: 0, novo: 0, em_correcao: 0, na_espera: 0, observando: 0, no_ar: 1 },
        })}
        agora={agora}
      />,
    )
    expect(screen.getByText('No ar')).toBeInTheDocument()
    expect(screen.getByText('no ar · faltam 22 h sem o erro')).toBeInTheDocument()
    expect(screen.getByText('no ar', { exact: true }).closest('span')).toHaveTextContent('1 no ar')
  })

  test('em observação mostra o botão Virar demanda para quem pode', () => {
    const acao = async () => {}
    const obs = quadro({
      linhas: [linha({ estado: 'observando', demandaId: null, detalhe: 'vira demanda com 10' })],
      contagem: { voltou: 0, novo: 0, em_correcao: 0, na_espera: 0, observando: 1, no_ar: 0 },
    })
    const { rerender } = render(<ErrosNoAr quadro={obs} agora={agora} virarDemanda={acao} />)
    expect(screen.getByText('Em observação')).toBeInTheDocument()
    expect(screen.getByText('em observação')).toBeInTheDocument()
    const botao = screen.getByRole('button', { name: 'Virar demanda' })
    expect(botao.closest('form')?.querySelector('input[name="issueId"]')).toHaveValue('17')
    rerender(<ErrosNoAr quadro={obs} agora={agora} />)
    expect(screen.queryByRole('button', { name: 'Virar demanda' })).not.toBeInTheDocument()
  })

  test('mostra 8 e guarda o resto em Ver todos', () => {
    const linhas = Array.from({ length: 10 }, (_, i) =>
      linha({ issueId: String(i), titulo: `Erro ${i}`, estado: 'novo' }),
    )
    render(<ErrosNoAr quadro={quadro({ linhas })} agora={agora} />)
    expect(screen.getByText('Ver todos os 10')).toBeInTheDocument()
  })

  test('vazio', () => {
    render(
      <ErrosNoAr
        quadro={quadro({
          linhas: [],
          contagem: { voltou: 0, novo: 0, em_correcao: 0, na_espera: 0, observando: 0, no_ar: 0 },
          corrigidosEm7Dias: 3,
        })}
        agora={agora}
      />,
    )
    expect(screen.getByText(/Nenhum erro aberto nos 4 projetos lidos/)).toBeInTheDocument()
    expect(screen.getByText(/3 corrigidos nos últimos 7 dias/)).toBeInTheDocument()
  })

  test('leitura velha avisa e marca os números como até a última leitura', () => {
    render(
      <ErrosNoAr
        quadro={quadro({
          leitura: {
            ultimoSucessoEm: new Date(agora.getTime() - 45 * MIN),
            velha: true,
            motivo: 'token recusado',
          },
        })}
        agora={agora}
      />,
    )
    expect(
      screen.getByText('o GlitchTip não responde há 45 min (token recusado)'),
    ).toBeInTheDocument()
    expect(screen.getByText(/até a última leitura/)).toBeInTheDocument()
  })

  test('nunca lido', () => {
    render(
      <ErrosNoAr
        quadro={quadro({
          linhas: [],
          leitura: { ultimoSucessoEm: null, velha: true, motivo: null },
        })}
        agora={agora}
      />,
    )
    expect(screen.getByText('o GlitchTip ainda não foi lido')).toBeInTheDocument()
  })

  test('nunca lido, com falha, mostra o motivo', () => {
    render(
      <ErrosNoAr
        quadro={quadro({
          linhas: [],
          leitura: { ultimoSucessoEm: null, velha: true, motivo: 'token recusado' },
        })}
        agora={agora}
      />,
    )
    expect(screen.getByText('o GlitchTip não respondeu ainda (token recusado)')).toBeInTheDocument()
  })

  test('não configurado', () => {
    render(<ErrosNoAr quadro={quadro({ configurado: false, linhas: [] })} agora={agora} />)
    expect(screen.getByText('GlitchTip não configurado')).toBeInTheDocument()
  })

  test('avisos de configuração aparecem', () => {
    render(
      <ErrosNoAr quadro={quadro({ avisos: ['projeto sem repositório: portal'] })} agora={agora} />,
    )
    expect(screen.getByText('projeto sem repositório: portal')).toBeInTheDocument()
  })
})
