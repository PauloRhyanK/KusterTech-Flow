import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import type { SituacaoDoWebhook as Situacao } from '@/modules/github/queries'

export interface SituacaoDoWebhookProps {
  situacao: Situacao
}

// Nunca em tom `sucesso`: "ativo" só diz que a web tem o segredo, não que o GitHub entrega (invariante 9).
export function SituacaoDoWebhook({ situacao }: SituacaoDoWebhookProps) {
  const { ativo, ultimoEventoEm, eventosNaoProcessados } = situacao

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-text-primary">Webhooks</h3>
      {ativo ? (
        <div className="flex flex-wrap items-center gap-2">
          <BadgeDeEstado tom="informacao">Webhooks ativos</BadgeDeEstado>
          <p className="text-sm text-text-secondary">
            {ultimoEventoEm
              ? `Último evento recebido em ${formatarDataHora(ultimoEventoEm)}.`
              : 'Nenhum evento recebido ainda. Confira a URL e o segredo na GitHub App.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <BadgeDeEstado tom="neutro">Webhooks desativados</BadgeDeEstado>
          <p className="text-sm text-text-secondary">
            As mudanças do GitHub chegam pela reconciliação periódica.
          </p>
        </div>
      )}
      {eventosNaoProcessados > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <BadgeDeEstado tom="atencao">
            {eventosNaoProcessados === 1
              ? '1 evento não processado'
              : `${eventosNaoProcessados} eventos não processados`}
          </BadgeDeEstado>
          <p className="text-sm text-text-secondary">
            A reconciliação periódica cobre essas mudanças.
          </p>
        </div>
      )}
    </div>
  )
}
