// Equidistant ("Redesenează") offset of a flattened contour outline: grow the
// cut die-line outward by a distance (bleed) or shrink it inward (safety margin),
// the same amount everywhere along the outline — unlike a proportional resize.
//
// Input/output are the same closed polygons `flattenPathD` (contourKeepRegion.ts)
// produces: arrays of points, one array per subpath, implicitly closed. The offset
// is applied per subpath in that subpath's own coordinate frame; a positive
// `dist` always grows the even-odd *filled* region (outer loops expand, holes
// shrink), regardless of the producer's winding direction.
//
// Joins are rounded on the "gap" side of a corner (arc of radius |dist|) and
// mitered on the overlap side (sharp corners survive a shrink), with a miter cap
// that falls back to a bevel so acute corners never spike. This is a pragmatic,
// dependency-free offset: extreme distances on strongly concave shapes can
// self-intersect, which is acceptable for the small mm die-line offsets this
// feature targets. Reuses the `Pt` contract from contourKeepRegion.ts.
import type { Pt } from './contourKeepRegion'

// Signed (shoelace) area; sign encodes winding (>0 = CCW in a y-up frame),
// magnitude is the enclosed area.
function signedArea(poly: Pt[]): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]
  }
  return a / 2
}

// Even-odd ray cast: is `p` strictly inside `poly`?
function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > p[1]) !== (yj > p[1])) {
      const x = xi + ((p[1] - yi) / (yj - yi)) * (xj - xi)
      if (p[0] < x) inside = !inside
    }
  }
  return inside
}

function norm(v: Pt): Pt {
  const len = Math.hypot(v[0], v[1])
  return len > 1e-9 ? [v[0] / len, v[1] / len] : [0, 0]
}

// Drop consecutive near-duplicate vertices so edge directions are well defined.
function dedupe(poly: Pt[], eps = 1e-6): Pt[] {
  const out: Pt[] = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push(p)
  }
  // Drop a closing duplicate of the first vertex.
  while (out.length >= 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) {
    out.pop()
  }
  return out
}

// Offset one closed polygon. `off` > 0 moves every edge along its right normal
// (dy, -dx); the caller has already folded orientation + hole depth into `off`'s
// sign so this always expands the filled side.
function offsetOne(polyIn: Pt[], off: number): Pt[] {
  const poly = dedupe(polyIn)
  const n = poly.length
  if (n < 3 || off === 0) return polyIn
  const miterLimit = 4 * Math.abs(off)
  // Per-edge unit right-normal r[k] for edge (v[k] -> v[k+1]).
  const dir: Pt[] = []
  const rn: Pt[] = []
  for (let k = 0; k < n; k++) {
    const a = poly[k]
    const b = poly[(k + 1) % n]
    const d = norm([b[0] - a[0], b[1] - a[1]])
    dir.push(d)
    rn.push([d[1], -d[0]]) // right normal
  }

  const out: Pt[] = []
  for (let j = 0; j < n; j++) {
    const v = poly[j]
    const kPrev = (j - 1 + n) % n // edge ending at v
    const kNext = j // edge starting at v
    const rPrev = rn[kPrev]
    const rNext = rn[kNext]
    // Endpoints of the two offset edges at this vertex.
    const A: Pt = [v[0] + off * rPrev[0], v[1] + off * rPrev[1]]
    const B: Pt = [v[0] + off * rNext[0], v[1] + off * rNext[1]]
    const cross = dir[kPrev][0] * dir[kNext][1] - dir[kPrev][1] * dir[kNext][0]

    if (Math.abs(cross) < 1e-9) {
      // Collinear (straight through or 180° spike) — A ≈ B, keep one point.
      out.push(A)
      continue
    }
    if (off * cross > 0) {
      // Gap corner: round it with an arc of radius |off| centred at v.
      appendArc(out, v, A, B, Math.abs(off))
    } else {
      // Overlap corner: miter (intersection of the two offset lines) keeps sharp
      // corners; cap the spike length and fall back to a bevel past the limit.
      const m = intersectLines(A, dir[kPrev], B, dir[kNext])
      if (m && Math.hypot(m[0] - v[0], m[1] - v[1]) <= miterLimit) {
        out.push(m)
      } else {
        out.push(A, B)
      }
    }
  }
  return out
}

// Append an arc from A to B (both at radius r from centre c) taking the short way.
function appendArc(out: Pt[], c: Pt, A: Pt, B: Pt, r: number) {
  const a0 = Math.atan2(A[1] - c[1], A[0] - c[0])
  const a1 = Math.atan2(B[1] - c[1], B[0] - c[0])
  let delta = a1 - a0
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 16)))
  for (let s = 0; s <= steps; s++) {
    const a = a0 + (delta * s) / steps
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)])
  }
}

// Intersection of line through p0 with direction d0 and line through p1 with d1.
function intersectLines(p0: Pt, d0: Pt, p1: Pt, d1: Pt): Pt | null {
  const denom = d0[0] * d1[1] - d0[1] * d1[0]
  if (Math.abs(denom) < 1e-9) return null
  const t = ((p1[0] - p0[0]) * d1[1] - (p1[1] - p0[1]) * d1[0]) / denom
  return [p0[0] + t * d0[0], p0[1] + t * d0[1]]
}

