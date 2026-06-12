import type { ChangeEvent } from 'react'

export function NumberField({
  label,
  value,
  onChange,
  step = 'any',
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: string | number
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <input
        type="number"
        step={step}
        value={Number.isNaN(value) ? '' : value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(parseFloat(e.target.value))}
        className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400"
      />
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onFocus={readOnly ? (e) => e.target.select() : undefined}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-blue-400"
      />
    </label>
  )
}

export function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800"
      />
      <span className="font-medium">{label}</span>
    </label>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as T)}
        className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// A color field with an optional "none" state, used for text backgrounds
// where `null` means "no background" (the generator's "none" sentinel).
export function ColorField({
  label,
  value,
  onChange,
  allowNone = false,
}: {
  label: string
  value: string | null
  onChange: (value: string | null) => void
  allowNone?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value ?? '#000000'}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          className="h-8 w-12 rounded border border-gray-300 dark:border-gray-600"
        />
        {allowNone && (
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={value === null}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked ? null : '#000000')}
              className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800"
            />
            fără fundal
          </label>
        )}
      </div>
    </label>
  )
}

export function FileField({
  label,
  accept,
  multiple,
  onChange,
}: {
  label: string
  accept?: string
  multiple?: boolean
  onChange: (files: FileList | null) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.files)}
        className="rounded border border-gray-300 px-2 py-1 text-sm file:mr-2 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-blue-700 dark:border-gray-600 dark:text-gray-300 dark:file:bg-blue-900 dark:file:text-blue-200"
      />
    </label>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <legend className="px-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</legend>
      {children}
    </fieldset>
  )
}
