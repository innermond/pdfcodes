use lopdf::{Document, Object, Dictionary, Stream, ObjectId, content::{Operation, Content}};

use crate::geometry::CardLayout;
use crate::pdf_import::import_object;

// Build a non-printable overlay layer showing the contour grid (background
// tiles + registration circles) at the same positions as the print grid, so
// print/contour alignment can be checked visually. Returns the overlay Form
// XObject's ID and the Optional Content Group ID used to mark it
// view-only/non-printing; also installs the OCProperties on the catalog.
pub(crate) fn build_overlay(
    doc: &mut Document,
    contour_background_bytes: &[u8],
    catalog_id: ObjectId,
    layout: &CardLayout,
    page_number: u32,
    // Translate the overlaid contour by (offset_x, offset_y) PDF points per card
    // cell, matching the standalone contour so the combine preview/output align.
    offset_x: f32,
    offset_y: f32,
    // Resize/rotate the overlaid contour so it matches the standalone cut (which
    // gets the same transform through the background pipeline). `rotation` is
    // clockwise degrees (multiple of 90), combined with the page's own /Rotate;
    // `target_width_mm`/`target_height_mm` scale the displayed contour to that
    // card size (`None`/0 keeps its own size).
    rotation: i64,
    // Free-angle spin (clockwise degrees) about the displayed contour's center, applied
    // after the 90° reorient + scale, matching the standalone cut (which spins via the
    // background pipeline's `background_spin_deg`). 0 = no spin.
    spin_deg: f32,
    target_width_mm: Option<f32>,
    target_height_mm: Option<f32>,
    // Trim the overlaid contour to the bounding box of its drawn path instead of its
    // page MediaBox, matching the standalone cut (see `content_path_bbox`). Keeps the
    // combine overlay aligned with the trimmed cut.
    trim_to_path: bool,
    // Number of cells the print job's last (partial) sheet fills. When `Some(n)` with
    // `0 < n < cards_per_page`, a second overlay Form tiling only those `n` cells is built
    // and returned, so the caller can draw it on the last print page instead of the full
    // grid — matching the standalone contour's extra partial page. `None`/full ⇒ no second
    // overlay.
    partial_cells: Option<usize>,
) -> Result<(ObjectId, Option<ObjectId>, ObjectId), Box<dyn std::error::Error>> {
    let contour_doc = Document::load_mem(contour_background_bytes)?;
    let contour_pages = contour_doc.get_pages();
    // `get_pages()` is keyed by 1-based page number; pick the requested page
    // (for multi-page contour uploads), falling back to the first.
    let contour_page_id = contour_pages
        .get(&page_number)
        .copied()
        .or_else(|| contour_pages.values().next().copied())
        .ok_or("No pages in contour background PDF")?;
    let contour_page_id = &contour_page_id;
    let contour_page_obj = contour_doc.get_object(*contour_page_id)?;
    let contour_page_dict = contour_page_obj.as_dict()?;
    let contour_media_box = contour_page_dict.get(b"MediaBox")?.as_array()?.clone();

    let raw_w = match &contour_media_box[2] {
        Object::Integer(w) => *w as f32,
        Object::Real(w) => *w,
        _ => layout.card_w,
    };
    let raw_h = match &contour_media_box[3] {
        Object::Integer(h) => *h as f32,
        Object::Real(h) => *h,
        _ => layout.card_h,
    };

    // With "trim to path" on, shrink the size to the artwork's bounding box and shift
    // the content so that box sits at the origin — the same trim mod.rs applies to the
    // standalone cut, applied here (before rotation/scale) so the combine overlay
    // stays aligned with it. Falls back to the page size when nothing paints.
    let raw_content = contour_doc.get_page_content(*contour_page_id)?;
    let (raw_w, raw_h, raw_content) = if trim_to_path {
        match crate::measure::content_path_bbox(&raw_content) {
            Some((x0, y0, x1, y1)) if (x1 - x0) > 0.0 && (y1 - y0) > 0.0 => {
                let shifted = [
                    format!("q 1 0 0 1 {:.4} {:.4} cm\n", -x0, -y0).into_bytes(),
                    raw_content,
                    b"\nQ\n".to_vec(),
                ].concat();
                ((x1 - x0) as f32, (y1 - y0) as f32, shifted)
            }
            _ => (raw_w, raw_h, raw_content),
        }
    } else {
        (raw_w, raw_h, raw_content)
    };

    // Bake the page's /Rotate plus the user rotation into the form content, then
    // report the *displayed* size (swapped for 90/270) — exactly as the
    // background pipeline does in mod.rs, so overlay and standalone cut agree.
    let page_rotate = match contour_page_dict.get(b"Rotate") {
        Ok(Object::Integer(r)) => *r,
        _ => 0,
    };
    let rotate = (((page_rotate + rotation) % 360) + 360) % 360;
    let (rot_w, rot_h, rotate_prefix): (f32, f32, Vec<u8>) = match rotate {
        90 => (raw_h, raw_w, format!("0 -1 1 0 0 {raw_w:.4} cm\n").into_bytes()),
        180 => (raw_w, raw_h, format!("-1 0 0 -1 {raw_w:.4} {raw_h:.4} cm\n").into_bytes()),
        270 => (raw_h, raw_w, format!("0 1 -1 0 {raw_h:.4} 0 cm\n").into_bytes()),
        _ => (raw_w, raw_h, Vec::new()),
    };

    let rotated_content = if rotate_prefix.is_empty() {
        raw_content
    } else {
        [b"q\n".to_vec(), rotate_prefix, raw_content, b"\nQ\n".to_vec()].concat()
    };

    // Scale the displayed contour to the target card size (if given), matching
    // the `card_width_mm`/`card_height_mm` scale the standalone job applies.
    let (card_w_c, card_h_c, contour_content_bytes) = match (target_width_mm, target_height_mm) {
        (Some(tw_mm), Some(th_mm)) if tw_mm > 0.0 && th_mm > 0.0 => {
            let target_w = tw_mm * crate::geometry::MM;
            let target_h = th_mm * crate::geometry::MM;
            if (target_w - rot_w).abs() > 0.1 || (target_h - rot_h).abs() > 0.1 {
                let sx = target_w / rot_w;
                let sy = target_h / rot_h;
                let prefix = format!("q {sx:.6} 0 0 {sy:.6} 0 0 cm\n").into_bytes();
                let content = [prefix, rotated_content, b"\nQ".to_vec()].concat();
                (target_w, target_h, content)
            } else {
                (rot_w, rot_h, rotated_content)
            }
        }
        _ => (rot_w, rot_h, rotated_content),
    };

    // Free-angle spin about the displayed contour's center (within its box; the BBox
    // clips anything pushed past the edge, same as the standalone cut through mod.rs).
    let contour_content_bytes = if spin_deg != 0.0 {
        match crate::geometry::word_transform(spin_deg, false, false, card_w_c / 2.0, card_h_c / 2.0) {
            Some(m) => [
                format!("q {:.6} {:.6} {:.6} {:.6} {:.4} {:.4} cm\n", m[0], m[1], m[2], m[3], m[4], m[5]).into_bytes(),
                contour_content_bytes,
                b"\nQ".to_vec(),
            ].concat(),
            None => contour_content_bytes,
        }
    } else {
        contour_content_bytes
    };
    let card_box_c = vec![Object::Real(0.0), Object::Real(0.0), Object::Real(card_w_c), Object::Real(card_h_c)];

    let mut id_map = std::collections::HashMap::new();
    let mut bg_xobj_dict_c = Dictionary::new();
    bg_xobj_dict_c.set("Type", Object::Name(b"XObject".to_vec()));
    bg_xobj_dict_c.set("Subtype", Object::Name(b"Form".to_vec()));
    bg_xobj_dict_c.set("BBox", Object::Array(card_box_c));
    if let Ok(resources) = contour_page_dict.get(b"Resources") {
        let imported = import_object(&contour_doc, doc, resources, &mut id_map);
        bg_xobj_dict_c.set("Resources", imported);
    }
    let bg_form_c = Stream::new(bg_xobj_dict_c, contour_content_bytes);
    let bg_form_c_id = doc.add_object(bg_form_c);

    // The full overlay draws the contour at every card position; when the last print
    // sheet is partial, a second overlay draws it only at the filled cells.
    let overlay_id = tile_overlay_form(doc, bg_form_c_id, layout, layout.cards_per_page, offset_x, offset_y)?;
    let partial_overlay_id = match partial_cells {
        Some(n) if n > 0 && n < layout.cards_per_page => {
            Some(tile_overlay_form(doc, bg_form_c_id, layout, n, offset_x, offset_y)?)
        }
        _ => None,
    };

    // Optional Content Group marking the overlay as visible on screen
    // but excluded when printing.
    let ocg_id = super::ocg::add_nonprintable_ocg(doc, catalog_id, b"Contour overlay (non-printable)")?;

    Ok((overlay_id, partial_overlay_id, ocg_id))
}

