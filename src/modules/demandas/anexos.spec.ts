import { describe, expect, test } from 'vitest'
import { descreverTamanho, juntarAnexos, MAXIMO_DE_ANEXOS } from './anexos'

const arquivo = (name: string, type: string, size = 1000) => ({ name, type, size })

describe('juntarAnexos', () => {
  test('acrescenta imagem e áudio aceitos', () => {
    const r = juntarAnexos([], [arquivo('tela.png', 'image/png'), arquivo('fala.ogg', 'audio/ogg')])
    expect(r.arquivos.map((a) => a.name)).toEqual(['tela.png', 'fala.ogg'])
    expect(r.erro).toBeNull()
  })

  test('recusa tipo não aceito e arquivo acima de 10 MB, dizendo qual', () => {
    const r = juntarAnexos(
      [],
      [
        arquivo('doc.pdf', 'application/pdf'),
        arquivo('grande.png', 'image/png', 10 * 1024 * 1024 + 1),
        arquivo('ok.jpg', 'image/jpeg'),
      ],
    )
    expect(r.arquivos.map((a) => a.name)).toEqual(['ok.jpg'])
    expect(r.erro).toBe(
      'doc.pdf: só imagem (PNG, JPEG, WebP) ou áudio. grande.png: passa de 10 MB.',
    )
  })

  test('para no máximo de 3 anexos', () => {
    const atuais = [arquivo('a.png', 'image/png'), arquivo('b.png', 'image/png')]
    const r = juntarAnexos(atuais, [arquivo('c.png', 'image/png'), arquivo('d.png', 'image/png')])
    expect(r.arquivos.map((a) => a.name)).toEqual(['a.png', 'b.png', 'c.png'])
    expect(r.erro).toBe(`Até ${MAXIMO_DE_ANEXOS} anexos: d.png ficou de fora.`)
  })

  test('não repete o mesmo arquivo', () => {
    const a = arquivo('a.png', 'image/png')
    const r = juntarAnexos([a], [arquivo('a.png', 'image/png')])
    expect(r.arquivos).toHaveLength(1)
    expect(r.erro).toBeNull()
  })
})

describe('descreverTamanho', () => {
  test('em KB abaixo de 1 MB e em MB acima', () => {
    expect(descreverTamanho(2048)).toBe('2 KB')
    expect(descreverTamanho(3.5 * 1024 * 1024)).toBe('3,5 MB')
  })
})
