use lopdf::{Document, Object, Dictionary, Stream, ObjectId, content::{Operation, Content}};
use csv::ReaderBuilder;
use ttf_parser::GlyphId;

use crate::align::TextAlign;
use crate::blend::BlendMode;
use crate::color::TextColor;
use crate::fonts::{EmbeddedFont, encode_text_gids};
use crate::generate::qr::{qr_matrix_bits, qr_payload, qr_rect_operations};
use crate::geometry::{apply_matrix, region_contains_outline, word_transform, CardLayout, GlyphOutline, MM};
use crate::options::Options;
use crate::qr::QrEcc;

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
    // Rows holding a QR whose payload is too long to encode at any version/ECC. The
    // QR is skipped rather than failing the whole job, so these are reported the same
    // way as overflows: `qr_failure_count` counts the rows, `qr_failures` holds every
    // distinct one.
    pub qr_failure_count: usize,
    pub qr_failures: Vec<String>,
}

// The rectangle a code occupies relative to its anchor point: `width` across,
// `ascent` above and `descent` below (negative, like a font's descender). Text
// fills it from the font's line metrics; a QR is a square sitting entirely above
// its anchor (`ascent` = the side, `descent` = 0). Placement and the overflow
// check work off this box alone, so both kinds of code share them.
#[derive(Clone, Copy)]
struct WordBox {
    width: f32,
    ascent: f32,
    descent: f32,
}

// A per-word array entry under the shared broadcast rule: a single entry applies to
// every word, an empty array means "unset" (the caller's default), anything else is
// indexed by position. Returns `None` rather than panicking on a short array — the
// row validation in `build_card_xobjects` reports that mismatch properly.
fn pick_word<T: Copy>(values: &[T], idx: usize) -> Option<T> {
    match values.len() {
        0 => None,
        1 => Some(values[0]),
        _ => values.get(idx).copied(),
    }
}

// `pick_word` for arrays whose element isn't `Copy`.
fn pick_word_ref<T>(values: &[T], idx: usize) -> Option<&T> {
    match values.len() {
        0 => None,
        1 => Some(&values[0]),
        _ => values.get(idx),
    }
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

// Does a QR's square lie fully inside the cut contour's keep region? A QR is a
// filled square, so its four corners — put through the same rotation/flip transform
// the draw path uses (see `word_transform`) — describe its entire footprint, where
// text needs every glyph outline.
#[allow(clippy::too_many_arguments)]
fn qr_fits_contour(
    size_pt: f32,
    x: f32,
    y: f32,
    rotation_deg: f32,
    flip_x: bool,
    flip_y: bool,
    keep: &[Vec<(f32, f32)>],
    inset_pt: f32,
) -> bool {
    let matrix = word_transform(rotation_deg, flip_x, flip_y, x + size_pt / 2.0, y + size_pt / 2.0);
    let mut corners = vec![
        (x, y),
        (x + size_pt, y),
        (x + size_pt, y + size_pt),
        (x, y + size_pt),
    ];
    if let Some(m) = &matrix {
        for p in corners.iter_mut() {
            *p = apply_matrix(m, *p);
        }
    }
    region_contains_outline(keep, std::slice::from_ref(&corners), inset_pt)
}

// Step size (points) the overflow corrector lowers the font by when hunting for a
// size that fits. Small enough to look tight, coarse enough to bound the loop.
const CORRECT_STEP_PT: f32 = 0.5;

// Smallest module a QR may print at and still scan reliably — the usual print rule
// of thumb. It floors the overflow corrector in place of `min_font_size_pt`, which
// is a type size and means nothing for a symbol: shrinking a QR past this point
// yields something that fits the cut but no scanner can read.
const QR_MIN_MODULE_MM: f32 = 0.5;

// Per-position layout inputs that don't depend on the font size, resolved once so
// the correction pre-pass and the render loop agree (each field falls back to a
// single shared entry, matching the per-word `len == 1 ? 0 : idx` rule elsewhere).
struct WordFit<'a> {
    align: TextAlign,
    char_spacing: f32,
    rotation_deg: f32,
    flip_x: bool,
    flip_y: bool,
    y: f32,
    configured_fs: f32,
    text_x_mm: Option<f32>,
    // > 0 turns this position into a QR of that side (mm) instead of a glyph run;
    // the two fields below then describe the symbol. See src/generate/qr.rs.
    qr_size_mm: f32,
    qr_ecc: QrEcc,
    qr_template: &'a str,
}

