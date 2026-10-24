import type { Metadata } from 'next'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'

export const metadata: Metadata = {
  title: 'Projetos',
}

export default function PaginaProjetos() {
  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Projetos' }]}
        titulo="Projetos"
        contexto="Gestão global de projetos, entregas e homologações"
      />
      <EstadoVazio
        tipo="nao-configurado"
        titulo="Cadastro de projetos ainda não disponível nesta versão."
        descricao="Projetos, entregas e homologações aparecem aqui quando o cadastro estiver ativo."
      />
    </div>
  )
}
