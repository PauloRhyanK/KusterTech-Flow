import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional, type LinhaOperacional } from '@/lib/ui/lista-operacional'
import type { OrigemEvidencia, SituacaoEvidencia, TipoAmbiente } from '@/modules/ambientes/model'
import type {
  LeituraDeDeployments,
  SituacaoNoAmbiente,
  VersaoNaLista,
} from '@/modules/ambientes/service'
import { LeituraDoRepositorio } from './ambientes-do-projeto'
import { RegistroManualDeDeploy } from './registro-manual-de-deploy'

export interface VersoesDoProjetoProps {
  projetoId: string
  ambientesConfigurados: readonly TipoAmbiente[]
  repositorios: readonly { id: string; nomeCompleto: string }[]
  situacoes: readonly SituacaoNoAmbiente[]
  versoes: readonly VersaoNaLista[]
  total: number
  leituras: readonly LeituraDeDeployments[]
  repositorioId: string | null
  podeRegistrar: boolean
}

const LIMITE_DE_VERSOES = 50

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

const ROTULO_DA_SITUACAO: Record<SituacaoEvidencia, string> = {
  SUCESSO: 'sucesso',
  FALHA: 'falha',
  EM_ANDAMENTO: 'em andamento',
}

function BadgeDaOrigem({ origem, autor }: { origem: OrigemEvidencia; autor: string | null }) {
  if (origem === 'MANUAL') {
    return <BadgeDeEstado tom="neutro">{`Manual · ${autor ?? 'autor removido'}`}</BadgeDeEstado>
  }
  return (
    <BadgeDeEstado tom="informacao">
      {origem === 'ENDPOINT' ? 'Endpoint' : 'GitHub Deployments'}
    </BadgeDeEstado>
  )
}

