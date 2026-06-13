use lopdf::{Document, Object, Dictionary, Stream, ObjectId, content::{Operation, Content}};
use csv::ReaderBuilder;
use ttf_parser::GlyphId;

use crate::align::TextAlign;
use crate::blend::BlendMode;
use crate::color::TextColor;
use crate::fonts::EmbeddedFont;
use crate::geometry::{CardLayout, MM};
use crate::options::Options;

// Build a Form XObject (background + label text) for each CSV row, returning
// the object IDs of the generated cards.
pub(crate) fn build_card_xobjects(
    doc: &mut Document,
    csv_data: &str,
    opts: &Options,
    embedded_fonts: &[EmbeddedFont],
    layout: &CardLayout,
    bg_form_id: ObjectId,
) -> Result<Vec<ObjectId>, Box<dyn std::error::Error>> {
    let card_w = layout.card_w;
    let card_box = layout.card_box.clone();

    let mut rdr = ReaderBuilder::new()
        .has_headers(false)
        .from_reader(csv_data.as_bytes());

    let kerning_adjustment = 0.3;
    let y_positions: Vec<f32> = opts.text_y_mm.iter().map(|y| y * MM).collect();

    let mut card_ids = Vec::new();
    for result in rdr.records() {
        let txt = result?.get(0).ok_or("Missing CSV field")?.to_string();
        let split_chars = if opts.split_chars.is_empty() { " " } else { opts.split_chars.as_str() };
        let texts: Vec<&str> = txt.split(split_chars).collect();

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

        for (idx, text) in texts.iter().enumerate() {
            let font_size = opts.font_sizes[idx];
            let font_idx = if embedded_fonts.len() == 1 { 0 } else { idx };
            let ef = &embedded_fonts[font_idx];
            let align_idx = if opts.align.len() == 1 { 0 } else { idx };
            let align = opts.align[align_idx];

            // Calculate text width using ttf-parser
            let mut base_text_width = 0.0f32;
            for ch in text.chars() {
                let glyph_id = ef.face.glyph_index(ch).unwrap_or(GlyphId(0));
                let advance = ef.face.glyph_hor_advance(glyph_id).unwrap_or(0);
                let char_width = (advance as f32 / ef.units_per_em as f32) * font_size;
                base_text_width += char_width;
            }

            // Account for Tc kerning (0.3 points between each character)
            let num_chars = text.len() as f32;
            let text_width = base_text_width + (kerning_adjustment * (num_chars - 1.0));

            let safe_margin = opts.safe_margin_mm * MM;
            let x = if !opts.text_x_mm.is_empty() {
                opts.text_x_mm[idx] * MM
            } else {
                match align {
                    TextAlign::Left => safe_margin,
                    TextAlign::Center => (card_w - text_width) / 2.0,
                    TextAlign::Right => card_w - text_width - safe_margin,
                }
            };
            let y = y_positions[idx];

            if x < safe_margin {
                eprintln!("code: {:?}", &text);
            }

            let color = if opts.text_colors.is_empty() {
                TextColor::Rgb(0.0, 0.0, 0.0)
            } else {
                let color_idx = if opts.text_colors.len() == 1 { 0 } else { idx };
                opts.text_colors[color_idx]
            };

            let ascent = (ef.face.ascender() as f32 / ef.units_per_em as f32) * font_size;
            let descent = (ef.face.descender() as f32 / ef.units_per_em as f32) * font_size;

            let rotation_deg = if opts.text_rotations.is_empty() {
                0.0
            } else {
                let rotation_idx = if opts.text_rotations.len() == 1 { 0 } else { idx };
                opts.text_rotations[rotation_idx]
            };
            let flip_x = if opts.text_flip_x.is_empty() {
                false
            } else {
                let flip_idx = if opts.text_flip_x.len() == 1 { 0 } else { idx };
                opts.text_flip_x[flip_idx]
            };
            let flip_y = if opts.text_flip_y.is_empty() {
                false
            } else {
                let flip_idx = if opts.text_flip_y.len() == 1 { 0 } else { idx };
                opts.text_flip_y[flip_idx]
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
            match color {
                TextColor::Rgb(r, g, b) => {
                    operations.push(Operation::new("rg", vec![Object::Real(r), Object::Real(g), Object::Real(b)]));
                }
                TextColor::Cmyk(c, m, y, k) => {
                    operations.push(Operation::new("k", vec![Object::Real(c), Object::Real(m), Object::Real(y), Object::Real(k)]));
                }
            }
            operations.push(Operation::new("BT", vec![]));
            operations.push(Operation::new("Tf", vec![Object::Name(ef.resource_name.clone()), Object::Real(font_size)]));
            operations.push(Operation::new("Tc", vec![Object::Real(kerning_adjustment)])); // add slight kerning
            operations.push(Operation::new("Tr", vec![Object::Integer(0)])); // fill only
            operations.push(Operation::new("Td", vec![Object::Real(x), Object::Real(y)]));
            operations.push(Operation::new("Tj", vec![Object::String(text.as_bytes().to_vec(), lopdf::StringFormat::Literal)]));
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
                operations.push(Operation::new("Tc", vec![Object::Real(kerning_adjustment)]));
                operations.push(Operation::new("Tr", vec![Object::Integer(1)])); // stroke only
                operations.push(Operation::new("Td", vec![Object::Real(x), Object::Real(y)]));
                operations.push(Operation::new("Tj", vec![Object::String(text.as_bytes().to_vec(), lopdf::StringFormat::Literal)]));
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

    Ok(card_ids)
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
