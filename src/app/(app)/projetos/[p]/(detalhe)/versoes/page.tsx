import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { listarVersoesDoProjeto } from '@/modules/ambientes/queries'
import { obterProjeto } from '@/modules/projetos/service'
import { VersoesDoProjeto } from '@/app/(app)/projetos/_componentes/versoes-do-projeto'

export interface PaginaVersoesProps {
  params: Promise<{ p: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Versões' }
}

export default async function PaginaVersoes({ params, searchParams }: PaginaVersoesProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p } = await params
  const filtro = (await searchParams).repositorio
  const repositorioId = (Array.isArray(filtro) ? filtro[0] : filtro) || null

  let projeto: Awaited<ReturnType<typeof obterProjeto>>
  let versoes: Awaited<ReturnType<typeof listarVersoesDoProjeto>>
  try {
    projeto = await obterProjeto(sessao.sujeito, p, { tipo: 'global' })
    versoes = await listarVersoesDoProjeto(sessao.sujeito, p, { repositorioId })
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina
            trilhas={[{ rotulo: 'Projetos', href: '/projetos' }, { rotulo: 'Versões' }]}
            titulo="Versões"
          />
          <SemPermissao />
        </div>
      )
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  return (
    <div className="space-y-8">
      <CabecalhoDePagina
        trilhas={[
          { rotulo: 'Projetos', href: '/projetos' },
          { rotulo: projeto.nome, href: `/projetos/${projeto.id}` },
          { rotulo: 'Versões' },
        ]}
        titulo="Versões"
        contexto="O que está em DEV, QA e PROD, com a evidência de cada deploy"
      />
      <VersoesDoProjeto
        projetoId={projeto.id}
        ambientesConfigurados={versoes.ambientesConfigurados}
        repositorios={versoes.repositorios}
        situacoes={versoes.situacoes}
        versoes={versoes.versoes}
        total={versoes.total}
        leituras={versoes.leituras}
        repositorioId={repositorioId}
        podeRegistrar={autorizar(sessao.sujeito, 'projetos.gerenciar') && !projeto.arquivadoEm}
      />
    </div>
  )
}
