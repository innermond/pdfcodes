mod cards;
mod contour;
mod overlay;
pub mod shapes;

use lopdf::{Document, Object, Stream, Dictionary, content::{Operation, Content}};

use crate::color::TextColor;
use crate::fonts::{embed_fonts, MONTSERRAT_BOLD_TTF};
use crate::geometry::CardLayout;
use crate::measure::{measure_stroked_paths, PathMetrics};
use crate::options::Options;

// Extract the first CMYK or RGB stroke-color operator from a decoded content
// stream. Used to read the stroke color embedded by `build_shape_pdf` so the
// grid-lines contour mode can reuse it without an extra round-trip parameter.
fn extract_stroke_color(content_bytes: &[u8]) -> Option<TextColor> {
    let content = Content::decode(content_bytes).ok()?;
    for op in &content.operations {
        let f = |o: &Object| match o { Object::Real(v) => *v, Object::Integer(v) => *v as f32, _ => 0.0 };
        match op.operator.as_str() {
            "K" if op.operands.len() == 4 =>
                return Some(TextColor::Cmyk(f(&op.operands[0]), f(&op.operands[1]), f(&op.operands[2]), f(&op.operands[3]))),
            "RG" if op.operands.len() == 3 =>
                return Some(TextColor::Rgb(f(&op.operands[0]), f(&op.operands[1]), f(&op.operands[2]))),
            _ => {}
        }
    }
    None
}

// Result of generating a PDF: the document bytes plus, when requested, the
// stroked-path measurements of the contour background (excluding the 3
// registration circles, which are added separately).
#[derive(Debug)]
pub struct GenerateOutput {
    pub pdf: Vec<u8>,
    pub cards_per_page: usize,
    pub path_length_per_card_mm: Option<f32>,
    pub path_length_total_mm: Option<f32>,
    pub node_count_per_card: Option<usize>,
    pub node_count_total: Option<usize>,
    pub sharp_turn_count_per_card: Option<usize>,
    pub sharp_turn_count_total: Option<usize>,
    pub time_cutting_per_card_s: Option<f32>,
    pub time_cutting_total_s: Option<f32>,
    // Number of text labels that exceeded the card width / safe area, and up to
    // a few distinct offending codes — for warning that some codes won't fit.
    pub text_overflow_count: usize,
    pub text_overflow_samples: Vec<String>,
}

// Path-length/node/sharp-turn/cutting-time measurements derived from a
// single card's stroked paths, scaled to `total_cards` and combined with
// `num_pages` worth of machine preparation time.
struct CuttingMetrics {
    path_length_per_card_mm: f32,
    path_length_total_mm: f32,
    node_count_per_card: usize,
    node_count_total: usize,
    sharp_turn_count_per_card: usize,
    sharp_turn_count_total: usize,
    time_cutting_per_card_s: f32,
    time_cutting_total_s: f32,
}

// Number of card records in the CSV data, used to scale contour cutting-time
// estimates to the number of sheets that will actually be cut.
fn count_csv_records(csv_data: &str) -> usize {
    csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(csv_data.as_bytes())
        .records()
        .count()
}

// Combine per-card path metrics with the cutting-time options to estimate
// how long a cutting machine would take to process `total_cards` cards
// spread across `num_pages` pages (each page requiring
// `opts.preparation_time_s` to feed and register, and `cards_on_page - 1`
// non-cutting travel moves of `pitch_mm` between adjacent cards at
// `opts.travel_speed_mm_s`).
fn compute_cutting_metrics(pm: &PathMetrics, opts: &Options, total_cards: usize, num_pages: f32, pitch_mm: f32) -> CuttingMetrics {
    let per_card_mm = pm.length / crate::geometry::MM;
    let total_mm = per_card_mm * total_cards as f32;
    let per_card_cut_time = per_card_mm / opts.cutting_speed_mm_s + pm.sharp_turn_count as f32 * opts.corner_penalty_s;

    // One fewer travel move than there are cards on each page.
    let travel_segments = (total_cards as f32 - num_pages).max(0.0);
    let travel_time_total = travel_segments * pitch_mm / opts.travel_speed_mm_s;

    let total_time = total_cards as f32 * per_card_cut_time + num_pages * opts.preparation_time_s + travel_time_total;
    let per_card_time = if total_cards > 0 { total_time / total_cards as f32 } else { 0.0 };

    CuttingMetrics {
        path_length_per_card_mm: per_card_mm,
        path_length_total_mm: total_mm,
        node_count_per_card: pm.node_count,
        node_count_total: pm.node_count * total_cards,
        sharp_turn_count_per_card: pm.sharp_turn_count,
        sharp_turn_count_total: pm.sharp_turn_count * total_cards,
        time_cutting_per_card_s: per_card_time,
        time_cutting_total_s: total_time,
    }
}

