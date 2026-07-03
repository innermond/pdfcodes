import { useId, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { fontFamilyForWord, type LoadedFont } from '../lib/fonts'
import { MM, type BlendMode, type WordStyle } from '../lib/options'
import { colorToCss } from '../lib/cmyk'
import { contourMaskPathD } from '../lib/contourMask'
import { flattenPathD, rotate } from '../lib/contourKeepRegion'
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
  // Vertex count + star flag for the 'polygon' kind (ignored by the other kinds).
  sides?: number
  star?: boolean
}

export function CardCanvas({
  backgroundImageUrl,
  transparentBackdrop = false,
  backdropColor = null,
  backgroundOffsetXPt = 0,
  backgroundOffsetYPt = 0,
  bgNudgeMode = false,
  onBackgroundOffsetChange,
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
  // Draw a gray checkerboard behind the background image (instead of the card's
  // white) so transparent regions of a generated image background read as
  // transparent, the way graphics editors indicate an alpha channel.
  transparentBackdrop?: boolean
  // Solid backdrop fill (CMYK color string) shown behind a transparent image
  // instead of the checkerboard; `null` keeps the checkerboard. Mirrors the fill
  // the generator bakes into the exported PDF, and shows it instantly while the
  // WASM rebuild is in flight.
  backdropColor?: string | null
  // Pan the background image within the card (right/up positive, PDF points). The
  // SVG viewport clips overflow; the vacated area reveals the card white / checker /
  // backdrop. Mirrors the offset the generator bakes into the exported PDF.
  backgroundOffsetXPt?: number
  backgroundOffsetYPt?: number
  // "Mută fundalul": show a drag surface to pan the background and suspend word /
  // contour interaction so a pan drag never selects a word.
  bgNudgeMode?: boolean
  // Raw new background offset in mm (X rightward, Y upward); the parent clamps it.
  onBackgroundOffsetChange?: (xMm: number, yMm: number) => void
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
  const checkerId = useId()

  // Checkerboard cell size in card (SVG) points. Fixed in user space, so cells
  // scale with the responsively-sized card — a stable "transparent" look at any
  // display width without depending on the current device scale.
  const checkerCellPt = 6

  // The contour image's rect in card (SVG) points. Shared by the dim-exterior knockout
  // and the drag/selection overlay so they line up exactly with the drawn <image>.
  const ix = contourOffsetXPt
  const iw = contourWidthPt
  const ih = contourHeightPt
  const iy = cardHeightPt - contourHeightPt - contourOffsetYPt

  // The exact cut outline of a preset shape, as an SVG path `d` (+ rotation
  // transform) in card points, plus its tight axis-aligned bounding rect. Reused
  // for the dim/clip "keep" region AND to size the selection marching-ants, so the
  // (still rectangular) selection envelops the real shape — e.g. a polygon, which
  // is inscribed in its box and so is smaller than the contour's bounding rect.
  const contourCutOutline = contourImageUrl && contourCutShape ? (() => {
    const { frac, rxFrac, ryFrac, kind, orientation, rotation, sides, star } = contourCutShape
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
      { rx: rxFrac * boxW, ry: ryFrac * boxH, orientation, sides, star },
    )
    // Tight bounding rect of the (rotated) outline: flatten the path, rotate its
    // points to match the image, then take the extents. For shapes that fill their
    // box this equals [ix,iy,iw,ih]; for a polygon it shrinks to the shape.
    const pts = flattenPathD(d).flat().map((p) => rotate(p, cx, cy, rot))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [px, py] of pts) {
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
    const rect = pts.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null
    return { d, transform: rot ? `rotate(${rot} ${cx} ${cy})` : undefined, rect }
  })() : null

  // The contour "keep" region: the cut interior, positioned to match exactly where
  // the contour image is drawn below (lines for x/y/w/h). Built whenever a contour is
  // present so it can serve both the "dim exterior" knockout (below, gated on
  // `dimExterior`) and the capture clip-path (a <clipPath> def, always available).
  const contourKeepShape = contourImageUrl ? (() => {
    if (contourCutOutline) {
      return <path d={contourCutOutline.d} fill="black" transform={contourCutOutline.transform} />
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
      {/* The background layer (its transparency backdrop + the image) pans as one:
          the baked checker/color travels with the image, while the vacated card area
          reveals the SVG's white — mirroring the export, where the pan leaves true
          transparency (prints white). The SVG viewport clips whatever slides out.
          Y is negated: PDF offset is up-positive, SVG y grows downward. */}
      <g transform={`translate(${backgroundOffsetXPt} ${-backgroundOffsetYPt})`}>
        {transparentBackdrop && backdropColor && (
          <rect x={0} y={0} width={cardWidthPt} height={cardHeightPt} fill={colorToCss(backdropColor)} />
        )}
        {transparentBackdrop && !backdropColor && (
          <>
            <defs>
              <pattern id={checkerId} width={checkerCellPt * 2} height={checkerCellPt * 2} patternUnits="userSpaceOnUse">
                <rect x={0} y={0} width={checkerCellPt * 2} height={checkerCellPt * 2} fill="#e9e9e9" />
                <rect x={0} y={0} width={checkerCellPt} height={checkerCellPt} fill="#cfcfcf" />
                <rect x={checkerCellPt} y={checkerCellPt} width={checkerCellPt} height={checkerCellPt} fill="#cfcfcf" />
              </pattern>
            </defs>
            <rect x={0} y={0} width={cardWidthPt} height={cardHeightPt} fill={`url(#${checkerId})`} />
          </>
        )}
        {backgroundImageUrl && (
          <image href={backgroundImageUrl} x={0} y={0} width={cardWidthPt} height={cardHeightPt} preserveAspectRatio="none" />
        )}
      </g>
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
          outlineRect={contourCutOutline?.rect ?? null}
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
      {bgNudgeMode && onBackgroundOffsetChange && (
        <BackgroundPanOverlay
          svgRef={svgRef}
          offsetXMm={backgroundOffsetXPt / MM}
          offsetYMm={backgroundOffsetYPt / MM}
          cardWidthPt={cardWidthPt}
          cardHeightPt={cardHeightPt}
          onChange={onBackgroundOffsetChange}
        />
      )}
    </svg>
  )
}

// Full-card drag surface to pan the background while "Mută fundalul" is on. Modeled
// on ContourOverlay's drag: client px → viewBox units → mm, Shift locks an axis, Y is
// up-positive (PDF convention). Sitting last in the SVG it covers the words/contour,
// so a pan drag never selects them; the parent clamps the resulting offset.
function BackgroundPanOverlay({
  svgRef,
  offsetXMm,
  offsetYMm,
  cardWidthPt,
  cardHeightPt,
  onChange,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>
  offsetXMm: number
  offsetYMm: number
  cardWidthPt: number
  cardHeightPt: number
  onChange: (xMm: number, yMm: number) => void
}) {
  function handlePointerDown(e: ReactPointerEvent<SVGRectElement>) {
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    const viewBox = svg.viewBox.baseVal
    const rect = svg.getBoundingClientRect()
    const scaleX = viewBox.width / rect.width
    const scaleY = viewBox.height / rect.height
    const startClientX = e.clientX
    const startClientY = e.clientY
    const startXMm = offsetXMm
    const startYMm = offsetYMm
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)

    function handleMove(ev: PointerEvent) {
      let dxUser = (ev.clientX - startClientX) * scaleX
      let dyUser = (ev.clientY - startClientY) * scaleY
      // Holding Shift locks the drag to the dominant axis.
      if (ev.shiftKey) {
        if (Math.abs(dxUser) >= Math.abs(dyUser)) dyUser = 0
        else dxUser = 0
      }
      // Y is up-positive, so a downward drag (dyUser > 0) decreases the offset.
      onChange(startXMm + dxUser / MM, startYMm - dyUser / MM)
    }

    function handleUp(ev: PointerEvent) {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      target.releasePointerCapture(ev.pointerId)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return (
    <rect
      x={0}
      y={0}
      width={cardWidthPt}
      height={cardHeightPt}
      fill="transparent"
      pointerEvents="all"
      className="cursor-move"
      onPointerDown={handlePointerDown}
    />
  )
}
