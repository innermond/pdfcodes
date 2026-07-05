use lopdf::{Document, Object, Dictionary, Stream, ObjectId, content::{Operation, Content}};
use csv::ReaderBuilder;
use ttf_parser::GlyphId;

use crate::align::TextAlign;
use crate::blend::BlendMode;
use crate::color::TextColor;
use crate::fonts::{EmbeddedFont, encode_text_gids};
use crate::geometry::{apply_matrix, region_contains_outline, word_transform, CardLayout, GlyphOutline, MM};
use crate::options::Options;

// Default character spacing (PDF `Tc`, in points) when `text_char_spacing_pt`
// doesn't specify a value for a word. Zero means glyphs use their natural
// advances with no extra tracking.
const DEFAULT_CHAR_SPACING_PT: f32 = 0.0;

// Tolerance (in PDF points, ~0.035 mm) for the text-overflow check, so float
// rounding doesn't flag text that exactly fills the available width.
const OVERFLOW_EPS_PT: f32 = 0.1;

// Rows whose codes don't fit the card / cut area — surfaced so the web app can warn
// and offer them as a downloadable CSV. Reported per *row* (not per field): a field
// may be a merge/unmerge that's hard to locate in the source data, so `count` is the
// number of overflowing rows and `samples` holds every *distinct* offending row (the
// whole row, fields joined by the separator; the web app truncates it for the inline
// warning).
#[derive(Default)]
pub(crate) struct OverflowReport {
    pub count: usize,
    pub samples: Vec<String>,
}

// Does a code's rendered glyph outline lie fully inside the cut contour's keep
// region? Builds each glyph's outline exactly as it is drawn — same ttf-parser
// face, same per-glyph advances + `Tc` spacing, same baseline (x, y) and the same
// rotation/flip `cm` transform (see `word_transform`) — then tests containment in
// card coordinates. Returns true when the whole code is safely inside the cut.
#[allow(clippy::too_many_arguments)]
fn code_fits_contour(
    face: &ttf_parser::Face,
    units_per_em: i32,
    font_size: f32,
    char_spacing: f32,
    text: &str,
    x: f32,
    y: f32,
    rotation_deg: f32,
    flip_x: bool,
    flip_y: bool,
    ascent: f32,
    descent: f32,
    keep: &[Vec<(f32, f32)>],
    // Inward safety margin (card points): the code must clear the cut by at least
    // this much, i.e. it's tested against the region eroded by `inset_pt`.
    inset_pt: f32,
) -> bool {
    let scale = font_size / units_per_em as f32;
    // The same flip/rotate pivot the draw path uses (word center).
    let text_width_for_center = {
        let mut w = 0.0f32;
        for ch in text.chars() {
            let gid = face.glyph_index(ch).unwrap_or(ttf_parser::GlyphId(0));
            let adv = face.glyph_hor_advance(gid).unwrap_or(0);
            w += (adv as f32 / units_per_em as f32) * font_size;
        }
        let n = text.chars().count() as f32;
        w + char_spacing * (n - 1.0).max(0.0)
    };
    let cx = x + text_width_for_center / 2.0;
    let cy = y + (ascent + descent) / 2.0;
    let matrix = word_transform(rotation_deg, flip_x, flip_y, cx, cy);

    // Pen advances glyph-by-glyph from the baseline origin, matching the width
    // calc and the PDF text layout.
    let mut pen_x = x;
    for ch in text.chars() {
        let gid = face.glyph_index(ch).unwrap_or(ttf_parser::GlyphId(0));
        let mut builder = GlyphOutline::new(scale, pen_x);
        // Outline coords are in font units; the builder scales/offsets them to
        // the baseline origin (y=0). Shift onto the actual baseline `y` after.
        if face.outline_glyph(gid, &mut builder).is_some() {
            let mut contours = builder.into_contours();
            for contour in contours.iter_mut() {
                for p in contour.iter_mut() {
                    p.1 += y;
                    if let Some(m) = &matrix {
                        *p = apply_matrix(m, *p);
                    }
                }
            }
            if !region_contains_outline(keep, &contours, inset_pt) {
                return false;
            }
        }
        let adv = face.glyph_hor_advance(gid).unwrap_or(0);
        pen_x += (adv as f32 / units_per_em as f32) * font_size + char_spacing;
    }
    true
}

// Step size (points) the overflow corrector lowers the font by when hunting for a
// size that fits. Small enough to look tight, coarse enough to bound the loop.
const CORRECT_STEP_PT: f32 = 0.5;

// Per-position layout inputs that don't depend on the font size, resolved once so
// the correction pre-pass and the render loop agree (each field falls back to a
// single shared entry, matching the per-word `len == 1 ? 0 : idx` rule elsewhere).
struct WordFit {
    align: TextAlign,
    char_spacing: f32,
    rotation_deg: f32,
    flip_x: bool,
    flip_y: bool,
    y: f32,
    configured_fs: f32,
    text_x_mm: Option<f32>,
}

