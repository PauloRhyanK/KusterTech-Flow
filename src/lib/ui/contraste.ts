function extrairRgb(hex: string): [number, number, number] {
  const limpo = hex.trim().replace(/^#/, '')
  if (!/^[0-9A-Fa-f]{6}$/.test(limpo)) {
    throw new Error(`Hex inválido: ${hex}`)
  }
  const r = Number.parseInt(limpo.slice(0, 2), 16)
  const g = Number.parseInt(limpo.slice(2, 4), 16)
  const b = Number.parseInt(limpo.slice(4, 6), 16)
  return [r, g, b]
}

function linearizarCanal(valor: number): number {
  const srgb = valor / 255
  // Limiar IEC 61966-2-1 / WCAG 2.1+ (0,04045; para canais inteiros de 8 bits é equivalente ao 0,03928 da WCAG 2.0, pois 10/255 ≈ 0,039216 <= ambos e 11/255 ≈ 0,043137 > ambos)
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

export function luminancia(hex: string): number {
  const [r, g, b] = extrairRgb(hex)
  return 0.2126 * linearizarCanal(r) + 0.7152 * linearizarCanal(g) + 0.0722 * linearizarCanal(b)
}

export function contraste(hexFrente: string, hexFundo: string): number {
  const l1 = luminancia(hexFrente)
  const l2 = luminancia(hexFundo)
  const maior = Math.max(l1, l2)
  const menor = Math.min(l1, l2)
  const razao = (maior + 0.05) / (menor + 0.05)
  return Math.trunc((razao + 1e-12) * 100) / 100
}

export function compor(hexCor: string, fracao: number, hexFundo: string): string {
  const [r1, g1, b1] = extrairRgb(hexCor)
  const [r2, g2, b2] = extrairRgb(hexFundo)
  const misturar = (c: number, f: number): string => {
    const valor = Math.min(255, Math.max(0, Math.round(c * fracao + f * (1 - fracao))))
    return valor.toString(16).padStart(2, '0').toUpperCase()
  }
  return `#${misturar(r1, r2)}${misturar(g1, g2)}${misturar(b1, b2)}`
}
