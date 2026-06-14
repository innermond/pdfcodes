import { describe, expect, it } from 'vitest'
import { defaultCodeColumn, generateCodesCsv, type CodeColumnConfig } from './codeSource'

function column(overrides: Partial<CodeColumnConfig>): CodeColumnConfig {
  return { ...defaultCodeColumn(), ...overrides }
}

describe('generateCodesCsv', () => {
  it('generates one line per row, separated by newlines', () => {
    const csv = generateCodesCsv(3, [column({ mode: 'range', rangeStart: 1, rangeStep: 1, padLength: 0 })], ' ')
    expect(csv.split('\n')).toEqual(['1', '2', '3'])
  })

  it('applies range start, step and zero-padding', () => {
    const csv = generateCodesCsv(3, [column({ mode: 'range', rangeStart: 10, rangeStep: 5, padLength: 4 })], ' ')
    expect(csv.split('\n')).toEqual(['0010', '0015', '0020'])
  })

  it('wraps the code with optional prefix and postfix, separated by a single space', () => {
    const csv = generateCodesCsv(1, [column({ mode: 'range', rangeStart: 1, padLength: 3, prefix: 'AB', postfix: 'X' })], ' ')
    expect(csv).toBe('AB 001 X')
  })

  it('omits surrounding spaces when prefix/postfix are empty', () => {
    const csv = generateCodesCsv(1, [column({ mode: 'range', rangeStart: 7, prefix: '', postfix: '' })], ' ')
    expect(csv).toBe('7')
  })

  it('joins multiple codes per row with the given separator', () => {
    const columns = [
      column({ mode: 'range', rangeStart: 1, prefix: 'A' }),
      column({ mode: 'range', rangeStart: 100, prefix: 'B' }),
    ]
    const csv = generateCodesCsv(2, columns, ';')
    expect(csv.split('\n')).toEqual(['A 1;B 100', 'A 2;B 101'])
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
})
