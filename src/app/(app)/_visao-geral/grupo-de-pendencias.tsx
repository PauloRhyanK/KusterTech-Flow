import Link from 'next/link'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import type { GrupoDePendencias as Grupo } from '@/modules/visao-geral/model'

export interface GrupoDePendenciasProps {
  grupo: Grupo
}

const CLASSE_DO_LINK = 'text-sm font-medium text-text-link hover:underline'

export function GrupoDePendencias({ grupo }: GrupoDePendenciasProps) {
  const id = `grupo-${grupo.tipo}`

  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 id={`${id}-titulo`} className="text-[15px] font-[600] leading-[1.4] text-text-primary">
          {grupo.titulo}
        </h3>
        {!grupo.falha && <span className="text-sm text-text-secondary">({grupo.total})</span>}
      </div>

      {grupo.falha ? (
        <EstadoVazio
          tipo="falha-integracao"
          titulo={`Não foi possível consultar ${grupo.titulo} agora.`}
          descricao="Recarregue a página; os outros grupos não foram afetados."
        />
      ) : (
        <>
          <ListaOperacional
            rotulo={grupo.titulo}
            linhas={grupo.itens.map((p) => ({
              id: p.id,
              nome: p.titulo,
              href: p.href,
              contexto: p.contexto,
              estado: <BadgeDeEstado tom={p.estado.tom}>{p.estado.texto}</BadgeDeEstado>,
              indicador: p.indicador ? (
                <span className="text-[13px] text-text-secondary">{p.indicador}</span>
              ) : undefined,
            }))}
            vazio={null}
          />
          {grupo.verTodas && (
            <Link href={grupo.verTodas.href} className={CLASSE_DO_LINK}>
              {grupo.verTodas.rotulo}
            </Link>
          )}
          {grupo.aviso && <p className="text-sm text-text-secondary">{grupo.aviso}</p>}
          {grupo.recolher && (
            <Link href={grupo.recolher.href} className={CLASSE_DO_LINK}>
              {grupo.recolher.rotulo}
            </Link>
          )}
        </>
      )}
    </section>
  )
}
