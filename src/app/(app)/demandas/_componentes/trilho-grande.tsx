import type { PontoDoTrilho } from '@/modules/demandas/apresentacao'
import { cn } from '@/lib/utils'
import type { PontoDeEtapa } from './trilho-de-etapas'

// Pontos de 14 px ligados por uma linha; o ponto da etapa atual ganha um anel no tom dela.
// Cada etapa tem largura mínima para o rótulo mais longo ("Desenvolvida"): no celular o trilho
// rola na horizontal em vez de sobrepor os rótulos.
const CLASSE_DO_PONTO: Record<PontoDoTrilho, string> = {
  feito: 'bg-marca-flow',
  atual: 'border-[3px] border-execucao bg-surface',
  espera: 'border-[3px] border-atencao bg-surface',
  travado: 'bg-erro',
  futuro: 'bg-border-strong',
}

const CLASSE_DO_ROTULO: Record<PontoDoTrilho, string> = {
  feito: 'text-text-secondary',
  atual: 'font-[650] text-execucao',
  espera: 'font-[650] text-atencao',
  travado: 'font-[650] text-erro',
  futuro: 'text-text-tertiary',
}

export function TrilhoGrande({ pontos }: { pontos: readonly PontoDeEtapa[] }) {
  return (
    <ol aria-label="Etapas" className="flex items-start overflow-x-auto pb-1">
      {pontos.map((p, i) => (
        <li
          key={p.chave}
          aria-current={p.ponto !== 'feito' && p.ponto !== 'futuro' ? 'step' : undefined}
          className={cn(
            'relative min-w-[78px] flex-1 whitespace-nowrap text-center text-xs',
            CLASSE_DO_ROTULO[p.ponto],
          )}
        >
          {i > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-1.5 right-1/2 h-0.5 w-full',
                p.ponto === 'futuro' ? 'bg-border' : 'bg-marca-flow',
              )}
            />
          )}
          <span
            data-ponto={p.ponto}
            aria-hidden="true"
            className={cn(
              // z-10: a linha da etapa seguinte é desenhada depois e não pode cobrir o ponto.
              'relative z-10 mx-auto mb-1.5 block size-3.5 rounded-full',
              CLASSE_DO_PONTO[p.ponto],
            )}
          />
          {p.rotulo}
        </li>
      ))}
    </ol>
  )
}
