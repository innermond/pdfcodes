// Points per millimeter, matching `MM` in src/geometry.rs.
export const MM = 72 / 25.4

export type Align = 'left' | 'center' | 'right'

// Per-word style, mirroring the per-word arrays in the main app's "Stil
// text" section (web/src/lib/options.ts). `null` means "not set", i.e. the
// generator falls back to its default (alignment-based X, auto background
// width, etc.)
export interface WordStyle {
  text: string
  fontSizePt: number
  align: Align
  xMm: number | null
  yMm: number
  color: string
  rotationDeg: number
  flipX: boolean
  flipY: boolean
  background: string | null
  backgroundWidthMm: number | null
  backgroundAlpha: number
}

export function defaultWordStyle(index: number): WordStyle {
  return {
    text: '',
    fontSizePt: index === 0 ? 9 : 14,
    align: 'center',
    xMm: null,
    yMm: index === 0 ? 10 : 3,
    color: '#000000',
    rotationDeg: 0,
    flipX: false,
    flipY: false,
    background: null,
    backgroundWidthMm: null,
    backgroundAlpha: 1,
  }
}

// Split a sample CSV-style record into words, matching `txt.split(split_chars)`
// in src/generate/cards.rs. An empty `splitChars` defaults to a single space.
export function splitWords(sample: string, splitChars: string = ' '): string[] {
  const sep = splitChars === '' ? ' ' : splitChars
  return sample.split(sep).filter((w) => w.length > 0)
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString()
}

// Build the comma-separated strings for the main app's "Stil text" fields.
// A field is only emitted when at least one word needs a non-default value
// for it, matching the generator's "empty = use default for all" behavior.
export function toStyleStrings(words: WordStyle[], backgroundPaddingMm: number) {
  const fontSizes = words.map((w) => fmt(w.fontSizePt)).join(', ')
  const textYMm = words.map((w) => fmt(w.yMm)).join(', ')

  const align = words.some((w) => w.align !== 'center')
    ? words.map((w) => w.align).join(', ')
    : ''

  const textXMm = words.every((w) => w.xMm !== null)
    ? words.map((w) => fmt(w.xMm!)).join(', ')
    : ''

  const textColors = words.some((w) => w.color.toLowerCase() !== '#000000')
    ? words.map((w) => w.color).join(', ')
    : ''

  const textRotations = words.some((w) => w.rotationDeg !== 0)
    ? words.map((w) => fmt(w.rotationDeg)).join(', ')
    : ''

  const textFlipX = words.some((w) => w.flipX)
    ? words.map((w) => (w.flipX ? 'true' : 'false')).join(', ')
    : ''

  const textFlipY = words.some((w) => w.flipY)
    ? words.map((w) => (w.flipY ? 'true' : 'false')).join(', ')
    : ''

  const hasBackground = words.some((w) => w.background !== null)
  const textBackgrounds = hasBackground
    ? words.map((w) => w.background ?? 'none').join(', ')
    : ''

  const textBackgroundWidthsMm = hasBackground && words.every((w) => w.background === null || w.backgroundWidthMm !== null)
    ? words.map((w) => fmt(w.backgroundWidthMm ?? 0)).join(', ')
    : ''

  const textBackgroundAlphas = hasBackground && words.some((w) => w.backgroundAlpha !== 1)
    ? words.map((w) => fmt(w.backgroundAlpha)).join(', ')
    : ''

  return {
    fontSizes,
    textYMm,
    textXMm,
    align,
    textColors,
    textRotations,
    textFlipX,
    textFlipY,
    textBackgrounds,
    textBackgroundPaddingMm: fmt(backgroundPaddingMm),
    textBackgroundWidthsMm,
    textBackgroundAlphas,
  }
}

// Page/cutting options for the "Generare" section, mirroring the
// page-level fields of `FormState` in web/src/lib/options.ts. Per-word
// styling instead comes directly from `words` (see `buildJsOptions`).
export interface PageOptions {
  hostWidthMm: number
  hostHeightMm: number
  offsetXMm: number
  offsetYMm: number
  circleDiameterMm: number
  combine: boolean
  debug: boolean
  measurePaths: boolean
  cuttingSpeedMmS: number
  cornerPenaltyS: number
  preparationTimeS: number
  travelSpeedMmS: number
}

// Defaults mirror `Options::default()` in src/options.rs.
export const defaultPageOptions: PageOptions = {
  hostWidthMm: 267,
  hostHeightMm: 350,
  offsetXMm: 0,
  offsetYMm: 0,
  circleDiameterMm: 10,
  combine: false,
  debug: false,
  measurePaths: false,
  cuttingSpeedMmS: 8,
  cornerPenaltyS: 0.2,
  preparationTimeS: 60,
  travelSpeedMmS: 16,
}

// Build the camelCase options object expected by `generate_with_options`'s
// `JsOptions` (see src/wasm.rs), directly from the live `words` state
// instead of round-tripping through the comma-separated strings used by
// the main app's form.
export function buildJsOptions(
  words: WordStyle[],
  splitChars: string,
  safeMarginMm: number,
  backgroundPaddingMm: number,
  page: PageOptions,
  contour: boolean,
) {
  const hasBackground = words.some((w) => w.background !== null)

  return {
    hostWidthMm: page.hostWidthMm,
    hostHeightMm: page.hostHeightMm,
    offsetXMm: page.offsetXMm,
    offsetYMm: page.offsetYMm,
    circleDiameterMm: page.circleDiameterMm,
    contour,
    measurePaths: page.measurePaths,
    cuttingSpeedMmS: page.cuttingSpeedMmS,
    cornerPenaltyS: page.cornerPenaltyS,
    preparationTimeS: page.preparationTimeS,
    travelSpeedMmS: page.travelSpeedMmS,
    fontSizes: new Float32Array(words.map((w) => w.fontSizePt)),
    textYMm: new Float32Array(words.map((w) => w.yMm)),
    textXMm: words.every((w) => w.xMm !== null)
      ? new Float32Array(words.map((w) => w.xMm!))
      : new Float32Array(),
    align: words.map((w) => w.align),
    combine: page.combine,
    debug: page.debug,
    safeMarginMm,
    textColors: words.map((w) => w.color),
    textRotations: new Float32Array(words.map((w) => w.rotationDeg)),
    textFlipX: words.map((w) => w.flipX),
    textFlipY: words.map((w) => w.flipY),
    textBackgrounds: hasBackground ? words.map((w) => w.background ?? 'none') : [],
    textBackgroundPaddingMm: backgroundPaddingMm,
    textBackgroundWidthsMm: hasBackground && words.every((w) => w.background === null || w.backgroundWidthMm !== null)
      ? new Float32Array(words.map((w) => w.backgroundWidthMm ?? 0))
      : new Float32Array(),
    textBackgroundAlphas: hasBackground
      ? new Float32Array(words.map((w) => w.backgroundAlpha))
      : new Float32Array(),
    splitChars,
  }
}
