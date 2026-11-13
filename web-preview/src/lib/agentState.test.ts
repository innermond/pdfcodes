import { describe, expect, it } from 'vitest'
import { describePdfCodes } from './agentState'

describe('describePdfCodes', () => {
  const state = describePdfCodes({
    step: 'aspect',
    mode: 'print',
    selectedIndex: 0,
    textFromFile: false,
    sampleText: 'AB-12',
    words: [{ text: 'AB-12', color: '0:0:0:1', fontSizePt: 9, yMm: 4, xMm: null, secret: 'x' }],
    bgConfig: { backgroundSource: 'simple', simpleBgWidthMm: 86, simpleBgHeightMm: 54, simpleBgColor: null, genBgImageUrl: 'https://x' },
    contourConfig: { contourSource: 'shape', shapeKind: 'heart', contourTargetWidthMm: NaN },
    styleConfig: { bleedMm: 1 },
  })

  it('reports each setting under its vocabulary name, colours as hex, and nothing else', () => {
    expect(state.words[0]).toMatchObject({ index: 0, text: 'AB-12', fontSizePt: 9, yMm: 4, xMm: null })
    expect(state.words[0].color).toMatch(/^#[0-9a-f]{6}$/)
    expect(state.words[0]).not.toHaveProperty('secret')
    expect(state.background).toEqual({ source: 'simple', simpleBgWidthMm: 86, simpleBgHeightMm: 54, simpleBgColor: null })
    expect(state.contour).toEqual({ source: 'shape', shapeKind: 'heart' })
    expect(state.style).toEqual({ bleedMm: 1 })
  })
})
