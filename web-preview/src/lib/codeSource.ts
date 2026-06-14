// Generates a CSV used to personalize the final PDF. Each row is one record;
// each record holds one or more codes ("words"), joined by `separator` so the
// row lines up with the word positions configured in "Cuvinte".
export type CodeCharset = 'numeric' | 'alpha' | 'alphanumeric'
export type CodeMode = 'random' | 'range'

export interface CodeColumnConfig {
  prefix: string
  postfix: string
  mode: CodeMode
  charset: CodeCharset
  length: number
  rangeStart: number
  rangeStep: number
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
    padLength: 0,
  }
}

const CHARSETS: Record<CodeCharset, string> = {
  numeric: '0123456789',
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alphanumeric: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
}

function randomCode(charset: CodeCharset, length: number): string {
  const chars = CHARSETS[charset]
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function codeForRow(column: CodeColumnConfig, rowIndex: number): string {
  const code =
    column.mode === 'range'
      ? String(column.rangeStart + rowIndex * column.rangeStep).padStart(column.padLength, '0')
      : randomCode(column.charset, column.length)

  return [column.prefix, code, column.postfix].filter((part) => part.length > 0).join(' ')
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
