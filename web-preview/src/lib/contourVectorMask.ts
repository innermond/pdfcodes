// Derive the preview "keep" mask for an uploaded contour PDF directly from its
// *vector* drawing operations, instead of rasterizing and tracing the pixels (see
// `contourInteriorMask.ts`, kept as a fallback). The shared operator walker
// (`contourOps.ts`) hands back the painted paths; we union their subpaths into one SVG
// path. The result keeps true Bézier curves and exact corners, costs no flood-fill, and
// — being real curves — stays crisp at any preview zoom.
//
// The path is emitted in fractional coordinates (0..1 of the contour box, y-down) using
// the even-odd fill rule, the exact contract CardCanvas already consumes for the traced
// path: it draws it with `transform="translate(ix iy) scale(iw ih)"` and
// `fillRule="evenodd"` so nested holes (e.g. a ring contour) render correctly.
//
// Returns null when no painted closed geometry is found (open outlines, clip-only
// contours, or PDFs whose shape comes from images/shadings we don't translate). Callers
// then fall back to the raster tracer, and finally to dimming the bounding box.
import { extractContourOps, segsToPathD, subpathArea, type Point, type Subpath } from './contourOps'

export async function computeContourVectorMaskPath(
  file: File,
  pageNumber = 1,
  rotation = 0,
): Promise<string | null> {
  const ops = await extractContourOps(file, pageNumber, rotation)
  if (!ops) return null
  const { vw, vh, paths } = ops

  // Collect every painted subpath (stroke or fill counts as keep geometry — a contour is
  // usually a stroked cut line, but filled shapes work too). Drop slivers so a stray
  // hairline doesn't register as the whole keep region.
  const minArea = vw * vh * 1e-5
  const kept: Subpath[] = []
  let totalArea = 0
  for (const path of paths) {
    if (!path.stroke && !path.fill) continue
    for (const sp of path.subpaths) {
      const area = subpathArea(sp)
      if (area < minArea) continue
      totalArea += area
      kept.push(sp)
    }
  }
  if (kept.length === 0 || totalArea < vw * vh * 1e-4) return null

  const f = (v: number) => +v.toFixed(5)
  const norm = (p: Point): Point => [p[0] / vw, p[1] / vh]
  const d = segsToPathD(kept, norm, f, true)
  return d || null
}
