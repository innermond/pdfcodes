// Build an SVG path `d` for the *filled* cut region of a preset contour shape,
// mirroring the stroked geometry in src/generate/shapes.rs so the preview's
// "dim exterior" mask matches the actual cut outline. Coordinates are SVG
// (top-left origin, y increases downward); `box` is the shape's bounding box and
// `rx`/`ry` are the per-axis corner radius / bevel leg (already scaled to SVG
// units, so a non-uniformly resized shape gets matching elliptical corners).

// Quarter-circle bézier handle ratio (same constant as shapes.rs).
const K = 0.5522847498

const f = (n: number) => n.toFixed(3)

type Box = { x: number; y: number; w: number; h: number }
type Opts = { rx: number; ry: number; orientation: 'out' | 'in' }

// Ellipse (also used for circle, whose box is already square) as 4 cubic béziers.
function ellipsePath(box: Box): string {
  const rx = box.w / 2
  const ry = box.h / 2
  const cx = box.x + rx
  const cy = box.y + ry
  const kx = K * rx
  const ky = K * ry
  return [
    `M ${f(cx + rx)} ${f(cy)}`,
    `C ${f(cx + rx)} ${f(cy + ky)} ${f(cx + kx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}`,
    `C ${f(cx - kx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ky)} ${f(cx - rx)} ${f(cy)}`,
    `C ${f(cx - rx)} ${f(cy - ky)} ${f(cx - kx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)}`,
    `C ${f(cx + kx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ky)} ${f(cx + rx)} ${f(cy)}`,
    'Z',
  ].join(' ')
}

function rectPath(box: Box): string {
  const { x, y, w, h } = box
  return `M ${f(x)} ${f(y)} L ${f(x + w)} ${f(y)} L ${f(x + w)} ${f(y + h)} L ${f(x)} ${f(y + h)} Z`
}

// Rounded rectangle for both corner orientations (convex 'out' / scalloped 'in'),
// ported from rounded_rect_stroke_ops with per-axis radii.
function roundedRectPath(box: Box, rxIn: number, ryIn: number, concave: boolean): string {
  const { x, y, w, h } = box
  const rx = Math.max(0, Math.min(rxIn, w / 2))
  const ry = Math.max(0, Math.min(ryIn, h / 2))
  if (rx <= 0 || ry <= 0) return rectPath(box)
  const kx = K * rx
  const ky = K * ry
  // Two control points per corner, clockwise from bottom-right (matching Rust).
  const corners = concave
    ? {
        br: [[x + w - rx, y + ky], [x + w - kx, y + ry]],
        tr: [[x + w - kx, y + h - ry], [x + w - rx, y + h - ky]],
        tl: [[x + rx, y + h - ky], [x + kx, y + h - ry]],
        bl: [[x + kx, y + ry], [x + rx, y + ky]],
      }
    : {
        br: [[x + w - rx + kx, y], [x + w, y + ry - ky]],
        tr: [[x + w, y + h - ry + ky], [x + w - rx + kx, y + h]],
        tl: [[x + rx - kx, y + h], [x, y + h - ry + ky]],
        bl: [[x, y + ry - ky], [x + rx - kx, y]],
      }
  const c = (pts: number[][], end: number[]) =>
    `C ${f(pts[0][0])} ${f(pts[0][1])} ${f(pts[1][0])} ${f(pts[1][1])} ${f(end[0])} ${f(end[1])}`
  return [
    `M ${f(x + rx)} ${f(y)}`,
    `L ${f(x + w - rx)} ${f(y)}`,
    c(corners.br, [x + w, y + ry]),
    `L ${f(x + w)} ${f(y + h - ry)}`,
    c(corners.tr, [x + w - rx, y + h]),
    `L ${f(x + rx)} ${f(y + h)}`,
    c(corners.tl, [x, y + h - ry]),
    `L ${f(x)} ${f(y + ry)}`,
    c(corners.bl, [x + rx, y]),
    'Z',
  ].join(' ')
}

// Chamfered (beveled) rectangle, ported from beveled_rect_stroke_ops.
function beveledRectPath(box: Box, bxIn: number, byIn: number): string {
  const { x, y, w, h } = box
  const bx = Math.max(0, Math.min(bxIn, w / 2))
  const by = Math.max(0, Math.min(byIn, h / 2))
  if (bx <= 0 || by <= 0) return rectPath(box)
  return [
    `M ${f(x + bx)} ${f(y)}`,
    `L ${f(x + w - bx)} ${f(y)}`,
    `L ${f(x + w)} ${f(y + by)}`,
    `L ${f(x + w)} ${f(y + h - by)}`,
    `L ${f(x + w - bx)} ${f(y + h)}`,
    `L ${f(x + bx)} ${f(y + h)}`,
    `L ${f(x)} ${f(y + h - by)}`,
    `L ${f(x)} ${f(y + by)}`,
    'Z',
  ].join(' ')
}

// Heart, ported from heart_stroke_ops but vertically mirrored: shapes.rs draws in
// PDF coords (tip at y=0 = bottom), here the tip sits at the box bottom (y+h).
function heartPath(box: Box): string {
  const { x, y, w, h } = box
  const px = (nx: number) => x + nx * w
  const py = (t: number) => y + (1 - t) * h
  const k = K * 0.25
  const c = (a: number[], b: number[], e: number[]) =>
    `C ${f(a[0])} ${f(a[1])} ${f(b[0])} ${f(b[1])} ${f(e[0])} ${f(e[1])}`
  return [
    `M ${f(px(0.5))} ${f(py(0.0))}`,
    c([px(0.4), py(0.1)], [px(0.0), py(0.5)], [px(0.0), py(0.75)]),
    c([px(0.0), py(0.75 + k)], [px(0.25 - k), py(1.0)], [px(0.25), py(1.0)]),
    c([px(0.25 + k), py(1.0)], [px(0.5), py(0.75 + k)], [px(0.5), py(0.75)]),
    c([px(0.5), py(0.75 + k)], [px(0.75 - k), py(1.0)], [px(0.75), py(1.0)]),
    c([px(0.75 + k), py(1.0)], [px(1.0), py(0.75 + k)], [px(1.0), py(0.75)]),
    c([px(1.0), py(0.5)], [px(0.6), py(0.1)], [px(0.5), py(0.0)]),
    'Z',
  ].join(' ')
}

export function contourMaskPathD(kind: string, box: Box, opts: Opts): string {
  switch (kind) {
    case 'circle':
    case 'ellipse':
      return ellipsePath(box)
    case 'rounded-rectangle':
      return roundedRectPath(box, opts.rx, opts.ry, opts.orientation === 'in')
    case 'beveled-rectangle':
      return beveledRectPath(box, opts.rx, opts.ry)
    case 'heart':
      return heartPath(box)
    case 'rectangle':
    default:
      return rectPath(box)
  }
}
