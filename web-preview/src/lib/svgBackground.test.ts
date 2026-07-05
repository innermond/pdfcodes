import { describe, it, expect } from 'vitest'
import { isSvgFile, looksLikeSvg } from './svgBackground'

// Only the DOM-free helpers are unit-tested here. `inspectSvg` and
// `prepareSvgForBackground` need DOMParser/XMLSerializer — vitest runs in node
// with no jsdom (same trade-off as screenshot.test.ts) — so they're covered by
// the svg-wasm Rust tests plus manual verification in the browser.

const enc = (s: string) => new TextEncoder().encode(s)

describe('looksLikeSvg', () => {
  it('accepts a bare root element', () => {
    expect(looksLikeSvg(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true)
  })

  it('accepts a BOM, XML prolog, DOCTYPE, comments and whitespace before the root', () => {
    const svg = '\ufeff' + `<?xml version="1.0" encoding="UTF-8"?>
      <!-- exported by a design tool -->
      <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`
    expect(looksLikeSvg(enc(svg))).toBe(true)
  })

  it('rejects other formats and lookalikes', () => {
    expect(looksLikeSvg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false) // PNG
    expect(looksLikeSvg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false) // JPEG
    expect(looksLikeSvg(enc('<html><body>nope</body></html>'))).toBe(false)
    expect(looksLikeSvg(enc('<svgfoo/>'))).toBe(false) // prefix is not the element name
    expect(looksLikeSvg(enc('plain text mentioning <svg>'))).toBe(false)
    expect(looksLikeSvg(enc(''))).toBe(false)
  })

  it('rejects an unterminated comment or prolog', () => {
    expect(looksLikeSvg(enc('<!-- endless'))).toBe(false)
    expect(looksLikeSvg(enc('<?xml version="1.0"'))).toBe(false)
  })
})

describe('isSvgFile', () => {
  it('matches by MIME type', () => {
    expect(isSvgFile(new File([''], 'logo', { type: 'image/svg+xml' }))).toBe(true)
  })

  it('falls back to the extension when the type is missing', () => {
    expect(isSvgFile(new File([''], 'logo.SVG', { type: '' }))).toBe(true)
  })

  it('rejects rasters, even with a lying .svg name', () => {
    expect(isSvgFile(new File([''], 'photo.png', { type: 'image/png' }))).toBe(false)
    expect(isSvgFile(new File([''], 'photo.svg', { type: 'image/png' }))).toBe(false)
  })
})
