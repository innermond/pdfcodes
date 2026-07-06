use svg2pdf::usvg;

#[cfg(target_arch = "wasm32")]
mod wasm;

// Convert an SVG document to a standalone one-page PDF whose page size matches
// the SVG's physical size, drawn as real vector content (paths, gradients,
// clips, transparency — never rasterized). The result feeds the same pipeline
// as an uploaded background PDF (the "Fundal imagine" feature).
//
// Sizing: usvg resolves absolute units at 96 dpi (the CSS pixel), so an SVG
// declared `width="86mm"` parses to 325.04 px; passing `dpi: 96` back to
// svg2pdf maps those px onto PDF points at their physical size (243.78 pt =
// 86 mm). An SVG with only a viewBox (no absolute width/height) keeps its
// viewBox units as CSS px — the app's target-size override rescales it anyway.
//
// The `text` cargo feature is off (see Cargo.toml), so `<text>` elements are
// dropped at parse time; the web side warns the user before converting.
pub fn convert_svg_to_pdf(svg_text: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let tree = usvg::Tree::from_str(svg_text, &usvg::Options::default())?;
    let pdf = svg2pdf::to_pdf(
        &tree,
        svg2pdf::ConversionOptions::default(),
        svg2pdf::PageOptions { dpi: 96.0 },
    )
    .map_err(|e| e.to_string())?;
    Ok(pdf)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 1 mm in PDF points (matches `geometry::MM` in the main crate).
    const MM: f32 = 72.0 / 25.4;

    fn num(o: &lopdf::Object) -> f32 {
        match o {
            lopdf::Object::Real(v) => *v,
            lopdf::Object::Integer(v) => *v as f32,
            _ => panic!("expected a number"),
        }
    }

    // Load the produced PDF with the same lopdf version the main crate uses and
    // return the document plus its single page's MediaBox width/height in points.
    fn load_single_page(pdf: &[u8]) -> (lopdf::Document, f32, f32) {
        let doc = lopdf::Document::load_mem(pdf).expect("output should parse as a PDF");
        let pages = doc.get_pages();
        assert_eq!(pages.len(), 1, "exactly one page expected");
        let (_, page_id) = pages.into_iter().next().unwrap();
        let page = doc.get_object(page_id).unwrap().as_dict().unwrap();
        let mb = page.get(b"MediaBox").unwrap().as_array().unwrap();
        let (w, h) = (num(&mb[2]) - num(&mb[0]), num(&mb[3]) - num(&mb[1]));
        (doc, w, h)
    }

    #[test]
    fn card_svg_converts_to_physical_size_pdf() {
        // A card-like SVG exercising the vector core: gradient fill, transparency,
        // a stroked path, and absolute mm dimensions.
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="86mm" height="54mm" viewBox="0 0 86 54">
          <defs><linearGradient id="g"><stop offset="0" stop-color="#0af"/><stop offset="1" stop-color="#f0a"/></linearGradient></defs>
          <rect width="86" height="54" fill="url(#g)"/>
          <circle cx="43" cy="27" r="20" fill="#fff" fill-opacity="0.5"/>
          <path d="M10 10 L76 10 L43 44 Z" fill="none" stroke="#333" stroke-width="1.5"/>
        </svg>"##;

        let pdf = convert_svg_to_pdf(svg).expect("should convert");
        assert!(pdf.starts_with(b"%PDF"));

        // 86 x 54 mm must land at its physical size in points (dpi mapping is
        // right), not the 4/3-inflated 96-dpi px size.
        let (_, w, h) = load_single_page(&pdf);
        assert!((w - 86.0 * MM).abs() < 0.05, "width {w} pt should be 86 mm");
        assert!((h - 54.0 * MM).abs() < 0.05, "height {h} pt should be 54 mm");
    }

    #[test]
    fn output_is_vector_not_raster() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="4" fill="#f00"/>
        </svg>"##;
        let pdf = convert_svg_to_pdf(svg).expect("should convert");
        let (doc, _, _) = load_single_page(&pdf);

        // No Image XObject anywhere in the document — the circle stays a path.
        for (_, obj) in doc.objects.iter() {
            if let Ok(stream) = obj.as_stream() {
                if let Ok(subtype) = stream.dict.get(b"Subtype").and_then(|s| s.as_name()) {
                    assert_ne!(subtype, b"Image", "vector SVG must not be rasterized");
                }
            }
        }
    }

    #[test]
    fn viewbox_only_svg_uses_css_px_size() {
        // No absolute width/height: the viewBox units are CSS px (96 dpi), so
        // 96 px come out as exactly 1 inch = 72 pt.
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
          <rect width="96" height="96" fill="#00f"/>
        </svg>"##;
        let pdf = convert_svg_to_pdf(svg).expect("should convert");
        let (_, w, h) = load_single_page(&pdf);
        assert!((w - 72.0).abs() < 0.05, "96 css px should be 72 pt, got {w}");
        assert!((h - 72.0).abs() < 0.05, "96 css px should be 72 pt, got {h}");
    }

    #[test]
    fn transparency_survives_conversion() {
        // A half-transparent fill must produce an ExtGState with a fill alpha (ca)
        // below 1 — proof the PDF keeps real transparency rather than flattening.
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10">
          <rect width="10" height="10" fill="#fff"/>
          <circle cx="5" cy="5" r="4" fill="#000" fill-opacity="0.5"/>
        </svg>"##;
        let pdf = convert_svg_to_pdf(svg).expect("should convert");
        let (doc, _, _) = load_single_page(&pdf);

        let mut found_alpha = false;
        for (_, obj) in doc.objects.iter() {
            if let Ok(dict) = obj.as_dict() {
                if let Ok(ca) = dict.get(b"ca") {
                    if num(ca) < 1.0 {
                        found_alpha = true;
                    }
                }
            }
        }
        assert!(found_alpha, "expected an ExtGState with fill alpha < 1");
    }

    #[test]
    fn rejects_invalid_svg() {
        assert!(convert_svg_to_pdf("not an svg at all").is_err());
        assert!(convert_svg_to_pdf("<svg xmlns='http://www.w3.org/2000/svg'><unclosed").is_err());
    }
}
