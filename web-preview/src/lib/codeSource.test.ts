import { describe, expect, it } from 'vitest'
import {
  CSV_PREVIEW_ROW_COUNT,
  defaultCodeColumn,
  generateCodesCsv,
  generateCsvPreview,
  mergeFields,
  streamCodesCsv,
  type CodeColumnConfig,
} from './codeSource'

function column(overrides: Partial<CodeColumnConfig>): CodeColumnConfig {
  return { ...defaultCodeColumn(), ...overrides }
}

describe('mergeFields', () => {
  it('returns the pieces unchanged when no gaps are merged', () => {
    expect(mergeFields(['1A', '1'], new Set(), ' ')).toEqual(['1A', '1'])
  })

  it('merges adjacent pieces across a merged gap, re-joining with the separator', () => {
    expect(mergeFields(['1A', '1'], new Set([0]), ' ')).toEqual(['1A 1'])
  })

  it('regroups a multi-field row by its merged gaps', () => {
    // "1A 1 2B 2" → pieces, merging gaps 0 and 2 → ["1A 1", "2B 2"]
    expect(mergeFields(['1A', '1', '2B', '2'], new Set([0, 2]), ' ')).toEqual(['1A 1', '2B 2'])
  })

  it('handles empty input', () => {
    expect(mergeFields([], new Set([0]), ' ')).toEqual([])
  })

  it('trims edge whitespace introduced by merging empty pieces', () => {
    // A trailing empty piece (from a trailing delimiter) must not leave a
    // trailing space, which would shift the centred text in the PDF.
    expect(mergeFields(['1A', '1', ''], new Set([0, 1]), ' ')).toEqual(['1A 1'])
    expect(mergeFields(['', '1A', '1'], new Set([0, 1]), ' ')).toEqual(['1A 1'])
  })

  it('removes an internal tab joiner entirely (zero width, not a space)', () => {
    // A tab has no defined print width, so a tab-delimited upload's joined field
    // must not keep it — the pieces glue together. (A real space would be kept.)
    expect(mergeFields(['1A', '1'], new Set([0]), '\t')).toEqual(['1A1'])
    expect(mergeFields(['1A', '1', ''], new Set([0, 1]), '\t')).toEqual(['1A1'])
  })

  it('keeps a real space but collapses runs of spaces', () => {
    expect(mergeFields(['1A', '1'], new Set([0]), ' ')).toEqual(['1A 1'])
    expect(mergeFields(['1A ', ' 1'], new Set([0]), ' ')).toEqual(['1A 1'])
  })

  it('strips stray edge separators left by empty pieces (non-space separator)', () => {
    // A trailing/leading delimiter (comma) must not survive at the field edge,
    // or the generator (advance width) and preview (ink box) would centre it
    // differently. Internal separators are kept.
    expect(mergeFields(['1A', '1', ''], new Set([0, 1]), ',')).toEqual(['1A,1'])
    expect(mergeFields(['', '1A', '1'], new Set([0, 1]), ',')).toEqual(['1A,1'])
    expect(mergeFields(['1A', '1'], new Set([0]), ',')).toEqual(['1A,1'])
  })
})

