import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { rotuloDoTipo } from '@/modules/infra/model'
import type { RecursoDetalhado } from '@/modules/infra/queries'
import { ArquivamentoDoRecurso } from './arquivamento-do-recurso'
import { PainelDaMaquinaLocal, type PainelDaMaquinaLocalProps } from './painel-da-maquina-local'
import { PainelDoBeszel, type PainelDoBeszelProps } from './painel-do-beszel'
import { ProjetosDoRecurso } from './projetos-do-recurso'

export interface DetalheDoRecursoProps {
  recurso: RecursoDetalhado
  // Só na máquina em que o Flow roda: o painel vem antes e o cadastro vai para a lateral dele.
  painelLocal?: Omit<PainelDaMaquinaLocalProps, 'principal' | 'lateral'>
  // Máquina ligada ao Beszel (D82): o mesmo arranjo, com as métricas do Beszel.
  painelBeszel?: Omit<PainelDoBeszelProps, 'principal' | 'lateral'>
}

const SECAO = 'space-y-3 rounded-padrao border border-border bg-surface p-4'

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function formatarCusto(custo: string | null): string | null {
  return custo === null ? null : REAIS.format(Number(custo))
}

function ParDoCadastro({
  rotulo,
  valor,
  quebra = false,
}: {
  rotulo: string
  valor: string | null
  quebra?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="text-text-secondary">{rotulo}</dt>
      <dd className={`text-right text-text-primary ${quebra ? 'break-all' : 'break-words'}`}>
        {valor ?? '—'}
      </dd>
    </div>
  )
}

// Máquina comum não tem quadro de métrica (spec §6.5): só a máquina local tem fonte, o painel.
// Contêiner sem fonte de logs ou saúde (decisão 1) aparece como "Sem dados".
export function DetalheDoRecurso({ recurso, painelLocal, painelBeszel }: DetalheDoRecursoProps) {
  const urlDeEdicao = `/maquinas/${recurso.id}/editar`
  const arquivado = recurso.arquivadoEm !== null
  // Na máquina local o painel já diz o que roda nela: seções vazias ficam de fora.
  const local = painelLocal !== undefined || painelBeszel !== undefined
  const mostrarHospedados = recurso.tipo === 'SERVIDOR' && (!local || recurso.hospedados.length > 0)
  const mostrarIdentificador = !local && recurso.identificadorExterno !== null

  const principal = (
    <>
      {mostrarHospedados && (
        <section className={SECAO}>
          <h2 className="text-[15px] font-[600] text-text-primary">Recursos hospedados</h2>
          {recurso.hospedados.length === 0 ? (
            <p className="text-sm text-text-secondary">Nenhum recurso hospedado neste servidor.</p>
          ) : (
            <ul aria-label="Recursos hospedados" className="divide-y divide-border">
              {recurso.hospedados.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/maquinas/${h.id}`} className="text-text-link hover:underline">
                    {h.nome}
                  </Link>
                  <span className="flex items-center gap-1.5 text-text-secondary">
                    {rotuloDoTipo(h.tipo)}
                    {h.arquivado && <BadgeDeEstado tom="neutro">Arquivado</BadgeDeEstado>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {recurso.tipo === 'CONTAINER' && (
        <>
          <section className={SECAO}>
            <h2 className="text-[15px] font-[600] text-text-primary">Estado do container</h2>
            <BadgeDeEstado tom="neutro">Sem dados</BadgeDeEstado>
          </section>
          <section className={SECAO}>
            <h2 className="text-[15px] font-[600] text-text-primary">Prévia de logs</h2>
            <EstadoVazio
              tipo="nao-configurado"
              titulo="Prévia de logs indisponível."
              descricao="Nenhuma fonte segura de logs está configurada."
            />
          </section>
        </>
      )}

      {(recurso.descricao || mostrarIdentificador) && (
        <section className={SECAO}>
          <h2 className="text-[15px] font-[600] text-text-primary">Informações</h2>
          {mostrarIdentificador && (
            <p className="break-words text-sm text-text-secondary">
              Identificador externo:{' '}
              <span className="text-text-primary">{recurso.identificadorExterno}</span>
            </p>
          )}
          {recurso.descricao && (
            <p className="whitespace-pre-wrap break-words text-sm text-text-primary">
              {recurso.descricao}
            </p>
          )}
        </section>
      )}
    </>
  )

  const lateral = (
    <>
      {recurso.tipo !== 'SERVIDOR' && (
        <section className={SECAO}>
          <h2 className="text-[15px] font-[600] text-text-primary">Hospedado em</h2>
          {recurso.hospedadoEm ? (
            <Link
              href={`/maquinas/${recurso.hospedadoEm.id}`}
              className="text-sm text-text-link hover:underline"
            >
              {recurso.hospedadoEm.nome}
            </Link>
          ) : (
            <p className="text-sm text-text-secondary">Nenhum servidor informado.</p>
          )}
        </section>
      )}

      <section aria-labelledby="cadastro-da-maquina" className={SECAO}>
        <h2 id="cadastro-da-maquina" className="text-[15px] font-[600] text-text-primary">
          Cadastro
        </h2>
        <dl className="divide-y divide-border text-sm">
          <ParDoCadastro rotulo="Provedor" valor={recurso.provedor} />
          <ParDoCadastro rotulo="Endereço" valor={recurso.endereco} quebra />
          <ParDoCadastro rotulo="Especificação" valor={recurso.especificacao} />
          <ParDoCadastro rotulo="Custo mensal" valor={formatarCusto(recurso.custoMensal)} />
        </dl>
      </section>

      <ProjetosDoRecurso
        recursoId={recurso.id}
        recursoArquivado={arquivado}
        projetos={recurso.projetos}
        disponiveis={recurso.projetosDisponiveis}
      />

      <section className={SECAO}>
        <div className="flex flex-wrap items-start gap-2">
          <Link href={urlDeEdicao} className={buttonVariants({ variant: 'outline' })}>
            Editar recurso
          </Link>
          <ArquivamentoDoRecurso recursoId={recurso.id} arquivado={arquivado} />
        </div>
      </section>
    </>
  )

  if (painelLocal) {
    return <PainelDaMaquinaLocal {...painelLocal} principal={principal} lateral={lateral} />
  }

  if (painelBeszel) {
    return <PainelDoBeszel {...painelBeszel} principal={principal} lateral={lateral} />
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">{principal}</div>
      <aside className="min-w-0 space-y-6">{lateral}</aside>
    </div>
  )
}
