'use client'

import { useState, useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { AplicadorDeTema } from '@/lib/tema/aplicar-tema'
import type { Tema } from '@/lib/tema/tema'
import { alterarTema } from './actions'

export interface SeletorDeTemaProps {
  temaAtual: Tema
}

interface OpcaoTema {
  valor: Tema
  rotulo: string
  descricao: string
}

const OPCOES_TEMA: readonly OpcaoTema[] = [
  {
    valor: 'claro',
    rotulo: 'Claro',
    descricao: 'Fundo claro, para ambientes bem iluminados.',
  },
  {
    valor: 'escuro',
    rotulo: 'Escuro',
    descricao: 'Fundo escuro, para ambientes com pouca luz.',
  },
  {
    valor: 'sistema',
    rotulo: 'Sistema (padrão)',
    descricao: 'Acompanha a preferência de tema do seu dispositivo.',
  },
]

export function SeletorDeTema({ temaAtual }: SeletorDeTemaProps) {
  const [estado, formAction, pendente] = useActionState(alterarTema, {})
  const [prevEstado, setPrevEstado] = useState(estado)
  const [selecionado, setSelecionado] = useState<Tema>(temaAtual)
  const [mostrarFeedback, setMostrarFeedback] = useState(false)

  if (estado !== prevEstado) {
    setPrevEstado(estado)
    if (estado.salvo || estado.erro) {
      setMostrarFeedback(true)
    }
    if (estado.tema) {
      setSelecionado(estado.tema)
    }
  }

  const temaAtivo = estado.tema ?? temaAtual
  const exibirFeedback = mostrarFeedback && !pendente

  return (
    <>
      <AplicadorDeTema tema={temaAtivo} />
      <form action={formAction} className="space-y-6">
        <fieldset key={temaAtivo} className="space-y-3">
          <legend className="text-sm font-semibold text-text-primary">Tema</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {OPCOES_TEMA.map((opcao) => {
              const id = `tema-${opcao.valor}`
              const descId = `desc-${opcao.valor}`
              const marcado = selecionado === opcao.valor

              return (
                <div
                  key={opcao.valor}
                  onClick={() => {
                    setSelecionado(opcao.valor)
                    setMostrarFeedback(false)
                  }}
                  className={`flex cursor-pointer flex-col justify-between rounded-compacto border p-4 transition-colors ${
                    marcado
                      ? 'border-action-primary bg-surface'
                      : 'border-border bg-surface hover:border-border-strong'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={id}
                        className="cursor-pointer text-sm font-medium text-text-primary"
                      >
                        {opcao.rotulo}
                      </label>
                      <input
                        id={id}
                        type="radio"
                        name="tema"
                        value={opcao.valor}
                        checked={marcado}
                        onChange={() => {
                          setSelecionado(opcao.valor)
                          setMostrarFeedback(false)
                        }}
                        aria-describedby={descId}
                        className="size-4 accent-action-primary focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      />
                    </div>
                    <p id={descId} className="text-xs text-text-secondary">
                      {opcao.descricao}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            aria-busy={pendente}
            onClick={(e) => {
              if (pendente) {
                e.preventDefault()
              }
            }}
          >
            Salvar
          </Button>
          <p role="status" aria-live="polite" className="text-sm font-medium text-sucesso">
            {exibirFeedback && estado.salvo ? 'Preferência salva.' : ''}
          </p>
          <p role="alert" className="text-sm font-medium text-erro">
            {exibirFeedback && estado.erro ? estado.erro : ''}
          </p>
        </div>
      </form>
    </>
  )
}
