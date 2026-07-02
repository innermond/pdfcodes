use lopdf::{Document, Object, Dictionary, Stream, content::{Operation, Content}};

use crate::color::TextColor;
use crate::geometry::MM;

// Preset contour shapes offered as an alternative to uploading a contour
// background PDF (see `build_shape_pdf` and src/wasm.rs `generate_shape_pdf`).
#[derive(Clone, Copy)]
pub enum ShapeKind {
    Circle,
    Ellipse,
    Rectangle,
    RoundedRectangle,
    BeveledRectangle,
    Heart,
    Polygon,
}

impl std::str::FromStr for ShapeKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "circle" => Ok(ShapeKind::Circle),
            "ellipse" => Ok(ShapeKind::Ellipse),
            "rectangle" => Ok(ShapeKind::Rectangle),
            "rounded-rectangle" => Ok(ShapeKind::RoundedRectangle),
            "beveled-rectangle" => Ok(ShapeKind::BeveledRectangle),
            "heart" => Ok(ShapeKind::Heart),
            "polygon" => Ok(ShapeKind::Polygon),
            other => Err(format!("unknown shape \"{other}\" (expected circle, ellipse, rectangle, rounded-rectangle, beveled-rectangle, heart, or polygon)")),
        }
    }
}

// Stroked ellipse centered at (cx, cy) with radii rx/ry, approximated with 4
// cubic beziers.
fn ellipse_stroke_ops(cx: f32, cy: f32, rx: f32, ry: f32) -> Vec<Operation> {
    let kx = 0.5522847498 * rx;
    let ky = 0.5522847498 * ry;
    vec![
        Operation::new("m", vec![Object::Real(cx + rx), Object::Real(cy)]),
        Operation::new("c", vec![
            Object::Real(cx + rx), Object::Real(cy + ky),
            Object::Real(cx + kx), Object::Real(cy + ry),
            Object::Real(cx), Object::Real(cy + ry),
        ]),
        Operation::new("c", vec![
            Object::Real(cx - kx), Object::Real(cy + ry),
            Object::Real(cx - rx), Object::Real(cy + ky),
            Object::Real(cx - rx), Object::Real(cy),
        ]),
        Operation::new("c", vec![
            Object::Real(cx - rx), Object::Real(cy - ky),
            Object::Real(cx - kx), Object::Real(cy - ry),
            Object::Real(cx), Object::Real(cy - ry),
        ]),
        Operation::new("c", vec![
            Object::Real(cx + kx), Object::Real(cy - ry),
            Object::Real(cx + rx), Object::Real(cy - ky),
            Object::Real(cx + rx), Object::Real(cy),
        ]),
        Operation::new("h", vec![]),
        Operation::new("S", vec![]),
    ]
}

// Stroked circle centered at (cx, cy) with radius r (an ellipse with equal radii).
fn circle_stroke_ops(cx: f32, cy: f32, r: f32) -> Vec<Operation> {
    ellipse_stroke_ops(cx, cy, r, r)
}

