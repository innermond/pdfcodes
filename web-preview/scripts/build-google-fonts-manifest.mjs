#!/usr/bin/env node
// Builds web-preview/src/assets/google-fonts-manifest.json: for each Google
// Fonts family, the direct fonts.gstatic.com .ttf URLs for the four standard
// styles (regular, bold, italic, bold italic). Those URLs serve real
// TrueType with CORS enabled, so the browser can fetch the bytes directly and
// feed them through the same pipeline as an uploaded .ttf/.otf (see
// src/lib/googleFonts.ts).
//
// Source data: https://gwfh.mranftl.com/api/fonts (google-webfonts-helper),
// which lacks CORS itself -- hence resolving it here, at build time, instead
// of from the browser.
//
// Usage: node scripts/build-google-fonts-manifest.mjs [--limit=N]

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const API = 'https://gwfh.mranftl.com/api/fonts'
const OUT = fileURLToPath(new URL('../src/assets/google-fonts-manifest.json', import.meta.url))
const CONCURRENCY = 12

// The four styles surfaced in the picker, in order of preference for each
// slot's fallback chain.
const WANTED = {
  regular: ['regular', '400', '300', '500'],
  '700': ['700', '600', '800', '500', 'regular'],
  italic: ['italic', '400italic', '300italic', '500italic', 'regular'],
  '700italic': ['700italic', '600italic', '800italic', 'italic', '700', 'regular'],
}

function pickVariant(variants, wantedIds) {
  const byId = new Map(variants.map((v) => [v.id, v]))
  for (const id of wantedIds) {
    const v = byId.get(id)
    if (v?.ttf) return v.ttf
  }
  return null
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

async function main() {
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity)

  const list = await fetchJson(API)
  const families = list.slice(0, limit)
  console.log(`Resolving ${families.length} families...`)

  const manifest = {}
  let done = 0

  async function worker(queue) {
    while (queue.length) {
      const fam = queue.pop()
      try {
        const detail = await fetchJson(`${API}/${fam.id}?subsets=latin`)
        const variants = {}
        for (const [slot, candidates] of Object.entries(WANTED)) {
          const url = pickVariant(detail.variants, candidates)
          if (url) variants[slot] = url
        }
        if (variants.regular) {
          manifest[fam.family] = { category: fam.category, variants }
        }
      } catch (err) {
        console.warn(`skip ${fam.family}: ${err.message}`)
      } finally {
        done++
        if (done % 50 === 0) console.log(`${done}/${families.length}`)
      }
    }
  }

  const queue = [...families]
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))

  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(OUT, JSON.stringify(sorted))
  console.log(`Wrote ${Object.keys(sorted).length} families to ${OUT}`)
}

main()
