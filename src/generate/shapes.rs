use lopdf::{Document, Object, Dictionary, Stream, content::{Operation, Content}};

use crate::geometry::MM;

// Preset contour shapes offered as an alternative to uploading a contour
// background PDF (see `build_shape_pdf` and src/wasm.rs `generate_shape_pdf`).
#[derive(Clone, Copy)]
pub enum ShapeKind {
    Circle,
    Rectangle,
    RoundedRectangle,
}

impl std::str::FromStr for ShapeKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "circle" => Ok(ShapeKind::Circle),
            "rectangle" => Ok(ShapeKind::Rectangle),
            "rounded-rectangle" => Ok(ShapeKind::RoundedRectangle),
            other => Err(format!("unknown shape \"{other}\" (expected circle, rectangle, or rounded-rectangle)")),
        }
    }
}

// Stroked circle centered at (cx, cy) with radius r, approximated with 4 cubic beziers.
fn circle_stroke_ops(cx: f32, cy: f32, r: f32) -> Vec<Operation> {
    let k = 0.5522847498 * r;
    vec![
        Operation::new("m", vec![Object::Real(cx + r), Object::Real(cy)]),
        Operation::new("c", vec![
            Object::Real(cx + r), Object::Real(cy + k),
            Object::Real(cx + k), Object::Real(cy + r),
            Object::Real(cx), Object::Real(cy + r),
        ]),
        Operation::new("c", vec![
            Object::Real(cx - k), Object::Real(cy + r),
            Object::Real(cx - r), Object::Real(cy + k),
            Object::Real(cx - r), Object::Real(cy),
        ]),
        Operation::new("c", vec![
            Object::Real(cx - r), Object::Real(cy - k),
            Object::Real(cx - k), Object::Real(cy - r),
            Object::Real(cx), Object::Real(cy - r),
        ]),
        Operation::new("c", vec![
            Object::Real(cx + k), Object::Real(cy - r),
            Object::Real(cx + r), Object::Real(cy - k),
            Object::Real(cx + r), Object::Real(cy),
        ]),
        Operation::new("h", vec![]),
        Operation::new("S", vec![]),
    ]
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

// Build a minimal one-page PDF whose MediaBox is `card_w` x `card_h` (in PDF
// points, matching the print background's card size) and whose content is a
// stroked outline of `shape`, inset by `inset_mm` from the card edges (and,
// for RoundedRectangle, with corners of radius `corner_radius_mm`). Used as
// a generated stand-in for a user-supplied contour background PDF.
pub fn build_shape_pdf(card_w: f32, card_h: f32, shape: ShapeKind, inset_mm: f32, corner_radius_mm: f32) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let inset = (inset_mm * MM).max(0.0);
    let x = inset;
    let y = inset;
    let w = (card_w - 2.0 * inset).max(0.0);
    let h = (card_h - 2.0 * inset).max(0.0);

    let mut operations = vec![
        Operation::new("w", vec![Object::Real(1.0)]),
        Operation::new("G", vec![Object::Real(0.0)]),
    ];
    operations.extend(match shape {
        ShapeKind::Circle => circle_stroke_ops(card_w / 2.0, card_h / 2.0, w.min(h) / 2.0),
        ShapeKind::Rectangle => rounded_rect_stroke_ops(x, y, w, h, 0.0),
        ShapeKind::RoundedRectangle => rounded_rect_stroke_ops(x, y, w, h, corner_radius_mm * MM),
    });

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
