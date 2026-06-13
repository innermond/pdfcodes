import { useEffect, useState } from 'react'
import { CardCanvas } from './components/CardCanvas'
import { CheckboxField, ColorField, FileField, NumberField, RadioGroupField, Section, SelectField, TextField } from './components/fields'
import { ResultPanel } from './components/ResultPanel'
import { generatePdf, type GenerateResult } from './lib/generate'
import { ensureDefaultFont, loadFontFile, type LoadedFont } from './lib/fonts'
import { buildJsOptions, BLEND_MODES, defaultPageOptions, MM, defaultWordStyle, splitWords, type Align, type BlendMode, type PageOptions, type WordStyle } from './lib/options'
import { renderPdfBackground, type PdfBackground } from './lib/pdfBackground'
import { randomWordFittingWidth } from './lib/randomWords'
import { useTheme } from './lib/theme'

type Mode = 'print' | 'contour' | 'both'

// User-configurable choices, saved to/loaded from a JSON file. Deliberately
// excludes binary uploads (background PDFs, fonts) and CSV data, which
// aren't representable as JSON and are provided separately per session.
interface Preset {
  version: 1
  sampleText: string
  splitChars: string
  words: WordStyle[]
  safeMarginMm: number
  backgroundPaddingMm: number
  contourOpacity: number
  contourBlendMode: BlendMode
  mode: Mode
  pageOptions: PageOptions
}

// UI-only gate for the "Generare" section. Not a security boundary — the
// password (and the generation logic itself) is fully visible/runnable from
// the client. Set VITE_GENERATE_PASSWORD to enable the gate; if unset, the
// section is always shown.
const GENERATE_PASSWORD = import.meta.env.VITE_GENERATE_PASSWORD as string | undefined
const GENERATE_UNLOCKED_KEY = 'pdfcodes-preview-generate-unlocked'

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function resizeWords(words: WordStyle[], texts: string[]): WordStyle[] {
  return texts.map((text, index) => {
    const existing = words[index] ?? defaultWordStyle(index)
    return { ...existing, text }
  })
}

