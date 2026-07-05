import { useContext, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { cmykToSquarePos, colorToCss, formatCmyk, parseCmyk, squareColor, squareToCmyk, type Cmyk } from '../lib/cmyk'
import { ColorSampleContext } from '../lib/colorSample'

export function NumberField({
  label,
  value,
  onChange,
  step = 'any',
  min,
  max,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: string | number
  /** When set, the emitted value is clamped to [min, max] (and the spinner is bounded). */
  min?: number
  max?: number
}) {
  // Display rounded, human-friendly numbers (computed values otherwise show long
  // binary-float tails like 12.3456789). This is display-only: the parent state
  // keeps full precision and is never overwritten with the rounded value, so
  // generation is unaffected. While the field is focused we show the raw keystrokes
  // (`editing`) so typing is never reformatted mid-entry.
  const [editing, setEditing] = useState<string | null>(null)
  const rounded = (v: number) => (Number.isNaN(v) ? '' : String(Math.round(v * 1000) / 1000))
  const display = editing ?? rounded(value)
  const clamp = (v: number) => {
    if (Number.isNaN(v)) return v
    let r = v
    if (min !== undefined) r = Math.max(min, r)
    if (max !== undefined) r = Math.min(max, r)
    return r
  }
  return (
    <label className="flex flex-col gap-tight text-label text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={display}
        onFocus={() => setEditing(rounded(value))}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          setEditing(e.target.value)
          onChange(clamp(parseFloat(e.target.value)))
        }}
        onBlur={() => setEditing(null)}
        className="rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400"
      />
    </label>
  )
}

