import { useId, useRef } from 'react'
import { fontFamilyForWord, type LoadedFont } from '../lib/fonts'
import { MM, type BlendMode, type WordStyle } from '../lib/options'
import { contourMaskPathD } from '../lib/contourMask'
import { WordOverlay } from './WordOverlay'
import { ContourOverlay } from './ContourOverlay'

// Describes the cut region for the "dim exterior" overlay. A preset shape carries
// its kind + normalized box (fractions of the contour's own space, PDF y-up) so
// the mask is shape-precise; `null` (an uploaded contour) falls back to the
// contour's bounding box.
export type ContourCutShape = {
  kind: string
  orientation: 'out' | 'in'
  // Clockwise rotation (deg) applied to the rendered contour image; the mask is
  // rotated to match. The frac/box are in the shape's *unrotated* card frame.
  rotation: number
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
  contourInteriorMaskPath = null,
  contourSelected = false,
  onContourSelect,
  onContourOffsetChange,
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
  // Vector "keep" path for an uploaded contour, traced from its outline in
  // fractional contour-box coordinates (0..1, y-down, even-odd fill). Used as the
  // dim knockout when there's no precise `contourCutShape`; null falls back to the
  // contour's bounding box.
  contourInteriorMaskPath?: string | null
  // The contour is "selected" for direct manipulation (drag / arrow-key nudge). Mutually
  // exclusive with word selection — the parent clears one when the other is chosen.
  contourSelected?: boolean
  onContourSelect?: () => void
  // Raw new contour offset in mm (X rightward, Y upward); the parent clamps it.
  onContourOffsetChange?: (xMm: number, yMm: number) => void
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
  const clipId = useId()

  // The contour image's rect in card (SVG) points. Shared by the dim-exterior knockout
  // and the drag/selection overlay so they line up exactly with the drawn <image>.
  const ix = contourOffsetXPt
  const iw = contourWidthPt
  const ih = contourHeightPt
  const iy = cardHeightPt - contourHeightPt - contourOffsetYPt

  // The contour "keep" region: the cut interior, positioned to match exactly where
  // the contour image is drawn below (lines for x/y/w/h). Built whenever a contour is
  // present so it can serve both the "dim exterior" knockout (below, gated on
  // `dimExterior`) and the capture clip-path (a <clipPath> def, always available).
  const contourKeepShape = contourImageUrl ? (() => {
    if (contourCutShape) {
      const { frac, rxFrac, ryFrac, kind, orientation, rotation } = contourCutShape
      // The rendered contour image is the unrotated shape rotated `rot` clockwise
      // and scaled into [ix,iy,iw,ih]. Reproduce that: build the shape in its
      // unrotated footprint (dims swapped for 90/270) centered on the rect, then
      // rotate it about the rect center to match the image.
      const rot = ((rotation % 360) + 360) % 360
      const cx = ix + iw / 2, cy = iy + ih / 2
      const swapped = rot === 90 || rot === 270
      const boxW = swapped ? ih : iw
      const boxH = swapped ? iw : ih
      const x0 = cx - boxW / 2, y0 = cy - boxH / 2
      const d = contourMaskPathD(
        kind,
        // Flip Y: the normalized box is PDF y-up; the footprint is SVG y-down.
        { x: x0 + frac.x * boxW, y: y0 + (1 - (frac.y + frac.h)) * boxH, w: frac.w * boxW, h: frac.h * boxH },
        { rx: rxFrac * boxW, ry: ryFrac * boxH, orientation },
      )
      return <path d={d} fill="black" transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined} />
    }
    // Uploaded contour: prefer the traced vector path (fractional coords scaled to
    // the same rect as the contour image, so it lines up and stays crisp at any
    // zoom). Without it (open outline, or still computing), dim outside the bbox.
    if (contourInteriorMaskPath) {
      return (
        <path
          d={contourInteriorMaskPath}
          fillRule="evenodd"
          clipRule="evenodd"
          fill="black"
          transform={`translate(${ix} ${iy}) scale(${iw} ${ih})`}
        />
      )
    }
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
      {contourKeepShape && (
        <defs>
          <clipPath id={clipId} data-capture-clip="true">
            {contourKeepShape}
          </clipPath>
        </defs>
      )}
      {contourImageUrl && (
        <image
          data-contour-outline="true"
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
      {dimExterior && contourKeepShape && (
        <>
          <defs>
            <mask id={maskId}>
              <rect x={0} y={0} width={cardWidthPt} height={cardHeightPt} fill="white" />
              {contourKeepShape}
            </mask>
          </defs>
          <rect x={0} y={0} width={cardWidthPt} height={cardHeightPt} fill="black" opacity={0.58} mask={`url(#${maskId})`} pointerEvents="none" />
        </>
      )}
      {contourImageUrl && onContourSelect && onContourOffsetChange && (
        <ContourOverlay
          svgRef={svgRef}
          cardWidthPt={cardWidthPt}
          cardHeightPt={cardHeightPt}
          ix={ix}
          iy={iy}
          iw={iw}
          ih={ih}
          offsetXMm={contourOffsetXPt / MM}
          offsetYMm={contourOffsetYPt / MM}
          selected={contourSelected}
          onSelect={onContourSelect}
          onChange={onContourOffsetChange}
        />
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
          selected={selectedIndex === index && !contourSelected}
          svgRef={svgRef}
          onSelect={() => onSelect(index)}
          onChange={(next) => onChangeWord(index, next)}
        />
      ))}
    </svg>
  )
}