// Build one overlay Form XObject that draws the `BGC` contour at the first `cells` card
// positions (row-major, via `layout.position`), plus the registration circles — exactly
// as `--contour` would lay them out. `cells == cards_per_page` gives the full grid;
// a smaller count gives the partial last-sheet overlay.
fn tile_overlay_form(
    doc: &mut Document,
    bg_form_c_id: ObjectId,
    layout: &CardLayout,
    cells: usize,
    offset_x: f32,
    offset_y: f32,
) -> Result<ObjectId, Box<dyn std::error::Error>> {
    let mut operations = Vec::new();
    for i in 0..cells {
        let (x, y) = layout.position(i);

        operations.push(Operation::new("q", vec![]));
        operations.push(Operation::new("cm", vec![
            Object::Real(1.0), Object::Real(0.0),
            Object::Real(0.0), Object::Real(1.0),
            Object::Real(x + offset_x), Object::Real(y + offset_y),
        ]));
        operations.push(Operation::new("Do", vec![Object::Name(b"BGC".to_vec())]));
        operations.push(Operation::new("Q", vec![]));
    }
    operations.extend(layout.registration_circles());

    let overlay_content = Content { operations };
    let mut overlay_dict = Dictionary::new();
    overlay_dict.set("Type", Object::Name(b"XObject".to_vec()));
    overlay_dict.set("Subtype", Object::Name(b"Form".to_vec()));
    overlay_dict.set("BBox", Object::Array(layout.host_box.clone()));
    overlay_dict.set("Resources", Object::Dictionary({
        let mut res = Dictionary::new();
        res.set("XObject", Object::Dictionary({
            let mut xobjs = Dictionary::new();
            xobjs.set("BGC", Object::Reference(bg_form_c_id));
            xobjs
        }));
        res
    }));
    let overlay_form = Stream::new(overlay_dict, overlay_content.encode()?);
    Ok(doc.add_object(overlay_form))
}
