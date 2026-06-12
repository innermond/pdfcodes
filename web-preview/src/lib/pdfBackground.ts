import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface PdfBackground {
  imageUrl: string
  widthPt: number
  heightPt: number
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

  await page.render({ canvasContext: ctx, viewport: renderViewport }).promise

  return {
    imageUrl: canvas.toDataURL('image/png'),
    widthPt: baseViewport.width,
    heightPt: baseViewport.height,
  }
}
