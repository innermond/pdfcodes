use wasm_bindgen::prelude::*;

use crate::align::TextAlign;
use crate::blend::BlendMode;
use crate::color::{parse_color, parse_color_or_none, TextColor};
use crate::generate::generate_pdf;
use crate::generate::image_bg::build_image_background_pdf;
use crate::generate::shapes::{build_polygon_pdf, build_shape_pdf, build_simple_background_pdf, ShapeKind};
use crate::geometry::CardLayout;
use crate::options::Options;
use lopdf::{Document, Object};

// Result of a wasm `generate` call: the PDF bytes plus, for contour
// pages, the stroked-path measurements (when `measure_paths` is set).
#[wasm_bindgen]
pub struct WasmGenerateOutput {
    pdf: Vec<u8>,
    cards_per_page: usize,
    path_length_per_card_mm: Option<f32>,
    path_length_total_mm: Option<f32>,
    node_count_per_card: Option<usize>,
    node_count_total: Option<usize>,
    sharp_turn_count_per_card: Option<usize>,
    sharp_turn_count_total: Option<usize>,
    time_cutting_per_card_s: Option<f32>,
    time_cutting_total_s: Option<f32>,
    text_overflow_count: usize,
    text_overflow_samples: Vec<String>,
}

#[wasm_bindgen]
impl WasmGenerateOutput {
    #[wasm_bindgen(getter)]
    pub fn pdf(&self) -> Vec<u8> {
        self.pdf.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn cards_per_page(&self) -> usize {
        self.cards_per_page
    }

    #[wasm_bindgen(getter)]
    pub fn path_length_per_card_mm(&self) -> Option<f32> {
        self.path_length_per_card_mm
    }

    #[wasm_bindgen(getter)]
    pub fn path_length_total_mm(&self) -> Option<f32> {
        self.path_length_total_mm
    }

    #[wasm_bindgen(getter)]
    pub fn node_count_per_card(&self) -> Option<usize> {
        self.node_count_per_card
    }

    #[wasm_bindgen(getter)]
    pub fn node_count_total(&self) -> Option<usize> {
        self.node_count_total
    }

    #[wasm_bindgen(getter)]
    pub fn sharp_turn_count_per_card(&self) -> Option<usize> {
        self.sharp_turn_count_per_card
    }

    #[wasm_bindgen(getter)]
    pub fn sharp_turn_count_total(&self) -> Option<usize> {
        self.sharp_turn_count_total
    }

    #[wasm_bindgen(getter)]
    pub fn time_cutting_per_card_s(&self) -> Option<f32> {
        self.time_cutting_per_card_s
    }

    #[wasm_bindgen(getter)]
    pub fn time_cutting_total_s(&self) -> Option<f32> {
        self.time_cutting_total_s
    }

    #[wasm_bindgen(getter)]
    pub fn text_overflow_count(&self) -> usize {
        self.text_overflow_count
    }

    // The offending codes, joined by '\n' (wasm-bindgen getters can't return
    // Vec<String>); the worker splits them back into a list for the UI.
    #[wasm_bindgen(getter)]
    pub fn text_overflow_samples(&self) -> String {
        self.text_overflow_samples.join("\n")
    }
}

// Generate a print PDF (when `csv_data` is `Some`) or a contour PDF
// (when `contour` is true; `csv_data` is then ignored).
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn generate(
    csv_data: Option<String>,
    background: &[u8],
    host_width_mm: f32,
    host_height_mm: f32,
    offset_x_mm: f32,
    offset_y_mm: f32,
    circle_diameter_mm: f32,
    contour: bool,
    measure_paths: bool,
    font_sizes: Vec<f32>,
    text_y_mm: Vec<f32>,
    text_x_mm: Vec<f32>,
    font_data: Vec<js_sys::Uint8Array>,
    align: Vec<String>,
    combine: bool,
    contour_background: Option<Vec<u8>>,
    debug: bool,
    safe_margin_mm: f32,
    text_colors: Vec<String>,
    text_blend_modes: Vec<String>,
    text_rotations: Vec<f32>,
    text_flip_x: Vec<u8>,
    text_flip_y: Vec<u8>,
    text_backgrounds: Vec<String>,
    text_background_padding_mm: f32,
    text_background_widths_mm: Vec<f32>,
    text_background_alphas: Vec<f32>,
    cutting_speed_mm_s: f32,
    corner_penalty_s: f32,
    preparation_time_s: f32,
    travel_speed_mm_s: f32,
    split_chars: String,
    text_contours: Vec<String>,
    text_contour_widths_mm: Vec<f32>,
    text_background_blend_modes: Vec<String>,
    text_contour_blend_modes: Vec<String>,
) -> Result<WasmGenerateOutput, JsError> {
    let align = align.iter()
        .map(|s| s.parse::<TextAlign>())
        .collect::<Result<Vec<TextAlign>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_colors = text_colors.iter()
        .map(|s| parse_color(s))
        .collect::<Result<Vec<TextColor>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_backgrounds = text_backgrounds.iter()
        .map(|s| parse_color_or_none(s))
        .collect::<Result<Vec<Option<TextColor>>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_contour_colors = text_contours.iter()
        .map(|s| parse_color_or_none(s))
        .collect::<Result<Vec<Option<TextColor>>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_background_blend_modes = text_background_blend_modes.iter()
        .map(|s| s.parse::<BlendMode>())
        .collect::<Result<Vec<BlendMode>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_contour_blend_modes = text_contour_blend_modes.iter()
        .map(|s| s.parse::<BlendMode>())
        .collect::<Result<Vec<BlendMode>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_blend_modes = text_blend_modes.iter()
        .map(|s| s.parse::<BlendMode>())
        .collect::<Result<Vec<BlendMode>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let opts = Options {
        host_width_mm,
        host_height_mm,
        offset_x_mm,
        offset_y_mm,
        circle_diameter_mm,
        contour,
        measure_paths,
        cutting_speed_mm_s,
        corner_penalty_s,
        preparation_time_s,
        travel_speed_mm_s,
        font_sizes,
        text_y_mm,
        text_x_mm,
        font_data: font_data.iter().map(|u| u.to_vec()).collect(),
        align,
        text_colors,
        text_blend_modes,
        combine,
        debug,
        safe_margin_mm,
        text_rotations,
        text_flip_x: text_flip_x.iter().map(|v| *v != 0).collect(),
        text_flip_y: text_flip_y.iter().map(|v| *v != 0).collect(),
        text_backgrounds,
        text_background_padding_mm,
        text_background_widths_mm,
        text_background_alphas,
        text_alphas: Vec::new(),
        text_background_blend_modes,
        split_chars,
        card_width_mm: None,
        card_height_mm: None,
        contour_as_grid: false,
        text_contour_colors,
        text_contour_widths_mm,
        text_contour_blend_modes,
        // The positional entry point keeps the previous fixed spacing.
        text_char_spacing_pt: Vec::new(),
        // The positional entry point always uses the first page.
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
        // The positional entry point has no contour geometry to test against.
        contour_keep_polygons: Vec::new(),
        // The positional entry point keeps the previous no-correction behavior.
        correct_overflow: false,
        min_font_size_pt: 6.0,
        overflow_correction_by_column: false,
        contour_inset_mm: 0.0,
        contour_align_left_mm: None,
        contour_align_width_mm: None,
        contour_total_cards: None,
    };

    let out = generate_pdf(csv_data.as_deref(), background, contour_background.as_deref(), &opts)
        .map_err(|e| JsError::new(&e.to_string()))?;

    Ok(WasmGenerateOutput {
        pdf: out.pdf,
        cards_per_page: out.cards_per_page,
        path_length_per_card_mm: out.path_length_per_card_mm,
        path_length_total_mm: out.path_length_total_mm,
        node_count_per_card: out.node_count_per_card,
        node_count_total: out.node_count_total,
        sharp_turn_count_per_card: out.sharp_turn_count_per_card,
        sharp_turn_count_total: out.sharp_turn_count_total,
        time_cutting_per_card_s: out.time_cutting_per_card_s,
        time_cutting_total_s: out.time_cutting_total_s,
        text_overflow_count: out.text_overflow_count,
        text_overflow_samples: out.text_overflow_samples,
    })
}

// Layout/styling options accepted as a single JS object by
// `generate_with_options`. Any field omitted by the caller falls back to
// the same default as `Options::default()`.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct JsOptions {
    host_width_mm: f32,
    host_height_mm: f32,
    offset_x_mm: f32,
    offset_y_mm: f32,
    circle_diameter_mm: f32,
    contour: bool,
    measure_paths: bool,
    cutting_speed_mm_s: f32,
    corner_penalty_s: f32,
    preparation_time_s: f32,
    travel_speed_mm_s: f32,
    font_sizes: Vec<f32>,
    text_y_mm: Vec<f32>,
    text_x_mm: Vec<f32>,
    align: Vec<String>,
    combine: bool,
    debug: bool,
    safe_margin_mm: f32,
    text_colors: Vec<String>,
    text_blend_modes: Vec<String>,
    text_rotations: Vec<f32>,
    text_flip_x: Vec<bool>,
    text_flip_y: Vec<bool>,
    text_backgrounds: Vec<String>,
    text_background_padding_mm: f32,
    text_background_widths_mm: Vec<f32>,
    text_background_alphas: Vec<f32>,
    text_alphas: Vec<f32>,
    text_background_blend_modes: Vec<String>,
    split_chars: String,
    card_width_mm: Option<f32>,
    card_height_mm: Option<f32>,
    contour_as_grid: bool,
    text_contours: Vec<String>,
    text_contour_widths_mm: Vec<f32>,
    text_contour_blend_modes: Vec<String>,
    text_char_spacings_pt: Vec<f32>,
    background_page_number: Option<u32>,
    contour_page_number: Option<u32>,
    background_rotation: i64,
    background_flip_x: bool,
    background_flip_y: bool,
    background_offset_x_mm: f32,
    background_offset_y_mm: f32,
    // Free-angle spin (degrees) of the background about the card center.
    background_spin_deg: f32,
    // Solid backdrop for the zones a pan vacates ("#RRGGBB" or "c:m:y:k"); empty keeps
    // them transparent.
    background_backdrop_color: String,
    no_cut: bool,
    contour_offset_x_mm: f32,
    contour_offset_y_mm: f32,
    contour_canvas_width_mm: Option<f32>,
    contour_canvas_height_mm: Option<f32>,
    contour_target_width_mm: Option<f32>,
    contour_target_height_mm: Option<f32>,
    contour_rotation: i64,
    // Free-angle spin (degrees) of the contour about its own center.
    contour_spin_deg: f32,
    // The spun contour's display footprint relative to its un-spun box origin (mm,
    // y-up); see `contour_footprint_*_mm` in src/options.rs. Only consulted when the
    // relevant spin is nonzero.
    contour_footprint_left_mm: Option<f32>,
    contour_footprint_bottom_mm: Option<f32>,
    contour_footprint_width_mm: Option<f32>,
    contour_footprint_height_mm: Option<f32>,
    contour_trim_to_path: bool,
    minimal: bool,
    minimal_width_mm: Option<f32>,
    minimal_height_mm: Option<f32>,
    // Cut "keep" region for the overflow check: flat [x0,y0,x1,y1,...] card
    // points (y-up) with `contour_keep_subpath_lens` giving the vertex count of
    // each closed subpath (even-odd). Empty ⇒ legacy card/safe-margin check.
    contour_keep_region: Vec<f32>,
    contour_keep_subpath_lens: Vec<u32>,
    // "Corectare depășire": auto-shrink overflowing codes down to
    // `min_font_size_pt`. `overflow_correction_by_column` picks the scope
    // (false = per code, true = uniform per word position).
    correct_overflow: bool,
    min_font_size_pt: f32,
    overflow_correction_by_column: bool,
    // Inward safety margin (mm) from the cut used by the fit check / corrector.
    contour_inset_mm: f32,
    // Contour bounding-rect horizontal extent (card mm) for the `contour-*` alignments,
    // resolved per code against the contour instead of the card. `None` ⇒ card frame.
    contour_align_left_mm: Option<f32>,
    contour_align_width_mm: Option<f32>,
    // Total cards the print job will emit (the effective CSV row count), so the contour
    // job can append an extra page cutting only the cards on a partially-filled last
    // sheet. `None` ⇒ single full-grid page (legacy).
    contour_total_cards: Option<u32>,
}

