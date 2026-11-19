import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import type { Limpeza } from '@/modules/oficina/contrato'
import { diaEHora, formatarBytes } from '@/modules/oficina/model'
import { CELULA, CELULA_NUMERICA, CABECALHO, CABECALHO_NUMERICO } from './tabela-da-maquina'

export interface LimpezasDaMaquinaProps {
  limpezas: readonly Limpeza[]
  agora: Date
}

// Concluída é neutra, nunca verde: a limpeza não comprova que a máquina está saudável.
export function LimpezasDaMaquina({ limpezas, agora }: LimpezasDaMaquinaProps) {
  return (
    <section aria-labelledby="titulo-limpezas">
      <TituloDeSecao
        id="titulo-limpezas"
        complemento={
          <small className="text-[12.5px] text-text-tertiary">últimas 7 execuções</small>
        }
      >
        Limpeza diária
      </TituloDeSecao>
      <div className={`${CLASSE_DO_CARTAO} overflow-x-auto`}>
        {limpezas.length === 0 ? (
          <p className="p-4 text-[13px] text-text-secondary">Nenhuma limpeza registrada.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={CABECALHO}>Quando</th>
                <th className={CABECALHO}>Resultado</th>
                <th className={`${CABECALHO_NUMERICO} hidden sm:table-cell`}>Livre antes</th>
                <th className={`${CABECALHO_NUMERICO} hidden sm:table-cell`}>Livre depois</th>
                <th className={CABECALHO_NUMERICO}>Liberou</th>
              </tr>
            </thead>
            <tbody>
              {limpezas.map((l) => {
                const { dia, hora } = diaEHora(new Date(l.em), agora)
                return (
                  <tr key={l.em}>
                    <td className={`${CELULA} whitespace-nowrap`}>
                      {dia}, {hora}
                    </td>
                    <td className={CELULA}>
                      {l.ok ? (
                        <BadgeDeEstado tom="neutro">Concluída</BadgeDeEstado>
                      ) : (
                        <BadgeDeEstado tom="erro">Falhou</BadgeDeEstado>
                      )}
                    </td>
                    <td className={`${CELULA_NUMERICA} hidden sm:table-cell`}>
                      {formatarBytes(l.livreAntesBytes)}
                    </td>
                    <td className={`${CELULA_NUMERICA} hidden sm:table-cell`}>
                      {formatarBytes(l.livreDepoisBytes)}
                    </td>
                    <td className={CELULA_NUMERICA}>
                      {l.liberadoBytes === 0 ? '0' : formatarBytes(l.liberadoBytes)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
