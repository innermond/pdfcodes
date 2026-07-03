use image::ImageDecoder; // brings the `orientation()` method into scope
use lopdf::{content::Content, content::Operation, Dictionary, Document, Object, Stream};

// Build a minimal one-page PDF sized `card_w` x `card_h` (in PDF points,
// matching the print background's card size) that draws `image_bytes` (a PNG or
// JPEG) stretched to fill the page. The image is embedded losslessly as a
// FlateDecode Image XObject. Used as a generated print background built from a
// raster image (the "Crează fundal" feature); the result is fed through the same
// pipeline as an uploaded background PDF.
//
// Transparency handling depends on `backdrop`:
// - `None` — a grayscale image stays DeviceGray; anything with real transparency
//   keeps straight (unpremultiplied) DeviceRGB color plus a DeviceGray `/SMask`,
//   so the exported PDF retains its alpha; fully-opaque color images are DeviceRGB.
// - `Some([r, g, b])` — transparent pixels are composited over that color into an
//   opaque DeviceRGB image with no `/SMask`, so the chosen backdrop is baked in.
pub fn build_image_background_pdf(
    image_bytes: &[u8],
    card_w: f32,
    card_h: f32,
    // Mirror the image horizontally / vertically (baked into the draw matrix so
    // the preview and generated output stay identical). Applied after EXIF
    // orientation, before any downstream page rotation.
    flip_x: bool,
    flip_y: bool,
    // Optional solid RGB backdrop composited under the image (fills transparent
    // regions); `None` preserves transparency via `/SMask`.
    backdrop: Option<[u8; 3]>,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    // Format is detected from the magic bytes; only the png + jpeg codecs are
    // compiled in (see Cargo.toml), so other formats fail here with an error.
    //
    // Apply the image's EXIF orientation (phone cameras store the sensor rotation
    // there; the raw pixel grid is otherwise sideways). Unlike an image embedded in
    // an uploaded PDF — whose orientation the PDF structure already defines, so the
    // embedded JPEG's EXIF is ignored — a bare uploaded JPEG's EXIF *is* its
    // orientation, so we bake it into the pixels here. The JS preview requests the
    // same via `createImageBitmap(file, { imageOrientation: 'from-image' })`, keeping
    // the generated card size and the preview in sync.
    let mut decoder = image::ImageReader::new(std::io::Cursor::new(image_bytes))
        .with_guessed_format()?
        .into_decoder()?;
    let orientation = decoder.orientation()?;
    let mut img = image::DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return Err("image has zero dimensions".into());
    }

    // Choose the color space + raw 8-bit samples, and build a soft mask when the
    // image carries real transparency and no backdrop is requested.
    let (color_space, samples, smask): (&[u8], Vec<u8>, Option<Stream>) = if let Some(bg) = backdrop {
        // Composite over the chosen color: transparent regions take that color, the
        // result is opaque DeviceRGB, and no `/SMask` is emitted. Fully-opaque
        // images composite to themselves, so this is a no-op for them.
        (b"DeviceRGB", flatten_over(&img, bg), None)
    } else if img.color().has_alpha() {
        let (rgb, alpha, any_transparent) = split_rgb_alpha(&img);
        // Straight (unpremultiplied) color + a DeviceGray alpha mask, so the export
        // keeps its transparency. Fully-opaque alpha (all 255) needs no mask; the
        // straight RGB then equals `flatten_over` white, so output stays unchanged.
        let smask = if any_transparent { Some(build_smask_stream(w, h, alpha)?) } else { None };
        (b"DeviceRGB", rgb, smask)
    } else {
        // No backdrop, no alpha channel: grayscale stays DeviceGray (1 sample/px);
        // other opaque images are DeviceRGB.
        match &img {
            image::DynamicImage::ImageLuma8(buf) => (b"DeviceGray", buf.as_raw().clone(), None),
            _ => (b"DeviceRGB", flatten_over(&img, [255, 255, 255]), None),
        }
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

    build_single_page_image_pdf(card_w, card_h, image_stream, smask, flip_x, flip_y)
}

