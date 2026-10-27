import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { Button } from '@/components/ui/button'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterRepositoriosDoProjeto } from '@/modules/github/queries'
import { obterProjetoParaConfiguracao } from '@/modules/projetos/queries'
import { AssociacaoDeClientes } from '@/app/(app)/projetos/_componentes/associacao-de-clientes'
import { FormularioProjeto } from '@/app/(app)/projetos/_componentes/formulario-projeto'
import { RepositoriosDoProjeto } from '@/app/(app)/projetos/_componentes/repositorios-do-projeto'
import {
  alternarArquivamentoDoProjetoAction,
  editarProjetoAction,
} from '@/app/(app)/projetos/actions'

export interface PaginaConfiguracaoProjetoProps {
  params: Promise<{ p: string }>
}

export async function generateMetadata({
  params,
}: PaginaConfiguracaoProjetoProps): Promise<Metadata> {
  const { p } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Configuração' }
  }
  try {
    const projeto = await obterProjetoParaConfiguracao(sessao.sujeito, p)
    return { title: `${projeto.nome} — Configuração` }
  } catch {
    return { title: 'Configuração' }
  }
}

export default async function PaginaConfiguracaoProjeto({
  params,
}: PaginaConfiguracaoProjetoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p } = await params

  let projeto: Awaited<ReturnType<typeof obterProjetoParaConfiguracao>>
  let github: Awaited<ReturnType<typeof obterRepositoriosDoProjeto>>
  try {
    projeto = await obterProjetoParaConfiguracao(sessao.sujeito, p)
    github = await obterRepositoriosDoProjeto(sessao.sujeito, p)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina
            trilhas={[{ rotulo: 'Projetos', href: '/projetos' }, { rotulo: 'Configuração' }]}
            titulo="Configuração inicial"
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

  const trilhas = [
    { rotulo: 'Projetos', href: '/projetos' },
    { rotulo: projeto.nome, href: `/projetos/${projeto.id}` },
    { rotulo: 'Configuração' },
  ]

  return (
    <div className="space-y-8">
      <CabecalhoDePagina
        trilhas={trilhas}
        titulo="Configuração inicial"
        contexto="Configuração progressiva do projeto, integrações e clientes"
        situacao={
          projeto.arquivadoEm ? <BadgeDeEstado tom="neutro">Arquivado</BadgeDeEstado> : undefined
        }
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Dados do projeto</h2>
        <FormularioProjeto
          action={editarProjetoAction}
          valoresIniciais={{
            projetoId: projeto.id,
            nome: projeto.nome,
            descricao: projeto.descricao,
          }}
          rotuloDoBotao="Salvar"
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Clientes</h2>
        <AssociacaoDeClientes
          projetoId={projeto.id}
          associados={projeto.clientes}
          disponiveis={projeto.clientesDisponiveis}
        />
      </section>

      <section id="repositorios" className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">GitHub</h2>
        <RepositoriosDoProjeto
          projetoId={projeto.id}
          situacao={github.situacao}
          vinculados={github.vinculados}
          disponiveis={github.disponiveis}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Ambientes</h2>
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Ambientes"
          descricao="Ambientes e evidências de deploy chegam no Incremento 4."
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Milestones</h2>
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Milestones"
          descricao="Milestones e entregas chegam no Incremento 3."
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Arquivar projeto</h2>
        {projeto.arquivadoEm ? (
          <form
            action={
              alternarArquivamentoDoProjetoAction as unknown as (
                formData: FormData,
              ) => Promise<void>
            }
            className="inline-block"
          >
            <input type="hidden" name="projetoId" value={projeto.id} />
            <input type="hidden" name="arquivar" value="false" />
            <Button type="submit" variant="outline">
              Reativar projeto
            </Button>
          </form>
        ) : (
          <BotaoDeConfirmacao
            rotulo="Arquivar projeto"
            rotuloDeConfirmacao="Confirmar arquivamento"
            action={alternarArquivamentoDoProjetoAction}
            camposOcultos={{
              projetoId: projeto.id,
              arquivar: 'true',
            }}
          />
        )}
      </section>
    </div>
  )
}
