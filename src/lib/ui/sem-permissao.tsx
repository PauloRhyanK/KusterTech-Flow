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
      <p className="text-[15px] font-[600] leading-[1.4] text-text-primary">
        Sem permissão para esta área.
      </p>
      <p className="mt-1 max-w-md text-sm text-text-secondary">
        Peça a um administrador o acesso necessário.
      </p>
    </div>
  )
}
