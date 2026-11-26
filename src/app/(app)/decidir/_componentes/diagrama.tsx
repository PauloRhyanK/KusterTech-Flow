'use client'

import { useEffect, useId, useState } from 'react'
import { Figura, VisorAmpliado } from './visor-ampliado'

const CODIGO =
  'my-2 overflow-x-auto rounded-compacto border border-border bg-surface-subtle px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-text-primary'

/** As cores do diagrama vêm dos tokens do tema, lidos do CSS. */
function coresDoTema(): Record<string, string> {
  const css = getComputedStyle(document.documentElement)
  const token = (nome: string) => css.getPropertyValue(nome).trim()
  const cores = {
    background: token('--surface-subtle'),
    primaryColor: token('--surface-elevated'),
    primaryTextColor: token('--text-primary'),
    primaryBorderColor: token('--border-strong'),
    lineColor: token('--text-tertiary'),
    secondaryColor: token('--surface'),
    tertiaryColor: token('--surface-subtle'),
    textColor: token('--text-primary'),
  }
  return Object.fromEntries(Object.entries(cores).filter(([, v]) => v !== ''))
}

/**
 * Um diagrama Mermaid escrito pelo agente. O Mermaid só é carregado quando há diagrama, em modo
 * `strict` (sem script nem link no desenho). Enquanto carrega, ou se o texto não desenha, fica o código.
 */
export function Diagrama({ codigo }: { codigo: string }) {
  const id = 'diagrama-' + useId().replace(/[^a-zA-Z0-9]/g, '')
  // O desenho guarda de que código veio: código novo volta a mostrar o texto até o desenho chegar.
  const [desenhado, setDesenhado] = useState<{ codigo: string; svg: string } | null>(null)
  const svg = desenhado?.codigo === codigo ? desenhado.svg : null
  const [ampliado, setAmpliado] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: 'base',
          themeVariables: coresDoTema(),
        })
        const r = await mermaid.render(id, codigo)
        if (vivo) setDesenhado({ codigo, svg: r.svg })
      } catch {
        // texto que não desenha: fica o código
      }
    })()
    return () => {
      vivo = false
    }
  }, [codigo, id])

  if (svg === null) {
    return (
      <pre className={CODIGO}>
        <code>{codigo}</code>
      </pre>
    )
  }
  // O SVG vem do Mermaid em modo `strict`, que o limpa; nenhum texto da mensagem entra como HTML.
  const desenho = (
    <div className="w-full [&_svg]:mx-auto" dangerouslySetInnerHTML={{ __html: svg }} />
  )
  return (
    <>
      <Figura legenda="Diagrama enviado pelo agente" onAmpliar={() => setAmpliado(true)}>
        {desenho}
      </Figura>
      <VisorAmpliado titulo="Diagrama" aberto={ampliado} onFechar={() => setAmpliado(false)}>
        <div className="mx-auto max-w-6xl [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none">
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </VisorAmpliado>
    </>
  )
}
