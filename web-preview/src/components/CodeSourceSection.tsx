import { FileField, NumberField, RadioGroupField, Section, SelectField, TextField } from './fields'
import { CSV_PREVIEW_ROW_COUNT, defaultCodeColumn, type CodeCharset, type CodeColumnConfig, type CodeMode, type CodePadMode } from '../lib/codeSource'

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

export function CodeSourceSection({
  dataMode,
  onDataModeChange,
  onCsvUpload,
  uploadRowCount,
  rowCount,
  onRowCountChange,
  separator,
  onSeparatorChange,
  columns,
  onColumnsChange,
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
  rowCount: number
  onRowCountChange: (value: number) => void
  separator: string
  onSeparatorChange: (value: string) => void
  columns: CodeColumnConfig[]
  onColumnsChange: (columns: CodeColumnConfig[]) => void
  onGenerate: () => void
  preview: string
  downloadUrl: string | null
  /** Rows written so far while streaming the CSV, or `null` when idle. */
  progress: number | null
  /** True when settings changed after the last CSV generation. */
  stale?: boolean
}) {
  const generating = progress !== null
  function updateColumn(index: number, next: CodeColumnConfig) {
    onColumnsChange(columns.map((col, i) => (i === index ? next : col)))
  }

  function removeColumn(index: number) {
    onColumnsChange(columns.filter((_, i) => i !== index))
  }

  function addColumn() {
    onColumnsChange([...columns, defaultCodeColumn()])
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
            Încarcă un fișier CSV existent. Fiecare rând devine un card; câmpurile de pe fiecare rând sunt separate
            de separatorul de mai jos (același separator trebuie setat în pasul „Aspect &amp; Cuvinte").
          </p>
          <FileField
            label="Fișier CSV"
            accept=".csv,text/csv,text/plain"
            onChange={(files) => onCsvUpload(files?.[0] ?? null)}
          />
          <TextField
            label="Separator între coduri pe rând"
            value={separator}
            onChange={onSeparatorChange}
            placeholder=" "
          />
          {uploadRowCount > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {uploadRowCount.toLocaleString('ro-RO')} rânduri detectate
            </p>
          )}
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

          <div className="flex flex-col gap-3">
            {columns.map((column, index) => (
              <CodeColumnEditor
                key={index}
                index={index}
                column={column}
                onChange={(next) => updateColumn(index, next)}
                onRemove={() => removeColumn(index)}
                canRemove={columns.length > 1}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addColumn}
            className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            Adaugă cod pe rând
          </button>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Adaugă încă un cod pe fiecare rând. Un rând poate conține mai multe coduri (separate prin separatorul de mai
            sus) — folosește această opțiune când un card trebuie să afișeze mai multe coduri.
          </p>

          {stale && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Setările s-au modificat. Regenerați CSV-ul pentru a putea continua.
            </p>
          )}

          <div className="flex items-center gap-4">
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
