# Handoff — manual.md sync to the current app

Resume note for continuing the documentation sync on another machine.

## Goal
Bring `manual.md` (+ `manual-assets/`) in line with the **actual** 5-step app
(`web-preview/src/App.tsx`). The old manual described a stale 4-step layout.

App wizard steps (source of truth: `WIZARD_STEPS` in `web-preview/src/App.tsx`):
**1 Fundal · 2 Contur · 3 Date · 4 Coduri · 5 PDF**.

## Done
- **General overview** — manual §1–§2 rewritten; added `manual-assets/00-privire-generala.png`.
- **Step 1 — Fundal** (§3): three sources (Încarcă PDF / Simplu / Imagine) + Poziționare block.
  Assets: `01-fundal.png`, `f1-print-upload.png`, `f2-print-simple.png`, `f7-print-imagine.png`.
- **Step 2 — Contur** (§4, newly inserted): upload (PDF/SVG, file/URL/clipboard) + preset shapes
  (7) + reglaje. Assets: `02-contur.png`, `c1-contur-upload.png`, `c2-contur-shape.png`.
- **Renumbered** downstream sections to keep structure consistent: §5 Pasul 3 … §10, including all
  subsection numbers and cross-references (color-picker refs → 6.4, generation refs → 7.3).

## Next (not yet done)
Sections §5–§7 are correctly **numbered/titled** but their **bodies are still the old content** —
rewrite each against the real UI, one step at a time:
- **§5 Pasul 3 — Date** — `step === 'date'` in App.tsx (`CodeSourceSection` / generate-vs-CSV).
- **§6 Pasul 4 — Coduri** — `step === 'aspect'` (Text exemplu, Cuvinte, Tipografie/Poziție, color picker).
- **§7 Pasul 5 — PDF** — `step === 'generare'` (Print+Contur, Aspect pagină, Opțiuni, Timp de tăiere).
- Then refresh §8 Previzualizare, §9 Rezultat, §10 Flux.
Old numbered hero assets (`02-sursa-date.png`, `03-aspect-cuvinte.png`, `05-generare.png`) and the
orphaned contour assets (`f3`–`f6`) still reflect the old layout — replace as each step is redone.

## How to reproduce screenshots (what worked here)
- Build/run: `cd web-preview && npm run dev` (builds both wasm modules, incl. `svg-wasm`, then vite).
  Or run vite directly on a fixed port: `npx vite --port 5199 --strictPort`.
- Playwright's bundled browser is NOT installed. Use **system Chrome** via
  `chromium.launch({ executablePath: '/usr/bin/google-chrome-stable' })`.
- Gotchas:
  - `browser.close()` tends to hang → end the script with `process.exit(0)`.
  - Scripts run from the `web-preview/` cwd, so **write screenshots to ABSOLUTE paths**
    (`/home/.../pdfcodes/manual-assets/...`) or they land in `web-preview/manual-assets/`.
  - Left panel locator: `page.locator('.lg\\:grid-cols-2 > div').first()`; whole preview: `.lg\\:grid-cols-2`.
  - Drive state by clicking radio label text (`getByText('Simplu', {exact:true})`), advance steps with
    `getByRole('button', { name: /Continuă/ })`, load a card via
    `input[accept="application/pdf"]` + `setInputFiles('/home/.../pdfcodes/15x15.pdf')`.
- Renumbering was done with an audited Python script (per-replacement count assertions) — safest
  approach if inserting another section forces a renumber again.

## Notes
- `svg-wasm/` crate source is now committed (previously untracked — it broke `npm run dev`).
- Untracked test-data files in the working tree (`background.pdf`, `cobai*.csv`, `list.csv`, etc.)
  are unrelated noise; don't commit them.
