import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { exigirModulo } from '@/lib/modulos-rota'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterTelaDaBusca } from '@/modules/demandas/busca/queries'
import { AtualizarEnquanto } from '../_componentes/atualizar-enquanto'
import { HistoricoDaBusca, ResultadoDaBusca } from '../_componentes/busca-com-ia'
import { FormularioDaBusca } from '../_componentes/formulario-da-busca'

const TRILHAS = [{ rotulo: 'Demandas', href: '/demandas' }, { rotulo: 'Buscar com IA' }]

export default async function PaginaDaBuscaComIa({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  exigirModulo('demandas')
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }
  if (!autorizar(sessao.sujeito, 'desenvolvimento.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={TRILHAS} titulo="Buscar com IA" />
        <SemPermissao />
      </div>
    )
  }

  const id = (await searchParams).id
  const agora = new Date()
  const tela = await obterTelaDaBusca(sessao.sujeito, typeof id === 'string' ? id : null, agora)
  const andando = tela.atual?.estado === 'pendente' || tela.atual?.estado === 'em_curso'

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={TRILHAS}
        titulo="Buscar com IA"
        contexto="pergunte se alguma demanda já trata de algo"
      />
      <FormularioDaBusca opcoes={tela.opcoes} restantesHoje={tela.restantesHoje} />
      {tela.atual && <ResultadoDaBusca busca={tela.atual} agora={agora} />}
      <AtualizarEnquanto ativo={andando} />
      <HistoricoDaBusca historico={tela.historico} mes={tela.mes} agora={agora} />
    </div>
  )
}
