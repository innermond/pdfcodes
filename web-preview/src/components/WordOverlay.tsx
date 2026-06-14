import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MM, type WordStyle } from '../lib/options'

interface TextMetrics {
  width: number
  ascent: number
  descent: number
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

    // Use the font's own ascent/descent (not the tight glyph bbox) for
    // vertical placement, matching how src/generate/cards.rs derives
    // `ascent`/`descent` from `face.ascender()`/`face.descender()`. The
    // glyph bbox varies per word (e.g. no descenders => zero descent),
    // which would desync the background rect's Y position from the PDF.
    let ascent = -bbox.y
    let descent = bbox.height + bbox.y
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.font = `${word.fontSizePt}px ${fontFamily}`
      const tm = ctx.measureText(word.text)
      ascent = tm.fontBoundingBoxAscent
      descent = tm.fontBoundingBoxDescent
    }

    setMetrics({ width: bbox.width, ascent, descent })
  }, [word.text, word.fontSizePt, fontFamily])

  if (!metrics) {
    return (
      <text
        ref={measureRef}
        x={0}
        y={0}
        fontSize={word.fontSizePt}
        fontFamily={fontFamily}
        opacity={0}
      >
        {word.text}
      </text>
    )
  }

  const textWidthPt = metrics.width
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

  const cxSvg = xPt + textWidthPt / 2
  const cySvg = ySvg - (metrics.ascent + metrics.descent) / 2

  const transformParts: string[] = []
  if (word.flipX || word.flipY) {
    transformParts.push(`translate(${cxSvg} ${cySvg})`, `scale(${word.flipX ? -1 : 1} ${word.flipY ? -1 : 1})`, `translate(${-cxSvg} ${-cySvg})`)
  }
  if (word.rotationDeg !== 0) {
    transformParts.push(`rotate(${-word.rotationDeg} ${cxSvg} ${cySvg})`)
  }
  const transform = transformParts.length > 0 ? transformParts.join(' ') : undefined

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
      const dxUser = (ev.clientX - startClientX) * scaleX
      const dyUser = (ev.clientY - startClientY) * scaleY
      onChange({
        xMm: startXMm + dxUser / MM,
        yMm: startYMm - dyUser / MM,
      })
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
        <rect
          x={xPt - 2}
          y={ySvg - metrics.ascent - 2}
          width={textWidthPt + 4}
          height={metrics.ascent + metrics.descent + 4}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={0.5}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {word.background !== null && (
        <rect
          x={rectXPt}
          y={rectYSvg}
          width={rectWPt}
          height={rectHPt}
          fill={word.background}
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
        fill={word.color}
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
          fill="none"
          stroke={word.contourColor}
          strokeWidth={word.contourWidthMm * MM}
          style={{ mixBlendMode: word.contourBlendMode }}
        >
          {word.text}
        </text>
      )}
    </g>
  )
}
