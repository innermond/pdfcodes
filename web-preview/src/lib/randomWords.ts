import { DEFAULT_FONT_FAMILY } from './fonts'

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

let measureCanvas: HTMLCanvasElement | null = null

// Measure text width in the same numeric unit as `WordStyle.fontSizePt` and
// `PdfBackground.widthPt` (both are "user units" of the card's viewBox), so
// the result is directly comparable to the background width.
function measureWidth(text: string, fontSizePt: number): number {
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return text.length * fontSizePt
  ctx.font = `${fontSizePt}px ${DEFAULT_FONT_FAMILY}`
  return ctx.measureText(text).width
}

// Generate a random uppercase alphanumeric string whose rendered width at
// `fontSizePt` fits within `maxWidthPt`, with a random length so it doesn't
// always fill the entire available width.
export function randomWordFittingWidth(maxWidthPt: number, fontSizePt: number): string {
  let text = ''
  while (true) {
    const next = text + CHARSET[Math.floor(Math.random() * CHARSET.length)]
    if (measureWidth(next, fontSizePt) > maxWidthPt) break
    text = next
  }
  if (text.length <= 1) return text || CHARSET[Math.floor(Math.random() * CHARSET.length)]

  const minLen = Math.min(3, text.length)
  const targetLen = minLen + Math.floor(Math.random() * (text.length - minLen + 1))
  return text.slice(0, targetLen)
}
