// CMYK colors, the print-oriented model used by the generator (see
// `parse_color` in src/color.rs, which accepts "c:m:y:k" with each component
// 0.0-1.0). The UI works in CMYK so picked colors map directly to print; for
// on-screen rendering we convert to RGB (an approximation, since monitors are
// additive RGB).

export interface Cmyk {
  c: number
  m: number
  y: number
  k: number
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

// Trim float noise so the serialized value stays readable (e.g. "0:0:0:1").
function trim(n: number): number {
  return Math.round(clamp01(n) * 1e4) / 1e4
}

// Serialize to the generator's "c:m:y:k" string (components 0.0-1.0).
export function formatCmyk({ c, m, y, k }: Cmyk): string {
  return `${trim(c)}:${trim(m)}:${trim(y)}:${trim(k)}`
}

// Parse a stored color into CMYK. Accepts the "c:m:y:k" form and, for
// backward compatibility with older presets, "#RRGGBB" hex.
export function parseCmyk(value: string): Cmyk {
  const s = value.trim()
  if (s.startsWith('#')) return rgbHexToCmyk(s)
  const parts = s.split(':').map((p) => Number(p.trim()))
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    const [c, m, y, k] = parts
    return { c: clamp01(c), m: clamp01(m), y: clamp01(y), k: clamp01(k) }
  }
  return { c: 0, m: 0, y: 0, k: 1 }
}

export function cmykToRgb({ c, m, y, k }: Cmyk): { r: number; g: number; b: number } {
  return {
    r: Math.round(255 * (1 - c) * (1 - k)),
    g: Math.round(255 * (1 - m) * (1 - k)),
    b: Math.round(255 * (1 - y) * (1 - k)),
  }
}

export function rgbHexToCmyk(hex: string): Cmyk {
  const h = hex.replace('#', '')
  if (h.length !== 6) return { c: 0, m: 0, y: 0, k: 1 }
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 }
  return {
    c: (1 - r - k) / (1 - k),
    m: (1 - g - k) / (1 - k),
    y: (1 - b - k) / (1 - k),
    k,
  }
}

// Convert any stored color string ("c:m:y:k" or "#RRGGBB") to a CSS hex color
// for on-screen rendering (SVG fill/stroke, swatches).
export function colorToCss(value: string): string {
  const s = value.trim()
  if (s.startsWith('#')) return s
  const { r, g, b } = cmykToRgb(parseCmyk(s))
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}