fn resolve_word_fit(opts: &Options, y_positions: &[f32], idx: usize) -> WordFit {
    let pick = |len: usize| if len == 1 { 0 } else { idx };
    WordFit {
        align: opts.align[pick(opts.align.len())],
        char_spacing: if opts.text_char_spacing_pt.is_empty() {
            DEFAULT_CHAR_SPACING_PT
        } else {
            opts.text_char_spacing_pt[pick(opts.text_char_spacing_pt.len())]
        },
        rotation_deg: if opts.text_rotations.is_empty() {
            0.0
        } else {
            opts.text_rotations[pick(opts.text_rotations.len())]
        },
        flip_x: !opts.text_flip_x.is_empty() && opts.text_flip_x[pick(opts.text_flip_x.len())],
        flip_y: !opts.text_flip_y.is_empty() && opts.text_flip_y[pick(opts.text_flip_y.len())],
        y: y_positions[idx],
        configured_fs: opts.font_sizes[idx],
        text_x_mm: if opts.text_x_mm.is_empty() { None } else { Some(opts.text_x_mm[idx]) },
    }
}

// Σ (glyph advance / units_per_em) over the code's chars — the glyph run's width
// per point of font size (multiply by the font size to get the run width).
fn advance_sum_per_pt(face: &ttf_parser::Face, units_per_em: i32, text: &str) -> f32 {
    text.chars()
        .map(|ch| {
            let gid = face.glyph_index(ch).unwrap_or(GlyphId(0));
            face.glyph_hor_advance(gid).unwrap_or(0) as f32 / units_per_em as f32
        })
        .sum()
}

fn word_text_width(advance_per_pt: f32, char_spacing: f32, num_chars: f32, fs: f32) -> f32 {
    advance_per_pt * fs + char_spacing * (num_chars - 1.0).max(0.0)
}

// `contour` is the contour's horizontal frame in points (left edge, width) used by the
// `Contour*` alignments; card alignments ignore it. Every alignment is resolved from the
// code's real `text_width` here (per code), so a too-wide code re-anchors to the frame
// edge and overflows the *other* side instead of past the aligned edge.
fn resolve_x(
    align: TextAlign,
    text_x_mm: Option<f32>,
    card_w: f32,
    safe_margin: f32,
    text_width: f32,
    contour: (f32, f32),
    contour_inset: f32,
) -> f32 {
    match text_x_mm {
        // A finite explicit X wins (custom drag / a fixed position). A non-finite value
        // (NaN) is the web app's "defer to `align`" sentinel — sent per word so an
        // explicit X on one word doesn't force all of them (see the `textXMm` array in
        // options.ts). Card *and* contour alignments are then measured per code here.
        Some(x_mm) if x_mm.is_finite() => x_mm * MM,
        _ => {
            let (c_left, c_width) = contour;
            match align {
                TextAlign::Left => safe_margin,
                TextAlign::Center => (card_w - text_width) / 2.0,
                TextAlign::Right => card_w - text_width - safe_margin,
                TextAlign::ContourLeft => c_left + contour_inset,
                TextAlign::ContourCenter => c_left + (c_width - text_width) / 2.0,
                TextAlign::ContourRight => c_left + c_width - text_width - contour_inset,
            }
        }
    }
}

// The contour horizontal frame (left, width) in points from the options, falling back to
// the card (0, card_w) when no contour rectangle was supplied.
fn contour_frame(opts: &Options, card_w: f32) -> (f32, f32) {
    let left = opts.contour_align_left_mm.map(|v| v * MM).unwrap_or(0.0);
    let width = opts.contour_align_width_mm.map(|v| v * MM).unwrap_or(card_w);
    (left, width)
}

// Would this code overflow at font size `fs`? Same predicate as the render loop:
// contour containment when a cut is supplied, else the card/safe-margin extent.
#[allow(clippy::too_many_arguments)]
fn word_overflows(
    ef: &EmbeddedFont,
    fs: f32,
    advance_per_pt: f32,
    wf: &WordFit,
    num_chars: f32,
    text: &str,
    card_w: f32,
    safe_margin: f32,
    keep: &[Vec<(f32, f32)>],
    inset_pt: f32,
    contour: (f32, f32),
) -> bool {
    let text_width = word_text_width(advance_per_pt, wf.char_spacing, num_chars, fs);
    let x = resolve_x(wf.align, wf.text_x_mm, card_w, safe_margin, text_width, contour, inset_pt);
    if !keep.is_empty() {
        let ascent = (ef.face.ascender() as f32 / ef.units_per_em as f32) * fs;
        let descent = (ef.face.descender() as f32 / ef.units_per_em as f32) * fs;
        !code_fits_contour(
            &ef.face, ef.units_per_em, fs, wf.char_spacing, text,
            x, wf.y, wf.rotation_deg, wf.flip_x, wf.flip_y, ascent, descent, keep, inset_pt,
        )
    } else {
        let available_w = card_w - 2.0 * safe_margin;
        text_width > available_w + OVERFLOW_EPS_PT
            || x < safe_margin - OVERFLOW_EPS_PT
            || x + text_width > card_w - safe_margin + OVERFLOW_EPS_PT
    }
}

