// The contour's true *display footprint*: the tight axis-aligned bounding box of its
// actual outline after the 90° reorient (baked into the preset cut shape / upload box)
// AND the free spin, expressed in card mm (x from the card left, y-up from the card
// bottom — the same frame the contour offset uses).
//
// Built on `contourLocalPolygons` (contourKeepRegion.ts), so it mirrors exactly what
// CardCanvas draws and what `computeContourKeepRegion` tests — the single source of
// truth for "does the contour fit inside the background", the offset bounds, and the
// Minimal crop window. A spun shape reaches past its `boxWidth × boxHeight` box, so the
// footprint is generally larger than the box (and equals it at 0° for a box-filling
// shape).
import { contourLocalPolygons } from './contourKeepRegion'
import type { ContourCutShape } from '../components/CardCanvas'

export interface ContourFootprintMm {
  // Bottom-left corner of the footprint in card mm (x from left, y-up from bottom).
  leftMm: number
  bottomMm: number
  widthMm: number
  heightMm: number
}

export function contourDisplayFootprintMm(params: {
  // The contour's un-spun box in card mm (already reflects the 90° reorient).
  boxWidthMm: number
  boxHeightMm: number
  // Box bottom-left placement in card mm (x from left, y-up from bottom).
  offsetXMm: number
  offsetYMm: number
  // Preset cut shape (precise outline, rotation baked) or an uploaded contour's traced
  // interior mask path (0..1). With neither, the box rectangle is used.
  cutShape: ContourCutShape | null
  interiorMaskPath: string | null
  // Free-angle spin (deg) about the box center. Default 0.
  spinDeg?: number
}): ContourFootprintMm | null {
  const { boxWidthMm: bw, boxHeightMm: bh, offsetXMm, offsetYMm, spinDeg = 0 } = params
  if (!(bw > 0) || !(bh > 0)) return null

  // Outline polygons in box space (mm, SVG y-down, origin box top-left), with the
  // reorient + spin already applied.
  const polys = contourLocalPolygons({
    width: bw,
    height: bh,
    cutShape: params.cutShape,
    interiorMaskPath: params.interiorMaskPath,
    spinDeg,
  })

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const sp of polys) {
    for (const [lx, ly] of sp) {
      if (lx < minX) minX = lx
      if (lx > maxX) maxX = lx
      if (ly < minY) minY = ly
      if (ly > maxY) maxY = ly
    }
  }
  if (!isFinite(minX)) return null

  // Box space (y-down, origin box top-left) → card mm (x from left, y-up from bottom).
  return {
    leftMm: offsetXMm + minX,
    bottomMm: offsetYMm + (bh - maxY),
    widthMm: maxX - minX,
    heightMm: maxY - minY,
  }
}