impl Default for JsOptions {
    fn default() -> Self {
        let base = Options::default();
        JsOptions {
            host_width_mm: base.host_width_mm,
            host_height_mm: base.host_height_mm,
            offset_x_mm: base.offset_x_mm,
            offset_y_mm: base.offset_y_mm,
            circle_diameter_mm: base.circle_diameter_mm,
            contour: base.contour,
            measure_paths: base.measure_paths,
            cutting_speed_mm_s: base.cutting_speed_mm_s,
            corner_penalty_s: base.corner_penalty_s,
            preparation_time_s: base.preparation_time_s,
            travel_speed_mm_s: base.travel_speed_mm_s,
            font_sizes: base.font_sizes,
            text_y_mm: base.text_y_mm,
            text_x_mm: base.text_x_mm,
            align: vec!["center".to_string()],
            combine: base.combine,
            debug: base.debug,
            safe_margin_mm: base.safe_margin_mm,
            text_colors: Vec::new(),
            text_blend_modes: Vec::new(),
            text_rotations: Vec::new(),
            text_flip_x: Vec::new(),
            text_flip_y: Vec::new(),
            text_backgrounds: Vec::new(),
            text_background_padding_mm: base.text_background_padding_mm,
            text_background_widths_mm: Vec::new(),
            text_background_alphas: Vec::new(),
            text_alphas: Vec::new(),
            text_background_blend_modes: Vec::new(),
            split_chars: base.split_chars,
            card_width_mm: None,
            card_height_mm: None,
            contour_as_grid: false,
            text_contours: Vec::new(),
            text_contour_widths_mm: Vec::new(),
            text_contour_blend_modes: Vec::new(),
            text_char_spacings_pt: Vec::new(),
            background_page_number: None,
            contour_page_number: None,
            background_rotation: 0,
            background_flip_x: false,
            background_flip_y: false,
            background_offset_x_mm: base.background_offset_x_mm,
            background_offset_y_mm: base.background_offset_y_mm,
            background_spin_deg: base.background_spin_deg,
            background_backdrop_color: String::new(),
            no_cut: false,
            contour_offset_x_mm: base.contour_offset_x_mm,
            contour_offset_y_mm: base.contour_offset_y_mm,
            contour_canvas_width_mm: None,
            contour_canvas_height_mm: None,
            contour_target_width_mm: None,
            contour_target_height_mm: None,
            contour_rotation: 0,
            contour_spin_deg: base.contour_spin_deg,
            contour_footprint_left_mm: None,
            contour_footprint_bottom_mm: None,
            contour_footprint_width_mm: None,
            contour_footprint_height_mm: None,
            contour_trim_to_path: base.contour_trim_to_path,
            minimal: false,
            minimal_width_mm: None,
            minimal_height_mm: None,
            contour_keep_region: Vec::new(),
            contour_keep_subpath_lens: Vec::new(),
            correct_overflow: base.correct_overflow,
            min_font_size_pt: base.min_font_size_pt,
            overflow_correction_by_column: base.overflow_correction_by_column,
            contour_inset_mm: base.contour_inset_mm,
            contour_align_left_mm: base.contour_align_left_mm,
            contour_align_width_mm: base.contour_align_width_mm,
            contour_total_cards: None,
        }
    }
}

