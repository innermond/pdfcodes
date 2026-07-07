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

// Minimum raster size (px) of the rendered page's longest side. A fixed scale
// suits card-sized pages, but a page much smaller than the card it previews —
// e.g. an SVG background whose declared size is a few mm — would rasterize to a
// tiny bitmap and blur when the preview stretches it. Bumping the scale to this
// floor keeps such pages sharp; the bump can't exceed the floor itself, so the
// canvas stays small. (The source stays vector throughout — the exported PDF is
// unaffected; this is preview resolution only.)
const MIN_RASTER_PX = 1200

export async function renderPdfBackground(file: File, pageNumber = 1, rotation = 0, renderScale = 2, flipX = false, flipY = false): Promise<PdfBackground> {
  const data = await file.arrayBuffer()
  // `isImageDecoderSupported: false` forces pdf.js to use its own JPEG decoder
  // instead of the browser's WebCodecs `ImageDecoder` (the default on Firefox/Safari).
  // The browser decoder honors an embedded JPEG's EXIF orientation, which a compliant
  // PDF renderer (and our generated output) ignores — so a stray orientation tag would
  // rotate the preview and mismatch the produced PDF. Ignoring EXIF keeps them in sync.
  const pdf = await pdfjsLib.getDocument({ data, isImageDecoderSupported: false }).promise
  const pageCount = pdf.numPages
  const safePage = Math.min(Math.max(1, Math.floor(pageNumber)), pageCount)
  const page = await pdf.getPage(safePage)

  // Combine the page's intrinsic /Rotate with the user-applied rotation so the
  // rendered image and the reported width/height reflect the displayed orientation
  // (the generator combines them identically, keeping preview and output in sync).
  const totalRotation = (((page.rotate + rotation) % 360) + 360) % 360
  const baseViewport = page.getViewport({ scale: 1, rotation: totalRotation, })

  // Never below the caller's scale; raised only when the page is small enough
  // that the requested scale would land under the MIN_RASTER_PX floor.
  const maxSidePt = Math.max(baseViewport.width, baseViewport.height)
  const effectiveScale = maxSidePt > 0 ? Math.max(renderScale, MIN_RASTER_PX / maxSidePt) : renderScale

  const renderViewport = page.getViewport({ scale: effectiveScale, rotation: totalRotation, })
  const canvas = document.createElement('canvas')
  canvas.width = renderViewport.width
  canvas.height = renderViewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context indisponibil')

  // Mirror the rendered raster in device space when requested. Applied as an extra
  // transform on top of the viewport, so it flips the already-rotated output — the
  // same axes the generator flips (see the flip `cm` in src/generate/mod.rs),
  // keeping preview and output in sync. A mirror doesn't change width/height.
  const transform = (flipX || flipY)
    ? [flipX ? -1 : 1, 0, 0, flipY ? -1 : 1, flipX ? renderViewport.width : 0, flipY ? renderViewport.height : 0]
    : undefined

  // Render onto a transparent canvas instead of pdf.js's default white fill.
  // A contour PDF is just a stroked outline (no fill), so a white background
  // would make it look filled and break every blend mode except multiply. For
  // a print background the card's own white SVG backdrop shows through, so the
  // result is unchanged.
  await page.render({ canvasContext: ctx, viewport: renderViewport, background: 'rgba(0,0,0,0)', transform }).promise

  return {
    imageUrl: canvas.toDataURL('image/png'),
    widthPt: baseViewport.width,
    heightPt: baseViewport.height,
    pageCount,
  }
}
