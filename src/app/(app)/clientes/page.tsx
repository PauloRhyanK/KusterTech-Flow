import type { Metadata } from 'next'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'

export const metadata: Metadata = {
  title: 'Clientes',
}

export default function PaginaClientes() {
  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Clientes' }]}
        titulo="Clientes"
        contexto="Acompanhamento dos clientes e seus projetos"
      />
      <EstadoVazio
        tipo="nao-configurado"
        titulo="Cadastro de clientes ainda não disponível nesta versão."
        descricao="Os clientes e seus projetos aparecem aqui quando o cadastro estiver ativo."
      />
    </div>
  )
}
