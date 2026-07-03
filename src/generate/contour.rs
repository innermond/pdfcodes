use lopdf::{Document, Object, Dictionary, Stream, ObjectId, content::{Operation, Content}};

use crate::color::TextColor;
use crate::geometry::{CardLayout, MM};

// Build a single host page laying out the grid (same dimensions, offsets and
// registration circles as the print pages), with every cell showing just the
// background and no label text. Returns the new page's object ID; the
// caller is responsible for adding it to the page tree.
pub(crate) fn build_contour_page(
    doc: &mut Document,
    pages_id: ObjectId,
    catalog_id: ObjectId,
    bg_form_id: ObjectId,
    layout: &CardLayout,
    // Translate the contour outline by (offset_x, offset_y) PDF points relative
    // to each card cell, so the cut can be nudged to align with the print.
    offset_x: f32,
    offset_y: f32,
) -> Result<ObjectId, Box<dyn std::error::Error>> {
    let mut operations = Vec::new();

    for i in 0..layout.cards_per_page {
        let (x, y) = layout.position_serpentine(i);

        operations.push(Operation::new("q", vec![]));
        operations.push(Operation::new("cm", vec![
            Object::Real(1.0), Object::Real(0.0),
            Object::Real(0.0), Object::Real(1.0),
            Object::Real(x + offset_x), Object::Real(y + offset_y),
        ]));
        operations.push(Operation::new("Do", vec![Object::Name(b"BG".to_vec())]));
        operations.push(Operation::new("Q", vec![]));
    }

    // The registration circles are positioning/print marks, not cut lines, so the
    // cut PDF marks them non-printable (an Optional Content Group, view-only).
    let circle_ocg = wrap_registration_circles(doc, catalog_id, &mut operations, layout)?;

    let content = Content { operations };
    let content_stream = Stream::new(Dictionary::new(), content.encode()?);
    let content_id = doc.add_object(content_stream);

    let mut page_dict = Dictionary::new();
    page_dict.set("Type", Object::Name(b"Page".to_vec()));
    page_dict.set("Parent", Object::Reference(pages_id));
    page_dict.set("MediaBox", Object::Array(layout.host_box.clone()));
    page_dict.set("Contents", Object::Reference(content_id));
    page_dict.set("Resources", Object::Dictionary({
        let mut res = Dictionary::new();
        res.set("XObject", Object::Dictionary({
            let mut xobjs = Dictionary::new();
            xobjs.set("BG", Object::Reference(bg_form_id));
            xobjs
        }));
        if let Some(ocg_id) = circle_ocg {
            res.set("Properties", circle_properties(ocg_id));
        }
        res
    }));

    Ok(doc.add_object(Object::Dictionary(page_dict)))
}

// Build the "extra" contour page for a partially-filled last print sheet: the same
// host page as `build_contour_page`, but drawing the contour only in the first `count`
// cells — the cells the print job actually fills on its last sheet — so the cutter
// doesn't trace paths over empty cells. Cells are placed row-major via
// `layout.position(i)` (NOT serpentine), matching how the print fills an incomplete last
// row from the left (mod.rs lays cards out with `CardLayout::position`). Registration
// circles are drawn identically (non-printable). Returns the new page's object ID.
pub(crate) fn build_partial_contour_page(
    doc: &mut Document,
    pages_id: ObjectId,
    catalog_id: ObjectId,
    bg_form_id: ObjectId,
    layout: &CardLayout,
    count: usize,
    offset_x: f32,
    offset_y: f32,
) -> Result<ObjectId, Box<dyn std::error::Error>> {
    let mut operations = Vec::new();

    for i in 0..count {
        let (x, y) = layout.position(i);

        operations.push(Operation::new("q", vec![]));
        operations.push(Operation::new("cm", vec![
            Object::Real(1.0), Object::Real(0.0),
            Object::Real(0.0), Object::Real(1.0),
            Object::Real(x + offset_x), Object::Real(y + offset_y),
        ]));
        operations.push(Operation::new("Do", vec![Object::Name(b"BG".to_vec())]));
        operations.push(Operation::new("Q", vec![]));
    }

    let circle_ocg = wrap_registration_circles(doc, catalog_id, &mut operations, layout)?;

    let content = Content { operations };
    let content_stream = Stream::new(Dictionary::new(), content.encode()?);
    let content_id = doc.add_object(content_stream);

    let mut page_dict = Dictionary::new();
    page_dict.set("Type", Object::Name(b"Page".to_vec()));
    page_dict.set("Parent", Object::Reference(pages_id));
    page_dict.set("MediaBox", Object::Array(layout.host_box.clone()));
    page_dict.set("Contents", Object::Reference(content_id));
    page_dict.set("Resources", Object::Dictionary({
        let mut res = Dictionary::new();
        res.set("XObject", Object::Dictionary({
            let mut xobjs = Dictionary::new();
            xobjs.set("BG", Object::Reference(bg_form_id));
            xobjs
        }));
        if let Some(ocg_id) = circle_ocg {
            res.set("Properties", circle_properties(ocg_id));
        }
        res
    }));

    Ok(doc.add_object(Object::Dictionary(page_dict)))
}

