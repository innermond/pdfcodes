# Handoff — manual sync to the current app

Status note for the documentation sync of the user manual (+ `manual-assets/`)
against the actual 5-step app (`web-preview/src/App.tsx`).

## Manual under i18n (2026-07-14)

The app UI is internationalized (compile-time Paraglide JS): every UI string lives
in `web-preview/messages/{ro,en}.json` (~390 keys), and the app builds one language
per bundle — `npm run build` (Romanian, default) or `LOCALE=en npm run build` /
`npm run build:en` (English). The manual follows the same split:

- `manual.ro.md` — the Romanian manual (renamed from `manual.md`; history preserved,
  `git log --follow` still works).
- `manual.en.md` — the full English translation. Its quoted UI labels ("Generate
  CSV", "Source mode", …) are taken **verbatim from `messages/en.json`**, the same
  way `manual.ro.md`'s `„…”` quotes match `messages/ro.json`.
- Both manuals reference the **same screenshots** (`manual-assets/*.png`), which
  currently show the **Romanian UI**; `manual.en.md` carries a note about this near
  the top. See "Deferred: localized screenshots" below for the continuation plan.

**Maintenance rule:** when a UI string changes in `messages/ro.json` / `en.json`,
update the corresponding quoted label in **both** `manual.ro.md` and `manual.en.md`.
Quick check: extract the quoted labels (`„…”` in RO, `"…"` in EN) and verify each
UI-control quote still exists as a value in the respective catalog (a few quotes
are intentionally not catalog values: browser-native "Choose File", data examples
like "prefix code suffix", and filenames).

## Screenshot re-sync (2026-07-15)

The Jul 7 screenshot set predated two visible UI changes from later that same
week: the compact CMYK row (`e2ed4e9`, no more per-channel "%" suffix) and the
"Distanțăre → Distanțare contur (mm)" typo fix. Re-ran `shoot.mjs` (all scripted
shots) and re-took the two affected hand shots (`f2-print-simple`,
`04-color-picker`) with a throwaway Playwright script using the same patterns.
The three RO contour shots from Jul 14 were left untouched.

Found while verifying: the global "Padding fundal text (mm)" field no longer
exists in step 4's "Text exemplu" (now two global margins) — it moved into the
per-word "Fundal text" group as `words_bg_padding_label` ("Padding (mm)").
§6.1/§6.2-background of **both** manuals updated accordingly.

## Deferred: localized screenshots (continue here)

Goal: an English screenshot set in `manual-assets/en/` (or `manual-assets/{ro,en}/`
with both manuals updated), so `manual.en.md` shows the English UI.

1. Make `web-preview/shoot.mjs` locale-aware. It currently hardcodes ~35 Romanian
   UI strings as Playwright selectors ('Simplu', 'Formă presetată', 'Număr de
   rânduri', 'Pasul N din 5', 'Generează CSV', …). Since those exact strings now
   live in the message catalogs, read `messages/{locale}.json` (parse the JSON;
   variant messages are arrays — only plain-string keys are needed for selectors)
   and build the selectors from catalog values. Take the locale from argv
   (`node shoot.mjs en`) or env; default `ro`. Write output to
   `manual-assets/{locale}/`.
2. Run it against a dev server of the target locale:
   `cd web-preview && LOCALE=en npx vite --port 5199 --strictPort`, then
   `node shoot.mjs en`. (The Vite paraglide plugin picks up `LOCALE` from
   `vite.config.ts`.)
3. Scope limit: the script covers only ~20 of the 34 images (`03-*`…`06-*`,
   `s2-*`, `s3-*`, `s4-*`). The other 14 were hand-shot and are NOT scripted:
   `00-privire-generala`, `01-fundal`, `02-contur`, `f1/f2/f7`, `c1/c2`,
   `04-color-picker`, `s4-quote`, `s4-unlock`. They are plain step-1/2/overview
   views and the password-gate UI — scriptable with the same patterns (see the
   gotchas below), or re-shoot by hand on the EN build.
4. When the EN images exist: point `manual.en.md`'s image paths at
   `manual-assets/en/` and remove its "screenshots are Romanian" note.

## Status: sync COMPLETE (2026-07-07) + verification pass (same day)

All ten sections of the manual (now `manual.ro.md`) describe the current UI, and
every referenced screenshot in `manual-assets/` was retaken against it (no orphans,
no missing files).

A follow-up verification pass compared every section against the app source and
applied these text-only fixes (no screenshots affected):
- §3.4: removed the stale "(în curs de actualizare)" note; documented Shift+drag
  axis-lock for "Mută fundalul".
- §4.1: documented the multi-page auto-pick note ("Aplicația folosește automat
  pagina X din Y (diferită de pagina fundalului).").
- §4.3: Decalaj X/Y labels show the allowed range; added the "După redesenare"
  info line and direct manipulation of the contour in the preview (click/drag/
  Shift/arrows, marching ants).
- §5.2: the "Câmpuri pe rând" editor shows the *widest* uploaded row, not the
  first one.
- §6.2: documented the Google Font picker's "Stil" select + "Șterge" button,
  the live sample in the chosen font, and the latin-ext diacritics warning.
- §9: documented the print overflow report ("⚠ N rânduri conțin coduri care
  depășesc…" + "Descarcă depășirile (N, .csv)" → `depasiri.csv`) and the
  "Mostră (un card)" entry in Rezultat.

RESOLVED (2026-07-14): the old "Distanțăre contur (mm)" label typo was already
fixed in the app; the label now lives in `messages/ro.json` as
`words_contour_inset_label`, spelled "Distanțare contur (mm)", matching both
manuals.

App wizard steps (source of truth: `WIZARD_STEPS` in `web-preview/src/App.tsx`):
**1 Fundal · 2 Contur · 3 Date · 4 Coduri · 5 PDF**.

- §1–§2 General overview — done earlier (`00-privire-generala.png`).
- §3 Pasul 1 — Fundal — done earlier (`01-fundal.png`, `f1`, `f2`, `f7`).
- §4 Pasul 2 — Contur — done earlier (`02-contur.png`, `c1`, `c2`).
- §5 Pasul 3 — Date — rewritten against `CodeSourceSection.tsx`: source-mode order
  (Încarcă CSV / Generează coduri), tabbed „Cod” pills + „+ Adaugă cod”, the third
  code type „Text fix”, renamed fields (Lungime / Completare / Umplutură / Lățime
  totală), uniqueness warnings + blocked generation + duplicate report, upload
  extras („Fiecare rând este un singur cod”, the „Câmpuri pe rând” merge editor),
  and the unlock gate (5.4). Assets: `03-date.png`, `s2-*.png` (incl. new
  `s2-uniqueness.png`, `s2-fields.png`).
- §6 Pasul 4 — Coduri — rewritten against the `aspect` step: Text exemplu (3 global
  margins incl. Distanțare contur), collapsible groups (Tipografie / Poziție / Stil /
  Fundal text / Contur text), per-word fonts (Google Font picker or .ttf/.otf),
  „(contur)” align variants and „la punct fix”. Assets: `04-coduri.png`, `s3-*.png`.
- §7 Pasul 5 — PDF — rewritten against the `generare` step: no CSV field here
  anymore, corrected meanings of Decalaj X/Y (gap between neighbouring cuts) and
  Diametru cerc (registration circles), the full options list incl. Non-decupare /
  Minimal / Contur Dreptunghi / Corectare depășire (+ Font minim, Pe cod/Pe coloană),
  the size-mismatch warnings (7.3.4), and „Generează o mostră (un card)”.
  Assets: `05-pdf.png`, `s4-mode.png`, `s4-page-layout.png`, `s4-options.png`,
  `s4-cut-time.png` (kept: `s4-quote.png`, `s4-unlock.png` — password gate UI).
- §8–§10 — refreshed: preview toolbar (zoom/pan, Captură + Descarcă/Conturat),
  Rezultat incl. „Descarcă ambele (print + contur, .zip)”, 5-step workflow.
  Asset: `06-rezultat.png` retaken.

Deleted stale assets: `02-sursa-date.png`, `03-aspect-cuvinte.png`, `05-generare.png`,
`s4-mode-csv.png`, and the orphaned `f3`–`f6`.

- FIXED (2026-07-07): eyedropper (Pipetă) color fidelity — sampled colors could
  differ from the preview. Three causes: RGB→CMYK used the naive formula instead
  of inverting the display polynomial (new `rgbToCmykPrint` in `lib/cmyk.ts`);
  the background's pan/spin transform was ignored when mapping the click (new
  `previewPointToBackgroundFrac` in `lib/colorSample.ts`); transparent samples
  composited over hardcoded white instead of the backdrop. Unit tests in
  `cmyk.test.ts`/`colorSample.test.ts`; verified E2E (black → pure K, saturated
  round-trip ±1/255, vacated pan zone → white).

## Regenerating screenshots

`web-preview/shoot.mjs` (tracked in git) retakes **all** §5–§9 assets in one run
(Romanian selectors — see "Deferred: localized screenshots" above for the
locale-aware plan):

```
cd web-preview && npx vite --port 5199 --strictPort   # wasm must already be built
node shoot.mjs                                        # ~2.5 min, ends with ALL SHOTS OK
```

Gotchas learned (beyond the ones below):
- `SelectField` labels textContent-include their `<option>` texts, so Playwright's
  `getByLabel('Formă')` never matches — use
  `page.locator('label:has(span:text-is("Formă")) select')` (the `sel()` helper).
- The footer „Continuă” click occasionally doesn't navigate; `goToStep()` verifies
  the „Pasul N din 5” marker and falls back to clicking the step chip.
- `page.screenshot({ clip })` fails for elements below the fold unless you pass
  `fullPage: true` and convert boundingBox → document coords (add `window.scrollY`).
- Uploading a CSV auto-sets the detected separator (space for `demo.csv`), which
  carries back into generate mode — the sample row in step 4 must use that separator.

## How to reproduce screenshots (original notes, still valid)
- Playwright's bundled browser is NOT installed. Use **system Chrome** via
  `chromium.launch({ executablePath: '/usr/bin/google-chrome-stable' })`.
- `browser.close()` tends to hang → end the script with `process.exit(0)`.
- Write screenshots to ABSOLUTE paths or they land in `web-preview/`.
- Left panel locator: `page.locator('.lg\\:grid-cols-2 > div').first()`; whole
  preview: `.lg\\:grid-cols-2`.
- Drive state by clicking radio label text (`getByText('Simplu', {exact:true})`),
  advance steps with `getByRole('button', { name: /Continuă/ })`.

## Notes
- `svg-wasm/` crate source is committed (previously untracked — it broke `npm run dev`).
- Untracked test-data files in the working tree (`*.pdf`, `list.csv`, `contour.svg`,
  etc.) are unrelated noise; don't commit them.
- FIXED (2026-07-07): the „Măsoară traseele de tăiere” quirk seen while shooting
  `06-rezultat.png` (contour result showed only „Carduri pe pagină” for a preset
  rectangle contour). Root cause: grid-mode contours (`contour_as_grid`) skipped
  cutting metrics entirely (`src/generate/mod.rs`). Now computed analytically from
  the grid's line geometry (`grid_page_metrics` in `src/generate/contour.rs`,
  combined by `compute_grid_cutting_metrics` in `src/generate/mod.rs`; partial
  last sheets use the per-card outline). Covered by two new Rust tests; wasm
  rebuilt into `web-preview/src/wasm/` and verified end-to-end in the UI.
