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
  // Opacity (0 transparent – 1 opaque) of the code's text fill.
  opacity: number
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
  // Extra spacing (in points) inserted between characters (PDF `Tc`).
  charSpacingPt: number
}

export function defaultWordStyle(index: number): WordStyle {
  return {
    text: '',
    fontSizePt: 9,
    align: 'center',
    // The primary word starts dead-centre on the card: `align: 'center'` +
    // `xMm: null` centres it horizontally, and `valign: 'middle'` centres it
    // vertically (re-snapped to the live card height by the effect in App).
    // Extra words keep an explicit position so a multi-word code doesn't pile
    // up on the same centre line.
    valign: index === 0 ? 'middle' : 'custom',
    xMm: null,
    yMm: index === 0 ? 10 : 3,
    color: '0:0:0:1', // CMYK black
    opacity: 1,
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
    charSpacingPt: 0.0,
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

// Resolve a horizontal alignment into an explicit baseline `xMm` (distance from
// the left of the card to the text's start, matching `WordStyle.xMm` and the
// left/center/right math in src/generate/cards.rs). Uses the same canvas
// measurement the preview relies on, so freezing an aligned word into "custom"
// keeps it visually in place.
export function horizontalAlignXMm(
  align: Align,
  word: WordStyle,
  fontFamily: string,
  cardWidthMm: number,
  safeMarginMm: number,
): number {
  let textWidthMm = (word.fontSizePt * 0.6 * Math.max(1, word.text.length)) / MM
  const ctx = document.createElement('canvas').getContext('2d')
  if (ctx) {
    ctx.font = `${word.fontSizePt}px ${fontFamily}`
    const charCount = Math.max(1, word.text.length)
    const measured = ctx.measureText(word.text || 'X').width + word.charSpacingPt * (charCount - 1)
    textWidthMm = measured / MM
  }

  switch (align) {
    case 'left':
      return safeMarginMm
    case 'center':
      return cardWidthMm / 2 - textWidthMm / 2
    case 'right':
      return cardWidthMm - textWidthMm - safeMarginMm
  }
}

// Split a sample CSV-style record into words, matching `txt.split(split_chars)`
// in src/generate/cards.rs. An empty separator defaults to a single space.
export function splitWords(sample: string, separator: string = ' '): string[] {
  const sep = separator === '' ? ' ' : separator
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
  // "Non-decupare" (no-cut): one card per page, page sized to the card, no
  // imposition grid and no registration circles.
  noCut: boolean
  // "Minimal": crop the generated page (and each card cell) down to the contour's
  // bounding box instead of the background size, so the output is a smaller page
  // tightly bounding the contour. Only has an effect once a contour is loaded.
  minimal: boolean
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
  noCut: false,
  minimal: false,
}

// Build the camelCase options object expected by `generate_with_options`'s
// `JsOptions` (see src/wasm.rs), directly from the live `words` state
// instead of round-tripping through the comma-separated strings used by
// the main app's form.
export function buildJsOptions(
  words: WordStyle[],
  separator: string,
  safeMarginMm: number,
  backgroundPaddingMm: number,
  page: PageOptions,
  contour: boolean,
  cardWidthMm?: number | null,
  cardHeightMm?: number | null,
  // 1-based page to use from the uploaded background PDF. For the contour-only
  // job the contour PDF is passed as the background, so its page number is sent
  // here too. `contourPageNumber` is only needed for `--combineb`, where the
  // print job's overlay reads a page from the separately-loaded contour PDF.
  backgroundPageNumber?: number | null,
  contourPageNumber?: number | null,
  // Nudge the contour within the background (right/up positive, mm). For the
  // no-cut standalone contour, `contourCanvas*Mm` sizes the cut page to the
  // background so a smaller, offset contour cuts in the right place.
  contourOffsetXMm?: number | null,
  contourOffsetYMm?: number | null,
  contourCanvasWidthMm?: number | null,
  contourCanvasHeightMm?: number | null,
  // Extra clockwise rotation (deg, multiple of 90) applied to the print background.
  backgroundRotation?: number | null,
  // Resize/rotate applied to the contour in the combine overlay so it matches
  // the standalone cut (which receives the same transform through the background
  // pipeline). Width/height are the target card-mm; rotation is clockwise degrees
  // (multiple of 90). Only consumed when an overlay is built (combine).
  contourTargetWidthMm?: number | null,
  contourTargetHeightMm?: number | null,
  contourRotation?: number | null,
  // "Minimal" crop window = the contour's bounding box (card-mm). When `page.minimal`
  // is set and these are > 0, the print page/cells shrink to this box, cropping the
  // background to the contour window (origin = the contour offset above).
  minimalWidthMm?: number | null,
  minimalHeightMm?: number | null,
  // Trim an uploaded contour to the bounding box of its drawn path instead of its page
  // MediaBox (see `contourTrimToPath` in App / `content_path_bbox` in Rust).
  contourTrimToPath?: boolean,
  // The cut contour's "keep" region (closed polygons, card points, y-up), used by
  // the generator to flag codes the cut would slice instead of testing against the
  // page/safe margin. Null ⇒ legacy card-confinement check. See `contourKeepRegion.ts`.
  contourKeepRegion?: { coords: Float32Array; lens: Uint32Array } | null,
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
    // "Combină paginile" overlays the contour onto the print pages (view-only,
    // non-printing). It works in both grid (decupare) and no-cut mode.
    combine: page.combine,
    debug: page.debug,
    noCut: page.noCut,
    minimal: page.minimal,
    safeMarginMm,
    textColors: words.map((w) => w.color),
    // Text fill opacity, one per word (always sent — text always renders).
    textAlphas: new Float32Array(words.map((w) => w.opacity ?? 1)),
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
    textCharSpacingsPt: new Float32Array(words.map((w) => w.charSpacingPt)),
    splitChars: separator,
    ...(cardWidthMm != null && isFinite(cardWidthMm) ? { cardWidthMm } : {}),
    ...(cardHeightMm != null && isFinite(cardHeightMm) ? { cardHeightMm } : {}),
    ...(backgroundPageNumber != null && backgroundPageNumber > 1 ? { backgroundPageNumber } : {}),
    ...(backgroundRotation != null && backgroundRotation !== 0 ? { backgroundRotation } : {}),
    ...(contourPageNumber != null && contourPageNumber > 1 ? { contourPageNumber } : {}),
    ...(contourOffsetXMm != null && contourOffsetXMm !== 0 ? { contourOffsetXMm } : {}),
    ...(contourOffsetYMm != null && contourOffsetYMm !== 0 ? { contourOffsetYMm } : {}),
    ...(contourCanvasWidthMm != null && contourCanvasWidthMm > 0 ? { contourCanvasWidthMm } : {}),
    ...(contourCanvasHeightMm != null && contourCanvasHeightMm > 0 ? { contourCanvasHeightMm } : {}),
    ...(contourTargetWidthMm != null && contourTargetWidthMm > 0 ? { contourTargetWidthMm } : {}),
    ...(contourTargetHeightMm != null && contourTargetHeightMm > 0 ? { contourTargetHeightMm } : {}),
    ...(contourRotation != null && contourRotation !== 0 ? { contourRotation } : {}),
    ...(minimalWidthMm != null && minimalWidthMm > 0 ? { minimalWidthMm } : {}),
    ...(minimalHeightMm != null && minimalHeightMm > 0 ? { minimalHeightMm } : {}),
    ...(contourTrimToPath ? { contourTrimToPath: true } : {}),
    ...(contourKeepRegion && contourKeepRegion.lens.length > 0
      ? { contourKeepRegion: contourKeepRegion.coords, contourKeepSubpathLens: contourKeepRegion.lens }
      : {}),
  }
}
