// The cut contour's "keep" region, expressed the way the Rust generator's
// text-overflow check wants it: closed polygons in *card* coordinates (PDF
// points, y-up), even-odd fill. The generator flags a code whose glyph outlines
// aren't fully inside this region (see `Options::contour_keep_polygons` and
// `code_fits_contour` in src/generate/cards.rs).
//
// The geometry mirrors CardCanvas's `contourKeepShape` (components/CardCanvas.tsx)
// so the tested region lines up exactly with the rendered cut: the contour image
// occupies the rect [ix, iy, iw, ih] in card points, a preset shape is built with
// `contourMaskPathD` (+ rotation), and an uploaded contour uses its traced
// interior mask path scaled into that rect. Curves are flattened to polylines,
// then y is flipped from SVG (y-down) to PDF card space (y-up).
import { MM } from './options'
import { contourMaskPathD } from './contourMask'
import type { ContourCutShape } from '../components/CardCanvas'

export interface ContourKeepRegion {
  // Flat [x0, y0, x1, y1, ...] vertices, card points, y-up.
  coords: Float32Array
  // Vertex count of each closed subpath (even-odd).
  lens: Uint32Array
}

export type Pt = [number, number]

// Flatten an SVG path `d` (only the absolute M/L/C/Z commands our producers emit —
// `contourMaskPathD` and `segsToPathD`) into closed subpaths of points, in the
// path's own coordinate space. Cubic segments are subdivided into `steps` lines.
export function flattenPathD(d: string, steps = 24): Pt[][] {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  if (!tokens) return []
  const subpaths: Pt[][] = []
  let cur: Pt[] = []
  let start: Pt = [0, 0]
  let last: Pt = [0, 0]
  let i = 0
  const num = () => parseFloat(tokens[i++])
  while (i < tokens.length) {
    const t = tokens[i++]
    switch (t) {
      case 'M': {
        if (cur.length >= 2) subpaths.push(cur)
        const p: Pt = [num(), num()]
        cur = [p]
        start = p
        last = p
        break
      }
      case 'L': {
        const p: Pt = [num(), num()]
        cur.push(p)
        last = p
        break
      }
      case 'C': {
        const c1: Pt = [num(), num()]
        const c2: Pt = [num(), num()]
        const p: Pt = [num(), num()]
        for (let s = 1; s <= steps; s++) {
          const u = s / steps
          const mu = 1 - u
          const x = mu * mu * mu * last[0] + 3 * mu * mu * u * c1[0] + 3 * mu * u * u * c2[0] + u * u * u * p[0]
          const y = mu * mu * mu * last[1] + 3 * mu * mu * u * c1[1] + 3 * mu * u * u * c2[1] + u * u * u * p[1]
          cur.push([x, y])
        }
        last = p
        break
      }
      case 'Z':
        // Close: the polygon is implicitly closed by the consumer, so just end it.
        last = start
        break
    }
  }
  if (cur.length >= 2) subpaths.push(cur)
  return subpaths
}

// SVG `rotate(deg, cx, cy)` applied to a point (clockwise in the y-down card frame,
// matching CardCanvas's rotation of the preset mask).
export function rotate(p: Pt, cx: number, cy: number, deg: number): Pt {
  if (!deg) return p
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = p[0] - cx
  const dy = p[1] - cy
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
}

// Flatten the contour outline into closed polygons in the contour's own box
// space: coordinates in `width` x `height` units (mm or points — the caller's
// choice), SVG y-down, origin at the box's top-left. A preset shape is built with
// `contourMaskPathD` (rotation baked in); an uploaded contour uses its traced
// interior mask path (0..1) scaled into the box; with neither, the box rectangle
// is returned. Shared by `computeContourKeepRegion` and the "Redesenează" offset
// stage (contourOffset.ts) so the tested/offset outline matches the rendered cut.
export function contourLocalPolygons(params: {
  width: number
  height: number
  cutShape: ContourCutShape | null
  interiorMaskPath: string | null
  // Free-angle spin (deg) applied about the box center on top of the preset reorient,
  // matching CardCanvas's `rotate(-spin)` on the contour group. Default 0.
  spinDeg?: number
}): Pt[][] {
  const { width: iw, height: ih, spinDeg = 0 } = params
  const local = contourLocalPolygonsUnspun(params)
  if (!spinDeg) return local
  return local.map((sp) => sp.map((p) => rotate(p, iw / 2, ih / 2, -spinDeg)))
}

