import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterTelaDePublicacao } from '@/modules/fila-de-publicacao/queries'
import { BotaoDaPausaGeral } from './_componentes/botoes-da-publicacao'
import { FaixaDeEspera } from './_componentes/faixa-de-espera'
import { FilaPorProjeto } from './_componentes/fila-por-projeto'
import { QuadrosDaPublicacao } from './_componentes/quadros-da-publicacao'
import { UltimoLote } from './_componentes/ultimo-lote'

const TRILHAS = [{ rotulo: 'Publicação' }]

export default async function PaginaDaPublicacao() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={TRILHAS} titulo="Publicação" />
        <SemPermissao />
      </div>
    )
  }

  const agora = new Date()
  const tela = await obterTelaDePublicacao(sessao.sujeito, agora)

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={TRILHAS}
        titulo="Publicação"
        acoes={tela.podeGerenciar && <BotaoDaPausaGeral pausada={tela.pausaGeral} />}
      />
      <FaixaDeEspera avisos={tela.avisos} />
      <QuadrosDaPublicacao resumo={tela.resumo} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_270px]">
        <FilaPorProjeto
          linhas={tela.linhas}
          agora={agora}
          pausaGeral={tela.pausaGeral}
          podeGerenciar={tela.podeGerenciar}
          podeRedefinir={tela.podeRedefinir}
        />
        <UltimoLote
          quando={tela.resumo.ultimoLote.quando}
          itens={tela.ultimoLote}
          rodape={tela.rodapeDoLote}
        />
      </div>
    </div>
  )
}
