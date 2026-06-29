// Render an uploaded contour PDF to a *vector* SVG image instead of a rasterized PNG, so
// the contour preview stays crisp when the user enlarges it (a PNG rendered at a fixed
// scale pixelates once stretched past its pixel size). It reuses the shared operator
// walker (`contourOps.ts`) to translate the PDF's drawing operators to styled SVG
// <path>s, then packs the markup into a data-URL.
//
// The result is returned as a `PdfBackground` with the same shape as
// `renderPdfBackground`, so CardCanvas keeps drawing it through the existing <image>
// element — an <image> whose href is an SVG renders as vector (resolution-independent)
// while still honoring its opacity, mix-blend-mode and preserveAspectRatio="none". No
// CardCanvas change is needed.
//
// Returns null when the page has no painted vector geometry (e.g. an image-only or
// text-only "contour"); callers fall back to the raster `renderPdfBackground`.
import { extractContourOps, segsToPathD, type Point } from './contourOps'
import type { PdfBackground } from './pdfBackground'

export async function renderContourVectorImage(
  file: File,
  pageNumber = 1,
  rotation = 0,
): Promise<PdfBackground | null> {
  const ops = await extractContourOps(file, pageNumber, rotation)
  if (!ops) return null
  const { vw, vh, pageCount, paths } = ops

  const f = (v: number) => +v.toFixed(3)
  const id = (p: Point): Point => p // device space == the SVG viewBox space
  let body = ''
  for (const path of paths) {
    if (!path.stroke && !path.fill) continue
    const d = segsToPathD(path.subpaths, id, f, false)
    if (!d) continue
    const attrs = [
      `d="${d}"`,
      path.fill ? `fill="${path.fillColor}"` : 'fill="none"',
      path.fill && path.evenOdd ? 'fill-rule="evenodd"' : '',
      path.stroke ? `stroke="${path.strokeColor}"` : '',
      // PDF line width 0 means "thinnest renderable line"; give it a hairline so it stays
      // visible at the SVG's own scale rather than vanishing.
      path.stroke ? `stroke-width="${f(Math.max(path.strokeWidth, 0.1))}"` : '',
      path.stroke && path.lineCap !== 'butt' ? `stroke-linecap="${path.lineCap}"` : '',
      path.stroke && path.lineJoin !== 'miter' ? `stroke-linejoin="${path.lineJoin}"` : '',
    ].filter(Boolean).join(' ')
    body += `<path ${attrs}/>`
  }
  if (!body) return null

  // No background fill: the contour is just an outline, matching the transparent-canvas
  // raster path so blend modes other than multiply still work (see renderPdfBackground).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(vw)} ${f(vh)}" width="${f(vw)}" height="${f(vh)}">${body}</svg>`
  const imageUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`
  return { imageUrl, widthPt: vw, heightPt: vh, pageCount }
}
