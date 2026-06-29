// Shared PDF.js operator-list walker for an uploaded contour PDF. It turns the page's
// drawing commands into a list of *painted* vector paths, in device space (PDF.js
// viewport at scale 1: y-down, origin top-left, page rotation + y-flip baked in). Two
// consumers build on it:
//   - `contourVectorMask.ts` — the dim-exterior "keep" path (geometry only).
//   - `contourVectorImage.ts` — the crisp, non-pixelating contour preview (styled).
// Keeping the operator decoding in one place avoids two copies of the subtle path /
// transform bookkeeping.
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const { OPS, Util } = pdfjsLib
type Matrix = number[]
export type Point = [number, number]
// A subpath segment in device space (CTM already applied). 'M' starts a subpath, 'L' is
// a line, 'C' is a cubic Bézier with its two control points. `p` is the anchor/endpoint.
export type Seg = { t: 'M' | 'L'; p: Point } | { t: 'C'; c1: Point; c2: Point; p: Point }
// A subpath plus whether the PDF explicitly closed it (closePath / rectangle). The image
// renderer honors this so an open stroked path isn't given a phantom closing segment; the
// mask force-closes regardless (a fill needs closed loops).
export interface Subpath {
  segs: Seg[]
  closed: boolean
}

export interface PaintedPath {
  subpaths: Subpath[]
  stroke: boolean
  fill: boolean
  evenOdd: boolean
  strokeColor: string
  fillColor: string
  // Stroke width in device units (the PDF line width scaled by the CTM).
  strokeWidth: number
  lineCap: 'butt' | 'round' | 'square'
  lineJoin: 'miter' | 'round' | 'bevel'
}

export interface ContourOps {
  // Page size in PDF points (scale-independent), matching renderPdfBackground.
  widthPt: number
  heightPt: number
  pageCount: number
  // Device-space viewBox the subpath coords live in (viewport at scale 1).
  vw: number
  vh: number
  paths: PaintedPath[]
}

interface GState {
  ctm: Matrix
  strokeColor: string
  fillColor: string
  lineWidth: number
  lineCap: PaintedPath['lineCap']
  lineJoin: PaintedPath['lineJoin']
}

const CAPS: PaintedPath['lineCap'][] = ['butt', 'round', 'square']
const JOINS: PaintedPath['lineJoin'][] = ['miter', 'round', 'bevel']

// Uniform scale factor the CTM applies, used to map PDF user-space line widths into the
// device-space viewBox (sqrt of the linear part's determinant).
function ctmScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1
}

