import { describe, it, expect } from 'vitest'
import { computeContourKeepRegion } from './contourKeepRegion'
import { MM } from './options'
import type { ContourCutShape } from '../components/CardCanvas'

// Reconstruct polygons (card points, y-up) from the packed wire form.
function polys(region: { coords: Float32Array; lens: Uint32Array }): [number, number][][] {
  const out: [number, number][][] = []
  let i = 0
  for (const len of region.lens) {
    const poly: [number, number][] = []
    for (let k = 0; k < len; k++) {
      poly.push([region.coords[i], region.coords[i + 1]])
      i += 2
    }
    out.push(poly)
  }
  return out
}

function bbox(poly: [number, number][]) {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

describe('computeContourKeepRegion', () => {
  it('returns null without a contour size', () => {
    expect(
      computeContourKeepRegion({
        cardWidthMm: 100, cardHeightMm: 60,
        contourWidthMm: 0, contourHeightMm: 0,
        offsetXMm: 0, offsetYMm: 0,
        cutShape: null, interiorMaskPath: null,
      }),
    ).toBeNull()
  })

  it('maps a full-card rectangle preset shape to the card box (y-up)', () => {
    const cutShape: ContourCutShape = {
      kind: 'rectangle', orientation: 'out', rotation: 0,
      frac: { x: 0, y: 0, w: 1, h: 1 }, rxFrac: 0, ryFrac: 0,
    }
    const region = computeContourKeepRegion({
      cardWidthMm: 100, cardHeightMm: 60,
      contourWidthMm: 100, contourHeightMm: 60,
      offsetXMm: 0, offsetYMm: 0,
      cutShape, interiorMaskPath: null,
    })!
    expect(region).not.toBeNull()
    const b = bbox(polys(region)[0])
    expect(b.minX).toBeCloseTo(0, 3)
    expect(b.minY).toBeCloseTo(0, 3)
    expect(b.maxX).toBeCloseTo(100 * MM, 2)
    expect(b.maxY).toBeCloseTo(60 * MM, 2)
  })

  it('places an offset contour box within the card and flips Y', () => {
    // 40x20mm contour, offset 10mm right / 5mm up, on an 100x60mm card.
    const region = computeContourKeepRegion({
      cardWidthMm: 100, cardHeightMm: 60,
      contourWidthMm: 40, contourHeightMm: 20,
      offsetXMm: 10, offsetYMm: 5,
      cutShape: null, interiorMaskPath: null, // -> bounding-box fallback
    })!
    const b = bbox(polys(region)[0])
    // x: offset..offset+w
    expect(b.minX).toBeCloseTo(10 * MM, 2)
    expect(b.maxX).toBeCloseTo(50 * MM, 2)
    // y-up: bottom edge at offsetY, top at offsetY+h
    expect(b.minY).toBeCloseTo(5 * MM, 2)
    expect(b.maxY).toBeCloseTo(25 * MM, 2)
  })

  it('flattens a fractional interior mask path into card points', () => {
    // A unit square mask (0..1) should scale to the contour rect.
    const d = 'M0 0 L1 0 L1 1 L0 1 Z'
    const region = computeContourKeepRegion({
      cardWidthMm: 100, cardHeightMm: 100,
      contourWidthMm: 50, contourHeightMm: 50,
      offsetXMm: 0, offsetYMm: 0,
      cutShape: null, interiorMaskPath: d,
    })!
    const b = bbox(polys(region)[0])
    expect(b.minX).toBeCloseTo(0, 3)
    expect(b.maxX).toBeCloseTo(50 * MM, 2)
    // offsetY 0 anchors the contour at the card bottom (y-up 0..50mm).
    expect(b.minY).toBeCloseTo(0, 3)
    expect(b.maxY).toBeCloseTo(50 * MM, 2)
  })
})
