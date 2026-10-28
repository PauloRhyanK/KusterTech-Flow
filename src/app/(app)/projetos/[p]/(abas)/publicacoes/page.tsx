import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { obterPublicacoesDoProjeto } from '@/modules/publicacao/queries'
import { ComposicaoDaPublicacao } from '@/app/(app)/projetos/_componentes/composicao-de-publicacao'
import { PublicacaoDoRepositorioView } from '@/app/(app)/projetos/_componentes/publicacao-do-repositorio'

export interface PaginaPublicacoesProps {
  params: Promise<{ p: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
}: Pick<PaginaPublicacoesProps, 'params'>): Promise<Metadata> {
  const { p } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Projeto' }
  }
  try {
    const projeto = await obterProjetoParaResumo(sessao.sujeito, p, null)
    return { title: `${projeto.nome} — Publicações` }
  } catch {
    return { title: 'Projeto' }
  }
}

function lerVersao(sp: Record<string, string | string[] | undefined>): string | null {
  const valor = Array.isArray(sp.versao) ? sp.versao[0] : sp.versao
  return valor && /^[0-9a-f-]{36}$/i.test(valor) ? valor : null
}

export default async function PaginaPublicacoes({ params, searchParams }: PaginaPublicacoesProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p } = await params
  const versaoId = lerVersao(await searchParams)

  let dados: Awaited<ReturnType<typeof obterPublicacoesDoProjeto>>
  try {
    dados = await obterPublicacoesDoProjeto(sessao.sujeito, p, versaoId)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return <SemPermissao />
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  const hrefAmbientes = autorizar(sessao.sujeito, 'projetos.gerenciar')
    ? `/projetos/${p}/configuracao#ambientes`
    : null
  const ambientesPendentes = !dados.ambientes.qa || !dados.ambientes.prod
  const selecionada = dados.versaoSelecionada
  const repositorioSelecionado = selecionada
    ? dados.repositorios.find((r) => r.repositorio.id === selecionada.repositorioId)
    : undefined

  return (
    <section aria-labelledby="publicacoes" className="space-y-6">
      <div className="space-y-1">
        <h2 id="publicacoes" className="text-lg font-semibold text-text-primary">
          Publicações
        </h2>
        <p className="text-sm text-text-secondary">
          Autorizar PROD não publica nada: o deploy continua com o pipeline do projeto.
        </p>
      </div>

      {selecionada && repositorioSelecionado && selecionada.somenteLeitura && (
        <section
          aria-labelledby="versao-selecionada"
          className="space-y-3 rounded-padrao border border-border bg-surface p-4"
        >
          <h3 id="versao-selecionada" className="text-base font-[600] text-text-primary">
            {`Versão ${selecionada.versao.rotulo} (${selecionada.versao.commitCurto})`}
          </h3>
          <p className="text-sm text-text-secondary">
            {repositorioSelecionado.repositorio.nomeCompleto}
          </p>
          <ComposicaoDaPublicacao composicao={selecionada.composicao} />
        </section>
      )}

      {dados.repositorios.length === 0 ? (
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Nenhum repositório vinculado a este projeto."
          descricao="Vincule repositórios na configuração para acompanhar publicações."
        />
      ) : ambientesPendentes ? (
        <EstadoVazio
          tipo="nao-configurado"
          titulo={`O ambiente ${dados.ambientes.prod ? 'QA' : 'PROD'} não está configurado.`}
          descricao="Configure os ambientes em Configuração › Ambientes."
          acao={
            hrefAmbientes ? (
              <Link href={hrefAmbientes} className="text-sm text-text-link hover:underline">
                Configurar ambientes
              </Link>
            ) : undefined
          }
        />
      ) : (
        dados.repositorios.map((publicacao) => (
          <PublicacaoDoRepositorioView
            key={publicacao.repositorio.id}
            projeto={dados.projeto}
            publicacao={publicacao}
            podeAutorizar={dados.podeAutorizar}
          />
        ))
      )}
    </section>
  )
}
