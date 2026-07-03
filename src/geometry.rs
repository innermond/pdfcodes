use lopdf::{Object, content::Operation};

use crate::options::Options;

pub(crate) const MM: f32 = 72.0 / 25.4;

// Black filled circle centered at (cx, cy) with radius r, approximated with 4 cubic beziers.
pub(crate) fn circle_ops(cx: f32, cy: f32, r: f32) -> Vec<Operation> {
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

// ---------------------------------------------------------------------------
// Contour hit-testing: is a code's glyph outline fully inside the cut region?
//
// The cut "keep" region is one or more closed polygons (card points, y-up) with
// even-odd fill, supplied by the web app (`Options::contour_keep_polygons`). A
// code is "cut off" unless every point of its flattened glyph outline lies inside
// the region *and* no glyph edge crosses a region edge (the latter catches a
// stroke bulging past the cut between two inside vertices).
// ---------------------------------------------------------------------------

// Even-odd point-in-region test: cast a ray to +x and count edge crossings across
// every subpath; an odd total means inside (so a hole in a ring subtracts out).
pub(crate) fn point_in_region(region: &[Vec<(f32, f32)>], p: (f32, f32)) -> bool {
    let (px, py) = p;
    let mut inside = false;
    for poly in region {
        let n = poly.len();
        if n < 3 {
            continue;
        }
        let mut j = n - 1;
        for i in 0..n {
            let (xi, yi) = poly[i];
            let (xj, yj) = poly[j];
            // Does the horizontal ray at `py` cross edge (j -> i)?
            if (yi > py) != (yj > py) {
                let t = (py - yi) / (yj - yi);
                let x_cross = xi + t * (xj - xi);
                if px < x_cross {
                    inside = !inside;
                }
            }
            j = i;
        }
    }
    inside
}

// Do open segments a0->a1 and b0->b1 properly cross? Uses orientation signs;
// collinear/touch-only cases return false (a glyph vertex resting exactly on the
// cut edge isn't treated as a crossing — the vertex-inside test governs those).
pub(crate) fn segments_cross(
    a0: (f32, f32),
    a1: (f32, f32),
    b0: (f32, f32),
    b1: (f32, f32),
) -> bool {
    fn cross(o: (f32, f32), a: (f32, f32), b: (f32, f32)) -> f32 {
        (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
    }
    let d1 = cross(a0, a1, b0);
    let d2 = cross(a0, a1, b1);
    let d3 = cross(b0, b1, a0);
    let d4 = cross(b0, b1, a1);
    ((d1 > 0.0) != (d2 > 0.0)) && ((d3 > 0.0) != (d4 > 0.0))
}

// Distance from point `p` to the segment `a`->`b`.
pub(crate) fn point_to_segment_dist(p: (f32, f32), a: (f32, f32), b: (f32, f32)) -> f32 {
    let (abx, aby) = (b.0 - a.0, b.1 - a.1);
    let len2 = abx * abx + aby * aby;
    let t = if len2 <= f32::EPSILON {
        0.0
    } else {
        (((p.0 - a.0) * abx + (p.1 - a.1) * aby) / len2).clamp(0.0, 1.0)
    };
    let (cx, cy) = (a.0 + t * abx, a.1 + t * aby);
    ((p.0 - cx).powi(2) + (p.1 - cy).powi(2)).sqrt()
}

// Shortest distance from `p` to the region's boundary — the nearest edge across
// every subpath (outer cut and any holes), so the clearance is honored on all sides.
pub(crate) fn dist_to_boundary(region: &[Vec<(f32, f32)>], p: (f32, f32)) -> f32 {
    let mut best = f32::INFINITY;
    for poly in region {
        let n = poly.len();
        if n < 2 {
            continue;
        }
        let mut j = n - 1;
        for i in 0..n {
            let d = point_to_segment_dist(p, poly[j], poly[i]);
            if d < best {
                best = d;
            }
            j = i;
        }
    }
    best
}

// True when the `outline` fits inside the cut: every vertex is inside `region`, no
// outline edge crosses a region edge, and — when `inset > 0` — every vertex clears
// the boundary by at least `inset` (card points), i.e. the outline sits inside the
// region eroded by `inset`. `outline` is a set of closed contours (glyph subpaths).
pub(crate) fn region_contains_outline(
    region: &[Vec<(f32, f32)>],
    outline: &[Vec<(f32, f32)>],
    inset: f32,
) -> bool {
    if region.is_empty() {
        return true;
    }
    for contour in outline {
        for &pt in contour {
            if !point_in_region(region, pt) {
                return false;
            }
            if inset > 0.0 && dist_to_boundary(region, pt) < inset {
                return false;
            }
        }
    }
    // No vertex escaped; make sure no edge slips across the boundary between two
    // inside vertices (e.g. a thin protrusion poking out of a concave cut).
    for contour in outline {
        let n = contour.len();
        if n < 2 {
            continue;
        }
        for i in 0..n {
            let a0 = contour[i];
            let a1 = contour[(i + 1) % n];
            for poly in region {
                let m = poly.len();
                if m < 2 {
                    continue;
                }
                let mut j = m - 1;
                for k in 0..m {
                    if segments_cross(a0, a1, poly[k], poly[j]) {
                        return false;
                    }
                    j = k;
                }
            }
        }
    }
    true
}

// Collects a glyph's outline into flattened, closed polylines. Implements
// `ttf_parser::OutlineBuilder`: coordinates arrive in font units, which
// `scale` converts to points (font_size / units_per_em); `dx` shifts each glyph
// to its pen origin. Quadratic/cubic segments are subdivided into `STEPS` line
// segments — dense enough that testing vertices approximates the true curve.
pub(crate) struct GlyphOutline {
    pub contours: Vec<Vec<(f32, f32)>>,
    scale: f32,
    dx: f32,
    current: Vec<(f32, f32)>,
    start: (f32, f32),
    last: (f32, f32),
}

impl GlyphOutline {
    const STEPS: usize = 8;

    pub fn new(scale: f32, dx: f32) -> Self {
        GlyphOutline {
            contours: Vec::new(),
            scale,
            dx,
            current: Vec::new(),
            start: (0.0, 0.0),
            last: (0.0, 0.0),
        }
    }

    fn map(&self, x: f32, y: f32) -> (f32, f32) {
        (self.dx + x * self.scale, y * self.scale)
    }

    fn finish_contour(&mut self) {
        if self.current.len() >= 2 {
            self.contours.push(std::mem::take(&mut self.current));
        } else {
            self.current.clear();
        }
    }
}

impl ttf_parser::OutlineBuilder for GlyphOutline {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish_contour();
        let p = self.map(x, y);
        self.start = p;
        self.last = p;
        self.current.push(p);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let p = self.map(x, y);
        self.last = p;
        self.current.push(p);
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let p0 = self.last;
        let c = self.map(x1, y1);
        let p = self.map(x, y);
        for s in 1..=Self::STEPS {
            let t = s as f32 / Self::STEPS as f32;
            let mt = 1.0 - t;
            let px = mt * mt * p0.0 + 2.0 * mt * t * c.0 + t * t * p.0;
            let py = mt * mt * p0.1 + 2.0 * mt * t * c.1 + t * t * p.1;
            self.current.push((px, py));
        }
        self.last = p;
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let p0 = self.last;
        let c1 = self.map(x1, y1);
        let c2 = self.map(x2, y2);
        let p = self.map(x, y);
        for s in 1..=Self::STEPS {
            let t = s as f32 / Self::STEPS as f32;
            let mt = 1.0 - t;
            let px = mt * mt * mt * p0.0 + 3.0 * mt * mt * t * c1.0 + 3.0 * mt * t * t * c2.0 + t * t * t * p.0;
            let py = mt * mt * mt * p0.1 + 3.0 * mt * mt * t * c1.1 + 3.0 * mt * t * t * c2.1 + t * t * t * p.1;
            self.current.push((px, py));
        }
        self.last = p;
    }

    fn close(&mut self) {
        self.finish_contour();
    }
}

impl GlyphOutline {
    // Call after `outline_glyph` to flush any trailing (unclosed) contour.
    pub fn into_contours(mut self) -> Vec<Vec<(f32, f32)>> {
        self.finish_contour();
        self.contours
    }
}

// Affine transform matrix [a, b, c, d, e, f] mapping (x, y) ->
// (a*x + c*y + e, b*x + d*y + f), matching the PDF `cm` operator built in
// cards.rs. `None` when no rotation/flip is needed (identity).
pub(crate) fn word_transform(
    rotation_deg: f32,
    flip_x: bool,
    flip_y: bool,
    cx: f32,
    cy: f32,
) -> Option<[f32; 6]> {
    if rotation_deg == 0.0 && !flip_x && !flip_y {
        return None;
    }
    let theta = rotation_deg.to_radians();
    let (sin, cos) = theta.sin_cos();
    let sx = if flip_x { -1.0 } else { 1.0 };
    let sy = if flip_y { -1.0 } else { 1.0 };
    let a = cos * sx;
    let b = sin * sx;
    let c = -sin * sy;
    let d = cos * sy;
    let e = cx - (a * cx + c * cy);
    let f = cy - (b * cx + d * cy);
    Some([a, b, c, d, e, f])
}

// Apply a `word_transform` matrix to a point.
pub(crate) fn apply_matrix(m: &[f32; 6], p: (f32, f32)) -> (f32, f32) {
    (m[0] * p.0 + m[2] * p.1 + m[4], m[1] * p.0 + m[3] * p.1 + m[5])
}

// Axis-aligned bounding box (x0, y0, x1, y1) of the rectangle (0,0)–(w,h) under a
// `word_transform` matrix. Everything drawn inside the rectangle stays inside this
// box after the transform, so it bounds the un-clipped extent of a spun contour.
pub(crate) fn rect_transform_bbox(m: &[f32; 6], w: f32, h: f32) -> (f32, f32, f32, f32) {
    let corners = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)];
    let mut bbox = (f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
    for p in corners {
        let (x, y) = apply_matrix(m, p);
        bbox.0 = bbox.0.min(x);
        bbox.1 = bbox.1.min(y);
        bbox.2 = bbox.2.max(x);
        bbox.3 = bbox.3.max(y);
    }
    bbox
}

