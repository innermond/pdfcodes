import { useRef, useState } from 'react'
import { CheckboxField, FileField, NumberField, RadioGroupField, Section, SelectField, TextField } from './fields'
import { CSV_PREVIEW_ROW_COUNT, defaultCodeColumn, defaultLeaderValue, mergeFields, randomCodeSpace, type CodeCharset, type CodeColumnConfig, type CodeMode, type CodePadMode, type LeaderValue } from '../lib/codeSource'
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
  // Only the first code may lead, so this option is filtered out elsewhere.
  { value: 'list', label: m.codes_mode_list() },
]

const FOLLOWER_MODE_OPTIONS = MODE_OPTIONS.filter((o) => o.value !== 'list')

const PAD_MODE_OPTIONS: { value: CodePadMode; label: string }[] = [
  { value: 'width', label: m.codes_pad_width() },
  { value: 'fixed', label: m.codes_pad_fixed() },
]

// Everything about importing the leader list from a file. Grouped so it can be
// drilled from `CodeSourceSection` down to the editor as one prop.
interface LeaderImportProps {
  /** Name of the file the list was imported from, or null when hand-typed. */
  fileName: string | null
  /** Rows that file holds before skipping — bounds the skip inputs. */
  fileRows: number
  skipFirst: number
  skipLast: number
  /** Imported rows whose second column wasn't a number. */
  badCounts: number
  importError: string | null
  onFileLoad: (file: File | null) => void
  onSkipChange: (first: number, last: number) => void
}

