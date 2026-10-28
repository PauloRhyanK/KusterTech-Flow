import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import Link from 'next/link'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { rotuloDoTipo } from '@/modules/infra/model'
import { listarRecursosDoProjeto } from '@/modules/infra/queries'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'

export interface PaginaRecursosProjetoProps {
  params: Promise<{ p: string }>
}

export async function generateMetadata({ params }: PaginaRecursosProjetoProps): Promise<Metadata> {
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

export default async function PaginaRecursosProjeto({ params }: PaginaRecursosProjetoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p } = await params

  let recursos: Awaited<ReturnType<typeof listarRecursosDoProjeto>>
  try {
    await obterProjetoParaResumo(sessao.sujeito, p, null)
    recursos = await listarRecursosDoProjeto(sessao.sujeito, p)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return <SemPermissao />
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  const linhas = recursos.map((r) => ({
    id: r.id,
    nome: r.nome,
    href: `/infraestrutura/recursos/${r.id}`,
    contexto: rotuloDoTipo(r.tipo),
    estado: <BadgeDeEstado tom={r.situacao.tom}>{r.situacao.texto}</BadgeDeEstado>,
  }))

  return (
    <ListaOperacional
      rotulo="Recursos do projeto"
      linhas={linhas}
      vazio={
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Nenhum recurso associado a este projeto."
          descricao="Associe recursos na página de cada recurso do inventário."
          acao={
            <Link href="/infraestrutura" className="text-sm text-text-link hover:underline">
              Abrir inventário
            </Link>
          }
        />
      }
    />
  )
}
