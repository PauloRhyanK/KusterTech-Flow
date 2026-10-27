import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { lerFiltrosDaFila } from '@/modules/homologacao/model'
import { listarFilaDoProjeto } from '@/modules/homologacao/queries'
import type { Contexto } from '@/modules/projetos/model'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { FilaDeHomologacao } from '@/app/(app)/projetos/_componentes/fila-de-homologacao'

export interface PaginaHomologacaoProjetoProps {
  params: Promise<{ p: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
}: Pick<PaginaHomologacaoProjetoProps, 'params'>): Promise<Metadata> {
  const { p } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Projeto' }
  }
  try {
    const projeto = await obterProjetoParaResumo(sessao.sujeito, p, null)
    return { title: projeto.nome }
  } catch {
    return { title: 'Projeto' }
  }
}

export default async function PaginaHomologacaoProjeto({
  params,
  searchParams,
}: PaginaHomologacaoProjetoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p } = await params
  const filtros = lerFiltrosDaFila(await searchParams)
  const contexto: Contexto = { tipo: 'global' }

  let fila: Awaited<ReturnType<typeof listarFilaDoProjeto>>
  try {
    await obterProjetoParaResumo(sessao.sujeito, p, null)
    fila = await listarFilaDoProjeto(sessao.sujeito, p, contexto, filtros)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return <SemPermissao />
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  return (
    <FilaDeHomologacao
      fila={fila}
      filtros={{ ...filtros, clienteId: filtros.clienteId }}
      base={`/projetos/${p}/homologacao`}
      global={true}
      escopado={!podeVerVisaoGlobal(sessao.sujeito)}
      hrefConfigurarAmbientes={
        autorizar(sessao.sujeito, 'projetos.gerenciar')
          ? `/projetos/${p}/configuracao#ambientes`
          : null
      }
    />
  )
}
