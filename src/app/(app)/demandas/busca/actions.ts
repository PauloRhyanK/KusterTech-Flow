'use server'

import { redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { exigirModulo } from '@/lib/modulos-rota'
import { pedirBusca } from '@/modules/demandas/busca/service'
import { lerFiltrosDaTabela } from '@/modules/demandas/model'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoDoPedido {
  erro: string | null
}

const campo = (form: FormData, nome: string) => {
  const v = form.get(nome)
  return typeof v === 'string' ? v : undefined
}

export async function pedirBuscaAction(
  _estado: EstadoDoPedido,
  form: FormData,
): Promise<EstadoDoPedido> {
  exigirModulo('demandas')
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')

  // A busca olha todo o histórico, a menos que o Paulo recorte o período.
  const filtros = lerFiltrosDaTabela({
    projeto: campo(form, 'projeto'),
    cliente: campo(form, 'cliente'),
    periodo: campo(form, 'periodo') || 'tudo',
  })
  let id: string
  try {
    ;({ id } = await pedirBusca(
      sessao.sujeito,
      { pergunta: campo(form, 'pergunta') ?? '', filtros },
      new Date(),
    ))
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) return { erro: 'Sem permissão para buscar demandas.' }
    if (erro instanceof ErroDeDominio) return { erro: erro.message }
    log.error({ erro: resumirErroParaLog(erro) }, 'Erro inesperado ao pedir a busca com IA.')
    return { erro: 'Não foi possível pedir a busca agora. Tente novamente em instantes.' }
  }
  redirect(`/demandas/busca?id=${id}`)
}