// Largest font size in [min_fs, configured] (stepping down by CORRECT_STEP_PT)
// at which the code fits; returns `min_fs` when even that overflows.
#[allow(clippy::too_many_arguments)]
fn max_fitting_fs(
    ef: &EmbeddedFont,
    configured: f32,
    min_fs: f32,
    advance_per_pt: f32,
    wf: &WordFit,
    num_chars: f32,
    text: &str,
    card_w: f32,
    safe_margin: f32,
    keep: &[Vec<(f32, f32)>],
    inset_pt: f32,
    contour: (f32, f32),
) -> f32 {
    let floor = min_fs.min(configured);
    let mut fs = configured;
    while fs > floor && word_overflows(ef, fs, advance_per_pt, wf, num_chars, text, card_w, safe_margin, keep, inset_pt, contour) {
        fs = (fs - CORRECT_STEP_PT).max(floor);
    }
    fs
}

// "Pe coloană" pre-pass: for each word position, the largest size at which *every*
// code in that position fits (clamped to [min, configured]). Codes that can't fit
// even at the minimum pull the column no lower than the minimum (they stay flagged
// at render). Positions beyond a record's word count are skipped.
fn compute_uniform_fs(
    records: &[csv::StringRecord],
    opts: &Options,
    embedded_fonts: &[EmbeddedFont],
    y_positions: &[f32],
    card_w: f32,
    safe_margin: f32,
) -> Vec<f32> {
    let n_pos = opts.font_sizes.len();
    let min_fs = opts.min_font_size_pt;
    let inset_pt = opts.contour_inset_mm * MM;
    let mut uniform = opts.font_sizes.clone();
    for record in records {
        for (idx, text) in record.iter().enumerate() {
            if idx >= n_pos || text.is_empty() {
                continue;
            }
            let wf = resolve_word_fit(opts, y_positions, idx);
            let font_idx = if embedded_fonts.len() == 1 { 0 } else { idx.min(embedded_fonts.len() - 1) };
            let ef = &embedded_fonts[font_idx];
            let advance_per_pt = advance_sum_per_pt(&ef.face, ef.units_per_em, text);
            let num_chars = text.chars().count() as f32;
            let fit = max_fitting_fs(
                ef, wf.configured_fs, min_fs, advance_per_pt, &wf, num_chars, text,
                card_w, safe_margin, &opts.contour_keep_polygons, inset_pt, contour_frame(opts, card_w),
            );
            if fit < uniform[idx] {
                uniform[idx] = fit;
            }
        }
    }
    uniform
}

