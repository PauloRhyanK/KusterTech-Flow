// Relato de exemplo no formato do fio (Flow.ia /v1), para os testes. Só dados fictícios.
export const ID_A = '019a0000-0000-7000-8000-00000000000a'
export const ID_B = '019a0000-0000-7000-8000-00000000000b'

export function relatoDeExemplo(p: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID_A,
    em: '2026-11-26T13:00:00.000Z',
    canal: 'whatsapp',
    resultado: 'segue',
    ticket: 'R-0001',
    tipo: 'defeito',
    autor: { id: 'u-1', nome: 'Ana Lima', papel: 'Assessora' },
    texto: 'A tela de pedidos não abre\nAparece um erro em branco.',
    transcricao: null,
    anexos: [],
    contexto: { tela: null, versao: null },
    sinais: [],
    cursor: '2',
    ...p,
  }
}
