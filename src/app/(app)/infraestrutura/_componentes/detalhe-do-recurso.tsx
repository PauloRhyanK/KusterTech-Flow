import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { rotuloDoTipo } from '@/modules/infra/model'
import type { AlertaNaLista, RecursoDetalhado } from '@/modules/infra/queries'
import { ArquivamentoDoRecurso } from './arquivamento-do-recurso'
import { ListaDeAlertas } from './lista-de-alertas'
import { ProjetosDoRecurso } from './projetos-do-recurso'

export interface DetalheDoRecursoProps {
  recurso: RecursoDetalhado
  alertas?: readonly AlertaNaLista[]
}

const SECAO = 'space-y-3 rounded-padrao border border-border bg-surface p-4'

function DadoSemFonte({ rotulo }: { rotulo: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-text-secondary">{rotulo}</dt>
      <dd>
        <BadgeDeEstado tom="neutro">Sem dados</BadgeDeEstado>
      </dd>
    </div>
  )
}

// Sem fonte de métricas, logs ou saúde (decisão 1): tudo que depende de fonte aparece como "Sem dados".
export function DetalheDoRecurso({ recurso, alertas = [] }: DetalheDoRecursoProps) {
  const urlDeEdicao = `/infraestrutura/recursos/${recurso.id}/editar`
  const arquivado = recurso.arquivadoEm !== null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <section className={SECAO}>
          <h2 className="text-[15px] font-[600] text-text-primary">Problemas prioritários</h2>
          <ListaDeAlertas
            rotulo="Problemas prioritários do recurso"
            alertas={alertas}
            vazio={
              <EstadoVazio
                tipo="nenhum-registro"
                titulo="Nenhum alerta aberto para este recurso."
                descricao="Isso não confirma que o recurso está saudável."
              />
            }
          />
        </section>

        {recurso.tipo === 'SERVIDOR' && (
          <>
            <section className={SECAO}>
              <h2 className="text-[15px] font-[600] text-text-primary">Métricas</h2>
              <dl className="space-y-2">
                <DadoSemFonte rotulo="CPU" />
                <DadoSemFonte rotulo="Memória" />
                <DadoSemFonte rotulo="Disco" />
              </dl>
              <EstadoVazio
                tipo="nao-configurado"
                titulo="Nenhuma fonte de métricas configurada."
                descricao="CPU, memória e disco aparecem quando uma fonte de métricas for integrada. Consulte o Beszel para os valores atuais."
              />
            </section>
            <section className={SECAO}>
              <h2 className="text-[15px] font-[600] text-text-primary">Recursos hospedados</h2>
              {recurso.hospedados.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  Nenhum recurso hospedado neste servidor.
                </p>
              ) : (
                <ul aria-label="Recursos hospedados" className="divide-y divide-border">
                  {recurso.hospedados.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link
                        href={`/infraestrutura/recursos/${h.id}`}
                        className="text-text-link hover:underline"
                      >
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
          </>
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
                descricao="Nenhuma fonte segura de logs está configurada. Use o host Docker ou o GlitchTip para investigar."
              />
            </section>
          </>
        )}

        {(recurso.descricao || recurso.identificadorExterno) && (
          <section className={SECAO}>
            <h2 className="text-[15px] font-[600] text-text-primary">Informações</h2>
            {recurso.identificadorExterno && (
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
      </div>

      <aside className="min-w-0 space-y-6">
        {recurso.tipo !== 'SERVIDOR' && (
          <section className={SECAO}>
            <h2 className="text-[15px] font-[600] text-text-primary">Hospedado em</h2>
            {recurso.hospedadoEm ? (
              <Link
                href={`/infraestrutura/recursos/${recurso.hospedadoEm.id}`}
                className="text-sm text-text-link hover:underline"
              >
                {recurso.hospedadoEm.nome}
              </Link>
            ) : (
              <p className="text-sm text-text-secondary">Nenhum servidor informado.</p>
            )}
          </section>
        )}

        <section className={SECAO}>
          <h2 className="text-[15px] font-[600] text-text-primary">Ferramentas</h2>
          {recurso.ferramentas.length === 0 ? (
            <div className="space-y-2 text-sm">
              <p className="text-text-secondary">
                Nenhuma ferramenta configurada para este recurso.
              </p>
              <Link href={urlDeEdicao} className="text-text-link hover:underline">
                Editar recurso
              </Link>
            </div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {recurso.ferramentas.map((f) => (
                <li key={`${f.rotulo}-${f.href}`}>
                  <a
                    href={f.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-words text-text-link hover:underline"
                  >
                    {f.rotulo}
                  </a>
                </li>
              ))}
            </ul>
          )}
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
      </aside>
    </div>
  )
}