// Stroked rectangle at (x, y) sized w x h, with corners rounded to radius
// `r` (0 for a plain rectangle), approximated with cubic beziers at each
// corner. `r` is clamped so opposite corner arcs never overlap.
//
// When `concave` is false the corner arcs bulge outward (the usual rounded
// rectangle). When true, each corner is a quarter-circle centered on the outer
// corner point, so the arc curves into the interior — a scalloped/notched
// corner. Either way the straight edges and the points where arcs meet them are
// identical; only the bezier control points differ.
fn rounded_rect_stroke_ops(x: f32, y: f32, w: f32, h: f32, r: f32, concave: bool) -> Vec<Operation> {
    let r = r.max(0.0).min(w / 2.0).min(h / 2.0);
    if r <= 0.0 {
        return vec![
            Operation::new("re", vec![Object::Real(x), Object::Real(y), Object::Real(w), Object::Real(h)]),
            Operation::new("S", vec![]),
        ];
    }
    let k = 0.5522847498 * r;
    // The two control points for each corner's bezier, listed clockwise from the
    // bottom-right corner, matching the path order below.
    let [br, tr, tl, bl] = if concave {
        [
            [(x + w - r, y + k), (x + w - k, y + r)],         // centered at (x+w, y)
            [(x + w - k, y + h - r), (x + w - r, y + h - k)], // centered at (x+w, y+h)
            [(x + r, y + h - k), (x + k, y + h - r)],         // centered at (x, y+h)
            [(x + k, y + r), (x + r, y + k)],                 // centered at (x, y)
        ]
    } else {
        [
            [(x + w - r + k, y), (x + w, y + r - k)],
            [(x + w, y + h - r + k), (x + w - r + k, y + h)],
            [(x + r - k, y + h), (x, y + h - r + k)],
            [(x, y + r - k), (x + r - k, y)],
        ]
    };
    vec![
        Operation::new("m", vec![Object::Real(x + r), Object::Real(y)]),
        Operation::new("l", vec![Object::Real(x + w - r), Object::Real(y)]),
        Operation::new("c", vec![
            Object::Real(br[0].0), Object::Real(br[0].1),
            Object::Real(br[1].0), Object::Real(br[1].1),
            Object::Real(x + w), Object::Real(y + r),
        ]),
        Operation::new("l", vec![Object::Real(x + w), Object::Real(y + h - r)]),
        Operation::new("c", vec![
            Object::Real(tr[0].0), Object::Real(tr[0].1),
            Object::Real(tr[1].0), Object::Real(tr[1].1),
            Object::Real(x + w - r), Object::Real(y + h),
        ]),
        Operation::new("l", vec![Object::Real(x + r), Object::Real(y + h)]),
        Operation::new("c", vec![
            Object::Real(tl[0].0), Object::Real(tl[0].1),
            Object::Real(tl[1].0), Object::Real(tl[1].1),
            Object::Real(x), Object::Real(y + h - r),
        ]),
        Operation::new("l", vec![Object::Real(x), Object::Real(y + r)]),
        Operation::new("c", vec![
            Object::Real(bl[0].0), Object::Real(bl[0].1),
            Object::Real(bl[1].0), Object::Real(bl[1].1),
            Object::Real(x + r), Object::Real(y),
        ]),
        Operation::new("h", vec![]),
        Operation::new("S", vec![]),
    ]
}

// Stroked rectangle at (x, y) sized w x h whose corners are cut off (chamfered)
// by `b` — each 90° corner becomes a straight diagonal of leg length `b`. `b`
// is clamped so opposite chamfers never overlap; `b <= 0` yields a plain
// rectangle.
fn beveled_rect_stroke_ops(x: f32, y: f32, w: f32, h: f32, b: f32) -> Vec<Operation> {
    let b = b.max(0.0).min(w / 2.0).min(h / 2.0);
    if b <= 0.0 {
        return vec![
            Operation::new("re", vec![Object::Real(x), Object::Real(y), Object::Real(w), Object::Real(h)]),
            Operation::new("S", vec![]),
        ];
    }
    vec![
        Operation::new("m", vec![Object::Real(x + b), Object::Real(y)]),
        Operation::new("l", vec![Object::Real(x + w - b), Object::Real(y)]),
        Operation::new("l", vec![Object::Real(x + w), Object::Real(y + b)]),
        Operation::new("l", vec![Object::Real(x + w), Object::Real(y + h - b)]),
        Operation::new("l", vec![Object::Real(x + w - b), Object::Real(y + h)]),
        Operation::new("l", vec![Object::Real(x + b), Object::Real(y + h)]),
        Operation::new("l", vec![Object::Real(x), Object::Real(y + h - b)]),
        Operation::new("l", vec![Object::Real(x), Object::Real(y + b)]),
        Operation::new("h", vec![]),
        Operation::new("S", vec![]),
    ]
}

