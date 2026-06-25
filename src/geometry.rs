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
