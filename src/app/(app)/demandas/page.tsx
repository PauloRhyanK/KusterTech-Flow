import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { DESTINOS } from '@/modules/demandas/contrato'
import { ehModoTabela, lerFiltrosDaTabela, type Destino } from '@/modules/demandas/model'
import { obterListaDeDemandas } from '@/modules/demandas/queries'
import { BarraDeFiltros } from './_componentes/barra-de-filtros'
import { ListaDeDemandas, QuadrosAteOAr } from './_componentes/lista-de-demandas'
import { TabelaDeDemandas } from './_componentes/tabela-de-demandas'

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

  const params = await searchParams
  const filtro = lerDestino(params.destino)
  // Qualquer filtro de tabela na URL troca os grupos pela tabela; `destino` sozinho fica nos grupos.
  const filtros = lerFiltrosDaTabela(params)
  const emTabela = ehModoTabela(params)
  const tela = await obterListaDeDemandas(
    sessao.sujeito,
    filtro,
    new Date(),
    emTabela ? filtros : null,
  )

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
      <BarraDeFiltros filtros={filtros} opcoes={tela.opcoes} ativa={emTabela || filtro !== null} />
      {!tela.tabela && filtro && (
        <Link href="/demandas" className="inline-block text-sm text-text-link hover:underline">
          <span aria-hidden="true">← </span>Todas as demandas
        </Link>
      )}
      {tela.tabela ? (
        <TabelaDeDemandas tabela={tela.tabela} filtros={filtros} />
      ) : (
        <ListaDeDemandas grupos={tela.grupos} filtrada={filtro !== null} />
      )}
      {!tela.tabela && !filtro && tela.orientadasHoje > 0 && (
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
