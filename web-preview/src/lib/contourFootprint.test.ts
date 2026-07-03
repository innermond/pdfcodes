import { describe, it, expect } from 'vitest'
import { contourDisplayFootprintMm } from './contourFootprint'
import type { ContourCutShape } from '../components/CardCanvas'

// A box-filling rectangle preset shape (frac full, no corner radius).
const rect: ContourCutShape = {
  kind: 'rectangle', orientation: 'out', rotation: 0,
  frac: { x: 0, y: 0, w: 1, h: 1 }, rxFrac: 0, ryFrac: 0,
}

describe('contourDisplayFootprintMm', () => {
  it('returns null for a degenerate box', () => {
    expect(
      contourDisplayFootprintMm({ boxWidthMm: 0, boxHeightMm: 20, offsetXMm: 0, offsetYMm: 0, cutShape: rect, interiorMaskPath: null }),
    ).toBeNull()
  })

  it('at 0° spin the footprint equals the box', () => {
    const f = contourDisplayFootprintMm({
      boxWidthMm: 40, boxHeightMm: 20, offsetXMm: 10, offsetYMm: 5,
      cutShape: rect, interiorMaskPath: null, spinDeg: 0,
    })!
    expect(f.widthMm).toBeCloseTo(40, 4)
    expect(f.heightMm).toBeCloseTo(20, 4)
    expect(f.leftMm).toBeCloseTo(10, 4)
    expect(f.bottomMm).toBeCloseTo(5, 4)
  })

  it('a 45° spin grows the footprint to (W+H)/√2 per side, centered on the box', () => {
    const bw = 40, bh = 20, ox = 10, oy = 5
    const f = contourDisplayFootprintMm({
      boxWidthMm: bw, boxHeightMm: bh, offsetXMm: ox, offsetYMm: oy,
      cutShape: rect, interiorMaskPath: null, spinDeg: 45,
    })!
    const side = (bw + bh) / Math.SQRT2
    expect(f.widthMm).toBeCloseTo(side, 3)
    expect(f.heightMm).toBeCloseTo(side, 3)
    // Spin is about the box center, so the footprint stays centered on it.
    expect(f.leftMm + f.widthMm / 2).toBeCloseTo(ox + bw / 2, 3)
    expect(f.bottomMm + f.heightMm / 2).toBeCloseTo(oy + bh / 2, 3)
  })

  it('fills whatever host box it is given (the 90° reorient is folded into the box by the caller)', () => {
    // The caller passes the already-swapped host box (e.g. a 40×20 design rotated 90° ⇒
    // 20×40 host box). A box-filling shape then fills it, so the footprint is that host
    // box — the helper must not swap again.
    const rot90: ContourCutShape = { ...rect, rotation: 90 }
    const f = contourDisplayFootprintMm({
      boxWidthMm: 20, boxHeightMm: 40, offsetXMm: 0, offsetYMm: 0,
      cutShape: rot90, interiorMaskPath: null, spinDeg: 0,
    })!
    expect(f.widthMm).toBeCloseTo(20, 3)
    expect(f.heightMm).toBeCloseTo(40, 3)
  })

  it('an uploaded contour (no cut shape / mask) uses the box, spun', () => {
    const f = contourDisplayFootprintMm({
      boxWidthMm: 30, boxHeightMm: 30, offsetXMm: 0, offsetYMm: 0,
      cutShape: null, interiorMaskPath: null, spinDeg: 45,
    })!
    // A 30×30 square spun 45° has a bounding box of 30·√2 per side.
    expect(f.widthMm).toBeCloseTo(30 * Math.SQRT2, 3)
    expect(f.heightMm).toBeCloseTo(30 * Math.SQRT2, 3)
  })
})