// Stroked heart filling the box at (x, y) sized w x h: a pointed tip at the
// bottom-center, two circular lobes across the top, and curved sides between.
// Built from cubic beziers in a normalized 0..1 box (so it stretches with a
// non-square box) — each lobe is a semicircle (two quarter-circle arcs).
fn heart_stroke_ops(x: f32, y: f32, w: f32, h: f32) -> Vec<Operation> {
    let px = |nx: f32| x + nx * w;
    let py = |ny: f32| y + ny * h;
    // Quarter-circle bezier constant for the lobe radius of 0.25 (in normalized
    // units); lobes are centered at y=0.75 and peak at the top (y=1).
    let k = 0.5522847498 * 0.25;
    vec![
        // Bottom tip.
        Operation::new("m", vec![Object::Real(px(0.5)), Object::Real(py(0.0))]),
        // Left side: tip up to the left outer edge.
        Operation::new("c", vec![
            Object::Real(px(0.4)), Object::Real(py(0.1)),
            Object::Real(px(0.0)), Object::Real(py(0.5)),
            Object::Real(px(0.0)), Object::Real(py(0.75)),
        ]),
        // Left lobe: outer edge over the top.
        Operation::new("c", vec![
            Object::Real(px(0.0)), Object::Real(py(0.75 + k)),
            Object::Real(px(0.25 - k)), Object::Real(py(1.0)),
            Object::Real(px(0.25)), Object::Real(py(1.0)),
        ]),
        // Left lobe: top down into the center cleft.
        Operation::new("c", vec![
            Object::Real(px(0.25 + k)), Object::Real(py(1.0)),
            Object::Real(px(0.5)), Object::Real(py(0.75 + k)),
            Object::Real(px(0.5)), Object::Real(py(0.75)),
        ]),
        // Right lobe: cleft up over the top.
        Operation::new("c", vec![
            Object::Real(px(0.5)), Object::Real(py(0.75 + k)),
            Object::Real(px(0.75 - k)), Object::Real(py(1.0)),
            Object::Real(px(0.75)), Object::Real(py(1.0)),
        ]),
        // Right lobe: top down to the right outer edge.
        Operation::new("c", vec![
            Object::Real(px(0.75 + k)), Object::Real(py(1.0)),
            Object::Real(px(1.0)), Object::Real(py(0.75 + k)),
            Object::Real(px(1.0)), Object::Real(py(0.75)),
        ]),
        // Right side: outer edge back down to the tip.
        Operation::new("c", vec![
            Object::Real(px(1.0)), Object::Real(py(0.5)),
            Object::Real(px(0.6)), Object::Real(py(0.1)),
            Object::Real(px(0.5)), Object::Real(py(0.0)),
        ]),
        Operation::new("h", vec![]),
        Operation::new("S", vec![]),
    ]
}

// Depth of a star's inner vertices as a fraction of the outer radius. For n >= 5
// this is the classic star silhouette (inner points sit where a {n/2} star
// polygon's edges would cross, e.g. 0.382 for a pentagram, 0.577 for a hexagram);
// n = 3/4 have no such polygon, so a plain 0.5 gives a reasonable 3-/4-point star.
// Kept identical to `starInnerRatio` in web-preview/src/lib/contourMask.ts.
fn star_inner_ratio(n: u32) -> f32 {
    let ratio = if n >= 5 {
        let a = std::f32::consts::TAU / (n as f32);
        (a).cos() / (a / 2.0).cos()
    } else {
        0.5
    };
    ratio.clamp(0.05, 0.95)
}

// Point-up regular polygon (or star) vertices at circumradius 1, in PDF y-up
// coords (first vertex at the top). For a star an inner vertex is inserted
// between each pair of outer points. Mirrored by `polygonUnitVertices` in
// web-preview/src/lib/contourMask.ts.
fn polygon_unit_vertices(sides: u32, star: bool) -> Vec<(f32, f32)> {
    let n = sides.max(3);
    let step = std::f32::consts::TAU / (n as f32);
    let r_in = if star { star_inner_ratio(n) } else { 0.0 };
    let mut verts = Vec::with_capacity((if star { 2 * n } else { n }) as usize);
    for i in 0..n {
        let ao = std::f32::consts::FRAC_PI_2 + (i as f32) * step;
        verts.push((ao.cos(), ao.sin()));
        if star {
            let ai = ao + step / 2.0;
            verts.push((r_in * ai.cos(), r_in * ai.sin()));
        }
    }
    verts
}

