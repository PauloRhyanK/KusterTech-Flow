import type { TomDaDemanda, iconeDoTipo } from '@/modules/demandas/apresentacao'
import { cn } from '@/lib/utils'

const TOM: Record<TomDaDemanda, string> = {
  erro: 'bg-tonal-erro text-erro',
  atencao: 'bg-tonal-atencao text-atencao',
  informacao: 'bg-tonal-informacao text-informacao',
  execucao: 'bg-tonal-execucao text-execucao',
  neutro: 'bg-tonal-neutro text-neutro',
}

const NOME: Record<ReturnType<typeof iconeDoTipo>['letra'], string> = {
  B: 'Defeito',
  I: 'Ideia',
  A: 'Ajuste',
  F: 'Função nova',
  '?': 'Sem tipo ainda',
}

export function IconeDoTipo({ icone }: { icone: ReturnType<typeof iconeDoTipo> }) {
  return (
    <span
      title={NOME[icone.letra]}
      data-tom={icone.tom}
      className={cn(
        'grid size-[30px] shrink-0 place-items-center rounded-compacto text-xs font-bold',
        TOM[icone.tom],
      )}
    >
      {icone.letra}
    </span>
  )
}
