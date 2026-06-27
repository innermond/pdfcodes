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
    target_width_mm: Option<f32>,
    target_height_mm: Option<f32>,
) -> Result<(ObjectId, ObjectId), Box<dyn std::error::Error>> {
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

    let raw_content = contour_doc.get_page_content(*contour_page_id)?;
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

    // Draw the contour background at every card position, plus the
    // registration circles, exactly as `--contour` would lay them out.
    let mut operations = Vec::new();
    for i in 0..layout.cards_per_page {
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
    let overlay_id = doc.add_object(overlay_form);

    // Optional Content Group marking the overlay as visible on screen
    // but excluded when printing.
    let mut ocg_dict = Dictionary::new();
    ocg_dict.set("Type", Object::Name(b"OCG".to_vec()));
    ocg_dict.set("Name", Object::String(b"Contour overlay (non-printable)".to_vec(), lopdf::StringFormat::Literal));
    ocg_dict.set("Usage", Object::Dictionary({
        let mut usage = Dictionary::new();
        usage.set("Print", Object::Dictionary({
            let mut print = Dictionary::new();
            print.set("PrintState", Object::Name(b"OFF".to_vec()));
            print
        }));
        usage.set("View", Object::Dictionary({
            let mut view = Dictionary::new();
            view.set("ViewState", Object::Name(b"ON".to_vec()));
            view
        }));
        usage
    }));
    let ocg_id = doc.add_object(Object::Dictionary(ocg_dict));

    let mut catalog_dict = doc.get_object(catalog_id)?.as_dict()?.clone();
    catalog_dict.set("OCProperties", Object::Dictionary({
        let mut ocp = Dictionary::new();
        ocp.set("OCGs", Object::Array(vec![Object::Reference(ocg_id)]));
        ocp.set("D", Object::Dictionary({
            let mut d = Dictionary::new();
            d.set("Name", Object::String(b"Default".to_vec(), lopdf::StringFormat::Literal));
            d.set("BaseState", Object::Name(b"ON".to_vec()));
            d.set("ON", Object::Array(vec![Object::Reference(ocg_id)]));
            d.set("OFF", Object::Array(vec![]));
            d.set("AS", Object::Array(vec![Object::Dictionary({
                let mut as_dict = Dictionary::new();
                as_dict.set("Event", Object::Name(b"Print".to_vec()));
                as_dict.set("OCGs", Object::Array(vec![Object::Reference(ocg_id)]));
                as_dict.set("Category", Object::Array(vec![Object::Name(b"Print".to_vec())]));
                as_dict
            })]));
            d.set("Order", Object::Array(vec![Object::Reference(ocg_id)]));
            d
        }));
        ocp
    }));
    doc.objects.insert(catalog_id, Object::Dictionary(catalog_dict));

    Ok((overlay_id, ocg_id))
}
