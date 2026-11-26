import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { moduloAtivo } from '@/lib/modulos'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterDemandasQueVemAi } from '@/modules/demandas/queries'
import { filtrarLinhas, lerFiltrosDaFila } from '@/modules/fila-de-publicacao/apresentacao'
import { obterTelaDePublicacao } from '@/modules/fila-de-publicacao/queries'
import { BotaoDaPausaGeral } from './_componentes/botoes-da-publicacao'
import { FaixaDeEspera } from './_componentes/faixa-de-espera'
import { FiltrosDaFilaForm } from './_componentes/filtros-da-fila'
import { FilaPorProjeto } from './_componentes/fila-por-projeto'
import { QuadrosDaPublicacao } from './_componentes/quadros-da-publicacao'
import { UltimoLote } from './_componentes/ultimo-lote'
import { VemAiDaFabrica } from './_componentes/vem-ai-da-fabrica'

const TRILHAS = [{ rotulo: 'Publicação' }]

export default async function PaginaDaPublicacao({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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

  const filtros = lerFiltrosDaFila(await searchParams)
  const agora = new Date()
  // Sem o módulo de demandas, a seção não aparece (os links levariam a uma rota desligada).
  const comDemandas = moduloAtivo('demandas')
  const [tela, vemAi] = await Promise.all([
    obterTelaDePublicacao(sessao.sujeito, agora),
    comDemandas ? obterDemandasQueVemAi(sessao.sujeito) : null,
  ])

  const projetos = [...new Map(tela.linhas.map((l) => [l.projetoId, l.projeto])).entries()]
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  const filtrando = Boolean(filtros.projeto || filtros.estado || filtros.modo || filtros.busca)
  const linhas = filtrarLinhas(tela.linhas, filtros)
  const totalDePedidos = linhas.reduce(
    (n, l) => n + (l.publicando ? 1 : 0) + l.aguardando.length,
    0,
  )

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
        <div className="min-w-0 space-y-6">
          <FiltrosDaFilaForm filtros={filtros} projetos={projetos} />
          {filtrando && (
            <p role="status" className="text-sm text-text-secondary">
              {totalDePedidos === 0
                ? 'Nenhum pedido com esses filtros'
                : `${totalDePedidos} ${totalDePedidos === 1 ? 'pedido' : 'pedidos'}`}
            </p>
          )}
          <FilaPorProjeto
            linhas={linhas}
            agora={agora}
            pausaGeral={tela.pausaGeral}
            podeGerenciar={tela.podeGerenciar}
            podeRedefinir={tela.podeRedefinir}
          />
          {vemAi && <VemAiDaFabrica demandas={vemAi} />}
        </div>
        <UltimoLote
          quando={tela.resumo.ultimoLote.quando}
          itens={tela.ultimoLote}
          rodape={tela.rodapeDoLote}
        />
      </div>
    </div>
  )
}
