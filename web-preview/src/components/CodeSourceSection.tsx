import { useState } from 'react'
import { CheckboxField, FileField, NumberField, RadioGroupField, Section, SelectField, TextField } from './fields'
import { CSV_PREVIEW_ROW_COUNT, defaultCodeColumn, mergeFields, randomCodeSpace, type CodeCharset, type CodeColumnConfig, type CodeMode, type CodePadMode } from '../lib/codeSource'
import { m } from '../paraglide/messages'
import { formatNumber } from '../lib/formatNumber'

type CodeDataMode = 'generate' | 'upload'

const CHARSET_OPTIONS: { value: CodeCharset; label: string }[] = [
  { value: 'numeric', label: m.codes_charset_numeric() },
  { value: 'alpha', label: m.codes_charset_alpha() },
  { value: 'alphanumeric', label: m.codes_charset_alphanumeric() },
]

const MODE_OPTIONS: { value: CodeMode; label: string }[] = [
  { value: 'random', label: m.codes_mode_random() },
  { value: 'range', label: m.codes_mode_range() },
  { value: 'text', label: m.codes_mode_text() },
]

const PAD_MODE_OPTIONS: { value: CodePadMode; label: string }[] = [
  { value: 'width', label: m.codes_pad_width() },
  { value: 'fixed', label: m.codes_pad_fixed() },
]

