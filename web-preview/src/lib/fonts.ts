import montserratBoldUrl from '../assets/fonts/Montserrat-Bold.ttf?url'

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

let counter = 0

// Load a font file into the document's font set, returning a unique
// font-family name to use in SVG `font-family`.
export async function loadFontFile(file: File): Promise<LoadedFont> {
  const buffer = await file.arrayBuffer()
  const family = `pdfcodes-preview-font-${counter++}`
  const fontFace = new FontFace(family, buffer)
  await fontFace.load()
  document.fonts.add(fontFace)
  return { family, fileName: file.name, file }
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