fn resolve_word_fit<'a>(opts: &'a Options, y_positions: &[f32], idx: usize) -> WordFit<'a> {
    let pick = |len: usize| if len == 1 { 0 } else { idx };
    WordFit {
        qr_size_mm: pick_word(&opts.qr_sizes_mm, idx).unwrap_or(0.0),
        qr_ecc: pick_word(&opts.qr_ecc, idx).unwrap_or_default(),
        qr_template: pick_word_ref(&opts.qr_templates, idx).map(String::as_str).unwrap_or(""),
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

// The legacy card-confinement check, used when no cut contour was supplied: does the
// code's box stay within the card's safe margin? Horizontal only, as it always has
// been — the vertical position is the user's to place. Shared by text and QR.
fn box_overflows_card(x: f32, b: WordBox, card_w: f32, safe_margin: f32) -> bool {
    let available_w = card_w - 2.0 * safe_margin;
    b.width > available_w + OVERFLOW_EPS_PT
        || x < safe_margin - OVERFLOW_EPS_PT
        || x + b.width > card_w - safe_margin + OVERFLOW_EPS_PT
}

// Would this code overflow at font size `fs`? Same predicate as the render loop:
// contour containment when a cut is supplied, else the card/safe-margin extent.
#[allow(clippy::too_many_arguments)]
fn word_overflows(
    ef: &EmbeddedFont,
    fs: f32,
    advance_per_pt: f32,
    wf: &WordFit<'_>,
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
        box_overflows_card(x, WordBox { width: text_width, ascent: 0.0, descent: 0.0 }, card_w, safe_margin)
    }
}

// `word_overflows` for a QR: the same two branches, measured against the square.
fn qr_overflows(
    size_pt: f32,
    wf: &WordFit<'_>,
    card_w: f32,
    safe_margin: f32,
    keep: &[Vec<(f32, f32)>],
    inset_pt: f32,
    contour: (f32, f32),
) -> bool {
    let x = resolve_x(wf.align, wf.text_x_mm, card_w, safe_margin, size_pt, contour, inset_pt);
    if !keep.is_empty() {
        !qr_fits_contour(size_pt, x, wf.y, wf.rotation_deg, wf.flip_x, wf.flip_y, keep, inset_pt)
    } else {
        box_overflows_card(x, qr_box(size_pt), card_w, safe_margin)
    }
}

// The square a QR of side `size_pt` occupies: it sits entirely above its anchor, so
// the anchor `y` is the symbol's bottom edge rather than a text baseline.
fn qr_box(size_pt: f32) -> WordBox {
    WordBox { width: size_pt, ascent: size_pt, descent: 0.0 }
}

// Largest square side in points (stepping down by CORRECT_STEP_PT) at which the QR
// fits. `modules_total` is the symbol's module count including the quiet zone, which
// sets the floor: never shrink a module below `QR_MIN_MODULE_MM`.
#[allow(clippy::too_many_arguments)]
fn max_fitting_qr_pt(
    configured_pt: f32,
    modules_total: usize,
    wf: &WordFit<'_>,
    card_w: f32,
    safe_margin: f32,
    keep: &[Vec<(f32, f32)>],
    inset_pt: f32,
    contour: (f32, f32),
) -> f32 {
    let floor = (QR_MIN_MODULE_MM * MM * modules_total as f32).min(configured_pt);
    let mut size = configured_pt;
    while size > floor && qr_overflows(size, wf, card_w, safe_margin, keep, inset_pt, contour) {
        size = (size - CORRECT_STEP_PT).max(floor);
    }
    size
}

