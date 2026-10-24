import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'

export const metadata: Metadata = {
  title: 'Configurações',
}

export default async function PaginaConfiguracoes() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const podeGerenciarUsuarios = autorizar(sessao.sujeito, 'usuarios.gerenciar')

  return (
    <div className="space-y-8">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Configurações' }]}
        titulo="Configurações"
        contexto="Preferências da conta e da aplicação."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/configuracoes/aparencia"
          className="flex flex-col gap-1 rounded-padrao border border-border bg-surface p-5 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <span className="text-[15px] font-[600] leading-[1.4] text-text-primary">Aparência</span>
          <span className="text-sm text-text-secondary">
            Preferência de tema claro, escuro ou do sistema para sua conta.
          </span>
        </Link>

        {podeGerenciarUsuarios && (
          <Link
            href="/configuracoes/usuarios"
            className="flex flex-col gap-1 rounded-padrao border border-border bg-surface p-5 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <span className="text-[15px] font-[600] leading-[1.4] text-text-primary">Usuários</span>
            <span className="text-sm text-text-secondary">
              Gerenciamento de contas, papéis e permissões de acesso.
            </span>
          </Link>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-[18px] font-[600] leading-[1.3] text-text-primary">Integrações</h2>
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Nenhuma integração configurada."
          descricao="GitHub e infraestrutura chegam nos próximos incrementos."
        />
      </section>
    </div>
  )
}
