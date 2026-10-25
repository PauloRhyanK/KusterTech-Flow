import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { cn } from '@/lib/utils'
import { abasDoContexto, type Contexto } from '@/modules/projetos/model'
import type { ProjetoResumo } from '@/modules/projetos/service'
import { AbasDoProjeto } from './abas-do-projeto'

export interface CabecalhoDoProjetoProps {
  projeto: ProjetoResumo
  contexto: Contexto
  cliente?: { id: string; nome: string }
  podeGerenciar: boolean
  podeVerGlobal: boolean
  className?: string
}

export function CabecalhoDoProjeto({
  projeto,
  contexto,
  cliente,
  podeGerenciar,
  podeVerGlobal,
  className,
}: CabecalhoDoProjetoProps) {
  const trilhas =
    contexto.tipo === 'cliente' && cliente
      ? [
          { rotulo: 'Clientes', href: '/clientes' },
          { rotulo: cliente.nome, href: `/clientes/${cliente.id}` },
          { rotulo: projeto.nome },
        ]
      : [{ rotulo: 'Projetos', href: '/projetos' }, { rotulo: projeto.nome }]

  const contextoTexto = projeto.descricao || 'Sem descrição.'
  const situacao = projeto.arquivadoEm ? (
    <BadgeDeEstado tom="neutro">Arquivado</BadgeDeEstado>
  ) : undefined

  let acoes = null
  if (contexto.tipo === 'global' && podeGerenciar) {
    acoes = (
      <Link
        href={`/projetos/${projeto.id}/configuracao`}
        className={buttonVariants({ variant: 'outline' })}
      >
        Configuração
      </Link>
    )
  } else if (contexto.tipo === 'cliente' && podeVerGlobal) {
    acoes = (
      <Link href={`/projetos/${projeto.id}`} className={buttonVariants({ variant: 'outline' })}>
        Ver na visão global
      </Link>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      <CabecalhoDePagina
        trilhas={trilhas}
        titulo={projeto.nome}
        contexto={contextoTexto}
        situacao={situacao}
        acoes={acoes}
      />
      <AbasDoProjeto abas={abasDoContexto(projeto.id, contexto)} />
    </div>
  )
}
