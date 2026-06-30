use lopdf::content::Content;
use kurbo::{Affine, BezPath, ParamCurveArclen, PathEl, PathSeg, Point, Rect, Shape, Vec2};

use crate::geometry::to_f64;

// A direction change between two consecutive path segments is "sharp" when
// the tangent direction changes by at least this many degrees at the shared
// node (e.g. the corners of a square or star).
const SHARP_TURN_THRESHOLD_DEG: f64 = 90.0;

// Metrics gathered while measuring the stroked paths of a content stream.
#[derive(Default)]
pub(crate) struct PathMetrics {
    // Total length (in the content stream's own unit space) of every
    // stroked path.
    pub length: f32,
    // Total number of path nodes (anchor points defined by m/l/c/v/y
    // operators) across all stroked subpaths.
    pub node_count: usize,
    // Number of nodes where the tangent direction changes by at least
    // `SHARP_TURN_THRESHOLD_DEG`.
    pub sharp_turn_count: usize,
}

// Tangent vector leaving the start of `seg`, falling back to a later
// control point if the immediately adjacent one is coincident with the
// start (which would otherwise give a zero-length tangent).
fn start_tangent(seg: &PathSeg) -> Vec2 {
    match seg {
        PathSeg::Line(l) => l.p1 - l.p0,
        PathSeg::Quad(q) => {
            let d = q.p1 - q.p0;
            if d != Vec2::ZERO { d } else { q.p2 - q.p0 }
        }
        PathSeg::Cubic(c) => {
            let d = c.p1 - c.p0;
            if d != Vec2::ZERO {
                d
            } else {
                let d2 = c.p2 - c.p0;
                if d2 != Vec2::ZERO { d2 } else { c.p3 - c.p0 }
            }
        }
    }
}

// Tangent vector arriving at the end of `seg`, falling back to an earlier
// control point if the immediately adjacent one is coincident with the end.
fn end_tangent(seg: &PathSeg) -> Vec2 {
    match seg {
        PathSeg::Line(l) => l.p1 - l.p0,
        PathSeg::Quad(q) => {
            let d = q.p2 - q.p1;
            if d != Vec2::ZERO { d } else { q.p2 - q.p0 }
        }
        PathSeg::Cubic(c) => {
            let d = c.p3 - c.p2;
            if d != Vec2::ZERO {
                d
            } else {
                let d2 = c.p3 - c.p1;
                if d2 != Vec2::ZERO { d2 } else { c.p3 - c.p0 }
            }
        }
    }
}

// Absolute angle (degrees, in [0, 180]) between two direction vectors.
fn angle_between_deg(a: Vec2, b: Vec2) -> f64 {
    let diff = b.angle() - a.angle();
    let wrapped = (diff + std::f64::consts::PI).rem_euclid(std::f64::consts::TAU) - std::f64::consts::PI;
    wrapped.abs().to_degrees()
}

// Number of path nodes (anchor points introduced by MoveTo/LineTo/QuadTo/
// CurveTo elements; ClosePath reuses the subpath's start point and adds no
// new node).
fn count_nodes(bp: &BezPath) -> usize {
    bp.elements().iter().filter(|el| !matches!(el, PathEl::ClosePath)).count()
}

// Number of nodes where the incoming and outgoing tangent directions differ
// by at least `SHARP_TURN_THRESHOLD_DEG`.
fn count_sharp_turns(bp: &BezPath) -> usize {
    let segs: Vec<PathSeg> = bp.segments().collect();
    if segs.len() < 2 {
        return 0;
    }

    let is_closed = matches!(bp.elements().last(), Some(PathEl::ClosePath));
    let junctions: Box<dyn Iterator<Item = (usize, usize)>> = if is_closed {
        Box::new((0..segs.len()).map(|i| (i, (i + 1) % segs.len())))
    } else {
        Box::new((0..segs.len() - 1).map(|i| (i, i + 1)))
    };

    let mut count = 0;
    for (i, j) in junctions {
        let incoming = end_tangent(&segs[i]);
        let outgoing = start_tangent(&segs[j]);
        if incoming.hypot() < 1e-9 || outgoing.hypot() < 1e-9 {
            continue;
        }
        if angle_between_deg(incoming, outgoing) >= SHARP_TURN_THRESHOLD_DEG {
            count += 1;
        }
    }
    count
}

