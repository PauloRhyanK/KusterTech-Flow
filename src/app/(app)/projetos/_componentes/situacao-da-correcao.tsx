import Link from 'next/link'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import type { CorrecaoNaTela } from '@/modules/homologacao/queries'
import { ClassificarForaDoEscopo, FormularioDeTriagem } from './formulario-de-triagem'

// Contexto de cliente (D40, D63): o link leva à issue dentro do próprio contexto, nunca ao GitHub.
export function SituacaoDaCorrecao({ correcao }: { correcao: CorrecaoNaTela }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <BadgeDeEstado tom={correcao.situacao.tom}>{correcao.situacao.texto}</BadgeDeEstado>
        {correcao.foraDoEscopo && <BadgeDeEstado tom="neutro">Fora do escopo</BadgeDeEstado>}
        {correcao.issueAlvo && (
          <Link href={correcao.issueAlvo.href} className="text-text-link hover:underline">
            #{correcao.issueAlvo.numero} · {correcao.issueAlvo.titulo}
          </Link>
        )}
      </div>
      {correcao.foraDoEscopo && correcao.justificativa && (
        <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">
          {correcao.justificativa}
        </p>
      )}
    </div>
  )
}

export interface BlocoDaCorrecaoProps {
  correcao: CorrecaoNaTela
  podeTriar: boolean
  integracaoConfigurada: boolean
  projetoId: string
  clienteId: string
  issueId: string
  milestoneId: string
  issueNumero: number
  issueTitulo: string
}

// Bloco "Correção" sob cada solicitação da timeline; sem `podeTriar` é só leitura.
export function BlocoDaCorrecao(props: BlocoDaCorrecaoProps) {
  const { correcao, podeTriar } = props
  const ids = {
    projetoId: props.projetoId,
    clienteId: props.clienteId,
    solicitacaoId: correcao.id,
    issueId: props.issueId,
    milestoneId: props.milestoneId,
  }
  return (
    <section
      aria-labelledby={`correcao-${correcao.id}`}
      className="space-y-3 rounded-padrao border border-border bg-surface-subtle p-4"
    >
      <h3 id={`correcao-${correcao.id}`} className="text-sm font-[600] text-text-primary">
        Correção
      </h3>
      <SituacaoDaCorrecao correcao={correcao} />
      {podeTriar && (
        <FormularioDeTriagem
          {...ids}
          ofertar={correcao.triavel}
          issueNumero={props.issueNumero}
          issueTitulo={props.issueTitulo}
          reabrivel={correcao.reabrivel}
          integracaoConfigurada={props.integracaoConfigurada}
          repositorioPublico={correcao.repositorioPublico}
        />
      )}
      {podeTriar && <ClassificarForaDoEscopo {...ids} ofertar={correcao.reclassificavel} />}
    </section>
  )
}
