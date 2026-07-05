// Scratch e2e check (temporary): drive the real contour upload through the cut
// pipeline with a spin, the way the web sends it, and verify page/geometry.
use pdfcodes::{generate_pdf, Options};

#[test]
fn spun_cut_from_real_upload_grows_page_and_places_footprint() {
    let contour = std::fs::read("mircea macelaru contur.pdf").expect("user contour present");
    // Web-like flow: box 40x20mm target, spin 25°, footprint = spun rect bbox.
    let mm = 72.0 / 25.4;
    let (bw, bh) = (40.0f32, 20.0f32);
    let theta = 25f32.to_radians();
    let (s, c) = theta.sin_cos();
    let fw = bw * c.abs() + bh * s.abs();
    let fh = bw * s.abs() + bh * c.abs();
    let fl = (bw - fw) / 2.0;
    let fb = (bh - fh) / 2.0;
    let out = generate_pdf(None, &contour, None, &Options {
        contour: true,
        card_width_mm: Some(bw),
        card_height_mm: Some(bh),
        background_spin_deg: 25.0,
        contour_footprint_left_mm: Some(fl),
        contour_footprint_bottom_mm: Some(fb),
        contour_footprint_width_mm: Some(fw),
        contour_footprint_height_mm: Some(fh),
        contour_trim_to_path: true,
        no_cut: true,
        contour_canvas_width_mm: Some(90.0),
        contour_canvas_height_mm: Some(50.0),
        contour_offset_x_mm: 10.0 + fl, // footprint origin = box offset + left0
        contour_offset_y_mm: 5.0 + fb,
        ..Options::default()
    }).expect("spun cut generates");
    std::fs::write("/tmp/claude-1000/-home-gabriel-Projects-pdfcodes/52b01f43-64a2-4723-aff9-fbb4d064a789/scratchpad/e2e/spun-cut.pdf", &out.pdf).unwrap();
    let doc = lopdf::Document::load_mem(&out.pdf).unwrap();
    let page_id = *doc.get_pages().values().next().unwrap();
    let mb = doc.get_dictionary(page_id).unwrap().get(b"MediaBox").unwrap().as_array().unwrap().clone();
    let n = |o: &lopdf::Object| match o { lopdf::Object::Real(v) => *v, lopdf::Object::Integer(v) => *v as f32, _ => 0.0 };
    // Canvas mode: page = 90x50mm regardless of the footprint.
    assert!((n(&mb[2]) - 90.0 * mm).abs() < 0.5, "page w {}", n(&mb[2]));
    assert!((n(&mb[3]) - 50.0 * mm).abs() < 0.5, "page h {}", n(&mb[3]));

    // Minimal-like flow: no canvas/offset — page must equal the footprint.
    let out2 = generate_pdf(None, &contour, None, &Options {
        contour: true,
        no_cut: true,
        card_width_mm: Some(bw),
        card_height_mm: Some(bh),
        background_spin_deg: 25.0,
        contour_footprint_left_mm: Some(fl),
        contour_footprint_bottom_mm: Some(fb),
        contour_footprint_width_mm: Some(fw),
        contour_footprint_height_mm: Some(fh),
        contour_trim_to_path: true,
        ..Options::default()
    }).expect("footprint-page cut generates");
    std::fs::write("/tmp/claude-1000/-home-gabriel-Projects-pdfcodes/52b01f43-64a2-4723-aff9-fbb4d064a789/scratchpad/e2e/spun-cut-minimal.pdf", &out2.pdf).unwrap();
    let doc2 = lopdf::Document::load_mem(&out2.pdf).unwrap();
    let p2 = *doc2.get_pages().values().next().unwrap();
    let mb2 = doc2.get_dictionary(p2).unwrap().get(b"MediaBox").unwrap().as_array().unwrap().clone();
    assert!((n(&mb2[2]) - fw * mm).abs() < 0.5, "footprint page w {} vs {}", n(&mb2[2]), fw * mm);
    assert!((n(&mb2[3]) - fh * mm).abs() < 0.5, "footprint page h {} vs {}", n(&mb2[3]), fh * mm);
}