function LinhaDoAmbiente({ situacao }: { situacao: SituacaoNoAmbiente }) {
  const { vigente, ultimoDeploy } = situacao
  return (
    <li className="space-y-2 px-4 py-3 text-[13px] leading-[1.45]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="w-12 font-semibold text-text-primary">{situacao.tipo}</span>
        <span className="text-text-secondary">{situacao.repositorio}</span>
        {vigente ? (
          <>
            <span className="font-mono text-text-primary">
              {vigente.rotulo} · {vigente.commitCurto}
            </span>
            <BadgeDaOrigem origem={vigente.origem} autor={vigente.autor} />
            <span className="text-text-secondary">em {formatarDataHora(vigente.ocorridaEm)}</span>
          </>
        ) : (
          <>
            <BadgeDeEstado tom="neutro">Sem evidência</BadgeDeEstado>
            <span className="text-text-secondary">
              A evidência de deploy ainda não foi recebida.
            </span>
          </>
        )}
      </div>
      {ultimoDeploy && (
        <div className="flex flex-wrap items-center gap-2">
          {ultimoDeploy.situacao === 'FALHA' ? (
            <>
              <BadgeDeEstado tom="erro">Falha no último deploy</BadgeDeEstado>
              <span className="text-text-secondary">
                Último deploy falhou em {formatarDataHora(ultimoDeploy.ocorridaEm)} (versão{' '}
                {ultimoDeploy.rotulo}).
              </span>
            </>
          ) : (
            <>
              <BadgeDeEstado tom="execucao">Deploy em andamento</BadgeDeEstado>
              <span className="text-text-secondary">
                Iniciado em {formatarDataHora(ultimoDeploy.ocorridaEm)} (versão{' '}
                {ultimoDeploy.rotulo}).
              </span>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function linhaDaVersao(versao: VersaoNaLista): LinhaOperacional {
  const { ultimaEvidencia: e } = versao
  return {
    id: versao.id,
    nome: <span className="font-mono">{versao.rotulo}</span>,
    contexto: (
      <>
        <span className="font-mono">{versao.commitCurto}</span> · {versao.repositorio}
      </>
    ),
    indicador: versao.vigenteEm.length > 0 && (
      <span className="flex gap-1.5">
        {versao.vigenteEm.map((tipo) => (
          <BadgeDeEstado key={tipo} tom="informacao">{`Em ${tipo}`}</BadgeDeEstado>
        ))}
      </span>
    ),
    estado: (
      <span className="flex flex-wrap items-center gap-2 text-text-secondary">
        <BadgeDaOrigem origem={e.origem} autor={e.autor} />
        <span>
          {e.tipo} · {ROTULO_DA_SITUACAO[e.situacao]} · {formatarDataHora(e.ocorridaEm)}
        </span>
      </span>
    ),
  }
}

function FiltroDeRepositorio({
  repositorios,
  repositorioId,
}: Pick<VersoesDoProjetoProps, 'repositorios' | 'repositorioId'>) {
  return (
    <form method="get" className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="space-y-1">
        <label htmlFor="filtro-repositorio" className="block text-sm font-medium text-text-primary">
          Repositório
        </label>
        <select
          id="filtro-repositorio"
          name="repositorio"
          defaultValue={repositorioId ?? ''}
          className={CLASSE_CAMPO}
        >
          <option value="">Todos</option>
          {repositorios.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.nomeCompleto}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit">Filtrar</Button>
    </form>
  )
}

export function VersoesDoProjeto({
  projetoId,
  ambientesConfigurados,
  repositorios,
  situacoes,
  versoes,
  total,
  leituras,
  repositorioId,
  podeRegistrar,
}: VersoesDoProjetoProps) {
  if (ambientesConfigurados.length === 0) {
    return (
      <EstadoVazio
        tipo="nao-configurado"
        titulo="Nenhum ambiente configurado."
        descricao="Configure DEV, QA e PROD para acompanhar versões."
        acao={
          <Link
            href={`/projetos/${projetoId}/configuracao#ambientes`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Configurar ambientes
          </Link>
        }
      />
    )
  }

  // Leitura que falhou ou ficou velha avisa acima das listas, sem esconder os dados.
  const avisos = leituras.filter(
    (l) => l.estado === 'indisponivel' || l.estado === 'sem-dados-recentes',
  )

  return (
    <div className="space-y-8">
      {avisos.length > 0 && (
        <div className="space-y-2">
          {avisos.map((leitura) => (
            <LeituraDoRepositorio key={leitura.repositorio} leitura={leitura} />
          ))}
        </div>
      )}

      <section aria-labelledby="versoes-em-cada-ambiente" className="space-y-3">
        <h2 id="versoes-em-cada-ambiente" className="text-lg font-semibold text-text-primary">
          Em cada ambiente
        </h2>
        {situacoes.length === 0 ? (
          <EstadoVazio
            tipo="nao-configurado"
            titulo="Nenhum repositório vinculado."
            descricao="Vincule repositórios para receber evidências de deploy."
          />
        ) : (
          <ul
            aria-label="Em cada ambiente"
            className="divide-y divide-border overflow-hidden rounded-padrao border border-border bg-surface"
          >
            {situacoes.map((situacao) => (
              <LinhaDoAmbiente
                key={`${situacao.tipo}-${situacao.repositorio}`}
                situacao={situacao}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="versoes-lista" className="space-y-3">
        <h2 id="versoes-lista" className="text-lg font-semibold text-text-primary">
          Versões
        </h2>
        <ListaOperacional
          rotulo="Versões"
          filtros={
            <FiltroDeRepositorio repositorios={repositorios} repositorioId={repositorioId} />
          }
          linhas={versoes.map(linhaDaVersao)}
          vazio={
            <EstadoVazio
              tipo="sem-evidencia"
              titulo="A evidência de deploy ainda não foi recebida."
              descricao="As versões aparecem quando o GitHub, o endpoint ou um registro manual informar um deploy."
            />
          }
        />
        {total > LIMITE_DE_VERSOES && (
          <p className="text-sm text-text-secondary">
            Mostrando {LIMITE_DE_VERSOES} de {total} versões. Filtre por repositório.
          </p>
        )}
      </section>

      {podeRegistrar && repositorios.length > 0 && (
        <section aria-labelledby="versoes-registro-manual" className="space-y-3">
          <h2 id="versoes-registro-manual" className="text-lg font-semibold text-text-primary">
            Registrar deploy manual
          </h2>
          <RegistroManualDeDeploy
            projetoId={projetoId}
            ambientes={ambientesConfigurados}
            repositorios={repositorios}
          />
        </section>
      )}
    </div>
  )
}
