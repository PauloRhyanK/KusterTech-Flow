import type { Metadata } from 'next'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'

export const metadata: Metadata = {
  title: 'Central de Desenvolvimento',
}

export default function PaginaDesenvolvimento() {
  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Central de Desenvolvimento' }]}
        titulo="Central de Desenvolvimento"
        contexto="Issues, PRs e execuções de agentes"
      />
      <EstadoVazio
        tipo="nao-configurado"
        titulo="Nenhuma integração de desenvolvimento configurada."
        descricao="Issues, PRs e execuções aparecem quando o GitHub e o Warren estiverem configurados."
      />
    </div>
  )
}
