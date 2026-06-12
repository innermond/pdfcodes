import { useState } from 'react'
import { CardCanvas } from './components/CardCanvas'
import { CheckboxField, ColorField, FileField, NumberField, RadioGroupField, Section, SelectField, TextField } from './components/fields'
import { ResultPanel } from './components/ResultPanel'
import { generatePdf, type GenerateResult } from './lib/generate'
import { loadFontFile, type LoadedFont } from './lib/fonts'
import { buildJsOptions, defaultPageOptions, MM, defaultWordStyle, splitWords, type Align, type PageOptions, type WordStyle } from './lib/options'
import { renderPdfBackground, type PdfBackground } from './lib/pdfBackground'
import { useTheme } from './lib/theme'

type Mode = 'print' | 'contour' | 'both'

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

  const [background, setBackground] = useState<PdfBackground | null>(null)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)

  const [contourBackground, setContourBackground] = useState<PdfBackground | null>(null)
  const [contourBackgroundError, setContourBackgroundError] = useState<string | null>(null)
  const [contourOpacity, setContourOpacity] = useState(0.5)

  const [sampleText, setSampleText] = useState('ABC123 Ion Popescu')
  const [splitChars, setSplitChars] = useState('')
  const [words, setWords] = useState<WordStyle[]>(() => resizeWords([], splitWords('ABC123 Ion Popescu', '')))
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

  function handleBackgroundFileChange(file: File | null) {
    setBackground(null)
    setBackgroundError(null)
    setBackgroundFile(file)
    if (!file) return
    renderPdfBackground(file)
      .then(setBackground)
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
              </>
            )}
          </Section>

          <Section title="Text exemplu">
            <TextField
              label="Rând CSV exemplu (cuvinte separate prin spațiu)"
              value={sampleText}
              onChange={handleSampleTextChange}
              placeholder="ABC123 Ion Popescu"
            />
            <TextField
              label="Caractere separator cuvinte (implicit: spațiu)"
              value={splitChars}
              onChange={handleSplitCharsChange}
              placeholder=" "
            />
            <div className="grid grid-cols-2 gap-3">
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
              <div className="grid grid-cols-2 gap-3 border-t border-gray-200 pt-3 dark:border-gray-700">
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
                  </>
                )}
                <div className="col-span-2">
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

          <Section title="Generare">
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
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Lățime pagină (mm)" value={pageOptions.hostWidthMm} onChange={(v) => setPageOption('hostWidthMm', v)} />
              <NumberField label="Înălțime pagină (mm)" value={pageOptions.hostHeightMm} onChange={(v) => setPageOption('hostHeightMm', v)} />
              <NumberField label="Decalaj X (mm)" value={pageOptions.offsetXMm} onChange={(v) => setPageOption('offsetXMm', v)} />
              <NumberField label="Decalaj Y (mm)" value={pageOptions.offsetYMm} onChange={(v) => setPageOption('offsetYMm', v)} />
              <NumberField label="Diametru cerc (mm)" value={pageOptions.circleDiameterMm} onChange={(v) => setPageOption('circleDiameterMm', v)} />
            </div>

            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Opțiuni</p>
            <div className="grid grid-cols-2 gap-3">
              <CheckboxField label="Combină paginile" checked={pageOptions.combine} onChange={(v) => setPageOption('combine', v)} />
              <CheckboxField label="Contururi de depanare" checked={pageOptions.debug} onChange={(v) => setPageOption('debug', v)} />
              {needsContourInput && (
                <CheckboxField label="Măsoară traseele de tăiere" checked={pageOptions.measurePaths} onChange={(v) => setPageOption('measurePaths', v)} />
              )}
            </div>

            {needsContourInput && pageOptions.measurePaths && (
              <>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Timp de tăiere</p>
                <div className="grid grid-cols-2 gap-3">
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
