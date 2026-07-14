// Light CSV helpers that carry no dependencies. Kept separate from
// `csvImport.ts` (which pulls in PapaParse) so the synchronous call sites that
// only need these string utilities don't drag the parser into the initial
// bundle — PapaParse is loaded on demand only when a file is actually parsed.

import { m } from '../paraglide/messages'

// Friendly, UI-language name for a detected delimiter.
export function describeDelimiter(delimiter: string): string {
  switch (delimiter) {
    case ',':
      return m.csv_delimiter_comma()
    case ';':
      return m.csv_delimiter_semicolon()
    case '\t':
      return m.csv_delimiter_tab()
    case '|':
      return m.csv_delimiter_pipe()
    case ' ':
      return m.csv_delimiter_space()
    default:
      return m.csv_delimiter_other({ delimiter })
  }
}

// Locale-independent test for the ragged-rows warning (`m.csv_ragged_rows`,
// produced in csvImport.ts): render the message with a sentinel in each slot
// and match the literal text around them, so the check keeps working no matter
// what language the warning was generated in.
export function isRaggedRowsWarning(warning: string): boolean {
  const esc = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sentinel = '\u0000'
  const template = m.csv_ragged_rows({ ragged: sentinel, expected: sentinel })
  const pattern = template.split(sentinel).map(esc).join('.*')
  return new RegExp(`^${pattern}$`).test(warning)
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
