// Points per millimeter, matching `MM` in src/geometry.rs.
export const MM = 72 / 25.4

// Horizontal alignment mode. `left`/`center`/`right` frame the code in the card
// rectangle; the `contour-*` variants frame it in the contour's bounding rectangle
// instead. Card variants are resolved by the generator (from the card width) when
// `xMm` is null; the `contour-*` variants are resolved here to an explicit `xMm`
// (like `VAlign`), since the generator doesn't know the contour rectangle.
export type Align =
  | 'left' | 'center' | 'right'
  | 'contour-left' | 'contour-center' | 'contour-right'

// Vertical alignment of a word's glyph box. `top`/`middle`/`bottom` frame it in the
// card; the `contour-*` variants frame it in the contour's bounding rectangle. Unlike
// the card `Align`, every variant here is resolved in the preview to a concrete
// baseline `yMm`, so the generated PDF needs no extra support. `custom` means the
// baseline was positioned manually (drag, arrow keys, or the Y field).
export type VAlign =
  | 'top' | 'middle' | 'bottom'
  | 'contour-top' | 'contour-middle' | 'contour-bottom'
  | 'custom'

// The frame a contour alignment measures against: the contour's bounding rectangle
// in card mm (y-up from the card bottom). `null` ⇒ no contour, fall back to the card.
export interface ContourAlignRect {
  leftMm: number
  bottomMm: number
  widthMm: number
  heightMm: number
}

