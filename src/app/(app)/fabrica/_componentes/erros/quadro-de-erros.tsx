// Quadro "Erros no ar" da página Fábrica (desenho 2026-11-26-erros/01-erros.html). O GlitchTip fica
// só para os detalhes: cada linha leva à demanda e, em nova aba, à issue.
import Link from 'next/link'
import type { EstadoNoQuadro } from '@/modules/erros/model'
import type { LinhaDoQuadro, QuadroDeErros } from '@/modules/erros/apresentacao'
import { formatarIdade } from '@/modules/inicio/model'

const VISIVEIS = 8

const ESTADO: Record<EstadoNoQuadro, { rotulo: string; cor: string; chip: string }> = {
  voltou: { rotulo: 'Voltou', cor: 'text-atencao', chip: 'bg-tonal-atencao text-atencao' },
  novo: { rotulo: 'Novo', cor: 'text-erro', chip: 'bg-tonal-erro text-erro' },
  em_correcao: {
    rotulo: 'Em correção',
    cor: 'text-execucao',
    chip: 'bg-tonal-execucao text-execucao',
  },
  na_espera: { rotulo: 'Na espera', cor: 'text-neutro', chip: 'bg-surface-subtle text-neutro' },
  observando: {
    rotulo: 'Em observação',
    cor: 'text-text-secondary',
    chip: 'bg-surface-subtle text-text-secondary',
  },
  no_ar: { rotulo: 'No ar', cor: 'text-sucesso', chip: 'bg-surface-subtle text-sucesso' },
  corrigido: { rotulo: 'Corrigido', cor: 'text-sucesso', chip: 'bg-tonal-sucesso text-sucesso' },
}

const CHIPS: { estado: Exclude<EstadoNoQuadro, 'corrigido'>; texto: string }[] = [
  { estado: 'novo', texto: 'novo' },
  { estado: 'em_correcao', texto: 'em correção' },
  { estado: 'voltou', texto: 'voltou' },
  { estado: 'na_espera', texto: 'na espera' },
  { estado: 'observando', texto: 'em observação' },
  { estado: 'no_ar', texto: 'no ar' },
]

function textoDaLeitura(q: QuadroDeErros, agora: Date): string {
  const { ultimoSucessoEm, motivo } = q.leitura
  if (ultimoSucessoEm === null) {
    return motivo ? `o GlitchTip não respondeu ainda (${motivo})` : 'o GlitchTip ainda não foi lido'
  }
  const idade = formatarIdade(ultimoSucessoEm, agora)
  if (!q.leitura.velha) return `GlitchTip lido ${idade}`
  return `o GlitchTip não responde ${idade}${motivo ? ` (${motivo})` : ''}`
}

function Barrinhas({ valores, subindo }: LinhaDoQuadro['barrinhas']) {
  const maior = Math.max(...valores, 1)
  return (
    <div aria-hidden="true" className="hidden h-5 w-16 flex-none items-end gap-0.5 md:flex">
      {valores.map((v, i) => (
        <i
          key={i}
          className={`flex-1 rounded-[1px] ${subindo ? 'bg-erro/40' : 'bg-border-strong'}`}
          style={{ height: `${Math.round((v / maior) * 100)}%` }}
        />
      ))}
    </div>
  )
}

type VirarDemanda = (form: FormData) => Promise<void>

