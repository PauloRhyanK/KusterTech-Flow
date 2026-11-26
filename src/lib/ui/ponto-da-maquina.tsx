// Ponto de estado de uma máquina lida pelo Beszel. Sem verde (invariante 9): lendo é neutro,
// atenção é laranja e sem resposta é vazado.
const CLASSE: Record<'neutro' | 'atencao' | 'sem_resposta', string> = {
  neutro: 'bg-neutro',
  atencao: 'bg-atencao',
  sem_resposta: 'border-[1.5px] border-text-tertiary bg-transparent',
}

export function PontoDaMaquina({ tom }: { tom: 'neutro' | 'atencao' | 'sem_resposta' }) {
  return (
    <span
      aria-hidden="true"
      data-tom={tom}
      className={`inline-block size-2 flex-none rounded-full ${CLASSE[tom]}`}
    />
  )
}
