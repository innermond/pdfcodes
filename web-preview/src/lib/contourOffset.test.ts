import { describe, it, expect } from 'vitest'
import { offsetPolygons, polygonsBBox, polygonsToPathD } from './contourOffset'
import type { Pt } from './contourKeepRegion'

const square = (r: number): Pt[] => [[-r, -r], [r, -r], [r, r], [-r, r]]

describe('offsetPolygons', () => {
  it('grows a CCW square outward by exactly the distance on every side', () => {
    const out = offsetPolygons([square(5)], 1)
    const b = polygonsBBox(out)!
    expect(b.minX).toBeCloseTo(-6, 3)
    expect(b.maxX).toBeCloseTo(6, 3)
    expect(b.minY).toBeCloseTo(-6, 3)
    expect(b.maxY).toBeCloseTo(6, 3)
  })

  it('shrinks inward with a negative distance and keeps sharp corners (miter)', () => {
    const out = offsetPolygons([square(5)], -1)
    const b = polygonsBBox(out)!
    expect(b.minX).toBeCloseTo(-4, 3)
    expect(b.maxX).toBeCloseTo(4, 3)
    // A shrunk rectangle keeps square corners, so its outline is still 4 vertices.
    expect(out[0].length).toBe(4)
  })

  it('is winding-agnostic: a CW square also grows outward', () => {
    const cw = square(5).slice().reverse()
    const b = polygonsBBox(offsetPolygons([cw], 1))!
    expect(b.maxX).toBeCloseTo(6, 3)
    expect(b.minX).toBeCloseTo(-6, 3)
  })

  it('grows the outer loop and shrinks the hole of a ring (even-odd)', () => {
    const outer = square(10)
    const hole = square(4).slice().reverse() // opposite winding => hole
    const [ao, ah] = offsetPolygons([outer, hole], 1)
    const bo = polygonsBBox([ao])!
    const bh = polygonsBBox([ah])!
    // Outer grows 10 -> 11.
    expect(bo.maxX).toBeCloseTo(11, 3)
    // Hole shrinks 4 -> 3 (more material), i.e. its half-extent drops to 3.
    expect(bh.maxX).toBeCloseTo(3, 3)
  })

  it('is a no-op for zero distance', () => {
    const input = [square(5)]
    expect(offsetPolygons(input, 0)).toBe(input)
  })

  it('rounds convex corners when growing (adds vertices)', () => {
    const out = offsetPolygons([square(5)], 2)
    // Round joins add arc points at each of the 4 corners.
    expect(out[0].length).toBeGreaterThan(8)
  })

  it('polygonsToPathD emits closed subpaths', () => {
    const d = polygonsToPathD([square(1)])
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
  })
})
