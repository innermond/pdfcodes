import { describe, it, expect } from 'vitest'
import { axisClearance, backgroundCoversCut } from './cutClearance'

// A 50 mm card, 1 mm minimum, unless a case says otherwise.
const axis = (over: Partial<Parameters<typeof axisClearance>[0]> = {}) =>
  axisClearance({
    cardMm: 50,
    footprintStartMm: 0,
    footprintSizeMm: 50,
    gutterMm: 0,
    minDistanceMm: 1,
    canShareEdge: false,
    ...over,
  })

describe('axisClearance dead band', () => {
  // The case the whole rule exists to protect. A plain rectangle at zero inset with no
  // gutter shares one straight cut with its neighbour, which is what contour_as_grid
  // draws as spanning lines. Flagging this would train people to ignore the warning.
  it('leaves a shared straight edge legal at zero distance', () => {
    const a = axis({ canShareEdge: true })

    expect(a.cutToCutMm).toBe(0)
    expect(a.sharedEdge).toBe(true)
    expect(a.unsafe).toBe(false)
  })

  // A curve touching the card edge is not a shared cut: two tangent circles meet at a
  // point, not along a line, so the neighbouring outlines are still two separate cuts.
  it('never treats a non-shareable contour at zero as a shared edge', () => {
    const a = axis({ canShareEdge: false })

    expect(a.cutToCutMm).toBe(0)
    expect(a.sharedEdge).toBe(false)
    expect(a.unsafe).toBe(true)
  })

  // The false positive today's rule produces: it warns on any non-rectangular contour
  // with a gutter under 1 mm, even when the contour is nowhere near the card edge.
  it('accepts an inset contour with no gutter at all', () => {
    // 2 mm clear on each side, so neighbouring cuts are 4 mm apart with a zero gutter.
    const a = axis({ footprintStartMm: 2, footprintSizeMm: 46, gutterMm: 0 })

    expect(a.leadingMm).toBe(2)
    expect(a.trailingMm).toBe(2)
    expect(a.cutToCutMm).toBe(4)
    expect(a.unsafe).toBe(false)
  })

  // The false negative today's rule produces: the gutter clears 1 mm, so nothing warns,
  // yet the cuts really are 1.1 mm apart because the contour touches both edges.
  it('flags an edge-touching contour whose only separation is a small gutter', () => {
    const a = axis({ gutterMm: 1.1, minDistanceMm: 2 })

    expect(a.cutToCutMm).toBeCloseTo(1.1, 10)
    expect(a.unsafe).toBe(true)
  })

  it('accepts that same contour once the gutter reaches the minimum', () => {
    const a = axis({ gutterMm: 1.1, minDistanceMm: 1 })

    expect(a.unsafe).toBe(false)
  })

  // The hole left by keying the exemption to shape kind without checking the inset: a
  // rectangle inset a fraction of a millimetre no longer shares an edge, it leaves a
  // sliver — and today it is exempted precisely because it is a rectangle.
  it('flags a barely-inset rectangle even though it is shareable in principle', () => {
    const a = axis({ footprintStartMm: 0.1, footprintSizeMm: 49.8, gutterMm: 0, canShareEdge: true })

    expect(a.cutToCutMm).toBeCloseTo(0.2, 10)
    expect(a.sharedEdge).toBe(false)
    expect(a.unsafe).toBe(true)
  })

  it('adds the gutter to both cards clearances', () => {
    const a = axis({ footprintStartMm: 1, footprintSizeMm: 48, gutterMm: 3 })

    // 1 mm this side + 1 mm the neighbour's + 3 mm gutter.
    expect(a.cutToCutMm).toBe(5)
    expect(a.unsafe).toBe(false)
  })

  // A stale offset should read as "touching", never as extra room.
  it('clamps a footprint that escapes its card rather than reporting slack', () => {
    const a = axis({ footprintStartMm: -5, footprintSizeMm: 60 })

    expect(a.leadingMm).toBe(0)
    expect(a.trailingMm).toBe(0)
    expect(a.cutToCutMm).toBe(0)
  })
})

