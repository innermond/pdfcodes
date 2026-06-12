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

// Pick the font family for a word, mirroring `font_idx` in
// src/generate/cards.rs: a single uploaded font applies to all words,
// otherwise fonts map to words by position.
export function fontFamilyForWord(fonts: LoadedFont[], index: number): string {
  if (fonts.length === 0) return 'sans-serif'
  const font = fonts.length === 1 ? fonts[0] : fonts[index]
  return font?.family ?? 'sans-serif'
}
