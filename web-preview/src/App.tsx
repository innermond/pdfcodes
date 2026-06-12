import { useState } from 'react'
import { CardCanvas } from './components/CardCanvas'
import { CheckboxField, ColorField, FileField, NumberField, Section, SelectField, TextField } from './components/fields'
import { loadFontFile, type LoadedFont } from './lib/fonts'
import { MM, defaultWordStyle, splitWords, toStyleStrings, type Align, type WordStyle } from './lib/options'
import { renderPdfBackground, type PdfBackground } from './lib/pdfBackground'
import { useTheme } from './lib/theme'

function resizeWords(words: WordStyle[], texts: string[]): WordStyle[] {
  return texts.map((text, index) => {
    const existing = words[index] ?? defaultWordStyle(index)
    return { ...existing, text }
  })
}

function resizeFonts(fonts: (LoadedFont | null)[], length: number): (LoadedFont | null)[] {
  return Array.from({ length }, (_, index) => fonts[index] ?? null)
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

  function handleBackgroundFileChange(file: File | null) {
    setBackground(null)
    setBackgroundError(null)
    if (!file) return
    renderPdfBackground(file)
      .then(setBackground)
      .catch((err) => setBackgroundError(err instanceof Error ? err.message : String(err)))
  }

  function handleContourBackgroundFileChange(file: File | null) {
    setContourBackground(null)
    setContourBackgroundError(null)
    if (!file) return
    renderPdfBackground(file)
      .then(setContourBackground)
      .catch((err) => setContourBackgroundError(err instanceof Error ? err.message : String(err)))
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
  const styleStrings = toStyleStrings(words, backgroundPaddingMm)

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
        Previzualizează poziționarea codurilor pe un fundal și ajustează valorile pentru secțiunea „Stil text”.
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

          <Section title="Valori pentru „Stil text”">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Copiază aceste valori în secțiunea „Stil text” din aplicația principală.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Dimensiuni font (pt)" value={styleStrings.fontSizes} onChange={() => {}} readOnly />
              <TextField label="Text Y (mm)" value={styleStrings.textYMm} onChange={() => {}} readOnly />
              <TextField label="Text X (mm)" value={styleStrings.textXMm} onChange={() => {}} readOnly />
              <TextField label="Aliniere" value={styleStrings.align} onChange={() => {}} readOnly />
              <TextField label="Culori text" value={styleStrings.textColors} onChange={() => {}} readOnly />
              <TextField label="Rotații (grade)" value={styleStrings.textRotations} onChange={() => {}} readOnly />
              <TextField label="Oglindire X" value={styleStrings.textFlipX} onChange={() => {}} readOnly />
              <TextField label="Oglindire Y" value={styleStrings.textFlipY} onChange={() => {}} readOnly />
              <TextField label="Fundaluri text" value={styleStrings.textBackgrounds} onChange={() => {}} readOnly />
              <TextField label="Padding fundal (mm)" value={styleStrings.textBackgroundPaddingMm} onChange={() => {}} readOnly />
              <TextField label="Lățimi fundal (mm)" value={styleStrings.textBackgroundWidthsMm} onChange={() => {}} readOnly />
              <TextField label="Transparențe fundal" value={styleStrings.textBackgroundAlphas} onChange={() => {}} readOnly />
            </div>
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
        </div>
      </div>
    </div>
  )
}