describe('backgroundCoversCut', () => {
  const base = {
    cardWidthMm: 50,
    cardHeightMm: 50,
    bgOffsetXMm: 0,
    bgOffsetYMm: 0,
    bgSpinDeg: 0,
    hasBackdropColor: false,
    footprintLeftMm: 5,
    footprintBottomMm: 5,
    footprintWidthMm: 40,
    footprintHeightMm: 40,
    bleedMm: 1,
  }

  it('is satisfied by an unpanned background that fills the card', () => {
    expect(backgroundCoversCut(base)).toBe(true)
  })

  // A contour running to the card edge cannot be asked for bleed *outside* the card:
  // nothing can supply it and no setting can fix it, so demanding it would be a warning
  // the user can only silence by giving up the design. Past that edge sits the
  // neighbouring card or the gutter — the cut-to-cut question, answered elsewhere.
  it('does not demand bleed outside the card for a full-card contour', () => {
    expect(backgroundCoversCut({
      ...base,
      footprintLeftMm: 0, footprintBottomMm: 0, footprintWidthMm: 50, footprintHeightMm: 50,
      bleedMm: 1,
    })).toBe(true)
  })

  // ...but the part of that demand which *is* inside the card still counts.
  it('still fails a full-card contour when the pan bares a strip inside the card', () => {
    expect(backgroundCoversCut({
      ...base,
      footprintLeftMm: 0, footprintBottomMm: 0, footprintWidthMm: 50, footprintHeightMm: 50,
      bleedMm: 1,
      bgOffsetXMm: 8,
    })).toBe(false)
  })

  // The reachable failure: panning vacates a strip that stays transparent, and here the
  // strip reaches under the cut line.
  it('fails when the pan vacates a strip beneath the cut', () => {
    // Panned 8 mm right: the left 8 mm of the card is bare, but the cut needs
    // everything from 4 mm (5 mm footprint − 1 mm bleed) rightwards.
    expect(backgroundCoversCut({ ...base, bgOffsetXMm: 8 })).toBe(false)
  })

  it('tolerates a pan that vacates a strip clear of the cut', () => {
    // Panned 3 mm: bare up to 3 mm, and the cut plus bleed starts at 4 mm.
    expect(backgroundCoversCut({ ...base, bgOffsetXMm: 3 })).toBe(true)
  })

  // The bleed is the point: merely meeting the cut line is not enough.
  it('fails when the background meets the cut exactly but does not overshoot it', () => {
    expect(backgroundCoversCut({ ...base, bgOffsetXMm: 5 })).toBe(false)
    // ...and the same placement is fine once no bleed is demanded.
    expect(backgroundCoversCut({ ...base, bgOffsetXMm: 5, bleedMm: 0 })).toBe(true)
  })

  // A free-zone colour paints everything the pan vacates, so coverage stops being a
  // question however far the background was pushed.
  it('is always satisfied once a free-zone colour is set', () => {
    expect(backgroundCoversCut({ ...base, bgOffsetXMm: 40, hasBackdropColor: true })).toBe(true)
  })

  it('fails when the background is panned fully out', () => {
    expect(backgroundCoversCut({ ...base, bgOffsetXMm: 50 })).toBe(false)
  })

  // Spinning vacates the corners; a contour reaching into one is exposed.
  it('fails when a spin vacates the corner the cut reaches into', () => {
    const cornerHugging = {
      ...base,
      footprintLeftMm: 0,
      footprintBottomMm: 0,
      footprintWidthMm: 50,
      footprintHeightMm: 50,
      bleedMm: 0,
      bgSpinDeg: 15,
    }

    expect(backgroundCoversCut(cornerHugging)).toBe(false)
    // Unspun, the same full-card contour is exactly covered.
    expect(backgroundCoversCut({ ...cornerHugging, bgSpinDeg: 0 })).toBe(true)
  })

  it('tolerates a spin when the cut sits well inside the card', () => {
    expect(backgroundCoversCut({
      ...base,
      footprintLeftMm: 20, footprintBottomMm: 20, footprintWidthMm: 10, footprintHeightMm: 10,
      bgSpinDeg: 15,
    })).toBe(true)
  })

  it('has nothing to judge without a card', () => {
    expect(backgroundCoversCut({ ...base, cardWidthMm: 0 })).toBe(true)
  })
})
