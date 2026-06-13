import { useEffect, useRef, useState } from 'react'
import { SelectField, TextField } from './fields'
import {
  fetchGoogleFont,
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
  const latestQuery = useRef(query)

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
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-gray-300 bg-white text-sm shadow-lg dark:border-gray-600 dark:bg-gray-800">
            {matches.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => selectFamily(name)}
                  className="block w-full px-2 py-1 text-left hover:bg-blue-50 dark:hover:bg-gray-700"
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

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
