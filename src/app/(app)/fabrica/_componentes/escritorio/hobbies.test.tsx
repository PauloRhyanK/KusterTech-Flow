import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { CLASSE_DO_HOBBY, CantoDoHobby, HOBBY_DO_PAPEL, hobbyDoPapel } from './hobbies'

test.each(Object.entries(HOBBY_DO_PAPEL))(
  'papel %s tem o hobby %s e um canto desenhado',
  (papel, hobby) => {
    expect(hobbyDoPapel(papel)).toBe(hobby)
    const { container } = render(<CantoDoHobby hobby={hobby} />)
    expect(container.querySelector(`[data-hobby="${hobby}"] svg`)).not.toBeNull()
  },
)

test('conserto e papel desconhecido não têm hobby', () => {
  expect(hobbyDoPapel('fixer')).toBeNull()
  expect(hobbyDoPapel(null)).toBeNull()
  expect(hobbyDoPapel('inexistente')).toBeNull()
  expect(hobbyDoPapel('constructor')).toBeNull()
  expect(hobbyDoPapel('toString')).toBeNull()
})

test('canto não tem texto', () => {
  for (const h of Object.values(HOBBY_DO_PAPEL))
    expect(render(<CantoDoHobby hobby={h} />).container.textContent).toBe('')
})

test('todo hobby tem classe de animação esc-hobby-*', () => {
  for (const h of new Set(Object.values(HOBBY_DO_PAPEL)))
    expect(CLASSE_DO_HOBBY[h]).toBe(`esc-hobby-${h}`)
})

test('a tinta fica dentro do contêiner que recorta a tela do cavalete', () => {
  const { container } = render(<CantoDoHobby hobby="pintar" />)
  const tela = container.querySelector('.esc-quadro-tela')
  expect(tela).not.toBeNull()
  expect(tela!.querySelectorAll('.esc-tinta').length).toBeGreaterThan(0)
  expect(container.querySelectorAll('.esc-tinta').length).toBe(
    tela!.querySelectorAll('.esc-tinta').length,
  )
})

test('poltrona tem camada de fundo e de frente', () => {
  const { container } = render(<CantoDoHobby hobby="leitura" />)
  expect(container.querySelector('[data-camada="fundo"]')).not.toBeNull()
  expect(container.querySelector('[data-camada="frente"]')).not.toBeNull()
})
