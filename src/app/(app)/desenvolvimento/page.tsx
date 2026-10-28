import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { autorizar, type Sujeito } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import {
  lerFiltrosDaFila,
  lerVisao,
  listarExecucoesAgrupadas,
  listarFilaDeDesenvolvimento,
  type FiltrosDaFila,
} from '@/modules/desenvolvimento/queries'
import { cn } from '@/lib/utils'
import { ExecucoesAgrupadas } from './_componentes/execucoes-agrupadas'
import { FilaDeDesenvolvimento } from './_componentes/fila-de-desenvolvimento'
import { SituacaoDasFontes } from './_componentes/situacao-das-fontes'

export const metadata: Metadata = {
  title: 'Central de Desenvolvimento',
}

export interface PaginaDesenvolvimentoProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const TRILHAS = [{ rotulo: 'Central de Desenvolvimento' }]
const CONTEXTO = 'Issues, PRs e execuções de agentes'

async function Fila({ sujeito, filtros }: { sujeito: Sujeito; filtros: FiltrosDaFila }) {
  const { fontes, projetos, itens, total } = await listarFilaDeDesenvolvimento(sujeito, filtros)
  return (
    <>
      <SituacaoDasFontes fontes={fontes} />
      <FilaDeDesenvolvimento
        fontes={fontes}
        itens={itens}
        total={total}
        filtros={filtros}
        projetos={projetos}
      />
    </>
  )
}

async function Agrupada({ sujeito, projetoId }: { sujeito: Sujeito; projetoId: string | null }) {
  const { fontes, projetos, grupos } = await listarExecucoesAgrupadas(sujeito, projetoId)
  return (
    <>
      <SituacaoDasFontes fontes={fontes} />
      <ExecucoesAgrupadas grupos={grupos} projetos={projetos} projetoId={projetoId} />
    </>
  )
}

export default async function PaginaDesenvolvimento({ searchParams }: PaginaDesenvolvimentoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const cabecalho = (
    <CabecalhoDePagina trilhas={TRILHAS} titulo="Central de Desenvolvimento" contexto={CONTEXTO} />
  )

  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) {
    return (
      <div className="space-y-6">
        {cabecalho}
        <SemPermissao />
      </div>
    )
  }

  const parametros = await searchParams
  const visao = lerVisao(parametros)
  const filtros = lerFiltrosDaFila(parametros)
  const visoes = [
    { chave: 'fila', rotulo: 'Fila', href: '/desenvolvimento' },
    {
      chave: 'execucoes',
      rotulo: 'Por projeto e issue',
      href: '/desenvolvimento?visao=execucoes',
    },
  ] as const

  return (
    <div className="space-y-6">
      {cabecalho}
      <nav aria-label="Visões da Central" className="flex gap-1 border-b border-border">
        {visoes.map((v) => (
          <Link
            key={v.chave}
            href={v.href}
            aria-current={v.chave === visao ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              v.chave === visao
                ? 'border-primary text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {v.rotulo}
          </Link>
        ))}
      </nav>
      {visao === 'fila' ? (
        <Fila sujeito={sessao.sujeito} filtros={filtros} />
      ) : (
        <Agrupada sujeito={sessao.sujeito} projetoId={filtros.projetoId} />
      )}
    </div>
  )
}