// Rebuild the cut keep region from its flat wire form (a coordinate buffer plus a
// per-subpath vertex count) into closed polygons. Malformed input (lengths that
// overrun the buffer) yields an empty region, which safely disables the check.
fn rebuild_keep_polygons(coords: &[f32], lens: &[u32]) -> Vec<Vec<(f32, f32)>> {
    let mut polygons = Vec::with_capacity(lens.len());
    let mut i = 0usize;
    for &len in lens {
        let n = len as usize;
        let mut poly = Vec::with_capacity(n);
        for _ in 0..n {
            if i + 1 >= coords.len() {
                return Vec::new();
            }
            poly.push((coords[i], coords[i + 1]));
            i += 2;
        }
        if poly.len() >= 3 {
            polygons.push(poly);
        }
    }
    polygons
}

// Number of cards that fit on one host page for the given background page
// size and layout options, without building a PDF. The JS side uses this to
// size generation batches to whole pages (see web-preview's batched worker).
#[wasm_bindgen]
pub fn cards_per_page(background: &[u8], options: JsValue) -> Result<usize, JsError> {
    let js_opts: JsOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|e| JsError::new(&e.to_string()))?;

    let doc = Document::load_mem(background).map_err(|e| JsError::new(&e.to_string()))?;
    let pages = doc.get_pages();
    let page_num = js_opts.background_page_number.unwrap_or(1);
    let page_id = pages
        .get(&page_num)
        .copied()
        .or_else(|| pages.values().next().copied())
        .ok_or_else(|| JsError::new("No pages in background PDF"))?;
    let media_box = doc
        .get_dictionary(page_id)
        .and_then(|d| d.get(b"MediaBox"))
        .and_then(|o| o.as_array())
        .map_err(|e| JsError::new(&e.to_string()))?;
    let dim = |o: &Object| match o {
        Object::Integer(v) => *v as f32,
        Object::Real(v) => *v,
        _ => 0.0,
    };
    let orig_w = dim(&media_box[2]);
    let orig_h = dim(&media_box[3]);
    // Honour the caller's dimension override so batch sizes match what
    // generate_with_options will actually produce.
    let card_w = js_opts.card_width_mm.map(|mm| mm * crate::geometry::MM).unwrap_or(orig_w);
    let card_h = js_opts.card_height_mm.map(|mm| mm * crate::geometry::MM).unwrap_or(orig_h);

    // Only the layout fields affect the grid; the rest fall back to defaults.
    let opts = Options {
        host_width_mm: js_opts.host_width_mm,
        host_height_mm: js_opts.host_height_mm,
        offset_x_mm: js_opts.offset_x_mm,
        offset_y_mm: js_opts.offset_y_mm,
        circle_diameter_mm: js_opts.circle_diameter_mm,
        no_cut: js_opts.no_cut,
        ..Options::default()
    };
    Ok(CardLayout::compute(card_w, card_h, &opts).cards_per_page)
}

