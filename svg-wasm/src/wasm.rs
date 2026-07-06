use wasm_bindgen::prelude::*;

// Convert an SVG document (as text) to a standalone one-page background PDF.
// The web preview loads this module lazily — only once the user actually picks
// an SVG — and feeds the returned bytes through the same pipeline as an
// uploaded background PDF.
#[wasm_bindgen]
pub fn svg_to_pdf(svg_text: &str) -> Result<Vec<u8>, JsError> {
    crate::convert_svg_to_pdf(svg_text).map_err(|e| JsError::new(&e.to_string()))
}
