import { useEffect, useMemo, useState } from 'react'
import { CheckboxField, FileField, NumberField, RadioGroupField, Section, TextField } from './components/fields'
import { generatePdf, type GenerateResult } from './lib/generate'
import { defaultFormState, type FormState } from './lib/options'
import { useTheme } from './lib/theme'

type Mode = 'print' | 'contour' | 'both'

function formatMetric(value: number | undefined, unit: string, digits = 2): string {
  if (value === undefined) return '—'
  return `${value.toFixed(digits)} ${unit}`
}

// Format a duration in seconds as `Ss`, `Mm Ss`, or `Hh Mm Ss`, dropping
// higher units that are zero.
function formatDuration(value: number | undefined): string {
  if (value === undefined) return '—'
  const totalSeconds = Math.max(0, Math.round(value))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function usePdfUrl(result: GenerateResult | null): string | null {
  const pdfUrl = useMemo(() => {
    if (!result) return null
    const blob = new Blob([result.pdf.slice().buffer], { type: 'application/pdf' })
    return URL.createObjectURL(blob)
  }, [result])

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [pdfUrl])

  return pdfUrl
}

function ResultPanel({ title, result, downloadName }: { title: string; result: GenerateResult; downloadName: string }) {
  const pdfUrl = usePdfUrl(result)

  // Cutting-time and path metrics only apply to the contour/cut-lines PDF —
  // the print sheet doesn't get measured or cut.
  const hasCuttingMetrics = result.timeCuttingPerCardS !== undefined

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <div className="grid grid-cols-2 gap-2 text-sm text-gray-700 dark:text-gray-300">
        <div>Carduri pe pagină: <span className="font-semibold">{result.cardsPerPage}</span></div>
        {hasCuttingMetrics && (
          <>
            <div>Lungime traseu / card: <span className="font-semibold">{formatMetric(result.pathLengthPerCardMm, 'mm')}</span></div>
            <div>Lungime traseu totală: <span className="font-semibold">{formatMetric(result.pathLengthTotalMm, 'mm')}</span></div>
            <div>Noduri / card: <span className="font-semibold">{result.nodeCountPerCard ?? '—'}</span></div>
            <div>Noduri total: <span className="font-semibold">{result.nodeCountTotal ?? '—'}</span></div>
            <div>Colțuri ascuțite / card: <span className="font-semibold">{result.sharpTurnCountPerCard ?? '—'}</span></div>
            <div>Colțuri ascuțite total: <span className="font-semibold">{result.sharpTurnCountTotal ?? '—'}</span></div>
            <div>Timp de tăiere / card: <span className="font-semibold">{formatDuration(result.timeCuttingPerCardS)}</span></div>
            <div>Timp de tăiere total: <span className="font-semibold">{formatDuration(result.timeCuttingTotalS)}</span></div>
          </>
        )}
      </div>

      {pdfUrl && (
        <div className="mt-2 flex flex-col gap-2">
          <a href={pdfUrl} download={downloadName} className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
            Descarcă {downloadName}
          </a>
          <iframe title={`Previzualizare ${title}`} src={pdfUrl} className="h-[600px] w-full rounded border border-gray-200 dark:border-gray-700" />
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const [form, setForm] = useState<FormState>(defaultFormState)
  const [mode, setMode] = useState<Mode>('print')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  const [contourBackgroundFile, setContourBackgroundFile] = useState<File | null>(null)
  const [fontFiles, setFontFiles] = useState<File[]>([])

  const [printResult, setPrintResult] = useState<GenerateResult | null>(null)
  const [contourResult, setContourResult] = useState<GenerateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const needsPrintInputs = mode === 'print' || mode === 'both'
  const needsContourInput = mode === 'contour' || mode === 'both'

  async function handleGenerate() {
    if (needsPrintInputs && !backgroundFile) {
      setError('Este necesar un PDF de fundal.')
      return
    }
    if (needsPrintInputs && !csvFile) {
      setError('Este necesar un fișier CSV.')
      return
    }
    if (needsContourInput && !contourBackgroundFile) {
      setError('Este necesar un PDF de fundal pentru contur.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const nextPrintResult = needsPrintInputs
        ? await generatePdf({
            form,
            contour: false,
            csvFile,
            backgroundFile: backgroundFile!,
            contourBackgroundFile,
            fontFiles,
          })
        : null

      const nextContourResult = needsContourInput
        ? await generatePdf({
            form,
            contour: true,
            // The contour PDF is a single sheet, but the CSV record count
            // (if available) scales the cutting-time estimate to every
            // sheet that needs to be cut.
            csvFile,
            backgroundFile: contourBackgroundFile!,
            contourBackgroundFile: null,
            fontFiles: [],
          })
        : null

      setPrintResult(nextPrintResult)
      setContourResult(nextContourResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPrintResult(null)
      setContourResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 dark:bg-gray-950 dark:text-gray-100">
      <div className="mb-1 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">pdfcodes</h1>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {theme === 'dark' ? 'Mod luminos' : 'Mod întunecat'}
        </button>
      </div>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        Generează PDF-uri cu grile de carduri și estimări ale timpului de tăiere dintr-un fișier CSV și un PDF de fundal.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Section title="Mod">
            <RadioGroupField<Mode>
              label="Ce se generează"
              value={mode}
              onChange={setMode}
              options={[
                {
                  value: 'print',
                  label: 'Doar print',
                  description: 'Generează PDF-ul cu foaia de printat din fundal și CSV.',
                },
                {
                  value: 'contour',
                  label: 'Doar contur',
                  description: 'Generează un PDF separat cu linii de tăiere (contur) din fundalul de contur.',
                },
                {
                  value: 'both',
                  label: 'Print + Contur',
                  description: 'Generează atât foaia de printat, cât și PDF-ul cu linii de tăiere (contur) corespunzător.',
                },
              ]}
            />
          </Section>

          <Section title="Fișiere">
            {needsPrintInputs && (
              <>
                <FileField
                  label="PDF de fundal (design pentru print)"
                  accept="application/pdf"
                  onChange={(files) => setBackgroundFile(files?.[0] ?? null)}
                />
                <FileField
                  label="Date CSV"
                  accept=".csv,text/csv"
                  onChange={(files) => setCsvFile(files?.[0] ?? null)}
                />
              </>
            )}
            <FileField
              label={
                needsContourInput
                  ? 'PDF de fundal pentru contur (fișier cu linii de tăiere)'
                  : 'PDF de fundal pentru contur (opțional, folosit pentru suprapunerea Combine și măsurarea timpului de tăiere)'
              }
              accept="application/pdf"
              onChange={(files) => setContourBackgroundFile(files?.[0] ?? null)}
            />
            {mode === 'contour' && (
              <FileField
                label="Date CSV (opțional, pentru a calcula timpul de tăiere pentru toate colile)"
                accept=".csv,text/csv"
                onChange={(files) => setCsvFile(files?.[0] ?? null)}
              />
            )}
            {needsPrintInputs && (
              <FileField
                label="Fonturi (opțional, câte unul pentru fiecare poziție de cuvânt)"
                accept=".ttf,.otf"
                multiple
                onChange={(files) => setFontFiles(files ? Array.from(files) : [])}
              />
            )}
          </Section>

          <Section title="Aspect pagină">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Lățime pagină (mm)" value={form.hostWidthMm} onChange={(v) => set('hostWidthMm', v)} />
              <NumberField label="Înălțime pagină (mm)" value={form.hostHeightMm} onChange={(v) => set('hostHeightMm', v)} />
              <NumberField label="Decalaj X (mm)" value={form.offsetXMm} onChange={(v) => set('offsetXMm', v)} />
              <NumberField label="Decalaj Y (mm)" value={form.offsetYMm} onChange={(v) => set('offsetYMm', v)} />
              <NumberField label="Diametru cerc (mm)" value={form.circleDiameterMm} onChange={(v) => set('circleDiameterMm', v)} />
              <NumberField label="Margine de siguranță (mm)" value={form.safeMarginMm} onChange={(v) => set('safeMarginMm', v)} />
            </div>
          </Section>

          <Section title="Opțiuni">
            <div className="grid grid-cols-2 gap-3">
              <CheckboxField label="Suprapunere combinată" checked={form.combine} onChange={(v) => set('combine', v)} />
              <CheckboxField label="Contururi de depanare" checked={form.debug} onChange={(v) => set('debug', v)} />
              {needsContourInput && (
                <CheckboxField label="Măsoară traseele / timpul de tăiere" checked={form.measurePaths} onChange={(v) => set('measurePaths', v)} />
              )}
            </div>
          </Section>

          {needsContourInput && form.measurePaths && (
            <Section title="Timp de tăiere">
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Viteză de tăiere (mm/s)" value={form.cuttingSpeedMmS} onChange={(v) => set('cuttingSpeedMmS', v)} />
                <NumberField label="Penalizare colț (s)" value={form.cornerPenaltyS} onChange={(v) => set('cornerPenaltyS', v)} />
                <NumberField label="Timp de pregătire (s)" value={form.preparationTimeS} onChange={(v) => set('preparationTimeS', v)} />
                <NumberField label="Viteză de deplasare (mm/s)" value={form.travelSpeedMmS} onChange={(v) => set('travelSpeedMmS', v)} />
              </div>
            </Section>
          )}

          <Section title="Stil text (separat prin virgulă, câte o valoare pentru fiecare cuvânt)">
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Caractere separator cuvinte (implicit: spațiu)"
                value={form.splitChars}
                onChange={(v) => set('splitChars', v)}
                placeholder=" "
              />
              <TextField label="Dimensiuni font (pt)" value={form.fontSizes} onChange={(v) => set('fontSizes', v)} placeholder="9, 14" />
              <TextField label="Text Y (mm)" value={form.textYMm} onChange={(v) => set('textYMm', v)} placeholder="10, 3" />
              <TextField label="Text X (mm, suprascrie alinierea)" value={form.textXMm} onChange={(v) => set('textXMm', v)} />
              <TextField label="Aliniere (left/center/right)" value={form.align} onChange={(v) => set('align', v)} placeholder="center" />
              <TextField label="Culori text" value={form.textColors} onChange={(v) => set('textColors', v)} placeholder="#RRGGBB sau c:m:y:k" />
              <TextField label="Rotații (grade)" value={form.textRotations} onChange={(v) => set('textRotations', v)} />
              <TextField label="Oglindire X (true/false)" value={form.textFlipX} onChange={(v) => set('textFlipX', v)} />
              <TextField label="Oglindire Y (true/false)" value={form.textFlipY} onChange={(v) => set('textFlipY', v)} />
              <TextField label="Fundaluri text" value={form.textBackgrounds} onChange={(v) => set('textBackgrounds', v)} placeholder="#RRGGBB, none" />
              <NumberField label="Padding fundal (mm)" value={form.textBackgroundPaddingMm} onChange={(v) => set('textBackgroundPaddingMm', v)} />
              <TextField label="Lățimi fundal (mm)" value={form.textBackgroundWidthsMm} onChange={(v) => set('textBackgroundWidthsMm', v)} />
              <TextField label="Transparențe fundal (0-1)" value={form.textBackgroundAlphas} onChange={(v) => set('textBackgroundAlphas', v)} />
            </div>
          </Section>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Se generează…' : 'Generează PDF'}
          </button>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex flex-col gap-6">
          <Section title="Rezultat">
            {!printResult && !contourResult && (
              <p className="text-sm text-gray-500 dark:text-gray-400">Generează un PDF pentru a vedea o previzualizare aici.</p>
            )}
            {printResult && <ResultPanel title="PDF Print" result={printResult} downloadName="output.pdf" />}
            {contourResult && <ResultPanel title="PDF Contur" result={contourResult} downloadName="output-contour.pdf" />}
          </Section>
        </div>
      </div>
    </div>
  )
}
