import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { CardCanvas, type ContourCutShape } from './components/CardCanvas'
import { CodeSourceSection } from './components/CodeSourceSection'
import { WizardFooter, WizardNav } from './components/WizardNav'
import { CheckboxField, ColorField, FileField, LinkedDimensions, NumberField, RadioGroupField, Section, SelectField, TextField } from './components/fields'
import { DownloadBothButton, FileDownload, ResultPanel } from './components/ResultPanel'
import { type GenerateResult } from './lib/generate'
import { generateBatched, type BatchProgress, type PrintArtifact } from './lib/generateBatched'
import { GoogleFontPicker, type GoogleFontSelection } from './components/GoogleFontPicker'
import { fetchGoogleFont } from './lib/googleFonts'
import { DEFAULT_FONT_FAMILY, ensureDefaultFont, fontFamilyForWord, getDefaultFontBytes, loadFontFile, type LoadedFont } from './lib/fonts'
import { buildFontFaceCss, copyBlobToClipboard, downloadBlob, rasterizePreview } from './lib/screenshot'
import { blobToPngFile, imageBlobFromDataTransfer, readImageBlobFromClipboard } from './lib/clipboardImage'
import { ensureWasmInit, generate_with_options, generate_shape_pdf, generate_polygon_pdf, generate_simple_background_pdf, generate_image_background_pdf } from './lib/wasm'
import { svgToPdf } from './lib/svgWasm'
import { inspectSvg, isSvgFile, looksLikeSvg, prepareSvgForBackground } from './lib/svgBackground'
import type { PresetResources } from './lib/presetBundle'
import { buildJsOptions, BLEND_MODES, defaultPageOptions, MM, defaultWordStyle, splitWords, horizontalAlignXMm, verticalAlignYMm, baseAlign, type Align, type BlendMode, type ContourAlignRect, type PageOptions, type VAlign, type WordStyle } from './lib/options'
import { computeContourKeepRegion, contourLocalPolygons, type Pt } from './lib/contourKeepRegion'
import { contourDisplayFootprintMm } from './lib/contourFootprint'
import { offsetPolygons, polygonsBBox, polygonsToPathD } from './lib/contourOffset'
import { polygonAspectExtent } from './lib/contourMask'
import { CSV_PREVIEW_ROW_COUNT, defaultCodeColumn, generateCsvPreview, mergeFields, randomCodeSpace, streamCodesCsv, type CodeColumnConfig } from './lib/codeSource'
import { serializeRows, describeDelimiter } from './lib/csvSerialize'
import { solidColorBackground } from './lib/solidColorBackground'
import type { PdfBackground } from './lib/pdfBackground'
import { computeContourInteriorMaskPath } from './lib/contourInteriorMask'
import { ColorSampleContext, imageUrlToCanvas, sampleCanvasColorAt } from './lib/colorSample'
import { colorToCss, contrastColor } from './lib/cmyk'
import { randomWordFittingWidth } from './lib/randomWords'
import { useTheme } from './lib/theme'

// --- Lazily-loaded heavy dependencies (per-step code splitting) ---------------
// Each of these modules pulls in a large library that only a specific step
// needs: pdfjs-dist (~600 KB) for the background/contour previews (Steps 1 & 2),
// PapaParse for CSV upload (Step 3), and fflate for preset .zip bundles (Step 5
// + presets). Importing them statically would bake the whole payload into the
// initial bundle. Instead each wrapper below `import()`s its module on first use
// and caches the module promise, so the library is fetched only when the user
// actually reaches that step. The wrappers keep the exact signature and
// (promise) return type of the originals, so every existing call site — which
// already `.then()`/`await`s them — is unchanged.

let pdfBackgroundMod: Promise<typeof import('./lib/pdfBackground')> | null = null
function renderPdfBackground(
  ...args: Parameters<typeof import('./lib/pdfBackground').renderPdfBackground>
): ReturnType<typeof import('./lib/pdfBackground').renderPdfBackground> {
  pdfBackgroundMod ??= import('./lib/pdfBackground')
  return pdfBackgroundMod.then((m) => m.renderPdfBackground(...args))
}

let contourVectorMaskMod: Promise<typeof import('./lib/contourVectorMask')> | null = null
function computeContourVectorMaskPath(
  ...args: Parameters<typeof import('./lib/contourVectorMask').computeContourVectorMaskPath>
): ReturnType<typeof import('./lib/contourVectorMask').computeContourVectorMaskPath> {
  contourVectorMaskMod ??= import('./lib/contourVectorMask')
  return contourVectorMaskMod.then((m) => m.computeContourVectorMaskPath(...args))
}

let contourVectorImageMod: Promise<typeof import('./lib/contourVectorImage')> | null = null
function renderContourVectorImage(
  ...args: Parameters<typeof import('./lib/contourVectorImage').renderContourVectorImage>
): ReturnType<typeof import('./lib/contourVectorImage').renderContourVectorImage> {
  contourVectorImageMod ??= import('./lib/contourVectorImage')
  return contourVectorImageMod.then((m) => m.renderContourVectorImage(...args))
}

let csvImportMod: Promise<typeof import('./lib/csvImport')> | null = null
function parseUploadedCsv(
  ...args: Parameters<typeof import('./lib/csvImport').parseUploadedCsv>
): ReturnType<typeof import('./lib/csvImport').parseUploadedCsv> {
  csvImportMod ??= import('./lib/csvImport')
  return csvImportMod.then((m) => m.parseUploadedCsv(...args))
}

let presetBundleMod: Promise<typeof import('./lib/presetBundle')> | null = null
function downloadPresetBundle(
  ...args: Parameters<typeof import('./lib/presetBundle').downloadPresetBundle>
): ReturnType<typeof import('./lib/presetBundle').downloadPresetBundle> {
  presetBundleMod ??= import('./lib/presetBundle')
  return presetBundleMod.then((m) => m.downloadPresetBundle(...args))
}
function loadPresetBundle(
  ...args: Parameters<typeof import('./lib/presetBundle').loadPresetBundle>
): ReturnType<typeof import('./lib/presetBundle').loadPresetBundle> {
  presetBundleMod ??= import('./lib/presetBundle')
  return presetBundleMod.then((m) => m.loadPresetBundle(...args))
}
// -----------------------------------------------------------------------------

type Mode = 'print' | 'contour' | 'both'

// User-configurable choices, saved to/loaded from a JSON file. Deliberately
// excludes binary uploads (background PDFs, CSV data, and custom font files),
// which aren't representable as JSON and are provided separately per session.
// Per-word Google Font selections *are* representable (just family + style
// strings) and are re-fetched on load.
type CodeDataMode = 'generate' | 'upload'

interface Preset {
  version: 1
  sampleText: string
  codeSeparator: string
  codeDataMode: CodeDataMode
  codeRowCount: number
  codeColumns: CodeColumnConfig[]
  codeFieldMerges: number[]
  codeSingleField: boolean
  words: WordStyle[]
  safeMarginMm: number
  correctOverflow?: boolean
  minFontSizePt?: number
  overflowCorrectionMode?: 'per-code' | 'column'
  contourInsetMm?: number
  backgroundPaddingMm: number
  contourOpacity: number
  contourBlendMode: BlendMode
  contourOffsetXMm: number
  contourOffsetYMm: number
  mode: Mode
  pageOptions: PageOptions
  backgroundSource: BackgroundSource
  backgroundPageNumber: number
  simpleBgWidthMm: number
  simpleBgHeightMm: number
  simpleBgColor: string | null
  fontSources: FontSource[]
  googleFontSelections: (GoogleFontSelection | null)[]
  contourSource: ContourSource
  contourPageNumber: number
  contourTrimToPath?: boolean
  shapeKind: ShapeKind
  shapeCornerRadiusMm: number
  shapeCornerOrientation: CornerOrientation
  polygonSides?: number
  polygonStar?: boolean
  rectangleContour: boolean
}

// UI-only gate for the "Generare" section. Not a security boundary — the
// password (and the generation logic itself) is fully visible/runnable from
// the client. Set VITE_GENERATE_PASSWORD to enable the gate; if unset, the
// section is always shown.
const GENERATE_PASSWORD = import.meta.env.VITE_GENERATE_PASSWORD as string | undefined
// Base URL of a server-side proxy used to fetch remote background images,
// sidestepping the browser's CORS restrictions. The target image URL is
// URL-encoded and appended, so the value must end with the query/path that
// receives it, e.g. `/image-proxy?url=` (Laravel) or `http://localhost:8000/proxy.php?url=`
// (local PHP during dev). If unset, remote-URL background fetching is disabled.
const IMAGE_PROXY = import.meta.env.VITE_IMAGE_PROXY as string | undefined
const GENERATE_UNLOCKED_KEY = 'pdfcodes-preview-generate-unlocked'

