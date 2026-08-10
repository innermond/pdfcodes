// Draw a code as a 1D barcode instead of glyphs. The symbol occupies a rectangle
// whose width and height the caller supplies in points; the quiet zone is drawn
// *inside* that width, so the stated size is the real footprint reserved on the
// card (see `barcode_widths_mm` in src/options.rs).
//
// A barcode is a single row of modules stretched to the full bar height, so the
// drawing itself is `module_rects` with `rows = 1` — the same run-merged fill the
// QR path uses.
use lopdf::content::Operation;

use crate::barcode::{encode, Symbology};
use crate::generate::symbol::module_rects;

// The narrowest bar a barcode should print at to stay scannable — the usual print
// rule of thumb. Mirrors `QR_MIN_MODULE_MM` for the QR path: it floors the overflow
// corrector, because shrinking past it yields something that fits the cut but no
// scanner can read.
pub(crate) const MIN_NARROW_BAR_MM: f32 = 0.25;

// The module row for `data`, plus the total module count *including* both quiet
// zones — the caller needs that total to work out the narrow-bar width and the
// shrink floor. The bits themselves exclude the quiet zone.
pub(crate) fn barcode_bits(sym: Symbology, data: &str) -> Result<(Vec<u8>, usize), String> {
    let bits = encode(sym, data)?;
    let total = bits.len() + 2 * sym.quiet_modules();
    Ok((bits, total))
}

// Fill operations for an already-encoded bar row, as a rectangle `width_pt` x
// `height_pt` whose bottom-left corner sits at (x, y) in card space (PDF y-up).
// Takes the bits rather than the text because the caller encodes once and may then
// shrink the rectangle to fit the cut. The caller sets the fill color / alpha /
// blend beforehand — only the path and its `f` are emitted here.
pub(crate) fn barcode_rect_operations(
    bits: &[u8],
    quiet: usize,
    x: f32,
    y: f32,
    width_pt: f32,
    height_pt: f32,
) -> Vec<Operation> {
    let module = width_pt / (bits.len() + 2 * quiet) as f32;
    // Bars run the full height of the rectangle, so a single row of cells that tall
    // is the whole symbol. `module_rects` measures rows downward from the top edge.
    module_rects(bits.len(), 1, bits, x + quiet as f32 * module, y + height_pt, module, height_pt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generate::symbol::test_support::rects;

    #[test]
    fn bars_span_the_width_minus_the_quiet_zones() {
        let sym = Symbology::Code128;
        let (bits, total) = barcode_bits(sym, "AB1234").unwrap();
        let quiet = sym.quiet_modules();
        assert_eq!(total, bits.len() + 2 * quiet);

        let (width, height) = (85.0, 28.0);
        let ops = barcode_rect_operations(&bits, quiet, 10.0, 20.0, width, height);
        let r = rects(&ops);
        assert!(!r.is_empty());

        let module = width / total as f32;
        // Every Code 128 symbol starts and ends with a bar, so the ink runs from
        // exactly one quiet zone in to exactly one quiet zone short of the far edge.
        let left = r.iter().map(|t| t.0).fold(f32::MAX, f32::min);
        let right = r.iter().map(|t| t.0 + t.2).fold(f32::MIN, f32::max);
        assert!((left - (10.0 + quiet as f32 * module)).abs() < 1e-3, "left {left}");
        assert!((right - (10.0 + width - quiet as f32 * module)).abs() < 1e-3, "right {right}");
    }

    #[test]
    fn every_bar_is_full_height_and_a_whole_number_of_modules_wide() {
        let sym = Symbology::Code39;
        let (bits, total) = barcode_bits(sym, "AB-12").unwrap();
        let (width, height) = (120.0, 30.0);
        let ops = barcode_rect_operations(&bits, sym.quiet_modules(), 0.0, 5.0, width, height);
        let module = width / total as f32;

        for (_, py, w, h) in rects(&ops) {
            assert!((h - height).abs() < 1e-4, "bars span the full height, got {h}");
            assert!((py - 5.0).abs() < 1e-4, "bars sit on the rectangle's bottom edge, got {py}");
            let cols = w / module;
            assert!((cols - cols.round()).abs() < 1e-3, "width {w} is not a multiple of {module}");
        }
    }

    #[test]
    fn run_merge_covers_exactly_the_encoder_bit_row() {
        let sym = Symbology::Code128;
        let (bits, total) = barcode_bits(sym, "PDFCODES-42").unwrap();
        let quiet = sym.quiet_modules();
        let width = 200.0;
        let ops = barcode_rect_operations(&bits, quiet, 0.0, 0.0, width, 20.0);
        let module = width / total as f32;

        // Expand the merged bars back into single modules and compare with the
        // encoder's row — the optimisation must not add or drop a module.
        let mut covered = vec![0u8; bits.len()];
        for (x, _, w, _) in rects(&ops) {
            let col0 = (x / module).round() as usize - quiet;
            for c in 0..(w / module).round() as usize {
                covered[col0 + c] = 1;
            }
        }
        assert_eq!(covered, bits);
    }

    #[test]
    fn emits_one_fill_for_the_whole_symbol() {
        let (bits, _) = barcode_bits(Symbology::Ean13, "750103131130").unwrap();
        let ops = barcode_rect_operations(&bits, Symbology::Ean13.quiet_modules(), 0.0, 0.0, 90.0, 25.0);
        assert_eq!(ops.iter().filter(|op| op.operator == "f").count(), 1);
        assert_eq!(ops.last().unwrap().operator, "f");
    }

    #[test]
    fn an_unencodable_code_surfaces_the_reason() {
        let err = barcode_bits(Symbology::Ean13, "AB1234").unwrap_err();
        assert!(err.contains("EAN-13"), "{err}");
    }
}
