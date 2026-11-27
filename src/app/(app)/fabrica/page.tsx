import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { obterEscritorio } from '@/modules/fabrica/escritorio/queries'
import { PainelDaFabrica } from './_componentes/painel-da-fabrica'
import { Atualizar } from './_componentes/escritorio/atualizar'
import { Escritorio } from './_componentes/escritorio/escritorio'

export default async function PaginaDaFabrica() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const agora = new Date()
  const permitido = autorizar(sessao.sujeito, 'desenvolvimento.ler')
  if (!permitido) {
    return <PainelDaFabrica secao="planos" permitido={false} retrato={null} agora={agora} />
  }

  const { escritorio, gestao, recebido, publicacao } = await obterEscritorio(sessao.sujeito, agora)
  return (
    <>
      <Atualizar />
      <Escritorio
        escritorio={escritorio}
        gestao={gestao}
        publicacao={publicacao}
        agora={agora.toISOString()}
        tecnico={<PainelDaFabrica secao="planos" permitido retrato={recebido} agora={agora} />}
      />
    </>
  )
}