// Stroked regular polygon (or star) scaled to *fill* the box (x, y, w, h): its
// bounding box maps onto the box, so a non-square box stretches it — matching how
// the ellipse fills its inset rectangle. The first vertex points straight up.
fn polygon_stroke_ops(x: f32, y: f32, w: f32, h: f32, sides: u32, star: bool) -> Vec<Operation> {
    let verts = polygon_unit_vertices(sides, star);
    let (mut min_x, mut max_x, mut min_y, mut max_y) = (f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::NEG_INFINITY);
    for &(vx, vy) in &verts {
        min_x = min_x.min(vx);
        max_x = max_x.max(vx);
        min_y = min_y.min(vy);
        max_y = max_y.max(vy);
    }
    let span_x = (max_x - min_x).max(1e-6);
    let span_y = (max_y - min_y).max(1e-6);
    let mut ops = Vec::with_capacity(verts.len() + 2);
    for (i, &(vx, vy)) in verts.iter().enumerate() {
        let px = x + (vx - min_x) / span_x * w;
        let py = y + (vy - min_y) / span_y * h;
        let op = if i == 0 { "m" } else { "l" };
        ops.push(Operation::new(op, vec![Object::Real(px), Object::Real(py)]));
    }
    ops.push(Operation::new("h", vec![]));
    ops.push(Operation::new("S", vec![]));
    ops
}

// Assemble a minimal one-page PDF whose MediaBox is `card_w` x `card_h` (in
// PDF points, matching the print background's card size) with the given
// content stream operations. Shared by `build_shape_pdf` and
// `build_simple_background_pdf`.
fn build_single_page_pdf(card_w: f32, card_h: f32, operations: Vec<Operation>) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    let content = Content { operations };
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content.encode()?));

    let media_box = vec![Object::Real(0.0), Object::Real(0.0), Object::Real(card_w), Object::Real(card_h)];

    let mut page_dict = Dictionary::new();
    page_dict.set("Type", Object::Name(b"Page".to_vec()));
    page_dict.set("Parent", Object::Reference(pages_id));
    page_dict.set("Contents", Object::Reference(content_id));
    page_dict.set("MediaBox", Object::Array(media_box));
    let page_id = doc.add_object(Object::Dictionary(page_dict));

    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
    pages_dict.set("Count", Object::Integer(1));
    doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

    let mut catalog_dict = Dictionary::new();
    catalog_dict.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog_dict.set("Pages", Object::Reference(pages_id));
    let catalog_id = doc.add_object(Object::Dictionary(catalog_dict));

    doc.trailer.set("Root", Object::Reference(catalog_id));

    let mut buf = Vec::new();
    doc.save_to(&mut buf)?;
    Ok(buf)
}

// Build a minimal one-page PDF whose MediaBox is `card_w` x `card_h` (in PDF
// points, matching the print background's card size) and whose content is a
// stroked outline of `shape`, inset by `inset_mm` from the card edges.
// `corner_radius_mm` is the corner radius for RoundedRectangle and the chamfer
// leg length for BeveledRectangle; it's ignored by the other shapes.
// `corner_concave` flips RoundedRectangle's corners to curve inward (ignored by
// the other shapes). `sides` is the vertex count for Polygon and `star` turns it
// into an N-pointed star (both ignored by the other shapes). Used as a generated
// stand-in for a user-supplied contour background PDF.
pub fn build_shape_pdf(card_w: f32, card_h: f32, shape: ShapeKind, inset_mm: f32, corner_radius_mm: f32, corner_concave: bool, stroke: TextColor, sides: u32, star: bool) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let inset = (inset_mm * MM).max(0.0);
    let x = inset;
    let y = inset;
    let w = (card_w - 2.0 * inset).max(0.0);
    let h = (card_h - 2.0 * inset).max(0.0);

    // Stroke color uses the uppercase (stroking) color operators: `RG` for RGB,
    // `K` for CMYK.
    let stroke_op = match stroke {
        TextColor::Rgb(r, g, b) => Operation::new("RG", vec![Object::Real(r), Object::Real(g), Object::Real(b)]),
        TextColor::Cmyk(c, m, y, k) => Operation::new("K", vec![Object::Real(c), Object::Real(m), Object::Real(y), Object::Real(k)]),
    };
    // Line width 0 is a PDF hairline: the thinnest line the output device can
    // render (one device pixel), independent of scale — what cutters/plotters
    // expect for a cut contour.
    let mut operations = vec![
        Operation::new("w", vec![Object::Real(0.0)]),
        stroke_op,
    ];
    operations.extend(match shape {
        ShapeKind::Circle => circle_stroke_ops(card_w / 2.0, card_h / 2.0, w.min(h) / 2.0),
        ShapeKind::Ellipse => ellipse_stroke_ops(card_w / 2.0, card_h / 2.0, w / 2.0, h / 2.0),
        ShapeKind::Rectangle => rounded_rect_stroke_ops(x, y, w, h, 0.0, false),
        ShapeKind::RoundedRectangle => rounded_rect_stroke_ops(x, y, w, h, corner_radius_mm * MM, corner_concave),
        ShapeKind::BeveledRectangle => beveled_rect_stroke_ops(x, y, w, h, corner_radius_mm * MM),
        ShapeKind::Heart => heart_stroke_ops(x, y, w, h),
        ShapeKind::Polygon => polygon_stroke_ops(x, y, w, h, sides, star),
    });

    build_single_page_pdf(card_w, card_h, operations)
}

