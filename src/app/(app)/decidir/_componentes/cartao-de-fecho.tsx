'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ACOES_POR_TIPO,
  cabeNaEspera,
  cabeNoDesfecho,
  type Acao,
  type Cartao,
} from '@/modules/decidir/cartao'
import { ROTULO_DO_TIPO, trechosComLink, type TipoDeItem } from '@/modules/decidir/model'
import { NIVEIS, TIPOS } from '@/modules/demandas/contrato'
import { rotuloDoDesfecho, type Desfecho, type Espera } from '@/modules/demandas/model'
import { ROTULO_DO_DESTINO, ROTULO_DO_NIVEL } from '@/modules/demandas/apresentacao'

export interface CartaoNaTela {
  id: string
  conteudo: Cartao
  erro: string | null
  estado: 'PROPOSTO' | 'CONFIRMANDO'
}

interface Linha {
  rotulo: string
  valor: string
  atencao?: boolean
}

const DESTINOS = ['fila_de_agentes', 'urgente', 'lote_da_noite'] as const

export const ROTULO_DA_ACAO: Record<Acao, string> = {
  destino: 'Definir o destino',
  guardar: 'Guardar para depois',
  recusar: 'Não vamos fazer',
  aprovar_desenho: 'Aprovar o desenho',
  ajustar_desenho: 'Pedir ajuste no desenho',
  responder: 'Responder na issue',
  aprovar_e_mergear: 'Aprovar e mergear o PR',
  pedir_mudanca: 'Pedir mudança',
  retomar: 'Retomar a demanda',
  entregar_parcial: 'Entregar o que funciona',
  encerrar: 'Encerrar a demanda',
  concluir: 'Concluir a etapa',
}

const resposta = (r: string | null): Linha[] =>
  r ? [{ rotulo: 'Resposta a quem pediu', valor: r }] : []

/** Uma linha por campo do cartão, no texto que o Paulo confirma. */
export function linhasDoCartao(c: Cartao): Linha[] {
  switch (c.acao) {
    case 'destino':
      return [
        {
          rotulo: 'Destino',
          valor: [
            ROTULO_DO_DESTINO[c.destino],
            ROTULO_DO_NIVEL[c.nivel],
            c.tipoDeDemanda ? ROTULO_DO_TIPO[c.tipoDeDemanda] : null,
          ]
            .filter(Boolean)
            .join(' · '),
        },
        ...(c.escopo ? [{ rotulo: 'Escopo', valor: c.escopo }] : []),
        ...resposta(c.resposta),
      ]
    case 'guardar':
      return [{ rotulo: 'Ação', valor: 'guardar para depois' }]
    case 'recusar':
      return [
        { rotulo: 'Ação', valor: 'não vamos fazer; a demanda é encerrada' },
        ...resposta(c.resposta),
      ]
    case 'aprovar_desenho':
      return [{ rotulo: 'Ação', valor: `aprovar o desenho (versão ${c.versao})` }]
    case 'ajustar_desenho':
      return [
        { rotulo: 'Ação', valor: `pedir ajuste no desenho (versão ${c.versao})` },
        { rotulo: 'Ajuste', valor: c.texto },
      ]
    case 'responder':
      return [
        { rotulo: 'Ação', valor: 'responder na issue e fechá-la' },
        { rotulo: 'Comentário', valor: c.texto },
      ]
    case 'aprovar_e_mergear':
      return [
        {
          rotulo: 'Ação',
          valor: `aprovar e mergear o PR #${c.numero} (head ${c.head.slice(0, 7)}, conferido)`,
        },
        { rotulo: 'Depois', valor: 'a Fábrica segue sozinha com o PR mergeado' },
        ...(c.protegidos.length > 0
          ? [{ rotulo: 'Também mexe em', valor: c.protegidos.join(', '), atencao: true }]
          : []),
      ]
    case 'pedir_mudanca':
      return [
        { rotulo: 'Ação', valor: 'pedir mudança no PR da fase' },
        { rotulo: 'Comentário', valor: c.texto },
      ]
    case 'retomar':
      return [{ rotulo: 'Ação', valor: 'retomar a demanda' }, ...resposta(c.resposta)]
    case 'entregar_parcial':
      return [
        { rotulo: 'Ação', valor: 'entregar o que funciona; a demanda segue para a entrega' },
        { rotulo: 'Depois', valor: 'o que faltou vira uma demanda nova no mesmo projeto' },
      ]
    case 'encerrar':
      if (!c.desfecho) return [{ rotulo: 'Ação', valor: 'encerrar a demanda' }]
      return [
        { rotulo: 'Ação', valor: `encerrar como ${rotuloDoDesfecho(c.desfecho)}` },
        ...(c.desfecho.de
          ? [{ rotulo: 'A outra demanda', valor: `/demandas/${c.desfecho.de}` }]
          : []),
      ]
    case 'concluir':
      return [{ rotulo: 'Ação', valor: `concluir a etapa ${c.etapa}` }]
  }
}