// Split an image into straight (unpremultiplied) RGB samples (row-major, 3
// bytes/px) and a separate 8-bit alpha channel (1 byte/px), reporting whether
// any pixel is non-opaque. The RGB keeps the raw color (no white compositing) so
// it can pair with an `/SMask`; `any_transparent` lets the caller skip the mask
// for fully-opaque images.
fn split_rgb_alpha(img: &image::DynamicImage) -> (Vec<u8>, Vec<u8>, bool) {
    let rgba = img.to_rgba8();
    let px_count = (rgba.width() as usize) * (rgba.height() as usize);
    let mut rgb = Vec::with_capacity(px_count * 3);
    let mut alpha = Vec::with_capacity(px_count);
    let mut any_transparent = false;
    for px in rgba.pixels() {
        let [r, g, b, a] = px.0;
        rgb.push(r);
        rgb.push(g);
        rgb.push(b);
        alpha.push(a);
        if a != 255 {
            any_transparent = true;
        }
    }
    (rgb, alpha, any_transparent)
}

// Build a DeviceGray Image XObject stream holding `alpha` (1 sample/px, 8-bit),
// suitable as another image's `/SMask`. Same `Width`/`Height` as the base image;
// no `/Filter` is set so `compress()` stamps `/Filter /FlateDecode`.
fn build_smask_stream(w: u32, h: u32, alpha: Vec<u8>) -> Result<Stream, Box<dyn std::error::Error>> {
    let mut dict = Dictionary::new();
    dict.set("Type", Object::Name(b"XObject".to_vec()));
    dict.set("Subtype", Object::Name(b"Image".to_vec()));
    dict.set("Width", Object::Integer(w as i64));
    dict.set("Height", Object::Integer(h as i64));
    dict.set("ColorSpace", Object::Name(b"DeviceGray".to_vec()));
    dict.set("BitsPerComponent", Object::Integer(8));
    let mut stream = Stream::new(dict, alpha);
    stream.compress()?;
    Ok(stream)
}

// Composite any image over a solid `bg` color and return tightly packed RGB8
// samples (row-major, 3 bytes/px). Alpha is flattened so transparent regions take
// the backdrop color; no `/SMask` is emitted. Passing `[255, 255, 255]` gives the
// print-on-white default.
fn flatten_over(img: &image::DynamicImage, bg: [u8; 3]) -> Vec<u8> {
    let rgba = img.to_rgba8();
    let mut out = Vec::with_capacity((rgba.width() as usize) * (rgba.height() as usize) * 3);
    for px in rgba.pixels() {
        let [r, g, b, a] = px.0;
        let a = a as u32;
        // `c` over `bg`: (c*a + bg*(255-a)) / 255, rounded toward zero.
        let blend = |c: u8, over: u8| (((c as u32) * a + (over as u32) * (255 - a)) / 255) as u8;
        out.push(blend(r, bg[0]));
        out.push(blend(g, bg[1]));
        out.push(blend(b, bg[2]));
    }
    out
}

