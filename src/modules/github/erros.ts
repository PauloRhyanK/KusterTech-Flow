import { mensagemDeFalha, type CategoriaDeFalha } from './model'

export class ErroDeIntegracao extends Error {
  readonly categoria: CategoriaDeFalha
  readonly tentarApos?: Date
  /** O que já aconteceu antes da falha, para quem chama não repetir. */
  readonly progresso?: Readonly<Record<string, boolean>>

  constructor(
    categoria: CategoriaDeFalha,
    tentarApos?: Date,
    progresso?: Readonly<Record<string, boolean>>,
  ) {
    super(mensagemDeFalha(categoria))
    this.name = 'ErroDeIntegracao'
    this.categoria = categoria
    this.tentarApos = tentarApos
    this.progresso = progresso
  }
}
