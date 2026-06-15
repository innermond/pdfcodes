import { describe, expect, it } from 'vitest'
import { cmykToRgb, colorToCss, formatCmyk, parseCmyk, rgbHexToCmyk } from './cmyk'

describe('cmyk', () => {
  it('serializes CMYK to the generator "c:m:y:k" form', () => {
    expect(formatCmyk({ c: 0, m: 0, y: 0, k: 1 })).toBe('0:0:0:1')
    expect(formatCmyk({ c: 0.5, m: 0.25, y: 0, k: 0.1 })).toBe('0.5:0.25:0:0.1')
  })

  it('parses "c:m:y:k" strings and clamps out-of-range values', () => {
    expect(parseCmyk('0:0:0:1')).toEqual({ c: 0, m: 0, y: 0, k: 1 })
    expect(parseCmyk('2:-1:0:0')).toEqual({ c: 1, m: 0, y: 0, k: 0 })
  })

  it('parses legacy hex into CMYK', () => {
    expect(parseCmyk('#000000')).toEqual({ c: 0, m: 0, y: 0, k: 1 })
    expect(parseCmyk('#ffffff')).toEqual({ c: 0, m: 0, y: 0, k: 0 })
    expect(parseCmyk('#00ffff')).toEqual({ c: 1, m: 0, y: 0, k: 0 })
  })

  it('falls back to black for malformed values', () => {
    expect(parseCmyk('not-a-color')).toEqual({ c: 0, m: 0, y: 0, k: 1 })
  })

  it('converts CMYK to RGB', () => {
    expect(cmykToRgb({ c: 0, m: 0, y: 0, k: 1 })).toEqual({ r: 0, g: 0, b: 0 })
    expect(cmykToRgb({ c: 0, m: 0, y: 0, k: 0 })).toEqual({ r: 255, g: 255, b: 255 })
    expect(cmykToRgb({ c: 1, m: 0, y: 0, k: 0 })).toEqual({ r: 0, g: 255, b: 255 })
  })

  it('round-trips hex -> cmyk -> hex for primary colors', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff']) {
      expect(colorToCss(formatCmyk(rgbHexToCmyk(hex)))).toBe(hex)
    }
  })

  it('colorToCss passes hex through and converts cmyk to hex', () => {
    expect(colorToCss('#abcdef')).toBe('#abcdef')
    expect(colorToCss('0:0:0:1')).toBe('#000000')
    expect(colorToCss('1:0:0:0')).toBe('#00ffff')
  })
})
