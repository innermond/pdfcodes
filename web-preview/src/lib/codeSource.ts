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
