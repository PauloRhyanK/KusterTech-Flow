'use client'

// A gaveta da fila: abre ao lado do prédio ao clicar na recepção. Duas abas: as demandas que esperam
// (com o interruptor de urgência) e os pedidos de publicação (os mesmos da página /publicacao, em tamanho compacto).
import Link from 'next/link'
import { useActionState, useEffect, useRef, useState } from 'react'
import { PedidoExpansivel } from '@/app/(app)/publicacao/_componentes/pedido-expansivel'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { CLASSE_DO_LINK } from '@/lib/ui/titulo-de-secao'
import { ROTULO_DO_TIPO } from '@/modules/decidir/model'
import { duracaoDaEspera } from '@/modules/demandas/model'
import { filtrarLinhas, type LinhaDaFila } from '@/modules/fila-de-publicacao/apresentacao'
import type { ItemDaRecepcao } from '@/modules/fabrica/escritorio/model'
import { alternarUrgenciaAction } from '../../actions'

export interface GavetaDaFilaProps {
  recepcao: ItemDaRecepcao[]
  /** null sem o módulo de publicação: a aba some */
  publicacao: { linhas: LinhaDaFila[]; podeGerenciar: boolean } | null
  agora: Date
  onFechar: () => void
}

const SEM_TIPO = 'sem tipo'

function rotuloDoTipo(tipo: string): string {
  return (ROTULO_DO_TIPO as Record<string, string>)[tipo] ?? tipo
}
const CLASSE_DO_CAMPO =
  'h-8 rounded-padrao border border-border bg-surface px-2 text-sm text-text-primary'

function InterruptorDeUrgencia({ item }: { item: ItemDaRecepcao }) {
  const [estado, alternar, pendente] = useActionState(alternarUrgenciaAction, {})
  return (
    <div className="space-y-1">
      <form action={alternar}>
        <input type="hidden" name="demandaId" value={item.demandaId} />
        <input type="hidden" name="urgente" value={item.urgente ? 'false' : 'true'} />
        <Button type="submit" variant="outline" size="sm" aria-busy={pendente} disabled={pendente}>
          {item.urgente ? 'Voltar a normal' : 'Marcar urgente'}
        </Button>
      </form>
      <MensagensDeEstado estado={{ erro: estado.erro }} />
    </div>
  )
}

function ItemDeDemanda({ item }: { item: ItemDaRecepcao }) {
  return (
    <li
      aria-label={item.titulo}
      className="space-y-2 rounded-padrao border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {item.urgente && (
          <span className="rounded-full bg-tonal-erro px-2 py-0.5 text-[11px] font-semibold text-erro">
            Urgente
          </span>
        )}
        {item.esperaPaulo && (
          <span className="rounded-full bg-tonal-atencao px-2 py-0.5 text-[11px] font-semibold text-text-primary">
            {item.esperando
              ? `espera você há ${duracaoDaEspera(item.esperando.minutos)}`
              : 'espera você'}
          </span>
        )}
      </div>
      <b className="block text-sm text-text-primary">{item.titulo}</b>
      <span className="block text-xs text-text-secondary">
        {[item.projeto, item.repositorio, item.tipo === SEM_TIPO ? null : rotuloDoTipo(item.tipo)]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {item.podeAlternarUrgencia ? <InterruptorDeUrgencia item={item} /> : <span />}
        <Link href={`/demandas/${item.demandaId}`} className={CLASSE_DO_LINK}>
          Abrir demanda
        </Link>
      </div>
    </li>
  )
}