// Offset every subpath by `dist` (signed: >0 grows the filled region, <0 shrinks
// it). Orientation and even-odd hole nesting are resolved per subpath so the sign
// is consistent no matter how the producer wound the paths.
export function offsetPolygons(subpaths: Pt[][], dist: number): Pt[][] {
  if (!dist) return subpaths
  const areas = subpaths.map(signedArea)
  return subpaths.map((poly, i) => {
    if (poly.length < 3) return poly
    // Nesting depth: how many other subpaths contain this one (even-odd) → a hole
    // sits at odd depth and must move opposite to an outer loop.
    let depth = 0
    const probe = poly[0]
    for (let jx = 0; jx < subpaths.length; jx++) {
      if (jx === i || subpaths[jx].length < 3) continue
      if (pointInPolygon(probe, subpaths[jx])) depth++
    }
    const holeSign = depth % 2 === 0 ? 1 : -1
    const orient = areas[i] >= 0 ? 1 : -1 // away-from-own-interior = orient * right normal
    return offsetOne(poly, dist * orient * holeSign)
  })
}

// Proper intersection point of segments a→b and c→d, or null when they don't cross
// in their interiors. Shared endpoints (adjacent edges) and collinear overlaps return
// null: those aren't the self-crossings we clean. Mirrors the intent of Rust
// `segments_cross` (src/geometry.rs) but returns the crossing point.
export function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r: Pt = [b[0] - a[0], b[1] - a[1]]
  const s: Pt = [d[0] - c[0], d[1] - c[1]]
  const denom = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(denom) < 1e-12) return null // parallel or collinear
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denom
  // Strictly interior on both segments (open interval) → a genuine crossing, not a
  // shared vertex that merely touches.
  const EPS = 1e-9
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null
  return [a[0] + t * r[0], a[1] + t * r[1]]
}

// Remove self-intersections from each closed subpath so the cut is a simple polygon a
// cutter can physically follow. Greedy winding-based loop removal: at the first crossing
// of two non-adjacent edges, split the loop into the two sub-loops that meet at the
// crossing point and keep the one whose winding matches the original (ties → larger
// area), dropping the spurious loop's nodes. Repeat to convergence. Subpaths (incl.
// holes) are cleaned independently, each against its own winding. Not a full boolean
// self-union — enough for the small die-line offsets and traced outlines this targets.
export function removeSelfIntersections(subpaths: Pt[][]): Pt[][] {
  const out: Pt[][] = []
  for (const sp of subpaths) {
    const cleaned = cleanLoop(sp)
    if (cleaned.length >= 3) out.push(cleaned)
  }
  return out
}

function cleanLoop(polyIn: Pt[]): Pt[] {
  let poly = dedupe(polyIn)
  if (poly.length < 4) return poly
  const wantSign = Math.sign(signedArea(poly)) || 1
  // Each pass removes one crossing; bound the work in case of degenerate geometry.
  const maxPasses = poly.length * 2 + 16
  for (let pass = 0; pass < maxPasses; pass++) {
    const n = poly.length
    let found: { i: number; j: number; x: Pt } | null = null
    for (let i = 0; i < n && !found; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % n]
      // Start j at i+2 so adjacent edges are skipped; stop before the edge that wraps
      // back to i (that pair is adjacent to edge i through vertex i).
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue // edges (n-1→0) and (0→1) are adjacent
        const x = segsCross(a, b, poly[j], poly[(j + 1) % n])
        if (x) { found = { i, j, x }; break }
      }
    }
    if (!found) break
    const { i, j, x } = found
    // Inner loop: crossing → v[i+1..j] → back to crossing. Outer loop: crossing →
    // v[j+1..n-1], v[0..i] → back to crossing.
    const inner: Pt[] = [x]
    for (let k = i + 1; k <= j; k++) inner.push(poly[k])
    const outer: Pt[] = [x]
    for (let k = j + 1; k < n; k++) outer.push(poly[k])
    for (let k = 0; k <= i; k++) outer.push(poly[k])
    const innerA = signedArea(inner)
    const outerA = signedArea(outer)
    const innerOk = Math.sign(innerA) === wantSign
    const outerOk = Math.sign(outerA) === wantSign
    let keep: Pt[]
    if (innerOk && !outerOk) keep = inner
    else if (outerOk && !innerOk) keep = outer
    else keep = Math.abs(outerA) >= Math.abs(innerA) ? outer : inner // both/neither → larger
    poly = dedupe(keep)
    if (poly.length < 4) break
  }
  return poly
}

export function polygonsBBox(subpaths: Pt[][]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const sp of subpaths) {
    for (const [x, y] of sp) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

// Serialize closed subpaths to an SVG path `d` (M/L…Z), the form CardCanvas's
// interior-mask consumer and `flattenPathD` both accept.
export function polygonsToPathD(subpaths: Pt[][], f: (v: number) => number = (v) => +v.toFixed(4)): string {
  let d = ''
  for (const sp of subpaths) {
    if (sp.length < 3) continue
    sp.forEach(([x, y], i) => {
      d += `${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`
    })
    d += 'Z'
  }
  return d
}
