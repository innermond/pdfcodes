// The preview counterpart of a joined unit in src/generate/cards.rs (`plan_units`):
// several text codes drawn on one line, each with its own font, size and colour,
// but placed, aligned, rotated and flipped as a whole by the unit's first code.
// Every run stays individually selectable so its style can be edited; dragging or
// nudging any of them moves the unit (i.e. edits the first code).
import { useLayoutEffect, useRef, useState } from 'react'
import { MM, type ContourAlignRect, type WordStyle } from '../lib/options'
import { colorToCss } from '../lib/cmyk'
import { useArrowNudge, useCodeDrag } from '../lib/codeDrag'
import { unitRunOffsets, unitStartXPt } from '../lib/wordUnits'
import { SelectionAnts } from './SelectionAnts'

interface RunMetrics {
  widthPt: number
  // Width of a space in this run's font and size, plus its character spacing: the
  // gap the generator leaves before the next run.
  spacePt: number
  // Font line metrics (positive), like the generator's `face.ascender()/descender()`.
  ascent: number
  descent: number
}

function measureRun(word: WordStyle, fontFamily: string, svgWidthPt: number): RunMetrics {
  let spacePt = word.fontSizePt * 0.3 + word.charSpacingPt
  let ascent = word.fontSizePt * 0.8
  let descent = word.fontSizePt * 0.2
  const ctx = document.createElement('canvas').getContext('2d')
  if (ctx) {
    ctx.font = `${word.fontSizePt}px ${fontFamily}`
    spacePt = ctx.measureText(' ').width + word.charSpacingPt
    const tm = ctx.measureText(word.text || 'X')
    ascent = tm.fontBoundingBoxAscent
    descent = tm.fontBoundingBoxDescent
  }
  return { widthPt: svgWidthPt, spacePt, ascent, descent }
}

