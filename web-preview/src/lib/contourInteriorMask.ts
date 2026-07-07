// Derive a preview "keep" mask from a rasterized contour outline and return it as
// a *vector* SVG path (so it stays crisp at any preview zoom — a raster mask
// pixelates when zoomed in). The pipeline:
//   1. Flood-fill the transparent exterior inward from the image border; whatever
//      the fill can't reach (blocked by the drawn outline) is the region the cut
//      keeps.
//   2. Trace the boundary between that "keep" region and the exterior as loops of
//      unit pixel edges, stitched into closed circuits.
//   3. Simplify each circuit (Douglas–Peucker) to drop the staircase steps.
// The path is emitted in fractional coordinates (0..1 of the contour box, y-down)
// so CardCanvas can scale it to wherever the contour image is drawn, and uses the
// even-odd fill rule so nested holes (e.g. a ring contour) render correctly.
//
// Preset shapes use a precise analytic path instead (see `contourMask.ts`); this
// is the uploaded-PDF path, where only the rasterized outline is known.
//
// Returns null when the outline isn't usefully closed: an open path lets the fill
// leak into the interior, leaving almost nothing "inside", so callers fall back
// to dimming the bounding box rather than the whole card.
//
// `alphaWall` is the alpha level (0..255) at/above which a pixel counts as solid
// (the fill can't pass it); `eps` is the Douglas–Peucker simplification tolerance in
// pixels. Both default to the values tuned for the uploaded-contour fallback; the
// PNG-trace contour source exposes them as user sliders.
export async function computeContourInteriorMaskPath(
  imageUrl: string,
  opts: { alphaWall?: number; eps?: number } = {},
): Promise<string | null> {
  const ALPHA_WALL = opts.alphaWall ?? 16
  const EPS = opts.eps ?? 1.0
  const img = await loadImage(imageUrl)
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w === 0 || h === 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, w, h).data

  // A pixel belongs to the drawn outline ("wall") once its alpha clears
  // `ALPHA_WALL`; anything fainter is empty space the fill can flow through. The
  // contour is rendered onto a transparent canvas, so the exterior is alpha 0.
  const n = w * h
  // keep[i] = 1 for pixels the fill can't reach (interior + the outline itself),
  // i.e. the region to leave bright; 0 for the flood-filled exterior.
  const keep = new Uint8Array(n).fill(1)
  const stack: number[] = []
  const flood = (idx: number) => {
    if (!keep[idx]) return
    if (data[idx * 4 + 3] >= ALPHA_WALL) return // wall blocks the fill
    keep[idx] = 0
    stack.push(idx)
  }
  for (let x = 0; x < w; x++) {
    flood(x)
    flood((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    flood(y * w)
    flood(y * w + (w - 1))
  }
  let keepCount = n
  while (stack.length > 0) {
    const idx = stack.pop()!
    keepCount-- // counted lazily: every popped pixel was set to exterior
    const x = idx % w
    const y = (idx - x) / w
    if (x > 0) flood(idx - 1)
    if (x < w - 1) flood(idx + 1)
    if (y > 0) flood(idx - w)
    if (y < h - 1) flood(idx + w)
  }
  // Open outline: the fill reached almost everything, so the "keep" region is just
  // the thin stroke. Bail to the bounding-box fallback.
  if (keepCount < n * 0.01) return null

  // Collect the boundary as undirected unit edges on the (w+1)×(h+1) lattice: for
  // every keep pixel, each side facing the exterior (or the image edge) is an edge.
  // Lattice node id = y*(w+1)+x. Adjacency lists double as a consumable multigraph.
  const stride = w + 1
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    ;(adj.get(a) ?? adj.set(a, []).get(a)!).push(b)
    ;(adj.get(b) ?? adj.set(b, []).get(b)!).push(a)
  }
  const isKeep = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && keep[y * w + x] === 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (keep[y * w + x] !== 1) continue
      const tl = y * stride + x
      const tr = tl + 1
      const bl = (y + 1) * stride + x
      const br = bl + 1
      if (!isKeep(x - 1, y)) link(tl, bl) // left edge
      if (!isKeep(x + 1, y)) link(tr, br) // right edge
      if (!isKeep(x, y - 1)) link(tl, tr) // top edge
      if (!isKeep(x, y + 1)) link(bl, br) // bottom edge
    }
  }

  // Walk each connected component into a closed circuit (Hierholzer): every lattice
  // node has even degree, so a closed walk consuming all of a component's edges
  // always exists. Multiple components → multiple loops (separate shapes / holes).
  const xOf = (id: number) => id % stride
  const yOf = (id: number) => (id - (id % stride)) / stride
  const loops: Array<Array<[number, number]>> = []
  for (const start of adj.keys()) {
    if ((adj.get(start)?.length ?? 0) === 0) continue
    const walk: number[] = [start]
    const circuit: number[] = []
    while (walk.length > 0) {
      const v = walk[walk.length - 1]
      const list = adj.get(v)!
      if (list.length > 0) {
        const u = list.pop()!
        const back = adj.get(u)!
        back.splice(back.lastIndexOf(v), 1) // consume the reverse edge too
        walk.push(u)
      } else {
        circuit.push(walk.pop()!)
      }
    }
    if (circuit.length >= 4) loops.push(circuit.map((id) => [xOf(id), yOf(id)] as [number, number]))
  }
  if (loops.length === 0) return null

  // Simplify and emit. Coordinates are normalized to the contour box. With the
  // high-resolution trace source, ~1px tolerance collapses the rasterized staircase
  // of straight runs into clean lines yet keeps curved outlines smooth (a circle
  // stays a fine many-segment polygon rather than a coarse facet count) and
  // preserves real corners, whose deviation is far larger.
  const f = (v: number) => +v.toFixed(5)
  let d = ''
  for (const loop of loops) {
    const simple = simplifyClosed(loop, EPS)
    if (simple.length < 3 || polygonArea(simple) < 2) continue // drop slivers / specks
    simple.forEach(([x, y], i) => {
      d += `${i === 0 ? 'M' : 'L'}${f(x / w)} ${f(y / h)}`
    })
    d += 'Z'
  }
  return d || null
}

// Iterative Douglas–Peucker on a closed loop (first point == last point). Keeps the
// loop's start/end; recursion is unrolled to a stack to handle long boundaries.
function simplifyClosed(points: Array<[number, number]>, eps: number): Array<[number, number]> {
  const nPts = points.length
  if (nPts < 3) return points.slice()
  const keep = new Uint8Array(nPts)
  keep[0] = 1
  keep[nPts - 1] = 1
  const segs: Array<[number, number]> = [[0, nPts - 1]]
  while (segs.length > 0) {
    const [s, e] = segs.pop()!
    const [ax, ay] = points[s]
    const [bx, by] = points[e]
    let maxD = -1
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const dist = perpDistance(points[i], ax, ay, bx, by)
      if (dist > maxD) {
        maxD = dist
        idx = i
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1
      segs.push([s, idx], [idx, e])
    }
  }
  const out: Array<[number, number]> = []
  for (let i = 0; i < nPts; i++) if (keep[i]) out.push(points[i])
  return out
}

function perpDistance(p: [number, number], ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - ax, p[1] - ay)
  const t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2
  return Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))
}

function polygonArea(points: Array<[number, number]>): number {
  let area = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1])
  }
  return Math.abs(area) / 2
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Nu am putut încărca imaginea conturului'))
    img.src = url
  })
}