/** "Pronto para registrar": confirmar envia o id deste cartão (um trocado depois é recusado). */
export function CartaoDeFecho({
  cartao,
  erro,
  pendente,
  podeAgir,
  onConfirmar,
  onAjustar,
}: {
  cartao: CartaoNaTela
  erro: string | null
  pendente: boolean
  podeAgir: boolean
  onConfirmar: () => void
  onAjustar: () => void
}) {
  const confirmando = cartao.estado === 'CONFIRMANDO'
  const mensagem = erro ?? cartao.erro
  const fimDeFase = cartao.conteudo.acao === 'aprovar_e_mergear'
  return (
    <section
      aria-label="Pronto para registrar"
      className="space-y-3 rounded-padrao border-[1.5px] border-sucesso bg-tonal-sucesso px-4 py-3.5 md:ml-10 md:max-w-[80%]"
    >
      <p className="text-[11px] font-bold tracking-[0.08em] text-sucesso">PRONTO PARA REGISTRAR</p>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
        {linhasDoCartao(cartao.conteudo).map((l) => (
          <li
            key={l.rotulo}
            className={cn('break-words', l.atencao ? 'text-atencao' : 'text-text-primary')}
          >
            <strong className="font-[650]">{`${l.rotulo}:`}</strong>{' '}
            {trechosComLink(l.valor).map((t, i) =>
              t.href ? (
                <Link
                  key={i}
                  href={t.href}
                  className="font-[600] text-text-link underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  {t.texto}
                </Link>
              ) : (
                t.texto
              ),
            )}
          </li>
        ))}
      </ul>
      {mensagem && (
        <p role="alert" className="break-words text-sm font-[550] text-erro">
          {mensagem}
        </p>
      )}
      {podeAgir && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="lg"
            onClick={onConfirmar}
            disabled={pendente || confirmando}
            aria-busy={pendente || confirmando}
          >
            {confirmando
              ? 'Registrando…'
              : fimDeFase
                ? 'Confirmar e mergear'
                : 'Confirmar e ir para a próxima'}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={onAjustar}
            disabled={pendente || confirmando}
          >
            Ajustar
          </Button>
        </div>
      )}
    </section>
  )
}

export type CampoDoCartao = 'tipoDeDemanda' | 'texto' | 'destino' | 'nivel' | 'escopo' | 'resposta'

/** O ponto de partida do formulário: a ação e os campos que já se sabem. */
export type InicialDoCartao = { acao: Acao } & Partial<Record<CampoDoCartao, string | null>>

interface Valores {
  destino: string
  nivel: string
  tipoDeDemanda: string
  escopo: string
  resposta: string
  texto: string
}

/** Só os campos que o esquema do cartão aceita para cada ação; o resto o Flow preenche. */
function camposDaAcao(acao: Acao, v: Valores): Record<string, unknown> {
  switch (acao) {
    case 'destino':
      return {
        acao,
        destino: v.destino,
        nivel: v.nivel,
        tipoDeDemanda: v.tipoDeDemanda === '' ? null : v.tipoDeDemanda,
        escopo: v.escopo,
        resposta: v.resposta,
      }
    case 'recusar':
    case 'retomar':
      return { acao, resposta: v.resposta }
    case 'ajustar_desenho':
    case 'responder':
    case 'pedir_mudanca':
      return { acao, texto: v.texto }
    default:
      return { acao }
  }
}

const CAMPO =
  'w-full rounded-compacto border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring'
const ROTULO = 'text-[12.5px] font-[600] text-text-secondary'

const LIMITE: Record<'escopo' | 'resposta' | 'ajuste' | 'comentario', number> = {
  escopo: 500,
  resposta: 1000,
  ajuste: 500,
  comentario: 2000,
}

