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
    bg_form_id: ObjectId,
    layout: &CardLayout,
) -> Result<ObjectId, Box<dyn std::error::Error>> {
    let mut operations = Vec::new();

    for i in 0..layout.cards_per_page {
        let (x, y) = layout.position_serpentine(i);

        operations.push(Operation::new("q", vec![]));
        operations.push(Operation::new("cm", vec![
            Object::Real(1.0), Object::Real(0.0),
            Object::Real(0.0), Object::Real(1.0),
            Object::Real(x), Object::Real(y),
        ]));
        operations.push(Operation::new("Do", vec![Object::Name(b"BG".to_vec())]));
        operations.push(Operation::new("Q", vec![]));
    }

    operations.extend(layout.registration_circles());

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
        res
    }));

    Ok(doc.add_object(Object::Dictionary(page_dict)))
}

// Build a contour page that draws a single grid of spanning lines instead of
// tiling individual card rectangles. Used when the contour shape is a plain
// rectangle at zero inset — replacing (cols * rows) overlapping rectangles with
// (cols + 1) vertical + (rows + 1) horizontal hairlines that share no edges.
pub(crate) fn build_grid_contour_page(
    doc: &mut Document,
    pages_id: ObjectId,
    layout: &CardLayout,
    stroke: TextColor,
) -> Result<ObjectId, Box<dyn std::error::Error>> {
    let rows = layout.rows;
    let cols = layout.cols;
    let grid_w = cols as f32 * layout.card_w + (cols as f32 - 1.0) * layout.gutter_x;
    let grid_h = rows as f32 * layout.card_h + (rows as f32 - 1.0) * layout.gutter_y;
    let x0 = layout.start_x;
    let y0 = layout.start_y;
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

    // Helper: x position of the col-th vertical line.
    let col_x = |col: usize| -> f32 {
        if col < cols { x0 + col as f32 * (layout.card_w + layout.gutter_x) } else { x1 }
    };

    // Helper: y position of the row-th horizontal line.
    let row_y = |row: usize| -> f32 {
        if row < rows { y0 + row as f32 * (layout.card_h + layout.gutter_y) } else { y1 }
    };

    // --- Vertical lines in serpentine order ---
    // Col 0: bottom → top (ly0 → ly1)
    // Col 1: top → bottom (ly1 → ly0)
    // Col n: alternates — even index starts at bottom, odd at top.
    for col in 0..=cols {
        let x = col_x(col);
        let (from_y, to_y) = if col % 2 == 0 { (ly0, ly1) } else { (ly1, ly0) };
        operations.push(Operation::new("m", vec![Object::Real(x), Object::Real(from_y)]));
        operations.push(Operation::new("l", vec![Object::Real(x), Object::Real(to_y)]));
    }

    // --- Horizontal lines in serpentine order, picking up from where the last
    //     vertical line ended ---
    //
    // The last vertical line has index `cols`. It ends at ly1 when cols is even
    // (bottom→top), or ly0 when cols is odd (top→bottom). We are also at x1
    // (rightmost column boundary), so the first horizontal begins at lx1 and
    // goes left. Rows are visited starting from the end nearest to where we
    // just stopped (top-first when the last vertical ended at the top).
    let last_vertical_at_top = cols % 2 == 0;
    for i in 0..=rows {
        // Walk rows from the end where the last vertical finished.
        let row = if last_vertical_at_top { rows - i } else { i };
        let y = row_y(row);
        // i=0: first horizontal, goes right → left (we came from x1).
        let (from_x, to_x) = if i % 2 == 0 { (lx1, lx0) } else { (lx0, lx1) };
        operations.push(Operation::new("m", vec![Object::Real(from_x), Object::Real(y)]));
        operations.push(Operation::new("l", vec![Object::Real(to_x), Object::Real(y)]));
    }

    // Stroke all segments in one pass, then draw registration circles.
    operations.push(Operation::new("S", vec![]));
    operations.extend(layout.registration_circles());

    let content = Content { operations };
    let content_stream = Stream::new(Dictionary::new(), content.encode()?);
    let content_id = doc.add_object(content_stream);

    let mut page_dict = Dictionary::new();
    page_dict.set("Type", Object::Name(b"Page".to_vec()));
    page_dict.set("Parent", Object::Reference(pages_id));
    page_dict.set("MediaBox", Object::Array(layout.host_box.clone()));
    page_dict.set("Contents", Object::Reference(content_id));
    page_dict.set("Resources", Object::Dictionary(Dictionary::new()));

    Ok(doc.add_object(Object::Dictionary(page_dict)))
}
