export interface MensagensDeEstadoProps {
  estado: { erro?: string; sucesso?: string }
}

// Regiões sempre montadas: o leitor de tela anuncia a mudança de conteúdo.
export function MensagensDeEstado({ estado }: MensagensDeEstadoProps) {
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className={
          estado.sucesso
            ? 'rounded-compacto border border-sucesso/30 bg-tonal-sucesso p-3 text-sm text-sucesso'
            : 'sr-only'
        }
      >
        {estado.sucesso ?? ''}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        className={
          estado.erro
            ? 'rounded-compacto border border-erro/30 bg-tonal-erro p-3 text-sm text-erro'
            : 'sr-only'
        }
      >
        {estado.erro ?? ''}
      </div>
    </>
  )
}
