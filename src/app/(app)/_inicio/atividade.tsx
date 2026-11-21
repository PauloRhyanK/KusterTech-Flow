import Link from 'next/link'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { LIMITE_NO_INICIO, type LinhaDeAtividade } from '@/modules/atividade/model'
import type { AtividadeGeral } from '@/modules/atividade/queries'
import { formatarIdade } from '@/modules/inicio/model'
import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import { FaixaDeOrigem, LegendaDaOrigem } from './faixa-de-origem'

export interface AtividadeProps {
  atividade: AtividadeGeral | 'falha'
  agora: Date
}

function Linha({ linha }: { linha: LinhaDeAtividade }) {
  return (
    <li className="grid items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_110px_80px_180px]">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Link
          href={`/projetos/${linha.projeto.id}/desenvolvimento`}
          className="truncate font-[550] text-text-primary hover:underline"
        >
          {linha.projeto.nome}
        </Link>
        {linha.desatualizado && <BadgeDeEstado tom="atencao">Desatualizado</BadgeDeEstado>}
      </div>
      <div className="flex items-center gap-4 sm:contents">
        <p>
          <span className="block text-[26px] font-[650] leading-none tracking-[-0.02em] text-text-primary">
            {linha.mergeadosHoje}
          </span>
          <span className="text-[11.5px] text-text-tertiary">mergeados hoje</span>
        </p>
        <p>
          <span className="block text-xl font-[650] leading-none tracking-[-0.02em] text-text-primary">
            {linha.abertos}
          </span>
          <span className="text-[11.5px] text-text-tertiary">abertos</span>
        </p>
        <div className="min-w-0 flex-1">
          <FaixaDeOrigem porOrigem={linha.porOrigem} />
        </div>
      </div>
    </li>
  )
}

export function Atividade({ atividade, agora }: AtividadeProps) {
  if (atividade === 'falha') {
    return (
      <section aria-labelledby="titulo-atividade">
        <TituloDeSecao id="titulo-atividade">Atividade</TituloDeSecao>
        <div className={`${CLASSE_DO_CARTAO} px-4 py-3 text-sm text-text-secondary`}>
          Não foi possível ler a atividade agora.
        </div>
      </section>
    )
  }

  const { linhas, totalHoje, dadosDe, desatualizado } = atividade
  const visiveis = linhas.slice(0, LIMITE_NO_INICIO)
  const demais = linhas.slice(LIMITE_NO_INICIO)
  const frase = `${totalHoje} ${totalHoje === 1 ? 'PR mergeado' : 'PRs mergeados'} nas últimas 24 h · ${
    dadosDe ? `dados de ${formatarIdade(dadosDe, agora)}` : 'sem sincronização'
  }`

  return (
    <section aria-labelledby="titulo-atividade">
      <TituloDeSecao
        id="titulo-atividade"
        complemento={
          <>
            <span className="text-[13px] text-text-tertiary">{frase}</span>
            {desatualizado && <BadgeDeEstado tom="atencao">Desatualizado</BadgeDeEstado>}
          </>
        }
      >
        Atividade
      </TituloDeSecao>

      {linhas.length === 0 ? (
        <div className={`${CLASSE_DO_CARTAO} px-4 py-3 text-sm text-text-secondary`}>
          Nenhuma atividade nas últimas 24 horas.
        </div>
      ) : (
        <>
          <div className={CLASSE_DO_CARTAO}>
            <ul>
              {visiveis.map((l) => (
                <Linha key={l.projeto.id} linha={l} />
              ))}
            </ul>
            {demais.length > 0 && (
              <details className="border-t border-border">
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-text-link">
                  ver todos ({linhas.length})
                </summary>
                <ul>
                  {demais.map((l) => (
                    <Linha key={l.projeto.id} linha={l} />
                  ))}
                </ul>
              </details>
            )}
          </div>
          <LegendaDaOrigem />
        </>
      )}
    </section>
  )
}
