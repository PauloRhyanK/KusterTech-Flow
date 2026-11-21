import { FaixaDeOrigem } from '@/app/(app)/_inicio/faixa-de-origem'
import { BadgeDeEstado, type TomDeEstado } from '@/lib/ui/badge-de-estado'
import { CLASSE_DO_CARTAO, TituloDeSecao } from '@/lib/ui/titulo-de-secao'
import { QuadroDeMetrica } from '@/lib/ui/quadro-de-metrica'
import { ROTULO_DA_ORIGEM, tempoDesde, type Origem } from '@/modules/atividade/model'
import type { AtividadeDoProjeto as Dados } from '@/modules/atividade/queries'
import { formatarIdade } from '@/modules/inicio/model'

const TOM_DA_ORIGEM: Record<Origem, TomDeEstado> = {
  sessao: 'informacao',
  fabrica: 'execucao',
  outro: 'neutro',
}

export function AtividadeDoProjeto({ atividade, agora }: { atividade: Dados; agora: Date }) {
  return (
    <section aria-label="Atividade do projeto" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`${CLASSE_DO_CARTAO} p-4`}>
          <QuadroDeMetrica rotulo="Mergeados hoje" valor={String(atividade.mergeadosHoje)} />
        </div>
        <div className={`${CLASSE_DO_CARTAO} p-4`}>
          <QuadroDeMetrica rotulo="Abertos" valor={String(atividade.abertos)} />
        </div>
        <div className={`${CLASSE_DO_CARTAO} space-y-3 p-4`}>
          <p className="text-[13px] text-text-secondary">Origem</p>
          <FaixaDeOrigem porOrigem={atividade.porOrigem} />
        </div>
      </div>

      <div>
        <TituloDeSecao
          id="titulo-ultimos-merges"
          complemento={
            <>
              <span className="text-[13px] text-text-tertiary">
                {atividade.dadosDe
                  ? `dados de ${formatarIdade(atividade.dadosDe, agora)}`
                  : 'sem sincronização'}
              </span>
              {atividade.desatualizado && (
                <BadgeDeEstado tom="atencao">Desatualizado</BadgeDeEstado>
              )}
            </>
          }
        >
          Últimos merges
        </TituloDeSecao>
        {atividade.ultimosMerges.length === 0 ? (
          <div className={`${CLASSE_DO_CARTAO} px-4 py-3 text-sm text-text-secondary`}>
            Nenhum PR mergeado neste projeto.
          </div>
        ) : (
          <ul aria-labelledby="titulo-ultimos-merges" className={CLASSE_DO_CARTAO}>
            {atividade.ultimosMerges.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 border-t border-border px-4 py-2.5 text-[13px] first:border-t-0"
              >
                <span className="min-w-0 flex-1 truncate font-[550] text-text-primary">
                  {m.titulo}
                </span>
                <BadgeDeEstado tom={TOM_DA_ORIGEM[m.origem]}>
                  {ROTULO_DA_ORIGEM[m.origem]}
                </BadgeDeEstado>
                <span className="w-16 text-right text-xs text-text-tertiary">
                  {tempoDesde(m.mergeadoEm, agora)}
                </span>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Abrir PR #${m.numero} no GitHub`}
                  className="text-text-link hover:underline"
                >
                  ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
