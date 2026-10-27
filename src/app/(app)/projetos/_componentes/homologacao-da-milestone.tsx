import Link from 'next/link'
import { EstadoVazio } from '@/lib/ui/estado-vazio'

export interface HomologacaoDaMilestoneProps {
  hrefAmbientes: string | null
}

export function HomologacaoDaMilestone({ hrefAmbientes }: HomologacaoDaMilestoneProps) {
  return (
    <EstadoVazio
      tipo="nao-configurado"
      titulo="Ambientes não configurados."
      descricao="A homologação desta milestone começa quando o ambiente QA do projeto tiver evidência de implantação. Ambientes chegam no Incremento 4."
      acao={
        hrefAmbientes ? (
          <Link href={hrefAmbientes} className="text-sm text-text-link hover:underline">
            Configurar ambientes
          </Link>
        ) : undefined
      }
    />
  )
}
