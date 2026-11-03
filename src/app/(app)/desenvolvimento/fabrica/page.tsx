import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { obterRetratoMaisRecente } from '@/modules/fabrica/queries'
import { PainelDaFabrica } from './_componentes/painel-da-fabrica'

export const metadata: Metadata = {
  title: 'Fábrica de agentes',
}

export default async function PaginaDaFabrica() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const permitido = autorizar(sessao.sujeito, 'desenvolvimento.ler')
  const retrato = permitido ? await obterRetratoMaisRecente(sessao.sujeito) : null

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[
          { rotulo: 'Central de Desenvolvimento', href: '/desenvolvimento' },
          { rotulo: 'Fábrica de agentes' },
        ]}
        titulo="Fábrica de agentes"
        contexto="Estado da máquina de agentes, enviado pelo coordenador. Só leitura."
      />
      <PainelDaFabrica permitido={permitido} retrato={retrato} agora={new Date()} />
    </div>
  )
}