// Build a Form XObject (background + label text) for each CSV row, returning
// the object IDs of the generated cards.
pub(crate) fn build_card_xobjects(
    doc: &mut Document,
    csv_data: &str,
    opts: &Options,
    embedded_fonts: &[EmbeddedFont],
    layout: &CardLayout,
    bg_form_id: ObjectId,
) -> Result<(Vec<ObjectId>, OverflowReport), Box<dyn std::error::Error>> {
    let card_w = layout.card_w;
    let card_box = layout.card_box.clone();
    let mut overflow = OverflowReport::default();
    let mut seen = std::collections::HashSet::new();

    // Rows are \n-separated; fields within a row are separated by split_chars
    // (any character, not necessarily the CSV standard comma).
    let sep = opts.split_chars.as_bytes().first().copied().unwrap_or(b' ');
    // Rows may legitimately hold different numbers of words/codes (e.g. an
    // uploaded CSV with ragged rows, or one row merged into a single field while
    // another wasn't). Each row is laid out independently below, so accept
    // varying field counts instead of erroring on the first mismatch.
    let mut rdr = ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(sep)
        .from_reader(csv_data.as_bytes());

    let y_positions: Vec<f32> = opts.text_y_mm.iter().map(|y| y * MM).collect();
    let safe_margin = opts.safe_margin_mm * MM;
    // Inward safety margin from the cut (card points); 0 tests against the true cut.
    let inset_pt = opts.contour_inset_mm * MM;

    // Collect the records so the "Corectare depășire" column pre-pass can scan
    // every code before rendering (harmless for the other paths).
    let records: Vec<csv::StringRecord> = rdr.records().collect::<Result<Vec<_>, _>>()?;

    // "Pe coloană": one uniform, all-codes-fit size per word position. "Pe cod"
    // shrinks each code individually in the render loop below.
    let uniform_fs: Option<Vec<f32>> = if opts.correct_overflow && opts.overflow_correction_by_column && !opts.skip_codes {
        Some(compute_uniform_fs(&records, opts, embedded_fonts, &y_positions, card_w, safe_margin))
    } else {
        None
    };

    let mut card_ids = Vec::new();
    for record in &records {
        // "Nu printa codurile" (skip_codes): treat every row as having no words —
        // the imposition (one card per CSV row) and the background cells stay
        // identical, but no code text is drawn and none of the per-word config
        // validation below applies.
        let texts: Vec<&str> = if opts.skip_codes { Vec::new() } else { record.iter().collect() };
        let txt = texts.join(std::str::from_utf8(&[sep]).unwrap_or(" "));

        if texts.len() > opts.font_sizes.len() || texts.len() > opts.text_y_mm.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} font size(s)/y-position(s) configured",
                txt, texts.len(), opts.font_sizes.len().min(opts.text_y_mm.len())
            ).into());
        }
        if embedded_fonts.len() > 1 && texts.len() > embedded_fonts.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} font(s) configured",
                txt, texts.len(), embedded_fonts.len()
            ).into());
        }
        if opts.align.len() > 1 && texts.len() > opts.align.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} alignment(s) configured",
                txt, texts.len(), opts.align.len()
            ).into());
        }
        if !opts.text_x_mm.is_empty() && texts.len() > opts.text_x_mm.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} x-position(s) configured",
                txt, texts.len(), opts.text_x_mm.len()
            ).into());
        }
        if opts.text_colors.len() > 1 && texts.len() > opts.text_colors.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} text color(s) configured",
                txt, texts.len(), opts.text_colors.len()
            ).into());
        }
        if opts.text_blend_modes.len() > 1 && texts.len() > opts.text_blend_modes.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} --text-blend-modes value(s) configured",
                txt, texts.len(), opts.text_blend_modes.len()
            ).into());
        }
        if opts.text_rotations.len() > 1 && texts.len() > opts.text_rotations.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} text rotation(s) configured",
                txt, texts.len(), opts.text_rotations.len()
            ).into());
        }
        if opts.text_flip_x.len() > 1 && texts.len() > opts.text_flip_x.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} --text-flip-x value(s) configured",
                txt, texts.len(), opts.text_flip_x.len()
            ).into());
        }
        if opts.text_flip_y.len() > 1 && texts.len() > opts.text_flip_y.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} --text-flip-y value(s) configured",
                txt, texts.len(), opts.text_flip_y.len()
            ).into());
        }
        if opts.text_backgrounds.len() > 1 && texts.len() > opts.text_backgrounds.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} --text-backgrounds value(s) configured",
                txt, texts.len(), opts.text_backgrounds.len()
            ).into());
        }
        if opts.text_background_widths_mm.len() > 1 && texts.len() > opts.text_background_widths_mm.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} --text-backgrounds-widths value(s) configured",
                txt, texts.len(), opts.text_background_widths_mm.len()
            ).into());
        }
        if opts.text_background_alphas.len() > 1 && texts.len() > opts.text_background_alphas.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} --text-backgrounds-alphas value(s) configured",
                txt, texts.len(), opts.text_background_alphas.len()
            ).into());
        }
        if opts.text_contour_colors.len() > 1 && texts.len() > opts.text_contour_colors.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} --text-contours value(s) configured",
                txt, texts.len(), opts.text_contour_colors.len()
            ).into());
        }
        if opts.text_contour_widths_mm.len() > 1 && texts.len() > opts.text_contour_widths_mm.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} --text-contour-widths value(s) configured",
                txt, texts.len(), opts.text_contour_widths_mm.len()
            ).into());
        }
        if opts.text_background_blend_modes.len() > 1 && texts.len() > opts.text_background_blend_modes.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} --text-backgrounds-blend-modes value(s) configured",
                txt, texts.len(), opts.text_background_blend_modes.len()
            ).into());
        }
        if opts.text_contour_blend_modes.len() > 1 && texts.len() > opts.text_contour_blend_modes.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} --text-contour-blend-modes value(s) configured",
                txt, texts.len(), opts.text_contour_blend_modes.len()
            ).into());
        }

        let mut operations = Vec::new();
        let mut ext_gstates: Vec<(String, Option<f32>, Option<BlendMode>)> = Vec::new();

        // Draw background XObject once per card, behind all words.
        operations.push(Operation::new("Do", vec![Object::Name(b"BG".to_vec())]));

        // Tracks whether any field on this row overflows: we report the *whole row*
        // (not the offending field) so the user can find it in their source data —
        // a field may be a merge/unmerge that doesn't appear verbatim there.
        let mut row_overflows = false;

        for (idx, text) in texts.iter().enumerate() {
            let wf = resolve_word_fit(opts, &y_positions, idx);
            let font_idx = if embedded_fonts.len() == 1 { 0 } else { idx };
            let ef = &embedded_fonts[font_idx];
            let align = wf.align;
            let char_spacing = wf.char_spacing;
            let rotation_deg = wf.rotation_deg;
            let flip_x = wf.flip_x;
            let flip_y = wf.flip_y;
            let y = wf.y;

            // Glyph-run width per point, so the size can be re-evaluated cheaply.
            let advance_per_pt = advance_sum_per_pt(&ef.face, ef.units_per_em, text);
            let num_chars = text.chars().count() as f32;

            // "Corectare depășire": render at a uniform per-column size (Pe
            // coloană), an individually shrunk size (Pe cod), or the configured
            // size when correction is off.
            let font_size = if let Some(uf) = &uniform_fs {
                uf[idx]
            } else if opts.correct_overflow {
                max_fitting_fs(
                    ef, wf.configured_fs, opts.min_font_size_pt, advance_per_pt, &wf,
                    num_chars, text, card_w, safe_margin, &opts.contour_keep_polygons, inset_pt, contour_frame(opts, card_w),
                )
            } else {
                wf.configured_fs
            };

            let text_width = word_text_width(advance_per_pt, char_spacing, num_chars, font_size);
            let x = resolve_x(align, wf.text_x_mm, card_w, safe_margin, text_width, contour_frame(opts, card_w), inset_pt);

            let color = if opts.text_colors.is_empty() {
                TextColor::Rgb(0.0, 0.0, 0.0)
            } else {
                let color_idx = if opts.text_colors.len() == 1 { 0 } else { idx };
                opts.text_colors[color_idx]
            };

            let ascent = (ef.face.ascender() as f32 / ef.units_per_em as f32) * font_size;
            let descent = (ef.face.descender() as f32 / ef.units_per_em as f32) * font_size;

            // Note if this field still doesn't fit at the (possibly corrected) size —
            // the cut contour when supplied, else the card/safe-margin extent. The row
            // is recorded once, after the loop.
            if word_overflows(ef, font_size, advance_per_pt, &wf, num_chars, text, card_w, safe_margin, &opts.contour_keep_polygons, inset_pt, contour_frame(opts, card_w)) {
                row_overflows = true;
            }
            let background = if opts.text_backgrounds.is_empty() {
                None
            } else {
                let bg_idx = if opts.text_backgrounds.len() == 1 { 0 } else { idx };
                opts.text_backgrounds[bg_idx]
            };
            let background_width = if opts.text_background_widths_mm.is_empty() {
                None
            } else {
                let width_idx = if opts.text_background_widths_mm.len() == 1 { 0 } else { idx };
                Some(opts.text_background_widths_mm[width_idx] * MM)
            };
            let background_alpha = if opts.text_background_alphas.is_empty() {
                1.0
            } else {
                let alpha_idx = if opts.text_background_alphas.len() == 1 { 0 } else { idx };
                opts.text_background_alphas[alpha_idx]
            };
            let text_alpha = if opts.text_alphas.is_empty() {
                1.0
            } else {
                let alpha_idx = if opts.text_alphas.len() == 1 { 0 } else { idx };
                opts.text_alphas[alpha_idx]
            };
            let contour_color = if opts.text_contour_colors.is_empty() {
                None
            } else {
                let contour_idx = if opts.text_contour_colors.len() == 1 { 0 } else { idx };
                opts.text_contour_colors[contour_idx]
            };
            let contour_width_mm = if opts.text_contour_widths_mm.is_empty() {
                0.25
            } else {
                let width_idx = if opts.text_contour_widths_mm.len() == 1 { 0 } else { idx };
                opts.text_contour_widths_mm[width_idx]
            };
            let background_blend_mode = if opts.text_background_blend_modes.is_empty() {
                BlendMode::Normal
            } else {
                let blend_idx = if opts.text_background_blend_modes.len() == 1 { 0 } else { idx };
                opts.text_background_blend_modes[blend_idx]
            };
            let text_blend_mode = if opts.text_blend_modes.is_empty() {
                BlendMode::Normal
            } else {
                let blend_idx = if opts.text_blend_modes.len() == 1 { 0 } else { idx };
                opts.text_blend_modes[blend_idx]
            };
            let contour_blend_mode = if opts.text_contour_blend_modes.is_empty() {
                BlendMode::Normal
            } else {
                let blend_idx = if opts.text_contour_blend_modes.len() == 1 { 0 } else { idx };
                opts.text_contour_blend_modes[blend_idx]
            };

            operations.push(Operation::new("q", vec![])); // save
            if rotation_deg != 0.0 || flip_x || flip_y {
                let cx = x + text_width / 2.0;
                let cy = y + (ascent + descent) / 2.0;
                let theta = rotation_deg.to_radians();
                let (sin, cos) = theta.sin_cos();
                let sx = if flip_x { -1.0 } else { 1.0 };
                let sy = if flip_y { -1.0 } else { 1.0 };
                // Combined matrix: translate to center, rotate, flip, translate back.
                let a = cos * sx;
                let b = sin * sx;
                let c = -sin * sy;
                let d = cos * sy;
                let e = cx - (a * cx + c * cy);
                let f = cy - (b * cx + d * cy);
                operations.push(Operation::new("cm", vec![
                    Object::Real(a), Object::Real(b), Object::Real(c), Object::Real(d),
                    Object::Real(e), Object::Real(f),
                ]));
            }

            if let Some(bg_color) = background {
                let pad = opts.text_background_padding_mm * MM;
                operations.push(Operation::new("q", vec![])); // save
                let alpha = if background_alpha < 1.0 { Some(background_alpha) } else { None };
                let blend = if background_blend_mode != BlendMode::Normal { Some(background_blend_mode) } else { None };
                if let Some(gs_name) = ext_gstate_name(&mut ext_gstates, alpha, blend) {
                    operations.push(Operation::new("gs", vec![Object::Name(gs_name.into_bytes())]));
                }
                match bg_color {
                    TextColor::Rgb(r, g, b) => {
                        operations.push(Operation::new("rg", vec![Object::Real(r), Object::Real(g), Object::Real(b)]));
                    }
                    TextColor::Cmyk(c, m, y, k) => {
                        operations.push(Operation::new("k", vec![Object::Real(c), Object::Real(m), Object::Real(y), Object::Real(k)]));
                    }
                }
                let (rect_x, rect_w) = match background_width {
                    Some(w) => (x + text_width / 2.0 - w / 2.0, w),
                    None => (x - pad, text_width + 2.0 * pad),
                };
                operations.push(Operation::new("re", vec![
                    Object::Real(rect_x), Object::Real(y + descent - pad),
                    Object::Real(rect_w), Object::Real((ascent - descent) + 2.0 * pad),
                ]));
                operations.push(Operation::new("f", vec![]));
                operations.push(Operation::new("Q", vec![])); // restore
            }

            operations.push(Operation::new("q", vec![])); // save
            let alpha = if text_alpha < 1.0 { Some(text_alpha) } else { None };
            let blend = if text_blend_mode != BlendMode::Normal { Some(text_blend_mode) } else { None };
            if let Some(gs_name) = ext_gstate_name(&mut ext_gstates, alpha, blend) {
                operations.push(Operation::new("gs", vec![Object::Name(gs_name.into_bytes())]));
            }
            match color {
                TextColor::Rgb(r, g, b) => {
                    operations.push(Operation::new("rg", vec![Object::Real(r), Object::Real(g), Object::Real(b)]));
                }
                TextColor::Cmyk(c, m, y, k) => {
                    operations.push(Operation::new("k", vec![Object::Real(c), Object::Real(m), Object::Real(y), Object::Real(k)]));
                }
            }
            // The Type0 font uses Identity-H, so text is written as 2-byte glyph
            // IDs (not UTF-8 bytes) — this is what makes diacritics render right.
            let gid_text = encode_text_gids(&ef.face, &text);
            operations.push(Operation::new("BT", vec![]));
            operations.push(Operation::new("Tf", vec![Object::Name(ef.resource_name.clone()), Object::Real(font_size)]));
            operations.push(Operation::new("Tc", vec![Object::Real(char_spacing)])); // character spacing
            operations.push(Operation::new("Tr", vec![Object::Integer(0)])); // fill only
            operations.push(Operation::new("Td", vec![Object::Real(x), Object::Real(y)]));
            operations.push(Operation::new("Tj", vec![Object::String(gid_text.clone(), lopdf::StringFormat::Hexadecimal)]));
            operations.push(Operation::new("ET", vec![]));
            operations.push(Operation::new("Q", vec![])); // restore

            // Stroke the glyph outlines as a separate pass, so the contour
            // can use its own blend mode independent of the fill above
            // (matching the web preview, which draws the contour as a
            // separate stroke-only <text> element).
            if let Some(stroke_color) = contour_color {
                operations.push(Operation::new("q", vec![])); // save
                let blend = if contour_blend_mode != BlendMode::Normal { Some(contour_blend_mode) } else { None };
                if let Some(gs_name) = ext_gstate_name(&mut ext_gstates, None, blend) {
                    operations.push(Operation::new("gs", vec![Object::Name(gs_name.into_bytes())]));
                }
                match stroke_color {
                    TextColor::Rgb(r, g, b) => {
                        operations.push(Operation::new("RG", vec![Object::Real(r), Object::Real(g), Object::Real(b)]));
                    }
                    TextColor::Cmyk(c, m, y, k) => {
                        operations.push(Operation::new("K", vec![Object::Real(c), Object::Real(m), Object::Real(y), Object::Real(k)]));
                    }
                }
                operations.push(Operation::new("w", vec![Object::Real(contour_width_mm * MM)]));
                operations.push(Operation::new("BT", vec![]));
                operations.push(Operation::new("Tf", vec![Object::Name(ef.resource_name.clone()), Object::Real(font_size)]));
                operations.push(Operation::new("Tc", vec![Object::Real(char_spacing)]));
                operations.push(Operation::new("Tr", vec![Object::Integer(1)])); // stroke only
                operations.push(Operation::new("Td", vec![Object::Real(x), Object::Real(y)]));
                operations.push(Operation::new("Tj", vec![Object::String(gid_text.clone(), lopdf::StringFormat::Hexadecimal)]));
                operations.push(Operation::new("ET", vec![]));
                operations.push(Operation::new("Q", vec![])); // restore
            }

            if opts.debug {
                operations.push(Operation::new("q", vec![])); // save
                operations.push(Operation::new("RG", vec![Object::Real(1.0), Object::Real(0.0), Object::Real(0.0)])); // red stroke
                operations.push(Operation::new("re", vec![
                    Object::Real(x), Object::Real(y + descent),
                    Object::Real(text_width), Object::Real(ascent - descent),
                ]));
                operations.push(Operation::new("S", vec![]));
                operations.push(Operation::new("Q", vec![])); // restore
            }

            operations.push(Operation::new("Q", vec![])); // restore (rotation)
        }

        // One overflowing row = one count + one CSV entry (the entire row), deduped
        // so a code repeated across rows isn't listed twice.
        if row_overflows {
            overflow.count += 1;
            if seen.insert(txt.clone()) {
                overflow.samples.push(txt.clone());
            }
        }

        let content = Content { operations };
        let content_data = content.encode()?;

        let mut card_dict = Dictionary::new();
        card_dict.set("Type", Object::Name(b"XObject".to_vec()));
        card_dict.set("Subtype", Object::Name(b"Form".to_vec()));
        card_dict.set("BBox", Object::Array(card_box.clone()));
        card_dict.set("Resources", Object::Dictionary({
            let mut res = Dictionary::new();
            res.set("Font", Object::Dictionary({
                let mut fonts = Dictionary::new();
                for f in embedded_fonts {
                    fonts.set(f.resource_name.clone(), Object::Reference(f.font_id));
                }
                fonts
            }));
            res.set("XObject", Object::Dictionary({
                let mut xobjs = Dictionary::new();
                xobjs.set("BG", Object::Reference(bg_form_id));
                xobjs
            }));
            if !ext_gstates.is_empty() {
                res.set("ExtGState", Object::Dictionary({
                    let mut gstates = Dictionary::new();
                    for (name, alpha, blend) in &ext_gstates {
                        gstates.set(name.clone(), Object::Dictionary({
                            let mut gs = Dictionary::new();
                            gs.set("Type", Object::Name(b"ExtGState".to_vec()));
                            if let Some(alpha) = alpha {
                                gs.set("ca", Object::Real(*alpha));
                            }
                            if let Some(blend) = blend {
                                gs.set("BM", Object::Name(blend.pdf_name().as_bytes().to_vec()));
                            }
                            gs
                        }));
                    }
                    gstates
                }));
            }
            res
        }));

        let card_form = Stream::new(card_dict, content_data);
        let card_id = doc.add_object(card_form);
        card_ids.push(card_id);
    }

    Ok((card_ids, overflow))
}