export function WordUnitOverlay({
  words,
  indexes,
  fontFamilies,
  cardWidthPt,
  cardHeightPt,
  safeMarginMm,
  backgroundPaddingMm,
  contourAlignRect,
  contourInsetMm,
  selectedIndex,
  svgRef,
  onSelect,
  onChange,
}: {
  // The unit's codes in order; the first one places the whole unit.
  words: WordStyle[]
  // Their positions in the full word list, for selection and edits.
  indexes: number[]
  fontFamilies: string[]
  cardWidthPt: number
  cardHeightPt: number
  safeMarginMm: number
  backgroundPaddingMm: number
  contourAlignRect: ContourAlignRect | null
  contourInsetMm: number
  selectedIndex: number | null
  svgRef: React.RefObject<SVGSVGElement | null>
  onSelect: (index: number) => void
  onChange: (index: number, next: Partial<WordStyle>) => void
}) {
  const textRefs = useRef<(SVGTextElement | null)[]>([])
  const [measured, setMetrics] = useState<RunMetrics[] | null>(null)
  // Measurements from before a run was added or removed are one entry off until the
  // layout effect below re-measures, so they count as missing for that render.
  const metrics = measured !== null && measured.length === words.length ? measured : null

  // Re-measure whenever anything that changes a run's width changes.
  const measureKey = words.map((w, i) => `${w.text}|${w.fontSizePt}|${w.charSpacingPt}|${fontFamilies[i]}`).join('\n')
  useLayoutEffect(() => {
    const next = words.map((word, i) => measureRun(word, fontFamilies[i], textRefs.current[i]?.getBBox().width ?? 0))
    setMetrics(next)
    // `words`/`fontFamilies` are covered by `measureKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureKey])

  const leader = words[0]
  const leaderIndex = indexes[0]
  const { offsets, totalPt } = unitRunOffsets(
    words.map((word, i) => ({ text: word.text, widthPt: metrics?.[i]?.widthPt ?? 0, spacePt: metrics?.[i]?.spacePt ?? 0 })),
  )
  const x0 = unitStartXPt(leader, totalPt, cardWidthPt, safeMarginMm, contourAlignRect, contourInsetMm)
  const ySvg = cardHeightPt - leader.yMm * MM

  const unitSelected = selectedIndex !== null && indexes.includes(selectedIndex)
  const resolvedXMm = x0 / MM
  const onUnitChange = (next: Partial<WordStyle>) => onChange(leaderIndex, next)
  useArrowNudge({ selected: unitSelected, svgRef, xMm: resolvedXMm, yMm: leader.yMm, cardWidthPt, cardHeightPt, onChange: onUnitChange })
  // Selection is decided per run (below); this only supplies the drag itself.
  const startDrag = useCodeDrag({ svgRef, xMm: resolvedXMm, yMm: leader.yMm, onSelect: () => {}, onChange: onUnitChange })

  if (!metrics) {
    return (
      <g opacity={0}>
        {words.map((word, i) => (
          <text
            key={indexes[i]}
            ref={(el) => {
              textRefs.current[i] = el
            }}
            x={0}
            y={0}
            fontSize={word.fontSizePt}
            fontFamily={fontFamilies[i]}
            letterSpacing={word.charSpacingPt}
          >
            {word.text}
          </text>
        ))}
      </g>
    )
  }

  // The whole unit turns about one pivot: its horizontal centre and the middle of
  // its tallest line box, as in the generator.
  const ascentMax = Math.max(...metrics.map((m) => m.ascent))
  const descentMax = Math.max(...metrics.map((m) => m.descent))
  const cxSvg = x0 + totalPt / 2
  const cySvg = ySvg - (ascentMax - descentMax) / 2
  const transformParts: string[] = []
  if (leader.flipX || leader.flipY) {
    transformParts.push(`translate(${cxSvg} ${cySvg})`, `scale(${leader.flipX ? -1 : 1} ${leader.flipY ? -1 : 1})`, `translate(${-cxSvg} ${-cySvg})`)
  }
  if (leader.rotationDeg !== 0) {
    transformParts.push(`rotate(${-leader.rotationDeg} ${cxSvg} ${cySvg})`)
  }
  const transform = transformParts.length > 0 ? transformParts.join(' ') : undefined
  const padPt = backgroundPaddingMm * MM

  return (
    // Transforms go on each child, not the group, so the children's mix-blend-mode
    // still composites against the background (see WordOverlay).
    <g className="cursor-move">
      {words.map((word, i) => {
        const index = indexes[i]
        const m = metrics[i]
        const xPt = x0 + offsets[i]
        const rectWPt = word.backgroundWidthMm !== null ? word.backgroundWidthMm * MM : m.widthPt + 2 * padPt
        const rectXPt = word.backgroundWidthMm !== null ? xPt + m.widthPt / 2 - rectWPt / 2 : xPt - padPt
        return (
          <g
            key={index}
            onPointerDown={(e) => {
              onSelect(index)
              startDrag(e)
            }}
          >
            {selectedIndex === index && (
              <SelectionAnts x={xPt - 2} y={ySvg - m.ascent - 2} width={m.widthPt + 4} height={m.ascent + m.descent + 4} transform={transform} />
            )}
            {word.background !== null && (
              <rect
                transform={transform}
                x={rectXPt}
                y={ySvg - m.ascent - padPt}
                width={rectWPt}
                height={m.ascent + m.descent + 2 * padPt}
                fill={colorToCss(word.background)}
                fillOpacity={word.backgroundAlpha}
                style={{ mixBlendMode: word.backgroundBlendMode }}
              />
            )}
            <text
              ref={(el) => {
                textRefs.current[i] = el
              }}
              transform={transform}
              x={xPt}
              y={ySvg}
              fontSize={word.fontSizePt}
              fontFamily={fontFamilies[i]}
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
                fontFamily={fontFamilies[i]}
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
      })}
    </g>
  )
}
