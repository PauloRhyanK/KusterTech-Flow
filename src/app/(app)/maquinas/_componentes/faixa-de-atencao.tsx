import type { AvisoDaMaquina } from '@/modules/oficina/model'

const TITULO_DO_AVISO: Record<AvisoDaMaquina['tipo'], string> = {
  memoria: 'Memória apertada',
  disco: 'Disco cheio',
  limpeza: 'Limpeza',
  arquivo: 'Aviso da oficina',
}

// Só aparece quando algum limite da oficina foi passado.
export function FaixaDeAtencao({ avisos }: { avisos: readonly AvisoDaMaquina[] }) {
  if (avisos.length === 0) return null
  return (
    <section
      aria-label="Atenção"
      className="rounded-compacto border border-atencao/30 bg-tonal-atencao px-3.5 py-2.5 text-[13px] text-text-primary"
    >
      <ul className="space-y-1">
        {avisos.map((aviso, i) => (
          <li key={`${aviso.tipo}-${i}`} className="[overflow-wrap:anywhere]">
            <b className="font-[650] text-atencao">{TITULO_DO_AVISO[aviso.tipo]}:</b>{' '}
            {aviso.mensagem}
          </li>
        ))}
      </ul>
    </section>
  )
}
