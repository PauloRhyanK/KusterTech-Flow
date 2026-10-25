import type { Metadata } from 'next'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'

export const metadata: Metadata = {
  title: 'Registro não encontrado',
}

export default function NaoEncontrado() {
  return (
    <div className="space-y-6">
      <CabecalhoDePagina trilhas={[]} titulo="Registro não encontrado" />
      <EstadoVazio
        tipo="nenhum-registro"
        titulo="Este registro não existe ou não está disponível para você."
        descricao="Volte para a lista e tente de novo."
        acao={
          <Link href="/" className={buttonVariants({ variant: 'default' })}>
            Ir para a Visão Geral
          </Link>
        }
      />
    </div>
  )
}
