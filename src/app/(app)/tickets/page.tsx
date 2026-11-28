import Link from 'next/link'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { urlDosTickets } from '@/modules/tickets/model'
import { obterTelaDeTickets } from '@/modules/tickets/queries'
import { BarraDeFiltrosDosTickets } from './_componentes/barra-de-filtros-dos-tickets'
import { DetalheDoTicket } from './_componentes/detalhe-do-ticket'
import { ListaDeTickets } from './_componentes/lista-de-tickets'
import { QuadrosDosTickets } from './_componentes/quadros-dos-tickets'

const TRILHAS = [{ rotulo: 'Tickets' }]

const CONTEXTO_DO_PERIODO = {
  '7': 'últimos 7 dias',
  '30': 'últimos 30 dias',
  '90': 'últimos 90 dias',
  tudo: 'todo o período',
} as const

export default async function PaginaDosTickets({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={TRILHAS} titulo="Tickets" />
        <SemPermissao />
      </div>
    )
  }

  const params = await searchParams
  const tela = await obterTelaDeTickets(sessao.sujeito, params, new Date())
  const { filtros } = tela

  if (tela.semSistemas) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina
          trilhas={TRILHAS}
          titulo="Tickets"
          contexto="O que os usuários mandaram pelos apps"
        />
        <div className="rounded-padrao border border-border bg-surface p-6 text-sm text-text-secondary">
          <p className="font-[550] text-text-primary">Nenhum app conectado</p>
          <p className="mt-1">Conecte um app para ver aqui o que os usuários mandam por ele.</p>
          <Link
            href="/configuracoes/sistemas"
            className="mt-3 inline-block font-medium text-text-link hover:underline"
          >
            Conectar um app
          </Link>
        </div>
      </div>
    )
  }

  const comEscolha = tela.escolhido !== null

  return (
    <div className="space-y-5">
      <CabecalhoDePagina
        trilhas={TRILHAS}
        titulo="Tickets"
        contexto={CONTEXTO_DO_PERIODO[filtros.periodo]}
        situacao={
          tela.sistemasDesconectados.length > 0 && (
            <p role="status" className="text-sm font-[550] text-atencao">
              {tela.sistemasDesconectados.length === 1
                ? `${tela.sistemasDesconectados[0]} está desconectado: os tickets dele podem estar desatualizados.`
                : `${tela.sistemasDesconectados.join(', ')} estão desconectados: os tickets deles podem estar desatualizados.`}
            </p>
          )
        }
      />
      {/* No celular, com um ticket aberto, só o detalhe e o caminho de volta ocupam a tela. */}
      <div className={comEscolha ? 'hidden space-y-5 lg:block' : 'space-y-5'}>
        <QuadrosDosTickets quadros={tela.quadros} periodo={filtros.periodo} />
        <BarraDeFiltrosDosTickets filtros={filtros} opcoes={tela.opcoes} />
        {tela.truncado && (
          <p className="text-[12.5px] text-text-tertiary">
            {tela.total} tickets no período; mostrando os 300 mais recentes.
          </p>
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,44fr)_minmax(0,56fr)]">
        <div className={comEscolha ? 'hidden min-w-0 lg:block' : 'min-w-0'}>
          <ListaDeTickets grupos={tela.grupos} filtros={filtros} escolhidoId={filtros.t} />
          {tela.grupos.length === 0 && (
            <Link
              href="/tickets"
              className="inline-block text-sm font-medium text-text-link hover:underline"
            >
              Limpar filtros
            </Link>
          )}
        </div>
        <div className={comEscolha ? 'min-w-0' : 'hidden min-w-0 lg:block'}>
          {comEscolha && (
            <Link
              href={urlDosTickets(filtros, { t: null })}
              className="mb-3 inline-block text-[13px] text-text-link hover:underline lg:hidden"
            >
              <span aria-hidden="true">← </span>Voltar à lista
            </Link>
          )}
          <DetalheDoTicket ticket={tela.escolhido} filtros={filtros} emPagina={false} />
        </div>
      </div>
    </div>
  )
}
