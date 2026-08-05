import { describe, expect, it } from 'vitest'
import { parseUploadedCsv } from './csvImport'
import { describeDelimiter, keptRows, serializeRows, skippedRows } from './csvSerialize'

// PapaParse accepts a raw string as well as a File; passing a string lets us
// exercise the real delimiter-detection and warning logic without a DOM/File.
function parse(text: string, forced?: string) {
  return parseUploadedCsv(text as unknown as File, forced)
}

describe('parseUploadedCsv', () => {
  it('auto-detects a comma delimiter', async () => {
    const r = await parse('a,b,c\nd,e,f')
    expect(r.delimiter).toBe(',')
    expect(r.columnCount).toBe(3)
    expect(r.rows).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ])
    expect(r.warnings).toEqual([])
  })

  it('auto-detects a semicolon delimiter', async () => {
    const r = await parse('a;b\nc;d')
    expect(r.delimiter).toBe(';')
    expect(r.rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('auto-detects a tab delimiter', async () => {
    const r = await parse('a\tb\nc\td')
    expect(r.delimiter).toBe('\t')
  })

  it('strips a UTF-8 BOM from the first field', async () => {
    const r = await parse('﻿code1,code2\nx,y')
    expect(r.rows[0]).toEqual(['code1', 'code2'])
  })

  it('unquotes fields and normalises line endings', async () => {
    const r = await parse('"a","b"\r\n"c","d"\r\n')
    expect(r.rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('skips fully empty lines', async () => {
    const r = await parse('a,b\n\n\nc,d\n')
    expect(r.rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('keeps a quoted field that contains the delimiter as one field, no warning', async () => {
    const r = await parse('"a,b",c\nx,y')
    expect(r.rows).toEqual([
      ['a,b', 'c'],
      ['x', 'y'],
    ])
    // The downstream pipeline re-joins with a collision-safe separator, so a
    // field containing the delimiter is no longer flagged.
    expect(r.warnings).toEqual([])
  })

  it('does not warn for a single-column file (no delimiter needed)', async () => {
    const r = await parse('AB1\nAB2\nAB3')
    expect(r.rows).toEqual([['AB1'], ['AB2'], ['AB3']])
    expect(r.warnings).toEqual([])
  })

  it('warns when rows have inconsistent column counts', async () => {
    const r = await parse('a,b,c\nd,e')
    expect(r.warnings.some((w) => w.includes('coloane'))).toBe(true)
  })

  it('warns about an empty file', async () => {
    const r = await parse('\n  \n')
    expect(r.rows).toEqual([])
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('honours a forced delimiter over auto-detection', async () => {
    // Commas would otherwise win; force semicolon so each line stays one field.
    const r = await parse('a,b;c,d', ';')
    expect(r.delimiter).toBe(';')
    expect(r.rows).toEqual([['a,b', 'c,d']])
  })
})

describe('serializeRows', () => {
  it('joins fields by the separator, one record per line', () => {
    expect(serializeRows([['1', '2'], ['3', '4']], ',')).toBe('1,2\n3,4')
  })

  it('falls back to a space for an empty separator', () => {
    expect(serializeRows([['a', 'b']], '')).toBe('a b')
  })
})

describe('describeDelimiter', () => {
  it('names common delimiters in a human-readable way', () => {
    expect(describeDelimiter(',')).toContain('virgulă')
    expect(describeDelimiter(';')).toContain('punct')
    expect(describeDelimiter('\t')).toBe('tab')
    expect(describeDelimiter(' ')).toBe('spațiu')
  })
})

describe('keptRows', () => {
  const rows = ['header', 'a', 'b', 'c', 'total']

  it('returns every row when nothing is skipped', () => {
    // The default path must be a no-op — this is what every existing upload does.
    expect(keptRows(rows, 0, 0)).toEqual(rows)
  })

  it('drops rows off the front', () => {
    expect(keptRows(rows, 1, 0)).toEqual(['a', 'b', 'c', 'total'])
    expect(keptRows(rows, 2, 0)).toEqual(['b', 'c', 'total'])
  })

  it('drops rows off the back', () => {
    expect(keptRows(rows, 0, 1)).toEqual(['header', 'a', 'b', 'c'])
  })

  it('drops from both ends at once', () => {
    expect(keptRows(rows, 1, 1)).toEqual(['a', 'b', 'c'])
  })

  it('returns nothing when the skips consume every row', () => {
    // Must never produce a reversed or wrapped slice.
    expect(keptRows(rows, 3, 2)).toEqual([])
    expect(keptRows(rows, 5, 0)).toEqual([])
    expect(keptRows(rows, 0, 5)).toEqual([])
    expect(keptRows(rows, 99, 99)).toEqual([])
  })

  it('keeps a single row when the skips leave exactly one', () => {
    expect(keptRows(rows, 2, 2)).toEqual(['b'])
  })

  it('clamps negative, fractional and non-finite counts to no skip', () => {
    // NaN is what an emptied NumberField emits; the rest can arrive from a
    // hand-edited preset or an old undo snapshot. Nonsense input keeps the
    // user's rows visible rather than silently emptying the file.
    expect(keptRows(rows, -3, 0)).toEqual(rows)
    expect(keptRows(rows, NaN, NaN)).toEqual(rows)
    expect(keptRows(rows, Infinity, 0)).toEqual(rows)
    expect(keptRows(rows, 1.9, 0)).toEqual(['a', 'b', 'c', 'total'])
  })

  it('treats a huge but finite skip as dropping everything', () => {
    expect(keptRows(rows, 1e9, 0)).toEqual([])
  })

  it('handles an empty input', () => {
    expect(keptRows([], 0, 0)).toEqual([])
    expect(keptRows([], 2, 2)).toEqual([])
  })
})

describe('skippedRows', () => {
  const rows = ['header', 'a', 'b', 'c', 'total']

  it('returns nothing when nothing is skipped', () => {
    expect(skippedRows(rows, 0, 0)).toEqual({ before: [], after: [] })
  })

  it('splits the dropped rows by which end they came off', () => {
    expect(skippedRows(rows, 1, 1)).toEqual({ before: ['header'], after: ['total'] })
    expect(skippedRows(rows, 2, 0)).toEqual({ before: ['header', 'a'], after: [] })
    expect(skippedRows(rows, 0, 2)).toEqual({ before: [], after: ['c', 'total'] })
  })

  it('reports every row as skipped when the skips consume the file', () => {
    // Must agree with keptRows returning [] for the same arguments.
    expect(keptRows(rows, 3, 3)).toEqual([])
    expect(skippedRows(rows, 3, 3)).toEqual({ before: rows, after: [] })
  })

  it('partitions the rows exactly — no row lost, none counted twice', () => {
    for (const [first, last] of [[0, 0], [1, 0], [0, 1], [2, 2], [1, 3]]) {
      const skipped = skippedRows(rows, first, last)
      expect([...skipped.before, ...keptRows(rows, first, last), ...skipped.after]).toEqual(rows)
    }
  })

  it('clamps nonsense counts the same way keptRows does', () => {
    expect(skippedRows(rows, -1, NaN)).toEqual({ before: [], after: [] })
  })
})
