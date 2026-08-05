// Generates a CSV used to personalize the final PDF. Each row is one record;
// each record holds one or more codes ("words"), joined by `separator` so the
// row lines up with the word positions configured in "Cuvinte".
export type CodeCharset = 'numeric' | 'alpha' | 'alphanumeric'
// 'random' draws codes from a charset, 'range' increments a number, and 'text'
// emits the same user-supplied text on every row (a fixed watermark-style label).
// 'text' is exempt from uniqueness — every row repeats it by design.
//
// 'list' turns the FIRST code into a *leader*: instead of one value per row it
// holds several typed values, and each value is repeated over its own block of
// rows, joined with the other codes. See `leaderGroups`.
export type CodeMode = 'random' | 'range' | 'text' | 'list'
// How a code is padded: 'width' left-pads with `padChar` up to `padLength`
// characters; 'fixed' simply prepends `padChar` to every code.
export type CodePadMode = 'width' | 'fixed'

// One value of a leader code, plus how many rows it spans.
export interface LeaderValue {
  value: string
  /** Rows emitted for this value; null inherits the global default row count. */
  rows: number | null
}

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
  // Leader values, meaningful only for `mode === 'list'` on the first column.
  values: LeaderValue[]
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
    values: [],
  }
}

export function defaultLeaderValue(): LeaderValue {
  return { value: '', rows: null }
}

// Only the first code can lead — one level of nesting, no cartesian product of
// several leaders. Presets and undo snapshots can carry an arbitrary array, and
// removing code 1 promotes code 2 into its place, so `normalizeColumns` demotes
// a stray 'list' outside the first slot (and backfills `values` for presets
// written before leaders existed).
export function normalizeColumns(columns: CodeColumnConfig[]): CodeColumnConfig[] {
  let changed = false
  const next = columns.map((column, index) => {
    const values = column.values ?? []
    const mode: CodeMode = index > 0 && column.mode === 'list' ? 'text' : column.mode
    if (values === column.values && mode === column.mode) return column
    changed = true
    return { ...column, values, mode }
  })
  return changed ? next : columns
}

// The active leader column, or null when the first code isn't a non-empty list.
// A 'list' with no values yet (the user just switched the mode) is deliberately
// NOT a leader — the config still describes a plain `rowCount` run.
export function leaderColumn(columns: CodeColumnConfig[]): CodeColumnConfig | null {
  const first = columns[0]
  if (!first || first.mode !== 'list') return null
  return (first.values?.length ?? 0) > 0 ? first : null
}

