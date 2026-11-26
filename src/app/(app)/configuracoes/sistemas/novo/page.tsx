import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterProjetosParaSistemas } from '@/modules/relatos/queries'
import { FormularioDoSistema } from '../_componentes/formulario-do-sistema'
import { criarSistemaAcao } from '../actions'

export const metadata: Metadata = {
  title: 'Conectar sistema',
}

export default async function PaginaConectarSistema() {
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')
  const cabecalho = (
    <CabecalhoDePagina
      trilhas={[
        { rotulo: 'Configurações', href: '/configuracoes' },
        { rotulo: 'Sistemas conectados', href: '/configuracoes/sistemas' },
        { rotulo: 'Conectar sistema' },
      ]}
      titulo="Conectar sistema"
      contexto="O Flow passa a buscar os relatos deste sistema a cada minuto."
    />
  )
  if (!autorizar(sessao.sujeito, 'configuracoes.gerenciar')) {
    return (
      <div className="space-y-6">
        {cabecalho}
        <SemPermissao />
      </div>
    )
  }
  const projetos = await obterProjetosParaSistemas(sessao.sujeito)
  return (
    <div className="space-y-6">
      {cabecalho}
      <div className="rounded-padrao border border-border bg-surface p-6">
        {projetos.length === 0 ? (
          <EstadoVazio
            tipo="nao-configurado"
            titulo="Nenhum projeto com repositório ligado."
            descricao="As demandas dos relatos nascem num repositório do projeto."
          />
        ) : (
          <FormularioDoSistema action={criarSistemaAcao} projetos={projetos} />
        )}
      </div>
    </div>
  )
}
