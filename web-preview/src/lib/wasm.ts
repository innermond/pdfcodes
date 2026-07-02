import init, { generate_with_options, generate_shape_pdf, generate_polygon_pdf, generate_simple_background_pdf, generate_image_background_pdf, type WasmGenerateOutput } from '../wasm/pdfcodes'

let ready: Promise<void> | null = null

// Lazily initialize the wasm module exactly once.
export function ensureWasmInit(): Promise<void> {
  if (!ready) {
    ready = init().then(() => undefined)
  }
  return ready
}

export { generate_with_options, generate_shape_pdf, generate_polygon_pdf, generate_simple_background_pdf, generate_image_background_pdf }
export type { WasmGenerateOutput }
