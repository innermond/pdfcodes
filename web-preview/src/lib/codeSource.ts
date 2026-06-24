// Generates a CSV used to personalize the final PDF. Each row is one record;
// each record holds one or more codes ("words"), joined by `separator` so the
// row lines up with the word positions configured in "Cuvinte".
export type CodeCharset = 'numeric' | 'alpha' | 'alphanumeric'
export type CodeMode = 'random' | 'range'
// How a code is padded: 'width' left-pads with `padChar` up to `padLength`
// characters; 'fixed' simply prepends `padChar` to every code.
export type CodePadMode = 'width' | 'fixed'

export interface CodeColumnConfig {
  prefix: string
  postfix: string
  mode: CodeMode
  charset: CodeCharset
  length: number
  rangeStart: number
  rangeStep: number
  padMode: CodePadMode
  padChar: string
  padLength: number
}

export function defaultCodeColumn(): CodeColumnConfig {
  return {
    prefix: '',
    postfix: '',
    mode: 'random',
    charset: 'alphanumeric',
    length: 6,
    rangeStart: 1,
    rangeStep: 1,
    padMode: 'width',
    padChar: '0',
    padLength: 0,
  }
}

// Regroup separator-split pieces into fields. `mergedGaps` holds the indices of
// gaps (gap i sits between piece i and i+1) that are merged; merged pieces are
// re-joined with `joiner` so a field keeps its original text (e.g. "1A 1").
//
// Each resulting field is normalised so the preview and the generator measure the
// SAME text. The card preview renders text in SVG (it collapses runs of real
// spaces to one and never gives a tab a glyph), while the generator sums every
// character's glyph advance — counting, say, a tab as a .notdef glyph with its own
// width. A separator with no rendered width must therefore not survive in a joined
// field: we drop control/zero-width whitespace (tab, newline, …) entirely, keep
// real spaces (a space has a width) collapsing runs to one, and strip edge
// whitespace plus an edge visible `joiner` (a leading/trailing delimiter in the
// source yields an empty edge piece, re-inserting the delimiter at the edge). An
// empty `mergedGaps` still normalises but otherwise returns the pieces.
export function mergeFields(pieces: string[], mergedGaps: ReadonlySet<number>, joiner: string): string[] {
  if (pieces.length === 0) return []
  const fields: string[] = [pieces[0]]
  for (let i = 1; i < pieces.length; i++) {
    if (mergedGaps.has(i - 1)) fields[fields.length - 1] += joiner + pieces[i]
    else fields.push(pieces[i])
  }
  return fields.map((f) =>
    trimFieldEdges(
      f
        .replace(/[\t\n\r\f\v]+/g, '') // zero-width separators (tab, …) — must not appear
        .replace(/ {2,}/g, ' '), // collapse real-space runs (matches the SVG preview)
      joiner,
    ),
  )
}

// Strip leading/trailing whitespace and, for a non-whitespace `joiner`, any
// stray edge separators left by merging an empty edge piece.
function trimFieldEdges(field: string, joiner: string): string {
  let s = field.trim()
  if (joiner.length > 0 && joiner.trim().length > 0) {
    while (s.startsWith(joiner)) s = s.slice(joiner.length)
    while (s.endsWith(joiner)) s = s.slice(0, s.length - joiner.length)
    s = s.trim()
  }
  return s
}

const CHARSETS: Record<CodeCharset, string> = {
  numeric: '0123456789',
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alphanumeric: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
}

// Number of distinct codes a random column can produce: charset size ^ length.
// Padding and prefix/postfix are applied uniformly to every code, so they don't
// add distinct values and don't affect this count. Returns 1 for a non-positive
// length (an empty code has a single possible value, "").
export function randomCodeSpace(charset: CodeCharset, length: number): number {
  if (length <= 0) return 1
  return Math.pow(CHARSETS[charset].length, Math.floor(length))
}

function randomCode(charset: CodeCharset, length: number): string {
  const chars = CHARSETS[charset]
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function padCode(column: CodeColumnConfig, raw: string): string {
  if (column.padChar.length === 0) return raw
  // 'fixed' prepends the pad string verbatim; 'width' left-pads up to the
  // target length (padStart is a no-op when the code is already long enough).
  if (column.padMode === 'fixed') return column.padChar + raw
  return column.padLength > 0 ? raw.padStart(column.padLength, column.padChar) : raw
}

function codeForRow(column: CodeColumnConfig, rowIndex: number): string {
  const raw =
    column.mode === 'range'
      ? String(column.rangeStart + rowIndex * column.rangeStep)
      : randomCode(column.charset, column.length)
  const code = padCode(column, raw)

  // Prefix/postfix attach directly to the code with no separator; a space (or
  // any spacer) must be included by the user in the prefix/postfix itself.
  return column.prefix + code + column.postfix
}

export function generateCodesCsv(rowCount: number, columns: CodeColumnConfig[], separator: string): string {
  const sep = separator || ' '
  const lines: string[] = []
  for (let row = 0; row < rowCount; row++) {
    lines.push(columns.map((column) => codeForRow(column, row)).join(sep))
  }
  return lines.join('\n')
}

// Number of rows rendered in the "Previzualizare" panel — cheap enough to
// regenerate on every keystroke, independent of the (possibly huge) row count
// used for the actual CSV download.
export const CSV_PREVIEW_ROW_COUNT = 15

export function generateCsvPreview(rowCount: number, columns: CodeColumnConfig[], separator: string): string {
  return generateCodesCsv(Math.min(rowCount, CSV_PREVIEW_ROW_COUNT), columns, separator)
}

export interface CsvChunk {
  text: string
  rowsDone: number
}

// Generates the full CSV in batches, yielding control back to the event loop
// between batches so the UI thread stays responsive for large row counts.
export async function* streamCodesCsv(
  rowCount: number,
  columns: CodeColumnConfig[],
  separator: string,
  rowsPerChunk = 2000,
): AsyncGenerator<CsvChunk> {
  const sep = separator || ' '
  let lines: string[] = []
  for (let row = 0; row < rowCount; row++) {
    lines.push(columns.map((column) => codeForRow(column, row)).join(sep))
    if (lines.length >= rowsPerChunk) {
      yield { text: lines.join('\n') + '\n', rowsDone: row + 1 }
      lines = []
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  if (lines.length > 0) {
    yield { text: lines.join('\n') + '\n', rowsDone: rowCount }
  }
}
