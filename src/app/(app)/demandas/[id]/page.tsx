import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterPaginaDaDemanda } from '@/modules/demandas/queries'
import { CanvasDoDesenho } from '../_componentes/canvas-do-desenho'
import { EntregaLadoALado } from '../_componentes/entrega-lado-a-lado'
import { FaixaDaEspera } from '../_componentes/faixa-da-espera'
import { HistoricoDaDemanda } from '../_componentes/historico-da-demanda'
import { IconeDoTipo } from '../_componentes/icone-do-tipo'
import { QuadrosDeImpacto } from '../_componentes/quadros-de-impacto'
import { TrilhoGrande } from '../_componentes/trilho-grande'

export default async function PaginaDaDemanda({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina
          trilhas={[{ rotulo: 'Demandas', href: '/demandas' }, { rotulo: 'Demanda' }]}
          titulo="Demanda"
        />
        <SemPermissao />
      </div>
    )
  }

  const { id } = await params
  const p = await obterPaginaDaDemanda(sessao.sujeito, id, new Date())
  if (!p) notFound()

  return (
    <div className="space-y-5">
      <header className="space-y-1.5">
        <Link href="/demandas" className="block text-[13px] text-text-link hover:underline">
          <span aria-hidden="true">← </span>Demandas
        </Link>
        <div className="flex flex-wrap items-center gap-3.5">
          <IconeDoTipo icone={p.icone} />
          <h1 className="min-w-0 text-[21px] font-[650] leading-[1.25] tracking-[-0.02em] text-text-primary md:text-2xl">
            {p.titulo}
          </h1>
          {p.entrega && (
            <span className="ml-auto inline-flex items-center rounded-[6px] border border-sucesso/30 bg-tonal-sucesso px-2.5 py-0.5 text-[12.5px] font-[600] text-sucesso">
              {p.entrega}
            </span>
          )}
        </div>
        <ul aria-label="Sobre a demanda" className="flex flex-wrap gap-2 pt-1">
          {p.chips.map((c) => (
            <li
              key={c}
              className="whitespace-nowrap rounded-[6px] bg-surface-subtle px-2 py-0.5 text-xs text-text-secondary"
            >
              {c}
            </li>
          ))}
        </ul>
      </header>

      <TrilhoGrande pontos={p.trilho} />

      {p.faixa && (
        <FaixaDaEspera
          demandaId={p.id}
          versao={p.desenho?.versao ?? 0}
          etapaAtual={p.etapaAtual}
          podeAgir={p.podeAgir}
          faixa={p.faixa}
        />
      )}

      {p.entrega ? (
        <EntregaLadoALado
          demandaId={p.id}
          desenho={p.desenho}
          temTela={p.temTela}
          capturas={p.capturas}
          capturasApagadasEm={p.capturasApagadasEm}
        />
      ) : (
        <>
          <QuadrosDeImpacto
            quadros={p.impacto.quadros}
            podeQuebrar={p.impacto.podeQuebrar}
            pilulas={p.impacto.pilulas}
          />
          {p.desenho ? (
            <CanvasDoDesenho demandaId={p.id} desenho={p.desenho} artefatoUrl={p.artefatoUrl} />
          ) : (
            p.artefatoUrl && (
              <a
                href={p.artefatoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm font-medium text-text-link hover:underline"
              >
                Ver o artefato do Claude <span aria-hidden="true">↗</span>
              </a>
            )
          )}
        </>
      )}

      <HistoricoDaDemanda eventos={p.historico} />
    </div>
  )
}
