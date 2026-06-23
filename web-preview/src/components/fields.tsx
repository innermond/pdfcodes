import { useContext, useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { cmykToSquarePos, colorToCss, formatCmyk, parseCmyk, squareColor, squareToCmyk, type Cmyk } from '../lib/cmyk'
import { ColorSampleContext } from '../lib/colorSample'

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
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  type?: 'text' | 'password'
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onFocus={readOnly ? (e) => e.target.select() : undefined}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="w-full min-w-0 rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-blue-400"
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
    <label className="-mx-2 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800"
      />
      <span className="font-medium">{label}</span>
    </label>
  )
}

export function RadioGroupField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string; description?: string }[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-300">
      <legend className="font-medium">{label}</legend>
      {options.map((opt) => (
        <label
          key={opt.value}
          className="-mx-2 flex cursor-pointer items-start gap-2 rounded px-2 py-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <input
            type="radio"
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="mt-1 h-4 w-4 cursor-pointer border-gray-300 dark:border-gray-600 dark:bg-gray-800"
          />
          <span>
            <span className="font-medium">{opt.label}</span>
            {opt.description && <span className="block text-xs text-gray-500 dark:text-gray-400">{opt.description}</span>}
          </span>
        </label>
      ))}
    </fieldset>
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

const CMYK_CHANNELS: { key: keyof Cmyk; label: string }[] = [
  { key: 'c', label: 'C' },
  { key: 'm', label: 'M' },
  { key: 'y', label: 'Y' },
  { key: 'k', label: 'K' },
]

const DEFAULT_CMYK = '0:0:0:1' // black
// A `null` value has no ink and renders as the white card; show the picker
// seeded with this so its swatch/square/inputs reflect that white.
const NULL_CMYK = '0:0:0:0' // white

// The picker's color square: hue across X, saturation top->bottom, painted
// through the print CMYK->RGB conversion (via `squareColor`) so it shows only
// the colors CMYK can reproduce and darkens with the current black level `k` —
// matching the swatch and the generated PDF. The click math in the component
// uses the same axis mapping via `squareToCmyk`. Painting depends on `k`, so the
// PNGs are cached per quantized K rather than built once.
const cmySquarePngByK = new Map<number, string>()
function cmySquareDataUrl(k: number): string {
  // Quantize K so dragging the slider reuses cached squares instead of
  // repainting on every sub-step.
  const kq = Math.round(Math.min(1, Math.max(0, k)) * 100) / 100
  const cached = cmySquarePngByK.get(kq)
  if (cached !== undefined) return cached
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { r, g, b } = squareColor(x / (size - 1), y / (size - 1), kq)
      const i = (y * size + x) * 4
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const url = canvas.toDataURL('image/png')
  cmySquarePngByK.set(kq, url)
  return url
}

// A CMYK color field with an optional "none" state. Picking happens in CMYK so
// colors map directly to print (the generator stores "c:m:y:k"); the swatch is
// an RGB approximation for on-screen preview. `null` means "no color" (the
// generator's "none" sentinel), used for text backgrounds and contour.
export function ColorField({
  label,
  value,
  onChange,
  allowNone = false,
  noneLabel = 'fără fundal',
  hideWhenNull = false,
}: {
  label: string
  value: string | null
  onChange: (value: string | null) => void
  allowNone?: boolean
  noneLabel?: string
  // By default a `null` value still shows the picker, seeded with white (its
  // rendered color). Set this to collapse the picker entirely while `null`
  // instead — e.g. when `null` means a deliberate "none" toggled via `allowNone`.
  hideWhenNull?: boolean
}) {
  // `null` renders as white, so seed the picker (swatch, square, inputs) with
  // white when there's no explicit color.
  const effectiveColor = value ?? NULL_CMYK
  const cmyk = parseCmyk(effectiveColor)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  function setChannel(key: keyof Cmyk, percent: number) {
    const next = { ...cmyk, [key]: Math.min(100, Math.max(0, percent)) / 100 }
    onChange(formatCmyk(next))
  }

  // Close the popover when clicking outside it or pressing Escape.
  useEffect(() => {
    if (!open) return
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Swallow the click so it only closes the popover and doesn't also
        // activate whatever control was underneath (a radio/checkbox/button).
        // Capture phase + stopPropagation keeps the event from reaching the
        // target or React's delegated handlers; preventDefault blocks the
        // native default (e.g. toggling a checkbox).
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', handleOutsideClick, true)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('click', handleOutsideClick, true)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  // Pick a color from the square: map the pointer position to hue/saturation and
  // keep the current K. Supports click and drag.
  function pickFromSquare(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const xFrac = (e.clientX - rect.left) / rect.width
    const yFrac = (e.clientY - rect.top) / rect.height
    onChange(squareToCmyk(xFrac, yFrac, cmyk.k))
  }

  function handleSquarePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pickFromSquare(e)
  }

  function handleSquarePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1) return
    pickFromSquare(e)
  }

  // Show the picker whenever there's a color, and also for `null` unless the
  // caller opted into hiding it (e.g. a deliberate "none").
  const showPicker = value !== null || !hideWhenNull
  const marker = cmykToSquarePos(effectiveColor)
  // Eyedropper: sample a color straight from the live preview (works in every
  // browser — no EyeDropper API needed). Offered only while a preview exists,
  // which is exactly when the context provides a sampler.
  const requestColorSample = useContext(ColorSampleContext)
  async function pickFromPreview() {
    if (!requestColorSample) return
    const sampled = await requestColorSample()
    if (sampled !== null) onChange(sampled)
  }

  return (
    <fieldset className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-300">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {allowNone && (
          <label className="flex cursor-pointer items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={value === null}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked ? null : DEFAULT_CMYK)}
              className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800"
            />
            {noneLabel}
          </label>
        )}
      </div>
      {showPicker && (
        <div className="flex items-center gap-3">
          <div ref={containerRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="Alege culoarea"
              onClick={() => setOpen((v) => !v)}
              className="h-10 w-10 rounded border border-gray-300 dark:border-gray-600"
              style={{ backgroundColor: colorToCss(effectiveColor) }}
            />
            {open && (
              <div className="absolute z-10 mt-1 flex flex-col gap-2 rounded border border-gray-300 bg-white p-2 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                <div
                  className="relative h-40 w-40 cursor-crosshair rounded"
                  style={{ backgroundImage: `url(${cmySquareDataUrl(cmyk.k)})`, backgroundSize: '100% 100%' }}
                  onPointerDown={handleSquarePointerDown}
                  onPointerMove={handleSquarePointerMove}
                >
                  {marker && (
                    <span
                      className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                      style={{ left: `${marker.xFrac * 100}%`, top: `${marker.yFrac * 100}%` }}
                    />
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <span className="w-4 font-medium">K</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(cmyk.k * 100)}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setChannel('k', Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="w-8 text-right text-gray-500 dark:text-gray-400">{Math.round(cmyk.k * 100)}%</span>
                </label>
                {requestColorSample && (
                  <button
                    type="button"
                    onClick={pickFromPreview}
                    aria-label="Alege o culoare din previzualizare"
                    title="Alege o culoare din previzualizare"
                    className="flex items-center justify-center gap-1.5 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                      <path d="M15 11.25l1.5 1.5.75-.75V8.758l2.276-.61a3 3 0 10-3.675-3.675l-.61 2.277H12l-.75.75 1.5 1.5M15 11.25l-8.47 8.47c-.34.34-.8.53-1.28.53s-.94.19-1.28.53l-.97.97-.75-.75.97-.97c.34-.34.53-.8.53-1.28s.19-.94.53-1.28L12.75 9M15 11.25L12.75 9" />
                    </svg>
                    Pipetă
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {CMYK_CHANNELS.map(({ key, label: ch }) => (
              <label key={key} className="flex items-center gap-1">
                <span className="w-4 font-medium">{ch}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(cmyk[key] * 100)}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setChannel(key, Number(e.target.value))}
                  className="w-14 rounded border border-gray-300 px-1 py-0.5 text-right focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">%</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </fieldset>
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
    <label className="flex min-w-0 flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.files)}
        className="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-sm file:mr-2 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-blue-700 dark:border-gray-600 dark:text-gray-300 dark:file:bg-blue-900 dark:file:text-blue-200"
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
