import { useState } from 'react'
import { FileField, NumberField, RadioGroupField, Section, SelectField, TextField } from './fields'
import { CSV_PREVIEW_ROW_COUNT, defaultCodeColumn, mergeFields, type CodeCharset, type CodeColumnConfig, type CodeMode, type CodePadMode } from '../lib/codeSource'

type CodeDataMode = 'generate' | 'upload'

const CHARSET_OPTIONS: { value: CodeCharset; label: string }[] = [
  { value: 'numeric', label: 'Numeric' },
  { value: 'alpha', label: 'Alfabetic' },
  { value: 'alphanumeric', label: 'Alfanumeric (mixt)' },
]

const MODE_OPTIONS: { value: CodeMode; label: string }[] = [
  { value: 'random', label: 'Generat aleator' },
  { value: 'range', label: 'Interval numeric' },
]

const PAD_MODE_OPTIONS: { value: CodePadMode; label: string }[] = [
  { value: 'width', label: 'Până la o lățime' },
  { value: 'fixed', label: 'Text fix adăugat' },
]

function CodeColumnEditor({
  index,
  column,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number
  column: CodeColumnConfig
  onChange: (next: CodeColumnConfig) => void
  onRemove: () => void
  canRemove: boolean
}) {
  function set<K extends keyof CodeColumnConfig>(key: K, value: CodeColumnConfig[K]) {
    onChange({ ...column, [key]: value })
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">Cod {index + 1}</legend>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-sm font-medium text-red-600 hover:underline dark:text-red-400"
          >
            Elimină
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
        <TextField label="Prefix (opțional)" value={column.prefix} onChange={(v) => set('prefix', v)} />
        <TextField label="Sufix (opțional)" value={column.postfix} onChange={(v) => set('postfix', v)} />
        <SelectField label="Tip cod" value={column.mode} options={MODE_OPTIONS} onChange={(v) => set('mode', v)} />

        {column.mode === 'random' ? (
          <>
            <SelectField label="Caractere" value={column.charset} options={CHARSET_OPTIONS} onChange={(v) => set('charset', v)} />
            <NumberField label="Lungime cod" value={column.length} onChange={(v) => set('length', v)} step={1} />
          </>
        ) : (
          <>
            <NumberField label="Start interval" value={column.rangeStart} onChange={(v) => set('rangeStart', v)} step={1} />
            <NumberField label="Pas" value={column.rangeStep} onChange={(v) => set('rangeStep', v)} step={1} />
          </>
        )}
        <SelectField label="Mod completare" value={column.padMode} options={PAD_MODE_OPTIONS} onChange={(v) => set('padMode', v)} />
        <TextField label="Caractere de completare" value={column.padChar} onChange={(v) => set('padChar', v)} />
        {column.padMode === 'width' && (
          <NumberField label="Lățime totală (caractere)" value={column.padLength} onChange={(v) => set('padLength', v)} step={1} />
        )}
      </div>
      {column.padChar.length > 0 && column.padMode === 'width' && column.mode === 'random' &&
        column.padLength > 0 && column.padLength <= column.length && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Completarea nu apare când lățimea totală ({column.padLength}) ≤ lungimea codului ({column.length}). Mărește lățimea totală pentru a vedea caracterele de completare.
        </p>
      )}
    </fieldset>
  )
}

