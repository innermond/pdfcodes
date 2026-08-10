// The preview counterpart of the QR branch in src/generate/cards.rs: a code whose
// `kind` is 'qr' is drawn as a square of modules instead of glyphs. Placement,
// dragging, selection and the background rectangle behave exactly as they do for
// text — only what fills the box differs.
import { useEffect, useState } from 'react'
import { MM, qrPayload, type WordStyle } from '../lib/options'
import { colorToCss } from '../lib/cmyk'
import { qrMatrixAsync, qrPathData, type QrMatrix } from '../lib/qrMatrix'
import { useArrowNudge, useCodeDrag } from '../lib/codeDrag'
import { SelectionAnts } from './SelectionAnts'

export function QrOverlay({
  word,
  cardWidthPt,
  cardHeightPt,
  safeMarginMm,
  backgroundPaddingMm,
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
  selected: boolean
  svgRef: React.RefObject<SVGSVGElement | null>
  onSelect: () => void
  onChange: (next: Partial<WordStyle>) => void
}) {
  const [matrix, setMatrix] = useState<QrMatrix | null>(null)
  const payload = qrPayload(word)

  useEffect(() => {
    let cancelled = false
    // The encoder lives in wasm, which may still be loading on the first render.
    qrMatrixAsync(payload, word.qrEcc).then((m) => {
      if (!cancelled) setMatrix(m)
    })
    return () => {
      cancelled = true
    }
  }, [payload, word.qrEcc])

  // A QR is square, so its box needs no measuring — unlike text, the size is known
  // before the symbol is even encoded.
  const sidePt = word.qrSizeMm * MM
  const safeMarginPt = safeMarginMm * MM

  const xPt =
    word.xMm !== null
      ? word.xMm * MM
      : word.align === 'left'
        ? safeMarginPt
        : word.align === 'right'
          ? cardWidthPt - sidePt - safeMarginPt
          : (cardWidthPt - sidePt) / 2

  // `yMm` is the square's *bottom* edge (a QR has no baseline), so in SVG's y-down
  // space the box starts a full side higher. Matches `qr_box` in cards.rs.
  const yTopSvg = cardHeightPt - word.yMm * MM - sidePt

  const resolvedXMm = word.xMm ?? xPt / MM
  useArrowNudge({ selected, svgRef, xMm: resolvedXMm, yMm: word.yMm, cardWidthPt, cardHeightPt, onChange })
  const handlePointerDown = useCodeDrag({ svgRef, xMm: resolvedXMm, yMm: word.yMm, onSelect, onChange })

  // Flip/rotate about the square's centre, the same pivot the generator uses.
  const cxSvg = xPt + sidePt / 2
  const cySvg = yTopSvg + sidePt / 2
  const transformParts: string[] = []
  if (word.flipX || word.flipY) {
    transformParts.push(
      `translate(${cxSvg} ${cySvg})`,
      `scale(${word.flipX ? -1 : 1} ${word.flipY ? -1 : 1})`,
      `translate(${-cxSvg} ${-cySvg})`,
    )
  }
  if (word.rotationDeg !== 0) {
    transformParts.push(`rotate(${-word.rotationDeg} ${cxSvg} ${cySvg})`)
  }
  const transform = transformParts.length > 0 ? transformParts.join(' ') : undefined

  const padPt = backgroundPaddingMm * MM
  const rectWPt = word.backgroundWidthMm !== null ? word.backgroundWidthMm * MM : sidePt + 2 * padPt
  const rectXPt = word.backgroundWidthMm !== null ? cxSvg - rectWPt / 2 : xPt - padPt

  return (
    // As in WordOverlay, the transform goes on each child rather than this group: a
    // transformed group forms its own stacking context and would isolate the
    // children's `mix-blend-mode` from the background below.
    <g onPointerDown={handlePointerDown} className="cursor-move">
      {selected && (
        <SelectionAnts
          x={xPt - 2}
          y={yTopSvg - 2}
          width={sidePt + 4}
          height={sidePt + 4}
          transform={transform}
        />
      )}
      {word.background !== null && (
        <rect
          transform={transform}
          x={rectXPt}
          y={yTopSvg - padPt}
          width={rectWPt}
          height={sidePt + 2 * padPt}
          fill={colorToCss(word.background)}
          fillOpacity={word.backgroundAlpha}
          style={{ mixBlendMode: word.backgroundBlendMode }}
        />
      )}
      {matrix ? (
        // One path for the whole symbol: every dark run is a subpath, so the browser
        // handles a few hundred modules as a single node.
        <path
          transform={transform}
          d={qrPathData(matrix, xPt, yTopSvg, sidePt)}
          fill={colorToCss(word.color)}
          fillOpacity={word.opacity ?? 1}
          style={{ mixBlendMode: word.blendMode }}
        />
      ) : (
        // Payload too long to encode (or wasm not ready yet): outline the reserved
        // square so the code is still selectable and draggable. The generator
        // likewise leaves the symbol off and reports the row.
        <rect
          transform={transform}
          x={xPt}
          y={yTopSvg}
          width={sidePt}
          height={sidePt}
          fill="none"
          stroke={colorToCss(word.color)}
          strokeOpacity={0.4}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  )
}
