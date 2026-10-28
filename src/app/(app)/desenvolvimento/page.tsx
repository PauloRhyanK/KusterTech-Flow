import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import {
  lerFiltrosDaFila,
  lerVisao,
  listarFilaDeDesenvolvimento,
} from '@/modules/desenvolvimento/queries'
import { cn } from '@/lib/utils'
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
  const { fontes, projetos, itens, total } = await listarFilaDeDesenvolvimento(
    sessao.sujeito,
    filtros,
  )

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
      <SituacaoDasFontes fontes={fontes} />
      {visao === 'fila' ? (
        <FilaDeDesenvolvimento
          fontes={fontes}
          itens={itens}
          total={total}
          filtros={filtros}
          projetos={projetos}
        />
      ) : (
        <EstadoVazio
          tipo="sem-evidencia"
          titulo="Esta visão ainda não está disponível."
          descricao="Use a Fila para ver issues, PRs e execuções."
        />
      )}
    </div>
  )
}