// Largest font size in [min_fs, configured] (stepping down by CORRECT_STEP_PT)
// at which the code fits; returns `min_fs` when even that overflows.
#[allow(clippy::too_many_arguments)]
fn max_fitting_fs(
    ef: &EmbeddedFont,
    configured: f32,
    min_fs: f32,
    advance_per_pt: f32,
    wf: &WordFit<'_>,
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
//
// The returned size is in points either way: a font size for a text position, the
// square's side for a QR position (which has no font size to speak of).
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
    let quiet = opts.qr_quiet_modules as usize;
    let mut uniform: Vec<f32> = (0..n_pos)
        .map(|idx| {
            let wf = resolve_word_fit(opts, y_positions, idx);
            if wf.qr_size_mm > 0.0 { wf.qr_size_mm * MM } else { wf.configured_fs }
        })
        .collect();
    for record in records {
        for (idx, text) in record.iter().enumerate() {
            if idx >= n_pos || text.is_empty() {
                continue;
            }
            let wf = resolve_word_fit(opts, y_positions, idx);
            let fit = if wf.qr_size_mm > 0.0 {
                // A payload too long to encode is reported at render time; it must
                // not drag the whole column's size down here.
                let Ok((n, _)) = qr_matrix_bits(&qr_payload(wf.qr_template, text), wf.qr_ecc) else {
                    continue;
                };
                max_fitting_qr_pt(
                    wf.qr_size_mm * MM, n + 2 * quiet, &wf,
                    card_w, safe_margin, &opts.contour_keep_polygons, inset_pt, contour_frame(opts, card_w),
                )
            } else {
                let font_idx = if embedded_fonts.len() == 1 { 0 } else { idx.min(embedded_fonts.len() - 1) };
                let ef = &embedded_fonts[font_idx];
                let advance_per_pt = advance_sum_per_pt(&ef.face, ef.units_per_em, text);
                let num_chars = text.chars().count() as f32;
                max_fitting_fs(
                    ef, wf.configured_fs, min_fs, advance_per_pt, &wf, num_chars, text,
                    card_w, safe_margin, &opts.contour_keep_polygons, inset_pt, contour_frame(opts, card_w),
                )
            };
            if fit < uniform[idx] {
                uniform[idx] = fit;
            }
        }
    }
    uniform
}

// Push the per-word rotate/flip transform about the box's center, if the word has
// one. Uses the same `word_transform` matrix the contour fit-check applies, so what
// is drawn and what is tested against the cut can never diverge.
fn push_word_transform(ops: &mut Vec<Operation>, rotation_deg: f32, flip_x: bool, flip_y: bool, cx: f32, cy: f32) {
    if let Some([a, b, c, d, e, f]) = word_transform(rotation_deg, flip_x, flip_y, cx, cy) {
        ops.push(Operation::new("cm", vec![
            Object::Real(a), Object::Real(b), Object::Real(c),
            Object::Real(d), Object::Real(e), Object::Real(f),
        ]));
    }
}

// Push the filled rectangle drawn behind a code, sized to its box (plus padding) or
// to an explicit width centered on it. Shared by text and QR: for a QR the box is
// the module square, so the rectangle frames the symbol and its quiet zone — which
// is what makes a QR readable over artwork.
#[allow(clippy::too_many_arguments)]
fn push_code_background(
    ops: &mut Vec<Operation>,
    ext_gstates: &mut Vec<(String, Option<f32>, Option<BlendMode>)>,
    color: TextColor,
    alpha: f32,
    blend: BlendMode,
    x: f32,
    y: f32,
    b: WordBox,
    explicit_width: Option<f32>,
    pad: f32,
) {
    ops.push(Operation::new("q", vec![])); // save
    let alpha = if alpha < 1.0 { Some(alpha) } else { None };
    let blend = if blend != BlendMode::Normal { Some(blend) } else { None };
    if let Some(gs_name) = ext_gstate_name(ext_gstates, alpha, blend) {
        ops.push(Operation::new("gs", vec![Object::Name(gs_name.into_bytes())]));
    }
    push_fill_color(ops, color);
    let (rect_x, rect_w) = match explicit_width {
        Some(w) => (x + b.width / 2.0 - w / 2.0, w),
        None => (x - pad, b.width + 2.0 * pad),
    };
    ops.push(Operation::new("re", vec![
        Object::Real(rect_x), Object::Real(y + b.descent - pad),
        Object::Real(rect_w), Object::Real((b.ascent - b.descent) + 2.0 * pad),
    ]));
    ops.push(Operation::new("f", vec![]));
    ops.push(Operation::new("Q", vec![])); // restore
}

