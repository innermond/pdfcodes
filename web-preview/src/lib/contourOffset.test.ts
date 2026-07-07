import { describe, it, expect } from 'vitest'
import { offsetPolygons, polygonsBBox, polygonsToPathD, segsCross, removeSelfIntersections } from './contourOffset'
import type { Pt } from './contourKeepRegion'

const square = (r: number): Pt[] => [[-r, -r], [r, -r], [r, r], [-r, r]]

// True if any pair of non-adjacent edges of a closed polygon cross in their interiors.
function hasSelfCrossing(poly: Pt[]): boolean {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // adjacent through the wrap
      if (segsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true
    }
  }
  return false
}

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

describe('segsCross', () => {
  it('returns the interior crossing point of two crossing segments', () => {
    const x = segsCross([0, 0], [2, 2], [0, 2], [2, 0])
    expect(x).not.toBeNull()
    expect(x![0]).toBeCloseTo(1, 6)
    expect(x![1]).toBeCloseTo(1, 6)
  })
  it('returns null for non-crossing, shared-endpoint, and parallel segments', () => {
    expect(segsCross([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull() // parallel
    expect(segsCross([0, 0], [1, 1], [1, 1], [2, 0])).toBeNull() // shared endpoint only
    expect(segsCross([0, 0], [1, 0], [2, 0], [3, 0])).toBeNull() // collinear, disjoint
  })
})

describe('removeSelfIntersections', () => {
  it('turns a bow-tie into a simple, non-self-crossing loop', () => {
    const bowtie: Pt[] = [[0, 0], [2, 2], [2, 0], [0, 2]]
    expect(hasSelfCrossing(bowtie)).toBe(true)
    const [clean] = removeSelfIntersections([bowtie])
    expect(clean.length).toBeGreaterThanOrEqual(3)
    expect(hasSelfCrossing(clean)).toBe(false)
  })

  it('leaves a simple square unchanged (no spurious node drops)', () => {
    const [clean] = removeSelfIntersections([square(5)])
    expect(hasSelfCrossing(clean)).toBe(false)
    expect(clean.length).toBe(4)
  })

  it('cleans a self-intersecting inward offset of a concave (L / arrow) shape', () => {
    // A concave arrow-ish polygon whose inward offset overlaps itself.
    const concave: Pt[] = [
      [0, 0], [10, 0], [10, 10], [6, 10], [6, 3], [4, 3], [4, 10], [0, 10],
    ]
    const off = offsetPolygons([concave], -2.5)
    // The raw offset self-intersects around the narrow slot; cleanup removes it.
    const cleaned = removeSelfIntersections(off)
    for (const sp of cleaned) expect(hasSelfCrossing(sp)).toBe(false)
    expect(cleaned.length).toBeGreaterThanOrEqual(1)
  })
})
