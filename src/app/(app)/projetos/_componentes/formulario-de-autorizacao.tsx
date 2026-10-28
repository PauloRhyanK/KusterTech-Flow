'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { ComposicaoApresentada } from '@/modules/publicacao/queries'
import { autorizarPublicacaoAction } from '../[p]/(abas)/publicacoes/actions'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface FormularioDeAutorizacaoProps {
  projetoId: string
  projetoNome: string
  repositorio: { id: string; nomeCompleto: string }
  versao: { id: string; rotulo: string }
  composicao: ComposicaoApresentada
  podeAutorizar: boolean
  // Depois de autorizar o formulário some, mas a região de status continua montada para
  // anunciar o resultado da ação que acabou de acontecer.
  autorizada?: boolean
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

const CLASSE_CAIXA = 'flex items-start gap-2 text-sm text-text-primary'

// Autorizar PROD (D28–D31): um clique conferido sobre a composição exata mostrada. A autorização
// não dispara o deploy; o pipeline do projeto continua sendo quem publica.
export function FormularioDeAutorizacao(props: FormularioDeAutorizacaoProps) {
  const { composicao } = props
  const [estado, enviar, pendente] = useActionState(autorizarPublicacaoAction, {})

  if (!props.podeAutorizar) {
    return (
      <p className="text-sm text-text-secondary">
        Somente administradores autorizam publicação em PROD.
      </p>
    )
  }
  if (props.autorizada || composicao.desatualizada || composicao.avaliacao.bloqueios.length > 0) {
    return (
      <form action={enviar} aria-busy={pendente}>
        <MensagensDeEstado estado={estado} />
      </form>
    )
  }

  const { avaliacao } = composicao
  const paraVerificar = avaliacao.itens.filter((i) => i.exigeVerificacaoHumana)
  const temDesconhecidos = avaliacao.desconhecidos.length > 0
  const pedeJustificativa = composicao.estado === 'INCERTA' || paraVerificar.length > 0

  return (
    <form action={enviar} aria-busy={pendente} className="space-y-3">
      <MensagensDeEstado estado={estado} />
      <input type="hidden" name="projetoId" value={props.projetoId} />
      <input type="hidden" name="repositorioId" value={props.repositorio.id} />
      <input type="hidden" name="versaoAlvoId" value={props.versao.id} />
      <input type="hidden" name="composicaoId" value={composicao.id} />
      <input type="hidden" name="hashComposicao" value={composicao.hash} />

      <div className="grid gap-1 text-sm text-text-secondary">
        <p>Projeto: {props.projetoNome}</p>
        <p>Repositório: {props.repositorio.nomeCompleto}</p>
        <p>Versão: {props.versao.rotulo}</p>
        <p>Base: {composicao.commitBaseCurto ?? 'sem base conhecida'}</p>
        <p>Composição: {composicao.hash.slice(0, 7)}</p>
      </div>

      {paraVerificar.map((item) => (
        <label key={item.issueId} className={CLASSE_CAIXA}>
          <input type="checkbox" name="verificadas" value={item.issueId} className="mt-0.5" />
          <span>{`Verifiquei #${item.numero} manualmente`}</span>
        </label>
      ))}
      {temDesconhecidos && (
        <label className={CLASSE_CAIXA}>
          <input type="checkbox" name="desconhecidosConferidos" className="mt-0.5" />
          <span>Conferi manualmente os itens desconhecidos.</span>
        </label>
      )}
      {pedeJustificativa && (
        <div className="space-y-1">
          <label
            htmlFor={`justificativa-${props.repositorio.id}`}
            className="text-sm text-text-primary"
          >
            Justificativa
          </label>
          <textarea
            id={`justificativa-${props.repositorio.id}`}
            name="justificativa"
            rows={3}
            maxLength={1000}
            className={CLASSE_CAMPO}
          />
        </div>
      )}
      <label className={CLASSE_CAIXA}>
        <input type="checkbox" name="contextoConferido" className="mt-0.5" />
        <span>Conferi o projeto, o repositório, a versão e a composição acima.</span>
      </label>

      <Button type="submit" aria-busy={pendente}>
        Autorizar publicação em PROD
      </Button>
    </form>
  )
}
