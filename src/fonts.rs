use lopdf::{Document, Object, Stream, Dictionary, StringFormat};
use ttf_parser::{Face, GlyphId};
use std::collections::BTreeMap;

pub(crate) static MONTSERRAT_BOLD_TTF: &[u8] = include_bytes!("assets/fonts/Montserrat-Bold.ttf");

// A font embedded into the PDF for use as a Form XObject resource, plus the
// parsed face used to measure glyph metrics when laying out text.
pub(crate) struct EmbeddedFont<'a> {
    pub face: Face<'a>,
    pub units_per_em: i32,
    pub font_id: lopdf::ObjectId,
    pub resource_name: Vec<u8>,
}

// Derive a PDF BaseFont name from the font's PostScript name, falling back
// to a generic "CustomFontN" name (1-based) if it has none.
fn font_base_name(face: &Face, index: usize) -> String {
    face.names()
        .into_iter()
        .find(|n| n.name_id == ttf_parser::name_id::POST_SCRIPT_NAME && n.is_unicode())
        .and_then(|n| n.to_string())
        .map(|s| s.replace(' ', ""))
        .unwrap_or_else(|| format!("CustomFont{}", index + 1))
}

// Embed each font in `font_bytes_list` into `doc` as a Type0 (composite)
// TrueType font with Identity-H encoding, returning the parsed faces and
// resource handles needed to lay out and reference the fonts in card content
// streams. Identity-H means card text is written as 2-byte glyph IDs (see
// `encode_text_gids`), so any Unicode character the font contains — including
// Romanian diacritics ș/ț/ă — renders correctly, unlike a simple WinAnsi font
// which can only address a single-byte Latin-1 subset.
pub(crate) fn embed_fonts<'a>(doc: &mut Document, font_bytes_list: &[&'a [u8]]) -> Result<Vec<EmbeddedFont<'a>>, Box<dyn std::error::Error>> {
    let mut embedded_fonts = Vec::new();
    for (i, font_bytes) in font_bytes_list.iter().enumerate() {
        let face = Face::parse(font_bytes, 0)?;
        let base_name = font_base_name(&face, i);
        let units_per_em = face.units_per_em() as i32;
        let units_per_em_f = units_per_em as f32;

        // Embed the raw TrueType program (compressed).
        let mut font_stream_dict = Dictionary::new();
        font_stream_dict.set("Length1", Object::Integer(font_bytes.len() as i64));
        let mut font_stream = Stream::new(font_stream_dict, font_bytes.to_vec());
        let _ = font_stream.compress();
        let font_stream_id = doc.add_object(font_stream);

        // Font descriptor.
        let ascender = face.ascender();
        let descender = face.descender();
        let bbox = face.global_bounding_box();
        let mut fd_dict = Dictionary::new();
        fd_dict.set("Type", Object::Name(b"FontDescriptor".to_vec()));
        fd_dict.set("FontName", Object::Name(base_name.clone().into_bytes()));
        fd_dict.set("FontFile2", Object::Reference(font_stream_id));
        fd_dict.set("Flags", Object::Integer(32));
        fd_dict.set("FontBBox", Object::Array(vec![
            Object::Integer(bbox.x_min as i64),
            Object::Integer(bbox.y_min as i64),
            Object::Integer(bbox.x_max as i64),
            Object::Integer(bbox.y_max as i64),
        ]));
        fd_dict.set("ItalicAngle", Object::Integer(0));
        fd_dict.set("Ascent", Object::Integer(ascender as i64));
        fd_dict.set("Descent", Object::Integer(descender as i64));
        fd_dict.set("CapHeight", Object::Integer((ascender * 7 / 10) as i64)); // Approximation
        fd_dict.set("StemV", Object::Integer(80));
        let fd_id = doc.add_object(Object::Dictionary(fd_dict));

        // Per-glyph advance widths (CID == GID under Identity), in 1000-em units,
        // as a single contiguous `W` run starting at CID 0.
        let num_glyphs = face.number_of_glyphs();
        let mut glyph_widths = Vec::with_capacity(num_glyphs as usize);
        for gid in 0..num_glyphs {
            let advance = face.glyph_hor_advance(GlyphId(gid)).unwrap_or(0);
            let w = (advance as f32 / units_per_em_f * 1000.0).round() as i64;
            glyph_widths.push(Object::Integer(w));
        }
        let w_array = vec![Object::Integer(0), Object::Array(glyph_widths)];

        // Descendant CIDFontType2.
        let mut cid_sysinfo = Dictionary::new();
        cid_sysinfo.set("Registry", Object::String(b"Adobe".to_vec(), StringFormat::Literal));
        cid_sysinfo.set("Ordering", Object::String(b"Identity".to_vec(), StringFormat::Literal));
        cid_sysinfo.set("Supplement", Object::Integer(0));
        let mut cid_dict = Dictionary::new();
        cid_dict.set("Type", Object::Name(b"Font".to_vec()));
        cid_dict.set("Subtype", Object::Name(b"CIDFontType2".to_vec()));
        cid_dict.set("BaseFont", Object::Name(base_name.clone().into_bytes()));
        cid_dict.set("CIDSystemInfo", Object::Dictionary(cid_sysinfo));
        cid_dict.set("FontDescriptor", Object::Reference(fd_id));
        cid_dict.set("CIDToGIDMap", Object::Name(b"Identity".to_vec()));
        cid_dict.set("DW", Object::Integer(1000));
        cid_dict.set("W", Object::Array(w_array));
        let cid_id = doc.add_object(Object::Dictionary(cid_dict));

        // ToUnicode CMap so selecting/copying the rendered text yields the
        // original characters rather than raw glyph IDs.
        let mut tu_stream = Stream::new(Dictionary::new(), build_to_unicode_cmap(&face).into_bytes());
        let _ = tu_stream.compress();
        let tu_id = doc.add_object(tu_stream);

        // Type0 parent font.
        let mut type0 = Dictionary::new();
        type0.set("Type", Object::Name(b"Font".to_vec()));
        type0.set("Subtype", Object::Name(b"Type0".to_vec()));
        type0.set("BaseFont", Object::Name(base_name.into_bytes()));
        type0.set("Encoding", Object::Name(b"Identity-H".to_vec()));
        type0.set("DescendantFonts", Object::Array(vec![Object::Reference(cid_id)]));
        type0.set("ToUnicode", Object::Reference(tu_id));
        let font_id = doc.add_object(Object::Dictionary(type0));

        embedded_fonts.push(EmbeddedFont {
            face,
            units_per_em,
            font_id,
            resource_name: format!("F{}", i + 1).into_bytes(),
        });
    }

    Ok(embedded_fonts)
}

