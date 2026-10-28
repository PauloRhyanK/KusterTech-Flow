'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { reclassificarSolicitacaoAction, triarSolicitacaoAction } from '../acoes-de-triagem'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface FormularioDeTriagemProps {
  projetoId: string
  clienteId: string
  solicitacaoId: string
  issueId: string
  milestoneId: string
  issueNumero: number
  issueTitulo: string
  reabrivel: boolean
  integracaoConfigurada: boolean
  repositorioPublico: boolean
  // Falso depois da triagem: o formulário some, mas a região de status continua montada para
  // anunciar o resultado da ação que acabou de acontecer.
  ofertar?: boolean
}

type Opcao = 'reabrir' | 'criar_correcao' | 'responder'

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

type Ids = Pick<
  FormularioDeTriagemProps,
  'projetoId' | 'clienteId' | 'solicitacaoId' | 'issueId' | 'milestoneId'
>

function CamposOcultos(props: Ids) {
  return (
    <>
      <input type="hidden" name="projetoId" value={props.projetoId} />
      <input type="hidden" name="clienteId" value={props.clienteId} />
      <input type="hidden" name="solicitacaoId" value={props.solicitacaoId} />
      <input type="hidden" name="issueId" value={props.issueId} />
      <input type="hidden" name="milestoneId" value={props.milestoneId} />
    </>
  )
}

export function FormularioDeTriagem(props: FormularioDeTriagemProps) {
  const [estado, enviar, pendente] = useActionState(triarSolicitacaoAction, {})
  const abreTarefa = props.integracaoConfigurada
  const opcoes: Opcao[] = [
    ...(abreTarefa && props.reabrivel ? (['reabrir'] as const) : []),
    ...(abreTarefa ? (['criar_correcao'] as const) : []),
    'responder',
  ]
  const [escolhida, setEscolhida] = useState<Opcao>(opcoes[0]!)
  const [foraDoEscopo, setForaDoEscopo] = useState(false)
  const opcao = opcoes.includes(escolhida) ? escolhida : opcoes[0]!

  if (props.ofertar === false) {
    return (
      <form action={enviar} aria-busy={pendente}>
        <MensagensDeEstado estado={estado} />
      </form>
    )
  }

  const rotulos: Record<Opcao, string> = {
    reabrir: `Reabrir a issue #${props.issueNumero} no GitHub`,
    criar_correcao: 'Criar issue de correção vinculada',
    responder: 'Responder sem abrir tarefa',
  }
  const botao: Record<Opcao, string> = {
    reabrir: `Reabrir #${props.issueNumero} no GitHub`,
    criar_correcao: 'Criar issue no GitHub',
    responder: 'Registrar resposta',
  }

  return (
    <form action={enviar} aria-busy={pendente} className="space-y-3">
      <MensagensDeEstado estado={estado} />
      <CamposOcultos {...props} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-[600] text-text-primary">Decisão da triagem</legend>
        {!abreTarefa && (
          <p className="text-sm text-text-secondary">
            A integração com o GitHub não está configurada; só é possível responder sem abrir
            tarefa.
          </p>
        )}
        {opcoes.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="radio"
              name="tipo"
              value={o}
              checked={opcao === o}
              onChange={() => setEscolhida(o)}
            />
            {rotulos[o]}
          </label>
        ))}
      </fieldset>

      {opcao === 'criar_correcao' && (
        <div className="space-y-3">
          {props.repositorioPublico && (
            <p className="text-sm text-atencao">
              Este repositório é público no GitHub. Não inclua dados do cliente.
            </p>
          )}
          <div className="space-y-1">
            <label
              htmlFor={`triagem-titulo-${props.solicitacaoId}`}
              className="block text-sm font-medium"
            >
              Título
            </label>
            <input
              id={`triagem-titulo-${props.solicitacaoId}`}
              name="titulo"
              required
              maxLength={200}
              defaultValue={`Correção: ${props.issueTitulo}`}
              className={CLASSE_CAMPO}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`triagem-corpo-${props.solicitacaoId}`}
              className="block text-sm font-medium"
            >
              Descrição
            </label>
            <textarea
              id={`triagem-corpo-${props.solicitacaoId}`}
              name="corpo"
              rows={4}
              maxLength={5000}
              defaultValue={`Correção da issue #${props.issueNumero} solicitada na homologação.`}
              className={CLASSE_CAMPO}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              name="foraDoEscopo"
              checked={foraDoEscopo}
              onChange={(e) => setForaDoEscopo(e.target.checked)}
            />
            Fora do escopo desta milestone
          </label>
          {foraDoEscopo && (
            <div className="space-y-1">
              <label
                htmlFor={`triagem-justificativa-${props.solicitacaoId}`}
                className="block text-sm font-medium"
              >
                Justificativa
              </label>
              <textarea
                id={`triagem-justificativa-${props.solicitacaoId}`}
                name="justificativa"
                required
                rows={3}
                maxLength={1000}
                className={CLASSE_CAMPO}
              />
            </div>
          )}
        </div>
      )}

      {opcao === 'responder' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label
              htmlFor={`triagem-resposta-${props.solicitacaoId}`}
              className="block text-sm font-medium"
            >
              Resposta
            </label>
            <textarea
              id={`triagem-resposta-${props.solicitacaoId}`}
              name="resposta"
              required
              rows={4}
              maxLength={2000}
              className={CLASSE_CAMPO}
            />
          </div>
          <fieldset className="space-y-1 text-sm">
            <legend className="font-medium text-text-primary">Visibilidade</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="visibilidade" value="COMPARTILHAVEL" defaultChecked />
              Compartilhável com o cliente
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="visibilidade" value="INTERNA" />
              Interna (só a equipe)
            </label>
          </fieldset>
        </div>
      )}

      <Button
        type="submit"
        aria-busy={pendente}
        onClick={(e) => {
          if (pendente) e.preventDefault()
        }}
      >
        {botao[opcao]}
      </Button>
    </form>
  )
}

export function ClassificarForaDoEscopo(props: Ids & { ofertar?: boolean }) {
  const [estado, enviar, pendente] = useActionState(reclassificarSolicitacaoAction, {})
  const [aberto, setAberto] = useState(false)

  return (
    <form action={enviar} aria-busy={pendente} className="space-y-3">
      <MensagensDeEstado estado={estado} />
      <CamposOcultos {...props} />
      {props.ofertar === false ? null : !aberto ? (
        <Button type="button" variant="outline" onClick={() => setAberto(true)}>
          Classificar como fora do escopo
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <label
              htmlFor={`reclassificar-justificativa-${props.solicitacaoId}`}
              className="block text-sm font-medium"
            >
              Justificativa
            </label>
            <textarea
              id={`reclassificar-justificativa-${props.solicitacaoId}`}
              name="justificativa"
              required
              rows={3}
              maxLength={1000}
              className={CLASSE_CAMPO}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              aria-busy={pendente}
              onClick={(e) => {
                if (pendente) e.preventDefault()
              }}
            >
              Confirmar classificação
            </Button>
            <Button type="button" variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}
