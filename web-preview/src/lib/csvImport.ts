// Robust parsing of a *user-uploaded* CSV file. Unlike the codes we generate
// ourselves (a clean, known format), an uploaded file can use any delimiter
// (comma, semicolon, tab, pipe, space), carry a UTF-8 BOM, mix CRLF/LF line
// endings, or quote fields that contain the delimiter. We lean on PapaParse —
// the de-facto standard browser CSV parser — to handle all of that and to
// auto-detect the delimiter, so the user never has to know what a "separator"
// even is.
import Papa from 'papaparse'

export interface ParsedCsv {
  // One entry per record, each a list of field values (already unquoted and
  // with the BOM stripped by PapaParse).
  rows: string[][]
  // The delimiter PapaParse detected in the file (e.g. ',' or ';' or '\t').
  delimiter: string
  // Number of fields in the first record — what we treat as the column count.
  columnCount: number
  // Human-readable issues to surface to the user. Never throws for these;
  // we parse as much as we can and report what looked off.
  warnings: string[]
}

// Delimiters PapaParse will try when auto-detecting. We add space and pipe to
// its defaults so space- or pipe-separated files are recognised too.
const DELIMITERS_TO_GUESS = [',', ';', '\t', '|', ' ']

// Parse an uploaded CSV file. Resolves with the parsed rows plus metadata; only
// rejects if the file genuinely cannot be read. Pass `forcedDelimiter` to
// override auto-detection (e.g. when the user corrects a mis-guessed separator).
export function parseUploadedCsv(file: File, forcedDelimiter?: string): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      // No header row: every record is data. Each card maps to one record.
      header: false,
      // Auto-detect the delimiter from the candidates below, unless forced.
      delimiter: forcedDelimiter ?? '',
      delimitersToGuess: DELIMITERS_TO_GUESS,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        const rows = (results.data as unknown[][])
          .map((row) => row.map((cell) => String(cell ?? '')))
          // Drop records that are entirely empty (e.g. a trailing blank line).
          .filter((row) => row.some((cell) => cell.trim().length > 0))

        const delimiter = results.meta.delimiter || ','
        const columnCount = rows.length > 0 ? rows[0].length : 0
        const warnings = collectWarnings(rows, results.errors)

        resolve({ rows, delimiter, columnCount, warnings })
      },
      error: (err) => reject(err),
    })
  })
}

function collectWarnings(rows: string[][], errors: Papa.ParseError[]): string[] {
  const warnings: string[] = []

  if (rows.length === 0) {
    warnings.push('Fișierul nu conține niciun rând de date.')
    return warnings
  }

  // Rows with a different field count than the first row usually mean the wrong
  // delimiter was guessed or the file is irregular — worth flagging.
  const expected = rows[0].length
  const ragged = rows.filter((row) => row.length !== expected).length
  if (ragged > 0) {
    warnings.push(
      `${ragged} rând(uri) au un număr diferit de coloane față de primul rând (${expected}). ` +
        'Verifică separatorul detectat.',
    )
  }

  // A field that contains the original delimiter (a quoted "a,b") is handled
  // correctly downstream — PapaParse unquotes it and the app re-joins fields
  // with a collision-safe separator — so it no longer needs a warning.

  // PapaParse also reports parse errors, but two kinds are noise here:
  //  - 'Delimiter' (UndetectableDelimiter): emitted for single-column files,
  //    where there is genuinely no separator to find and the default ',' is
  //    harmless because nothing gets split.
  //  - 'FieldMismatch': inconsistent column counts, already reported in
  //    Romanian by the ragged-row check above.
  // Anything left is a rare structural issue (e.g. mismatched quotes); surface
  // it in Romanian rather than passing through PapaParse's English message.
  const structuralError = errors.some(
    (e) => e.type !== 'Delimiter' && e.type !== 'FieldMismatch',
  )
  if (structuralError) {
    warnings.push(
      'Fișierul CSV pare să aibă un format neobișnuit (de ex. ghilimele nepotrivite). Verifică fișierul.',
    )
  }

  return warnings
}
