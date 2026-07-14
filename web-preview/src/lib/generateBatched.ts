import type { GenerateResult } from './generate'
import { m } from '../paraglide/messages'

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
      const m = e.data
      switch (m?.type) {
        case 'progress':
          onProgress?.(m as BatchProgress)
          break
        case 'done':
          settled = true
          resolve({ print: m.print ?? null, contour: m.contour ?? null })
          worker.terminate()
          break
        case 'cancelled':
          settled = true
          reject(new DOMException(m.errors_generation_cancelled(), 'AbortError'))
          worker.terminate()
          break
        case 'error':
          settled = true
          reject(new Error(m.message))
          worker.terminate()
          break
      }
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
      worker.terminate()
      rejectPromise(new DOMException(m.errors_generation_cancelled(), 'AbortError'))
    },
  }
}