// JS-friendly entry point: takes the CSV/background/font data plus a
// single options object (camelCase keys, all optional) instead of a long
// positional argument list. See `generate` for the raw equivalent.
#[wasm_bindgen]
pub fn generate_with_options(
    csv_data: Option<String>,
    background: &[u8],
    contour_background: Option<Vec<u8>>,
    font_data: Vec<js_sys::Uint8Array>,
    options: JsValue,
) -> Result<WasmGenerateOutput, JsError> {
    let js_opts: JsOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|e| JsError::new(&e.to_string()))?;

    let align = js_opts.align.iter()
        .map(|s| s.parse::<TextAlign>())
        .collect::<Result<Vec<TextAlign>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_colors = js_opts.text_colors.iter()
        .map(|s| parse_color(s))
        .collect::<Result<Vec<TextColor>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_backgrounds = js_opts.text_backgrounds.iter()
        .map(|s| parse_color_or_none(s))
        .collect::<Result<Vec<Option<TextColor>>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_contour_colors = js_opts.text_contours.iter()
        .map(|s| parse_color_or_none(s))
        .collect::<Result<Vec<Option<TextColor>>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let background_backdrop_color = if js_opts.background_backdrop_color.trim().is_empty() {
        None
    } else {
        parse_color_or_none(&js_opts.background_backdrop_color).map_err(|e| JsError::new(&e))?
    };

    let text_background_blend_modes = js_opts.text_background_blend_modes.iter()
        .map(|s| s.parse::<BlendMode>())
        .collect::<Result<Vec<BlendMode>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_contour_blend_modes = js_opts.text_contour_blend_modes.iter()
        .map(|s| s.parse::<BlendMode>())
        .collect::<Result<Vec<BlendMode>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let text_blend_modes = js_opts.text_blend_modes.iter()
        .map(|s| s.parse::<BlendMode>())
        .collect::<Result<Vec<BlendMode>, String>>()
        .map_err(|e| JsError::new(&e))?;

    let opts = Options {
        host_width_mm: js_opts.host_width_mm,
        host_height_mm: js_opts.host_height_mm,
        offset_x_mm: js_opts.offset_x_mm,
        offset_y_mm: js_opts.offset_y_mm,
        circle_diameter_mm: js_opts.circle_diameter_mm,
        contour: js_opts.contour,
        measure_paths: js_opts.measure_paths,
        cutting_speed_mm_s: js_opts.cutting_speed_mm_s,
        corner_penalty_s: js_opts.corner_penalty_s,
        preparation_time_s: js_opts.preparation_time_s,
        travel_speed_mm_s: js_opts.travel_speed_mm_s,
        font_sizes: js_opts.font_sizes,
        text_y_mm: js_opts.text_y_mm,
        text_x_mm: js_opts.text_x_mm,
        font_data: font_data.iter().map(|u| u.to_vec()).collect(),
        align,
        text_colors,
        text_blend_modes,
        combine: js_opts.combine,
        debug: js_opts.debug,
        safe_margin_mm: js_opts.safe_margin_mm,
        text_rotations: js_opts.text_rotations,
        text_flip_x: js_opts.text_flip_x,
        text_flip_y: js_opts.text_flip_y,
        text_backgrounds,
        text_background_padding_mm: js_opts.text_background_padding_mm,
        text_background_widths_mm: js_opts.text_background_widths_mm,
        text_background_alphas: js_opts.text_background_alphas,
        text_alphas: js_opts.text_alphas,
        text_background_blend_modes,
        split_chars: js_opts.split_chars,
        card_width_mm: js_opts.card_width_mm,
        card_height_mm: js_opts.card_height_mm,
        contour_as_grid: js_opts.contour_as_grid,
        text_contour_colors,
        text_contour_widths_mm: js_opts.text_contour_widths_mm,
        text_contour_blend_modes,
        text_char_spacing_pt: js_opts.text_char_spacings_pt,
        background_page_number: js_opts.background_page_number.unwrap_or(1),
        contour_page_number: js_opts.contour_page_number.unwrap_or(1),
        background_rotation: js_opts.background_rotation,
        background_flip_x: js_opts.background_flip_x,
        background_flip_y: js_opts.background_flip_y,
        background_offset_x_mm: js_opts.background_offset_x_mm,
        background_offset_y_mm: js_opts.background_offset_y_mm,
        background_spin_deg: js_opts.background_spin_deg,
        background_backdrop_color,
        no_cut: js_opts.no_cut,
        contour_offset_x_mm: js_opts.contour_offset_x_mm,
        contour_offset_y_mm: js_opts.contour_offset_y_mm,
        contour_canvas_width_mm: js_opts.contour_canvas_width_mm,
        contour_canvas_height_mm: js_opts.contour_canvas_height_mm,
        contour_target_width_mm: js_opts.contour_target_width_mm,
        contour_target_height_mm: js_opts.contour_target_height_mm,
        contour_rotation: js_opts.contour_rotation,
        contour_spin_deg: js_opts.contour_spin_deg,
        contour_footprint_left_mm: js_opts.contour_footprint_left_mm,
        contour_footprint_bottom_mm: js_opts.contour_footprint_bottom_mm,
        contour_footprint_width_mm: js_opts.contour_footprint_width_mm,
        contour_footprint_height_mm: js_opts.contour_footprint_height_mm,
        contour_trim_to_path: js_opts.contour_trim_to_path,
        minimal: js_opts.minimal,
        minimal_width_mm: js_opts.minimal_width_mm,
        minimal_height_mm: js_opts.minimal_height_mm,
        contour_keep_polygons: rebuild_keep_polygons(
            &js_opts.contour_keep_region,
            &js_opts.contour_keep_subpath_lens,
        ),
        correct_overflow: js_opts.correct_overflow,
        min_font_size_pt: js_opts.min_font_size_pt,
        overflow_correction_by_column: js_opts.overflow_correction_by_column,
        contour_inset_mm: js_opts.contour_inset_mm,
        contour_align_left_mm: js_opts.contour_align_left_mm,
        contour_align_width_mm: js_opts.contour_align_width_mm,
        contour_total_cards: js_opts.contour_total_cards.map(|n| n as usize),
    };

    let out = generate_pdf(csv_data.as_deref(), background, contour_background.as_deref(), &opts)
        .map_err(|e| JsError::new(&e.to_string()))?;

    Ok(WasmGenerateOutput {
        pdf: out.pdf,
        cards_per_page: out.cards_per_page,
        path_length_per_card_mm: out.path_length_per_card_mm,
        path_length_total_mm: out.path_length_total_mm,
        node_count_per_card: out.node_count_per_card,
        node_count_total: out.node_count_total,
        sharp_turn_count_per_card: out.sharp_turn_count_per_card,
        sharp_turn_count_total: out.sharp_turn_count_total,
        time_cutting_per_card_s: out.time_cutting_per_card_s,
        time_cutting_total_s: out.time_cutting_total_s,
        text_overflow_count: out.text_overflow_count,
        text_overflow_samples: out.text_overflow_samples,
    })
}

