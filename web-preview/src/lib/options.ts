// Points per millimeter, matching `MM` in src/geometry.rs.
export const MM = 72 / 25.4

export type Align = 'left' | 'center' | 'right'

// Vertical alignment of a word's glyph box within the card. Unlike `Align`
// (handled by the generator), this is resolved in the preview to a concrete
// baseline `yMm`, so the generated PDF needs no extra support. `custom` means
// the baseline was positioned manually (drag, arrow keys, or the Y field).
export type VAlign = 'top' | 'middle' | 'bottom' | 'custom'

// CSS `mix-blend-mode` values, used to composite the contour background.
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]

// Per-word style, mirroring the per-word arrays in the main app's "Stil
// text" section (web/src/lib/options.ts). `null` means "not set", i.e. the
// generator falls back to its default (alignment-based X, auto background
// width, etc.)
export interface WordStyle {
  text: string
  fontSizePt: number
  align: Align
  valign: VAlign
  xMm: number | null
  yMm: number
  color: string
  blendMode: BlendMode
  rotationDeg: number
  flipX: boolean
  flipY: boolean
  background: string | null
  backgroundWidthMm: number | null
  backgroundAlpha: number
  backgroundBlendMode: BlendMode
  contourColor: string | null
  contourWidthMm: number
  contourBlendMode: BlendMode
}

export function defaultWordStyle(index: number): WordStyle {
  return {
    text: '',
    fontSizePt: index === 0 ? 9 : 14,
    align: 'center',
    valign: 'custom',
    xMm: null,
    yMm: index === 0 ? 10 : 3,
    color: '0:0:0:1', // CMYK black
    blendMode: 'normal',
    rotationDeg: 0,
    flipX: false,
    flipY: false,
    background: null,
    backgroundWidthMm: null,
    backgroundAlpha: 1,
    backgroundBlendMode: 'normal',
    contourColor: null,
    contourWidthMm: 0.25,
    contourBlendMode: 'normal',
  }
}

// Resolve a vertical alignment into a baseline `yMm` (distance from the
// bottom of the card, matching `WordStyle.yMm`). Font ascent/descent come
// from the same canvas measurement `WordOverlay` uses, so the snapped
// position lines up with the rendered glyph box. Returns the word's current
// `yMm` unchanged for `custom`.
export function verticalAlignYMm(
  valign: VAlign,
  word: WordStyle,
  fontFamily: string,
  cardHeightMm: number,
  safeMarginMm: number,
): number {
  if (valign === 'custom') return word.yMm

  let ascentMm = (word.fontSizePt * 0.8) / MM
  let descentMm = (word.fontSizePt * 0.2) / MM
  const ctx = document.createElement('canvas').getContext('2d')
  if (ctx) {
    ctx.font = `${word.fontSizePt}px ${fontFamily}`
    const tm = ctx.measureText(word.text || 'X')
    ascentMm = tm.fontBoundingBoxAscent / MM
    descentMm = tm.fontBoundingBoxDescent / MM
  }

  switch (valign) {
    case 'top':
      return cardHeightMm - safeMarginMm - ascentMm
    case 'bottom':
      return safeMarginMm + descentMm
    case 'middle':
      return cardHeightMm / 2 - (ascentMm - descentMm) / 2
  }
}

// Split a sample CSV-style record into words, matching `txt.split(split_chars)`
// in src/generate/cards.rs. An empty `splitChars` defaults to a single space.
export function splitWords(sample: string, splitChars: string = ' '): string[] {
  const sep = splitChars === '' ? ' ' : splitChars
  return sample.split(sep).filter((w) => w.length > 0)
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
  const hasContour = words.some((w) => w.contourColor !== null)

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
    textBlendModes: words.map((w) => w.blendMode),
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
    textBackgroundBlendModes: hasBackground ? words.map((w) => w.backgroundBlendMode) : [],
    textContours: hasContour ? words.map((w) => w.contourColor ?? 'none') : [],
    textContourWidthsMm: hasContour
      ? new Float32Array(words.map((w) => w.contourWidthMm))
      : new Float32Array(),
    textContourBlendModes: hasContour ? words.map((w) => w.contourBlendMode) : [],
    splitChars,
  }
}
