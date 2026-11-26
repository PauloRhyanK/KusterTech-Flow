'use client'

import Link from 'next/link'
import { isValidElement, useMemo, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { blocosDaMensagem, type OpcaoDaMensagem } from '@/modules/decidir/leitura'
import { trechosComLink } from '@/modules/decidir/model'
import { Diagrama } from './diagrama'
import { MiniaturaDoAnexo } from './visor-ampliado'

const ROTULO =
  'mb-1 mt-4 text-[11px] font-bold uppercase tracking-[0.08em] text-text-tertiary first:mt-0'
const LINK =
  'font-[600] text-text-link underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
const CAMINHO_INTERNO = /^\/demandas\/[0-9a-f-]{36}$/

function Rotulo({ children }: { children?: ReactNode }) {
  return <h4 className={ROTULO}>{children}</h4>
}

/**
 * Link da mensagem. Só endereço `http(s)` abre (em outra aba, sem referência). O caminho interno de
 * uma demanda só vira link na mensagem do Flow: o texto do agente não cria navegação dentro do Flow.
 */
function Ancora({
  href,
  internos,
  children,
}: {
  href?: string
  internos: boolean
  children?: ReactNode
}) {
  if (!href) return <span>{children}</span>
  if (CAMINHO_INTERNO.test(href)) {
    if (!internos) return <span>{children}</span>
    return (
      <Link href={href} className={LINK}>
        {children}
      </Link>
    )
  }
  if (!/^https?:\/\//i.test(href)) return <span>{children}</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
    </a>
  )
}

export interface AnexoDaMensagem {
  id: string
  nome: string
}

const SEM_ANEXOS: readonly AnexoDaMensagem[] = []

/** O anexo que a imagem de caminho relativo cita, pelo nome do arquivo (`anexos/fluxo.svg`). */
function anexoCitado(src: unknown, anexos: readonly AnexoDaMensagem[]): AnexoDaMensagem | null {
  if (typeof src !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/'))
    return null
  const nome = src.split('/').pop()
  return anexos.find((a) => a.nome === nome) ?? null
}

// Imagem de fora nunca é carregada na sessão do Paulo: vira link.
function imagemDeFora(src: unknown, alt: unknown): ReactNode {
  return (
    <Ancora href={typeof src === 'string' ? src : undefined} internos={false}>
      {typeof alt === 'string' && alt ? alt : 'Abrir imagem'}
    </Ancora>
  )
}

const componentes = (internos: boolean, anexos: readonly AnexoDaMensagem[]): Components => ({
  h1: Rotulo,
  h2: Rotulo,
  h3: Rotulo,
  h4: Rotulo,
  h5: Rotulo,
  h6: Rotulo,
  // As quebras de linha de uma mensagem simples continuam valendo (como no texto puro).
  p: ({ node, children }) => {
    // A imagem anexada vira uma figura, que não cabe dentro de um parágrafo.
    const unico = node?.children.length === 1 ? node.children[0] : null
    if (unico?.type === 'element' && unico.tagName === 'img') {
      if (anexoCitado(unico.properties.src, anexos)) return <>{children}</>
    }
    return <p className="my-2 whitespace-pre-line break-words">{children}</p>
  },
  a: ({ href, children }) => (
    <Ancora href={href} internos={internos}>
      {children}
    </Ancora>
  ),
  img: ({ src, alt }) => {
    const anexo = anexoCitado(src, anexos)
    if (anexo)
      return <MiniaturaDoAnexo id={anexo.id} nome={anexo.nome} legenda={alt || undefined} />
    return imagemDeFora(src, alt)
  },
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="break-words">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border-strong pl-3 text-text-secondary">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  code: ({ className, children }) => (
    <code
      className={cn(
        'rounded-[5px] border border-border bg-surface-subtle px-1 py-px font-mono text-[12.5px]',
        className,
      )}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => {
    const filho = isValidElement<{ className?: string; children?: ReactNode }>(children)
      ? children.props
      : null
    if (filho?.className?.split(' ').includes('language-mermaid')) {
      return <Diagrama codigo={String(filho.children ?? '').trimEnd()} />
    }
    return (
      <pre className="my-2 overflow-x-auto rounded-compacto border border-border bg-surface-subtle px-3 py-2.5 text-[12.5px] leading-relaxed [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
    )
  },
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border py-1.5 pr-3 text-left font-[600] text-text-secondary">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border py-1.5 pr-3 align-top">{children}</td>
  ),
})

/** O caminho solto de uma demanda (`/demandas/<id>`), que o Flow escreve em texto puro, vira link. */
function comLinksInternos(texto: string): string {
  return trechosComLink(texto)
    .map((t) => (t.href ? `[${t.texto}](${t.href})` : t.texto))
    .join('')
}

function Texto({
  texto,
  internos,
  anexos,
}: {
  texto: string
  internos: boolean
  anexos: readonly AnexoDaMensagem[]
}) {
  const mapa = useMemo(() => componentes(internos, anexos), [internos, anexos])
  return (
    <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">
      <Markdown remarkPlugins={[remarkGfm]} components={mapa}>
        {internos ? comLinksInternos(texto) : texto}
      </Markdown>
    </div>
  )
}

function Opcoes({ opcoes }: { opcoes: readonly OpcaoDaMensagem[] }) {
  return (
    <ul aria-label="Opções" className="my-2 grid gap-2.5 md:grid-cols-2">
      {opcoes.map((o) => (
        <li
          key={o.numero}
          className={cn(
            'rounded-compacto border bg-surface-subtle px-3 py-2.5',
            o.recomendada ? 'border-execucao' : 'border-border-strong',
          )}
        >
          {o.recomendada && (
            <span className="block text-[10.5px] font-bold uppercase tracking-[0.06em] text-execucao">
              Recomendada
            </span>
          )}
          <span className="block break-words font-[650] text-text-primary">
            {o.numero}. {o.nome}
          </span>
          {o.consequencia && (
            <span className="block break-words text-[13px] text-text-secondary">
              {o.consequencia}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * A mensagem do agente ou do Flow, formatada. O texto é markdown; HTML cru nunca é interpretado
 * (aparece como texto). Opções viram cartões e o bloco de detalhes fica recolhido.
 */
export function MensagemFormatada({
  texto,
  linksInternos = false,
  anexos = SEM_ANEXOS,
}: {
  texto: string
  /** As imagens guardadas com a mensagem; a que o texto cita aparece no lugar da citação. */
  anexos?: readonly AnexoDaMensagem[]
  /** Só a mensagem do Flow liga para dentro do Flow (`/demandas/<id>`). */
  linksInternos?: boolean
}) {
  return (
    <div className="min-w-0 break-words">
      {blocosDaMensagem(texto).map((b, i) => {
        if (b.tipo === 'opcoes') return <Opcoes key={i} opcoes={b.opcoes} />
        if (b.tipo === 'detalhes') {
          return (
            <details key={i} className="mt-3 rounded-compacto border border-border">
              <summary className="cursor-pointer px-3 py-2 text-[13px] font-[600] text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
                {b.resumo}
              </summary>
              <div className="border-t border-border px-3 py-2.5">
                <MensagemFormatada texto={b.texto} linksInternos={linksInternos} anexos={anexos} />
              </div>
            </details>
          )
        }
        return <Texto key={i} texto={b.texto} internos={linksInternos} anexos={anexos} />
      })}
    </div>
  )
}
