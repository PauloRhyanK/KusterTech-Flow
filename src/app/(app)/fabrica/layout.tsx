import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { Abas } from '@/lib/ui/abas'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { obterRetratoMaisRecente } from '@/modules/fabrica/queries'

export const metadata: Metadata = {
  title: 'Fábrica',
}

export default async function LayoutDaFabrica({ children }: { children: ReactNode }) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const permitido = autorizar(sessao.sujeito, 'desenvolvimento.ler')
  const retrato = permitido ? await obterRetratoMaisRecente(sessao.sujeito) : null

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Fábrica' }]}
        titulo="Fábrica"
        contexto="Estado da máquina de agentes, enviado pelo coordenador. Só leitura."
      />
      <Abas
        rotulo="Seções da Fábrica"
        abas={[
          { rotulo: 'Planos em execução', href: '/fabrica', disponivel: true },
          {
            rotulo: 'Avisos',
            href: '/fabrica/avisos',
            disponivel: true,
            contador: retrato?.retrato.avisos.length,
          },
        ]}
      />
      {children}
    </div>
  )
}