function contourLocalPolygonsUnspun(params: {
  width: number
  height: number
  cutShape: ContourCutShape | null
  interiorMaskPath: string | null
}): Pt[][] {
  const { width: iw, height: ih } = params
  if (params.cutShape) {
    const { frac, rxFrac, ryFrac, kind, orientation, rotation, sides, star } = params.cutShape
    const rot = ((rotation % 360) + 360) % 360
    const cx = iw / 2
    const cy = ih / 2
    const swapped = rot === 90 || rot === 270
    const boxW = swapped ? ih : iw
    const boxH = swapped ? iw : ih
    const x0 = cx - boxW / 2
    const y0 = cy - boxH / 2
    const d = contourMaskPathD(
      kind,
      // Flip Y: the normalized box is PDF y-up; the footprint is SVG y-down.
      { x: x0 + frac.x * boxW, y: y0 + (1 - (frac.y + frac.h)) * boxH, w: frac.w * boxW, h: frac.h * boxH },
      { rx: rxFrac * boxW, ry: ryFrac * boxH, orientation, sides, star },
    )
    return flattenPathD(d).map((sp) => sp.map((p) => rotate(p, cx, cy, rot)))
  }
  if (params.interiorMaskPath) {
    // Fractional (0..1) coords scaled into the contour box.
    return flattenPathD(params.interiorMaskPath).map((sp) =>
      sp.map(([fx, fy]): Pt => [fx * iw, fy * ih]),
    )
  }
  // No fillable shape (open outline, still computing): keep the bounding box.
  return [[[0, 0], [iw, 0], [iw, ih], [0, ih]]]
}

export function computeContourKeepRegion(params: {
  cardWidthMm: number
  cardHeightMm: number
  contourWidthMm: number
  contourHeightMm: number
  offsetXMm: number
  offsetYMm: number
  // Preset shape (precise cut) or, for an uploaded contour, its traced interior
  // mask path (0..1, y-down, even-odd). When both are null the keep region falls
  // back to the contour's bounding rectangle.
  cutShape: ContourCutShape | null
  interiorMaskPath: string | null
  // Free-angle spin (deg) about the contour center, matching the preview + the generator.
  spinDeg?: number
}): ContourKeepRegion | null {
  const { cardWidthMm, cardHeightMm, contourWidthMm, contourHeightMm, offsetXMm, offsetYMm } = params
  if (!(cardWidthMm > 0) || !(cardHeightMm > 0) || !(contourWidthMm > 0) || !(contourHeightMm > 0)) {
    return null
  }

  const cardHeightPt = cardHeightMm * MM
  const ix = offsetXMm * MM
  const iw = contourWidthMm * MM
  const ih = contourHeightMm * MM
  const iy = cardHeightPt - ih - offsetYMm * MM

  // Build the keep region in the contour box (SVG y-down), translate to the card
  // and flip y below.
  const subpaths = contourLocalPolygons({ width: iw, height: ih, cutShape: params.cutShape, interiorMaskPath: params.interiorMaskPath, spinDeg: params.spinDeg })
    .map((sp) => sp.map(([lx, ly]): Pt => [ix + lx, iy + ly]))

  // Flip to PDF card space (y-up) and pack. Drop degenerate subpaths.
  const coords: number[] = []
  const lens: number[] = []
  for (const sp of subpaths) {
    if (sp.length < 3) continue
    for (const [x, y] of sp) {
      coords.push(x, cardHeightPt - y)
    }
    lens.push(sp.length)
  }
  if (lens.length === 0) return null

  return { coords: new Float32Array(coords), lens: new Uint32Array(lens) }
}
