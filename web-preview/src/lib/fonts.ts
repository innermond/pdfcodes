// WOFF2 (~104 kB vs the 336 kB TTF): these bytes are display-only — FontFace
// registration and the screenshot path's inline @font-face, both of which
// sniff the format. The generator never sees them; Rust falls back to its own
// embedded TTF copy (src/assets/fonts/Montserrat-Bold.ttf via src/fonts.rs).
import montserratBoldUrl from '../assets/fonts/Montserrat-Bold.woff2?url'

export interface LoadedFont {
  family: string
  fileName: string
  file: File
}

// Matches the bundled Montserrat Bold the CLI/generator falls back to when
// no `--fonts` are provided (src/fonts.rs, src/generate/mod.rs).
export const DEFAULT_FONT_FAMILY = 'pdfcodes-preview-default'

let defaultFontReady: Promise<void> | null = null

// Load the default font into the document's font set exactly once.
export function ensureDefaultFont(): Promise<void> {
  if (!defaultFontReady) {
    defaultFontReady = fetch(montserratBoldUrl)
      .then((res) => res.arrayBuffer())
      .then((buffer) => new FontFace(DEFAULT_FONT_FAMILY, buffer).load())
      .then((fontFace) => {
        document.fonts.add(fontFace)
      })
  }
  return defaultFontReady
}

let defaultFontBytes: Promise<ArrayBuffer> | null = null

// Raw bytes of the bundled default font, fetched (and cached) once. Used to embed an
// `@font-face` for `DEFAULT_FONT_FAMILY` when rasterizing the preview SVG to an image —
// a serialized SVG can't see the document's JS-registered FontFaces, so the bytes have
// to travel inline. See `lib/screenshot.ts`.
export function getDefaultFontBytes(): Promise<ArrayBuffer> {
  if (!defaultFontBytes) {
    defaultFontBytes = fetch(montserratBoldUrl).then((res) => res.arrayBuffer())
  }
  // Hand out a fresh copy each call: a consumer may transfer/detach the buffer, which
  // must not poison the cache.
  return defaultFontBytes.then((buf) => buf.slice(0))
}

let counter = 0

// Load font bytes into the document's font set, returning a unique
// font-family name to use in SVG `font-family`. `fileName` is wrapped into a
// `File` so the result can be sent to the generator the same way as an
// uploaded font (see resolveFontFiles in App.tsx).
export async function loadFontBytes(bytes: ArrayBuffer, fileName: string): Promise<LoadedFont> {
  const family = `pdfcodes-preview-font-${counter++}`
  const fontFace = new FontFace(family, bytes)
  await fontFace.load()
  document.fonts.add(fontFace)
  registeredFaces.set(family, fontFace)
  return { family, fileName, file: new File([bytes], fileName) }
}

// Faces this module added to `document.fonts`, by family. The document keeps
// every face (and its bytes) for the page's life unless told otherwise, so
// `syncDocumentFonts` drops the ones no word uses any more.
const registeredFaces = new Map<string, FontFace>()

// Make the document's font set match `inUse`: delete faces nothing references,
// and re-register a face that was dropped earlier (an undo, or a cached Google
// font coming back) from the bytes still held in `LoadedFont.file`.
export function syncDocumentFonts(inUse: LoadedFont[]): void {
  const wanted = new Set(inUse.map((f) => f.family))
  for (const [family, face] of registeredFaces) {
    if (!wanted.has(family)) {
      document.fonts.delete(face)
      registeredFaces.delete(family)
    }
  }
  for (const font of inUse) {
    if (registeredFaces.has(font.family)) continue
    // Claim the slot synchronously so repeated syncs don't register it twice.
    const face = new FontFace(font.family, new ArrayBuffer(0))
    registeredFaces.set(font.family, face)
    void font.file.arrayBuffer().then(async (buf) => {
      if (registeredFaces.get(font.family) !== face) return
      const real = new FontFace(font.family, buf)
      await real.load()
      if (registeredFaces.get(font.family) !== face) return
      registeredFaces.set(font.family, real)
      document.fonts.add(real)
    }).catch(() => {
      if (registeredFaces.get(font.family) === face) registeredFaces.delete(font.family)
    })
  }
}

// Load a font file into the document's font set, returning a unique
// font-family name to use in SVG `font-family`.
export async function loadFontFile(file: File): Promise<LoadedFont> {
  const buffer = await file.arrayBuffer()
  return loadFontBytes(buffer, file.name)
}

// Pick the font family for a word. Each word may have its own font (set via
// its per-word font input); if exactly one word has a font set, that font
// applies to all words too, mirroring the `font_idx` broadcast convention in
// src/generate/cards.rs (a single `--fonts` entry applies to every word).
export function fontFamilyForWord(fonts: (LoadedFont | null)[], index: number): string {
  const set = fonts.filter((f): f is LoadedFont => f !== null)
  if (set.length === 0) return DEFAULT_FONT_FAMILY
  const font = set.length === 1 ? set[0] : fonts[index]
  return font?.family ?? DEFAULT_FONT_FAMILY
}
