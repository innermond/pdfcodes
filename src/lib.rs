use lopdf::{Document, Object, Stream, Dictionary, content::{Operation, Content}};
use csv::ReaderBuilder;
use ttf_parser::{Face, GlyphId};
use kurbo::{Affine, BezPath, ParamCurveArclen, Point};

static MONTSERRAT_BOLD_TTF: &[u8] = include_bytes!("assets/fonts/Montserrat-Bold.ttf");
static MM: f32 = 72.0 / 25.4;

#[derive(Clone)]
pub struct Options {
    pub host_width_mm: f32,
    pub host_height_mm: f32,
    pub offset_x_mm: f32,
    pub offset_y_mm: f32,
    pub circle_diameter_mm: f32,
    pub contour: bool,
    pub measure_paths: bool,
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
            font_sizes: vec![9.0, 14.0],
            text_y_mm: vec![10.0, 3.0],
            text_x_mm: Vec::new(),
            font_data: Vec::new(),
            align: vec![TextAlign::Center],
            text_colors: Vec::new(),
            combine: false,
            debug: false,
            safe_margin_mm: 0.0,
            text_rotations: Vec::new(),
            text_flip_x: Vec::new(),
            text_flip_y: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

impl std::str::FromStr for TextAlign {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "left" => Ok(TextAlign::Left),
            "center" => Ok(TextAlign::Center),
            "right" => Ok(TextAlign::Right),
            other => Err(format!("invalid alignment {:?} (expected \"left\", \"center\", or \"right\")", other)),
        }
    }
}

// Result of generating a PDF: the document bytes plus, when requested, the
// stroked-path measurements of the contour background (excluding the 3
// registration circles, which are added separately).
#[derive(Debug)]
pub struct GenerateOutput {
    pub pdf: Vec<u8>,
    pub cards_per_page: usize,
    pub path_length_per_card_mm: Option<f32>,
    pub path_length_total_mm: Option<f32>,
}

// Black filled circle centered at (cx, cy) with radius r, approximated with 4 cubic beziers.
fn circle_ops(cx: f32, cy: f32, r: f32) -> Vec<Operation> {
    let k = 0.5522847498 * r;
    vec![
        Operation::new("g", vec![Object::Real(0.0)]),
        Operation::new("m", vec![Object::Real(cx + r), Object::Real(cy)]),
        Operation::new("c", vec![
            Object::Real(cx + r), Object::Real(cy + k),
            Object::Real(cx + k), Object::Real(cy + r),
            Object::Real(cx), Object::Real(cy + r),
        ]),
        Operation::new("c", vec![
            Object::Real(cx - k), Object::Real(cy + r),
            Object::Real(cx - r), Object::Real(cy + k),
            Object::Real(cx - r), Object::Real(cy),
        ]),
        Operation::new("c", vec![
            Object::Real(cx - r), Object::Real(cy - k),
            Object::Real(cx - k), Object::Real(cy - r),
            Object::Real(cx), Object::Real(cy - r),
        ]),
        Operation::new("c", vec![
            Object::Real(cx + k), Object::Real(cy - r),
            Object::Real(cx + r), Object::Real(cy - k),
            Object::Real(cx + r), Object::Real(cy),
        ]),
        Operation::new("h", vec![]),
        Operation::new("f", vec![]),
    ]
}

// Deep-copy an object (and, recursively, anything it references) from `src`
// into `dst`, renumbering object IDs so they don't collide with `dst`'s
// existing objects. Used to pull a background page's content/resources from
// a separately-loaded contour PDF into the print document for `--combineb`.
fn import_object(
    src: &Document,
    dst: &mut Document,
    obj: &Object,
    id_map: &mut std::collections::HashMap<lopdf::ObjectId, lopdf::ObjectId>,
) -> Object {
    match obj {
        Object::Reference(id) => {
            if let Some(new_id) = id_map.get(id) {
                return Object::Reference(*new_id);
            }
            dst.max_id += 1;
            let new_id = (dst.max_id, 0);
            id_map.insert(*id, new_id);
            if let Ok(referenced) = src.get_object(*id) {
                let imported = import_object(src, dst, referenced, id_map);
                dst.objects.insert(new_id, imported);
            }
            Object::Reference(new_id)
        }
        Object::Dictionary(dict) => {
            let mut new_dict = Dictionary::new();
            for (k, v) in dict.iter() {
                new_dict.set(k.clone(), import_object(src, dst, v, id_map));
            }
            Object::Dictionary(new_dict)
        }
        Object::Array(arr) => Object::Array(arr.iter().map(|v| import_object(src, dst, v, id_map)).collect()),
        Object::Stream(stream) => {
            let mut new_dict = Dictionary::new();
            for (k, v) in stream.dict.iter() {
                new_dict.set(k.clone(), import_object(src, dst, v, id_map));
            }
            Object::Stream(Stream::new(new_dict, stream.content.clone()))
        }
        other => other.clone(),
    }
}

