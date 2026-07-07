# Handoff — manual.md sync to the current app

Status note for the documentation sync of `manual.md` (+ `manual-assets/`) against the
actual 5-step app (`web-preview/src/App.tsx`).

## Status: sync COMPLETE (2026-07-07) + verification pass (same day)

All ten sections of `manual.md` now describe the current UI, and every referenced
screenshot in `manual-assets/` was retaken against it (no orphans, no missing files).

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

Known, deliberately-unfixed mismatch (user decision): the app label
"Distanțăre contur (mm)" (`web-preview/src/App.tsx:3737`) has a typo; the manual
intentionally spells it "Distanțare contur (mm)". Fix the app label (and retake
`s3-text-exemplu.png` / `04-coduri.png`) whenever convenient.

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

`web-preview/shoot.mjs` (untracked; commit it if it should persist) retakes **all**
§5–§9 assets in one run:

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
