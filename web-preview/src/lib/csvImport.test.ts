import { describe, expect, it } from 'vitest'
import { describeDelimiter, parseUploadedCsv, serializeRows } from './csvImport'

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
