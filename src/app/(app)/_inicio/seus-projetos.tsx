import Link from 'next/link'
import type { ResumoDeProjetos } from '@/modules/inicio/queries'
import { CLASSE_DO_CARTAO, CLASSE_DO_LINK, TituloDeSecao } from '@/lib/ui/titulo-de-secao'

export interface SeusProjetosProps {
  // Nulo quando a consulta falhou.
  resumo: ResumoDeProjetos | null
}

export function SeusProjetos({ resumo }: SeusProjetosProps) {
  return (
    <section aria-labelledby="titulo-seus-projetos" className="space-y-3">
      <TituloDeSecao id="titulo-seus-projetos">Seus projetos</TituloDeSecao>
      {resumo === null ? (
        <p role="status" className={`${CLASSE_DO_CARTAO} px-4 py-3 text-sm text-atencao`}>
          Não foi possível ler seus projetos.
        </p>
      ) : (
        <>
          <dl className={`${CLASSE_DO_CARTAO} divide-y divide-border overflow-hidden`}>
            {resumo.indicadores.map((indicador) => (
              <div
                key={indicador.rotulo}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <div className="min-w-0">
                  <dt className="text-[13px] font-medium text-text-primary">{indicador.rotulo}</dt>
                  <dd className="text-[13px] text-text-secondary">{indicador.detalhe}</dd>
                </div>
                <dd className="shrink-0 text-[15px] font-[650] text-text-primary">
                  {indicador.valor}
                </dd>
              </div>
            ))}
          </dl>
          <Link href={resumo.link.href} className={CLASSE_DO_LINK}>
            {resumo.link.rotulo}
          </Link>
        </>
      )}
    </section>
  )
}
