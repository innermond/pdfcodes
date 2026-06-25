import { useEffect, useRef, useState } from 'react'
import { SelectField, TextField } from './fields'
import {
  fetchGoogleFont,
  familySupportsLatinExt,
  googleFontsCss2Url,
  PREVIEW_SAMPLE,
  searchGoogleFonts,
  stylesForFamily,
  GOOGLE_FONT_STYLES,
  type GoogleFontStyle,
} from '../lib/googleFonts'
import type { LoadedFont } from '../lib/fonts'

export interface GoogleFontSelection {
  family: string
  style: GoogleFontStyle
}

// Searchable picker for the Google Fonts catalog (see
// src/lib/googleFonts.ts). On selection, fetches the chosen family/style's
// .ttf bytes and reports both the selection (for re-rendering this picker
// when switching between words) and the resulting LoadedFont (for use in the
// generator, the same way an uploaded .ttf/.otf is used).
export function GoogleFontPicker({
  value,
  onChange,
}: {
  value: GoogleFontSelection | null
  onChange: (selection: GoogleFontSelection | null, font: LoadedFont | null) => void
}) {
  const [query, setQuery] = useState(value?.family ?? '')
  const [matches, setMatches] = useState<string[]>([])
  const [styles, setStyles] = useState<GoogleFontStyle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // False when the selected family can't render Romanian diacritics (no
  // latin-ext subset). Defaults true so unknown fonts don't warn.
  const [latinExtOk, setLatinExtOk] = useState(true)
  const latestQuery = useRef(query)
  const previewLinkRef = useRef<HTMLLinkElement | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // Result families that have scrolled into view; only these get preview fonts
  // requested, so we don't fetch samples for results the user can't see.
  const [visibleFamilies, setVisibleFamilies] = useState<string[]>([])

  // Watch which result items are visible in the (scrollable) dropdown and
  // accumulate their families. Re-created whenever the result list changes;
  // initially-visible items fire immediately on observe.
  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((e) => e.isIntersecting)
          .map((e) => (e.target as HTMLElement).dataset.family)
          .filter((f): f is string => !!f)
        if (seen.length > 0) setVisibleFamilies((prev) => Array.from(new Set([...prev, ...seen])))
      },
      { root },
    )
    root.querySelectorAll<HTMLElement>('li[data-family]').forEach((li) => observer.observe(li))
    return () => observer.disconnect()
  }, [matches])

  // Load tiny, glyph-subsetted preview webfonts for the *visible* result
  // families (plus the selected one) via the Google Fonts CSS2 API, so each
  // result can be rendered in its own typeface. Google's response only declares
  // @font-face; the browser fetches the woff2 binaries lazily when first used,
  // so scoping the link to visible families means only those download. A single
  // <link> is reused and its href updated as families become visible; if it
  // fails to load the samples just fall back to the default font.
  useEffect(() => {
    const families = [value?.family, ...visibleFamilies.filter((f) => matches.includes(f))].filter(
      (f): f is string => !!f,
    )
    const href = googleFontsCss2Url(families)
    if (!href) return
    let link = previewLinkRef.current
    if (!link) {
      link = document.createElement('link')
      link.rel = 'stylesheet'
      document.head.appendChild(link)
      previewLinkRef.current = link
    }
    if (link.href !== href) link.href = href
  }, [visibleFamilies, matches, value?.family])

  // Remove the preview stylesheet when the picker unmounts.
  useEffect(() => {
    return () => {
      previewLinkRef.current?.remove()
      previewLinkRef.current = null
    }
  }, [])

  // Load the styles available for the currently selected family.
  useEffect(() => {
    if (!value?.family) return
    let cancelled = false
    stylesForFamily(value.family).then((s) => {
      if (!cancelled) setStyles(s)
    })
    return () => {
      cancelled = true
    }
  }, [value?.family])

  // Check whether the selected family covers Romanian diacritics (latin-ext).
  // No reset when the family is empty: the warning JSX is gated on
  // `value?.family`, so a stale value can't surface without a selection.
  useEffect(() => {
    if (!value?.family) return
    let cancelled = false
    familySupportsLatinExt(value.family).then((ok) => {
      if (!cancelled) setLatinExtOk(ok)
    })
    return () => {
      cancelled = true
    }
  }, [value?.family])

  async function apply(family: string, style: GoogleFontStyle) {
    setLoading(true)
    setError(null)
    try {
      const available = await stylesForFamily(family)
      if (available.length === 0) {
        throw new Error(`Fontul "${family}" nu a fost găsit.`)
      }
      const resolvedStyle = available.includes(style) ? style : available[0]
      const font = await fetchGoogleFont(family, resolvedStyle)
      onChange({ family, style: resolvedStyle }, font)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      onChange(null, null)
    } finally {
      setLoading(false)
    }
  }

  function handleQueryChange(next: string) {
    setQuery(next)
    latestQuery.current = next
    if (!next.trim() || next === value?.family) {
      setMatches([])
      return
    }
    searchGoogleFonts(next).then((names) => {
      if (latestQuery.current === next) setMatches(names)
    })
  }

  function selectFamily(family: string) {
    setQuery(family)
    setMatches([])
    void apply(family, value?.style ?? 'regular')
  }

  function selectStyle(style: GoogleFontStyle) {
    if (!value?.family) return
    void apply(value.family, style)
  }

  function clear() {
    setQuery('')
    setMatches([])
    setStyles([])
    setError(null)
    onChange(null, null)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <TextField label="Google Font" value={query} onChange={handleQueryChange} placeholder="Caută un font (ex: Roboto)" />
        {matches.length > 0 && (
          <ul ref={listRef} className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-gray-300 bg-white text-sm shadow-lg dark:border-gray-600 dark:bg-gray-800">
            {matches.map((name) => (
              <li key={name} data-family={name}>
                <button
                  type="button"
                  onClick={() => selectFamily(name)}
                  className="flex w-full flex-col gap-0.5 px-2 py-1 text-left hover:bg-blue-50 dark:hover:bg-gray-700"
                >
                  <span className="text-xs text-gray-500 dark:text-gray-400">{name}</span>
                  <span className="text-lg leading-tight text-gray-900 dark:text-gray-100" style={{ fontFamily: `"${name}", sans-serif` }}>
                    {PREVIEW_SAMPLE}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {value?.family && (
        <span className="text-2xl leading-tight text-gray-900 dark:text-gray-100" style={{ fontFamily: `"${value.family}", sans-serif` }}>
          {PREVIEW_SAMPLE}
        </span>
      )}

      {value?.family && !latinExtOk && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          ⚠ Acest font nu acoperă diacriticele românești (ș, ț, ă, â, î).
        </p>
      )}

      {value?.family && styles.length > 0 && (
        <div className="flex items-end gap-2">
          <SelectField
            label="Stil"
            value={value.style}
            onChange={selectStyle}
            options={GOOGLE_FONT_STYLES.filter((s) => styles.includes(s.value))}
          />
          <button
            type="button"
            onClick={clear}
            className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Șterge
          </button>
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Se încarcă fontul...</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
