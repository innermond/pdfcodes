// Robust cleanup of cut outlines, backed by Clipper (an established polygon-clipping
// library) instead of hand-rolled geometry. A cut path is physically followed by a
// cutter, so it must be made of simple, non-overlapping loops: no self-crossings, no two
// loops tracing the same stretch (a double cut), no coincident shared edges, no specks.
//
// Polygons are `Pt[][]` (one array per closed loop), the same contract as
// contourOffset.ts. Clipper works on integer coordinates, so points are scaled by
// `scale` (units → integer grid) on the way in and back on the way out; the default of
// 1000 gives micrometre resolution for mm input.
import ClipperLib, { type IntPoint, type Paths } from 'clipper-lib'
import type { Pt } from './contourKeepRegion'

const DEFAULT_SCALE = 1000

function toPaths(polys: Pt[][], scale: number): Paths {
  return polys
    .filter((p) => p.length >= 3)
    .map((p) => p.map(([x, y]): IntPoint => ({ X: Math.round(x * scale), Y: Math.round(y * scale) })))
}

function fromPaths(paths: Paths, scale: number): Pt[][] {
  return paths.filter((p) => p.length >= 3).map((p) => p.map((q): Pt => [q.X / scale, q.Y / scale]))
}

// Normalize an even-odd set of loops (outer rings + holes by nesting, as the traced /
// preset / vector sources produce) to simple loops: overlaps resolved, duplicates and
// collinear shared edges merged, collinear points removed. Outers and holes keep their
// roles (Clipper orients outers positive and holes negative).
export function simplifyEvenOdd(polys: Pt[][], scale = DEFAULT_SCALE): Pt[][] {
  const out = ClipperLib.Clipper.SimplifyPolygons(toPaths(polys, scale), ClipperLib.PolyFillType.pftEvenOdd)
  return fromPaths(ClipperLib.Clipper.CleanPolygons(out, 1), scale)
}

// Union of loops that each describe a *filled* region (any winding): the merged
// silhouette. Every loop is oriented positive first so a reversed loop can't cancel a
// neighbour. `outerOnly` drops interior holes, leaving the outer boundary alone.
export function unionPolygons(polys: Pt[][], opts: { scale?: number; outerOnly?: boolean } = {}): Pt[][] {
  const scale = opts.scale ?? DEFAULT_SCALE
  const paths = toPaths(polys, scale).map((p) => (ClipperLib.Clipper.Orientation(p) ? p : p.slice().reverse()))
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true)
  const solution: Paths = []
  clipper.Execute(ClipperLib.ClipType.ctUnion, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  const kept = opts.outerOnly ? solution.filter((p) => ClipperLib.Clipper.Orientation(p)) : solution
  return fromPaths(ClipperLib.Clipper.CleanPolygons(kept, 1), scale)
}

// Equidistant offset of an even-odd region by `dist` (units; >0 grows, <0 shrinks).
// The region is simplified first and offset as one shape, so separate parts that grow
// into each other merge (no overlapping cut lines), a hole growing into its outer
// closes up, and a thin part that shrinks past zero disappears. Growth uses round
// joins; shrinking keeps sharp corners (mitre with a cap that falls back to a bevel).
export function offsetClean(polys: Pt[][], dist: number, scale = DEFAULT_SCALE): Pt[][] {
  const base = ClipperLib.Clipper.SimplifyPolygons(toPaths(polys, scale), ClipperLib.PolyFillType.pftEvenOdd)
  if (!dist) return fromPaths(base, scale)
  const grow = dist > 0
  // Arc tolerance 0.005 units keeps round joins within 5 µm of the true arc (mm input).
  const co = new ClipperLib.ClipperOffset(4, 0.005 * scale)
  co.AddPaths(base, grow ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon)
  const solution: Paths = []
  co.Execute(solution, dist * scale)
  return fromPaths(ClipperLib.Clipper.CleanPolygons(solution, 1), scale)
}

// Drop loops whose enclosed area is below `minArea` (square units) — raster noise
// islands and sliver holes that would each become a pointless tiny cut.
export function dropSpecks(polys: Pt[][], minArea: number): Pt[][] {
  return polys.filter((p) => {
    let a = 0
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]
    return Math.abs(a) / 2 >= minArea
  })
}

export interface CutDefects {
  // Loops that still cross themselves or another loop, or overlap one (area is
  // double-counted), i.e. would be cut over twice or tear stock.
  overlapping: boolean
  // Loops below the speck threshold.
  specks: number
}

// Detect what cleanup would change: `polys` is defect-free when the even-odd
// simplification returns the same total area and loop count (it only merges/splits
// loops that overlap or self-cross).
export function findCutDefects(polys: Pt[][], minSpeckArea: number, scale = DEFAULT_SCALE): CutDefects {
  const area = (ps: Pt[][]) =>
    ps.reduce((s, p) => {
      let a = 0
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]
      return s + Math.abs(a) / 2
    }, 0)
  const valid = polys.filter((p) => p.length >= 3)
  const clean = simplifyEvenOdd(valid, scale)
  const tol = Math.max(1e-6, area(valid) * 1e-4)
  const overlapping = clean.length !== valid.length || Math.abs(area(clean) - area(valid)) > tol
  return { overlapping, specks: valid.length - dropSpecks(valid, minSpeckArea).length }
}
