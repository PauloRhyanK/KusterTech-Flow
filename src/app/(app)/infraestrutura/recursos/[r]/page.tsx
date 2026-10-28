import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { rotuloDoTipo } from '@/modules/infra/model'
import { listarAlertasDoRecurso, obterRecursoDaPagina } from '@/modules/infra/queries'
import { DetalheDoRecurso } from '../../_componentes/detalhe-do-recurso'

export interface PaginaRecursoProps {
  params: Promise<{ r: string }>
}

export async function generateMetadata({ params }: PaginaRecursoProps): Promise<Metadata> {
  const { r } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Recurso' }
  }
  try {
    const recurso = await obterRecursoDaPagina(sessao.sujeito, r)
    return { title: recurso.nome }
  } catch {
    return { title: 'Recurso' }
  }
}

export default async function PaginaRecurso({ params }: PaginaRecursoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { r } = await params

  let recurso: Awaited<ReturnType<typeof obterRecursoDaPagina>>
  try {
    recurso = await obterRecursoDaPagina(sessao.sujeito, r)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina
            trilhas={[{ rotulo: 'Infraestrutura', href: '/infraestrutura' }, { rotulo: 'Recurso' }]}
            titulo="Recurso"
          />
          <SemPermissao />
        </div>
      )
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  const alertas = await listarAlertasDoRecurso(sessao.sujeito, r)

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Infraestrutura', href: '/infraestrutura' }, { rotulo: recurso.nome }]}
        titulo={recurso.nome}
        situacao={
          <div className="flex flex-wrap items-center gap-1.5">
            <BadgeDeEstado tom="neutro">{rotuloDoTipo(recurso.tipo)}</BadgeDeEstado>
            <BadgeDeEstado tom={recurso.situacao.tom}>{recurso.situacao.texto}</BadgeDeEstado>
          </div>
        }
      />
      <DetalheDoRecurso recurso={recurso} alertas={alertas} />
    </div>
  )
}
