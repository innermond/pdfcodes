// Placement interaction shared by the two kinds of code overlay: dragging a code
// with the pointer and nudging it with the arrow keys. `WordOverlay` (glyphs) and
// `QrOverlay` (a module square) differ only in what they draw, so this keeps a
// single copy of how a code is moved around the card. The selection outline they
// also share is a component, in ../components/SelectionAnts.
import { useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { MM, type WordStyle } from './options'

// Arrow keys nudge the selected code. The step is 1/100 of the card dimension along
// the axis of movement (width for left/right, height for up/down), matching how the
// printed card is proportioned. The handler closes over the current resolved
// position, so it re-subscribes when the code moves.
export function useArrowNudge({
  selected,
  svgRef,
  xMm,
  yMm,
  cardWidthPt,
  cardHeightPt,
  onChange,
}: {
  selected: boolean
  svgRef: React.RefObject<SVGSVGElement | null>
  // The code's *resolved* position: its explicit xMm, or where its alignment put it.
  xMm: number
  yMm: number
  cardWidthPt: number
  cardHeightPt: number
  onChange: (next: Partial<WordStyle>) => void
}) {
  const stepXMm = cardWidthPt / MM / 100
  const stepYMm = cardHeightPt / MM / 100
  useEffect(() => {
    if (!selected) return
    // Bind to the preview SVG (focusable) rather than `window`, so arrows only
    // nudge the code while the preview is focused — arrows pressed while a
    // select/input elsewhere has focus won't move it.
    const svg = svgRef.current
    if (!svg) return
    function handleKey(e: KeyboardEvent) {
      // Nudge only the axis pressed, so the other axis keeps its alignment: a
      // horizontal nudge must not freeze the vertical snap, and a vertical nudge
      // must not turn a left/center/right code into a custom X position.
      const next: Partial<WordStyle> = {}
      switch (e.key) {
        case 'ArrowLeft':
          next.xMm = xMm - stepXMm
          break
        case 'ArrowRight':
          next.xMm = xMm + stepXMm
          break
        case 'ArrowUp':
          next.yMm = yMm + stepYMm
          next.valign = 'custom'
          break
        case 'ArrowDown':
          next.yMm = yMm - stepYMm
          next.valign = 'custom'
          break
        default:
          return
      }
      e.preventDefault()
      onChange(next)
    }
    svg.addEventListener('keydown', handleKey)
    return () => svg.removeEventListener('keydown', handleKey)
  }, [selected, xMm, yMm, stepXMm, stepYMm, onChange, svgRef])
}

// Build the pointer-down handler that drags a code around the card. Shift locks the
// drag to the dominant axis; only the axis that actually moved is written, so a
// single-axis drag leaves the other axis's alignment intact.
export function useCodeDrag({
  svgRef,
  xMm,
  yMm,
  onSelect,
  onChange,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>
  xMm: number
  yMm: number
  onSelect: () => void
  onChange: (next: Partial<WordStyle>) => void
}) {
  return function handlePointerDown(e: ReactPointerEvent<SVGGElement>) {
    e.stopPropagation()
    onSelect()
    const svg = svgRef.current
    if (!svg) return
    // Focus the preview so arrow keys nudge this code (and not whatever control
    // last had focus). preventScroll avoids the page jumping to the canvas.
    svg.focus({ preventScroll: true })
    const viewBox = svg.viewBox.baseVal
    const rect = svg.getBoundingClientRect()
    const scaleX = viewBox.width / rect.width
    const scaleY = viewBox.height / rect.height

    const startClientX = e.clientX
    const startClientY = e.clientY
    const startXMm = xMm
    const startYMm = yMm
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
      const next: Partial<WordStyle> = {}
      if (dxUser !== 0) next.xMm = startXMm + dxUser / MM
      if (dyUser !== 0) {
        next.yMm = startYMm - dyUser / MM
        // Moving the code vertically overrides any snapped vertical alignment.
        next.valign = 'custom'
      }
      if (next.xMm === undefined && next.yMm === undefined) return
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
}