// Generate a single-page PDF, sized `card_width_mm` x `card_height_mm`,
// containing a stroked outline of `shape` ("circle", "ellipse", "rectangle",
// "rounded-rectangle", "beveled-rectangle", or "heart"), inset by `inset_mm`
// from the card edges. `corner_radius_mm` is the corner radius for "rounded-rectangle"
// and the chamfer leg length for "beveled-rectangle". `corner_orientation`
// ("out" — the default — or "in") flips "rounded-rectangle"'s corners to curve
// inward. The ellipse fills the inset rectangle. Intended as a generated
// stand-in for a user-supplied contour background PDF.
#[wasm_bindgen]
pub fn generate_shape_pdf(
    card_width_mm: f32,
    card_height_mm: f32,
    shape: String,
    inset_mm: f32,
    corner_radius_mm: f32,
    corner_orientation: String,
    stroke_color: String,
    // Vertex count for "polygon" (ignored by the other shapes; clamped to ≥3).
    sides: u32,
    // Turn "polygon" into an N-pointed star (ignored by the other shapes).
    star: bool,
) -> Result<Vec<u8>, JsError> {
    let shape: ShapeKind = shape.parse().map_err(|e: String| JsError::new(&e))?;
    let corner_concave = match corner_orientation.as_str() {
        "in" => true,
        "out" | "" => false,
        other => return Err(JsError::new(&format!("unknown corner orientation \"{other}\" (expected in or out)"))),
    };
    // `stroke_color` is "#RRGGBB" or "c:m:y:k"; an empty string falls back to black.
    let stroke = if stroke_color.trim().is_empty() {
        crate::color::TextColor::Cmyk(0.0, 0.0, 0.0, 1.0)
    } else {
        crate::color::parse_color(&stroke_color).map_err(|e| JsError::new(&e))?
    };
    let card_w = card_width_mm * crate::geometry::MM;
    let card_h = card_height_mm * crate::geometry::MM;
    build_shape_pdf(card_w, card_h, shape, inset_mm, corner_radius_mm, corner_concave, stroke, sides, star)
        .map_err(|e| JsError::new(&e.to_string()))
}

