export interface LoadedFont {
  family: string
  fileName: string
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
  return { family, fileName: file.name }
}

// Pick the font family for a word. Each word may have its own font (set via
// its per-word font input); if exactly one word has a font set, that font
// applies to all words too, mirroring the `font_idx` broadcast convention in
// src/generate/cards.rs (a single `--fonts` entry applies to every word).
export function fontFamilyForWord(fonts: (LoadedFont | null)[], index: number): string {
  const set = fonts.filter((f): f is LoadedFont => f !== null)
  if (set.length === 0) return 'sans-serif'
  const font = set.length === 1 ? set[0] : fonts[index]
  return font?.family ?? 'sans-serif'
}
