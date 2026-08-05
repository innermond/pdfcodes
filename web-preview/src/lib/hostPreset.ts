import { m } from '../paraglide/messages'

// Presets handed to the app by the page that hosts it. A gallery of saved
// settings (each `.zip` shown by the `thumbnail.png` it carries) links to the
// app, and the host serves index.html through a controller that replaces the
// `pdfcodes:preset` marker there with a descriptor. On startup the app reads
// that descriptor, downloads the archive and feeds it through the very same
// restore path as the manual "Încarcă setări" picker.
//
// Only the archive's location travels through the global: the settings
// themselves stay in the .zip, so a host page needs to know nothing about the
// preset format.
export interface HostPreset {
  // Absolute, same-origin URL of the .zip.
  url: string
  // Label for the "loaded from the gallery" notice. Optional: the app falls
  // back to the archive's filename.
  name?: string
}

declare global {
  interface Window {
    __PDFCODES_PRESET__?: unknown
  }
}

// Pure, DOM-free validation of whatever the host injected, split out from
// `readHostPreset` so it can be unit-tested. Returns null for anything
// unusable — a missing descriptor is the normal case (the app opened
// directly), so a bad one is ignored rather than raised: the app simply
// starts empty.
//
// Cross-origin URLs are rejected. That is not a security boundary (the host
// page controls the whole document anyway) but a sanity check: it keeps a
// mistyped descriptor from turning the app into a fetcher for arbitrary hosts,
// and stops CORS failures from surfacing as a confusing parse error.
export function parseHostPreset(raw: unknown, baseHref: string): HostPreset | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { url, name } = raw as { url?: unknown; name?: unknown }
  if (typeof url !== 'string' || url.trim() === '') return null

  let resolved: URL
  let base: URL
  try {
    base = new URL(baseHref)
    resolved = new URL(url, base)
  } catch {
    return null
  }
  if (resolved.origin !== base.origin) return null

  const label = typeof name === 'string' ? name.trim() : ''
  return label ? { url: resolved.href, name: label } : { url: resolved.href }
}

export function readHostPreset(): HostPreset | null {
  if (typeof window === 'undefined') return null
  return parseHostPreset(window.__PDFCODES_PRESET__, window.location.href)
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

// Name the downloaded File after the URL's last path segment so the fallback
// notice label and any later re-save read like a hand-picked file.
function fileNameFor(url: string): string {
  const segment = new URL(url).pathname.split('/').pop() ?? ''
  return segment || 'setari.zip'
}

// Download the archive a host preset points at. Credentials ride along (the
// default for same-origin) so the host can put the download behind its own
// session. The bytes are checked to actually be a zip: a host that answers a
// logged-out request with a login page or an error page returns HTML with a
// 200, which would otherwise reach `loadPresetBundle` and fail as a JSON parse
// error. Every failure mode throws an Error carrying the user-facing message.
export async function fetchHostPreset(preset: HostPreset): Promise<File> {
  let blob: Blob
  try {
    const resp = await fetch(preset.url, { credentials: 'same-origin' })
    if (!resp.ok) throw new Error(m.errors_preset_url_http({ status: resp.status }))
    blob = await resp.blob()
  } catch (err) {
    // Network failures (host unreachable) surface as a TypeError.
    if (err instanceof TypeError) {
      throw new Error(m.errors_preset_url_unreachable(), { cause: err })
    }
    throw err
  }
  const head = new Uint8Array(await blob.slice(0, ZIP_MAGIC.length).arrayBuffer())
  if (!ZIP_MAGIC.every((b, i) => head[i] === b)) {
    throw new Error(m.errors_preset_url_not_zip())
  }
  return new File([blob], fileNameFor(preset.url), { type: 'application/zip' })
}
