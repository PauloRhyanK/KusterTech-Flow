import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import { BadgeDeEstado, type TomDeEstado } from '@/lib/ui/badge-de-estado'
import type { RetratoDaMaquina } from '@/modules/oficina/contrato'
import { formatarBytes, servicoDoFlow } from '@/modules/oficina/model'

export interface EstadoDaFabrica {
  ocupadas: number
  efetivas: number
  planos: number
}

export interface ServicosDaMaquinaProps {
  retrato: RetratoDaMaquina | null
  fabrica: EstadoDaFabrica | null
}

interface Servico {
  nome: string
  detalhe: string
  selo: { texto: string; tom: TomDeEstado }
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

function servicos(retrato: RetratoDaMaquina, fabrica: EstadoDaFabrica | null): Servico[] {
  const ativa = retrato.servicos.fabrica === 'ativa'
  const fila = ativa ? 'fila ativa' : 'fila parada'
  const doFabrica: Servico = {
    nome: 'Fábrica',
    detalhe: fabrica
      ? `${fila} · ${fabrica.ocupadas} de ${fabrica.efetivas} vagas ocupadas · ${plural(fabrica.planos, 'plano', 'planos')}`
      : fila,
    selo: !ativa
      ? { texto: 'Parada', tom: 'neutro' }
      : fabrica && fabrica.ocupadas > 0
        ? { texto: 'Trabalhando', tom: 'execucao' }
        : { texto: 'Ativa', tom: 'neutro' },
  }

  const { noAr, ocupados, total } = retrato.servicos.runners
  const doRunners: Servico = {
    nome: 'Runners do GitHub Actions',
    detalhe: `${plural(ocupados, 'ocupado', 'ocupados')} · ${plural(Math.max(0, noAr - ocupados), 'livre', 'livres')}`,
    selo: { texto: `${noAr} de ${total} no ar`, tom: noAr < total ? 'atencao' : 'neutro' },
  }

  const flow = servicoDoFlow(retrato.containers)
  const doFlow: Servico = flow
    ? {
        nome: 'KusterTech Flow',
        detalhe: `${plural(flow.total, 'container', 'containers')} · ${formatarBytes(flow.memoriaBytes)} de memória`,
        selo:
          flow.noAr === flow.total
            ? { texto: 'No ar', tom: 'neutro' }
            : { texto: `${flow.noAr} de ${flow.total} no ar`, tom: 'atencao' },
      }
    : {
        nome: 'KusterTech Flow',
        detalhe: 'nenhum container do Flow',
        selo: { texto: 'Sem dados', tom: 'neutro' },
      }

  return [doFabrica, doRunners, doFlow]
}

// O que divide a máquina: Fábrica, runners e o próprio Flow. Nada aqui é verde (invariante 9).
export function ServicosDaMaquina({ retrato, fabrica }: ServicosDaMaquinaProps) {
  return (
    <section aria-labelledby="titulo-servicos">
      <TituloDeSecao
        id="titulo-servicos"
        complemento={
          <small className="text-[12.5px] text-text-tertiary">o que divide a máquina</small>
        }
      >
        Serviços
      </TituloDeSecao>
      <div className={CLASSE_DO_CARTAO}>
        {retrato === null ? (
          <p className="p-4 text-[13px] text-text-tertiary">Sem dados</p>
        ) : (
          <ul className="divide-y divide-border">
            {servicos(retrato, fabrica).map((s) => (
              <li key={s.nome} className="flex items-center gap-3 px-4 py-[11px]">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-[550] text-text-primary">{s.nome}</p>
                  <p className="text-[12.5px] text-text-secondary">{s.detalhe}</p>
                </div>
                <BadgeDeEstado tom={s.selo.tom} className="shrink-0">
                  {s.selo.texto}
                </BadgeDeEstado>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