// Strip a contour alignment down to its base card alignment (the value the generator
// understands). Card modes pass through unchanged.
export function baseAlign(align: Align): 'left' | 'center' | 'right' {
  switch (align) {
    case 'contour-left': return 'left'
    case 'contour-center': return 'center'
    case 'contour-right': return 'right'
    case 'left': case 'center': case 'right': return align
  }
}

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
  contour?: ContourAlignRect | null,
  // Inset for the `contour-*` modes ("Distanțăre contur" = the cut clearance). Defaults
  // to the card margin so callers that don't distinguish keep the old behavior.
  contourInsetMm: number = safeMarginMm,
): number {
  if (valign === 'custom') return word.yMm

  let ascentMm = (word.fontSizePt * 0.8) / MM
  let descentMm = (word.fontSizePt * 0.2) / MM
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (ctx) {
    ctx.font = `${word.fontSizePt}px ${fontFamily}`
    const tm = ctx.measureText(word.text || 'X')
    ascentMm = tm.fontBoundingBoxAscent / MM
    descentMm = tm.fontBoundingBoxDescent / MM
  }

  // Contour modes frame against the contour rectangle and inset by the *cut* clearance
  // (`contourInsetMm`), so an edge-aligned contour code sits exactly at the safe distance
  // the overflow check enforces — mirroring how card modes use the card margin. A missing
  // contour falls back to the card frame + card margin.
  const useContour = contour != null && (valign === 'contour-top' || valign === 'contour-middle' || valign === 'contour-bottom')
  const marginMm = useContour ? contourInsetMm : safeMarginMm
  const bottomMm = useContour ? contour.bottomMm : 0
  const heightMm = useContour ? contour.heightMm : cardHeightMm

  switch (valign) {
    case 'top':
    case 'contour-top':
      return bottomMm + heightMm - marginMm - ascentMm
    case 'bottom':
    case 'contour-bottom':
      return bottomMm + marginMm + descentMm
    case 'middle':
    case 'contour-middle':
      return bottomMm + heightMm / 2 - (ascentMm - descentMm) / 2
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
  contour?: ContourAlignRect | null,
  // Inset for the `contour-*` modes ("Distanțăre contur" = the cut clearance). Defaults
  // to the card margin so callers that don't distinguish keep the old behavior.
  contourInsetMm: number = safeMarginMm,
): number {
  let textWidthMm = (word.fontSizePt * 0.6 * Math.max(1, word.text.length)) / MM
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (ctx) {
    ctx.font = `${word.fontSizePt}px ${fontFamily}`
    const charCount = Math.max(1, word.text.length)
    const measured = ctx.measureText(word.text || 'X').width + word.charSpacingPt * (charCount - 1)
    textWidthMm = measured / MM
  }

  // Contour modes frame against the contour rectangle and inset by the *cut* clearance
  // (`contourInsetMm`); card modes use the card margin. A missing contour falls back to
  // the card frame + card margin.
  const useContour = contour != null && (align === 'contour-left' || align === 'contour-center' || align === 'contour-right')
  const marginMm = useContour ? contourInsetMm : safeMarginMm
  const leftMm = useContour ? contour.leftMm : 0
  const widthMm = useContour ? contour.widthMm : cardWidthMm

  switch (align) {
    case 'left':
    case 'contour-left':
      return leftMm + marginMm
    case 'center':
    case 'contour-center':
      return leftMm + widthMm / 2 - textWidthMm / 2
    case 'right':
    case 'contour-right':
      return leftMm + widthMm - textWidthMm - marginMm
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
  // "Corectare depășire": auto-shrink overflowing codes down to `minFontSizePt`
  // (never below). `overflowCorrectionByColumn` picks the scope (false = per code,
  // true = uniform per word position). Off by default.
  correctOverflow?: boolean,
  minFontSizePt?: number,
  overflowCorrectionByColumn?: boolean,
  // Inward safety margin (mm) from the cut: codes are checked against the contour
  // eroded by this much, so the fit/correction keeps them clear of the cut line.
  // 0 (or no contour) ⇒ test against the true cut path. See `contour_inset_mm`.
  contourInsetMm?: number,
  // Mirror the print background horizontally / vertically (baked into the output,
  // matching the pdf.js preview). See `background_flip_x`/`_y` in src/options.rs.
  backgroundFlipX?: boolean,
  backgroundFlipY?: boolean,
  // Pan the print background within its card rectangle (mm; X right, Y up). Content
  // shifted past the card edge is clipped; the vacated area stays transparent.
  // Appended last to keep the existing positional call sites stable.
  backgroundOffsetXMm?: number | null,
  backgroundOffsetYMm?: number | null,
  // Solid color ("#RRGGBB" or "c:m:y:k") painted behind the background to fill the
  // zones a pan vacates (and any transparent pixels); empty/null keeps them transparent.
  backgroundBackdropColor?: string | null,
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
    // Per-word X: an explicit `xMm` (custom drag or a resolved `contour-*` alignment)
    // or `NaN` = "defer to `align`" for card left/center/right, which the generator
    // then measures itself (see `resolve_x` in src/generate/cards.rs). Sent per word so
    // one explicit X never forces the others; the generator ignores `align` for finite X.
    textXMm: new Float32Array(words.map((w) => (w.xMm ?? NaN))),
    // Only the base card alignment reaches the generator; `contour-*` resolves to `xMm`
    // above, so map it to its base (harmless — ignored when the word carries a finite X).
    align: words.map((w) => baseAlign(w.align)),
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
    ...(backgroundOffsetXMm != null && backgroundOffsetXMm !== 0 ? { backgroundOffsetXMm } : {}),
    ...(backgroundOffsetYMm != null && backgroundOffsetYMm !== 0 ? { backgroundOffsetYMm } : {}),
    ...(backgroundBackdropColor ? { backgroundBackdropColor } : {}),
    ...(backgroundFlipX ? { backgroundFlipX: true } : {}),
    ...(backgroundFlipY ? { backgroundFlipY: true } : {}),
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
    ...(correctOverflow
      ? { correctOverflow: true, minFontSizePt, overflowCorrectionByColumn: overflowCorrectionByColumn === true }
      : {}),
    ...(contourInsetMm != null && contourInsetMm > 0 ? { contourInsetMm } : {}),
  }
}
