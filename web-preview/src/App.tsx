import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CardCanvas } from './components/CardCanvas'
import { CodeSourceSection } from './components/CodeSourceSection'
import { WizardFooter, WizardNav } from './components/WizardNav'
import { CheckboxField, ColorField, FileField, LinkedDimensions, NumberField, RadioGroupField, Section, SelectField, TextField } from './components/fields'
import { DownloadBothButton, FileDownload, ResultPanel } from './components/ResultPanel'
import { type GenerateResult } from './lib/generate'
import { generateBatched, type BatchProgress, type PrintArtifact } from './lib/generateBatched'
import { GoogleFontPicker, type GoogleFontSelection } from './components/GoogleFontPicker'
import { fetchGoogleFont } from './lib/googleFonts'
import { ensureDefaultFont, fontFamilyForWord, loadFontFile, type LoadedFont } from './lib/fonts'
import { ensureWasmInit, generate_with_options, generate_shape_pdf, generate_simple_background_pdf, generate_image_background_pdf } from './lib/wasm'
import { downloadPresetBundle, loadPresetBundle } from './lib/presetBundle'
import { buildJsOptions, BLEND_MODES, defaultPageOptions, MM, defaultWordStyle, splitWords, horizontalAlignXMm, verticalAlignYMm, type Align, type BlendMode, type PageOptions, type VAlign, type WordStyle } from './lib/options'
import { CSV_PREVIEW_ROW_COUNT, defaultCodeColumn, generateCsvPreview, mergeFields, randomCodeSpace, streamCodesCsv, type CodeColumnConfig } from './lib/codeSource'
import { parseUploadedCsv, serializeRows, describeDelimiter } from './lib/csvImport'
import { renderPdfBackground, solidColorBackground, type PdfBackground } from './lib/pdfBackground'
import { ColorSampleContext, imageUrlToCanvas, sampleCanvasColorAt } from './lib/colorSample'
import { contrastColor } from './lib/cmyk'
import { randomWordFittingWidth } from './lib/randomWords'
import { useTheme } from './lib/theme'

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
  shapeKind: ShapeKind
  shapeInsetMm: number
  shapeCornerRadiusMm: number
  shapeCornerOrientation: CornerOrientation
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
type ContourSource = 'upload' | 'shape'
type ShapeKind = 'circle' | 'ellipse' | 'rectangle' | 'rounded-rectangle' | 'beveled-rectangle' | 'heart'

const SHAPE_OPTIONS: { value: ShapeKind; label: string }[] = [
  { value: 'circle', label: 'Cerc' },
  { value: 'ellipse', label: 'Elipsă' },
  { value: 'rectangle', label: 'Dreptunghi' },
  { value: 'rounded-rectangle', label: 'Dreptunghi cu colțuri rotunjite' },
  { value: 'beveled-rectangle', label: 'Dreptunghi cu colțuri teșite' },
  { value: 'heart', label: 'Inimă' },
]

