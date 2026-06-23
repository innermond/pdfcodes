import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MM, type WordStyle } from '../lib/options'
import { colorToCss } from '../lib/cmyk'

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

    setMetrics({ width: bbox.width, ascent, descent, inkAscent, inkDescent })
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

  // Arrow keys nudge the selected word. The step is 1/100 of the card
  // dimension along the axis of movement (width for left/right, height for
  // up/down), matching how the printed card is proportioned. The handler
  // closes over the current resolved position, so it re-subscribes when the
  // word moves.
  const startXMm = word.xMm ?? xPt / MM
  const startYMm = word.yMm
  const stepXMm = cardWidthPt / MM / 100
  const stepYMm = cardHeightPt / MM / 100
  useEffect(() => {
    if (!selected) return
    function handleKey(e: KeyboardEvent) {
      let xMm = startXMm
      let yMm = startYMm
      switch (e.key) {
        case 'ArrowLeft':
          xMm -= stepXMm
          break
        case 'ArrowRight':
          xMm += stepXMm
          break
        case 'ArrowUp':
          yMm += stepYMm
          break
        case 'ArrowDown':
          yMm -= stepYMm
          break
        default:
          return
      }
      e.preventDefault()
      const next: Partial<WordStyle> = { xMm, yMm }
      // A vertical nudge overrides any snapped vertical alignment.
      if (yMm !== startYMm) next.valign = 'custom'
      onChange(next)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selected, startXMm, startYMm, stepXMm, stepYMm, onChange])

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

  const cxSvg = xPt + textWidthPt / 2
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

  // Selection outline geometry (a 2pt margin around the glyph box).
  const selX = xPt - 2
  const selY = ySvg - metrics.ascent - 2
  const selW = textWidthPt + 4
  const selH = metrics.ascent + metrics.descent + 4

  const padPt = backgroundPaddingMm * MM
  const rectWPt = word.backgroundWidthMm !== null ? word.backgroundWidthMm * MM : textWidthPt + 2 * padPt
  const rectXPt = word.backgroundWidthMm !== null ? xPt + textWidthPt / 2 - rectWPt / 2 : xPt - padPt
  const rectYSvg = ySvg - metrics.ascent - padPt
  const rectHPt = metrics.ascent + metrics.descent + 2 * padPt

  function handlePointerDown(e: ReactPointerEvent<SVGGElement>) {
    e.stopPropagation()
    onSelect()
    const svg = svgRef.current
    if (!svg) return
    const viewBox = svg.viewBox.baseVal
    const rect = svg.getBoundingClientRect()
    const scaleX = viewBox.width / rect.width
    const scaleY = viewBox.height / rect.height

    const startClientX = e.clientX
    const startClientY = e.clientY
    const startXMm = word.xMm ?? xPt / MM
    const startYMm = word.yMm
    const target = e.currentTarget

    target.setPointerCapture(e.pointerId)

    function handleMove(ev: PointerEvent) {
      let dxUser = (ev.clientX - startClientX) * scaleX
      let dyUser = (ev.clientY - startClientY) * scaleY
      // Holding Shift locks the drag to a straight line along the dominant
      // axis (horizontal or vertical), zeroing the smaller component.
      if (ev.shiftKey) {
        if (Math.abs(dxUser) >= Math.abs(dyUser)) {
          dyUser = 0
        } else {
          dxUser = 0
        }
      }
      const next: Partial<WordStyle> = {
        xMm: startXMm + dxUser / MM,
        yMm: startYMm - dyUser / MM,
      }
      // Moving the word vertically overrides any snapped vertical alignment.
      if (dyUser !== 0) next.valign = 'custom'
      onChange(next)
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
    <g
      transform={transform}
      onPointerDown={handlePointerDown}
      className="cursor-move"
    >
      {selected && (
        // "Marching ants" selection: a static white dashed track with dark
        // dashes filling its gaps, both animated in lockstep so the dashes
        // appear to crawl. The two colors keep it visible on any background.
        <g pointerEvents="none">
          <rect
            x={selX}
            y={selY}
            width={selW}
            height={selH}
            fill="none"
            stroke="#ffffff"
            strokeWidth={0.75}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          >
            <animate
              attributeName="stroke-dashoffset"
              values="0;8"
              dur="0.5s"
              repeatCount="indefinite"
            />
          </rect>
          <rect
            x={selX}
            y={selY}
            width={selW}
            height={selH}
            fill="none"
            stroke="#1e3a8a"
            strokeWidth={0.75}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          >
            <animate
              attributeName="stroke-dashoffset"
              values="4;12"
              dur="0.5s"
              repeatCount="indefinite"
            />
          </rect>
        </g>
      )}
      {word.background !== null && (
        <rect
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
        x={xPt}
        y={ySvg}
        fontSize={word.fontSizePt}
        fontFamily={fontFamily}
        letterSpacing={word.charSpacingPt}
        fill={colorToCss(word.color)}
        style={{ mixBlendMode: word.blendMode }}
      >
        {word.text}
      </text>
      {word.contourColor !== null && (
        <text
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
