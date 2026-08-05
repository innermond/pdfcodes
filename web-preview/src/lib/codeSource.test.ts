import { describe, expect, it } from 'vitest'
import {
  CSV_PREVIEW_ROW_COUNT,
  defaultCodeColumn,
  generateCodesCsv,
  generateCsvPreview,
  generateSampleRow,
  leaderColumn,
  maxGroupRowCount,
  mergeFields,
  normalizeColumns,
  streamCodesCsv,
  totalRowCount,
  type CodeColumnConfig,
  type LeaderValue,
} from './codeSource'

function column(overrides: Partial<CodeColumnConfig>): CodeColumnConfig {
  return { ...defaultCodeColumn(), ...overrides }
}

/** A leader column: `values` is a list of [value, rows] pairs; null rows inherit the default. */
function leader(values: [string, number | null][], overrides: Partial<CodeColumnConfig> = {}): CodeColumnConfig {
  const list: LeaderValue[] = values.map(([value, rows]) => ({ value, rows }))
  return column({ mode: 'list', values: list, ...overrides })
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
    expect(preview.text.split('\n')).toHaveLength(CSV_PREVIEW_ROW_COUNT)
    expect(preview.text.split('\n')).toEqual(Array.from({ length: CSV_PREVIEW_ROW_COUNT }, (_, i) => String(i + 1)))
    expect(preview).toMatchObject({ shown: CSV_PREVIEW_ROW_COUNT, total: 100_000 })
  })

  it('does not cap below the requested row count', () => {
    const preview = generateCsvPreview(5, [column({ mode: 'range', rangeStart: 1 })], ' ')
    expect(preview.text.split('\n')).toEqual(['1', '2', '3', '4', '5'])
    expect(preview).toMatchObject({ shown: 5, total: 5 })
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

describe('normalizeColumns', () => {
  it('demotes a list mode outside the first column to a fixed text', () => {
    const columns = [column({ mode: 'random' }), leader([['B', 3]])]
    expect(normalizeColumns(columns)[1].mode).toBe('text')
  })

  it('keeps a list mode on the first column', () => {
    const columns = [leader([['A', 3]]), column({ mode: 'random' })]
    expect(normalizeColumns(columns)[0].mode).toBe('list')
  })

  it('returns the same array when nothing needs fixing', () => {
    const columns = [column({ mode: 'range' })]
    expect(normalizeColumns(columns)).toBe(columns)
  })

  it('backfills values missing from a preset written before leaders existed', () => {
    const legacy = { ...defaultCodeColumn(), values: undefined } as unknown as CodeColumnConfig
    expect(normalizeColumns([legacy])[0].values).toEqual([])
  })
})

describe('leader row counts', () => {
  it('reports no leader when the first code is not a list', () => {
    expect(leaderColumn([column({ mode: 'random' })])).toBeNull()
  })

  it('reports no leader for a list with no values yet', () => {
    expect(leaderColumn([leader([])])).toBeNull()
  })

  it('ignores a list that is not the first code', () => {
    expect(leaderColumn([column({ mode: 'random' }), leader([['B', 3]])])).toBeNull()
  })

  it('totals the leader blocks instead of the default row count', () => {
    const columns = [leader([['A', 500], ['B', 120], ['C', 50]])]
    expect(totalRowCount(columns, 10)).toBe(670)
    expect(maxGroupRowCount(columns, 10)).toBe(500)
  })

  it('inherits the default row count for a blank per-value count', () => {
    const columns = [leader([['A', 5], ['B', null], ['C', null]])]
    expect(totalRowCount(columns, 10)).toBe(25)
    expect(maxGroupRowCount(columns, 10)).toBe(10)
  })

  it('falls back to the plain row count with no leader', () => {
    const columns = [column({ mode: 'range' })]
    expect(totalRowCount(columns, 42)).toBe(42)
    expect(maxGroupRowCount(columns, 42)).toBe(42)
  })
})

describe('generateCodesCsv with a leader', () => {
  it('repeats each leader value over its own block, joined with the other codes', () => {
    const columns = [leader([['A', 2], ['B', 3]]), column({ mode: 'range', rangeStart: 1 })]
    expect(generateCodesCsv(10, columns, ',').split('\n')).toEqual([
      'A,1', 'A,2',
      'B,1', 'B,2', 'B,3',
    ])
  })

  it('restarts a range follower at rangeStart inside every block', () => {
    const columns = [leader([['A', 3], ['B', 3]]), column({ mode: 'range', rangeStart: 10, rangeStep: 5 })]
    expect(generateCodesCsv(1, columns, ',').split('\n')).toEqual([
      'A,10', 'A,15', 'A,20',
      'B,10', 'B,15', 'B,20',
    ])
  })

  it('uses the default row count for blocks with a blank count', () => {
    const columns = [leader([['A', null], ['B', 1]]), column({ mode: 'range', rangeStart: 1 })]
    expect(generateCodesCsv(2, columns, ',').split('\n')).toEqual(['A,1', 'A,2', 'B,1'])
  })

  it('applies the leader prefix/postfix but never padding', () => {
    const columns = [
      leader([['A', 2]], { prefix: '[', postfix: ']', padMode: 'width', padChar: '0', padLength: 10 }),
      column({ mode: 'range', rangeStart: 1 }),
    ]
    expect(generateCodesCsv(1, columns, ',').split('\n')).toEqual(['[A],1', '[A],2'])
  })

  it('emits leader-only rows when there are no follower codes', () => {
    expect(generateCodesCsv(1, [leader([['A', 2], ['B', 1]])], ',').split('\n')).toEqual(['A', 'A', 'B'])
  })

  it('keeps random followers unique within a block', () => {
    // 100 possible codes, blocks of 100 rows: uniqueness is achievable per block
    // but impossible across the 200-row total — which is exactly the point.
    const columns = [leader([['A', 100], ['B', 100]]), column({ mode: 'random', charset: 'numeric', length: 2 })]
    const rows = generateCodesCsv(1, columns, ',').split('\n')
    for (const value of ['A', 'B']) {
      const codes = rows.filter((r) => r.startsWith(`${value},`)).map((r) => r.split(',')[1])
      expect(new Set(codes).size).toBe(100)
    }
  })

  it('treats a list with no values as a plain column, not as random codes', () => {
    // The user picked the mode but hasn't typed a value yet: emit the bare
    // prefix/postfix rather than random codes the leader will never produce.
    const columns = [leader([], { prefix: '<', postfix: '>' })]
    expect(generateCodesCsv(2, columns, ',').split('\n')).toEqual(['<>', '<>'])
  })

  it('skips a block whose row count is zero', () => {
    const columns = [leader([['A', 0], ['B', 2]]), column({ mode: 'range', rangeStart: 1 })]
    expect(generateCodesCsv(5, columns, ',').split('\n')).toEqual(['B,1', 'B,2'])
  })
})

describe('generateSampleRow', () => {
  it('returns the first row of the first leader block', () => {
    const columns = [leader([['A', 3], ['B', 3]]), column({ mode: 'range', rangeStart: 7 })]
    expect(generateSampleRow(1, columns, ',')).toBe('A,7')
  })

  it('returns the first row without a leader', () => {
    expect(generateSampleRow(10, [column({ mode: 'range', rangeStart: 4 })], ',')).toBe('4')
  })

  it('returns an empty string when nothing would be generated', () => {
    expect(generateSampleRow(0, [column({ mode: 'range' })], ',')).toBe('')
  })
})

describe('generateCsvPreview with a leader', () => {
  const labels = {
    skippedRows: (count: number) => `<skip ${count}>`,
    moreGroups: (count: number) => `<groups ${count}>`,
  }

  it('shows a slice of every block instead of only the first one', () => {
    const columns = [leader([['A', 500], ['B', 120], ['C', 50]]), column({ mode: 'range', rangeStart: 1 })]
    const preview = generateCsvPreview(10, columns, ',', labels)
    const lines = preview.text.split('\n')

    // 15 lines over 3 blocks → 5 rows each, with the remainder marked.
    expect(lines.filter((l) => l.startsWith('A,'))).toHaveLength(5)
    expect(lines.filter((l) => l.startsWith('B,'))).toHaveLength(5)
    expect(lines.filter((l) => l.startsWith('C,'))).toHaveLength(5)
    expect(lines).toContain('<skip 495>')
    expect(lines).toContain('<skip 115>')
    expect(lines).toContain('<skip 45>')
    // Markers are not data rows.
    expect(preview).toMatchObject({ shown: 15, total: 670 })
  })

  it('never renders more than CSV_PREVIEW_ROW_COUNT data rows', () => {
    const columns = [leader(Array.from({ length: 40 }, (_, i) => [`V${i}`, 100] as [string, number]))]
    const preview = generateCsvPreview(10, columns, ',', labels)
    expect(preview.shown).toBeLessThanOrEqual(CSV_PREVIEW_ROW_COUNT)
    expect(preview.total).toBe(4000)
    // Blocks beyond the cap are summarised rather than rendered.
    expect(preview.text.split('\n')).toContain('<groups 25>')
  })

  it('marks nothing when every block fits in the budget', () => {
    const columns = [leader([['A', 2], ['B', 3]]), column({ mode: 'range', rangeStart: 1 })]
    const preview = generateCsvPreview(10, columns, ',', labels)
    expect(preview.text.split('\n')).toEqual(['A,1', 'A,2', 'B,1', 'B,2', 'B,3'])
    expect(preview).toMatchObject({ shown: 5, total: 5 })
  })
})

describe('streamCodesCsv with a leader', () => {
  async function collect(generator: AsyncGenerator<{ text: string; rowsDone: number; duplicates: number }>) {
    const chunks: { text: string; rowsDone: number; duplicates: number }[] = []
    for await (const chunk of generator) chunks.push(chunk)
    return chunks
  }

  it('matches generateCodesCsv when a chunk is smaller than a block', async () => {
    const columns = [leader([['A', 5], ['B', 4]]), column({ mode: 'range', rangeStart: 1 })]
    const chunks = await collect(streamCodesCsv(10, columns, ',', 2))
    expect(chunks.map((c) => c.text).join('').trimEnd()).toBe(generateCodesCsv(10, columns, ','))
    expect(chunks.at(-1)?.rowsDone).toBe(9)
  })

  it('matches generateCodesCsv when a block is smaller than a chunk', async () => {
    const columns = [leader([['A', 2], ['B', 3], ['C', 1]]), column({ mode: 'range', rangeStart: 1 })]
    const chunks = await collect(streamCodesCsv(10, columns, ',', 100))
    expect(chunks.map((c) => c.text).join('').trimEnd()).toBe(generateCodesCsv(10, columns, ','))
    expect(chunks.at(-1)?.rowsDone).toBe(6)
  })

  it('counts rowsDone over the leader total, not the default row count', async () => {
    const columns = [leader([['A', 3], ['B', 3]])]
    const chunks = await collect(streamCodesCsv(10, columns, ',', 2))
    expect(chunks.map((c) => c.rowsDone)).toEqual([2, 4, 6])
  })
})
