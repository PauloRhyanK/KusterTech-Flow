import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { lerFiltrosDosTickets } from '@/modules/tickets/model'
import { obterTicket } from '@/modules/tickets/queries'
import { DetalheDoTicket } from '../_componentes/detalhe-do-ticket'

export default async function PaginaDoTicket({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const trilhas = [{ rotulo: 'Tickets', href: '/tickets' }, { rotulo: 'Ticket' }]
  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={trilhas} titulo="Ticket" />
        <SemPermissao />
      </div>
    )
  }

  const { id } = await params
  const ticket = await obterTicket(sessao.sujeito, id, new Date())
  if (!ticket) notFound()

  return (
    <div className="space-y-5">
      <Link href="/tickets" className="block text-[13px] text-text-link hover:underline">
        <span aria-hidden="true">← </span>Tickets
      </Link>
      <DetalheDoTicket ticket={ticket} filtros={lerFiltrosDosTickets({})} emPagina />
    </div>
  )
}
