import { useEffect, useState } from 'react'
import { unzipSync, zipSync, type Zippable } from 'fflate'
import type { GenerateResult } from '../lib/generate'

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
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!result) return
    const blob = new Blob([result.pdf.slice().buffer], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    // The object URL must be created and revoked together as a paired
    // browser-resource side effect, so it can't be derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPdfUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [result])

  return result ? pdfUrl : null
}

// A downloadable artifact with an inline preview of the first PDF. When the blob
// is a ZIP of batched print PDFs we unzip it and preview only the first entry;
// when it's a single PDF we preview the blob directly. The download link always
// points at the full artifact (the whole ZIP, or the single PDF).
export function FileDownload({
  title,
  blob,
  name,
  note,
  isZip = false,
}: {
  title: string
  blob: Blob
  name: string
  note?: string
  isZip?: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob)
    // Object URL is a paired create/revoke browser resource, so it can't be
    // derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  // Build a preview URL for the first PDF: extract entry 0 from the ZIP, or use
  // the blob as-is when it's already a single PDF.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    if (!isZip) {
      objectUrl = URL.createObjectURL(blob)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewUrl(objectUrl)
    } else {
      void blob.arrayBuffer().then((buf) => {
        if (cancelled) return
        const entries = unzipSync(new Uint8Array(buf))
        const firstPdf = Object.keys(entries)
          .sort()
          .find((n) => n.toLowerCase().endsWith('.pdf'))
        if (!firstPdf) return
        objectUrl = URL.createObjectURL(new Blob([entries[firstPdf].slice().buffer], { type: 'application/pdf' }))
        setPreviewUrl(objectUrl)
      })
    }

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setPreviewUrl(null)
    }
  }, [blob, isZip])

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      {note && <p className="text-sm text-gray-500 dark:text-gray-400">{note}</p>}
      {previewUrl && (
        <iframe
          title={`Previzualizare ${title}`}
          src={previewUrl}
          className="h-[600px] w-full rounded border border-gray-200 dark:border-gray-700"
        />
      )}
      {url && (
        <a href={url} download={name} className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          Descarcă {name}
        </a>
      )}
    </div>
  )
}

// Strip the extension off a file name (`cards.zip` → `cards`).
function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

// "Print + Contur" only: download a single ZIP holding the print PDF(s) plus the
// contour PDF. Operates on the already-generated artifacts — the print `blob`
// (a single PDF or a batched ZIP) and the contour PDF bytes — so no regeneration
// is needed. Building re-reads the print blob into memory and re-zips it
// store-only (≈2× the archive in RAM, briefly), but only on an explicit click.
export function DownloadBothButton({
  print,
  contourPdf,
}: {
  print: { blob: Blob; name: string; isZip: boolean }
  contourPdf: Uint8Array
}) {
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    setBusy(true)
    try {
      const files: Zippable = {}
      const buf = new Uint8Array(await print.blob.arrayBuffer())
      if (print.isZip) {
        // Carry over every print PDF already in the batched archive.
        Object.assign(files, unzipSync(buf))
      } else {
        files[print.name] = buf // single `cards.pdf`
      }
      files['contur.pdf'] = contourPdf.slice()
      // Store-only (no compression): PDFs barely compress, matching the worker.
      const zipped = zipSync(files, { level: 0 })
      const url = URL.createObjectURL(new Blob([zipped.buffer], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName(print.name)}-contur.zip`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="self-start text-sm font-medium text-blue-600 hover:underline disabled:opacity-60 dark:text-blue-400"
    >
      {busy ? 'Se pregătește…' : 'Descarcă ambele (print + contur, .zip)'}
    </button>
  )
}

export function ResultPanel({ title, result, downloadName }: { title: string; result: GenerateResult; downloadName: string }) {
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
