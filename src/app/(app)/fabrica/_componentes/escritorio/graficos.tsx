// Gráficos da sala de gestão, em SVG próprio (sem biblioteca), com as cores dos tokens e da paleta do escritório.
import type { DadosDaGestao, LinhaDaGestao } from '@/modules/fabrica/escritorio/gestao'
import type { TempoDaEtapa } from '@/modules/fabrica/escritorio/previsao'
import { hora } from './hora'

const COR = {
  grade: 'var(--border)',
  texto: 'var(--text-secondary)',
  agora: 'var(--cor-informacao)',
  bom: 'var(--cor-sucesso)',
  ruim: 'var(--cor-erro)',
  previsto: 'var(--surface-subtle)',
}

const ms = (iso: string) => new Date(iso).getTime()

/** Uma barra por parte: cheia para o tempo gasto, tracejada para o que falta pela previsão. */
export function LinhaDoTempoDasPartes({
  linhas,
  agora,
  entrega,
}: {
  linhas: LinhaDaGestao[]
  agora: Date
  entrega: string | null
}) {
  const instantes = linhas
    .flatMap((l) => [l.comecou, l.termina])
    .filter((x): x is string => x !== null)
  const inicio = Math.min(agora.getTime(), ...instantes.map(ms))
  const fim = Math.max(
    agora.getTime() + 30 * 60_000,
    entrega ? ms(entrega) : 0,
    ...instantes.map(ms),
  )
  const L = 900
  const x = (t: number) => 160 + ((t - inicio) / (fim - inicio)) * (L - 220)
  const altura = 40 + linhas.length * 30
  return (
    <svg viewBox={`0 0 ${L} ${altura}`} role="img" aria-label="Linha do tempo das partes">
      {linhas.map((l, i) => {
        const y = 24 + i * 30
        const cor = `var(--pixel-raia-${l.cor % 8})`
        const comeco = l.comecou ? ms(l.comecou) : agora.getTime()
        const termino = l.termina ? ms(l.termina) : agora.getTime()
        const gastoAte = l.terminaPrevisto ? Math.min(agora.getTime(), termino) : termino
        return (
          <g key={l.raia}>
            <text x={0} y={y + 13} fontSize={11} fill="var(--text-primary)">
              {l.raia}
            </text>
            {l.comecou && gastoAte > comeco && (
              <rect
                x={x(comeco)}
                y={y}
                width={x(gastoAte) - x(comeco)}
                height={18}
                rx={4}
                fill={cor}
                stroke="var(--pixel-contorno)"
              />
            )}
            {l.terminaPrevisto && l.termina && (
              <rect
                x={x(Math.max(comeco, agora.getTime()))}
                y={y}
                width={Math.max(2, x(termino) - x(Math.max(comeco, agora.getTime())))}
                height={18}
                rx={4}
                fill={cor}
                opacity={0.35}
                strokeDasharray="4 3"
                stroke={cor}
              />
            )}
            <text x={x(termino) + 6} y={y + 13} fontSize={10} fill={COR.texto}>
              {l.termina ? `${l.terminaPrevisto ? '~' : '✓ '}${hora(l.termina)}` : '—'}
            </text>
          </g>
        )
      })}
      <line
        x1={x(agora.getTime())}
        x2={x(agora.getTime())}
        y1={14}
        y2={altura - 14}
        stroke={COR.agora}
        strokeWidth={2}
      />
      <text x={x(agora.getTime()) + 4} y={altura - 2} fontSize={10} fill={COR.agora}>
        agora {hora(agora)}
      </text>
      {entrega && (
        <>
          <line
            x1={x(ms(entrega))}
            x2={x(ms(entrega))}
            y1={14}
            y2={altura - 14}
            stroke={COR.bom}
            strokeDasharray="4 3"
          />
          <text x={x(ms(entrega)) - 4} y={12} fontSize={10} textAnchor="end" fill={COR.bom}>
            entrega ~{hora(entrega)}
          </text>
        </>
      )}
    </svg>
  )
}

