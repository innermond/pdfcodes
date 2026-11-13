import { describe, it, expect, vi } from 'vitest'

vi.mock('../paraglide/messages', () => ({ m: { errors_contour_image_load: () => 'x' } }))

import { refineLoop, smoothClosed } from './contourInteriorMask'

type P = [number, number]

// Pixel-edge staircase of a filled circle (what the tracer emits), closed.
function circleStaircase(r: number, noise = 0): P[] {
  const pts: P[] = []
  const jitter = (x: number, y: number) => noise * Math.sin(x * 12.9898 + y * 78.233) * Math.cos(x * 3.1 - y * 1.7)
  const inside = (x: number, y: number) => Math.hypot(x + 0.5 - r, y + 0.5 - r) <= r + jitter(x, y)
  // Walk the boundary of the pixel set: collect lattice points by scanning column spans.
  const n = 2 * r
  const top: P[] = []
  const bottom: P[] = []
  for (let x = 0; x < n; x++) {
    let y0 = -1
    let y1 = -1
    for (let y = 0; y < n; y++) {
      if (inside(x, y)) {
        if (y0 < 0) y0 = y
        y1 = y + 1
      }
    }
    if (y0 < 0) continue
    top.push([x, y0], [x + 1, y0])
    bottom.push([x, y1], [x + 1, y1])
  }
  pts.push(...top, ...bottom.reverse())
  pts.push(pts[0])
  return pts
}

function rectLoop(w: number, h: number): P[] {
  const pts: P[] = []
  for (let x = 0; x < w; x++) pts.push([x, 0])
  for (let y = 0; y < h; y++) pts.push([w, y])
  for (let x = w; x > 0; x--) pts.push([x, h])
  for (let y = h; y > 0; y--) pts.push([0, y])
  pts.push([0, 0])
  return pts
}

describe('refineLoop', () => {
  it('with both options off it is plain Douglas–Peucker', () => {
    const loop = circleStaircase(200)
    expect(refineLoop(loop, 1, false, false).length).toBeGreaterThan(8)
  })

  it('smooth + simplify cuts the points of a noisy edge and stays close to the true circle', () => {
    const r = 200
    const loop = circleStaircase(r, 1.2)
    const base = refineLoop(loop, 1, false, false)
    const both = refineLoop(loop, 1, true, true)
    expect(both.length).toBeLessThan(base.length * 0.6)
    for (const [x, y] of both) {
      expect(Math.abs(Math.hypot(x - r, y - r) - r)).toBeLessThan(2.5)
    }
  })

  it('simplify alone never adds points', () => {
    const loop = circleStaircase(200, 1.2)
    expect(refineLoop(loop, 1, false, true).length).toBeLessThanOrEqual(refineLoop(loop, 1, false, false).length)
  })

  it('keeps rectangle corners sharp when smoothing', () => {
    const out = refineLoop(rectLoop(80, 50), 1, true, true)
    for (const c of [[0, 0], [80, 0], [80, 50], [0, 50]]) {
      const d = Math.min(...out.map(([x, y]) => Math.hypot(x - c[0], y - c[1])))
      expect(d).toBeLessThan(1)
    }
    expect(out.length).toBeLessThanOrEqual(12)
  })
})

describe('smoothClosed', () => {
  it('returns a closed loop and passes tiny loops through', () => {
    const out = smoothClosed(circleStaircase(30), 1.5)
    expect(out[0]).toEqual(out[out.length - 1])
    const tiny: P[] = [[0, 0], [1, 0], [1, 1], [0, 0]]
    expect(smoothClosed(tiny, 1.5)).toBe(tiny)
  })
})
