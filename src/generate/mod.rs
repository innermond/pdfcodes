mod cards;
mod contour;
mod overlay;

use lopdf::{Document, Object, Stream, Dictionary, content::{Operation, Content}};

use crate::fonts::{embed_fonts, MONTSERRAT_BOLD_TTF};
use crate::geometry::CardLayout;
use crate::measure::measure_stroked_paths;
use crate::options::Options;

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

    // Get background page
    let pages = doc.get_pages();
    let (_, bg_page_id) = pages.iter().next().ok_or("No pages in background PDF")?;
    let bg_page_obj = doc.get_object(*bg_page_id)?;
    let bg_page_dict = bg_page_obj.as_dict()?;
    let media_box_obj = bg_page_dict.get(b"MediaBox")?;
    let media_box_orig = media_box_obj.as_array()?.clone();

    let card_w = match &media_box_orig[2] {
        Object::Integer(w) => *w as f32,
        Object::Real(w) => *w,
        _ => 595.0,
    };
    let card_h = match &media_box_orig[3] {
        Object::Integer(h) => *h as f32,
        Object::Real(h) => *h,
        _ => 842.0,
    };

    // Get background content bytes for XObject
    let bg_content_bytes = doc.get_page_content(*bg_page_id)?;

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

    // Resolve the font(s) used for label text. If none are supplied, fall
    // back to the bundled Montserrat Bold. A single font is used for every
    // word; otherwise each word position uses its own font by index.
    let font_bytes_list: Vec<&[u8]> = if opts.font_data.is_empty() {
        vec![MONTSERRAT_BOLD_TTF]
    } else {
        opts.font_data.iter().map(|v| v.as_slice()).collect()
    };
    let embedded_fonts = embed_fonts(&mut doc, &font_bytes_list)?;

    // Get pages root
    let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    let catalog = doc.get_object(catalog_id)?;
    let pages_id = catalog.as_dict()?.get(b"Pages").unwrap().as_reference()?;

    // Remove the original background page from the page tree, since its
    // content is now reused as the BG XObject on every generated card.
    {
        let pages_obj = doc.get_object(pages_id)?;
        let pages_dict_orig = pages_obj.as_dict()?;
        let mut kids = pages_dict_orig.get(b"Kids").unwrap().as_array()?.clone();
        kids.retain(|kid| kid.as_reference().map(|r| r != *bg_page_id).unwrap_or(true));
        let count = kids.len() as i64;
        let mut pages_dict = pages_dict_orig.clone();
        pages_dict.set("Kids", Object::Array(kids));
        pages_dict.set("Count", Object::Integer(count));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));
    }
    doc.objects.remove(bg_page_id);

    // If requested, lay out a single host page using the grid (same
    // dimensions, offsets and registration circles), with every cell showing
    // just the background and no label text.
    if opts.contour {
        let (
            path_length_per_card_mm, path_length_total_mm,
            node_count_per_card, node_count_total,
            sharp_turn_count_per_card, sharp_turn_count_total,
        ) = if opts.measure_paths {
            let path_metrics = measure_stroked_paths(&bg_content_bytes)?;
            let per_card_mm = path_metrics.length / crate::geometry::MM;
            let total_mm = per_card_mm * layout.cards_per_page as f32;
            (
                Some(per_card_mm), Some(total_mm),
                Some(path_metrics.node_count), Some(path_metrics.node_count * layout.cards_per_page),
                Some(path_metrics.sharp_turn_count), Some(path_metrics.sharp_turn_count * layout.cards_per_page),
            )
        } else {
            (None, None, None, None, None, None)
        };

        let page_id = contour::build_contour_page(&mut doc, pages_id, bg_form_id, &layout)?;

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
            path_length_per_card_mm, path_length_total_mm,
            node_count_per_card, node_count_total,
            sharp_turn_count_per_card, sharp_turn_count_total,
        });
    }

    // Load CSV
    let csv_data = csv_data.ok_or("csv data is required unless contour is set")?;
    let card_ids = cards::build_card_xobjects(&mut doc, csv_data, opts, &embedded_fonts, &layout, bg_form_id)?;

    // If requested, build a non-printable overlay layer showing the contour
    // grid (background tiles + registration circles) at the same positions
    // as the print grid, so print/contour alignment can be checked visually.
    let overlay = if opts.combine {
        let contour_bytes = contour_background_bytes.ok_or("--combineb requires a contour background PDF")?;
        Some(overlay::build_overlay(&mut doc, contour_bytes, catalog_id, &layout)?)
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

    Ok(GenerateOutput {
        pdf,
        cards_per_page: layout.cards_per_page,
        path_length_per_card_mm: None, path_length_total_mm: None,
        node_count_per_card: None, node_count_total: None,
        sharp_turn_count_per_card: None, sharp_turn_count_total: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::{parse_color, parse_color_or_none};
    use crate::align::TextAlign;

    static BACKGROUND_PDF: &[u8] = include_bytes!("../../15x15.pdf");

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
}
