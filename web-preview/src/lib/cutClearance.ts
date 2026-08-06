// Is this job safe to cut?
//
// Two questions the imposed sheet asks, both answered here in pure geometry so they
// can be unit-tested away from the app: how close do neighbouring cut lines come, and
// does the printed background reach past the cut.
//
// ---------------------------------------------------------------------------
// 1. Cut-to-cut distance is a *dead band*, not a minimum
// ---------------------------------------------------------------------------
//
// Cards are tiled at a pitch of card + gutter (`src/geometry.rs`, `cols`/`rows`), and
// each card's cut outline sits somewhere inside its own card rectangle. The distance
// between one card's cut and its neighbour's is therefore
//
//     gutter + (this card's trailing clearance) + (the next card's leading clearance)
//
// and because every card is identical that is `gutter + trailing + leading`.
//
// Zero is not the failure. A plain rectangle at zero inset shares a straight edge with
// its neighbour along the whole boundary, so one cut serves both cards — which is
// exactly what `Options::contour_as_grid` optimises, drawing spanning grid lines
// "instead of tiling individual rectangles — eliminating the double-stroke along shared
// card edges". That must stay legal.
//
// The failure is *near* zero: two distinct cut lines a fraction of a millimetre apart,
// leaving a sliver of stock that the cutter tears out. So the safe set is
// `{0} ∪ [minDistance, ∞)`, and everything strictly between is flagged.
//
// A curve does not get the zero case. Two tangent circles meet at a single point, not
// along a line, so there is no shared cut to make — they are a sliver like any other.
export interface AxisClearance {
  // Contour footprint's leading edge → card edge (left on X, bottom on Y), mm.
  leadingMm: number
  // Card edge → footprint's trailing edge (right on X, top on Y), mm.
  trailingMm: number
  // Distance between this card's cut and the neighbouring card's, mm.
  cutToCutMm: number
  // Exactly coincident *and* legitimately shareable: one cut serves both cards.
  sharedEdge: boolean
  // Inside the dead band — distinct cut lines too close to each other.
  unsafe: boolean
}

// Distances come from user-entered millimetre fields and accumulate through additions,
// so comparisons need a tolerance rather than exact equality.
const EPS = 1e-6

export function axisClearance(params: {
  // Card extent along this axis, mm.
  cardMm: number
  // Footprint's leading edge measured from the card's leading edge, mm. This is the
  // contour's *bounding box*, which is the right measure: the bbox edge is exactly
  // where the outline reaches furthest along the axis, i.e. its closest approach to
  // the neighbouring card.
  footprintStartMm: number
  footprintSizeMm: number
  // Tiling gutter between cards along this axis, mm (`Options::offset_x_mm`).
  gutterMm: number
  minDistanceMm: number
  // May this contour legitimately share a cut with its neighbour? True only for an
  // unspun plain rectangle, whose edge is a straight line running the whole length of
  // the shared boundary — the precondition `contour_as_grid` itself requires.
  canShareEdge: boolean
}): AxisClearance {
  const { cardMm, footprintStartMm, footprintSizeMm, gutterMm, minDistanceMm, canShareEdge } = params

  // Negative clearances would mean the footprint escapes its card; the app clamps the
  // offset so it cannot, but clamp anyway so a caller passing stale numbers reports a
  // conservative 0 rather than a distance that looks larger than it is.
  const leadingMm = Math.max(0, footprintStartMm)
  const trailingMm = Math.max(0, cardMm - (footprintStartMm + footprintSizeMm))
  const cutToCutMm = Math.max(0, gutterMm) + leadingMm + trailingMm

  const coincident = cutToCutMm <= EPS
  const sharedEdge = coincident && canShareEdge

  return {
    leadingMm,
    trailingMm,
    cutToCutMm,
    sharedEdge,
    unsafe: !sharedEdge && cutToCutMm < minDistanceMm - EPS,
  }
}

