import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EsperaVoce as Espera, ItemDeEspera } from '@/modules/inicio/model'
import { EsperaVoce } from './espera-voce'

const AGORA = new Date('2026-11-19T12:00:00Z')

function item(extra: Partial<ItemDeEspera> = {}): ItemDeEspera {
  return {
    id: 'i1',
    tipo: 'integracao',
    titulo: 'GitHub — Portal',
    contexto: 'Indisponível · nenhuma sincronização concluída',
    href: '/projetos/P/configuracao#repositorios',
    externo: false,
    rotuloDoLink: 'Abrir o projeto',
    tom: 'erro',
    desde: new Date('2026-11-19T10:00:00Z'),
    ...extra,
  }
}

function espera(extra: Partial<Espera> = {}): Espera {
  return { itens: [], total: 0, ocultos: 0, fontesComFalha: [], ...extra }
}

describe('EsperaVoce', () => {
  it('lista vazia mostra o texto fixo', () => {
    render(<EsperaVoce espera={espera()} agora={AGORA} />)
    expect(screen.getByText('Nada espera você nas fontes disponíveis.')).toBeVisible()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('cada linha tem selo do tipo, título, contexto com idade e link; a contagem fica no título', () => {
    render(<EsperaVoce espera={espera({ itens: [item()], total: 1 })} agora={AGORA} />)

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Espera você')
    expect(screen.getByText('1 item · o mais antigo há 2 h')).toBeVisible()
    const linha = within(screen.getByRole('list', { name: 'Espera você' })).getByRole('listitem')
    expect(within(linha).getByText('Integração')).toHaveAttribute('data-tom', 'erro')
    expect(within(linha).getByText('GitHub — Portal')).toBeVisible()
    expect(linha).toHaveTextContent('Indisponível · nenhuma sincronização concluída · há 2 h')
    expect(within(linha).getByRole('link', { name: 'Abrir o projeto' })).toHaveAttribute(
      'href',
      '/projetos/P/configuracao#repositorios',
    )
  })

  it('aviso da publicação com o run: leva à Publicação e ao run no GitHub', () => {
    render(
      <EsperaVoce
        espera={espera({
          itens: [
            item({
              tipo: 'publicacao',
              titulo:
                'CAIS parou: o deploy terminou, mas o site no ar mostra a versão 1111111, não 2222222',
              contexto: 'o workflow ficou verde, mas o site não trocou de versão',
              href: '/publicacao',
              rotuloDoLink: 'Ver a publicação',
              linkDoRun: 'https://github.com/o/cais/actions/runs/88',
            }),
          ],
          total: 1,
        })}
        agora={AGORA}
      />,
    )
    const linha = within(screen.getByRole('list', { name: 'Espera você' })).getByRole('listitem')
    expect(within(linha).getByText(/o site no ar mostra a versão 1111111/)).toBeVisible()
    expect(within(linha).getByRole('link', { name: 'Ver a publicação' })).toHaveAttribute(
      'href',
      '/publicacao',
    )
    const run = within(linha).getByRole('link', { name: /Ver o run no GitHub/ })
    expect(run).toHaveAttribute('href', 'https://github.com/o/cais/actions/runs/88')
    expect(run).toHaveAttribute('target', '_blank')
  })

  it('link externo tem target="_blank" e rel="noreferrer"', () => {
    render(
      <EsperaVoce
        espera={espera({
          itens: [
            item({
              tipo: 'decisao',
              href: 'https://github.com/o/r/issues/1',
              externo: true,
              rotuloDoLink: 'Responder no GitHub',
              tom: 'atencao',
              desde: null,
            }),
          ],
          total: 1,
        })}
        agora={AGORA}
      />,
    )
    const link = screen.getByRole('link', { name: /Responder no GitHub/ })
    expect(link).toHaveAttribute('href', 'https://github.com/o/r/issues/1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    expect(screen.queryByText(/há /)).toBeNull()
  })

  it('ocultos > 0 mostra "e mais N"', () => {
    render(
      <EsperaVoce espera={espera({ itens: [item()], total: 26, ocultos: 25 })} agora={AGORA} />,
    )
    expect(screen.getByText('e mais 25')).toBeVisible()
    expect(screen.getByText('26 itens · o mais antigo há 2 h')).toBeVisible()
  })

  it('fontes com falha aparecem pelo rótulo, e a lista vazia não diz que nada espera', () => {
    render(
      <EsperaVoce
        espera={espera({ fontesComFalha: ['aviso-da-oficina', 'integracao'] })}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('Não foi possível ler: Oficina, Integração.')).toBeVisible()
    expect(screen.queryByText('Nada espera você nas fontes disponíveis.')).toBeNull()
  })
})
