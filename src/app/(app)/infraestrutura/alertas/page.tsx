import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import {
  contarAlertasNaoResolvidos,
  lerFiltrosDeAlertas,
  listarAlertas,
  listarFontesDeAlertas,
  listarRecursos,
  type FiltrosDeAlertas,
} from '@/modules/infra/queries'
import { apresentarSeveridade } from '@/modules/infra/model'
import { FontesDeAlertas } from '../_componentes/fontes-de-alertas'
import { FormularioAlerta } from '../_componentes/formulario-alerta'
import { ListaDeAlertas } from '../_componentes/lista-de-alertas'
import { NavegacaoDeInfraestrutura } from '../_componentes/navegacao-de-infraestrutura'

export const metadata: Metadata = {
  title: 'Alertas',
}

export interface PaginaAlertasProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const TRILHAS = [{ rotulo: 'Infraestrutura', href: '/infraestrutura' }, { rotulo: 'Alertas' }]
const ESTADOS: readonly { valor: FiltrosDeAlertas['estado']; rotulo: string }[] = [
  { valor: 'nao-resolvidos', rotulo: 'Não resolvidos' },
  { valor: 'ativos', rotulo: 'Ativos' },
  { valor: 'reconhecidos', rotulo: 'Reconhecidos' },
  { valor: 'resolvidos', rotulo: 'Resolvidos' },
  { valor: 'todos', rotulo: 'Todos' },
]
const SEVERIDADES = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'] as const
const CLASSE_CAMPO =
  'h-8 w-full max-w-full rounded-compacto border border-border bg-surface px-2 sm:w-auto sm:max-w-[16rem] text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

function FiltrosDeAlertasForm({ filtros }: { filtros: FiltrosDeAlertas }) {
  return (
    <form
      method="GET"
      action="/infraestrutura/alertas"
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="space-y-1">
        <label htmlFor="filtro-estado" className="block text-xs font-medium text-text-secondary">
          Situação
        </label>
        <select
          id="filtro-estado"
          name="estado"
          defaultValue={filtros.estado}
          className={CLASSE_CAMPO}
        >
          {ESTADOS.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.rotulo}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label
          htmlFor="filtro-severidade"
          className="block text-xs font-medium text-text-secondary"
        >
          Severidade
        </label>
        <select
          id="filtro-severidade"
          name="severidade"
          defaultValue={filtros.severidade ?? ''}
          className={CLASSE_CAMPO}
        >
          <option value="">Todas</option>
          {SEVERIDADES.map((s) => (
            <option key={s} value={s}>
              {apresentarSeveridade(s).texto}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
    </form>
  )
}

export default async function PaginaAlertas({ searchParams }: PaginaAlertasProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!autorizar(sessao.sujeito, 'infraestrutura.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={TRILHAS} titulo="Alertas" />
        <SemPermissao />
      </div>
    )
  }

  const filtros = lerFiltrosDeAlertas(await searchParams)
  const podeGerenciar = autorizar(sessao.sujeito, 'infraestrutura.gerenciar')
  const [{ alertas, total }, fontes, opcoes, naoResolvidos] = await Promise.all([
    listarAlertas(sessao.sujeito, filtros),
    listarFontesDeAlertas(sessao.sujeito),
    podeGerenciar
      ? listarRecursos(sessao.sujeito, { tipo: null, projetoId: null, situacao: 'todas' })
      : null,
    // A navegação mostra sempre o total de não resolvidos, independente do filtro.
    contarAlertasNaoResolvidos(sessao.sujeito),
  ])
  const comFiltros = filtros.estado !== 'nao-resolvidos' || filtros.severidade !== null

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={TRILHAS}
        titulo="Alertas"
        contexto="Inventário, recursos, alertas e diagnóstico"
      />
      <NavegacaoDeInfraestrutura ativo="alertas" alertasNaoResolvidos={naoResolvidos} />

      <ListaDeAlertas
        rotulo="Fila de alertas"
        alertas={alertas}
        filtros={<FiltrosDeAlertasForm filtros={filtros} />}
        vazio={
          comFiltros ? (
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhum alerta com estes filtros."
              descricao="Altere os filtros para ver outros alertas."
            />
          ) : (
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhum alerta não resolvido."
              descricao="Alertas chegam pelo webhook das fontes configuradas ou por registro manual. A ausência de alertas não confirma que os recursos estão saudáveis."
            />
          )
        }
      />
      {total > alertas.length && (
        <p className="text-sm text-text-secondary">
          Mostrando {alertas.length} de {total} alertas. Use os filtros para refinar.
        </p>
      )}

      {podeGerenciar && opcoes && (
        <section className="space-y-3 rounded-padrao border border-border bg-surface p-4">
          <h2 className="text-[15px] font-[600] text-text-primary">Registrar alerta</h2>
          <FormularioAlerta recursos={opcoes.recursos} projetos={opcoes.projetos} />
        </section>
      )}

      {podeGerenciar && <FontesDeAlertas fontes={fontes} />}
    </div>
  )
}
