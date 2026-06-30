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
// serialized SVG renders text in the real fonts. Format is left to the browser to sniff
// (data-URLs make the `format()` hint unnecessary and TTF/OTF/WOFF all work).
export function buildFontFaceCss(families: { family: string; bytes: ArrayBuffer }[]): string {
  return families
    .map(({ family, bytes }) =>
      `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${arrayBufferToBase64(bytes)});}`,
    )
    .join('\n')
}

// Clone the preview SVG into a standalone, self-contained document ready to rasterize:
// drop the selection chrome, inline the fonts, keep blend-mode isolation, and pin an
// explicit pixel size (viewBox × scale) since the live SVG sizes itself via CSS.
export function prepareSvgForExport(svg: SVGSVGElement, fontFaceCss: string, scale = DEFAULT_SCALE): SVGSVGElement {
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

  if (fontFaceCss) {
    const style = document.createElementNS(SVG_NS, 'style')
    style.textContent = fontFaceCss
    clone.insertBefore(style, clone.firstChild)
  }

  // `isolate` is a Tailwind class on the live SVG; it won't carry over, so set it
  // inline — otherwise multiply/darken/etc. composite against nothing.
  clone.style.isolation = 'isolate'

  const { width, height } = svg.viewBox.baseVal
  clone.setAttribute('width', String(width * scale))
  clone.setAttribute('height', String(height * scale))
  clone.setAttribute('xmlns', SVG_NS)

  return clone
}

// Render the prepared SVG onto a white canvas and resolve a PNG blob.
export async function rasterizePreview(svg: SVGSVGElement, fontFaceCss: string, scale = DEFAULT_SCALE): Promise<Blob> {
  const { width: vbWidth, height: vbHeight } = svg.viewBox.baseVal
  const prepared = prepareSvgForExport(svg, fontFaceCss, scale)
  const xml = new XMLSerializer().serializeToString(prepared)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))

  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(vbWidth * scale))
    canvas.height = Math.max(1, Math.round(vbHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    // White backing so transparent areas don't turn black when pasted.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
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
