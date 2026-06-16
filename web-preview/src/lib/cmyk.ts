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

// Pick a legible default text color (CMYK black or white) for a given
// background color, so codes stay visible on a chosen simple background. A
// `null` background means "no fill" (white card), so default to black.
export function contrastColor(background: string | null): string {
  if (background === null) return '0:0:0:1' // black on white
  const { r, g, b } = cmykToRgb(parseCmyk(background))
  // Perceived luminance (0-255): light background -> black text, dark -> white.
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 140 ? '0:0:0:1' : '0:0:0:0'
}

// Standard HSV -> RGB (hue in 0-360, sat/val in 0-1; returns 0-255 components).
// Used to paint the picker's color square and to resolve a clicked position to
// a color.
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360 / 60
  const i = Math.floor(hh)
  const f = hh - i
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  const [r, g, b] =
    i % 6 === 0 ? [v, t, p]
    : i % 6 === 1 ? [q, v, p]
    : i % 6 === 2 ? [p, v, t]
    : i % 6 === 3 ? [p, q, v]
    : i % 6 === 4 ? [t, p, v]
    : [v, p, q]
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) }
}

// Inverse of `hsvToRgb` (components 0-255; hue 0-360, sat/val 0-1). Used to
// place the picker marker for the current color.
export function rgbToHsv({ r, g, b }: { r: number; g: number; b: number }): { h: number; s: number; v: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

// Map a position in the picker's color square (`xFrac`/`yFrac` each 0-1: x is
// hue, y is saturation top->bottom) plus a separate K value (0-1) to a stored
// "c:m:y:k" string. The square is painted at full brightness so the picked RGB
// yields C/M/Y with no black of its own; the K slider supplies black.
export function squareToCmyk(xFrac: number, yFrac: number, k: number): string {
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  const { r, g, b } = hsvToRgb(clamp(xFrac) * 360, 1 - clamp(yFrac), 1)
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  const { c, m, y } = rgbHexToCmyk(`#${hex(r)}${hex(g)}${hex(b)}`)
  return formatCmyk({ c, m, y, k: clamp(k) })
}

// Where a stored color sits in the picker square (inverse axis mapping of
// `squareToCmyk`), used to position the marker.
export function cmykToSquarePos(value: string): { xFrac: number; yFrac: number } {
  const { h, s } = rgbToHsv(cmykToRgb(parseCmyk(value)))
  return { xFrac: h / 360, yFrac: 1 - s }
}
