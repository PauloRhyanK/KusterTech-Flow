import type { Metadata } from 'next'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'

export const metadata: Metadata = {
  title: 'Visão Geral',
}

export default function PaginaVisaoGeral() {
  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Visão Geral' }]}
        titulo="Visão Geral"
        contexto="Pendências prioritárias; resumos de projetos e infraestrutura"
      />
      <EstadoVazio
        tipo="nao-configurado"
        titulo="Pendências ainda não disponíveis."
        descricao="Elas aparecem quando projetos, integrações e homologações estiverem configurados."
      />
    </div>
  )
}