function resizeFonts(fonts: (LoadedFont | null)[], length: number): (LoadedFont | null)[] {
  return Array.from({ length }, (_, index) => fonts[index] ?? null)
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

  useEffect(() => {
    void ensureDefaultFont()
  }, [])

  const [background, setBackground] = useState<PdfBackground | null>(null)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)

  const [contourBackground, setContourBackground] = useState<PdfBackground | null>(null)
  const [contourBackgroundError, setContourBackgroundError] = useState<string | null>(null)
  const [contourOpacity, setContourOpacity] = useState(0.5)
  const [contourBlendMode, setContourBlendMode] = useState<BlendMode>('multiply')

  const [sampleText, setSampleText] = useState('')
  const [splitChars, setSplitChars] = useState('')
  const [words, setWords] = useState<WordStyle[]>(() => resizeWords([], splitWords('', '')))
  const [fonts, setFonts] = useState<(LoadedFont | null)[]>(() => resizeFonts([], words.length))
  const [fontsError, setFontsError] = useState<string | null>(null)
  const [safeMarginMm, setSafeMarginMm] = useState(0)
  const [backgroundPaddingMm, setBackgroundPaddingMm] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  const [contourBackgroundFile, setContourBackgroundFile] = useState<File | null>(null)
  const [mode, setMode] = useState<Mode>('print')
  const [pageOptions, setPageOptions] = useState<PageOptions>(defaultPageOptions)
  const [printResult, setPrintResult] = useState<GenerateResult | null>(null)
  const [contourResult, setContourResult] = useState<GenerateResult | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [csvDataFile, setCsvDataFile] = useState<File | null>(null)
  const [presetError, setPresetError] = useState<string | null>(null)

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

  function handleSavePreset() {
    const preset: Preset = {
      version: 1,
      sampleText,
      splitChars,
      words,
      safeMarginMm,
      backgroundPaddingMm,
      contourOpacity,
      contourBlendMode,
      mode,
      pageOptions,
    }
    downloadJson('pdfcodes-preview-setari.json', preset)
  }

  function handleLoadPresetFile(file: File | null) {
    setPresetError(null)
    if (!file) return
    file.text()
      .then((text) => {
        const preset = JSON.parse(text) as Partial<Preset>
        if (!Array.isArray(preset.words)) {
          throw new Error('Fișier de setări invalid: lipsește lista de cuvinte.')
        }
        setSampleText(preset.sampleText ?? '')
        setSplitChars(preset.splitChars ?? '')
        setWords(preset.words.map((w, i) => ({ ...defaultWordStyle(i), ...w })))
        setFonts(resizeFonts([], preset.words.length))
        setSelectedIndex(null)
        if (typeof preset.safeMarginMm === 'number') setSafeMarginMm(preset.safeMarginMm)
        if (typeof preset.backgroundPaddingMm === 'number') setBackgroundPaddingMm(preset.backgroundPaddingMm)
        if (typeof preset.contourOpacity === 'number') setContourOpacity(preset.contourOpacity)
        if (preset.contourBlendMode) setContourBlendMode(preset.contourBlendMode)
        if (preset.mode) setMode(preset.mode)
        if (preset.pageOptions) setPageOptions((prev) => ({ ...prev, ...preset.pageOptions }))
      })
      .catch((err) => setPresetError(err instanceof Error ? err.message : String(err)))
  }

  function handleBackgroundFileChange(file: File | null) {
    setBackground(null)
    setBackgroundError(null)
    setBackgroundFile(file)
    if (!file) return
    renderPdfBackground(file)
      .then(async (bg) => {
        setBackground(bg)
        await ensureDefaultFont()
        const maxWidthPt = bg.widthPt * 0.9
        const separator = splitChars === '' ? ' ' : splitChars[0]
        const words = [defaultWordStyle(0), defaultWordStyle(1)]
          .map((style) => randomWordFittingWidth(maxWidthPt, style.fontSizePt))
          .join(separator)
        handleSampleTextChange(words)
      })
      .catch((err) => setBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  function handleContourBackgroundFileChange(file: File | null) {
    setContourBackground(null)
    setContourBackgroundError(null)
    setContourBackgroundFile(file)
    if (!file) return
    renderPdfBackground(file)
      .then(setContourBackground)
      .catch((err) => setContourBackgroundError(err instanceof Error ? err.message : String(err)))
  }

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

  function handleSampleTextChange(value: string) {
    setSampleText(value)
    const texts = splitWords(value, splitChars)
    setWords((prev) => resizeWords(prev, texts))
    setFonts((prev) => resizeFonts(prev, texts.length))
  }

  function handleSplitCharsChange(value: string) {
    setSplitChars(value)
    const texts = splitWords(sampleText, value)
    setWords((prev) => resizeWords(prev, texts))
    setFonts((prev) => resizeFonts(prev, texts.length))
  }

  function updateWord(index: number, next: Partial<WordStyle>) {
    setWords((prev) => prev.map((w, i) => (i === index ? { ...w, ...next } : w)))
  }

  const selected = selectedIndex !== null ? words[selectedIndex] : null

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
    try {
      const csvData = await csvDataFile.text()

      const nextPrintResult = needsPrintInput
        ? await generatePdf({
            csvData,
            backgroundFile: backgroundFile!,
            contourBackgroundFile,
            fontFiles: fontResult.files,
            options: buildJsOptions(words, splitChars, safeMarginMm, backgroundPaddingMm, pageOptions, false),
          })
        : null

      const nextContourResult = needsContourInput
        ? await generatePdf({
            csvData,
            backgroundFile: contourBackgroundFile!,
            contourBackgroundFile: null,
            fontFiles: fontResult.files,
            options: buildJsOptions(words, splitChars, safeMarginMm, backgroundPaddingMm, pageOptions, true),
          })
        : null

      setPrintResult(nextPrintResult)
      setContourResult(nextContourResult)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err))
      setPrintResult(null)
      setContourResult(null)
    } finally {
      setGenLoading(false)
    }
  }

  return (
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Section title="Fundal">
            <FileField
              label="PDF de fundal (un card)"
              accept="application/pdf"
              onChange={(files) => handleBackgroundFileChange(files?.[0] ?? null)}
            />
            {backgroundError && <p className="text-sm text-red-600 dark:text-red-400">{backgroundError}</p>}
            {background && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Dimensiune card: {(background.widthPt / MM).toFixed(1)} × {(background.heightPt / MM).toFixed(1)} mm
              </p>
            )}

            <FileField
              label="PDF de fundal contur (opțional)"
              accept="application/pdf"
              onChange={(files) => handleContourBackgroundFileChange(files?.[0] ?? null)}
            />
            {contourBackgroundError && <p className="text-sm text-red-600 dark:text-red-400">{contourBackgroundError}</p>}
            {contourBackground && (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Dimensiune contur: {(contourBackground.widthPt / MM).toFixed(1)} × {(contourBackground.heightPt / MM).toFixed(1)} mm
                </p>
                <NumberField label="Transparență contur (0-1)" value={contourOpacity} onChange={setContourOpacity} />
                <SelectField
                  label="Mod combinare contur"
                  value={contourBlendMode}
                  options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))}
                  onChange={setContourBlendMode}
                />
              </>
            )}
          </Section>

          <Section title="Text exemplu">
            <TextField
              label="Rând CSV exemplu (cuvinte separate prin spațiu)"
              value={sampleText}
              onChange={handleSampleTextChange}
            />
            <TextField
              label="Caractere separator cuvinte (implicit: spațiu)"
              value={splitChars}
              onChange={handleSplitCharsChange}
              placeholder=" "
            />
            <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
              <NumberField label="Margine de siguranță (mm)" value={safeMarginMm} onChange={setSafeMarginMm} />
              <NumberField label="Padding fundal text (mm)" value={backgroundPaddingMm} onChange={setBackgroundPaddingMm} />
            </div>
            {fontsError && <p className="text-sm text-red-600 dark:text-red-400">{fontsError}</p>}
          </Section>

          <Section title="Cuvinte">
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
                <SelectField<Align>
                  label="Aliniere"
                  value={selected.align}
                  onChange={(v) => updateWord(selectedIndex, { align: v, xMm: null })}
                  options={[
                    { value: 'left', label: 'stânga' },
                    { value: 'center', label: 'centru' },
                    { value: 'right', label: 'dreapta' },
                  ]}
                />
                <NumberField label="Y (mm)" value={selected.yMm} onChange={(v) => updateWord(selectedIndex, { yMm: v })} />
                <NumberField
                  label="X (mm, gol = automat după aliniere)"
                  value={selected.xMm ?? NaN}
                  onChange={(v) => updateWord(selectedIndex, { xMm: Number.isNaN(v) ? null : v })}
                />
                <ColorField label="Culoare text" value={selected.color} onChange={(v) => updateWord(selectedIndex, { color: v ?? '#000000' })} />
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
                  <FileField
                    key={selectedIndex}
                    label="Font pentru acest cuvânt (opțional)"
                    accept=".ttf,.otf,font/ttf,font/otf"
                    onChange={(files) => handleWordFontFileChange(selectedIndex, files?.[0] ?? null)}
                  />
                  {fonts[selectedIndex] && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{fonts[selectedIndex]?.fileName}</p>
                  )}
                </div>
              </div>
            )}
          </Section>

          <Section title="Setări">
            <div className="flex flex-wrap items-end gap-3">
              <button
                type="button"
                onClick={handleSavePreset}
                className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Salvează setările (JSON)
              </button>
              <FileField
                label="Încarcă setări (JSON)"
                accept="application/json,.json"
                onChange={(files) => handleLoadPresetFile(files?.[0] ?? null)}
              />
            </div>
            {presetError && <p className="text-sm text-red-600 dark:text-red-400">{presetError}</p>}
          </Section>

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

            <FileField
              label="Fișier CSV cu date (necesar pentru generare)"
              accept=".csv,text/csv"
              onChange={(files) => setCsvDataFile(files?.[0] ?? null)}
            />

            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Aspect pagină</p>
            <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
              <NumberField label="Lățime pagină (mm)" value={pageOptions.hostWidthMm} onChange={(v) => setPageOption('hostWidthMm', v)} />
              <NumberField label="Înălțime pagină (mm)" value={pageOptions.hostHeightMm} onChange={(v) => setPageOption('hostHeightMm', v)} />
              <NumberField label="Decalaj X (mm)" value={pageOptions.offsetXMm} onChange={(v) => setPageOption('offsetXMm', v)} />
              <NumberField label="Decalaj Y (mm)" value={pageOptions.offsetYMm} onChange={(v) => setPageOption('offsetYMm', v)} />
              <NumberField label="Diametru cerc (mm)" value={pageOptions.circleDiameterMm} onChange={(v) => setPageOption('circleDiameterMm', v)} />
            </div>

            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Opțiuni</p>
            <div className="flex flex-wrap gap-3 [&>*]:min-w-40 [&>*]:flex-1">
              <CheckboxField label="Combină paginile" checked={pageOptions.combine} onChange={(v) => setPageOption('combine', v)} />
              <CheckboxField label="Contururi de depanare" checked={pageOptions.debug} onChange={(v) => setPageOption('debug', v)} />
              {needsContourInput && (
                <CheckboxField label="Măsoară traseele de tăiere" checked={pageOptions.measurePaths} onChange={(v) => setPageOption('measurePaths', v)} />
              )}
            </div>

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

            <button
              type="button"
              onClick={handleGenerate}
              disabled={genLoading}
              className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {genLoading ? 'Se generează…' : 'Generează PDF'}
            </button>
            {genError && <p className="text-sm text-red-600 dark:text-red-400">{genError}</p>}
              </>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <Section title="Previzualizare">
            {background ? (
              <CardCanvas
                backgroundImageUrl={background.imageUrl}
                cardWidthPt={background.widthPt}
                cardHeightPt={background.heightPt}
                contourImageUrl={contourBackground?.imageUrl ?? null}
                contourWidthPt={contourBackground?.widthPt ?? 0}
                contourHeightPt={contourBackground?.heightPt ?? 0}
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
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">Încarcă un PDF de fundal pentru a vedea previzualizarea.</p>
            )}
          </Section>

          {(printResult || contourResult) && (
            <Section title="Rezultat">
              {printResult && <ResultPanel title="Print" result={printResult} downloadName="print.pdf" />}
              {contourResult && <ResultPanel title="Contur" result={contourResult} downloadName="contur.pdf" />}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
