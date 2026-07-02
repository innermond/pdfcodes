import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface PdfBackground {
  imageUrl: string
  widthPt: number
  heightPt: number
  // Total number of pages in the source PDF. Always 1 for generated backgrounds
  // (solid color / shapes); >1 means the user can pick which page to use.
  pageCount: number
}

// Render one page of a background PDF to an image, plus its page size in PDF
// points (matching the MediaBox-derived `card_w`/`card_h` in
// src/generate/mod.rs) and the document's total page count. `pageNumber` is
// 1-based and clamped to the valid range; the generator must be told the same
// page number (see `background_page_number` in src/options.rs) so the print
// output matches this preview.
// `renderScale` controls the rasterization resolution (device px per PDF point).
// The default of 2 suits the on-screen preview; callers that trace the raster into
// a vector (the dim-exterior contour mask) pass a higher value so curved outlines
// are finely sampled. The reported `widthPt`/`heightPt` are scale-independent.
export async function renderPdfBackground(file: File, pageNumber = 1, rotation = 0, renderScale = 2): Promise<PdfBackground> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const pageCount = pdf.numPages
  const safePage = Math.min(Math.max(1, Math.floor(pageNumber)), pageCount)
  const page = await pdf.getPage(safePage)

  // Combine the page's intrinsic /Rotate with the user-applied rotation so the
  // rendered image and the reported width/height reflect the displayed orientation
  // (the generator combines them identically, keeping preview and output in sync).
  const totalRotation = (((page.rotate + rotation) % 360) + 360) % 360
  const baseViewport = page.getViewport({ scale: 1, rotation: totalRotation })

  const renderViewport = page.getViewport({ scale: renderScale, rotation: totalRotation })
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
    pageCount,
  }
}
