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

export interface PaginaMaquinasProjetoProps {
  params: Promise<{ p: string }>
}

export async function generateMetadata({ params }: PaginaMaquinasProjetoProps): Promise<Metadata> {
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

export default async function PaginaMaquinasProjeto({ params }: PaginaMaquinasProjetoProps) {
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
    href: `/maquinas/${r.id}`,
    contexto: rotuloDoTipo(r.tipo),
    estado: r.situacao ? (
      <BadgeDeEstado tom={r.situacao.tom}>{r.situacao.texto}</BadgeDeEstado>
    ) : undefined,
  }))

  return (
    <ListaOperacional
      rotulo="Máquinas do projeto"
      linhas={linhas}
      vazio={
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Nenhuma máquina associada a este projeto."
          descricao="Associe máquinas na página de cada máquina do inventário."
          acao={
            <Link href="/maquinas" className="text-sm text-text-link hover:underline">
              Abrir inventário
            </Link>
          }
        />
      }
    />
  )
}
