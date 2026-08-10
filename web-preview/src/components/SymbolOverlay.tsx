// The preview counterpart of the symbol branch in src/generate/cards.rs: a code whose
// `kind` isn't 'text' is drawn as a grid of modules instead of glyphs. Placement,
// dragging, selection and the background rectangle behave exactly as they do for
// text — only what fills the box differs, and both symbol kinds fill it the same way
// (one run-merged path), so one component serves both.
import { useEffect, useState } from 'react'
import { MM, symbolSizeMm, type WordStyle } from '../lib/options'
import { colorToCss } from '../lib/cmyk'
import { encodeSymbolAsync, modulePathData, type ModuleGrid } from '../lib/symbolBits'
import { useArrowNudge, useCodeDrag } from '../lib/codeDrag'
import { SelectionAnts } from './SelectionAnts'

export function SymbolOverlay({
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
  const [grid, setGrid] = useState<ModuleGrid | null>(null)

  // Re-encode whenever anything the payload or the symbol shape depends on changes.
  // Not the size — that only scales the same grid.
  const { text, kind, qrEcc, symbology, payloadTemplate } = word
  useEffect(() => {
    let cancelled = false
    // The encoder lives in wasm, which may still be loading on the first render.
    encodeSymbolAsync(word).then((result) => {
      if (!cancelled) setGrid('grid' in result ? result.grid : null)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, kind, qrEcc, symbology, payloadTemplate])

  // A symbol's rectangle is known before the symbol is even encoded — unlike text,
  // nothing needs measuring.
  const { widthMm, heightMm } = symbolSizeMm(word)
  const widthPt = widthMm * MM
  const heightPt = heightMm * MM
  const safeMarginPt = safeMarginMm * MM

  const xPt =
    word.xMm !== null
      ? word.xMm * MM
      : word.align === 'left'
        ? safeMarginPt
        : word.align === 'right'
          ? cardWidthPt - widthPt - safeMarginPt
          : (cardWidthPt - widthPt) / 2

  // `yMm` is the rectangle's *bottom* edge (a symbol has no baseline), so in SVG's
  // y-down space the box starts its full height higher. Matches `symbol_box` in
  // cards.rs.
  const yTopSvg = cardHeightPt - word.yMm * MM - heightPt

  const resolvedXMm = word.xMm ?? xPt / MM
  useArrowNudge({ selected, svgRef, xMm: resolvedXMm, yMm: word.yMm, cardWidthPt, cardHeightPt, onChange })
  const handlePointerDown = useCodeDrag({ svgRef, xMm: resolvedXMm, yMm: word.yMm, onSelect, onChange })

  // Flip/rotate about the rectangle's centre, the same pivot the generator uses.
  const cxSvg = xPt + widthPt / 2
  const cySvg = yTopSvg + heightPt / 2
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
  const rectWPt = word.backgroundWidthMm !== null ? word.backgroundWidthMm * MM : widthPt + 2 * padPt
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
          width={widthPt + 4}
          height={heightPt + 4}
          transform={transform}
        />
      )}
      {word.background !== null && (
        <rect
          transform={transform}
          x={rectXPt}
          y={yTopSvg - padPt}
          width={rectWPt}
          height={heightPt + 2 * padPt}
          fill={colorToCss(word.background)}
          fillOpacity={word.backgroundAlpha}
          style={{ mixBlendMode: word.backgroundBlendMode }}
        />
      )}
      {grid ? (
        // One path for the whole symbol: every dark run is a subpath, so the browser
        // handles a few hundred modules as a single node.
        <path
          transform={transform}
          d={modulePathData(grid, xPt, yTopSvg, widthPt, heightPt)}
          fill={colorToCss(word.color)}
          fillOpacity={word.opacity ?? 1}
          style={{ mixBlendMode: word.blendMode }}
        />
      ) : (
        // The symbology refused the payload (or wasm isn't ready yet): outline the
        // reserved rectangle so the code stays selectable and draggable. The
        // generator likewise leaves the symbol off and reports the row — the panel
        // shows the reason.
        <rect
          transform={transform}
          x={xPt}
          y={yTopSvg}
          width={widthPt}
          height={heightPt}
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
