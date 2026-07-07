import { describe, expect, it } from 'vitest'
import { previewPointToBackgroundFrac } from './colorSample'

describe('previewPointToBackgroundFrac', () => {
  const card = { cardWidthPt: 200, cardHeightPt: 100 }

  it('is the identity with no offset or spin', () => {
    expect(previewPointToBackgroundFrac(0.5, 0.5, card)).toEqual({ fx: 0.5, fy: 0.5 })
    expect(previewPointToBackgroundFrac(0, 1, card)).toEqual({ fx: 0, fy: 1 })
  })

  it('subtracts the pan offset (PDF y-up offset vs. SVG y-down click)', () => {
    // The background is drawn translated by (+20, −10) in SVG coords (20pt
    // right, 10pt up), so the pixel under a click at (120, 40) is image point
    // (100, 50) — the exact center.
    expect(previewPointToBackgroundFrac(0.6, 0.4, { ...card, offsetXPt: 20, offsetYPt: 10 })).toEqual({
      fx: 0.5,
      fy: 0.5,
    })
  })

  it('returns null for a click in the zone a pan vacated', () => {
    // Image shifted half a card to the right: the left edge shows the base
    // (backdrop/checker), not image content.
    expect(previewPointToBackgroundFrac(0.1, 0.5, { ...card, offsetXPt: 100 })).toBeNull()
  })

  it('un-rotates the spin about the card center', () => {
    // Square card, 90° spin: CardCanvas draws image point (75, 50) at display
    // (50, 25) — rotate(−90°) about (50, 50). The inverse must recover it.
    const r = previewPointToBackgroundFrac(0.5, 0.25, { cardWidthPt: 100, cardHeightPt: 100, spinDeg: 90 })
    expect(r).not.toBeNull()
    expect(r!.fx).toBeCloseTo(0.75)
    expect(r!.fy).toBeCloseTo(0.5)
  })

  it('returns null when the spin moves the corner out of the image', () => {
    // 2:1 card spun 90°: the card's left-center point falls outside the
    // rotated image footprint.
    expect(previewPointToBackgroundFrac(0.02, 0.5, { ...card, spinDeg: 90 })).toBeNull()
  })
})
