import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'

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
  fonts?: Record<string, string>
}

export interface PresetResources {
  background?: File
  contour?: File
  csv?: File
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

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadPresetBundle<T extends object>(
  filename: string,
  preset: T,
  resources: PresetResources,
): Promise<void> {
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

  if (resources.fonts.size > 0) {
    manifest.fonts = {}
    for (const [index, file] of resources.fonts) {
      const path = `fonts/word-${index}.${extOf(file.name, 'ttf')}`
      files[path] = new Uint8Array(await file.arrayBuffer())
      manifest.fonts[index] = path
    }
  }

  files['settings.json'] = strToU8(JSON.stringify({ ...preset, resources: manifest }, null, 2))

  const zipped = zipSync(files, { level: 6 })
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
  const settingsBytes = entries['settings.json']
  if (!settingsBytes) {
    throw new Error('Arhivă invalidă: lipsește settings.json.')
  }
  const preset = JSON.parse(strFromU8(settingsBytes)) as Record<string, unknown>
  const manifest = (preset.resources ?? {}) as ResourceManifest

  const result: LoadedPresetBundle = { preset, fonts: new Map() }

  if (manifest.background && entries[manifest.background]) {
    result.background = new File([entries[manifest.background]], manifest.background.split('/').pop()!, {
      type: 'application/pdf',
    })
  }

  if (manifest.contour && entries[manifest.contour]) {
    result.contour = new File([entries[manifest.contour]], manifest.contour.split('/').pop()!, {
      type: 'application/pdf',
    })
  }

  if (manifest.csv && entries[manifest.csv]) {
    result.csv = new File([entries[manifest.csv]], manifest.csv.split('/').pop()!, {
      type: 'text/csv',
    })
  }

  if (manifest.fonts) {
    for (const [indexStr, path] of Object.entries(manifest.fonts)) {
      const data = entries[path]
      if (data) {
        result.fonts.set(Number(indexStr), new File([data], path.split('/').pop()!))
      }
    }
  }

  return result
}
