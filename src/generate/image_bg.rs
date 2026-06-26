use lopdf::{content::Content, content::Operation, Dictionary, Document, Object, Stream};

// Build a minimal one-page PDF sized `card_w` x `card_h` (in PDF points,
// matching the print background's card size) that draws `image_bytes` (a PNG or
// JPEG) stretched to fill the page. The image is embedded losslessly as a
// FlateDecode Image XObject: a grayscale image stays DeviceGray, anything else
// is composited over white (alpha dropped) into DeviceRGB. Used as a generated
// print background built from a raster image (the "Crează fundal" feature); the
// result is fed through the same pipeline as an uploaded background PDF.
pub fn build_image_background_pdf(
    image_bytes: &[u8],
    card_w: f32,
    card_h: f32,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    // Format is detected from the magic bytes; only the png + jpeg codecs are
    // compiled in (see Cargo.toml), so other formats fail here with an error.
    let img = image::load_from_memory(image_bytes)?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return Err("image has zero dimensions".into());
    }

    // Choose the color space + raw 8-bit samples. Grayscale-without-alpha maps
    // to DeviceGray (1 sample/px); everything else is flattened over white and
    // emitted as DeviceRGB (3 samples/px).
    let (color_space, samples): (&[u8], Vec<u8>) = match &img {
        image::DynamicImage::ImageLuma8(buf) => (b"DeviceGray", buf.as_raw().clone()),
        _ => (b"DeviceRGB", flatten_over_white(&img)),
    };

    let mut xobj_dict = Dictionary::new();
    xobj_dict.set("Type", Object::Name(b"XObject".to_vec()));
    xobj_dict.set("Subtype", Object::Name(b"Image".to_vec()));
    xobj_dict.set("Width", Object::Integer(w as i64));
    xobj_dict.set("Height", Object::Integer(h as i64));
    xobj_dict.set("ColorSpace", Object::Name(color_space.to_vec()));
    xobj_dict.set("BitsPerComponent", Object::Integer(8));

    // No `/Filter` is set, so `compress()` deflates the raw samples and stamps
    // `/Filter /FlateDecode` — a valid, lossless image stream.
    let mut image_stream = Stream::new(xobj_dict, samples);
    image_stream.compress()?;

    build_single_page_image_pdf(card_w, card_h, image_stream)
}

// Composite any image over a white background and return tightly packed RGB8
// samples (row-major, 3 bytes/px). Alpha is flattened so transparent regions
// print white (cards print on white stock and the preview's SVG backdrop is
// white); no `/SMask` is emitted.
fn flatten_over_white(img: &image::DynamicImage) -> Vec<u8> {
    let rgba = img.to_rgba8();
    let mut out = Vec::with_capacity((rgba.width() as usize) * (rgba.height() as usize) * 3);
    for px in rgba.pixels() {
        let [r, g, b, a] = px.0;
        let a = a as u32;
        // `c` over white: (c*a + 255*(255-a)) / 255, rounded toward zero.
        let blend = |c: u8| (((c as u32) * a + 255 * (255 - a)) / 255) as u8;
        out.push(blend(r));
        out.push(blend(g));
        out.push(blend(b));
    }
    out
}

