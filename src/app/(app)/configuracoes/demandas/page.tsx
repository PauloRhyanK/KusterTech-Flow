import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { moduloAtivo } from '@/lib/modulos'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { FontesComToken } from '@/lib/ui/fontes-com-token'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { listarFontesDeDemandas } from '@/modules/demandas/service'
import { criarFonteDeDemandasAction, revogarFonteDeDemandasAction } from './actions'

export const metadata: Metadata = {
  title: 'Demandas',
}

export default async function PaginaConfiguracoesDeDemandas() {
  if (!moduloAtivo('demandas')) notFound()
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const cabecalho = (
    <CabecalhoDePagina
      trilhas={[{ rotulo: 'Configurações', href: '/configuracoes' }, { rotulo: 'Demandas' }]}
      titulo="Demandas"
      contexto="Tokens que as sessões do Claude Code usam para abrir e acompanhar demandas."
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

  const fontes = await listarFontesDeDemandas(sessao.sujeito)

  return (
    <div className="space-y-6">
      {cabecalho}
      <FontesComToken
        fontes={fontes}
        criarAction={criarFonteDeDemandasAction}
        revogarAction={revogarFonteDeDemandasAction}
        textos={{
          titulo: 'Tokens de sessões',
          ariaDaLista: 'Tokens de demandas',
          vazioTitulo: 'Nenhum token criado.',
          vazioDescricao:
            'Crie um token para a sessão do Claude Code de um projeto abrir e acompanhar demandas.',
          avisoDoToken:
            'Copie agora; o token não será mostrado de novo. Envie-o como Bearer em /api/demandas.',
          idDoCampoNome: 'fonte-demandas-nome',
        }}
      />
    </div>
  )
}
