import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { moduloAtivo } from '@/lib/modulos'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { FontesComToken } from '@/lib/ui/fontes-com-token'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { listarFontesDePublicacao } from '@/modules/fila-de-publicacao/service'
import { criarFonteDePublicacaoAction, revogarFonteDePublicacaoAction } from './actions'

export const metadata: Metadata = {
  title: 'Publicação',
}

export default async function PaginaConfiguracoesDePublicacao() {
  if (!moduloAtivo('fila-de-publicacao')) notFound()
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const cabecalho = (
    <CabecalhoDePagina
      trilhas={[{ rotulo: 'Configurações', href: '/configuracoes' }, { rotulo: 'Publicação' }]}
      titulo="Publicação"
      contexto="Tokens que a Fábrica e as sessões usam para pedir publicações."
    />
  )

  if (!autorizar(sessao.sujeito, 'configuracoes.gerenciar')) {
    return (
      <div className="space-y-6">
        {cabecalho}
        <SemPermissao />
      </div>
    )
  }

  const fontes = await listarFontesDePublicacao(sessao.sujeito)

  return (
    <div className="space-y-6">
      {cabecalho}
      <FontesComToken
        fontes={fontes}
        criarAction={criarFonteDePublicacaoAction}
        revogarAction={revogarFonteDePublicacaoAction}
        textos={{
          titulo: 'Tokens de pedido',
          ariaDaLista: 'Tokens de publicação',
          vazioTitulo: 'Nenhum token criado.',
          vazioDescricao: 'Crie um token para a Fábrica ou uma sessão pedir publicações à Central.',
          avisoDoToken:
            'Copie agora; o token não será mostrado de novo. Envie-o como Bearer em POST /api/publicacoes.',
          idDoCampoNome: 'fonte-publicacao-nome',
        }}
      />
    </div>
  )
}
