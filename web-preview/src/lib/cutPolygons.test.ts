import { describe, it, expect } from 'vitest'
import { dropSpecks, findCutDefects, offsetClean, simplifyEvenOdd, unionPolygons } from './cutPolygons'
import type { Pt } from './contourKeepRegion'

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const area = (p: Pt[]) => {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]
  return Math.abs(a) / 2
}
const bbox = (ps: Pt[][]) => {
  const xs = ps.flat().map((p) => p[0]), ys = ps.flat().map((p) => p[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

describe('unionPolygons', () => {
  it('merges an exact duplicate loop into one', () => {
    const out = unionPolygons([rect(0, 0, 10, 10), rect(0, 0, 10, 10)])
    expect(out).toHaveLength(1)
    expect(area(out[0])).toBeCloseTo(100, 3)
  })
  it('merges overlapping rects into a single outline', () => {
    const out = unionPolygons([rect(0, 0, 10, 10), rect(5, 0, 15, 10)])
    expect(out).toHaveLength(1)
    expect(area(out[0])).toBeCloseTo(150, 3)
  })
  it('merges rects sharing an edge (no coincident edge left)', () => {
    const out = unionPolygons([rect(0, 0, 10, 10), rect(10, 0, 20, 10)])
    expect(out).toHaveLength(1)
    expect(area(out[0])).toBeCloseTo(200, 3)
  })
  it('treats every loop as filled and any winding alike: a nested loop is absorbed', () => {
    const out = unionPolygons([rect(0, 0, 20, 20), rect(5, 5, 15, 15).reverse()])
    expect(out).toHaveLength(1)
    expect(area(out[0])).toBeCloseTo(400, 3)
  })
})

describe('simplifyEvenOdd', () => {
  it('splits a bow-tie into simple loops', () => {
    const bow: Pt[] = [[0, 0], [10, 10], [10, 0], [0, 10]]
    const out = simplifyEvenOdd([bow])
    expect(out).toHaveLength(2)
    expect(out.reduce((s, p) => s + area(p), 0)).toBeCloseTo(50, 2)
  })
})

describe('offsetClean', () => {
  it('grows a square by the distance', () => {
    const b = bbox(offsetClean([rect(0, 0, 10, 10)], 1))
    expect([b.x0, b.x1, b.y0, b.y1].map((v) => Math.round(v))).toEqual([-1, 11, -1, 11])
  })
  it('shrinks keeping sharp corners (still 4 vertices)', () => {
    const out = offsetClean([rect(0, 0, 10, 10)], -1)
    expect(out).toHaveLength(1)
    expect(out[0]).toHaveLength(4)
    expect(area(out[0])).toBeCloseTo(64, 2)
  })
  it('merges two parts that grow into each other', () => {
    const out = offsetClean([rect(0, 0, 10, 10), rect(11, 0, 21, 10)], 1)
    expect(out).toHaveLength(1)
  })
  it('closes a hole that grows into itself and drops a thin part when shrinking', () => {
    expect(offsetClean([rect(0, 0, 20, 20), rect(9, 9, 11, 11)], 2)).toHaveLength(1)
    expect(offsetClean([rect(0, 0, 10, 10), rect(20, 0, 22, 10)], -2)).toHaveLength(1)
  })
})

describe('dropSpecks / findCutDefects', () => {
  it('drops tiny loops', () => {
    expect(dropSpecks([rect(0, 0, 10, 10), rect(0, 0, 0.1, 0.1)], 0.25)).toHaveLength(1)
  })
  it('flags overlap and passes a cleaned set', () => {
    const bad = [rect(0, 0, 10, 10), rect(5, 0, 15, 10)]
    expect(findCutDefects(bad, 0.25).overlapping).toBe(true)
    expect(findCutDefects(unionPolygons(bad), 0.25).overlapping).toBe(false)
  })
})
