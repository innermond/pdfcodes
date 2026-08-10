// Draw a code as a QR symbol instead of glyphs. The symbol occupies a square
// whose side the caller supplies in points; the quiet zone is drawn *inside*
// that square, so the stated size is the real footprint the user must reserve
// on the card (see `qr_sizes_mm` in src/options.rs).
use lopdf::{Object, content::Operation};

use crate::qr::QrEcc;

// Quiet-zone width in modules mandated by the QR standard. `Options::qr_quiet_modules`
// overrides it; anything below 4 risks scanners failing to find the symbol.
pub(crate) const DEFAULT_QUIET_MODULES: u32 = 4;

// The payload placeholder substituted with the CSV field's text, so a code can be
// wrapped in a URL (e.g. "https://site.ro/v?c={code}") instead of encoded bare.
pub(crate) const CODE_PLACEHOLDER: &str = "{code}";

// Substitute the code into the payload template. An empty template encodes the
// bare code, which is also what a template without the placeholder yields for
// callers that want a constant payload.
pub(crate) fn qr_payload(template: &str, code: &str) -> String {
    if template.is_empty() {
        code.to_string()
    } else {
        template.replace(CODE_PLACEHOLDER, code)
    }
}

// The module grid for `text`: the number of modules per side and one byte per
// module (1 = dark), row-major from the top-left. Excludes the quiet zone.
// Shared by the PDF draw path below and the `qr_matrix` wasm export, so the
// preview and the generated file are always the same symbol.
pub(crate) fn qr_matrix_bits(text: &str, ecc: QrEcc) -> Result<(usize, Vec<u8>), qrcodegen::DataTooLong> {
    let qr = qrcodegen::QrCode::encode_text(text, ecc.to_qrcodegen())?;
    let n = qr.size();
    let mut bits = Vec::with_capacity((n * n) as usize);
    for y in 0..n {
        for x in 0..n {
            bits.push(u8::from(qr.get_module(x, y)));
        }
    }
    Ok((n as usize, bits))
}

