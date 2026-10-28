import { Settings2 } from 'lucide-react'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import type { GrupoDePendencias as Grupo } from '@/modules/visao-geral/model'
import { GrupoDePendencias } from './grupo-de-pendencias'

export interface PendenciasProps {
  grupos: readonly Grupo[]
  fontesSemDados: readonly string[]
  escopo: 'global' | 'cliente'
}

export function Pendencias({ grupos, fontesSemDados, escopo }: PendenciasProps) {
  return (
    <section aria-labelledby="titulo-pendencias" className="space-y-4">
      <h2
        id="titulo-pendencias"
        className="text-[17px] font-[650] leading-[1.35] text-text-primary"
      >
        Pendências
      </h2>

      {grupos.length === 0 ? (
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Nenhuma pendência nas fontes disponíveis."
          descricao={
            escopo === 'cliente'
              ? 'Nenhuma homologação aguarda você nos seus clientes.'
              : 'Homologações, publicações, alertas, integrações e configuração foram consultados agora.'
          }
        />
      ) : (
        <div className="space-y-6">
          {grupos.map((grupo) => (
            <GrupoDePendencias key={grupo.tipo} grupo={grupo} />
          ))}
        </div>
      )}

      {fontesSemDados.length > 0 && (
        <ul
          aria-label="Fontes sem dados"
          className="space-y-1 rounded-padrao border border-border bg-surface px-4 py-3 text-sm text-neutro"
        >
          {fontesSemDados.map((texto) => (
            <li key={texto} className="flex items-center gap-2">
              <Settings2 size={16} strokeWidth={1.75} aria-hidden="true" />
              {texto}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
