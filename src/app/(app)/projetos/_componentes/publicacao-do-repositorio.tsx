import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import type { OrigemEvidencia } from '@/modules/ambientes/model'
import type { SituacaoDaIntegracao } from '@/modules/github/service'
import type { PublicacaoDoRepositorio } from '@/modules/publicacao/queries'
import { AvisoDeIntegracao } from './aviso-de-integracao'
import { ComposicaoDaPublicacao } from './composicao-de-publicacao'
import { EstadosDaPublicacao } from './estados-de-publicacao'
import { FormularioDeAutorizacao } from './formulario-de-autorizacao'

export interface PublicacaoDoRepositorioProps {
  projeto: { id: string; nome: string }
  publicacao: PublicacaoDoRepositorio
  podeAutorizar: boolean
}

const ORIGEM: Record<OrigemEvidencia, string> = {
  GITHUB_DEPLOYMENT: 'GitHub Deployments',
  ENDPOINT: 'Endpoint de evidência',
  MANUAL: 'Confirmação manual',
}

function situacaoDaIntegracao(p: PublicacaoDoRepositorio): SituacaoDaIntegracao {
  return {
    configurada: true,
    fonte: null,
    catalogoSincronizadoEm: p.repositorio.sincronizadoEm,
    falhaDoCatalogo: null,
    estadoDoProjeto: p.repositorio.estado,
  }
}

export function PublicacaoDoRepositorioView({
  projeto,
  publicacao,
  podeAutorizar,
}: PublicacaoDoRepositorioProps) {
  const { repositorio, emProd, candidata } = publicacao
  const tituloId = `publicacao-${repositorio.id}`
  const conectada = repositorio.estado === 'conectada'

  return (
    <section aria-labelledby={tituloId} className="space-y-4">
      <h2 id={tituloId} className="text-lg font-semibold text-text-primary">
        {repositorio.nomeCompleto}
      </h2>
      {!conectada && (
        <AvisoDeIntegracao
          situacao={situacaoDaIntegracao(publicacao)}
          sincronizadoEm={repositorio.sincronizadoEm}
          hrefConfiguracao={null}
        />
      )}

      <>
        <div className="space-y-3 rounded-padrao border border-border bg-surface p-4">
          <h3 className="text-base font-[600] text-text-primary">Em PROD</h3>
          {emProd ? (
            <>
              <p className="text-sm text-text-secondary">
                {`${emProd.commitCurto} · ${emProd.rotulo} · ${ORIGEM[emProd.origem]} · ${formatarDataHora(emProd.ocorridaEm)}`}
              </p>
              <EstadosDaPublicacao estados={emProd.estados} />
            </>
          ) : (
            <EstadoVazio
              tipo="sem-evidencia"
              titulo="Sem evidência de deploy em PROD."
              descricao="A evidência chega pelo GitHub Deployments, pelo endpoint ou por confirmação manual."
            />
          )}
        </div>

        <div className="space-y-3 rounded-padrao border border-border bg-surface p-4">
          <h3 className="text-base font-[600] text-text-primary">Candidata à publicação</h3>
          {!candidata ? (
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhuma versão em QA aguardando publicação."
              descricao="Quando uma nova versão chegar ao QA, ela aparece aqui."
            />
          ) : (
            <>
              <p className="text-sm text-text-secondary">
                {`Versão ${candidata.versao.rotulo} (${candidata.versao.commitCurto})`}
              </p>
              {!candidata.composicao ? (
                <EstadoVazio
                  tipo="sem-evidencia"
                  titulo="A composição desta versão ainda não foi calculada."
                  descricao="O worker calcula no próximo ciclo."
                />
              ) : (
                <>
                  {candidata.composicao.desatualizada && (
                    <EstadoVazio
                      tipo="dados-desatualizados"
                      titulo="A composição pode estar desatualizada."
                      descricao="A autorização fica bloqueada até o próximo cálculo."
                    />
                  )}
                  <ComposicaoDaPublicacao composicao={candidata.composicao} />
                </>
              )}
              <EstadosDaPublicacao estados={candidata.estados} />
              {candidata.autorizacao && (
                <p className="text-sm text-text-secondary">
                  {`Autorizada por ${candidata.autorizacao.autorNome} em ${formatarDataHora(candidata.autorizacao.criadaEm)}.`}
                </p>
              )}
              {candidata.composicao && (
                <FormularioDeAutorizacao
                  projetoId={projeto.id}
                  projetoNome={projeto.nome}
                  repositorio={{ id: repositorio.id, nomeCompleto: repositorio.nomeCompleto }}
                  versao={{ id: candidata.versao.id, rotulo: candidata.versao.rotulo }}
                  composicao={candidata.composicao}
                  podeAutorizar={podeAutorizar}
                  autorizada={candidata.autorizacao !== null}
                />
              )}
            </>
          )}
        </div>

        {publicacao.autorizacoes.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-base font-[600] text-text-primary">Autorizações recentes</h3>
            <ul className="space-y-1 text-sm text-text-secondary">
              {publicacao.autorizacoes.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <span>{`${a.rotulo} · ${a.autorNome} · ${formatarDataHora(a.criadaEm)}`}</span>
                  {a.revogadaEm && (
                    <BadgeDeEstado tom="atencao">Revogada: a composição mudou</BadgeDeEstado>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    </section>
  )
}