/** "Ajustar": os campos editáveis do cartão; o Flow valida de novo ao salvar. */
export function FormularioDoCartao({
  tipoDoItem,
  espera = null,
  desfecho = null,
  inicial,
  foco,
  erro,
  onSalvar,
  onCancelar,
}: {
  tipoDoItem: TipoDeItem
  /** A espera da demanda do item: algumas ações só cabem nela (entregar o que funciona). */
  espera?: Espera | null
  /** Duplicada ou já resolvida: a trava só encerra. */
  desfecho?: Desfecho | null
  inicial: InicialDoCartao
  foco?: string
  erro?: string | null
  onSalvar: (campos: Record<string, unknown>) => Promise<unknown> | void
  onCancelar: () => void
}) {
  const base = useId()
  const acoes = ACOES_POR_TIPO[tipoDoItem].filter(
    (a) => cabeNaEspera(a, espera) && cabeNoDesfecho(a, desfecho),
  )
  const [acao, setAcao] = useState<Acao>(inicial.acao)
  const [v, setV] = useState<Valores>({
    destino: inicial.destino ?? 'fila_de_agentes',
    nivel: inicial.nivel ?? 'aprovar_desenho',
    tipoDeDemanda: inicial.tipoDeDemanda ?? '',
    escopo: inicial.escopo ?? '',
    resposta: inicial.resposta ?? '',
    texto: inicial.texto ?? '',
  })
  const [enviando, setEnviando] = useState(false)
  const mudar = (campo: keyof Valores) => (e: { target: { value: string } }) =>
    setV((atual) => ({ ...atual, [campo]: e.target.value }))
  const id = (campo: string) => `${base}-${campo}`

  const texto = (campo: 'escopo' | 'resposta' | 'texto', rotulo: string, limite: number) => (
    <div className="space-y-1">
      <label htmlFor={id(campo)} className={ROTULO}>
        {rotulo}
      </label>
      <textarea
        id={id(campo)}
        rows={campo === 'escopo' ? 2 : 3}
        maxLength={limite}
        autoFocus={foco === campo}
        value={v[campo]}
        onChange={mudar(campo)}
        className={CAMPO}
      />
    </div>
  )
  const escolha = (
    campo: 'destino' | 'nivel' | 'tipoDeDemanda',
    rotulo: string,
    opcoes: readonly { valor: string; rotulo: string }[],
  ) => (
    <div className="space-y-1">
      <label htmlFor={id(campo)} className={ROTULO}>
        {rotulo}
      </label>
      <select
        id={id(campo)}
        autoFocus={foco === campo}
        value={v[campo]}
        onChange={mudar(campo)}
        className={CAMPO}
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </div>
  )

  const salvar = async () => {
    setEnviando(true)
    try {
      await onSalvar(camposDaAcao(acao, v))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form
      aria-label="Ajustar o cartão"
      onSubmit={(e) => {
        e.preventDefault()
        void salvar()
      }}
      className="space-y-3 rounded-padrao border-[1.5px] border-sucesso bg-surface px-4 py-3.5 md:ml-10 md:max-w-[80%]"
    >
      {acoes.length > 1 && (
        <div className="space-y-1">
          <label htmlFor={id('acao')} className={ROTULO}>
            Ação
          </label>
          <select
            id={id('acao')}
            value={acao}
            onChange={(e) => setAcao(e.target.value as Acao)}
            className={CAMPO}
          >
            {acoes.map((a) => (
              <option key={a} value={a}>
                {ROTULO_DA_ACAO[a]}
              </option>
            ))}
          </select>
        </div>
      )}
      {acao === 'destino' && (
        <div className="grid gap-3 sm:grid-cols-3">
          {escolha(
            'destino',
            'Destino',
            DESTINOS.map((d) => ({ valor: d, rotulo: ROTULO_DO_DESTINO[d] })),
          )}
          {escolha(
            'nivel',
            'Nível',
            NIVEIS.map((n) => ({ valor: n, rotulo: ROTULO_DO_NIVEL[n] })),
          )}
          {escolha('tipoDeDemanda', 'Tipo', [
            { valor: '', rotulo: 'Escolha o tipo' },
            ...TIPOS.map((t) => ({ valor: t, rotulo: ROTULO_DO_TIPO[t] })),
          ])}
        </div>
      )}
      {acao === 'destino' && texto('escopo', 'Escopo', LIMITE.escopo)}
      {(acao === 'destino' || acao === 'recusar' || acao === 'retomar') &&
        texto('resposta', 'Resposta a quem pediu', LIMITE.resposta)}
      {acao === 'ajustar_desenho' && texto('texto', 'Ajuste', LIMITE.ajuste)}
      {(acao === 'responder' || acao === 'pedir_mudanca') &&
        texto('texto', 'Comentário', LIMITE.comentario)}
      {erro && (
        <p role="alert" className="break-words text-sm font-[550] text-erro">
          {erro}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando} aria-busy={enviando}>
          Salvar o cartão
        </Button>
      </div>
    </form>
  )
}
