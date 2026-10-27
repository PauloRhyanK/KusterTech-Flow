'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { Button, buttonVariants } from '@/components/ui/button'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import type { AmbienteNaTela, LeituraDeDeployments } from '@/modules/ambientes/service'
import {
  gerarTokenDeEvidenciaAction,
  revogarTokenDeEvidenciaAction,
  salvarAmbienteAction,
} from '../ambientes-actions'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface AmbientesDoProjetoProps {
  projetoId: string
  ambientes: readonly AmbienteNaTela[]
  leituras: readonly LeituraDeDeployments[]
  githubConfigurado: boolean
  repositoriosVinculados: number
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function LeituraDoRepositorio({ leitura }: { leitura: LeituraDeDeployments }) {
  const { repositorio, estado, lidoEm, falhaMotivo } = leitura
  if (estado === 'indisponivel') {
    return (
      <EstadoVazio
        tipo="falha-integracao"
        titulo={`Não foi possível ler os deployments de ${repositorio}.`}
        descricao={falhaMotivo ?? 'Tente novamente em instantes.'}
      />
    )
  }
  if (lidoEm === null) {
    return (
      <p className="text-sm text-text-secondary">
        Deployments de {repositorio}: aguardando a primeira leitura.
      </p>
    )
  }
  if (estado === 'sem-dados-recentes') {
    return (
      <EstadoVazio
        tipo="dados-desatualizados"
        titulo="Os deployments do GitHub podem estar desatualizados."
        descricao={`Última leitura em ${formatarDataHora(lidoEm)}.`}
      />
    )
  }
  return (
    <p className="text-sm text-text-secondary">
      Deployments de {repositorio}: última leitura em {formatarDataHora(lidoEm)}.
    </p>
  )
}

function FonteDosDeployments({
  ambientes,
  leituras,
  githubConfigurado,
  repositoriosVinculados,
}: Omit<AmbientesDoProjetoProps, 'projetoId'>) {
  if (!githubConfigurado) {
    return (
      <p className="text-sm text-text-secondary">
        A GitHub App não está configurada; só o endpoint e o registro manual trazem evidências.
      </p>
    )
  }
  if (repositoriosVinculados === 0) {
    return (
      <EstadoVazio
        tipo="nao-configurado"
        titulo="Nenhum repositório vinculado."
        descricao="Vincule repositórios para receber evidências de deploy."
      />
    )
  }
  if (!ambientes.some((a) => a.nomeNoGitHub !== null)) {
    return (
      <p className="text-sm text-text-secondary">
        Nenhum ambiente usa GitHub Deployments; as evidências vêm do endpoint ou de registro manual.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {leituras.map((leitura) => (
        <LeituraDoRepositorio key={leitura.repositorio} leitura={leitura} />
      ))}
    </div>
  )
}

function TokenDeEvidencia({
  projetoId,
  ambiente,
}: {
  projetoId: string
  ambiente: AmbienteNaTela
}) {
  const [estadoGerar, gerar, gerando] = useActionState(gerarTokenDeEvidenciaAction, {})
  const [estadoRevogar, revogar, revogando] = useActionState(revogarTokenDeEvidenciaAction, {})
  const campos = { projetoId, tipo: ambiente.tipo }
  // Depois de revogado (tokenCriadoEm nulo) o valor mostrado deixa de valer e some.
  const tokenNovo = ambiente.tokenCriadoEm === null ? undefined : estadoGerar.token

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-text-primary">Token de evidência</h4>
      <MensagensDeEstado estado={{ erro: estadoGerar.erro ?? estadoRevogar.erro }} />
      <div role="status" aria-live="polite" className={tokenNovo ? 'space-y-2' : 'sr-only'}>
        {tokenNovo && (
          <>
            <code
              data-testid="token-de-evidencia"
              className="block break-all rounded-compacto border border-border bg-surface-subtle p-3 text-sm text-text-primary"
            >
              {tokenNovo}
            </code>
            <p className="text-sm font-medium text-text-primary">
              Copie agora: este token não será mostrado de novo.
            </p>
            <p className="text-sm text-text-secondary">
              Use no pipeline: Authorization: Bearer &lt;token&gt; em POST /api/evidencias/deploy.
            </p>
          </>
        )}
      </div>
      {estadoRevogar.sucesso && (
        <p className="text-sm text-text-secondary">{estadoRevogar.sucesso}</p>
      )}

      {!ambiente.configurado ? (
        <p className="text-sm text-text-secondary">
          Salve o ambiente para gerar um token de evidência.
        </p>
      ) : ambiente.tokenCriadoEm === null ? (
        <div className="space-y-2">
          <p className="text-sm text-text-secondary">Nenhum token de evidência.</p>
          <form action={gerar}>
            {Object.entries(campos).map(([nome, valor]) => (
              <input key={nome} type="hidden" name={nome} value={valor} />
            ))}
            <Button
              type="submit"
              variant="outline"
              aria-busy={gerando}
              onClick={(e) => {
                if (gerando) {
                  e.preventDefault()
                }
              }}
            >
              Gerar token
            </Button>
          </form>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-text-secondary">
            Token criado em {formatarDataHora(ambiente.tokenCriadoEm)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <BotaoDeConfirmacao
              rotulo="Gerar novo token"
              rotuloDeConfirmacao="Confirmar: o token atual deixa de valer"
              action={gerar}
              camposOcultos={campos}
              pendente={gerando}
            />
            <BotaoDeConfirmacao
              rotulo="Revogar token"
              rotuloDeConfirmacao="Confirmar revogação"
              action={revogar}
              camposOcultos={campos}
              pendente={revogando}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function SecaoDoAmbiente({ projetoId, ambiente }: { projetoId: string; ambiente: AmbienteNaTela }) {
  const [estado, salvar, salvando] = useActionState(salvarAmbienteAction, {})
  const titulo = `ambiente-${ambiente.tipo}`
  const idNome = `${titulo}-nome`
  const idUrl = `${titulo}-url`
  const idAjuda = `${titulo}-ajuda`

  return (
    <section
      aria-labelledby={titulo}
      className="space-y-4 rounded-padrao border border-border bg-surface p-6"
    >
      <div className="flex items-center gap-3">
        <h3 id={titulo} className="text-base font-semibold text-text-primary">
          {ambiente.tipo}
        </h3>
        {ambiente.configurado ? (
          <BadgeDeEstado tom="informacao">Configurado</BadgeDeEstado>
        ) : (
          <BadgeDeEstado tom="neutro">Não configurado</BadgeDeEstado>
        )}
      </div>

      <form action={salvar} className="max-w-md space-y-4">
        <MensagensDeEstado estado={estado} />
        <input type="hidden" name="projetoId" value={projetoId} />
        <input type="hidden" name="tipo" value={ambiente.tipo} />
        <div className="space-y-1">
          <label htmlFor={idNome} className="block text-sm font-medium text-text-primary">
            Nome do environment no GitHub
          </label>
          <input
            id={idNome}
            name="nomeNoGitHub"
            type="text"
            maxLength={100}
            defaultValue={ambiente.nomeNoGitHub ?? ''}
            aria-describedby={idAjuda}
            className={CLASSE_CAMPO}
          />
          <p id={idAjuda} className="text-xs text-text-secondary">
            O mesmo nome usado em environment: no workflow do GitHub Actions. Deixe vazio se este
            ambiente não usa GitHub Deployments.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor={idUrl} className="block text-sm font-medium text-text-primary">
            URL do ambiente
          </label>
          <input
            id={idUrl}
            name="url"
            type="text"
            inputMode="url"
            maxLength={300}
            defaultValue={ambiente.url ?? ''}
            className={CLASSE_CAMPO}
          />
        </div>
        <Button
          type="submit"
          aria-busy={salvando}
          onClick={(e) => {
            if (salvando) {
              e.preventDefault()
            }
          }}
        >
          Salvar ambiente
        </Button>
      </form>

      <TokenDeEvidencia projetoId={projetoId} ambiente={ambiente} />
    </section>
  )
}

export function AmbientesDoProjeto({
  projetoId,
  ambientes,
  leituras,
  githubConfigurado,
  repositoriosVinculados,
}: AmbientesDoProjetoProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-text-primary">Ambientes</h2>
      <p className="text-sm text-text-secondary">
        DEV, QA e PROD são compartilhados por todos os clientes do projeto. A evidência de deploy
        vem do GitHub Deployments, do endpoint com token ou de um registro manual.
      </p>

      <FonteDosDeployments
        ambientes={ambientes}
        leituras={leituras}
        githubConfigurado={githubConfigurado}
        repositoriosVinculados={repositoriosVinculados}
      />

      <div className="space-y-4">
        {ambientes.map((ambiente) => (
          <SecaoDoAmbiente key={ambiente.tipo} projetoId={projetoId} ambiente={ambiente} />
        ))}
      </div>

      <Link
        href={`/projetos/${projetoId}/versoes`}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        Ver versões do projeto
      </Link>
    </div>
  )
}