/** Partes entregues ao longo do tempo, com a projeção até o total na entrega prevista. */
export function BurnUp({
  dados,
  total,
  agora,
}: {
  dados: DadosDaGestao
  total: number
  agora: Date
}) {
  const entregas = [...dados.entregas].sort((a, b) => ms(a.fim) - ms(b.fim))
  const inicio = Math.min(agora.getTime() - 60 * 60_000, ...entregas.map((e) => ms(e.fim)))
  const fim = Math.max(
    agora.getTime() + 30 * 60_000,
    dados.entregaPrevista ? ms(dados.entregaPrevista.p50) : 0,
  )
  const x = (t: number) => 36 + ((t - inicio) / (fim - inicio)) * 470
  const y = (n: number) => 160 - (n / Math.max(1, total)) * 140
  let pontos = `${x(inicio)},${y(0)}`
  entregas.forEach((e, i) => {
    pontos += ` ${x(ms(e.fim))},${y(i)} ${x(ms(e.fim))},${y(i + 1)}`
  })
  pontos += ` ${x(agora.getTime())},${y(entregas.length)}`
  return (
    <svg viewBox="0 0 520 180" role="img" aria-label="Partes entregues ao longo do tempo">
      {[0, total].map((n) => (
        <g key={n}>
          <line
            x1={36}
            x2={510}
            y1={y(n)}
            y2={y(n)}
            stroke={COR.grade}
            strokeDasharray={n === total ? '5 4' : undefined}
          />
          <text x={30} y={y(n) + 3} fontSize={9} textAnchor="end" fill={COR.texto}>
            {n}
          </text>
        </g>
      ))}
      <polyline points={pontos} fill="none" stroke={COR.bom} strokeWidth={3} />
      {dados.entregaPrevista && (
        <line
          x1={x(agora.getTime())}
          y1={y(entregas.length)}
          x2={x(ms(dados.entregaPrevista.p50))}
          y2={y(total)}
          stroke={COR.bom}
          strokeWidth={2.5}
          strokeDasharray="5 4"
        />
      )}
      <line
        x1={x(agora.getTime())}
        x2={x(agora.getTime())}
        y1={14}
        y2={165}
        stroke={COR.agora}
        strokeDasharray="3 3"
      />
      <text x={x(agora.getTime()) + 4} y={22} fontSize={9} fill={COR.agora}>
        agora
      </text>
    </svg>
  )
}

/** A chance de terminar em cada janela de horário. */
export function ChancePorHorario({ chances }: { chances: DadosDaGestao['chances'] }) {
  const maior = Math.max(1, ...chances.map((c) => c.chance))
  const acumuladas = chances.map((_, i) =>
    chances.slice(0, i + 1).reduce((soma, c) => soma + c.chance, 0),
  )
  return (
    <svg viewBox="0 0 360 190" role="img" aria-label="Chance de terminar em cada horário">
      {chances.map((c, i) => {
        const acumulada = acumuladas[i]!
        const largura = 320 / chances.length
        const h = (c.chance / maior) * 120
        const xi = 16 + i * largura
        return (
          <g key={c.ate}>
            <rect
              x={xi}
              y={150 - h}
              width={largura - 6}
              height={h}
              rx={3}
              fill={
                acumulada <= 50
                  ? 'var(--pixel-raia-0)'
                  : acumulada <= 85
                    ? 'var(--pixel-papel-frontend)'
                    : 'var(--pixel-metal)'
              }
            />
            <text
              x={xi + (largura - 6) / 2}
              y={146 - h}
              fontSize={9}
              textAnchor="middle"
              fill={COR.texto}
            >
              {Math.round(c.chance)}%
            </text>
            <text
              x={xi + (largura - 6) / 2}
              y={166}
              fontSize={9}
              textAnchor="middle"
              fill={COR.texto}
            >
              {hora(c.ate)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Tempo real de cada etapa contra o previsto; vermelho quando passa. */
export function TempoPorEtapa({ etapas }: { etapas: TempoDaEtapa[] }) {
  const maior = Math.max(1, ...etapas.flatMap((e) => [e.realMin ?? 0, e.previstoMin ?? 0]))
  const escala = 190 / maior
  return (
    <svg
      viewBox={`0 0 360 ${Math.max(60, 12 + etapas.length * 31)}`}
      role="img"
      aria-label="Tempo por etapa"
    >
      {etapas.map((e, i) => {
        const y = 12 + i * 31
        const passou = e.realMin !== null && e.previstoMin !== null && e.realMin > e.previstoMin
        return (
          <g key={e.etapa}>
            <text x={0} y={y + 12} fontSize={10} fill={COR.texto}>
              {e.etapa}
            </text>
            <rect
              x={100}
              y={y}
              width={(e.previstoMin ?? 0) * escala}
              height={14}
              rx={3}
              fill={COR.previsto}
            />
            <rect
              x={100}
              y={y}
              width={(e.realMin ?? 0) * escala}
              height={14}
              rx={3}
              fill={passou ? COR.ruim : 'var(--pixel-papel-frontend)'}
            />
            <text
              x={Math.min(300, 100 + Math.max(e.realMin ?? 0, e.previstoMin ?? 0) * escala + 6)}
              y={y + 11}
              fontSize={9}
              fill={COR.texto}
            >
              {e.realMin ?? '—'} / {e.previstoMin ?? '—'} min
            </text>
          </g>
        )
      })}
    </svg>
  )
}
