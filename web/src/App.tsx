import { useEffect, useMemo, useState } from 'react'
import { CheckboxField, FileField, NumberField, RadioGroupField, Section, TextField } from './components/fields'
import { generatePdf, type GenerateResult } from './lib/generate'
import { defaultFormState, type FormState } from './lib/options'

type Mode = 'print' | 'contour' | 'both'

function formatMetric(value: number | undefined, unit: string, digits = 2): string {
  if (value === undefined) return '—'
  return `${value.toFixed(digits)} ${unit}`
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

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
        <div>Cards per page: <span className="font-semibold">{result.cardsPerPage}</span></div>
        <div>Path length / card: <span className="font-semibold">{formatMetric(result.pathLengthPerCardMm, 'mm')}</span></div>
        <div>Path length total: <span className="font-semibold">{formatMetric(result.pathLengthTotalMm, 'mm')}</span></div>
        <div>Nodes / card: <span className="font-semibold">{result.nodeCountPerCard ?? '—'}</span></div>
        <div>Nodes total: <span className="font-semibold">{result.nodeCountTotal ?? '—'}</span></div>
        <div>Sharp turns / card: <span className="font-semibold">{result.sharpTurnCountPerCard ?? '—'}</span></div>
        <div>Sharp turns total: <span className="font-semibold">{result.sharpTurnCountTotal ?? '—'}</span></div>
        <div>Cutting time / card: <span className="font-semibold">{formatMetric(result.timeCuttingPerCardS, 's')}</span></div>
        <div>Cutting time total: <span className="font-semibold">{formatMetric(result.timeCuttingTotalS, 's')}</span></div>
      </div>

      {pdfUrl && (
        <div className="mt-2 flex flex-col gap-2">
          <a href={pdfUrl} download={downloadName} className="text-sm font-medium text-blue-600 hover:underline">
            Download {downloadName}
          </a>
          <iframe title={`${title} preview`} src={pdfUrl} className="h-[600px] w-full rounded border border-gray-200" />
        </div>
      )}
    </div>
  )
}