// Encode `text` as big-endian 2-byte glyph IDs for an Identity-H composite
// font. Characters the font lacks fall back to glyph 0 (.notdef).
pub(crate) fn encode_text_gids(face: &Face, text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.chars().count() * 2);
    for ch in text.chars() {
        let gid = face.glyph_index(ch).unwrap_or(GlyphId(0)).0;
        out.push((gid >> 8) as u8);
        out.push((gid & 0xff) as u8);
    }
    out
}

// Build a ToUnicode CMap mapping each glyph ID back to the Unicode value it was
// reached from, by reversing the font's Unicode cmap. Lets PDF viewers recover
// text from the Identity-H glyph IDs for selection, copy and search.
fn build_to_unicode_cmap(face: &Face) -> String {
    let mut gid_to_cp: BTreeMap<u16, u32> = BTreeMap::new();
    if let Some(cmap) = face.tables().cmap {
        for subtable in cmap.subtables {
            if !subtable.is_unicode() {
                continue;
            }
            subtable.codepoints(|cp| {
                if let Some(gid) = subtable.glyph_index(cp) {
                    gid_to_cp.entry(gid.0).or_insert(cp);
                }
            });
        }
    }

    let entries: Vec<(u16, u32)> = gid_to_cp.into_iter().filter(|&(g, _)| g != 0).collect();
    let mut body = String::new();
    // `bfchar` blocks are capped at 100 entries each.
    for chunk in entries.chunks(100) {
        body.push_str(&format!("{} beginbfchar\n", chunk.len()));
        for &(gid, cp) in chunk {
            body.push_str(&format!("<{:04X}> <{}>\n", gid, utf16be_hex(cp)));
        }
        body.push_str("endbfchar\n");
    }

    format!(
        "/CIDInit /ProcSet findresource begin\n\
         12 dict begin\n\
         begincmap\n\
         /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n\
         /CMapName /Adobe-Identity-UCS def\n\
         /CMapType 2 def\n\
         1 begincodespacerange\n\
         <0000> <FFFF>\n\
         endcodespacerange\n\
         {body}endcmap\n\
         CMapName currentdict /CMap defineresource pop\n\
         end\n\
         end"
    )
}

// UTF-16BE hex for a ToUnicode destination value (surrogate pair for codepoints
// beyond the BMP). Invalid scalars map to U+FFFD.
fn utf16be_hex(cp: u32) -> String {
    let ch = char::from_u32(cp).unwrap_or('\u{FFFD}');
    let mut buf = [0u16; 2];
    let mut s = String::new();
    for unit in ch.encode_utf16(&mut buf) {
        s.push_str(&format!("{:04X}", unit));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_romanian_diacritics_as_real_glyph_ids() {
        let face = Face::parse(MONTSERRAT_BOLD_TTF, 0).unwrap();
        // Montserrat covers Latin-Extended, so each Romanian diacritic must map
        // to a real glyph — never .notdef (0), which is what produced garbled
        // output when the text was written as raw UTF-8 under WinAnsiEncoding.
        for ch in ['ș', 'ț', 'ă', 'â', 'î'] {
            let bytes = encode_text_gids(&face, &ch.to_string());
            assert_eq!(bytes.len(), 2, "{ch}: one 2-byte glyph id");
            let gid = (u16::from(bytes[0]) << 8) | u16::from(bytes[1]);
            assert_ne!(gid, 0, "{ch} should resolve to a real glyph, not .notdef");
        }
    }

    #[test]
    fn embeds_type0_identity_h_font_with_tounicode() {
        let mut doc = Document::with_version("1.5");
        let fonts = embed_fonts(&mut doc, &[MONTSERRAT_BOLD_TTF]).unwrap();
        let font = doc.get_object(fonts[0].font_id).unwrap().as_dict().unwrap();
        assert_eq!(font.get(b"Subtype").unwrap().as_name().unwrap(), b"Type0");
        assert_eq!(font.get(b"Encoding").unwrap().as_name().unwrap(), b"Identity-H");
        assert!(font.get(b"ToUnicode").is_ok(), "ToUnicode CMap should be present");
        // The descendant must be a CIDFontType2 with Identity glyph mapping.
        let desc_id = font.get(b"DescendantFonts").unwrap().as_array().unwrap()[0].as_reference().unwrap();
        let cid = doc.get_object(desc_id).unwrap().as_dict().unwrap();
        assert_eq!(cid.get(b"Subtype").unwrap().as_name().unwrap(), b"CIDFontType2");
        assert_eq!(cid.get(b"CIDToGIDMap").unwrap().as_name().unwrap(), b"Identity");
    }
}
