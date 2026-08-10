import { describe, expect, it } from 'vitest'
import {
  buildJsOptions,
  codePayload,
  defaultPageOptions,
  defaultWordStyle,
  horizontalAlignXMm,
  migrateWord,
  verticalAlignYMm,
  type WordStyle,
} from './options'
import { modulePathData, type ModuleGrid } from './symbolBits'
import { symbologyFitsColumn } from './symbologyFit'
import { defaultCodeColumn } from './codeSource'

const textWord: WordStyle = { ...defaultWordStyle(0), text: 'AB12', fontSizePt: 10 }
const qrWord: WordStyle = { ...defaultWordStyle(0), text: 'AB12', kind: 'qr', qrSizeMm: 12 }
const barcodeWord: WordStyle = {
  ...defaultWordStyle(0),
  text: 'AB12',
  kind: 'barcode',
  barcodeWidthMm: 30,
  barcodeHeightMm: 10,
}

// buildJsOptions takes a long positional tail; every call here only needs the
// leading arguments, so wrap it once.
function jsOptions(words: WordStyle[]) {
  return buildJsOptions(words, ' ', 0, 0, defaultPageOptions, false) as Record<string, unknown>
}

describe('codePayload', () => {
  it('encodes the bare code when no template is set', () => {
    expect(codePayload(qrWord)).toBe('AB12')
  })

  it('substitutes the code into the template', () => {
    expect(codePayload({ ...qrWord, payloadTemplate: 'https://s.ro/v?c={code}' })).toBe('https://s.ro/v?c=AB12')
  })

  it('replaces every occurrence of the placeholder', () => {
    expect(codePayload({ ...qrWord, payloadTemplate: '{code}/{code}' })).toBe('AB12/AB12')
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
    expect(opts.payloadTemplates).toBeUndefined()
  })

  it('sends a zero size for text positions so one array carries both switch and size', () => {
    const opts = jsOptions([textWord, { ...qrWord, qrSizeMm: 14 }])
    expect(Array.from(opts.qrSizesMm as Float32Array)).toEqual([0, 14])
    expect(opts.qrQuietModules).toBe(4)
  })

  it('sends the template only for QR positions', () => {
    const opts = jsOptions([
      { ...textWord, payloadTemplate: 'leftover-from-a-toggle' },
      { ...qrWord, payloadTemplate: 'https://s.ro/{code}' },
    ])
    expect(opts.payloadTemplates).toEqual(['', 'https://s.ro/{code}'])
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

describe('modulePathData', () => {
  // A 3x3 QR-shaped grid with a full top row and one isolated module, no quiet zone,
  // so the coordinates are easy to state exactly.
  const qrGrid: ModuleGrid = { cols: 3, rows: 3, bits: new Uint8Array([1, 1, 1, 0, 0, 0, 0, 1, 0]), quiet: 0 }

  it('merges a horizontal run into one subpath', () => {
    // Side 3 with 3 modules and no quiet zone ⇒ 1 unit per module.
    expect(modulePathData(qrGrid, 0, 0, 3, 3)).toBe('M0 0h3v1h-3ZM1 2h1v1h-1Z')
  })

  it('insets a square grid by the quiet zone on both axes', () => {
    // 3 modules + 2x1 quiet = 5 across a side of 10 ⇒ 2 units per module, and the
    // first dark module starts one quiet zone in from the top-left.
    const d = modulePathData({ ...qrGrid, quiet: 1 }, 0, 0, 10, 10)
    expect(d.startsWith('M2 2h6v2h-6Z')).toBe(true)
  })

  it('offsets by the rectangle origin', () => {
    expect(modulePathData(qrGrid, 5, 7, 3, 3).startsWith('M5 7h3')).toBe(true)
  })

  it('draws a single-row grid as full-height bars with no vertical inset', () => {
    // How a barcode uses it: bars span the whole height, and the quiet zone applies
    // horizontally only — there is no top/bottom quiet zone on a 1D symbol.
    const bars: ModuleGrid = { cols: 4, rows: 1, bits: new Uint8Array([1, 0, 1, 1]), quiet: 1 }
    // 4 modules + 2 quiet = 6 across a width of 6 ⇒ 1 unit per module.
    expect(modulePathData(bars, 0, 0, 6, 20)).toBe('M1 0h1v20h-1ZM3 0h2v20h-2Z')
  })
})

describe('symbologyFitsColumn', () => {
  const numeric12 = { ...defaultCodeColumn(), charset: 'numeric' as const, length: 12 }

  it('accepts anything for the symbologies that encode anything', () => {
    const alphanumeric = defaultCodeColumn()
    expect(symbologyFitsColumn('code128', alphanumeric)).toBeNull()
    expect(symbologyFitsColumn('code39', alphanumeric)).toBeNull()
  })

  it('flags an alphanumeric source against EAN, which is the trap worth catching', () => {
    const mismatch = symbologyFitsColumn('ean13', defaultCodeColumn())
    expect(mismatch?.kind).toBe('charset')
    expect(mismatch?.needDigits).toBe(12)
  })

  it('flags a numeric source of the wrong length', () => {
    const mismatch = symbologyFitsColumn('ean13', { ...numeric12, length: 6 })
    expect(mismatch?.kind).toBe('length')
    expect(mismatch?.gotLength).toBe(6)
  })

  it('accepts the exact length, and the same plus a supplied check digit', () => {
    expect(symbologyFitsColumn('ean13', numeric12)).toBeNull()
    expect(symbologyFitsColumn('ean13', { ...numeric12, length: 13 })).toBeNull()
    expect(symbologyFitsColumn('ean8', { ...numeric12, length: 7 })).toBeNull()
  })

  it('counts the prefix and postfix, which are part of the printed code', () => {
    expect(symbologyFitsColumn('ean13', { ...numeric12, prefix: '99', length: 12 })?.gotLength).toBe(14)
    expect(symbologyFitsColumn('ean13', { ...numeric12, prefix: '99', length: 10 })).toBeNull()
  })

  it('stays silent when the length cannot be known ahead of time', () => {
    // A range without fixed-width padding grows with the numbers; the per-row
    // failure report covers that rather than a warning that might be wrong.
    const range = { ...numeric12, mode: 'range' as const, padMode: 'width' as const }
    expect(symbologyFitsColumn('ean13', range)).toBeNull()
  })
})

describe('barcode wiring', () => {
  it('sizes the box by width and height, not by a single side', () => {
    expect(horizontalAlignXMm('center', barcodeWord, 'sans', 100, 0)).toBeCloseTo((100 - 30) / 2, 6)
    // `yMm` is the bottom edge, so 'top' leaves the whole 10mm under the margin.
    expect(verticalAlignYMm('top', barcodeWord, 'sans', 100, 2)).toBeCloseTo(100 - 2 - 10, 6)
    expect(verticalAlignYMm('bottom', barcodeWord, 'sans', 100, 2)).toBeCloseTo(2, 6)
  })

  it('sends the barcode arrays only when a barcode word exists', () => {
    const qrOnly = jsOptions([qrWord])
    expect(qrOnly.codeKinds).toEqual(['qr'])
    expect(qrOnly.barcodeWidthsMm).toBeUndefined()

    const mixed = jsOptions([textWord, barcodeWord])
    expect(mixed.codeKinds).toEqual(['text', 'barcode'])
    expect(Array.from(mixed.barcodeWidthsMm as Float32Array)).toEqual([0, 30])
    expect(Array.from(mixed.barcodeHeightsMm as Float32Array)).toEqual([0, 10])
    expect(mixed.barcodeSymbologies).toEqual(['code128', 'code128'])
  })

  it('sends no symbol arrays at all when every word is text', () => {
    const opts = jsOptions([textWord])
    expect(opts.codeKinds).toBeUndefined()
    expect(opts.payloadTemplates).toBeUndefined()
  })

  it('shares the payload template between both symbol kinds', () => {
    const opts = jsOptions([
      { ...qrWord, payloadTemplate: 'https://s.ro/{code}' },
      { ...barcodeWord, payloadTemplate: 'X{code}' },
    ])
    expect(opts.payloadTemplates).toEqual(['https://s.ro/{code}', 'X{code}'])
  })

  it('never sends a glyph outline for a barcode word either', () => {
    expect(jsOptions([{ ...barcodeWord, contourColor: '#ff0000' }]).textContours).toEqual([])
  })
})

describe('migrateWord', () => {
  it('carries a preset\'s qrTemplate over to payloadTemplate', () => {
    // Presets saved between the QR and barcode releases used the old field name.
    const legacy = { ...defaultWordStyle(0), kind: 'qr' as const, qrTemplate: 'https://s.ro/{code}' }
    expect(migrateWord(legacy as WordStyle).payloadTemplate).toBe('https://s.ro/{code}')
  })

  it('leaves a current word untouched', () => {
    const current = { ...defaultWordStyle(0), payloadTemplate: 'X{code}' }
    expect(migrateWord(current)).toBe(current)
  })
})