export default function App() {
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
      setError('A background PDF is required.')
      return
    }
    if (needsPrintInputs && !csvFile) {
      setError('A CSV file is required.')
      return
    }
    if (needsContourInput && !contourBackgroundFile) {
      setError('A contour background PDF is required.')
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
            csvFile: null,
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
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">pdfcodes</h1>
      <p className="mb-6 text-sm text-gray-500">
        Generate card-grid PDFs and cutting-time estimates from a CSV and background PDF.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Section title="Mode">
            <RadioGroupField<Mode>
              label="What to generate"
              value={mode}
              onChange={setMode}
              options={[
                {
                  value: 'print',
                  label: 'Print only',
                  description: 'Generate the printable sheet PDF from the background and CSV.',
                },
                {
                  value: 'contour',
                  label: 'Contour only',
                  description: 'Generate a standalone contour/cut-lines PDF from the contour background.',
                },
                {
                  value: 'both',
                  label: 'Print + Contour',
                  description: 'Generate both the printable sheet and a matching contour/cut-lines PDF.',
                },
              ]}
            />
          </Section>

          <Section title="Files">
            {needsPrintInputs && (
              <>
                <FileField
                  label="Background PDF (print design)"
                  accept="application/pdf"
                  onChange={(files) => setBackgroundFile(files?.[0] ?? null)}
                />
                <FileField
                  label="CSV data"
                  accept=".csv,text/csv"
                  onChange={(files) => setCsvFile(files?.[0] ?? null)}
                />
              </>
            )}
            <FileField
              label={
                needsContourInput
                  ? 'Contour background PDF (cut-lines file)'
                  : 'Contour background PDF (optional, used by Combine overlay and cutting-time measurement)'
              }
              accept="application/pdf"
              onChange={(files) => setContourBackgroundFile(files?.[0] ?? null)}
            />
            {needsPrintInputs && (
              <FileField
                label="Fonts (optional, one per word position)"
                accept=".ttf,.otf"
                multiple
                onChange={(files) => setFontFiles(files ? Array.from(files) : [])}
              />
            )}
          </Section>

          <Section title="Layout">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Host width (mm)" value={form.hostWidthMm} onChange={(v) => set('hostWidthMm', v)} />
              <NumberField label="Host height (mm)" value={form.hostHeightMm} onChange={(v) => set('hostHeightMm', v)} />
              <NumberField label="Offset X (mm)" value={form.offsetXMm} onChange={(v) => set('offsetXMm', v)} />
              <NumberField label="Offset Y (mm)" value={form.offsetYMm} onChange={(v) => set('offsetYMm', v)} />
              <NumberField label="Circle diameter (mm)" value={form.circleDiameterMm} onChange={(v) => set('circleDiameterMm', v)} />
              <NumberField label="Safe margin (mm)" value={form.safeMarginMm} onChange={(v) => set('safeMarginMm', v)} />
            </div>
          </Section>

          <Section title="Options">
            <div className="grid grid-cols-2 gap-3">
              <CheckboxField label="Combine overlay" checked={form.combine} onChange={(v) => set('combine', v)} />
              <CheckboxField label="Debug outlines" checked={form.debug} onChange={(v) => set('debug', v)} />
              <CheckboxField label="Measure paths / cutting time" checked={form.measurePaths} onChange={(v) => set('measurePaths', v)} />
            </div>
          </Section>

          {form.measurePaths && (
            <Section title="Cutting time">
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Cutting speed (mm/s)" value={form.cuttingSpeedMmS} onChange={(v) => set('cuttingSpeedMmS', v)} />
                <NumberField label="Corner penalty (s)" value={form.cornerPenaltyS} onChange={(v) => set('cornerPenaltyS', v)} />
                <NumberField label="Preparation time (s)" value={form.preparationTimeS} onChange={(v) => set('preparationTimeS', v)} />
                <NumberField label="Travel speed (mm/s)" value={form.travelSpeedMmS} onChange={(v) => set('travelSpeedMmS', v)} />
              </div>
            </Section>
          )}

          <Section title="Text styling (comma-separated, one entry per word)">
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Font sizes (pt)" value={form.fontSizes} onChange={(v) => set('fontSizes', v)} placeholder="9, 14" />
              <TextField label="Text Y (mm)" value={form.textYMm} onChange={(v) => set('textYMm', v)} placeholder="10, 3" />
              <TextField label="Text X (mm, overrides align)" value={form.textXMm} onChange={(v) => set('textXMm', v)} />
              <TextField label="Align (left/center/right)" value={form.align} onChange={(v) => set('align', v)} placeholder="center" />
              <TextField label="Text colors" value={form.textColors} onChange={(v) => set('textColors', v)} placeholder="#RRGGBB or c:m:y:k" />
              <TextField label="Rotations (degrees)" value={form.textRotations} onChange={(v) => set('textRotations', v)} />
              <TextField label="Flip X (true/false)" value={form.textFlipX} onChange={(v) => set('textFlipX', v)} />
              <TextField label="Flip Y (true/false)" value={form.textFlipY} onChange={(v) => set('textFlipY', v)} />
              <TextField label="Backgrounds" value={form.textBackgrounds} onChange={(v) => set('textBackgrounds', v)} placeholder="#RRGGBB, none" />
              <NumberField label="Background padding (mm)" value={form.textBackgroundPaddingMm} onChange={(v) => set('textBackgroundPaddingMm', v)} />
              <TextField label="Background widths (mm)" value={form.textBackgroundWidthsMm} onChange={(v) => set('textBackgroundWidthsMm', v)} />
              <TextField label="Background alphas (0-1)" value={form.textBackgroundAlphas} onChange={(v) => set('textBackgroundAlphas', v)} />
            </div>
          </Section>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Generate PDF'}
          </button>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex flex-col gap-6">
          <Section title="Result">
            {!printResult && !contourResult && (
              <p className="text-sm text-gray-500">Generate a PDF to see a preview here.</p>
            )}
            {printResult && <ResultPanel title="Print PDF" result={printResult} downloadName="output.pdf" />}
            {contourResult && <ResultPanel title="Contour PDF" result={contourResult} downloadName="output-contour.pdf" />}
          </Section>
        </div>
      </div>
    </div>
  )
}
