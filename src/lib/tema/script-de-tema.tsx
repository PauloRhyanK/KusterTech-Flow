import { SCRIPT_APLICAR_TEMA } from '@/lib/tema/tema'

export function ScriptDeTema() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT_APLICAR_TEMA }} />
}
