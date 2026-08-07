import { describe, it, expect } from 'vitest'
import { axisClearance, backgroundCoversCut } from './cutClearance'

// No gutter, 1 mm minimum, not shareable, unless a case says otherwise.
const axis = (over: Partial<Parameters<typeof axisClearance>[0]> = {}) =>
  axisClearance({
    gutterMm: 0,
    minDistanceMm: 1,
    canShareEdge: false,
    ...over,
  })

describe('axisClearance dead band', () => {
  // The case the whole rule exists to protect. Two neighbouring plain rectangles with no
  // gutter share one straight cut, which is what contour_as_grid draws as spanning lines.
  // Flagging this would train people to ignore the warning.
  it('leaves a shared straight edge legal at zero distance', () => {
    const a = axis({ canShareEdge: true })

    expect(a.cutToCutMm).toBe(0)
    expect(a.sharedEdge).toBe(true)
    expect(a.unsafe).toBe(false)
  })

  // A curve touching its neighbour is not a shared cut: two tangent circles meet at a
  // point, not along a line, so the neighbouring outlines are still two separate cuts.
  it('never treats a non-shareable contour at zero as a shared edge', () => {
    const a = axis({ canShareEdge: false })

    expect(a.cutToCutMm).toBe(0)
    expect(a.sharedEdge).toBe(false)
    expect(a.unsafe).toBe(true)
  })

  // `canShareEdge` follows whether the generator actually draws spanning grid lines, not
  // whether the shape is a rectangle. Tick "Contur Dreptunghi" — or grow the outline with
  // "Redesenează", which rounds its corners — and the cards are tiled as individual
  // rectangles, so the cutter really does trace their common edge twice.
  it('flags a rectangle at zero gutter when the cut is tiled rather than gridded', () => {
    const a = axis({ gutterMm: 0, canShareEdge: false })

    expect(a.sharedEdge).toBe(false)
    expect(a.unsafe).toBe(true)
  })

  // The distance is the gutter and nothing else: the cut page's card is the contour, so
  // room left inside the print card shrinks the cut card instead of separating the cuts.
  it('measures the gutter alone, whatever the contour leaves inside the card', () => {
    const a = axis({ gutterMm: 4 })

    expect(a.cutToCutMm).toBe(4)
    expect(a.unsafe).toBe(false)
  })

  // The false negative the old gutter-only rule produced: it exempted rectangles by kind,
  // so a tiled rectangle 1.1 mm from its neighbour passed a 2 mm minimum.
  it('flags cuts whose only separation is a small gutter', () => {
    const a = axis({ gutterMm: 1.1, minDistanceMm: 2 })

    expect(a.cutToCutMm).toBeCloseTo(1.1, 10)
    expect(a.unsafe).toBe(true)
  })

  it('accepts that same gutter once it reaches the minimum', () => {
    const a = axis({ gutterMm: 1.1, minDistanceMm: 1 })

    expect(a.unsafe).toBe(false)
  })

  // A shareable contour is exempt only at a true zero — a hair of gutter is the sliver
  // case, and the shared cut it would have had is gone.
  it('flags a shareable contour once a sliver of gutter separates the cuts', () => {
    const a = axis({ gutterMm: 0.2, canShareEdge: true })

    expect(a.cutToCutMm).toBeCloseTo(0.2, 10)
    expect(a.sharedEdge).toBe(false)
    expect(a.unsafe).toBe(true)
  })

  // A stale negative gutter should read as "touching", never as extra room.
  it('clamps a negative gutter rather than reporting slack', () => {
    const a = axis({ gutterMm: -5 })

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
