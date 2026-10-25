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
import { listarClientesParaTela } from '@/modules/clientes/queries'

export const metadata: Metadata = {
  title: 'Clientes',
}

export interface PaginaClientesProps {
  searchParams: Promise<{ q?: string }>
}

export default async function PaginaClientes({ searchParams }: PaginaClientesProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { q } = await searchParams
  const busca = typeof q === 'string' ? q.trim().slice(0, 120) : undefined

  if (!autorizar(sessao.sujeito, 'clientes.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina
          trilhas={[{ rotulo: 'Clientes' }]}
          titulo="Clientes"
          contexto="Acompanhamento dos clientes e seus projetos"
        />
        <SemPermissao />
      </div>
    )
  }

  let clientes: Awaited<ReturnType<typeof listarClientesParaTela>>
  try {
    clientes = await listarClientesParaTela(sessao.sujeito, busca)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina
            trilhas={[{ rotulo: 'Clientes' }]}
            titulo="Clientes"
            contexto="Acompanhamento dos clientes e seus projetos"
          />
          <SemPermissao />
        </div>
      )
    }
    throw erro
  }

  const podeGerenciar = autorizar(sessao.sujeito, 'clientes.gerenciar')

  const acaoNovoCliente = podeGerenciar ? (
    <Link href="/clientes/novo" className={buttonVariants({ variant: 'default' })}>
      Novo cliente
    </Link>
  ) : null

  const temBusca = Boolean(busca && busca.length > 0)

  const estadoVazio = temBusca ? (
    <EstadoVazio
      tipo="nenhum-registro"
      titulo="Nenhum cliente encontrado para esta busca."
      descricao="Tente outro nome."
    />
  ) : (
    <EstadoVazio
      tipo="nenhum-registro"
      titulo="Nenhum cliente cadastrado."
      descricao="Crie o primeiro cliente para associar projetos."
      acao={acaoNovoCliente ?? undefined}
    />
  )

  const filtros = (
    <form method="GET" action="/clientes" className="flex items-center gap-2">
      <label htmlFor="busca-clientes" className="sr-only">
        Buscar por nome
      </label>
      <input
        id="busca-clientes"
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

  const linhas = clientes.map((cliente) => ({
    id: cliente.id,
    nome: cliente.nome,
    href: `/clientes/${cliente.id}`,
    contexto:
      cliente.totalDeProjetos === 0
        ? 'Sem projetos'
        : `${cliente.totalDeProjetos} ${cliente.totalDeProjetos === 1 ? 'projeto' : 'projetos'}`,
    estado: cliente.arquivadoEm ? <BadgeDeEstado tom="neutro">Arquivado</BadgeDeEstado> : undefined,
  }))

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Clientes' }]}
        titulo="Clientes"
        contexto="Acompanhamento dos clientes e seus projetos"
        acoes={acaoNovoCliente}
      />

      <ListaOperacional
        rotulo="Lista de clientes"
        linhas={linhas}
        filtros={filtros}
        vazio={estadoVazio}
      />
    </div>
  )
}