// Set the non-stroking color, in the color space the value was given in.
fn push_fill_color(ops: &mut Vec<Operation>, color: TextColor) {
    match color {
        TextColor::Rgb(r, g, b) => {
            ops.push(Operation::new("rg", vec![Object::Real(r), Object::Real(g), Object::Real(b)]));
        }
        TextColor::Cmyk(c, m, y, k) => {
            ops.push(Operation::new("k", vec![Object::Real(c), Object::Real(m), Object::Real(y), Object::Real(k)]));
        }
    }
}

// Outline a code's box in red for `--debug`.
fn push_debug_box(ops: &mut Vec<Operation>, x: f32, y: f32, b: WordBox) {
    ops.push(Operation::new("q", vec![])); // save
    ops.push(Operation::new("RG", vec![Object::Real(1.0), Object::Real(0.0), Object::Real(0.0)])); // red stroke
    ops.push(Operation::new("re", vec![
        Object::Real(x), Object::Real(y + b.descent),
        Object::Real(b.width), Object::Real(b.ascent - b.descent),
    ]));
    ops.push(Operation::new("S", vec![]));
    ops.push(Operation::new("Q", vec![])); // restore
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
    let mut qr_seen = std::collections::HashSet::new();

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
        if opts.qr_sizes_mm.len() > 1 && texts.len() > opts.qr_sizes_mm.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} QR size(s) configured",
                txt, texts.len(), opts.qr_sizes_mm.len()
            ).into());
        }
        if opts.qr_ecc.len() > 1 && texts.len() > opts.qr_ecc.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} QR error-correction level(s) configured",
                txt, texts.len(), opts.qr_ecc.len()
            ).into());
        }
        if opts.qr_templates.len() > 1 && texts.len() > opts.qr_templates.len() {
            return Err(format!(
                "CSV row {:?} has {} word(s), but only {} QR payload template(s) configured",
                txt, texts.len(), opts.qr_templates.len()
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
        // Likewise for a QR whose payload is too long to encode: the symbol is left
        // out and the row reported, so one bad row can't sink the whole job.
        let mut row_qr_failed = false;

        for (idx, text) in texts.iter().enumerate() {
            let wf = resolve_word_fit(opts, &y_positions, idx);
            let align = wf.align;
            let char_spacing = wf.char_spacing;
            let rotation_deg = wf.rotation_deg;
            let flip_x = wf.flip_x;
            let flip_y = wf.flip_y;
            let y = wf.y;

            // Styling that depends on the word's position alone, resolved before the
            // text/QR split below because both composite identically: a QR takes its
            // module color, opacity, blend mode and background rectangle from exactly
            // the fields the text it replaces would have used.
            let color = if opts.text_colors.is_empty() {
                TextColor::Rgb(0.0, 0.0, 0.0)
            } else {
                let color_idx = if opts.text_colors.len() == 1 { 0 } else { idx };
                opts.text_colors[color_idx]
            };

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


            // A QR position replaces the glyph run with a square of modules. It reuses
            // every placement input above but needs no font, so it branches before the
            // font lookup — a QR-only position never forces a font upload.
            if wf.qr_size_mm > 0.0 {
                let payload = qr_payload(wf.qr_template, text);
                let Ok((modules, bits)) = qr_matrix_bits(&payload, wf.qr_ecc) else {
                    // Too long to encode at any version: skip the symbol and report the
                    // row, rather than failing a job that is otherwise fine.
                    row_qr_failed = true;
                    continue;
                };
                let total_modules = modules + 2 * opts.qr_quiet_modules as usize;

                // The same three-way size choice as the text path: uniform per column
                // (Pe coloană), shrunk per code (Pe cod), or exactly as configured.
                let size = if let Some(uf) = &uniform_fs {
                    uf[idx]
                } else if opts.correct_overflow {
                    max_fitting_qr_pt(
                        wf.qr_size_mm * MM, total_modules, &wf, card_w, safe_margin,
                        &opts.contour_keep_polygons, inset_pt, contour_frame(opts, card_w),
                    )
                } else {
                    wf.qr_size_mm * MM
                };

                let b = qr_box(size);
                let x = resolve_x(align, wf.text_x_mm, card_w, safe_margin, b.width, contour_frame(opts, card_w), inset_pt);
                if qr_overflows(size, &wf, card_w, safe_margin, &opts.contour_keep_polygons, inset_pt, contour_frame(opts, card_w)) {
                    row_overflows = true;
                }

                operations.push(Operation::new("q", vec![])); // save
                // `y` is the square's bottom edge (a QR has no baseline), so the
                // rotate/flip pivot is the middle of the box either way.
                push_word_transform(&mut operations, rotation_deg, flip_x, flip_y, x + b.width / 2.0, y + (b.ascent + b.descent) / 2.0);

                if let Some(bg_color) = background {
                    push_code_background(
                        &mut operations, &mut ext_gstates, bg_color, background_alpha,
                        background_blend_mode, x, y, b, background_width, opts.text_background_padding_mm * MM,
                    );
                }

                operations.push(Operation::new("q", vec![])); // save
                let alpha = if text_alpha < 1.0 { Some(text_alpha) } else { None };
                let blend = if text_blend_mode != BlendMode::Normal { Some(text_blend_mode) } else { None };
                if let Some(gs_name) = ext_gstate_name(&mut ext_gstates, alpha, blend) {
                    operations.push(Operation::new("gs", vec![Object::Name(gs_name.into_bytes())]));
                }
                push_fill_color(&mut operations, color);
                operations.extend(qr_rect_operations(modules, &bits, x, y, size, opts.qr_quiet_modules));
                operations.push(Operation::new("Q", vec![])); // restore

                // No glyph-contour pass: stroking the module edges only fattens them
                // and costs the symbol its scannability, so `text_contour_colors` is
                // deliberately ignored for a QR.
                if opts.debug {
                    push_debug_box(&mut operations, x, y, b);
                }
                operations.push(Operation::new("Q", vec![])); // restore (rotation)
                continue;
            }

            let font_idx = if embedded_fonts.len() == 1 { 0 } else { idx };
            let ef = &embedded_fonts[font_idx];

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

            let ascent = (ef.face.ascender() as f32 / ef.units_per_em as f32) * font_size;
            let descent = (ef.face.descender() as f32 / ef.units_per_em as f32) * font_size;
            let text_box = WordBox { width: text_width, ascent, descent };

            // Note if this field still doesn't fit at the (possibly corrected) size —
            // the cut contour when supplied, else the card/safe-margin extent. The row
            // is recorded once, after the loop.
            if word_overflows(ef, font_size, advance_per_pt, &wf, num_chars, text, card_w, safe_margin, &opts.contour_keep_polygons, inset_pt, contour_frame(opts, card_w)) {
                row_overflows = true;
            }

            operations.push(Operation::new("q", vec![])); // save
            push_word_transform(&mut operations, rotation_deg, flip_x, flip_y, x + text_width / 2.0, y + (ascent + descent) / 2.0);

            if let Some(bg_color) = background {
                push_code_background(
                    &mut operations, &mut ext_gstates, bg_color, background_alpha,
                    background_blend_mode, x, y, text_box, background_width, opts.text_background_padding_mm * MM,
                );
            }

            operations.push(Operation::new("q", vec![])); // save
            let alpha = if text_alpha < 1.0 { Some(text_alpha) } else { None };
            let blend = if text_blend_mode != BlendMode::Normal { Some(text_blend_mode) } else { None };
            if let Some(gs_name) = ext_gstate_name(&mut ext_gstates, alpha, blend) {
                operations.push(Operation::new("gs", vec![Object::Name(gs_name.into_bytes())]));
            }
            push_fill_color(&mut operations, color);
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
                push_debug_box(&mut operations, x, y, text_box);
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
        // Unencodable QR payloads are deduped on their own, so a row can be listed
        // both as overflowing and as failing to encode without one hiding the other.
        if row_qr_failed {
            overflow.qr_failure_count += 1;
            if qr_seen.insert(txt.clone()) {
                overflow.qr_failures.push(txt.clone());
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

    fn centered_fit(configured_fs: f32) -> WordFit<'static> {
        WordFit {
            align: TextAlign::Center,
            char_spacing: 0.0,
            rotation_deg: 0.0,
            flip_x: false,
            flip_y: false,
            y: 5.0,
            configured_fs,
            text_x_mm: None,
            qr_size_mm: 0.0,
            qr_ecc: QrEcc::Medium,
            qr_template: "",
        }
    }

    // The same position, but rendered as a QR square of `size_mm` a side.
    fn centered_qr_fit(size_mm: f32) -> WordFit<'static> {
        WordFit { qr_size_mm: size_mm, ..centered_fit(9.0) }
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

    // A card whose keep region is the whole 40x40mm card, so only the QR's own size
    // and placement decide whether it clears the cut.
    fn full_card_keep(card_w: f32, card_h: f32) -> Vec<Vec<(f32, f32)>> {
        vec![vec![(0.0, 0.0), (card_w, 0.0), (card_w, card_h), (0.0, card_h)]]
    }

    #[test]
    fn qr_box_sits_entirely_above_its_anchor() {
        // Unlike text, a QR has no baseline: `y` is the square's bottom edge, so the
        // whole symbol is "ascent" and nothing hangs below.
        let b = qr_box(30.0);
        assert_eq!((b.width, b.ascent, b.descent), (30.0, 30.0, 0.0));
    }

    #[test]
    fn qr_centers_on_the_card_like_text_does() {
        // `resolve_x` is shared with the text path — the square's side is just the
        // box width, so a centered QR lands the same way a centered code would.
        let card_w = 40.0 * MM;
        let size = 12.0 * MM;
        let x = resolve_x(TextAlign::Center, None, card_w, 0.0, size, (0.0, card_w), 0.0);
        assert!((x - (card_w - size) / 2.0).abs() < 1e-3);
    }

    #[test]
    fn qr_fit_check_uses_the_square_corners() {
        let card = 40.0 * MM;
        let keep = full_card_keep(card, card);
        // A 10mm square at (5mm, 5mm) is comfortably inside the card.
        assert!(qr_fits_contour(10.0 * MM, 5.0 * MM, 5.0 * MM, 0.0, false, false, &keep, 0.0));
        // Slide it so its right edge crosses the cut and it must fail.
        assert!(!qr_fits_contour(10.0 * MM, 35.0 * MM, 5.0 * MM, 0.0, false, false, &keep, 0.0));
        // A rotation that swings the corners past the edge is caught too: a 30mm
        // square centred on the card fits square-on but not at 45 degrees.
        let centered = (card - 30.0 * MM) / 2.0;
        assert!(qr_fits_contour(30.0 * MM, centered, centered, 0.0, false, false, &keep, 0.0));
        assert!(!qr_fits_contour(30.0 * MM, centered, centered, 45.0, false, false, &keep, 0.0));
    }

    #[test]
    fn qr_overflow_correction_shrinks_to_fit() {
        // 36mm of QR on a 40mm card with a 4mm margin each side (32mm available).
        let card_w = 40.0 * MM;
        let margin = 4.0 * MM;
        let configured = 36.0 * MM;
        let wf = centered_qr_fit(36.0);
        assert!(qr_overflows(configured, &wf, card_w, margin, &[], 0.0, (0.0, card_w)));

        // A 21-module symbol plus two 4-module quiet zones = 29 modules, whose floor
        // (29 x 0.5mm = 14.5mm) leaves plenty of room to shrink into.
        let total = 21 + 2 * 4;
        let fitted = max_fitting_qr_pt(configured, total, &wf, card_w, margin, &[], 0.0, (0.0, card_w));
        assert!(fitted < configured, "should shrink, got {fitted}");
        assert!(!qr_overflows(fitted, &wf, card_w, margin, &[], 0.0, (0.0, card_w)), "shrunk size must fit");
    }

    #[test]
    fn qr_overflow_correction_stops_at_the_module_floor() {
        // Only 12mm of room, but 29 modules can't print below 29 x 0.5mm = 14.5mm.
        // The corrector stops there and leaves the code flagged, rather than emitting
        // a symbol that fits the card but no scanner can read.
        let card_w = 20.0 * MM;
        let margin = 4.0 * MM;
        let total = 21 + 2 * 4;
        let wf = centered_qr_fit(18.0);
        let floor = QR_MIN_MODULE_MM * MM * total as f32;

        let fitted = max_fitting_qr_pt(18.0 * MM, total, &wf, card_w, margin, &[], 0.0, (0.0, card_w));
        assert!((fitted - floor).abs() < 1e-3, "expected the floor {floor}, got {fitted}");
        assert!(qr_overflows(fitted, &wf, card_w, margin, &[], 0.0, (0.0, card_w)), "still flagged");
    }

    #[test]
    fn qr_column_correction_picks_a_size_every_code_fits() {
        let ef = vec![font()];
        // A short and a long payload: they need different module counts, but the
        // square they occupy is the same, so the column lands on one size for both.
        let records = vec![
            csv::StringRecord::from(vec!["A1"]),
            csv::StringRecord::from(vec!["A-MUCH-LONGER-CODE-000001"]),
        ];
        let opts = Options {
            font_sizes: vec![9.0],
            text_y_mm: vec![5.0],
            align: vec![TextAlign::Center],
            qr_sizes_mm: vec![36.0],
            correct_overflow: true,
            overflow_correction_by_column: true,
            ..Options::default()
        };
        let y_positions = vec![5.0 * MM];
        let card_w = 40.0 * MM;
        let margin = 4.0 * MM;

        let uniform = compute_uniform_fs(&records, &opts, &ef, &y_positions, card_w, margin);
        // The column is seeded from the QR side in points, not from the font size,
        // and shrunk from there.
        assert!(uniform[0] < 36.0 * MM, "column should shrink, got {}", uniform[0]);
        let wf = resolve_word_fit(&opts, &y_positions, 0);
        assert!(!qr_overflows(uniform[0], &wf, card_w, margin, &[], 0.0, (0.0, card_w)));
    }

    #[test]
    fn resolve_word_fit_broadcasts_a_single_qr_entry_to_every_position() {
        let opts = Options {
            font_sizes: vec![9.0, 9.0, 9.0],
            text_y_mm: vec![5.0, 5.0, 5.0],
            align: vec![TextAlign::Center],
            qr_sizes_mm: vec![14.0],
            qr_ecc: vec![QrEcc::High],
            qr_templates: vec!["https://s.ro/{code}".to_string()],
            ..Options::default()
        };
        let y_positions = vec![5.0 * MM; 3];
        for idx in 0..3 {
            let wf = resolve_word_fit(&opts, &y_positions, idx);
            assert_eq!(wf.qr_size_mm, 14.0);
            assert!(matches!(wf.qr_ecc, QrEcc::High));
            assert_eq!(wf.qr_template, "https://s.ro/{code}");
        }
    }

    #[test]
    fn resolve_word_fit_defaults_a_position_without_qr_config_to_text() {
        let opts = Options {
            font_sizes: vec![9.0, 9.0],
            text_y_mm: vec![5.0, 5.0],
            align: vec![TextAlign::Center],
            // Only the second position is a QR.
            qr_sizes_mm: vec![0.0, 14.0],
            ..Options::default()
        };
        let y_positions = vec![5.0 * MM; 2];
        assert_eq!(resolve_word_fit(&opts, &y_positions, 0).qr_size_mm, 0.0);
        assert_eq!(resolve_word_fit(&opts, &y_positions, 1).qr_size_mm, 14.0);
        // An unconfigured level/template falls back to the documented defaults.
        let wf = resolve_word_fit(&opts, &y_positions, 1);
        assert!(matches!(wf.qr_ecc, QrEcc::Medium));
        assert_eq!(wf.qr_template, "");
    }
}
