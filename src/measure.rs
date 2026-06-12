use lopdf::content::Content;
use kurbo::{Affine, BezPath, ParamCurveArclen, Point};

use crate::geometry::to_f64;

// Measure the total length (in the content stream's own unit space) of every
// stroked path (S, s, B, B*, b, b*) in a content stream, applying any CTM
// changes (q/Q/cm) along the way. Curve segments are measured with kurbo's
// adaptive arc-length quadrature. Filled-only paths (f, f*, F, n) and
// clipping paths (W, W*) are not counted.
pub(crate) fn measure_stroke_length(content_bytes: &[u8]) -> Result<f32, Box<dyn std::error::Error>> {
    const ACCURACY: f64 = 1e-3;

    let content = Content::decode(content_bytes)?;
    let mut ctm_stack: Vec<Affine> = vec![Affine::IDENTITY];
    let mut current_point = Point::ZERO;
    let mut subpath_start = Point::ZERO;
    let mut subpaths: Vec<BezPath> = Vec::new();
    let mut total = 0.0f64;

    let pt = |op: &lopdf::content::Operation, i: usize| -> Point {
        Point::new(to_f64(&op.operands[i]), to_f64(&op.operands[i + 1]))
    };

    for op in &content.operations {
        let ctm = *ctm_stack.last().unwrap();
        match op.operator.as_str() {
            "q" => ctm_stack.push(ctm),
            "Q" => {
                if ctm_stack.len() > 1 {
                    ctm_stack.pop();
                }
            }
            "cm" => {
                let m = Affine::new([
                    to_f64(&op.operands[0]), to_f64(&op.operands[1]),
                    to_f64(&op.operands[2]), to_f64(&op.operands[3]),
                    to_f64(&op.operands[4]), to_f64(&op.operands[5]),
                ]);
                *ctm_stack.last_mut().unwrap() = ctm * m;
            }
            "m" => {
                let p = pt(op, 0);
                current_point = p;
                subpath_start = p;
                let mut bp = BezPath::new();
                bp.move_to(ctm * p);
                subpaths.push(bp);
            }
            "l" => {
                let p = pt(op, 0);
                if let Some(sp) = subpaths.last_mut() {
                    sp.line_to(ctm * p);
                }
                current_point = p;
            }
            "c" => {
                let (p1, p2, p3) = (pt(op, 0), pt(op, 2), pt(op, 4));
                if let Some(sp) = subpaths.last_mut() {
                    sp.curve_to(ctm * p1, ctm * p2, ctm * p3);
                }
                current_point = p3;
            }
            "v" => {
                let (p2, p3) = (pt(op, 0), pt(op, 2));
                let p1 = current_point;
                if let Some(sp) = subpaths.last_mut() {
                    sp.curve_to(ctm * p1, ctm * p2, ctm * p3);
                }
                current_point = p3;
            }
            "y" => {
                let (p1, p3) = (pt(op, 0), pt(op, 2));
                if let Some(sp) = subpaths.last_mut() {
                    sp.curve_to(ctm * p1, ctm * p3, ctm * p3);
                }
                current_point = p3;
            }
            "h" => {
                if let Some(sp) = subpaths.last_mut() {
                    sp.close_path();
                }
                current_point = subpath_start;
            }
            "re" => {
                let x = to_f64(&op.operands[0]);
                let y = to_f64(&op.operands[1]);
                let w = to_f64(&op.operands[2]);
                let h = to_f64(&op.operands[3]);
                let mut bp = BezPath::new();
                bp.move_to(ctm * Point::new(x, y));
                bp.line_to(ctm * Point::new(x + w, y));
                bp.line_to(ctm * Point::new(x + w, y + h));
                bp.line_to(ctm * Point::new(x, y + h));
                bp.close_path();
                subpaths.push(bp);
                current_point = Point::new(x, y);
                subpath_start = Point::new(x, y);
            }
            "S" | "s" | "B" | "B*" | "b" | "b*" => {
                let closes = matches!(op.operator.as_str(), "s" | "b" | "b*");
                for sp in &mut subpaths {
                    if closes {
                        sp.close_path();
                    }
                    for seg in sp.segments() {
                        total += seg.arclen(ACCURACY);
                    }
                }
                subpaths.clear();
            }
            "f" | "F" | "f*" | "n" | "W" | "W*" => {
                subpaths.clear();
            }
            _ => {}
        }
    }

    Ok(total as f32)
}