// Append the layout's registration circles to `operations`, wrapped in an
// `/OC /OC0 BDC … EMC` marked-content sequence tied to a fresh non-printable OCG.
// Returns the OCG id (for the page's Resources /Properties), or `None` when the
// layout draws no circles (e.g. no-cut), in which case nothing is appended.
fn wrap_registration_circles(
    doc: &mut Document,
    catalog_id: ObjectId,
    operations: &mut Vec<Operation>,
    layout: &CardLayout,
) -> Result<Option<ObjectId>, Box<dyn std::error::Error>> {
    let circles = layout.registration_circles();
    if circles.is_empty() {
        return Ok(None);
    }
    let ocg_id = super::ocg::add_nonprintable_ocg(doc, catalog_id, b"Registration circles (non-printable)")?;
    operations.push(Operation::new("BDC", vec![Object::Name(b"OC".to_vec()), Object::Name(b"OC0".to_vec())]));
    operations.extend(circles);
    operations.push(Operation::new("EMC", vec![]));
    Ok(Some(ocg_id))
}

// Resources /Properties dict mapping the `/OC0` marked-content tag to `ocg_id`.
fn circle_properties(ocg_id: ObjectId) -> Object {
    let mut props = Dictionary::new();
    props.set("OC0", Object::Reference(ocg_id));
    Object::Dictionary(props)
}

