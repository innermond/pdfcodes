// Rasterize the live preview <svg> (CardCanvas) to a PNG so it can be copied to the
// clipboard or downloaded. Done by hand (no dependency): a serialized SVG is rendered
// by the browser in an isolated context that can't see the document's JS-registered
// FontFaces (lib/fonts.ts) or Tailwind classes, so we clone it, embed the fonts as
// base64 `@font-face`s, re-add the bits that matter (isolation for blend modes), and
// draw it onto a canvas. Every href in the SVG is a data-URL (PNG background, SVG
// contour), so the canvas is never tainted and `toBlob` works.

const SVG_NS = 'http://www.w3.org/2000/svg'

// Default oversampling so text/edges stay crisp when pasted at 1:1.
const DEFAULT_SCALE = 2

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // Chunk to stay well under the argument-count limit of String.fromCharCode.
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

// One `@font-face` per family, with the font bytes inlined as a data-URL so the
// serialized SVG renders text in the real fonts. Format is left to the browser to
// sniff (data-URLs make the `format()` hint unnecessary and TTF/OTF/WOFF/WOFF2 all
// work), so the MIME is a neutral octet-stream — the default font is now WOFF2
// while uploaded/Google fonts stay TTF/OTF, and one label can't fit them all.
export function buildFontFaceCss(families: { family: string; bytes: ArrayBuffer }[]): string {
  return families
    .map(({ family, bytes }) =>
      `@font-face{font-family:'${family}';src:url(data:application/octet-stream;base64,${arrayBufferToBase64(bytes)});}`,
    )
    .join('\n')
}

// Clone the preview SVG into a standalone, self-contained document ready to rasterize:
// drop the selection chrome, inline the fonts, keep blend-mode isolation, and pin an
// explicit pixel size (viewBox × scale) since the live SVG sizes itself via CSS.
export function prepareSvgForExport(
  svg: SVGSVGElement,
  fontFaceCss: string,
  scale = DEFAULT_SCALE,
  clipToContour = false,
): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement

  // Remove the animated "marching-ants" selection/hover outlines (word + contour):
  // every such group carries an <animate>. The transparent drag hit-rects are
  // invisible, so they need no removal.
  const groups = new Set<Element>()
  clone.querySelectorAll('animate').forEach((a) => {
    const g = a.closest('g')
    if (g) groups.add(g)
  })
  groups.forEach((g) => g.remove())

  // Contour cut-out: drop the contour outline drawing (it's a cutting guide, not
  // content) and clip everything else to the contour's "keep" region so the export
  // shows only the print + codes inside the contour, transparent outside. CardCanvas
  // renders a hidden <clipPath data-capture-clip> with that exact geometry, and tags
  // the contour outline <image> whose x/y/width/height are the contour's footprint —
  // we crop the export to that box so there's no meaningless transparent margin.
  let cropBox: { x: number; y: number; w: number; h: number } | null = null
  if (clipToContour) {
    const outline = clone.querySelector('[data-contour-outline]')
    if (outline) {
      const x = parseFloat(outline.getAttribute('x') ?? '')
      const y = parseFloat(outline.getAttribute('y') ?? '')
      const w = parseFloat(outline.getAttribute('width') ?? '')
      const h = parseFloat(outline.getAttribute('height') ?? '')
      if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) cropBox = { x, y, w, h }
      outline.remove()
    }
    const cp = clone.querySelector('clipPath[data-capture-clip]')
    if (cp?.id) {
      const g = document.createElementNS(SVG_NS, 'g')
      g.setAttribute('clip-path', `url(#${cp.id})`)
      // Move the renderable content into the clipped group, leaving the font <style>,
      // the dim <defs>, and the clip def itself in place (the def is referenced by the
      // group, not moved into it). Snapshot first so the live list isn't mutated mid-loop.
      for (const child of [...clone.children]) {
        const tag = child.tagName.toLowerCase()
        if (tag === 'style' || tag === 'defs' || tag === 'clippath') continue
        g.appendChild(child)
      }
      clone.appendChild(g)
    }
  }

  if (fontFaceCss) {
    const style = document.createElementNS(SVG_NS, 'style')
    style.textContent = fontFaceCss
    clone.insertBefore(style, clone.firstChild)
  }

  // `isolate` is a Tailwind class on the live SVG; it won't carry over, so set it
  // inline — otherwise multiply/darken/etc. composite against nothing.
  clone.style.isolation = 'isolate'

  // Pin an explicit pixel size (view box × scale). For a cut-out, narrow the view box
  // to the contour footprint so the raster is just the shape, not the whole card.
  const vb = svg.viewBox.baseVal
  const outW = cropBox ? cropBox.w : vb.width
  const outH = cropBox ? cropBox.h : vb.height
  if (cropBox) clone.setAttribute('viewBox', `${cropBox.x} ${cropBox.y} ${outW} ${outH}`)
  clone.setAttribute('width', String(outW * scale))
  clone.setAttribute('height', String(outH * scale))
  clone.setAttribute('xmlns', SVG_NS)

  return clone
}

// Render the prepared SVG onto a canvas and resolve a PNG blob. Normally the canvas
// gets a white backing; for a contour cut-out (`clipToContour`) it stays transparent
// so the area outside the contour is see-through.
export async function rasterizePreview(
  svg: SVGSVGElement,
  fontFaceCss: string,
  scale = DEFAULT_SCALE,
  clipToContour = false,
): Promise<Blob> {
  const prepared = prepareSvgForExport(svg, fontFaceCss, scale, clipToContour)
  const xml = new XMLSerializer().serializeToString(prepared)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))

  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    // The prepared SVG's width/height are already device pixels (view box × scale) and
    // reflect any contour crop, so the canvas matches the raster exactly.
    canvas.width = Math.max(1, Math.round(parseFloat(prepared.getAttribute('width') ?? '0')))
    canvas.height = Math.max(1, Math.round(parseFloat(prepared.getAttribute('height') ?? '0')))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    // White backing so transparent areas don't turn black when pasted — but the
    // contour cut-out wants the exterior to stay transparent, so skip it there.
    if (!clipToContour) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await canvasToBlob(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to render the preview SVG'))
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode PNG'))), 'image/png')
  })
}

// Try to copy the image to the clipboard; return false (don't throw) when the browser
// can't, so the caller can fall back to a download.
export async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return true
  } catch {
    return false
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
