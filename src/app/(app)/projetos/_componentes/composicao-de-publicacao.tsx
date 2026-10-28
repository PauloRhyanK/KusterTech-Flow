import { BadgeDeEstado, type TomDeEstado } from '@/lib/ui/badge-de-estado'
import {
  descreverItemDesconhecido,
  type AvaliacaoDeAutorizacao,
  type ItemDaComposicao,
} from '@/modules/publicacao/model'
import type { ComposicaoApresentada } from '@/modules/publicacao/queries'

export interface ComposicaoDaPublicacaoProps {
  composicao: ComposicaoApresentada
}

const ORIGEM_DA_BASE: Record<ComposicaoApresentada['origemDaBase'], string> = {
  EVIDENCIA_PROD: 'versão em PROD pela evidência',
  AUTORIZACAO: 'última autorização',
  SEM_BASE: 'sem base conhecida',
}

function textoDaBase(c: ComposicaoApresentada): string {
  return c.commitBaseCurto
    ? `Base: ${c.commitBaseCurto} (${ORIGEM_DA_BASE[c.origemDaBase]})`
    : 'Base: sem base conhecida'
}

function selo(item: AvaliacaoDeAutorizacao['itens'][number]): { tom: TomDeEstado; texto: string } {
  switch (item.situacao) {
    case 'QA_APROVADO':
      return { tom: 'sucesso', texto: 'QA aprovado' }
    case 'REAPROVEITADO':
      return { tom: 'informacao', texto: 'Aprovação reaproveitada' }
    case 'VERIFICADO_POR_HUMANO':
      return { tom: 'informacao', texto: 'Verificada manualmente' }
    case null:
      return item.exigeVerificacaoHumana
        ? { tom: 'atencao', texto: 'Verificação humana necessária' }
        : { tom: 'erro', texto: 'Não pode ser autorizada' }
  }
}

function Lista({ titulo, itens }: { titulo: string; itens: readonly string[] }) {
  if (itens.length === 0) return null
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-[600] text-text-primary">{titulo}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
        {itens.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  )
}

export function ComposicaoDaPublicacao({ composicao }: ComposicaoDaPublicacaoProps) {
  const { avaliacao } = composicao
  const desconhecidos = composicao.itens.filter(
    (i): i is Exclude<ItemDaComposicao, { tipo: 'issue' }> => i.tipo !== 'issue',
  )
  const issues = composicao.itens.filter(
    (i): i is Extract<ItemDaComposicao, { tipo: 'issue' }> => i.tipo === 'issue',
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-text-secondary">{textoDaBase(composicao)}</p>
        {composicao.estado === 'IDENTIFICADA' ? (
          <BadgeDeEstado tom="informacao">Composição identificada</BadgeDeEstado>
        ) : (
          <BadgeDeEstado tom="atencao">Composição incerta</BadgeDeEstado>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((issue) => {
            const avaliado = avaliacao.itens.find((i) => i.issueId === issue.issueId)
            const etiqueta = avaliado ? selo(avaliado) : null
            return (
              <li
                key={issue.issueId}
                className="space-y-1 rounded-compacto border border-border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-[600] text-text-primary">
                    {`#${issue.numero} ${composicao.tituloPorIssueId[issue.issueId] ?? ''}`.trim()}
                  </span>
                  {etiqueta && <BadgeDeEstado tom={etiqueta.tom}>{etiqueta.texto}</BadgeDeEstado>}
                </div>
                {avaliado && <p className="text-sm text-text-secondary">{avaliado.motivo}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {desconhecidos.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-sm font-[600] text-text-primary">Itens desconhecidos</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
            {desconhecidos.map((d) => {
              const texto = descreverItemDesconhecido(d)
              return <li key={JSON.stringify(d)}>{texto}</li>
            })}
          </ul>
        </div>
      )}

      <Lista titulo="Bloqueios" itens={avaliacao.bloqueios} />
      <Lista titulo="Homologações pendentes (não bloqueiam)" itens={avaliacao.avisos} />
    </div>
  )
}