function CodeColumnEditor({
  index,
  column,
  onChange,
  onRemove,
  canRemove,
  rowCount,
}: {
  index: number
  column: CodeColumnConfig
  onChange: (next: CodeColumnConfig) => void
  onRemove: () => void
  canRemove: boolean
  /** Number of rows requested — used to flag when random codes can't be unique. */
  rowCount: number
}) {
  function set<K extends keyof CodeColumnConfig>(key: K, value: CodeColumnConfig[K]) {
    onChange({ ...column, [key]: value })
  }

  // For random codes, warn when the requested rows exceed the combination space
  // (duplicates unavoidable) or merely approach it (duplicates very likely, by
  // the birthday paradox). Range codes always increment, so they never collide.
  const codeSpace = column.mode === 'random' ? randomCodeSpace(column.charset, column.length) : Infinity
  const exceedsSpace = rowCount > codeSpace
  const nearsSpace = !exceedsSpace && rowCount > codeSpace / 2

  return (
    <fieldset className="flex flex-col gap-field rounded border border-gray-200 p-field dark:border-gray-700">
      <div className="flex items-center justify-between">
        <legend className="text-label font-semibold text-gray-900 dark:text-gray-100">{m.codes_code_n({ n: index + 1 })}</legend>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-label font-medium text-red-600 hover:underline dark:text-red-400"
          >
            {m.codes_remove()}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-field [&>*]:min-w-40 [&>*]:flex-1">
        <TextField label={m.codes_prefix_label()} value={column.prefix} onChange={(v) => set('prefix', v)} />
        <TextField label={m.codes_suffix_label()} value={column.postfix} onChange={(v) => set('postfix', v)} />
      </div>

      {/* Code type and its per-mode fields are tightly related: keep them on one
          row (fragments are DOM-transparent, so the conditional fields become
          direct flex children). A small min-width floor lets the three fields
          shrink together and share the row, wrapping only as a last resort when
          the column is genuinely too narrow. */}
      <div className="flex flex-wrap gap-field [&>*]:min-w-24 [&>*]:flex-1">
        <SelectField label={m.codes_type_label()} value={column.mode} options={MODE_OPTIONS} onChange={(v) => set('mode', v)} />
        {column.mode === 'random' && (
          <>
            <SelectField label={m.codes_charset_label()} value={column.charset} options={CHARSET_OPTIONS} onChange={(v) => set('charset', v)} />
            <NumberField label={m.codes_length_label()} value={column.length} onChange={(v) => set('length', v)} step={1} />
          </>
        )}
        {column.mode === 'range' && (
          <>
            <NumberField label={m.codes_range_start_label()} value={column.rangeStart} onChange={(v) => set('rangeStart', v)} step={1} />
            <NumberField label={m.codes_range_step_label()} value={column.rangeStep} onChange={(v) => set('rangeStep', v)} step={1} />
          </>
        )}
        {column.mode === 'text' && (
          <TextField label={m.codes_text_label()} value={column.text} onChange={(v) => set('text', v)} placeholder={m.codes_text_placeholder()} />
        )}
      </div>

      {/* Padding only applies to generated codes, not a fixed text label. Same
          single-row-until-last-resort treatment for the completion controls: a
          small min-width floor keeps the three fields sharing one row and wrapping
          only as a last resort. */}
      {column.mode !== 'text' && (
        <div className="flex flex-wrap gap-field [&>*]:min-w-24 [&>*]:flex-1">
          <SelectField label={m.codes_pad_mode_label()} value={column.padMode} options={PAD_MODE_OPTIONS} onChange={(v) => set('padMode', v)} />
          <TextField label={m.codes_pad_char_label()} value={column.padChar} onChange={(v) => set('padChar', v)} />
          {column.padMode === 'width' && (
            <NumberField label={m.codes_pad_width_label()} value={column.padLength} onChange={(v) => set('padLength', v)} step={1} />
          )}
        </div>
      )}
      {column.padChar.length > 0 && column.padMode === 'width' && column.mode === 'random' &&
        column.padLength > 0 && column.padLength <= column.length && (
        <p className="text-hint text-amber-600 dark:text-amber-400">
          {m.codes_pad_hidden_hint({ padLength: column.padLength, length: column.length })}
        </p>
      )}
      {exceedsSpace && (
        <p className="text-hint text-red-600 dark:text-red-400">
          {m.codes_exceeds_space({
            rows: formatNumber(rowCount),
            space: formatNumber(codeSpace),
            charset: CHARSET_OPTIONS.find((c) => c.value === column.charset)?.label.toLowerCase() ?? column.charset,
            length: column.length,
          })}
        </p>
      )}
      {nearsSpace && (
        <p className="text-hint text-amber-600 dark:text-amber-400">
          {m.codes_nears_space({ rows: formatNumber(rowCount), space: formatNumber(codeSpace) })}
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
    <div className="flex flex-col gap-inner rounded border border-gray-200 p-field dark:border-gray-700">
      <p className="text-label font-semibold text-gray-900 dark:text-gray-100">{m.codes_fields_per_row()}</p>
      <p className="text-hint text-gray-500 dark:text-gray-400">
        {m.codes_fields_hint()}
      </p>
      <div className="flex flex-wrap items-center gap-tight">
        {pieces.map((piece, i) => (
          <span key={i} className="flex items-center gap-tight">
            <span className="rounded bg-gray-100 px-2 py-1 font-mono text-label text-gray-800 dark:bg-gray-800 dark:text-gray-200">
              {piece}
            </span>
            {i < pieces.length - 1 && (
              <button
                type="button"
                onClick={() => toggleGap(i)}
                aria-pressed={gapSet.has(i)}
                title={gapSet.has(i) ? m.codes_gap_merged() : m.codes_gap_separate()}
                className={
                  'rounded px-1.5 py-1 text-hint font-medium transition ' +
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
      <p className="text-hint text-gray-600 dark:text-gray-400">
        {m.codes_fields_result({ count: fields.length, list: fields.map((f) => `„${f}"`).join('   ') })}
      </p>
    </div>
  )
}

export function CodeSourceSection({
  dataMode,
  onDataModeChange,
  onCsvUpload,
  uploadFileName,
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
  singleFieldPerRow,
  onSingleFieldPerRowChange,
  onGenerate,
  preview,
  downloadUrl,
  progress,
  stale,
  blocked,
  duplicates,
}: {
  dataMode: CodeDataMode
  onDataModeChange: (mode: CodeDataMode) => void
  onCsvUpload: (file: File | null) => void
  /** Name of the currently uploaded CSV, shown as a persistent hint on remount. */
  uploadFileName?: string | null
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
  /** When true, every field on a row is joined into a single code. */
  singleFieldPerRow: boolean
  onSingleFieldPerRowChange: (value: boolean) => void
  onGenerate: () => void
  preview: string
  downloadUrl: string | null
  /** Rows written so far while streaming the CSV, or `null` when idle. */
  progress: number | null
  /** True when settings changed after the last CSV generation. */
  stale?: boolean
  /** True when a random column can't yield enough unique codes — generation is disabled. */
  blocked?: boolean
  /** Forced-duplicate count from the last generation, or null before generating. */
  duplicates?: number | null
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
    <Section title={m.codes_settings_title()} frame="top">
      <RadioGroupField<CodeDataMode>
        label={m.codes_source_mode()}
        value={dataMode}
        onChange={onDataModeChange}
        options={[
          { value: 'upload', label: m.codes_mode_upload() },
          { value: 'generate', label: m.codes_mode_generate() },
        ]}
      />

      {dataMode === 'upload' ? (
        <>
          <p className="text-label text-gray-500 dark:text-gray-400">
            {m.codes_upload_hint()}
          </p>
          <FileField
            label={m.codes_csv_file_label()}
            accept=".csv,text/csv,text/plain"
            onChange={(files) => onCsvUpload(files?.[0] ?? null)}
            currentName={uploadFileName}
          />
          {uploadRowCount > 0 && (
            <CheckboxField
              label={m.codes_single_field_per_row()}
              checked={singleFieldPerRow}
              onChange={onSingleFieldPerRowChange}
            />
          )}
          {uploadInfo && (
            <p className="text-label font-medium text-green-700 dark:text-green-400">{uploadInfo}</p>
          )}
          {uploadWarnings && uploadWarnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-label text-amber-600 dark:text-amber-400">
              {uploadWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {uploadRowCount > 0 && (
            <details className="text-label text-gray-500 dark:text-gray-400">
              <summary className="cursor-pointer select-none">{m.codes_wrong_separator_summary()}</summary>
              <div className="mt-inner">
                <TextField
                  label={m.codes_separator_label()}
                  value={separator}
                  onChange={onSeparatorChange}
                  placeholder=","
                />
              </div>
            </details>
          )}
          {!singleFieldPerRow && (
            <FieldBoundaryEditor
              pieces={fieldPieces}
              joiner={separator || ' '}
              mergedGaps={fieldMerges}
              onChange={onFieldMergesChange}
            />
          )}
        </>
      ) : (
        <>
          <p className="text-label text-gray-500 dark:text-gray-400">
            {m.codes_generate_hint()}
          </p>

          <div className="flex flex-wrap gap-field [&>*]:min-w-40 [&>*]:flex-1">
            <NumberField label={m.codes_row_count_label()} value={rowCount} onChange={onRowCountChange} step={1} />
            <TextField
              label={m.codes_separator_label()}
              value={separator}
              onChange={onSeparatorChange}
              placeholder=" "
            />
          </div>

          <div className="flex flex-wrap gap-inner border-t border-gray-200 pt-block mt-inner dark:border-gray-700">
            {columns.map((column, index) => {
              // Flag a tab whose random code can't yield enough unique values for
              // the requested rows (the editor shows the full explanation).
              const exceeds = column.mode === 'random' && rowCount > randomCodeSpace(column.charset, column.length)
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setActiveColumn(index)}
                  title={exceeds ? m.codes_tab_too_few_combinations() : undefined}
                  className={`rounded-full px-3 py-1 text-label font-medium ${
                    active === index
                      ? exceeds
                        ? 'bg-red-600 text-white'
                        : 'bg-blue-600 text-white'
                      : exceeds
                        ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {exceeds && <span aria-hidden className="mr-1">⚠</span>}
                  {m.codes_code_n({ n: index + 1 })}
                </button>
              )
            })}
            <button
              type="button"
              onClick={addColumn}
              className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-label font-medium text-gray-600 hover:border-gray-400 hover:text-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:text-gray-100"
            >
              {m.codes_add_code()}
            </button>
          </div>

          {columns[active] && (
            <CodeColumnEditor
              index={active}
              column={columns[active]}
              onChange={(next) => updateColumn(active, next)}
              onRemove={() => removeColumn(active)}
              canRemove={columns.length > 1}
              rowCount={rowCount}
            />
          )}
          <p className="text-label text-gray-500 dark:text-gray-400">
            {m.codes_add_code_hint()}
          </p>

          {stale && (
            <p className="text-label text-amber-600 dark:text-amber-400">
              {m.codes_stale()}
            </p>
          )}

          {blocked && (
            <p className="text-label text-red-600 dark:text-red-400">
              {m.codes_blocked()}
            </p>
          )}

          <div className="flex items-center gap-block my-field">
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating || blocked}
              className="self-start rounded-lg bg-blue-600 px-4 py-2 text-label font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {generating ? m.codes_generating_progress({ done: formatNumber(progress), total: formatNumber(rowCount) }) : m.codes_generate_csv()}
            </button>
            {downloadUrl && !generating && (
              <a href={downloadUrl} download="codes.csv" className="text-label font-medium text-blue-600 hover:underline dark:text-blue-400">
                {m.codes_download_csv()}
              </a>
            )}
          </div>

          {!generating && duplicates != null && (
            duplicates === 0 ? (
              <p className="text-label font-medium text-green-700 dark:text-green-400">
                {m.codes_all_unique()}
              </p>
            ) : (
              <p className="text-label font-medium text-amber-600 dark:text-amber-400">
                {m.codes_duplicates({ count: duplicates, countFormatted: formatNumber(duplicates) })}
              </p>
            )
          )}
        </>
      )}

      {preview && (
        <div className="flex flex-col gap-tight">
          <span className="text-label font-medium text-gray-700 dark:text-gray-300">
            {previewRowCount > CSV_PREVIEW_ROW_COUNT
              ? m.codes_preview_truncated({ shown: CSV_PREVIEW_ROW_COUNT, total: formatNumber(previewRowCount) })
              : m.codes_preview()}
          </span>
          <pre className="max-h-40 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-hint text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {preview}
          </pre>
        </div>
      )}
    </Section>
  )
}
