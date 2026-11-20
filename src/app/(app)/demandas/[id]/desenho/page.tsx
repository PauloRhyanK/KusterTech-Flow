import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterPaginaDaDemanda } from '@/modules/demandas/queries'
import { QuadroDoDesenho } from '../../_componentes/canvas-do-desenho'
import { DecisaoNaTelaCheia } from '../../_componentes/faixa-da-espera'

// O desenho ocupando a tela inteira, estilo canvas (spec §4.4): cobre o menu e a barra do app.
export default async function DesenhoEmTelaCheia({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina
          trilhas={[{ rotulo: 'Demandas', href: '/demandas' }, { rotulo: 'Desenho' }]}
          titulo="Desenho"
        />
        <SemPermissao />
      </div>
    )
  }

  const { id } = await params
  const p = await obterPaginaDaDemanda(sessao.sujeito, id, new Date())
  if (!p?.desenho) notFound()
  const esperaAprovacao = p.podeAgir && (p.faixa?.acoes.includes('aprovar') ?? false)

  return (
    <div className="fixed inset-0 z-50 bg-surface">
      <h1 className="sr-only">{`Desenho · ${p.desenho.nome}`}</h1>
      <QuadroDoDesenho demandaId={p.id} desenho={p.desenho} className="h-full" />
      <Link
        href={`/demandas/${p.id}`}
        className="fixed top-3 left-3 rounded-compacto border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-text-link shadow-md hover:underline"
      >
        <span aria-hidden="true">← </span>Voltar à demanda
      </Link>
      {esperaAprovacao && (
        <div className="fixed right-3 bottom-3">
          <DecisaoNaTelaCheia demandaId={p.id} versao={p.desenho.versao} />
        </div>
      )}
    </div>
  )
}
