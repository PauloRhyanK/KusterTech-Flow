import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterFormularioDeDemanda } from '@/modules/demandas/queries'
import { FormularioNovaDemanda } from '../_componentes/formulario-nova-demanda'

const TRILHAS = [{ rotulo: 'Demandas', href: '/demandas' }, { rotulo: 'Nova demanda' }]

export default async function PaginaNovaDemanda() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!autorizar(sessao.sujeito, 'projetos.gerenciar')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={TRILHAS} titulo="Nova demanda" />
        <SemPermissao />
      </div>
    )
  }

  const { projetos } = await obterFormularioDeDemanda(sessao.sujeito)

  return (
    <div className="space-y-6">
      <CabecalhoDePagina trilhas={TRILHAS} titulo="Nova demanda" />
      {projetos.length === 0 ? (
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Nenhum projeto com repositório."
          descricao="Vincule um repositório a um projeto para abrir demandas."
        />
      ) : (
        <FormularioNovaDemanda projetos={projetos} />
      )}
    </div>
  )
}
