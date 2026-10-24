import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SeletorDeTema } from './seletor-de-tema'

export const metadata: Metadata = {
  title: 'Aparência',
}

export default async function PaginaAparencia() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Configurações', href: '/configuracoes' }, { rotulo: 'Aparência' }]}
        titulo="Aparência"
        contexto="Personalização visual e preferência de tema da aplicação"
      />
      <SeletorDeTema temaAtual={sessao.usuario.tema} />
    </div>
  )
}
