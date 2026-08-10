// The module grid for the live preview, encoded by the same Rust code that draws the
// symbol into the PDF (`qr_matrix` / `barcode_bits` in src/wasm.rs). Going through
// wasm rather than JavaScript encoders is deliberate: the preview must show the exact
// symbol the generator will emit, and a second implementation would eventually drift.
import { ensureWasmInit } from './wasm'
import { qr_matrix, barcode_bits, barcode_quiet_modules } from '../wasm/pdfcodes'
import { QR_QUIET_MODULES, codePayload, type Symbology, type WordStyle } from './options'

// A symbol as a grid of modules, whatever produced it. A QR is `size` x `size`; a
// barcode is one row of `size` modules drawn at the full bar height.
export interface ModuleGrid {
  cols: number
  rows: number
  // One entry per module (1 = dark), row-major from the top-left.
  bits: Uint8Array
  // Quiet zone in modules kept on each side, inside the stated width.
  quiet: number
}

// Encode a word's payload, or return the reason the symbology refused it — the same
// message the generator reports for that row, so the preview and the result panel
// say the same thing.
export function encodeSymbol(word: WordStyle): { grid: ModuleGrid } | { error: string } {
  const payload = codePayload(word)
  try {
    if (word.kind === 'qr') {
      const out = qr_matrix(payload, word.qrEcc)
      const size = out[0]
      return { grid: { cols: size, rows: size, bits: out.subarray(1), quiet: QR_QUIET_MODULES } }
    }
    const bits = barcode_bits(payload, word.symbology)
    return { grid: { cols: bits.length, rows: 1, bits, quiet: quietModules(word.symbology) } }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// `encodeSymbol`, but safe to call before the wasm module has finished loading.
export async function encodeSymbolAsync(word: WordStyle): Promise<{ grid: ModuleGrid } | { error: string }> {
  await ensureWasmInit()
  return encodeSymbol(word)
}

function quietModules(symbology: Symbology): number {
  try {
    return barcode_quiet_modules(symbology)
  } catch {
    // Only reachable if the symbology string is unknown, which the types prevent.
    return 10
  }
}

// The SVG path data drawing a module grid into the rectangle whose top-left corner is
// at (x, y) in SVG space (y down). Horizontal runs are merged into one subpath each,
// exactly as `module_rects` does for the PDF, so the preview is one `<path>` node
// instead of hundreds of `<rect>`s.
export function modulePathData(grid: ModuleGrid, x: number, y: number, width: number, height: number): string {
  const { cols, rows, bits, quiet } = grid
  const cellW = width / (cols + 2 * quiet)
  // A barcode's single row spans the full height; a QR's cells are square and inset
  // by the quiet zone vertically too.
  const cellH = rows === 1 ? height : cellW
  const originY = rows === 1 ? y : y + quiet * cellW
  const parts: string[] = []
  for (let row = 0; row < rows; row++) {
    const py = originY + row * cellH
    let col = 0
    while (col < cols) {
      if (bits[row * cols + col] === 0) {
        col++
        continue
      }
      const start = col
      while (col < cols && bits[row * cols + col] === 1) col++
      const px = x + (quiet + start) * cellW
      const w = (col - start) * cellW
      parts.push(`M${px} ${py}h${w}v${cellH}h${-w}Z`)
    }
  }
  return parts.join('')
}

// Width of one module in mm — a QR module or a barcode's narrow bar — for the "too
// small to scan" warning. Null when the payload can't be encoded, since there is no
// symbol to measure.
export function moduleWidthMm(grid: ModuleGrid | null, widthMm: number): number | null {
  if (!grid) return null
  return widthMm / (grid.cols + 2 * grid.quiet)
}
