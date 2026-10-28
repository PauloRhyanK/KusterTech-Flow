import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional, type LinhaOperacional } from '@/lib/ui/lista-operacional'
import type {
  FiltrosDaFila as Filtros,
  ItemDaFila,
  SituacaoDasFontes,
} from '@/modules/desenvolvimento/queries'
import { FiltrosDaFila } from './filtros-da-fila'

export interface FilaDeDesenvolvimentoProps {
  fontes: SituacaoDasFontes
  itens: readonly ItemDaFila[]
  total: number
  filtros: Filtros
  projetos: readonly { id: string; nome: string }[]
}

const LIMITE_DE_LINHAS = 100
const AVISO = 'p-4'

function dataOuNada(data: Date | null, quando: (d: string) => string, semData: string): string {
  return data ? quando(formatarDataHora(data)) : semData
}

function Avisos({ fontes }: { fontes: SituacaoDasFontes }) {
  const falhas = fontes.repositorios.filter((r) => r.situacao === 'falha')
  const desatualizados = fontes.repositorios.filter((r) => r.situacao === 'desatualizado')
  const leituras = fontes.repositorios.flatMap((r) => (r.lidoEm ? [r.lidoEm] : []))
  const maisAntiga = leituras.length
    ? new Date(Math.min(...leituras.map((d) => d.getTime())))
    : null

  return (
    <>
      {fontes.github === 'indisponivel' && (
        <EstadoVazio
          className={AVISO}
          tipo="falha-integracao"
          titulo="Integração com o GitHub indisponível."
          descricao={dataOuNada(
            fontes.githubSincronizadoEm,
            (d) => `Mostrando os últimos dados obtidos em ${d}.`,
            'Nenhum dado do GitHub foi obtido ainda.',
          )}
        />
      )}
      {fontes.github === 'sem-dados-recentes' && (
        <EstadoVazio
          className={AVISO}
          tipo="dados-desatualizados"
          titulo="Os dados do GitHub podem estar desatualizados."
          descricao={dataOuNada(
            fontes.githubSincronizadoEm,
            (d) => `Última sincronização: ${d}.`,
            'Nenhuma sincronização concluída ainda.',
          )}
        />
      )}
      {falhas.length > 0 && (
        <EstadoVazio
          className={AVISO}
          tipo="falha-integracao"
          titulo={`Não foi possível ler os dados do Warren em ${falhas.length} repositório(s).`}
          descricao={dataOuNada(
            maisAntiga,
            (d) => `Mostrando as execuções lidas em ${d}.`,
            'Nenhuma leitura do Warren foi concluída ainda.',
          )}
        />
      )}
      {desatualizados.length > 0 && (
        <EstadoVazio
          className={AVISO}
          tipo="dados-desatualizados"
          titulo="Os dados do Warren podem estar desatualizados."
          descricao={dataOuNada(
            maisAntiga,
            (d) => `Última leitura: ${d}.`,
            'Nenhuma leitura concluída ainda.',
          )}
        />
      )}
    </>
  )
}

function linhaDoItem(item: ItemDaFila): LinhaOperacional {
  const contexto = [
    item.referencia,
    `${item.projeto.nome} · ${item.repositorio}`,
    item.abertaPeloWarren ? 'Aberta pelo Warren' : null,
  ]
    .filter((parte) => parte !== null)
    .join(' · ')

  return {
    id: `${item.tipo}-${item.id}`,
    nome: item.titulo,
    href: item.href,
    contexto,
    indicador: item.motivo ? (
      <span className="text-[13px] text-text-secondary">{item.motivo}</span>
    ) : undefined,
    estado: (
      <span className="flex flex-wrap items-center gap-2">
        <BadgeDeEstado tom={item.estado.tom}>{item.estado.texto}</BadgeDeEstado>
        {item.checks && <BadgeDeEstado tom={item.checks.tom}>{item.checks.texto}</BadgeDeEstado>}
      </span>
    ),
  }
}

export function FilaDeDesenvolvimento({
  fontes,
  itens,
  total,
  filtros,
  projetos,
}: FilaDeDesenvolvimentoProps) {
  if (!fontes.githubConfigurado) {
    return (
      <section aria-label="Fila de desenvolvimento">
        <EstadoVazio
          tipo="nao-configurado"
          titulo="O GitHub ainda não está configurado na Central."
          descricao="Issues, PRs e execuções aparecem depois que a GitHub App estiver configurada e houver repositórios vinculados."
        />
      </section>
    )
  }
  if (fontes.repositorios.length === 0) {
    return (
      <section aria-label="Fila de desenvolvimento">
        <EstadoVazio
          tipo="nao-configurado"
          titulo="Nenhum repositório vinculado a projetos."
          descricao="Vincule repositórios na configuração de cada projeto."
          acao={
            <Link href="/projetos" className={buttonVariants({ variant: 'secondary' })}>
              Ver projetos
            </Link>
          }
        />
      </section>
    )
  }

  const comFiltros =
    filtros.projetoId !== null || filtros.situacao !== 'abertos' || filtros.origem !== 'todas'

  return (
    <section aria-label="Fila de desenvolvimento" className="space-y-4">
      <Avisos fontes={fontes} />
      <ListaOperacional
        rotulo="Fila de desenvolvimento"
        linhas={itens.map(linhaDoItem)}
        filtros={<FiltrosDaFila filtros={filtros} projetos={projetos} />}
        vazio={
          comFiltros ? (
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhum item com estes filtros."
              descricao="Altere o projeto, a situação ou a origem."
            />
          ) : (
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhuma issue, PR ou execução em aberto."
              descricao="Use a situação Todos para ver os itens encerrados."
            />
          )
        }
      />
      {total > LIMITE_DE_LINHAS && (
        <p className="text-sm text-text-secondary">
          Mostrando {LIMITE_DE_LINHAS} de {total} itens. Refine os filtros.
        </p>
      )}
    </section>
  )
}
