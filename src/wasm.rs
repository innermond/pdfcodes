use wasm_bindgen::prelude::*;

use crate::align::TextAlign;
use crate::color::{parse_color, parse_color_or_none, TextColor};
use crate::generate::generate_pdf;
use crate::options::Options;

// Result of a wasm `generate` call: the PDF bytes plus, for contour
// pages, the stroked-path measurements (when `measure_paths` is set).
#[wasm_bindgen]
pub struct WasmGenerateOutput {
    pdf: Vec<u8>,
    cards_per_page: usize,
    path_length_per_card_mm: Option<f32>,
    path_length_total_mm: Option<f32>,
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
    text_rotations: Vec<f32>,
    text_flip_x: Vec<u8>,
    text_flip_y: Vec<u8>,
    text_backgrounds: Vec<String>,
    text_background_padding_mm: f32,
    text_background_widths_mm: Vec<f32>,
    text_background_alphas: Vec<f32>,
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

    let opts = Options {
        host_width_mm,
        host_height_mm,
        offset_x_mm,
        offset_y_mm,
        circle_diameter_mm,
        contour,
        measure_paths,
        font_sizes,
        text_y_mm,
        text_x_mm,
        font_data: font_data.iter().map(|u| u.to_vec()).collect(),
        align,
        text_colors,
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
    };

    let out = generate_pdf(csv_data.as_deref(), background, contour_background.as_deref(), &opts)
        .map_err(|e| JsError::new(&e.to_string()))?;

    Ok(WasmGenerateOutput {
        pdf: out.pdf,
        cards_per_page: out.cards_per_page,
        path_length_per_card_mm: out.path_length_per_card_mm,
        path_length_total_mm: out.path_length_total_mm,
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
    font_sizes: Vec<f32>,
    text_y_mm: Vec<f32>,
    text_x_mm: Vec<f32>,
    align: Vec<String>,
    combine: bool,
    debug: bool,
    safe_margin_mm: f32,
    text_colors: Vec<String>,
    text_rotations: Vec<f32>,
    text_flip_x: Vec<bool>,
    text_flip_y: Vec<bool>,
    text_backgrounds: Vec<String>,
    text_background_padding_mm: f32,
    text_background_widths_mm: Vec<f32>,
    text_background_alphas: Vec<f32>,
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
            font_sizes: base.font_sizes,
            text_y_mm: base.text_y_mm,
            text_x_mm: base.text_x_mm,
            align: vec!["center".to_string()],
            combine: base.combine,
            debug: base.debug,
            safe_margin_mm: base.safe_margin_mm,
            text_colors: Vec::new(),
            text_rotations: Vec::new(),
            text_flip_x: Vec::new(),
            text_flip_y: Vec::new(),
            text_backgrounds: Vec::new(),
            text_background_padding_mm: base.text_background_padding_mm,
            text_background_widths_mm: Vec::new(),
            text_background_alphas: Vec::new(),
        }
    }
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

    let opts = Options {
        host_width_mm: js_opts.host_width_mm,
        host_height_mm: js_opts.host_height_mm,
        offset_x_mm: js_opts.offset_x_mm,
        offset_y_mm: js_opts.offset_y_mm,
        circle_diameter_mm: js_opts.circle_diameter_mm,
        contour: js_opts.contour,
        measure_paths: js_opts.measure_paths,
        font_sizes: js_opts.font_sizes,
        text_y_mm: js_opts.text_y_mm,
        text_x_mm: js_opts.text_x_mm,
        font_data: font_data.iter().map(|u| u.to_vec()).collect(),
        align,
        text_colors,
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
    };

    let out = generate_pdf(csv_data.as_deref(), background, contour_background.as_deref(), &opts)
        .map_err(|e| JsError::new(&e.to_string()))?;

    Ok(WasmGenerateOutput {
        pdf: out.pdf,
        cards_per_page: out.cards_per_page,
        path_length_per_card_mm: out.path_length_per_card_mm,
        path_length_total_mm: out.path_length_total_mm,
    })
}
