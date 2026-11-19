import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { autorizar, ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { exigirModulo } from '@/lib/modulos-rota'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { cn } from '@/lib/utils'
import {
  lerFiltrosDaFila,
  lerVisao,
  listarExecucoesAgrupadas,
  listarFilaDeDesenvolvimento,
  type FiltrosDaFila,
} from '@/modules/desenvolvimento/queries'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { ExecucoesAgrupadas } from '@/app/(app)/projetos/_componentes/desenvolvimento/execucoes-agrupadas'
import { FilaDeDesenvolvimento } from '@/app/(app)/projetos/_componentes/desenvolvimento/fila-de-desenvolvimento'
import { SituacaoDasFontes } from '@/app/(app)/projetos/_componentes/desenvolvimento/situacao-das-fontes'

export interface PaginaDesenvolvimentoDoProjetoProps {
  params: Promise<{ p: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export const metadata: Metadata = {
  title: 'Desenvolvimento',
}

async function Fila({
  sujeito,
  filtros,
  acao,
}: {
  sujeito: Sujeito
  filtros: FiltrosDaFila
  acao: string
}) {
  const { fontes, itens, total } = await listarFilaDeDesenvolvimento(sujeito, filtros)
  return (
    <>
      <SituacaoDasFontes fontes={fontes} />
      <FilaDeDesenvolvimento
        fontes={fontes}
        itens={itens}
        total={total}
        filtros={filtros}
        acao={acao}
      />
    </>
  )
}

async function Agrupada({
  sujeito,
  projetoId,
  acao,
}: {
  sujeito: Sujeito
  projetoId: string
  acao: string
}) {
  const { fontes, grupos } = await listarExecucoesAgrupadas(sujeito, projetoId)
  return (
    <>
      <SituacaoDasFontes fontes={fontes} />
      <ExecucoesAgrupadas grupos={grupos} acao={acao} />
    </>
  )
}

export default async function PaginaDesenvolvimentoDoProjeto({
  params,
  searchParams,
}: PaginaDesenvolvimentoDoProjetoProps) {
  exigirModulo('desenvolvimento')

  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p } = await params

  try {
    await obterProjetoParaResumo(sessao.sujeito, p, null)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return <SemPermissao />
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) {
    return <SemPermissao />
  }

  const parametros = await searchParams
  const visao = lerVisao(parametros)
  const filtros: FiltrosDaFila = { ...lerFiltrosDaFila(parametros), projetoId: p }
  const base = `/projetos/${p}/desenvolvimento`
  const visoes = [
    { chave: 'fila', rotulo: 'Fila', href: base },
    { chave: 'execucoes', rotulo: 'Por issue', href: `${base}?visao=execucoes` },
  ] as const

  return (
    <div className="space-y-6">
      <nav aria-label="Visões do desenvolvimento" className="flex gap-1 border-b border-border">
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
        <Fila sujeito={sessao.sujeito} filtros={filtros} acao={base} />
      ) : (
        <Agrupada sujeito={sessao.sujeito} projetoId={p} acao={base} />
      )}
    </div>
  )
}
