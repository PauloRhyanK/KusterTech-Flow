'use client'

import { useEffect, useLayoutEffect, useState, useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { AplicadorDeTema } from '@/lib/tema/aplicar-tema'
import { resolverTema, type Tema } from '@/lib/tema/tema'
import { alterarTema } from './actions'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

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
    descricao: 'Cores claras sobre fundo Cloud, ideal para ambientes bem iluminados.',
  },
  {
    valor: 'escuro',
    rotulo: 'Escuro',
    descricao: 'Cores escuras sobre fundo Midnight, com menor cansaço visual.',
  },
  {
    valor: 'sistema',
    rotulo: 'Sistema (padrão)',
    descricao: 'Acompanha automaticamente a preferência de tema do seu dispositivo.',
  },
]

export function SeletorDeTema({ temaAtual }: SeletorDeTemaProps) {
  const [estado, formAction, pendente] = useActionState(alterarTema, {})
  const [selecionado, setSelecionado] = useState<Tema>(temaAtual)

  const temaAtivo = estado.tema ?? temaAtual

  useIsomorphicLayoutEffect(() => {
    if (estado.tema) {
      const raiz = document.documentElement
      raiz.dataset.tema = estado.tema
      const media =
        typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-color-scheme: dark)')
          : null
      const resolvido = resolverTema(estado.tema, Boolean(media?.matches))
      raiz.classList.toggle('dark', resolvido === 'escuro')
    }
  }, [estado.tema])

  return (
    <>
      <AplicadorDeTema tema={temaAtivo} />
      <form action={formAction} className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-text-primary">Tema</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {OPCOES_TEMA.map((opcao) => {
              const id = `tema-${opcao.valor}`
              const descId = `desc-${opcao.valor}`
              const marcado = selecionado === opcao.valor

              return (
                <label
                  key={opcao.valor}
                  htmlFor={id}
                  className={`flex cursor-pointer flex-col justify-between rounded-compacto border p-4 transition-colors ${
                    marcado
                      ? 'border-action-primary bg-surface shadow-xs'
                      : 'border-border bg-surface hover:border-border-strong'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-text-primary">{opcao.rotulo}</span>
                      <input
                        id={id}
                        type="radio"
                        name="tema"
                        value={opcao.valor}
                        checked={marcado}
                        onChange={() => setSelecionado(opcao.valor)}
                        aria-describedby={descId}
                        className="size-4 text-action-primary focus:ring-focus-ring"
                      />
                    </div>
                    <p id={descId} className="text-xs text-text-secondary">
                      {opcao.descricao}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pendente} aria-busy={pendente}>
            Salvar
          </Button>
          {estado.salvo && (
            <p role="status" className="text-sm font-medium text-sucesso">
              Preferência salva.
            </p>
          )}
          {estado.erro && (
            <p role="alert" className="text-sm font-medium text-erro">
              {estado.erro}
            </p>
          )}
        </div>
      </form>
    </>
  )
}