describe('generateCodesCsv', () => {
  it('generates one line per row, separated by newlines', () => {
    const csv = generateCodesCsv(3, [column({ mode: 'range', rangeStart: 1, rangeStep: 1, padLength: 0 })], ' ')
    expect(csv.split('\n')).toEqual(['1', '2', '3'])
  })

  it('applies range start, step and zero-padding', () => {
    const csv = generateCodesCsv(3, [column({ mode: 'range', rangeStart: 10, rangeStep: 5, padLength: 4 })], ' ')
    expect(csv.split('\n')).toEqual(['0010', '0015', '0020'])
  })

  it('zero-pads random numeric codes shorter than padLength', () => {
    const csv = generateCodesCsv(20, [column({ mode: 'random', charset: 'numeric', length: 3, padLength: 6 })], ' ')
    for (const line of csv.split('\n')) {
      expect(line).toHaveLength(6)
      expect(line).toMatch(/^0+[0-9]{3}$/)
    }
  })

  it('uses custom padChar (not default 0) for random numeric codes when padLength > length', () => {
    const csv = generateCodesCsv(20, [column({ mode: 'random', charset: 'numeric', length: 3, padChar: 'X', padLength: 6 })], ' ')
    for (const line of csv.split('\n')) {
      expect(line).toHaveLength(6)
      expect(line).toMatch(/^X+[0-9]{3}$/)
    }
  })

  it('applies no padding for random codes when padLength equals length', () => {
    const csv = generateCodesCsv(20, [column({ mode: 'random', charset: 'numeric', length: 6, padChar: 'X', padLength: 6 })], ' ')
    for (const line of csv.split('\n')) {
      expect(line).toHaveLength(6)
      expect(line).toMatch(/^[0-9]{6}$/)
    }
  })

  it('leaves codes untouched when padLength is shorter than the code', () => {
    const csv = generateCodesCsv(1, [column({ mode: 'range', rangeStart: 12345, padLength: 3 })], ' ')
    expect(csv).toBe('12345')
  })

  it('pads to width with a custom fill character', () => {
    const csv = generateCodesCsv(2, [column({ mode: 'range', rangeStart: 1, padMode: 'width', padChar: 'X', padLength: 4 })], ' ')
    expect(csv.split('\n')).toEqual(['XXX1', 'XXX2'])
  })

  it('pads to width with a multi-character fill', () => {
    const csv = generateCodesCsv(1, [column({ mode: 'range', rangeStart: 5, padMode: 'width', padChar: 'ab', padLength: 7 })], ' ')
    expect(csv).toBe('ababab5')
  })

  it('prepends a fixed pad string in fixed mode regardless of length', () => {
    const csv = generateCodesCsv(2, [column({ mode: 'range', rangeStart: 9, padMode: 'fixed', padChar: '00', padLength: 4 })], ' ')
    expect(csv.split('\n')).toEqual(['009', '0010'])
  })

  it('applies no padding when the pad character is empty', () => {
    const csv = generateCodesCsv(1, [column({ mode: 'range', rangeStart: 7, padMode: 'width', padChar: '', padLength: 5 })], ' ')
    expect(csv).toBe('7')
  })

  it('attaches prefix and postfix directly to the code, with no separator', () => {
    const csv = generateCodesCsv(1, [column({ mode: 'range', rangeStart: 1, padLength: 3, prefix: 'AB', postfix: 'X' })], ' ')
    expect(csv).toBe('AB001X')
  })

  it('keeps spaces the user adds inside prefix/postfix', () => {
    const csv = generateCodesCsv(1, [column({ mode: 'range', rangeStart: 1, padLength: 3, prefix: 'AB ', postfix: ' X' })], ' ')
    expect(csv).toBe('AB 001 X')
  })

  it('produces just the code when prefix/postfix are empty', () => {
    const csv = generateCodesCsv(1, [column({ mode: 'range', rangeStart: 7, prefix: '', postfix: '' })], ' ')
    expect(csv).toBe('7')
  })

  it('joins multiple codes per row with the given separator', () => {
    const columns = [
      column({ mode: 'range', rangeStart: 1, prefix: 'A' }),
      column({ mode: 'range', rangeStart: 100, prefix: 'B' }),
    ]
    const csv = generateCodesCsv(2, columns, ';')
    expect(csv.split('\n')).toEqual(['A1;B100', 'A2;B101'])
  })

  it('defaults to a space separator when given an empty string', () => {
    const columns = [column({ mode: 'range', rangeStart: 1 }), column({ mode: 'range', rangeStart: 9 })]
    const csv = generateCodesCsv(1, columns, '')
    expect(csv).toBe('1 9')
  })

  it.each([
    ['numeric', /^[0-9]+$/],
    ['alpha', /^[A-Z]+$/],
    ['alphanumeric', /^[0-9A-Z]+$/],
  ] as const)('generates random %s codes from the expected charset and length', (charset, pattern) => {
    const csv = generateCodesCsv(20, [column({ mode: 'random', charset, length: 8 })], ' ')
    for (const line of csv.split('\n')) {
      expect(line).toHaveLength(8)
      expect(line).toMatch(pattern)
    }
  })

  it('returns an empty string for zero rows', () => {
    expect(generateCodesCsv(0, [defaultCodeColumn()], ' ')).toBe('')
  })

  it('repeats the fixed text on every row in text mode', () => {
    const csv = generateCodesCsv(3, [column({ mode: 'text', text: 'SPECIMEN' })], ' ')
    expect(csv.split('\n')).toEqual(['SPECIMEN', 'SPECIMEN', 'SPECIMEN'])
  })

  it('applies prefix/postfix to a fixed text but no padding', () => {
    const csv = generateCodesCsv(1, [column({ mode: 'text', text: 'WM', prefix: '[', postfix: ']', padMode: 'width', padChar: '0', padLength: 10 })], ' ')
    expect(csv).toBe('[WM]')
  })

  it('mixes a fixed-text column with a generated one', () => {
    const columns = [column({ mode: 'range', rangeStart: 1 }), column({ mode: 'text', text: 'COPY' })]
    const csv = generateCodesCsv(2, columns, ';')
    expect(csv.split('\n')).toEqual(['1;COPY', '2;COPY'])
  })
})

