import { describe, it, expect } from 'vitest'
import { polygonUnitVertices, starInnerRatio, contourMaskPathD } from './contourMask'

const r = ([x, y]: [number, number]) => Math.hypot(x, y)

describe('polygonUnitVertices (star inner ratio)', () => {
  it('places outer vertices at radius 1 and inner at the explicit ratio', () => {
    const v = polygonUnitVertices(5, true, 0.2, 0.2)
    expect(v.length).toBe(10) // 5 outer + 5 inner, alternating
    expect(r(v[0])).toBeCloseTo(1, 4) // even index = outer tip
    expect(r(v[1])).toBeCloseTo(0.2, 4) // odd index = inner
  })

  it('falls back to starInnerRatio(n) when the ratio is non-positive', () => {
    const v = polygonUnitVertices(5, true, 0, 0)
    expect(r(v[1])).toBeCloseTo(starInnerRatio(5), 4)
  })

  it('supports a per-axis inner ring (rx != ry)', () => {
    const v = polygonUnitVertices(4, true, 0.6, 0.3)
    // Inner vertex 1 is at 90°+45° = 135°.
    const a = (135 * Math.PI) / 180
    expect(v[1][0]).toBeCloseTo(0.6 * Math.cos(a), 4)
    expect(v[1][1]).toBeCloseTo(0.3 * Math.sin(a), 4)
  })

  it('matches the Rust star_inner_ratio constants (pentagram / hexagram)', () => {
    expect(starInnerRatio(5)).toBeCloseTo(0.38196, 4)
    expect(starInnerRatio(6)).toBeCloseTo(0.57735, 4)
  })
})

describe('contourMaskPathD polygon star', () => {
  it('threads the inner ratio through to the emitted path (deeper notch = smaller inner span)', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 }
    const shallow = contourMaskPathD('polygon', box, { rx: 0, ry: 0, orientation: 'out', sides: 5, star: true, starInnerRx: 0.6, starInnerRy: 0.6 })
    const deep = contourMaskPathD('polygon', box, { rx: 0, ry: 0, orientation: 'out', sides: 5, star: true, starInnerRx: 0.15, starInnerRy: 0.15 })
    // Both fill the same box (outer defines the bbox), so the min-x extent is equal…
    const minX = (d: string) => Math.min(...[...d.matchAll(/[ML]\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g)].map((m) => +m[1]))
    expect(minX(shallow)).toBeCloseTo(minX(deep), 2)
    // …but a deeper notch pulls the inner vertices closer to the centre, so the set of
    // distinct x-coordinates differs (the two paths are not identical).
    expect(deep).not.toEqual(shallow)
  })
})
