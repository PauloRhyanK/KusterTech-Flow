// Horário de São Paulo no formato das telas do escritório ("05h05" e "hoje, 05h05").
const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const DIA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
})

export function hora(instante: string | Date | null): string {
  if (!instante) return '··h··'
  const partes = HORA.formatToParts(new Date(instante))
  const h = partes.find((p) => p.type === 'hour')?.value ?? '··'
  const m = partes.find((p) => p.type === 'minute')?.value ?? '··'
  return `${h}h${m}`
}

/** "hoje", "amanhã" ou a data, mais o horário. */
export function quando(instante: string, agora: Date): string {
  const alvo = DIA.format(new Date(instante))
  const hoje = DIA.format(agora)
  const amanha = DIA.format(new Date(agora.getTime() + 86_400_000))
  const dia = alvo === hoje ? 'hoje' : alvo === amanha ? 'amanhã' : alvo
  return `${dia} por volta das ${hora(instante)}`
}