pub(crate) fn to_f64(obj: &Object) -> f64 {
    match obj {
        Object::Real(v) => *v as f64,
        Object::Integer(v) => *v as f64,
        _ => 0.0,
    }
}

// Grid layout of cards on the host page: card/host dimensions, gutters,
// registration circle radius, and the resulting grid (columns, rows, and the
// top-left position of the first card).
pub(crate) struct CardLayout {
    pub card_w: f32,
    pub card_h: f32,
    pub card_box: Vec<Object>,
    pub host_w: f32,
    pub host_h: f32,
    pub host_box: Vec<Object>,
    pub gutter_x: f32,
    pub gutter_y: f32,
    pub circle_r: f32,
    pub cols: usize,
    pub rows: usize,
    pub cards_per_page: usize,
    pub start_x: f32,
    pub start_y: f32,
}

impl CardLayout {
    // Compute grid layout on the host page.
    //
    // Each edge of the host page is touched by a registration circle, so the
    // grid is laid out within the area remaining after insetting every edge
    // by one circle diameter.
    pub fn compute(card_w: f32, card_h: f32, opts: &Options) -> Self {
        // "Non-decupare" (no-cut): one card per page, the page sized exactly to
        // the card, no gutters and no registration circles. This bypasses the
        // grid math below so the print/contour paths emit a single card per page.
        if opts.no_cut {
            let card_box = vec![Object::Real(0.0), Object::Real(0.0), Object::Real(card_w), Object::Real(card_h)];
            return CardLayout {
                card_w,
                card_h,
                card_box: card_box.clone(),
                host_w: card_w,
                host_h: card_h,
                host_box: card_box,
                gutter_x: 0.0,
                gutter_y: 0.0,
                circle_r: 0.0,
                cols: 1,
                rows: 1,
                cards_per_page: 1,
                start_x: 0.0,
                start_y: 0.0,
            };
        }

        let host_w = opts.host_width_mm * MM;
        let host_h = opts.host_height_mm * MM;
        let gutter_x = opts.offset_x_mm * MM;
        let gutter_y = opts.offset_y_mm * MM;
        let circle_r = opts.circle_diameter_mm * MM / 2.0;

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

        let card_box = vec![Object::Real(0.0), Object::Real(0.0), Object::Real(card_w), Object::Real(card_h)];
        let host_box = vec![Object::Real(0.0), Object::Real(0.0), Object::Real(host_w), Object::Real(host_h)];

        CardLayout {
            card_w,
            card_h,
            card_box,
            host_w,
            host_h,
            host_box,
            gutter_x,
            gutter_y,
            circle_r,
            cols,
            rows,
            cards_per_page,
            start_x,
            start_y,
        }
    }

