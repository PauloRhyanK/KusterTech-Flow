import type { Metadata } from 'next'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'

export const metadata: Metadata = {
  title: 'Infraestrutura',
}

export default function PaginaInfraestrutura() {
  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Infraestrutura' }]}
        titulo="Infraestrutura"
        contexto="Inventário, recursos, alertas e diagnóstico"
      />
      <EstadoVazio
        tipo="nao-configurado"
        titulo="Nenhuma fonte de inventário configurada."
        descricao="Recursos aparecem quando uma integração de infraestrutura for configurada."
      />
    </div>
  )
}
