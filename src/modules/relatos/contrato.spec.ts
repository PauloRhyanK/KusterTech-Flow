import { describe, expect, test } from 'vitest'
import { lerPagina, RELATOS_POR_PAGINA } from './contrato'
import { ID_A, ID_B, relatoDeExemplo } from './exemplos'

const sem = (o: Record<string, unknown>, chave: string) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== chave))

describe('lerPagina', () => {
  test('aceita o envelope real { relatos, cursor } e diz que não há mais quando veio menos que o limite', () => {
    const r = lerPagina({ relatos: [relatoDeExemplo()], cursor: '2' }, RELATOS_POR_PAGINA)
    expect(r).toMatchObject({ ok: true, cursor: '2', mais: false })
    if (!r.ok) throw new Error('esperava ok')
    expect(r.relatos[0]).toMatchObject({ id: ID_A, ticket: 'R-0001', resultado: 'segue' })
  })

  test('página cheia → mais: true', () => {
    const relatos = [relatoDeExemplo({ id: ID_A }), relatoDeExemplo({ id: ID_B })]
    expect(lerPagina({ relatos, cursor: '9' }, 2)).toMatchObject({ ok: true, mais: true })
  })

  test('descarta campo extra do relato e do autor (telefone não chega ao objeto)', () => {
    const r = lerPagina(
      {
        relatos: [
          relatoDeExemplo({
            telefone: '+55 11 90000-0000',
            autor: { id: 'u-1', nome: 'Ana', papel: 'A', email: 'a@exemplo.com' },
          }),
        ],
        cursor: '2',
      },
      50,
    )
    if (!r.ok) throw new Error(r.motivo)
    expect(JSON.stringify(r.relatos[0])).not.toMatch(/telefone|90000|email/)
  })

  test('sinais, anexos de vídeo e arquivo e contexto com tela são aceitos', () => {
    const r = lerPagina(
      {
        relatos: [
          relatoDeExemplo({
            anexos: [
              { tipo: 'video', url: 'https://alfa.exemplo.com/v1/relatos/anexos/x', bytes: 10 },
              { tipo: 'arquivo', url: 'https://alfa.exemplo.com/v1/relatos/anexos/y', bytes: 20 },
            ],
            contexto: { tela: 'Pedidos', versao: '2.3' },
            sinais: [
              {
                tipo: 'urgencia',
                autor: { id: 'u-2', nome: 'Bruno Reis', papel: 'Gestor' },
                texto: 'Cliente esperando',
                em: '2026-11-26T14:00:00.000Z',
              },
            ],
          }),
        ],
        cursor: '3',
      },
      50,
    )
    if (!r.ok) throw new Error(r.motivo)
    expect(r.relatos[0]!.anexos).toHaveLength(2)
    expect(r.relatos[0]!.sinais[0]).toMatchObject({ tipo: 'urgencia', texto: 'Cliente esperando' })
    expect(r.relatos[0]!.contexto).toEqual({ tela: 'Pedidos', versao: '2.3' })
  })

  test('envelope torto → "A resposta do sistema não segue o contrato."', () => {
    expect(lerPagina({ relatos: [] }, 50)).toEqual({
      ok: false,
      motivo: 'A resposta do sistema não segue o contrato.',
    })
    expect(lerPagina({ relatos: [], cursor: null }, 50)).toMatchObject({ ok: false })
    expect(lerPagina('oi', 50)).toMatchObject({ ok: false })
  })

  test('relato sem autor recusa a página com o id e o caminho do erro', () => {
    const semAutor = sem(relatoDeExemplo({ id: ID_B }), 'autor')
    expect(lerPagina({ relatos: [relatoDeExemplo(), semAutor], cursor: '3' }, 50)).toEqual({
      ok: false,
      motivo: `O relato ${ID_B} não segue o contrato: autor.`,
    })
  })

  test('relato sem id recusa pela posição; canal "email" recusa', () => {
    const semId = sem(relatoDeExemplo(), 'id')
    expect(lerPagina({ relatos: [semId], cursor: '3' }, 50)).toEqual({
      ok: false,
      motivo: 'O relato na posição 1 não segue o contrato: id.',
    })
    expect(
      lerPagina({ relatos: [relatoDeExemplo({ canal: 'email' })], cursor: '3' }, 50),
    ).toMatchObject({
      ok: false,
    })
  })

  test('caractere de controle no nome do autor recusa', () => {
    const r = lerPagina(
      {
        relatos: [relatoDeExemplo({ autor: { id: 'u', nome: 'An\u0007a', papel: '' } })],
        cursor: '1',
      },
      50,
    )
    expect(r).toMatchObject({ ok: false })
  })
})
