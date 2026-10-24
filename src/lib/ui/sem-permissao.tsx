import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SemPermissaoProps {
  className?: string
}

export function SemPermissao({ className }: SemPermissaoProps = {}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center rounded-amplo border border-border bg-surface p-8 text-center',
        className,
      )}
    >
      <div className="mb-3 text-text-secondary">
        <Lock size={18} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-text-primary">Sem permissão para esta área.</h3>
      <p className="mt-1 max-w-md text-sm text-text-secondary">
        Peça a um administrador o acesso necessário.
      </p>
    </div>
  )
}
