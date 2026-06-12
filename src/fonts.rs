use lopdf::{Document, Object, Stream, Dictionary};
use ttf_parser::{Face, GlyphId};

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

// Embed each font in `font_bytes_list` into `doc` as a TrueType font
// resource, returning the parsed faces and resource handles needed to lay
// out and reference the fonts in card content streams.
pub(crate) fn embed_fonts<'a>(doc: &mut Document, font_bytes_list: &[&'a [u8]]) -> Result<Vec<EmbeddedFont<'a>>, Box<dyn std::error::Error>> {
    let mut embedded_fonts = Vec::new();
    for (i, font_bytes) in font_bytes_list.iter().enumerate() {
        let face = Face::parse(font_bytes, 0)?;
        let base_name = font_base_name(&face, i);

        // Extract actual character widths from the font
        let mut widths = Vec::new();
        for char_code in 32u8..=126u8 {
            let ch = char_code as char;
            let glyph_id = face.glyph_index(ch).unwrap_or(GlyphId(0));
            let advance = face.glyph_hor_advance(glyph_id).unwrap_or(0);

            // Convert from font units to PDF font units (typically 1000 units per em)
            let units_per_em_f = face.units_per_em() as f32;
            let width_in_pdf_units = (advance as f32 / units_per_em_f * 1000.0) as i64;
            widths.push(Object::Integer(width_in_pdf_units));
        }

        // Embed font with proper descriptor and compression
        let mut font_stream_dict = Dictionary::new();
        font_stream_dict.set("Length1", Object::Integer(font_bytes.len() as i64));

        // Compress the font data
        let mut font_stream = Stream::new(font_stream_dict, font_bytes.to_vec());
        let _ = font_stream.compress();
        let font_stream_id = doc.add_object(font_stream);

        // Extract font metrics
        let ascender = face.ascender();
        let descender = face.descender();
        let units_per_em = face.units_per_em() as i32;
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

        let mut font_dict = Dictionary::new();
        font_dict.set("Type", Object::Name(b"Font".to_vec()));
        font_dict.set("Subtype", Object::Name(b"TrueType".to_vec()));
        font_dict.set("BaseFont", Object::Name(base_name.into_bytes()));
        font_dict.set("FontDescriptor", Object::Reference(fd_id));
        font_dict.set("Encoding", Object::Name(b"WinAnsiEncoding".to_vec()));
        font_dict.set("FirstChar", Object::Integer(32));
        font_dict.set("LastChar", Object::Integer(126));
        font_dict.set("Widths", Object::Array(widths));
        let font_id = doc.add_object(Object::Dictionary(font_dict));

        embedded_fonts.push(EmbeddedFont {
            face,
            units_per_em,
            font_id,
            resource_name: format!("F{}", i + 1).into_bytes(),
        });
    }

    Ok(embedded_fonts)
}