// True if any pixel of the bitmap is non-opaque (alpha < 255). The bitmap is
// drawn into a size-capped canvas first: downscaling never turns a fully-opaque
// image translucent (averaging 255s stays 255), so this is cheap and free of
// false positives. Mirrors the generator's own alpha check that decides whether
// to embed an /SMask (src/generate/image_bg.rs).
function bitmapHasTransparency(bmp: ImageBitmap): boolean {
  const cap = 256
  const scale = Math.min(1, cap / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(bmp, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}
const SEPARATOR_DEFAULT = ','

// Internal field separator used for *uploaded* CSVs. PapaParse splits the file
// into clean fields (honouring quoting), and we re-join them with this ASCII
// Unit Separator — a control character that never appears in real CSV text — so
// the downstream renderer can split rows safely even when a field legitimately
// contains the file's original delimiter (e.g. a quoted "a,b"). The friendly
// detected delimiter is still what the user sees; this is plumbing only.
const UPLOAD_SEPARATOR = '\u001F'

// Heuristic for "the user picked the same file in two pickers": the browser
// gives a distinct File object per <input>, but the same on-disk file has the
// same name, size and last-modified time. Used to default the contour to a
// different page when it reuses the background PDF.
function isSameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

// Turn a file name into a safe download-name stem: drop the extension, replace
// any run of characters that aren't letters/digits/`.`/`_`/`-` with a single
// dash, trim stray separators, and cap the length. Returns '' when nothing
// usable remains, so callers can fall back to a default name.
function sanitizeFileStem(name: string): string {
  return name
    .replace(/\.[^./\\]+$/, '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 80)
    .replace(/[-._]+$/g, '')
}

const WIZARD_STEPS = [
  { id: 'fundal', label: 'Fundal' },
  { id: 'contur', label: 'Contur' },
  { id: 'date', label: 'Date' },
  { id: 'aspect', label: 'Coduri' },
  { id: 'generare', label: 'PDF' },
] as const

// Pages per generation batch. Each batch is built as its own PDF and freed
// before the next, bounding peak memory to roughly one batch.
const PAGES_PER_BATCH = 50
type WizardStepId = (typeof WIZARD_STEPS)[number]['id']

function resizeWords(words: WordStyle[], texts: string[]): WordStyle[] {
  const result: WordStyle[] = []
  texts.forEach((text, index) => {
    const existing = words[index]
    if (existing) {
      result.push({ ...existing, text })
      return
    }
    // A code added beyond the current list stacks directly under the previous
    // one. `yMm` is the baseline measured up from the card bottom, so "under"
    // means a smaller y; offset by a line height of the larger of the two fonts.
    const base = defaultWordStyle(index)
    const prev = result[index - 1]
    if (prev) {
      const spacingMm = (Math.max(prev.fontSizePt, base.fontSizePt) * 1.2) / MM
      result.push({ ...base, valign: 'custom', yMm: Math.max(0, prev.yMm - spacingMm), text })
    } else {
      result.push({ ...base, text })
    }
  })
  return result
}

// Human-readable rendering of a separator for warning text. An empty string
// means "space" (the default used by both splitWords and the CSV generator).
function describeSeparator(sep: string): string {
  return sep === '' || sep === ' ' ? 'spațiu' : `„${sep}”`
}

type FontSource = 'google' | 'custom'

type BackgroundSource = 'upload' | 'simple' | 'generate'
// Where the "Fundal imagine" (generate) source gets its raster image from.
type GenBgImageSource = 'file' | 'url' | 'clipboard'
type ContourSource = 'upload' | 'shape'
type ShapeKind = 'circle' | 'ellipse' | 'rectangle' | 'rounded-rectangle' | 'beveled-rectangle' | 'heart' | 'polygon'

// Grouped user-input config for the "Fundal" (background) step, folded into one
// useState (see `setBgField`) instead of a dozen separate ones — following the
// `pageOptions` precedent. Holds only *scalar user choices*; the rendered
// artifacts (`background`, `backgroundFile`, `backgroundPageCount`) and the
// transient `backgroundError`/`genBgLoading`/`genBgImageFile` boundary stay as
// their own state, since they're derived/async rather than user-set config.
interface BgConfig {
  backgroundSource: BackgroundSource
  // Multi-page PDF page selection (1-based); sent to the generator so the print
  // output uses the same page as the preview.
  backgroundPageNumber: number
  // Simple solid-color background dimensions + color ("c:m:y:k" or null).
  simpleBgWidthMm: number
  simpleBgHeightMm: number
  simpleBgColor: string | null
  // "Fundal imagine" (generate-from-raster) target card size + image source.
  genBgWidthMm: number
  genBgHeightMm: number
  genBgImageSource: GenBgImageSource
  genBgImageUrl: string
  // User-editable target card dimensions for an uploaded background PDF.
  // NaN = no override; pre-filled with the detected MediaBox on file load.
  bgTargetWidthMm: number
  bgTargetHeightMm: number
  // User-applied rotation of the uploaded/generated background (0/90/180/270,
  // clockwise), baked into both the preview and the generated output.
  bgRotation: number
  // Mirror the generated image background horizontally / vertically. Only applies
  // to the "Fundal imagine" source (file / URL / clipboard); baked into the image
  // PDF so preview and output match.
  bgFlipX: boolean
  bgFlipY: boolean
  // Pan the background within its card rectangle (mm; X right, Y up, PDF convention).
  // Shared by every source: content shifted past the card edge is clipped and the
  // vacated area stays transparent. Baked into the generated output and mirrored in
  // the preview (see CardCanvas / BackgroundPanOverlay).
  bgOffsetXMm: number
  bgOffsetYMm: number
  // Free-angle "spin" (degrees) of the background about the card center, on top of the
  // 90° `bgRotation` reorient. Corners it vacates are transparent (backdrop/checker).
  bgSpinDeg: number
  // Solid color ("c:m:y:k" or null) painted behind the background to fill the zones a
  // pan vacates (and any transparent pixels); null keeps them transparent.
  bgBackdropColor: string | null
}

const defaultBgConfig: BgConfig = {
  backgroundSource: 'upload',
  backgroundPageNumber: 1,
  simpleBgWidthMm: 86,
  simpleBgHeightMm: 54,
  simpleBgColor: null,
  genBgWidthMm: 86,
  genBgHeightMm: 54,
  genBgImageSource: 'file',
  genBgImageUrl: '',
  bgTargetWidthMm: NaN,
  bgTargetHeightMm: NaN,
  bgRotation: 0,
  bgFlipX: false,
  bgFlipY: false,
  bgOffsetXMm: 0,
  bgOffsetYMm: 0,
  bgSpinDeg: 0,
  bgBackdropColor: null,
}

const SHAPE_OPTIONS: { value: ShapeKind; label: string }[] = [
  { value: 'circle', label: 'Cerc' },
  { value: 'ellipse', label: 'Elipsă' },
  { value: 'rectangle', label: 'Dreptunghi' },
  { value: 'rounded-rectangle', label: 'Dreptunghi cu colțuri rotunjite' },
  { value: 'beveled-rectangle', label: 'Dreptunghi cu colțuri teșite' },
  { value: 'heart', label: 'Inimă' },
  { value: 'polygon', label: 'Poligon' },
]

// Tight bounding box (in card-mm coords, measured from the card's bottom-left)
// of a preset contour shape, mirroring how `build_shape_pdf` in
// src/generate/shapes.rs draws each shape filling the card. A circle uses
// `min(w, h)` and stays centered (so it doesn't grow along the longer axis);
// every other shape fills the full card. Used to re-position codes relative to
// the cut shape when the card is resized.
function contourBoxMm(shape: ShapeKind, cardWMm: number, cardHMm: number) {
  // Only the circle is inscribed in the min(w,h) circle (its tight box is that
  // centered square). Every other shape — including the polygon, which fills its
  // box like the ellipse so a non-square resize stretches it — fills the card.
  if (shape === 'circle') {
    const d = Math.min(cardWMm, cardHMm)
    return { x: (cardWMm - d) / 2, y: (cardHMm - d) / 2, w: d, h: d }
  }
  return { x: 0, y: 0, w: cardWMm, h: cardHMm }
}

// Default box for a preset polygon/star: its natural (regular) bounding box,
// inscribed in the min(w,h) circle of the available space. Sizing the box to the
// shape's own aspect makes it start out regular; the user can then resize it
// (unlocking the aspect stretches the polygon, since it fills its box).
function polygonNaturalBoxMm(sides: number, star: boolean, availWMm: number, availHMm: number) {
  const { spanX, spanY } = polygonAspectExtent(sides, star)
  const r = Math.min(availWMm, availHMm) / 2
  return { w: spanX * r, h: spanY * r }
}

// Pick a page distinct from `chosenPage` within a `pageCount`-page PDF: prefer
// the next page, fall back to the previous one when `chosenPage` is the last
// page, and settle on `chosenPage` itself when there's no other page (a
// single-page PDF). Used to default the contour to a different page than the
// print background when both reuse the same uploaded PDF.
function pickDistinctPage(chosenPage: number, pageCount: number): number {
  const total = Math.max(1, Math.round(pageCount))
  const c = Math.min(Math.max(1, Math.round(chosenPage)), total)
  if (c + 1 <= total) return c + 1
  if (c - 1 >= 1) return c - 1
  return c
}

// Preview zoom bounds and per-click multiplier (display-only magnification).
const PREVIEW_ZOOM_MIN = 0.5
const PREVIEW_ZOOM_MAX = 4
const PREVIEW_ZOOM_STEP = 1.25

// Orientation of a rounded rectangle's corner arcs: "out" bulges outward (the
// usual rounded corner), "in" curves them toward the interior (scalloped).
type CornerOrientation = 'out' | 'in'

// Contour-step user config, grouped into one object (mirrors BgConfig). Holds
// only scalar, user-editable settings; async artifacts (the rendered
// PdfBackground, its File, page count, errors) and transient UI selection stay
// as their own useState. `contourLockAspect` and `contourInsetMm` are kept out
// on purpose — the former mirrors BgConfig's separate `lockAspect`, the latter
// groups with the overflow-correction controls in the Coduri step.
interface ContourConfig {
  contourSource: ContourSource
  contourPageNumber: number
  contourOpacity: number
  contourBlendMode: BlendMode
  // Preview-only: dim everything outside the cut region. Doesn't affect output.
  dimContourExterior: boolean
  shapeKind: ShapeKind
  shapeCornerRadiusMm: number
  shapeCornerOrientation: CornerOrientation
  // Vertex count for the 'polygon' shape (min 3; ignored by the other shapes).
  polygonSides: number
  // Turn the 'polygon' shape into an N-pointed star (ignored by the other shapes).
  polygonStar: boolean
  // Draw a rectangle contour as plain tiled rectangles vs. the optimized grid.
  rectangleContour: boolean
  // Nudge the contour within the background (right/up positive, mm), clamped.
  contourOffsetXMm: number
  contourOffsetYMm: number
  // Size an uploaded contour by its drawn path's bbox instead of the page box.
  contourTrimToPath: boolean
  // User target size (NaN = detected default) and rotation (0/90/180/270 cw).
  contourTargetWidthMm: number
  contourTargetHeightMm: number
  contourRotation: number
  // Free-angle "spin" (degrees) of the contour about its own center, on top of the 90°
  // `contourRotation` reorient. Rotates the cut outline + keep-region without changing size.
  contourSpinDeg: number
  // "Redesenează": equidistant offset of the cut outline (mm, signed). Positive
  // grows it outward (bleed), negative shrinks it inward (safety margin), the
  // same amount everywhere along the outline — applied to both contour sources.
  contourRedrawMm: number
}
const defaultContourConfig: ContourConfig = {
  contourSource: 'upload',
  contourPageNumber: 1,
  contourOpacity: 1.0,
  contourBlendMode: 'normal',
  dimContourExterior: true,
  shapeKind: 'circle',
  shapeCornerRadiusMm: 3,
  shapeCornerOrientation: 'out',
  polygonSides: 6,
  polygonStar: false,
  rectangleContour: false,
  contourOffsetXMm: 0,
  contourOffsetYMm: 0,
  contourTrimToPath: false,
  contourTargetWidthMm: NaN,
  contourTargetHeightMm: NaN,
  contourRotation: 0,
  contourSpinDeg: 0,
  contourRedrawMm: 0,
}

// Data-step user config, grouped into one object (mirrors BgConfig/ContourConfig).
// Holds the scalar/array settings that describe the codes themselves and how a
// CSV is interpreted. Everything derived from parsing an uploaded file (preview
// text, row/warning info, the parsed rows, the raw File, the generated CSV URL
// and its progress/stale/duplicate status) stays as its own useState — those are
// artifacts, not user config. All seven fields here round-trip through `Preset`.
interface DataConfig {
  sampleText: string
  codeDataMode: CodeDataMode
  codeRowCount: number
  codeSeparator: string
  codeColumns: CodeColumnConfig[]
  // Gap indices the user merged back into one field after a wrong auto-split.
  codeFieldMerges: number[]
  // Treat each uploaded row as a single code (re-join all its fields).
  codeSingleField: boolean
}
const defaultDataConfig: DataConfig = {
  sampleText: '',
  codeDataMode: 'generate',
  codeRowCount: 10,
  codeSeparator: SEPARATOR_DEFAULT,
  codeColumns: [defaultCodeColumn()],
  codeFieldMerges: [],
  codeSingleField: false,
}

// Coduri-step (text/layout) user config, grouped into one object (mirrors the
// other *Config clusters). Scalars only: the per-word style collections
// (`words`, `fonts`, `fontSources`, `googleFontSelections`) are heavily mutated
// index-wise and `words` round-trips through Preset on its own, so they stay as
// their own useState. Transient UI (`selectedIndex`) stays separate too.
interface StyleConfig {
  safeMarginMm: number
  backgroundPaddingMm: number
  // Safety inset (mm) from the cut: codes are checked against the contour eroded
  // by this much, so the fit/correction never parks a code on the cut line.
  contourInsetMm: number
  // "Corectare depășire": auto-shrink overflowing codes to fit, down to
  // `minFontSizePt`. `overflowCorrectionMode` picks per-card vs. per-column shrink.
  correctOverflow: boolean
  minFontSizePt: number
  overflowCorrectionMode: 'per-code' | 'column'
  // While true, code/text colors auto-track a contrasting color over a simple
  // colored background; turns off once the user picks a text color / loads a preset.
  autoTextColor: boolean
}
const defaultStyleConfig: StyleConfig = {
  safeMarginMm: 0,
  backgroundPaddingMm: 0,
  contourInsetMm: 0,
  correctOverflow: false,
  minFontSizePt: 6,
  overflowCorrectionMode: 'per-code',
  autoTextColor: true,
}

const CORNER_ORIENTATION_OPTIONS: { value: CornerOrientation; label: string }[] = [
  { value: 'out', label: 'În afară' },
  { value: 'in', label: 'În interior' },
]

function resizeFonts(fonts: (LoadedFont | null)[], length: number): (LoadedFont | null)[] {
  return Array.from({ length }, (_, index) => fonts[index] ?? null)
}

function resizeFontSources(sources: FontSource[], length: number): FontSource[] {
  return Array.from({ length }, (_, index) => sources[index] ?? 'google')
}

function resizeGoogleFontSelections(selections: (GoogleFontSelection | null)[], length: number): (GoogleFontSelection | null)[] {
  return Array.from({ length }, (_, index) => selections[index] ?? null)
}

// Pick the font files to send as `--fonts`: a single shared font (mirroring
// the font_idx broadcast in src/generate/cards.rs), one per word, or none.
function resolveFontFiles(fonts: (LoadedFont | null)[]): { files: File[] } | { error: string } {
  const set = fonts.filter((f): f is LoadedFont => f !== null)
  if (set.length === 0) return { files: [] }
  if (set.length === 1) return { files: [set[0].file] }
  if (set.length === fonts.length) return { files: fonts.map((f) => f!.file) }
  return { error: 'Setează un font pentru fiecare cuvânt, sau pentru un singur cuvânt (folosit pentru toate).' }
}

// Offer the whole rows whose codes fall outside the cut/card as a one-column CSV \u2014
// the entire row (not the offending field) so it's locatable in the source data even
// when fields were merged/unmerged. A UTF-8 BOM keeps Excel happy with Romanian
// diacritics; values with commas/quotes/newlines are quoted per RFC 4180.
function downloadOverflowCsv(rows: string[]) {
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const csv = '\ufeff' + ['rand', ...rows.map(esc)].join('\r\n') + '\r\n'
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'depasiri.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const [step, setStep] = useState<WizardStepId>('fundal')
  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step)

  useEffect(() => {
    void ensureDefaultFont()
  }, [])

  const [background, setBackground] = useState<PdfBackground | null>(null)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)
  // Background-step user config, grouped into one object (see BgConfig) with a
  // generic field setter — mirrors the `pageOptions` precedent. Destructured
  // immediately so every read/effect-dep site stays a plain identifier.
  const [bgConfig, setBgConfig] = useState<BgConfig>(defaultBgConfig)
  const {
    backgroundSource, backgroundPageNumber,
    simpleBgWidthMm, simpleBgHeightMm, simpleBgColor,
    genBgWidthMm, genBgHeightMm, genBgImageSource, genBgImageUrl,
    bgTargetWidthMm, bgTargetHeightMm, bgRotation, bgFlipX, bgFlipY,
    bgOffsetXMm, bgOffsetYMm, bgSpinDeg, bgBackdropColor,
  } = bgConfig
  function setBgField<K extends keyof BgConfig>(key: K, value: BgConfig[K]) {
    setBgConfig((prev) => ({ ...prev, [key]: value }))
  }
  // "Crează fundal": build the print background from a raster image (PNG/JPEG)
  // or an SVG at the chosen card size. `genBgImageFile` is the source-image
  // boundary — any future image source (e.g. AI generation) just feeds a File in
  // here. It's a binary/async boundary, not scalar config, so it stays outside BgConfig.
  const [genBgImageFile, setGenBgImageFile] = useState<File | null>(null)
  const [genBgLoading, setGenBgLoading] = useState(false)
  // A loaded SVG contains <text> elements, which the size-trimmed svg-wasm build
  // drops (no `text` feature) — shown as a warning, not an error, since the rest
  // of the SVG converts fine.
  const [genBgSvgTextWarning, setGenBgSvgTextWarning] = useState(false)
  // Whether the loaded source image carries transparency (any non-opaque pixel).
  // Drives the preview's checkerboard backdrop so transparent regions read as
  // transparent, matching the /SMask the generator now embeds (src/generate/image_bg.rs).
  const [genBgTransparent, setGenBgTransparent] = useState(false)
  // Backdrop for a transparent image: `null` = the gray checkerboard (a preview-only
  // transparency indicator; the exported PDF keeps its alpha via /SMask); a CMYK
  // color string fills the transparent regions with that color, baked into both the
  // preview and the exported PDF (see the backdrop arg to generate_image_background_pdf).
  const [genBgBackdropColor, setGenBgBackdropColor] = useState<string | null>(null)
  // "Mută fundalul": while on, the preview shows a drag surface to pan the background
  // (BackgroundPanOverlay) and word/contour editing is suspended so a drag never
  // steals a word click. The numeric offset fields stay active regardless.
  const [bgNudgeMode, setBgNudgeMode] = useState(false)

  const [contourBackground, setContourBackground] = useState<PdfBackground | null>(null)
  const [contourBackgroundError, setContourBackgroundError] = useState<string | null>(null)
  // Contour-step user config, grouped into one object (see ContourConfig) with a
  // `setContourField` helper — the same pattern as bgConfig/setBgField. Reads
  // stay via the destructured names below; only write sites go through the helper.
  const [contourConfig, setContourConfig] = useState<ContourConfig>(defaultContourConfig)
  const {
    contourSource, contourPageNumber, contourOpacity, contourBlendMode, dimContourExterior,
    shapeKind, shapeCornerRadiusMm, shapeCornerOrientation, polygonSides, polygonStar, rectangleContour,
    contourOffsetXMm, contourOffsetYMm, contourTrimToPath,
    contourTargetWidthMm, contourTargetHeightMm, contourRotation, contourSpinDeg, contourRedrawMm,
  } = contourConfig
  // Accepts a plain value or an updater fn (like a raw setState). None of the
  // config fields are functions, so the typeof check safely tells them apart —
  // this is what lets the async shape effect read the latest target size.
  function setContourField<K extends keyof ContourConfig>(
    key: K,
    value: ContourConfig[K] | ((prev: ContourConfig[K]) => ContourConfig[K]),
  ) {
    setContourConfig((prev) => ({
      ...prev,
      [key]:
        typeof value === 'function'
          ? (value as (p: ContourConfig[K]) => ContourConfig[K])(prev[key])
          : value,
    }))
  }
  // Traced vector "keep" path for the dim-exterior preview of an uploaded contour
  // (preset shapes use the precise `contourCutShape` instead). Recomputed from
  // the rendered outline below; null falls back to the bounding box.
  const [contourInteriorMaskPath, setContourInteriorMaskPath] = useState<string | null>(null)
  // "Redesenează" (equidistant offset) products. When `contourRedrawMm` is non-zero
  // the base contour outline is offset and re-emitted as a fresh cut PDF
  // (`redrawnContourFile` + its rendered `redrawnContour`), a normalized preview mask
  // (`redrawnMaskPath`, 0..1 y-down), and the offset footprint size (`redrawnFootprint`).
  // All null when the offset is 0 (base contour unchanged).
  const [redrawnContourFile, setRedrawnContourFile] = useState<File | null>(null)
  const [redrawnContour, setRedrawnContour] = useState<PdfBackground | null>(null)
  const [redrawnMaskPath, setRedrawnMaskPath] = useState<string | null>(null)
  const [redrawnFootprint, setRedrawnFootprint] = useState<
    { widthMm: number; heightMm: number } | null
  >(null)
  const [shapeError, setShapeError] = useState<string | null>(null)
  // Whether the contour is selected for direct manipulation (drag / arrow-key nudge in
  // the preview). Mutually exclusive with word selection (a word is always selectedIndex,
  // so we gate on this flag rather than nulling the index).
  const [contourSelected, setContourSelected] = useState(false)
  // Last contour offset bounds, used to preserve the offset's *relative* position
  // (its fraction of the available slack) when the card or contour is resized —
  // so a centered contour stays centered and a nudged one stays proportional,
  // instead of keeping a stale absolute mm that drifts off as dimensions change.
  const prevContourBoundsRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null)

  // Data-step user config, grouped into one object (see DataConfig) with a
  // `setDataField` helper — same pattern as bgConfig/contourConfig. Reads stay
  // via the destructured names; the helper takes a value or an updater fn (none
  // of the fields are functions, so the typeof check safely tells them apart).
  const [dataConfig, setDataConfig] = useState<DataConfig>(defaultDataConfig)
  const {
    sampleText, codeDataMode, codeRowCount, codeSeparator,
    codeColumns, codeFieldMerges, codeSingleField,
  } = dataConfig
  function setDataField<K extends keyof DataConfig>(
    key: K,
    value: DataConfig[K] | ((prev: DataConfig[K]) => DataConfig[K]),
  ) {
    setDataConfig((prev) => ({
      ...prev,
      [key]:
        typeof value === 'function'
          ? (value as (p: DataConfig[K]) => DataConfig[K])(prev[key])
          : value,
    }))
  }
  const [words, setWords] = useState<WordStyle[]>(() => resizeWords([], splitWords('', '')))
  const [fonts, setFonts] = useState<(LoadedFont | null)[]>(() => resizeFonts([], words.length))
  const [fontSources, setFontSources] = useState<FontSource[]>(() => resizeFontSources([], words.length))
  const [googleFontSelections, setGoogleFontSelections] = useState<(GoogleFontSelection | null)[]>(() =>
    resizeGoogleFontSelections([], words.length),
  )
  const [fontsError, setFontsError] = useState<string | null>(null)
  const [fontsNotice, setFontsNotice] = useState<string | null>(null)
  // Coduri-step (text/layout) scalar config, grouped into one object (see
  // StyleConfig) with a `setStyleField` helper — same pattern as the other
  // clusters. The per-word arrays (words/fonts/…) stay as separate useState.
  const [styleConfig, setStyleConfig] = useState<StyleConfig>(defaultStyleConfig)
  const {
    safeMarginMm, backgroundPaddingMm, contourInsetMm,
    correctOverflow, minFontSizePt, overflowCorrectionMode, autoTextColor,
  } = styleConfig
  function setStyleField<K extends keyof StyleConfig>(
    key: K,
    value: StyleConfig[K] | ((prev: StyleConfig[K]) => StyleConfig[K]),
  ) {
    setStyleConfig((prev) => ({
      ...prev,
      [key]:
        typeof value === 'function'
          ? (value as (p: StyleConfig[K]) => StyleConfig[K])(prev[key])
          : value,
    }))
  }
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  // When locked, the target width/height inputs keep the uploaded PDF's original
  // aspect ratio; editing one derives the other. Unlocked lets them move freely.
  // (The target dims themselves — `bgTargetWidthMm/HeightMm` — live in BgConfig.)
  const [lockAspect, setLockAspect] = useState(true)
  // Page count of the loaded multi-page PDF (drives whether the page stepper is
  // shown). Derived from the rendered PDF, so it stays out of BgConfig; the
  // user-picked `backgroundPageNumber` lives in BgConfig.
  const [backgroundPageCount, setBackgroundPageCount] = useState(1)
  const [contourBackgroundFile, setContourBackgroundFile] = useState<File | null>(null)
  const [contourPageCount, setContourPageCount] = useState(1)
  // True when the app auto-selected the contour page (a page distinct from the
  // background's) on load, rather than the user picking it. Drives an
  // informational note and is cleared once the user changes the page manually.
  const [contourPageAutoPicked, setContourPageAutoPicked] = useState(false)
  // Lock that keeps an uploaded/preset contour's aspect ratio while resizing —
  // mirrors BgConfig's separate `lockAspect`. The target dims, trim flag, and
  // rotation it acts on all live in ContourConfig (same resize/switch/rotate
  // machinery as the background upload: contour-only cut applies them through the
  // background pipeline (scale + /Rotate); the combine overlay in build_overlay).
  const [contourLockAspect, setContourLockAspect] = useState(true)
  const [mode, setMode] = useState<Mode>('print')
  const [pageOptions, setPageOptions] = useState<PageOptions>(defaultPageOptions)
  const [printArtifact, setPrintArtifact] = useState<PrintArtifact | null>(null)
  const [contourResult, setContourResult] = useState<GenerateResult | null>(null)
  const [genProgress, setGenProgress] = useState<BatchProgress | null>(null)
  const cancelGenRef = useRef<(() => void) | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [genLoading, setGenLoading] = useState(false)
  // A one-card proof ("Mostră"): a single rendered card with the contour over it,
  // generated on the main thread independent of the full batch.
  const [sampleArtifact, setSampleArtifact] = useState<{ blob: Blob } | null>(null)
  const [sampleLoading, setSampleLoading] = useState(false)
  const [csvDataFile, setCsvDataFile] = useState<File | null>(null)
  const [uploadedCsvPreview, setUploadedCsvPreview] = useState('')
  const [uploadedCsvRowCount, setUploadedCsvRowCount] = useState(0)
  const [uploadedCsvInfo, setUploadedCsvInfo] = useState<string | null>(null)
  const [uploadedCsvWarnings, setUploadedCsvWarnings] = useState<string[]>([])
  // The raw file the user uploaded, kept so a manual separator correction can
  // re-parse it with the forced delimiter.
  const [uploadedRawFile, setUploadedRawFile] = useState<File | null>(null)
  const [presetError, setPresetError] = useState<string | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  // For an uploaded CSV whose delimiter was auto-detected wrongly: the raw parsed
  // rows (the merges the user applied to them live in DataConfig.codeFieldMerges,
  // e.g. so a value like "1A 1" mis-split into ["1A","1"] becomes one field again).
  const [uploadedRows, setUploadedRows] = useState<string[][]>([])
  // The widest merged row in the uploaded file (sentinel-joined), used to size
  // the per-word styles. Sizing from the *widest* row — not just the first —
  // ensures every row fits the configured word count, so the generator (which
  // checks each row against the style count) never rejects a longer row.
  const [uploadedMaxRow, setUploadedMaxRow] = useState('')
  const [codeCsvUrl, setCodeCsvUrl] = useState<string | null>(null)
  const [codeCsvProgress, setCodeCsvProgress] = useState<number | null>(null)
  const [codeCsvStale, setCodeCsvStale] = useState(false)
  // Forced-duplicate count from the last generation (null until generated): the
  // post-generation uniqueness check shown next to the download link.
  const [codeCsvDuplicates, setCodeCsvDuplicates] = useState<number | null>(null)

  const codeCsvPreview = useMemo(
    () => generateCsvPreview(codeRowCount, codeColumns, codeSeparator),
    [codeRowCount, codeColumns, codeSeparator],
  )

  // True when at least one random column is asked for more rows than its code
  // space can yield — unique codes are impossible, so generation is blocked
  // until the user fixes the config (longer code, different charset, range).
  const codeUniquenessImpossible =
    codeDataMode === 'generate' &&
    codeColumns.some((c) => c.mode === 'random' && codeRowCount > randomCodeSpace(c.charset, c.length))

  // The separator the renderer actually splits rows by. Generated CSVs use the
  // user's chosen separator; uploaded CSVs are re-joined with the collision-safe
  // `UPLOAD_SEPARATOR`, so that's what they must be split by downstream.
  const effectiveSeparator = codeDataMode === 'upload' ? UPLOAD_SEPARATOR : codeSeparator

  // The raw uploaded row with the most fields (== the most separation chars).
  // The "Câmpuri pe rând" editor shows this row so every mergeable gap is
  // available — a shorter first row would hide gaps that exist only in longer
  // rows, which is why merges defined on the first row didn't cover every row.
  const widestUploadedRow = useMemo(
    () => uploadedRows.reduce<string[]>((max, r) => (r.length > max.length ? r : max), uploadedRows[0] ?? []),
    [uploadedRows],
  )

  // Active preview shown in the data-source step: the uploaded file's rows
  // when in upload mode, the generated preview otherwise. In upload mode the
  // rows are joined with `UPLOAD_SEPARATOR` (so the card sample splits into the
  // exact parsed fields); the visible separator is restored only for display.
  const activePreview = codeDataMode === 'upload' ? uploadedCsvPreview : codeCsvPreview
  const displayPreview =
    codeDataMode === 'upload'
      ? activePreview.split(UPLOAD_SEPARATOR).join(codeSeparator || ' ')
      : activePreview
  // The sample-row field is user-editable, so it always shows/edits with the
  // friendly separator even though uploaded samples are stored sentinel-joined.
  const sampleTextDisplay =
    codeDataMode === 'upload' ? sampleText.split(UPLOAD_SEPARATOR).join(codeSeparator || ' ') : sampleText

  // Mirror a representative CSV row into the card preview and per-word styles.
  // In upload mode this is the *widest* row in the whole file (not the first
  // preview row), applied on both the data step and the styling step so the
  // styles cover every row's field count — otherwise a later, longer row would
  // have more words than configured and the generator rejects it ("has N
  // word(s), but only M ... configured"). In generate mode it tracks the first
  // generated row while editing the data source.
  useEffect(() => {
    if (codeDataMode === 'upload') {
      // Use the widest uploaded row (most separators, counted exactly as the
      // generator splits — every UPLOAD_SEPARATOR, empty fields included) as the
      // example. This drives both the data step's live preview and the styling
      // step (aspect), so the per-word styles configured there cover the file's
      // worst-case row and the generator never sees a row with extra words.
      if (step !== 'date' && step !== 'aspect') return
      const fields = uploadedMaxRow === '' ? [] : uploadedMaxRow.split(UPLOAD_SEPARATOR)
      handleSampleTextChange(uploadedMaxRow, effectiveSeparator, fields)
    } else {
      if (step !== 'date') return
      // A row count of 0 has no representative row to mirror — skip so this
      // momentary state doesn't blank the sample text and wipe the per-word
      // styles (font, color, size…) already configured once rows resume.
      if (codeRowCount === 0) return
      handleSampleTextChange(activePreview.split('\n')[0] ?? '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activePreview, effectiveSeparator, codeDataMode, uploadedMaxRow])

  // On the "Aspect & Cuvinte" step, default the selection to the first word so
  // its editing controls are shown right away. Also recovers from a stale
  // selection index that points past the current word list.
  useEffect(() => {
    if (step !== 'aspect' || words.length === 0) return
    if (selectedIndex === null || selectedIndex >= words.length) {
      setSelectedIndex(0)
    }
  }, [step, selectedIndex, words.length])

  // Effective card dimensions: use user overrides when set (upload mode only),
  // otherwise fall back to what the PDF or simple-background source reports.
  // Declared here (above the effects that depend on it) so a change to the
  // target size re-snaps and re-scales word positions just like a new PDF would.
  // Both "upload" and "create" build a background PDF that's scaled to a target
  // card size: upload's target is `bgTarget*`, create's is `genBg*`. The simple
  // source has no separate target — its card is the rendered background itself.
  const cardTargetWidthMm = backgroundSource === 'upload' ? bgTargetWidthMm : backgroundSource === 'generate' ? genBgWidthMm : NaN
  const cardTargetHeightMm = backgroundSource === 'upload' ? bgTargetHeightMm : backgroundSource === 'generate' ? genBgHeightMm : NaN
  const effectiveCardWidthMm = background && isFinite(cardTargetWidthMm) && cardTargetWidthMm > 0
    ? cardTargetWidthMm
    : (background ? background.widthPt / MM : 0)
  const effectiveCardHeightMm = background && isFinite(cardTargetHeightMm) && cardTargetHeightMm > 0
    ? cardTargetHeightMm
    : (background ? background.heightPt / MM : 0)

  // Nudge the background within its card rectangle, clamped to ±the card dimension
  // (so it can be pushed fully out, leaving all-transparent). Shared by the numeric
  // fields and the preview drag (BackgroundPanOverlay).
  function handleBackgroundOffsetChange(xMm: number, yMm: number) {
    const cx = effectiveCardWidthMm || 0
    const cy = effectiveCardHeightMm || 0
    setBgField('bgOffsetXMm', Math.min(Math.max(-cx, xMm), cx))
    setBgField('bgOffsetYMm', Math.min(Math.max(-cy, yMm), cy))
  }

  // Available space for a preset shape = the full card (no interior margin).
  const contourAvailWidthMm = effectiveCardWidthMm
  const contourAvailHeightMm = effectiveCardHeightMm
  // Requested contour frame = the user's target (default = fill available),
  // clamped to the available space so it only shrinks when it no longer fits.
  // A 90°/270° reorient swaps which card axis each design dimension lands on, so a preset
  // shape's design request is clamped against the axis it occupies *after* the reorient.
  const contourRotQuarter = (((contourRotation % 180) + 180) % 180) === 90
  const designAvailWidthMm = contourRotQuarter ? contourAvailHeightMm : contourAvailWidthMm
  const designAvailHeightMm = contourRotQuarter ? contourAvailWidthMm : contourAvailHeightMm
  const contourReqWidthMm = isFinite(contourTargetWidthMm) && contourTargetWidthMm > 0
    ? Math.min(contourTargetWidthMm, designAvailWidthMm) : designAvailWidthMm
  const contourReqHeightMm = isFinite(contourTargetHeightMm) && contourTargetHeightMm > 0
    ? Math.min(contourTargetHeightMm, designAvailHeightMm) : designAvailHeightMm
  // The shape's tight box in its own (unrotated, design) frame — a circle stays a square of
  // min(side), a polygon its natural box, etc. Gated on `background` (the card), not
  // `contourBackground`, so the size is known before the shape PDF is generated.
  const contourShapeTightBox = contourSource === 'shape' && background
    ? contourBoxMm(shapeKind, contourReqWidthMm, contourReqHeightMm)
    : null
  // Uploaded contour's host-frame size: its `contourBackground` render already bakes the
  // reorient, so its native dims are host-frame (a target override is host-frame too).
  const rawUploadWidthMm = contourBackground
    ? (isFinite(contourTargetWidthMm) && contourTargetWidthMm > 0 ? contourTargetWidthMm : contourBackground.widthPt / MM)
    : 0
  const rawUploadHeightMm = contourBackground
    ? (isFinite(contourTargetHeightMm) && contourTargetHeightMm > 0 ? contourTargetHeightMm : contourBackground.heightPt / MM)
    : 0
  // Host-frame contour box: a 90°/270° reorient swaps a preset shape's design-box sides (so a
  // rotated 40×20 shape occupies 20×40 on the card); an uploaded contour's render is already
  // host-frame. Every downstream consumer — preview rect, cut size, keep-region, footprint,
  // Minimal crop, offset bounds — reads these, so the reorient stays consistent end-to-end.
  const effectiveContourWidthMm = contourShapeTightBox
    ? (contourRotQuarter ? contourShapeTightBox.h : contourShapeTightBox.w)
    : Math.min(contourAvailWidthMm, rawUploadWidthMm)
  const effectiveContourHeightMm = contourShapeTightBox
    ? (contourRotQuarter ? contourShapeTightBox.w : contourShapeTightBox.h)
    : Math.min(contourAvailHeightMm, rawUploadHeightMm)
  // The contour must fit inside the background: an uploaded contour larger than the card is
  // clamped above (shapes are already clamped via `contourReq*`); flag it so the UI warns.
  const uploadExceedsCard =
    contourSource === 'upload' && contourBackground != null &&
    (rawUploadWidthMm > contourAvailWidthMm + 1e-6 || rawUploadHeightMm > contourAvailHeightMm + 1e-6)

  // Cut region for the preview's "dim exterior" overlay. The preset shape now
  // fills its own (effective-size) frame, so the cut fills the contour rect: the
  // mask path is the shape spanning the whole rect (frac = full). `rotation` lets
  // CardCanvas rotate the mask to match the rendered contour image. An uploaded
  // contour has no fillable region → null (CardCanvas dims outside its bbox).
  const contourCutShape: ContourCutShape | null = useMemo(
    () =>
      contourSource === 'shape' && contourBackground && effectiveContourWidthMm > 0 && effectiveContourHeightMm > 0
        ? {
            kind: shapeKind,
            orientation: shapeCornerOrientation,
            rotation: contourRotation,
            frac: { x: 0, y: 0, w: 1, h: 1 },
            rxFrac: shapeCornerRadiusMm / effectiveContourWidthMm,
            ryFrac: shapeCornerRadiusMm / effectiveContourHeightMm,
            sides: polygonSides,
            star: polygonStar,
          }
        : null,
    [
      contourSource, contourBackground, effectiveContourWidthMm, effectiveContourHeightMm,
      shapeKind, shapeCornerOrientation, contourRotation, shapeCornerRadiusMm, polygonSides, polygonStar,
    ],
  )

  // Whether the "Redesenează" offset is active and its products (set by the effect
  // below) are ready. Until then the base contour is shown/used, so a mid-computation
  // nudge never renders or cuts with stale geometry.
  const contourRedrawActive = contourRedrawMm !== 0 && redrawnContour != null && redrawnFootprint != null

  // Active contour = the redrawn (offset) contour when the redraw is live, else the
  // base contour. Every downstream consumer (preview, keep-region, generation) reads
  // the `active*` values so the offset reaches the real cut, not just the preview.
  const activeContourFile = contourRedrawActive ? redrawnContourFile : contourBackgroundFile
  const activeContourBackground = contourRedrawActive ? redrawnContour : contourBackground
  const activeContourWidthMm = contourRedrawActive ? redrawnFootprint!.widthMm : effectiveContourWidthMm
  const activeContourHeightMm = contourRedrawActive ? redrawnFootprint!.heightMm : effectiveContourHeightMm
  // The redrawn contour renders through the interior-mask path (with rotation baked),
  // so its cut-shape is null and its rotation is 0 regardless of the original source.
  const activeContourCutShape = contourRedrawActive ? null : contourCutShape
  const activeInteriorMaskPath = contourRedrawActive ? redrawnMaskPath : contourInteriorMaskPath
  const activeContourRotation = contourRedrawActive ? 0 : contourRotation
  // The contour's display footprint at a given spin (about the box center), offset 0.
  // Unlike the 90° reorient (baked into the outline), the free spin is *not* baked by the
  // redraw, so it always applies as a transform on top — otherwise redraw drops the spin.
  const footprintAtSpin = (spin: number) =>
    contourDisplayFootprintMm({
      boxWidthMm: activeContourWidthMm,
      boxHeightMm: activeContourHeightMm,
      offsetXMm: 0,
      offsetYMm: 0,
      cutShape: activeContourCutShape,
      interiorMaskPath: activeInteriorMaskPath,
      spinDeg: spin,
    })
  const spinFits = (spin: number) => {
    const f = footprintAtSpin(spin)
    return !f || (f.widthMm <= effectiveCardWidthMm + 1e-6 && f.heightMm <= effectiveCardHeightMm + 1e-6)
  }
  // The contour must stay inside the background: a spin grows the footprint, so cap |spin|
  // to the largest value (≤ the requested one) whose footprint still fits the card. The
  // box already fits at 0°, so the fitting range is an interval around 0 — a binary search
  // on the magnitude finds its edge. 0 when even an unspun (oversized) contour overflows.
  const cappedContourSpinDeg = (() => {
    if (!contourBackground || spinFits(contourSpinDeg)) return contourSpinDeg
    const sign = Math.sign(contourSpinDeg) || 1
    let lo = 0
    let hi = Math.abs(contourSpinDeg)
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (spinFits(sign * mid)) lo = mid
      else hi = mid
    }
    return sign * lo
  })()
  const activeContourSpinDeg = cappedContourSpinDeg
  const activeContourTrimToPath = contourRedrawActive ? false : contourTrimToPath
  // The redrawn cut PDF is single-page, so its page pick is always 1.
  const activeContourPageNumber = contourRedrawActive ? 1 : contourPageNumber

  // Display footprint (spin folded in) at offset 0, so the offset bounds and the Minimal
  // crop use the real spun extent, not the un-spun box. `left0/bottom0` is where the
  // footprint sits relative to the box origin — negative when the spin reaches past it.
  // Only engaged for a nonzero spin: at 0° the box IS the footprint (keeps the un-spun
  // behavior byte-identical, including untrimmed uploads whose outline sits inside it).
  const contourFootprint0 = cappedContourSpinDeg !== 0 ? footprintAtSpin(cappedContourSpinDeg) : null
  const footprintWidthMm = contourFootprint0?.widthMm ?? activeContourWidthMm
  const footprintHeightMm = contourFootprint0?.heightMm ?? activeContourHeightMm
  const footprintLeft0Mm = contourFootprint0?.leftMm ?? 0
  const footprintBottom0Mm = contourFootprint0?.bottomMm ?? 0

  // Offset bounds keep the whole footprint inside the card (corner-anchored). The box
  // origin never goes negative (the standalone cut positions by it); when a spin makes the
  // footprint reach past the box's left/bottom, `min` rises so the footprint's own edge —
  // not the box's — lands on the card edge.
  const contourOffsetMinXMm = Math.max(0, -footprintLeft0Mm)
  const contourOffsetMaxXMm = Math.max(contourOffsetMinXMm, effectiveCardWidthMm - footprintWidthMm - footprintLeft0Mm)
  const contourOffsetMinYMm = Math.max(0, -footprintBottom0Mm)
  const contourOffsetMaxYMm = Math.max(contourOffsetMinYMm, effectiveCardHeightMm - footprintHeightMm - footprintBottom0Mm)
  // Re-clamp at point-of-use so a later contour/size/spin change can't leave a stale
  // out-of-range value reaching the preview or the generator.
  const clampedContourOffsetXMm = Math.min(Math.max(contourOffsetMinXMm, contourOffsetXMm), contourOffsetMaxXMm)
  const clampedContourOffsetYMm = Math.min(Math.max(contourOffsetMinYMm, contourOffsetYMm), contourOffsetMaxYMm)

  // Placement: `contourOffsetMinXMm`/`MaxXMm` already reflect the redrawn footprint's own
  // size (see `activeContourWidthMm`/`HeightMm` above), so the clamped offset already IS
  // the footprint's placement — no further shift needed.
  const activeContourOffsetXMm = clampedContourOffsetXMm
  const activeContourOffsetYMm = clampedContourOffsetYMm

  // The footprint at its actual placement (card mm, y-up), used as the Minimal crop window
  // so the crop envelops the spun contour instead of the un-spun box.
  const contourFootprintLeftMm = activeContourOffsetXMm + footprintLeft0Mm
  const contourFootprintBottomMm = activeContourOffsetYMm + footprintBottom0Mm

  // Drag / arrow-key nudge from the preview: clamp the raw offset into the in-card range.
  function handleContourOffsetChange(xMm: number, yMm: number) {
    setContourField('contourOffsetXMm', Math.min(Math.max(contourOffsetMinXMm, xMm), contourOffsetMaxXMm))
    setContourField('contourOffsetYMm', Math.min(Math.max(contourOffsetMinYMm, yMm), contourOffsetMaxYMm))
  }

  // The contour was reduced to keep it inside the background — spin capped and/or an
  // oversized uploaded contour clamped to the card — so the UI can warn the user.
  const contourCappedToFit =
    contourBackground != null &&
    (Math.abs(cappedContourSpinDeg - contourSpinDeg) > 1e-3 || uploadExceedsCard)

  // Preserve the contour offset's relative position across any resize of the card or the
  // contour. We remember the previous bounds and re-express the offset at the same fraction
  // of the new bounds, so a centered contour stays centered and a nudged one keeps its
  // proportional spot. Only for preset shapes; uploaded contours keep their absolute
  // placement. The offset itself is in the deps so its closure is never stale.
  useEffect(() => {
    if (contourSource !== 'shape' || !contourBackground) { prevContourBoundsRef.current = null; return }
    const cur = { minX: contourOffsetMinXMm, maxX: contourOffsetMaxXMm, minY: contourOffsetMinYMm, maxY: contourOffsetMaxYMm }
    const prev = prevContourBoundsRef.current
    prevContourBoundsRef.current = cur
    if (!prev) {
      // First appearance of this contour: center it (offsets are corner-anchored).
      setContourField('contourOffsetXMm', (cur.minX + cur.maxX) / 2)
      setContourField('contourOffsetYMm', (cur.minY + cur.maxY) / 2)
      return
    }
    const fx = prev.maxX > prev.minX ? (contourOffsetXMm - prev.minX) / (prev.maxX - prev.minX) : 0.5
    const fy = prev.maxY > prev.minY ? (contourOffsetYMm - prev.minY) / (prev.maxY - prev.minY) : 0.5
    const nx = cur.minX + fx * (cur.maxX - cur.minX)
    const ny = cur.minY + fy * (cur.maxY - cur.minY)
    if (Math.abs(nx - contourOffsetXMm) > 1e-6) setContourField('contourOffsetXMm', nx)
    if (Math.abs(ny - contourOffsetYMm) > 1e-6) setContourField('contourOffsetYMm', ny)
  }, [contourSource, contourBackground, contourOffsetXMm, contourOffsetYMm, contourOffsetMinXMm, contourOffsetMaxXMm, contourOffsetMinYMm, contourOffsetMaxYMm])

  // The contour's bounding rectangle in card mm (y-up from the card bottom), fed to the
  // align helpers so the `contour-*` alignment options frame a code against the contour
  // instead of the card. `null` when no contour is loaded → those options fall back to
  // the card frame. Recomputed as the contour moves/resizes so alignments re-snap.
  const contourAlignRect: ContourAlignRect | null = useMemo(
    () =>
      activeContourBackground && activeContourWidthMm > 0 && activeContourHeightMm > 0
        ? { leftMm: activeContourOffsetXMm, bottomMm: activeContourOffsetYMm, widthMm: activeContourWidthMm, heightMm: activeContourHeightMm }
        : null,
    [activeContourBackground, activeContourWidthMm, activeContourHeightMm, activeContourOffsetXMm, activeContourOffsetYMm],
  )

  // The cut's "keep" region in card coordinates (PDF points, y-up), handed to the
  // generator so Step 5's overflow warning flags codes the cut would slice instead
  // of testing against the page. Present whenever a contour is loaded; null (no
  // contour) leaves the legacy card/safe-margin check in force. Mirrors the placement
  // of `contourCutShape` / `contourInteriorMaskPath` in CardCanvas.
  const contourKeepRegion = useMemo(
    () =>
      contourBackground
        ? computeContourKeepRegion({
            cardWidthMm: effectiveCardWidthMm,
            cardHeightMm: effectiveCardHeightMm,
            contourWidthMm: activeContourWidthMm,
            contourHeightMm: activeContourHeightMm,
            offsetXMm: activeContourOffsetXMm,
            offsetYMm: activeContourOffsetYMm,
            cutShape: activeContourCutShape,
            interiorMaskPath: activeInteriorMaskPath,
            spinDeg: activeContourSpinDeg,
          })
        : null,
    [
      contourBackground, effectiveCardWidthMm, effectiveCardHeightMm,
      activeContourWidthMm, activeContourHeightMm,
      activeContourOffsetXMm, activeContourOffsetYMm, activeContourSpinDeg,
      activeContourCutShape, activeInteriorMaskPath,
    ],
  )

  // Derive the dim-exterior "keep" path for an uploaded contour (preset shapes use
  // `contourCutShape`). The result is a vector path, so it stays crisp at any preview
  // zoom. Recomputes when the contour changes (upload, page pick, rotation); a null
  // result leaves CardCanvas to dim the bounding box instead.
  //
  // Primary path: translate the PDF's own drawing operators to SVG via PDF.js
  // (`computeContourVectorMaskPath`) — true Béziers, exact corners, no rasterization.
  // Fallback: if the operator walk finds no usable closed geometry (open outline,
  // clip-only or image-based contour), trace the rasterized outline instead. The trace
  // source is rendered well above the on-screen scale-2 so curved outlines are finely
  // sampled; small contours get the full scale, large ones are capped (~2400 px/side)
  // to bound the flood-fill cost.
  useEffect(() => {
    if (contourSource !== 'upload' || !contourBackgroundFile || !contourBackground) {
      setContourInteriorMaskPath(null)
      return
    }
    let cancelled = false
    const traceFallback = () => {
      const maxSidePt = Math.max(contourBackground.widthPt, contourBackground.heightPt)
      const traceScale = maxSidePt > 0 ? Math.max(2, Math.min(8, 2400 / maxSidePt)) : 4
      return renderPdfBackground(contourBackgroundFile, contourPageNumber, contourRotation, traceScale)
        .then((hires) => computeContourInteriorMaskPath(hires.imageUrl))
    }
    computeContourVectorMaskPath(contourBackgroundFile, contourPageNumber, contourRotation, contourTrimToPath)
      .then((d) => d ?? traceFallback())
      .then((d) => { if (!cancelled) setContourInteriorMaskPath(d) })
      .catch(() => { if (!cancelled) setContourInteriorMaskPath(null) })
    return () => { cancelled = true }
  }, [contourSource, contourBackgroundFile, contourBackground, contourPageNumber, contourRotation, contourTrimToPath])

  // "Redesenează": equidistant-offset the base contour outline by `contourRedrawMm`
  // and re-emit it as a fresh cut PDF, a preview mask, and a footprint — the same way
  // for both contour sources (the base outline `contourLocalPolygons` returns already
  // bakes rotation, so the redrawn contour is fully oriented and generated at
  // rotation 0). When the offset is 0 everything reverts to the base contour (no-op).
  useEffect(() => {
    const Wc = effectiveContourWidthMm
    const Hc = effectiveContourHeightMm
    // Clamp an inward offset so it can't collapse/invert the shape into garbage cut
    // geometry (a shrink can only go to just under half the smaller side).
    const dist = Math.max(-0.49 * Math.min(Wc, Hc), contourRedrawMm)
    if (!contourBackground || !(Wc > 0) || !(Hc > 0) || !dist) {
      setRedrawnContourFile(null); setRedrawnContour(null); setRedrawnMaskPath(null); setRedrawnFootprint(null)
      return
    }
    // Base outline in the contour's own box (mm, SVG y-down), then offset it. 1 local
    // unit = 1 card mm on both axes, so `dist` mm is a true equidistant offset.
    const base = contourLocalPolygons({ width: Wc, height: Hc, cutShape: contourCutShape, interiorMaskPath: contourInteriorMaskPath })
    const offset = offsetPolygons(base, dist)
    const bb = polygonsBBox(offset)
    if (!bb || bb.maxX - bb.minX <= 0 || bb.maxY - bb.minY <= 0) {
      setRedrawnContourFile(null); setRedrawnContour(null); setRedrawnMaskPath(null); setRedrawnFootprint(null)
      return
    }
    const Wf = bb.maxX - bb.minX
    const Hf = bb.maxY - bb.minY
    // Translate the offset outline so its box starts at (0,0). For the cut PDF, flip
    // to PDF points (y-up); for the mask, normalize to 0..1 (y-down).
    const localZeroed = offset.map((sp) => sp.map(([x, y]): Pt => [x - bb.minX, y - bb.minY]))
    const coords: number[] = []
    const lens: number[] = []
    for (const sp of localZeroed) {
      if (sp.length < 3) continue
      for (const [x, y] of sp) coords.push(x * MM, (Hf - y) * MM)
      lens.push(sp.length)
    }
    const maskD = polygonsToPathD(localZeroed.map((sp) => sp.map(([x, y]): Pt => [x / Wf, y / Hf])))
    const footprint = { widthMm: Wf, heightMm: Hf }

    let cancelled = false
    ensureWasmInit()
      .then(() => {
        if (cancelled || coords.length === 0) return null
        const bytes = generate_polygon_pdf(Wf, Hf, new Float32Array(coords), new Uint32Array(lens), '0:1:0:0')
        const file = new File([bytes.buffer as ArrayBuffer], 'contur-redesenat.pdf', { type: 'application/pdf' })
        if (cancelled) return null
        setRedrawnContourFile(file)
        setRedrawnMaskPath(maskD || null)
        setRedrawnFootprint(footprint)
        return renderPdfBackground(file, 1, 0)
      })
      .then((bg) => { if (!cancelled && bg) setRedrawnContour(bg) })
      .catch((err) => { if (!cancelled) setShapeError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [contourRedrawMm, effectiveContourWidthMm, effectiveContourHeightMm, contourBackground, contourCutShape, contourInteriorMaskPath])

  // "top"/"middle"/"bottom" snap a word's baseline using the font's ascent and
  // descent, so the snapped `yMm` only matches the chosen edge for the font and
  // size in effect when it was picked. Re-snap whenever the font family, size,
  // text, effective card height or safe margin change so the alignment keeps
  // holding — this is what re-centres an unmoved "middle" code when the user
  // edits the card dimensions. Words set to "custom" keep their explicit
  // (ratio-scaled) position untouched.
  useEffect(() => {
    if (!background || !(effectiveCardHeightMm > 0)) return
    const cardHeightMm = effectiveCardHeightMm
    setWords((prev) => {
      let changed = false
      const next = prev.map((word, index) => {
        if (word.valign === 'custom') return word
        const yMm = verticalAlignYMm(word.valign, word, fontFamilyForWord(fonts, index), cardHeightMm, safeMarginMm, contourAlignRect, contourInsetMm)
        if (Math.abs(yMm - word.yMm) < 1e-6) return word
        changed = true
        return { ...word, yMm }
      })
      return changed ? next : prev
    })
  }, [fonts, background, effectiveCardHeightMm, safeMarginMm, words, contourAlignRect, contourInsetMm])

  // Horizontal analog of the vertical re-snap above, but only for the `contour-*`
  // alignment modes: they're resolved here to an explicit `xMm` (the generator can't
  // frame against the contour). Card left/center/right keep `xMm === null` and stay
  // generator-resolved. Re-runs when the contour rect, text, font or margin change.
  useEffect(() => {
    if (!background || !(effectiveCardWidthMm > 0)) return
    setWords((prev) => {
      let changed = false
      const next = prev.map((word, index) => {
        if (word.align !== 'contour-left' && word.align !== 'contour-center' && word.align !== 'contour-right') return word
        const xMm = horizontalAlignXMm(word.align, word, fontFamilyForWord(fonts, index), effectiveCardWidthMm, safeMarginMm, contourAlignRect, contourInsetMm)
        if (word.xMm !== null && Math.abs(xMm - word.xMm) < 1e-6) return word
        changed = true
        return { ...word, xMm }
      })
      return changed ? next : prev
    })
  }, [fonts, background, effectiveCardWidthMm, safeMarginMm, words, contourAlignRect, contourInsetMm])

  async function handleGenerateCsv() {
    setCodeCsvProgress(0)
    let duplicates = 0
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const chunk of streamCodesCsv(codeRowCount, codeColumns, codeSeparator)) {
          controller.enqueue(encoder.encode(chunk.text))
          setCodeCsvProgress(chunk.rowsDone)
          duplicates = chunk.duplicates
        }
        controller.close()
      },
    })
    const blob = await new Response(stream).blob()
    setCsvDataFile(new File([blob], 'codes.csv', { type: 'text/csv' }))
    setCodeCsvUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(blob)
    })
    setCodeCsvProgress(null)
    setCodeCsvStale(false)
    setCodeCsvDuplicates(duplicates)
  }

  function invalidateCsv() {
    if (codeCsvUrl === null) return
    URL.revokeObjectURL(codeCsvUrl)
    setCodeCsvUrl(null)
    setCsvDataFile(null)
    setCodeCsvProgress(null)
    setCodeCsvStale(true)
    setCodeCsvDuplicates(null)
  }

  function clearUploadedCsv() {
    setCsvDataFile(null)
    setCodeCsvUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setUploadedCsvPreview('')
    setUploadedCsvRowCount(0)
    setUploadedCsvInfo(null)
    setUploadedCsvWarnings([])
    setUploadedRawFile(null)
    setUploadedRows([])
    setDataField('codeFieldMerges', [])
    setDataField('codeSingleField', false)
    setUploadedMaxRow('')
  }

  // Build the normalised downstream CSV File (and its preview/download URL) from
  // parsed records. PapaParse has already resolved each row into clean fields
  // (honouring quoting/BOM/line endings), so we re-join them with the
  // collision-safe `UPLOAD_SEPARATOR`: the worker and wasm split rows by that
  // same separator, which can't clash with field content even when a field
  // contained the file's original delimiter. The preview keeps the separator so
  // the card sample (split by `effectiveSeparator`) recovers the exact fields;
  // it's only swapped for a readable one at display time (`displayPreview`).
  // `gaps` merges adjacent parsed fields back into one (when detection over-split
  // a value that contained the delimiter), re-joined with `joiner` (the delimiter).
  // When `singleField` is set, every field on a row is re-joined into one value
  // (each row becomes a single code), which `gaps` can't guarantee on ragged rows.
  function applyUploadedCsvRows(rows: string[][], gaps: number[], joiner: string, singleField: boolean) {
    setUploadedRows(rows)
    const gapSet = new Set(gaps)
    const merged = singleField
      ? rows.map((r) => [r.join(joiner)])
      : rows.map((r) => mergeFields(r, gapSet, joiner))
    // Track the row with the most fields — equivalently, the most separation
    // chars (fields = separators + 1) — so the per-word styles cover every row.
    const widest = merged.reduce<string[]>((max, r) => (r.length > max.length ? r : max), merged[0] ?? [])
    setUploadedMaxRow(widest.join(UPLOAD_SEPARATOR))
    const file = new File([serializeRows(merged, UPLOAD_SEPARATOR)], 'uploaded.csv', { type: 'text/csv' })
    setCsvDataFile(file)
    setUploadedCsvPreview(serializeRows(merged.slice(0, CSV_PREVIEW_ROW_COUNT), UPLOAD_SEPARATOR))
    setUploadedCsvRowCount(rows.length)
    setCodeCsvUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    setCodeCsvStale(false)
  }

  // Re-apply merges to the already-parsed rows when the user toggles a field gap.
  function handleUploadFieldMergesChange(gaps: number[]) {
    setDataField('codeFieldMerges', gaps)
    applyUploadedCsvRows(uploadedRows, gaps, codeSeparator || ' ', codeSingleField)
  }

  // Toggle "each row is a single code" and re-build the downstream CSV.
  function handleSingleFieldChange(value: boolean) {
    setDataField('codeSingleField', value)
    applyUploadedCsvRows(uploadedRows, codeFieldMerges, codeSeparator || ' ', value)
  }

  // Read a file (the original upload, or a re-parse with a corrected delimiter)
  // and fold the result into state. `auto` distinguishes the message wording.
  async function ingestCsvFile(
    file: File,
    forcedDelimiter?: string,
    restore?: { merges: number[]; singleField: boolean },
  ) {
    let parsed
    try {
      parsed = await parseUploadedCsv(file, forcedDelimiter)
    } catch (err) {
      clearUploadedCsv()
      setUploadedCsvWarnings([`Fișierul nu a putut fi citit: ${err instanceof Error ? err.message : String(err)}`])
      return
    }
    if (parsed.rows.length === 0) {
      clearUploadedCsv()
      setUploadedRawFile(file)
      setUploadedCsvWarnings(parsed.warnings.length > 0 ? parsed.warnings : ['Fișierul nu conține date.'])
      return
    }
    // Remember the detected delimiter as the displayed separator (the friendly
    // label and the "detected wrong?" override field). The actual downstream
    // split uses `UPLOAD_SEPARATOR`, so the user never has to know about CSV
    // separators at all.
    setDataField('codeSeparator', parsed.delimiter)
    setUploadedRawFile(file)
    // Ragged rows (varying field counts) on an auto-detected delimiter mean the
    // split likely fell inside labels (e.g. spaces in "Rasol cu mușchi"). Default
    // to treating each row as one code. A manual override (forcedDelimiter) is an
    // explicit "split like this", so it's respected as-is.
    const ragged = forcedDelimiter === undefined && parsed.rows.some((r) => r.length !== parsed.columnCount)
    // Restoring a preset reloads the same file, so honour the saved field merges
    // and single-code choice. A fresh parse instead drops any previous merges
    // (the layout may have changed) and falls back to the ragged default.
    const merges = restore ? restore.merges : []
    const singleField = restore ? restore.singleField : ragged
    setDataField('codeFieldMerges', merges)
    setDataField('codeSingleField', singleField)
    const rowsLabel = `${parsed.rows.length.toLocaleString('ro-RO')} rânduri`
    if (singleField) {
      setUploadedCsvInfo(`Fiecare rând este tratat ca un singur cod · ${rowsLabel}`)
    } else if (parsed.columnCount <= 1) {
      // A single code per row needs no separator, so don't mention one.
      setUploadedCsvInfo(`Un singur cod pe rând · ${rowsLabel}`)
    } else {
      const prefix = forcedDelimiter !== undefined ? 'Separator' : 'Separator detectat'
      setUploadedCsvInfo(`${prefix}: ${describeDelimiter(parsed.delimiter)} · ${rowsLabel} · ${parsed.columnCount} coloane`)
    }
    // The ragged-columns warning is moot once each row is collapsed to one code,
    // and its "check the separator" advice would now mislead — drop just that one.
    setUploadedCsvWarnings(
      singleField ? parsed.warnings.filter((w) => !w.includes('număr diferit de coloane')) : parsed.warnings,
    )
    applyUploadedCsvRows(parsed.rows, merges, parsed.delimiter || ' ', singleField)
  }

  async function handleCsvUpload(
    file: File | null,
    restore?: { merges: number[]; singleField: boolean },
  ) {
    if (!file) {
      clearUploadedCsv()
      return
    }
    await ingestCsvFile(file, undefined, restore)
  }

  function handleCodeDataModeChange(mode: CodeDataMode) {
    setDataField('codeDataMode', mode)
    // Clear the current CSV when switching so the gate re-opens cleanly.
    clearUploadedCsv()
    setCodeCsvStale(false)
  }

  function handleCodeRowCountChange(value: number) {
    setDataField('codeRowCount', value)
    invalidateCsv()
  }

  function handleCodeColumnsChange(columns: CodeColumnConfig[]) {
    setDataField('codeColumns', columns)
    invalidateCsv()
  }

  const [generateUnlocked, setGenerateUnlocked] = useState(
    () => !GENERATE_PASSWORD || sessionStorage.getItem(GENERATE_UNLOCKED_KEY) === '1',
  )
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  function handleUnlock() {
    if (passwordInput === GENERATE_PASSWORD) {
      setGenerateUnlocked(true)
      setPasswordError(null)
      sessionStorage.setItem(GENERATE_UNLOCKED_KEY, '1')
    } else {
      setPasswordError('Parolă incorectă.')
    }
  }

  function buildPresetBundleArgs(): [Preset, PresetResources] {
    const preset: Preset = {
      version: 1,
      sampleText,
      codeSeparator,
      codeDataMode,
      codeRowCount,
      codeColumns,
      codeFieldMerges,
      codeSingleField,
      words,
      safeMarginMm,
      correctOverflow,
      minFontSizePt,
      overflowCorrectionMode,
      contourInsetMm,
      backgroundPaddingMm,
      contourOpacity,
      contourBlendMode,
      contourOffsetXMm,
      contourOffsetYMm,
      mode,
      pageOptions,
      backgroundSource,
      backgroundPageNumber,
      simpleBgWidthMm,
      simpleBgHeightMm,
      simpleBgColor,
      fontSources,
      googleFontSelections,
      contourSource,
      contourPageNumber,
      contourTrimToPath,
      shapeKind,
      shapeCornerRadiusMm,
      shapeCornerOrientation,
      polygonSides,
      polygonStar,
      rectangleContour,
    }

    const fontsToBundle = new Map<number, File>()
    fontSources.forEach((source, index) => {
      if (source !== 'custom') return
      const font = fonts[index]
      if (font) fontsToBundle.set(index, font.file)
    })

    return [
      preset,
      {
        background: backgroundFile ?? undefined,
        contour: contourSource === 'upload' ? (contourBackgroundFile ?? undefined) : undefined,
        // For an uploaded source bundle the *original* file (not the processed,
        // UPLOAD_SEPARATOR-joined `csvDataFile`, which `parseUploadedCsv` can't
        // round-trip): on load it's re-parsed and the saved merges/single-code
        // choice are re-applied to reproduce the exact field layout.
        csv: (codeDataMode === 'upload' ? uploadedRawFile : csvDataFile) ?? undefined,
        fonts: fontsToBundle,
      },
    ]
  }

  async function handleSavePreset() {
    const [preset, resources] = buildPresetBundleArgs()
    // Name the archive after the user-provided background (e.g.
    // "mircea-macelaru-setari.zip"); fall back to a generic name when the
    // background is a generated simple one or absent.
    const stem = backgroundSource === 'upload' && backgroundFile ? sanitizeFileStem(backgroundFile.name) : ''
    const filename = stem ? `${stem}-setari.zip` : 'pdfcodes-preview-setari.zip'
    await downloadPresetBundle(filename, preset, resources)
  }

  async function handleRequestQuote() {
    if (!backgroundFile) {
      setQuoteError('Este necesar un PDF de fundal.')
      return
    }
    if (!contourBackgroundFile) {
      setQuoteError('Este necesar un fundal de contur (încărcat sau o formă presetată).')
      return
    }
    setQuoteError(null)
    const [preset, resources] = buildPresetBundleArgs()
    await downloadPresetBundle('pdfcodes-cerere-oferta.zip', preset, resources)
  }

  function handleLoadPresetFile(file: File | null) {
    setPresetError(null)
    setFontsError(null)
    setFontsNotice(null)
    if (!file) return
    loadPresetBundle(file)
      .then(({ preset: rawPreset, background: bgFile, contour: contourFile, csv: csvFile, fonts: bundledFonts }) => {
        const preset = rawPreset as Partial<Preset>
        if (!Array.isArray(preset.words)) {
          throw new Error('Fișier de setări invalid: lipsește lista de cuvinte.')
        }
        setDataField('sampleText', preset.sampleText ?? '')
        setDataField('codeSeparator', preset.codeSeparator ?? '')
        if (typeof preset.codeRowCount === 'number') setDataField('codeRowCount', preset.codeRowCount)
        if (Array.isArray(preset.codeColumns)) setDataField('codeColumns', preset.codeColumns)
        const presetMerges = Array.isArray(preset.codeFieldMerges) ? preset.codeFieldMerges : []
        const presetSingleField = preset.codeSingleField === true
        setDataField('codeFieldMerges', presetMerges)
        setDataField('codeSingleField', presetSingleField)
        const length = preset.words.length
        setWords(preset.words.map((w, i) => ({ ...defaultWordStyle(i), ...w })))
        // The preset carries its own text colors; don't override them with the
        // background-contrast default.
        setStyleField('autoTextColor', false)
        setFonts(resizeFonts([], length))
        const sources = resizeFontSources(preset.fontSources ?? [], length)
        const selections = resizeGoogleFontSelections(preset.googleFontSelections ?? [], length)
        setFontSources(sources)
        setGoogleFontSelections(selections)
        setSelectedIndex(null)
        if (typeof preset.safeMarginMm === 'number') setStyleField('safeMarginMm', preset.safeMarginMm)
        if (typeof preset.correctOverflow === 'boolean') setStyleField('correctOverflow', preset.correctOverflow)
        if (typeof preset.minFontSizePt === 'number') setStyleField('minFontSizePt', preset.minFontSizePt)
        if (preset.overflowCorrectionMode === 'per-code' || preset.overflowCorrectionMode === 'column')
          setStyleField('overflowCorrectionMode', preset.overflowCorrectionMode)
        if (typeof preset.contourInsetMm === 'number') setStyleField('contourInsetMm', preset.contourInsetMm)
        if (typeof preset.backgroundPaddingMm === 'number') setStyleField('backgroundPaddingMm', preset.backgroundPaddingMm)
        if (typeof preset.contourOpacity === 'number') setContourField('contourOpacity', preset.contourOpacity)
        if (preset.contourBlendMode) setContourField('contourBlendMode', preset.contourBlendMode)
        // A saved offset is an explicit placement — load it as the new baseline
        // (clearing remembered bounds so it isn't rescaled against stale slack).
        prevContourBoundsRef.current = null
        if (typeof preset.contourOffsetXMm === 'number') setContourField('contourOffsetXMm', preset.contourOffsetXMm)
        if (typeof preset.contourOffsetYMm === 'number') setContourField('contourOffsetYMm', preset.contourOffsetYMm)
        if (preset.mode) setMode(preset.mode)
        if (preset.pageOptions) setPageOptions((prev) => ({ ...prev, ...preset.pageOptions }))
        const loadedBackgroundSource = preset.backgroundSource === 'simple' ? 'simple' : 'upload'
        setBgField('backgroundSource', loadedBackgroundSource)
        if (typeof preset.simpleBgWidthMm === 'number') setBgField('simpleBgWidthMm', preset.simpleBgWidthMm)
        if (typeof preset.simpleBgHeightMm === 'number') setBgField('simpleBgHeightMm', preset.simpleBgHeightMm)
        if (preset.simpleBgColor === null || typeof preset.simpleBgColor === 'string') setBgField('simpleBgColor', preset.simpleBgColor)
        if (preset.contourSource === 'upload' || preset.contourSource === 'shape') setContourField('contourSource', preset.contourSource)
        if (preset.shapeKind && SHAPE_OPTIONS.some((o) => o.value === preset.shapeKind)) setContourField('shapeKind', preset.shapeKind)
        if (typeof preset.shapeCornerRadiusMm === 'number') setContourField('shapeCornerRadiusMm', preset.shapeCornerRadiusMm)
        if (preset.shapeCornerOrientation === 'in' || preset.shapeCornerOrientation === 'out')
          setContourField('shapeCornerOrientation', preset.shapeCornerOrientation)
        if (typeof preset.polygonSides === 'number') setContourField('polygonSides', preset.polygonSides)
        if (typeof preset.polygonStar === 'boolean') setContourField('polygonStar', preset.polygonStar)
        if (typeof preset.rectangleContour === 'boolean') setContourField('rectangleContour', preset.rectangleContour)

        // Restore the print/contour background PDFs bundled in the archive, if any.
        // A simple background is regenerated from its saved dimensions/color by
        // the effect, so the bundled file is only used for the upload source.
        // Restore the saved page for each multi-page PDF: a single uploaded file
        // often holds the print artwork on one page and the cut outline on another,
        // so background/contour can point at different pages of the same document.
        // `renderPdfBackground` clamps internally; re-clamp the stored page once the
        // real page count is known so the preview and the generator agree.
        const savedBgPage = typeof preset.backgroundPageNumber === 'number' ? preset.backgroundPageNumber : 1
        const savedContourPage = typeof preset.contourPageNumber === 'number' ? preset.contourPageNumber : 1
        if (bgFile && loadedBackgroundSource === 'upload') {
          setBackgroundFile(bgFile)
          setBgField('backgroundPageNumber', savedBgPage)
          renderPdfBackground(bgFile, savedBgPage)
            .then((bg) => {
              setBackground(bg)
              setBackgroundPageCount(bg.pageCount)
              setBgField('backgroundPageNumber', Math.min(Math.max(1, savedBgPage), bg.pageCount))
            })
            .catch((err) => setBackgroundError(err instanceof Error ? err.message : String(err)))
        }
        const savedContourTrim = preset.contourTrimToPath === true
        setContourField('contourTrimToPath', savedContourTrim)
        if (contourFile && (preset.contourSource ?? 'upload') === 'upload') {
          setContourBackgroundFile(contourFile)
          setContourField('contourPageNumber', savedContourPage)
          renderContourPreview(contourFile, savedContourPage, 0, savedContourTrim)
            .then((bg) => {
              setContourBackground(bg)
              setContourPageCount(bg.pageCount)
              setContourField('contourPageNumber', Math.min(Math.max(1, savedContourPage), bg.pageCount))
            })
            .catch((err) => setContourBackgroundError(err instanceof Error ? err.message : String(err)))
        }
        const loadedDataMode: CodeDataMode = preset.codeDataMode === 'upload' ? 'upload' : 'generate'
        setDataField('codeDataMode', loadedDataMode)
        if (csvFile && loadedDataMode === 'upload') {
          // Re-ingesting the file would otherwise re-detect the layout and wipe
          // the merges set above, so pass the saved joining through to be honoured.
          void handleCsvUpload(csvFile, { merges: presetMerges, singleField: presetSingleField })
        } else if (csvFile) {
          setCsvDataFile(csvFile)
        }

        // Re-fetch any Google Fonts referenced by the preset.
        selections.forEach((selection, index) => {
          if (sources[index] !== 'google' || !selection) return
          fetchGoogleFont(selection.family, selection.style)
            .then((font) => setFonts((prev) => prev.map((f, i) => (i === index ? font : f))))
            .catch((err) => setFontsError(err instanceof Error ? err.message : String(err)))
        })

        // Restore custom fonts bundled in the archive; warn about any that
        // are missing (e.g. older JSON-only presets) and must be re-uploaded.
        const missingCustomWords: number[] = []
        sources.forEach((source, index) => {
          if (source !== 'custom') return
          const fontFile = bundledFonts.get(index)
          if (!fontFile) {
            missingCustomWords.push(index + 1)
            return
          }
          loadFontFile(fontFile)
            .then((font) => setFonts((prev) => prev.map((f, i) => (i === index ? font : f))))
            .catch((err) => setFontsError(err instanceof Error ? err.message : String(err)))
        })
        if (missingCustomWords.length > 0) {
          setFontsNotice(
            `Cuvântul${missingCustomWords.length > 1 ? 'ele' : ''} ${missingCustomWords.join(', ')} folose${missingCustomWords.length > 1 ? 'sc' : 'ște'} ` +
              `un font propriu (.ttf/.otf) care nu a fost găsit în arhivă — încarcă din nou fișierul de font.`,
          )
        }
      })
      .catch((err) => setPresetError(err instanceof Error ? err.message : String(err)))
  }

  function handleBackgroundFileChange(file: File | null) {
    setBackground(null)
    setBackgroundError(null)
    setBackgroundFile(file)
    setBgField('bgTargetWidthMm', NaN)
    setBgField('bgTargetHeightMm', NaN)
    setBgField('bgRotation', 0)
    setBgField('bgFlipX', false)
    setBgField('bgFlipY', false)
    setBgField('backgroundPageNumber', 1)
    setBackgroundPageCount(1)
    if (!file) return
    renderPdfBackground(file)
      .then(async (bg) => {
        setBackground(bg)
        setBackgroundPageCount(bg.pageCount)
        setBgField('bgTargetWidthMm', bg.widthPt / MM)
        setBgField('bgTargetHeightMm', bg.heightPt / MM)
        await ensureDefaultFont()
        const maxWidthPt = bg.widthPt * 0.9
        const word = randomWordFittingWidth(maxWidthPt, defaultWordStyle(0).fontSizePt)
        handleSampleTextChange(word)
      })
      .catch((err) => setBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  // Re-render the background preview from a different page of the uploaded PDF.
  // The new page may have a different MediaBox, so dimensions are re-detected
  // (same as a fresh upload). The page number is also forwarded to the generator.
  function handleBackgroundPageChange(pageNumber: number) {
    if (!backgroundFile) return
    const page = Math.min(Math.max(1, Math.round(pageNumber)), backgroundPageCount)
    setBgField('backgroundPageNumber', page)
    setBackgroundError(null)
    renderPdfBackground(backgroundFile, page, bgRotation, 2, bgFlipX, bgFlipY)
      .then((bg) => {
        setBackground(bg)
        setBgField('bgTargetWidthMm', bg.widthPt / MM)
        setBgField('bgTargetHeightMm', bg.heightPt / MM)
      })
      .catch((err) => setBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  // Rotate the background (uploaded PDF or generated-from-image) by another 90°
  // clockwise (cycling 0→90→180→270). The rotation is applied non-destructively
  // (preview viewport + the `backgroundRotation` generation option); here we
  // re-render the preview and transpose the active source's target dimensions so
  // the card follows the new orientation.
  function rotateBackground() {
    if (!backgroundFile) return
    const next = (bgRotation + 90) % 360
    setBgField('bgRotation', next)
    if (backgroundSource === 'generate') {
      const w = genBgWidthMm
      setBgField('genBgWidthMm', genBgHeightMm)
      setBgField('genBgHeightMm', w)
    } else {
      const w = bgTargetWidthMm
      setBgField('bgTargetWidthMm', bgTargetHeightMm)
      setBgField('bgTargetHeightMm', w)
    }
    setBackgroundError(null)
    // A generated image background bakes the flip into its PDF, so only the uploaded
    // source flips at render time (passing it for `generate` would double-flip).
    const fx = backgroundSource === 'upload' ? bgFlipX : false
    const fy = backgroundSource === 'upload' ? bgFlipY : false
    renderPdfBackground(backgroundFile, backgroundPageNumber, next, 2, fx, fy)
      .then(setBackground)
      .catch((err) => setBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  // Toggle a mirror axis for an uploaded PDF background and re-render the preview
  // (the generated-image source instead re-bakes the flip in its build effect).
  function flipUploadBackground(axis: 'x' | 'y', value: boolean) {
    const nextX = axis === 'x' ? value : bgFlipX
    const nextY = axis === 'y' ? value : bgFlipY
    setBgField(axis === 'x' ? 'bgFlipX' : 'bgFlipY', value)
    if (!backgroundFile) return
    setBackgroundError(null)
    renderPdfBackground(backgroundFile, backgroundPageNumber, bgRotation, 2, nextX, nextY)
      .then(setBackground)
      .catch((err) => setBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  function handleBackgroundSourceChange(source: BackgroundSource) {
    setBgField('backgroundSource', source)
    setBackgroundError(null)
    // Upload and generate both start from an empty background until the user
    // provides input (a PDF / an image); simple instead regenerates from its
    // dimensions+color via the effect below. (A kept `genBgImageFile` lets the
    // generate effect re-render if the user returns to that source.)
    if (source !== 'simple') {
      setBackground(null)
      setBackgroundFile(null)
      setBgField('bgTargetWidthMm', NaN)
      setBgField('bgTargetHeightMm', NaN)
      setBgField('bgRotation', 0)
      setBgField('backgroundPageNumber', 1)
      setBackgroundPageCount(1)
    }
    // The "Fundal imagine" (generate) source holds the source image
    // (`genBgImageFile`) — including the clipboard sub-source; drop it when leaving.
    if (source !== 'generate') {
      setGenBgImageFile(null)
      setGenBgSvgTextWarning(false)
    }
  }

  // Generate a simple solid-color (or blank) background PDF whenever the simple
  // background source is active and its dimensions/color change, feeding it
  // through the same `backgroundFile`/`background` pipeline as an uploaded PDF.
  useEffect(() => {
    if (backgroundSource !== 'simple') return
    if (!(simpleBgWidthMm > 0) || !(simpleBgHeightMm > 0)) {
      setBackground(null)
      setBackgroundFile(null)
      setBackgroundError('Lățimea și înălțimea fundalului trebuie să fie numere pozitive.')
      return
    }
    let cancelled = false
    ensureWasmInit()
      .then(async () => {
        const bytes = generate_simple_background_pdf(simpleBgWidthMm, simpleBgHeightMm, simpleBgColor ?? '')
        const file = new File([bytes.buffer as ArrayBuffer], 'fundal-simplu.pdf', { type: 'application/pdf' })
        if (cancelled) return null
        setBackgroundFile(file)
        setBackgroundError(null)
        await ensureDefaultFont()
        // Preview the solid color via the app's own CMYK->RGB conversion so it
        // matches the picker swatch; the print PDF (`file`) stays CMYK.
        return solidColorBackground(simpleBgColor, simpleBgWidthMm * MM, simpleBgHeightMm * MM)
      })
      .then((bg) => {
        if (cancelled || !bg) return
        setBackground(bg)
        // Populate a sample row for the preview, but only when empty so tweaking
        // the dimensions doesn't clobber text the user already entered.
        if (!sampleText) {
          const maxWidthPt = bg.widthPt * 0.9
          const word = randomWordFittingWidth(maxWidthPt, defaultWordStyle(0).fontSizePt)
          handleSampleTextChange(word)
        }
      })
      .catch((err) => {
        if (!cancelled) setBackgroundError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundSource, simpleBgWidthMm, simpleBgHeightMm, simpleBgColor])

  // Loading a source image resets the shared rotation and gives the target inputs
  // the image's proportions so the card matches it on load (the width is kept and
  // the height derived from the natural aspect).
  function handleGenBgImageChange(file: File | null) {
    setGenBgImageFile(file)
    setBgField('bgRotation', 0)
    setGenBgSvgTextWarning(false)
    if (!file) {
      setGenBgTransparent(false)
      return
    }
    if (isSvgFile(file)) {
      // Vector source: the aspect comes from the parsed viewBox/width/height
      // (createImageBitmap on SVG blobs is unreliable cross-browser). SVGs are
      // transparency-capable, so the checkerboard backdrop + backdrop color
      // control always apply; <text> content gets a warning (see the state doc).
      setGenBgTransparent(true)
      file
        .text()
        .then((text) => {
          const info = inspectSvg(text)
          setGenBgSvgTextWarning(info.hasText)
          if (info.aspect && info.aspect > 0) {
            setBgField('genBgHeightMm', Math.round((genBgWidthMm / info.aspect) * 100) / 100)
          }
        })
        .catch(() => {}) // a broken SVG surfaces via the conversion effect's error
      return
    }
    // `imageOrientation: 'from-image'` applies the JPEG's EXIF orientation so the
    // measured aspect matches the oriented image the generator bakes in (see
    // `build_image_background_pdf` / `apply_orientation` in src/generate/image_bg.rs).
    createImageBitmap(file, { imageOrientation: 'from-image' })
      .then((bmp) => {
        const a = bmp.width / bmp.height
        // Detect transparency while the bitmap is live (drives the preview's
        // checkerboard backdrop); orientation doesn't affect the alpha channel.
        const transparent = bitmapHasTransparency(bmp)
        if (typeof bmp.close === 'function') bmp.close()
        setGenBgTransparent(transparent)
        if (a > 0) setBgField('genBgHeightMm', Math.round((genBgWidthMm / a) * 100) / 100)
      })
      .catch(() => {})
  }

  // Fetch a remote PNG/JPEG (always through the server-side `IMAGE_PROXY` to
  // sidestep CORS) and feed it through the same pipeline as a local file. The
  // bytes are validated by magic number (not the server's content-type) and
  // wrapped in a File so `handleGenBgImageChange` drives the rest unchanged.
  async function handleGenBgUrlLoad() {
    const url = genBgImageUrl.trim()
    if (!url) return
    if (!IMAGE_PROXY) {
      setBackgroundError('Descărcarea după URL nu este configurată (lipsește proxy-ul de imagini).')
      return
    }
    setGenBgLoading(true)
    setBackgroundError(null)
    try {
      const resp = await fetch(IMAGE_PROXY + encodeURIComponent(url))
      if (!resp.ok) throw new Error(`Nu s-a putut descărca imaginea (HTTP ${resp.status}).`)
      const blob = await resp.blob()
      // SVG is text with no magic number, so it gets a prolog-aware sniff instead.
      const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer())
      const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
      const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
      const isSvg = !isPng && !isJpeg && looksLikeSvg(head)
      if (!isPng && !isJpeg && !isSvg) throw new Error('Doar imagini PNG, JPEG sau SVG sunt acceptate.')
      const type = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'image/svg+xml'
      const fallback = isPng ? 'fundal.png' : isJpeg ? 'fundal.jpg' : 'fundal.svg'
      const name = url.split('/').pop()?.split('?')[0] || fallback
      handleGenBgImageChange(new File([blob], name, { type }))
    } catch (err) {
      // Network failures (proxy down/unreachable) surface as a TypeError.
      setBackgroundError(
        err instanceof TypeError
          ? 'Nu s-a putut contacta proxy-ul de imagini.'
          : err instanceof Error ? err.message : String(err),
      )
      setGenBgImageFile(null)
    } finally {
      setGenBgLoading(false)
    }
  }

  // Turn a clipboard image blob into a PNG file and feed it through the shared raster
  // pipeline (same as an uploaded image) — except SVG, which stays text and goes down
  // the vector path instead of being rasterized. `null` blob → friendly error.
  async function loadClipboardImageBlob(blob: Blob | null) {
    if (!blob) {
      setBackgroundError('Clipboard-ul nu conține o imagine.')
      return
    }
    setGenBgLoading(true)
    setBackgroundError(null)
    try {
      const file = blob.type === 'image/svg+xml'
        ? new File([blob], 'fundal.svg', { type: 'image/svg+xml' })
        : await blobToPngFile(blob)
      handleGenBgImageChange(file)
    } catch (err) {
      setBackgroundError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenBgLoading(false)
    }
  }

  // "Lipește imaginea" button: read the clipboard via the async Clipboard API.
  async function handlePasteBackgroundFromButton() {
    await loadClipboardImageBlob(await readImageBlobFromClipboard())
  }

  // Ctrl/Cmd+V over the clipboard-source area: read the image from the paste event
  // (works where the async Clipboard API is unavailable).
  function handleBackgroundPaste(e: ReactClipboardEvent) {
    const blob = imageBlobFromDataTransfer(e.clipboardData)
    if (!blob) return // let non-image pastes fall through untouched
    e.preventDefault()
    void loadClipboardImageBlob(blob)
  }

  // Build a print background PDF from a raster image (PNG/JPEG) or an SVG
  // (converted to a vector PDF) whenever the "create background" source is
  // active and the image / dimensions change, feeding it through the same
  // `backgroundFile`/`background` pipeline as an uploaded PDF. Unlike the simple
  // source there's no shortcut swatch — the produced PDF is rasterised via
  // `renderPdfBackground` for the preview.
  useEffect(() => {
    if (backgroundSource !== 'generate' || !genBgImageFile) return
    let cancelled = false
    setGenBgLoading(true)
    setBackgroundError(null)
    ensureWasmInit()
      .then(async () => {
        let bytes: Uint8Array
        if (isSvgFile(genBgImageFile)) {
          // Vector source: flips and the backdrop color are baked into the SVG
          // text (a mirror <g> / an underlying <rect> — see prepareSvgForBackground),
          // then the lazily-loaded svg-wasm module converts it to a vector PDF at
          // the SVG's own size. Downstream is identical to the raster branch: the
          // target size / rotation are applied by the shared machinery.
          const svgText = await genBgImageFile.text()
          const prepared = prepareSvgForBackground(svgText, {
            flipX: bgFlipX,
            flipY: bgFlipY,
            backdropCss: genBgBackdropColor ? colorToCss(genBgBackdropColor) : null,
          })
          // Normalize conversion failures to the same user-facing message the
          // helper's pre-parse throws, keeping the raw usvg detail for diagnosis.
          bytes = await svgToPdf(prepared).catch((err) => {
            throw new Error(`Fișierul nu este un SVG valid. (${err instanceof Error ? err.message : String(err)})`)
          })
        } else {
          // Build the image PDF once at the image's own aspect (normalized width);
          // `genBgWidthMm/HeightMm` is the *target* card size (applied as a scale at
          // generation) and `bgRotation` the rotation — exactly like an uploaded PDF,
          // so both sources share the same rotate/scale/override machinery and the
          // build no longer rebuilds on dimension/rotation changes.
          // Match the generator's EXIF-oriented decode (see handleGenBgImageChange).
          const bmp = await createImageBitmap(genBgImageFile, { imageOrientation: 'from-image' })
          const aspect = bmp.width / bmp.height
          if (typeof bmp.close === 'function') bmp.close()
          const refW = 100
          const refH = aspect > 0 ? 100 / aspect : 100
          const imageBytes = new Uint8Array(await genBgImageFile.arrayBuffer())
          // Flip X/Y is baked into the image PDF so preview and output match. A chosen
          // backdrop color (converted to the #RRGGBB the generator parses, via the same
          // `colorToCss` the preview uses) fills transparent pixels in the exported PDF;
          // an empty string keeps the transparency (the generator embeds an /SMask).
          const backdrop = genBgBackdropColor ? colorToCss(genBgBackdropColor) : ''
          bytes = generate_image_background_pdf(imageBytes, refW, refH, bgFlipX, bgFlipY, backdrop)
        }
        if (cancelled) return null
        const file = new File([bytes.buffer as ArrayBuffer], 'fundal-imagine.pdf', { type: 'application/pdf' })
        setBackgroundFile(file)
        await ensureDefaultFont()
        return renderPdfBackground(file, 1, bgRotation)
      })
      .then((bg) => {
        if (cancelled || !bg) return
        setBackground(bg)
        setBackgroundPageCount(bg.pageCount)
        if (!sampleText) {
          const maxWidthPt = bg.widthPt * 0.9
          const word = randomWordFittingWidth(maxWidthPt, defaultWordStyle(0).fontSizePt)
          handleSampleTextChange(word)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setBackgroundError(err instanceof Error ? err.message : String(err))
          setBackground(null)
          setBackgroundFile(null)
        }
      })
      .finally(() => {
        if (!cancelled) setGenBgLoading(false)
      })
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundSource, genBgImageFile, bgFlipX, bgFlipY, genBgBackdropColor])

  // Default the code/text color to one that contrasts the simple background so
  // codes are visible. Stays in effect (also recoloring newly added words) only
  // until the user picks a text color, then leaves their choices untouched.
  useEffect(() => {
    if (backgroundSource !== 'simple' || !autoTextColor) return
    const target = contrastColor(simpleBgColor)
    // Syncing a derived default into word state; the equality guard prevents re-renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWords((prev) => (prev.every((w) => w.color === target) ? prev : prev.map((w) => ({ ...w, color: target }))))
  }, [backgroundSource, autoTextColor, simpleBgColor, words.length])

  // Render the contour preview as a crisp vector SVG image (so enlarging it doesn't
  // pixelate); fall back to the raster renderer for contours with no painted vector
  // geometry (image/text-only PDFs). Both return the same PdfBackground shape, so every
  // contour render site can share this.
  // `trim` (default = current toggle) trims the vector render to the artwork's box;
  // the raster fallback can't trim, so an image/text-only contour stays page-sized
  // (matching the backend, which also falls back to the page when nothing paints).
  function renderContourPreview(file: File, pageNumber = 1, rotation = 0, trim = contourTrimToPath): Promise<PdfBackground> {
    return renderContourVectorImage(file, pageNumber, rotation, trim)
      .then((vec) => vec ?? renderPdfBackground(file, pageNumber, rotation))
      .catch(() => renderPdfBackground(file, pageNumber, rotation))
  }

  function handleContourBackgroundFileChange(file: File | null) {
    setContourBackground(null)
    setContourBackgroundError(null)
    setContourSelected(false)
    setContourBackgroundFile(file)
    setContourField('contourPageNumber', 1)
    setContourPageCount(1)
    setContourPageAutoPicked(false)
    setContourField('contourTargetWidthMm', NaN)
    setContourField('contourTargetHeightMm', NaN)
    setContourField('contourRotation', 0)
    if (!file) return
    // When the contour reuses the same PDF as the background (Step 1), default to
    // a DIFFERENT page than the one chosen for the background: a multi-page PDF
    // usually carries the print design and the cut outline on separate pages.
    const sameAsBackground = backgroundFile != null && isSameFile(file, backgroundFile)
    const prefill = (bg: PdfBackground) => {
      setContourBackground(bg)
      setContourField('contourTargetWidthMm', bg.widthPt / MM)
      setContourField('contourTargetHeightMm', bg.heightPt / MM)
    }
    renderContourPreview(file)
      .then((bg) => {
        setContourPageCount(bg.pageCount)
        // Pick a page other than the background's: prefer the next page, fall back
        // to the previous one when the background is on the last page, and settle
        // for the background's own page when there's no other (single-page PDF).
        const contourPage = sameAsBackground ? pickDistinctPage(backgroundPageNumber, bg.pageCount) : 1
        if (sameAsBackground && contourPage !== 1) {
          setContourField('contourPageNumber', contourPage)
          setContourPageAutoPicked(true)
          return renderContourPreview(file, contourPage).then(prefill)
        }
        prefill(bg)
      })
      .catch((err) => setContourBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  // Re-render the contour preview from a different page of the uploaded PDF.
  // A new page may have a different MediaBox, so its dimensions are re-detected
  // (same as a fresh upload), keeping the current rotation.
  function handleContourPageChange(pageNumber: number) {
    if (!contourBackgroundFile) return
    const page = Math.min(Math.max(1, Math.round(pageNumber)), contourPageCount)
    setContourField('contourPageNumber', page)
    setContourPageAutoPicked(false)
    setContourBackgroundError(null)
    renderContourPreview(contourBackgroundFile, page, contourRotation)
      .then((bg) => {
        setContourBackground(bg)
        setContourField('contourTargetWidthMm', bg.widthPt / MM)
        setContourField('contourTargetHeightMm', bg.heightPt / MM)
      })
      .catch((err) => setContourBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  // Toggle "size by path vs. page": re-render the preview with the new trim and
  // re-detect the contour size from the result (the box snaps to the artwork or back
  // to the page). Resets any manual resize override, like a page change does.
  function handleContourTrimChange(trim: boolean) {
    setContourField('contourTrimToPath', trim)
    if (!contourBackgroundFile) return
    setContourBackgroundError(null)
    renderContourPreview(contourBackgroundFile, contourPageNumber, contourRotation, trim)
      .then((bg) => {
        setContourBackground(bg)
        setContourField('contourTargetWidthMm', bg.widthPt / MM)
        setContourField('contourTargetHeightMm', bg.heightPt / MM)
      })
      .catch((err) => setContourBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  // Rotate the uploaded contour by another 90° clockwise (cycling 0→90→180→270),
  // mirroring rotateBackground: re-render the preview rotated and transpose the
  // target dimensions so the contour box follows the new orientation.
  function rotateContour() {
    if (!contourBackgroundFile) return
    const next = (contourRotation + 90) % 360
    setContourField('contourRotation', next)
    const w = contourTargetWidthMm
    setContourField('contourTargetWidthMm', contourTargetHeightMm)
    setContourField('contourTargetHeightMm', w)
    setContourBackgroundError(null)
    // A preset shape's generation effect depends on contourRotation and re-renders
    // the rotated outline itself; only the uploaded file needs a manual re-render.
    if (contourSource === 'upload') {
      renderContourPreview(contourBackgroundFile, contourPageNumber, next)
        .then(setContourBackground)
        .catch((err) => setContourBackgroundError(err instanceof Error ? err.message : String(err)))
    }
  }

  function handleContourSourceChange(source: ContourSource) {
    setContourField('contourSource', source)
    setShapeError(null)
    setContourSelected(false)
    // Reset the resize/rotate overrides on every switch so the new source starts
    // from its own detected/card size (upload re-detects on load; the preset
    // shape re-prefills to the card size in its generation effect).
    setContourField('contourTargetWidthMm', NaN)
    setContourField('contourTargetHeightMm', NaN)
    setContourField('contourRotation', 0)
    setContourField('contourRedrawMm', 0)
    // A freshly selected preset shape starts full-card (auto-tracks the card).
    // Drop the remembered offset bounds so the new contour isn't rescaled
    // against the previous source's slack.
    contourShapeTargetAutoRef.current = true
    prevContourBoundsRef.current = null
    if (source === 'upload') {
      setContourBackground(null)
      setContourBackgroundFile(null)
      setContourBackgroundError(null)
      setContourField('contourPageNumber', 1)
      setContourPageCount(1)
    }
  }

  // Keep each word's fractional position within the contour box constant when the
  // card dimensions change: a word's stored position is remapped to the same
  // fraction of the reference box's new size. For a preset shape the reference is
  // the contour's tight bbox (the card inset on all sides), so a code placed
  // inside the cut shape keeps its spot inside the shape; otherwise the reference
  // is the full card. Horizontal auto-centering (`xMm === null`) and snapped
  // vertical alignment (`valign !== 'custom'`) are left to the align/valign
  // machinery, which already tracks the card size — so a word that was dead-centre
  // stays dead-centre across a resize. The first valid size only establishes the
  // baseline (no scaling on initial placement).
  const prevCardDimsRef = useRef<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const w = effectiveCardWidthMm
    const h = effectiveCardHeightMm
    const prev = prevCardDimsRef.current
    if (prev && prev.w > 0 && prev.h > 0 && w > 0 && h > 0 && (prev.w !== w || prev.h !== h)) {
      // Reference box: the contour's tight bbox for a preset shape, or the full
      // card otherwise. Remapping uses the box's origin AND size so a code keeps
      // its fraction within the shape — including a circle, whose box is capped to
      // `min(w, h)` and re-centred (so it doesn't grow along the longer axis).
      const useContour = contourSource === 'shape'
      const oldBox = useContour
        ? contourBoxMm(shapeKind, prev.w, prev.h)
        : { x: 0, y: 0, w: prev.w, h: prev.h }
      const newBox = useContour
        ? contourBoxMm(shapeKind, w, h)
        : { x: 0, y: 0, w, h }
      // Skip a degenerate box (zero-size card) to avoid divide-by-zero.
      if (oldBox.w > 0 && oldBox.h > 0 && newBox.w > 0 && newBox.h > 0) {
        const sx = newBox.w / oldBox.w
        const sy = newBox.h / oldBox.h
        setWords((words) => {
          let changed = false
          const next = words.map((word) => {
            const xMm = word.xMm !== null ? newBox.x + (word.xMm - oldBox.x) * sx : word.xMm
            const yMm = word.valign === 'custom' ? newBox.y + (word.yMm - oldBox.y) * sy : word.yMm
            if (xMm === word.xMm && yMm === word.yMm) return word
            changed = true
            return { ...word, xMm, yMm }
          })
          return changed ? next : words
        })
      }
    }
    prevCardDimsRef.current = w > 0 && h > 0 ? { w, h } : null
  }, [effectiveCardWidthMm, effectiveCardHeightMm, contourSource, shapeKind])

  // Whether a preset shape still fills the available space (auto-tracks the card
  // as the background is resized) vs. an explicit/frozen size (then preserved).
  const contourShapeTargetAutoRef = useRef(true)

  // Generate a preset-shape contour PDF in its own (design) frame, then let
  // `renderPdfBackground` re-apply `contourRotation`. `effectiveContour*` is the host box
  // (already swapped for 90/270), so swapping it back here recovers the design dims — the
  // shape is drawn true-size and the reorient rotates it onto the swapped host footprint.
  useEffect(() => {
    if (contourSource !== 'shape' || !background) return
    const rot = (((contourRotation % 360) + 360) % 360)
    const swapped = rot === 90 || rot === 270
    const genW = swapped ? effectiveContourHeightMm : effectiveContourWidthMm
    const genH = swapped ? effectiveContourWidthMm : effectiveContourHeightMm
    if (!(genW > 0) || !(genH > 0)) return
    let cancelled = false
    const strokeColor = '0:1:0:0'
    ensureWasmInit()
      .then(() => {
        const bytes = generate_shape_pdf(genW, genH, shapeKind, 0, shapeCornerRadiusMm, shapeCornerOrientation, strokeColor, Math.max(3, Math.round(polygonSides)), polygonStar)
        const file = new File([bytes.buffer as ArrayBuffer], `${shapeKind}.pdf`, { type: 'application/pdf' })
        if (cancelled) return null
        setContourBackgroundFile(file)
        return renderPdfBackground(file, 1, contourRotation)
      })
      .then((bg) => {
        if (!cancelled && bg) {
          setContourBackground(bg)
          setContourField('contourPageNumber', 1)
          setContourPageCount(1)
          setShapeError(null)
          // Default the contour size the first time; a later user resize is kept.
          // Circle → the inscribed min(w,h) square; polygon → its natural regular
          // bounding box; every other shape fills the available card.
          const box = shapeKind === 'polygon'
            ? polygonNaturalBoxMm(polygonSides, polygonStar, contourAvailWidthMm, contourAvailHeightMm)
            : contourBoxMm(shapeKind, contourAvailWidthMm, contourAvailHeightMm)
          setContourField('contourTargetWidthMm', (v) => (isFinite(v) && v > 0 ? v : box.w))
          setContourField('contourTargetHeightMm', (v) => (isFinite(v) && v > 0 ? v : box.h))
        }
      })
      .catch((err) => {
        if (!cancelled) setShapeError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [contourSource, shapeKind, shapeCornerRadiusMm, shapeCornerOrientation, polygonSides, polygonStar, contourRotation, background, backgroundSource, simpleBgColor, effectiveContourWidthMm, effectiveContourHeightMm, contourAvailWidthMm, contourAvailHeightMm])

  // Auto-track: while a shape auto-fits, keep its target equal to the shape's
  // tight box (min(w,h) square for a circle, the full card for shapes that fill
  // it) as the BACKGROUND is resized or the shape is switched.
  useEffect(() => {
    if (contourSource !== 'shape' || !background || !contourShapeTargetAutoRef.current) return
    const box = shapeKind === 'polygon'
      ? polygonNaturalBoxMm(polygonSides, polygonStar, effectiveCardWidthMm, effectiveCardHeightMm)
      : contourBoxMm(shapeKind, effectiveCardWidthMm, effectiveCardHeightMm)
    setContourField('contourTargetWidthMm', box.w)
    setContourField('contourTargetHeightMm', box.h)
  }, [contourSource, background, shapeKind, polygonSides, polygonStar, effectiveCardWidthMm, effectiveCardHeightMm])

  function setPageOption<K extends keyof PageOptions>(key: K, value: PageOptions[K]) {
    setPageOptions((prev) => ({ ...prev, [key]: value }))
  }

  function handleWordFontFileChange(index: number, file: File | null) {
    setFontsError(null)
    if (!file) {
      setFonts((prev) => prev.map((f, i) => (i === index ? null : f)))
      return
    }
    loadFontFile(file)
      .then((font) => setFonts((prev) => prev.map((f, i) => (i === index ? font : f))))
      .catch((err) => setFontsError(err instanceof Error ? err.message : String(err)))
  }

  function handleWordFontSourceChange(index: number, source: FontSource) {
    setFontsError(null)
    setFontSources((prev) => prev.map((s, i) => (i === index ? source : s)))
    setFonts((prev) => prev.map((f, i) => (i === index ? null : f)))
    if (source === 'google') {
      setGoogleFontSelections((prev) => prev.map((s, i) => (i === index ? null : s)))
    }
  }

  function handleWordGoogleFontChange(index: number, selection: GoogleFontSelection | null, font: LoadedFont | null) {
    setFontsError(null)
    setGoogleFontSelections((prev) => prev.map((s, i) => (i === index ? selection : s)))
    setFonts((prev) => prev.map((f, i) => (i === index ? font : f)))
  }

  // Splits `value` into per-word texts. Defaults to `effectiveSeparator` (the
  // sentinel for uploaded rows mirrored from the file); the manually editable
  // sample field passes the friendly `codeSeparator` so the user can type and
  // see ordinary separators.
  // `presplit` overrides the separator split with an exact field list — used for
  // uploaded rows so the word count matches the generator's separator-based
  // count (which keeps empty fields) instead of `splitWords` (which drops them).
  function handleSampleTextChange(value: string, separator: string = effectiveSeparator, presplit?: string[]) {
    setDataField('sampleText', value)
    const texts = presplit ?? splitWords(value, separator)
    setWords((prev) => resizeWords(prev, texts))
    setFonts((prev) => resizeFonts(prev, texts.length))
    setFontSources((prev) => resizeFontSources(prev, texts.length))
    setGoogleFontSelections((prev) => resizeGoogleFontSelections(prev, texts.length))
  }

  function handleCodeSeparatorChange(value: string) {
    setDataField('codeSeparator', value)
    // The split structure changes, so previously chosen merges no longer line up.
    setDataField('codeFieldMerges', [])
    if (codeDataMode === 'generate') {
      invalidateCsv()
    } else if (uploadedRawFile && value.length > 0) {
      // Manual override after auto-detection: re-parse the original file with
      // the corrected delimiter so fields split (and re-join) correctly.
      void ingestCsvFile(uploadedRawFile, value)
    }
  }

  function updateWord(index: number, next: Partial<WordStyle>) {
    setWords((prev) => prev.map((w, i) => {
      if (i !== index) return w
      const merged = { ...w, ...next }
      // Setting an explicit finite X (a horizontal drag or the "X (mm)" field) on a
      // contour-aligned word freezes it as a custom position: strip the `contour-*`
      // mode to its base so the horizontal re-snap effect stops overriding the value.
      if (next.xMm != null && Number.isFinite(next.xMm) && next.align === undefined && merged.align.startsWith('contour-')) {
        merged.align = baseAlign(merged.align)
      }
      return merged
    }))
  }

  const selected = selectedIndex !== null ? words[selectedIndex] : null

  // The "Fundal" and "Contur" steps each gate the rest of the wizard: the print
  // background must be set before the contour step unlocks, and the contour must
  // be set before the data step unlocks.
  const backgroundDone = background !== null
  const contourDone = contourBackground !== null
  const backgroundLockedHint = 'Configurează fundalul în pasul „Fundal” pentru a continua.'
  const contourLockedHint = 'Configurează conturul în pasul „Contur” pentru a continua.'

  // The "Date" step adds a further gate: the user must press "Generează CSV" so
  // the data source is fixed before the remaining steps unlock. The generated
  // CSV's object URL (only ever set by handleGenerateCsv) is the signal — a CSV
  // uploaded later in "Generare" doesn't count here.
  const dataSourceDone = codeCsvUrl !== null
  const dataSourceLockedHint = 'Apasă „Generează CSV” în pasul „Date” pentru a continua.'

  // Single hint surfaced on locked steps: whichever gate is currently blocking.
  const lockedHint = !backgroundDone
    ? backgroundLockedHint
    : !contourDone
      ? contourLockedHint
      : dataSourceLockedHint

  const needsPrintInput = mode === 'print' || mode === 'both'
  const needsContourInput = mode === 'contour' || mode === 'both'

  // The cutter reserves a registration-circle band around the sheet, so it can only
  // cut within the page minus one circle diameter on every edge (see
  // `CardLayout::compute`: available = host − 2·circle_d). The contour must fit that
  // "legit cutting size". Only meaningful in grid mode (no-cut sizes the page to the
  // card, no circles) when a cut is produced and its size is known.
  const cuttableWidthMm = pageOptions.hostWidthMm - 2 * pageOptions.circleDiameterMm
  const cuttableHeightMm = pageOptions.hostHeightMm - 2 * pageOptions.circleDiameterMm
  // The contour's real host-oriented footprint (the 90° reorient and the free spin are
  // both folded into `footprintWidth/HeightMm`), so the cut-zone check uses the true
  // extent rather than the un-rotated box.
  const contourFitWidthMm = footprintWidthMm
  const contourFitHeightMm = footprintHeightMm
  const cutExceedsSheet =
    needsContourInput &&
    !pageOptions.noCut &&
    pageOptions.circleDiameterMm > 0 &&
    effectiveContourWidthMm > 0 &&
    effectiveContourHeightMm > 0 &&
    (cuttableWidthMm <= 0 ||
      cuttableHeightMm <= 0 ||
      contourFitWidthMm > cuttableWidthMm + 1e-6 ||
      contourFitHeightMm > cuttableHeightMm + 1e-6)

  // A plain rectangle contour tiles edge-to-edge: neighbouring cards share a single
  // cut line, so a zero "Decalaj X/Y" (tiling gutter) is fine. Every other contour —
  // rounded/beveled/heart/circle shapes, or an uploaded contour of unknown shape —
  // needs a real gap between cards; below ~1 mm the individual cut outlines touch or
  // overlap, so the cutter double-cuts the same material and can tear the stock.
  // Keyed to the configured contour (its shape/source), not the print/contour/both
  // `mode`: the double-cut risk exists whenever that contour is cut, and `mode`
  // defaults to 'print', which would otherwise hide the warning in the common case.
  // `contourBackground` is non-null once a shape or an uploaded contour is available.
  const contourIsPlainRectangle = contourSource === 'shape' && shapeKind === 'rectangle'
  const cutGapTooSmall =
    contourBackground != null &&
    !pageOptions.noCut &&
    !contourIsPlainRectangle &&
    (pageOptions.offsetXMm < 1 || pageOptions.offsetYMm < 1)

  // The page fields are the media (sheet) size. The print background is one card
  // tiled onto that sheet, so a single card must fit within the media. (Printing can
  // use the whole sheet — only cutting reserves the circle band, handled above. In
  // no-cut mode the page is sized to the card, and in minimal the page is cropped to
  // the contour, so neither constrains the card against a fixed media.)
  const bgExceedsSheet =
    needsPrintInput &&
    !pageOptions.noCut &&
    !pageOptions.minimal &&
    effectiveCardWidthMm > 0 &&
    effectiveCardHeightMm > 0 &&
    (effectiveCardWidthMm > pageOptions.hostWidthMm + 1e-6 ||
      effectiveCardHeightMm > pageOptions.hostHeightMm + 1e-6)

  async function handleGenerate() {
    if (needsPrintInput && !backgroundFile) {
      setGenError('Este necesar un PDF de fundal pentru print.')
      return
    }
    if (needsContourInput && !contourBackgroundFile) {
      setGenError('Este necesar un PDF de fundal pentru contur.')
      return
    }
    if (!csvDataFile) {
      setGenError('Este necesar un fișier CSV cu date.')
      return
    }

    const fontResult = resolveFontFiles(fonts)
    if ('error' in fontResult) {
      setGenError(fontResult.error)
      return
    }

    setGenLoading(true)
    setGenError(null)
    setGenProgress(null)
    setPrintArtifact(null)
    setContourResult(null)
    // Drop any one-card proof so the full run's results don't sit next to a stale one.
    setSampleArtifact(null)
    try {
      const bgWidthOverride = isFinite(cardTargetWidthMm) && cardTargetWidthMm > 0 ? cardTargetWidthMm : null
      const bgHeightOverride = isFinite(cardTargetHeightMm) && cardTargetHeightMm > 0 ? cardTargetHeightMm : null
      // Only the uploaded PDF flips at output time; the generated-image source
      // already bakes the flip into its PDF, so passing it here would double-flip.
      const bgOutFlipX = backgroundSource === 'upload' ? bgFlipX : false
      const bgOutFlipY = backgroundSource === 'upload' ? bgFlipY : false
      // Contour resize/rotate (uploaded PDF or preset shape alike). For the
      // standalone cut the contour PDF *is* the background, so these feed
      // cardWidth/Height + backgroundRotation; for the combine overlay they ride
      // the dedicated contour* options so `build_overlay` applies the same transform.
      // The contour PDF is generated at the effective (margin-clamped, true) size
      // for shapes, so the override = that size → scale 1; uploads still scale to
      // their target. Either way the override is the effective contour size.
      // With "Redesenează" active the contour is the offset outline (a freshly
      // generated cut PDF), so every contour input below reads the `active*` values.
      const contourWidthOverride = activeContourWidthMm > 0 ? activeContourWidthMm : null
      const contourHeightOverride = activeContourHeightMm > 0 ? activeContourHeightMm : null
      // "Combină paginile" (combine) overlays the contour onto the print pages as
      // a view-only (non-printing) layer. It is irrelevant in no-cut mode (the
      // checkbox is hidden there), so gate it on `!noCut`. Require a loaded contour:
      // the overlay needs the contour bytes (and `build_overlay` errors without
      // them), so this also keeps a stale combine flag from failing generation.
      const combine = pageOptions.combine === true && !pageOptions.noCut && activeContourFile != null
      // "Minimal": crop the print page/cells down to the contour box. Needs a loaded
      // contour (its effective size is the crop window); a no-op otherwise.
      const minimal = pageOptions.minimal === true && activeContourFile != null
      // Page picks from multi-page uploads. The print background uses
      // `backgroundPageNumber`; for the combine overlay the contour PDF's page is
      // also sent on the print options. The contour job loads the contour PDF as
      // its background, so its page is passed there as `backgroundPageNumber`.
      // Contour offset (clamped to keep the contour inside the background). When
      // a nonzero offset is set, send the background card size as the contour
      // "canvas" so the no-cut cut page is sized to the background (a smaller,
      // offset contour then cuts in the right place); otherwise leave it so the
      // contour keeps its own page size (unchanged behaviour).
      // The cut's drawing unit is the spun *footprint* (Rust re-origins a spun contour
      // to it), so the cut and the overlay place by the footprint origin — identical
      // to the box offset at 0° spin.
      const contourOffsetActive = contourFootprintLeftMm !== 0 || contourFootprintBottomMm !== 0
      const contourCanvasWMm = contourOffsetActive ? effectiveCardWidthMm : undefined
      const contourCanvasHMm = contourOffsetActive ? effectiveCardHeightMm : undefined
      // Minimal sends the contour offset (the crop origin) and the contour window even
      // without combine; the window is the last two args. The window and its origin are
      // the contour's *display footprint* (rotation + spin folded in), so the crop
      // envelops the actually-drawn contour rather than the un-spun box; the combine
      // overlay places by the same footprint origin (in minimal mode Rust puts it at
      // bleed/2 instead).
      const cropOriginXMm = (combine || minimal) ? contourFootprintLeftMm : undefined
      const cropOriginYMm = (combine || minimal) ? contourFootprintBottomMm : undefined
      const printOptions = needsPrintInput
        ? buildJsOptions(words, effectiveSeparator, safeMarginMm, backgroundPaddingMm, { ...pageOptions, combine }, false, bgWidthOverride, bgHeightOverride, backgroundPageNumber, combine ? activeContourPageNumber : undefined, cropOriginXMm, cropOriginYMm, undefined, undefined, bgRotation, combine ? contourWidthOverride : undefined, combine ? contourHeightOverride : undefined, combine ? activeContourRotation : undefined, minimal ? footprintWidthMm : undefined, minimal ? footprintHeightMm : undefined, activeContourTrimToPath, contourKeepRegion, correctOverflow, minFontSizePt, overflowCorrectionMode === 'column', contourInsetMm, bgOutFlipX, bgOutFlipY, bgOffsetXMm, bgOffsetYMm, bgBackdropColor ? colorToCss(bgBackdropColor) : '', contourAlignRect?.leftMm ?? null, contourAlignRect?.widthMm ?? null, bgSpinDeg, combine ? activeContourSpinDeg : undefined, combine ? footprintLeft0Mm : undefined, combine ? footprintBottom0Mm : undefined, combine ? footprintWidthMm : undefined, combine ? footprintHeightMm : undefined)
        : null
      // A rectangle contour normally draws as optimized spanning grid lines; "Contur
      // Dreptunghi" forces plain tiled rectangles instead. The redrawn (offset) contour
      // is an arbitrary polygon PDF, never the grid; a spun rectangle can't be spanning
      // lines either, so any spin also forces real tiled rectangles.
      const contourIsGrid = contourSource === 'shape' && shapeKind === 'rectangle' && !rectangleContour && !contourRedrawActive && activeContourSpinDeg === 0
      // In minimal mode the cut page is the contour's own footprint at origin (matching
      // the cropped print page), so drop the background canvas and zero the offset.
      const cutOffsetXMm = minimal ? 0 : contourFootprintLeftMm
      const cutOffsetYMm = minimal ? 0 : contourFootprintBottomMm
      const cutCanvasWMm = minimal ? undefined : contourCanvasWMm
      const cutCanvasHMm = minimal ? undefined : contourCanvasHMm
      const contourOptions = needsContourInput
        // The contour job loads the contour PDF as its background, so its page is
        // the 9th arg (backgroundPageNumber) and its resize/rotate ride the
        // background slots: cardWidth/Height (7th/8th) and backgroundRotation
        // (15th). The 10th (contourPageNumber, only for the combine overlay) is
        // unused here — undefined so the offset/canvas args land in their slots.
        ? { ...buildJsOptions(words, effectiveSeparator, safeMarginMm, backgroundPaddingMm, pageOptions, true, contourWidthOverride, contourHeightOverride, activeContourPageNumber, undefined, cutOffsetXMm, cutOffsetYMm, cutCanvasWMm, cutCanvasHMm, activeContourRotation, undefined, undefined, undefined, undefined, undefined, activeContourTrimToPath, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, activeContourSpinDeg, undefined, footprintLeft0Mm, footprintBottom0Mm, footprintWidthMm, footprintHeightMm), ...(contourIsGrid ? { contourAsGrid: true } : {}) }
        : null

      const background = needsPrintInput ? await backgroundFile!.arrayBuffer() : new ArrayBuffer(0)
      const contour =
        (needsContourInput || combine) && activeContourFile ? await activeContourFile.arrayBuffer() : null
      const fontBufs = await Promise.all(fontResult.files.map((f) => f.arrayBuffer()))
      const mode: 'print' | 'contour' | 'both' =
        needsPrintInput && needsContourInput ? 'both' : needsPrintInput ? 'print' : 'contour'

      // Effective row count of the data source feeding the job: the uploaded
      // CSV's rows in upload mode, the generated row count otherwise. Drives the
      // progress total and the ZIP-size estimate that gates OPFS streaming.
      const effectiveRowCount = codeDataMode === 'upload' ? uploadedCsvRowCount : codeRowCount

      const handle = generateBatched(
        {
          mode,
          background,
          contour,
          fonts: fontBufs,
          printOptions,
          contourOptions,
          // "Pe coloană" needs the whole dataset in one pass so the uniform per-column
          // size is consistent across every card (a per-batch size would differ between
          // batches); generate it as a single batch. Per-code correction and the
          // no-correction path keep normal row-batching.
          pagesPerBatch: correctOverflow && overflowCorrectionMode === 'column' ? Number.MAX_SAFE_INTEGER : PAGES_PER_BATCH,
          totalRows: effectiveRowCount > 0 ? effectiveRowCount : null,
          csv: csvDataFile,
        },
        setGenProgress,
      )
      cancelGenRef.current = handle.cancel
      const result = await handle.promise
      setPrintArtifact(result.print)
      setContourResult(result.contour)
    } catch (err) {
      // A user cancellation is not an error.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setGenError(err instanceof Error ? err.message : String(err))
      }
      setPrintArtifact(null)
      setContourResult(null)
    } finally {
      setGenLoading(false)
      setGenProgress(null)
      cancelGenRef.current = null
    }
  }

  // Generate a single sample card ("Mostră") with the contour over it — a quick
  // proof of how one code renders, without producing the whole batch. Runs on the
  // main thread via the same WASM entry point as the worker, forcing a single
  // no-cut card and the (view-only) combine overlay when a contour is loaded.
  async function handleGenerateSample() {
    if (!backgroundFile) {
      setGenError('Este necesar un PDF de fundal pentru print.')
      return
    }
    const fontResult = resolveFontFiles(fonts)
    if ('error' in fontResult) {
      setGenError(fontResult.error)
      return
    }

    setSampleLoading(true)
    setGenError(null)
    try {
      // One data row, independent of the full "Generează CSV" run: a fresh first
      // code in generate mode, or the first line of the uploaded CSV.
      let row: string
      if (codeDataMode === 'upload') {
        if (!csvDataFile) {
          setGenError('Încarcă un fișier CSV cu date.')
          return
        }
        row = (await csvDataFile.text()).split('\n').find((l) => l.trim().length > 0) ?? ''
      } else {
        row = generateCsvPreview(1, codeColumns, codeSeparator).split('\n')[0] ?? ''
      }

      const bgWidthOverride = isFinite(cardTargetWidthMm) && cardTargetWidthMm > 0 ? cardTargetWidthMm : null
      const bgHeightOverride = isFinite(cardTargetHeightMm) && cardTargetHeightMm > 0 ? cardTargetHeightMm : null
      const sampleCombine = activeContourFile != null
      // The contour PDF is generated at the effective (margin-clamped, true) size
      // for shapes, so the override = that size → scale 1; uploads still scale to
      // their target. With "Redesenează" active the override is the offset contour.
      const contourWidthOverride = activeContourWidthMm > 0 ? activeContourWidthMm : null
      const contourHeightOverride = activeContourHeightMm > 0 ? activeContourHeightMm : null
      // Force a single isolated card (no-cut) with the contour overlaid.
      const samplePageOptions = { ...pageOptions, noCut: true, combine: sampleCombine }
      // Mirror Minimal so the proof reflects the cropped output (the contour offset is
      // already sent for the overlay; add the contour box as the crop window).
      const sampleMinimal = pageOptions.minimal === true && activeContourFile != null
      const printOptions = buildJsOptions(
        words, effectiveSeparator, safeMarginMm, backgroundPaddingMm, samplePageOptions, false,
        bgWidthOverride, bgHeightOverride, backgroundPageNumber,
        sampleCombine ? activeContourPageNumber : undefined,
        // The overlay and the minimal crop both place by the contour's footprint
        // origin (= the box offset at 0° spin); see the batch flow above.
        (sampleCombine || sampleMinimal) ? contourFootprintLeftMm : undefined,
        (sampleCombine || sampleMinimal) ? contourFootprintBottomMm : undefined,
        undefined, undefined, bgRotation,
        sampleCombine ? contourWidthOverride : undefined,
        sampleCombine ? contourHeightOverride : undefined,
        sampleCombine ? activeContourRotation : undefined,
        sampleMinimal ? footprintWidthMm : undefined,
        sampleMinimal ? footprintHeightMm : undefined,
        activeContourTrimToPath,
        contourKeepRegion,
        correctOverflow,
        minFontSizePt,
        overflowCorrectionMode === 'column',
        contourInsetMm,
        backgroundSource === 'upload' ? bgFlipX : false,
        backgroundSource === 'upload' ? bgFlipY : false,
        bgOffsetXMm, bgOffsetYMm,
        bgBackdropColor ? colorToCss(bgBackdropColor) : '',
        contourAlignRect?.leftMm ?? null, contourAlignRect?.widthMm ?? null,
        bgSpinDeg, sampleCombine ? activeContourSpinDeg : undefined,
        sampleCombine ? footprintLeft0Mm : undefined,
        sampleCombine ? footprintBottom0Mm : undefined,
        sampleCombine ? footprintWidthMm : undefined,
        sampleCombine ? footprintHeightMm : undefined,
      )

      await ensureWasmInit()
      const bgBytes = new Uint8Array(await backgroundFile.arrayBuffer())
      const contourBytes = sampleCombine ? new Uint8Array(await activeContourFile!.arrayBuffer()) : undefined
      const fontBytes = await Promise.all(fontResult.files.map(async (f) => new Uint8Array(await f.arrayBuffer())))

      const out = generate_with_options(row, bgBytes, contourBytes, fontBytes, printOptions)
      const pdf = out.pdf.slice()
      out.free()
      setSampleArtifact({ blob: new Blob([pdf], { type: 'application/pdf' }) })
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err))
    } finally {
      setSampleLoading(false)
    }
  }

  // Eyedropper: when a ColorField requests a sample, arm a one-shot pointer
  // capture over the preview. The next click on the preview reads that pixel of
  // the background image (a same-origin data URL, so getImageData is allowed)
  // and resolves the stored color; Esc or a click off the preview cancels.
  // Capturing on `window` pre-empts word dragging and the picker's outside-click
  // close. Works in every browser — no EyeDropper API needed.
  const previewRef = useRef<HTMLDivElement>(null)
  const [colorSamplingActive, setColorSamplingActive] = useState(false)
  // Display-only magnification of the preview (1 = fit-to-panel). Applied as the
  // wrapper width so the `w-full` CardCanvas SVG follows it; dragging and color
  // sampling read the SVG's live size, so no coordinate math depends on this.
  const [previewZoom, setPreviewZoom] = useState(1)
  const zoomInPreview = () => setPreviewZoom((z) => Math.min(PREVIEW_ZOOM_MAX, Math.round(z * PREVIEW_ZOOM_STEP * 100) / 100))
  const zoomOutPreview = () => setPreviewZoom((z) => Math.max(PREVIEW_ZOOM_MIN, Math.round((z / PREVIEW_ZOOM_STEP) * 100) / 100))
  // "Screenshot": rasterize the live preview SVG to a PNG and copy it to the clipboard,
  // falling back to a download when the browser refuses clipboard image-writes. The
  // transient status drives brief button feedback.
  type ScreenshotStatus = 'idle' | 'busy' | 'copied' | 'downloaded' | 'error'
  const [screenshotStatus, setScreenshotStatus] = useState<ScreenshotStatus>('idle')
  // "Conturat": capture only the print + codes cut to the contour shape, as a
  // transparent PNG. A capture-time modifier, so it lives outside the Preset.
  const [contourCutout, setContourCutout] = useState(false)
  const hasContour = contourBackground != null
  const captureCutout = contourCutout && hasContour
  // "Descarcă": force the capture to download a file instead of copying to the
  // clipboard. Also a capture-time modifier, so it stays out of the Preset.
  const [captureDownload, setCaptureDownload] = useState(false)
  async function handleScreenshot() {
    const svg = previewRef.current?.querySelector('svg')
    if (!svg) return
    setScreenshotStatus('busy')
    try {
      // Gather bytes for every font family the preview actually uses: the default for
      // words without a custom font, plus each uploaded font in play.
      const families = new Map<string, ArrayBuffer>()
      for (let i = 0; i < words.length; i++) {
        const family = fontFamilyForWord(fonts, i)
        if (families.has(family)) continue
        if (family === DEFAULT_FONT_FAMILY) {
          families.set(family, await getDefaultFontBytes())
        } else {
          const lf = fonts.find((f): f is LoadedFont => f !== null && f.family === family)
          if (lf) families.set(family, await lf.file.arrayBuffer())
        }
      }
      const css = buildFontFaceCss([...families].map(([family, bytes]) => ({ family, bytes })))
      const blob = await rasterizePreview(svg as SVGSVGElement, css, undefined, captureCutout)
      const filename = captureCutout ? 'previzualizare-contur.png' : 'previzualizare.png'
      // "Descarcă" forces a download; otherwise copy to the clipboard and only fall
      // back to a download when the browser can't.
      const copied = captureDownload ? false : await copyBlobToClipboard(blob)
      if (!copied) downloadBlob(blob, filename)
      setScreenshotStatus(copied ? 'copied' : 'downloaded')
    } catch {
      setScreenshotStatus('error')
    }
  }
  // Clear the transient screenshot feedback after a moment.
  useEffect(() => {
    if (screenshotStatus === 'idle' || screenshotStatus === 'busy') return
    const t = setTimeout(() => setScreenshotStatus('idle'), 2000)
    return () => clearTimeout(t)
  }, [screenshotStatus])
  // Drag-to-pan the zoomed preview by scrolling its viewport. Mouse-only — touch
  // and trackpad keep their native scrolling. Word drags stop propagation, so
  // this only fires for pointer-downs on the background (never hijacks a word).
  const previewScrollRef = useRef<HTMLDivElement>(null)
  function handlePreviewPanStart(e: ReactPointerEvent<HTMLDivElement>) {
    const el = previewScrollRef.current
    if (!el || colorSamplingActive) return
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    if (previewZoom <= 1) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startLeft = el.scrollLeft
    const startTop = el.scrollTop
    el.setPointerCapture(e.pointerId)
    el.style.cursor = 'grabbing'
    const onMove = (ev: PointerEvent) => {
      el.scrollLeft = startLeft - (ev.clientX - startX)
      el.scrollTop = startTop - (ev.clientY - startY)
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.releasePointerCapture(ev.pointerId)
      el.style.cursor = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  async function requestColorSample(): Promise<string | null> {
    if (!background || !previewRef.current?.querySelector('svg')) return null
    // Rasterize the background up front so the click samples synchronously.
    let canvas: HTMLCanvasElement
    try {
      canvas = await imageUrlToCanvas(background.imageUrl)
    } catch {
      return null
    }
    return new Promise<string | null>((resolve) => {
      let settled = false
      function finish(result: string | null) {
        if (settled) return
        settled = true
        window.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('keydown', onKeyDown, true)
        setColorSamplingActive(false)
        resolve(result)
      }
      function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') finish(null)
      }
      function onPointerDown(e: PointerEvent) {
        const svg = previewRef.current?.querySelector('svg')
        const rect = svg?.getBoundingClientRect()
        const fx = rect ? (e.clientX - rect.left) / rect.width : -1
        const fy = rect ? (e.clientY - rect.top) / rect.height : -1
        if (fx < 0 || fx > 1 || fy < 0 || fy > 1) {
          finish(null) // clicked off the preview → cancel
          return
        }
        // Claim the click so it can't drag a word or dismiss the picker.
        e.preventDefault()
        e.stopPropagation()
        finish(sampleCanvasColorAt(canvas, fx, fy))
      }
      setColorSamplingActive(true)
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('keydown', onKeyDown, true)
    })
  }

  return (
    <ColorSampleContext.Provider value={background ? requestColorSample : null}>
    <div className="mx-auto max-w-6xl px-4 py-8 dark:bg-gray-950 dark:text-gray-100">
      <div className="mb-1 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Printare coduri unice / Decupare pe contur</h1>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {theme === 'dark' ? 'Mod luminos' : 'Mod întunecat'}
        </button>
      </div>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        Previzualizează poziționarea codurilor pe un fundal și generează PDF-uri de print și contur.
      </p>

      <Section title="Setări" collapsible defaultCollapsed>
        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={handleSavePreset}
            className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Salvează setările (.zip)
          </button>
          <FileField
            label="Încarcă setări (.zip sau .json)"
            accept=".zip,application/zip,application/json,.json"
            onChange={(files) => handleLoadPresetFile(files?.[0] ?? null)}
          />
        </div>
        {presetError && <p className="text-sm text-red-600 dark:text-red-400">{presetError}</p>}
      </Section>

      <div className="my-4">
        <WizardNav
          steps={WIZARD_STEPS}
          current={step}
          onSelect={(id) => setStep(id as WizardStepId)}
          isEnabled={(s) =>
            s.id === 'fundal'
              ? true
              : s.id === 'contur'
                ? backgroundDone
                : s.id === 'date'
                  ? backgroundDone && contourDone
                  : backgroundDone && contourDone && dataSourceDone
          }
          lockedHint={lockedHint}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {step === 'fundal' && (
          <Section title="Fundal">
            <RadioGroupField<BackgroundSource>
              label="Sursă fundal print"
              value={backgroundSource}
              onChange={handleBackgroundSourceChange}
              options={[
                { value: 'upload', label: 'Încarcă PDF' },
                { value: 'simple', label: 'Fundal simplu' },
                { value: 'generate', label: 'Fundal imagine' },
              ]}
            />
            {backgroundSource === 'upload' ? (
              // File input and its page picker are tightly related: keep them on
              // one row (the file grows, the page field stays narrow) and only let
              // them wrap when the row genuinely can't fit.
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <FileField
                    label="PDF de fundal (un card)"
                    accept="application/pdf"
                    onChange={(files) => handleBackgroundFileChange(files?.[0] ?? null)}
                    currentName={backgroundFile?.name}
                  />
                </div>
                {backgroundPageCount > 1 && (
                  <div className="w-28 shrink-0">
                    <NumberField
                      label={`Pagina (1–${backgroundPageCount})`}
                      value={backgroundPageNumber}
                      onChange={handleBackgroundPageChange}
                    />
                  </div>
                )}
              </div>
            ) : backgroundSource === 'simple' ? (
              <>
                <LinkedDimensions
                  widthLabel="Lățime (mm)"
                  heightLabel="Înălțime (mm)"
                  width={simpleBgWidthMm}
                  height={simpleBgHeightMm}
                  onWidth={(v) => setBgField('simpleBgWidthMm', v)}
                  onHeight={(v) => setBgField('simpleBgHeightMm', v)}
                  // No source artwork — lock keeps the ratio currently set.
                  aspect={simpleBgWidthMm / simpleBgHeightMm}
                  locked={lockAspect}
                  onToggleLock={() => setLockAspect((v) => !v)}
                />
                <ColorField
                  label="Culoare fundal (opțional)"
                  value={simpleBgColor}
                  onChange={(v) => setBgField('simpleBgColor', v)}
                  allowNone
                  noneLabel="fără culoare"
                />
              </>
            ) : (
              <>
                <RadioGroupField<GenBgImageSource>
                  label="Sursă imagine"
                  value={genBgImageSource}
                  onChange={(v) => setBgField('genBgImageSource', v)}
                  options={[
                    { value: 'file', label: 'Fișier local' },
                    { value: 'url', label: 'URL' },
                    { value: 'clipboard', label: 'Clipboard' },
                  ]}
                />
                {genBgImageSource === 'file' ? (
                  <FileField
                    label="Imagine fundal (PNG, JPEG sau SVG)"
                    accept="image/png,image/jpeg,image/svg+xml,.svg"
                    onChange={(files) => handleGenBgImageChange(files?.[0] ?? null)}
                    currentName={genBgImageFile?.name}
                  />
                ) : genBgImageSource === 'url' ? (
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <TextField
                        label="URL imagine (PNG, JPEG sau SVG)"
                        value={genBgImageUrl}
                        onChange={(v) => setBgField('genBgImageUrl', v)}
                        placeholder="https://exemplu.ro/imagine.png"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleGenBgUrlLoad}
                      disabled={genBgLoading}
                      className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Încarcă
                    </button>
                  </div>
                ) : (
                  <div
                    onPaste={handleBackgroundPaste}
                    tabIndex={0}
                    className="flex flex-col gap-2 rounded border border-dashed border-gray-300 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-600"
                  >
                    <button
                      type="button"
                      onClick={handlePasteBackgroundFromButton}
                      disabled={genBgLoading}
                      className="self-start rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      📋 Lipește imaginea
                    </button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Apasă butonul sau Ctrl+V pentru a lipi o imagine (PNG/JPEG/SVG) din clipboard.
                    </p>
                  </div>
                )}
                {background && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Imaginea este întinsă pentru a umple cardul la dimensiunile țintă de mai jos.
                  </p>
                )}
                {genBgSvgTextWarning && (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Textul din SVG nu este suportat — convertește textul în contururi (outline) înainte de încărcare.
                  </p>
                )}
                {genBgLoading && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Se generează fundalul…</p>
                )}
              </>
            )}
            {backgroundError && <p className="text-sm text-red-600 dark:text-red-400">{backgroundError}</p>}
            {backgroundSource === 'upload' && background && (
              <>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm dark:border-sky-800 dark:bg-sky-950/40">
                  <span className="text-xs font-medium uppercase tracking-wide text-sky-500 dark:text-sky-500">Dimensiuni detectate</span>
                  <span className="font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                    {(background.widthPt / MM).toFixed(1)} × {(background.heightPt / MM).toFixed(1)} mm
                  </span>
                  <span className="text-xs text-sky-500 dark:text-sky-600">
                    ({background.widthPt.toFixed(0)} × {background.heightPt.toFixed(0)} pt)
                  </span>
                </div>
                <LinkedDimensions
                  widthLabel="Lățime țintă (mm)"
                  heightLabel="Înălțime țintă (mm)"
                  width={bgTargetWidthMm}
                  height={bgTargetHeightMm}
                  onWidth={(v) => setBgField('bgTargetWidthMm', v)}
                  onHeight={(v) => setBgField('bgTargetHeightMm', v)}
                  // Live target ratio (starts at the PDF's detected ratio) so the
                  // lock follows the orientation after a swap or rotation.
                  aspect={bgTargetWidthMm / bgTargetHeightMm}
                  locked={lockAspect}
                  onToggleLock={() => setLockAspect((v) => !v)}
                  onSwap={() => {
                    const w = bgTargetWidthMm
                    setBgField('bgTargetWidthMm', bgTargetHeightMm)
                    setBgField('bgTargetHeightMm', w)
                  }}
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    onClick={rotateBackground}
                    title="Rotește fundalul cu 90° (portret ⇄ peisaj)"
                    className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    ↻ Rotește 90°
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">Rotație: {bgRotation}°</span>
                  <CheckboxField label="Oglindire X" checked={bgFlipX} onChange={(v) => flipUploadBackground('x', v)} />
                  <CheckboxField label="Oglindire Y" checked={bgFlipY} onChange={(v) => flipUploadBackground('y', v)} />
                </div>
              </>
            )}
            {backgroundSource === 'generate' && background && (
              <>
                <LinkedDimensions
                  widthLabel="Lățime țintă (mm)"
                  heightLabel="Înălțime țintă (mm)"
                  width={genBgWidthMm}
                  height={genBgHeightMm}
                  onWidth={(v) => setBgField('genBgWidthMm', v)}
                  onHeight={(v) => setBgField('genBgHeightMm', v)}
                  // Live target ratio (starts at the image's aspect) so the lock
                  // follows the orientation after a swap or rotation.
                  aspect={genBgWidthMm / genBgHeightMm}
                  locked={lockAspect}
                  onToggleLock={() => setLockAspect((v) => !v)}
                  onSwap={() => {
                    const w = genBgWidthMm
                    setBgField('genBgWidthMm', genBgHeightMm)
                    setBgField('genBgHeightMm', w)
                  }}
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    onClick={rotateBackground}
                    title="Rotește imaginea cu 90° (portret ⇄ peisaj)"
                    className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    ↻ Rotește 90°
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">Rotație: {bgRotation}°</span>
                  <CheckboxField label="Oglindire X" checked={bgFlipX} onChange={(v) => setBgField('bgFlipX', v)} />
                  <CheckboxField label="Oglindire Y" checked={bgFlipY} onChange={(v) => setBgField('bgFlipY', v)} />
                </div>
                {genBgTransparent && (
                  <>
                    <ColorField
                      label="Fundal zone transparente"
                      value={genBgBackdropColor}
                      onChange={setGenBgBackdropColor}
                      allowNone
                      noneLabel="carouri (transparent)"
                      hideWhenNull
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Culoarea aleasă umple zonele transparente în PDF-ul exportat; „carouri” păstrează transparența.
                    </p>
                  </>
                )}
              </>
            )}
            {background && (
              <div className="flex flex-col gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Poziționare fundal</span>
                  <CheckboxField label="Mută fundalul" checked={bgNudgeMode} onChange={setBgNudgeMode} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Decalaj fundal X (mm)" value={bgOffsetXMm} onChange={(v) => handleBackgroundOffsetChange(v, bgOffsetYMm)} />
                  <NumberField label="Decalaj fundal Y (mm)" value={bgOffsetYMm} onChange={(v) => handleBackgroundOffsetChange(bgOffsetXMm, v)} />
                </div>
                <NumberField label="Rotație fundal (grade)" value={bgSpinDeg} onChange={(v) => setBgField('bgSpinDeg', v)} step={1} />
                <ColorField
                  label="Culoare zone libere"
                  value={bgBackdropColor}
                  onChange={(v) => setBgField('bgBackdropColor', v)}
                  allowNone
                  noneLabel="transparent"
                  hideWhenNull
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Deplasează fundalul în cadrul cardului; zonele rămase libere sunt transparente (sau umplute cu culoarea aleasă mai sus). Activează „Mută fundalul” pentru a trage direct în previzualizare.
                </p>
              </div>
            )}
          </Section>
          )}

          {step === 'contur' && (
          <Section title="Contur">
            <RadioGroupField<ContourSource>
              label="Sursă fundal contur"
              value={contourSource}
              onChange={handleContourSourceChange}
              options={[
                { value: 'upload', label: 'Încarcă PDF' },
                { value: 'shape', label: 'Formă presetată' },
              ]}
            />

            {contourSource === 'upload' ? (
              <>
                <FileField
                  label="PDF de fundal contur (opțional)"
                  accept="application/pdf"
                  onChange={(files) => handleContourBackgroundFileChange(files?.[0] ?? null)}
                  currentName={contourBackgroundFile?.name}
                />
                {contourPageCount > 1 && (
                  <>
                    <NumberField
                      label={`Pagina contur (1–${contourPageCount})`}
                      value={contourPageNumber}
                      onChange={handleContourPageChange}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {contourPageAutoPicked
                        ? `Aplicația folosește automat pagina ${contourPageNumber} din ${contourPageCount} (diferită de pagina fundalului).`
                        : `Aplicația folosește pagina ${contourPageNumber} din ${contourPageCount}.`}
                    </p>
                  </>
                )}
                {contourBackgroundFile && (
                  <>
                    <CheckboxField
                      label="Dimensiunea conturului (nu a paginii)"
                      checked={contourTrimToPath}
                      onChange={handleContourTrimChange}
                    />
                    {contourTrimToPath && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        Atenție: conturul este redus la conturul desenului, ignorând marginile
                        goale ale paginii. Aliniați cu grijă decuparea la print.
                      </p>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                {/* Shape and its corner controls are tightly related: keep them on
                    one row (fragments are DOM-transparent, so the conditional fields
                    become direct flex children) and only wrap as a last resort. */}
                <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
                  <SelectField
                    label="Formă"
                    value={shapeKind}
                    options={SHAPE_OPTIONS}
                    onChange={(v) => setContourField('shapeKind', v)}
                  />
                  {shapeKind === 'rounded-rectangle' && (
                    <>
                      <NumberField label="Raza colțurilor (mm)" value={shapeCornerRadiusMm} onChange={(v) => setContourField('shapeCornerRadiusMm', v)} />
                      <SelectField
                        label="Orientare"
                        value={shapeCornerOrientation}
                        options={CORNER_ORIENTATION_OPTIONS}
                        onChange={(v) => setContourField('shapeCornerOrientation', v)}
                      />
                    </>
                  )}
                  {shapeKind === 'beveled-rectangle' && (
                    <NumberField label="Teșire colțuri (mm)" value={shapeCornerRadiusMm} onChange={(v) => setContourField('shapeCornerRadiusMm', v)} />
                  )}
                  {shapeKind === 'polygon' && (
                    <NumberField label="Număr laturi" value={polygonSides} onChange={(v) => setContourField('polygonSides', v)} min={3} step={1} />
                  )}
                  {shapeKind === 'polygon' && (
                    <CheckboxField label="Stea (vârfuri spre interior)" checked={polygonStar} onChange={(v) => setContourField('polygonStar', v)} />
                  )}
                </div>
                {!background && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Încarcă întâi PDF-ul de fundal pentru a genera forma.</p>
                )}
                {shapeError && <p className="text-sm text-red-600 dark:text-red-400">{shapeError}</p>}
              </>
            )}
            {contourBackgroundError && <p className="text-sm text-red-600 dark:text-red-400">{contourBackgroundError}</p>}
            {contourBackground && (
              <>
                {/* Design size — the width/height controls below. The "Redesenează"
                    offset never changes this; it only affects the resulting cut,
                    reported on its own line so the size controls stay stable. */}
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Dimensiune contur: {(contourBackground.widthPt / MM).toFixed(1)} × {(contourBackground.heightPt / MM).toFixed(1)} mm
                </p>
                {contourRedrawActive && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    După redesenare ({contourRedrawMm > 0 ? '+' : ''}{contourRedrawMm} mm): tăiere {activeContourWidthMm.toFixed(1)} × {activeContourHeightMm.toFixed(1)} mm
                  </p>
                )}
                {/* Resize / switch dimensions / rotate apply to both the uploaded
                    contour PDF and the generated preset shape (treated alike). */}
                {(contourSource === 'upload' || contourSource === 'shape') && (
                  <>
                    <LinkedDimensions
                      widthLabel="Lățime țintă contur (mm)"
                      heightLabel="Înălțime țintă contur (mm)"
                      width={contourTargetWidthMm}
                      height={contourTargetHeightMm}
                      // Editing the target is an explicit resize: stop auto-tracking
                      // the card so a preset shape keeps the user's chosen size.
                      // Editing the target is an explicit resize: stop auto-tracking
                      // the card so a preset shape keeps the user's chosen size. The
                      // offset stays auto-centered (see the effect below) so the
                      // resized shape doesn't jump to the corner.
                      onWidth={(v) => { contourShapeTargetAutoRef.current = false; setContourField('contourTargetWidthMm', v) }}
                      onHeight={(v) => { contourShapeTargetAutoRef.current = false; setContourField('contourTargetHeightMm', v) }}
                      // A preset circle must stay 1:1 — resizing it non-proportionally
                      // would just be an ellipse — so force the lock on (and disable the
                      // toggle + swap). Other shapes use the live target ratio so the
                      // lock follows the orientation after a swap or rotation.
                      aspect={contourSource === 'shape' && shapeKind === 'circle' ? 1 : contourTargetWidthMm / contourTargetHeightMm}
                      locked={(contourSource === 'shape' && shapeKind === 'circle') || contourLockAspect}
                      onToggleLock={() => setContourLockAspect((v) => !v)}
                      lockToggleDisabled={contourSource === 'shape' && shapeKind === 'circle'}
                      // A preset shape can't exceed the background: cap each target at
                      // the available card size (the same bound the effective-size math
                      // already enforces, now reflected in the inputs).
                      maxWidth={contourSource === 'shape' ? contourAvailWidthMm : undefined}
                      maxHeight={contourSource === 'shape' ? contourAvailHeightMm : undefined}
                      onSwap={contourSource === 'shape' && shapeKind === 'circle' ? undefined : () => {
                        contourShapeTargetAutoRef.current = false
                        const w = contourTargetWidthMm
                        setContourField('contourTargetWidthMm', contourTargetHeightMm)
                        setContourField('contourTargetHeightMm', w)
                      }}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={rotateContour}
                        title="Rotește conturul cu 90° (portret ⇄ peisaj)"
                        className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        ↻ Rotește 90°
                      </button>
                      <span className="text-sm text-gray-600 dark:text-gray-400">Rotație: {contourRotation}°</span>
                    </div>
                    <NumberField label="Rotație contur (grade)" value={contourSpinDeg} onChange={(v) => setContourField('contourSpinDeg', v)} step={1} />
                  </>
                )}
                {/* "Redesenează": equidistant offset of the cut outline, applied to
                    both sources. Positive grows it outward (bleed), negative shrinks
                    it inward (safety margin). */}
                <NumberField
                  label="Redesenează (decalaj mm, + în afară / − în interior)"
                  value={contourRedrawMm}
                  step={0.5}
                  onChange={(v) => setContourField('contourRedrawMm', isFinite(v) ? v : 0)}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Decalează întregul contur cu aceeași distanță pe tot conturul (die-line). 0 = neschimbat.
                </p>
                {contourOffsetMaxXMm > 0 || contourOffsetMaxYMm > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
                      <NumberField
                        label={`Decalaj X contur (${contourOffsetMinXMm.toFixed(1)}–${contourOffsetMaxXMm.toFixed(1)} mm)`}
                        value={clampedContourOffsetXMm}
                        // A nudge sets a relative position that's then preserved
                        // proportionally across later resizes (see the effect above).
                        onChange={(v) => setContourField('contourOffsetXMm', Math.min(Math.max(contourOffsetMinXMm, v), contourOffsetMaxXMm))}
                      />
                      <NumberField
                        label={`Decalaj Y contur (${contourOffsetMinYMm.toFixed(1)}–${contourOffsetMaxYMm.toFixed(1)} mm)`}
                        value={clampedContourOffsetYMm}
                        onChange={(v) => setContourField('contourOffsetYMm', Math.min(Math.max(contourOffsetMinYMm, v), contourOffsetMaxYMm))}
                      />
                    </div>
                    {/* Snap the contour to the centre of its available room on each
                        axis: the midpoint of [min, max] (0 for a centred full-card
                        shape, (card − contour)/2 for a resized/corner-anchored one). */}
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Centrează:</span>
                      <button
                        type="button"
                        onClick={() => setContourField('contourOffsetXMm', (contourOffsetMinXMm + contourOffsetMaxXMm) / 2)}
                        disabled={!(contourOffsetMaxXMm > contourOffsetMinXMm)}
                        title="Centrează conturul pe orizontală"
                        className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        ↔ Orizontal
                      </button>
                      <button
                        type="button"
                        onClick={() => setContourField('contourOffsetYMm', (contourOffsetMinYMm + contourOffsetMaxYMm) / 2)}
                        disabled={!(contourOffsetMaxYMm > contourOffsetMinYMm)}
                        title="Centrează conturul pe verticală"
                        className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        ↕ Vertical
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Conturul ocupă tot fundalul — nu există spațiu pentru decalaj. Folosește un contur mai mic decât fundalul.
                  </p>
                )}
                <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
                  <NumberField label="Transparență contur (0-1)" value={contourOpacity} onChange={(v) => setContourField('contourOpacity', v)} step={0.1} min={0} max={1} />
                  <SelectField
                    label="Mod combinare contur"
                    value={contourBlendMode}
                    options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))}
                    onChange={(v) => setContourField('contourBlendMode', v)}
                  />
                </div>
                {/* Preview-only aid: dims the background outside the cut so the
                    user sees what the contour keeps. Doesn't change the output. */}
                <CheckboxField
                  label="Întunecă exteriorul conturului (doar previzualizare)"
                  checked={dimContourExterior}
                  onChange={(v) => setContourField('dimContourExterior', v)}
                />

              </>
            )}
          </Section>
          )}

          {step === 'aspect' && (
          <>
          <Section title="Text exemplu">
            <TextField
              label={`Rând CSV exemplu (separator: ${describeSeparator(codeSeparator)})`}
              value={sampleTextDisplay}
              onChange={(v) => handleSampleTextChange(v, codeSeparator)}
            />
            <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
              <NumberField label="Margine (mm)" value={safeMarginMm} onChange={(v) => setStyleField('safeMarginMm', v)} />
              <NumberField label="Padding fundal text (mm)" value={backgroundPaddingMm} onChange={(v) => setStyleField('backgroundPaddingMm', v)} />
              <NumberField label="Distanțăre contur (mm)" value={contourInsetMm} onChange={(v) => setStyleField('contourInsetMm', v)} min={0} step={0.5} />
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              „Distanțare contur” este distanța minimă față de tăietură: e folosită atât pentru
              verificare (codurile trebuie să stea cel puțin atât de departe de tăietură ca să fie
              „sigure”), cât și ca margine pentru alinierile „(contur)”. Se aplică doar când
              folosești un contur de tăiere.
            </p>
            {fontsError && <p className="text-sm text-red-600 dark:text-red-400">{fontsError}</p>}
            {fontsNotice && <p className="text-sm text-amber-600 dark:text-amber-400">{fontsNotice}</p>}
          </Section>

          <Section title="Coduri">
            <div className="flex flex-wrap gap-2">
              {words.map((word, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className={`rounded-full px-3 py-1 text-sm font-medium ${
                    selectedIndex === index
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {word.text || `Cuvânt ${index + 1}`}
                </button>
              ))}
            </div>

            {selected && selectedIndex !== null && (
              <div className="flex flex-col gap-3 border-t border-gray-200 pt-3 dark:border-gray-700">
              <Section title="Tipografie" collapsible>
                <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
                <NumberField label="Dimensiune font (pt)" value={selected.fontSizePt} onChange={(v) => updateWord(selectedIndex, { fontSizePt: v })} />
                <NumberField label="Spațiere caractere (pt)" value={selected.charSpacingPt} onChange={(v) => updateWord(selectedIndex, { charSpacingPt: v })} step={0.1} />
                </div>
                <div className="w-full">
                  <RadioGroupField<FontSource>
                    label="Font pentru acest cuvânt"
                    value={fontSources[selectedIndex]}
                    onChange={(v) => handleWordFontSourceChange(selectedIndex, v)}
                    options={[
                      { value: 'google', label: 'Google Font' },
                      { value: 'custom', label: 'Fișier propriu (.ttf/.otf)' },
                    ]}
                  />
                  <div className="mt-2">
                    {fontSources[selectedIndex] === 'google' ? (
                      <GoogleFontPicker
                        key={selectedIndex}
                        value={googleFontSelections[selectedIndex]}
                        onChange={(selection, font) => handleWordGoogleFontChange(selectedIndex, selection, font)}
                      />
                    ) : (
                      <>
                        <FileField
                          key={selectedIndex}
                          label="Font pentru acest cuvânt (opțional)"
                          accept=".ttf,.otf,font/ttf,font/otf"
                          onChange={(files) => handleWordFontFileChange(selectedIndex, files?.[0] ?? null)}
                        />
                        {fonts[selectedIndex] && (
                          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{fonts[selectedIndex]?.fileName}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Section>
              <Section title="Poziție" collapsible>
                <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
                <SelectField<Align | 'custom'>
                  label="Aliniere orizontală"
                  warning={selected.xMm !== null && !selected.align.startsWith('contour-') ? 'Codurile lungi pot ieși în afara fundalului.' : undefined}
                  value={selected.align.startsWith('contour-') ? selected.align : selected.xMm !== null ? 'custom' : selected.align}
                  onChange={(v) => {
                    if (v === 'custom') {
                      // Freeze at the current on-screen position and drop any contour mode.
                      const xMm = selected.xMm ??
                        (effectiveCardWidthMm > 0
                          ? horizontalAlignXMm(selected.align, selected, fontFamilyForWord(fonts, selectedIndex), effectiveCardWidthMm, safeMarginMm, contourAlignRect, contourInsetMm)
                          : 0)
                      updateWord(selectedIndex, { align: baseAlign(selected.align), xMm })
                    } else if (v.startsWith('contour-')) {
                      // Contour modes resolve to an explicit xMm (kept in sync by the effect).
                      const xMm = effectiveCardWidthMm > 0
                        ? horizontalAlignXMm(v, selected, fontFamilyForWord(fonts, selectedIndex), effectiveCardWidthMm, safeMarginMm, contourAlignRect, contourInsetMm)
                        : 0
                      updateWord(selectedIndex, { align: v, xMm })
                    } else {
                      updateWord(selectedIndex, { align: v, xMm: null })
                    }
                  }}
                  options={[
                    { value: 'left', label: 'stânga' },
                    { value: 'center', label: 'centru' },
                    { value: 'right', label: 'dreapta' },
                    ...(contourAlignRect || selected.align.startsWith('contour-')
                      ? ([
                          { value: 'contour-left', label: 'stânga (contur)' },
                          { value: 'contour-center', label: 'centru (contur)' },
                          { value: 'contour-right', label: 'dreapta (contur)' },
                        ] as const)
                      : []),
                    { value: 'custom', label: 'la punct fix' },
                  ]}
                />
                <SelectField<VAlign>
                  label="Aliniere verticală"
                  warning={selected.valign === 'custom' ? 'Codurile lungi pot ieși în afara fundalului.' : undefined}
                  value={selected.valign}
                  onChange={(v) =>
                    updateWord(selectedIndex, {
                      valign: v,
                      yMm: background
                        ? verticalAlignYMm(
                            v,
                            selected,
                            fontFamilyForWord(fonts, selectedIndex),
                            background.heightPt / MM,
                            safeMarginMm,
                            contourAlignRect,
                            contourInsetMm,
                          )
                        : selected.yMm,
                    })
                  }
                  options={[
                    { value: 'top', label: 'sus' },
                    { value: 'middle', label: 'mijloc' },
                    { value: 'bottom', label: 'jos' },
                    ...(contourAlignRect || selected.valign.startsWith('contour-')
                      ? ([
                          { value: 'contour-top', label: 'sus (contur)' },
                          { value: 'contour-middle', label: 'mijloc (contur)' },
                          { value: 'contour-bottom', label: 'jos (contur)' },
                        ] as const)
                      : []),
                    { value: 'custom', label: 'la punct fix' },
                  ]}
                />
                <NumberField label="Y (mm)" value={selected.yMm} onChange={(v) => updateWord(selectedIndex, { yMm: v, valign: 'custom' })} />
                <NumberField
                  label="X (mm, gol = automat după aliniere)"
                  value={selected.xMm ?? NaN}
                  onChange={(v) => updateWord(selectedIndex, { xMm: Number.isNaN(v) ? null : v })}
                />
                </div>
              </Section>
              <Section title="Stil" collapsible defaultCollapsed>
                <ColorField
                  label="Culoare text"
                  value={selected.color}
                  onChange={(v) => {
                    setStyleField('autoTextColor', false)
                    updateWord(selectedIndex, { color: v ?? '0:0:0:1' })
                  }}
                />
                {/* Opacity, blend mode and rotation are tightly related: a small
                    min-width floor keeps them sharing one row and wrapping only as
                    a last resort when the column is too narrow. */}
                <div className="flex flex-wrap gap-3 [&>*]:min-w-24 [&>*]:flex-1">
                  <NumberField
                    label="Opacitate (0-1)"
                    value={selected.opacity}
                    onChange={(v) => updateWord(selectedIndex, { opacity: v })}
                    step={0.1}
                    min={0}
                    max={1}
                  />
                  <SelectField
                    label="Mod îmbinare text"
                    value={selected.blendMode}
                    options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))}
                    onChange={(v) => updateWord(selectedIndex, { blendMode: v })}
                  />
                  <NumberField label="Rotație (grade)" value={selected.rotationDeg} onChange={(v) => updateWord(selectedIndex, { rotationDeg: v })} />
                </div>
                <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
                  <CheckboxField label="Oglindire X" checked={selected.flipX} onChange={(v) => updateWord(selectedIndex, { flipX: v })} />
                  <CheckboxField label="Oglindire Y" checked={selected.flipY} onChange={(v) => updateWord(selectedIndex, { flipY: v })} />
                </div>
              </Section>
              <Section title="Fundal text" collapsible defaultCollapsed>
                <ColorField
                  label="Fundal text"
                  value={selected.background}
                  allowNone
                  onChange={(v) => updateWord(selectedIndex, { background: v })}
                />
                {selected.background !== null && (
                  // Width, transparency and blend mode are tightly related: a small
                  // min-width floor keeps them sharing one row and wrapping only as
                  // a last resort when the column is too narrow.
                  <div className="flex flex-wrap gap-3 [&>*]:min-w-24 [&>*]:flex-1">
                    <NumberField
                      label="Lățime (mm, gol = automat)"
                      value={selected.backgroundWidthMm ?? NaN}
                      onChange={(v) => updateWord(selectedIndex, { backgroundWidthMm: Number.isNaN(v) ? null : v })}
                    />
                    <NumberField label="Transparență (0-1)" value={selected.backgroundAlpha} onChange={(v) => updateWord(selectedIndex, { backgroundAlpha: v })} step={0.1} min={0} max={1} />
                    {/* Blend-mode select hugs its content (min-content) instead of
                        stretching, so the two number fields take the extra width.
                        `!` overrides the row's `[&>*]:flex-1 [&>*]:min-w-24`. */}
                    <div className="w-min !min-w-0 !flex-none">
                      <SelectField
                        label="Mod îmbinare"
                        value={selected.backgroundBlendMode}
                        options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))}
                        onChange={(v) => updateWord(selectedIndex, { backgroundBlendMode: v })}
                      />
                    </div>
                  </div>
                )}
              </Section>
              <Section title="Contur text" collapsible defaultCollapsed>
                <ColorField
                  label="Contur text"
                  value={selected.contourColor}
                  allowNone
                  noneLabel="fără contur"
                  onChange={(v) => updateWord(selectedIndex, { contourColor: v })}
                />
                {selected.contourColor !== null && (
                  <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
                    <NumberField label="Lățime contur (mm)" value={selected.contourWidthMm} onChange={(v) => updateWord(selectedIndex, { contourWidthMm: v })} />
                    <SelectField
                      label="Mod îmbinare contur"
                      value={selected.contourBlendMode}
                      options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))}
                      onChange={(v) => updateWord(selectedIndex, { contourBlendMode: v })}
                    />
                  </div>
                )}
              </Section>
              </div>
            )}
          </Section>
          </>
          )}

          {step === 'date' && (
          <CodeSourceSection
            correctOverflow={correctOverflow}
            onCorrectOverflowChange={(v) => setStyleField('correctOverflow', v)}
            minFontSizePt={minFontSizePt}
            onMinFontSizeChange={(v) => setStyleField('minFontSizePt', v)}
            overflowCorrectionMode={overflowCorrectionMode}
            onOverflowCorrectionModeChange={(v) => setStyleField('overflowCorrectionMode', v)}
            dataMode={codeDataMode}
            onDataModeChange={handleCodeDataModeChange}
            onCsvUpload={(f) => void handleCsvUpload(f)}
            uploadFileName={uploadedRawFile?.name}
            uploadRowCount={uploadedCsvRowCount}
            uploadInfo={uploadedCsvInfo}
            uploadWarnings={uploadedCsvWarnings}
            rowCount={codeRowCount}
            onRowCountChange={handleCodeRowCountChange}
            separator={codeSeparator}
            onSeparatorChange={handleCodeSeparatorChange}
            columns={codeColumns}
            onColumnsChange={handleCodeColumnsChange}
            fieldPieces={widestUploadedRow}
            fieldMerges={codeFieldMerges}
            onFieldMergesChange={handleUploadFieldMergesChange}
            singleFieldPerRow={codeSingleField}
            onSingleFieldPerRowChange={handleSingleFieldChange}
            onGenerate={handleGenerateCsv}
            preview={displayPreview}
            downloadUrl={codeDataMode === 'generate' ? codeCsvUrl : null}
            progress={codeCsvProgress}
            stale={codeCsvStale}
            blocked={codeUniquenessImpossible}
            duplicates={codeDataMode === 'generate' ? codeCsvDuplicates : null}
          />
          )}

          {step === 'generare' && (
          <>
          {!generateUnlocked && (
            <Section title="Cere ofertă">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Descarcă fișierul cu setările tale (inclusiv fundalurile și fonturile folosite), apoi trimite-ni-l pe
                email pentru o ofertă personalizată.
              </p>
              <button
                type="button"
                onClick={() => void handleRequestQuote()}
                className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                Descarcă setările pentru ofertă (.zip)
              </button>
              {quoteError && <p className="text-sm text-red-600 dark:text-red-400">{quoteError}</p>}
              <p className="text-sm text-gray-600 dark:text-gray-400">
                După descărcare,{' '}
                <a
                  href={`mailto:braila.gabriel@gmail.com?subject=${encodeURIComponent('Cerere ofertă')}&body=${encodeURIComponent(
                    'Bună,\n\nAș dori o ofertă pentru proiectul meu. Am atașat fișierul .zip cu setările descărcat din aplicatia de printare coduri si decupare pe contur.\n\n' +
                      'Trebuie să vă trimit și un fișier cu codurile, sau sa va spun cum să fie generate.\n\nMulțumesc!',
                  )}`}
                  className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  trimite-ne un email
                </a>{' '}
                și atașează fișierul descărcat.
              </p>
            </Section>
          )}

          <Section title="Generare">
            {!generateUnlocked ? (
              <>
                <TextField label="Parolă" type="password" value={passwordInput} onChange={setPasswordInput} />
                <button
                  type="button"
                  onClick={handleUnlock}
                  className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  Deblochează
                </button>
                {passwordError && <p className="text-sm text-red-600 dark:text-red-400">{passwordError}</p>}
              </>
            ) : (
              <>
            <RadioGroupField<Mode>
              label="Ce se generează"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'print', label: 'Print', description: 'Generează PDF-ul de print folosind fundalul.' },
                { value: 'contour', label: 'Contur', description: 'Generează PDF-ul cu linii de tăiere folosind fundalul de contur.' },
                { value: 'both', label: 'Print + Contur', description: 'Generează ambele PDF-uri.' },
              ]}
            />

            {/* No-cut mode skips imposition, so the host-sheet/circle fields are ignored. */}
            {!pageOptions.noCut && (
              <>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Aspect pagină</p>
                <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
                  <NumberField label="Lățime pagină (mm)" value={pageOptions.hostWidthMm} onChange={(v) => setPageOption('hostWidthMm', v)} />
                  <NumberField label="Înălțime pagină (mm)" value={pageOptions.hostHeightMm} onChange={(v) => setPageOption('hostHeightMm', v)} />
                  <NumberField label="Decalaj X (mm)" value={pageOptions.offsetXMm} onChange={(v) => setPageOption('offsetXMm', Math.max(0, v))} />
                  <NumberField label="Decalaj Y (mm)" value={pageOptions.offsetYMm} onChange={(v) => setPageOption('offsetYMm', Math.max(0, v))} />
                  <NumberField label="Diametru cerc (mm)" value={pageOptions.circleDiameterMm} onChange={(v) => setPageOption('circleDiameterMm', v)} />
                </div>
              </>
            )}

            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Opțiuni</p>
            <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
              <CheckboxField
                label="Non-decupare"
                checked={pageOptions.noCut}
                onChange={(v) => setPageOption('noCut', v)}
              />
              {/* "Combină paginile" overlays the contour onto the print pages, so it's
                  meaningless without a print output (Contur mode) and in no-cut mode. */}
              {needsPrintInput && !pageOptions.noCut && (
                <CheckboxField label="Combină paginile" checked={pageOptions.combine} onChange={(v) => setPageOption('combine', v)} />
              )}
              {/* "Minimal" crops the generated page down to the contour box (needs a contour). */}
              <CheckboxField label="Minimal" checked={pageOptions.minimal} onChange={(v) => setPageOption('minimal', v)} />
              {/* "Contur Dreptunghi" emits plain rectangles instead of the optimized grid
                  lines — only for a rectangle contour in a contour-producing mode. */}
              {needsContourInput && contourSource === 'shape' && shapeKind === 'rectangle' && (
                <CheckboxField label="Contur Dreptunghi" checked={rectangleContour} onChange={(v) => setContourField('rectangleContour', v)} />
              )}
              <CheckboxField label="Contururi de depanare" checked={pageOptions.debug} onChange={(v) => setPageOption('debug', v)} />
              {needsContourInput && (
                <CheckboxField label="Măsoară traseele de tăiere" checked={pageOptions.measurePaths} onChange={(v) => setPageOption('measurePaths', v)} />
              )}
            </div>
            {pageOptions.noCut && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Non-decupare: un card pe pagină, fără impunere și fără cercuri de reglaj.
              </p>
            )}

            {bgExceedsSheet && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                ⚠ Fundalul ({effectiveCardWidthMm.toFixed(1)} × {effectiveCardHeightMm.toFixed(1)} mm) nu încape în
                pagina ({pageOptions.hostWidthMm.toFixed(1)} × {pageOptions.hostHeightMm.toFixed(1)} mm). Mărește pagina
                sau micșorează cardul.
              </p>
            )}

            {cutExceedsSheet && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                ⚠ Conturul ({contourFitWidthMm.toFixed(1)} × {contourFitHeightMm.toFixed(1)} mm) nu încape în zona de
                tăiere a paginii ({Math.max(0, cuttableWidthMm).toFixed(1)} × {Math.max(0, cuttableHeightMm).toFixed(1)}{' '}
                mm = pagina minus cercurile de reglaj). Mărește pagina, micșorează diametrul cercurilor sau conturul.
              </p>
            )}

            {contourCappedToFit && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                ⚠ Conturul a fost redus ca să încapă în fundal ({effectiveCardWidthMm.toFixed(1)} ×{' '}
                {effectiveCardHeightMm.toFixed(1)} mm): {Math.abs(cappedContourSpinDeg - contourSpinDeg) > 1e-3
                  ? `rotația a fost limitată la ${cappedContourSpinDeg.toFixed(0)}° (din ${contourSpinDeg.toFixed(0)}°)`
                  : 'dimensiunea a fost micșorată'}
                . Micșorează conturul sau rotația ca să folosești valoarea dorită.
              </p>
            )}

            {cutGapTooSmall && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                ⚠ Decalaj X/Y ({pageOptions.offsetXMm.toFixed(1)} × {pageOptions.offsetYMm.toFixed(1)} mm) este prea
                mic pentru acest contur. Doar un contur dreptunghiular simplu poate avea decalaj 0 (cardurile
                împart aceeași linie de tăiere). Pentru celelalte forme sau pentru un contur încărcat, un decalaj
                sub 1,0 mm face ca tăierile vecine să se suprapună — cutter-ul taie de două ori aceeași zonă la
                dublă tăiere și materialul se poate deteriora. Mărește Decalaj X și Y la cel puțin 1,0 mm.
              </p>
            )}

            {needsContourInput && pageOptions.measurePaths && (
              <>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Timp de tăiere</p>
                <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
                  <NumberField label="Viteză de tăiere (mm/s)" value={pageOptions.cuttingSpeedMmS} onChange={(v) => setPageOption('cuttingSpeedMmS', v)} />
                  <NumberField label="Penalizare colț (s)" value={pageOptions.cornerPenaltyS} onChange={(v) => setPageOption('cornerPenaltyS', v)} />
                  <NumberField label="Timp pregătire (s)" value={pageOptions.preparationTimeS} onChange={(v) => setPageOption('preparationTimeS', v)} />
                  <NumberField label="Viteză deplasare (mm/s)" value={pageOptions.travelSpeedMmS} onChange={(v) => setPageOption('travelSpeedMmS', v)} />
                </div>
              </>
            )}

            {genLoading ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => cancelGenRef.current?.()}
                  className="self-start rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Anulează
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {genProgress
                    ? `${genProgress.phase === 'contour' ? 'Contur' : 'Print'}: ${genProgress.rowsDone.toLocaleString('ro-RO')}${
                        genProgress.totalRows ? ` / ${genProgress.totalRows.toLocaleString('ro-RO')}` : ''
                      } rânduri · ${genProgress.batchesDone} loturi · ${Math.round(genProgress.wasmBytes / 1048576)} MB`
                    : 'Se generează…'}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={sampleLoading}
                  className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  Generează PDF
                </button>
                <button
                  type="button"
                  onClick={handleGenerateSample}
                  disabled={sampleLoading}
                  title="Generează un singur card cu conturul deasupra — o probă rapidă, fără tot lotul."
                  className="self-start rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {sampleLoading ? 'Se generează mostra…' : 'Generează o mostră (un card)'}
                </button>
              </div>
            )}
            {genError && <p className="text-sm text-red-600 dark:text-red-400">{genError}</p>}
              </>
            )}
          </Section>
          </>
          )}

          {step === 'fundal' && !backgroundDone && (
            <p className="text-sm text-amber-600 dark:text-amber-400">{backgroundLockedHint}</p>
          )}
          {step === 'contur' && !contourDone && (
            <p className="text-sm text-amber-600 dark:text-amber-400">{contourLockedHint}</p>
          )}
          {step === 'date' && !dataSourceDone && (
            <p className="text-sm text-amber-600 dark:text-amber-400">{dataSourceLockedHint}</p>
          )}
          <WizardFooter
            stepIndex={stepIndex}
            stepCount={WIZARD_STEPS.length}
            onBack={() => setStep(WIZARD_STEPS[stepIndex - 1].id)}
            onNext={() => setStep(WIZARD_STEPS[stepIndex + 1].id)}
            nextDisabled={
              (step === 'fundal' && !backgroundDone) ||
              (step === 'contur' && !contourDone) ||
              (step === 'date' && !dataSourceDone)
            }
          />
        </div>

        <div className="flex flex-col gap-4">
          <Section title="Previzualizare">
            {background ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Zoom:</span>
                  <button
                    type="button"
                    onClick={zoomOutPreview}
                    disabled={previewZoom <= PREVIEW_ZOOM_MIN}
                    aria-label="Micșorează previzualizarea"
                    title="Micșorează"
                    className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewZoom(1)}
                    aria-label="Resetează zoom la 100%"
                    title="Resetează la 100%"
                    className="min-w-14 rounded border border-gray-300 px-2 py-1 text-sm font-medium tabular-nums text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {Math.round(previewZoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={zoomInPreview}
                    disabled={previewZoom >= PREVIEW_ZOOM_MAX}
                    aria-label="Mărește previzualizarea"
                    title="Mărește"
                    className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    +
                  </button>
                  <label
                    className="ml-auto flex cursor-pointer items-center gap-1 text-sm text-gray-700 dark:text-gray-300"
                    title="Captura descarcă un fișier în loc să copieze în clipboard"
                  >
                    <input
                      type="checkbox"
                      checked={captureDownload}
                      onChange={(e) => setCaptureDownload(e.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800"
                    />
                    <span className="font-medium">Descarcă</span>
                  </label>
                  <label
                    className={`flex items-center gap-1 text-sm ${hasContour ? 'cursor-pointer text-gray-700 dark:text-gray-300' : 'cursor-not-allowed text-gray-400 dark:text-gray-600'}`}
                    title="Captura decupează doar imprimarea și codurile din interiorul conturului, ca PNG transparent"
                  >
                    <input
                      type="checkbox"
                      checked={captureCutout}
                      disabled={!hasContour}
                      onChange={(e) => setContourCutout(e.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded border-gray-300 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800"
                    />
                    <span className="font-medium">Conturat</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleScreenshot}
                    disabled={screenshotStatus === 'busy'}
                    aria-label="Captură de ecran a previzualizării (copiază în clipboard)"
                    title="Captură de ecran (copiază în clipboard)"
                    className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    📷 Captură
                  </button>
                  {screenshotStatus !== 'idle' && screenshotStatus !== 'busy' && (
                    <span
                      className={`text-xs ${screenshotStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}
                      role="status"
                    >
                      {screenshotStatus === 'copied' ? 'Copiat!' : screenshotStatus === 'downloaded' ? 'Descărcat' : 'Eroare'}
                    </span>
                  )}
                </div>
                <div
                  ref={previewScrollRef}
                  onPointerDown={handlePreviewPanStart}
                  className={`overflow-auto select-none ${previewZoom > 1 ? 'max-h-[75vh]' : ''} ${previewZoom > 1 && !colorSamplingActive ? 'cursor-grab' : ''}`}
                >
                  <div
                    ref={previewRef}
                    style={{ width: `${previewZoom * 100}%` }}
                    className={[previewZoom <= 1 ? 'mx-auto' : '', colorSamplingActive ? 'cursor-crosshair [&_*]:!cursor-crosshair' : ''].filter(Boolean).join(' ') || undefined}
                  >
                    <CardCanvas
                      backgroundImageUrl={background.imageUrl}
                      backgroundOffsetXPt={bgOffsetXMm * MM}
                      backgroundOffsetYPt={bgOffsetYMm * MM}
                      backgroundSpinDeg={bgSpinDeg}
                      contourSpinDeg={activeContourSpinDeg}
                      backgroundBackdropColor={bgBackdropColor}
                      bgNudgeMode={bgNudgeMode}
                      onBackgroundOffsetChange={handleBackgroundOffsetChange}
                      cardWidthPt={effectiveCardWidthMm * MM}
                      cardHeightPt={effectiveCardHeightMm * MM}
                      contourImageUrl={activeContourBackground?.imageUrl ?? null}
                      contourWidthPt={activeContourWidthMm * MM}
                      contourHeightPt={activeContourHeightMm * MM}
                      contourOffsetXPt={activeContourOffsetXMm * MM}
                      contourOffsetYPt={activeContourOffsetYMm * MM}
                      contourOpacity={contourOpacity}
                      contourBlendMode={contourBlendMode}
                      dimExterior={dimContourExterior}
                      contourCutShape={activeContourCutShape}
                      contourInteriorMaskPath={activeInteriorMaskPath}
                      contourSelected={contourSelected && contourBackground != null}
                      onContourSelect={() => setContourSelected(true)}
                      onContourOffsetChange={handleContourOffsetChange}
                      words={words}
                      fonts={fonts}
                      safeMarginMm={safeMarginMm}
                      backgroundPaddingMm={backgroundPaddingMm}
                      selectedIndex={selectedIndex}
                      onSelect={(i) => { setSelectedIndex(i); setContourSelected(false) }}
                      onChangeWord={updateWord}
                    />
                  </div>
                </div>
                {colorSamplingActive && (
                  <p className="text-center text-xs text-blue-600 dark:text-blue-400">
                    Click pe previzualizare pentru a alege culoarea · Esc pentru anulare
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">Încarcă un PDF de fundal pentru a vedea previzualizarea.</p>
            )}
          </Section>

          {(printArtifact || contourResult || sampleArtifact) && (
            <Section title="Rezultat">
              {sampleArtifact && (
                <FileDownload
                  title="Mostră (un card)"
                  blob={sampleArtifact.blob}
                  name="mostra.pdf"
                  note="Probă cu un singur card — conturul este suprapus ca strat vizibil pe ecran (neimprimabil)."
                />
              )}
              {printArtifact && (
                <FileDownload
                  title="Print"
                  blob={printArtifact.blob}
                  name={printArtifact.name}
                  isZip={printArtifact.isZip}
                  note={
                    printArtifact.isZip
                      ? 'Generat în loturi — arhivă ZIP cu mai multe PDF-uri (previzualizarea arată primul PDF).' +
                        (printArtifact.sink === 'opfs' ? ' Arhivă mare — scrisă pe disc pentru a economisi memoria.' : '')
                      : undefined
                  }
                />
              )}
              {printArtifact && printArtifact.overflowCount > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    ⚠ {printArtifact.overflowCount}{' '}
                    {printArtifact.overflowCount === 1
                      ? 'rând conține un cod care depășește'
                      : 'rânduri conțin coduri care depășesc'}{' '}
                    zona de tăiere sau spațiul cardului
                    {printArtifact.overflowSamples.length > 0 &&
                      ` (ex: ${printArtifact.overflowSamples.slice(0, 5).join(' | ')}${printArtifact.overflowSamples.length > 5 ? '…' : ''})`}.
                    {' '}Micșorați fontul, scurtați codul sau măriți cardul.
                  </p>
                  {printArtifact.overflowSamples.length > 0 && (
                    <button
                      type="button"
                      onClick={() => downloadOverflowCsv(printArtifact.overflowSamples)}
                      className="self-start text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Descarcă depășirile ({printArtifact.overflowSamples.length}, .csv)
                    </button>
                  )}
                </div>
              )}
              {contourResult && <ResultPanel title="Contur" result={contourResult} downloadName="contur.pdf" />}
              {mode === 'both' && printArtifact && contourResult && (
                <DownloadBothButton
                  print={{ blob: printArtifact.blob, name: printArtifact.name, isZip: printArtifact.isZip }}
                  contourPdf={contourResult.pdf}
                />
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
    </ColorSampleContext.Provider>
  )
}
