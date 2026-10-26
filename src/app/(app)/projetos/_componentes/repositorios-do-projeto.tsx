'use client'

import { useActionState } from 'react'
import { BotaoDeConfirmacao } from '@/app/(app)/clientes/_componentes/botao-de-confirmacao'
import { Button } from '@/components/ui/button'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional, type LinhaOperacional } from '@/lib/ui/lista-operacional'
import { apresentarEstado } from '@/modules/github/model'
import type { RepositorioVinculado, SituacaoDaIntegracao } from '@/modules/github/service'
import {
  desvincularRepositorioAction,
  solicitarSincronizacaoAction,
  vincularRepositorioAction,
} from '../actions'

export interface RepositoriosDoProjetoProps {
  projetoId: string
  situacao: SituacaoDaIntegracao
  vinculados: readonly RepositorioVinculado[]
  disponiveis: readonly { id: string; nomeCompleto: string }[]
}

function Mensagens({ sucesso, erro }: { sucesso?: string; erro?: string }) {
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className={
          sucesso
            ? 'rounded-compacto border border-sucesso/30 bg-tonal-sucesso p-3 text-sm text-sucesso'
            : 'sr-only'
        }
      >
        {sucesso ?? ''}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        className={
          erro
            ? 'rounded-compacto border border-erro/30 bg-tonal-erro p-3 text-sm text-erro'
            : 'sr-only'
        }
      >
        {erro ?? ''}
      </div>
    </>
  )
}

export function RepositoriosDoProjeto({
  projetoId,
  situacao,
  vinculados,
  disponiveis,
}: RepositoriosDoProjetoProps) {
  const [estadoVincular, vincular, vinculando] = useActionState(vincularRepositorioAction, {})
  const [estadoSincronizar, sincronizar, sincronizando] = useActionState(
    solicitarSincronizacaoAction,
    {},
  )

  if (!situacao.configurada) {
    return (
      <EstadoVazio
        tipo="nao-configurado"
        titulo="A GitHub App da Central ainda não está configurada no servidor."
        descricao="Siga docs/github-app.md; os repositórios aparecem aqui depois da primeira sincronização."
      />
    )
  }

  const linhas: LinhaOperacional[] = vinculados.map((repo) => {
    const { texto, tom } = apresentarEstado(repo.estado)
    return {
      id: repo.id,
      nome: (
        <a
          href={repo.urlHtml}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-link hover:underline"
        >
          {repo.nomeCompleto}
        </a>
      ),
      contexto: (
        <>
          {repo.sincronizadoEm ? (
            <span>Última sincronização: {formatarDataHora(repo.sincronizadoEm)}</span>
          ) : (
            <span>Aguardando a primeira sincronização</span>
          )}
          {repo.ultimaFalhaMotivo && repo.estado === 'indisponivel' && (
            <span className="ml-3 text-erro">{repo.ultimaFalhaMotivo}</span>
          )}
        </>
      ),
      estado: <BadgeDeEstado tom={tom}>{texto}</BadgeDeEstado>,
      acoes: (
        <BotaoDeConfirmacao
          rotulo="Desvincular"
          rotuloDeConfirmacao="Confirmar desvinculação"
          action={desvincularRepositorioAction}
          camposOcultos={{ projetoId, repositorioId: repo.id }}
        />
      ),
    }
  })

  return (
    <div className="space-y-6 rounded-padrao border border-border bg-surface p-6">
      {situacao.fonte === 'fixtures' && (
        <BadgeDeEstado tom="neutro">Dados de teste (fixtures)</BadgeDeEstado>
      )}

      {situacao.falhaDoCatalogo && (
        <EstadoVazio
          tipo="falha-integracao"
          titulo={situacao.falhaDoCatalogo}
          descricao={
            situacao.catalogoSincronizadoEm
              ? `Última lista obtida em ${formatarDataHora(situacao.catalogoSincronizadoEm)}`
              : 'A lista de repositórios ainda não foi obtida.'
          }
        />
      )}

      <ListaOperacional
        rotulo="Repositórios vinculados"
        linhas={linhas}
        vazio={<p className="text-sm text-text-secondary">Nenhum repositório vinculado.</p>}
      />

      <div className="space-y-3">
        <Mensagens sucesso={estadoSincronizar.sucesso} erro={estadoSincronizar.erro} />
        {vinculados.length > 0 && (
          <form action={sincronizar}>
            <input type="hidden" name="projetoId" value={projetoId} />
            <Button
              type="submit"
              variant="outline"
              aria-busy={sincronizando}
              onClick={(e) => {
                if (sincronizando) {
                  e.preventDefault()
                }
              }}
            >
              Sincronizar agora
            </Button>
          </form>
        )}
      </div>

      <div className="space-y-3 pt-2">
        <Mensagens sucesso={estadoVincular.sucesso} erro={estadoVincular.erro} />
        {disponiveis.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nenhum repositório disponível na instalação da GitHub App.
          </p>
        ) : (
          <form action={vincular} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="projetoId" value={projetoId} />
            <div className="flex-1 space-y-1">
              <label
                htmlFor="repositorioId"
                className="block text-sm font-medium text-text-primary"
              >
                Repositório
              </label>
              <select
                id="repositorioId"
                name="repositorioId"
                required
                defaultValue=""
                className="w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <option value="" disabled>
                  Selecione um repositório
                </option>
                {disponiveis.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.nomeCompleto}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="submit"
              aria-busy={vinculando}
              onClick={(e) => {
                if (vinculando) {
                  e.preventDefault()
                }
              }}
            >
              Vincular
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
