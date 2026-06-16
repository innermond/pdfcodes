import { describe, expect, it } from 'vitest'
import {
  cmykToRgb,
  cmykToSquarePos,
  colorToCss,
  contrastColor,
  formatCmyk,
  hsvToRgb,
  parseCmyk,
  rgbHexToCmyk,
  rgbToHsv,
  squareToCmyk,
} from './cmyk'

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

  it('converts HSV primaries to RGB', () => {
    expect(hsvToRgb(0, 1, 1)).toEqual({ r: 255, g: 0, b: 0 })
    expect(hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 255, b: 0 })
    expect(hsvToRgb(240, 1, 1)).toEqual({ r: 0, g: 0, b: 255 })
    expect(hsvToRgb(0, 0, 1)).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('round-trips hsv <-> rgb for sample hues', () => {
    for (const h of [0, 60, 120, 180, 240, 300]) {
      const rgb = hsvToRgb(h, 1, 1)
      const back = rgbToHsv(rgb)
      expect(Math.round(back.h)).toBe(h)
      expect(back.s).toBeCloseTo(1, 5)
      expect(back.v).toBeCloseTo(1, 5)
    }
  })

  it('maps the top of the square (full saturation) to a K-free CMYK color', () => {
    // x=0 -> hue 0 (red), y=0 -> full saturation, k preserved at 0.
    expect(squareToCmyk(0, 0, 0)).toBe('0:1:1:0')
    // The K argument is carried straight through.
    expect(squareToCmyk(0, 0, 0.5)).toBe('0:1:1:0.5')
  })

  it('picks a contrasting default text color for a background', () => {
    expect(contrastColor(null)).toBe('0:0:0:1') // white card -> black
    expect(contrastColor('0:0:0:0')).toBe('0:0:0:1') // white bg -> black
    expect(contrastColor('0:0:0:1')).toBe('0:0:0:0') // black bg -> white
    expect(contrastColor('0:0:0:0.9')).toBe('0:0:0:0') // very dark gray -> white
    expect(contrastColor('1:1:0:0')).toBe('0:0:0:0') // saturated blue -> white
    expect(contrastColor('0:0:1:0')).toBe('0:0:0:1') // yellow -> black
  })

  it('places the marker by inverting squareToCmyk', () => {
    // The color is quantized to 8-bit twice, so allow a small tolerance.
    for (const [xFrac, yFrac] of [[0, 0], [0.5, 0.25], [0.75, 0.6]]) {
      const pos = cmykToSquarePos(squareToCmyk(xFrac, yFrac, 0))
      expect(Math.abs(pos.xFrac - xFrac)).toBeLessThan(0.02)
      expect(Math.abs(pos.yFrac - yFrac)).toBeLessThan(0.02)
    }
  })
})
