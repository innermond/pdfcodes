import { describe, it, expect } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildPresetZip, type PresetResources } from './presetBundle'

// Only the pure, DOM-free zip assembly is unit-tested here; the download itself
// (URL.createObjectURL + anchor) needs a real browser and is verified manually.
function readZip(bytes: Uint8Array) {
  const entries = unzipSync(bytes)
  const settings = JSON.parse(strFromU8(entries['settings.json'])) as {
    resources?: { thumbnail?: string }
  }
  return { entries, settings }
}

const noResources = (): PresetResources => ({ fonts: new Map() })

describe('buildPresetZip thumbnail handling', () => {
  it('adds thumbnail.png (and manifest entry) when a thumbnail is provided', async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
    const bytes = await buildPresetZip({ version: 1 }, { ...noResources(), thumbnail: png })
    const { entries, settings } = readZip(bytes)

    expect(entries['thumbnail.png']).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    expect(settings.resources?.thumbnail).toBe('thumbnail.png')
  })

  it('omits thumbnail.png when no thumbnail is provided (settings.json still saved)', async () => {
    const bytes = await buildPresetZip({ version: 1 }, noResources())
    const { entries, settings } = readZip(bytes)

    expect(entries['thumbnail.png']).toBeUndefined()
    expect(settings.resources?.thumbnail).toBeUndefined()
    expect(entries['settings.json']).toBeTruthy()
  })
})
