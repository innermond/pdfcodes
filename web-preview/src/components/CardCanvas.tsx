import { useId, useRef } from 'react'
import { fontFamilyForWord, type LoadedFont } from '../lib/fonts'
import type { BlendMode, WordStyle } from '../lib/options'
import { contourMaskPathD } from '../lib/contourMask'
import { WordOverlay } from './WordOverlay'

// Describes the cut region for the "dim exterior" overlay. A preset shape carries
// its kind + normalized box (fractions of the contour's own space, PDF y-up) so
// the mask is shape-precise; `null` (an uploaded contour) falls back to the
// contour's bounding box.
export type ContourCutShape = {
  kind: string
  orientation: 'out' | 'in'
  frac: { x: number; y: number; w: number; h: number }
  rxFrac: number
  ryFrac: number
}

export function CardCanvas({
  backgroundImageUrl,
  cardWidthPt,
  cardHeightPt,
  contourImageUrl,
  contourWidthPt,
  contourHeightPt,
  contourOffsetXPt = 0,
  contourOffsetYPt = 0,
  contourOpacity,
  contourBlendMode,
  dimExterior = false,
  contourCutShape = null,
  words,
  fonts,
  safeMarginMm,
  backgroundPaddingMm,
  selectedIndex,
  onSelect,
  onChangeWord,
}: {
  backgroundImageUrl: string | null
  cardWidthPt: number
  cardHeightPt: number
  contourImageUrl: string | null
  contourWidthPt: number
  contourHeightPt: number
  // Translate the contour within the card (right/up positive, PDF points).
  contourOffsetXPt?: number
  contourOffsetYPt?: number
  contourOpacity: number
  contourBlendMode: BlendMode
  // Dim everything outside the cut region so the user sees what the cut keeps.
  dimExterior?: boolean
  contourCutShape?: ContourCutShape | null
  words: WordStyle[]
  fonts: (LoadedFont | null)[]
  safeMarginMm: number
  backgroundPaddingMm: number
  selectedIndex: number | null
  onSelect: (index: number) => void
  onChangeWord: (index: number, next: Partial<WordStyle>) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const maskId = useId()

  // The "dim exterior" knockout: the cut region to keep bright, positioned to
  // match exactly where the contour image is drawn below (lines for x/y/w/h).
  const dimKnockout = dimExterior && contourImageUrl ? (() => {
    const ix = contourOffsetXPt
    const iw = contourWidthPt
    const ih = contourHeightPt
    const iy = cardHeightPt - contourHeightPt - contourOffsetYPt
    if (contourCutShape) {
      const { frac, rxFrac, ryFrac, kind, orientation } = contourCutShape
      const d = contourMaskPathD(
        kind,
        // Flip Y: the normalized box is PDF y-up; the image rect is SVG y-down.
        { x: ix + frac.x * iw, y: iy + (1 - (frac.y + frac.h)) * ih, w: frac.w * iw, h: frac.h * ih },
        { rx: rxFrac * iw, ry: ryFrac * ih, orientation },
      )
      return <path d={d} fill="black" />
    }
    // Uploaded contour: no fillable region, so dim outside its bounding box.
    return <rect x={ix} y={iy} width={iw} height={ih} fill="black" />
  })() : null

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${cardWidthPt} ${cardHeightPt}`}
      // Focusable so arrow-key nudging of the selected word only happens while
      // the preview holds focus — otherwise arrows pressed while operating other
      // UI (selects, inputs) would move the code unexpectedly. Clicking a word
      // focuses the SVG (see WordOverlay), and the keydown listener is bound to
      // this element rather than `window`.
      tabIndex={0}
      // `isolate` (isolation: isolate) makes the SVG an isolated group so the
      // words' `mix-blend-mode` (text, background rect, contour) composites
      // against the card's own content — the background image below them —
      // instead of leaking out to blend with the white page, where multiply/
      // darken/etc. would be invisible. Matches how the PDF blends on the card.
      className="isolate w-full rounded border border-gray-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700"
      style={{ aspectRatio: `${cardWidthPt} / ${cardHeightPt}` }}
    >
      {backgroundImageUrl && (
        <image href={backgroundImageUrl} x={0} y={0} width={cardWidthPt} height={cardHeightPt} preserveAspectRatio="none" />
      )}
      {contourImageUrl && (
        <image
          href={contourImageUrl}
          x={contourOffsetXPt}
          y={cardHeightPt - contourHeightPt - contourOffsetYPt}
          width={contourWidthPt}
          height={contourHeightPt}
          preserveAspectRatio="none"
          opacity={contourOpacity}
          style={{ mixBlendMode: contourBlendMode }}
        />
      )}
      {dimKnockout && (
        <>
          <defs>
            <mask id={maskId}>
              <rect x={0} y={0} width={cardWidthPt} height={cardHeightPt} fill="white" />
              {dimKnockout}
            </mask>
          </defs>
          <rect x={0} y={0} width={cardWidthPt} height={cardHeightPt} fill="black" opacity={0.58} mask={`url(#${maskId})`} />
        </>
      )}
      {words.map((word, index) => (
        <WordOverlay
          key={index}
          word={word}
          cardWidthPt={cardWidthPt}
          cardHeightPt={cardHeightPt}
          safeMarginMm={safeMarginMm}
          backgroundPaddingMm={backgroundPaddingMm}
          fontFamily={fontFamilyForWord(fonts, index)}
          selected={selectedIndex === index}
          svgRef={svgRef}
          onSelect={() => onSelect(index)}
          onChange={(next) => onChangeWord(index, next)}
        />
      ))}
    </svg>
  )
}
