// Generates a CSV used to personalize the final PDF. Each row is one record;
// each record holds one or more codes ("words"), joined by `separator` so the
// row lines up with the word positions configured in "Cuvinte".
export type CodeCharset = 'numeric' | 'alpha' | 'alphanumeric'
// 'random' draws codes from a charset, 'range' increments a number, and 'text'
// emits the same user-supplied text on every row (a fixed watermark-style label).
// 'text' is exempt from uniqueness — every row repeats it by design.
export type CodeMode = 'random' | 'range' | 'text'
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
  // The literal text emitted on every row when `mode === 'text'`.
  text: string
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
    text: '',
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

// How many times we resample a colliding random code before giving up and
// accepting a duplicate. Generous enough that the only realistic way to hit it
// is a code space so nearly full that uniqueness is effectively impossible —
// the UI blocks the truly-impossible case (rows > space) up front.
const MAX_UNIQUE_ATTEMPTS = 1000

// Produces the next random value for a column, kept distinct from `seen` when
// the code space still has room. `duplicate` is true only when a unique value
// could not be found — the space is exhausted (`seen.size >= space`) or the
// resample cap was hit on a near-full space. Mutates `seen` with the value.
function nextRandomCode(column: CodeColumnConfig, seen: Set<string>): { value: string; duplicate: boolean } {
  const space = randomCodeSpace(column.charset, column.length)
  if (seen.size >= space) {
    // No unused codes remain; a duplicate is unavoidable.
    return { value: randomCode(column.charset, column.length), duplicate: true }
  }
  for (let i = 0; i < MAX_UNIQUE_ATTEMPTS; i++) {
    const c = randomCode(column.charset, column.length)
    if (!seen.has(c)) {
      seen.add(c)
      return { value: c, duplicate: false }
    }
  }
  return { value: randomCode(column.charset, column.length), duplicate: true }
}

function padCode(column: CodeColumnConfig, raw: string): string {
  if (column.padChar.length === 0) return raw
  // 'fixed' prepends the pad string verbatim; 'width' left-pads up to the
  // target length (padStart is a no-op when the code is already long enough).
  if (column.padMode === 'fixed') return column.padChar + raw
  return column.padLength > 0 ? raw.padStart(column.padLength, column.padChar) : raw
}

// Builds one field for the given row/column. Random codes are deduplicated
// against `seen` (one Set per column) so a column yields distinct values; range
// codes increment and are unique by construction. `duplicate` flags a random
// code that could not be made unique (code space exhausted).
function codeForRow(column: CodeColumnConfig, rowIndex: number, seen: Set<string>): { code: string; duplicate: boolean } {
  // A fixed watermark-style label: the same text on every row, exempt from
  // uniqueness (it's meant to repeat) and from padding (it's emitted verbatim,
  // with only the prefix/postfix attached).
  if (column.mode === 'text') {
    return { code: column.prefix + (column.text ?? '') + column.postfix, duplicate: false }
  }

  let raw: string
  let duplicate = false
  if (column.mode === 'range') {
    raw = String(column.rangeStart + rowIndex * column.rangeStep)
  } else {
    const next = nextRandomCode(column, seen)
    raw = next.value
    duplicate = next.duplicate
  }
  const code = padCode(column, raw)

  // Prefix/postfix attach directly to the code with no separator; a space (or
  // any spacer) must be included by the user in the prefix/postfix itself.
  return { code: column.prefix + code + column.postfix, duplicate }
}

export function generateCodesCsv(rowCount: number, columns: CodeColumnConfig[], separator: string): string {
  const sep = separator || ' '
  // One Set of already-used random values per column, so codes stay distinct
  // within a column across all rows.
  const seen = columns.map(() => new Set<string>())
  const lines: string[] = []
  for (let row = 0; row < rowCount; row++) {
    lines.push(columns.map((column, c) => codeForRow(column, row, seen[c]).code).join(sep))
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
  /** Cumulative count of codes that could not be made unique (should be 0). */
  duplicates: number
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
  // Per-column used-value Sets persist across every yield (generator local
  // state), so uniqueness holds over the whole CSV, not just within a chunk.
  const seen = columns.map(() => new Set<string>())
  let duplicates = 0
  let lines: string[] = []
  for (let row = 0; row < rowCount; row++) {
    lines.push(
      columns
        .map((column, c) => {
          const { code, duplicate } = codeForRow(column, row, seen[c])
          if (duplicate) duplicates++
          return code
        })
        .join(sep),
    )
    if (lines.length >= rowsPerChunk) {
      yield { text: lines.join('\n') + '\n', rowsDone: row + 1, duplicates }
      lines = []
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  if (lines.length > 0) {
    yield { text: lines.join('\n') + '\n', rowsDone: rowCount, duplicates }
  }
}
