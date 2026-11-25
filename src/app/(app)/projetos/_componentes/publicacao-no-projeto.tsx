'use client'

import { useActionState } from 'react'
import {
  publicarAgoraAction,
  salvarConfiguracaoDePublicacaoAction,
  salvarUrlDaVersaoAction,
} from '@/app/(app)/projetos/[p]/(detalhe)/configuracao/publicacao-actions'
import { Button } from '@/components/ui/button'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { HORA_DO_LOTE_PADRAO } from '@/modules/fila-de-publicacao/model'
import type { PublicacaoDoProjeto } from '@/modules/fila-de-publicacao/queries'
import { MensagensDeEstado } from './mensagens-de-estado'

type RepositorioDaPublicacao = PublicacaoDoProjeto['repositorios'][number]

export interface PublicacaoNoProjetoProps {
  projetoId: string
  repositorios: readonly RepositorioDaPublicacao[]
  /** `configuracoes.gerenciar`: só quem configura o Flow define o endereço que ele lê. */
  podeConfigurarVersao?: boolean
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'
const CLASSE_ROTULO = 'block text-sm font-medium text-text-primary'
const CLASSE_AJUDA = 'text-xs text-text-secondary'
const CLASSE_MARCA = 'size-4 accent-action-primary'

function PublicarAgora({ projetoId, repositorioId }: { projetoId: string; repositorioId: string }) {
  const [estado, publicar, pendente] = useActionState(publicarAgoraAction, {})
  return (
    <div className="space-y-2">
      <form action={publicar}>
        <input type="hidden" name="projetoId" value={projetoId} />
        <input type="hidden" name="repositorioId" value={repositorioId} />
        <Button type="submit" variant="outline" aria-busy={pendente} disabled={pendente}>
          Publicar agora
        </Button>
      </form>
      <p className={CLASSE_AJUDA}>Pede a publicação da ponta de main, na frente do lote.</p>
      <MensagensDeEstado estado={estado} />
    </div>
  )
}

function VersaoNoAr({
  projetoId,
  repositorioId,
  urlDaVersao,
}: {
  projetoId: string
  repositorioId: string
  urlDaVersao: string | null
}) {
  const [estado, salvar, salvando] = useActionState(salvarUrlDaVersaoAction, {})
  const id = (campo: string) => `publicacao-${repositorioId}-${campo}`
  return (
    <form action={salvar} className="max-w-md space-y-3 border-t border-border pt-4">
      <MensagensDeEstado estado={estado} />
      <input type="hidden" name="projetoId" value={projetoId} />
      <input type="hidden" name="repositorioId" value={repositorioId} />
      <div className="space-y-1">
        <label htmlFor={id('versao')} className={CLASSE_ROTULO}>
          Versão no ar
        </label>
        <input
          id={id('versao')}
          name="urlDaVersao"
          type="url"
          maxLength={500}
          placeholder="https://site.com.br/versao.json"
          defaultValue={urlDaVersao ?? ''}
          aria-describedby={id('versao-ajuda')}
          className={CLASSE_CAMPO}
        />
        <p id={id('versao-ajuda')} className={CLASSE_AJUDA}>
          Endereço que o site publica com {'{"commit": "<sha>"}'}. Depois de cada deploy, o Flow só
          marca como publicado quando o site mostra o commit. Em branco, não confere.
        </p>
      </div>
      <Button type="submit" variant="outline" aria-busy={salvando} disabled={salvando}>
        Salvar a versão no ar
      </Button>
    </form>
  )
}

function ConfiguracaoDoRepositorio({
  projetoId,
  repositorio,
  podeConfigurarVersao,
}: {
  projetoId: string
  repositorio: RepositorioDaPublicacao
  podeConfigurarVersao: boolean
}) {
  const [estado, salvar, salvando] = useActionState(salvarConfiguracaoDePublicacaoAction, {})
  const c = repositorio.configuracao
  const id = (campo: string) => `publicacao-${repositorio.id}-${campo}`
  const titulo = id('titulo')

  return (
    <section
      aria-labelledby={titulo}
      className="space-y-4 rounded-padrao border border-border bg-surface p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 id={titulo} className="text-base font-semibold text-text-primary">
          {repositorio.nomeCompleto}
        </h3>
        {c === null ? (
          <BadgeDeEstado tom="neutro">Publicação não configurada</BadgeDeEstado>
        ) : c.pausado ? (
          <BadgeDeEstado tom="neutro">Fila pausada</BadgeDeEstado>
        ) : null}
      </div>

      <form action={salvar} className="max-w-md space-y-4">
        <MensagensDeEstado estado={estado} />
        <input type="hidden" name="projetoId" value={projetoId} />
        <input type="hidden" name="repositorioId" value={repositorio.id} />

        <div className="space-y-1">
          <label htmlFor={id('workflow')} className={CLASSE_ROTULO}>
            Workflow de deploy
          </label>
          <input
            id={id('workflow')}
            name="workflow"
            type="text"
            required
            maxLength={200}
            placeholder="deploy.yml"
            defaultValue={c?.workflow ?? ''}
            aria-describedby={id('workflow-ajuda')}
            className={CLASSE_CAMPO}
          />
          <p id={id('workflow-ajuda')} className={CLASSE_AJUDA}>
            O arquivo em .github/workflows, com workflow_dispatch. O Flow só dispara este workflow.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor={id('entrada')} className={CLASSE_ROTULO}>
            Entrada do commit
          </label>
          <input
            id={id('entrada')}
            name="entradaDoCommit"
            type="text"
            required
            maxLength={64}
            defaultValue={c?.entradaDoCommit ?? 'commit'}
            aria-describedby={id('entrada-ajuda')}
            className={CLASSE_CAMPO}
          />
          <p id={id('entrada-ajuda')} className={CLASSE_AJUDA}>
            O nome do input do workflow que recebe o commit a publicar.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor={id('hora')} className={CLASSE_ROTULO}>
            Hora do lote
          </label>
          <input
            id={id('hora')}
            name="horaDoLote"
            type="time"
            required
            defaultValue={c?.horaDoLote ?? HORA_DO_LOTE_PADRAO}
            aria-describedby={id('hora-ajuda')}
            className={CLASSE_CAMPO}
          />
          <p id={id('hora-ajuda')} className={CLASSE_AJUDA}>
            Horário de Brasília.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className={CLASSE_ROTULO}>Modo padrão</legend>
          {(
            [
              ['imediato', 'Imediato'],
              ['lote', 'Lote da noite'],
            ] as const
          ).map(([valor, rotulo]) => (
            <label key={valor} className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="radio"
                name="modoPadrao"
                value={valor}
                defaultChecked={(c?.modoPadrao ?? 'imediato') === valor}
                className={CLASSE_MARCA}
              />
              {rotulo}
            </label>
          ))}
        </fieldset>

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              name="automatico"
              defaultChecked={c?.automatico ?? true}
              aria-describedby={id('automatico-ajuda')}
              className={CLASSE_MARCA}
            />
            Publicar ao entrar na fila
          </label>
          <p id={id('automatico-ajuda')} className={CLASSE_AJUDA}>
            Desmarcado, a fila só publica manualmente.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            name="pausado"
            defaultChecked={c?.pausado ?? false}
            className={CLASSE_MARCA}
          />
          Pausar a fila
        </label>

        <Button type="submit" aria-busy={salvando} disabled={salvando}>
          Salvar
        </Button>
      </form>

      {c !== null && podeConfigurarVersao && (
        <VersaoNoAr
          projetoId={projetoId}
          repositorioId={repositorio.id}
          urlDaVersao={c.urlDaVersao}
        />
      )}

      {c !== null && <PublicarAgora projetoId={projetoId} repositorioId={repositorio.id} />}
    </section>
  )
}

export function PublicacaoNoProjeto({
  projetoId,
  repositorios,
  podeConfigurarVersao = false,
}: PublicacaoNoProjetoProps) {
  if (repositorios.length === 0) {
    return (
      <EstadoVazio
        tipo="nao-configurado"
        titulo="Nenhum repositório vinculado."
        descricao="Vincule um repositório na seção GitHub para configurar a publicação."
      />
    )
  }
  return (
    <div className="space-y-4">
      {repositorios.map((r) => (
        <ConfiguracaoDoRepositorio
          key={r.id}
          projetoId={projetoId}
          repositorio={r}
          podeConfigurarVersao={podeConfigurarVersao}
        />
      ))}
    </div>
  )
}
