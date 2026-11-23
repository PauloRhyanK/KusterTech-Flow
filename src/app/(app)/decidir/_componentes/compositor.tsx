'use client'

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'

const MAXIMO_DE_IMAGENS = 3
const TIPOS_DE_IMAGEM = ['image/png', 'image/jpeg', 'image/webp']
const LIMITE_DA_MENSAGEM = 4000

export interface EnvioDoCompositor {
  /** Fica o mesmo até o envio dar certo: reenviar não duplica a mensagem. */
  id: string
  texto: string
  imagens: File[]
}

function arquivosColados(e: ClipboardEvent<HTMLTextAreaElement>): File[] {
  const dados = e.clipboardData
  const files = Array.from(dados?.files ?? [])
  if (files.length > 0) return files
  return Array.from(dados?.items ?? [])
    .filter((i) => i.kind === 'file')
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null)
}

/** Texto e até três imagens (botão "Imagem" ou colar). Enter envia; Shift+Enter quebra a linha. */
export function Compositor({
  onEnviar,
  desabilitado = false,
}: {
  onEnviar: (e: EnvioDoCompositor) => Promise<{ erro?: string }>
  desabilitado?: boolean
}) {
  const [texto, setTexto] = useState('')
  const [imagens, setImagens] = useState<File[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, setPendente] = useState(false)
  const [id, setId] = useState(() => crypto.randomUUID())
  const arquivo = useRef<HTMLInputElement>(null)

  const anexar = (novas: File[]) => {
    if (novas.length === 0) return
    if (novas.some((f) => !TIPOS_DE_IMAGEM.includes(f.type))) {
      setErro('Só imagens PNG, JPEG ou WebP.')
      return
    }
    if (imagens.length + novas.length > MAXIMO_DE_IMAGENS) {
      setErro('Envie até 3 imagens.')
      return
    }
    setErro(null)
    setImagens((atuais) => [...atuais, ...novas])
  }

  const vazio = texto.trim() === '' && imagens.length === 0
  const enviar = async () => {
    if (vazio || pendente || desabilitado) return
    setPendente(true)
    try {
      const r = await onEnviar({ id, texto, imagens })
      if (r.erro) {
        setErro(r.erro)
        return
      }
      setErro(null)
      setTexto('')
      setImagens([])
      setId(crypto.randomUUID())
    } finally {
      setPendente(false)
    }
  }

  const teclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    void enviar()
  }

  const colar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const imagensColadas = arquivosColados(e)
    if (imagensColadas.length === 0) return
    e.preventDefault()
    anexar(imagensColadas)
  }

  return (
    <form
      aria-label="Responder"
      onSubmit={(e) => {
        e.preventDefault()
        void enviar()
      }}
      className="space-y-2"
    >
      <div className="rounded-padrao border border-border-strong bg-surface px-3.5 py-3 focus-within:ring-2 focus-within:ring-focus-ring">
        <textarea
          aria-label="Mensagem"
          placeholder="Escreva ou cole uma imagem…"
          rows={2}
          maxLength={LIMITE_DA_MENSAGEM}
          value={texto}
          disabled={desabilitado}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={teclar}
          onPaste={colar}
          className="block w-full resize-none bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-none"
        />
        {imagens.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {imagens.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex max-w-full items-center gap-1.5 rounded-compacto border border-border bg-surface-subtle px-2 py-1 text-xs text-text-secondary"
              >
                <span className="break-all">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Tirar ${f.name}`}
                  onClick={() => setImagens((atuais) => atuais.filter((_, j) => j !== i))}
                  className="text-text-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={desabilitado}
            onClick={() => arquivo.current?.click()}
          >
            Imagem
          </Button>
          <input
            ref={arquivo}
            type="file"
            aria-label="Escolher imagem"
            accept={TIPOS_DE_IMAGEM.join(',')}
            multiple
            hidden
            onChange={(e) => {
              anexar(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <Button
            type="submit"
            size="lg"
            disabled={desabilitado || pendente || vazio}
            aria-busy={pendente}
          >
            Enviar
          </Button>
        </div>
      </div>
      {erro && (
        <p role="alert" className="break-words text-sm font-[550] text-erro">
          {erro}
        </p>
      )}
    </form>
  )
}
