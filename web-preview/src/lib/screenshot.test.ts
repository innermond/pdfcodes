import { describe, it, expect } from 'vitest'
import { buildFontFaceCss } from './screenshot'

// Only the pure, DOM-free part is unit-tested here. `prepareSvgForExport` (cloneNode /
// createElementNS), `rasterizePreview` (Image + canvas) and the clipboard/download
// helpers need a real browser — vitest runs in node with no jsdom — so they're covered
// by the manual verification in the plan instead.
describe('buildFontFaceCss', () => {
  it('emits one base64 @font-face per family', () => {
    const bytes = (s: string) => new TextEncoder().encode(s).buffer
    const css = buildFontFaceCss([
      { family: 'fam-a', bytes: bytes('hello') },
      { family: 'fam-b', bytes: bytes('world') },
    ])
    const faces = css.split('\n')
    expect(faces).toHaveLength(2)
    expect(faces[0]).toContain("font-family:'fam-a'")
    // "hello" → base64 is "aGVsbG8=".
    expect(faces[0]).toContain('src:url(data:application/octet-stream;base64,aGVsbG8=)')
    expect(faces[1]).toContain("font-family:'fam-b'")
  })

  it('is empty for no families', () => {
    expect(buildFontFaceCss([])).toBe('')
  })
})