// Lets the user fix an uploaded CSV whose delimiter was auto-detected wrongly:
// the first row's parsed fields are shown as pieces with a clickable control in
// each gap to merge two pieces back into a single field.
function FieldBoundaryEditor({
  pieces,
  joiner,
  mergedGaps,
  onChange,
}: {
  pieces: string[]
  joiner: string
  mergedGaps: number[]
  onChange: (gaps: number[]) => void
}) {
  if (pieces.length <= 1) return null

  const gapSet = new Set(mergedGaps)
  const fields = mergeFields(pieces, gapSet, joiner)

  function toggleGap(i: number) {
    const next = new Set(gapSet)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    onChange([...next].sort((a, b) => a - b))
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Câmpuri pe rând</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Apasă pe spațiul dintre două bucăți pentru a le uni într-un singur cod — util când un cod conține separatorul (ex. „1A 1").
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {pieces.map((piece, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="rounded bg-gray-100 px-2 py-1 font-mono text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-200">
              {piece}
            </span>
            {i < pieces.length - 1 && (
              <button
                type="button"
                onClick={() => toggleGap(i)}
                aria-pressed={gapSet.has(i)}
                title={gapSet.has(i) ? 'Unite — apasă pentru a separa' : 'Separate — apasă pentru a uni'}
                className={
                  'rounded px-1.5 py-1 text-xs font-medium transition ' +
                  (gapSet.has(i)
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                    : 'bg-gray-200 text-gray-500 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600')
                }
              >
                {gapSet.has(i) ? '∪' : '|'}
              </button>
            )}
          </span>
        ))}
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400">
        Rezultă {fields.length} {fields.length === 1 ? 'câmp' : 'câmpuri'}: {fields.map((f) => `„${f}"`).join('   ')}
      </p>
    </div>
  )
}

export function CodeSourceSection({
  dataMode,
  onDataModeChange,
  onCsvUpload,
  uploadRowCount,
  uploadInfo,
  uploadWarnings,
  rowCount,
  onRowCountChange,
  separator,
  onSeparatorChange,
  columns,
  onColumnsChange,
  fieldPieces,
  fieldMerges,
  onFieldMergesChange,
  onGenerate,
  preview,
  downloadUrl,
  progress,
  stale,
}: {
  dataMode: CodeDataMode
  onDataModeChange: (mode: CodeDataMode) => void
  onCsvUpload: (file: File | null) => void
  uploadRowCount: number
  /** Human-readable summary of the detected delimiter / row & column counts. */
  uploadInfo?: string | null
  /** Non-fatal issues found while parsing the uploaded CSV. */
  uploadWarnings?: string[]
  rowCount: number
  onRowCountChange: (value: number) => void
  separator: string
  onSeparatorChange: (value: string) => void
  columns: CodeColumnConfig[]
  onColumnsChange: (columns: CodeColumnConfig[]) => void
  /** Raw parsed fields of the first uploaded row (for the merge editor). */
  fieldPieces: string[]
  /** Indices of gaps (between parsed fields) merged into one field. */
  fieldMerges: number[]
  onFieldMergesChange: (gaps: number[]) => void
  onGenerate: () => void
  preview: string
  downloadUrl: string | null
  /** Rows written so far while streaming the CSV, or `null` when idle. */
  progress: number | null
  /** True when settings changed after the last CSV generation. */
  stale?: boolean
}) {
  const generating = progress !== null
  // Which code (column) is shown in the editor. The columns render as tabs
  // rather than a stack, so only the active one is expanded at a time.
  const [activeColumn, setActiveColumn] = useState(0)
  const active = Math.min(activeColumn, columns.length - 1)

  function updateColumn(index: number, next: CodeColumnConfig) {
    onColumnsChange(columns.map((col, i) => (i === index ? next : col)))
  }

  function removeColumn(index: number) {
    onColumnsChange(columns.filter((_, i) => i !== index))
    // Keep the active tab valid: shift left when removing at/before it.
    setActiveColumn((prev) => (index <= prev ? Math.max(0, prev - 1) : prev))
  }

  function addColumn() {
    onColumnsChange([...columns, defaultCodeColumn()])
    setActiveColumn(columns.length)
  }

  const previewRowCount = dataMode === 'upload' ? uploadRowCount : rowCount

  return (
    <Section title="Sursa de date">
      <RadioGroupField<CodeDataMode>
        label="Mod sursă"
        value={dataMode}
        onChange={onDataModeChange}
        options={[
          { value: 'generate', label: 'Generează coduri' },
          { value: 'upload', label: 'Încarcă CSV' },
        ]}
      />

      {dataMode === 'upload' ? (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Încarcă un fișier CSV existent. Fiecare rând devine un card. Separatorul (virgulă, punct și virgulă, tab
            etc.) este detectat automat — nu trebuie să știi nimic despre formatul CSV.
          </p>
          <FileField
            label="Fișier CSV"
            accept=".csv,text/csv,text/plain"
            onChange={(files) => onCsvUpload(files?.[0] ?? null)}
          />
          {uploadInfo && (
            <p className="text-sm font-medium text-green-700 dark:text-green-400">{uploadInfo}</p>
          )}
          {uploadWarnings && uploadWarnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-600 dark:text-amber-400">
              {uploadWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {uploadRowCount > 0 && (
            <details className="text-sm text-gray-500 dark:text-gray-400">
              <summary className="cursor-pointer select-none">Separator detectat greșit? Corectează manual</summary>
              <div className="mt-2">
                <TextField
                  label="Separator între coduri pe rând"
                  value={separator}
                  onChange={onSeparatorChange}
                  placeholder=","
                />
              </div>
            </details>
          )}
          <FieldBoundaryEditor
            pieces={fieldPieces}
            joiner={separator || ' '}
            mergedGaps={fieldMerges}
            onChange={onFieldMergesChange}
          />
        </>
      ) : (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Generează un CSV pentru a personaliza PDF-ul. Fiecare cod are formatul „prefix cod sufix" (prefixul și
            sufixul sunt opționale), iar codurile pot fi generate aleator (alfabetic, numeric sau mixt) sau ca interval
            numeric.
          </p>

          <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
            <NumberField label="Număr de rânduri" value={rowCount} onChange={onRowCountChange} step={1} />
            <TextField
              label="Separator între coduri pe rând"
              value={separator}
              onChange={onSeparatorChange}
              placeholder=" "
            />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-4 mt-2 dark:border-gray-700">
            {columns.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setActiveColumn(index)}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  active === index
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                Cod {index + 1}
              </button>
            ))}
            <button
              type="button"
              onClick={addColumn}
              className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-sm font-medium text-gray-600 hover:border-gray-400 hover:text-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:text-gray-100"
            >
              + Adaugă cod
            </button>
          </div>

          {columns[active] && (
            <CodeColumnEditor
              index={active}
              column={columns[active]}
              onChange={(next) => updateColumn(active, next)}
              onRemove={() => removeColumn(active)}
              canRemove={columns.length > 1}
            />
          )}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Adaugă încă un cod pe fiecare rând. Un rând poate conține mai multe coduri (separate prin separatorul de mai
            sus) — folosește această opțiune când un card trebuie să afișeze mai multe coduri.
          </p>

          {stale && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Setările s-au modificat. Regenerați CSV-ul pentru a putea continua.
            </p>
          )}

          <div className="flex items-center gap-4 my-3">
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {generating ? `Se generează… ${progress.toLocaleString('ro-RO')} / ${rowCount.toLocaleString('ro-RO')}` : 'Generează CSV'}
            </button>
            {downloadUrl && !generating && (
              <a href={downloadUrl} download="codes.csv" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                Descarcă codes.csv
              </a>
            )}
          </div>
        </>
      )}

      {preview && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Previzualizare{previewRowCount > CSV_PREVIEW_ROW_COUNT ? ` (primele ${CSV_PREVIEW_ROW_COUNT} din ${previewRowCount.toLocaleString('ro-RO')} rânduri)` : ''}
          </span>
          <pre className="max-h-40 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {preview}
          </pre>
        </div>
      )}
    </Section>
  )
}
