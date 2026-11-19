import { notFound } from 'next/navigation'
import { moduloAtivo, type ModuloId } from './modulos'

export function exigirModulo(id: ModuloId): void {
  if (!moduloAtivo(id)) notFound()
}
