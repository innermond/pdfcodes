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

// Convert CMYK to RGB for on-screen display. This deliberately matches how PDF
// viewers render DeviceCMYK (the polynomial pdf.js uses, derived from Adobe's
// conversion) rather than the naive `255*(1-c)*(1-k)` model, so the preview
// reflects the *actual* generated PDF — e.g. pure CMYK black shows as the same
// washed dark slate a viewer paints, not an idealized #000000. Inputs are
// 0-1; outputs are 0-255.
export function cmykToRgb({ c, m, y, k }: Cmyk): { r: number; g: number; b: number } {
  const r =
    255 +
    c * (-4.387332384609988 * c + 54.48615194189176 * m + 18.82290502165302 * y + 212.25662451639585 * k - 285.2331026137004) +
    m * (1.7149763477362134 * m - 5.6096736904047315 * y - 17.873870861415444 * k - 5.497006427196366) +
    y * (-2.5217340131683033 * y - 21.248923337353073 * k + 17.5119270841813) +
    k * (-21.86122147463605 * k - 189.48180835922747)
  const g =
    255 +
    c * (8.841041422036149 * c + 60.118027045597366 * m + 6.871425592049007 * y + 31.159100130055922 * k - 79.2970844816548) +
    m * (-15.310361306967817 * m + 17.575251261109482 * y + 131.35250912493976 * k - 190.9453302588951) +
    y * (4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878) +
    k * (-20.737325471181034 * k - 187.80453709719578)
  const b =
    255 +
    c * (0.8842522430003296 * c + 8.078677503112928 * m + 30.89978309703729 * y - 0.23883238689178934 * k - 14.183576799673286) +
    m * (10.49593273432072 * m + 63.02378494754052 * y + 50.606957656360734 * k - 112.23884253719248) +
    y * (0.03296041114873217 * y + 115.60384449646641 * k - 193.58209356861505) +
    k * (-22.33816807309886 * k - 180.12613974708367)
  const clampByte = (n: number) => Math.min(255, Math.max(0, Math.round(n)))
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b) }
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

// Invert `cmykToRgb`: find the CMYK whose *display* rendering matches the given
// RGB (0-255) as closely as possible. Used by the preview eyedropper, where the
// sampled pixel was itself painted through `cmykToRgb` (by pdf.js or by our own
// swatches) — inverting the same polynomial makes the picked color re-render as
// exactly the pixel that was clicked. (The naive `rgbHexToCmyk` is NOT that
// inverse; it exists for legacy hex parsing and the picker square's axes.)
//
// The polynomial has no closed-form inverse, so this is a coarse-to-fine grid
// search: a full-cube pass at step 1/8, then three refinement rounds shrinking
// the step ×4 around the best candidate (4 passes of 9⁴ ≈ 26k evaluations —
// instant for a single click). The system is underdetermined (4 unknowns, 3
// targets),
// so K is scanned from high to low and only strictly better errors replace the
// best: among exact ties the highest-K candidate wins (GCR-style — grays map to
// pure K, and CMYK black round-trips to `0:0:0:1`).
export function rgbToCmykPrint(rgb: { r: number; g: number; b: number }): Cmyk {
  let best: Cmyk = { c: 0, m: 0, y: 0, k: 0 }
  let bestErr = Infinity
  const consider = (c: number, m: number, y: number, k: number) => {
    const o = cmykToRgb({ c, m, y, k })
    const e = (o.r - rgb.r) ** 2 + (o.g - rgb.g) ** 2 + (o.b - rgb.b) ** 2
    if (e < bestErr) {
      bestErr = e
      best = { c, m, y, k }
    }
  }

  // Coarse pass. K descends so equal-error ties keep the highest K; C/M/Y
  // ascend so, within a K, ties keep the least ink (white → 0:0:0:0).
  const coarse = 8
  for (let k = coarse; k >= 0; k--)
    for (let c = 0; c <= coarse; c++)
      for (let m = 0; m <= coarse; m++)
        for (let y = 0; y <= coarse; y++) consider(c / coarse, m / coarse, y / coarse, k / coarse)

  // Refinement: rescan ±previous step around the best hit at 4× resolution
  // (9 samples per axis), landing at a final step of 1/512 — below what one
  // 8-bit RGB channel can resolve through the polynomial's gradients.
  let step = 1 / coarse
  for (let round = 0; round < 3; round++) {
    const prev = step
    step = prev / 4
    const { c: c0, m: m0, y: y0, k: k0 } = best
    for (let dk = 4; dk >= -4; dk--)
      for (let dc = -4; dc <= 4; dc++)
        for (let dm = -4; dm <= 4; dm++)
          for (let dy = -4; dy <= 4; dy++)
            consider(clamp01(c0 + dc * step), clamp01(m0 + dm * step), clamp01(y0 + dy * step), clamp01(k0 + dk * step))
  }

  return best
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

// CMYK for a position in the picker's color square (`xFrac`/`yFrac` each 0-1: x
// is hue, y is saturation top->bottom) plus a separate K value (0-1). The square
// is sampled at full brightness so the C/M/Y carry no black of their own; the K
// slider supplies black.
function squareCmyk(xFrac: number, yFrac: number, k: number): Cmyk {
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  const { r, g, b } = hsvToRgb(clamp(xFrac) * 360, 1 - clamp(yFrac), 1)
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  const { c, m, y } = rgbHexToCmyk(`#${hex(r)}${hex(g)}${hex(b)}`)
  return { c, m, y, k: clamp(k) }
}

// `squareCmyk` serialized to the generator's "c:m:y:k" string.
export function squareToCmyk(xFrac: number, yFrac: number, k: number): string {
  return formatCmyk(squareCmyk(xFrac, yFrac, k))
}

// Display RGB for a square position: the CMYK that position encodes, rendered
// with the print CMYK->RGB conversion so the picker shows only the colors CMYK
// can actually produce (and darkens with K) instead of the full RGB gamut.
export function squareColor(xFrac: number, yFrac: number, k: number): { r: number; g: number; b: number } {
  return cmykToRgb(squareCmyk(xFrac, yFrac, k))
}

// Where a stored color sits in the picker square (inverse axis mapping of
// `squareToCmyk`), used to position the marker. This inverts the square's own
// RGB->CMY sampling (naive, at K=0) rather than the display conversion, so the
// marker tracks the picked hue/saturation regardless of how colors are painted.
export function cmykToSquarePos(value: string): { xFrac: number; yFrac: number } {
  const { c, m, y } = parseCmyk(value)
  const { h, s } = rgbToHsv({ r: 255 * (1 - c), g: 255 * (1 - m), b: 255 * (1 - y) })
  return { xFrac: h / 360, yFrac: 1 - s }
}