// ---------------------------------------------------------------------------
// 2. Does the background reach past the cut?
// ---------------------------------------------------------------------------
//
// A cut that lands where nothing was printed exposes bare stock, and the cutter's
// registration is never perfect, so the printed area has to overshoot the cut line by
// a bleed distance rather than merely meet it.
//
// Coverage is judged geometrically — where the background was *placed* — not per pixel.
// Panning the background is what makes this reachable: content pushed past the card
// edge is clipped and "the vacated area stays transparent", and the pan is free to push
// it out entirely. A free-zone colour paints those vacated zones, so once one is set the
// whole card is covered and the question is settled.
//
// The contour's bounding box grown by the bleed is what gets tested, not its outline.
// That is conservative by construction: the box contains the outline, so this can
// over-warn for a curved contour near a rotated background corner, but it cannot miss a
// real exposure. For a warning that is the right way round.
export function backgroundCoversCut(params: {
  cardWidthMm: number
  cardHeightMm: number
  // Background pan within the card (mm; X right, Y up).
  bgOffsetXMm: number
  bgOffsetYMm: number
  // Free-angle spin about the card centre (degrees, clockwise).
  bgSpinDeg: number
  // A free-zone colour fills everything the pan and the spin vacate.
  hasBackdropColor: boolean
  // Contour footprint in card mm (x from left, y-up from bottom).
  footprintLeftMm: number
  footprintBottomMm: number
  footprintWidthMm: number
  footprintHeightMm: number
  bleedMm: number
}): boolean {
  const {
    cardWidthMm: cw, cardHeightMm: ch,
    bgOffsetXMm: ox, bgOffsetYMm: oy, bgSpinDeg,
    hasBackdropColor, bleedMm,
  } = params

  // Nothing to judge without a card.
  if (!(cw > 0) || !(ch > 0)) return true

  // The backdrop paints every zone the background does not, so the card is fully
  // covered regardless of how far it was panned or spun.
  if (hasBackdropColor) return true

  const bleed = Math.max(0, bleedMm)
  // Clamped to the card, because the card is all this background can answer for. A
  // contour running to the card edge would otherwise demand coverage *outside* the
  // card, which no background can provide and no user can fix — and it does not need
  // to: past that edge lies the neighbouring card or the gutter, which is the
  // cut-to-cut question, not this one.
  const left = Math.max(0, params.footprintLeftMm - bleed)
  const bottom = Math.max(0, params.footprintBottomMm - bleed)
  const right = Math.min(cw, params.footprintLeftMm + params.footprintWidthMm + bleed)
  const top = Math.min(ch, params.footprintBottomMm + params.footprintHeightMm + bleed)

  // The four corners of the grown footprint. The covered region is convex in both
  // branches below (an axis-aligned rectangle, or the card rectangle rotated about its
  // centre), so all four corners being inside means the whole box is inside.
  const corners: Array<[number, number]> = [
    [left, bottom], [right, bottom], [right, top], [left, top],
  ]

  if (bgSpinDeg % 360 === 0) {
    // Pan only: the covered region is the card rectangle intersected with itself
    // translated by the pan — content outside the card is clipped away.
    const coveredLeft = Math.max(0, ox)
    const coveredRight = Math.min(cw, cw + ox)
    const coveredBottom = Math.max(0, oy)
    const coveredTop = Math.min(ch, ch + oy)

    return corners.every(([x, y]) =>
      x >= coveredLeft - EPS && x <= coveredRight + EPS &&
      y >= coveredBottom - EPS && y <= coveredTop + EPS)
  }

  // Spun: the covered region is the panned card rectangle rotated about the card
  // centre. Rotating each test point by the inverse spin about that centre puts it back
  // in the rectangle's own frame, where the check is the axis-aligned one again.
  const rad = (-bgSpinDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = cw / 2
  const cy = ch / 2

  return corners.every(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    // Clockwise degrees, y-up frame: undoing the spin rotates by -spin.
    const rx = cx + dx * cos - dy * sin
    const ry = cy + dx * sin + dy * cos
    return rx >= ox - EPS && rx <= cw + ox + EPS
      && ry >= oy - EPS && ry <= ch + oy + EPS
  })
}
