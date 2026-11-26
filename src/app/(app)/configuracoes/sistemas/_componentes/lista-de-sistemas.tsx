import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { cn } from '@/lib/utils'
import type { TelaDeSistemas } from '@/modules/relatos/queries'

export interface ListaDeSistemasProps {
  tela: TelaDeSistemas
}

const RODAPE =
  'O Flow busca os relatos de cada sistema a cada minuto e devolve o andamento ao usuário pelo mesmo canal. O token de cada sistema fica cifrado.'

function Quadro({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-padrao border border-border bg-surface px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-secondary">
        {rotulo}
      </p>
      <p className="text-[26px] font-[650] leading-[1.2] tracking-[-0.02em] text-text-primary">
        {valor}
      </p>
    </div>
  )
}

function Contagem({ n, rotulo }: { n: number; rotulo: string }) {
  return (
    <div>
      <p className="text-[18px] font-[650] leading-[1.2] text-text-primary">{n}</p>
      <p className="text-xs text-text-secondary">{rotulo}</p>
    </div>
  )
}

export function BotaoConectarSistema() {
  return (
    <Link href="/configuracoes/sistemas/novo" className={buttonVariants({ variant: 'default' })}>
      Conectar sistema
    </Link>
  )
}

export function ListaDeSistemas({ tela }: ListaDeSistemasProps) {
  if (tela.sistemas.length === 0) {
    return (
      <div className="space-y-4">
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Nenhum sistema conectado ainda."
          descricao="Conecte um sistema para o Flow buscar os relatos dos usuários."
        />
        <BotaoConectarSistema />
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Quadro rotulo="Relatos hoje" valor={tela.quadros.relatosHoje} />
        <Quadro rotulo="Viraram demanda" valor={tela.quadros.viraramDemanda} />
        <Quadro rotulo="Orientados na hora" valor={tela.quadros.orientadosNaHora} />
      </div>
      <ul
        aria-label="Sistemas conectados"
        className="divide-y divide-border rounded-padrao border border-border bg-surface"
      >
        {tela.sistemas.map((s) => (
          <li
            key={s.id}
            className="grid grid-cols-2 items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_120px_120px_180px_auto]"
          >
            <div className="col-span-2 min-w-0 md:col-span-1">
              <p className="truncate text-[15px] font-[600] text-text-primary">{s.nome}</p>
              <p className="truncate text-[13px] text-text-secondary">
                {s.projeto} · {s.host}
              </p>
            </div>
            <Contagem n={s.relatosHoje} rotulo="relatos hoje" />
            <Contagem n={s.demandasHoje} rotulo="demandas" />
            <p
              className={cn(
                'flex items-center gap-2 text-[13px]',
                s.situacao.tom === 'erro' ? 'font-medium text-erro' : 'text-text-secondary',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 rounded-full',
                  s.situacao.tom === 'erro' ? 'bg-erro' : 'bg-neutro',
                )}
              />
              {s.situacao.texto}
            </p>
            <Link
              href={`/configuracoes/sistemas/${s.id}`}
              className="text-sm text-text-link hover:underline md:justify-self-end"
              aria-label={`Editar ${s.nome}`}
            >
              Editar
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-text-secondary">{RODAPE}</p>
    </div>
  )
}
