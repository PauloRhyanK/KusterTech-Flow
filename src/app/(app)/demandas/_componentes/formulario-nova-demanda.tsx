'use client'

import { type ClipboardEvent, type DragEvent, useActionState, useRef, useState } from 'react'
import { criarDemandaAction } from '@/app/(app)/demandas/nova/actions'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { descreverTamanho, juntarAnexos, MAXIMO_DE_ANEXOS } from '@/modules/demandas/anexos'
import { ROTULO_DO_NIVEL } from '@/modules/demandas/apresentacao'
import { CONTEUDOS_ACEITOS } from '@/modules/demandas/transicoes'
import { NIVEIS } from '@/modules/demandas/contrato'
import type { FormularioDeDemanda } from '@/modules/demandas/queries'

export interface FormularioNovaDemandaProps {
  projetos: FormularioDeDemanda['projetos']
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'
const CLASSE_ROTULO = 'block text-sm font-medium text-text-primary'
const CLASSE_PILULA =
  'cursor-pointer rounded-full border border-border-strong px-3.5 py-1.5 text-sm font-[550] text-text-primary has-[:checked]:border-text-primary has-[:checked]:bg-text-primary has-[:checked]:text-surface has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus-ring'

function Anexos({
  arquivos,
  erro,
  aoEscolher,
  aoRemover,
}: {
  arquivos: File[]
  erro: string | null
  aoEscolher: (novos: File[]) => void
  aoRemover: (indice: number) => void
}) {
  const seletor = useRef<HTMLInputElement>(null)
  const [arrastando, setArrastando] = useState(false)
  const cheio = arquivos.length >= MAXIMO_DE_ANEXOS

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setArrastando(false)
    aoEscolher(Array.from(e.dataTransfer.files))
  }

