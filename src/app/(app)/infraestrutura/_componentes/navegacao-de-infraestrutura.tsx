import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface NavegacaoDeInfraestruturaProps {
  ativo: 'inventario'
}

const ITENS = [{ chave: 'inventario', rotulo: 'Inventário', href: '/infraestrutura' }] as const

export function NavegacaoDeInfraestrutura({ ativo }: NavegacaoDeInfraestruturaProps) {
  return (
    <nav aria-label="Seções de Infraestrutura" className="flex gap-1 border-b border-border">
      {ITENS.map((item) => (
        <Link
          key={item.chave}
          href={item.href}
          aria-current={item.chave === ativo ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            item.chave === ativo
              ? 'border-primary text-text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary',
          )}
        >
          {item.rotulo}
        </Link>
      ))}
    </nav>
  )
}
