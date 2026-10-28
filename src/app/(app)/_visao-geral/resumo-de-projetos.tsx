import Link from 'next/link'
import type { ResumoDeProjetos as Resumo } from '@/modules/visao-geral/resumos'
import { ListaDeIndicadores } from './lista-de-indicadores'

export interface ResumoDeProjetosProps {
  resumo: Resumo
}

export function ResumoDeProjetos({ resumo }: ResumoDeProjetosProps) {
  return (
    <section aria-labelledby="titulo-resumo-projetos" className="space-y-3">
      <h2
        id="titulo-resumo-projetos"
        className="text-[17px] font-[650] leading-[1.35] text-text-primary"
      >
        {resumo.escopo === 'cliente' ? 'Seus projetos' : 'Projetos'}
      </h2>
      <ListaDeIndicadores indicadores={resumo.indicadores} />
      <Link href={resumo.link.href} className="text-sm font-medium text-text-link hover:underline">
        {resumo.link.rotulo}
      </Link>
    </section>
  )
}