// A text fill color, either RGB (each component 0.0-1.0) or CMYK (each
// component 0.0-1.0).
#[derive(Clone, Copy)]
pub enum TextColor {
    Rgb(f32, f32, f32),
    Cmyk(f32, f32, f32, f32),
}

// Parse a color, either:
// - "#RRGGBB" (or "RRGGBB") hex -> RGB
// - "c:m:y:k" (4 colon-separated floats, 0.0-1.0) -> CMYK. A colon (rather
//   than comma) is used so multiple colors can still be given as a
//   comma-separated list, e.g. "--text-colors=#FF0000,0:0:0:1".
pub fn parse_color(s: &str) -> Result<TextColor, String> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix('#') {
        return parse_hex_rgb(hex);
    }
    if s.contains(':') {
        let parts = s.split(':').map(|v| v.trim().parse::<f32>()).collect::<Result<Vec<f32>, _>>()
            .map_err(|e| format!("invalid color {:?}: {}", s, e))?;
        if let [c, m, y, k] = parts[..] {
            return Ok(TextColor::Cmyk(c, m, y, k));
        }
        return Err(format!("invalid color {:?} (expected 4 colon-separated CMYK values, e.g. \"0:0:0:1\")", s));
    }
    parse_hex_rgb(s)
}

fn parse_hex_rgb(s: &str) -> Result<TextColor, String> {
    if s.len() != 6 {
        return Err(format!("invalid color {:?} (expected hex \"#RRGGBB\" or 4 comma-separated CMYK values)", s));
    }
    let component = |slice: &str| -> Result<f32, String> {
        u8::from_str_radix(slice, 16)
            .map(|v| v as f32 / 255.0)
            .map_err(|e| format!("invalid color {:?}: {}", s, e))
    };
    Ok(TextColor::Rgb(component(&s[0..2])?, component(&s[2..4])?, component(&s[4..6])?))
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

fn to_f64(obj: &Object) -> f64 {
    match obj {
        Object::Real(v) => *v as f64,
        Object::Integer(v) => *v as f64,
        _ => 0.0,
    }
}

// Measure the total length (in the content stream's own unit space) of every
// stroked path (S, s, B, B*, b, b*) in a content stream, applying any CTM
// changes (q/Q/cm) along the way. Curve segments are measured with kurbo's
// adaptive arc-length quadrature. Filled-only paths (f, f*, F, n) and
// clipping paths (W, W*) are not counted.
fn measure_stroke_length(content_bytes: &[u8]) -> Result<f32, Box<dyn std::error::Error>> {
    const ACCURACY: f64 = 1e-3;

    let content = Content::decode(content_bytes)?;
    let mut ctm_stack: Vec<Affine> = vec![Affine::IDENTITY];
    let mut current_point = Point::ZERO;
    let mut subpath_start = Point::ZERO;
    let mut subpaths: Vec<BezPath> = Vec::new();
    let mut total = 0.0f64;

    let pt = |op: &Operation, i: usize| -> Point {
        Point::new(to_f64(&op.operands[i]), to_f64(&op.operands[i + 1]))
    };

    for op in &content.operations {
        let ctm = *ctm_stack.last().unwrap();
        match op.operator.as_str() {
            "q" => ctm_stack.push(ctm),
            "Q" => {
                if ctm_stack.len() > 1 {
                    ctm_stack.pop();
                }
            }
            "cm" => {
                let m = Affine::new([
                    to_f64(&op.operands[0]), to_f64(&op.operands[1]),
                    to_f64(&op.operands[2]), to_f64(&op.operands[3]),
                    to_f64(&op.operands[4]), to_f64(&op.operands[5]),
                ]);
                *ctm_stack.last_mut().unwrap() = ctm * m;
            }
            "m" => {
                let p = pt(op, 0);
                current_point = p;
                subpath_start = p;
                let mut bp = BezPath::new();
                bp.move_to(ctm * p);
                subpaths.push(bp);
            }
            "l" => {
                let p = pt(op, 0);
                if let Some(sp) = subpaths.last_mut() {
                    sp.line_to(ctm * p);
                }
                current_point = p;
            }
            "c" => {
                let (p1, p2, p3) = (pt(op, 0), pt(op, 2), pt(op, 4));
                if let Some(sp) = subpaths.last_mut() {
                    sp.curve_to(ctm * p1, ctm * p2, ctm * p3);
                }
                current_point = p3;
            }
            "v" => {
                let (p2, p3) = (pt(op, 0), pt(op, 2));
                let p1 = current_point;
                if let Some(sp) = subpaths.last_mut() {
                    sp.curve_to(ctm * p1, ctm * p2, ctm * p3);
                }
                current_point = p3;
            }
            "y" => {
                let (p1, p3) = (pt(op, 0), pt(op, 2));
                if let Some(sp) = subpaths.last_mut() {
                    sp.curve_to(ctm * p1, ctm * p3, ctm * p3);
                }
                current_point = p3;
            }
            "h" => {
                if let Some(sp) = subpaths.last_mut() {
                    sp.close_path();
                }
                current_point = subpath_start;
            }
            "re" => {
                let x = to_f64(&op.operands[0]);
                let y = to_f64(&op.operands[1]);
                let w = to_f64(&op.operands[2]);
                let h = to_f64(&op.operands[3]);
                let mut bp = BezPath::new();
                bp.move_to(ctm * Point::new(x, y));
                bp.line_to(ctm * Point::new(x + w, y));
                bp.line_to(ctm * Point::new(x + w, y + h));
                bp.line_to(ctm * Point::new(x, y + h));
                bp.close_path();
                subpaths.push(bp);
                current_point = Point::new(x, y);
                subpath_start = Point::new(x, y);
            }
            "S" | "s" | "B" | "B*" | "b" | "b*" => {
                let closes = matches!(op.operator.as_str(), "s" | "b" | "b*");
                for sp in &mut subpaths {
                    if closes {
                        sp.close_path();
                    }
                    for seg in sp.segments() {
                        total += seg.arclen(ACCURACY);
                    }
                }
                subpaths.clear();
            }
            "f" | "F" | "f*" | "n" | "W" | "W*" => {
                subpaths.clear();
            }
            _ => {}
        }
    }

    Ok(total as f32)
}

// Generate a print or contour PDF in memory.
//
// `csv_data` is the raw CSV text (one label per row); required unless
// `opts.contour` is set, in which case it is ignored. `background_bytes` is
// the source PDF whose first page is tiled across the host sheet.
// `contour_background_bytes` is required when `opts.combine` is set: its
// first page is drawn as a non-printable overlay layer on every print page,
// at the same grid positions, so print/contour alignment can be checked.
pub fn generate_pdf(csv_data: Option<&str>, background_bytes: &[u8], contour_background_bytes: Option<&[u8]>, opts: &Options) -> Result<GenerateOutput, Box<dyn std::error::Error>> {
    // Load background PDF
    let mut doc = Document::load_mem(background_bytes)?;

    // Get background page
    let pages = doc.get_pages();
    let (_, bg_page_id) = pages.iter().next().ok_or("No pages in background PDF")?;
    let bg_page_obj = doc.get_object(*bg_page_id)?;
    let bg_page_dict = bg_page_obj.as_dict()?;
    let media_box_obj = bg_page_dict.get(b"MediaBox")?;
    let media_box_orig = media_box_obj.as_array()?.clone();

    let card_w = match &media_box_orig[2] {
        Object::Integer(w) => *w as f32,
        Object::Real(w) => *w,
        _ => 595.0,
    };
    let card_h = match &media_box_orig[3] {
        Object::Integer(h) => *h as f32,
        Object::Real(h) => *h,
        _ => 842.0,
    };

    // Card BBox as Real values for consistency
    let card_box = vec![
        Object::Real(0.0),
        Object::Real(0.0),
        Object::Real(card_w),
        Object::Real(card_h),
    ];

    // Get background content bytes for XObject
    let bg_content_bytes = doc.get_page_content(*bg_page_id)?;

    // Create Form XObject for background
    let mut bg_xobj_dict = Dictionary::new();
    bg_xobj_dict.set("Type", Object::Name(b"XObject".to_vec()));
    bg_xobj_dict.set("Subtype", Object::Name(b"Form".to_vec()));
    bg_xobj_dict.set("BBox", Object::Array(card_box.clone()));
    if let Ok(resources) = bg_page_dict.get(b"Resources") {
        bg_xobj_dict.set("Resources", resources.clone());
    }
    let bg_form = Stream::new(bg_xobj_dict, bg_content_bytes.clone());
    let bg_form_id = doc.add_object(bg_form);

    // Compute grid layout on the host page.
    let host_w = opts.host_width_mm * MM;
    let host_h = opts.host_height_mm * MM;
    let gutter_x = opts.offset_x_mm * MM;
    let gutter_y = opts.offset_y_mm * MM;
    let circle_r = opts.circle_diameter_mm * MM / 2.0;

    // Each edge of the host page is touched by a registration circle, so the
    // grid is laid out within the area remaining after insetting every edge
    // by one circle diameter.
    let circle_d = circle_r * 2.0;
    let available_w = host_w - 2.0 * circle_d;
    let available_h = host_h - 2.0 * circle_d;

    let cols = (((available_w + gutter_x) / (card_w + gutter_x)).floor().max(1.0)) as usize;
    let rows = (((available_h + gutter_y) / (card_h + gutter_y)).floor().max(1.0)) as usize;
    let cards_per_page = cols * rows;

    let total_w = cols as f32 * card_w + (cols as f32 - 1.0) * gutter_x;
    let total_h = rows as f32 * card_h + (rows as f32 - 1.0) * gutter_y;
    let start_x = circle_d + (available_w - total_w) / 2.0;
    let start_y = circle_d + (available_h - total_h) / 2.0;

    let host_box = vec![
        Object::Real(0.0),
        Object::Real(0.0),
        Object::Real(host_w),
        Object::Real(host_h),
    ];

    // Resolve the font(s) used for label text. If none are supplied, fall
    // back to the bundled Montserrat Bold. A single font is used for every
    // word; otherwise each word position uses its own font by index.
    let font_bytes_list: Vec<&[u8]> = if opts.font_data.is_empty() {
        vec![MONTSERRAT_BOLD_TTF]
    } else {
        opts.font_data.iter().map(|v| v.as_slice()).collect()
    };

    struct EmbeddedFont<'a> {
        face: Face<'a>,
        units_per_em: i32,
        font_id: lopdf::ObjectId,
        resource_name: Vec<u8>,
    }

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

    // Get pages root
    let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    let catalog = doc.get_object(catalog_id)?;
    let pages_id = catalog.as_dict()?.get(b"Pages").unwrap().as_reference()?;

    // Remove the original background page from the page tree, since its
    // content is now reused as the BG XObject on every generated card.
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

    // If requested, lay out a single host page using the grid (same
    // dimensions, offsets and registration circles), with every cell showing
    // just the background and no label text.
    if opts.contour {
        let (path_length_per_card_mm, path_length_total_mm) = if opts.measure_paths {
            let per_card_pt = measure_stroke_length(&bg_content_bytes)?;
            let per_card_mm = per_card_pt / MM;
            let total_mm = per_card_mm * cards_per_page as f32;
            (Some(per_card_mm), Some(total_mm))
        } else {
            (None, None)
        };

        let mut operations = Vec::new();

        for i in 0..cards_per_page {
            let col = i % cols;
            let row = i / cols;
            // Serpentine layout: even rows are laid out from the right edge
            // of the host page (column order reversed).
            let visual_col = if row % 2 == 1 { cols - 1 - col } else { col };
            let x = start_x + visual_col as f32 * (card_w + gutter_x);
            let y = start_y + row as f32 * (card_h + gutter_y);

            operations.push(Operation::new("q", vec![]));
            operations.push(Operation::new("cm", vec![
                Object::Real(1.0), Object::Real(0.0),
                Object::Real(0.0), Object::Real(1.0),
                Object::Real(x), Object::Real(y),
            ]));
            operations.push(Operation::new("Do", vec![Object::Name(b"BG".to_vec())]));
            operations.push(Operation::new("Q", vec![]));
        }

        // Registration circles: top-left, bottom-right, bottom-left, inset by radius.
        operations.extend(circle_ops(circle_r, host_h - circle_r, circle_r));
        operations.extend(circle_ops(host_w - circle_r, circle_r, circle_r));
        operations.extend(circle_ops(circle_r, circle_r, circle_r));

        let content = Content { operations };
        let content_stream = Stream::new(Dictionary::new(), content.encode()?);
        let content_id = doc.add_object(content_stream);

        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(pages_id));
        page_dict.set("MediaBox", Object::Array(host_box.clone()));
        page_dict.set("Contents", Object::Reference(content_id));
        page_dict.set("Resources", Object::Dictionary({
            let mut res = Dictionary::new();
            res.set("XObject", Object::Dictionary({
                let mut xobjs = Dictionary::new();
                xobjs.set("BG", Object::Reference(bg_form_id));
                xobjs
            }));
            res
        }));

        let page_id = doc.add_object(Object::Dictionary(page_dict));

        let pages_obj = doc.get_object(pages_id)?;
        let pages_dict_orig = pages_obj.as_dict()?;
        let mut kids = pages_dict_orig.get(b"Kids").unwrap().as_array()?.clone();
        kids.push(Object::Reference(page_id));
        let mut pages_dict = pages_dict_orig.clone();
        pages_dict.set("Kids", Object::Array(kids));
        pages_dict.set("Count", Object::Integer(1));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

        let mut pdf = Vec::new();
        doc.save_to(&mut pdf)?;
        return Ok(GenerateOutput { pdf, cards_per_page, path_length_per_card_mm, path_length_total_mm });
    }

    // Load CSV
    let csv_data = csv_data.ok_or("csv data is required unless contour is set")?;
    let mut rdr = ReaderBuilder::new()
        .has_headers(false)
        .from_reader(csv_data.as_bytes());

    let kerning_adjustment = 0.3;
    let y_positions: Vec<f32> = opts.text_y_mm.iter().map(|y| y * MM).collect();

    // Build a Form XObject for each card (background + label text).
    let mut card_ids = Vec::new();
    for result in rdr.records() {
        let txt = result?.get(0).ok_or("Missing CSV field")?.to_string();
        let texts: Vec<&str> = txt.split(' ').collect();

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

        let mut operations = Vec::new();
        for (idx, text) in texts.iter().enumerate() {
            let font_size = opts.font_sizes[idx];
            let font_idx = if embedded_fonts.len() == 1 { 0 } else { idx };
            let ef = &embedded_fonts[font_idx];
            let align_idx = if opts.align.len() == 1 { 0 } else { idx };
            let align = opts.align[align_idx];
            // Draw background XObject
            operations.push(Operation::new("Do", vec![Object::Name(b"BG".to_vec())]));

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
            operations.push(Operation::new("Td", vec![Object::Real(x), Object::Real(y)]));
            operations.push(Operation::new("Tj", vec![Object::String(text.as_bytes().to_vec(), lopdf::StringFormat::Literal)]));
            operations.push(Operation::new("ET", vec![]));
            operations.push(Operation::new("Q", vec![])); // restore

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
                for f in &embedded_fonts {
                    fonts.set(f.resource_name.clone(), Object::Reference(f.font_id));
                }
                fonts
            }));
            res.set("XObject", Object::Dictionary({
                let mut xobjs = Dictionary::new();
                xobjs.set("BG", Object::Reference(bg_form_id));
                xobjs
            }));
            res
        }));

        let card_form = Stream::new(card_dict, content_data);
        let card_id = doc.add_object(card_form);
        card_ids.push(card_id);
    }

    // If requested, build a non-printable overlay layer showing the contour
    // grid (background tiles + registration circles) at the same positions
    // as the print grid, so print/contour alignment can be checked visually.
    let overlay = if opts.combine {
        let contour_bytes = contour_background_bytes.ok_or("--combineb requires a contour background PDF")?;
        let contour_doc = Document::load_mem(contour_bytes)?;
        let contour_pages = contour_doc.get_pages();
        let (_, contour_page_id) = contour_pages.iter().next().ok_or("No pages in contour background PDF")?;
        let contour_page_obj = contour_doc.get_object(*contour_page_id)?;
        let contour_page_dict = contour_page_obj.as_dict()?;
        let contour_media_box = contour_page_dict.get(b"MediaBox")?.as_array()?.clone();

        let card_w_c = match &contour_media_box[2] {
            Object::Integer(w) => *w as f32,
            Object::Real(w) => *w,
            _ => card_w,
        };
        let card_h_c = match &contour_media_box[3] {
            Object::Integer(h) => *h as f32,
            Object::Real(h) => *h,
            _ => card_h,
        };
        let card_box_c = vec![Object::Real(0.0), Object::Real(0.0), Object::Real(card_w_c), Object::Real(card_h_c)];

        let contour_content_bytes = contour_doc.get_page_content(*contour_page_id)?;

        let mut id_map = std::collections::HashMap::new();
        let mut bg_xobj_dict_c = Dictionary::new();
        bg_xobj_dict_c.set("Type", Object::Name(b"XObject".to_vec()));
        bg_xobj_dict_c.set("Subtype", Object::Name(b"Form".to_vec()));
        bg_xobj_dict_c.set("BBox", Object::Array(card_box_c));
        if let Ok(resources) = contour_page_dict.get(b"Resources") {
            let imported = import_object(&contour_doc, &mut doc, resources, &mut id_map);
            bg_xobj_dict_c.set("Resources", imported);
        }
        let bg_form_c = Stream::new(bg_xobj_dict_c, contour_content_bytes);
        let bg_form_c_id = doc.add_object(bg_form_c);

        // Draw the contour background at every card position, plus the
        // registration circles, exactly as `--contour` would lay them out.
        let mut operations = Vec::new();
        for i in 0..cards_per_page {
            let col = i % cols;
            let row = i / cols;
            let x = start_x + col as f32 * (card_w + gutter_x);
            let y = start_y + row as f32 * (card_h + gutter_y);

            operations.push(Operation::new("q", vec![]));
            operations.push(Operation::new("cm", vec![
                Object::Real(1.0), Object::Real(0.0),
                Object::Real(0.0), Object::Real(1.0),
                Object::Real(x), Object::Real(y),
            ]));
            operations.push(Operation::new("Do", vec![Object::Name(b"BGC".to_vec())]));
            operations.push(Operation::new("Q", vec![]));
        }
        operations.extend(circle_ops(circle_r, host_h - circle_r, circle_r));
        operations.extend(circle_ops(host_w - circle_r, circle_r, circle_r));
        operations.extend(circle_ops(circle_r, circle_r, circle_r));

        let overlay_content = Content { operations };
        let mut overlay_dict = Dictionary::new();
        overlay_dict.set("Type", Object::Name(b"XObject".to_vec()));
        overlay_dict.set("Subtype", Object::Name(b"Form".to_vec()));
        overlay_dict.set("BBox", Object::Array(host_box.clone()));
        overlay_dict.set("Resources", Object::Dictionary({
            let mut res = Dictionary::new();
            res.set("XObject", Object::Dictionary({
                let mut xobjs = Dictionary::new();
                xobjs.set("BGC", Object::Reference(bg_form_c_id));
                xobjs
            }));
            res
        }));
        let overlay_form = Stream::new(overlay_dict, overlay_content.encode()?);
        let overlay_id = doc.add_object(overlay_form);

        // Optional Content Group marking the overlay as visible on screen
        // but excluded when printing.
        let mut ocg_dict = Dictionary::new();
        ocg_dict.set("Type", Object::Name(b"OCG".to_vec()));
        ocg_dict.set("Name", Object::String(b"Contour overlay (non-printable)".to_vec(), lopdf::StringFormat::Literal));
        ocg_dict.set("Usage", Object::Dictionary({
            let mut usage = Dictionary::new();
            usage.set("Print", Object::Dictionary({
                let mut print = Dictionary::new();
                print.set("PrintState", Object::Name(b"OFF".to_vec()));
                print
            }));
            usage.set("View", Object::Dictionary({
                let mut view = Dictionary::new();
                view.set("ViewState", Object::Name(b"ON".to_vec()));
                view
            }));
            usage
        }));
        let ocg_id = doc.add_object(Object::Dictionary(ocg_dict));

        let mut catalog_dict = doc.get_object(catalog_id)?.as_dict()?.clone();
        catalog_dict.set("OCProperties", Object::Dictionary({
            let mut ocp = Dictionary::new();
            ocp.set("OCGs", Object::Array(vec![Object::Reference(ocg_id)]));
            ocp.set("D", Object::Dictionary({
                let mut d = Dictionary::new();
                d.set("Name", Object::String(b"Default".to_vec(), lopdf::StringFormat::Literal));
                d.set("BaseState", Object::Name(b"ON".to_vec()));
                d.set("ON", Object::Array(vec![Object::Reference(ocg_id)]));
                d.set("OFF", Object::Array(vec![]));
                d.set("AS", Object::Array(vec![Object::Dictionary({
                    let mut as_dict = Dictionary::new();
                    as_dict.set("Event", Object::Name(b"Print".to_vec()));
                    as_dict.set("OCGs", Object::Array(vec![Object::Reference(ocg_id)]));
                    as_dict.set("Category", Object::Array(vec![Object::Name(b"Print".to_vec())]));
                    as_dict
                })]));
                d.set("Order", Object::Array(vec![Object::Reference(ocg_id)]));
                d
            }));
            ocp
        }));
        doc.objects.insert(catalog_id, Object::Dictionary(catalog_dict));

        Some((overlay_id, ocg_id))
    } else {
        None
    };

    // Lay out card XObjects on host pages.
    for chunk in card_ids.chunks(cards_per_page) {
        let mut operations = Vec::new();
        let mut xobjects = Dictionary::new();

        for (i, card_id) in chunk.iter().enumerate() {
            let col = i % cols;
            let row = i / cols;
            let x = start_x + col as f32 * (card_w + gutter_x);
            let y = start_y + row as f32 * (card_h + gutter_y);

            let name = format!("C{}", i);
            operations.push(Operation::new("q", vec![]));
            operations.push(Operation::new("cm", vec![
                Object::Real(1.0), Object::Real(0.0),
                Object::Real(0.0), Object::Real(1.0),
                Object::Real(x), Object::Real(y),
            ]));
            operations.push(Operation::new("Do", vec![Object::Name(name.clone().into_bytes())]));
            operations.push(Operation::new("Q", vec![]));

            xobjects.set(name, Object::Reference(*card_id));
        }

        // Registration circles: top-left, bottom-right, bottom-left, inset by radius.
        operations.extend(circle_ops(circle_r, host_h - circle_r, circle_r));
        operations.extend(circle_ops(host_w - circle_r, circle_r, circle_r));
        operations.extend(circle_ops(circle_r, circle_r, circle_r));

        let mut properties = Dictionary::new();
        if let Some((overlay_id, ocg_id)) = overlay {
            xobjects.set("OV", Object::Reference(overlay_id));
            properties.set("MC0", Object::Reference(ocg_id));

            operations.push(Operation::new("q", vec![]));
            operations.push(Operation::new("BDC", vec![Object::Name(b"OC".to_vec()), Object::Name(b"MC0".to_vec())]));
            operations.push(Operation::new("Do", vec![Object::Name(b"OV".to_vec())]));
            operations.push(Operation::new("EMC", vec![]));
            operations.push(Operation::new("Q", vec![]));
        }

        let content = Content { operations };
        let content_data = content.encode()?;
        let content_stream = Stream::new(Dictionary::new(), content_data);
        let content_id = doc.add_object(content_stream);

        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(pages_id));
        page_dict.set("MediaBox", Object::Array(host_box.clone()));
        page_dict.set("Contents", Object::Reference(content_id));
        page_dict.set("Resources", Object::Dictionary({
            let mut res = Dictionary::new();
            res.set("XObject", Object::Dictionary(xobjects));
            if !properties.is_empty() {
                res.set("Properties", Object::Dictionary(properties));
            }
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
    let mut pdf = Vec::new();
    doc.save_to(&mut pdf)?;

    Ok(GenerateOutput { pdf, cards_per_page, path_length_per_card_mm: None, path_length_total_mm: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    static BACKGROUND_PDF: &[u8] = include_bytes!("../15x15.pdf");

    #[test]
    fn parse_color_rgb_hex_with_hash() {
        match parse_color("#FF0000").unwrap() {
            TextColor::Rgb(r, g, b) => {
                assert!((r - 1.0).abs() < 1e-6);
                assert!((g - 0.0).abs() < 1e-6);
                assert!((b - 0.0).abs() < 1e-6);
            }
            _ => panic!("expected RGB"),
        }
    }

    #[test]
    fn parse_color_rgb_hex_without_hash() {
        match parse_color("00FF00").unwrap() {
            TextColor::Rgb(r, g, b) => {
                assert!((r - 0.0).abs() < 1e-6);
                assert!((g - 1.0).abs() < 1e-6);
                assert!((b - 0.0).abs() < 1e-6);
            }
            _ => panic!("expected RGB"),
        }
    }

    #[test]
    fn parse_color_cmyk() {
        match parse_color("0:0:0:1").unwrap() {
            TextColor::Cmyk(c, m, y, k) => {
                assert_eq!((c, m, y, k), (0.0, 0.0, 0.0, 1.0));
            }
            _ => panic!("expected CMYK"),
        }
    }

    #[test]
    fn parse_color_invalid_hex_length() {
        assert!(parse_color("#FF00").is_err());
    }

    #[test]
    fn parse_color_invalid_hex_digits() {
        assert!(parse_color("#GGGGGG").is_err());
    }

    #[test]
    fn parse_color_invalid_cmyk_component_count() {
        assert!(parse_color("0:0:0").is_err());
    }

    #[test]
    fn parse_color_invalid_cmyk_value() {
        assert!(parse_color("0:0:0:not-a-number").is_err());
    }

    #[test]
    fn text_align_from_str() {
        assert!(matches!("left".parse::<TextAlign>(), Ok(TextAlign::Left)));
        assert!(matches!("center".parse::<TextAlign>(), Ok(TextAlign::Center)));
        assert!(matches!("right".parse::<TextAlign>(), Ok(TextAlign::Right)));
        assert!("middle".parse::<TextAlign>().is_err());
    }

    #[test]
    fn options_as_contour_sets_contour_and_preserves_other_fields() {
        let opts = Options { host_width_mm: 123.0, ..Options::default() };
        assert!(!opts.contour);

        let contour_opts = opts.as_contour();
        assert!(contour_opts.contour);
        assert_eq!(contour_opts.host_width_mm, 123.0);
    }

    #[test]
    fn generate_contour_pdf() {
        let opts = Options { contour: true, ..Options::default() };
        let out = generate_pdf(None, BACKGROUND_PDF, None, &opts).expect("contour generation should succeed");

        assert!(out.pdf.starts_with(b"%PDF"));
        assert!(out.cards_per_page >= 1);
    }

    #[test]
    fn generate_print_pdf() {
        let opts = Options::default();
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts).expect("print generation should succeed");

        assert!(out.pdf.starts_with(b"%PDF"));
        assert!(out.cards_per_page >= 1);
    }

    #[test]
    fn generate_print_pdf_requires_csv_data_unless_contour() {
        let opts = Options::default();
        let err = generate_pdf(None, BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("csv data is required"));
    }

    #[test]
    fn generate_print_pdf_rejects_too_many_words() {
        let opts = Options { font_sizes: vec![9.0], text_y_mm: vec![10.0], ..Options::default() };
        let err = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts).unwrap_err();
        assert!(err.to_string().contains("word(s)"));
    }

    #[test]
    fn generate_print_pdf_with_combine_overlay() {
        let opts = Options { combine: true, ..Options::default() };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, Some(BACKGROUND_PDF), &opts)
            .expect("combine generation should succeed");

        assert!(out.pdf.starts_with(b"%PDF"));
    }

    #[test]
    fn generate_print_pdf_with_styling_options() {
        let opts = Options {
            align: vec![TextAlign::Left, TextAlign::Right],
            text_colors: vec![
                parse_color("#FF0000").unwrap(),
                parse_color("0:0:0:1").unwrap(),
            ],
            text_rotations: vec![15.0],
            text_flip_x: vec![true, false],
            text_flip_y: vec![false, true],
            debug: true,
            safe_margin_mm: 5.0,
            ..Options::default()
        };
        let out = generate_pdf(Some("1A 1\n"), BACKGROUND_PDF, None, &opts)
            .expect("styled generation should succeed");

        assert!(out.pdf.starts_with(b"%PDF"));
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;

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
    ) -> Result<WasmGenerateOutput, JsError> {
        let align = align.iter()
            .map(|s| s.parse::<TextAlign>())
            .collect::<Result<Vec<TextAlign>, String>>()
            .map_err(|e| JsError::new(&e))?;

        let text_colors = text_colors.iter()
            .map(|s| parse_color(s))
            .collect::<Result<Vec<TextColor>, String>>()
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
}
