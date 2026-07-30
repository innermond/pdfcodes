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
    // "Nu desena cercurile" clears this to skip the registration circles; the
    // layout (and so the cut positions) is identical either way.
    draw_circles: bool,
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
    let circle_ocg = wrap_registration_circles(doc, catalog_id, &mut operations, layout, draw_circles)?;

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
// circles are drawn identically (non-printable, and skipped when `draw_circles` is
// false). Returns the new page's object ID.
pub(crate) fn build_partial_contour_page(
    doc: &mut Document,
    pages_id: ObjectId,
    catalog_id: ObjectId,
    bg_form_id: ObjectId,
    layout: &CardLayout,
    count: usize,
    draw_circles: bool,
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

    let circle_ocg = wrap_registration_circles(doc, catalog_id, &mut operations, layout, draw_circles)?;

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
// Returns the OCG id (for the page's Resources /Properties), or `None` when no
// circles are drawn — either because the caller asked for none ("Nu desena
// cercurile") or the layout has none (e.g. no-cut) — in which case nothing is
// appended and no OCG is created.
fn wrap_registration_circles(
    doc: &mut Document,
    catalog_id: ObjectId,
    operations: &mut Vec<Operation>,
    layout: &CardLayout,
    draw_circles: bool,
) -> Result<Option<ObjectId>, Box<dyn std::error::Error>> {
    if !draw_circles {
        return Ok(None);
    }
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

// Cut-line geometry of the optimized grid page: each line as one maximal straight
// segment, already extended past the outermost cards it serves. Shared by the
// drawing (`build_grid_contour_page`) and the analytic cutting metrics
// (`grid_page_metrics`) so they can't drift apart.
pub(crate) struct GridSegments {
    // Vertical cut lines as (x, y_from, y_to) with y_from < y_to, ascending x.
    pub verticals: Vec<(f32, f32, f32)>,
    // Horizontal cut lines as (y, x_from, x_to) with x_from < x_to, ascending y.
    pub horizontals: Vec<(f32, f32, f32)>,
}

// Cut lines for a sheet whose first `cells` cells carry a card (row-major, via
// `CardLayout::position` — the order the print job fills a sheet in). `cells ==
// cards_per_page` is the full grid; a smaller count is the partially-filled last
// sheet, where every line stops at the last card that needs it instead of running
// the whole grid. Lines are still shared between neighbouring cards, so a common
// edge is stroked once.
fn grid_segments(layout: &CardLayout, cells: usize, offset_x: f32, offset_y: f32) -> GridSegments {
    let cols = layout.cols.max(1);
    let cells = cells.min(layout.cards_per_page);
    let x0 = layout.start_x + offset_x;
    let y0 = layout.start_y + offset_y;

    // Cards fill whole rows from row 0; only the last row can be short.
    let full_rows = cells / cols;
    let rem = cells % cols;
    let rows = full_rows + usize::from(rem > 0);
    let filled_in_row = |r: usize| if r < full_rows { cols } else { rem };

    let cell_x = |c: usize| x0 + c as f32 * (layout.card_w + layout.gutter_x);
    let cell_y = |r: usize| y0 + r as f32 * (layout.card_h + layout.gutter_y);

    // Distinct vertical/horizontal line positions = each card's two edges per axis,
    // tracked with the range of rows (resp. columns) whose cards actually touch that
    // line. With a gutter (Decalaj) > 0 the left/right (and bottom/top) edges of
    // adjacent cards are distinct, so every interior boundary yields TWO lines a
    // gutter apart; with no gutter the shared edges coincide and collapse back to the
    // contiguous grid, so no edge is double-stroked.
    // (f32, min index, max index)
    let mut xs: Vec<(f32, usize, usize)> = Vec::with_capacity(2 * cols);
    let mut ys: Vec<(f32, usize, usize)> = Vec::with_capacity(2 * rows);
    fn record(acc: &mut Vec<(f32, usize, usize)>, at: f32, idx: usize) {
        match acc.iter_mut().find(|e| (e.0 - at).abs() < 1e-3) {
            Some(e) => {
                e.1 = e.1.min(idx);
                e.2 = e.2.max(idx);
            }
            None => acc.push((at, idx, idx)),
        }
    }
    for r in 0..rows {
        for c in 0..filled_in_row(r) {
            record(&mut xs, cell_x(c), r);
            record(&mut xs, cell_x(c) + layout.card_w, r);
            record(&mut ys, cell_y(r), c);
            record(&mut ys, cell_y(r) + layout.card_h, c);
        }
    }
    xs.sort_by(|a, b| a.0.total_cmp(&b.0));
    ys.sort_by(|a, b| a.0.total_cmp(&b.0));

    // Extend each line 3 mm past the outermost card it serves so the cutter enters
    // and exits cleanly. Clamped to the registration-circle safe zone so lines don't
    // overlap the circles at the sheet corners.
    let bleed = 3.0 * MM;
    let safe = layout.circle_r * 2.0;
    let verticals = xs.iter()
        .map(|&(x, r_lo, r_hi)| (
            x,
            (cell_y(r_lo) - bleed).max(safe),
            (cell_y(r_hi) + layout.card_h + bleed).min(layout.host_h - safe),
        ))
        .collect();
    let horizontals = ys.iter()
        .map(|&(y, c_lo, c_hi)| (
            y,
            (cell_x(c_lo) - bleed).max(safe),
            (cell_x(c_hi) + layout.card_w + bleed).min(layout.host_w - safe),
        ))
        .collect();

    GridSegments { verticals, horizontals }
}

// Analytic cut metrics of one full grid page. The grid shares cut lines
// between neighbouring cards, so measuring one card's outline and scaling it
// by the card count (the tiled path's model) would overcount — instead the
// page's real line geometry is totalled: every line is a straight two-node
// subpath (no sharp turns), and the serpentine cutting order makes the
// between-line travel telescope to the grid's span on each axis.
pub(crate) struct GridPageMetrics {
    // Total stroked length of the page's cut lines (PDF points).
    pub length: f32,
    // Path nodes: two per line.
    pub node_count: usize,
    // Non-cutting travel between successive lines (PDF points).
    pub travel: f32,
}

// Metrics of the sheet whose first `cells` cells carry a card; `cells ==
// cards_per_page` is a full grid page, a smaller count the partial last sheet.
pub(crate) fn grid_page_metrics(layout: &CardLayout, cells: usize, offset_x: f32, offset_y: f32) -> GridPageMetrics {
    let g = grid_segments(layout, cells, offset_x, offset_y);
    // Both axes are walked in serpentine order, so the travel between successive
    // lines telescopes to the distance between the first and the last of them.
    let span = |v: &[(f32, f32, f32)]| match (v.first(), v.last()) {
        (Some(first), Some(last)) => last.0 - first.0,
        _ => 0.0,
    };
    let total_len = |v: &[(f32, f32, f32)]| v.iter().map(|&(_, from, to)| to - from).sum::<f32>();
    GridPageMetrics {
        length: total_len(&g.verticals) + total_len(&g.horizontals),
        node_count: 2 * (g.verticals.len() + g.horizontals.len()),
        travel: span(&g.verticals) + span(&g.horizontals),
    }
}

// Build a contour page that draws a single grid of spanning lines instead of
// tiling individual card rectangles. Used when the contour shape is a plain
// rectangle — replacing (cols * rows) overlapping rectangles with spanning
// hairlines that share no edges. With no gutter the card edges coincide into a
// (cols + 1) × (rows + 1) grid; with a gutter (Decalaj) each card keeps its own
// edges, so adjacent cards get two lines a gutter apart. Pass `cells` to cut a
// partially-filled last sheet: the same shared lines, each stopping at the last
// card that needs it.
pub(crate) fn build_grid_contour_page(
    doc: &mut Document,
    pages_id: ObjectId,
    catalog_id: ObjectId,
    layout: &CardLayout,
    stroke: TextColor,
    // Cells carrying a card, row-major. `layout.cards_per_page` is the full sheet;
    // a smaller count is the partially-filled last sheet, whose lines stop at the
    // last card instead of running the whole grid.
    cells: usize,
    // "Nu desena cercurile" clears this to skip the registration circles.
    draw_circles: bool,
    // Translate the whole grid by (offset_x, offset_y) PDF points. In practice
    // grid contour only runs when the contour fills the card (zero clamp slack),
    // so this is normally 0; kept for consistency with the tiled path.
    offset_x: f32,
    offset_y: f32,
) -> Result<ObjectId, Box<dyn std::error::Error>> {
    let GridSegments { verticals, horizontals } = grid_segments(layout, cells, offset_x, offset_y);

    let stroke_op = match stroke {
        TextColor::Rgb(r, g, b) => Operation::new("RG", vec![Object::Real(r), Object::Real(g), Object::Real(b)]),
        TextColor::Cmyk(c, m, y, k) => Operation::new("K", vec![Object::Real(c), Object::Real(m), Object::Real(y), Object::Real(k)]),
    };

    let mut operations = vec![
        Operation::new("w", vec![Object::Real(0.0)]), // hairline — same as build_shape_pdf
        stroke_op,
    ];

    // --- Vertical lines in serpentine order ---
    // Line 0: bottom → top (ly0 → ly1); each subsequent line alternates direction
    // (even index starts at the bottom, odd at the top).
    //
    // Each line is stroked on its own (m … l … S) so it stays a separate path:
    // a downstream cutter treats every line as a distinct cuttable path rather
    // than one continuous toolpath. Serpentine ordering is kept only to minimize
    // plotter travel between successive cuts.
    for (i, &(x, y_lo, y_hi)) in verticals.iter().enumerate() {
        let (from_y, to_y) = if i % 2 == 0 { (y_lo, y_hi) } else { (y_hi, y_lo) };
        operations.push(Operation::new("m", vec![Object::Real(x), Object::Real(from_y)]));
        operations.push(Operation::new("l", vec![Object::Real(x), Object::Real(to_y)]));
        operations.push(Operation::new("S", vec![]));
    }

    // --- Horizontal lines in serpentine order, picking up from where the last
    //     vertical line ended ---
    //
    // The last vertical line ends at the top when its index is even (bottom→top).
    // It's also the rightmost (the verticals are ascending), so the first horizontal
    // begins at its right end and goes left. Rows are visited starting from the end
    // nearest to where we just stopped (top-first when the last vertical ended at the
    // top).
    let last_vertical_at_top = verticals.len() % 2 == 1;
    for j in 0..horizontals.len() {
        // Walk rows from the end where the last vertical finished.
        let (y, x_lo, x_hi) = if last_vertical_at_top { horizontals[horizontals.len() - 1 - j] } else { horizontals[j] };
        // j=0: first horizontal, goes right → left (we came from the right edge).
        let (from_x, to_x) = if j % 2 == 0 { (x_hi, x_lo) } else { (x_lo, x_hi) };
        operations.push(Operation::new("m", vec![Object::Real(from_x), Object::Real(y)]));
        operations.push(Operation::new("l", vec![Object::Real(to_x), Object::Real(y)]));
        operations.push(Operation::new("S", vec![]));
    }

    // Each line was stroked individually above; now draw the registration circles
    // as a non-printable layer (positioning/print marks, not cut lines).
    let circle_ocg = wrap_registration_circles(doc, catalog_id, &mut operations, layout, draw_circles)?;

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
