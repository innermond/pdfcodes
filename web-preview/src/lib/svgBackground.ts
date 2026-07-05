// Helpers for the SVG "Fundal imagine" source. An SVG background is converted
// to a vector PDF by the lazily-loaded svg-wasm module (lib/svgWasm.ts); these
// helpers cover everything around that conversion: recognizing SVG files/bytes,
// reading the aspect ratio and warning-worthy content, and baking the flip /
// backdrop options into the SVG text itself (the raster path bakes the same
// options into the image PDF, so preview and output stay identical either way).

const SVG_NS = 'http://www.w3.org/2000/svg'

// An SVG file input, by MIME type or (when the OS didn't map the extension,
// common on Windows) by file name. A declared non-SVG type wins over the name:
// a URL download called "photo.svg" that actually served PNG bytes is a PNG.
export function isSvgFile(file: File): boolean {
  if (file.type) return file.type === 'image/svg+xml'
  return /\.svg$/i.test(file.name)
}

// Sniff downloaded bytes for an SVG document. SVG is text (no magic number), so
// after decoding the head and dropping a BOM, skip anything that may legally
// precede the root element — whitespace, comments, an XML prolog, a DOCTYPE —
// and require the first real element to be <svg>.
export function looksLikeSvg(bytes: Uint8Array): boolean {
  let head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024))
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1)
  let i = 0
  while (i < head.length) {
    // Skip whitespace between prolog parts.
    if (/\s/.test(head[i])) {
      i++
      continue
    }
    if (head.startsWith('<!--', i)) {
      const end = head.indexOf('-->', i + 4)
      if (end === -1) return false
      i = end + 3
      continue
    }
    // XML prolog (<?xml …?>) or DOCTYPE (<!DOCTYPE …>).
    if (head.startsWith('<?', i) || head.startsWith('<!', i)) {
      const end = head.indexOf('>', i)
      if (end === -1) return false
      i = end + 1
      continue
    }
    return /^<svg[\s>]/.test(head.slice(i))
  }
  return false
}

// The root element's box in user units: the viewBox when present, else numeric
// width/height attributes (unitless or px — enough for aspect/flip math), else
// null when the SVG declares neither.
function rootBox(root: Element): { x: number; y: number; w: number; h: number } | null {
  const vb = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }
  }
  const w = parseFloat(root.getAttribute('width') ?? '')
  const h = parseFloat(root.getAttribute('height') ?? '')
  if (w > 0 && h > 0) return { x: 0, y: 0, w, h }
  return null
}

// Parse the SVG (throws when it isn't one) and report what the UI needs before
// conversion: the aspect ratio (to derive the target card height, as the raster
// path does via createImageBitmap — unreliable for SVG blobs cross-browser) and
// whether it contains <text> elements, which the size-trimmed svg-wasm build
// drops (no `text` feature — see svg-wasm/Cargo.toml).
export function inspectSvg(svgText: string): { aspect: number | null; hasText: boolean } {
  const root = parseSvg(svgText).documentElement
  const box = rootBox(root)
  return {
    aspect: box ? box.w / box.h : null,
    hasText: root.getElementsByTagNameNS(SVG_NS, 'text').length > 0,
  }
}

// Bake the generate-source options into the SVG text before conversion:
// - flip X/Y: wrap the content in a <g> mirroring about the box center, the
//   vector counterpart of the raster path's negated draw matrix;
// - backdrop: a full-box <rect> behind everything, the vector counterpart of
//   compositing transparent pixels over the chosen color.
// Returns the input unchanged when there's nothing to bake.
export function prepareSvgForBackground(
  svgText: string,
  opts: { flipX: boolean; flipY: boolean; backdropCss: string | null },
): string {
  const { flipX, flipY, backdropCss } = opts
  if (!flipX && !flipY && !backdropCss) return svgText

  const doc = parseSvg(svgText)
  const root = doc.documentElement
  const box = rootBox(root)

  // Mirroring needs the box to reflect about; without one (no viewBox, no
  // numeric size) flips are skipped rather than guessed.
  if ((flipX || flipY) && box) {
    const g = doc.createElementNS(SVG_NS, 'g')
    const sx = flipX ? -1 : 1
    const sy = flipY ? -1 : 1
    const tx = flipX ? 2 * box.x + box.w : 0
    const ty = flipY ? 2 * box.y + box.h : 0
    g.setAttribute('transform', `matrix(${sx} 0 0 ${sy} ${tx} ${ty})`)
    while (root.firstChild) g.appendChild(root.firstChild)
    root.appendChild(g)
  }

  if (backdropCss) {
    const rect = doc.createElementNS(SVG_NS, 'rect')
    if (box) {
      rect.setAttribute('x', String(box.x))
      rect.setAttribute('y', String(box.y))
      rect.setAttribute('width', String(box.w))
      rect.setAttribute('height', String(box.h))
    } else {
      rect.setAttribute('width', '100%')
      rect.setAttribute('height', '100%')
    }
    rect.setAttribute('fill', backdropCss)
    root.insertBefore(rect, root.firstChild)
  }

  return new XMLSerializer().serializeToString(doc)
}

// DOMParser with explicit failure: a parse error yields a <parsererror>
// document (never a throw), and a non-SVG root is just as unusable.
function parseSvg(svgText: string): Document {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.getElementsByTagName('parsererror').length > 0 || doc.documentElement.localName !== 'svg') {
    throw new Error('Fișierul nu este un SVG valid.')
  }
  return doc
}