// Assemble a one-page PDF (MediaBox `card_w` x `card_h`) whose content draws the
// given image XObject stretched to fill the page. Mirrors
// `shapes::build_single_page_pdf` but wires the image into `/Resources`.
fn build_single_page_image_pdf(
    card_w: f32,
    card_h: f32,
    mut image_stream: Stream,
    // The image's soft mask, when it carries transparency. Added as its own object
    // and referenced from the base image's dict via `/SMask`.
    smask: Option<Stream>,
    flip_x: bool,
    flip_y: bool,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    if let Some(smask) = smask {
        let smask_id = doc.add_object(smask);
        image_stream.dict.set("SMask", Object::Reference(smask_id));
    }
    let image_id = doc.add_object(image_stream);

    // The `cm` maps the image's 1x1 unit space onto the full MediaBox, so the
    // image stretches to exactly fill the card (same model as `simple`/uploaded
    // backgrounds, which define the card size by their page box). A flip negates
    // the corresponding axis scale and shifts the origin by the card size so the
    // mirrored image still lands inside the MediaBox.
    let sx = if flip_x { -card_w } else { card_w };
    let ex = if flip_x { card_w } else { 0.0 };
    let sy = if flip_y { -card_h } else { card_h };
    let ey = if flip_y { card_h } else { 0.0 };
    let operations = vec![
        Operation::new("q", vec![]),
        Operation::new(
            "cm",
            vec![
                Object::Real(sx),
                Object::Real(0.0),
                Object::Real(0.0),
                Object::Real(sy),
                Object::Real(ex),
                Object::Real(ey),
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
        let pdf = build_image_background_pdf(&png, card_w, card_h, false, false, None).expect("should build");
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
    fn flip_negates_the_draw_matrix_axes() {
        let img = image::RgbaImage::from_pixel(8, 8, image::Rgba([10, 20, 30, 255]));
        let png = encode(image::DynamicImage::ImageRgba8(img), image::ImageFormat::Png);
        let (card_w, card_h) = (80.0, 50.0);

        let cm = |flip_x: bool, flip_y: bool| -> Vec<f32> {
            let pdf = build_image_background_pdf(&png, card_w, card_h, flip_x, flip_y, None).unwrap();
            let doc = Document::load_mem(&pdf).unwrap();
            let (_, page_id) = doc.get_pages().into_iter().next().unwrap();
            let ops = Content::decode(&doc.get_page_content(page_id).unwrap()).unwrap().operations;
            let cm = ops.iter().find(|op| op.operator == "cm").expect("cm op");
            cm.operands.iter().map(num).collect()
        };

        // No flip: identity-scale-to-card, origin at (0,0).
        assert_eq!(cm(false, false), vec![card_w, 0.0, 0.0, card_h, 0.0, 0.0]);
        // Flip X: negate x-scale, shift origin right by the card width.
        assert_eq!(cm(true, false), vec![-card_w, 0.0, 0.0, card_h, card_w, 0.0]);
        // Flip Y: negate y-scale, shift origin up by the card height.
        assert_eq!(cm(false, true), vec![card_w, 0.0, 0.0, -card_h, 0.0, card_h]);
        // Both.
        assert_eq!(cm(true, true), vec![-card_w, 0.0, 0.0, -card_h, card_w, card_h]);
    }

    #[test]
    fn grayscale_png_uses_devicegray() {
        let img = image::GrayImage::from_pixel(64, 64, image::Luma([128]));
        let png = encode(image::DynamicImage::ImageLuma8(img), image::ImageFormat::Png);

        let pdf = build_image_background_pdf(&png, 100.0, 100.0, false, false, None).expect("should build");
        let (doc, page_id) = page_and_image(&pdf);
        let im = image_stream(&doc, page_id);
        assert_eq!(im.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceGray");
        assert!(im.dict.get(b"SMask").is_err(), "opaque grayscale needs no /SMask");
    }

    #[test]
    fn jpeg_decodes_and_re_embeds_as_devicergb() {
        let img = image::RgbImage::from_pixel(32, 32, image::Rgb([200, 50, 50]));
        let jpeg = encode(image::DynamicImage::ImageRgb8(img), image::ImageFormat::Jpeg);

        let pdf = build_image_background_pdf(&jpeg, 50.0, 50.0, false, false, None).expect("should build");
        let (doc, page_id) = page_and_image(&pdf);
        let im = image_stream(&doc, page_id);
        assert_eq!(im.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceRGB");
        assert_eq!(im.dict.get(b"Filter").unwrap().as_name().unwrap(), b"FlateDecode");
    }

    #[test]
    fn transparent_image_gets_devicergb_base_plus_smask() {
        // A 1x1 pixel with alpha=0: the color stays straight (unpremultiplied) RGB
        // and the alpha becomes a separate DeviceGray /SMask — no white composite.
        // A 1x1 image won't compress, so its samples are stored raw — read directly.
        let img = image::RgbaImage::from_pixel(1, 1, image::Rgba([10, 20, 30, 0]));
        let png = encode(image::DynamicImage::ImageRgba8(img), image::ImageFormat::Png);

        let pdf = build_image_background_pdf(&png, 50.0, 50.0, false, false, None).expect("should build");
        let (doc, page_id) = page_and_image(&pdf);
        let im = image_stream(&doc, page_id);
        assert_eq!(im.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceRGB");
        assert_eq!(im.content, vec![10, 20, 30], "straight color kept, not flattened to white");

        // /SMask points at a DeviceGray image of matching size holding the alpha.
        let smask_ref = im.dict.get(b"SMask").expect("transparent image has /SMask").as_reference().unwrap();
        let smask = doc.get_object(smask_ref).unwrap().as_stream().unwrap();
        assert_eq!(smask.dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Image");
        assert_eq!(smask.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceGray");
        assert_eq!(smask.dict.get(b"BitsPerComponent").unwrap().as_i64().unwrap(), 8);
        assert_eq!(smask.dict.get(b"Width").unwrap().as_i64().unwrap(), 1);
        assert_eq!(smask.dict.get(b"Height").unwrap().as_i64().unwrap(), 1);
        assert_eq!(smask.content, vec![0], "alpha 0 stored in the mask");
    }

    #[test]
    fn opaque_rgba_has_no_smask() {
        // Alpha channel present but fully opaque (255): straight RGB, no mask —
        // output matches the pre-SMask behavior.
        let img = image::RgbaImage::from_pixel(64, 64, image::Rgba([200, 80, 40, 255]));
        let png = encode(image::DynamicImage::ImageRgba8(img), image::ImageFormat::Png);

        let pdf = build_image_background_pdf(&png, 50.0, 50.0, false, false, None).expect("should build");
        let (doc, page_id) = page_and_image(&pdf);
        let im = image_stream(&doc, page_id);
        assert_eq!(im.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceRGB");
        assert!(im.dict.get(b"SMask").is_err(), "fully-opaque image needs no /SMask");
    }

    #[test]
    fn backdrop_bakes_over_transparent_pixels_without_smask() {
        // A fully transparent pixel with a red backdrop → the pixel becomes red
        // (baked in), the image is opaque DeviceRGB, and no /SMask is emitted.
        let img = image::RgbaImage::from_pixel(1, 1, image::Rgba([10, 20, 30, 0]));
        let png = encode(image::DynamicImage::ImageRgba8(img), image::ImageFormat::Png);

        let pdf = build_image_background_pdf(&png, 50.0, 50.0, false, false, Some([255, 0, 0])).expect("should build");
        let (doc, page_id) = page_and_image(&pdf);
        let im = image_stream(&doc, page_id);
        assert_eq!(im.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceRGB");
        assert!(im.dict.get(b"SMask").is_err(), "a baked backdrop leaves no /SMask");
        assert_eq!(im.content, vec![255, 0, 0], "transparent pixel takes the backdrop color");
    }

    #[test]
    fn backdrop_leaves_opaque_pixels_untouched() {
        // An opaque pixel is unaffected by the backdrop (composites to itself).
        let img = image::RgbaImage::from_pixel(1, 1, image::Rgba([10, 20, 30, 255]));
        let png = encode(image::DynamicImage::ImageRgba8(img), image::ImageFormat::Png);

        let pdf = build_image_background_pdf(&png, 50.0, 50.0, false, false, Some([255, 0, 0])).expect("should build");
        let (doc, page_id) = page_and_image(&pdf);
        let im = image_stream(&doc, page_id);
        assert_eq!(im.content, vec![10, 20, 30], "opaque pixel ignores the backdrop");
    }

    #[test]
    fn rejects_non_image_bytes() {
        assert!(build_image_background_pdf(b"not an image at all", 50.0, 50.0, false, false, None).is_err());
    }
}
