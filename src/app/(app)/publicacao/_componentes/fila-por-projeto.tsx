import Link from 'next/link'
import {
  colunaDeEstado,
  historicoReescrito,
  noArDaLinha,
  oQueEstaNoAr,
  pilulasDaLinha,
  type ChecksDoPedido,
  type ColunaDeEstado,
  type LinhaDaFila,
  type Pilula,
  type TomDaPilula,
} from '@/modules/fila-de-publicacao/apresentacao'
import { CLASSE_DO_CARTAO, CLASSE_DO_LINK, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import { cn } from '@/lib/utils'
import { BotaoDeRedefinirNoAr, BotaoDeRetomarFila } from './botoes-da-publicacao'

export interface FilaPorProjetoProps {
  linhas: readonly LinhaDaFila[]
  agora: Date
  pausaGeral: boolean
  podeGerenciar: boolean
  podeRedefinir: boolean
}

// Abaixo de md cada linha vira um cartão; a partir de md, as quatro colunas do desenho.
const COLUNAS =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 md:grid-cols-[minmax(0,1fr)_minmax(9rem,1.5fr)_minmax(0,1.8fr)_9.5rem]'

const TOM_DA_PILULA: Record<TomDaPilula, string> = {
  neutro: 'border-border bg-tonal-neutro text-neutro',
  execucao: 'border-execucao/30 bg-tonal-execucao text-execucao',
  informacao: 'border-informacao/40 bg-tonal-informacao text-informacao',
  atencao: 'border-atencao/30 bg-tonal-atencao text-atencao',
  erro: 'border-erro/30 bg-tonal-erro text-erro',
}

const COR_DOS_CHECKS: Record<NonNullable<ChecksDoPedido> | 'nenhum', string> = {
  sucesso: 'bg-sucesso',
  falha: 'bg-erro',
  pendente: 'bg-border-strong',
  sem_checks: 'bg-border-strong',
  nenhum: 'bg-border-strong',
}

const ROTULO_DOS_CHECKS: Record<NonNullable<ChecksDoPedido> | 'nenhum', string> = {
  sucesso: 'checks verdes',
  falha: 'checks vermelhos',
  pendente: 'checks pendentes',
  sem_checks: 'sem CI',
  nenhum: 'checks ainda não lidos',
}

function PontoDosChecks({ checks, rotular }: { checks: ChecksDoPedido; rotular?: boolean }) {
  const chave = checks ?? 'nenhum'
  return (
    <>
      <span
        aria-hidden="true"
        className={cn('inline-block size-2 shrink-0 rounded-full', COR_DOS_CHECKS[chave])}
      />
      {rotular && <span className="sr-only">{`${ROTULO_DOS_CHECKS[chave]}: `}</span>}
    </>
  )
}

function PilulaDaFila({ pilula }: { pilula: Pilula }) {
  if (pilula.vazia) {
    return <span className="text-xs font-[550] text-text-tertiary">{pilula.texto}</span>
  }
  return (
    <span
      className={cn(
        'inline-flex h-[22px] max-w-full items-center gap-[5px] whitespace-nowrap rounded-[5px] border px-[9px] text-xs font-[550]',
        TOM_DA_PILULA[pilula.tom],
        pilula.tracejada && 'border-dashed',
        pilula.chave === 'parado' && 'font-[650]',
      )}
    >
      {pilula.checks !== undefined && <PontoDosChecks checks={pilula.checks} rotular />}
      <span className="truncate">{pilula.texto}</span>
    </span>
  )
}

const TOM_DA_COLUNA = {
  secundario: 'text-text-secondary',
  atencao: 'font-[600] text-atencao',
  erro: 'font-[600] text-erro',
} as const

function Coluna({ coluna }: { coluna: ColunaDeEstado | null }) {
  if (coluna === null) return null
  if (coluna.tipo === 'link') {
    return (
      <Link href={coluna.href} className={CLASSE_DO_LINK}>
        {coluna.texto}
      </Link>
    )
  }
  return (
    <span className={cn('whitespace-nowrap text-sm', TOM_DA_COLUNA[coluna.tom])}>
      {coluna.texto}
    </span>
  )
}

function LinhaDoProjeto({
  linha,
  agora,
  pausaGeral,
  podeGerenciar,
  podeRedefinir,
}: Omit<FilaPorProjetoProps, 'linhas'> & { linha: LinhaDaFila }) {
  const parada = linha.configuracao?.situacao === 'parado'
  const reescrito = historicoReescrito(linha, agora)
  return (
    <li
      id={linha.repositorioId}
      className={cn(COLUNAS, 'scroll-mt-24 gap-y-2 px-4 py-3 md:items-center')}
    >
      <p className="truncate text-sm font-[650] text-text-primary" title={linha.rotulo}>
        {linha.rotulo}
      </p>
      {/* No celular, o que está no ar ocupa a linha toda: um título longo não espreme o nome do projeto. */}
      <div className="col-span-2 min-w-0 md:col-span-1">
        {oQueEstaNoAr(linha) && (
          <p className="truncate text-sm text-text-primary" title={oQueEstaNoAr(linha)!}>
            {oQueEstaNoAr(linha)}
          </p>
        )}
        <p
          className={cn(
            'whitespace-nowrap font-mono text-xs',
            !linha.noAr
              ? 'text-text-tertiary'
              : oQueEstaNoAr(linha)
                ? 'text-text-secondary'
                : 'text-text-primary',
          )}
        >
          {noArDaLinha(linha, agora)}
        </p>
      </div>
      <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-[5px] md:col-span-1">
        {pilulasDaLinha(linha, agora).map((p) => (
          <PilulaDaFila key={p.chave} pilula={p} />
        ))}
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:flex-col md:items-start">
        <Coluna coluna={colunaDeEstado(linha, agora, pausaGeral)} />
        {parada && podeGerenciar && <BotaoDeRetomarFila repositorioId={linha.repositorioId} />}
        {reescrito && podeRedefinir && <BotaoDeRedefinirNoAr repositorioId={linha.repositorioId} />}
      </div>
    </li>
  )
}

export function FilaPorProjeto({ linhas, ...resto }: FilaPorProjetoProps) {
  return (
    <section aria-labelledby="titulo-fila-por-projeto" className="min-w-0">
      <TituloDeSecao id="titulo-fila-por-projeto">Fila por projeto</TituloDeSecao>
      <div className={CLASSE_DO_CARTAO}>
        {linhas.length === 0 ? (
          <p className="px-4 py-3 text-sm text-text-secondary">
            Nenhum repositório vinculado a projeto ativo.
          </p>
        ) : (
          <>
            <div
              aria-hidden="true"
              className={cn(
                COLUNAS,
                'hidden border-b border-border px-4 py-2.5 text-[11.5px] font-[600] uppercase tracking-[0.05em] text-text-secondary md:grid',
              )}
            >
              <span>Projeto</span>
              <span>No ar</span>
              <span>Fila</span>
              <span />
            </div>
            <ul aria-label="Fila por projeto" className="divide-y divide-border">
              {linhas.map((linha) => (
                <LinhaDoProjeto key={linha.repositorioId} linha={linha} {...resto} />
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-[5px]">
          <PontoDosChecks checks="sucesso" />
          checks verdes
        </span>
        <span className="inline-flex items-center gap-[5px]">
          <PontoDosChecks checks="falha" />
          vermelhos
        </span>
        <span className="inline-flex items-center gap-[5px]">
          <PontoDosChecks checks="sem_checks" />
          sem CI — não bloqueiam
        </span>
      </p>
    </section>
  )
}
