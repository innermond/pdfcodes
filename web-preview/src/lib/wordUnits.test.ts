import { describe, expect, it } from 'vitest'
import { defaultWordStyle, MM, type WordStyle } from './options'
import { canJoinPrevious, continuesPrevious, unitRunOffsets, unitStartXPt, wordUnits } from './wordUnits'

function word(over: Partial<WordStyle> = {}): WordStyle {
  return { ...defaultWordStyle(0), ...over }
}

describe('wordUnits', () => {
  it('keeps every code on its own unless flagged', () => {
    expect(wordUnits([word(), word(), word()])).toEqual([[0], [1], [2]])
  })

  it('groups consecutive flagged codes behind their leader', () => {
    expect(wordUnits([word(), word({ joinPrev: true }), word({ joinPrev: true }), word(), word({ joinPrev: true })])).toEqual([
      [0, 1, 2],
      [3, 4],
    ])
  })

  it('ignores a flag on the first code', () => {
    expect(wordUnits([word({ joinPrev: true }), word()])).toEqual([[0], [1]])
  })

  it('never lets a symbol join or lead', () => {
    expect(wordUnits([word(), word({ joinPrev: true, kind: 'qr' }), word({ joinPrev: true })])).toEqual([[0], [1], [2]])
    expect(wordUnits([word({ kind: 'barcode' }), word({ joinPrev: true })])).toEqual([[0], [1]])
  })

  it('knows which codes are continuations and which may be flagged', () => {
    const words = [word(), word({ joinPrev: true }), word({ kind: 'qr' })]
    expect(continuesPrevious(words, 0)).toBe(false)
    expect(continuesPrevious(words, 1)).toBe(true)
    expect(canJoinPrevious(words, 0)).toBe(false)
    expect(canJoinPrevious(words, 1)).toBe(true)
    expect(canJoinPrevious(words, 2)).toBe(false)
  })
})

describe('unitRunOffsets', () => {
  it('puts a gap (the previous run\'s space) between runs and none after the last', () => {
    const { offsets, totalPt } = unitRunOffsets([
      { text: 'AB', widthPt: 20, spacePt: 3 },
      { text: 'CD', widthPt: 10, spacePt: 2 },
      { text: 'EF', widthPt: 5, spacePt: 1 },
    ])
    expect(offsets).toEqual([0, 23, 35])
    expect(totalPt).toBe(40)
  })

  it('skips an empty run without adding a gap', () => {
    const { offsets, totalPt } = unitRunOffsets([
      { text: 'AB', widthPt: 20, spacePt: 3 },
      { text: '', widthPt: 0, spacePt: 3 },
      { text: 'CD', widthPt: 10, spacePt: 2 },
    ])
    expect(offsets).toEqual([0, 20, 23])
    expect(totalPt).toBe(33)
  })
})

describe('unitStartXPt', () => {
  const card = 200
  it('frames the whole unit width for card alignments', () => {
    expect(unitStartXPt({ align: 'center', xMm: null }, 60, card, 2, null, 2)).toBe(70)
    expect(unitStartXPt({ align: 'left', xMm: null }, 60, card, 2, null, 2)).toBe(2 * MM)
    expect(unitStartXPt({ align: 'right', xMm: null }, 60, card, 2, null, 2)).toBe(card - 60 - 2 * MM)
  })

  it('lets an explicit X win', () => {
    expect(unitStartXPt({ align: 'center', xMm: 10 }, 60, card, 2, null, 2)).toBe(10 * MM)
  })

  it('frames against the contour for contour alignments, ignoring a stale X', () => {
    const contour = { leftMm: 10, bottomMm: 0, widthMm: 40, heightMm: 20 }
    expect(unitStartXPt({ align: 'contour-left', xMm: 99 }, 60, card, 2, contour, 1)).toBe(10 * MM + 1 * MM)
    expect(unitStartXPt({ align: 'contour-center', xMm: 99 }, 60, card, 2, contour, 1)).toBe(10 * MM + (40 * MM - 60) / 2)
    expect(unitStartXPt({ align: 'contour-right', xMm: 99 }, 60, card, 2, contour, 1)).toBe(10 * MM + 40 * MM - 60 - 1 * MM)
  })

  it('falls back to the card frame when there is no contour', () => {
    expect(unitStartXPt({ align: 'contour-center', xMm: null }, 60, card, 2, null, 1)).toBe(70)
  })
})
