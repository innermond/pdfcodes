import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { colorToCss } from './cmyk'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface PdfBackground {
  imageUrl: string
  widthPt: number
  heightPt: number
}

// Build the preview for a simple solid-color background directly from the
// stored "c:m:y:k" color, using the app's CMYK->RGB conversion (the same one the
// picker swatch and word text use). That conversion mirrors how PDF viewers
// render DeviceCMYK, so this 1x1 swatch matches the generated print PDF's actual
// appearance. `null` means no color, leaving a transparent card so the white SVG
// backdrop shows through.
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
  return { imageUrl: canvas.toDataURL('image/png'), widthPt, heightPt }
}

// Render the first page of a background PDF to an image, plus its page size
// in PDF points (matching the MediaBox-derived `card_w`/`card_h` in
// src/generate/mod.rs).
export async function renderPdfBackground(file: File): Promise<PdfBackground> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const page = await pdf.getPage(1)

  const baseViewport = page.getViewport({ scale: 1 })

  const renderScale = 2
  const renderViewport = page.getViewport({ scale: renderScale })
  const canvas = document.createElement('canvas')
  canvas.width = renderViewport.width
  canvas.height = renderViewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context indisponibil')

  // Render onto a transparent canvas instead of pdf.js's default white fill.
  // A contour PDF is just a stroked outline (no fill), so a white background
  // would make it look filled and break every blend mode except multiply. For
  // a print background the card's own white SVG backdrop shows through, so the
  // result is unchanged.
  await page.render({ canvasContext: ctx, viewport: renderViewport, background: 'rgba(0,0,0,0)' }).promise

  return {
    imageUrl: canvas.toDataURL('image/png'),
    widthPt: baseViewport.width,
    heightPt: baseViewport.height,
  }
}
