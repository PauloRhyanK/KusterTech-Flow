'use client'

import { useActionState, useState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'

export interface FonteNaLista {
  id: string
  nome: string
  criadoEm: Date
  ultimoUsoEm: Date | null
  revogadaEm: Date | null
}

export interface EstadoDeFontes {
  erro?: string
  sucesso?: string
  token?: string
}

export type ActionDeFontes = (estado: EstadoDeFontes, form: FormData) => Promise<EstadoDeFontes>

export interface TextosDeFontes {
  titulo: string
  ariaDaLista: string
  vazioTitulo: string
  vazioDescricao: string
  avisoDoToken: string
  idDoCampoNome: string
}

export interface FontesComTokenProps {
  fontes: readonly FonteNaLista[]
  criarAction: ActionDeFontes
  revogarAction: ActionDeFontes
  textos: TextosDeFontes
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function FontesComToken({
  fontes,
  criarAction,
  revogarAction,
  textos,
}: FontesComTokenProps) {
  const [estadoCriar, criar, pendenteCriar] = useActionState(criarAction, {})
  const [estadoRevogar, revogar, pendenteRevogar] = useActionState(revogarAction, {})
  // Só a mensagem e o token da última ação ficam na tela; o token some ao revogar.
  const [ultima, setUltima] = useState<'criar' | 'revogar'>('criar')
  const estadoVisivel = ultima === 'criar' ? estadoCriar : estadoRevogar

  return (
    <section className="space-y-4 rounded-padrao border border-border bg-surface p-4">
      <h2 className="text-[15px] font-[600] text-text-primary">{textos.titulo}</h2>
      <MensagensDeEstado estado={estadoVisivel} />
      <div role="status" aria-live="polite">
        {ultima === 'criar' && estadoCriar.token && (
          <div className="space-y-2 rounded-compacto border border-border bg-surface-subtle p-3 text-sm">
            <code className="block break-all font-mono text-text-primary">{estadoCriar.token}</code>
            <p className="text-text-secondary">{textos.avisoDoToken}</p>
          </div>
        )}
      </div>

      {fontes.length === 0 ? (
        <EstadoVazio
          tipo="nao-configurado"
          titulo={textos.vazioTitulo}
          descricao={textos.vazioDescricao}
        />
      ) : (
        <ul aria-label={textos.ariaDaLista} className="divide-y divide-border">
          {fontes.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="break-words font-medium text-text-primary">{f.nome}</p>
                <p className="text-text-secondary">
                  {f.ultimoUsoEm
                    ? `Último envio: ${formatarDataHora(f.ultimoUsoEm)}`
                    : 'Nenhum envio ainda'}
                </p>
              </div>
              {f.revogadaEm ? (
                <BadgeDeEstado tom="neutro">Revogado</BadgeDeEstado>
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
          <label
            htmlFor={textos.idDoCampoNome}
            className="block text-sm font-medium text-text-primary"
          >
            Nome
          </label>
          <input
            id={textos.idDoCampoNome}
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
          Criar token
        </Button>
      </form>
    </section>
  )
}
