import Link from 'next/link'
import type { ItemDaPilha } from '@/modules/decidir/model'
import type { PlanoDaTriagem } from '@/modules/demandas/contrato'
import { IconeDoTipo } from '../../demandas/_componentes/icone-do-tipo'
import { iconeDoItem } from './pilha'

const LINK =
  'shrink-0 font-[600] text-text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'

const ROTULO_DO_TAMANHO: Record<PlanoDaTriagem['opcoes'][number]['tamanho'], string> = {
  pequeno: 'pequeno',
  medio: 'médio',
  grande: 'grande',
}

const SUBTITULO = 'text-[11px] font-bold tracking-[0.08em] text-text-secondary'

/** O plano curto da triagem: o que a pessoa quer, o que muda, as opções, os conflitos e a recomendação. */
function PlanoParaAvaliar({ plano }: { plano: PlanoDaTriagem }) {
  return (
    <section
      aria-label="Plano para avaliar"
      className="space-y-3 rounded-padrao border border-border bg-surface px-4 py-3.5 text-sm"
    >
      <p className={SUBTITULO}>PLANO PARA AVALIAR</p>
      <p className="break-words text-text-primary">{plano.pedido}</p>
      {plano.muda.length > 0 && (
        <div className="space-y-1">
          <p className="font-[600] text-text-primary">O que mudaria</p>
          <ul className="list-disc space-y-0.5 pl-5 text-text-secondary">
            {plano.muda.map((m) => (
              <li key={m} className="break-words">
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plano.opcoes.length > 0 && (
        <div className="space-y-1">
          <p className="font-[600] text-text-primary">Opções</p>
          <ul className="space-y-1.5">
            {plano.opcoes.map((o) => (
              <li key={o.nome} className="break-words">
                <span className="font-[600] text-text-primary">{o.nome}</span>{' '}
                <span className="rounded-compacto border border-border px-1.5 py-px text-[12px] text-text-secondary">
                  {ROTULO_DO_TAMANHO[o.tamanho]}
                </span>
                <span className="block text-text-secondary">{o.descricao}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plano.conflitos.length > 0 && (
        <div className="space-y-1">
          <p className="font-[600] text-text-primary">Conflitos com decisões vigentes</p>
          <ul className="space-y-1.5">
            {plano.conflitos.map((c) => (
              <li key={c.decisao} className="break-words">
                <span className="font-[600] text-atencao">{c.decisao}</span>
                <span className="block text-text-secondary">{c.explicacao}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-0.5">
        <p className="font-[600] text-text-primary">Recomendação</p>
        <p className="break-words text-text-primary">{plano.recomendacao}</p>
      </div>
    </section>
  )
}

/** O que é e o que preciso de você: linha pequena, título, pergunta, fatos e o relato recolhido. */
export function CabecalhoDoItem({
  item,
  pergunta,
}: {
  item: ItemDaPilha
  /** A frase de "O que preciso de você" lida da mensagem; quando vem, vale no lugar da do item. */
  pergunta?: string | null
}) {
  const publicacao = item.ref.tipo === 'publicacao'
  const mostraPedido = item.tipo === 'pedido' || item.tipo === 'nao_classificada'
  return (
    <header className="space-y-3.5 border-b border-border bg-surface p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-secondary">
        <IconeDoTipo {...iconeDoItem(item)} />
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-compacto border border-border bg-surface-subtle px-2 py-0.5 font-[550]">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-[2px] bg-marca-tech" />
          <span className="break-all">{item.projeto ?? item.repositorio}</span>
        </span>
        <span className="min-w-0 break-words">{item.linha}</span>
      </div>

      <h2 className="break-words text-[19px] font-[650] leading-snug tracking-[-0.01em] text-text-primary md:text-[21px]">
        {item.titulo}
      </h2>

      {mostraPedido && item.pedido && (
        <section
          aria-label="O que foi pedido"
          className="space-y-1 rounded-padrao border border-border bg-surface-subtle px-4 py-3"
        >
          <p className="text-[11px] font-bold tracking-[0.08em] text-text-secondary">
            O QUE FOI PEDIDO
          </p>
          <p className="whitespace-pre-line break-words text-sm leading-relaxed text-text-primary">
            {item.pedido}
          </p>
        </section>
      )}

      <section
        aria-label="O que preciso de você"
        className="flex items-start gap-3.5 rounded-padrao border border-atencao/30 bg-tonal-atencao px-4 py-3.5"
      >
        <span
          aria-hidden="true"
          className="grid size-[30px] shrink-0 place-items-center rounded-full bg-atencao text-sm font-bold text-action-foreground"
        >
          ?
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.08em] text-atencao">
            O QUE PRECISO DE VOCÊ
          </p>
          <p className="break-words text-base font-[650] leading-snug text-text-primary">
            {pergunta || item.pergunta || item.titulo}
          </p>
        </div>
      </section>

      {item.fatos.length > 0 && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          {item.fatos.slice(0, 3).map((f) => (
            <div key={f.rotulo} className="flex min-w-0 gap-1">
              <dt className="text-text-secondary">{f.rotulo}</dt>
              <dd className="break-words font-[650] text-text-primary">{f.valor}</dd>
            </div>
          ))}
        </dl>
      )}

      {mostraPedido && item.plano && <PlanoParaAvaliar plano={item.plano} />}

      {item.relato && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-padrao border border-border bg-surface px-3.5 py-2.5 text-[13px]">
          <span className="min-w-0 flex-1 break-words text-text-secondary">
            {item.relato.resumo}
          </span>
          {item.relato.externo ? (
            <a href={item.relato.href} target="_blank" rel="noopener noreferrer" className={LINK}>
              {publicacao ? 'Ver o run no GitHub ↗' : 'Abrir no GitHub ↗'}
            </a>
          ) : (
            <Link href={item.relato.href} className={LINK}>
              {publicacao ? 'Ver a fila' : 'Ver o relato'}
            </Link>
          )}
        </div>
      )}
    </header>
  )
}
