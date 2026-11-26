import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterPaginaDaDemanda } from '@/modules/demandas/queries'
import { CanvasDoDesenho } from '../_componentes/canvas-do-desenho'
import { EncerrarDemanda } from '../_componentes/encerrar-demanda'
import { EntregaLadoALado } from '../_componentes/entrega-lado-a-lado'
import { EvidenciasDaDemanda } from '../_componentes/evidencias-da-demanda'
import { FaixaDaJuntada } from '../_componentes/faixa-da-juntada'
import { FaixaDaEspera } from '../_componentes/faixa-da-espera'
import { FaixaDoQueFalta } from '../_componentes/faixa-do-que-falta'
import { HistoricoDaDemanda } from '../_componentes/historico-da-demanda'
import { PartesDaDemanda } from '../_componentes/partes-da-demanda'
import { QuadrosDeImpacto } from '../_componentes/quadros-de-impacto'
import { TrilhoAteOAr } from '../_componentes/trilho-ate-o-ar'

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
  const agora = new Date()
  const p = await obterPaginaDaDemanda(sessao.sujeito, id, agora)
  if (!p) notFound()

  const cabecalho = (
    <header className="space-y-1.5">
      <Link href="/demandas" className="block text-[13px] text-text-link hover:underline">
        <span aria-hidden="true">← </span>Demandas
      </Link>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="min-w-0 text-[21px] font-[650] leading-[1.25] tracking-[-0.02em] text-text-primary md:text-2xl">
          {p.titulo}
        </h1>
        <span className="text-[13px] text-text-tertiary">{p.subtitulo}</span>
        {p.entrega && (
          <span className="ml-auto inline-flex items-center rounded-[6px] border border-sucesso/30 bg-tonal-sucesso px-2.5 py-0.5 text-[12.5px] font-[600] text-sucesso">
            {p.entrega}
          </span>
        )}
      </div>
    </header>
  )

  // A demanda juntada pela triagem não tem trabalho: a faixa leva à demanda de destino.
  if (p.juntadaEm) {
    return (
      <div className="space-y-5">
        {cabecalho}
        <FaixaDaJuntada demandaId={p.id} juntadaEm={p.juntadaEm} />
        <HistoricoDaDemanda eventos={p.historico} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {cabecalho}

      <TrilhoAteOAr grande pontos={p.trilho} />

      <EvidenciasDaDemanda evidencias={p.evidencias} agora={agora} />

      {p.descartada && (
        <p
          role="status"
          className="rounded-padrao border border-border bg-surface-subtle px-4 py-3 text-sm text-text-secondary"
        >
          Você encerrou esta demanda. A Fábrica não trabalha mais nela.
        </p>
      )}

      {p.faixa && (
        <FaixaDaEspera
          demandaId={p.id}
          versao={p.desenho?.versao ?? 0}
          etapaAtual={p.etapaAtual}
          podeAgir={p.podeAgir}
          faixa={p.faixa}
        />
      )}

      {p.falta && <FaixaDoQueFalta demandaId={p.id} falta={p.falta} />}

      {/* A triagem só ajuda quando a decisão é do Paulo. */}
      {p.faixa && (
        <QuadrosDeImpacto
          quadros={p.impacto.quadros}
          podeQuebrar={p.impacto.podeQuebrar}
          pilulas={p.impacto.pilulas}
        />
      )}

      <PartesDaDemanda ordem={p.ordem} partes={p.partes} />

      {p.entrega ? (
        <EntregaLadoALado
          demandaId={p.id}
          desenho={p.desenho}
          temTela={p.temTela}
          capturas={p.capturas}
          capturasApagadasEm={p.capturasApagadasEm}
        />
      ) : p.desenho ? (
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

      <HistoricoDaDemanda eventos={p.historico} />

      {p.podeEncerrar && !p.faixa?.encerrar && <EncerrarDemanda demandaId={p.id} />}
    </div>
  )
}
