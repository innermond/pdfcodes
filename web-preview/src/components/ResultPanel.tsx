import { useEffect, useMemo } from 'react'
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
