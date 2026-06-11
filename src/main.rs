use lopdf::{Document, Object, Stream, Dictionary, content::{Operation, Content}};
use csv::ReaderBuilder;
use ttf_parser::{Face, GlyphId};
use std::{fs::File, env};

static MONTSERRAT_BOLD_TTF: &[u8] = include_bytes!("../Montserrat-Bold.ttf");
static MM: f32 = 72.0 / 25.4;
static SAFE_MM: f32 = 3.5 * MM;


fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: {} <csv_file> <background_pdf> [output_pdf]", args[0]);
        std::process::exit(1);
    }
    let csv_path = &args[1];
    let background_path = &args[2];
    let output_path = args.get(3).map(|s| s.as_str()).unwrap_or("output.pdf");

    generate_pdf(csv_path, background_path, output_path)?;
    println!("PDF generated successfully: {}", output_path);
    Ok(())
}

fn generate_pdf(csv_path: &str, background_path: &str, output_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Load background PDF
    let mut doc = Document::load(background_path)?;

    // Get background page
    let pages = doc.get_pages();
    let (_, bg_page_id) = pages.iter().next().ok_or("No pages in background PDF")?;
    let bg_page_obj = doc.get_object(*bg_page_id)?;
    let bg_page_dict = bg_page_obj.as_dict()?;
    let media_box_obj = bg_page_dict.get(b"MediaBox")?;
    let media_box_orig = media_box_obj.as_array()?.clone();

    let width = match &media_box_orig[2] {
        Object::Integer(w) => *w as f64,
        Object::Real(w) => (*w).into(),
        _ => 595.0,
    };
    let _height = match &media_box_orig[3] {
        Object::Integer(h) => *h as f64,
        Object::Real(h) => (*h).into(),
        _ => 842.0,
    };

    // Create MediaBox as Real values for consistency
    let media_box = vec![
        Object::Real(0.0),
        Object::Real(0.0),
        Object::Real(width as f32),
        Object::Real(_height as f32),
    ];

    // Update background page MediaBox to Real
    let mut bg_page_dict = bg_page_dict.clone();
    bg_page_dict.set("MediaBox", Object::Array(media_box.clone()));

    doc.objects.insert(*bg_page_id, Object::Dictionary(bg_page_dict));

    // Get background content bytes for XObject
    let bg_content_bytes = doc.get_page_content(*bg_page_id)?;

    // Create Form XObject for background
    let mut xobj_dict = Dictionary::new();
    xobj_dict.set("Type", Object::Name(b"XObject".to_vec()));
    xobj_dict.set("Subtype", Object::Name(b"Form".to_vec()));
    xobj_dict.set("BBox", Object::Array(media_box.clone()));
    let bg_form = Stream::new(xobj_dict, bg_content_bytes);
    let bg_form_id = doc.add_object(bg_form);

    // Parse font with ttf-parser
    let face = Face::parse(MONTSERRAT_BOLD_TTF, 0)?;
    
    // Extract actual character widths from the font
    let mut widths = Vec::new();
    for char_code in 32u8..=126u8 {
        let ch = char_code as char;
        let glyph_id = face.glyph_index(ch).unwrap_or(GlyphId(0));
        let advance = face.glyph_hor_advance(glyph_id).unwrap_or(0);
        
        // Convert from font units to PDF font units (typically 1000 units per em)
        let units_per_em = face.units_per_em() as f32;
        let width_in_pdf_units = (advance as f32 / units_per_em * 1000.0) as i64;
        widths.push(Object::Integer(width_in_pdf_units));
    }

    // Embed Montserrat font with proper descriptor and compression
    let mut font_stream_dict = Dictionary::new();
    font_stream_dict.set("Length1", Object::Integer(MONTSERRAT_BOLD_TTF.len() as i64));
    
    // Compress the font data
    let mut font_stream = Stream::new(font_stream_dict, MONTSERRAT_BOLD_TTF.to_vec());
    let _ = font_stream.compress();
    let font_stream_id = doc.add_object(font_stream);

    // Extract font metrics
    let ascender = face.ascender();
    let descender = face.descender();
    let units_per_em = face.units_per_em() as i32;
    let bbox = face.global_bounding_box();
    
    let mut fd_dict = Dictionary::new();
    fd_dict.set("Type", Object::Name(b"FontDescriptor".to_vec()));
    fd_dict.set("FontName", Object::Name(b"MontserratBold".to_vec()));
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
    font_dict.set("BaseFont", Object::Name(b"MontserratBold".to_vec()));
    font_dict.set("FontDescriptor", Object::Reference(fd_id));
    font_dict.set("Encoding", Object::Name(b"WinAnsiEncoding".to_vec()));
    font_dict.set("FirstChar", Object::Integer(32));
    font_dict.set("LastChar", Object::Integer(126));
    font_dict.set("Widths", Object::Array(widths));
    let font_id = doc.add_object(Object::Dictionary(font_dict));


    // Get pages root
    let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    let catalog = doc.get_object(catalog_id)?;
    let pages_id = catalog.as_dict()?.get(b"Pages").unwrap().as_reference()?;

    // Remove the original background page from the page tree, since its
    // content is now reused as the BG XObject on every generated page.
    {
        let pages_obj = doc.get_object(pages_id)?;
        let pages_dict_orig = pages_obj.as_dict()?;
        let mut kids = pages_dict_orig.get(b"Kids").unwrap().as_array()?.clone();
        kids.retain(|kid| kid.as_reference().map(|r| r != *bg_page_id).unwrap_or(true));
        let count = kids.len() as i64;
        let mut pages_dict = pages_dict_orig.clone();
        pages_dict.set("Kids", Object::Array(kids));
        pages_dict.set("Count", Object::Integer(count));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));
    }
    doc.objects.remove(bg_page_id);

    // Load CSV
    let file = File::open(csv_path)?;
    let mut rdr = ReaderBuilder::new()
        .has_headers(false)
        .from_reader(file);

    let kerning_adjustment = 0.3;
    let y_positions = vec![9.0 * MM, 4.0 * MM]; // y for each word
    let font_sizes = vec![9.0, 13.0];

    for result in rdr.records() {
        let txt = result?.get(0).ok_or("Missing CSV field")?.to_string();
        // Split text by spaces
        let texts: Vec<&str> = txt.split(' ').collect();

        // Create new page content: draw XObject background + text
        let mut operations = Vec::new();
        for (idx, text) in texts.iter().enumerate() {

        let font_size = font_sizes[idx];
        // Draw background XObject
        operations.push(Operation::new("Do", vec![Object::Name(b"BG".to_vec())]));

        // Calculate text width using ttf-parser
        let mut base_text_width = 0.0f32;
        for ch in text.chars() {
            let glyph_id = face.glyph_index(ch).unwrap_or(GlyphId(0));
            let advance = face.glyph_hor_advance(glyph_id).unwrap_or(0);
            
            // Scale to font size: (advance / units_per_em) * font_size
            let char_width = (advance as f32 / units_per_em as f32) * font_size;
            base_text_width += char_width;
        }
        
        // Account for Tc kerning (0.3 points between each character)
        let num_chars = text.len() as f32;
        let text_width = base_text_width + (kerning_adjustment * (num_chars - 1.0));
        
        let x = (width as f32 - text_width) / 2.0; // center text horizontally
        let y = y_positions[idx];

        if x < SAFE_MM {
          eprintln!("code: {:?}", &text);
        } 
        
        operations.push(Operation::new("q", vec![])); // save
        operations.push(Operation::new("BT", vec![]));
        operations.push(Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), Object::Real(font_size)]));
        operations.push(Operation::new("Tc", vec![Object::Real(kerning_adjustment)])); // add slight kerning
        operations.push(Operation::new("Td", vec![Object::Real(x), Object::Real(y)]));
        operations.push(Operation::new("Tj", vec![Object::String(text.as_bytes().to_vec(), lopdf::StringFormat::Literal)]));
        operations.push(Operation::new("ET", vec![]));
        operations.push(Operation::new("Q", vec![])); // restore
}
        // Create content stream
        let content = Content { operations };
        let content_data = content.encode()?;
        let content_stream = Stream::new(Dictionary::new(), content_data);

        // Add content
        let content_id = doc.add_object(content_stream);

        // Create page dict
        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(pages_id));
        page_dict.set("MediaBox", Object::Array(media_box.clone()));
        page_dict.set("Contents", Object::Reference(content_id));
        page_dict.set("Resources", Object::Dictionary({
            let mut res = Dictionary::new();
            res.set("Font", Object::Dictionary({
                let mut fonts = Dictionary::new();
                fonts.set("F1", Object::Reference(font_id));
                fonts
            }));
            res.set("XObject", Object::Dictionary({
                let mut xobjs = Dictionary::new();
                xobjs.set("BG", Object::Reference(bg_form_id));
                xobjs
            }));
            res
        }));

        let page_id = doc.add_object(Object::Dictionary(page_dict));

        // Add to pages tree
        let pages_obj = doc.get_object(pages_id)?;
        let pages_dict_orig = pages_obj.as_dict()?;
        let mut kids = pages_dict_orig.get(b"Kids").unwrap().as_array()?.clone();
        kids.push(Object::Reference(page_id));
        let count = pages_dict_orig.get(b"Count").unwrap().as_i64().unwrap_or(0) + 1;
        let mut pages_dict = pages_dict_orig.clone();
        pages_dict.set("Kids", Object::Array(kids));
        pages_dict.set("Count", Object::Integer(count));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));
    }

    // Save
    doc.save(output_path)?;

    Ok(())
}