// Measure the stroked paths (S, s, B, B*, b, b*) in a content stream:
// total length, node count, and the number of sharp (>= 90 degree)
// direction changes, applying any CTM changes (q/Q/cm) along the way.
// Curve segments are measured with kurbo's adaptive arc-length quadrature.
// Filled-only paths (f, f*, F, n) and clipping paths (W, W*) are not
// counted.
pub(crate) fn measure_stroked_paths(content_bytes: &[u8]) -> Result<PathMetrics, Box<dyn std::error::Error>> {
    const ACCURACY: f64 = 1e-3;

    let content = Content::decode(content_bytes)?;
    let mut ctm_stack: Vec<Affine> = vec![Affine::IDENTITY];
    let mut current_point = Point::ZERO;
    let mut subpath_start = Point::ZERO;
    let mut subpaths: Vec<BezPath> = Vec::new();
    let mut metrics = PathMetrics::default();

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
                        metrics.length += seg.arclen(ACCURACY) as f32;
                    }
                    metrics.node_count += count_nodes(sp);
                    metrics.sharp_turn_count += count_sharp_turns(sp);
                }
                subpaths.clear();
            }
            "f" | "F" | "f*" | "n" | "W" | "W*" => {
                subpaths.clear();
            }
            _ => {}
        }
    }

    Ok(metrics)
}

