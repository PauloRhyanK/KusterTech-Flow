import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterProjetosParaSistemas, obterSistemaParaEditar } from '@/modules/relatos/queries'
import { RevogarSistema, TestarConexao } from '../_componentes/acoes-do-sistema'
import { FormularioDoSistema } from '../_componentes/formulario-do-sistema'
import { editarSistemaAcao, revogarSistemaAcao, testarConexaoAcao } from '../actions'

export const metadata: Metadata = {
  title: 'Sistema conectado',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaDoSistema({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ criado?: string }>
}) {
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')
  const { id } = await params
  const { criado } = await searchParams
  const trilhas = [
    { rotulo: 'Configurações', href: '/configuracoes' },
    { rotulo: 'Sistemas conectados', href: '/configuracoes/sistemas' },
  ]
  if (!autorizar(sessao.sujeito, 'configuracoes.gerenciar')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={trilhas} titulo="Sistema conectado" />
        <SemPermissao />
      </div>
    )
  }
  if (!UUID.test(id)) notFound()
  const sistema = await obterSistemaParaEditar(sessao.sujeito, id)
  if (!sistema || sistema.estado === 'REVOGADO') notFound()
  const projetos = await obterProjetosParaSistemas(sessao.sujeito)

  return (
    <div className="space-y-6">
      <CabecalhoDePagina trilhas={[...trilhas, { rotulo: sistema.nome }]} titulo={sistema.nome} />
      {criado === '1' && (
        <p
          role="status"
          className="rounded-compacto border border-sucesso/30 bg-tonal-sucesso p-3 text-sm text-sucesso"
        >
          Sistema conectado. Teste a conexão.
        </p>
      )}
      {sistema.estado === 'DESCONECTADO' && (
        <p
          role="alert"
          className="rounded-compacto border border-erro/30 bg-tonal-erro p-3 text-sm text-erro"
        >
          O sistema recusou o token. Salve um token novo para voltar a buscar.
        </p>
      )}
      {sistema.estado === 'ATIVO' && sistema.ultimoErro && (
        <p className="rounded-compacto border border-atencao/30 bg-tonal-atencao p-3 text-sm text-atencao">
          Última busca: {sistema.ultimoErro}
        </p>
      )}
      <div className="rounded-padrao border border-border bg-surface p-6">
        <FormularioDoSistema action={editarSistemaAcao} projetos={projetos} sistema={sistema} />
      </div>
      <div className="flex flex-col gap-6 rounded-padrao border border-border bg-surface p-6 md:flex-row md:justify-between">
        <TestarConexao sistemaId={sistema.id} action={testarConexaoAcao} />
        <RevogarSistema sistemaId={sistema.id} action={revogarSistemaAcao} />
      </div>
    </div>
  )
}
