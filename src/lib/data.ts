const FORMATADOR = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
})

export function formatarDataHora(data: Date): string {
  return FORMATADOR.format(data).replace(', ', ' ')
}
