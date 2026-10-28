// Derive a cut outline from the card (print background) itself, for when no contour
// is supplied. Vector cards: the outermost painted closed shapes (inner artwork would
// only add cut lines, so nested loops are dropped). Raster / transparent cards, or a
// vector page whose shapes are just small decoration: the alpha silhouette, traced the
// same way as an uploaded PNG contour. Returns null when neither yields a usable
// shape (e.g. a fully opaque card) — callers then cut the card rectangle.
//
// The path is in fractions of the card (0..1, y-down), the contract of
// `contourLocalPolygons`' `interiorMaskPath`.
import { extractContourOps, segsToPathD, subpathArea, type Point } from './contourOps'
import { flattenPathD, type Pt } from './contourKeepRegion'
import { polygonsToPathD } from './contourOffset'
import { unionPolygons } from './cutPolygons'
import { computeContourInteriorMaskPath } from './contourInteriorMask'
import { renderPdfBackground } from './pdfBackground'

// A vector outline smaller than this share of the page is treated as decoration, not the
// card's silhouette, and the alpha trace is tried instead.
const MIN_PAGE_SHARE = 0.25

async function vectorOutline(file: File, page: number, rotation: number): Promise<string | null> {
  const ops = await extractContourOps(file, page, rotation, false)
  if (!ops) return null
  const { vw, vh, paths } = ops
  const minArea = vw * vh * 1e-5
  const candidates: { sp: (typeof paths)[number]['subpaths'][number]; area: number }[] = []
  for (const path of paths) {
    if (!path.stroke && !path.fill) continue
    for (const sp of path.subpaths) {
      const area = subpathArea(sp)
      if (area >= minArea && sp.segs.length >= 3) candidates.push({ sp, area })
    }
  }
  // Flatten each candidate loop and union them (fractions of the page): duplicates
  // (a shape painted as fill + stroke), overlaps and shared edges merge into one
  // outline, so no stretch of the cut is traced twice. Interior holes are dropped —
  // artwork inside the card must not become cut lines.
  const f = (v: number) => +v.toFixed(5)
  const norm = (p: Point): Point => [p[0] / vw, p[1] / vh]
  const loops: Pt[][] = []
  for (const { sp } of candidates) {
    const flat = flattenPathD(segsToPathD([sp], norm, f, true))[0]
    if (flat && flat.length >= 3) loops.push(flat)
  }
  const merged = unionPolygons(loops, { scale: 1e6, outerOnly: true })
  if (merged.length === 0) return null

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const sp of merged) {
    for (const [x, y] of sp) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x)
      y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
  }
  if ((x1 - x0) * (y1 - y0) < MIN_PAGE_SHARE) return null
  return polygonsToPathD(merged, f) || null
}

async function alphaOutline(
  file: File,
  page: number,
  rotation: number,
  flipX: boolean,
  flipY: boolean,
  alphaWall: number,
  eps: number,
): Promise<string | null> {
  const probe = await renderPdfBackground(file, page, rotation, 1, flipX, flipY)
  const maxSidePt = Math.max(probe.widthPt, probe.heightPt)
  const scale = maxSidePt > 0 ? Math.max(2, Math.min(8, 2400 / maxSidePt)) : 4
  const hires = await renderPdfBackground(file, page, rotation, scale, flipX, flipY)
  return computeContourInteriorMaskPath(hires.imageUrl, { alphaWall, eps })
}

export async function deriveCardOutline(
  file: File,
  page: number,
  rotation: number,
  flipX: boolean,
  flipY: boolean,
  alphaWall: number,
  eps: number,
): Promise<{ d: string | null; vector: boolean }> {
  const vec = await vectorOutline(file, page, rotation).catch(() => null)
  if (vec) return { d: vec, vector: true }
  const alpha = await alphaOutline(file, page, rotation, flipX, flipY, alphaWall, eps).catch(() => null)
  return { d: alpha, vector: false }
}
