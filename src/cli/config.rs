use serde::Deserialize;

// Optional JSON config file (--config=path.json) providing defaults for any
// of the CLI parameters. CLI flags and positional arguments take precedence.
#[derive(Default, Deserialize)]
pub(crate) struct Config {
    pub csv: Option<String>,
    pub background: Option<String>,
    pub contour_background: Option<String>,
    pub output: Option<String>,
    pub contour_output: Option<String>,
    pub host_width: Option<f32>,
    pub host_height: Option<f32>,
    pub offset_x: Option<f32>,
    pub offset_y: Option<f32>,
    pub circle_diameter: Option<f32>,
    pub contour: Option<bool>,
    pub with_contour: Option<bool>,
    pub measure_paths: Option<bool>,
    // Cutter feed rate (mm/s) used to estimate cutting time.
    pub cutting_speed: Option<f32>,
    // Extra dwell time (seconds) added per sharp (>= 90 degree) turn.
    pub corner_penalty: Option<f32>,
    // Fixed time (seconds) per page for feeding/registering the sheet.
    pub preparation_time: Option<f32>,
    // Speed (mm/s) of the blade's non-cutting travel moves between cards.
    pub travel_speed: Option<f32>,
    // Per-word text layout: font size in points and baseline y-position in
    // mm, indexed by the word's position in the (space-separated) CSV field.
    pub font_sizes: Option<Vec<f32>>,
    pub text_y: Option<Vec<f32>>,
    // Explicit baseline x-position in mm, indexed by word position. When
    // set, overrides `align` (and ignores `safe_margin`).
    pub text_x: Option<Vec<f32>>,
    // Paths to TrueType/OpenType font files, one per word position (or a
    // single entry to use the same font for every word).
    pub fonts: Option<Vec<String>>,
    // Horizontal alignment ("left", "center", or "right"), one per word
    // position (or a single entry to use the same alignment for every word).
    pub align: Option<Vec<String>>,
    // Text fill color ("#RRGGBB"), one per word position (or a single entry
    // to use the same color for every word). Defaults to black.
    pub text_colors: Option<Vec<String>>,
    // Blend mode for the text fill itself ("normal", "multiply", "screen",
    // etc., matching CSS mix-blend-mode names), one per word position (or a
    // single entry for every word). Defaults to "normal".
    pub text_blend_modes: Option<Vec<String>>,
    // Overlay the contour grid as a non-printable layer on the print PDF.
    pub combineb: Option<bool>,
    // Outline the bounding box of each text part on the print PDF.
    pub debug: Option<bool>,
    // Margin (in mm) kept clear of left/right-aligned text.
    pub safe_margin: Option<f32>,
    // Rotation in degrees (counterclockwise) around each text part's own
    // center, one per word position (or a single entry for every word).
    pub text_rotations: Option<Vec<f32>>,
    // Mirror each text part horizontally/vertically around its own center,
    // one per word position (or a single entry for every word).
    pub text_flip_x: Option<Vec<bool>>,
    pub text_flip_y: Option<Vec<bool>>,
    // Background fill color drawn behind each text part's bounding box
    // ("#RRGGBB", "c:m:y:k", or "none"/"-" for no background), one per word
    // position (or a single entry for every word).
    pub text_backgrounds: Option<Vec<String>>,
    // Padding (in mm) added around the text bounding box for text_backgrounds.
    pub text_background_padding: Option<f32>,
    // Explicit width (in mm) for the text_backgrounds rectangle, one per
    // word position (or a single entry for every word). Centers the
    // rectangle on the text part's horizontal center.
    pub text_background_widths: Option<Vec<f32>>,
    // Opacity (0.0-1.0) of the text_backgrounds rectangle, one per word
    // position (or a single entry for every word).
    pub text_background_alphas: Option<Vec<f32>>,
    // Blend mode for the text_backgrounds rectangle ("normal", "multiply",
    // "screen", etc., matching CSS mix-blend-mode names), one per word
    // position (or a single entry for every word). Defaults to "normal".
    pub text_background_blend_modes: Option<Vec<String>>,
    // Stroke color drawn around each text part's glyphs ("#RRGGBB",
    // "c:m:y:k", or "none"/"-" for no contour), one per word position (or a
    // single entry for every word).
    pub text_contours: Option<Vec<String>>,
    // Stroke width (in mm) for text_contours, one per word position (or a
    // single entry for every word). Defaults to 0.25mm.
    pub text_contour_widths: Option<Vec<f32>>,
    // Blend mode for text_contours ("normal", "multiply", "screen", etc.,
    // matching CSS mix-blend-mode names), one per word position (or a
    // single entry for every word). Defaults to "normal".
    pub text_contour_blend_modes: Option<Vec<String>>,
    // Character combination used to split each CSV field into "words".
    // Defaults to a single space character.
    pub split_chars: Option<String>,
    // Extra spacing (in points) between characters of each word, one per word
    // position (or a single entry for every word). Defaults to 0.0pt.
    pub text_char_spacings: Option<Vec<f32>>,
}
