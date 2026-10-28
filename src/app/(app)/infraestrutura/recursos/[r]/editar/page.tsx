import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { listarHospedeirosDisponiveis, obterRecursoDaPagina } from '@/modules/infra/queries'
import { FormularioRecurso } from '../../../_componentes/formulario-recurso'
import { editarRecursoAction } from '../../../actions'

export interface PaginaEditarRecursoProps {
  params: Promise<{ r: string }>
}

export const metadata: Metadata = {
  title: 'Editar recurso',
}

export default async function PaginaEditarRecurso({ params }: PaginaEditarRecursoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { r } = await params

  let recurso: Awaited<ReturnType<typeof obterRecursoDaPagina>>
  let hospedeiros: Awaited<ReturnType<typeof listarHospedeirosDisponiveis>>
  try {
    recurso = await obterRecursoDaPagina(sessao.sujeito, r)
    hospedeiros = await listarHospedeirosDisponiveis(sessao.sujeito, r)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina
            trilhas={[
              { rotulo: 'Infraestrutura', href: '/infraestrutura' },
              { rotulo: 'Editar recurso' },
            ]}
            titulo="Editar recurso"
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

  // O servidor atual aparece na lista mesmo se foi arquivado depois do vínculo.
  const atual = recurso.hospedadoEm
  const opcoes =
    atual && !hospedeiros.some((h) => h.id === atual.id) ? [atual, ...hospedeiros] : hospedeiros

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[
          { rotulo: 'Infraestrutura', href: '/infraestrutura' },
          { rotulo: recurso.nome, href: `/infraestrutura/recursos/${recurso.id}` },
          { rotulo: 'Editar' },
        ]}
        titulo="Editar recurso"
        contexto={recurso.nome}
      />
      <FormularioRecurso
        action={editarRecursoAction}
        hospedeiros={opcoes}
        rotuloDoBotao="Salvar alterações"
        recurso={{
          id: recurso.id,
          tipo: recurso.tipo,
          nome: recurso.nome,
          identificadorExterno: recurso.identificadorExterno,
          descricao: recurso.descricao,
          urlBeszel: recurso.urlBeszel,
          urlGlitchTip: recurso.urlGlitchTip,
          urlHostDocker: recurso.urlHostDocker,
          hospedadoEmId: recurso.hospedadoEm?.id ?? null,
        }}
      />
    </div>
  )
}