export async function extractContourOps(
  file: File,
  pageNumber = 1,
  rotation = 0,
): Promise<ContourOps | null> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const pageCount = pdf.numPages
  const safePage = Math.min(Math.max(1, Math.floor(pageNumber)), pageCount)
  const page = await pdf.getPage(safePage)

  // Same rotation/viewport convention as renderPdfBackground: combine the page's
  // intrinsic /Rotate with the user rotation. At scale 1, viewport.transform maps PDF
  // user space -> device space and viewport.width/height are the displayed page size.
  const totalRotation = (((page.rotate + rotation) % 360) + 360) % 360
  const viewport = page.getViewport({ scale: 1, rotation: totalRotation })
  const base = viewport.transform as Matrix
  const { width: vw, height: vh } = viewport
  if (vw <= 0 || vh <= 0) return null

  const { fnArray, argsArray } = await page.getOperatorList()

  // Graphics-state stack: save/restore push/pop the whole state (CTM + paint + stroke
  // style), transform composes onto the CTM, and the color/line ops mutate the top.
  let g: GState = {
    ctm: base,
    strokeColor: '#000000',
    fillColor: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  }
  const stack: GState[] = []

  // The path under construction (subpaths in device space) plus the running current
  // point in *user* space so curveTo2/3 resolve before transforming.
  let subpaths: Subpath[] = []
  let current: Subpath | null = null
  let cur: Point = [0, 0]
  const paths: PaintedPath[] = []

  const dev = (x: number, y: number): Point => Util.applyTransform([x, y], g.ctm) as Point
  const start = (): Subpath => {
    const sp: Subpath = { segs: [{ t: 'M', p: dev(cur[0], cur[1]) }], closed: false }
    subpaths.push(sp)
    return sp
  }
  const flush = (stroke: boolean, fill: boolean, evenOdd: boolean) => {
    const sps = subpaths.filter((sp) => sp.segs.length >= 2)
    if (sps.length > 0) {
      paths.push({
        subpaths: sps,
        stroke,
        fill,
        evenOdd,
        strokeColor: g.strokeColor,
        fillColor: g.fillColor,
        strokeWidth: g.lineWidth * ctmScale(g.ctm),
        lineCap: g.lineCap,
        lineJoin: g.lineJoin,
      })
    }
    subpaths = []
    current = null
  }

  for (let i = 0; i < fnArray.length; i++) {
    const args = argsArray[i] as unknown[]
    switch (fnArray[i]) {
      case OPS.save:
        stack.push({ ...g })
        break
      case OPS.restore:
        g = stack.pop() ?? g
        break
      case OPS.transform:
        g.ctm = Util.transform(g.ctm, args as Matrix)
        break
      case OPS.setLineWidth:
        g.lineWidth = args[0] as number
        break
      case OPS.setLineCap:
        g.lineCap = CAPS[args[0] as number] ?? 'butt'
        break
      case OPS.setLineJoin:
        g.lineJoin = JOINS[args[0] as number] ?? 'miter'
        break
      case OPS.setStrokeRGBColor:
        g.strokeColor = Util.makeHexColor(args[0] as number, args[1] as number, args[2] as number)
        break
      case OPS.setFillRGBColor:
        g.fillColor = Util.makeHexColor(args[0] as number, args[1] as number, args[2] as number)
        break
      case OPS.constructPath: {
        const [ops, coords] = args as [number[], number[]]
        let j = 0
        for (let k = 0; k < ops.length; k++) {
          switch (ops[k] | 0) {
            case OPS.rectangle: {
              const x = coords[j++], y = coords[j++], w = coords[j++], h = coords[j++]
              current = {
                segs: [
                  { t: 'M', p: dev(x, y) },
                  { t: 'L', p: dev(x + w, y) },
                  { t: 'L', p: dev(x + w, y + h) },
                  { t: 'L', p: dev(x, y + h) },
                ],
                closed: true, // a rectangle subpath is implicitly closed
              }
              subpaths.push(current)
              cur = [x, y]
              break
            }
            case OPS.moveTo: {
              const x = coords[j++], y = coords[j++]
              current = { segs: [{ t: 'M', p: dev(x, y) }], closed: false }
              subpaths.push(current)
              cur = [x, y]
              break
            }
            case OPS.lineTo: {
              const x = coords[j++], y = coords[j++]
              current ??= start()
              current.segs.push({ t: 'L', p: dev(x, y) })
              cur = [x, y]
              break
            }
            case OPS.curveTo: {
              const c1x = coords[j++], c1y = coords[j++]
              const c2x = coords[j++], c2y = coords[j++]
              const x = coords[j++], y = coords[j++]
              current ??= start()
              current.segs.push({ t: 'C', c1: dev(c1x, c1y), c2: dev(c2x, c2y), p: dev(x, y) })
              cur = [x, y]
              break
            }
            case OPS.curveTo2: {
              // control1 == current point.
              const c2x = coords[j++], c2y = coords[j++]
              const x = coords[j++], y = coords[j++]
              current ??= start()
              current.segs.push({ t: 'C', c1: dev(cur[0], cur[1]), c2: dev(c2x, c2y), p: dev(x, y) })
              cur = [x, y]
              break
            }
            case OPS.curveTo3: {
              // control2 == end point.
              const c1x = coords[j++], c1y = coords[j++]
              const x = coords[j++], y = coords[j++]
              current ??= start()
              current.segs.push({ t: 'C', c1: dev(c1x, c1y), c2: dev(x, y), p: dev(x, y) })
              cur = [x, y]
              break
            }
            case OPS.closePath:
              if (current) current.closed = true
              break
          }
        }
        break
      }
      // Painting ops consume the constructed path; record which paints apply.
      case OPS.stroke:
      case OPS.closeStroke:
        flush(true, false, false)
        break
      case OPS.fill:
        flush(false, true, false)
        break
      case OPS.eoFill:
        flush(false, true, true)
        break
      case OPS.fillStroke:
      case OPS.closeFillStroke:
        flush(true, true, false)
        break
      case OPS.eoFillStroke:
      case OPS.closeEOFillStroke:
        flush(true, true, true)
        break
      // Clip and endPath drop the pending path without painting.
      case OPS.endPath:
      case OPS.clip:
      case OPS.eoClip:
        subpaths = []
        current = null
        break
    }
  }

  return { widthPt: vw, heightPt: vh, pageCount, vw, vh, paths }
}

// Serialize subpaths to an SVG path-data fragment. `map` converts a device-space point
// to the target coordinate space (identity for the image renderer, normalize-to-0..1 for
// the mask). With `forceClose`, every subpath gets a Z (the mask needs closed loops for
// even-odd fill); otherwise only subpaths the PDF actually closed do.
export function segsToPathD(
  subpaths: Subpath[],
  map: (p: Point) => Point,
  f: (v: number) => number,
  forceClose: boolean,
): string {
  let d = ''
  for (const sp of subpaths) {
    for (const s of sp.segs) {
      if (s.t === 'C') {
        const c1 = map(s.c1), c2 = map(s.c2), p = map(s.p)
        d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p[0])} ${f(p[1])}`
      } else {
        const p = map(s.p)
        d += `${s.t}${f(p[0])} ${f(p[1])}`
      }
    }
    if (forceClose || sp.closed) d += 'Z'
  }
  return d
}

// Anchor-polygon area of a subpath (ignores curve bulge — exact enough for the mask's
// sliver threshold).
export function subpathArea(sp: Subpath): number {
  let area = 0
  const pts = sp.segs.map((s) => s.p)
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1])
  }
  return Math.abs(area) / 2
}
