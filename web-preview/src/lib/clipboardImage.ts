// Acquire a vector file (PDF or SVG) from the clipboard for the Step-2 contour
// "Clipboard" source. Same two paste paths as the raster image helpers in
// `@shared/clipboardImage`, but instead of rasterizing, the file is handed over as-is:
// a PDF goes straight to the contour pipeline and an SVG is converted to a vector PDF
// downstream (lib/svgWasm.ts).

import { looksLikeSvg } from './svgBackground'

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