// Tight bounding box of every *painted* (stroked or filled) subpath in a content
// stream, in the stream's own user space (CTM applied, q/Q/cm honored — the same
// space `[0,0,MediaBox_w,MediaBox_h]` lives in). Returns `(min_x, min_y, max_x,
// max_y)`, or `None` when nothing paints (image/text/clip-only contours), so callers
// can fall back to the page MediaBox. Stroked paints are expanded by half the
// (CTM-scaled) line width so the stroke isn't clipped. Used to trim an uploaded
// contour to its artwork instead of its page — see `contour_trim_to_path`.
pub(crate) fn content_path_bbox(content_bytes: &[u8]) -> Option<(f64, f64, f64, f64)> {
    let content = Content::decode(content_bytes).ok()?;
    let mut ctm_stack: Vec<Affine> = vec![Affine::IDENTITY];
    let mut current_point = Point::ZERO;
    let mut subpath_start = Point::ZERO;
    let mut subpaths: Vec<BezPath> = Vec::new();
    let mut line_width: f64 = 1.0;
    let mut bbox: Option<Rect> = None;

    let pt = |op: &lopdf::content::Operation, i: usize| -> Point {
        Point::new(to_f64(&op.operands[i]), to_f64(&op.operands[i + 1]))
    };

    // Uniform scale the CTM applies (sqrt of the linear part's determinant), used to
    // map the user-space line width into the transformed bbox space.
    let ctm_scale = |m: &Affine| -> f64 {
        let c = m.as_coeffs();
        (c[0] * c[3] - c[1] * c[2]).abs().sqrt()
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
            "w" => line_width = to_f64(&op.operands[0]),
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
            // Any paint op (fill and/or stroke) contributes the pending path to the
            // bbox; stroked paints grow it by half the CTM-scaled line width.
            "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" => {
                let strokes = matches!(op.operator.as_str(), "S" | "s" | "B" | "B*" | "b" | "b*");
                let grow = if strokes { 0.5 * line_width * ctm_scale(&ctm) } else { 0.0 };
                for sp in &subpaths {
                    if sp.elements().is_empty() {
                        continue;
                    }
                    let r = sp.bounding_box().inflate(grow, grow);
                    bbox = Some(match bbox {
                        Some(b) => b.union(r),
                        None => r,
                    });
                }
                subpaths.clear();
            }
            // No-paint terminators (clip, end-path) drop the pending path.
            "n" | "W" | "W*" => {
                subpaths.clear();
            }
            _ => {}
        }
    }

    bbox.map(|r| (r.x0, r.y0, r.x1, r.y1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::Object;

    fn encode(operations: Vec<Operation>) -> Vec<u8> {
        Content { operations }.encode().unwrap()
    }

    #[test]
    fn rectangle_has_four_nodes_and_four_sharp_turns() {
        let bytes = encode(vec![
            Operation::new("re", vec![Object::Real(0.0), Object::Real(0.0), Object::Real(10.0), Object::Real(20.0)]),
            Operation::new("S", vec![]),
        ]);
        let metrics = measure_stroked_paths(&bytes).unwrap();
        assert_eq!(metrics.node_count, 4);
        assert_eq!(metrics.sharp_turn_count, 4);
        assert!((metrics.length - 60.0).abs() < 1e-3);
    }

    #[test]
    fn straight_line_has_no_sharp_turns() {
        let bytes = encode(vec![
            Operation::new("m", vec![Object::Real(0.0), Object::Real(0.0)]),
            Operation::new("l", vec![Object::Real(5.0), Object::Real(0.0)]),
            Operation::new("l", vec![Object::Real(10.0), Object::Real(0.0)]),
            Operation::new("S", vec![]),
        ]);
        let metrics = measure_stroked_paths(&bytes).unwrap();
        assert_eq!(metrics.node_count, 3);
        assert_eq!(metrics.sharp_turn_count, 0);
        assert!((metrics.length - 10.0).abs() < 1e-3);
    }

    #[test]
    fn open_right_angle_counts_one_sharp_turn() {
        let bytes = encode(vec![
            Operation::new("m", vec![Object::Real(0.0), Object::Real(0.0)]),
            Operation::new("l", vec![Object::Real(10.0), Object::Real(0.0)]),
            Operation::new("l", vec![Object::Real(10.0), Object::Real(10.0)]),
            Operation::new("S", vec![]),
        ]);
        let metrics = measure_stroked_paths(&bytes).unwrap();
        assert_eq!(metrics.node_count, 3);
        assert_eq!(metrics.sharp_turn_count, 1);
    }

    #[test]
    fn fill_only_paths_are_not_measured() {
        let bytes = encode(vec![
            Operation::new("re", vec![Object::Real(0.0), Object::Real(0.0), Object::Real(10.0), Object::Real(20.0)]),
            Operation::new("f", vec![]),
        ]);
        let metrics = measure_stroked_paths(&bytes).unwrap();
        assert_eq!(metrics.node_count, 0);
        assert_eq!(metrics.sharp_turn_count, 0);
        assert_eq!(metrics.length, 0.0);
    }

    #[test]
    fn bbox_of_offset_stroked_rect_is_tight_to_the_path() {
        // A 30x20 rect whose lower-left sits at (15, 5) — the artwork is offset
        // inside a larger page, exactly the multiple-shapes.pdf page-3 case.
        let bytes = encode(vec![
            Operation::new("re", vec![Object::Real(15.0), Object::Real(5.0), Object::Real(30.0), Object::Real(20.0)]),
            Operation::new("S", vec![]),
        ]);
        let (x0, y0, x1, y1) = content_path_bbox(&bytes).unwrap();
        // Default line width 1.0 grows the box by 0.5 on every side.
        assert!((x0 - 14.5).abs() < 1e-6, "x0={x0}");
        assert!((y0 - 4.5).abs() < 1e-6, "y0={y0}");
        assert!((x1 - 45.5).abs() < 1e-6, "x1={x1}");
        assert!((y1 - 25.5).abs() < 1e-6, "y1={y1}");
    }

    #[test]
    fn bbox_honors_ctm_and_includes_filled_paths() {
        // Fill (not stroke) a unit rect translated by (10, 20): bbox must follow the
        // CTM and have no stroke inflation.
        let bytes = encode(vec![
            Operation::new("cm", vec![
                Object::Real(1.0), Object::Real(0.0), Object::Real(0.0), Object::Real(1.0),
                Object::Real(10.0), Object::Real(20.0),
            ]),
            Operation::new("re", vec![Object::Real(0.0), Object::Real(0.0), Object::Real(4.0), Object::Real(6.0)]),
            Operation::new("f", vec![]),
        ]);
        let (x0, y0, x1, y1) = content_path_bbox(&bytes).unwrap();
        assert!((x0 - 10.0).abs() < 1e-6 && (y0 - 20.0).abs() < 1e-6, "{x0},{y0}");
        assert!((x1 - 14.0).abs() < 1e-6 && (y1 - 26.0).abs() < 1e-6, "{x1},{y1}");
    }

    #[test]
    fn bbox_is_none_when_nothing_paints() {
        let bytes = encode(vec![
            Operation::new("re", vec![Object::Real(0.0), Object::Real(0.0), Object::Real(10.0), Object::Real(10.0)]),
            Operation::new("n", vec![]),
        ]);
        assert!(content_path_bbox(&bytes).is_none());
    }
}
