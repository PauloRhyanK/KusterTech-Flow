import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import { formatarDataHora } from '@/lib/data'
import { formatarBytes, pontosDoGrafico, type PontoDoHistorico } from '@/modules/oficina/model'

export interface HistoricoDaMaquinaProps {
  historico: readonly PontoDoHistorico[]
  // A linha da memória fica em tom de atenção quando a memória está abaixo do mínimo.
  memoriaApertada?: boolean
}

const LARGURA = 300
const ALTURA = 70
const MB = 1024 * 1024

interface Serie {
  id: string
  titulo: string
  descricao: string
  cor: string
  pontos: { em: Date; bytes: number }[]
}

// "16/11/2026 15:20" → "16/11 15:20"
function diaCurto(em: Date): string {
  const [dia, hora] = formatarDataHora(em).split(' ')
  return `${dia!.slice(0, 5)} ${hora}`
}

function Grafico({ serie }: { serie: Serie }) {
  const minimo = serie.pontos.reduce<Serie['pontos'][number] | null>(
    (menor, p) => (menor === null || p.bytes < menor.bytes ? p : menor),
    null,
  )
  return (
    <section aria-labelledby={`titulo-${serie.id}`} className="min-w-0">
      <TituloDeSecao
        id={`titulo-${serie.id}`}
        complemento={<small className="text-[12.5px] text-text-tertiary">7 dias</small>}
      >
        {serie.titulo}
      </TituloDeSecao>
      <div className={`${CLASSE_DO_CARTAO} p-4`}>
        {minimo === null ? (
          <p className="text-[13px] text-text-tertiary">Sem dados</p>
        ) : (
          <>
            <svg
              role="img"
              aria-label={`${serie.descricao} nos últimos 7 dias`}
              viewBox={`0 0 ${LARGURA} ${ALTURA}`}
              preserveAspectRatio="none"
              className="block h-[70px] w-full"
            >
              <polyline
                fill="none"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                className={serie.cor}
                points={pontosDoGrafico(
                  serie.pontos.map((p) => p.bytes),
                  LARGURA,
                  ALTURA,
                )}
              />
            </svg>
            <p className="mt-1.5 text-[13px] text-text-secondary">
              Mínimo de {formatarBytes(minimo.bytes)} em {diaCurto(minimo.em)}
            </p>
          </>
        )}
      </div>
    </section>
  )
}

// Memória disponível e disco livre, um ponto a cada 10 minutos. SVG puro, sem biblioteca.
export function HistoricoDaMaquina({
  historico,
  memoriaApertada = false,
}: HistoricoDaMaquinaProps) {
  const memoria: Serie = {
    id: 'historico-memoria',
    titulo: 'Memória disponível',
    descricao: 'Memória disponível',
    cor: memoriaApertada ? 'stroke-atencao' : 'stroke-context-active',
    pontos: historico.map((p) => ({ em: p.em, bytes: p.memDisponivelMb * MB })),
  }
  const disco: Serie = {
    id: 'historico-disco',
    titulo: 'Disco livre',
    descricao: 'Disco livre',
    cor: 'stroke-action-primary',
    pontos: historico.flatMap((p) =>
      p.discoLivreBytes === null ? [] : [{ em: p.em, bytes: p.discoLivreBytes }],
    ),
  }
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Grafico serie={memoria} />
      <Grafico serie={disco} />
    </div>
  )
}