// Find or create an ExtGState resource with the given alpha/blend mode
// combination, returning its resource name. Returns `None` (no `gs`
// operator needed) when both are at their defaults (full opacity, Normal
// blend mode).
fn ext_gstate_name(
    ext_gstates: &mut Vec<(String, Option<f32>, Option<BlendMode>)>,
    alpha: Option<f32>,
    blend: Option<BlendMode>,
) -> Option<String> {
    if alpha.is_none() && blend.is_none() {
        return None;
    }
    if let Some((name, _, _)) = ext_gstates.iter().find(|(_, a, b)| match (a, alpha) {
        (Some(a), Some(alpha)) => (*a - alpha).abs() < 1e-6,
        (None, None) => true,
        _ => false,
    } && *b == blend) {
        return Some(name.clone());
    }
    let name = format!("GS{}", ext_gstates.len());
    ext_gstates.push((name.clone(), alpha, blend));
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ttf_parser::Face;

    static FONT: &[u8] = include_bytes!("../assets/fonts/Montserrat-Bold.ttf");

    fn font() -> EmbeddedFont<'static> {
        let face = Face::parse(FONT, 0).unwrap();
        let units_per_em = face.units_per_em() as i32;
        EmbeddedFont { face, units_per_em, font_id: (1, 0), resource_name: b"F1".to_vec() }
    }

    fn centered_fit(configured_fs: f32) -> WordFit {
        WordFit {
            align: TextAlign::Center,
            char_spacing: 0.0,
            rotation_deg: 0.0,
            flip_x: false,
            flip_y: false,
            y: 5.0,
            configured_fs,
            text_x_mm: None,
        }
    }

    #[test]
    fn resolve_x_uses_finite_explicit_but_falls_back_to_align_on_nan() {
        let no_contour = (0.0, 0.0);
        // Finite explicit X wins, in points.
        assert_eq!(resolve_x(TextAlign::Center, Some(10.0), 100.0, 2.0, 20.0, no_contour, 0.0), 10.0 * MM);
        // NaN is the "defer to align" sentinel → same as None (here: centered).
        let centered = resolve_x(TextAlign::Center, None, 100.0, 2.0, 20.0, no_contour, 0.0);
        assert_eq!(resolve_x(TextAlign::Center, Some(f32::NAN), 100.0, 2.0, 20.0, no_contour, 0.0), centered);
        assert_eq!(centered, (100.0 - 20.0) / 2.0);
        // NaN + left/right still resolve against the card + margin.
        assert_eq!(resolve_x(TextAlign::Left, Some(f32::NAN), 100.0, 2.0, 20.0, no_contour, 0.0), 2.0);
        assert_eq!(resolve_x(TextAlign::Right, Some(f32::NAN), 100.0, 2.0, 20.0, no_contour, 0.0), 100.0 - 20.0 - 2.0);
    }

    #[test]
    fn resolve_x_contour_variants_anchor_to_the_contour_frame_per_code() {
        // Contour frame: left=30, width=40 (right edge = 70); inset = 3.
        let contour = (30.0, 40.0);
        let inset = 3.0;
        // Right edge of a narrow code (width 10) sits at 70 − inset → x = 30+40−10−3 = 57.
        assert_eq!(resolve_x(TextAlign::ContourRight, None, 100.0, 2.0, 10.0, contour, inset), 57.0);
        // Left is width-independent: x = 30 + inset = 33.
        assert_eq!(resolve_x(TextAlign::ContourLeft, None, 100.0, 2.0, 10.0, contour, inset), 33.0);
        // Center: x = 30 + (40−10)/2 = 45.
        assert_eq!(resolve_x(TextAlign::ContourCenter, None, 100.0, 2.0, 10.0, contour, inset), 45.0);
        // Worst case: a code wider than the frame re-anchors left (x < contour left) while
        // its right edge stays at 70 − inset — never past the contour's right edge.
        let wide = 60.0;
        let x = resolve_x(TextAlign::ContourRight, None, 100.0, 2.0, wide, contour, inset);
        assert!(x < 30.0, "wide code overflows left, got x={x}");
        assert_eq!(x + wide, 30.0 + 40.0 - inset, "right edge stays anchored to the contour edge minus inset");
    }

    #[test]
    fn max_fitting_fs_keeps_the_configured_size_when_it_already_fits() {
        let ef = font();
        let wf = centered_fit(12.0);
        let adv = advance_sum_per_pt(&ef.face, ef.units_per_em, "AB");
        // A very wide card: nothing needs shrinking.
        let fs = max_fitting_fs(&ef, 12.0, 6.0, adv, &wf, 2.0, "AB", 1000.0, 0.0, &[], 0.0, (0.0, 0.0));
        assert_eq!(fs, 12.0);
    }

    #[test]
    fn max_fitting_fs_shrinks_to_fit_and_bottoms_out_at_the_minimum() {
        let ef = font();
        let text = "WWWWWWWWWW";
        let wf = centered_fit(40.0);
        let adv = advance_sum_per_pt(&ef.face, ef.units_per_em, text);
        let num = text.chars().count() as f32;
        let card_w = 40.0 * MM; // narrow: 40pt text won't fit

        let fs = max_fitting_fs(&ef, 40.0, 6.0, adv, &wf, num, text, card_w, 0.0, &[], 0.0, (0.0, 0.0));
        assert!(fs < 40.0 && fs >= 6.0, "should shrink into range, got {fs}");
        assert!(!word_overflows(&ef, fs, adv, &wf, num, text, card_w, 0.0, &[], 0.0, (0.0, 0.0)), "shrunk size must fit");

        // A high floor prevents shrinking enough — it stops at the minimum.
        let fs2 = max_fitting_fs(&ef, 40.0, 39.0, adv, &wf, num, text, card_w, 0.0, &[], 0.0, (0.0, 0.0));
        assert_eq!(fs2, 39.0);
    }

    #[test]
    fn compute_uniform_fs_is_driven_by_the_widest_code_in_the_column() {
        let ef = vec![font()];
        let records = vec![
            csv::StringRecord::from(vec!["I"]),
            csv::StringRecord::from(vec!["WWWWWWWWWW"]),
        ];
        let opts = Options {
            font_sizes: vec![40.0],
            text_y_mm: vec![5.0],
            align: vec![TextAlign::Center],
            min_font_size_pt: 6.0,
            correct_overflow: true,
            overflow_correction_by_column: true,
            ..Options::default()
        };
        let y_positions = vec![5.0 * MM];
        let card_w = 40.0 * MM;

        let uniform = compute_uniform_fs(&records, &opts, &ef, &y_positions, card_w, 0.0);
        assert!(uniform[0] < 40.0 && uniform[0] >= 6.0, "column shrinks, got {}", uniform[0]);
        // The uniform size fits every code in the column, including the narrow one.
        for text in ["I", "WWWWWWWWWW"] {
            let wf = resolve_word_fit(&opts, &y_positions, 0);
            let adv = advance_sum_per_pt(&ef[0].face, ef[0].units_per_em, text);
            let num = text.chars().count() as f32;
            assert!(
                !word_overflows(&ef[0], uniform[0], adv, &wf, num, text, card_w, 0.0, &[], 0.0, (0.0, 0.0)),
                "uniform size must fit {text}",
            );
        }
    }
}