// The leader's values: each one is repeated over its own block of rows and
// joined with the other codes. A blank row count inherits the global default,
// which is why the count input accepts an empty value (NumberField emits NaN,
// stored as null).
function LeaderValuesEditor({
  values,
  totalRows,
  onChange,
  fileName,
  fileRows,
  skipFirst,
  skipLast,
  badCounts,
  importError,
  onFileLoad,
  onSkipChange,
}: {
  values: LeaderValue[]
  /** Rows the whole config will emit — computed upstream so the math lives in one place. */
  totalRows: number
  onChange: (next: LeaderValue[]) => void
} & LeaderImportProps) {
  // A plain file input renders as a wide labelled control (see `FileField`),
  // which doesn't belong on the same row as the "add value" pill. Keep the input
  // hidden and drive it from a matching button instead.
  const fileInputRef = useRef<HTMLInputElement>(null)

  function update(index: number, next: LeaderValue) {
    onChange(values.map((v, i) => (i === index ? next : v)))
  }

  return (
    <div className="flex flex-col gap-inner">
      <p className="text-label font-semibold text-gray-900 dark:text-gray-100">{m.codes_leader_values()}</p>
      <p className="text-hint text-gray-500 dark:text-gray-400">{m.codes_leader_hint()}</p>

      {/* Only for a hand-built list: with a file loaded, an empty list means the
          skips ate it, and `codes_leader_skip_empty` below says so precisely —
          "add at least one value" would point at the wrong fix. */}
      {values.length === 0 && fileName === null && (
        <p className="text-hint text-amber-600 dark:text-amber-400">{m.codes_leader_empty()}</p>
      )}

      {values.map((value, index) => (
        // The value takes the room the count doesn't need, and both keep a
        // min-width floor so the pair shares one row until it genuinely can't.
        <div key={index} className="flex flex-wrap items-end gap-field">
          <div className="min-w-40 flex-[3]">
            <TextField
              label={m.codes_leader_value_label()}
              value={value.value}
              onChange={(v) => update(index, { ...value, value: v })}
            />
          </div>
          <div className="min-w-20 flex-1">
            <NumberField
              label={m.codes_leader_rows_label()}
              value={value.rows ?? NaN}
              onChange={(n) => update(index, { ...value, rows: Number.isNaN(n) ? null : n })}
              step={1}
              min={0}
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(values.filter((_, i) => i !== index))}
            title={m.codes_leader_remove()}
            aria-label={m.codes_leader_remove()}
            className="py-1 text-label font-medium text-red-600 hover:underline dark:text-red-400"
          >
            ×
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-field">
        <div className="flex flex-wrap items-center gap-inner">
          <button
            type="button"
            onClick={() => onChange([...values, defaultLeaderValue()])}
            className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-label font-medium text-gray-600 hover:border-gray-400 hover:text-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:text-gray-100"
          >
            {m.codes_leader_add()}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-label font-medium text-gray-600 hover:border-gray-400 hover:text-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:text-gray-100"
          >
            {m.codes_leader_load()}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              onFileLoad(e.target.files?.[0] ?? null)
              // Clear it, or picking the same file twice fires no change event —
              // re-loading after an edit would silently do nothing.
              e.target.value = ''
            }}
          />
        </div>
        {values.length > 0 && (
          <span className="text-label font-medium text-gray-700 dark:text-gray-300">
            {m.codes_total_rows({ count: totalRows, countFormatted: formatNumber(totalRows) })}
          </span>
        )}
      </div>

      {importError && (
        <p className="text-label text-red-600 dark:text-red-400">{importError}</p>
      )}

      {/* Import controls appear only once a file is loaded: the hand-typed flow
          stays exactly as it was, and they're never shown pointing at a file
          that no longer exists (a preset restores the values, not the file). */}
      {fileName !== null && (
        <>
          <p className="text-label font-medium text-green-700 dark:text-green-400">
            {m.codes_leader_loaded({
              file: fileName,
              count: values.length,
              countFormatted: formatNumber(values.length),
            })}
          </p>
          <div className="flex flex-wrap gap-field [&>*]:min-w-40 [&>*]:flex-1">
            <NumberField
              label={m.csv_skip_first_label()}
              value={skipFirst}
              onChange={(v) => onSkipChange(Number.isNaN(v) ? 0 : v, skipLast)}
              step={1}
              min={0}
              max={Math.max(0, fileRows - skipLast)}
            />
            <NumberField
              label={m.csv_skip_last_label()}
              value={skipLast}
              onChange={(v) => onSkipChange(skipFirst, Number.isNaN(v) ? 0 : v)}
              step={1}
              min={0}
              max={Math.max(0, fileRows - skipFirst)}
            />
          </div>
          <p className="text-hint text-gray-500 dark:text-gray-400">{m.codes_leader_file_hint()}</p>
          {values.length === 0 && (
            <p className="text-label text-red-600 dark:text-red-400">
              {m.codes_leader_skip_empty({ total: formatNumber(fileRows) })}
            </p>
          )}
          {badCounts > 0 && (
            <p className="text-label text-amber-600 dark:text-amber-400">
              {m.codes_leader_bad_counts({ count: badCounts, countFormatted: formatNumber(badCounts) })}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function CodeColumnEditor({
  index,
  column,
  onChange,
  onRemove,
  canRemove,
  rowCount,
  totalRows,
  leader,
}: {
  index: number
  column: CodeColumnConfig
  onChange: (next: CodeColumnConfig) => void
  onRemove: () => void
  canRemove: boolean
  /**
   * Rows a single code has to cover — the largest leader block when there is a
   * leader (followers restart inside each block), the plain row count otherwise.
   * Used to flag when random codes can't be unique.
   */
  rowCount: number
  /** Rows the whole config emits, shown as the leader's running total. */
  totalRows: number
  /** Leader-list import state and handlers, passed straight through to the editor. */
  leader: LeaderImportProps
}) {
  function set<K extends keyof CodeColumnConfig>(key: K, value: CodeColumnConfig[K]) {
    onChange({ ...column, [key]: value })
  }

  // Only the first code may lead: one level of nesting, no cartesian product.
  const modeOptions = index === 0 ? MODE_OPTIONS : FOLLOWER_MODE_OPTIONS

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
        <SelectField label={m.codes_type_label()} value={column.mode} options={modeOptions} onChange={(v) => set('mode', v)} />
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

      {/* The leader's values get their own editor: they replace the single
          per-row value the other modes emit. */}
      {column.mode === 'list' && (
        <LeaderValuesEditor
          values={column.values}
          totalRows={totalRows}
          onChange={(values) => set('values', values)}
          {...leader}
        />
      )}

      {/* Padding only applies to generated codes, not a fixed text label or the
          leader's typed values. Same single-row-until-last-resort treatment for
          the completion controls: a small min-width floor keeps the three fields
          sharing one row and wrapping only as a last resort. */}
      {column.mode !== 'text' && column.mode !== 'list' && (
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
  uploadTotalRows,
  uploadInfo,
  uploadWarnings,
  skipFirst,
  skipLast,
  onSkipChange,
  skippedPreview,
  rowCount,
  onRowCountChange,
  totalRows,
  maxGroupRows,
  hasLeader,
  separator,
  onSeparatorChange,
  columns,
  onColumnsChange,
  leaderFileName,
  leaderFileRows,
  leaderSkipFirst,
  leaderSkipLast,
  leaderBadCounts,
  leaderImportError,
  onLeaderFileLoad,
  onLeaderSkipChange,
  fieldPieces,
  fieldMerges,
  onFieldMergesChange,
  singleFieldPerRow,
  onSingleFieldPerRowChange,
  onGenerate,
  preview,
  previewShown,
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
  /** Rows that will become cards — the file's rows minus the skipped ones. */
  uploadRowCount: number
  /** Rows the file holds *before* skipping. Gates the skip controls and caps them. */
  uploadTotalRows: number
  /** Human-readable summary of the detected delimiter / row & column counts. */
  uploadInfo?: string | null
  /** Non-fatal issues found while parsing the uploaded CSV. */
  uploadWarnings?: string[]
  /** Rows dropped off the front/back of the uploaded file. */
  skipFirst: number
  skipLast: number
  onSkipChange: (first: number, last: number) => void
  /** Display-ready skipped rows shown around the preview (already capped). */
  skippedPreview: { before: string[]; after: string[] }
  /** The row count field: a plain row count, or the default for blank leader counts. */
  rowCount: number
  onRowCountChange: (value: number) => void
  /** Rows the config will actually emit — the sum of the leader's blocks. */
  totalRows: number
  /** Rows a single code must cover: the largest leader block, or `rowCount`. */
  maxGroupRows: number
  /** True when code 1 is a non-empty value list. */
  hasLeader: boolean
  separator: string
  onSeparatorChange: (value: string) => void
  columns: CodeColumnConfig[]
  onColumnsChange: (columns: CodeColumnConfig[]) => void
  /** Leader-list import — see `LeaderImportProps`; regrouped for the editor below. */
  leaderFileName: string | null
  leaderFileRows: number
  leaderSkipFirst: number
  leaderSkipLast: number
  leaderBadCounts: number
  leaderImportError: string | null
  onLeaderFileLoad: (file: File | null) => void
  onLeaderSkipChange: (first: number, last: number) => void
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
  /** Data rows in `preview` (generate mode) — marker lines excluded. */
  previewShown: number
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

  // Rows the file has but that won't become cards. Drives the summary line and
  // keeps it hidden entirely in the default (nothing skipped) case.
  const skippedCount = Math.max(0, uploadTotalRows - uploadRowCount)
  // Skipped rows past the few the preview renders, summarised instead.
  const skippedMore = {
    before: Math.max(0, Math.floor(skipFirst) - skippedPreview.before.length),
    after: Math.max(0, Math.floor(skipLast) - skippedPreview.after.length),
  }

  const previewRowCount = dataMode === 'upload' ? uploadRowCount : totalRows
  // Data rows actually rendered. With a leader the preview spreads its budget
  // across the blocks, so this is not simply `CSV_PREVIEW_ROW_COUNT`.
  const previewShownRows =
    dataMode === 'upload' ? Math.min(uploadRowCount, CSV_PREVIEW_ROW_COUNT) : previewShown

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
          {/* Step 3's primary control in upload mode. */}
          <FileField
            label={m.codes_csv_file_label()}
            accept=".csv,text/csv,text/plain"
            onChange={(files) => onCsvUpload(files?.[0] ?? null)}
            currentName={uploadFileName}
            highlight
          />
          {/* Gated on the file's total rows, not the kept count: over-skipping
              drives the kept count to 0, and the controls must stay on screen so
              the user can dial it back. Each field is capped by what the other
              one leaves, so the empty case is hard to reach from the UI at all. */}
          {uploadTotalRows > 0 && (
            <>
              <div className="flex flex-wrap gap-field [&>*]:min-w-40 [&>*]:flex-1">
                <NumberField
                  label={m.csv_skip_first_label()}
                  value={skipFirst}
                  onChange={(v) => onSkipChange(Number.isNaN(v) ? 0 : v, skipLast)}
                  step={1}
                  min={0}
                  max={Math.max(0, uploadTotalRows - skipLast)}
                />
                <NumberField
                  label={m.csv_skip_last_label()}
                  value={skipLast}
                  onChange={(v) => onSkipChange(skipFirst, Number.isNaN(v) ? 0 : v)}
                  step={1}
                  min={0}
                  max={Math.max(0, uploadTotalRows - skipFirst)}
                />
              </div>
              <p className="text-hint text-gray-500 dark:text-gray-400">{m.csv_skip_hint()}</p>
              {/* Two messages, not one: the kept and skipped counts each need
                  their own plural form, and a single message can only select on
                  one number (which produced "1 sărite"). */}
              {skippedCount > 0 && (
                <p className="text-label font-medium text-gray-700 dark:text-gray-300">
                  {m.csv_skip_summary({
                    count: uploadRowCount,
                    keptFormatted: formatNumber(uploadRowCount),
                    totalFormatted: formatNumber(uploadTotalRows),
                  })}
                  {' ('}
                  {m.csv_skip_summary_skipped({ count: skippedCount, countFormatted: formatNumber(skippedCount) })}
                  {').'}
                </p>
              )}
              {/* Derived, not stored: it must disappear the instant the counts
                  become valid again. Generation is already blocked upstream (the
                  CSV is dropped, so the step gate closes). */}
              {uploadRowCount === 0 && (
                <p className="text-label text-red-600 dark:text-red-400">
                  {m.csv_skip_removes_all({ total: formatNumber(uploadTotalRows) })}
                </p>
              )}
            </>
          )}
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
            {/* Step 3's primary control in generate mode. */}
            <NumberField label={m.codes_row_count_label()} value={rowCount} onChange={onRowCountChange} step={1} highlight />
            <TextField
              label={m.codes_separator_label()}
              value={separator}
              onChange={onSeparatorChange}
              placeholder=" "
            />
          </div>
          {/* With a leader the field no longer states how many rows come out —
              it only fills in the blanks — so say what it means and show the
              real total next to it. */}
          {hasLeader && (
            <p className="text-hint text-gray-500 dark:text-gray-400">
              {m.codes_row_count_leader_hint()}{' '}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {m.codes_total_rows({ count: totalRows, countFormatted: formatNumber(totalRows) })}
              </span>
            </p>
          )}

          <div className="flex flex-wrap gap-inner border-t border-gray-200 pt-block mt-inner dark:border-gray-700">
            {columns.map((column, index) => {
              // Flag a tab whose random code can't yield enough unique values for
              // the rows it has to cover (the editor shows the full explanation).
              const exceeds = column.mode === 'random' && maxGroupRows > randomCodeSpace(column.charset, column.length)
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
              rowCount={maxGroupRows}
              totalRows={totalRows}
              leader={{
                fileName: leaderFileName,
                fileRows: leaderFileRows,
                skipFirst: leaderSkipFirst,
                skipLast: leaderSkipLast,
                badCounts: leaderBadCounts,
                importError: leaderImportError,
                onFileLoad: onLeaderFileLoad,
                onSkipChange: onLeaderSkipChange,
              }}
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
              {generating ? m.codes_generating_progress({ done: formatNumber(progress), total: formatNumber(totalRows) }) : m.codes_generate_csv()}
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
            {previewShownRows < previewRowCount
              ? m.codes_preview_truncated({ shown: previewShownRows, total: formatNumber(previewRowCount) })
              : m.codes_preview()}
          </span>
          <pre className="max-h-40 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-hint text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {/* Skipped rows stay visible, struck through, in the position they
                occupy in the file — so the user can see at a glance that they
                dropped the header and not the first real record. */}
            {skippedPreview.before.map((line, i) => (
              <SkippedLine key={`b${i}`} line={line} />
            ))}
            {skippedMore.before > 0 && <SkippedMore count={skippedMore.before} />}
            {preview}
            {skippedMore.after > 0 && <SkippedMore count={skippedMore.after} />}
            {skippedPreview.after.map((line, i) => (
              <SkippedLine key={`a${i}`} line={line} />
            ))}
          </pre>
        </div>
      )}
    </Section>
  )
}

// One row the skip settings dropped: struck through and muted, with a trailing
// word so the reason is readable and not carried by styling alone.
function SkippedLine({ line }: { line: string }) {
  return (
    <span className="block text-gray-400 line-through dark:text-gray-500">
      {line}
      <span className="ml-2 no-underline">← {m.csv_skipped_marker()}</span>
    </span>
  )
}

// Stands in for skipped rows beyond the few the preview renders.
function SkippedMore({ count }: { count: number }) {
  return (
    <span className="block text-gray-400 dark:text-gray-500">
      {m.csv_skipped_more({ count, countFormatted: formatNumber(count) })}
    </span>
  )
}