describe('generateCsvPreview', () => {
  it('caps the preview at CSV_PREVIEW_ROW_COUNT rows even for large row counts', () => {
    const preview = generateCsvPreview(100_000, [column({ mode: 'range', rangeStart: 1 })], ' ')
    expect(preview.split('\n')).toHaveLength(CSV_PREVIEW_ROW_COUNT)
    expect(preview.split('\n')).toEqual(Array.from({ length: CSV_PREVIEW_ROW_COUNT }, (_, i) => String(i + 1)))
  })

  it('does not cap below the requested row count', () => {
    const preview = generateCsvPreview(5, [column({ mode: 'range', rangeStart: 1 })], ' ')
    expect(preview.split('\n')).toEqual(['1', '2', '3', '4', '5'])
  })
})

describe('streamCodesCsv', () => {
  async function collect(generator: AsyncGenerator<{ text: string; rowsDone: number; duplicates: number }>) {
    const chunks: { text: string; rowsDone: number; duplicates: number }[] = []
    for await (const chunk of generator) chunks.push(chunk)
    return chunks
  }

  it('never reports duplicates for a fixed-text column, even when every row repeats', async () => {
    const chunks = await collect(streamCodesCsv(50, [column({ mode: 'text', text: 'SAME' })], ' ', 20))
    expect(chunks.at(-1)?.duplicates).toBe(0)
    const lines = chunks.map((c) => c.text).join('').split('\n').filter((l) => l.length > 0)
    expect(lines).toEqual(Array.from({ length: 50 }, () => 'SAME'))
  })

  it('yields the full CSV across multiple chunks with increasing rowsDone', async () => {
    const columns = [column({ mode: 'range', rangeStart: 1 })]
    const chunks = await collect(streamCodesCsv(10, columns, ' ', 3))

    expect(chunks.map((c) => c.rowsDone)).toEqual([3, 6, 9, 10])

    const lines = chunks
      .map((c) => c.text)
      .join('')
      .split('\n')
      .filter((line) => line.length > 0)
    expect(lines).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)))
  })

  it('yields nothing for zero rows', async () => {
    const chunks = await collect(streamCodesCsv(0, [defaultCodeColumn()], ' ', 5))
    expect(chunks).toEqual([])
  })

  it('matches generateCodesCsv output when chunks are concatenated', async () => {
    const columns = [column({ mode: 'range', rangeStart: 1, padLength: 3 }), column({ mode: 'range', rangeStart: 100 })]
    const chunks = await collect(streamCodesCsv(7, columns, ';', 4))
    const streamed = chunks.map((c) => c.text).join('').trimEnd()
    expect(streamed).toBe(generateCodesCsv(7, columns, ';'))
  })
})
