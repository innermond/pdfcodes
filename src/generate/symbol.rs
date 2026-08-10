// The one piece of drawing every machine-readable code shares: turning a grid of
// modules into filled rectangles. A QR is an n x n grid of square cells; a 1D
// barcode is a single row of cells as tall as the whole symbol. Both reduce to the
// same run-merged fill, so it lives here rather than twice.
use lopdf::{Object, content::Operation};

// Fill operations for a `cols` x `rows` module grid whose **top-left** cell sits at
// (x, y_top) in card space, each cell `cell_w` x `cell_h`. `bits` is row-major from
// the top, one byte per module (1 = dark).
//
// Rows are laid out downward from `y_top` because that is the order both encoders
// produce, while PDF's y grows upward — doing the flip here keeps it in one place.
// The caller sets the fill color / alpha / blend first; only the path and its `f`
// are emitted, so a symbol composites exactly like the text it replaces.
pub(crate) fn module_rects(
    cols: usize,
    rows: usize,
    bits: &[u8],
    x: f32,
    y_top: f32,
    cell_w: f32,
    cell_h: f32,
) -> Vec<Operation> {
    // One `re` per *horizontal run* of dark modules rather than per module: a 33x33
    // QR drops from ~550 rectangles to ~150, and a barcode's bars are runs by
    // definition. This content stream is rebuilt for every card in the job.
    let mut ops = Vec::new();
    for row in 0..rows {
        let py = y_top - (row + 1) as f32 * cell_h;
        let mut col = 0;
        while col < cols {
            if bits[row * cols + col] == 0 {
                col += 1;
                continue;
            }
            let start = col;
            while col < cols && bits[row * cols + col] == 1 {
                col += 1;
            }
            ops.push(Operation::new("re", vec![
                Object::Real(x + start as f32 * cell_w),
                Object::Real(py),
                Object::Real((col - start) as f32 * cell_w),
                Object::Real(cell_h),
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
pub(crate) mod test_support {
    use super::*;

    // The (x, y, w, h) operands of the emitted `re` operations. Shared by the QR and
    // barcode tests, which both check the geometry of a merged fill.
    pub(crate) fn rects(ops: &[Operation]) -> Vec<(f32, f32, f32, f32)> {
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
}

#[cfg(test)]
mod tests {
    use super::test_support::rects;
    use super::*;

    #[test]
    fn merges_horizontal_runs_and_fills_once() {
        // A 3x2 grid: a full top row, one isolated module below.
        let bits = [1, 1, 1, 0, 1, 0];
        let ops = module_rects(3, 2, &bits, 0.0, 2.0, 1.0, 1.0);
        // Row 0 spans y 1..2 (top-down from y_top), row 1 spans y 0..1.
        assert_eq!(rects(&ops), vec![(0.0, 1.0, 3.0, 1.0), (1.0, 0.0, 1.0, 1.0)]);
        assert_eq!(ops.iter().filter(|op| op.operator == "f").count(), 1);
        assert_eq!(ops.last().unwrap().operator, "f");
    }

    #[test]
    fn a_single_row_becomes_full_height_bars() {
        // How a 1D barcode uses this: one row, cells as tall as the symbol.
        let bits = [1, 0, 1, 1];
        let ops = module_rects(4, 1, &bits, 10.0, 30.0, 0.5, 20.0);
        assert_eq!(rects(&ops), vec![(10.0, 10.0, 0.5, 20.0), (11.0, 10.0, 1.0, 20.0)]);
    }

    #[test]
    fn an_all_light_grid_emits_nothing_at_all() {
        // No stray `f` with an empty path, which would be a no-op at best.
        assert!(module_rects(3, 1, &[0, 0, 0], 0.0, 0.0, 1.0, 1.0).is_empty());
    }
}
