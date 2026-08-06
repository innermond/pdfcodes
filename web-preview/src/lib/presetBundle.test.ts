import { describe, it, expect } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { buildPresetZip, loadPresetBundle, type PresetResources } from './presetBundle'

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

describe('loadPresetBundle folder-wrapped archives', () => {
  // A preset re-zipped as a folder (`unzip` then re-`zip`, or archived from
  // Finder/Explorer) nests every entry under a top-level directory, while the
  // manifest paths inside settings.json stay relative to the zip root.
  it('resolves settings.json and resources under a folder prefix', async () => {
    const settings = {
      version: 1,
      words: [],
      resources: { background: 'background.pdf', csv: 'codes.csv' },
    }
    const wrapped = zipSync({
      'background-setari/': new Uint8Array(),
      'background-setari/settings.json': strToU8(JSON.stringify(settings)),
      'background-setari/background.pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      'background-setari/codes.csv': strToU8('a,b\n1,2\n'),
    })
    const file = new File([wrapped], 'background-setari.zip', { type: 'application/zip' })

    const loaded = await loadPresetBundle(file)
    expect((loaded.preset as { version?: number }).version).toBe(1)
    expect(loaded.background).toBeTruthy()
    expect(loaded.csv).toBeTruthy()
    expect(await loaded.background!.text()).toBe('%PDF')
  })

  // A flattened junk directory: the only shape the `__MACOSX/` skip itself catches,
  // and the reason it is still there.
  it('ignores __MACOSX junk when locating settings.json', async () => {
    const wrapped = zipSync({
      '__MACOSX/settings.json': strToU8('garbage'),
      'preset/settings.json': strToU8(JSON.stringify({ version: 2, words: [] })),
    })
    const file = new File([wrapped], 'preset.zip', { type: 'application/zip' })

    const loaded = await loadPresetBundle(file)
    expect((loaded.preset as { version?: number }).version).toBe(2)
  })

  // What Finder actually writes: a mirror tree of `._`-prefixed AppleDouble files.
  // Handled by the basename test rather than the `__MACOSX/` skip, which is why it
  // is worth asserting separately from the case above.
  it('ignores the AppleDouble tree a real macOS zip carries', async () => {
    const wrapped = zipSync({
      '__MACOSX/': new Uint8Array(),
      '__MACOSX/preset/._settings.json': strToU8('AppleDouble junk'),
      '__MACOSX/preset/._background.pdf': strToU8('AppleDouble junk'),
      'preset/settings.json': strToU8(JSON.stringify({ version: 3, words: [] })),
    })
    const file = new File([wrapped], 'preset.zip', { type: 'application/zip' })

    const loaded = await loadPresetBundle(file)
    expect((loaded.preset as { version?: number }).version).toBe(3)
  })

  // The nested entry is listed first on purpose: under the old first-match rule it
  // won, and the preset the archive is obviously *about* lost.
  it('prefers a root-level settings.json over a nested one', async () => {
    const wrapped = zipSync({
      'backup/settings.json': strToU8(JSON.stringify({ version: 99, words: [] })),
      'settings.json': strToU8(JSON.stringify({ version: 1, words: [] })),
    })
    const file = new File([wrapped], 'preset.zip', { type: 'application/zip' })

    const loaded = await loadPresetBundle(file)
    expect((loaded.preset as { version?: number }).version).toBe(1)
  })

  // Two presets at the same depth is genuinely ambiguous; archive order decides, and
  // the resources resolved must come from the *same* folder as the settings chosen.
  it('resolves an equal-depth tie by archive order, resources included', async () => {
    const a = { version: 10, words: [], resources: { csv: 'codes.csv' } }
    const b = { version: 20, words: [], resources: { csv: 'codes.csv' } }
    const wrapped = zipSync({
      'preset-a/settings.json': strToU8(JSON.stringify(a)),
      'preset-a/codes.csv': strToU8('from,a\n'),
      'preset-b/settings.json': strToU8(JSON.stringify(b)),
      'preset-b/codes.csv': strToU8('from,b\n'),
    })
    const file = new File([wrapped], 'presets.zip', { type: 'application/zip' })

    const loaded = await loadPresetBundle(file)
    expect((loaded.preset as { version?: number }).version).toBe(10)
    expect(await loaded.csv!.text()).toBe('from,a\n')
  })
})
