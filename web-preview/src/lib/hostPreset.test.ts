import { describe, it, expect } from 'vitest'
import { parseHostPreset } from './hostPreset'

// Only the pure descriptor validation is unit-tested here; `readHostPreset`
// (window globals) and `fetchHostPreset` (network) need a real browser and are
// verified manually against the host page.
const BASE = 'https://exemplu.ro/etichete/coduri-unice-decupare-contur/'

describe('parseHostPreset', () => {
  it('rejects anything that is not an object carrying a url', () => {
    expect(parseHostPreset(null, BASE)).toBeNull()
    expect(parseHostPreset(undefined, BASE)).toBeNull()
    expect(parseHostPreset('/presetari/a.zip', BASE)).toBeNull()
    expect(parseHostPreset(['/presetari/a.zip'], BASE)).toBeNull()
    expect(parseHostPreset({ name: 'Fără url' }, BASE)).toBeNull()
    expect(parseHostPreset({ url: '   ' }, BASE)).toBeNull()
    expect(parseHostPreset({ url: 42 }, BASE)).toBeNull()
  })

  it('resolves a relative url against the page', () => {
    expect(parseHostPreset({ url: 'presetari/flori.zip' }, BASE)).toEqual({
      url: 'https://exemplu.ro/etichete/coduri-unice-decupare-contur/presetari/flori.zip',
    })
    expect(parseHostPreset({ url: '/presetari/flori.zip' }, BASE)).toEqual({
      url: 'https://exemplu.ro/presetari/flori.zip',
    })
  })

  it('rejects a cross-origin url', () => {
    expect(parseHostPreset({ url: 'https://altcineva.ro/a.zip' }, BASE)).toBeNull()
    // Same host, different scheme/port is still a different origin.
    expect(parseHostPreset({ url: 'http://exemplu.ro/a.zip' }, BASE)).toBeNull()
    expect(parseHostPreset({ url: 'https://exemplu.ro:8443/a.zip' }, BASE)).toBeNull()
  })

  it('keeps a trimmed name and drops an unusable one', () => {
    expect(parseHostPreset({ url: '/a.zip', name: '  Flori 2026 ' }, BASE)).toEqual({
      url: 'https://exemplu.ro/a.zip',
      name: 'Flori 2026',
    })
    expect(parseHostPreset({ url: '/a.zip', name: '   ' }, BASE)).toEqual({
      url: 'https://exemplu.ro/a.zip',
    })
    expect(parseHostPreset({ url: '/a.zip', name: 7 }, BASE)).toEqual({
      url: 'https://exemplu.ro/a.zip',
    })
  })

  it('returns null for a malformed url instead of throwing', () => {
    expect(parseHostPreset({ url: 'http://' }, BASE)).toBeNull()
  })
})
