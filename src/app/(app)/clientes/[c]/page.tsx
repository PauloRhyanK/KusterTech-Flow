import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterClienteComProjetos } from '@/modules/clientes/queries'
import { BotaoDeConfirmacao } from '../_componentes/botao-de-confirmacao'
import { alternarArquivamentoAction } from '../actions'

export interface PaginaClienteProps {
  params: Promise<{ c: string }>
}

export async function generateMetadata({ params }: PaginaClienteProps): Promise<Metadata> {
  const { c } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Cliente' }
  }
  try {
    const cliente = await obterClienteComProjetos(sessao.sujeito, c)
    return { title: cliente.nome }
  } catch {
    return { title: 'Cliente' }
  }
}

export default async function PaginaCliente({ params }: PaginaClienteProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { c } = await params

  let cliente: Awaited<ReturnType<typeof obterClienteComProjetos>>
  try {
    cliente = await obterClienteComProjetos(sessao.sujeito, c)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return (
        <div className="space-y-6">
          <CabecalhoDePagina
            trilhas={[{ rotulo: 'Clientes', href: '/clientes' }]}
            titulo="Cliente"
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

  const primeiraLinhaObs = cliente.observacoes
    ? cliente.observacoes.split('\n')[0]?.trim() || null
    : null
  const contexto = primeiraLinhaObs || 'Sem observações.'

  const podeGerenciar = autorizar(sessao.sujeito, 'clientes.gerenciar')

  const acoes = podeGerenciar ? (
    <div className="flex items-center gap-2">
      <Link
        href={`/clientes/${cliente.id}/editar`}
        className={buttonVariants({ variant: 'outline' })}
      >
        Editar
      </Link>
      {cliente.arquivadoEm ? (
        <form
          action={alternarArquivamentoAction as unknown as (formData: FormData) => Promise<void>}
          className="inline-block"
        >
          <input type="hidden" name="clienteId" value={cliente.id} />
          <input type="hidden" name="arquivar" value="false" />
          <Button type="submit" variant="outline">
            Reativar
          </Button>
        </form>
      ) : (
        <BotaoDeConfirmacao
          rotulo="Arquivar"
          rotuloDeConfirmacao="Confirmar arquivamento"
          action={alternarArquivamentoAction}
          camposOcultos={{
            clienteId: cliente.id,
            arquivar: 'true',
          }}
        />
      )}
    </div>
  ) : null

  const linhasProjetos = cliente.projetos.map((projeto) => ({
    id: projeto.id,
    nome: projeto.nome,
    href: `/clientes/${cliente.id}/projetos/${projeto.id}`,
    contexto: projeto.descricao ?? undefined,
    estado: projeto.arquivadoEm ? <BadgeDeEstado tom="neutro">Arquivado</BadgeDeEstado> : undefined,
  }))

  return (
    <div className="space-y-8">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Clientes', href: '/clientes' }, { rotulo: cliente.nome }]}
        titulo={cliente.nome}
        contexto={contexto}
        situacao={
          cliente.arquivadoEm ? <BadgeDeEstado tom="neutro">Arquivado</BadgeDeEstado> : undefined
        }
        acoes={acoes}
      />

      <section className="space-y-4">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Projetos</h2>
        <ListaOperacional
          rotulo="Lista de projetos"
          linhas={linhasProjetos}
          vazio={
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhum projeto associado."
              descricao="Associe este cliente a um projeto na configuração do projeto."
            />
          }
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">
          Homologações pendentes
        </h2>
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Homologações ainda não disponíveis."
          descricao="Elas aparecem quando o fluxo de homologação estiver configurado."
        />
      </section>
    </div>
  )
}
