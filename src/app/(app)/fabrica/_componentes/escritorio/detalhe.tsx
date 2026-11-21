'use client'

// Coluna da direita: a parte (raia) ou o agente clicado.
import type { Agente, Parte } from '@/modules/fabrica/escritorio/model'
import { hora } from './hora'
import { Boneco, Caixa } from './pixel'
import { ROTULO_DA_SITUACAO } from './plano-da-entrega'

export type Selecao =
  { tipo: 'agente'; agente: Agente } | { tipo: 'parte'; parte: Parte; fase: string } | null

const MARCA = {
  cinza: 'var(--pixel-metal)',
  verde: 'var(--pixel-folha)',
  vermelho: 'var(--pixel-papel-conserto)',
}

export function Detalhe({ selecao }: { selecao: Selecao }) {
  if (!selecao) {
    return (
      <p className="text-sm text-text-secondary">
        Clique num boneco, numa caixa ou num cartão do plano.
      </p>
    )
  }
  if (selecao.tipo === 'agente') {
    const a = selecao.agente
    return (
      <div>
        <div className="mb-3 flex items-center gap-3">
          <span className="grid size-16 shrink-0 place-items-center rounded-padrao bg-surface-subtle">
            <Boneco papel={a.papel} semente={a.runId} />
          </span>
          <div>
            <h3 className="text-base font-semibold text-text-primary">{a.nome}</h3>
            <p className="text-xs text-text-secondary">
              {a.trabalhando ? 'trabalhando agora' : 'parado'}
            </p>
          </div>
        </div>
        <div className="mb-3 rounded-compacto bg-tonal-informacao p-2.5 text-xs">
          <b className="block text-[11px]">{a.trabalhando ? 'Fazendo agora' : 'Última coisa'}</b>
          {a.balao}
        </div>
        <h4 className="mb-2 text-[11px] font-semibold tracking-wide text-text-secondary uppercase">
          Histórico
        </h4>
        <ol className="ml-1.5 border-l-2 border-border pl-3">
          {[...a.linhas].reverse().map((l, i) => (
            <li key={i} className="mb-2 text-xs">
              <small className="block text-[10px] text-text-secondary">{hora(l.em)}</small>
              {l.texto}
            </li>
          ))}
        </ol>
      </div>
    )
  }
  const p = selecao.parte
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="grid size-16 shrink-0 place-items-center rounded-padrao bg-surface-subtle">
          <Caixa cor={p.cor} entregue={p.situacao === 'entregue'} />
        </span>
        <div>
          <h3 className="text-base font-semibold text-text-primary">{p.raia}</h3>
          <p className="text-xs text-text-secondary">
            fase {selecao.fase} · {ROTULO_DA_SITUACAO[p.situacao]}
          </p>
        </div>
      </div>
      <div className="mb-3 rounded-compacto bg-tonal-informacao p-2.5 text-xs">
        <b className="block text-[11px]">Tarefa</b>
        {p.tarefa ?? p.raia}
      </div>
      <h4 className="mb-2 text-[11px] font-semibold tracking-wide text-text-secondary uppercase">
        Critérios de aceite · {p.criterios.filter((c) => c.marca === 'verde').length} de{' '}
        {p.criterios.length}
      </h4>
      <ul className="space-y-1.5">
        {p.criterios.map((c, i) => (
          <li key={i} className="flex gap-2 text-xs">
            <span
              className="mt-0.5 inline-block size-3 shrink-0 rounded-[3px]"
              style={{ background: MARCA[c.marca] }}
            />
            {c.texto}
          </li>
        ))}
      </ul>
      {p.prUrl && (
        <a
          href={p.prUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs text-text-link"
        >
          abrir o PR ↗
        </a>
      )}
      <p className="mt-4 border-t border-border pt-2.5 text-[11px] text-text-secondary">
        Os critérios ficam cinza até o revisor conferir.
      </p>
    </div>
  )
}
