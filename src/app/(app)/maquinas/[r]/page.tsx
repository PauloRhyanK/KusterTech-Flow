import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao, type Sujeito } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { log } from '@/lib/log'
import { ErroDeDominio } from '@/lib/erros'
import { moduloAtivo } from '@/lib/modulos'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterDetalheNoBeszel, linkDoBeszel } from '@/modules/beszel/queries'
import { planosEmCurso } from '@/modules/fabrica/model'
import { resumirErroParaLog } from '@/modules/github/model'
import { obterRetratoMaisRecente } from '@/modules/fabrica/queries'
import { rotuloDoTipo } from '@/modules/infra/model'
import { obterRecursoDaPagina } from '@/modules/infra/queries'
import { maquinaLocalConfigurada, obterLeituraDaMaquinaLocal } from '@/modules/oficina/queries'
import { DetalheDoRecurso, type DetalheDoRecursoProps } from '../_componentes/detalhe-do-recurso'

export interface PaginaRecursoProps {
  params: Promise<{ r: string }>
}

export async function generateMetadata({ params }: PaginaRecursoProps): Promise<Metadata> {
  const { r } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Máquina' }
  }
  try {
    const recurso = await obterRecursoDaPagina(sessao.sujeito, r)
    return { title: recurso.nome }
  } catch {
    return { title: 'Máquina' }
  }
}

// Leitura da oficina e estado da Fábrica para o painel da máquina local. Sem retrato da
// Fábrica (ou sem permissão para lê-lo), o painel segue sem o mínimo de memória.
async function painelDaMaquinaLocal(
  sujeito: Sujeito,
): Promise<NonNullable<DetalheDoRecursoProps['painelLocal']> | null> {
  const agora = new Date()
  const [leitura, recebido] = await Promise.all([
    obterLeituraDaMaquinaLocal(sujeito, agora),
    moduloAtivo('fabrica') ? obterRetratoMaisRecente(sujeito).catch(() => null) : null,
  ])
  if (!leitura) return null
  const vagas = recebido?.retrato.vagas
  return {
    leitura,
    agora,
    ramMinimaMb: vagas?.ramMinimaMb ?? null,
    fabrica:
      recebido && vagas
        ? {
            ocupadas: vagas.ocupadas,
            efetivas: vagas.efetivas,
            planos: planosEmCurso(recebido.retrato).length,
          }
        : null,
  }
}

// Painel de uma máquina ligada ao Beszel pelo identificador externo. Beszel fora ou sem esse
// sistema: a página segue como antes, só com o cadastro.
async function painelDoBeszel(
  sujeito: Sujeito,
  identificador: string | null,
): Promise<NonNullable<DetalheDoRecursoProps['painelBeszel']> | null> {
  if (identificador === null) return null
  const agora = new Date()
  const { detalhe } = await obterDetalheNoBeszel(sujeito, identificador, agora).catch(
    (erro: unknown) => {
      log.error({ erro: resumirErroParaLog(erro), fonte: 'beszel' }, 'leitura do Beszel falhou')
      return { detalhe: null }
    },
  )
  return detalhe ? { detalhe, agora, link: linkDoBeszel() } : null
}

export default async function PaginaRecurso({ params }: PaginaRecursoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { r } = await params

  let recurso: Awaited<ReturnType<typeof obterRecursoDaPagina>>
  try {
    recurso = await obterRecursoDaPagina(sessao.sujeito, r)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina
            trilhas={[{ rotulo: 'Máquinas', href: '/maquinas' }, { rotulo: 'Máquina' }]}
            titulo="Máquina"
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

  const local = maquinaLocalConfigurada()
  const ehLocal = local !== null && recurso.identificadorExterno === local
  const painelLocal = ehLocal ? await painelDaMaquinaLocal(sessao.sujeito) : null
  const painelBeszel =
    ehLocal || recurso.arquivadoEm !== null
      ? null
      : await painelDoBeszel(sessao.sujeito, recurso.identificadorExterno)

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Máquinas', href: '/maquinas' }, { rotulo: recurso.nome }]}
        titulo={recurso.nome}
        situacao={
          <div className="flex flex-wrap items-center gap-1.5">
            <BadgeDeEstado tom="neutro">{rotuloDoTipo(recurso.tipo)}</BadgeDeEstado>
            {recurso.situacao && (
              <BadgeDeEstado tom={recurso.situacao.tom}>{recurso.situacao.texto}</BadgeDeEstado>
            )}
          </div>
        }
      />
      <DetalheDoRecurso
        recurso={recurso}
        painelLocal={painelLocal ?? undefined}
        painelBeszel={painelBeszel ?? undefined}
      />
    </div>
  )
}
