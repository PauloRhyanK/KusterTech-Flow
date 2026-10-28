import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { obterSaudeDoProjeto } from '@/modules/infra/queries'
import { obterProjetoParaResumo } from '@/modules/projetos/queries'
import { ListaDeAlertas } from '@/app/(app)/infraestrutura/_componentes/lista-de-alertas'

export interface PaginaSaudeProjetoProps {
  params: Promise<{ p: string }>
}

export async function generateMetadata({ params }: PaginaSaudeProjetoProps): Promise<Metadata> {
  const { p } = await params
  const sessao = await obterSessao()
  if (!sessao) {
    return { title: 'Projeto' }
  }
  try {
    const projeto = await obterProjetoParaResumo(sessao.sujeito, p, null)
    return { title: projeto.nome }
  } catch {
    return { title: 'Projeto' }
  }
}

export default async function PaginaSaudeProjeto({ params }: PaginaSaudeProjetoProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  const { p } = await params

  let saude: Awaited<ReturnType<typeof obterSaudeDoProjeto>>
  try {
    await obterProjetoParaResumo(sessao.sujeito, p, null)
    saude = await obterSaudeDoProjeto(sessao.sujeito, p)
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) {
      return <SemPermissao />
    }
    if (erro instanceof ErroDeDominio) {
      notFound()
    }
    throw erro
  }

  const titulo = 'text-[18px] font-[600] leading-[1.3] text-text-primary'

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className={titulo}>Alertas</h2>
        <ListaDeAlertas
          rotulo="Alertas não resolvidos do projeto"
          alertas={saude.alertas}
          vazio={
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhum alerta não resolvido para este projeto."
              descricao="Isso não confirma que o projeto está saudável."
            />
          }
        />
      </section>

      <section className="space-y-3">
        <h2 className={titulo}>Erros da aplicação</h2>
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Nenhuma fonte de erros integrada."
          descricao="Consulte o GlitchTip dos recursos associados."
        />
        {saude.glitchTip.length > 0 && (
          <ul role="list" aria-label="GlitchTip dos recursos" className="space-y-1 text-sm">
            {saude.glitchTip.map((g) => (
              <li key={g.href}>
                <a
                  href={g.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-link hover:underline"
                >
                  GlitchTip · {g.recurso}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className={titulo}>Métricas</h2>
        <p className="text-sm text-text-secondary">Sem dados</p>
      </section>
    </div>
  )
}
