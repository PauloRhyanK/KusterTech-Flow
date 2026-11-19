import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { rotuloDoTipo } from '@/modules/infra/model'
import { lerFiltrosDoInventario, listarRecursos } from '@/modules/infra/queries'
import { FiltrosDoInventario } from './_componentes/filtros-do-inventario'

export const metadata: Metadata = {
  title: 'Máquinas',
}

export interface PaginaMaquinasProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const TRILHAS = [{ rotulo: 'Máquinas' }]
const CONTEXTO = 'Inventário de servidores, containers, bancos e storage'

export default async function PaginaMaquinas({ searchParams }: PaginaMaquinasProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!autorizar(sessao.sujeito, 'infraestrutura.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={TRILHAS} titulo="Máquinas" contexto={CONTEXTO} />
        <SemPermissao />
      </div>
    )
  }

  const filtros = lerFiltrosDoInventario(await searchParams)
  const { recursos, total, projetos } = await listarRecursos(sessao.sujeito, filtros)
  const comFiltros =
    filtros.tipo !== null || filtros.projetoId !== null || filtros.situacao !== 'todas'

  const acaoCadastrar = autorizar(sessao.sujeito, 'infraestrutura.gerenciar') ? (
    <Link href="/maquinas/nova" className={buttonVariants({ variant: 'default' })}>
      Cadastrar máquina
    </Link>
  ) : null

  const linhas = recursos.map((r) => {
    const partes = [rotuloDoTipo(r.tipo)]
    if (r.hospedadoEm) partes.push(`Hospedado em ${r.hospedadoEm.nome}`)
    partes.push(r.totalDeProjetos === 1 ? '1 projeto' : `${r.totalDeProjetos} projetos`)
    return {
      id: r.id,
      nome: r.nome,
      href: `/maquinas/${r.id}`,
      contexto: partes.join(' · '),
      estado: r.situacao ? (
        <BadgeDeEstado tom={r.situacao.tom}>{r.situacao.texto}</BadgeDeEstado>
      ) : undefined,
    }
  })

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={TRILHAS}
        titulo="Máquinas"
        contexto={CONTEXTO}
        acoes={acaoCadastrar}
      />

      <div className="flex flex-wrap items-center gap-3 rounded-padrao border border-border bg-surface px-4 py-3 text-sm text-text-secondary">
        <BadgeDeEstado tom="neutro">Inventário manual</BadgeDeEstado>
        <p>
          Descoberta automática e métricas não estão configuradas; indicadores sem fonte aparecem
          como Sem dados.
        </p>
      </div>

      <ListaOperacional
        rotulo="Inventário de recursos"
        linhas={linhas}
        filtros={<FiltrosDoInventario filtros={filtros} projetos={projetos} />}
        vazio={
          comFiltros ? (
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhum recurso com estes filtros."
              descricao="Altere os filtros para ver outros recursos."
            />
          ) : (
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhum recurso cadastrado."
              descricao="Cadastre servidores, containers, bancos e storage para relacioná-los aos projetos."
            />
          )
        }
      />
      {total > recursos.length && (
        <p className="text-sm text-text-secondary">
          Mostrando {recursos.length} de {total} recursos. Use os filtros para refinar.
        </p>
      )}
    </div>
  )
}
