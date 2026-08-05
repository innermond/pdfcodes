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

// Rows left after dropping `skipFirst` off the front and `skipLast` off the
// back — how the user discards a header line, or a trailing totals/footer row,
// from an uploaded file. We parse with `header: false` (the app can't know
// whether a given file has one), so a header is just an ordinary record and
// would otherwise be printed on a card.
//
// Both counts are clamped: an emptied number input yields NaN, and presets or
// undo snapshots can carry anything. Nonsense (negative, NaN, non-finite) means
// "no skip" — keeping the user's rows visible beats silently emptying the file —
// while an over-large but finite skip correctly yields no rows at all, never a
// reversed or wrapped slice.
export function keptRows<T>(rows: T[], skipFirst: number, skipLast: number): T[] {
  const first = clampSkip(skipFirst)
  const last = clampSkip(skipLast)
  if (first + last >= rows.length) return []
  return rows.slice(first, rows.length - last)
}

// The counterpart of `keptRows`: the rows it discarded, split by which end they
// came off. Shares the same clamping so the two can never disagree about where
// the boundaries are. Returns everything (as `before`) when the skips consume
// the whole file, matching `keptRows` returning nothing.
export function skippedRows<T>(rows: T[], skipFirst: number, skipLast: number): { before: T[]; after: T[] } {
  const first = clampSkip(skipFirst)
  const last = clampSkip(skipLast)
  if (first + last >= rows.length) return { before: rows.slice(), after: [] }
  return { before: rows.slice(0, first), after: last === 0 ? [] : rows.slice(rows.length - last) }
}

function clampSkip(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
