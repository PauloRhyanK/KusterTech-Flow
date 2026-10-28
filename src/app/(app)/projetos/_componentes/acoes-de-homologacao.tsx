'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { AcaoDeRegistro } from '@/modules/homologacao/model'
import { registrarAcaoDeHomologacaoAction } from '../acoes-de-homologacao'
import { MensagensDeEstado } from './mensagens-de-estado'

export interface AcoesDeHomologacaoProps {
  projetoId: string
  clienteId: string
  clienteNome: string
  milestoneId: string
  milestoneTitulo: string
  issueId: string
  issueNumero: number
  repositorio: string
  itemId: string
  ultimoEventoId: string | null
  versao: { id: string; rotulo: string } | null
  acoes: readonly AcaoDeRegistro[]
  recusa: string | null
  podeEscolherVisibilidade: boolean
  hrefDeRetorno?: string | null
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

const ROTULO_DO_BOTAO: Record<AcaoDeRegistro, string> = {
  APROVAR: 'Testado e aprovado',
  SOLICITAR_CORRECAO: 'Solicitar correção',
  COMENTAR: 'Comentário',
  DISPONIBILIZAR: 'Disponibilizar ao cliente',
}

const ORDEM_DOS_BOTOES: readonly AcaoDeRegistro[] = [
  'APROVAR',
  'SOLICITAR_CORRECAO',
  'COMENTAR',
  'DISPONIBILIZAR',
]

const MINIMO_DA_CORRECAO = 10

export function AcoesDeHomologacao(props: AcoesDeHomologacaoProps) {
  const { acoes, recusa, versao } = props
  const [estado, enviar, pendente] = useActionState(registrarAcaoDeHomologacaoAction, {})
  const [aberta, setAberta] = useState<AcaoDeRegistro | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [texto, setTexto] = useState('')
  const [erroLocal, setErroLocal] = useState<string | null>(null)
  const [estadoVisto, setEstadoVisto] = useState(estado)
  const [sucessoOculto, setSucessoOculto] = useState(false)

  // Depois de um sucesso o formulário volta ao início (nada otimista: só após a resposta).
  if (estado !== estadoVisto) {
    setEstadoVisto(estado)
    setSucessoOculto(false)
    if (estado.sucesso) {
      setAberta(null)
      setRevisando(false)
      setTexto('')
    }
  }

  const rotuloDaVersao = versao?.rotulo ?? 'não identificada'
  const contexto = `na issue #${props.issueNumero} (${props.repositorio}) para ${props.clienteNome}, na milestone ${props.milestoneTitulo}, versão ${rotuloDaVersao}`

  function alternar(acao: AcaoDeRegistro) {
    setAberta((atual) => (atual === acao ? null : acao))
    setRevisando(false)
    setTexto('')
    setSucessoOculto(true)
    setErroLocal(null)
  }

  function revisar() {
    if (aberta === 'SOLICITAR_CORRECAO' && texto.trim().length < MINIMO_DA_CORRECAO) {
      setErroLocal(`Descreva a correção com pelo menos ${MINIMO_DA_CORRECAO} caracteres.`)
      return
    }
    setErroLocal(null)
    setRevisando(true)
  }

  function bloquearSePendente(e: React.MouseEvent) {
    if (pendente) {
      e.preventDefault()
    }
  }

  return (
    <form action={enviar} aria-busy={pendente} className="space-y-4">
      <MensagensDeEstado
        estado={{
          erro: erroLocal ?? estado.erro,
          sucesso: sucessoOculto ? undefined : estado.sucesso,
        }}
      />
      {props.hrefDeRetorno && estado.sucesso && !sucessoOculto && (
        <Link href={props.hrefDeRetorno} className="block text-sm text-text-link hover:underline">
          Voltar à fila
        </Link>
      )}
      {recusa && (
        <p role="status" className="text-sm text-text-secondary">
          {recusa}
        </p>
      )}
      <input type="hidden" name="acao" value={aberta ?? ''} />
      <input type="hidden" name="projetoId" value={props.projetoId} />
      <input type="hidden" name="itemId" value={props.itemId} />
      <input type="hidden" name="clienteId" value={props.clienteId} />
      <input type="hidden" name="milestoneId" value={props.milestoneId} />
      <input type="hidden" name="issueId" value={props.issueId} />
      <input type="hidden" name="versaoId" value={versao?.id ?? ''} />
      <input type="hidden" name="ultimoEventoId" value={props.ultimoEventoId ?? ''} />

      <div role="group" aria-label="Ações de homologação" className="flex flex-wrap gap-2">
        {ORDEM_DOS_BOTOES.filter((a) => acoes.includes(a)).map((acao) => (
          <Button
            key={acao}
            type="button"
            variant="outline"
            aria-pressed={aberta === acao}
            onClick={() => alternar(acao)}
          >
            {ROTULO_DO_BOTAO[acao]}
          </Button>
        ))}
      </div>

      {aberta === 'COMENTAR' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="homologacao-comentario" className="block text-sm font-medium">
              Comentário
            </label>
            <textarea
              id="homologacao-comentario"
              name="texto"
              required
              maxLength={4000}
              rows={4}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className={CLASSE_CAMPO}
            />
          </div>
          {props.podeEscolherVisibilidade ? (
            <fieldset className="space-y-1 text-sm">
              <legend className="sr-only">Visibilidade do comentário</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="visibilidade" value="INTERNA" defaultChecked />
                Interna (só a equipe)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="visibilidade" value="COMPARTILHAVEL" />
                Compartilhável com o cliente
              </label>
            </fieldset>
          ) : (
            <input type="hidden" name="visibilidade" value="COMPARTILHAVEL" />
          )}
          <Button type="submit" aria-busy={pendente} onClick={bloquearSePendente}>
            Registrar comentário
          </Button>
        </div>
      )}

      {aberta !== null && aberta !== 'COMENTAR' && (
        <>
          <input type="hidden" name="visibilidade" value="COMPARTILHAVEL" />
          {aberta === 'DISPONIBILIZAR' && (
            <div className="space-y-3 rounded-padrao border border-border bg-surface-subtle p-4">
              <p className="text-sm text-text-primary">
                Disponibilizar a issue #{props.issueNumero} para teste de {props.clienteNome} na
                versão {rotuloDaVersao}?
              </p>
              <Button type="submit" aria-busy={pendente} onClick={bloquearSePendente}>
                Confirmar disponibilização
              </Button>
            </div>
          )}
          {(aberta === 'APROVAR' || aberta === 'SOLICITAR_CORRECAO') && (
            <>
              {!revisando ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="homologacao-texto" className="block text-sm font-medium">
                      {aberta === 'APROVAR'
                        ? 'Observação (opcional)'
                        : 'O que precisa ser corrigido'}
                    </label>
                    <textarea
                      id="homologacao-texto"
                      maxLength={4000}
                      rows={4}
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                      className={CLASSE_CAMPO}
                    />
                  </div>
                  <Button type="button" onClick={revisar}>
                    {aberta === 'APROVAR' ? 'Revisar aprovação' : 'Revisar solicitação'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 rounded-padrao border border-border bg-surface-subtle p-4">
                  <input type="hidden" name="texto" value={texto} />
                  <p className="text-sm text-text-primary">
                    {aberta === 'APROVAR'
                      ? `Você vai registrar Testado e aprovado ${contexto}.`
                      : `Você vai solicitar correção da issue #${props.issueNumero} (${props.repositorio}) para ${props.clienteNome}, na milestone ${props.milestoneTitulo}, versão ${rotuloDaVersao}.`}
                  </p>
                  {texto.trim() !== '' && (
                    <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">
                      {texto}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" aria-busy={pendente} onClick={bloquearSePendente}>
                      {aberta === 'APROVAR'
                        ? 'Confirmar aprovação'
                        : 'Confirmar solicitação de correção'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setRevisando(false)}>
                      Voltar e editar
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </form>
  )
}