function AbaDemandas({ recepcao }: { recepcao: ItemDaRecepcao[] }) {
  const [projeto, setProjeto] = useState('')
  const [tipo, setTipo] = useState('')
  const [soEsperam, setSoEsperam] = useState(false)
  const [busca, setBusca] = useState('')
  const projetos = [
    ...new Set(recepcao.map((r) => r.projeto).filter((p): p is string => !!p)),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const tipos = [...new Set(recepcao.map((r) => r.tipo).filter((t) => t !== SEM_TIPO))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR'),
  )
  const termo = busca.trim().toLowerCase()
  const visiveis = recepcao.filter(
    (r) =>
      (!projeto || r.projeto === projeto) &&
      (!tipo || r.tipo === tipo) &&
      (!soEsperam || r.esperaPaulo) &&
      (!termo || r.titulo.toLowerCase().includes(termo)),
  )
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Projeto
          <select
            className={CLASSE_DO_CAMPO}
            value={projeto}
            onChange={(e) => setProjeto(e.target.value)}
          >
            <option value="">Todos</option>
            {projetos.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Tipo
          <select
            className={CLASSE_DO_CAMPO}
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            <option value="">Todos</option>
            {tipos.map((t) => (
              <option key={t} value={t}>
                {rotuloDoTipo(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-text-secondary">
          Buscar
          <input
            type="search"
            className={`${CLASSE_DO_CAMPO} w-full`}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Título da demanda"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          checked={soEsperam}
          onChange={(e) => setSoEsperam(e.target.checked)}
        />
        Só os que esperam você
      </label>
      {visiveis.length === 0 ? (
        <p className="text-sm text-text-secondary">
          {recepcao.length === 0 ? 'Nenhuma demanda na fila' : 'Nenhuma demanda com esses filtros'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((r) => (
            <ItemDeDemanda key={r.demandaId} item={r} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AbaPublicacao({
  linhas,
  podeGerenciar,
  agora,
}: {
  linhas: LinhaDaFila[]
  podeGerenciar: boolean
  agora: Date
}) {
  const [projeto, setProjeto] = useState('')
  const [busca, setBusca] = useState('')
  const projetos = [...new Map(linhas.map((l) => [l.projetoId, l.projeto])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1], 'pt-BR'),
  )
  const visiveis = filtrarLinhas(linhas, {
    projeto: projeto || null,
    estado: null,
    modo: null,
    busca: busca.trim(),
  })
  const total = visiveis.reduce((n, l) => n + (l.publicando ? 1 : 0) + l.aguardando.length, 0)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Projeto
          <select
            className={CLASSE_DO_CAMPO}
            value={projeto}
            onChange={(e) => setProjeto(e.target.value)}
          >
            <option value="">Todos</option>
            {projetos.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-text-secondary">
          Buscar
          <input
            type="search"
            className={`${CLASSE_DO_CAMPO} w-full`}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Descrição, commit ou repositório"
          />
        </label>
      </div>
      {total === 0 ? (
        <p className="text-sm text-text-secondary">Nenhum pedido de publicação na fila</p>
      ) : (
        visiveis.map((l) => {
          const pedidos = [...(l.publicando ? [l.publicando] : []), ...l.aguardando]
          if (pedidos.length === 0) return null
          return (
            <section key={l.repositorioId} aria-label={l.rotulo} className="space-y-2">
              <h3 className="text-xs font-semibold text-text-secondary">{l.rotulo}</h3>
              {pedidos.map((p) => (
                <PedidoExpansivel
                  key={p.id}
                  pedido={p}
                  linha={l}
                  agora={agora}
                  podeGerenciar={podeGerenciar}
                  compacto
                />
              ))}
            </section>
          )
        })
      )}
      <Link href="/publicacao" className={CLASSE_DO_LINK}>
        Ver tudo em /publicacao ↗
      </Link>
    </div>
  )
}

export function GavetaDaFila({ recepcao, publicacao, agora, onFechar }: GavetaDaFilaProps) {
  const [aba, setAba] = useState<'demandas' | 'publicacao'>('demandas')
  const raiz = useRef<HTMLDivElement>(null)

  // o foco entra na gaveta ao abrir e volta a quem o tinha ao fechar
  useEffect(() => {
    const anterior = document.activeElement
    raiz.current?.focus()
    return () => {
      if (anterior instanceof HTMLElement) anterior.focus()
    }
  }, [])

  const abas = [
    { id: 'demandas' as const, rotulo: 'Demandas' },
    ...(publicacao ? [{ id: 'publicacao' as const, rotulo: 'Publicação' }] : []),
  ]
  const ativa = publicacao ? aba : 'demandas'

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-40 bg-text-primary/30" onClick={onFechar} />
      <div
        ref={raiz}
        role="dialog"
        aria-label="Fila"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onFechar()
          }
          if (e.key === 'Tab') {
            // o diálogo é modal: o foco dá a volta dentro dele
            const focaveis = [
              ...e.currentTarget.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])',
              ),
            ]
            const primeiro = focaveis[0]
            const ultimo = focaveis[focaveis.length - 1]
            if (!primeiro || !ultimo) return
            const atual = document.activeElement
            if (e.shiftKey && (atual === primeiro || atual === e.currentTarget)) {
              e.preventDefault()
              ultimo.focus()
            } else if (!e.shiftKey && atual === ultimo) {
              e.preventDefault()
              primeiro.focus()
            }
          }
        }}
        className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background shadow-xl outline-none md:inset-y-0 md:right-0 md:left-auto md:w-[460px] md:border-l md:border-border"
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Fila</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onFechar}
            aria-label="Fechar a fila"
          >
            ✕
          </Button>
        </header>
        <div
          role="tablist"
          aria-label="Fila"
          className="flex gap-1 border-b border-border px-4 pt-2"
        >
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={ativa === a.id}
              onClick={() => setAba(a.id)}
              className={`rounded-t-padrao px-3 py-1.5 text-sm font-medium ${
                ativa === a.id
                  ? 'border-b-2 border-text-link text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
          {ativa === 'demandas' || !publicacao ? (
            <AbaDemandas recepcao={recepcao} />
          ) : (
            <AbaPublicacao
              linhas={publicacao.linhas}
              podeGerenciar={publicacao.podeGerenciar}
              agora={agora}
            />
          )}
        </div>
      </div>
    </>
  )
}
