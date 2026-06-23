import { createContext } from 'react'
import { formatCmyk, rgbHexToCmyk } from './cmyk'

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

// Read the pixel at fractional position (fx, fy) of the canvas and return it as
// a stored "c:m:y:k" color. The background is rendered on transparency, so
// composite the sample over the card's white backdrop to match what's seen.
export function sampleCanvasColorAt(canvas: HTMLCanvasElement, fx: number, fy: number): string {
  const ctx = canvas.getContext('2d')
  if (!ctx) return '0:0:0:0'
  const px = Math.min(canvas.width - 1, Math.max(0, Math.floor(fx * canvas.width)))
  const py = Math.min(canvas.height - 1, Math.max(0, Math.floor(fy * canvas.height)))
  const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data
  const alpha = a / 255
  const overWhite = (c: number) => Math.round(c * alpha + 255 * (1 - alpha))
  const hex = (c: number) => overWhite(c).toString(16).padStart(2, '0')
  return formatCmyk(rgbHexToCmyk(`#${hex(r)}${hex(g)}${hex(b)}`))
}
