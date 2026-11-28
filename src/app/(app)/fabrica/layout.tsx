import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { Abas } from '@/lib/ui/abas'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { moduloAtivo } from '@/lib/modulos'
import { rotuloDaAba } from '@/modules/erros/apresentacao'
import { obterQuadroDeErros } from '@/modules/erros/queries'
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
  const comErros = moduloAtivo('erros')
  const [retrato, erros] = permitido
    ? await Promise.all([
        obterRetratoMaisRecente(sessao.sujeito),
        comErros ? obterQuadroDeErros(sessao.sujeito, new Date()) : null,
      ])
    : [null, null]

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Fábrica' }]}
        titulo="Fábrica"
        contexto="O escritório da Fábrica: cada andar é uma demanda em execução. Só leitura."
      />
      <Abas
        rotulo="Seções da Fábrica"
        abas={[
          { rotulo: 'Escritório', href: '/fabrica', disponivel: true },
          ...(moduloAtivo('fabrica-operacao')
            ? [{ rotulo: 'Operação', href: '/fabrica/operacao', disponivel: true }]
            : []),
          {
            rotulo: 'Avisos',
            href: '/fabrica/avisos',
            disponivel: true,
            contador: retrato?.retrato.avisos.length,
          },
          ...(comErros
            ? [
                {
                  ...(erros ? rotuloDaAba(erros) : { rotulo: 'Erros' }),
                  href: '/fabrica/erros',
                  disponivel: true,
                },
              ]
            : []),
        ]}
      />
      {children}
    </div>
  )
}