    // Position of the i-th cell in the grid (row-major, left-to-right).
    pub fn position(&self, i: usize) -> (f32, f32) {
        let col = i % self.cols;
        let row = i / self.cols;
        let x = self.start_x + col as f32 * (self.card_w + self.gutter_x);
        let y = self.start_y + row as f32 * (self.card_h + self.gutter_y);
        (x, y)
    }

    // Position of the i-th cell in a serpentine layout: even rows are laid
    // out from the right edge of the host page (column order reversed).
    pub fn position_serpentine(&self, i: usize) -> (f32, f32) {
        let col = i % self.cols;
        let row = i / self.cols;
        let visual_col = if row % 2 == 1 { self.cols - 1 - col } else { col };
        let x = self.start_x + visual_col as f32 * (self.card_w + self.gutter_x);
        let y = self.start_y + row as f32 * (self.card_h + self.gutter_y);
        (x, y)
    }

    // Horizontal center-to-center distance (in mm) between adjacent cards in
    // the grid, used to estimate the cutter's travel time between cards.
    pub fn pitch_mm(&self) -> f32 {
        (self.card_w + self.gutter_x) / MM
    }

    // Registration circles: top-left, bottom-right, bottom-left, inset by radius.
    // No-cut layouts (and any zero-diameter request) draw none.
    pub fn registration_circles(&self) -> Vec<Operation> {
        if self.circle_r <= 0.0 {
            return Vec::new();
        }
        let mut ops = Vec::new();
        ops.extend(circle_ops(self.circle_r, self.host_h - self.circle_r, self.circle_r));
        ops.extend(circle_ops(self.host_w - self.circle_r, self.circle_r, self.circle_r));
        ops.extend(circle_ops(self.circle_r, self.circle_r, self.circle_r));
        ops
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cards_per_page_grid() {
        // 86x54mm cards on a 267x350mm host, no gutters, 10mm registration circles.
        // available 247x330mm -> floor(247/86)=2 cols, floor(330/54)=6 rows.
        let opts = Options {
            host_width_mm: 267.0,
            host_height_mm: 350.0,
            offset_x_mm: 0.0,
            offset_y_mm: 0.0,
            circle_diameter_mm: 10.0,
            ..Options::default()
        };
        let layout = CardLayout::compute(86.0 * MM, 54.0 * MM, &opts);
        assert_eq!(layout.cols, 2);
        assert_eq!(layout.cards_per_page, 12);
    }

    fn square(x0: f32, y0: f32, x1: f32, y1: f32) -> Vec<(f32, f32)> {
        vec![(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    }

    #[test]
    fn point_in_region_even_odd_ring() {
        // A 100x100 outer square with a 40x40 inner hole (even-odd => the hole is
        // outside the region).
        let region = vec![square(0.0, 0.0, 100.0, 100.0), square(30.0, 30.0, 70.0, 70.0)];
        assert!(point_in_region(&region, (10.0, 10.0))); // in the ring
        assert!(!point_in_region(&region, (50.0, 50.0))); // in the hole
        assert!(!point_in_region(&region, (150.0, 50.0))); // outside entirely
    }

    #[test]
    fn region_contains_outline_inside_and_outside() {
        let region = vec![square(0.0, 0.0, 100.0, 100.0)];
        // Fully inside.
        assert!(region_contains_outline(&region, &[square(20.0, 20.0, 40.0, 40.0)], 0.0));
        // A vertex pokes outside the right edge.
        assert!(!region_contains_outline(&region, &[square(90.0, 20.0, 120.0, 40.0)], 0.0));
    }

    #[test]
    fn region_contains_outline_honors_the_inset_clearance() {
        let region = vec![square(0.0, 0.0, 100.0, 100.0)];
        // Sits 5 units from the left/bottom edges, well inside.
        let outline = [square(5.0, 5.0, 50.0, 50.0)];
        // With no inset it fits; with a 6-unit inset the near edges are too close.
        assert!(region_contains_outline(&region, &outline, 0.0));
        assert!(!region_contains_outline(&region, &outline, 6.0));
        // A 4-unit inset still clears (nearest edge is 5 away).
        assert!(region_contains_outline(&region, &outline, 4.0));
    }

    #[test]
    fn region_contains_outline_catches_edge_crossing() {
        // A concave (C-shaped) region: the outline's vertices could sit inside
        // while an edge slips through the notch. Verify the edge test catches it.
        // Region: 100x100 square with a rectangular notch cut from the right edge.
        let region = vec![vec![
            (0.0, 0.0), (100.0, 0.0), (100.0, 40.0),
            (50.0, 40.0), (50.0, 60.0), (100.0, 60.0),
            (100.0, 100.0), (0.0, 100.0),
        ]];
        // Outline whose vertices are inside the left part but whose top/bottom
        // edges cross the notch walls.
        let outline = vec![square(20.0, 45.0, 80.0, 55.0)];
        assert!(!region_contains_outline(&region, &outline, 0.0));
    }

    #[test]
    fn word_transform_identity_and_rotation() {
        assert!(word_transform(0.0, false, false, 5.0, 5.0).is_none());
        // 90° rotation about the origin maps (1,0) -> (0,1).
        let m = word_transform(90.0, false, false, 0.0, 0.0).unwrap();
        let p = apply_matrix(&m, (1.0, 0.0));
        assert!((p.0).abs() < 1e-5, "x≈0, got {}", p.0);
        assert!((p.1 - 1.0).abs() < 1e-5, "y≈1, got {}", p.1);
    }

    #[test]
    fn no_cut_layout_is_single_card_page_without_circles() {
        let opts = Options { no_cut: true, circle_diameter_mm: 10.0, ..Options::default() };
        let card_w = 86.0 * MM;
        let card_h = 54.0 * MM;
        let layout = CardLayout::compute(card_w, card_h, &opts);

        assert_eq!(layout.cards_per_page, 1);
        assert_eq!(layout.cols, 1);
        assert_eq!(layout.rows, 1);
        // The page equals the card, positioned at the origin.
        assert_eq!(layout.host_w, card_w);
        assert_eq!(layout.host_h, card_h);
        assert_eq!(layout.position(0), (0.0, 0.0));
        // No registration circles are drawn.
        assert!(layout.registration_circles().is_empty());
    }
}
