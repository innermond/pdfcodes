// SVG → PDF background converter, compiled to its own lazily-loaded wasm module
// (see web-preview/src/lib/svgWasm.ts). The JS side hands us the SVG document as
// text and expects a standalone one-page vector PDF, sized to the SVG's physical
// dimensions, whose bytes feed the same pipeline as an uploaded background PDF.

use wasm_bindgen::prelude::*;

// svg2pdf re-exports the usvg it parses with, so we pin to exactly its version.
use svg2pdf::usvg;

/// Convert an SVG document to a standalone one-page background PDF.
///
/// Returns the PDF bytes, or a JS error whose message is surfaced to the user
/// (the caller normalises it into the same Romanian message as a bad upload).
#[wasm_bindgen]
pub fn svg_to_pdf(svg_text: String) -> Result<Vec<u8>, JsError> {
    // No `text` feature is compiled in, so any <text> is dropped during parsing;
    // the UI has already warned about that before calling here.
    let options = usvg::Options::default();
    let tree = usvg::Tree::from_str(&svg_text, &options)
        .map_err(|err| JsError::new(&format!("SVG invalid: {err}")))?;

    let pdf = svg2pdf::to_pdf(
        &tree,
        svg2pdf::ConversionOptions::default(),
        svg2pdf::PageOptions::default(),
    )
    .map_err(|err| JsError::new(&format!("Conversie SVG eșuată: {err}")))?;

    Ok(pdf)
}
