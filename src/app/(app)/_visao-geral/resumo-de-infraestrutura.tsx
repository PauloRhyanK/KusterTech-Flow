import Link from 'next/link'
import type { obterIndicadoresDeInfraestrutura } from '@/modules/visao-geral/resumos'
import { ListaDeIndicadores } from './lista-de-indicadores'

export interface ResumoDeInfraestruturaProps {
  resumo: Awaited<ReturnType<typeof obterIndicadoresDeInfraestrutura>>
}

export function ResumoDeInfraestrutura({ resumo }: ResumoDeInfraestruturaProps) {
  return (
    <section aria-labelledby="titulo-resumo-infraestrutura" className="space-y-3">
      <h2
        id="titulo-resumo-infraestrutura"
        className="text-[17px] font-[650] leading-[1.35] text-text-primary"
      >
        Infraestrutura
      </h2>
      <ListaDeIndicadores indicadores={resumo.indicadores} />
      <Link href={resumo.link.href} className="text-sm font-medium text-text-link hover:underline">
        {resumo.link.rotulo}
      </Link>
    </section>
  )
}
