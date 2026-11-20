import type { GenerateResult } from './generate'
import { m } from '../paraglide/messages'
import { sweepStaleZips } from './zipSink'

export interface BatchProgress {
  phase: 'print' | 'contour'
  rowsDone: number
  totalRows: number | null
  batchesDone: number
  wasmBytes: number
}

export interface PrintArtifact {
  blob: Blob
  isZip: boolean
  name: string
  /** Where a ZIP was assembled: in memory, or streamed to an OPFS temp file. */
  sink?: 'memory' | 'opfs'
  /** How many rows have a code that overflows the card / cut area. */
  overflowCount: number
  /** Every distinct offending row (whole row, first-seen order), for the warning + CSV. */
  overflowSamples: string[]
  /** How many rows have a QR/barcode the symbology couldn't encode (the symbol is
   *  left off the card; the rest of the row still prints). */
  symbolFailureCount: number
  /** Every distinct such row as `row<TAB>reason`, first-seen order. */
  symbolFailureSamples: string[]
}

export interface BatchResult {
  print: PrintArtifact | null
  contour: GenerateResult | null
}

export interface BatchInput {
  mode: 'print' | 'contour' | 'both'
  background: ArrayBuffer
  contour: ArrayBuffer | null
  fonts: ArrayBuffer[]
  printOptions: Record<string, unknown> | null
  contourOptions: Record<string, unknown> | null
  pagesPerBatch: number
  totalRows: number | null
  csv: Blob | null
}

export interface BatchHandle {
  promise: Promise<BatchResult>
  cancel: () => void
}

// Run a (possibly batched) generation job in a Web Worker. Returns a promise for
// the result plus a `cancel()` that terminates the worker (cancellation lands
// between batches). Transfers the input buffers to avoid copying them.
export function generateBatched(input: BatchInput, onProgress?: (p: BatchProgress) => void): BatchHandle {
  const worker = new Worker(new URL('./generateWorker.ts', import.meta.url), { type: 'module' })
  let settled = false
  let rejectPromise: (reason: unknown) => void = () => {}

  const promise = new Promise<BatchResult>((resolve, reject) => {
    rejectPromise = reject
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      switch (msg?.type) {
        case 'progress':
          onProgress?.(msg as BatchProgress)
          break
        case 'done':
          settled = true
          resolve({ print: msg.print ?? null, contour: msg.contour ?? null })
          worker.terminate()
          break
        case 'cancelled':
          settled = true
          reject(new DOMException(m.errors_generation_cancelled(), 'AbortError'))
          worker.terminate()
          break
        case 'error':
          settled = true
          reject(new Error(msg.message))
          worker.terminate()
          break
      }
    }
    worker.onmessageerror = () => {
      if (settled) return
      settled = true
      reject(new Error(m.errors_generation_worker()))
      worker.terminate()
    }
    worker.onerror = (e) => {
      if (settled) return
      settled = true
      reject(new Error(e.message || m.errors_generation_worker()))
      worker.terminate()
    }
  })

  const transfer: Transferable[] = [input.background, ...input.fonts]
  if (input.contour) transfer.push(input.contour)
  worker.postMessage({ type: 'start', data: input }, transfer)

  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      // Each batch is a synchronous wasm call, so terminating is the only way to
      // stop mid-job; reject so the awaiting caller unblocks.
      // Ask first, so the worker can dispose its OPFS temp ZIP when it next
      // reaches the cancel check; terminate on its ack, or after a grace period
      // if it is stuck inside a long synchronous wasm call.
      const prev = worker.onmessage
      const kill = () => worker.terminate()
      // If the worker never got to dispose its OPFS temp ZIP (it was stuck in a
      // synchronous batch), remove it from here once the terminated worker has
      // released the file.
      const killAndSweep = () => {
        kill()
        // Termination releases the file lock a little after the fact: retry once.
        setTimeout(() => void sweepStaleZips(), 500)
        setTimeout(() => void sweepStaleZips(), 3000)
      }
      const timer = setTimeout(killAndSweep, 3000)
      worker.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'cancelled' || e.data?.type === 'done' || e.data?.type === 'error') {
          clearTimeout(timer)
          kill()
        } else if (prev) prev.call(worker, e)
      }
      worker.postMessage({ type: 'cancel' })
      rejectPromise(new DOMException(m.errors_generation_cancelled(), 'AbortError'))
    },
  }
}
