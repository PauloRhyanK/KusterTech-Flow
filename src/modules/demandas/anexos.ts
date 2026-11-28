// Regras dos anexos no formulário de nova demanda. Puro: roda no navegador antes do envio;
// o servidor confere de novo (actions.ts e service.ts).
import { CONTEUDOS_ACEITOS, LIMITE_POR_ARQUIVO } from './transicoes'

export const MAXIMO_DE_ANEXOS = 3

export interface ArquivoEscolhido {
  name: string
  type: string
  size: number
}

const MB = 1024 * 1024

export function descreverTamanho(bytes: number): string {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(Math.round((bytes / MB) * 10) / 10).toLocaleString('pt-BR')} MB`
}

const mesmo = (a: ArquivoEscolhido, b: ArquivoEscolhido) =>
  a.name === b.name && a.size === b.size && a.type === b.type

/** Junta os novos aos atuais: recusa tipo e tamanho fora do limite, ignora repetido e para no máximo. */
export function juntarAnexos<T extends ArquivoEscolhido>(
  atuais: T[],
  novos: T[],
): { arquivos: T[]; erro: string | null } {
  const arquivos = [...atuais]
  const problemas: string[] = []
  const deFora: string[] = []
  for (const n of novos) {
    if (arquivos.some((a) => mesmo(a, n))) continue
    if (!CONTEUDOS_ACEITOS.anexo.includes(n.type)) {
      problemas.push(`${n.name}: só imagem (PNG, JPEG, WebP), áudio ou vídeo (MP4, WebM, MOV).`)
    } else if (n.size > LIMITE_POR_ARQUIVO) {
      problemas.push(`${n.name}: passa de 10 MB.`)
    } else if (arquivos.length >= MAXIMO_DE_ANEXOS) {
      deFora.push(n.name)
    } else {
      arquivos.push(n)
    }
  }
  if (deFora.length > 0) {
    problemas.push(`Até ${MAXIMO_DE_ANEXOS} anexos: ${deFora.join(', ')} ficou de fora.`)
  }
  return { arquivos, erro: problemas.length > 0 ? problemas.join(' ') : null }
}
