// Codes that continue one another on a single line ("Pe același rând cu codul
// anterior") form a *unit*: laid out left to right on the first code's baseline,
// one space apart, each in its own font/size/colour, and aligned, positioned,
// rotated and flipped as a whole by the first code. Mirrors `plan_units` in
// src/generate/cards.rs — keep the grouping rule and the layout in step with it.
import { isSymbolKind, MM, type Align, type ContourAlignRect, type WordStyle } from './options'

// Partition the codes into units, each a list of consecutive indices (a code that
// stands alone is a unit of one). A unit starts at a text code; the following codes
// join it while they are flagged `joinPrev` and are text too — a QR or barcode
// never joins, and a symbol can't lead a unit.
export function wordUnits(words: WordStyle[]): number[][] {
  const units: number[][] = []
  let start = 0
  while (start < words.length) {
    let end = start + 1
    if (!isSymbolKind(words[start].kind)) {
      while (end < words.length && words[end].joinPrev && !isSymbolKind(words[end].kind)) end++
    }
    units.push(Array.from({ length: end - start }, (_, k) => start + k))
    start = end
  }
  return units
}

// Whether code `index` is drawn as a continuation of the previous code.
export function continuesPrevious(words: WordStyle[], index: number): boolean {
  return wordUnits(words).some((unit) => unit.length > 1 && unit.indexOf(index) > 0)
}

// Whether `joinPrev` can be switched on for this code at all: there has to be a
// previous code, and both have to be text.
export function canJoinPrevious(words: WordStyle[], index: number): boolean {
  return index > 0 && !isSymbolKind(words[index].kind) && !isSymbolKind(words[index - 1].kind)
}

// Where each run starts (pt from the unit's left edge) and the unit's total width,
// given every run's measured width, its font size and its character spacing, plus
// the width of a space in the font of the run before it. An empty run takes no
// space and adds no gap.
export function unitRunOffsets(
  runs: { text: string; widthPt: number; spacePt: number }[],
): { offsets: number[]; totalPt: number } {
  const offsets: number[] = []
  let cursor = 0
  let gapAfterPrev: number | null = null
  for (const run of runs) {
    if (run.text === '') {
      offsets.push(cursor)
      continue
    }
    if (gapAfterPrev !== null) cursor += gapAfterPrev
    offsets.push(cursor)
    cursor += run.widthPt
    gapAfterPrev = run.spacePt
  }
  return { offsets, totalPt: cursor }
}

// X (pt) of the unit's left edge for the leader's alignment, framing the unit's
// whole width — the same maths as `resolve_x` in src/generate/cards.rs. An explicit
// X wins, except under a `contour-*` alignment, whose X the generator resolves
// itself per code.
export function unitStartXPt(
  leader: Pick<WordStyle, 'align' | 'xMm'>,
  totalPt: number,
  cardWidthPt: number,
  safeMarginMm: number,
  contour: ContourAlignRect | null | undefined,
  contourInsetMm: number,
): number {
  const align: Align = leader.align
  const isContour = align === 'contour-left' || align === 'contour-center' || align === 'contour-right'
  if (leader.xMm !== null && !isContour) return leader.xMm * MM
  const useContour = isContour && contour != null
  const marginPt = (useContour ? contourInsetMm : safeMarginMm) * MM
  const leftPt = useContour ? contour.leftMm * MM : 0
  const widthPt = useContour ? contour.widthMm * MM : cardWidthPt
  switch (align) {
    case 'left':
    case 'contour-left':
      return leftPt + marginPt
    case 'right':
    case 'contour-right':
      return leftPt + widthPt - totalPt - marginPt
    default:
      return leftPt + (widthPt - totalPt) / 2
  }
}
