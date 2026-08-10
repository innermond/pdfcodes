import { describe, expect, it } from 'vitest'
import {
  buildJsOptions,
  defaultPageOptions,
  defaultWordStyle,
  horizontalAlignXMm,
  qrPayload,
  verticalAlignYMm,
  type WordStyle,
} from './options'
import { qrPathData, type QrMatrix } from './qrMatrix'

const textWord: WordStyle = { ...defaultWordStyle(0), text: 'AB12', fontSizePt: 10 }
const qrWord: WordStyle = { ...defaultWordStyle(0), text: 'AB12', kind: 'qr', qrSizeMm: 12 }

// buildJsOptions takes a long positional tail; every call here only needs the
// leading arguments, so wrap it once.
function jsOptions(words: WordStyle[]) {
  return buildJsOptions(words, ' ', 0, 0, defaultPageOptions, false) as Record<string, unknown>
}

describe('qrPayload', () => {
  it('encodes the bare code when no template is set', () => {
    expect(qrPayload(qrWord)).toBe('AB12')
  })

  it('substitutes the code into the template', () => {
    expect(qrPayload({ ...qrWord, qrTemplate: 'https://s.ro/v?c={code}' })).toBe('https://s.ro/v?c=AB12')
  })

  it('replaces every occurrence of the placeholder', () => {
    expect(qrPayload({ ...qrWord, qrTemplate: '{code}/{code}' })).toBe('AB12/AB12')
  })
})

describe('defaultWordStyle', () => {
  it('starts as text, so presets saved before QR existed keep loading as text', () => {
    // App merges a stored preset word over this default; a stored word with no
    // `kind` therefore inherits 'text'.
    const stored = { text: 'AB12', fontSizePt: 8 }
    const merged = { ...defaultWordStyle(0), ...stored }
    expect(merged.kind).toBe('text')
    expect(merged.qrEcc).toBe('M')
  })
})

describe('alignment with a QR box', () => {
  // A QR sits entirely above its anchor: the box is the square, ascent = the side,
  // descent = 0 — matching `qr_box` in src/generate/cards.rs.
  it('frames the square, not a glyph run, horizontally', () => {
    expect(horizontalAlignXMm('center', qrWord, 'sans', 100, 0)).toBeCloseTo((100 - 12) / 2, 6)
    expect(horizontalAlignXMm('right', qrWord, 'sans', 100, 2)).toBeCloseTo(100 - 12 - 2, 6)
  })

  it('treats yMm as the square bottom, with no descent below it', () => {
    // 'bottom' = margin + descent, and a QR has no descent.
    expect(verticalAlignYMm('bottom', qrWord, 'sans', 100, 2)).toBeCloseTo(2, 6)
    // 'top' leaves the whole square under the top margin.
    expect(verticalAlignYMm('top', qrWord, 'sans', 100, 2)).toBeCloseTo(100 - 2 - 12, 6)
    expect(verticalAlignYMm('middle', qrWord, 'sans', 100, 0)).toBeCloseTo(100 / 2 - 12 / 2, 6)
  })

  it('leaves text words on the glyph-metrics path', () => {
    const ascentMm = (textWord.fontSizePt * 0.8) / (72 / 25.4)
    expect(verticalAlignYMm('top', textWord, 'sans', 100, 2)).toBeCloseTo(100 - 2 - ascentMm, 6)
  })
})

describe('buildJsOptions QR wiring', () => {
  it('sends nothing QR-related when every word is text', () => {
    const opts = jsOptions([textWord])
    expect(opts.qrSizesMm).toBeUndefined()
    expect(opts.qrTemplates).toBeUndefined()
  })

  it('sends a zero size for text positions so one array carries both switch and size', () => {
    const opts = jsOptions([textWord, { ...qrWord, qrSizeMm: 14 }])
    expect(Array.from(opts.qrSizesMm as Float32Array)).toEqual([0, 14])
    expect(opts.qrQuietModules).toBe(4)
  })

  it('sends the template only for QR positions', () => {
    const opts = jsOptions([
      { ...textWord, qrTemplate: 'leftover-from-a-toggle' },
      { ...qrWord, qrTemplate: 'https://s.ro/{code}' },
    ])
    expect(opts.qrTemplates).toEqual(['', 'https://s.ro/{code}'])
  })

  it('never sends a glyph outline for a QR word', () => {
    // A QR ignores the outline stroke, so a QR word must not switch the whole
    // `textContours` array on for the other words either.
    expect(jsOptions([{ ...qrWord, contourColor: '#ff0000' }]).textContours).toEqual([])
    // With a text word that does have one, the QR still reports 'none'.
    const mixed = jsOptions([{ ...textWord, contourColor: '#ff0000' }, { ...qrWord, contourColor: '#ff0000' }])
    expect(mixed.textContours).toEqual(['#ff0000', 'none'])
  })
})

describe('qrPathData', () => {
  // A 3x3 matrix with a full top row and one isolated module, no quiet zone, so
  // the coordinates are easy to state exactly.
  const matrix: QrMatrix = { size: 3, bits: new Uint8Array([1, 1, 1, 0, 0, 0, 0, 1, 0]) }

  it('merges a horizontal run into one subpath', () => {
    // Side 3 with 3 modules and no quiet zone ⇒ 1 unit per module.
    const d = qrPathData(matrix, 0, 0, 3, 0)
    // The top row is a single 3-wide subpath, the lone module a 1-wide one.
    expect(d).toBe('M0 0h3v1h-3ZM1 2h1v1h-1Z')
  })

  it('insets by the quiet zone and scales modules to fit the square', () => {
    // 3 modules + 2x1 quiet = 5 across a side of 10 ⇒ 2 units per module, and the
    // first dark module starts one quiet zone in.
    const d = qrPathData(matrix, 0, 0, 10, 1)
    expect(d.startsWith('M2 2h6v2h-6Z')).toBe(true)
  })

  it('offsets by the square origin', () => {
    expect(qrPathData(matrix, 5, 7, 3, 0).startsWith('M5 7h3')).toBe(true)
  })
})
