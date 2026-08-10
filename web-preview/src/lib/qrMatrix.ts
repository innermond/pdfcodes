// The QR module grid for the live preview, encoded by the same Rust code that
// draws the symbol into the PDF (`qr_matrix` in src/wasm.rs → `qr_matrix_bits` in
// src/generate/qr.rs). Going through wasm rather than a TypeScript QR library is
// deliberate: the preview must show the exact symbol the generator will emit, and a
// second implementation would eventually drift from it.
import { ensureWasmInit } from './wasm'
import { qr_matrix } from '../wasm/pdfcodes'
import { QR_QUIET_MODULES, type QrEcc } from './options'

export interface QrMatrix {
  // Modules per side, quiet zone excluded.
  size: number
  // One entry per module (1 = dark), row-major from the top-left.
  bits: Uint8Array
}

// Encode `text`, or return null when the payload is too long for any symbol — the
// preview then shows nothing rather than throwing, matching the generator, which
// skips the QR and reports the row.
export function qrMatrix(text: string, ecc: QrEcc): QrMatrix | null {
  try {
    const out = qr_matrix(text, ecc)
    return { size: out[0], bits: out.subarray(1) }
  } catch {
    return null
  }
}

// `qrMatrix`, but safe to call before the wasm module has finished loading.
export async function qrMatrixAsync(text: string, ecc: QrEcc): Promise<QrMatrix | null> {
  await ensureWasmInit()
  return qrMatrix(text, ecc)
}

// The SVG path data drawing a QR as a square of side `size` whose top-left corner is
// at (x, y) in SVG space (y down). Horizontal runs of dark modules are merged into
// one subpath each, exactly as `qr_rect_operations` does for the PDF, so the preview
// is one `<path>` node instead of several hundred `<rect>`s.
export function qrPathData(matrix: QrMatrix, x: number, y: number, size: number, quiet: number = QR_QUIET_MODULES): string {
  const { size: n, bits } = matrix
  const module = size / (n + 2 * quiet)
  const parts: string[] = []
  for (let row = 0; row < n; row++) {
    const py = y + (quiet + row) * module
    let col = 0
    while (col < n) {
      if (bits[row * n + col] === 0) {
        col++
        continue
      }
      const start = col
      while (col < n && bits[row * n + col] === 1) col++
      const px = x + (quiet + start) * module
      const w = (col - start) * module
      parts.push(`M${px} ${py}h${w}v${module}h${-w}Z`)
    }
  }
  return parts.join('')
}

// Side of one module in mm, for the "too small to scan" warning. Returns null when
// the payload can't be encoded (there is no symbol to measure).
export function qrModuleSizeMm(matrix: QrMatrix | null, qrSizeMm: number, quiet: number = QR_QUIET_MODULES): number | null {
  if (!matrix) return null
  return qrSizeMm / (matrix.size + 2 * quiet)
}
