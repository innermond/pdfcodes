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
// The distance is the gutter, and only the gutter. That is not obvious, because the cut
// page has a card of its own: the contour job sends the *contour's* size as the card
// (`contourWidthOverride` in App.tsx), and `CardLayout::compute` then tiles it at a pitch
// of `card_w + gutter_x` (src/geometry.rs). So the cut outline always fills its own cut
// card exactly, and two neighbouring cuts are the gutter apart no matter how much room
// the contour leaves inside the *print* card. Pulling a contour inwards does not push the
// cuts apart — it shrinks the cut card, and the cut grid then advances more slowly than
// the print grid. (`contour_canvas_*_mm` would lay the cut page out on the print card
// instead, but src/generate/mod.rs honours it only for `no_cut`, where a page holds one
// card and there is no neighbour to measure against.)
//
// Zero is not the failure. Two neighbouring plain rectangles share a straight edge along
// the whole boundary, so one cut can serve both — which is exactly what
// `Options::contour_as_grid` draws, spanning grid lines "instead of tiling individual
// rectangles — eliminating the double-stroke along shared card edges". That must stay
// legal, but only when it is what actually gets drawn: with tiled rectangles the cutter
// really does trace the common edge twice, so `canShareEdge` follows the generator's own
// grid decision (`contourIsGrid`), not the shape's kind.
//
// The failure is *near* zero: two distinct cut lines a fraction of a millimetre apart,
// leaving a sliver of stock that the cutter tears out. So the safe set is
// `{0} ∪ [minDistance, ∞)`, and everything strictly between is flagged.
//
// A curve does not get the zero case. Two tangent circles meet at a single point, not
// along a line, so there is no shared cut to make — they are a sliver like any other.
export interface AxisClearance {
  // Distance between this card's cut and the neighbouring card's, mm.
  cutToCutMm: number
  // Exactly coincident *and* legitimately shareable: one cut serves both cards.
  sharedEdge: boolean
  // Inside the dead band — distinct cut lines too close to each other.
  unsafe: boolean
}

// Distances come from user-entered millimetre fields, so comparisons need a tolerance
// rather than exact equality.
const EPS = 1e-6

export function axisClearance(params: {
  // Tiling gutter between cards along this axis, mm (`Options::offset_x_mm`).
  gutterMm: number
  minDistanceMm: number
  // May this contour legitimately share a cut with its neighbour? True only when the cut
  // is drawn as spanning grid lines, which needs an unspun plain rectangle: its edge is
  // then a straight line running the whole length of the shared boundary, and one line
  // is what the generator emits for it.
  canShareEdge: boolean
}): AxisClearance {
  const { gutterMm, minDistanceMm, canShareEdge } = params

  const cutToCutMm = Math.max(0, gutterMm)
  const sharedEdge = cutToCutMm <= EPS && canShareEdge

  return {
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
