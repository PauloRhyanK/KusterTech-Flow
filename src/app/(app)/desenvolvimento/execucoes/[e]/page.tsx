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
import { DetalheDaExecucao } from '@/app/(app)/projetos/_componentes/desenvolvimento/detalhe-da-execucao'

export interface PaginaExecucaoProps {
  params: Promise<{ e: string }>
}

const PROJETOS = { rotulo: 'Projetos', href: '/projetos' }

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
          trilhas={[PROJETOS, { rotulo: 'Execução' }]}
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
        trilhas={
          execucao.projeto
            ? [
                PROJETOS,
                { rotulo: execucao.projeto.nome, href: `/projetos/${execucao.projeto.id}` },
                {
                  rotulo: 'Desenvolvimento',
                  href: `/projetos/${execucao.projeto.id}/desenvolvimento`,
                },
                { rotulo: execucao.runId },
              ]
            : [PROJETOS, { rotulo: execucao.runId }]
        }
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
