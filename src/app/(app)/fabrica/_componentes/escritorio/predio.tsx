'use client'

// O prédio da Fábrica: um andar por demanda em execução, a equipe pela janela e sirenes onde o Paulo é esperado.
import type { Andar, ItemDaRecepcao } from '@/modules/fabrica/escritorio/model'
import { s } from './classes'
import { Boneco } from './pixel'

export interface PredioProps {
  andares: Andar[]
  recepcao: ItemDaRecepcao[]
  selecionado: string | null
  onSelecionar: (planoId: string) => void
}

function rotulo(andar: Andar, numero: number): string {
  const [feitas, total] = andar.progresso.partes
  const partes = `${feitas} de ${total} partes entregues`
  return `${numero}º andar: ${andar.titulo}, ${partes}${andar.esperaPaulo ? ', espera você' : ''}`
}

export function Predio({ andares, recepcao, selecionado, onSelecionar }: PredioProps) {
  // o andar mais novo fica em cima: a lista vem do mais antigo para o mais novo
  const deCimaParaBaixo = andares.map((a, i) => ({ andar: a, numero: i + 1 })).reverse()
  return (
    <div className={s.predio}>
      <div className={s.ceu}>
        <div className={s.teto}>
          <span className={s.antena} />
          <span className={s.placa}>FÁBRICA</span>
        </div>
        <div
          className={andares.length > 4 ? s.andares : undefined}
          data-rolagem={andares.length > 4 ? '' : undefined}
        >
          {deCimaParaBaixo.length === 0 ? (
            <p className="bg-surface px-3 py-6 text-center text-sm text-text-secondary">
              nenhuma demanda andando
            </p>
          ) : (
            deCimaParaBaixo.map(({ andar, numero }) => {
              const pct =
                andar.progresso.partes[1] === 0
                  ? 0
                  : (andar.progresso.partes[0] / andar.progresso.partes[1]) * 100
              const equipe = andar.agentes.filter((a) => a.area !== 'copa').slice(0, 4)
              return (
                <button
                  key={andar.planoId}
                  type="button"
                  className={`${s.andar} ${andar.esperaPaulo ? s.alerta : ''}`}
                  data-selecionado={selecionado === andar.planoId}
                  data-apagado={andar.semAgentes}
                  aria-label={rotulo(andar, numero)}
                  aria-pressed={selecionado === andar.planoId}
                  onClick={() => onSelecionar(andar.planoId)}
                >
                  <span className={s.vidro}>
                    <span className={s.chao} />
                    <span className={s.gente}>
                      {equipe.map((a) => (
                        <Boneco key={a.runId} papel={a.papel} semente={a.runId} escala={2} />
                      ))}
                    </span>
                  </span>
                  {andar.esperaPaulo && (
                    <>
                      <span className={s.sirene} data-sirene="esquerda" />
                      <span className={s.sirene} data-sirene="direita" />
                    </>
                  )}
                  {andar.semAgentes && <span className={s.zz}>z</span>}
                  <span className={s.info}>
                    <span className={s.numero}>{numero}º</span>
                    <span className={s.titulo}>{andar.titulo}</span>
                    <span className={s.barrinha}>
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
        <div className={s.terreo}>
          <span className={s.toldo} />
          <span className={s.recepcao}>RECEPÇÃO · {recepcao.length} na fila</span>
          <span className={s.porta} />
        </div>
        <div className={s.calcada} />
      </div>
    </div>
  )
}