// Assemble a one-page PDF (MediaBox `card_w` x `card_h`) whose content draws the
// given image XObject stretched to fill the page. Mirrors
// `shapes::build_single_page_pdf` but wires the image into `/Resources`.
fn build_single_page_image_pdf(
    card_w: f32,
    card_h: f32,
    image_stream: Stream,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    let image_id = doc.add_object(image_stream);

    // The `cm` maps the image's 1x1 unit space onto the full MediaBox, so the
    // image stretches to exactly fill the card (same model as `simple`/uploaded
    // backgrounds, which define the card size by their page box).
    let operations = vec![
        Operation::new("q", vec![]),
        Operation::new(
            "cm",
            vec![
                Object::Real(card_w),
                Object::Real(0.0),
                Object::Real(0.0),
                Object::Real(card_h),
                Object::Real(0.0),
                Object::Real(0.0),
            ],
        ),
        Operation::new("Do", vec![Object::Name(b"Im0".to_vec())]),
        Operation::new("Q", vec![]),
    ];
    let content = Content { operations };
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content.encode()?));

    let mut xobjects = Dictionary::new();
    xobjects.set("Im0", Object::Reference(image_id));
    let mut resources = Dictionary::new();
    resources.set("XObject", Object::Dictionary(xobjects));

    let media_box = vec![
        Object::Real(0.0),
        Object::Real(0.0),
        Object::Real(card_w),
        Object::Real(card_h),
    ];

    let mut page_dict = Dictionary::new();
    page_dict.set("Type", Object::Name(b"Page".to_vec()));
    page_dict.set("Parent", Object::Reference(pages_id));
    page_dict.set("Contents", Object::Reference(content_id));
    page_dict.set("Resources", Object::Dictionary(resources));
    page_dict.set("MediaBox", Object::Array(media_box));
    let page_id = doc.add_object(Object::Dictionary(page_dict));

    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
    pages_dict.set("Count", Object::Integer(1));
    doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

    let mut catalog_dict = Dictionary::new();
    catalog_dict.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog_dict.set("Pages", Object::Reference(pages_id));
    let catalog_id = doc.add_object(Object::Dictionary(catalog_dict));

    doc.trailer.set("Root", Object::Reference(catalog_id));

    let mut buf = Vec::new();
    doc.save_to(&mut buf)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::MM;
    use std::io::Cursor;

    fn encode(img: image::DynamicImage, format: image::ImageFormat) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        img.write_to(&mut buf, format).expect("encode should succeed");
        buf.into_inner()
    }

    // Fetch the single page's dictionary and its embedded Im0 image stream.
    fn page_and_image(pdf: &[u8]) -> (Document, lopdf::ObjectId) {
        let doc = Document::load_mem(pdf).expect("output should be a valid PDF");
        let pages = doc.get_pages();
        assert_eq!(pages.len(), 1, "exactly one page expected");
        let (_, page_id) = pages.into_iter().next().unwrap();
        (doc, page_id)
    }

    fn image_stream<'a>(doc: &'a Document, page_id: lopdf::ObjectId) -> &'a Stream {
        let page = doc.get_object(page_id).unwrap().as_dict().unwrap();
        let res = page.get(b"Resources").unwrap().as_dict().unwrap();
        let xobjs = res.get(b"XObject").unwrap().as_dict().unwrap();
        let im_ref = xobjs.get(b"Im0").unwrap().as_reference().unwrap();
        doc.get_object(im_ref).unwrap().as_stream().unwrap()
    }

    fn num(o: &Object) -> f32 {
        match o {
            Object::Real(v) => *v,
            Object::Integer(v) => *v as f32,
            _ => panic!("expected a number"),
        }
    }

    #[test]
    fn rgb_png_embeds_devicergb_flate_image_at_card_size() {
        // 64x64 solid so the samples compress (compress() only sets /Filter when
        // it actually saves bytes — tiny images stay valid-but-uncompressed).
        let img = image::RgbaImage::from_pixel(64, 64, image::Rgba([200, 80, 40, 255]));
        let png = encode(image::DynamicImage::ImageRgba8(img), image::ImageFormat::Png);

        let (card_w, card_h) = (86.0 * MM, 54.0 * MM);
        let pdf = build_image_background_pdf(&png, card_w, card_h).expect("should build");
        assert!(pdf.starts_with(b"%PDF"));

        let (doc, page_id) = page_and_image(&pdf);
        let page = doc.get_object(page_id).unwrap().as_dict().unwrap();
        let mb = page.get(b"MediaBox").unwrap().as_array().unwrap();
        assert!((num(&mb[2]) - card_w).abs() < 0.01);
        assert!((num(&mb[3]) - card_h).abs() < 0.01);

        let im = image_stream(&doc, page_id);
        assert_eq!(im.dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Image");
        assert_eq!(im.dict.get(b"Width").unwrap().as_i64().unwrap(), 64);
        assert_eq!(im.dict.get(b"Height").unwrap().as_i64().unwrap(), 64);
        assert_eq!(im.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceRGB");
        assert_eq!(im.dict.get(b"BitsPerComponent").unwrap().as_i64().unwrap(), 8);
        assert_eq!(im.dict.get(b"Filter").unwrap().as_name().unwrap(), b"FlateDecode");
    }

    #[test]
    fn grayscale_png_uses_devicegray() {
        let img = image::GrayImage::from_pixel(64, 64, image::Luma([128]));
        let png = encode(image::DynamicImage::ImageLuma8(img), image::ImageFormat::Png);

        let pdf = build_image_background_pdf(&png, 100.0, 100.0).expect("should build");
        let (doc, page_id) = page_and_image(&pdf);
        let im = image_stream(&doc, page_id);
        assert_eq!(im.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceGray");
    }

    #[test]
    fn jpeg_decodes_and_re_embeds_as_devicergb() {
        let img = image::RgbImage::from_pixel(32, 32, image::Rgb([200, 50, 50]));
        let jpeg = encode(image::DynamicImage::ImageRgb8(img), image::ImageFormat::Jpeg);

        let pdf = build_image_background_pdf(&jpeg, 50.0, 50.0).expect("should build");
        let (doc, page_id) = page_and_image(&pdf);
        let im = image_stream(&doc, page_id);
        assert_eq!(im.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceRGB");
        assert_eq!(im.dict.get(b"Filter").unwrap().as_name().unwrap(), b"FlateDecode");
    }

    #[test]
    fn transparent_pixels_flatten_to_white() {
        // A fully transparent image must composite to white (255,255,255). A 1x1
        // image won't compress, so its samples are stored raw — read directly.
        let img = image::RgbaImage::from_pixel(1, 1, image::Rgba([10, 20, 30, 0]));
        let png = encode(image::DynamicImage::ImageRgba8(img), image::ImageFormat::Png);

        let pdf = build_image_background_pdf(&png, 50.0, 50.0).expect("should build");
        let (doc, page_id) = page_and_image(&pdf);
        let im = image_stream(&doc, page_id);
        assert_eq!(im.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceRGB");
        assert!(im.dict.get(b"Filter").is_err(), "1x1 stays uncompressed (raw samples)");
        assert_eq!(im.content, vec![255, 255, 255], "transparent pixel flattens to white");
    }

    #[test]
    fn rejects_non_image_bytes() {
        assert!(build_image_background_pdf(b"not an image at all", 50.0, 50.0).is_err());
    }
}
