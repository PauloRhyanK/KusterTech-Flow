import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import type { EstadosDePublicacao } from '@/modules/publicacao/model'

export interface EstadosDaPublicacaoProps {
  estados: EstadosDePublicacao
}

// D68: homologação QA, autorização PROD, deploy efetivo e verificação variam de forma independente.
export function EstadosDaPublicacao({ estados }: EstadosDaPublicacaoProps) {
  const linhas = [
    ['Homologação QA', estados.qa],
    ['Autorização PROD', estados.autorizacao],
    ['Deploy em PROD', estados.deploy],
    ['Verificação em produção', estados.verificacao],
  ] as const

  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
      {linhas.map(([termo, estado]) => (
        <div key={termo} className="contents">
          <dt className="text-text-secondary">{termo}</dt>
          <dd>
            <BadgeDeEstado tom={estado.tom}>{estado.texto}</BadgeDeEstado>
          </dd>
        </div>
      ))}
    </dl>
  )
}