// Build a contour page that draws a single grid of spanning lines instead of
// tiling individual card rectangles. Used when the contour shape is a plain
// rectangle — replacing (cols * rows) overlapping rectangles with spanning
// hairlines that share no edges. With no gutter the card edges coincide into a
// (cols + 1) × (rows + 1) grid; with a gutter (Decalaj) each card keeps its own
// edges, so adjacent cards get two lines a gutter apart.
pub(crate) fn build_grid_contour_page(
    doc: &mut Document,
    pages_id: ObjectId,
    catalog_id: ObjectId,
    layout: &CardLayout,
    stroke: TextColor,
    // Translate the whole grid by (offset_x, offset_y) PDF points. In practice
    // grid contour only runs when the contour fills the card (zero clamp slack),
    // so this is normally 0; kept for consistency with the tiled path.
    offset_x: f32,
    offset_y: f32,
) -> Result<ObjectId, Box<dyn std::error::Error>> {
    let rows = layout.rows;
    let cols = layout.cols;
    let grid_w = cols as f32 * layout.card_w + (cols as f32 - 1.0) * layout.gutter_x;
    let grid_h = rows as f32 * layout.card_h + (rows as f32 - 1.0) * layout.gutter_y;
    let x0 = layout.start_x + offset_x;
    let y0 = layout.start_y + offset_y;
    let x1 = x0 + grid_w;
    let y1 = y0 + grid_h;

    // Extend each line 3 mm past the grid edge so the cutter enters and exits
    // cleanly. Clamped to the registration-circle safe zone so lines don't
    // overlap the circles at the sheet corners.
    let bleed = 3.0 * MM;
    let safe = layout.circle_r * 2.0;
    let lx0 = (x0 - bleed).max(safe);
    let lx1 = (x1 + bleed).min(layout.host_w - safe);
    let ly0 = (y0 - bleed).max(safe);
    let ly1 = (y1 + bleed).min(layout.host_h - safe);

    let stroke_op = match stroke {
        TextColor::Rgb(r, g, b) => Operation::new("RG", vec![Object::Real(r), Object::Real(g), Object::Real(b)]),
        TextColor::Cmyk(c, m, y, k) => Operation::new("K", vec![Object::Real(c), Object::Real(m), Object::Real(y), Object::Real(k)]),
    };

    let mut operations = vec![
        Operation::new("w", vec![Object::Real(0.0)]), // hairline — same as build_shape_pdf
        stroke_op,
    ];

    // Distinct vertical/horizontal line positions = each card's two edges per axis.
    // With a gutter (Decalaj) > 0 the left/right (and bottom/top) edges of adjacent
    // cards are distinct, so every interior boundary yields TWO lines a gutter apart;
    // with no gutter the shared edges coincide and dedupe back to the contiguous
    // (cols + 1)/(rows + 1) grid, so no edge is double-stroked.
    let mut xs: Vec<f32> = Vec::with_capacity(2 * cols);
    for c in 0..cols {
        let left = x0 + c as f32 * (layout.card_w + layout.gutter_x);
        xs.push(left);
        xs.push(left + layout.card_w);
    }
    xs.dedup_by(|a, b| (*a - *b).abs() < 1e-3);

    let mut ys: Vec<f32> = Vec::with_capacity(2 * rows);
    for r in 0..rows {
        let bottom = y0 + r as f32 * (layout.card_h + layout.gutter_y);
        ys.push(bottom);
        ys.push(bottom + layout.card_h);
    }
    ys.dedup_by(|a, b| (*a - *b).abs() < 1e-3);

    // --- Vertical lines in serpentine order ---
    // Line 0: bottom → top (ly0 → ly1); each subsequent line alternates direction
    // (even index starts at the bottom, odd at the top).
    //
    // Each line is stroked on its own (m … l … S) so it stays a separate path:
    // a downstream cutter treats every line as a distinct cuttable path rather
    // than one continuous toolpath. Serpentine ordering is kept only to minimize
    // plotter travel between successive cuts.
    for (i, &x) in xs.iter().enumerate() {
        let (from_y, to_y) = if i % 2 == 0 { (ly0, ly1) } else { (ly1, ly0) };
        operations.push(Operation::new("m", vec![Object::Real(x), Object::Real(from_y)]));
        operations.push(Operation::new("l", vec![Object::Real(x), Object::Real(to_y)]));
        operations.push(Operation::new("S", vec![]));
    }

    // --- Horizontal lines in serpentine order, picking up from where the last
    //     vertical line ended ---
    //
    // The last vertical line ends at the top when its index is even (bottom→top).
    // It's also the rightmost (xs is ascending), so the first horizontal begins at
    // lx1 and goes left. Rows are visited starting from the end nearest to where we
    // just stopped (top-first when the last vertical ended at the top).
    let last_vertical_at_top = xs.len() % 2 == 1;
    for j in 0..ys.len() {
        // Walk rows from the end where the last vertical finished.
        let y = if last_vertical_at_top { ys[ys.len() - 1 - j] } else { ys[j] };
        // j=0: first horizontal, goes right → left (we came from x1).
        let (from_x, to_x) = if j % 2 == 0 { (lx1, lx0) } else { (lx0, lx1) };
        operations.push(Operation::new("m", vec![Object::Real(from_x), Object::Real(y)]));
        operations.push(Operation::new("l", vec![Object::Real(to_x), Object::Real(y)]));
        operations.push(Operation::new("S", vec![]));
    }

    // Each line was stroked individually above; now draw the registration circles
    // as a non-printable layer (positioning/print marks, not cut lines).
    let circle_ocg = wrap_registration_circles(doc, catalog_id, &mut operations, layout)?;

    let content = Content { operations };
    let content_stream = Stream::new(Dictionary::new(), content.encode()?);
    let content_id = doc.add_object(content_stream);

    let mut page_dict = Dictionary::new();
    page_dict.set("Type", Object::Name(b"Page".to_vec()));
    page_dict.set("Parent", Object::Reference(pages_id));
    page_dict.set("MediaBox", Object::Array(layout.host_box.clone()));
    page_dict.set("Contents", Object::Reference(content_id));
    page_dict.set("Resources", Object::Dictionary({
        let mut res = Dictionary::new();
        if let Some(ocg_id) = circle_ocg {
            res.set("Properties", circle_properties(ocg_id));
        }
        res
    }));

    Ok(doc.add_object(Object::Dictionary(page_dict)))
}
