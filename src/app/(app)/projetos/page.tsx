import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { podeVerVisaoGlobal } from '@/modules/clientes/model'
import { listarClientesParaSelecao } from '@/modules/clientes/queries'
import { listarProjetosParaTela } from '@/modules/projetos/queries'

export const metadata: Metadata = {
  title: 'Projetos',
}

export interface PaginaProjetosProps {
  searchParams: Promise<{ q?: string }>
}

export default async function PaginaProjetos({ searchParams }: PaginaProjetosProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!podeVerVisaoGlobal(sessao.sujeito)) {
    let clientes: { id: string; nome: string }[] = []
    try {
      clientes = await listarClientesParaSelecao(sessao.sujeito)
    } catch {
      clientes = []
    }

    return (
      <div className="space-y-6">
        <CabecalhoDePagina
          trilhas={[{ rotulo: 'Projetos' }]}
          titulo="Projetos"
          contexto="Gestão global de projetos, entregas e homologações"
        />
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Os projetos ficam disponíveis no contexto de cada cliente."
          descricao="Escolha um cliente para ver os projetos dele."
          acao={
            clientes.length > 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {clientes.map((c) => (
                  <Link
                    key={c.id}
                    href={`/clientes/${c.id}`}
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    {c.nome}
                  </Link>
                ))}
              </div>
            ) : undefined
          }
        />
      </div>
    )
  }

  const { q } = await searchParams
  const busca = typeof q === 'string' ? q.trim().slice(0, 120) : undefined

  if (!autorizar(sessao.sujeito, 'projetos.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina
          trilhas={[{ rotulo: 'Projetos' }]}
          titulo="Projetos"
          contexto="Gestão global de projetos, entregas e homologações"
        />
        <SemPermissao />
      </div>
    )
  }

  let projetos: Awaited<ReturnType<typeof listarProjetosParaTela>>
  try {
    projetos = await listarProjetosParaTela(sessao.sujeito, busca)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina
            trilhas={[{ rotulo: 'Projetos' }]}
            titulo="Projetos"
            contexto="Gestão global de projetos, entregas e homologações"
          />
          <SemPermissao />
        </div>
      )
    }
    throw erro
  }

  const podeGerenciar = autorizar(sessao.sujeito, 'projetos.gerenciar')

  const acaoNovoProjeto = podeGerenciar ? (
    <Link href="/projetos/novo" className={buttonVariants({ variant: 'default' })}>
      Novo projeto
    </Link>
  ) : null

  const temBusca = Boolean(busca && busca.length > 0)

  const estadoVazio = temBusca ? (
    <EstadoVazio
      tipo="nenhum-registro"
      titulo="Nenhum projeto encontrado para esta busca."
      descricao="Tente outro nome."
    />
  ) : (
    <EstadoVazio
      tipo="nenhum-registro"
      titulo="Nenhum projeto cadastrado."
      descricao="Crie o primeiro projeto para começar a configuração."
      acao={acaoNovoProjeto ?? undefined}
    />
  )

  const filtros = (
    <form method="GET" action="/projetos" className="flex items-center gap-2">
      <label htmlFor="busca-projetos" className="sr-only">
        Buscar por nome
      </label>
      <input
        id="busca-projetos"
        name="q"
        type="search"
        defaultValue={busca ?? ''}
        placeholder="Buscar por nome"
        maxLength={120}
        className="h-8 rounded-compacto border border-border bg-surface px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      />
      <Button type="submit" variant="secondary" size="default">
        Buscar
      </Button>
    </form>
  )

  const linhas = projetos.map((projeto) => ({
    id: projeto.id,
    nome: projeto.nome,
    href: `/projetos/${projeto.id}/configuracao`,
    contexto:
      projeto.clientes.length === 0
        ? 'Sem clientes'
        : projeto.clientes.map((c) => c.nome).join(', '),
    indicador: projeto.configuracaoPendente ? (
      <span className="text-[13px] text-text-secondary">Configuração pendente</span>
    ) : undefined,
    estado: projeto.arquivadoEm ? <BadgeDeEstado tom="neutro">Arquivado</BadgeDeEstado> : undefined,
  }))

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Projetos' }]}
        titulo="Projetos"
        contexto="Gestão global de projetos, entregas e homologações"
        acoes={acaoNovoProjeto}
      />

      <ListaOperacional
        rotulo="Lista de projetos"
        linhas={linhas}
        filtros={filtros}
        vazio={estadoVazio}
      />
    </div>
  )
}
