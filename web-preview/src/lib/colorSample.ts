import { createContext } from 'react'
import { formatCmyk, rgbToCmykPrint } from './cmyk'

// Provided by App: arms an eyedropper over the live preview and resolves to a
// stored "c:m:y:k" color, or null if the user cancels (Esc / clicks off the
// preview). A null context value means sampling is unavailable (e.g. no
// background yet), so `ColorField` hides its eyedropper button.
export type RequestColorSample = () => Promise<string | null>
export const ColorSampleContext = createContext<RequestColorSample | null>(null)

// Draw an image URL onto a canvas so its pixels can be read. The preview's
// background is a same-origin data URL, so the canvas stays untainted and
// `getImageData` is allowed.
export function imageUrlToCanvas(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas 2D context indisponibil'))
        return
      }
      ctx.drawImage(img, 0, 0)
      resolve(canvas)
    }
    img.onerror = () => reject(new Error('Imaginea fundalului nu a putut fi încărcată'))
    img.src = url
  })
}

export interface Rgb {
  r: number
  g: number
  b: number
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }

// Read the pixel at fractional position (fx, fy) of the canvas and return it as
// a stored "c:m:y:k" color. The background is rendered on transparency, so a
// (semi-)transparent sample is composited over `base` — the color actually seen
// behind it: the chosen backdrop, or the card white (the checkerboard is only a
// transparency indicator; print renders white). The RGB→CMYK step inverts the
// same `cmykToRgb` polynomial the preview is painted with, so the picked color
// re-renders as exactly the pixel that was clicked.
export function sampleCanvasColorAt(canvas: HTMLCanvasElement, fx: number, fy: number, base: Rgb = WHITE): string {
  const ctx = canvas.getContext('2d')
  if (!ctx) return '0:0:0:0'
  const px = Math.min(canvas.width - 1, Math.max(0, Math.floor(fx * canvas.width)))
  const py = Math.min(canvas.height - 1, Math.max(0, Math.floor(fy * canvas.height)))
  const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data
  const alpha = a / 255
  const over = (c: number, bc: number) => Math.round(c * alpha + bc * (1 - alpha))
  return formatCmyk(rgbToCmykPrint({ r: over(r, base.r), g: over(g, base.g), b: over(b, base.b) }))
}

// Map a click at (fxCard, fyCard) — fractions of the card — to its fractional
// position within the background image, or null when the click lands outside it
// (a zone a pan/spin vacated). Inverts the transform CardCanvas draws the
// background with: `translate(offsetXPt, −offsetYPt) rotate(−spinDeg, center)`
// in SVG (y-down) coordinates — so the inverse subtracts the translation, then
// rotates by +spinDeg about the card center.
export function previewPointToBackgroundFrac(
  fxCard: number,
  fyCard: number,
  opts: { cardWidthPt: number; cardHeightPt: number; offsetXPt?: number; offsetYPt?: number; spinDeg?: number },
): { fx: number; fy: number } | null {
  const { cardWidthPt: w, cardHeightPt: h } = opts
  if (!(w > 0) || !(h > 0)) return null
  // Into card points (SVG y-down); the drawn translate is (offsetXPt, −offsetYPt).
  let x = fxCard * w - (opts.offsetXPt ?? 0)
  let y = fyCard * h + (opts.offsetYPt ?? 0)
  const spin = opts.spinDeg ?? 0
  if (spin) {
    const cx = w / 2
    const cy = h / 2
    const rad = (spin * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const dx = x - cx
    const dy = y - cy
    x = cx + dx * cos - dy * sin
    y = cy + dx * sin + dy * cos
  }
  const fx = x / w
  const fy = y / h
  const eps = 1e-9
  if (fx < -eps || fx > 1 + eps || fy < -eps || fy > 1 + eps) return null
  return { fx: Math.min(1, Math.max(0, fx)), fy: Math.min(1, Math.max(0, fy)) }
}
