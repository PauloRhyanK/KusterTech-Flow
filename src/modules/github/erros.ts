import { mensagemDeFalha, type CategoriaDeFalha } from './model'

export class ErroDeIntegracao extends Error {
  readonly categoria: CategoriaDeFalha
  readonly tentarApos?: Date

  constructor(categoria: CategoriaDeFalha, tentarApos?: Date) {
    super(mensagemDeFalha(categoria))
    this.name = 'ErroDeIntegracao'
    this.categoria = categoria
    this.tentarApos = tentarApos
  }
}
