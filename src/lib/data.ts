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

const DATA_HORA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

// Lê `YYYY-MM-DDTHH:mm` (campo datetime-local) como horário de São Paulo (-03:00).
export function lerDataHoraDeSaoPaulo(valor: string): Date | null {
  if (!DATA_HORA_LOCAL.test(valor)) {
    return null
  }
  const data = new Date(`${valor}:00-03:00`)
  return Number.isNaN(data.getTime()) ? null : data
}

const FORMATADOR_DE_CUSTO = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

// Custo do run em dólares, como o Warren o informa: "0.538" → "US$ 0,538".
export function formatarCusto(valorUsd: string): string {
  return FORMATADOR_DE_CUSTO.format(Number(valorUsd))
}
