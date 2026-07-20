import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { m } from '../paraglide/messages'

// Settings presets are saved as a .zip bundle containing `settings.json`
// plus any binary resources (background/contour PDFs, custom fonts) that
// can't be represented as JSON. `settings.json`'s `resources` field maps
// logical slots to paths within the archive so `loadPresetBundle` knows
// what to extract. Older plain-JSON presets (no bundled resources) are
// still accepted for backwards compatibility.
export interface ResourceManifest {
  background?: string
  contour?: string
  csv?: string
  thumbnail?: string
  fonts?: Record<string, string>
}

export interface PresetResources {
  background?: File
  contour?: File
  csv?: File
  // A PNG preview of how the generated output looks, saved as a viewing aid.
  // Optional: omitted when the current settings can't produce a preview.
  thumbnail?: Blob
  fonts: Map<number, File>
}

export interface LoadedPresetBundle {
  preset: Record<string, unknown>
  background?: File
  contour?: File
  csv?: File
  fonts: Map<number, File>
}

function extOf(name: string, fallback: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(name)
  return match ? match[1] : fallback
}

// Content-type for a bundled resource, keyed by extension. The contour slot can hold a
// PDF, an SVG, or a raster image (a traced contour bundles its original PNG/JPEG), and
// the loader must report the right type so App can route it back through the same kind
// detection as a fresh pick.
function mimeForExt(name: string, fallback: string): string {
  const ext = extOf(name, '').toLowerCase()
  switch (ext) {
    case 'pdf': return 'application/pdf'
    case 'svg': return 'image/svg+xml'
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'csv': return 'text/csv'
    default: return fallback
  }
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Pure, DOM-free zip assembly: turns a preset + its resources into the zip bytes.
// Split out from `downloadPresetBundle` so it can be unit-tested without a browser
// (the download itself needs the DOM and is verified manually).
export async function buildPresetZip<T extends object>(
  preset: T,
  resources: PresetResources,
): Promise<Uint8Array<ArrayBuffer>> {
  const files: Zippable = {}
  const manifest: ResourceManifest = {}

  if (resources.background) {
    const path = `background.${extOf(resources.background.name, 'pdf')}`
    files[path] = new Uint8Array(await resources.background.arrayBuffer())
    manifest.background = path
  }

  if (resources.contour) {
    const path = `contour.${extOf(resources.contour.name, 'pdf')}`
    files[path] = new Uint8Array(await resources.contour.arrayBuffer())
    manifest.contour = path
  }

  if (resources.csv) {
    const path = `codes.${extOf(resources.csv.name, 'csv')}`
    files[path] = new Uint8Array(await resources.csv.arrayBuffer())
    manifest.csv = path
  }

  if (resources.thumbnail) {
    files['thumbnail.png'] = new Uint8Array(await resources.thumbnail.arrayBuffer())
    manifest.thumbnail = 'thumbnail.png'
  }

  if (resources.fonts.size > 0) {
    manifest.fonts = {}
    for (const [index, file] of resources.fonts) {
      const path = `fonts/word-${index}.${extOf(file.name, 'ttf')}`
      files[path] = new Uint8Array(await file.arrayBuffer())
      manifest.fonts[index] = path
    }
  }

  files['settings.json'] = strToU8(JSON.stringify({ ...preset, resources: manifest }, null, 2))

  return zipSync(files, { level: 6 })
}

export async function downloadPresetBundle<T extends object>(
  filename: string,
  preset: T,
  resources: PresetResources,
): Promise<void> {
  const zipped = await buildPresetZip(preset, resources)
  downloadBlob(filename, new Blob([zipped], { type: 'application/zip' }))
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

export async function loadPresetBundle(file: File): Promise<LoadedPresetBundle> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isZip = ZIP_MAGIC.every((b, i) => bytes[i] === b)

  if (!isZip) {
    const preset = JSON.parse(strFromU8(bytes)) as Record<string, unknown>
    return { preset, fonts: new Map() }
  }

  const entries = unzipSync(bytes)

  // Tolerate archives where the preset was re-zipped inside a folder
  // (`background-setari/settings.json`) or carries macOS `__MACOSX/` junk:
  // locate settings.json by basename, then resolve every manifest resource
  // (which are stored relative to the zip root) against the same prefix.
  const settingsKey = Object.keys(entries).find(
    (k) => !k.startsWith('__MACOSX/') && k.split('/').pop() === 'settings.json',
  )
  const settingsBytes = settingsKey ? entries[settingsKey] : undefined
  if (!settingsBytes) {
    throw new Error(m.errors_preset_bundle_invalid())
  }
  const prefix = settingsKey!.slice(0, settingsKey!.length - 'settings.json'.length)
  // A manifest path resolves to `<prefix><path>` in a folder-wrapped archive,
  // falling back to the bare path for archives saved at the root. The return
  // type is inferred from `entries` (fflate's ArrayBuffer-backed Uint8Array) so
  // the bytes stay assignable to BlobPart in the `new File(...)` calls below.
  const resource = (path: string) => entries[prefix + path] ?? entries[path]

  const preset = JSON.parse(strFromU8(settingsBytes)) as Record<string, unknown>
  const manifest = (preset.resources ?? {}) as ResourceManifest

  const result: LoadedPresetBundle = { preset, fonts: new Map() }

  const backgroundData = manifest.background ? resource(manifest.background) : undefined
  if (manifest.background && backgroundData) {
    result.background = new File([backgroundData], manifest.background.split('/').pop()!, {
      type: 'application/pdf',
    })
  }

  const contourData = manifest.contour ? resource(manifest.contour) : undefined
  if (manifest.contour && contourData) {
    const name = manifest.contour.split('/').pop()!
    result.contour = new File([contourData], name, {
      type: mimeForExt(name, 'application/pdf'),
    })
  }

  const csvData = manifest.csv ? resource(manifest.csv) : undefined
  if (manifest.csv && csvData) {
    result.csv = new File([csvData], manifest.csv.split('/').pop()!, {
      type: 'text/csv',
    })
  }

  if (manifest.fonts) {
    for (const [indexStr, path] of Object.entries(manifest.fonts)) {
      const data = resource(path)
      if (data) {
        result.fonts.set(Number(indexStr), new File([data], path.split('/').pop()!))
      }
    }
  }

  return result
}