// Fill operations for an already-encoded matrix (`n` modules per side, `bits` from
// `qr_matrix_bits`), as a square of side `size_pt` whose bottom-left corner sits at
// (x, y) in card space (PDF y-up). Takes the matrix rather than the text because the
// caller encodes once and may then shrink the square to fit the cut. The caller also
// sets the fill color / alpha / blend beforehand — only the path and its `f` are
// emitted here, so the QR composites exactly like the text it replaces.
pub(crate) fn qr_rect_operations(
    n: usize,
    bits: &[u8],
    x: f32,
    y: f32,
    size_pt: f32,
    quiet: u32,
) -> Vec<Operation> {
    let total = n + 2 * quiet as usize;
    let module = size_pt / total as f32;

    // One `re` per *horizontal run* of dark modules rather than per module: a
    // 33x33 symbol drops from ~550 rectangles to ~150, and this content stream
    // is rebuilt for every card in the job.
    let mut ops = Vec::new();
    for row in 0..n {
        // The matrix runs top-down, the page bottom-up: row 0 is the top row of
        // modules, which sits one quiet zone below the square's top edge.
        let py = y + size_pt - (quiet as usize + row + 1) as f32 * module;
        let mut col = 0;
        while col < n {
            if bits[row * n + col] == 0 {
                col += 1;
                continue;
            }
            let start = col;
            while col < n && bits[row * n + col] == 1 {
                col += 1;
            }
            let px = x + (quiet as usize + start) as f32 * module;
            ops.push(Operation::new("re", vec![
                Object::Real(px),
                Object::Real(py),
                Object::Real((col - start) as f32 * module),
                Object::Real(module),
            ]));
        }
    }
    // A single `f` fills every subpath accumulated above — one operator for the
    // whole symbol instead of one per rectangle.
    if !ops.is_empty() {
        ops.push(Operation::new("f", vec![]));
    }
    ops
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pull the (x, y, w, h) operands out of the emitted `re` operations.
    fn rects(ops: &[Operation]) -> Vec<(f32, f32, f32, f32)> {
        let num = |o: &Object| match o {
            Object::Real(v) => *v,
            Object::Integer(v) => *v as f32,
            _ => panic!("non-numeric operand"),
        };
        ops.iter()
            .filter(|op| op.operator == "re")
            .map(|op| (num(&op.operands[0]), num(&op.operands[1]), num(&op.operands[2]), num(&op.operands[3])))
            .collect()
    }

    #[test]
    fn qr_payload_substitutes_or_passes_through() {
        assert_eq!(qr_payload("", "AB1234"), "AB1234");
        assert_eq!(qr_payload("https://site.ro/v?c={code}", "AB1234"), "https://site.ro/v?c=AB1234");
        // Repeated placeholders all get the code.
        assert_eq!(qr_payload("{code}-{code}", "X"), "X-X");
    }

    #[test]
    fn qr_matrix_bits_uses_the_smallest_fitting_version() {
        // "HELLO" fits version 1 at Medium ECC: 21 modules per side.
        let (n, bits) = qr_matrix_bits("HELLO", QrEcc::Medium).unwrap();
        assert_eq!(n, 21);
        assert_eq!(bits.len(), 21 * 21);
        // Top row of the top-left finder pattern: 7 dark modules, then the light
        // separator column that always follows it.
        assert_eq!(&bits[0..8], &[1, 1, 1, 1, 1, 1, 1, 0]);
    }

    #[test]
    fn qr_matrix_bits_reports_an_over_long_payload() {
        // Well past the ~2953-byte ceiling of the largest symbol.
        let huge = "x".repeat(5000);
        assert!(qr_matrix_bits(&huge, QrEcc::High).is_err());
    }

    #[test]
    fn qr_operations_span_exactly_the_requested_square() {
        let size = 36.0;
        let quiet = 4;
        let (n, bits) = qr_matrix_bits("HELLO", QrEcc::Medium).unwrap();
        let ops = qr_rect_operations(n, &bits, 10.0, 20.0, size, quiet);
        let r = rects(&ops);
        assert!(!r.is_empty());

        let module = size / (21.0 + 2.0 * quiet as f32);
        // Every rectangle is one module tall and a whole number of modules wide.
        for (_, _, w, h) in &r {
            assert!((h - module).abs() < 1e-4);
            let cols = w / module;
            assert!((cols - cols.round()).abs() < 1e-3, "width {w} is not a multiple of {module}");
        }

        // The dark modules sit inside the square, inset by the quiet zone: the
        // top-left finder pattern touches both inset edges.
        let left = r.iter().map(|t| t.0).fold(f32::MAX, f32::min);
        let right = r.iter().map(|t| t.0 + t.2).fold(f32::MIN, f32::max);
        let bottom = r.iter().map(|t| t.1).fold(f32::MAX, f32::min);
        let top = r.iter().map(|t| t.1 + t.3).fold(f32::MIN, f32::max);
        assert!((left - (10.0 + quiet as f32 * module)).abs() < 1e-3);
        assert!((right - (10.0 + size - quiet as f32 * module)).abs() < 1e-3);
        assert!((bottom - (20.0 + quiet as f32 * module)).abs() < 1e-3);
        assert!((top - (20.0 + size - quiet as f32 * module)).abs() < 1e-3);
    }

    #[test]
    fn qr_operations_run_merge_covers_the_same_modules_as_a_naive_scan() {
        let size = 42.0;
        let quiet = 4u32;
        let (n, bits) = qr_matrix_bits("PDFCODES-42", QrEcc::Quartile).unwrap();
        let ops = qr_rect_operations(n, &bits, 0.0, 0.0, size, quiet);
        let module = size / (n + 2 * quiet as usize) as f32;

        // Expand the merged rectangles back into single modules and compare with
        // the matrix — the optimisation must not add or drop a module.
        let mut covered = vec![0u8; n * n];
        for (x, y, w, _) in rects(&ops) {
            let col0 = (x / module).round() as usize - quiet as usize;
            // Rows are drawn bottom-up, so invert back to matrix order.
            let row_from_bottom = (y / module).round() as usize - quiet as usize;
            let row = n - 1 - row_from_bottom;
            for c in 0..(w / module).round() as usize {
                covered[row * n + col0 + c] = 1;
            }
        }
        assert_eq!(covered, bits);

        // And the merge actually merged: roughly two dark modules per rectangle
        // across typical payloads, so a comfortable margin under 0.6 catches a
        // regression that stopped merging without being brittle about the exact
        // symbol contents.
        let dark = bits.iter().filter(|b| **b == 1).count();
        let count = rects(&ops).len();
        assert!(
            (count as f32) < dark as f32 * 0.6,
            "expected run merging to collapse {dark} dark modules well below 0.6x, got {count} rectangles",
        );
    }

    #[test]
    fn qr_operations_emit_one_fill_for_the_whole_symbol() {
        let (n, bits) = qr_matrix_bits("HELLO", QrEcc::Medium).unwrap();
        let ops = qr_rect_operations(n, &bits, 0.0, 0.0, 36.0, 4);
        assert_eq!(ops.iter().filter(|op| op.operator == "f").count(), 1);
        assert_eq!(ops.last().unwrap().operator, "f");
    }
}