function Linha({
  l,
  agora,
  velha,
  virarDemanda,
}: {
  l: LinhaDoQuadro
  agora: Date
  velha: boolean
  virarDemanda?: VirarDemanda
}) {
  const estado = ESTADO[l.estado]
  const usuarios = l.usuarios === 1 ? '1 usuário' : `${l.usuarios} usuários`
  return (
    <li className="flex flex-wrap items-start gap-x-3.5 gap-y-1 border-t border-border px-4 py-2.5 first:border-t-0 md:flex-nowrap md:items-center">
      <span
        aria-label={`nível ${l.nivel}`}
        className={`mt-1.5 size-2.5 flex-none rounded-full bg-erro md:mt-0 ${
          l.nivel === 'fatal' ? 'ring-[3px] ring-erro/25' : ''
        }`}
      />
      <div className="min-w-0 flex-[1_1_calc(100%-24px)] md:flex-1">
        <b className="block font-medium text-text-primary md:truncate">{l.titulo}</b>
        <span className="block truncate text-xs text-text-tertiary">
          {l.projeto}
          {l.onde ? <span className="font-mono"> · {l.onde}</span> : null}
        </span>
      </div>
      <Barrinhas {...l.barrinhas} />
      <div className="ml-6 text-xs text-text-secondary md:ml-0 md:w-40 md:flex-none md:text-right">
        <span className="block">
          {l.eventos} eventos · {usuarios}
        </span>
        <span className="block text-text-tertiary">
          {velha ? 'até a última leitura' : `último ${formatarIdade(l.ultimoEm, agora)}`}
        </span>
      </div>
      <div className={`ml-6 text-[13px] font-semibold md:ml-0 md:w-44 md:flex-none ${estado.cor}`}>
        <span className="block">{estado.rotulo}</span>
        <span className="block text-xs font-normal text-text-tertiary">{l.detalhe}</span>
      </div>
      <div className="ml-auto flex flex-none gap-2.5 text-[13px] whitespace-nowrap md:w-36 md:justify-end">
        {l.demandaId ? (
          <Link href={`/demandas/${l.demandaId}`} className="text-text-link hover:underline">
            Demanda
          </Link>
        ) : null}
        {l.estado === 'observando' && virarDemanda ? (
          <form action={virarDemanda}>
            <input type="hidden" name="issueId" value={l.issueId} />
            <button type="submit" className="cursor-pointer text-text-link hover:underline">
              Virar demanda
            </button>
          </form>
        ) : null}
        <a
          href={l.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-link hover:underline"
        >
          Detalhes ↗
        </a>
      </div>
    </li>
  )
}

export function ErrosNoAr({
  quadro: q,
  agora,
  virarDemanda,
}: {
  quadro: QuadroDeErros
  agora: Date
  /** Ação do botão "Virar demanda"; sem ela (quem não pode abrir demanda) o botão não aparece. */
  virarDemanda?: VirarDemanda
}) {
  const velha = q.leitura.velha
  const visiveis = q.linhas.slice(0, VISIVEIS)
  const resto = q.linhas.slice(VISIVEIS)
  return (
    // Grade com minmax(0,1fr): os títulos com `truncate` não alargam a coluna principal da página.
    <section aria-labelledby="erros-no-ar" className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {q.configurado && velha ? (
        <p className="rounded-padrao border border-atencao/30 bg-tonal-atencao px-4 py-3 text-sm text-text-secondary">
          <b className="text-atencao">Espera você: </b>
          <span>{textoDaLeitura(q, agora)}</span>
        </p>
      ) : null}
      <div className="rounded-padrao border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
          <h2 id="erros-no-ar" className="text-[15px] font-semibold text-text-primary">
            Erros no ar
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.filter((c) => q.contagem[c.estado] > 0).map((c) => (
              <span
                key={c.estado}
                className={`rounded-full px-2.5 py-0.5 text-xs ${ESTADO[c.estado].chip}`}
              >
                <b className="font-semibold">{q.contagem[c.estado]}</b> {c.texto}
              </span>
            ))}
          </div>
          {q.configurado ? (
            <span
              className={`w-full text-xs md:ml-auto md:w-auto ${
                velha ? 'font-semibold text-erro' : 'text-text-tertiary'
              }`}
            >
              {velha ? 'sem leitura recente' : textoDaLeitura(q, agora)}
            </span>
          ) : null}
        </div>

        {!q.configurado ? (
          <p className="px-4 py-4 text-sm text-text-secondary">GlitchTip não configurado</p>
        ) : q.linhas.length === 0 ? (
          <p className="px-4 py-4 text-sm text-text-secondary">
            <span>Nenhum erro aberto nos {q.projetosLidos} projetos lidos.</span>{' '}
            {q.corrigidosEm7Dias > 0 ? (
              <span>{q.corrigidosEm7Dias} corrigidos nos últimos 7 dias.</span>
            ) : null}
          </p>
        ) : (
          <>
            <ul>
              {visiveis.map((l) => (
                <Linha
                  key={l.issueId}
                  l={l}
                  agora={agora}
                  velha={velha}
                  virarDemanda={virarDemanda}
                />
              ))}
            </ul>
            {resto.length > 0 ? (
              <details className="border-t border-border">
                <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-text-link">
                  Ver todos os {q.linhas.length}
                </summary>
                <ul>
                  {resto.map((l) => (
                    <Linha
                      key={l.issueId}
                      l={l}
                      agora={agora}
                      velha={velha}
                      virarDemanda={virarDemanda}
                    />
                  ))}
                </ul>
              </details>
            ) : null}
            {q.corrigidosEm7Dias > 0 ? (
              <p className="border-t border-border px-4 py-2.5 text-[13px] text-text-tertiary">
                {q.corrigidosEm7Dias} corrigidos nos últimos 7 dias
              </p>
            ) : null}
          </>
        )}
        {q.avisos.map((a) => (
          <p key={a} className="border-t border-border px-4 py-2 text-xs text-atencao">
            {a}
          </p>
        ))}
      </div>
    </section>
  )
}
