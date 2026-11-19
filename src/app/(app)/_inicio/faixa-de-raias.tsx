import type { ResumoDoPlano } from '@/modules/fabrica/model'

export interface FaixaDeRaiasProps {
  raias: ResumoDoPlano['raias']
}

// Um segmento por estado, com largura proporcional ao número de raias nele.
export function FaixaDeRaias({ raias }: FaixaDeRaiasProps) {
  const segmentos = [
    { chave: 'concluidas', n: raias.concluidas, cor: 'bg-context-active' },
    { chave: 'executando', n: raias.executando, cor: 'bg-execucao' },
    { chave: 'falharam', n: raias.falharam, cor: 'bg-erro' },
    { chave: 'planejadas', n: raias.planejadas, cor: 'bg-border' },
  ].filter((s) => s.n > 0)

  return (
    <div
      role="img"
      aria-label={`${raias.concluidas} de ${raias.total} raias concluídas, ${raias.executando} executando, ${raias.falharam} falharam`}
      className="mt-1.5 flex h-1.5 gap-[3px]"
    >
      {segmentos.map((s) => (
        <span
          key={s.chave}
          className={`${s.cor} block rounded-full`}
          style={{ flexGrow: s.n, flexBasis: 0 }}
        />
      ))}
    </div>
  )
}
