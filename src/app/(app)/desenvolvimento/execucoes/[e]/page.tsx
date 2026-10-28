import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { apresentarEstadoDaExecucao } from '@/modules/desenvolvimento/model'
import { obterExecucao } from '@/modules/desenvolvimento/queries'
import { DetalheDaExecucao } from '../../_componentes/detalhe-da-execucao'

export interface PaginaExecucaoProps {
  params: Promise<{ e: string }>
}

const CENTRAL = { rotulo: 'Central de Desenvolvimento', href: '/desenvolvimento' }

export const metadata: Metadata = {
  title: 'Execução de agente',
}

export default async function PaginaExecucao({ params }: PaginaExecucaoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina
          trilhas={[CENTRAL, { rotulo: 'Execução' }]}
          titulo="Execução de agente"
        />
        <SemPermissao />
      </div>
    )
  }

  const { e } = await params

  let execucao: Awaited<ReturnType<typeof obterExecucao>>
  try {
    execucao = await obterExecucao(sessao.sujeito, e)
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  const estado = apresentarEstadoDaExecucao(execucao.estado)

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[CENTRAL, { rotulo: execucao.runId }]}
        titulo={execucao.runId}
        contexto={
          execucao.projeto
            ? `${execucao.projeto.nome} · ${execucao.repositorio.nomeCompleto}`
            : execucao.repositorio.nomeCompleto
        }
        situacao={<BadgeDeEstado tom={estado.tom}>{estado.texto}</BadgeDeEstado>}
      />
      <DetalheDaExecucao execucao={execucao} />
    </div>
  )
}