// Tight bounding box (in card-mm coords, measured from the card's bottom-left)
// of a preset contour shape, mirroring how `build_shape_pdf` in
// src/generate/shapes.rs draws each shape inside the card inset by `insetMm`.
// A circle uses `min(w, h)` and stays centered (so it doesn't grow along the
// longer axis); every other shape fills the inset box. Used to re-position codes
// relative to the cut shape when the card is resized.
function contourBoxMm(shape: ShapeKind, cardWMm: number, cardHMm: number, insetMm: number) {
  const iw = cardWMm - 2 * insetMm
  const ih = cardHMm - 2 * insetMm
  if (shape === 'circle') {
    const d = Math.min(iw, ih)
    return { x: (cardWMm - d) / 2, y: (cardHMm - d) / 2, w: d, h: d }
  }
  return { x: insetMm, y: insetMm, w: iw, h: ih }
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

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const [step, setStep] = useState<WizardStepId>('fundal')
  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step)

  useEffect(() => {
    void ensureDefaultFont()
  }, [])

  const [background, setBackground] = useState<PdfBackground | null>(null)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)
  const [backgroundSource, setBackgroundSource] = useState<BackgroundSource>('upload')
  const [simpleBgWidthMm, setSimpleBgWidthMm] = useState(86)
  const [simpleBgHeightMm, setSimpleBgHeightMm] = useState(54)
  const [simpleBgColor, setSimpleBgColor] = useState<string | null>(null)
  // "Crează fundal": build the print background from a raster image (PNG/JPEG)
  // at the chosen card size. `genBgImageFile` is the source-image boundary — any
  // future image source (e.g. AI generation) just feeds a File in here.
  const [genBgWidthMm, setGenBgWidthMm] = useState(86)
  const [genBgHeightMm, setGenBgHeightMm] = useState(54)
  const [genBgImageFile, setGenBgImageFile] = useState<File | null>(null)
  const [genBgLoading, setGenBgLoading] = useState(false)
  // The image can come from a local file picker or a remote URL (sub-toggle).
  const [genBgImageSource, setGenBgImageSource] = useState<'file' | 'url'>('file')
  const [genBgImageUrl, setGenBgImageUrl] = useState('')

  const [contourBackground, setContourBackground] = useState<PdfBackground | null>(null)
  const [contourBackgroundError, setContourBackgroundError] = useState<string | null>(null)
  const [contourOpacity, setContourOpacity] = useState(1.0)
  const [contourBlendMode, setContourBlendMode] = useState<BlendMode>('normal')
  const [contourSource, setContourSource] = useState<ContourSource>('upload')
  const [shapeKind, setShapeKind] = useState<ShapeKind>('circle')
  const [shapeInsetMm, setShapeInsetMm] = useState(2)
  const [shapeCornerRadiusMm, setShapeCornerRadiusMm] = useState(3)
  const [shapeCornerOrientation, setShapeCornerOrientation] = useState<CornerOrientation>('out')
  const [shapeError, setShapeError] = useState<string | null>(null)
  // Nudge the contour within the background (right/up positive, mm). Clamped so
  // the contour box stays fully inside the background — see contourOffsetMax*.
  const [contourOffsetXMm, setContourOffsetXMm] = useState(0)
  const [contourOffsetYMm, setContourOffsetYMm] = useState(0)

  const [sampleText, setSampleText] = useState('')
  const [words, setWords] = useState<WordStyle[]>(() => resizeWords([], splitWords('', '')))
  const [fonts, setFonts] = useState<(LoadedFont | null)[]>(() => resizeFonts([], words.length))
  const [fontSources, setFontSources] = useState<FontSource[]>(() => resizeFontSources([], words.length))
  const [googleFontSelections, setGoogleFontSelections] = useState<(GoogleFontSelection | null)[]>(() =>
    resizeGoogleFontSelections([], words.length),
  )
  const [fontsError, setFontsError] = useState<string | null>(null)
  const [fontsNotice, setFontsNotice] = useState<string | null>(null)
  const [safeMarginMm, setSafeMarginMm] = useState(0)
  const [backgroundPaddingMm, setBackgroundPaddingMm] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  // While true, code/text colors auto-track a contrasting color over a simple
  // colored background so they stay visible. Turns off once the user picks a
  // text color (or loads a preset), after which their choices are kept.
  const [autoTextColor, setAutoTextColor] = useState(true)

  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  // User-editable target card dimensions for an uploaded background PDF.
  // NaN = no override; pre-filled with the detected MediaBox on file load.
  const [bgTargetWidthMm, setBgTargetWidthMm] = useState<number>(NaN)
  const [bgTargetHeightMm, setBgTargetHeightMm] = useState<number>(NaN)
  // When locked, the target width/height inputs keep the uploaded PDF's original
  // aspect ratio; editing one derives the other. Unlocked lets them move freely.
  const [lockAspect, setLockAspect] = useState(true)
  // User-applied rotation of the uploaded background (0/90/180/270, clockwise),
  // baked into both the preview and the generated output.
  const [bgRotation, setBgRotation] = useState(0)
  // Multi-page PDF page selection (1-based). The page count drives whether the
  // page stepper is shown; the page number is sent to the generator so the print
  // output uses the same page as the preview.
  const [backgroundPageNumber, setBackgroundPageNumber] = useState(1)
  const [backgroundPageCount, setBackgroundPageCount] = useState(1)
  const [contourBackgroundFile, setContourBackgroundFile] = useState<File | null>(null)
  const [contourPageNumber, setContourPageNumber] = useState(1)
  const [contourPageCount, setContourPageCount] = useState(1)
  // User-editable target size for an uploaded contour PDF (NaN = no override,
  // pre-filled with the detected MediaBox on load), plus a lock that keeps the
  // contour's aspect ratio and a rotation (0/90/180/270, clockwise) — the same
  // resize/switch/rotate machinery the background upload uses. The contour-only
  // cut job applies these through the background pipeline (scale + /Rotate); the
  // combine overlay applies them in build_overlay.
  const [contourTargetWidthMm, setContourTargetWidthMm] = useState<number>(NaN)
  const [contourTargetHeightMm, setContourTargetHeightMm] = useState<number>(NaN)
  const [contourLockAspect, setContourLockAspect] = useState(true)
  const [contourRotation, setContourRotation] = useState(0)
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
  const [codeDataMode, setCodeDataMode] = useState<CodeDataMode>('generate')
  const [uploadedCsvPreview, setUploadedCsvPreview] = useState('')
  const [uploadedCsvRowCount, setUploadedCsvRowCount] = useState(0)
  const [uploadedCsvInfo, setUploadedCsvInfo] = useState<string | null>(null)
  const [uploadedCsvWarnings, setUploadedCsvWarnings] = useState<string[]>([])
  // The raw file the user uploaded, kept so a manual separator correction can
  // re-parse it with the forced delimiter.
  const [uploadedRawFile, setUploadedRawFile] = useState<File | null>(null)
  const [presetError, setPresetError] = useState<string | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [codeRowCount, setCodeRowCount] = useState(10)
  const [codeSeparator, setCodeSeparator] = useState(SEPARATOR_DEFAULT)
  const [codeColumns, setCodeColumns] = useState<CodeColumnConfig[]>([defaultCodeColumn()])
  // For an uploaded CSV whose delimiter was auto-detected wrongly: the raw parsed
  // rows, plus the gap indices the user merged back into one field (so a value
  // like "1A 1" mis-split into ["1A","1"] becomes a single field again).
  const [uploadedRows, setUploadedRows] = useState<string[][]>([])
  const [codeFieldMerges, setCodeFieldMerges] = useState<number[]>([])
  // When true, each uploaded row is treated as one code: every field on the row
  // is re-joined into a single value. This handles label CSVs (e.g. "Rasol cu
  // mușchi") that the delimiter auto-detect over-split on spaces, which would
  // otherwise yield rows with more words than the configured styles. Auto-enabled
  // when a freshly parsed file has rows with differing field counts (ragged).
  const [codeSingleField, setCodeSingleField] = useState(false)
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

  // Effective contour size: the user's target override when set (upload or preset
  // shape), otherwise the rendered contour's own size. Drives the preview scale
  // and the offset room, mirroring effectiveCard* for the background.
  const effectiveContourWidthMm = contourBackground && isFinite(contourTargetWidthMm) && contourTargetWidthMm > 0
    ? contourTargetWidthMm
    : (contourBackground ? contourBackground.widthPt / MM : 0)
  const effectiveContourHeightMm = contourBackground && isFinite(contourTargetHeightMm) && contourTargetHeightMm > 0
    ? contourTargetHeightMm
    : (contourBackground ? contourBackground.heightPt / MM : 0)
  // Whether a preset shape is still at its card-sized default (target ≈ card), so
  // its full-card page has the outline centred — vs resized smaller, where it
  // behaves like a normal sub-card contour.
  const contourShapeFullCard = contourSource === 'shape' && !!background
    && (!(isFinite(contourTargetWidthMm) && contourTargetWidthMm > 0)
      || (Math.abs(contourTargetWidthMm - effectiveCardWidthMm) < 0.1
        && Math.abs(contourTargetHeightMm - effectiveCardHeightMm) < 0.1))

  // Contour offset bounds: the contour must stay fully inside the background.
  // An uploaded contour PDF (or a resized preset shape) is anchored bottom-left,
  // so its slack is (card − contour) and offsets run 0→max. A card-sized preset
  // shape is drawn as its tight box — a circle only spans min(w, h) — centred
  // inside a full-card page, so the page leaves no slack; instead the room to
  // nudge is the margin on each side, and offsets run symmetrically −max→max.
  // This is what lets a circle on a non-square card move along its longer axis.
  const contourShapeBox = contourShapeFullCard
    ? contourBoxMm(shapeKind, effectiveCardWidthMm, effectiveCardHeightMm, shapeInsetMm)
    : null
  const contourOffsetMaxXMm = contourShapeBox
    ? Math.max(0, (effectiveCardWidthMm - contourShapeBox.w) / 2)
    : Math.max(0, effectiveCardWidthMm - effectiveContourWidthMm)
  const contourOffsetMaxYMm = contourShapeBox
    ? Math.max(0, (effectiveCardHeightMm - contourShapeBox.h) / 2)
    : Math.max(0, effectiveCardHeightMm - effectiveContourHeightMm)
  // A centred shape can move either way; a corner-anchored upload only forward.
  const contourOffsetMinXMm = contourShapeBox ? -contourOffsetMaxXMm : 0
  const contourOffsetMinYMm = contourShapeBox ? -contourOffsetMaxYMm : 0
  // Re-clamp at point-of-use so a later contour/size change can't leave a stale
  // out-of-range value reaching the preview or the generator.
  const clampedContourOffsetXMm = Math.min(Math.max(contourOffsetMinXMm, contourOffsetXMm), contourOffsetMaxXMm)
  const clampedContourOffsetYMm = Math.min(Math.max(contourOffsetMinYMm, contourOffsetYMm), contourOffsetMaxYMm)

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
        const yMm = verticalAlignYMm(word.valign, word, fontFamilyForWord(fonts, index), cardHeightMm, safeMarginMm)
        if (Math.abs(yMm - word.yMm) < 1e-6) return word
        changed = true
        return { ...word, yMm }
      })
      return changed ? next : prev
    })
  }, [fonts, background, effectiveCardHeightMm, safeMarginMm, words])

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
    setCodeFieldMerges([])
    setCodeSingleField(false)
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
    setCodeFieldMerges(gaps)
    applyUploadedCsvRows(uploadedRows, gaps, codeSeparator || ' ', codeSingleField)
  }

  // Toggle "each row is a single code" and re-build the downstream CSV.
  function handleSingleFieldChange(value: boolean) {
    setCodeSingleField(value)
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
    setCodeSeparator(parsed.delimiter)
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
    setCodeFieldMerges(merges)
    setCodeSingleField(singleField)
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
    setCodeDataMode(mode)
    // Clear the current CSV when switching so the gate re-opens cleanly.
    clearUploadedCsv()
    setCodeCsvStale(false)
  }

  function handleCodeRowCountChange(value: number) {
    setCodeRowCount(value)
    invalidateCsv()
  }

  function handleCodeColumnsChange(columns: CodeColumnConfig[]) {
    setCodeColumns(columns)
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

  function buildPresetBundleArgs(): [Preset, Parameters<typeof downloadPresetBundle>[2]] {
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
      shapeKind,
      shapeInsetMm,
      shapeCornerRadiusMm,
      shapeCornerOrientation,
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
        setSampleText(preset.sampleText ?? '')
        setCodeSeparator(preset.codeSeparator ?? '')
        if (typeof preset.codeRowCount === 'number') setCodeRowCount(preset.codeRowCount)
        if (Array.isArray(preset.codeColumns)) setCodeColumns(preset.codeColumns)
        const presetMerges = Array.isArray(preset.codeFieldMerges) ? preset.codeFieldMerges : []
        const presetSingleField = preset.codeSingleField === true
        setCodeFieldMerges(presetMerges)
        setCodeSingleField(presetSingleField)
        const length = preset.words.length
        setWords(preset.words.map((w, i) => ({ ...defaultWordStyle(i), ...w })))
        // The preset carries its own text colors; don't override them with the
        // background-contrast default.
        setAutoTextColor(false)
        setFonts(resizeFonts([], length))
        const sources = resizeFontSources(preset.fontSources ?? [], length)
        const selections = resizeGoogleFontSelections(preset.googleFontSelections ?? [], length)
        setFontSources(sources)
        setGoogleFontSelections(selections)
        setSelectedIndex(null)
        if (typeof preset.safeMarginMm === 'number') setSafeMarginMm(preset.safeMarginMm)
        if (typeof preset.backgroundPaddingMm === 'number') setBackgroundPaddingMm(preset.backgroundPaddingMm)
        if (typeof preset.contourOpacity === 'number') setContourOpacity(preset.contourOpacity)
        if (preset.contourBlendMode) setContourBlendMode(preset.contourBlendMode)
        if (typeof preset.contourOffsetXMm === 'number') setContourOffsetXMm(preset.contourOffsetXMm)
        if (typeof preset.contourOffsetYMm === 'number') setContourOffsetYMm(preset.contourOffsetYMm)
        if (preset.mode) setMode(preset.mode)
        if (preset.pageOptions) setPageOptions((prev) => ({ ...prev, ...preset.pageOptions }))
        const loadedBackgroundSource = preset.backgroundSource === 'simple' ? 'simple' : 'upload'
        setBackgroundSource(loadedBackgroundSource)
        if (typeof preset.simpleBgWidthMm === 'number') setSimpleBgWidthMm(preset.simpleBgWidthMm)
        if (typeof preset.simpleBgHeightMm === 'number') setSimpleBgHeightMm(preset.simpleBgHeightMm)
        if (preset.simpleBgColor === null || typeof preset.simpleBgColor === 'string') setSimpleBgColor(preset.simpleBgColor)
        if (preset.contourSource === 'upload' || preset.contourSource === 'shape') setContourSource(preset.contourSource)
        if (preset.shapeKind && SHAPE_OPTIONS.some((o) => o.value === preset.shapeKind)) setShapeKind(preset.shapeKind)
        if (typeof preset.shapeInsetMm === 'number') setShapeInsetMm(preset.shapeInsetMm)
        if (typeof preset.shapeCornerRadiusMm === 'number') setShapeCornerRadiusMm(preset.shapeCornerRadiusMm)
        if (preset.shapeCornerOrientation === 'in' || preset.shapeCornerOrientation === 'out')
          setShapeCornerOrientation(preset.shapeCornerOrientation)

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
          setBackgroundPageNumber(savedBgPage)
          renderPdfBackground(bgFile, savedBgPage)
            .then((bg) => {
              setBackground(bg)
              setBackgroundPageCount(bg.pageCount)
              setBackgroundPageNumber(Math.min(Math.max(1, savedBgPage), bg.pageCount))
            })
            .catch((err) => setBackgroundError(err instanceof Error ? err.message : String(err)))
        }
        if (contourFile && (preset.contourSource ?? 'upload') === 'upload') {
          setContourBackgroundFile(contourFile)
          setContourPageNumber(savedContourPage)
          renderPdfBackground(contourFile, savedContourPage)
            .then((bg) => {
              setContourBackground(bg)
              setContourPageCount(bg.pageCount)
              setContourPageNumber(Math.min(Math.max(1, savedContourPage), bg.pageCount))
            })
            .catch((err) => setContourBackgroundError(err instanceof Error ? err.message : String(err)))
        }
        const loadedDataMode: CodeDataMode = preset.codeDataMode === 'upload' ? 'upload' : 'generate'
        setCodeDataMode(loadedDataMode)
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
    setBgTargetWidthMm(NaN)
    setBgTargetHeightMm(NaN)
    setBgRotation(0)
    setBackgroundPageNumber(1)
    setBackgroundPageCount(1)
    if (!file) return
    renderPdfBackground(file)
      .then(async (bg) => {
        setBackground(bg)
        setBackgroundPageCount(bg.pageCount)
        setBgTargetWidthMm(bg.widthPt / MM)
        setBgTargetHeightMm(bg.heightPt / MM)
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
    setBackgroundPageNumber(page)
    setBackgroundError(null)
    renderPdfBackground(backgroundFile, page, bgRotation)
      .then((bg) => {
        setBackground(bg)
        setBgTargetWidthMm(bg.widthPt / MM)
        setBgTargetHeightMm(bg.heightPt / MM)
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
    setBgRotation(next)
    if (backgroundSource === 'generate') {
      const w = genBgWidthMm
      setGenBgWidthMm(genBgHeightMm)
      setGenBgHeightMm(w)
    } else {
      const w = bgTargetWidthMm
      setBgTargetWidthMm(bgTargetHeightMm)
      setBgTargetHeightMm(w)
    }
    setBackgroundError(null)
    renderPdfBackground(backgroundFile, backgroundPageNumber, next)
      .then(setBackground)
      .catch((err) => setBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  function handleBackgroundSourceChange(source: BackgroundSource) {
    setBackgroundSource(source)
    setBackgroundError(null)
    // Upload and generate both start from an empty background until the user
    // provides input (a PDF / an image); simple instead regenerates from its
    // dimensions+color via the effect below. (A kept `genBgImageFile` lets the
    // generate effect re-render if the user returns to that source.)
    if (source !== 'simple') {
      setBackground(null)
      setBackgroundFile(null)
      setBgTargetWidthMm(NaN)
      setBgTargetHeightMm(NaN)
      setBgRotation(0)
      setBackgroundPageNumber(1)
      setBackgroundPageCount(1)
    }
    if (source !== 'generate') {
      setGenBgImageFile(null)
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
    setBgRotation(0)
    if (!file) return
    createImageBitmap(file)
      .then((bmp) => {
        const a = bmp.width / bmp.height
        if (typeof bmp.close === 'function') bmp.close()
        if (a > 0) setGenBgHeightMm(Math.round((genBgWidthMm / a) * 100) / 100)
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
      const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
      const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
      const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
      if (!isPng && !isJpeg) throw new Error('Doar imagini PNG sau JPEG sunt acceptate.')
      const type = isPng ? 'image/png' : 'image/jpeg'
      const name = url.split('/').pop()?.split('?')[0] || (isPng ? 'fundal.png' : 'fundal.jpg')
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

  // Build a print background PDF from a raster image (PNG/JPEG) whenever the
  // "create background" source is active and the image / dimensions change,
  // feeding it through the same `backgroundFile`/`background` pipeline as an
  // uploaded PDF. Unlike the simple source there's no shortcut swatch — the
  // produced PDF is rasterised via `renderPdfBackground` for the preview.
  useEffect(() => {
    if (backgroundSource !== 'generate' || !genBgImageFile) return
    let cancelled = false
    setGenBgLoading(true)
    setBackgroundError(null)
    ensureWasmInit()
      .then(async () => {
        // Build the image PDF once at the image's own aspect (normalized width);
        // `genBgWidthMm/HeightMm` is the *target* card size (applied as a scale at
        // generation) and `bgRotation` the rotation — exactly like an uploaded PDF,
        // so both sources share the same rotate/scale/override machinery and the
        // build no longer rebuilds on dimension/rotation changes.
        const bmp = await createImageBitmap(genBgImageFile)
        const aspect = bmp.width / bmp.height
        if (typeof bmp.close === 'function') bmp.close()
        const refW = 100
        const refH = aspect > 0 ? 100 / aspect : 100
        const imageBytes = new Uint8Array(await genBgImageFile.arrayBuffer())
        const bytes = generate_image_background_pdf(imageBytes, refW, refH)
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
  }, [backgroundSource, genBgImageFile])

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

  function handleContourBackgroundFileChange(file: File | null) {
    setContourBackground(null)
    setContourBackgroundError(null)
    setContourBackgroundFile(file)
    setContourPageNumber(1)
    setContourPageCount(1)
    setContourTargetWidthMm(NaN)
    setContourTargetHeightMm(NaN)
    setContourRotation(0)
    if (!file) return
    // When the contour reuses the same PDF as the background (Step 1), default to
    // a DIFFERENT page than the one chosen for the background: a multi-page PDF
    // usually carries the print design and the cut outline on separate pages.
    const sameAsBackground = backgroundFile != null && isSameFile(file, backgroundFile)
    const prefill = (bg: PdfBackground) => {
      setContourBackground(bg)
      setContourTargetWidthMm(bg.widthPt / MM)
      setContourTargetHeightMm(bg.heightPt / MM)
    }
    renderPdfBackground(file)
      .then((bg) => {
        setContourPageCount(bg.pageCount)
        // Pick a page other than the background's: prefer the next page, fall back
        // to the previous one when the background is on the last page, and settle
        // for the background's own page when there's no other (single-page PDF).
        const contourPage = sameAsBackground ? pickDistinctPage(backgroundPageNumber, bg.pageCount) : 1
        if (sameAsBackground && contourPage !== 1) {
          setContourPageNumber(contourPage)
          return renderPdfBackground(file, contourPage).then(prefill)
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
    setContourPageNumber(page)
    setContourBackgroundError(null)
    renderPdfBackground(contourBackgroundFile, page, contourRotation)
      .then((bg) => {
        setContourBackground(bg)
        setContourTargetWidthMm(bg.widthPt / MM)
        setContourTargetHeightMm(bg.heightPt / MM)
      })
      .catch((err) => setContourBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  // Rotate the uploaded contour by another 90° clockwise (cycling 0→90→180→270),
  // mirroring rotateBackground: re-render the preview rotated and transpose the
  // target dimensions so the contour box follows the new orientation.
  function rotateContour() {
    if (!contourBackgroundFile) return
    const next = (contourRotation + 90) % 360
    setContourRotation(next)
    const w = contourTargetWidthMm
    setContourTargetWidthMm(contourTargetHeightMm)
    setContourTargetHeightMm(w)
    setContourBackgroundError(null)
    // A preset shape's generation effect depends on contourRotation and re-renders
    // the rotated outline itself; only the uploaded file needs a manual re-render.
    if (contourSource === 'upload') {
      renderPdfBackground(contourBackgroundFile, contourPageNumber, next)
        .then(setContourBackground)
        .catch((err) => setContourBackgroundError(err instanceof Error ? err.message : String(err)))
    }
  }

  function handleContourSourceChange(source: ContourSource) {
    setContourSource(source)
    setShapeError(null)
    // Reset the resize/rotate overrides on every switch so the new source starts
    // from its own detected/card size (upload re-detects on load; the preset
    // shape re-prefills to the card size in its generation effect).
    setContourTargetWidthMm(NaN)
    setContourTargetHeightMm(NaN)
    setContourRotation(0)
    // A freshly selected preset shape starts full-card (auto-tracks the card).
    contourShapeTargetAutoRef.current = true
    if (source === 'upload') {
      setContourBackground(null)
      setContourBackgroundFile(null)
      setContourBackgroundError(null)
      setContourPageNumber(1)
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
        ? contourBoxMm(shapeKind, prev.w, prev.h, shapeInsetMm)
        : { x: 0, y: 0, w: prev.w, h: prev.h }
      const newBox = useContour
        ? contourBoxMm(shapeKind, w, h, shapeInsetMm)
        : { x: 0, y: 0, w, h }
      // Skip a degenerate box (e.g. inset ≥ half a side) to avoid divide-by-zero.
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
  }, [effectiveCardWidthMm, effectiveCardHeightMm, contourSource, shapeKind, shapeInsetMm])

  // Whether a preset shape's target box is still auto-tracking the card (so it
  // stays full-card as the background is resized) vs. explicitly resized by the
  // user (then it's preserved). A ref so flipping it doesn't re-run the shape
  // effect; the effect reads it at run time.
  const contourShapeTargetAutoRef = useRef(true)

  // Generate a preset-shape contour PDF whenever the shape source is active
  // and the shape/inset/corner-radius/card size changes, feeding it through
  // the same `contourBackgroundFile` pipeline as an uploaded contour PDF.
  useEffect(() => {
    if (contourSource !== 'shape' || !background) return
    let cancelled = false
    const cardWidthMm = effectiveCardWidthMm
    const cardHeightMm = effectiveCardHeightMm
    // Stroke the preset-shape contour in magenta (CMYK 0:1:0:0) — the
    // conventional cut-line colour, and visible over most backgrounds.
    const strokeColor = '0:1:0:0'
    ensureWasmInit()
      .then(() => {
        const bytes = generate_shape_pdf(cardWidthMm, cardHeightMm, shapeKind, shapeInsetMm, shapeCornerRadiusMm, shapeCornerOrientation, strokeColor)
        const file = new File([bytes.buffer as ArrayBuffer], `${shapeKind}.pdf`, { type: 'application/pdf' })
        if (cancelled) return null
        setContourBackgroundFile(file)
        // Render rotated so the preview matches the cut/overlay, which bake the
        // same rotation — the generated shape is treated exactly like an uploaded
        // contour PDF for resize/rotate.
        return renderPdfBackground(file, 1, contourRotation)
      })
      .then((bg) => {
        if (!cancelled && bg) {
          setContourBackground(bg)
          setContourPageNumber(1)
          setContourPageCount(1)
          setShapeError(null)
          // Prefill the target box to the shape's own (card) size the first time,
          // so the resize controls show real numbers; a later user resize/rotate
          // (non-NaN) is preserved across shape/inset/card tweaks. The shape is
          // always generated at the card size; the target only scales it. While
          // auto-tracking, the synchronous effect below keeps the target equal to
          // the card as it's resized (this async path would lag a card change).
          setContourTargetWidthMm((v) => (isFinite(v) && v > 0 ? v : cardWidthMm))
          setContourTargetHeightMm((v) => (isFinite(v) && v > 0 ? v : cardHeightMm))
        }
      })
      .catch((err) => {
        if (!cancelled) setShapeError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [contourSource, shapeKind, shapeInsetMm, shapeCornerRadiusMm, shapeCornerOrientation, contourRotation, background, backgroundSource, simpleBgColor, effectiveCardWidthMm, effectiveCardHeightMm])

  // Keep an auto-tracking preset shape's target box equal to the card as the
  // background is resized — synchronously, so the contour offset never references
  // the previous card size while the async shape rebuild above is in flight. Once
  // the user resizes the contour (ref flips off) this stops and their size sticks.
  useEffect(() => {
    if (contourSource !== 'shape' || !background || !contourShapeTargetAutoRef.current) return
    setContourTargetWidthMm(effectiveCardWidthMm)
    setContourTargetHeightMm(effectiveCardHeightMm)
  }, [contourSource, background, effectiveCardWidthMm, effectiveCardHeightMm])

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
    setSampleText(value)
    const texts = presplit ?? splitWords(value, separator)
    setWords((prev) => resizeWords(prev, texts))
    setFonts((prev) => resizeFonts(prev, texts.length))
    setFontSources((prev) => resizeFontSources(prev, texts.length))
    setGoogleFontSelections((prev) => resizeGoogleFontSelections(prev, texts.length))
  }

  function handleCodeSeparatorChange(value: string) {
    setCodeSeparator(value)
    // The split structure changes, so previously chosen merges no longer line up.
    setCodeFieldMerges([])
    if (codeDataMode === 'generate') {
      invalidateCsv()
    } else if (uploadedRawFile && value.length > 0) {
      // Manual override after auto-detection: re-parse the original file with
      // the corrected delimiter so fields split (and re-join) correctly.
      void ingestCsvFile(uploadedRawFile, value)
    }
  }

  function updateWord(index: number, next: Partial<WordStyle>) {
    setWords((prev) => prev.map((w, i) => (i === index ? { ...w, ...next } : w)))
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
      // Contour resize/rotate (uploaded PDF or preset shape alike). For the
      // standalone cut the contour PDF *is* the background, so these feed
      // cardWidth/Height + backgroundRotation; for the combine overlay they ride
      // the dedicated contour* options so `build_overlay` applies the same transform.
      const contourWidthOverride = isFinite(contourTargetWidthMm) && contourTargetWidthMm > 0 ? contourTargetWidthMm : null
      const contourHeightOverride = isFinite(contourTargetHeightMm) && contourTargetHeightMm > 0 ? contourTargetHeightMm : null
      // "Combină paginile" (combine) overlays the contour onto the print pages as
      // a view-only (non-printing) layer. It works in both decupare (grid) and
      // no-cut mode. Require a loaded contour: the overlay needs the contour bytes
      // (and `build_overlay` errors without them), so this also keeps a stale
      // combine flag from failing generation when no contour is present.
      const combine = pageOptions.combine === true && contourBackgroundFile != null
      // Page picks from multi-page uploads. The print background uses
      // `backgroundPageNumber`; for the combine overlay the contour PDF's page is
      // also sent on the print options. The contour job loads the contour PDF as
      // its background, so its page is passed there as `backgroundPageNumber`.
      // Contour offset (clamped to keep the contour inside the background). When
      // a nonzero offset is set, send the background card size as the contour
      // "canvas" so the no-cut cut page is sized to the background (a smaller,
      // offset contour then cuts in the right place); otherwise leave it so the
      // contour keeps its own page size (unchanged behaviour).
      const contourOffsetActive = clampedContourOffsetXMm !== 0 || clampedContourOffsetYMm !== 0
      const contourCanvasWMm = contourOffsetActive ? effectiveCardWidthMm : undefined
      const contourCanvasHMm = contourOffsetActive ? effectiveCardHeightMm : undefined
      const printOptions = needsPrintInput
        ? buildJsOptions(words, effectiveSeparator, safeMarginMm, backgroundPaddingMm, pageOptions, false, bgWidthOverride, bgHeightOverride, backgroundPageNumber, combine ? contourPageNumber : undefined, combine ? clampedContourOffsetXMm : undefined, combine ? clampedContourOffsetYMm : undefined, undefined, undefined, bgRotation, combine ? contourWidthOverride : undefined, combine ? contourHeightOverride : undefined, combine ? contourRotation : undefined)
        : null
      const contourIsGrid = contourSource === 'shape' && shapeKind === 'rectangle' && shapeInsetMm === 0
      const contourOptions = needsContourInput
        // The contour job loads the contour PDF as its background, so its page is
        // the 9th arg (backgroundPageNumber) and its resize/rotate ride the
        // background slots: cardWidth/Height (7th/8th) and backgroundRotation
        // (15th). The 10th (contourPageNumber, only for the combine overlay) is
        // unused here — undefined so the offset/canvas args land in their slots.
        ? { ...buildJsOptions(words, effectiveSeparator, safeMarginMm, backgroundPaddingMm, pageOptions, true, contourWidthOverride, contourHeightOverride, contourPageNumber, undefined, clampedContourOffsetXMm, clampedContourOffsetYMm, contourCanvasWMm, contourCanvasHMm, contourRotation), ...(contourIsGrid ? { contourAsGrid: true } : {}) }
        : null

      const background = needsPrintInput ? await backgroundFile!.arrayBuffer() : new ArrayBuffer(0)
      const contour =
        (needsContourInput || combine) && contourBackgroundFile ? await contourBackgroundFile.arrayBuffer() : null
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
          pagesPerBatch: PAGES_PER_BATCH,
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
      const sampleCombine = contourBackgroundFile != null
      const contourWidthOverride = isFinite(contourTargetWidthMm) && contourTargetWidthMm > 0 ? contourTargetWidthMm : null
      const contourHeightOverride = isFinite(contourTargetHeightMm) && contourTargetHeightMm > 0 ? contourTargetHeightMm : null
      // Force a single isolated card (no-cut) with the contour overlaid.
      const samplePageOptions = { ...pageOptions, noCut: true, combine: sampleCombine }
      const printOptions = buildJsOptions(
        words, effectiveSeparator, safeMarginMm, backgroundPaddingMm, samplePageOptions, false,
        bgWidthOverride, bgHeightOverride, backgroundPageNumber,
        sampleCombine ? contourPageNumber : undefined,
        sampleCombine ? clampedContourOffsetXMm : undefined,
        sampleCombine ? clampedContourOffsetYMm : undefined,
        undefined, undefined, bgRotation,
        sampleCombine ? contourWidthOverride : undefined,
        sampleCombine ? contourHeightOverride : undefined,
        sampleCombine ? contourRotation : undefined,
      )

      await ensureWasmInit()
      const bgBytes = new Uint8Array(await backgroundFile.arrayBuffer())
      const contourBytes = sampleCombine ? new Uint8Array(await contourBackgroundFile!.arrayBuffer()) : undefined
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">pdfcodes preview</h1>
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
                { value: 'generate', label: 'Crează fundal' },
              ]}
            />
            {backgroundSource === 'upload' ? (
              <>
                <FileField
                  label="PDF de fundal (un card)"
                  accept="application/pdf"
                  onChange={(files) => handleBackgroundFileChange(files?.[0] ?? null)}
                />
                {backgroundPageCount > 1 && (
                  <NumberField
                    label={`Pagina (1–${backgroundPageCount})`}
                    value={backgroundPageNumber}
                    onChange={handleBackgroundPageChange}
                  />
                )}
              </>
            ) : backgroundSource === 'simple' ? (
              <>
                <LinkedDimensions
                  widthLabel="Lățime (mm)"
                  heightLabel="Înălțime (mm)"
                  width={simpleBgWidthMm}
                  height={simpleBgHeightMm}
                  onWidth={setSimpleBgWidthMm}
                  onHeight={setSimpleBgHeightMm}
                  // No source artwork — lock keeps the ratio currently set.
                  aspect={simpleBgWidthMm / simpleBgHeightMm}
                  locked={lockAspect}
                  onToggleLock={() => setLockAspect((v) => !v)}
                />
                <ColorField
                  label="Culoare fundal (opțional)"
                  value={simpleBgColor}
                  onChange={setSimpleBgColor}
                  allowNone
                  noneLabel="fără culoare"
                />
              </>
            ) : (
              <>
                <RadioGroupField<'file' | 'url'>
                  label="Sursă imagine"
                  value={genBgImageSource}
                  onChange={setGenBgImageSource}
                  options={[
                    { value: 'file', label: 'Fișier local' },
                    { value: 'url', label: 'URL' },
                  ]}
                />
                {genBgImageSource === 'file' ? (
                  <FileField
                    label="Imagine fundal (PNG sau JPEG)"
                    accept="image/png,image/jpeg"
                    onChange={(files) => handleGenBgImageChange(files?.[0] ?? null)}
                  />
                ) : (
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <TextField
                        label="URL imagine (PNG sau JPEG)"
                        value={genBgImageUrl}
                        onChange={setGenBgImageUrl}
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
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Imaginea este întinsă pentru a umple cardul la dimensiunile țintă de mai jos.
                </p>
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
                  onWidth={setBgTargetWidthMm}
                  onHeight={setBgTargetHeightMm}
                  // Live target ratio (starts at the PDF's detected ratio) so the
                  // lock follows the orientation after a swap or rotation.
                  aspect={bgTargetWidthMm / bgTargetHeightMm}
                  locked={lockAspect}
                  onToggleLock={() => setLockAspect((v) => !v)}
                  onSwap={() => {
                    const w = bgTargetWidthMm
                    setBgTargetWidthMm(bgTargetHeightMm)
                    setBgTargetHeightMm(w)
                  }}
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={rotateBackground}
                    title="Rotește fundalul cu 90° (portret ⇄ peisaj)"
                    className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    ↻ Rotește 90°
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">Rotație: {bgRotation}°</span>
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
                  onWidth={setGenBgWidthMm}
                  onHeight={setGenBgHeightMm}
                  // Live target ratio (starts at the image's aspect) so the lock
                  // follows the orientation after a swap or rotation.
                  aspect={genBgWidthMm / genBgHeightMm}
                  locked={lockAspect}
                  onToggleLock={() => setLockAspect((v) => !v)}
                  onSwap={() => {
                    const w = genBgWidthMm
                    setGenBgWidthMm(genBgHeightMm)
                    setGenBgHeightMm(w)
                  }}
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={rotateBackground}
                    title="Rotește imaginea cu 90° (portret ⇄ peisaj)"
                    className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    ↻ Rotește 90°
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">Rotație: {bgRotation}°</span>
                </div>
              </>
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
                />
                {contourPageCount > 1 && (
                  <NumberField
                    label={`Pagina contur (1–${contourPageCount})`}
                    value={contourPageNumber}
                    onChange={handleContourPageChange}
                  />
                )}
              </>
            ) : (
              <>
                <SelectField
                  label="Formă"
                  value={shapeKind}
                  options={SHAPE_OPTIONS}
                  onChange={setShapeKind}
                />
                <NumberField label="Margine interioară (mm)" value={shapeInsetMm} onChange={setShapeInsetMm} />
                {shapeKind === 'rounded-rectangle' && (
                  <>
                    <NumberField label="Raza colțurilor (mm)" value={shapeCornerRadiusMm} onChange={setShapeCornerRadiusMm} />
                    <SelectField
                      label="Orientare"
                      value={shapeCornerOrientation}
                      options={CORNER_ORIENTATION_OPTIONS}
                      onChange={setShapeCornerOrientation}
                    />
                  </>
                )}
                {shapeKind === 'beveled-rectangle' && (
                  <NumberField label="Teșire colțuri (mm)" value={shapeCornerRadiusMm} onChange={setShapeCornerRadiusMm} />
                )}
                {!background && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Încarcă întâi PDF-ul de fundal pentru a genera forma.</p>
                )}
                {shapeError && <p className="text-sm text-red-600 dark:text-red-400">{shapeError}</p>}
              </>
            )}
            {contourBackgroundError && <p className="text-sm text-red-600 dark:text-red-400">{contourBackgroundError}</p>}
            {contourBackground && (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Dimensiune contur: {(contourBackground.widthPt / MM).toFixed(1)} × {(contourBackground.heightPt / MM).toFixed(1)} mm
                </p>
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
                      onWidth={(v) => { contourShapeTargetAutoRef.current = false; setContourTargetWidthMm(v) }}
                      onHeight={(v) => { contourShapeTargetAutoRef.current = false; setContourTargetHeightMm(v) }}
                      // Live target ratio (starts at the contour's detected ratio)
                      // so the lock follows the orientation after a swap or rotation.
                      aspect={contourTargetWidthMm / contourTargetHeightMm}
                      locked={contourLockAspect}
                      onToggleLock={() => setContourLockAspect((v) => !v)}
                      onSwap={() => {
                        contourShapeTargetAutoRef.current = false
                        const w = contourTargetWidthMm
                        setContourTargetWidthMm(contourTargetHeightMm)
                        setContourTargetHeightMm(w)
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
                  </>
                )}
                <NumberField label="Transparență contur (0-1)" value={contourOpacity} onChange={setContourOpacity} />
                <SelectField
                  label="Mod combinare contur"
                  value={contourBlendMode}
                  options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))}
                  onChange={setContourBlendMode}
                />
                {contourOffsetMaxXMm > 0 || contourOffsetMaxYMm > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
                      <NumberField
                        label={`Decalaj X contur (${contourOffsetMinXMm.toFixed(1)}–${contourOffsetMaxXMm.toFixed(1)} mm)`}
                        value={clampedContourOffsetXMm}
                        onChange={(v) => setContourOffsetXMm(Math.min(Math.max(contourOffsetMinXMm, v), contourOffsetMaxXMm))}
                      />
                      <NumberField
                        label={`Decalaj Y contur (${contourOffsetMinYMm.toFixed(1)}–${contourOffsetMaxYMm.toFixed(1)} mm)`}
                        value={clampedContourOffsetYMm}
                        onChange={(v) => setContourOffsetYMm(Math.min(Math.max(contourOffsetMinYMm, v), contourOffsetMaxYMm))}
                      />
                    </div>
                    {/* Snap the contour to the centre of its available room on each
                        axis: the midpoint of [min, max] (0 for a centred full-card
                        shape, (card − contour)/2 for a resized/corner-anchored one). */}
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Centrează:</span>
                      <button
                        type="button"
                        onClick={() => setContourOffsetXMm((contourOffsetMinXMm + contourOffsetMaxXMm) / 2)}
                        disabled={!(contourOffsetMaxXMm > contourOffsetMinXMm)}
                        title="Centrează conturul pe orizontală"
                        className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        ↔ Orizontal
                      </button>
                      <button
                        type="button"
                        onClick={() => setContourOffsetYMm((contourOffsetMinYMm + contourOffsetMaxYMm) / 2)}
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
              <NumberField label="Margine de siguranță (mm)" value={safeMarginMm} onChange={setSafeMarginMm} />
              <NumberField label="Padding fundal text (mm)" value={backgroundPaddingMm} onChange={setBackgroundPaddingMm} />
            </div>
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
              <div className="flex flex-wrap gap-3 border-t border-gray-200 pt-3 dark:border-gray-700 [&>*]:min-w-40 [&>*]:flex-1">
                <NumberField label="Dimensiune font (pt)" value={selected.fontSizePt} onChange={(v) => updateWord(selectedIndex, { fontSizePt: v })} />
                <NumberField label="Spațiere caractere (pt)" value={selected.charSpacingPt} onChange={(v) => updateWord(selectedIndex, { charSpacingPt: v })} step={0.1} />
                <SelectField<Align | 'custom'>
                  label="Aliniere orizontală"
                  warning={selected.xMm !== null ? 'Codurile lungi pot ieși în afara fundalului.' : undefined}
                  value={selected.xMm !== null ? 'custom' : selected.align}
                  onChange={(v) =>
                    v === 'custom'
                      ? updateWord(selectedIndex, {
                          xMm:
                            selected.xMm ??
                            (effectiveCardWidthMm > 0
                              ? horizontalAlignXMm(
                                  selected.align,
                                  selected,
                                  fontFamilyForWord(fonts, selectedIndex),
                                  effectiveCardWidthMm,
                                  safeMarginMm,
                                )
                              : 0),
                        })
                      : updateWord(selectedIndex, { align: v, xMm: null })
                  }
                  options={[
                    { value: 'left', label: 'stânga' },
                    { value: 'center', label: 'centru' },
                    { value: 'right', label: 'dreapta' },
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
                          )
                        : selected.yMm,
                    })
                  }
                  options={[
                    { value: 'top', label: 'sus' },
                    { value: 'middle', label: 'mijloc' },
                    { value: 'bottom', label: 'jos' },
                    { value: 'custom', label: 'la punct fix' },
                  ]}
                />
                <NumberField label="Y (mm)" value={selected.yMm} onChange={(v) => updateWord(selectedIndex, { yMm: v, valign: 'custom' })} />
                <NumberField
                  label="X (mm, gol = automat după aliniere)"
                  value={selected.xMm ?? NaN}
                  onChange={(v) => updateWord(selectedIndex, { xMm: Number.isNaN(v) ? null : v })}
                />
                <ColorField
                  label="Culoare text"
                  value={selected.color}
                  onChange={(v) => {
                    setAutoTextColor(false)
                    updateWord(selectedIndex, { color: v ?? '0:0:0:1' })
                  }}
                />
                <NumberField
                  label="Opacitate (0-1)"
                  value={selected.opacity}
                  onChange={(v) => updateWord(selectedIndex, { opacity: Math.min(Math.max(0, v), 1) })}
                />
                <SelectField
                  label="Mod îmbinare text"
                  value={selected.blendMode}
                  options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))}
                  onChange={(v) => updateWord(selectedIndex, { blendMode: v })}
                />
                <NumberField label="Rotație (grade)" value={selected.rotationDeg} onChange={(v) => updateWord(selectedIndex, { rotationDeg: v })} />
                <CheckboxField label="Oglindire X" checked={selected.flipX} onChange={(v) => updateWord(selectedIndex, { flipX: v })} />
                <CheckboxField label="Oglindire Y" checked={selected.flipY} onChange={(v) => updateWord(selectedIndex, { flipY: v })} />
                <ColorField
                  label="Fundal text"
                  value={selected.background}
                  allowNone
                  onChange={(v) => updateWord(selectedIndex, { background: v })}
                />
                {selected.background !== null && (
                  <>
                    <NumberField
                      label="Lățime fundal (mm, gol = automat)"
                      value={selected.backgroundWidthMm ?? NaN}
                      onChange={(v) => updateWord(selectedIndex, { backgroundWidthMm: Number.isNaN(v) ? null : v })}
                    />
                    <NumberField label="Transparență fundal (0-1)" value={selected.backgroundAlpha} onChange={(v) => updateWord(selectedIndex, { backgroundAlpha: v })} />
                    <SelectField
                      label="Mod îmbinare fundal"
                      value={selected.backgroundBlendMode}
                      options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))}
                      onChange={(v) => updateWord(selectedIndex, { backgroundBlendMode: v })}
                    />
                  </>
                )}
                <ColorField
                  label="Contur text"
                  value={selected.contourColor}
                  allowNone
                  noneLabel="fără contur"
                  onChange={(v) => updateWord(selectedIndex, { contourColor: v })}
                />
                {selected.contourColor !== null && (
                  <>
                    <NumberField label="Lățime contur (mm)" value={selected.contourWidthMm} onChange={(v) => updateWord(selectedIndex, { contourWidthMm: v })} />
                    <SelectField
                      label="Mod îmbinare contur"
                      value={selected.contourBlendMode}
                      options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))}
                      onChange={(v) => updateWord(selectedIndex, { contourBlendMode: v })}
                    />
                  </>
                )}
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
              </div>
            )}
          </Section>
          </>
          )}

          {step === 'date' && (
          <CodeSourceSection
            dataMode={codeDataMode}
            onDataModeChange={handleCodeDataModeChange}
            onCsvUpload={(f) => void handleCsvUpload(f)}
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
                  href={`mailto:braila.gabriel@gmail.com?subject=${encodeURIComponent('Cerere ofertă pdfcodes')}&body=${encodeURIComponent(
                    'Bună,\n\nAș dori o ofertă pentru proiectul meu. Am atașat fișierul .zip cu setările descărcat din pdfcodes preview.\n\n' +
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
                  <NumberField label="Decalaj X (mm)" value={pageOptions.offsetXMm} onChange={(v) => setPageOption('offsetXMm', v)} />
                  <NumberField label="Decalaj Y (mm)" value={pageOptions.offsetYMm} onChange={(v) => setPageOption('offsetYMm', v)} />
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
              {pageOptions.noCut ? (
                // "Combină paginile" needs a contour to overlay, so it only shows
                // in no-cut mode once a contour PDF is loaded.
                needsPrintInput &&
                contourBackgroundFile != null && (
                  <CheckboxField label="Combină paginile" checked={pageOptions.combine} onChange={(v) => setPageOption('combine', v)} />
                )
              ) : (
                <CheckboxField label="Combină paginile" checked={pageOptions.combine} onChange={(v) => setPageOption('combine', v)} />
              )}
              <CheckboxField label="Contururi de depanare" checked={pageOptions.debug} onChange={(v) => setPageOption('debug', v)} />
              {needsContourInput && (
                <CheckboxField label="Măsoară traseele de tăiere" checked={pageOptions.measurePaths} onChange={(v) => setPageOption('measurePaths', v)} />
              )}
            </div>
            {pageOptions.noCut && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Non-decupare: un card pe pagină, fără impunere și fără cercuri de reglaj.
                {needsPrintInput && contourBackgroundFile != null
                  ? ' „Combină paginile” suprapune conturul peste fundal ca strat vizibil pe ecran (neimprimabil).'
                  : ''}
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
                      cardWidthPt={effectiveCardWidthMm * MM}
                      cardHeightPt={effectiveCardHeightMm * MM}
                      contourImageUrl={contourBackground?.imageUrl ?? null}
                      contourWidthPt={effectiveContourWidthMm * MM}
                      contourHeightPt={effectiveContourHeightMm * MM}
                      contourOffsetXPt={clampedContourOffsetXMm * MM}
                      contourOffsetYPt={clampedContourOffsetYMm * MM}
                      contourOpacity={contourOpacity}
                      contourBlendMode={contourBlendMode}
                      words={words}
                      fonts={fonts}
                      safeMarginMm={safeMarginMm}
                      backgroundPaddingMm={backgroundPaddingMm}
                      selectedIndex={selectedIndex}
                      onSelect={setSelectedIndex}
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
                <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                  ⚠ {printArtifact.overflowCount}{' '}
                  {printArtifact.overflowCount === 1 ? 'text depășește' : 'texte depășesc'} lățimea cardului sau spațiul sigur
                  {printArtifact.overflowSamples.length > 0 && ` (ex: ${printArtifact.overflowSamples.join(', ')})`}.
                  {' '}Micșorați fontul, scurtați codul sau măriți cardul.
                </p>
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
