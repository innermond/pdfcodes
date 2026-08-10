import { useLayoutEffect, useRef, useState } from 'react'
import { MM, type WordStyle } from '../lib/options'
import { colorToCss } from '../lib/cmyk'
import { useArrowNudge, useCodeDrag } from '../lib/codeDrag'
import { SelectionAnts } from './SelectionAnts'

interface TextMetrics {
  width: number
  // Font line metrics (include empty padding): used for layout — the background
  // rect and selection box — so they stay synced with the PDF generator.
  ascent: number
  descent: number
  // Tight glyph-ink extent: used as the flip/rotate pivot so mirroring/rotating
  // turns the visible glyphs in place rather than around the padded line box.
  inkAscent: number
  inkDescent: number
  // Horizontal offset from the text's `x` origin to the ink's left edge (the
  // first glyph's left side bearing). Lets the selection box and flip pivot
  // track the visible glyphs instead of the advance origin.
  inkLeft: number
}

export function WordOverlay({
  word,
  cardWidthPt,
  cardHeightPt,
  safeMarginMm,
  backgroundPaddingMm,
  fontFamily,
  selected,
  svgRef,
  onSelect,
  onChange,
}: {
  word: WordStyle
  cardWidthPt: number
  cardHeightPt: number
  safeMarginMm: number
  backgroundPaddingMm: number
  fontFamily: string
  selected: boolean
  svgRef: React.RefObject<SVGSVGElement | null>
  onSelect: () => void
  onChange: (next: Partial<WordStyle>) => void
}) {
  const measureRef = useRef<SVGTextElement>(null)
  const [metrics, setMetrics] = useState<TextMetrics | null>(null)

  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const bbox = el.getBBox()
    // Tight ink extent of these exact glyphs, relative to the baseline, taken
    // from the same SVG bbox as `width` so the flip/rotate pivot matches what's
    // actually rendered. `bbox` is in the element's own space (the parent's flip
    // transform doesn't affect it), where the baseline sits at the text's `y`
    // attribute — which is 0 for the hidden first-measure pass and `ySvg` once
    // positioned, so we subtract it to stay position-independent. (Canvas
    // measureText's ink metrics differ subtly from SVG and made the flip jump.)
    const baseline = el.y.baseVal.numberOfItems > 0 ? el.y.baseVal.getItem(0).value : 0
    const inkAscent = baseline - bbox.y
    const inkDescent = bbox.y + bbox.height - baseline
    // Likewise horizontally: the text's `x` origin is 0 for the hidden measure
    // pass and `xPt` once positioned, so subtract it to get the ink's left edge
    // relative to the advance origin (the first glyph's left side bearing).
    const originX = el.x.baseVal.numberOfItems > 0 ? el.x.baseVal.getItem(0).value : 0
    const inkLeft = bbox.x - originX

    // Layout uses the font's own ascent/descent (not the tight glyph bbox),
    // matching how src/generate/cards.rs derives `ascent`/`descent` from
    // `face.ascender()`/`face.descender()`. The glyph bbox varies per word
    // (e.g. no descenders => zero descent), which would desync the background
    // rect's Y position from the PDF.
    let ascent = inkAscent
    let descent = inkDescent
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.font = `${word.fontSizePt}px ${fontFamily}`
      const tm = ctx.measureText(word.text)
      ascent = tm.fontBoundingBoxAscent
      descent = tm.fontBoundingBoxDescent
    }

    setMetrics({ width: bbox.width, ascent, descent, inkAscent, inkDescent, inkLeft })
  }, [word.text, word.fontSizePt, word.charSpacingPt, fontFamily])

  const textWidthPt = metrics?.width ?? 0
  const safeMarginPt = safeMarginMm * MM

  const xPt =
    word.xMm !== null
      ? word.xMm * MM
      : word.align === 'left'
        ? safeMarginPt
        : word.align === 'right'
          ? cardWidthPt - textWidthPt - safeMarginPt
          : (cardWidthPt - textWidthPt) / 2

  const yPt = word.yMm * MM
  const ySvg = cardHeightPt - yPt

  // Dragging and arrow-key nudging are identical for every kind of code, so they
  // live in ./codeInteraction and are shared with QrOverlay.
  const resolvedXMm = word.xMm ?? xPt / MM
  useArrowNudge({ selected, svgRef, xMm: resolvedXMm, yMm: word.yMm, cardWidthPt, cardHeightPt, onChange })
  const handlePointerDown = useCodeDrag({ svgRef, xMm: resolvedXMm, yMm: word.yMm, onSelect, onChange })

  if (!metrics) {
    return (
      <text
        ref={measureRef}
        x={0}
        y={0}
        fontSize={word.fontSizePt}
        fontFamily={fontFamily}
        letterSpacing={word.charSpacingPt}
        opacity={0}
      >
        {word.text}
      </text>
    )
  }

  // Horizontal pivot: the centre of the *visible glyph ink* (`xPt + inkLeft` is
  // the ink's left edge, not the advance origin `xPt`), so mirror-X turns the
  // glyphs in place instead of shifting them by the side bearing.
  const cxSvg = xPt + metrics.inkLeft + textWidthPt / 2
  // Pivot for flip/rotate: the centre of the *visible glyph ink*, so mirroring or
  // rotating keeps the text in place. In SVG (y down) the ink spans
  // `ySvg - inkAscent` (top) to `ySvg + inkDescent` (bottom), both metrics
  // positive, so the midpoint is `ySvg - (inkAscent - inkDescent) / 2`. Using
  // the font line box instead leaves its empty ascent/descent padding off
  // centre, which shifts text whose glyphs don't fill the box on a vertical flip.
  const cySvg = ySvg - (metrics.inkAscent - metrics.inkDescent) / 2

  const transformParts: string[] = []
  if (word.flipX || word.flipY) {
    transformParts.push(`translate(${cxSvg} ${cySvg})`, `scale(${word.flipX ? -1 : 1} ${word.flipY ? -1 : 1})`, `translate(${-cxSvg} ${-cySvg})`)
  }
  if (word.rotationDeg !== 0) {
    transformParts.push(`rotate(${-word.rotationDeg} ${cxSvg} ${cySvg})`)
  }
  const transform = transformParts.length > 0 ? transformParts.join(' ') : undefined

  // Selection outline geometry (a 2pt margin around the glyph box). Anchor X to
  // the ink's left edge (`xPt + inkLeft`), not the advance origin, so the box
  // wraps the visible glyphs symmetrically instead of sitting off to one side.
  const selX = xPt + metrics.inkLeft - 2
  const selY = ySvg - metrics.ascent - 2
  const selW = textWidthPt + 4
  const selH = metrics.ascent + metrics.descent + 4

  const padPt = backgroundPaddingMm * MM
  const rectWPt = word.backgroundWidthMm !== null ? word.backgroundWidthMm * MM : textWidthPt + 2 * padPt
  const rectXPt = word.backgroundWidthMm !== null ? xPt + textWidthPt / 2 - rectWPt / 2 : xPt - padPt
  const rectYSvg = ySvg - metrics.ascent - padPt
  const rectHPt = metrics.ascent + metrics.descent + 2 * padPt

  return (
    // The flip/rotate `transform` is applied to each child individually rather
    // than to this wrapping group on purpose: a transformed group forms its own
    // stacking context, which isolates the children's `mix-blend-mode` so they
    // can no longer composite against the background image below. The transform
    // is defined in this (untransformed) parent space, so applying it per child
    // is visually identical to transforming the group.
    <g onPointerDown={handlePointerDown} className="cursor-move">
      {selected && <SelectionAnts x={selX} y={selY} width={selW} height={selH} transform={transform} />}
      {word.background !== null && (
        <rect
          transform={transform}
          x={rectXPt}
          y={rectYSvg}
          width={rectWPt}
          height={rectHPt}
          fill={colorToCss(word.background)}
          fillOpacity={word.backgroundAlpha}
          style={{ mixBlendMode: word.backgroundBlendMode }}
        />
      )}
      <text
        ref={measureRef}
        transform={transform}
        x={xPt}
        y={ySvg}
        fontSize={word.fontSizePt}
        fontFamily={fontFamily}
        letterSpacing={word.charSpacingPt}
        fill={colorToCss(word.color)}
        fillOpacity={word.opacity ?? 1}
        style={{ mixBlendMode: word.blendMode }}
      >
        {word.text}
      </text>
      {word.contourColor !== null && (
        <text
          transform={transform}
          x={xPt}
          y={ySvg}
          fontSize={word.fontSizePt}
          fontFamily={fontFamily}
          letterSpacing={word.charSpacingPt}
          fill="none"
          stroke={colorToCss(word.contourColor)}
          strokeWidth={word.contourWidthMm * MM}
          style={{ mixBlendMode: word.contourBlendMode }}
        >
          {word.text}
        </text>
      )}
    </g>
  )
}
