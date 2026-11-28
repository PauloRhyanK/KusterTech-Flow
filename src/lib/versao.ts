/** O commit com que a imagem foi construída (`FLOW_COMMIT`, passado pelo workflow da imagem), ou null. */
export function versaoDaImagem(env: Readonly<Record<string, string | undefined>>): string | null {
  const commit = env.FLOW_COMMIT?.trim().toLowerCase() ?? ''
  return /^[0-9a-f]{40}$/.test(commit) ? commit : null
}
