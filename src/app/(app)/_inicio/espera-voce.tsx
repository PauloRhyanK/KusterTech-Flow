import Link from 'next/link'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import {
  ROTULO_DO_TIPO,
  formatarIdade,
  type EsperaVoce as Espera,
  type ItemDeEspera,
} from '@/modules/inicio/model'
import { CLASSE_DO_CARTAO, CLASSE_DO_LINK, TituloDeSecao } from '@/lib/ui/titulo-de-secao'

export interface EsperaVoceProps {
  espera: Espera
  agora: Date
}

function LinkDoItem({ item }: { item: ItemDeEspera }) {
  if (item.externo) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={CLASSE_DO_LINK}>
        {item.rotuloDoLink} <span aria-hidden="true">↗</span>
      </a>
    )
  }
  return (
    <Link href={item.href} className={CLASSE_DO_LINK}>
      {item.rotuloDoLink}
    </Link>
  )
}

export function EsperaVoce({ espera, agora }: EsperaVoceProps) {
  const { itens, total, ocultos, fontesComFalha } = espera
  const datas = itens.flatMap((i) => (i.desde ? [i.desde.getTime()] : []))
  const maisAntigo = datas.length > 0 ? new Date(Math.min(...datas)) : null
  return (
    <section aria-labelledby="titulo-espera-voce">
      <TituloDeSecao
        id="titulo-espera-voce"
        complemento={
          total > 0 && (
            <span className="text-[13px] text-text-tertiary">
              {total === 1 ? '1 item' : `${total} itens`}
              {maisAntigo && ` · o mais antigo ${formatarIdade(maisAntigo, agora)}`}
            </span>
          )
        }
      >
        Espera você
      </TituloDeSecao>

      <div className={CLASSE_DO_CARTAO}>
        {itens.length > 0 && (
          <ul aria-label="Espera você" className="divide-y divide-border">
            {itens.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:flex-nowrap"
              >
                <BadgeDeEstado tom={item.tom} className="shrink-0">
                  {ROTULO_DO_TIPO[item.tipo]}
                </BadgeDeEstado>
                <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                  <p className="text-sm font-medium text-text-primary">{item.titulo}</p>
                  <p className="text-[13px] text-text-secondary">
                    {item.contexto}
                    {item.desde && ` · ${formatarIdade(item.desde, agora)}`}
                  </p>
                </div>
                <LinkDoItem item={item} />
              </li>
            ))}
          </ul>
        )}
        {itens.length === 0 && fontesComFalha.length === 0 && (
          <p className="px-4 py-3 text-sm text-text-secondary">
            Nada espera você nas fontes disponíveis.
          </p>
        )}
        {ocultos > 0 && (
          <p className="border-t border-border px-4 py-2.5 text-[13px] text-text-secondary">
            e mais {ocultos}
          </p>
        )}
        {fontesComFalha.length > 0 && (
          <p
            role="status"
            className={`px-4 py-2.5 text-[13px] text-atencao ${itens.length > 0 ? 'border-t border-border' : ''}`}
          >
            Não foi possível ler: {fontesComFalha.map((t) => ROTULO_DO_TIPO[t]).join(', ')}.
          </p>
        )}
      </div>
    </section>
  )
}
