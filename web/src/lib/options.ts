// Form state mirrors `Options` in the Rust crate. Per-word fields (font
// sizes, alignment, colors, etc.) are edited as comma-separated strings and
// parsed into arrays right before calling into wasm.
export interface FormState {
  hostWidthMm: number
  hostHeightMm: number
  offsetXMm: number
  offsetYMm: number
  circleDiameterMm: number
  safeMarginMm: number

  combine: boolean
  debug: boolean
  measurePaths: boolean

  cuttingSpeedMmS: number
  cornerPenaltyS: number
  preparationTimeS: number
  travelSpeedMmS: number

  fontSizes: string
  textYMm: string
  textXMm: string
  align: string
  textColors: string
  textRotations: string
  textFlipX: string
  textFlipY: string
  textBackgrounds: string
  textBackgroundPaddingMm: number
  textBackgroundWidthsMm: string
  textBackgroundAlphas: string
}

// Defaults mirror `Options::default()` in src/options.rs.
export const defaultFormState: FormState = {
  hostWidthMm: 267,
  hostHeightMm: 350,
  offsetXMm: 0,
  offsetYMm: 0,
  circleDiameterMm: 10,
  safeMarginMm: 0,

  combine: false,
  debug: false,
  measurePaths: false,

  cuttingSpeedMmS: 8,
  cornerPenaltyS: 0.2,
  preparationTimeS: 60,
  travelSpeedMmS: 16,

  fontSizes: '9, 14',
  textYMm: '10, 3',
  textXMm: '',
  align: 'center',
  textColors: '',
  textRotations: '',
  textFlipX: '',
  textFlipY: '',
  textBackgrounds: '',
  textBackgroundPaddingMm: 0,
  textBackgroundWidthsMm: '',
  textBackgroundAlphas: '',
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function parseFloatList(value: string): Float32Array {
  return new Float32Array(splitList(value).map((s) => parseFloat(s)))
}

export function parseStringList(value: string): string[] {
  return splitList(value)
}

export function parseBoolList(value: string): boolean[] {
  return splitList(value).map((s) => s.toLowerCase() === 'true' || s === '1')
}

// Build the camelCase options object expected by `generate_with_options`'s
// `JsOptions` (see src/wasm.rs). Any field omitted falls back to
// `Options::default()` on the Rust side.
export function toJsOptions(form: FormState, contour: boolean) {
  return {
    hostWidthMm: form.hostWidthMm,
    hostHeightMm: form.hostHeightMm,
    offsetXMm: form.offsetXMm,
    offsetYMm: form.offsetYMm,
    circleDiameterMm: form.circleDiameterMm,
    contour,
    measurePaths: form.measurePaths,
    cuttingSpeedMmS: form.cuttingSpeedMmS,
    cornerPenaltyS: form.cornerPenaltyS,
    preparationTimeS: form.preparationTimeS,
    travelSpeedMmS: form.travelSpeedMmS,
    fontSizes: parseFloatList(form.fontSizes),
    textYMm: parseFloatList(form.textYMm),
    textXMm: parseFloatList(form.textXMm),
    align: parseStringList(form.align),
    combine: form.combine,
    debug: form.debug,
    safeMarginMm: form.safeMarginMm,
    textColors: parseStringList(form.textColors),
    textRotations: parseFloatList(form.textRotations),
    textFlipX: parseBoolList(form.textFlipX),
    textFlipY: parseBoolList(form.textFlipY),
    textBackgrounds: parseStringList(form.textBackgrounds),
    textBackgroundPaddingMm: form.textBackgroundPaddingMm,
    textBackgroundWidthsMm: parseFloatList(form.textBackgroundWidthsMm),
    textBackgroundAlphas: parseFloatList(form.textBackgroundAlphas),
  }
}
