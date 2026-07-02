import { colorToCss } from './cmyk'
import type { PdfBackground } from './pdfBackground'

// Build the preview for a simple solid-color background directly from the
// stored "c:m:y:k" color, using the app's CMYK->RGB conversion (the same one the
// picker swatch and word text use). That conversion mirrors how PDF viewers
// render DeviceCMYK, so this 1x1 swatch matches the generated print PDF's actual
// appearance. `null` means no color, leaving a transparent card so the white SVG
// backdrop shows through.
//
// Kept in its own module (canvas + colorToCss only, no pdfjs) so the simple
// solid-color path doesn't statically pull `pdfBackground.ts` — and with it
// pdfjs-dist — into the initial bundle. `renderPdfBackground` is imported
// dynamically at its call sites instead.
export function solidColorBackground(
  color: string | null,
  widthPt: number,
  heightPt: number,
): PdfBackground {
  const canvas = document.createElement('canvas')
  // A 1x1 swatch is enough; CardCanvas stretches it with preserveAspectRatio="none".
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (ctx && color !== null) {
    ctx.fillStyle = colorToCss(color)
    ctx.fillRect(0, 0, 1, 1)
  }
  return { imageUrl: canvas.toDataURL('image/png'), widthPt, heightPt, pageCount: 1 }
}
