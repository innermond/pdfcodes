// Bridge to the separate SVG→PDF wasm module (svg-wasm/, built to src/wasm-svg
// by `build:wasm-svg`). Unlike lib/wasm.ts — whose module is imported statically
// and initialized at startup — this one is behind a dynamic import() so Vite
// splits it into its own chunk and the ~0.5 MB wasm binary is fetched only the
// first time the user actually picks an SVG background.

type SvgWasmModule = typeof import('../wasm-svg/pdfcodes_svg')

let ready: Promise<SvgWasmModule> | null = null

// Load + initialize the module exactly once. A failed load (e.g. network error
// on the wasm fetch) clears the cached promise so a later attempt can retry
// instead of replaying the same rejection forever.
function ensureSvgWasm(): Promise<SvgWasmModule> {
  if (!ready) {
    ready = import('../wasm-svg/pdfcodes_svg')
      .then(async (mod) => {
        await mod.default()
        return mod
      })
      .catch((err) => {
        ready = null
        throw err
      })
  }
  return ready
}

// Convert an SVG document (as text) to a standalone one-page background PDF
// (vector content, page sized to the SVG's physical dimensions). The bytes feed
// the same pipeline as an uploaded background PDF.
export async function svgToPdf(svgText: string): Promise<Uint8Array> {
  const mod = await ensureSvgWasm()
  return mod.svg_to_pdf(svgText)
}
