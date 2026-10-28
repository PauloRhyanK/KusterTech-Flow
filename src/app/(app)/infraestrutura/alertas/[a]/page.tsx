import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { apresentarEstadoDoAlerta, apresentarSeveridade } from '@/modules/infra/model'
import { obterAlerta } from '@/modules/infra/queries'
import { DetalheDoAlerta } from '../../_componentes/detalhe-do-alerta'

export interface PaginaAlertaProps {
  params: Promise<{ a: string }>
}

// A página e o generateMetadata leem o alerta uma vez por requisição.
const obterAlertaDaPagina = cache(obterAlerta)

export async function generateMetadata({ params }: PaginaAlertaProps): Promise<Metadata> {
  const { a } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Alerta' }
  }
  try {
    const alerta = await obterAlertaDaPagina(sessao.sujeito, a)
    return { title: alerta.titulo }
  } catch {
    return { title: 'Alerta' }
  }
}

export default async function PaginaAlerta({ params }: PaginaAlertaProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { a } = await params

  let alerta: Awaited<ReturnType<typeof obterAlertaDaPagina>>
  try {
    alerta = await obterAlertaDaPagina(sessao.sujeito, a)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina
            trilhas={[
              { rotulo: 'Infraestrutura', href: '/infraestrutura' },
              { rotulo: 'Alertas', href: '/infraestrutura/alertas' },
              { rotulo: 'Alerta' },
            ]}
            titulo="Alerta"
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

  const estado = apresentarEstadoDoAlerta(alerta.estado)
  const severidade = apresentarSeveridade(alerta.severidade)

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[
          { rotulo: 'Infraestrutura', href: '/infraestrutura' },
          { rotulo: 'Alertas', href: '/infraestrutura/alertas' },
          { rotulo: alerta.titulo },
        ]}
        titulo={alerta.titulo}
        situacao={
          <div className="flex flex-wrap items-center gap-1.5">
            <BadgeDeEstado tom={severidade.tom}>{severidade.texto}</BadgeDeEstado>
            <BadgeDeEstado tom={estado.tom}>{estado.texto}</BadgeDeEstado>
          </div>
        }
      />
      <DetalheDoAlerta
        alerta={alerta}
        podeGerenciar={autorizar(sessao.sujeito, 'infraestrutura.gerenciar')}
      />
    </div>
  )
}
