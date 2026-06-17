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
}

impl std::str::FromStr for ShapeKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "circle" => Ok(ShapeKind::Circle),
            "ellipse" => Ok(ShapeKind::Ellipse),
            "rectangle" => Ok(ShapeKind::Rectangle),
            "rounded-rectangle" => Ok(ShapeKind::RoundedRectangle),
            other => Err(format!("unknown shape \"{other}\" (expected circle, ellipse, rectangle, or rounded-rectangle)")),
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
fn rounded_rect_stroke_ops(x: f32, y: f32, w: f32, h: f32, r: f32) -> Vec<Operation> {
    let r = r.max(0.0).min(w / 2.0).min(h / 2.0);
    if r <= 0.0 {
        return vec![
            Operation::new("re", vec![Object::Real(x), Object::Real(y), Object::Real(w), Object::Real(h)]),
            Operation::new("S", vec![]),
        ];
    }
    let k = 0.5522847498 * r;
    vec![
        Operation::new("m", vec![Object::Real(x + r), Object::Real(y)]),
        Operation::new("l", vec![Object::Real(x + w - r), Object::Real(y)]),
        Operation::new("c", vec![
            Object::Real(x + w - r + k), Object::Real(y),
            Object::Real(x + w), Object::Real(y + r - k),
            Object::Real(x + w), Object::Real(y + r),
        ]),
        Operation::new("l", vec![Object::Real(x + w), Object::Real(y + h - r)]),
        Operation::new("c", vec![
            Object::Real(x + w), Object::Real(y + h - r + k),
            Object::Real(x + w - r + k), Object::Real(y + h),
            Object::Real(x + w - r), Object::Real(y + h),
        ]),
        Operation::new("l", vec![Object::Real(x + r), Object::Real(y + h)]),
        Operation::new("c", vec![
            Object::Real(x + r - k), Object::Real(y + h),
            Object::Real(x), Object::Real(y + h - r + k),
            Object::Real(x), Object::Real(y + h - r),
        ]),
        Operation::new("l", vec![Object::Real(x), Object::Real(y + r)]),
        Operation::new("c", vec![
            Object::Real(x), Object::Real(y + r - k),
            Object::Real(x + r - k), Object::Real(y),
            Object::Real(x + r), Object::Real(y),
        ]),
        Operation::new("h", vec![]),
        Operation::new("S", vec![]),
    ]
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
// stroked outline of `shape`, inset by `inset_mm` from the card edges (and,
// for RoundedRectangle, with corners of radius `corner_radius_mm`). Used as
// a generated stand-in for a user-supplied contour background PDF.
pub fn build_shape_pdf(card_w: f32, card_h: f32, shape: ShapeKind, inset_mm: f32, corner_radius_mm: f32, stroke: TextColor) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
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
    let mut operations = vec![
        Operation::new("w", vec![Object::Real(1.0)]),
        stroke_op,
    ];
    operations.extend(match shape {
        ShapeKind::Circle => circle_stroke_ops(card_w / 2.0, card_h / 2.0, w.min(h) / 2.0),
        ShapeKind::Ellipse => ellipse_stroke_ops(card_w / 2.0, card_h / 2.0, w / 2.0, h / 2.0),
        ShapeKind::Rectangle => rounded_rect_stroke_ops(x, y, w, h, 0.0),
        ShapeKind::RoundedRectangle => rounded_rect_stroke_ops(x, y, w, h, corner_radius_mm * MM),
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
        let pdf = build_shape_pdf(200.0, 100.0, ShapeKind::Ellipse, 0.0, 0.0, TextColor::Cmyk(0.0, 0.0, 0.0, 1.0)).unwrap();
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
    fn simple_background_without_color_is_blank() {
        let pdf = build_simple_background_pdf(120.0, 80.0, None).unwrap();
        assert_eq!(media_box(&pdf), vec![0.0, 0.0, 120.0, 80.0]);
        let ops = page_operations(&pdf);
        assert!(ops.iter().all(|op| op.operator != "f"), "blank page has no fill");
        assert!(ops.iter().all(|op| op.operator != "rg" && op.operator != "k"), "blank page sets no color");
    }
}