// Generate a single-page cut PDF, sized `width_mm` x `height_mm`, that strokes the
// offset contour outline supplied as flattened closed polygons. `coords` is a flat
// [x0, y0, x1, y1, …] list in PDF points (y-up, already placed within the box) and
// `subpath_lens` gives each closed subpath's vertex count — the same packing the
// keep-region uses. `stroke_color` is "#RRGGBB" or "c:m:y:k" (empty ⇒ black).
// Backs the "Redesenează" contour offset (see contourOffset.ts): the offset outline
// is generated the same way for both contour sources, replacing the base contour.
#[wasm_bindgen]
pub fn generate_polygon_pdf(
    width_mm: f32,
    height_mm: f32,
    coords: Vec<f32>,
    subpath_lens: Vec<u32>,
    stroke_color: String,
) -> Result<Vec<u8>, JsError> {
    let stroke = if stroke_color.trim().is_empty() {
        crate::color::TextColor::Cmyk(0.0, 0.0, 0.0, 1.0)
    } else {
        crate::color::parse_color(&stroke_color).map_err(|e| JsError::new(&e))?
    };
    let polygons = rebuild_keep_polygons(&coords, &subpath_lens);
    if polygons.is_empty() {
        return Err(JsError::new("generate_polygon_pdf: no closed polygons"));
    }
    let width = width_mm * crate::geometry::MM;
    let height = height_mm * crate::geometry::MM;
    build_polygon_pdf(width, height, &polygons, stroke)
        .map_err(|e| JsError::new(&e.to_string()))
}

