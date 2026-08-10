// Does the configured code source produce codes the chosen symbology can actually
// encode? The app knows both sides, so it can say so *before* a job runs — otherwise
// picking EAN-13 while the generator makes alphanumeric codes fails every single row,
// and the user only finds out from the result panel.
//
// This mirrors the constraints in src/barcode.rs. It deliberately only reports what
// it can be sure of from the column configuration; a payload template or an uploaded
// CSV can still surprise it, which is what the per-row failure report is for.
import type { CodeColumnConfig } from './codeSource'
import type { Symbology } from './options'

// What a symbology demands of a code, or null when it accepts anything.
interface Requirement {
  // The exact code length the symbology needs, check digit excluded.
  digits: number
}

function requirement(symbology: Symbology): Requirement | null {
  switch (symbology) {
    // Code 128 takes any ASCII, Code 39 any uppercase code — both accept every
    // charset this app's generator can produce (its alpha modes are uppercase).
    case 'code128':
    case 'code39':
      return null
    case 'ean13':
      return { digits: 12 }
    case 'ean8':
      return { digits: 7 }
  }
}

// The total length a column emits per row, or null when it can't be known ahead of
// time (a range without fixed-width padding grows as the numbers do).
function columnLength(column: CodeColumnConfig): number | null {
  const fixed = column.prefix.length + column.postfix.length
  switch (column.mode) {
    case 'random':
      return fixed + column.length
    case 'text':
      return fixed + column.text.length
    case 'range':
      return column.padMode === 'fixed' ? fixed + column.padLength : null
    case 'list':
      return null
  }
}

// A description of the mismatch between `symbology` and what `column` generates, or
// null when they're compatible (or when it can't be determined). Deliberately returns
// the facts rather than a sentence, so the caller can phrase it in the user's
// language; `describe` below is the default phrasing.
export interface SymbologyMismatch {
  kind: 'charset' | 'length'
  // What the symbology needs, and what the column actually produces.
  needDigits: number
  gotLength: number | null
  gotCharset: CodeColumnConfig['charset']
}

export function symbologyFitsColumn(
  symbology: Symbology,
  column: CodeColumnConfig | undefined,
): SymbologyMismatch | null {
  const need = requirement(symbology)
  if (!need || !column) return null

  // A non-numeric charset can never satisfy EAN — flag that first, since it is the
  // more fundamental problem and the length is then beside the point.
  if (column.mode !== 'text' && column.charset !== 'numeric') {
    return { kind: 'charset', needDigits: need.digits, gotLength: columnLength(column), gotCharset: column.charset }
  }
  const length = columnLength(column)
  // An unknowable length isn't a mismatch we can assert; the per-row report covers it.
  if (length === null) return null
  // The check digit may be supplied, so both lengths are acceptable.
  if (length === need.digits || length === need.digits + 1) return null
  return { kind: 'length', needDigits: need.digits, gotLength: length, gotCharset: column.charset }
}