// A blank count (null, or the NaN an emptied number input emits) inherits the
// global default; an explicit count is used as typed, floored at zero.
function resolveRows(rows: number | null, defaultRowCount: number): number {
  const n = rows === null || Number.isNaN(rows) ? defaultRowCount : rows
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

// The leader's values resolved into emit-ready blocks: the value with its
// prefix/postfix attached (no padding — like 'text', it's emitted verbatim) and
// its row count. Empty when there is no leader.
export function leaderGroups(
  columns: CodeColumnConfig[],
  defaultRowCount: number,
): { text: string; rows: number }[] {
  const leader = leaderColumn(columns)
  if (leader === null) return []
  return leader.values.map((v) => ({
    text: leader.prefix + v.value + leader.postfix,
    rows: resolveRows(v.rows, defaultRowCount),
  }))
}

/** Total rows the config emits: the sum of the leader's blocks, or `defaultRowCount`. */
export function totalRowCount(columns: CodeColumnConfig[], defaultRowCount: number): number {
  const groups = leaderGroups(columns, defaultRowCount)
  if (groups.length === 0) return resolveRows(defaultRowCount, defaultRowCount)
  return groups.reduce((sum, g) => sum + g.rows, 0)
}

// The largest block a follower code has to cover. Followers restart inside each
// leader block, so uniqueness only has to hold within a block — this, not the
// total, is what the random-code-space warnings must be measured against.
export function maxGroupRowCount(columns: CodeColumnConfig[], defaultRowCount: number): number {
  const groups = leaderGroups(columns, defaultRowCount)
  if (groups.length === 0) return resolveRows(defaultRowCount, defaultRowCount)
  return groups.reduce((max, g) => Math.max(max, g.rows), 0)
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

  // A 'list' only reaches here when it isn't an active leader — the mode was
  // just picked and no value has been typed yet. Emit the bare prefix/postfix
  // rather than falling through to the random branch, which would fill the
  // preview with codes the leader is never going to produce.
  if (column.mode === 'list') {
    return { code: column.prefix + (column.values[0]?.value ?? '') + column.postfix, duplicate: false }
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

// Builds one row's fields: the leader value (when there is one) followed by
// each follower column's code for `rowInGroup`. `seen` holds one already-used
// set per follower, so codes stay distinct for as long as the caller keeps it.
function rowFields(
  leaderText: string | null,
  followers: CodeColumnConfig[],
  rowInGroup: number,
  seen: Set<string>[],
): { fields: string[]; duplicates: number } {
  const fields: string[] = leaderText === null ? [] : [leaderText]
  let duplicates = 0
  followers.forEach((column, c) => {
    const { code, duplicate } = codeForRow(column, rowInGroup, seen[c])
    if (duplicate) duplicates++
    fields.push(code)
  })
  return { fields, duplicates }
}

// The single source of truth for what the CSV contains — the bulk generator,
// the streaming one and the sample row all consume this, so they cannot drift.
// `duplicates` counts the codes in THAT row which could not be made unique.
function* iterateRows(
  rowCount: number,
  columns: CodeColumnConfig[],
  sep: string,
): Generator<{ text: string; duplicates: number }> {
  const leader = leaderColumn(columns)

  if (leader === null) {
    // One implicit block: every column emits one value per row, as before.
    const seen = columns.map(() => new Set<string>())
    for (let row = 0; row < rowCount; row++) {
      const { fields, duplicates } = rowFields(null, columns, row, seen)
      yield { text: fields.join(sep), duplicates }
    }
    return
  }

  // Followers restart inside every leader block: `rowInGroup` counts from 0, so
  // a range code begins at `rangeStart` again, and a fresh `seen` per block
  // scopes random uniqueness to the block. The unique key is (leader, code) —
  // a bare code may legitimately repeat under a different leader value.
  const followers = columns.slice(1)
  for (const group of leaderGroups(columns, rowCount)) {
    const seen = followers.map(() => new Set<string>())
    for (let row = 0; row < group.rows; row++) {
      const { fields, duplicates } = rowFields(group.text, followers, row, seen)
      yield { text: fields.join(sep), duplicates }
    }
  }
}

export function generateCodesCsv(rowCount: number, columns: CodeColumnConfig[], separator: string): string {
  const lines: string[] = []
  for (const row of iterateRows(rowCount, columns, separator || ' ')) lines.push(row.text)
  return lines.join('\n')
}

// The first row the config would emit — used for the sample card and to mirror
// a representative row into the "Cuvinte" step. Kept separate from the preview
// so the preview's cosmetic markers can never leak into it.
export function generateSampleRow(rowCount: number, columns: CodeColumnConfig[], separator: string): string {
  for (const row of iterateRows(rowCount, columns, separator || ' ')) return row.text
  return ''
}

// Number of rows rendered in the "Previzualizare" panel — cheap enough to
// regenerate on every keystroke, independent of the (possibly huge) row count
// used for the actual CSV download.
export const CSV_PREVIEW_ROW_COUNT = 15

// Leader blocks rendered before the preview gives up and summarises the rest.
const PREVIEW_MAX_GROUPS = 15

// Localised markers for the rows/blocks the preview leaves out. Injected rather
// than imported so this module stays free of i18n.
export interface PreviewLabels {
  skippedRows: (count: number) => string
  moreGroups: (count: number) => string
}

const DEFAULT_PREVIEW_LABELS: PreviewLabels = {
  skippedRows: (count) => `   … (${count})`,
  moreGroups: (count) => `   … (+${count})`,
}

export interface CsvPreview {
  text: string
  /** Data rows rendered — marker lines are not counted. */
  shown: number
  /** Rows the full CSV would contain. */
  total: number
}

// With a leader, the head of the file would only ever show the first block (a
// block can be thousands of rows), which hides exactly the structure the user
// is trying to check. So spread the line budget across the blocks instead and
// mark what was skipped.
export function generateCsvPreview(
  rowCount: number,
  columns: CodeColumnConfig[],
  separator: string,
  labels: PreviewLabels = DEFAULT_PREVIEW_LABELS,
): CsvPreview {
  const groups = leaderGroups(columns, rowCount)

  if (groups.length === 0) {
    const shown = Math.max(0, Math.min(Math.floor(rowCount) || 0, CSV_PREVIEW_ROW_COUNT))
    return { text: generateCodesCsv(shown, columns, separator), shown, total: totalRowCount(columns, rowCount) }
  }

  const sep = separator || ' '
  const followers = columns.slice(1)
  const visible = groups.slice(0, PREVIEW_MAX_GROUPS)
  const perGroup = Math.max(1, Math.floor(CSV_PREVIEW_ROW_COUNT / visible.length))

  const lines: string[] = []
  let shown = 0
  for (const group of visible) {
    const take = Math.min(perGroup, group.rows)
    const seen = followers.map(() => new Set<string>())
    for (let row = 0; row < take; row++) {
      lines.push(rowFields(group.text, followers, row, seen).fields.join(sep))
      shown++
    }
    if (group.rows > take) lines.push(labels.skippedRows(group.rows - take))
  }
  if (groups.length > visible.length) lines.push(labels.moreGroups(groups.length - visible.length))

  return { text: lines.join('\n'), shown, total: groups.reduce((sum, g) => sum + g.rows, 0) }
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
  // `iterateRows` is a generator, so its used-value Sets are generator-local and
  // survive every yield — uniqueness holds over the whole CSV (per leader block
  // when there is a leader), not just within a chunk.
  let duplicates = 0
  let rowsDone = 0
  let lines: string[] = []
  for (const row of iterateRows(rowCount, columns, separator || ' ')) {
    lines.push(row.text)
    duplicates += row.duplicates
    rowsDone++
    if (lines.length >= rowsPerChunk) {
      yield { text: lines.join('\n') + '\n', rowsDone, duplicates }
      lines = []
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  if (lines.length > 0) {
    yield { text: lines.join('\n') + '\n', rowsDone, duplicates }
  }
}
