import { redirect } from 'next/navigation'
import { autorizar, ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterPilha, type PilhaDoDecidir } from '@/modules/decidir/queries'
import { TelaDecidir } from './_componentes/tela-decidir'

export default async function PaginaDoDecidir({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')

  let pilha: PilhaDoDecidir
  try {
    pilha = await obterPilha(sessao.sujeito, new Date())
  } catch (erro) {
    if (!(erro instanceof ErroDeAutorizacao)) throw erro
    return (
      <div className="space-y-6">
        <h1 className="text-[24px] font-[650] leading-[1.25] text-text-primary">Decidir</h1>
        <SemPermissao />
      </div>
    )
  }

  // `?item=<chave>` abre esse item quando ele está na pilha; senão, o primeiro.
  const pedido = (await searchParams).item
  const inicial =
    typeof pedido === 'string' && pilha.itens.some((i) => i.chave === pedido) ? pedido : null

  return (
    <TelaDecidir
      itens={pilha.itens}
      guardados={pilha.guardados}
      conversas={pilha.conversas}
      inicial={inicial}
      podeAgir={autorizar(sessao.sujeito, 'projetos.gerenciar')}
      resolvidasSemVoce={pilha.resolvidasSemVoce}
    />
  )
}
