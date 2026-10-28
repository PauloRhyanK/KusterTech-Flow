import Link from 'next/link'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import type { EstadosDePublicacao, resumirEstadosDaMilestone } from '@/modules/publicacao/model'
import { EstadosDaPublicacao } from './estados-de-publicacao'

type ResumoDaMilestone = ReturnType<typeof resumirEstadosDaMilestone>

function SemProd({ hrefAmbientes }: { hrefAmbientes?: string | null }) {
  return (
    <EstadoVazio
      tipo="nao-configurado"
      titulo="O ambiente PROD não está configurado."
      descricao="Configure os ambientes em Configuração › Ambientes."
      acao={
        hrefAmbientes ? (
          <Link href={hrefAmbientes} className="text-sm text-text-link hover:underline">
            Configurar ambientes
          </Link>
        ) : undefined
      }
    />
  )
}

function VerPublicacoes({ projetoId }: { projetoId: string }) {
  return (
    <Link
      href={`/projetos/${projetoId}/publicacoes`}
      className="text-sm text-text-link hover:underline"
    >
      Ver publicações
    </Link>
  )
}

export interface ResumoDePublicacaoProps {
  projetoId: string
  prodConfigurado: boolean
  resumo: ResumoDaMilestone
  hrefAmbientes?: string | null
}

// Milestone, visão global: onde cada issue do escopo está na publicação (D68).
export function ResumoDePublicacao({
  projetoId,
  prodConfigurado,
  resumo,
  hrefAmbientes,
}: ResumoDePublicacaoProps) {
  const { total } = resumo
  const contagens = [
    `QA aprovado: ${resumo.qaAprovado} de ${total}`,
    `Autorizadas para PROD: ${resumo.autorizadas} de ${total}`,
    `Em PROD: ${resumo.emProd} de ${total}`,
    `Verificadas em produção: ${resumo.verificadas} de ${total}`,
  ]
  const divergentes = resumo.emProdSemAutorizacao

  return (
    <section aria-labelledby="publicacao-da-milestone" className="space-y-3">
      <h2 id="publicacao-da-milestone" className="text-lg font-semibold text-text-primary">
        Publicação
      </h2>
      {!prodConfigurado ? (
        <SemProd hrefAmbientes={hrefAmbientes} />
      ) : total === 0 ? (
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Sem issues no escopo desta milestone."
          descricao="Adicione issues à milestone para acompanhar a publicação."
        />
      ) : (
        <>
          <ul className="space-y-1 text-sm text-text-primary">
            {contagens.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {divergentes > 0 && (
            <p className="text-sm text-atencao">
              {divergentes === 1 ? '1 issue' : `${divergentes} issues`} em PROD por um deploy sem
              autorização registrada.
            </p>
          )}
          <VerPublicacoes projetoId={projetoId} />
        </>
      )}
    </section>
  )
}

export interface PublicacaoDaIssueProps {
  projetoId: string
  prodConfigurado: boolean
  estados: EstadosDePublicacao | null
  hrefAmbientes?: string | null
}

// Issue, visão global: os quatro estados na lateral.
export function PublicacaoDaIssue({
  projetoId,
  prodConfigurado,
  estados,
  hrefAmbientes,
}: PublicacaoDaIssueProps) {
  return (
    <section aria-labelledby="publicacao-da-issue" className="space-y-3">
      <h2 id="publicacao-da-issue" className="text-[15px] font-[600] text-text-primary">
        Publicação
      </h2>
      {!prodConfigurado || !estados ? (
        <SemProd hrefAmbientes={hrefAmbientes} />
      ) : (
        <>
          <EstadosDaPublicacao estados={estados} />
          <VerPublicacoes projetoId={projetoId} />
        </>
      )}
    </section>
  )
}