  return (
    <div className="space-y-2 pt-1">
      <div
        data-testid="zona-de-anexos"
        onDragOver={(e) => {
          e.preventDefault()
          setArrastando(true)
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
        className={`flex flex-wrap items-center gap-3 rounded-compacto border border-dashed px-3 py-2.5 ${
          arrastando ? 'border-focus-ring bg-surface-subtle' : 'border-border-strong'
        }`}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cheio}
          onClick={() => seletor.current?.click()}
        >
          Anexar arquivo
        </Button>
        <span className="text-xs text-text-secondary">
          {cheio
            ? `Limite de ${MAXIMO_DE_ANEXOS} anexos.`
            : 'Ou arraste aqui, ou cole uma imagem nos detalhes. Imagem ou áudio, até 3 de 10 MB.'}
        </span>
        <input
          ref={seletor}
          type="file"
          multiple
          aria-label="Anexos"
          accept={CONTEUDOS_ACEITOS.anexo.join(',')}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            aoEscolher(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>

      {arquivos.length > 0 && (
        <ul className="space-y-1">
          {arquivos.map((a, i) => (
            <li
              key={`${a.name}-${a.size}-${i}`}
              className="flex items-center gap-2 rounded-compacto border border-border px-3 py-1.5 text-sm"
            >
              <span className="text-xs text-text-secondary">
                {a.type.startsWith('audio/') ? 'Áudio' : 'Imagem'}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-primary">{a.name}</span>
              <span className="text-xs text-text-secondary">{descreverTamanho(a.size)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remover ${a.name}`}
                onClick={() => aoRemover(i)}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p aria-live="polite" className={erro ? 'text-xs text-erro' : 'sr-only'}>
        {erro ?? ''}
      </p>
    </div>
  )
}

function Pilulas({
  legenda,
  nome,
  opcoes,
  valor,
  aoMudar,
}: {
  legenda: string
  nome: string
  opcoes: readonly { valor: string; rotulo: string }[]
  valor: string
  aoMudar: (v: string) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className={CLASSE_ROTULO}>{legenda}</legend>
      <div className="flex flex-wrap gap-2">
        {opcoes.map((o) => (
          <label key={o.valor} className={CLASSE_PILULA}>
            <input
              type="radio"
              name={nome}
              value={o.valor}
              checked={valor === o.valor}
              onChange={() => aoMudar(o.valor)}
              className="sr-only"
            />
            {o.rotulo}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function FormularioNovaDemanda({ projetos }: FormularioNovaDemandaProps) {
  const [estado, criar, criando] = useActionState(criarDemandaAction, {})
  const [projetoId, setProjetoId] = useState(projetos[0]?.id ?? '')
  const [nivelEscolhido, setNivelEscolhido] = useState<string | null>(null)
  const [temTela, setTemTela] = useState('sim')
  // Controlados: o React 19 limpa campos não controlados ao fim da ação, mesmo quando ela volta com erro.
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [anexos, setAnexos] = useState<File[]>([])
  const [erroDosAnexos, setErroDosAnexos] = useState<string | null>(null)

  const escolher = (novos: File[]) => {
    if (novos.length === 0) return
    const r = juntarAnexos(anexos, novos)
    setAnexos(r.arquivos)
    setErroDosAnexos(r.erro)
  }

  const colar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const imagens = Array.from(e.clipboardData.files).filter((f) =>
      CONTEUDOS_ACEITOS.anexo.includes(f.type),
    )
    // Planilhas e editores põem texto e uma imagem de prévia juntos: com texto, cola o texto.
    if (imagens.length === 0 || e.clipboardData.getData('text/plain')) return
    e.preventDefault()
    escolher(imagens)
  }

  // Os anexos vivem no estado (para listar e remover); entram no envio aqui.
  const enviar = (form: FormData) => {
    form.delete('anexos')
    for (const a of anexos) form.append('anexos', a)
    criar(form)
  }

  const projeto = projetos.find((p) => p.id === projetoId)
  // Enquanto a pessoa não escolheu, o nível acompanha o padrão do projeto.
  const nivel = nivelEscolhido ?? projeto?.nivelPadrao ?? 'aprovar_desenho'

  return (
    <form
      action={enviar}
      className="max-w-[620px] space-y-5 rounded-padrao border border-border bg-surface p-6"
    >
      <MensagensDeEstado estado={estado} />

      <div className="space-y-1">
        <label htmlFor="nova-demanda-projeto" className={CLASSE_ROTULO}>
          Projeto
        </label>
        <select
          id="nova-demanda-projeto"
          name="projetoId"
          required
          value={projetoId}
          onChange={(e) => {
            setProjetoId(e.target.value)
            setNivelEscolhido(null)
          }}
          className={CLASSE_CAMPO}
        >
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </div>

      {projeto && projeto.repositorios.length > 1 && (
        <div className="space-y-1">
          <label htmlFor="nova-demanda-repositorio" className={CLASSE_ROTULO}>
            Repositório
          </label>
          {/* `key` recomeça no primeiro repositório ao trocar de projeto. */}
          <select
            key={projeto.id}
            id="nova-demanda-repositorio"
            name="repositorioId"
            required
            defaultValue={projeto.repositorios[0]!.id}
            className={CLASSE_CAMPO}
          >
            {projeto.repositorios.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nomeCompleto}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="nova-demanda-titulo" className={CLASSE_ROTULO}>
          O que você quer
        </label>
        <input
          id="nova-demanda-titulo"
          name="titulo"
          type="text"
          required
          maxLength={120}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Título curto"
          className={CLASSE_CAMPO}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="nova-demanda-detalhes" className={CLASSE_ROTULO}>
          Detalhes (opcional)
        </label>
        <textarea
          id="nova-demanda-detalhes"
          name="descricao"
          rows={4}
          maxLength={4000}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Escreva, cole imagem ou anexe um áudio"
          onPaste={colar}
          className={CLASSE_CAMPO}
        />
        <Anexos
          arquivos={anexos}
          erro={erroDosAnexos}
          aoEscolher={escolher}
          aoRemover={(i) => {
            setAnexos((atuais) => atuais.filter((_, j) => j !== i))
            setErroDosAnexos(null)
          }}
        />
      </div>

      <Pilulas
        legenda="Quanto você quer acompanhar"
        nome="nivel"
        opcoes={NIVEIS.map((n) => ({ valor: n, rotulo: ROTULO_DO_NIVEL[n] }))}
        valor={nivel}
        aoMudar={setNivelEscolhido}
      />

      <Pilulas
        legenda="Tem tela?"
        nome="temTela"
        opcoes={[
          { valor: 'sim', rotulo: 'Sim' },
          { valor: 'nao', rotulo: 'Não' },
        ]}
        valor={temTela}
        aoMudar={setTemTela}
      />

      <Button type="submit" aria-busy={criando} disabled={criando}>
        Criar demanda
      </Button>
    </form>
  )
}
