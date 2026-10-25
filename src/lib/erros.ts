export class ErroDeDominio extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroDeDominio'
  }
}
