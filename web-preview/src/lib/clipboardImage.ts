// Acquire an image from the clipboard for the "Clipboard" background source. Two paste
// paths are supported: the async Clipboard API (`navigator.clipboard.read`, driven by a
// button click) and a `paste` event's DataTransfer (Ctrl/Cmd+V), which works where the
// async API is restricted. Whatever type comes back is normalized to PNG via a canvas
// (blobToPngFile) because the background pipeline's Rust decoder only accepts PNG/JPEG
// (src/generate/image_bg.rs).

import { looksLikeSvg } from './svgBackground'

// Image MIME types we accept off the clipboard, in preference order. Anything the
// browser can decode is fine — it's re-encoded to PNG before use.
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']

// First supported image MIME in `types` (e.g. a ClipboardItem's `.types`), or null when
// none is an image we handle.
export function pickImageType(types: readonly string[]): string | null {
  for (const t of SUPPORTED_IMAGE_TYPES) {
    if (types.includes(t)) return t
  }
  // Fall back to any `image/*` the list offers (covers exotic types the browser can
  // still decode, e.g. image/svg+xml, image/avif).
  return types.find((t) => t.startsWith('image/')) ?? null
}

// Read the first image on the clipboard via the async Clipboard API. Returns null when
// the API is unavailable, permission is denied, or the clipboard holds no image, so the
// caller can show a friendly message instead of throwing.
export async function readImageBlobFromClipboard(): Promise<Blob | null> {
  try {
    if (!navigator.clipboard?.read) return null
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const type = pickImageType(item.types)
      if (type) return await item.getType(type)
    }
    return null
  } catch {
    return null
  }
}

// Pull the first image out of a paste event's DataTransfer (Ctrl/Cmd+V), or null.
export function imageBlobFromDataTransfer(dt: DataTransfer | null): Blob | null {
  if (!dt) return null
  for (const item of dt.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  for (const file of dt.files) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}

// Acquire a vector file (PDF or SVG) from the clipboard for the Step-2 contour
// "Clipboard" source. Same two paste paths as the image pair above, but instead of
// rasterizing, the file is handed over as-is: a PDF goes straight to the contour
// pipeline and an SVG is converted to a vector PDF downstream (lib/svgWasm.ts).

// True for a clipboard file we can use as contour source: declared PDF/SVG MIME, or
// (when the OS didn't map the extension) a .pdf/.svg name on a type-less file.
function isVectorFile(file: File): boolean {
  if (file.type) return file.type === 'application/pdf' || file.type === 'image/svg+xml'
  return /\.(pdf|svg)$/i.test(file.name)
}

// Wrap clipboard SVG markup in a File so it flows through the same path as an
// uploaded .svg.
function svgTextToFile(text: string): File {
  return new File([text], 'contur.svg', { type: 'image/svg+xml' })
}

// Pull the first PDF/SVG out of a paste event's DataTransfer (Ctrl/Cmd+V), or null.
// Files copied from a file manager arrive in items/files; SVG markup copied from an
// editor arrives as text/plain and is sniffed with looksLikeSvg.
export function vectorFileFromDataTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null
  for (const item of dt.items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file && isVectorFile(file)) return file
    }
  }
  for (const file of dt.files) {
    if (isVectorFile(file)) return file
  }
  const text = dt.getData('text/plain')
  if (text && looksLikeSvg(new TextEncoder().encode(text))) return svgTextToFile(text)
  return null
}

// Read the first PDF/SVG on the clipboard via the async Clipboard API (button click).
// Browsers never expose OS-copied *files* here (only a paste event's DataTransfer
// carries those — hence the Ctrl/Cmd+V hint in the UI), and Chrome's read() even
// throws when the clipboard holds one. So after read() finds nothing usable — or
// isn't available at all (Firefox) — fall back to readText(), which is supported
// more widely and still covers the SVG-markup-as-text case.
export async function readVectorFileFromClipboard(): Promise<File | null> {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        if (item.types.includes('image/svg+xml')) {
          const blob = await item.getType('image/svg+xml')
          return new File([blob], 'contur.svg', { type: 'image/svg+xml' })
        }
        if (item.types.includes('application/pdf')) {
          const blob = await item.getType('application/pdf')
          return new File([blob], 'contur.pdf', { type: 'application/pdf' })
        }
        if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text()
          if (looksLikeSvg(new TextEncoder().encode(text))) return svgTextToFile(text)
        }
      }
    }
  } catch {
    // fall through to readText
  }
  try {
    const text = await navigator.clipboard?.readText?.()
    if (text && looksLikeSvg(new TextEncoder().encode(text))) return svgTextToFile(text)
  } catch {
    // unavailable/denied → null below
  }
  return null
}

// Re-encode any decodable image blob to a PNG File so it flows through the same pipeline
// as an uploaded PNG/JPEG (whose Rust decoder only handles PNG + JPEG).
export async function blobToPngFile(blob: Blob, name = 'clipboard.png'): Promise<File> {
  const bmp = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bmp, 0, 0)
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG'))), 'image/png')
    })
    return new File([png], name, { type: 'image/png' })
  } finally {
    if (typeof bmp.close === 'function') bmp.close()
  }
}