// Generate a print or contour PDF in memory.
//
// `csv_data` is the raw CSV text (one label per row); required unless
// `opts.contour` is set, in which case it is ignored. `background_bytes` is
// the source PDF whose first page is tiled across the host sheet.
// `contour_background_bytes` is required when `opts.combine` is set: its
// first page is drawn as a non-printable overlay layer on every print page,
// at the same grid positions, so print/contour alignment can be checked.
pub fn generate_pdf(csv_data: Option<&str>, background_bytes: &[u8], contour_background_bytes: Option<&[u8]>, opts: &Options) -> Result<GenerateOutput, Box<dyn std::error::Error>> {
    // Load background PDF
    let mut doc = Document::load_mem(background_bytes)?;

    // Get background page. `get_pages()` is keyed by 1-based page number, so a
    // multi-page upload can pick which page becomes the card; fall back to the
    // first page if the requested number is out of range.
    let pages = doc.get_pages();
    let bg_page_id = pages
        .get(&opts.background_page_number)
        .copied()
        .or_else(|| pages.values().next().copied())
        .ok_or("No pages in background PDF")?;
    let bg_page_id = &bg_page_id;
    let bg_page_obj = doc.get_object(*bg_page_id)?;
    let bg_page_dict = bg_page_obj.as_dict()?;
    let media_box_obj = bg_page_dict.get(b"MediaBox")?;
    let media_box_orig = media_box_obj.as_array()?.clone();

    let orig_w = match &media_box_orig[2] {
        Object::Integer(w) => *w as f32,
        Object::Real(w) => *w,
        _ => 595.0,
    };
    let orig_h = match &media_box_orig[3] {
        Object::Integer(h) => *h as f32,
        Object::Real(h) => *h,
        _ => 842.0,
    };

    // Get background content bytes for XObject
    let bg_content_bytes_raw = doc.get_page_content(*bg_page_id)?;

    // Apply user-specified card dimensions via a PDF `cm` scale transform.
    // This rescales the background content without rasterization; the BBox
    // and grid layout then use the target size so codes land correctly.
    let (card_w, card_h, bg_content_bytes) = match (opts.card_width_mm, opts.card_height_mm) {
        (Some(tw_mm), Some(th_mm)) if tw_mm > 0.0 && th_mm > 0.0 => {
            let target_w = tw_mm * crate::geometry::MM;
            let target_h = th_mm * crate::geometry::MM;
            if (target_w - orig_w).abs() > 0.1 || (target_h - orig_h).abs() > 0.1 {
                let sx = target_w / orig_w;
                let sy = target_h / orig_h;
                let prefix = format!("q {sx:.6} 0 0 {sy:.6} 0 0 cm\n").into_bytes();
                let content = [prefix, bg_content_bytes_raw, b"\nQ".to_vec()].concat();
                (target_w, target_h, content)
            } else {
                (orig_w, orig_h, bg_content_bytes_raw)
            }
        }
        _ => (orig_w, orig_h, bg_content_bytes_raw),
    };

    // Compute grid layout on the host page.
    let layout = CardLayout::compute(card_w, card_h, opts);

    // Create Form XObject for background
    let mut bg_xobj_dict = Dictionary::new();
    bg_xobj_dict.set("Type", Object::Name(b"XObject".to_vec()));
    bg_xobj_dict.set("Subtype", Object::Name(b"Form".to_vec()));
    bg_xobj_dict.set("BBox", Object::Array(layout.card_box.clone()));
    if let Ok(resources) = bg_page_dict.get(b"Resources") {
        bg_xobj_dict.set("Resources", resources.clone());
    }
    let bg_form = Stream::new(bg_xobj_dict, bg_content_bytes.clone());
    let bg_form_id = doc.add_object(bg_form);

    // Get pages root
    let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    let catalog = doc.get_object(catalog_id)?;
    let pages_id = catalog.as_dict()?.get(b"Pages").unwrap().as_reference()?;

    // Remove all of the source PDF's original pages from the page tree. The
    // chosen page's content is now reused as the BG XObject on every generated
    // card; the *other* pages of a multi-page background upload (e.g. a print
    // PDF that carries its cut outline on a separate page) must not leak into
    // the output as stray pages — so drop them all, not just the selected one.
    let original_page_ids: std::collections::HashSet<lopdf::ObjectId> =
        pages.values().copied().collect();
    {
        let pages_obj = doc.get_object(pages_id)?;
        let pages_dict_orig = pages_obj.as_dict()?;
        let mut kids = pages_dict_orig.get(b"Kids").unwrap().as_array()?.clone();
        kids.retain(|kid| kid.as_reference().map(|r| !original_page_ids.contains(&r)).unwrap_or(true));
        let count = kids.len() as i64;
        let mut pages_dict = pages_dict_orig.clone();
        pages_dict.set("Kids", Object::Array(kids));
        pages_dict.set("Count", Object::Integer(count));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));
    }
    for id in &original_page_ids {
        doc.objects.remove(id);
    }

    // If requested, lay out a single host page using the grid (same
    // dimensions, offsets and registration circles), with every cell showing
    // just the background and no label text.
    if opts.contour {
        let cutting_metrics = if opts.measure_paths && !opts.contour_as_grid {
            let path_metrics = measure_stroked_paths(&bg_content_bytes)?;
            // The contour PDF is a single sheet, but the cutting machine
            // will run it once per sheet needed to cover every CSV record.
            let total_cards = match csv_data {
                Some(data) => count_csv_records(data),
                None => layout.cards_per_page,
            };
            let num_pages = (total_cards as f32 / layout.cards_per_page as f32).ceil().max(1.0);
            Some(compute_cutting_metrics(&path_metrics, opts, total_cards, num_pages, layout.pitch_mm()))
        } else {
            None
        };

        let page_id = if opts.contour_as_grid {
            let stroke = extract_stroke_color(&bg_content_bytes)
                .unwrap_or(TextColor::Cmyk(0.0, 0.0, 0.0, 1.0));
            contour::build_grid_contour_page(&mut doc, pages_id, &layout, stroke)?
        } else {
            contour::build_contour_page(&mut doc, pages_id, bg_form_id, &layout)?
        };

        let pages_obj = doc.get_object(pages_id)?;
        let pages_dict_orig = pages_obj.as_dict()?;
        let mut kids = pages_dict_orig.get(b"Kids").unwrap().as_array()?.clone();
        kids.push(Object::Reference(page_id));
        let mut pages_dict = pages_dict_orig.clone();
        pages_dict.set("Kids", Object::Array(kids));
        pages_dict.set("Count", Object::Integer(1));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

        let mut pdf = Vec::new();
        doc.save_to(&mut pdf)?;
        return Ok(GenerateOutput {
            pdf,
            cards_per_page: layout.cards_per_page,
            path_length_per_card_mm: cutting_metrics.as_ref().map(|m| m.path_length_per_card_mm),
            path_length_total_mm: cutting_metrics.as_ref().map(|m| m.path_length_total_mm),
            node_count_per_card: cutting_metrics.as_ref().map(|m| m.node_count_per_card),
            node_count_total: cutting_metrics.as_ref().map(|m| m.node_count_total),
            sharp_turn_count_per_card: cutting_metrics.as_ref().map(|m| m.sharp_turn_count_per_card),
            sharp_turn_count_total: cutting_metrics.as_ref().map(|m| m.sharp_turn_count_total),
            time_cutting_per_card_s: cutting_metrics.as_ref().map(|m| m.time_cutting_per_card_s),
            time_cutting_total_s: cutting_metrics.as_ref().map(|m| m.time_cutting_total_s),
            // Contour PDFs contain no text, so nothing can overflow.
            text_overflow_count: 0,
            text_overflow_samples: Vec::new(),
        });
    }

    // Contour PDFs contain no text — skip font embedding entirely so they
    // stay small and import cleanly into cutting-software (Inkscape, etc.).
    // Fonts are only needed for the print path below.
    let font_bytes_list: Vec<&[u8]> = if opts.font_data.is_empty() {
        vec![MONTSERRAT_BOLD_TTF]
    } else {
        opts.font_data.iter().map(|v| v.as_slice()).collect()
    };
    let embedded_fonts = embed_fonts(&mut doc, &font_bytes_list)?;

    // Load CSV
    let csv_data = csv_data.ok_or("csv data is required unless contour is set")?;
    let (card_ids, text_overflow) = cards::build_card_xobjects(&mut doc, csv_data, opts, &embedded_fonts, &layout, bg_form_id)?;

    // If requested, build a non-printable overlay layer showing the contour
    // grid (background tiles + registration circles) at the same positions
    // as the print grid, so print/contour alignment can be checked visually.
    let overlay = if opts.combine {
        let contour_bytes = contour_background_bytes.ok_or("--combineb requires a contour background PDF")?;
        Some(overlay::build_overlay(&mut doc, contour_bytes, catalog_id, &layout, opts.contour_page_number)?)
    } else {
        None
    };

    // Lay out card XObjects on host pages.
    for chunk in card_ids.chunks(layout.cards_per_page) {
        let mut operations = Vec::new();
        let mut xobjects = Dictionary::new();

        for (i, card_id) in chunk.iter().enumerate() {
            let (x, y) = layout.position(i);

            let name = format!("C{}", i);
            operations.push(Operation::new("q", vec![]));
            operations.push(Operation::new("cm", vec![
                Object::Real(1.0), Object::Real(0.0),
                Object::Real(0.0), Object::Real(1.0),
                Object::Real(x), Object::Real(y),
            ]));
            operations.push(Operation::new("Do", vec![Object::Name(name.clone().into_bytes())]));
            operations.push(Operation::new("Q", vec![]));

            xobjects.set(name, Object::Reference(*card_id));
        }

        operations.extend(layout.registration_circles());

        let mut properties = Dictionary::new();
        if let Some((overlay_id, ocg_id)) = overlay {
            xobjects.set("OV", Object::Reference(overlay_id));
            properties.set("MC0", Object::Reference(ocg_id));

            operations.push(Operation::new("q", vec![]));
            operations.push(Operation::new("BDC", vec![Object::Name(b"OC".to_vec()), Object::Name(b"MC0".to_vec())]));
            operations.push(Operation::new("Do", vec![Object::Name(b"OV".to_vec())]));
            operations.push(Operation::new("EMC", vec![]));
            operations.push(Operation::new("Q", vec![]));
        }

        let content = Content { operations };
        let content_data = content.encode()?;
        let content_stream = Stream::new(Dictionary::new(), content_data);
        let content_id = doc.add_object(content_stream);

        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(pages_id));
        page_dict.set("MediaBox", Object::Array(layout.host_box.clone()));
        page_dict.set("Contents", Object::Reference(content_id));
        page_dict.set("Resources", Object::Dictionary({
            let mut res = Dictionary::new();
            res.set("XObject", Object::Dictionary(xobjects));
            if !properties.is_empty() {
                res.set("Properties", Object::Dictionary(properties));
            }
            res
        }));

        let page_id = doc.add_object(Object::Dictionary(page_dict));

        // Add to pages tree
        let pages_obj = doc.get_object(pages_id)?;
        let pages_dict_orig = pages_obj.as_dict()?;
        let mut kids = pages_dict_orig.get(b"Kids").unwrap().as_array()?.clone();
        kids.push(Object::Reference(page_id));
        let count = pages_dict_orig.get(b"Count").unwrap().as_i64().unwrap_or(0) + 1;
        let mut pages_dict = pages_dict_orig.clone();
        pages_dict.set("Kids", Object::Array(kids));
        pages_dict.set("Count", Object::Integer(count));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));
    }

    // Save
    let mut pdf = Vec::new();
    doc.save_to(&mut pdf)?;

    // Cutting-time and path metrics describe the contour/cut-lines PDF, not
    // the print sheet, so the print branch never reports them.
    Ok(GenerateOutput {
        pdf,
        cards_per_page: layout.cards_per_page,
        path_length_per_card_mm: None,
        path_length_total_mm: None,
        node_count_per_card: None,
        node_count_total: None,
        sharp_turn_count_per_card: None,
        sharp_turn_count_total: None,
        time_cutting_per_card_s: None,
        time_cutting_total_s: None,
        text_overflow_count: text_overflow.count,
        text_overflow_samples: text_overflow.samples,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::align::TextAlign;
    use crate::blend::BlendMode;
    use crate::color::{parse_color, parse_color_or_none};

    static BACKGROUND_PDF: &[u8] = include_bytes!("../../15x15.pdf");

    // Build a minimal multi-page PDF where each page has the given MediaBox size
    // (in points) and an empty content stream. Used to verify page selection.
    fn multi_page_pdf(sizes: &[(f32, f32)]) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let mut kids = Vec::new();
        for &(w, h) in sizes {
            let content_id = doc.add_object(Stream::new(Dictionary::new(), Content { operations: vec![] }.encode().unwrap()));
            let mut page_dict = Dictionary::new();
            page_dict.set("Type", Object::Name(b"Page".to_vec()));
            page_dict.set("Parent", Object::Reference(pages_id));
            page_dict.set("Contents", Object::Reference(content_id));
            page_dict.set("MediaBox", Object::Array(vec![Object::Real(0.0), Object::Real(0.0), Object::Real(w), Object::Real(h)]));
            kids.push(Object::Reference(doc.add_object(Object::Dictionary(page_dict))));
        }
        let mut pages_dict = Dictionary::new();
        pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
        pages_dict.set("Count", Object::Integer(sizes.len() as i64));
        pages_dict.set("Kids", Object::Array(kids));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));
        let mut catalog_dict = Dictionary::new();
        catalog_dict.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog_dict.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(Object::Dictionary(catalog_dict));
        doc.trailer.set("Root", Object::Reference(catalog_id));
        let mut buf = Vec::new();
        doc.save_to(&mut buf).unwrap();
        buf
    }

    #[test]
    fn generate_print_pdf_uses_selected_background_page() {
        // A small page 1 fits many cards per host sheet; a large page 2 fits
        // fewer. Selecting page 2 must change the layout, proving the page
        // number reaches the generator rather than always using page 1.
        let bg = multi_page_pdf(&[(72.0, 72.0), (288.0, 360.0)]);

        let page1 = generate_pdf(Some("1A 1\n"), &bg, None, &Options { background_page_number: 1, ..Options::default() })
            .expect("page 1 generation should succeed");
        let page2 = generate_pdf(Some("1A 1\n"), &bg, None, &Options { background_page_number: 2, ..Options::default() })
            .expect("page 2 generation should succeed");

        assert!(page1.cards_per_page > page2.cards_per_page, "larger page 2 should fit fewer cards");
    }

    #[test]
    fn generate_print_pdf_falls_back_to_first_page_when_out_of_range() {
        let bg = multi_page_pdf(&[(72.0, 72.0), (288.0, 360.0)]);
        let out_of_range = generate_pdf(Some("1A 1\n"), &bg, None, &Options { background_page_number: 99, ..Options::default() })
            .expect("out-of-range page should fall back to page 1");
        let first = generate_pdf(Some("1A 1\n"), &bg, None, &Options { background_page_number: 1, ..Options::default() })
            .expect("page 1 generation should succeed");
        assert_eq!(out_of_range.cards_per_page, first.cards_per_page);
    }

    #[test]
    fn generate_no_cut_drops_unselected_background_pages() {
        // A multi-page background upload (e.g. print on one page, cut outline on
        // another). Selecting one page must not leave the others in the output:
        // a single code in no-cut mode yields exactly one card page, never the
        // stray source pages on top of it.
        let bg = multi_page_pdf(&[(288.0, 360.0), (288.0, 360.0)]);
        let out = generate_pdf(
            Some("1A 1\n"),
            &bg,
            None,
            &Options { background_page_number: 2, no_cut: true, ..Options::default() },
        )
        .expect("no-cut generation should succeed");
        let doc = Document::load_mem(&out.pdf).expect("output should be a valid PDF");
        assert_eq!(doc.get_pages().len(), 1, "only the generated card page should remain");
    }

    #[test]
    fn generate_contour_pdf() {
        let opts = Options { contour: true, ..Options::default() };
        let out = generate_pdf(None, BACKGROUND_PDF, None, &opts).expect("contour generation should succeed");

        assert!(out.pdf.starts_with(b"%PDF"));
        assert!(out.cards_per_page >= 1);
    }

    #[test]
    fn generate_print_pdf() {
        let opts = Options::default();
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts).expect("print generation should succeed");

        assert!(out.pdf.starts_with(b"%PDF"));
        assert!(out.cards_per_page >= 1);
    }

    #[test]
    fn generate_print_pdf_accepts_ragged_rows() {
        // Rows with different field counts (one merged into a single field, the
        // next holding two) must not be rejected: the CSV reader is flexible and
        // each row is laid out on its own. Regression for the "found record with
        // 2 fields, but the previous record has 1 fields" generation error.
        let opts = Options::default();
        let out = generate_pdf(Some("1A 1\n2B\n3C 3\n"), BACKGROUND_PDF, None, &opts)
            .expect("ragged rows should generate without a CSV-length error");
        assert!(out.pdf.starts_with(b"%PDF"));
    }

    #[test]
    fn compute_cutting_metrics_applies_speed_corner_penalty_prep_and_travel_time() {
        let pm = PathMetrics { length: 100.0 * crate::geometry::MM, node_count: 4, sharp_turn_count: 4 };
        let opts = Options { cutting_speed_mm_s: 8.0, corner_penalty_s: 0.2, preparation_time_s: 60.0, travel_speed_mm_s: 16.0, ..Options::default() };

        let metrics = compute_cutting_metrics(&pm, &opts, 3, 2.0, 50.0);

        assert!((metrics.path_length_per_card_mm - 100.0).abs() < 1e-3);
        assert!((metrics.path_length_total_mm - 300.0).abs() < 1e-3);
        assert_eq!(metrics.node_count_per_card, 4);
        assert_eq!(metrics.node_count_total, 12);
        assert_eq!(metrics.sharp_turn_count_per_card, 4);
        assert_eq!(metrics.sharp_turn_count_total, 12);

        // per-card cutting: 100mm / 8mm/s + 4 turns * 0.2s = 12.5 + 0.8 = 13.3s
        // travel: (3 cards - 2 pages) = 1 travel move of 50mm / 16mm/s = 3.125s
        // total: 3 * 13.3 + 2 * 60 + 3.125 = 39.9 + 120 + 3.125 = 163.025s
        let expected_total = 163.025;
        assert!((metrics.time_cutting_total_s - expected_total).abs() < 1e-3);

        // per-card is the total averaged across all cards.
        let expected_per_card = expected_total / 3.0;
        assert!((metrics.time_cutting_per_card_s - expected_per_card).abs() < 1e-3);
    }

    #[test]
    fn generate_contour_pdf_with_measure_paths_includes_cutting_time() {
        let opts = Options { contour: true, measure_paths: true, ..Options::default() };
        let out = generate_pdf(None, BACKGROUND_PDF, None, &opts).expect("contour generation should succeed");

        let per_card = out.time_cutting_per_card_s.expect("per-card cutting time should be set");
        let total = out.time_cutting_total_s.expect("total cutting time should be set");
        assert!(per_card >= 0.0);
        // Without CSV data, total cards falls back to a single sheet.
        assert!((total - per_card * out.cards_per_page as f32).abs() < 1e-2);
        assert!(total > opts.preparation_time_s);
    }

    #[test]
    fn generate_contour_pdf_scales_cutting_time_by_csv_record_count() {
        let opts = Options { contour: true, measure_paths: true, ..Options::default() };
        let out = generate_pdf(None, BACKGROUND_PDF, None, &opts).expect("contour generation should succeed");
        let single_sheet_total = out.time_cutting_total_s.expect("total cutting time should be set");

        // Two sheets' worth of records (one row per card) should roughly
        // double the total cutting time, since two sheets need cutting.
        let csv_data = "1A 1\n".repeat(out.cards_per_page * 2);
        let out_two_sheets = generate_pdf(Some(&csv_data), BACKGROUND_PDF, None, &opts)
            .expect("contour generation should succeed");
        let two_sheets_total = out_two_sheets.time_cutting_total_s.expect("total cutting time should be set");

        assert!((two_sheets_total - single_sheet_total * 2.0).abs() < 1e-2);
    }

    #[test]
    fn generate_print_pdf_omits_cutting_time_even_with_measure_paths() {
        let opts = Options { measure_paths: true, ..Options::default() };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts).expect("print generation should succeed");

        // Cutting-time and path metrics describe the contour PDF, not the
        // print sheet, so the print branch never reports them.
        assert!(out.path_length_per_card_mm.is_none());
        assert!(out.path_length_total_mm.is_none());
        assert!(out.node_count_per_card.is_none());
        assert!(out.node_count_total.is_none());
        assert!(out.sharp_turn_count_per_card.is_none());
        assert!(out.sharp_turn_count_total.is_none());
        assert!(out.time_cutting_per_card_s.is_none());
        assert!(out.time_cutting_total_s.is_none());
    }

    #[test]
    fn generate_print_pdf_with_card_size_override() {
        let opts = Options {
            card_width_mm: Some(100.0),
            card_height_mm: Some(60.0),
            ..Options::default()
        };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts)
            .expect("resized generation should succeed");
        assert!(out.pdf.starts_with(b"%PDF"));
        assert!(out.cards_per_page >= 1);
    }

    #[test]
    fn generate_print_pdf_requires_csv_data_unless_contour() {
        let opts = Options::default();
        let err = generate_pdf(None, BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("csv data is required"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words() {
        let opts = Options { font_sizes: vec![9.0], text_y_mm: vec![10.0], ..Options::default() };
        let err = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("word(s)"));
    }

    // 3-word base options used to test bounds checks for fields configured
    // with exactly 2 entries (i.e. fewer than the 3 words in the CSV row).
    fn three_word_options() -> Options {
        Options {
            font_sizes: vec![9.0, 9.0, 9.0],
            text_y_mm: vec![10.0, 10.0, 10.0],
            ..Options::default()
        }
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_fonts() {
        let opts = Options {
            font_data: vec![MONTSERRAT_BOLD_TTF.to_vec(), MONTSERRAT_BOLD_TTF.to_vec()],
            ..three_word_options()
        };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("font(s)"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_align() {
        let opts = Options { align: vec![TextAlign::Left, TextAlign::Right], ..three_word_options() };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("alignment(s)"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_x() {
        let opts = Options { text_x_mm: vec![5.0], ..Options::default() };
        let err = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("x-position(s)"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_colors() {
        let opts = Options {
            text_colors: vec![parse_color("#FF0000").unwrap(), parse_color("#00FF00").unwrap()],
            ..three_word_options()
        };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("text color(s)"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_rotations() {
        let opts = Options { text_rotations: vec![10.0, 20.0], ..three_word_options() };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("text rotation(s)"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_flip_x() {
        let opts = Options { text_flip_x: vec![true, false], ..three_word_options() };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("--text-flip-x"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_flip_y() {
        let opts = Options { text_flip_y: vec![true, false], ..three_word_options() };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("--text-flip-y"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_backgrounds() {
        let opts = Options {
            text_backgrounds: vec![parse_color_or_none("#FF0000").unwrap(), parse_color_or_none("none").unwrap()],
            ..three_word_options()
        };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("--text-backgrounds value"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_background_widths() {
        let opts = Options { text_background_widths_mm: vec![10.0, 20.0], ..three_word_options() };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("--text-backgrounds-widths"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_background_alphas() {
        let opts = Options { text_background_alphas: vec![0.5, 1.0], ..three_word_options() };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("--text-backgrounds-alphas"));
    }

    #[test]
    fn generate_print_pdf_with_combine_overlay() {
        let opts = Options { combine: true, ..Options::default() };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, Some(BACKGROUND_PDF), &opts)
            .expect("combine generation should succeed");

        assert!(out.pdf.starts_with(b"%PDF"));
    }

    #[test]
    fn generate_print_pdf_with_styling_options() {
        let opts = Options {
            align: vec![TextAlign::Left, TextAlign::Right],
            text_colors: vec![
                parse_color("#FF0000").unwrap(),
                parse_color("0:0:0:1").unwrap(),
            ],
            text_rotations: vec![15.0],
            text_flip_x: vec![true, false],
            text_flip_y: vec![false, true],
            text_backgrounds: vec![
                parse_color_or_none("#FFFF00").unwrap(),
                parse_color_or_none("none").unwrap(),
            ],
            text_background_padding_mm: 1.0,
            text_background_widths_mm: vec![40.0, 5.0],
            text_background_alphas: vec![0.3, 1.0],
            debug: true,
            safe_margin_mm: 5.0,
            ..Options::default()
        };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts)
            .expect("styled generation should succeed");

        assert!(out.pdf.starts_with(b"%PDF"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_contours() {
        let opts = Options {
            text_contour_colors: vec![parse_color_or_none("#FF0000").unwrap(), parse_color_or_none("none").unwrap()],
            ..three_word_options()
        };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("--text-contours value"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_contour_widths() {
        let opts = Options { text_contour_widths_mm: vec![0.25, 0.5], ..three_word_options() };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("--text-contour-widths"));
    }

    // Find the first card Form XObject (the one referencing the "BG"
    // background XObject) and return its decoded content operations.
    fn first_card_operations(pdf: &[u8]) -> Vec<Operation> {
        let doc = Document::load_mem(pdf).expect("pdf should parse");
        for object in doc.objects.values() {
            if let Object::Stream(stream) = object {
                if stream.dict.get(b"Subtype").and_then(Object::as_name_str).ok() != Some("Form") {
                    continue;
                }
                let Ok(resources) = stream.dict.get(b"Resources").and_then(Object::as_dict) else { continue };
                let Ok(xobjects) = resources.get(b"XObject").and_then(Object::as_dict) else { continue };
                if xobjects.has(b"BG") {
                    return stream.decode_content().expect("content should decode").operations;
                }
            }
        }
        panic!("no card form XObject found");
    }

    // Find the first card Form XObject's `/Resources /ExtGState` dictionary.
    fn first_card_ext_gstates(pdf: &[u8]) -> Dictionary {
        let doc = Document::load_mem(pdf).expect("pdf should parse");
        for object in doc.objects.values() {
            if let Object::Stream(stream) = object {
                if stream.dict.get(b"Subtype").and_then(Object::as_name_str).ok() != Some("Form") {
                    continue;
                }
                let Ok(resources) = stream.dict.get(b"Resources").and_then(Object::as_dict) else { continue };
                let Ok(xobjects) = resources.get(b"XObject").and_then(Object::as_dict) else { continue };
                if !xobjects.has(b"BG") {
                    continue;
                }
                return resources.get(b"ExtGState").and_then(Object::as_dict).cloned().unwrap_or_default();
            }
        }
        panic!("no card form XObject found");
    }

    #[test]
    fn diacritics_are_written_as_font_glyph_ids() {
        // Render a word with Romanian diacritics and confirm the content stream
        // writes 2-byte glyph IDs (Identity-H), not raw UTF-8 bytes — the latter
        // is what made diacritics garble under the old simple WinAnsi font.
        let opts = Options { font_sizes: vec![9.0], text_y_mm: vec![10.0], ..Options::default() };
        let out = generate_pdf(Some("mușchi\n"), BACKGROUND_PDF, None, &opts).expect("generation should succeed");

        let ops = first_card_operations(&out.pdf);
        let tj = ops.iter().find(|op| op.operator == "Tj").expect("a Tj text op");
        let Object::String(bytes, _) = &tj.operands[0] else { panic!("Tj operand should be a string") };

        let face = ttf_parser::Face::parse(MONTSERRAT_BOLD_TTF, 0).unwrap();
        let mut expected = Vec::new();
        for ch in "mușchi".chars() {
            let gid = face.glyph_index(ch).expect("Montserrat covers this char").0;
            assert_ne!(gid, 0, "{ch} must be a real glyph");
            expected.push((gid >> 8) as u8);
            expected.push((gid & 0xff) as u8);
        }
        assert_eq!(bytes, &expected, "text must be encoded as big-endian glyph ids");
    }

    #[test]
    fn generate_print_pdf_with_text_contour_draws_stroke_as_separate_pass() {
        let opts = Options {
            text_contour_colors: vec![parse_color_or_none("#FF0000").unwrap()],
            text_contour_widths_mm: vec![0.5],
            ..Options::default()
        };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts)
            .expect("contoured generation should succeed");

        let operations = first_card_operations(&out.pdf);

        let rg = operations.iter().find(|op| op.operator == "RG").expect("RG operator should be present");
        assert_eq!(rg.operands, vec![Object::Integer(1), Object::Integer(0), Object::Integer(0)]);

        let w = operations.iter().find(|op| op.operator == "w").expect("w operator should be present");
        assert_eq!(w.operands, vec![Object::Real(0.5 * crate::geometry::MM)]);

        // Each word's fill text is drawn in one pass (Tr 0), the contour
        // stroke in a separate pass (Tr 1), so each can have its own
        // ExtGState/blend mode. The default options lay out 2 words.
        let tr = operations.iter().filter(|op| op.operator == "Tr").map(|op| op.operands.clone()).collect::<Vec<_>>();
        assert_eq!(tr, vec![vec![Object::Integer(0)], vec![Object::Integer(1)], vec![Object::Integer(0)], vec![Object::Integer(1)]]);
    }

    #[test]
    fn generate_print_pdf_without_text_contour_uses_fill_only_render_mode() {
        let opts = Options::default();
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts)
            .expect("generation should succeed");

        let operations = first_card_operations(&out.pdf);

        assert!(operations.iter().all(|op| op.operator != "RG"));
        assert!(operations.iter().all(|op| op.operator != "w"));

        let tr = operations.iter().filter(|op| op.operator == "Tr").collect::<Vec<_>>();
        assert!(!tr.is_empty());
        assert!(tr.iter().all(|op| op.operands == vec![Object::Integer(0)]));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_background_blend_modes() {
        let opts = Options { text_background_blend_modes: vec![BlendMode::Multiply, BlendMode::Normal], ..three_word_options() };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("--text-backgrounds-blend-modes"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_contour_blend_modes() {
        let opts = Options { text_contour_blend_modes: vec![BlendMode::Multiply, BlendMode::Normal], ..three_word_options() };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("--text-contour-blend-modes"));
    }

    #[test]
    fn generate_print_pdf_with_text_background_blend_mode_sets_extgstate_bm() {
        let opts = Options {
            text_backgrounds: vec![parse_color_or_none("#FFFF00").unwrap()],
            text_background_blend_modes: vec![BlendMode::Multiply],
            ..Options::default()
        };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts)
            .expect("generation should succeed");

        let ext_gstates = first_card_ext_gstates(&out.pdf);
        let bm = ext_gstates.iter().find_map(|(_, gs)| {
            let gs = gs.as_dict().ok()?;
            gs.get(b"BM").and_then(Object::as_name_str).ok()
        });
        assert_eq!(bm, Some("Multiply"));
    }

    #[test]
    fn generate_print_pdf_with_text_contour_blend_mode_sets_extgstate_bm() {
        let opts = Options {
            text_contour_colors: vec![parse_color_or_none("#FF0000").unwrap()],
            text_contour_blend_modes: vec![BlendMode::Screen],
            ..Options::default()
        };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts)
            .expect("generation should succeed");

        let ext_gstates = first_card_ext_gstates(&out.pdf);
        let bm = ext_gstates.iter().find_map(|(_, gs)| {
            let gs = gs.as_dict().ok()?;
            gs.get(b"BM").and_then(Object::as_name_str).ok()
        });
        assert_eq!(bm, Some("Screen"));
    }

    #[test]
    fn generate_print_pdf_without_blend_modes_omits_extgstate_bm() {
        let opts = Options {
            text_backgrounds: vec![parse_color_or_none("#FFFF00").unwrap()],
            text_contour_colors: vec![parse_color_or_none("#FF0000").unwrap()],
            ..Options::default()
        };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts)
            .expect("generation should succeed");

        let ext_gstates = first_card_ext_gstates(&out.pdf);
        for (_, gs) in ext_gstates.iter() {
            let gs = gs.as_dict().expect("ExtGState entry should be a dict");
            assert!(!gs.has(b"BM"), "unexpected /BM in {:?}", gs);
        }
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words_for_text_blend_modes() {
        let opts = Options { text_blend_modes: vec![BlendMode::Multiply, BlendMode::Normal], ..three_word_options() };
        let err = generate_pdf(Some("1A 1 X\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("--text-blend-modes"));
    }

    #[test]
    fn generate_print_pdf_with_text_blend_mode_sets_extgstate_bm() {
        let opts = Options {
            text_blend_modes: vec![BlendMode::Multiply],
            ..Options::default()
        };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts)
            .expect("generation should succeed");

        let ext_gstates = first_card_ext_gstates(&out.pdf);
        let bm = ext_gstates.iter().find_map(|(_, gs)| {
            let gs = gs.as_dict().ok()?;
            gs.get(b"BM").and_then(Object::as_name_str).ok()
        });
        assert_eq!(bm, Some("Multiply"));
    }

    #[test]
    fn generate_print_pdf_emits_per_word_char_spacing_as_tc() {
        // Two words, two distinct character-spacing values.
        let opts = Options {
            text_char_spacing_pt: vec![0.5, 1.25],
            ..Options::default()
        };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts)
            .expect("generation should succeed");

        let operations = first_card_operations(&out.pdf);
        let tc = operations
            .iter()
            .filter(|op| op.operator == "Tc")
            .map(|op| op.operands.clone())
            .collect::<Vec<_>>();
        assert_eq!(tc, vec![vec![Object::Real(0.5)], vec![Object::Real(1.25)]]);
    }

    #[test]
    fn generate_print_pdf_centers_multibyte_text_by_char_count() {
        // A single multi-byte character ("é" is 2 UTF-8 bytes) has no gaps
        // between characters, so its centered x must not depend on the spacing
        // value. The previous byte-count logic added one spacing's worth of
        // width and shifted the glyph left.
        let td_x = |spacing: f32| -> f32 {
            let opts = Options {
                font_sizes: vec![9.0],
                text_y_mm: vec![10.0],
                text_char_spacing_pt: vec![spacing],
                ..Options::default()
            };
            let out = generate_pdf(Some("é\n"), BACKGROUND_PDF, None, &opts)
                .expect("generation should succeed");
            let operations = first_card_operations(&out.pdf);
            let td = operations.iter().find(|op| op.operator == "Td").expect("Td present");
            match &td.operands[0] {
                Object::Real(v) => *v,
                other => panic!("unexpected Td x operand: {other:?}"),
            }
        };
        assert_eq!(td_x(0.0), td_x(50.0));
    }

    #[test]
    fn generate_print_pdf_defaults_char_spacing_when_unset() {
        // Empty `text_char_spacing_pt` falls back to no extra tracking (0.0pt).
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &Options::default())
            .expect("generation should succeed");

        // lopdf serializes 0.0 without a decimal point, so it decodes back as
        // an Integer — compare numeric values rather than the exact variant.
        let operations = first_card_operations(&out.pdf);
        let tc = operations
            .iter()
            .filter(|op| op.operator == "Tc")
            .map(|op| match op.operands[0] {
                Object::Real(v) => v,
                Object::Integer(v) => v as f32,
                ref other => panic!("unexpected Tc operand: {other:?}"),
            })
            .collect::<Vec<_>>();
        assert_eq!(tc, vec![0.0, 0.0]);
    }
}
