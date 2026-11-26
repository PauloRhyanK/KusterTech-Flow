import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { DESTINOS } from '@/modules/demandas/contrato'
import type { Destino } from '@/modules/demandas/model'
import { obterListaDeDemandas } from '@/modules/demandas/queries'
import { ListaDeDemandas, QuadrosAteOAr } from './_componentes/lista-de-demandas'

const TRILHAS = [{ rotulo: 'Demandas' }]

function lerDestino(valor: string | string[] | undefined): Destino | null {
  return typeof valor === 'string' && (DESTINOS as readonly string[]).includes(valor)
    ? (valor as Destino)
    : null
}

export default async function PaginaDasDemandas({
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
        <CabecalhoDePagina trilhas={TRILHAS} titulo="Demandas" />
        <SemPermissao />
      </div>
    )
  }

  const filtro = lerDestino((await searchParams).destino)
  const tela = await obterListaDeDemandas(sessao.sujeito, filtro, new Date())

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={TRILHAS}
        titulo="Demandas"
        contexto="últimos 30 dias"
        situacao={
          tela.fabricaSemBuscar && (
            <p role="status" className="text-sm font-[550] text-atencao">
              {tela.fabricaSemBuscar}
            </p>
          )
        }
        acoes={
          tela.podeCriar && (
            <Link href="/demandas/nova" className={buttonVariants()}>
              Nova demanda
            </Link>
          )
        }
      />
      <QuadrosAteOAr quadros={tela.quadros} />
      {filtro && (
        <Link href="/demandas" className="inline-block text-sm text-text-link hover:underline">
          <span aria-hidden="true">← </span>Todas as demandas
        </Link>
      )}
      <ListaDeDemandas grupos={tela.grupos} filtrada={filtro !== null} />
      {!filtro && tela.orientadasHoje > 0 && (
        <Link
          href="/demandas?destino=orientada"
          className="inline-block text-[12.5px] text-text-tertiary hover:text-text-link hover:underline"
        >
          {tela.orientadasHoje} {tela.orientadasHoje === 1 ? 'orientada' : 'orientadas'} hoje
        </Link>
      )}
    </div>
  )
}
