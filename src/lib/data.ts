const FORMATADOR = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
})

export function formatarDataHora(data: Date): string {
  return FORMATADOR.format(data).replace(', ', ' ')
}

const FORMATADOR_DE_DATA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  dateStyle: 'short',
})

export function formatarData(data: Date): string {
  return FORMATADOR_DE_DATA.format(data)
}
