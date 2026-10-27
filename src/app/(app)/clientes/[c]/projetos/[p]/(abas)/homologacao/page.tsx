import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { lerFiltrosDaFila } from '@/modules/homologacao/model'
import { listarFilaDoProjeto } from '@/modules/homologacao/queries'
import type { Contexto } from '@/modules/projetos/model'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { FilaDeHomologacao } from '@/app/(app)/projetos/_componentes/fila-de-homologacao'

export interface PaginaHomologacaoProjetoClienteProps {
  params: Promise<{ c: string; p: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
}: Pick<PaginaHomologacaoProjetoClienteProps, 'params'>): Promise<Metadata> {
  const { c, p } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Projeto' }
  }
  try {
    const projeto = await obterProjetoParaResumo(sessao.sujeito, p, c)
    return { title: projeto.nome }
  } catch {
    return { title: 'Projeto' }
  }
}

export default async function PaginaHomologacaoProjetoCliente({
  params,
  searchParams,
}: PaginaHomologacaoProjetoClienteProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { c, p } = await params
  const filtros = lerFiltrosDaFila(await searchParams)
  const contexto: Contexto = { tipo: 'cliente', clienteId: c }

  let fila: Awaited<ReturnType<typeof listarFilaDoProjeto>>
  try {
    await obterProjetoParaResumo(sessao.sujeito, p, c)
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
      filtros={{ ...filtros, clienteId: null }}
      base={`/clientes/${c}/projetos/${p}/homologacao`}
      global={false}
      escopado={!podeVerVisaoGlobal(sessao.sujeito)}
      hrefConfigurarAmbientes={null}
    />
  )
}
