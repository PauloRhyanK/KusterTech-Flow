import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { listarUsuariosParaTela } from '@/modules/usuarios/queries'
import { BotaoAtivo } from './botao-ativo'
import { FormularioUsuario } from './formulario-usuario'

export const metadata: Metadata = {
  title: 'Usuários',
}

function formatarPapeis(papeis: readonly { papel: string; clienteId: string | null }[]): string {
  return papeis
    .map((p) =>
      p.papel === 'ADMIN'
        ? 'ADMIN'
        : p.clienteId
          ? `${p.papel} (${p.clienteId})`
          : `${p.papel} (todos os clientes)`,
    )
    .join(', ')
}

export default async function PaginaUsuarios() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!autorizar(sessao.sujeito, 'usuarios.gerenciar')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina
          trilhas={[{ rotulo: 'Configurações', href: '/configuracoes' }, { rotulo: 'Usuários' }]}
          titulo="Usuários"
          contexto="Gerenciamento de contas, papéis e permissões de acesso"
        />
        <SemPermissao />
      </div>
    )
  }

  const usuarios = await listarUsuariosParaTela(sessao.sujeito)

  const linhas = usuarios.map((u) => ({
    id: u.id,
    nome: u.nome,
    contexto: <span className="font-mono">{u.email}</span>,
    estado: (
      <BadgeDeEstado tom={u.ativo ? 'sucesso' : 'neutro'}>
        {u.ativo ? 'Ativo' : 'Desativado'}
      </BadgeDeEstado>
    ),
    indicador: <span className="text-xs text-text-secondary">{formatarPapeis(u.papeis)}</span>,
    acoes: (
      <BotaoAtivo usuarioId={u.id} ativo={u.ativo} ehProprioUsuario={u.id === sessao.usuario.id} />
    ),
  }))

  return (
    <div className="space-y-8">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Configurações', href: '/configuracoes' }, { rotulo: 'Usuários' }]}
        titulo="Usuários"
        contexto="Gerenciamento de contas, papéis e permissões de acesso"
      />

      <section className="space-y-4">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">
          Usuários cadastrados
        </h2>
        <ListaOperacional
          rotulo="Lista de usuários"
          linhas={linhas}
          vazio={
            <div className="rounded-padrao border border-border bg-surface p-6 text-center text-sm text-text-secondary">
              Nenhum usuário encontrado.
            </div>
          }
        />
      </section>

      <FormularioUsuario />
    </div>
  )
}
