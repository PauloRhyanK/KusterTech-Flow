import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { lerGrupoExpandido, tiposDePendenciaVisiveis } from '@/modules/visao-geral/model'
import { obterVisaoGeral } from '@/modules/visao-geral/queries'
import {
  obterIndicadoresDeInfraestrutura,
  obterResumoDeProjetos,
} from '@/modules/visao-geral/resumos'
import { Pendencias } from './_visao-geral/pendencias'
import { ResumoDeInfraestrutura } from './_visao-geral/resumo-de-infraestrutura'
import { ResumoDeProjetos } from './_visao-geral/resumo-de-projetos'

export const metadata: Metadata = {
  title: 'Visão Geral',
}

export interface PaginaVisaoGeralProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PaginaVisaoGeral({ searchParams }: PaginaVisaoGeralProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }
  const { sujeito } = sessao

  const agora = new Date()
  const expandido = lerGrupoExpandido(await searchParams, tiposDePendenciaVisiveis(sujeito))
  const [visao, projetos, infraestrutura] = await Promise.all([
    obterVisaoGeral(sujeito, { expandido, agora }),
    obterResumoDeProjetos(sujeito, agora),
    autorizar(sujeito, 'infraestrutura.ler')
      ? obterIndicadoresDeInfraestrutura(sujeito)
      : Promise.resolve(null),
  ])

  return (
    <div className="space-y-8">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Visão Geral' }]}
        titulo="Visão Geral"
        contexto={
          visao.escopo === 'cliente'
            ? 'Pendências dos seus clientes'
            : 'Pendências prioritárias; resumos de projetos e infraestrutura'
        }
      />
      <Pendencias
        grupos={visao.grupos}
        fontesSemDados={visao.fontesSemDados}
        escopo={visao.escopo}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <ResumoDeProjetos resumo={projetos} />
        {infraestrutura && <ResumoDeInfraestrutura resumo={infraestrutura} />}
      </div>
    </div>
  )
}
