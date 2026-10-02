// The parts of the wizard that only a later step shows, each in a chunk of its
// own.
//
// Fundal is where everyone starts, so the CSV/code-source form (Date), the
// Google font picker (Aspect) and the result downloads — which bring fflate
// with them — all wait for their step. `App` makes its `lazy` components out of
// these and warms the next step's chunks as soon as a step is shown; the step
// tabs do the same on hover and focus. With that the `Suspense` fallback, which
// is empty, is not normally seen.

import { lazyChunk, type LazyChunk } from './lazyChunk'

export const codeSourceChunk = lazyChunk(() => import('../components/CodeSourceSection'))
export const fontPickerChunk = lazyChunk(() => import('../components/GoogleFontPicker'))
export const resultChunk = lazyChunk(() => import('../components/ResultPanel'))

const STEP_CHUNKS: Record<string, readonly LazyChunk<unknown>[]> = {
  date: [codeSourceChunk],
  aspect: [fontPickerChunk],
  generare: [resultChunk],
}

/** Warms a wizard step's chunks; a no-op for a step that has none. */
export function preloadStep(id: string): void {
  STEP_CHUNKS[id]?.forEach((chunk) => chunk.preload())
}