// Two numeric dimension inputs (width/height) with a lock toggle between them.
// When locked and `aspect` (original width/height ratio) is known, editing one
// input derives the other so the pair keeps that ratio; unlocked lets them move
// freely. Toggling the lock on doesn't retroactively snap existing values.
export function LinkedDimensions({
  widthLabel,
  heightLabel,
  width,
  height,
  onWidth,
  onHeight,
  aspect,
  locked,
  onToggleLock,
  lockToggleDisabled = false,
  maxWidth,
  maxHeight,
  onSwap,
}: {
  widthLabel: string
  heightLabel: string
  width: number
  height: number
  onWidth: (value: number) => void
  onHeight: (value: number) => void
  /** Original width/height ratio; NaN/0 when unknown (linking is then inert). */
  aspect: number
  locked: boolean
  onToggleLock: () => void
  /** Forces the lock on and disables the toggle (e.g. a circle must stay 1:1). */
  lockToggleDisabled?: boolean
  /** Upper bounds (e.g. the background size the contour must fit in). Unlocked, each
   *  side is clamped to its own max; locked, the pair scales down keeping aspect. */
  maxWidth?: number
  maxHeight?: number
  onSwap?: () => void
}) {
  const round2 = (x: number) => Math.round(x * 100) / 100
  const canLink = Number.isFinite(aspect) && aspect > 0
  const clampTo = (v: number, max: number | undefined) =>
    max !== undefined && Number.isFinite(v) && v > max ? max : v
  // Largest uniform down-scale (≤1) that fits (w, h) within both maxes.
  const fitScale = (w: number, h: number) =>
    Math.min(
      maxWidth !== undefined && w > maxWidth ? maxWidth / w : 1,
      maxHeight !== undefined && h > maxHeight ? maxHeight / h : 1,
    )
  const emitFromWidth = (w: number) => {
    if (locked && canLink && Number.isFinite(w) && w > 0) {
      const s = fitScale(w, w / aspect)
      onWidth(round2(w * s))
      onHeight(round2((w / aspect) * s))
    } else {
      onWidth(clampTo(w, maxWidth))
    }
  }
  const emitFromHeight = (h: number) => {
    if (locked && canLink && Number.isFinite(h) && h > 0) {
      const s = fitScale(h * aspect, h)
      onWidth(round2(h * aspect * s))
      onHeight(round2(h * s))
    } else {
      onHeight(clampTo(h, maxHeight))
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-field">
      <div className="min-w-40 flex-1">
        <NumberField label={widthLabel} value={width} max={maxWidth} onChange={emitFromWidth} />
      </div>
      <button
        type="button"
        onClick={onToggleLock}
        disabled={lockToggleDisabled}
        aria-pressed={locked}
        title={
          lockToggleDisabled
            ? 'Proporții fixe (forma rămâne rotundă)'
            : locked
              ? 'Proporții păstrate — apasă pentru dimensiuni libere'
              : 'Dimensiuni libere — apasă pentru a păstra proporțiile'
        }
        aria-label={locked ? 'Păstrează proporțiile' : 'Dimensiuni libere'}
        className={
          'mb-tight rounded px-2 py-1 text-label transition ' +
          (lockToggleDisabled ? 'cursor-not-allowed opacity-60 ' : '') +
          (locked
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
            : 'bg-gray-200 text-gray-500 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600')
        }
      >
        {locked ? '🔒' : '🔓'}
      </button>
      {onSwap && (
        <button
          type="button"
          onClick={onSwap}
          title="Schimbă lățimea cu înălțimea (portret ⇄ peisaj)"
          aria-label="Schimbă orientarea"
          className="mb-tight rounded bg-gray-200 px-2 py-1 text-label text-gray-600 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        >
          ⇄
        </button>
      )}
      <div className="min-w-40 flex-1">
        <NumberField label={heightLabel} value={height} max={maxHeight} onChange={emitFromHeight} />
      </div>
    </div>
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
    <label className="flex min-w-0 flex-col gap-tight text-label text-gray-700 dark:text-gray-300">
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
    <label className="-mx-2 flex cursor-pointer items-center gap-inner rounded px-2 py-1 text-label text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
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
    <fieldset className="flex flex-col gap-inner text-label text-gray-700 dark:text-gray-300">
      <legend className="font-medium">{label}</legend>
      <div className="flex flex-wrap gap-inner">
        {options.map((opt) => {
          const isSelected = value === opt.value
          return (
            <label
              key={opt.value}
              className={
                'flex w-fit cursor-pointer items-start gap-inner rounded px-2 py-1 transition ' +
                (isSelected
                  ? 'text-gray-900 dark:text-gray-100'
                  : 'opacity-60 hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-800')
              }
            >
              <input
                type="radio"
                checked={isSelected}
                onChange={() => onChange(opt.value)}
                className="mt-tight h-4 w-4 cursor-pointer border-gray-300 dark:border-gray-600 dark:bg-gray-800"
              />
              <span>
                <span className={isSelected ? 'font-semibold' : 'font-normal'}>{opt.label}</span>
                {opt.description && <span className="block text-hint text-gray-500 dark:text-gray-400">{opt.description}</span>}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  warning,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  // When set, the control is shown in an amber warning state and the message is
  // rendered below it (e.g. an alignment that risks codes overflowing the card).
  warning?: string
}) {
  return (
    <label className="flex flex-col gap-tight text-label text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as T)}
        className={`rounded border px-2 py-1 focus:outline-none dark:bg-gray-800 dark:text-gray-100 ${
          warning
            ? 'border-amber-500 bg-amber-50 focus:border-amber-600 dark:border-amber-500 dark:bg-amber-950/40 dark:focus:border-amber-400'
            : 'border-gray-300 focus:border-blue-500 dark:border-gray-600 dark:focus:border-blue-400'
        }`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {warning && <span className="text-hint text-amber-600 dark:text-amber-400">{warning}</span>}
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
  const panelRef = useRef<HTMLDivElement>(null)
  // Where the popover opens relative to the swatch. Recomputed on open so the
  // panel lands wherever the viewport has room rather than always below.
  const [placement, setPlacement] = useState<{ vertical: 'top' | 'bottom'; horizontal: 'left' | 'right' }>({
    vertical: 'bottom',
    horizontal: 'left',
  })

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

  // Position the popover where the viewport has the most room. Runs before paint
  // (and on scroll/resize while open) so it flips above/left instead of spilling
  // off-screen. The panel is measured live, so it accounts for its real size.
  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const container = containerRef.current
      const panel = panelRef.current
      if (!container || !panel) return
      const anchor = container.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const margin = 8
      const spaceBelow = window.innerHeight - anchor.bottom
      const spaceAbove = anchor.top
      const vertical: 'top' | 'bottom' =
        spaceBelow < panelRect.height + margin && spaceAbove > spaceBelow ? 'top' : 'bottom'
      // Default aligns the panel's left edge to the swatch; flip to right-aligned
      // when that would overflow the right edge and there's more room the other way.
      const spaceRight = window.innerWidth - anchor.left
      const spaceLeft = anchor.right
      const horizontal: 'left' | 'right' =
        spaceRight < panelRect.width + margin && spaceLeft > spaceRight ? 'right' : 'left'
      setPlacement({ vertical, horizontal })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
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
    <fieldset className="flex flex-col gap-inner text-label text-gray-700 dark:text-gray-300">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {allowNone && (
          <label className="flex cursor-pointer items-center gap-tight text-hint">
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
        <div className="flex items-center gap-field">
          <div ref={containerRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="Alege culoarea"
              onClick={() => setOpen((v) => !v)}
              className="h-10 w-10 rounded border border-gray-300 dark:border-gray-600"
              style={{ backgroundColor: colorToCss(effectiveColor) }}
            />
            {open && (
              <div
                ref={panelRef}
                className={
                  'absolute z-10 flex flex-col gap-inner rounded border border-gray-300 bg-white p-2 shadow-lg dark:border-gray-600 dark:bg-gray-800 ' +
                  (placement.vertical === 'top' ? 'bottom-full mb-tight ' : 'top-full mt-tight ') +
                  (placement.horizontal === 'right' ? 'right-0' : 'left-0')
                }
              >
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
                <label className="flex items-center gap-inner text-hint">
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
                    className="flex items-center justify-center gap-tight rounded border border-gray-300 px-2 py-1 text-hint hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
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
          <div className="flex flex-1 flex-wrap items-center justify-between gap-inner">
            {CMYK_CHANNELS.map(({ key, label: ch }) => (
              <label key={key} className="flex items-center gap-tight">
                <span className="w-4 font-medium">{ch}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(cmyk[key] * 100)}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setChannel(key, Number(e.target.value))}
                  className="w-14 rounded border border-gray-300 px-1 py-0.5 text-right focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
                <span className="text-hint text-gray-500 dark:text-gray-400">%</span>
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
  currentName,
}: {
  label: string
  accept?: string
  multiple?: boolean
  onChange: (files: FileList | null) => void
  // Filename to show as a persistent hint. The native input loses its displayed
  // name when this field is remounted (e.g. switching wizard steps), so we surface
  // the retained filename from state here instead of relying on the browser UI.
  currentName?: string | null
}) {
  return (
    <label className="flex min-w-0 flex-col gap-tight text-label text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.files)}
        className="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-label file:mr-2 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-blue-700 dark:border-gray-600 dark:text-gray-300 dark:file:bg-blue-900 dark:file:text-blue-200"
      />
      {currentName ? (
        <span className="min-w-0 break-all text-hint text-green-600 dark:text-green-500">
          ✓ Fișier selectat: {currentName}
        </span>
      ) : null}
    </label>
  )
}

export function Section({
  title,
  children,
  collapsible,
  defaultCollapsed,
  frame = 'none',
}: {
  title: string
  children: React.ReactNode
  collapsible?: boolean
  defaultCollapsed?: boolean
  // 'top': only a top rule under the legend — the outermost, step-level
  // sections (Fundal/Contur/…). 'none' (default): no border at all — every
  // other section (nested collapsibles, Previzualizare, Rezultat, …).
  frame?: 'top' | 'none'
}) {
  const [open, setOpen] = useState(!defaultCollapsed)
  const frameClasses =
    frame === 'top' ? 'border-t border-gray-200 p-block dark:border-gray-700' : 'border-0 p-block'

  if (!collapsible) {
    return (
      <fieldset className={'flex flex-col gap-field ' + frameClasses}>
        <legend className="px-1 text-title font-semibold text-gray-900 dark:text-gray-100">{title}</legend>
        {children}
      </fieldset>
    )
  }

  return (
    <fieldset className={'flex flex-col gap-field ' + (open ? frameClasses : 'border-0 p-0')}>
      <legend className={open ? 'px-1' : 'p-0'}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-tight text-title font-semibold text-gray-900 hover:text-gray-700 dark:text-gray-100 dark:hover:text-gray-300"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={'h-4 w-4 transition-transform ' + (open ? 'rotate-180' : '')}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          {title}
        </button>
      </legend>
      {open && children}
    </fieldset>
  )
}