// Generate a single-page background PDF sized `card_width_mm` x
// `card_height_mm`. `color` is an optional fill ("#RRGGBB" or "c:m:y:k", or
// "none"/"-"/empty for a blank page). Intended as a generated stand-in for a
// user-supplied print background PDF.
#[wasm_bindgen]
pub fn generate_simple_background_pdf(
    card_width_mm: f32,
    card_height_mm: f32,
    color: String,
) -> Result<Vec<u8>, JsError> {
    let fill = if color.trim().is_empty() {
        None
    } else {
        parse_color_or_none(&color).map_err(|e| JsError::new(&e))?
    };
    let card_w = card_width_mm * crate::geometry::MM;
    let card_h = card_height_mm * crate::geometry::MM;
    build_simple_background_pdf(card_w, card_h, fill)
        .map_err(|e| JsError::new(&e.to_string()))
}

// Generate a single-page background PDF sized `card_width_mm` x
// `card_height_mm` from a raster image (`image_bytes`, a PNG or JPEG). The image
// is decoded and embedded losslessly, stretched to fill the card. Intended as a
// generated print background built from a user-supplied/created image (the
// "Crează fundal" feature); the result feeds the same pipeline as an uploaded
// background PDF.
#[wasm_bindgen]
pub fn generate_image_background_pdf(
    image_bytes: &[u8],
    card_width_mm: f32,
    card_height_mm: f32,
    // Mirror the image horizontally / vertically (baked into the generated PDF).
    flip_x: bool,
    flip_y: bool,
    // Solid backdrop composited under transparent pixels ("#RRGGBB" or "c:m:y:k").
    // Empty / "none" / "-" keeps transparency (embeds an /SMask instead).
    backdrop: String,
) -> Result<Vec<u8>, JsError> {
    if !(card_width_mm > 0.0) || !(card_height_mm > 0.0) {
        return Err(JsError::new("card dimensions must be positive"));
    }
    let backdrop = if backdrop.trim().is_empty() {
        None
    } else {
        parse_color_or_none(&backdrop).map_err(|e| JsError::new(&e))?
    }
    .map(|c| c.to_rgb8());
    let card_w = card_width_mm * crate::geometry::MM;
    let card_h = card_height_mm * crate::geometry::MM;
    build_image_background_pdf(image_bytes, card_w, card_h, flip_x, flip_y, backdrop)
        .map_err(|e| JsError::new(&e.to_string()))
}
