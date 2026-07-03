use crate::align::TextAlign;
use crate::blend::BlendMode;
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
    // Cutter feed rate (mm/s) used to estimate cutting time from the
    // measured path length.
    pub cutting_speed_mm_s: f32,
    // Extra dwell time (seconds) added per sharp (>= 90 degree) turn, to
    // account for the cutter decelerating/accelerating through the corner.
    pub corner_penalty_s: f32,
    // Fixed time (seconds) per page for manually feeding the sheet into the
    // cutter and having it register the 3 black registration circles.
    pub preparation_time_s: f32,
    // Speed (mm/s) of the blade's non-cutting travel moves between cards.
    pub travel_speed_mm_s: f32,
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
    // Blend mode for the text fill itself, one per word position (or a
    // single entry for every word). Empty means `Normal` for every word.
    pub text_blend_modes: Vec<BlendMode>,
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
    // Opacity (0.0 transparent - 1.0 opaque) of the text fill itself, one per
    // word position (or a single entry for every word). Empty means fully opaque.
    pub text_alphas: Vec<f32>,
    // Blend mode for the `text_backgrounds` rectangle, one per word position
    // (or a single entry for every word). Empty means `Normal` for every
    // word.
    pub text_background_blend_modes: Vec<BlendMode>,
    // Character combination (one or more characters) used to split each CSV
    // field into "words" for per-word layout. Empty defaults to a single
    // space character.
    pub split_chars: String,
    // Override the card dimensions (in mm) derived from the background PDF's
    // MediaBox. When both are set, the background content is scaled via a PDF
    // `cm` transform to fill the target size without rasterization.
    pub card_width_mm: Option<f32>,
    pub card_height_mm: Option<f32>,
    // When true and the contour source is a plain rectangle with zero inset,
    // the contour page draws spanning grid lines instead of tiling individual
    // rectangles — eliminating the double-stroke along shared card edges.
    pub contour_as_grid: bool,
    // Stroke color drawn around each text part's glyphs, one per word
    // position (or a single entry for every word). `None` means no contour
    // for that word. Empty means no contours at all.
    pub text_contour_colors: Vec<Option<TextColor>>,
    // Stroke width (in mm) for `text_contour_colors`, one per word position
    // (or a single entry for every word). Empty defaults to 0.25mm for any
    // word with a contour color set.
    pub text_contour_widths_mm: Vec<f32>,
    // Blend mode for `text_contour_colors`, one per word position (or a
    // single entry for every word). Empty means `Normal` for every word.
    pub text_contour_blend_modes: Vec<BlendMode>,
    // Extra spacing (in points) inserted between characters of each word,
    // emitted as the PDF `Tc` operator. One per word position (or a single
    // entry for every word). Empty defaults to no extra tracking (0.0) for
    // every word.
    pub text_char_spacing_pt: Vec<f32>,
    // 1-based page to use from the uploaded background PDF (for multi-page
    // uploads). Defaults to 1. `contour_page_number` selects the page from the
    // separately-loaded contour PDF used by the `--combineb` overlay.
    pub background_page_number: u32,
    pub contour_page_number: u32,
    // Extra clockwise rotation (degrees, multiple of 90) the user applied to the
    // print background, added to the page's own /Rotate before baking. Default 0.
    pub background_rotation: i64,
    // Mirror the print background horizontally / vertically, applied (after any
    // rotation) in the oriented page space and baked into the background content —
    // the same axes the pdf.js preview flips. Default false.
    pub background_flip_x: bool,
    pub background_flip_y: bool,
    // Pan the print background within its own card rectangle (mm; X rightward,
    // Y upward, PDF convention), baked as the outermost transform on the drawn
    // background. Content shifted past the card edge is clipped by the background
    // Form's BBox; the vacated area stays transparent. Default 0 (no pan).
    pub background_offset_x_mm: f32,
    pub background_offset_y_mm: f32,
    // Free-angle "spin" (clockwise degrees) applied to the drawn background about the card
    // center, on top of the 90° `background_rotation` reorient. Corners it rotates past the
    // card edge are clipped by the background Form's BBox (left transparent / backdrop).
    // Default 0.
    pub background_spin_deg: f32,
    // Solid color painted behind the (possibly panned) background, filling the whole
    // card so the zones a pan vacates — and any transparent pixels of the background —
    // show this color instead of nothing. `None` keeps them transparent. Default None.
    pub background_backdrop_color: Option<TextColor>,
    // "Non-decupare" (no-cut) mode: skip imposition entirely. Each card (or the
    // contour outline) is emitted on its own page sized to the card, with no
    // registration circles. See `CardLayout::compute`.
    pub no_cut: bool,
    // Translate the contour outline by this many mm (right/up positive) relative
    // to its default position, so the cut can be nudged to align with the print
    // background. Applied in the standalone contour page and the combine overlay.
    pub contour_offset_x_mm: f32,
    pub contour_offset_y_mm: f32,
    // For the no-cut standalone contour: lay the cut page out at this size (the
    // print background's card size) instead of the contour PDF's own size, so a
    // contour smaller than the background can be offset within it and still cut
    // in the right place. `None`/0 keeps the contour's own size (legacy).
    pub contour_canvas_width_mm: Option<f32>,
    pub contour_canvas_height_mm: Option<f32>,
    // Resize/rotate applied to the contour in the combine overlay so it matches
    // the standalone cut (which gets the same transform through the background
    // pipeline). Width/height are the target card size in mm (`None`/0 keeps the
    // contour's own size); rotation is clockwise degrees (multiple of 90),
    // combined with the contour page's own /Rotate. Default: no transform.
    pub contour_target_width_mm: Option<f32>,
    pub contour_target_height_mm: Option<f32>,
    pub contour_rotation: i64,
    // Free-angle "spin" (clockwise degrees) applied to the contour about its own center,
    // on top of the 90° `contour_rotation` reorient. Baked into the standalone cut and the
    // combine overlay; rotates the cut outline (and its keep-region) without changing the
    // contour's target size. Default 0.
    pub contour_spin_deg: f32,
    // The spun contour's *display footprint*: the tight bounding box of its outline
    // after the spin, relative to the un-spun contour box's origin (mm, y-up;
    // left/bottom go negative when the spin reaches past the box). Computed by the web
    // from the actual outline and consumed only when the relevant spin is nonzero: the
    // standalone cut and the combine overlay re-origin the spun contour to this
    // footprint and treat it as the contour box, so nothing is clipped and the cut
    // page/cells stay aligned with the minimal print window (which the web also sizes
    // to the footprint). `None` falls back to the spun box rectangle's bounding box.
    pub contour_footprint_left_mm: Option<f32>,
    pub contour_footprint_bottom_mm: Option<f32>,
    pub contour_footprint_width_mm: Option<f32>,
    pub contour_footprint_height_mm: Option<f32>,
    // Trim an uploaded contour to the tight bounding box of its drawn path instead of
    // its page MediaBox, so a cut line sitting inside a larger page (with whitespace
    // margins) is sized/placed by the artwork, not the page. Default: false (use the
    // page size, the historical behavior). See `measure::content_path_bbox`.
    pub contour_trim_to_path: bool,
    // "Minimal" mode: crop the generated print page (and each card cell) down to the
    // contour's bounding box instead of the background's size, so the output is a
    // smaller page tightly bounding the contour. `minimal_width_mm`/`minimal_height_mm`
    // are the contour box (mm); the crop origin within the background frame reuses
    // `contour_offset_x_mm`/`contour_offset_y_mm`. `None`/0 disables (full background).
    pub minimal: bool,
    pub minimal_width_mm: Option<f32>,
    pub minimal_height_mm: Option<f32>,
    // The cut contour's "keep" region, as one or more closed polygons in card
    // coordinates (PDF points, y-up), even-odd fill. When non-empty, the
    // text-overflow check flags a code whose glyph outlines are not fully inside
    // this region (i.e. the cut would slice it), instead of testing against the
    // card width / safe margin. Empty keeps the legacy card-confinement check.
    // The web app derives it from the actual contour path / preset shape and its
    // placement within the card; see `contourKeepRegion.ts`.
    pub contour_keep_polygons: Vec<Vec<(f32, f32)>>,
    // "Corectare depășire": when a code overflows the cut/card, shrink its font
    // size (down to `min_font_size_pt`, never below) until it fits instead of only
    // flagging it. `overflow_correction_by_column` selects the scope: false shrinks
    // each overflowing code on its own card (per-code); true shrinks a whole word
    // position uniformly to the largest size at which every code in it fits.
    pub correct_overflow: bool,
    pub min_font_size_pt: f32,
    pub overflow_correction_by_column: bool,
    // Safety inset (mm) applied to the cut contour before the fit check: a code must
    // clear the real cut by at least this distance (it is tested against the contour
    // eroded inward by this much), so the corrector never parks a code right on the
    // cut line. 0 = test against the true cut path. Only used when a contour exists.
    pub contour_inset_mm: f32,
    // The contour's bounding rectangle horizontal extent in card mm (left edge, width),
    // used to resolve the `ContourLeft/Center/Right` alignments per code against the
    // contour instead of the card. `None` falls back to the card frame (0, card width).
    pub contour_align_left_mm: Option<f32>,
    pub contour_align_width_mm: Option<f32>,
    // Total number of cards (CSV rows) the print job will emit, so the contour branch can
    // tell whether the last printed sheet is partial and, if so, append an extra contour
    // page cutting only the cards that exist on it. `None` ⇒ single full-grid page (legacy).
    pub contour_total_cards: Option<usize>,
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
            cutting_speed_mm_s: 8.0,
            corner_penalty_s: 0.2,
            preparation_time_s: 60.0,
            travel_speed_mm_s: 16.0,
            font_sizes: vec![9.0, 14.0],
            text_y_mm: vec![10.0, 3.0],
            text_x_mm: Vec::new(),
            font_data: Vec::new(),
            align: vec![TextAlign::Center],
            text_colors: Vec::new(),
            text_blend_modes: Vec::new(),
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
            text_alphas: Vec::new(),
            text_background_blend_modes: Vec::new(),
            split_chars: " ".to_string(),
            card_width_mm: None,
            card_height_mm: None,
            contour_as_grid: false,
            text_contour_colors: Vec::new(),
            text_contour_widths_mm: Vec::new(),
            text_contour_blend_modes: Vec::new(),
            text_char_spacing_pt: Vec::new(),
            background_page_number: 1,
            contour_page_number: 1,
            background_rotation: 0,
            background_flip_x: false,
            background_flip_y: false,
            background_offset_x_mm: 0.0,
            background_offset_y_mm: 0.0,
            background_spin_deg: 0.0,
            background_backdrop_color: None,
            no_cut: false,
            contour_offset_x_mm: 0.0,
            contour_offset_y_mm: 0.0,
            contour_canvas_width_mm: None,
            contour_canvas_height_mm: None,
            contour_target_width_mm: None,
            contour_target_height_mm: None,
            contour_rotation: 0,
            contour_spin_deg: 0.0,
            contour_footprint_left_mm: None,
            contour_footprint_bottom_mm: None,
            contour_footprint_width_mm: None,
            contour_footprint_height_mm: None,
            contour_trim_to_path: false,
            minimal: false,
            minimal_width_mm: None,
            minimal_height_mm: None,
            contour_keep_polygons: Vec::new(),
            correct_overflow: false,
            min_font_size_pt: 6.0,
            overflow_correction_by_column: false,
            contour_inset_mm: 0.0,
            contour_align_left_mm: None,
            contour_align_width_mm: None,
            contour_total_cards: None,
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
