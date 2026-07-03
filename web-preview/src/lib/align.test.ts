import { describe, expect, it } from 'vitest'
import { MM, baseAlign, defaultWordStyle, horizontalAlignXMm, verticalAlignYMm, type ContourAlignRect } from './options'

// These run in the node env (no canvas), so the helpers use their deterministic
// fallback metrics: ascent = 0.8*fs/MM, descent = 0.2*fs/MM, textWidth = 0.6*fs*len/MM.
const word = { ...defaultWordStyle(0), text: 'AB', fontSizePt: 10, charSpacingPt: 0 }
const ascentMm = (word.fontSizePt * 0.8) / MM
const descentMm = (word.fontSizePt * 0.2) / MM
const textWidthMm = (word.fontSizePt * 0.6 * word.text.length) / MM
const contour: ContourAlignRect = { leftMm: 15, bottomMm: 20, widthMm: 40, heightMm: 30 }
const safe = 2

describe('baseAlign', () => {
  it('strips contour variants to their base card alignment', () => {
    expect(baseAlign('contour-left')).toBe('left')
    expect(baseAlign('contour-center')).toBe('center')
    expect(baseAlign('contour-right')).toBe('right')
    expect(baseAlign('center')).toBe('center')
  })
})

describe('verticalAlignYMm contour framing', () => {
  it('frames contour-top/middle/bottom against the contour rectangle', () => {
    expect(verticalAlignYMm('contour-top', word, 'sans', 100, safe, contour)).toBeCloseTo(20 + 30 - safe - ascentMm, 6)
    expect(verticalAlignYMm('contour-bottom', word, 'sans', 100, safe, contour)).toBeCloseTo(20 + safe + descentMm, 6)
    expect(verticalAlignYMm('contour-middle', word, 'sans', 100, safe, contour)).toBeCloseTo(20 + 30 / 2 - (ascentMm - descentMm) / 2, 6)
  })

  it('falls back to the card frame when no contour rect is given', () => {
    expect(verticalAlignYMm('contour-top', word, 'sans', 100, safe)).toBeCloseTo(verticalAlignYMm('top', word, 'sans', 100, safe), 6)
  })
})

describe('horizontalAlignXMm contour framing', () => {
  it('frames contour-left/center/right against the contour rectangle', () => {
    expect(horizontalAlignXMm('contour-left', word, 'sans', 100, safe, contour)).toBeCloseTo(15 + safe, 6)
    expect(horizontalAlignXMm('contour-right', word, 'sans', 100, safe, contour)).toBeCloseTo(15 + 40 - textWidthMm - safe, 6)
    expect(horizontalAlignXMm('contour-center', word, 'sans', 100, safe, contour)).toBeCloseTo(15 + 40 / 2 - textWidthMm / 2, 6)
  })

  it('falls back to the card frame when no contour rect is given', () => {
    expect(horizontalAlignXMm('contour-left', word, 'sans', 100, safe)).toBeCloseTo(horizontalAlignXMm('left', word, 'sans', 100, safe), 6)
  })
})

describe('contour alignment insets by contourInsetMm (not the card margin)', () => {
  const inset = 5 // distinct from `safe` (2)
  it('vertical contour edges use the contour inset', () => {
    expect(verticalAlignYMm('contour-top', word, 'sans', 100, safe, contour, inset)).toBeCloseTo(20 + 30 - inset - ascentMm, 6)
    expect(verticalAlignYMm('contour-bottom', word, 'sans', 100, safe, contour, inset)).toBeCloseTo(20 + inset + descentMm, 6)
  })
  it('horizontal contour edges use the contour inset', () => {
    expect(horizontalAlignXMm('contour-left', word, 'sans', 100, safe, contour, inset)).toBeCloseTo(15 + inset, 6)
    expect(horizontalAlignXMm('contour-right', word, 'sans', 100, safe, contour, inset)).toBeCloseTo(15 + 40 - textWidthMm - inset, 6)
  })
  it('card modes still use the card margin even when a contour inset is passed', () => {
    expect(verticalAlignYMm('top', word, 'sans', 100, safe, contour, inset)).toBeCloseTo(100 - safe - ascentMm, 6)
    expect(horizontalAlignXMm('left', word, 'sans', 100, safe, contour, inset)).toBeCloseTo(safe, 6)
  })
})
