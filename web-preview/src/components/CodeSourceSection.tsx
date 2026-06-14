import { NumberField, Section, SelectField, TextField } from './fields'
import { defaultCodeColumn, type CodeCharset, type CodeColumnConfig, type CodeMode } from '../lib/codeSource'

const CHARSET_OPTIONS: { value: CodeCharset; label: string }[] = [
  { value: 'numeric', label: 'Numeric' },
  { value: 'alpha', label: 'Alfabetic' },
  { value: 'alphanumeric', label: 'Alfanumeric (mixt)' },
]

const MODE_OPTIONS: { value: CodeMode; label: string }[] = [
  { value: 'random', label: 'Generat aleator' },
  { value: 'range', label: 'Interval numeric' },
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
            <NumberField label="Completare cu zerouri (cifre)" value={column.padLength} onChange={(v) => set('padLength', v)} step={1} />
          </>
        )}
      </div>
    </fieldset>
  )
}

export function CodeSourceSection({
  rowCount,
  onRowCountChange,
  separator,
  onSeparatorChange,
  columns,
  onColumnsChange,
  onGenerate,
  preview,
  downloadUrl,
}: {
  rowCount: number
  onRowCountChange: (value: number) => void
  separator: string
  onSeparatorChange: (value: string) => void
  columns: CodeColumnConfig[]
  onColumnsChange: (columns: CodeColumnConfig[]) => void
  onGenerate: () => void
  preview: string
  downloadUrl: string | null
}) {
  function updateColumn(index: number, next: CodeColumnConfig) {
    onColumnsChange(columns.map((col, i) => (i === index ? next : col)))
  }

  function removeColumn(index: number) {
    onColumnsChange(columns.filter((_, i) => i !== index))
  }

  function addColumn() {
    onColumnsChange([...columns, defaultCodeColumn()])
  }

  return (
    <Section title="Sursa de date">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Generează un CSV pentru a personaliza PDF-ul. Fiecare cod are formatul „prefix cod sufix” (prefixul și
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
        className="self-start rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        Adaugă cod pe rând
      </button>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onGenerate}
          className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          Generează CSV
        </button>
        {downloadUrl && (
          <a href={downloadUrl} download="codes.csv" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
            Descarcă codes.csv
          </a>
        )}
      </div>

      {preview && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Previzualizare</span>
          <pre className="max-h-40 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {preview}
          </pre>
        </div>
      )}
    </Section>
  )
}
