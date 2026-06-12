use crate::align::TextAlign;
use crate::color::TextColor;

#[derive(Clone)]
pub struct Options {
    pub host_width_mm: f32,
    pub host_height_mm: f32,
    pub offset_x_mm: f32,
    pub offset_y_mm: f32,
    pub circle_diameter_mm: f32,
    pub contour: bool,
    pub measure_paths: bool,
    // Per-word text layout: font size in points and baseline y-position in
    // mm, indexed by the word's position in the (space-separated) CSV field.
    pub font_sizes: Vec<f32>,
    pub text_y_mm: Vec<f32>,
    // Explicit baseline x-position in mm, indexed by word position. When
    // non-empty, overrides `align` entirely (and, like `text_y_mm`, ignores
    // `safe_margin_mm`).
    pub text_x_mm: Vec<f32>,
    // TrueType/OpenType font data, one per word position (or a single entry
    // to use the same font for every word). Empty falls back to the bundled
    // Montserrat Bold.
    pub font_data: Vec<Vec<u8>>,
    // Horizontal alignment, one per word position (or a single entry to use
    // the same alignment for every word).
    pub align: Vec<TextAlign>,
    // Text fill color per word position, or a single entry to use the same
    // color for every word. Empty defaults to RGB black.
    pub text_colors: Vec<TextColor>,
    // When generating the print PDF, also draw the contour grid (background
    // tiles + registration circles) as a non-printable overlay layer, so the
    // alignment between print and contour PDFs can be checked visually.
    pub combine: bool,
    // Outline the bounding box of each text part on the print PDF.
    pub debug: bool,
    // Margin (in mm) kept clear of left/right-aligned text and used as the
    // intrusion threshold for the centering warning.
    pub safe_margin_mm: f32,
    // Rotation in degrees (counterclockwise), applied around each text
    // part's own center, one per word position (or a single entry to use
    // the same rotation for every word). Empty defaults to no rotation.
    pub text_rotations: Vec<f32>,
    // Mirror each text part horizontally/vertically around its own center,
    // one per word position (or a single entry for every word). Empty
    // defaults to no flip.
    pub text_flip_x: Vec<bool>,
    pub text_flip_y: Vec<bool>,
    // Background fill color drawn behind each text part's bounding box, one
    // per word position (or a single entry for every word). `None` means no
    // background for that word. Empty means no backgrounds at all.
    pub text_backgrounds: Vec<Option<TextColor>>,
    // Padding (in mm) added on all sides of the text bounding box when
    // drawing `text_backgrounds`.
    pub text_background_padding_mm: f32,
    // Explicit width (in mm) for the `text_backgrounds` rectangle, one per
    // word position (or a single entry for every word). When set for a
    // word, the rectangle is centered on the text part's horizontal center
    // with this width instead of the text width plus padding. Empty means
    // no override.
    pub text_background_widths_mm: Vec<f32>,
    // Opacity (0.0 transparent - 1.0 opaque) of the `text_backgrounds`
    // rectangle, one per word position (or a single entry for every word).
    // Empty means fully opaque.
    pub text_background_alphas: Vec<f32>,
}

impl Options {
    pub fn as_contour(&self) -> Options {
        Options { contour: true, ..self.clone() }
    }
}

impl Default for Options {
    fn default() -> Self {
        Options {
            host_width_mm: 267.0,
            host_height_mm: 350.0,
            offset_x_mm: 0.0,
            offset_y_mm: 0.0,
            circle_diameter_mm: 10.0,
            contour: false,
            measure_paths: false,
            font_sizes: vec![9.0, 14.0],
            text_y_mm: vec![10.0, 3.0],
            text_x_mm: Vec::new(),
            font_data: Vec::new(),
            align: vec![TextAlign::Center],
            text_colors: Vec::new(),
            combine: false,
            debug: false,
            safe_margin_mm: 0.0,
            text_rotations: Vec::new(),
            text_flip_x: Vec::new(),
            text_flip_y: Vec::new(),
            text_backgrounds: Vec::new(),
            text_background_padding_mm: 0.0,
            text_background_widths_mm: Vec::new(),
            text_background_alphas: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_as_contour_sets_contour_and_preserves_other_fields() {
        let opts = Options { host_width_mm: 123.0, ..Options::default() };
        assert!(!opts.contour);

        let contour_opts = opts.as_contour();
        assert!(contour_opts.contour);
        assert_eq!(contour_opts.host_width_mm, 123.0);
    }
}
