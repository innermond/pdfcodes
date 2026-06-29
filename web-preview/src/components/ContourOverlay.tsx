import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MM } from '../lib/options'

// Direct-manipulation layer for the contour: a transparent hit rect over the contour
// box lets the user drag it, and (when selected) arrow keys nudge it — mirroring how a
// word is moved (see WordOverlay). The contour itself is drawn by CardCanvas's <image>;
// this only handles pointer/keyboard and the marching-ants outline. Positions are the
// app's `contourOffset{X,Y}Mm` (X rightward, Y upward, PDF convention); the parent clamps
// them so the box stays inside the card.
export function ContourOverlay({
  svgRef,
  cardWidthPt,
  cardHeightPt,
  ix,
  iy,
  iw,
  ih,
  offsetXMm,
  offsetYMm,
  selected,
  onSelect,
  onChange,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>
  cardWidthPt: number
  cardHeightPt: number
  // Contour box rect in card (SVG) points — matches where CardCanvas draws the image.
  ix: number
  iy: number
  iw: number
  ih: number
  offsetXMm: number
  offsetYMm: number
  selected: boolean
  onSelect: () => void
  onChange: (xMm: number, yMm: number) => void
}) {
  const [hovered, setHovered] = useState(false)

  // Arrow keys nudge the contour while selected, by 1/100 of the card dimension along
  // the axis pressed — same step the word nudge uses. Bound to the focusable preview SVG
  // so arrows only act while the preview holds focus.
  const stepXMm = cardWidthPt / MM / 100
  const stepYMm = cardHeightPt / MM / 100
  useEffect(() => {
    if (!selected) return
    const svg = svgRef.current
    if (!svg) return
    function handleKey(e: KeyboardEvent) {
      let nextX = offsetXMm
      let nextY = offsetYMm
      switch (e.key) {
        case 'ArrowLeft':
          nextX -= stepXMm
          break
        case 'ArrowRight':
          nextX += stepXMm
          break
        case 'ArrowUp':
          nextY += stepYMm // Y is up-positive (PDF convention)
          break
        case 'ArrowDown':
          nextY -= stepYMm
          break
        default:
          return
      }
      e.preventDefault()
      onChange(nextX, nextY)
    }
    svg.addEventListener('keydown', handleKey)
    return () => svg.removeEventListener('keydown', handleKey)
  }, [selected, offsetXMm, offsetYMm, stepXMm, stepYMm, onChange, svgRef])

  function handlePointerDown(e: ReactPointerEvent<SVGRectElement>) {
    e.stopPropagation()
    onSelect()
    const svg = svgRef.current
    if (!svg) return
    // Focus the preview so arrow keys nudge the contour (preventScroll avoids the page
    // jumping to the canvas).
    svg.focus({ preventScroll: true })
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
      // Y is up-positive, so a downward drag (dyUser > 0) decreases the offset. The
      // parent clamps the result back inside the card.
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
    <>
      {(selected || hovered) && (
        // "Marching ants" outline matching the selected word's look: a white dashed
        // track with dark dashes filling its gaps, both crawling in lockstep.
        <g pointerEvents="none">
          <rect x={ix} y={iy} width={iw} height={ih} fill="none" stroke="#ffffff" strokeWidth={0.75} strokeDasharray="4 4" vectorEffect="non-scaling-stroke">
            <animate attributeName="stroke-dashoffset" values="0;8" dur="0.5s" repeatCount="indefinite" />
          </rect>
          <rect x={ix} y={iy} width={iw} height={ih} fill="none" stroke="#1e3a8a" strokeWidth={0.75} strokeDasharray="4 4" vectorEffect="non-scaling-stroke">
            <animate attributeName="stroke-dashoffset" values="4;12" dur="0.5s" repeatCount="indefinite" />
          </rect>
        </g>
      )}
      <rect
        x={ix}
        y={iy}
        width={iw}
        height={ih}
        fill="transparent"
        pointerEvents="all"
        className="cursor-move"
        onPointerDown={handlePointerDown}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      />
    </>
  )
}
