// Light CSV helpers that carry no dependencies. Kept separate from
// `csvImport.ts` (which pulls in PapaParse) so the synchronous call sites that
// only need these string utilities don't drag the parser into the initial
// bundle — PapaParse is loaded on demand only when a file is actually parsed.

const DELIMITER_LABELS: Record<string, string> = {
  ',': 'virgulă (,)',
  ';': 'punct și virgulă (;)',
  '\t': 'tab',
  '|': 'bară verticală (|)',
  ' ': 'spațiu',
}

// Friendly, Romanian-language name for a detected delimiter (the UI language).
export function describeDelimiter(delimiter: string): string {
  return DELIMITER_LABELS[delimiter] ?? `„${delimiter}”`
}

// Re-serialise parsed rows into the clean, single-delimiter CSV text that the
// rest of the pipeline (worker + wasm) expects: each record on its own line,
// fields joined by `separator`. PapaParse has already unquoted and BOM-stripped
// the input, so this output is normalised regardless of the original file's
// quirks.
export function serializeRows(rows: string[][], separator: string): string {
  const sep = separator === '' ? ' ' : separator
  return rows.map((row) => row.join(sep)).join('\n')
}