// Build a minimal one-page background PDF sized `card_w` x `card_h` (in PDF
// points). When `fill` is given the whole page is filled with that color;
// otherwise the page is left blank. Used as a generated stand-in for a
// user-supplied print background PDF.
pub fn build_simple_background_pdf(card_w: f32, card_h: f32, fill: Option<TextColor>) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let operations = match fill {
        Some(color) => {
            let color_op = match color {
                TextColor::Rgb(r, g, b) => Operation::new("rg", vec![Object::Real(r), Object::Real(g), Object::Real(b)]),
                TextColor::Cmyk(c, m, y, k) => Operation::new("k", vec![Object::Real(c), Object::Real(m), Object::Real(y), Object::Real(k)]),
            };
            vec![
                color_op,
                Operation::new("re", vec![Object::Real(0.0), Object::Real(0.0), Object::Real(card_w), Object::Real(card_h)]),
                Operation::new("f", vec![]),
            ]
        }
        None => Vec::new(),
    };

    build_single_page_pdf(card_w, card_h, operations)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::parse_color;

    // Decode the single page's content stream operations from a built PDF.
    fn page_operations(pdf: &[u8]) -> Vec<Operation> {
        let doc = Document::load_mem(pdf).expect("pdf should parse");
        let (_, page_id) = doc.get_pages().into_iter().next().expect("one page");
        let content = doc.get_page_content(page_id).expect("page content");
        Content::decode(&content).expect("content should decode").operations
    }

    // PDF numbers round-trip through the content encoder as either Real or
    // Integer (whole numbers lose their decimal), so compare numeric values.
    fn nums(objs: &[Object]) -> Vec<f32> {
        objs.iter()
            .map(|o| match o {
                Object::Real(v) => *v,
                Object::Integer(v) => *v as f32,
                _ => panic!("unexpected numeric value"),
            })
            .collect()
    }

    // The page's MediaBox, read as four numbers in PDF points.
    fn media_box(pdf: &[u8]) -> Vec<f32> {
        let doc = Document::load_mem(pdf).expect("pdf should parse");
        let (_, page_id) = doc.get_pages().into_iter().next().expect("one page");
        let page = doc.get_dictionary(page_id).expect("page dict");
        nums(page.get(b"MediaBox").and_then(Object::as_array).expect("MediaBox"))
    }

    #[test]
    fn simple_background_with_color_fills_the_whole_page() {
        let pdf = build_simple_background_pdf(200.0, 100.0, Some(parse_color("#FF0000").unwrap())).unwrap();

        assert_eq!(media_box(&pdf), vec![0.0, 0.0, 200.0, 100.0]);

        let ops = page_operations(&pdf);
        let rg = ops.iter().find(|op| op.operator == "rg").expect("rg operator");
        assert_eq!(nums(&rg.operands), vec![1.0, 0.0, 0.0]);
        let re = ops.iter().find(|op| op.operator == "re").expect("re operator");
        assert_eq!(nums(&re.operands), vec![0.0, 0.0, 200.0, 100.0]);
        assert!(ops.iter().any(|op| op.operator == "f"), "page should be filled");
    }

    #[test]
    fn simple_background_with_cmyk_color_uses_k_operator() {
        let pdf = build_simple_background_pdf(50.0, 50.0, Some(parse_color("0:0:0:1").unwrap())).unwrap();
        let ops = page_operations(&pdf);
        let k = ops.iter().find(|op| op.operator == "k").expect("k operator");
        assert_eq!(nums(&k.operands), vec![0.0, 0.0, 0.0, 1.0]);
        assert!(ops.iter().any(|op| op.operator == "f"));
    }

    #[test]
    fn ellipse_fills_the_inset_rectangle_and_is_stroked_not_filled() {
        // 200x100 card, no inset: rx=100, ry=50, centered at (100, 50).
        let pdf = build_shape_pdf(200.0, 100.0, ShapeKind::Ellipse, 0.0, 0.0, false, TextColor::Cmyk(0.0, 0.0, 0.0, 1.0), 3, false).unwrap();
        let ops = page_operations(&pdf);

        let m = ops.iter().find(|op| op.operator == "m").expect("moveto");
        assert_eq!(nums(&m.operands), vec![200.0, 50.0]); // cx + rx, cy

        assert!(ops.iter().any(|op| op.operator == "S"), "ellipse is stroked");
        assert!(ops.iter().all(|op| op.operator != "f"), "ellipse is not filled");

        // The requested CMYK stroke color is emitted via the `K` operator.
        let k = ops.iter().find(|op| op.operator == "K").expect("stroke color");
        assert_eq!(nums(&k.operands), vec![0.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn beveled_rectangle_chamfers_each_corner_with_straight_lines() {
        // 200x100 card, no inset, 10pt bevel. The path is moveto + 7 lineto +
        // close + stroke; no curves, no fill.
        let pdf = build_shape_pdf(200.0, 100.0, ShapeKind::BeveledRectangle, 0.0, 10.0 / MM, false, TextColor::Cmyk(0.0, 0.0, 0.0, 1.0), 3, false).unwrap();
        let ops = page_operations(&pdf);

        let m = ops.iter().find(|op| op.operator == "m").expect("moveto");
        assert_eq!(nums(&m.operands), vec![10.0, 0.0]); // x + b, y — first point after bottom-left chamfer

        assert_eq!(ops.iter().filter(|op| op.operator == "l").count(), 7, "7 line segments");
        assert!(ops.iter().all(|op| op.operator != "c"), "bevels are straight, not curved");
        assert!(ops.iter().any(|op| op.operator == "S"), "shape is stroked");
        assert!(ops.iter().all(|op| op.operator != "f"), "shape is not filled");
    }

    #[test]
    fn heart_starts_at_the_bottom_tip_and_is_built_from_curves() {
        // 200x100 card, no inset: tip is centered at the bottom, (100, 0).
        let pdf = build_shape_pdf(200.0, 100.0, ShapeKind::Heart, 0.0, 0.0, false, TextColor::Cmyk(0.0, 0.0, 0.0, 1.0), 3, false).unwrap();
        let ops = page_operations(&pdf);

        let m = ops.iter().find(|op| op.operator == "m").expect("moveto");
        assert_eq!(nums(&m.operands), vec![100.0, 0.0]); // tip at bottom-center

        assert_eq!(ops.iter().filter(|op| op.operator == "c").count(), 6, "two sides + four lobe arcs");
        assert!(ops.iter().any(|op| op.operator == "S"), "heart is stroked");
        assert!(ops.iter().all(|op| op.operator != "f"), "heart is not filled");
    }

    #[test]
    fn polygon_has_one_vertex_per_side_pointing_up_and_is_stroked_not_filled() {
        // 100x100 card, no inset, 6 sides: a hexagon filling the box, so its top
        // vertex sits at the top-center, (50, 100).
        let pdf = build_shape_pdf(100.0, 100.0, ShapeKind::Polygon, 0.0, 0.0, false, TextColor::Cmyk(0.0, 0.0, 0.0, 1.0), 6, false).unwrap();
        let ops = page_operations(&pdf);

        let m = ops.iter().find(|op| op.operator == "m").expect("moveto");
        let start = nums(&m.operands);
        assert!((start[0] - 50.0).abs() < 1e-3 && (start[1] - 100.0).abs() < 1e-3, "first vertex points up");

        // moveto + 5 lineto (one per remaining vertex), no curves, closed + stroked.
        assert_eq!(ops.iter().filter(|op| op.operator == "l").count(), 5, "n-1 line segments");
        assert!(ops.iter().all(|op| op.operator != "c"), "polygon edges are straight");
        assert!(ops.iter().any(|op| op.operator == "S"), "polygon is stroked");
        assert!(ops.iter().all(|op| op.operator != "f"), "polygon is not filled");
    }

    #[test]
    fn polygon_clamps_sides_below_three_to_a_triangle() {
        let pdf = build_shape_pdf(100.0, 100.0, ShapeKind::Polygon, 0.0, 0.0, false, TextColor::Cmyk(0.0, 0.0, 0.0, 1.0), 1, false).unwrap();
        let ops = page_operations(&pdf);
        assert_eq!(ops.iter().filter(|op| op.operator == "l").count(), 2, "1 moveto + 2 lineto = triangle");
    }

    #[test]
    fn polygon_star_doubles_the_vertices_with_alternating_inner_points() {
        // 100x100 card, 5-point star: 10 vertices (5 outer + 5 inner), so
        // moveto + 9 lineto. The first (outer) vertex still points straight up.
        let pdf = build_shape_pdf(100.0, 100.0, ShapeKind::Polygon, 0.0, 0.0, false, TextColor::Cmyk(0.0, 0.0, 0.0, 1.0), 5, true).unwrap();
        let ops = page_operations(&pdf);

        let m = ops.iter().find(|op| op.operator == "m").expect("moveto");
        let start = nums(&m.operands);
        assert!((start[0] - 50.0).abs() < 1e-3 && (start[1] - 100.0).abs() < 1e-3, "first outer vertex points up");
        assert_eq!(ops.iter().filter(|op| op.operator == "l").count(), 9, "2n-1 segments for a star");
        assert!(ops.iter().all(|op| op.operator != "c"), "star edges are straight");
        assert!(ops.iter().all(|op| op.operator != "f"), "star is not filled");

        // The vertex right after the first outer point is an inner point: same
        // angle bucket but closer to the center than the outer radius (50).
        let first_l = ops.iter().find(|op| op.operator == "l").expect("lineto");
        let p = nums(&first_l.operands);
        let inner_r = ((p[0] - 50.0).powi(2) + (p[1] - 50.0).powi(2)).sqrt();
        assert!(inner_r < 50.0 && inner_r > 1.0, "inner vertex sits between center and outer radius");
    }

    #[test]
    fn rounded_rectangle_concave_centers_corner_arcs_on_the_outer_corner() {
        // 200x100 card, no inset, r=10. Both orientations share the same edge
        // endpoints (4 lines + 4 curves); only the control points differ. The
        // concave bottom-right arc is a quarter circle centered on (200, 0), so
        // its first control point sits at (x+w-r, y+k) = (190, k).
        let r = 10.0;
        let k = 0.5522847498 * r;
        let concave = build_shape_pdf(200.0, 100.0, ShapeKind::RoundedRectangle, 0.0, r / MM, true, TextColor::Cmyk(0.0, 0.0, 0.0, 1.0), 3, false).unwrap();
        let convex = build_shape_pdf(200.0, 100.0, ShapeKind::RoundedRectangle, 0.0, r / MM, false, TextColor::Cmyk(0.0, 0.0, 0.0, 1.0), 3, false).unwrap();

        let concave_ops = page_operations(&concave);
        let convex_ops = page_operations(&convex);
        // Same path structure: 4 straight edges and 4 corner curves either way.
        for ops in [&concave_ops, &convex_ops] {
            assert_eq!(ops.iter().filter(|op| op.operator == "l").count(), 4);
            assert_eq!(ops.iter().filter(|op| op.operator == "c").count(), 4);
        }

        let first_curve = concave_ops.iter().find(|op| op.operator == "c").expect("curve");
        let p = nums(&first_curve.operands);
        assert!((p[0] - 190.0).abs() < 1e-3 && (p[1] - k).abs() < 1e-3, "first control point is centered on the outer corner");
    }

    #[test]
    fn simple_background_without_color_is_blank() {
        let pdf = build_simple_background_pdf(120.0, 80.0, None).unwrap();
        assert_eq!(media_box(&pdf), vec![0.0, 0.0, 120.0, 80.0]);
        let ops = page_operations(&pdf);
        assert!(ops.iter().all(|op| op.operator != "f"), "blank page has no fill");
        assert!(ops.iter().all(|op| op.operator != "rg" && op.operator != "k"), "blank page sets no color");
    }
}
