'use client'

import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import type { DivergenciaApresentada } from '@/modules/publicacao/queries'
import { reconhecerDivergenciaAction } from '../[p]/(abas)/publicacoes/actions'
import { MensagensDeEstado } from './mensagens-de-estado'
import { ORIGEM_DA_EVIDENCIA } from './origem-da-evidencia'

export interface DivergenciasDeDeployProps {
  projetoId: string
  divergencias: readonly DivergenciaApresentada[]
  podeAutorizar: boolean
}

// Invariante 7: o deploy em PROD sem autorização é registrado e reconhecido, nunca "bloqueado".
// Reconhecer só diz que alguém viu; não autoriza a versão.
export function DivergenciasDeDeploy({
  projetoId,
  divergencias,
  podeAutorizar,
}: DivergenciasDeDeployProps) {
  const [estado, enviar, pendente] = useActionState(reconhecerDivergenciaAction, {})

  return (
    <div className="space-y-3 rounded-padrao border border-border bg-surface p-4">
      <h3 className="text-base font-[600] text-text-primary">Divergências</h3>
      <MensagensDeEstado estado={estado} />
      {divergencias.length === 0 ? (
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Nenhuma divergência de deploy."
          descricao="Deploys em PROD sem autorização registrada aparecem aqui."
        />
      ) : (
        <ul className="space-y-3">
          {divergencias.map((d) => (
            <li
              key={d.id}
              id={`divergencia-${d.id}`}
              className="space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0"
            >
              <BadgeDeEstado tom="atencao">Deploy em PROD sem autorização registrada</BadgeDeEstado>
              <p className="text-sm text-text-secondary">
                {`${d.commitCurto} · ${ORIGEM_DA_EVIDENCIA[d.origem]} · deploy em ${formatarDataHora(d.ocorridaEm)}`}
              </p>
              <p className="text-sm text-text-secondary">
                {`Detectada em ${formatarDataHora(d.detectadaEm)}`}
              </p>
              {d.reconhecida ? (
                <p className="text-sm text-text-secondary">
                  {`Reconhecida por ${d.reconhecida.porNome} em ${formatarDataHora(d.reconhecida.em)}. Reconhecer não autoriza a versão.`}
                </p>
              ) : (
                podeAutorizar && (
                  <BotaoDeConfirmacao
                    rotulo="Reconhecer divergência"
                    rotuloDeConfirmacao="Confirmar reconhecimento"
                    action={enviar}
                    camposOcultos={{ projetoId, divergenciaId: d.id }}
                    pendente={pendente}
                  />
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
