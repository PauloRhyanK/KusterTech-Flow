'use client'

import { useActionState, useState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { criarFonteDeAlertasAction, revogarFonteDeAlertasAction } from '../actions'

export interface FonteDeAlertasNaLista {
  id: string
  nome: string
  criadoEm: Date
  ultimoUsoEm: Date | null
  revogadaEm: Date | null
}

export interface FontesDeAlertasProps {
  fontes: readonly FonteDeAlertasNaLista[]
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function FontesDeAlertas({ fontes }: FontesDeAlertasProps) {
  const [estadoCriar, criar, pendenteCriar] = useActionState(criarFonteDeAlertasAction, {})
  const [estadoRevogar, revogar, pendenteRevogar] = useActionState(revogarFonteDeAlertasAction, {})
  // Só a mensagem da última ação executada fica na tela; a das anteriores já é história.
  const [ultima, setUltima] = useState<'criar' | 'revogar'>('criar')
  const estadoVisivel = ultima === 'criar' ? estadoCriar : estadoRevogar

  return (
    <section id="fontes" className="space-y-4 rounded-padrao border border-border bg-surface p-4">
      <h2 className="text-[15px] font-[600] text-text-primary">Fontes de alertas</h2>
      <MensagensDeEstado estado={estadoVisivel} />
      <div role="status" aria-live="polite">
        {estadoCriar.token && (
          <div className="space-y-2 rounded-compacto border border-border bg-surface-subtle p-3 text-sm">
            <code className="block break-all font-mono text-text-primary">{estadoCriar.token}</code>
            <p className="text-text-secondary">
              Copie agora; o token não será mostrado de novo. Envie-o no cabeçalho Authorization:
              Bearer &lt;token&gt;.
            </p>
          </div>
        )}
      </div>

      {fontes.length === 0 ? (
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Nenhuma fonte de alertas configurada."
          descricao="Crie uma fonte para receber alertas pelo webhook POST /api/alertas."
        />
      ) : (
        <ul aria-label="Fontes de alertas" className="divide-y divide-border">
          {fontes.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="break-words font-medium text-text-primary">{f.nome}</p>
                <p className="text-text-secondary">
                  {f.ultimoUsoEm
                    ? `Última notificação: ${formatarDataHora(f.ultimoUsoEm)}`
                    : 'Nunca usada'}
                </p>
              </div>
              {f.revogadaEm ? (
                <BadgeDeEstado tom="neutro">Revogada</BadgeDeEstado>
              ) : (
                <div onSubmit={() => setUltima('revogar')}>
                  <BotaoDeConfirmacao
                    rotulo="Revogar"
                    rotuloDeConfirmacao="Confirmar revogação"
                    action={revogar}
                    pendente={pendenteRevogar}
                    camposOcultos={{ fonteId: f.id }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form action={criar} onSubmit={() => setUltima('criar')} className="max-w-xl space-y-2">
        <div className="space-y-1">
          <label htmlFor="fonte-nome" className="block text-sm font-medium text-text-primary">
            Nome
          </label>
          <input
            id="fonte-nome"
            name="nome"
            type="text"
            required
            maxLength={80}
            className={CLASSE_CAMPO}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          aria-busy={pendenteCriar}
          onClick={(e) => {
            if (pendenteCriar) {
              e.preventDefault()
            }
          }}
        >
          Criar fonte
        </Button>
      </form>
    </section>
  )
}
