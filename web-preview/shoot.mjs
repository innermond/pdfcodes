// Regenerates every screenshot in manual-assets/ by driving the app through the
// five wizard steps. Run with the dev server up on port 5199:
//   npx vite --port 5199 --strictPort   (wasm must already be built)
//   node shoot.mjs
import { chromium } from 'playwright'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const A = join(dirname(fileURLToPath(import.meta.url)), '..', 'manual-assets')
const SCRATCH = mkdtempSync(join(tmpdir(), 'pdfcodes-shots-'))
// Space-separated demo CSV for the upload shots ("1A 1" shows the field-merge editor).
writeFileSync(join(SCRATCH, 'demo.csv'), Array.from({ length: 100 }, (_, i) => `${i + 1}A ${i + 1}`).join('\n') + '\n')
const failures = []

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page.setDefaultTimeout(10000)

async function step(name, fn) {
  try {
    await fn()
    console.log('OK  ' + name)
  } catch (e) {
    failures.push(name + ': ' + e.message.split('\n')[0])
    console.log('FAIL ' + name + ': ' + e.message.split('\n')[0])
    try { await page.screenshot({ path: `${SCRATCH}/fail-${name}.png`, fullPage: true }) } catch {}
  }
}

// Screenshot the union bounding box of several locators (document coordinates,
// full-page capture, so elements below the fold work too).
async function unionShot(locators, file, pad = 10) {
  const boxes = []
  for (const l of locators) {
    await l.first().scrollIntoViewIfNeeded()
    const b = await l.first().boundingBox()
    if (!b) throw new Error('no bounding box for a locator (' + file + ')')
    const { sx, sy } = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY }))
    boxes.push({ x: b.x + sx, y: b.y + sy, width: b.width, height: b.height })
  }
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad
  await page.screenshot({ path: `${A}/${file}`, fullPage: true, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
}

await page.goto('http://localhost:5199')
await page.waitForSelector('.lg\\:grid-cols-2', { timeout: 30000 })

const grid = page.locator('.lg\\:grid-cols-2')
const left = grid.locator('> div').first()
const right = grid.locator('> div').nth(1)
const cont = page.getByRole('button', { name: /Continuă/ })
// SelectField labels textContent-include their option texts, so getByLabel can't
// match them; target the label's own span instead.
const sel = (name) => page.locator(`label:has(span:text-is("${name}")) select`).last()

// Advance the wizard and verify it landed; fall back to the step chip.
async function goToStep(number, chipName) {
  const marker = page.getByText(`Pasul ${number} din 5`)
  await cont.scrollIntoViewIfNeeded()
  await cont.click()
  try {
    await marker.waitFor({ timeout: 4000 })
  } catch {
    console.log('  (Continuă did not navigate, clicking step chip ' + chipName + ')')
    await page.getByRole('button', { name: chipName }).click()
    await marker.waitFor({ timeout: 4000 })
  }
  await page.waitForTimeout(300)
}

// ---------- Step 1: Fundal (Simplu) ----------
await step('step1-simplu', async () => {
  await page.getByText('Simplu', { exact: true }).click()
  await page.waitForTimeout(800)
  await goToStep(2, /Contur/)
})

// ---------- Step 2: Contur (formă presetată, dreptunghi) ----------
await step('step2-shape', async () => {
  await page.getByText('Formă presetată', { exact: true }).click()
  await page.waitForTimeout(400)
  await sel('Formă').selectOption({ label: 'Dreptunghi' })
  await page.waitForTimeout(800)
  await goToStep(3, /Date/)
})

// ---------- Step 3: Date ----------
await step('s2-mode', async () => {
  await unionShot([left.locator('fieldset', { hasText: 'Mod sursă' }).last()], 's2-mode.png')
})

await step('s2-generate-top', async () => {
  await unionShot(
    [
      left.locator('label', { hasText: 'Număr de rânduri' }).first(),
      left.locator('label', { hasText: 'Separator între coduri pe rând' }).first(),
    ],
    's2-generate-top.png',
  )
})

const codBlock = () => left.locator('fieldset', { hasText: 'Prefix (opțional)' }).last()

await step('s2-cod-random', async () => {
  await unionShot([codBlock()], 's2-cod-random.png')
})

await step('s2-cod-range', async () => {
  await page.getByLabel('Prefix (opțional)').fill('NR-')
  await sel('Tip cod').selectOption({ label: 'Interval numeric' })
  await page.getByLabel('Lățime totală').fill('5')
  await page.waitForTimeout(300)
  await unionShot([codBlock()], 's2-cod-range.png')
})

await step('s2-padding-warning', async () => {
  // Random mode with pad width 5 <= code length 6 triggers the amber note.
  await sel('Tip cod').selectOption({ label: 'Generat aleator' })
  await page.waitForTimeout(300)
  await unionShot([codBlock()], 's2-padding-warning.png')
})

await step('s2-uniqueness', async () => {
  // 2000 rows over a numeric length-2 space (100 combos) -> red tab + blocked.
  await sel('Caractere').selectOption({ label: 'Numeric' })
  await page.getByLabel('Lungime').fill('2')
  await page.getByLabel('Număr de rânduri').fill('2000')
  await page.waitForTimeout(300)
  await unionShot(
    [
      left.getByRole('button', { name: /Cod 1/ }),
      codBlock(),
      left.getByText(/Generarea este dezactivată/),
    ],
    's2-uniqueness.png',
  )
})

await step('restore-cod1', async () => {
  await page.getByLabel('Număr de rânduri').fill('100')
  await sel('Tip cod').selectOption({ label: 'Interval numeric' })
  await page.waitForTimeout(200)
})

await step('s2-multi-code', async () => {
  await left.getByRole('button', { name: '+ Adaugă cod' }).click()
  await page.waitForTimeout(300)
  await unionShot(
    [
      left.getByRole('button', { name: 'Cod 1', exact: true }),
      left.getByRole('button', { name: '+ Adaugă cod' }),
      codBlock(),
    ],
    's2-multi-code.png',
  )
})

await step('generate-csv', async () => {
  await left.getByRole('button', { name: 'Generează CSV' }).click()
  await left.getByRole('link', { name: /Descarcă codes.csv/ }).waitFor({ timeout: 30000 })
  await page.waitForTimeout(300)
})

await step('s2-preview', async () => {
  await unionShot([left.getByText(/^Previzualizare/), left.locator('pre')], 's2-preview.png')
})

await step('03-date-hero', async () => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await grid.screenshot({ path: `${A}/03-date.png` })
})

await step('s2-upload', async () => {
  await page.getByText('Încarcă CSV', { exact: true }).click()
  await left.locator('input[type="file"]').setInputFiles(`${SCRATCH}/demo.csv`)
  await left.getByText(/Separator detectat/).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(300)
  await unionShot(
    [
      left.getByText('Fișier CSV', { exact: true }),
      left.getByText('Fiecare rând este un singur cod'),
      left.getByText(/Separator detectat greșit/),
    ],
    's2-upload.png',
  )
})

await step('s2-fields', async () => {
  // Merge the first gap so the shot shows both states (| and ∪).
  await left.locator('button[aria-pressed]').first().click()
  await page.waitForTimeout(300)
  await unionShot([left.locator('div.rounded.border', { hasText: 'Câmpuri pe rând' }).last()], 's2-fields.png')
})

await step('back-to-generate', async () => {
  await page.getByText('Generează coduri', { exact: true }).click()
  await page.waitForTimeout(300)
  await left.getByRole('button', { name: 'Generează CSV' }).click()
  await left.getByRole('link', { name: /Descarcă codes.csv/ }).waitFor({ timeout: 30000 })
  await goToStep(4, /Coduri/)
})

// ---------- Step 4: Coduri ----------
await step('sample-text', async () => {
  // The uploaded CSV switched the separator to space, so the sample row
  // must be space-separated to split into two words.
  await page.getByLabel(/Rând CSV exemplu/).fill('ABC123 XYZ789')
  await page.waitForTimeout(500)
})

await step('s3-text-exemplu', async () => {
  await unionShot([left.locator('fieldset', { hasText: 'Rând CSV exemplu' }).last()], 's3-text-exemplu.png')
})

await step('select-word', async () => {
  await left.getByRole('button', { name: 'ABC123', exact: true }).click()
  await page.waitForTimeout(300)
})

await step('s3-word-pills', async () => {
  await unionShot(
    [
      left.getByRole('button', { name: 'ABC123', exact: true }),
      left.getByRole('button', { name: 'XYZ789', exact: true }),
    ],
    's3-word-pills.png',
  )
})

await step('style-word', async () => {
  await page.getByLabel('Dimensiune font (pt)').fill('24')
  // Separate the two words vertically so the preview doesn't overlap them.
  await sel('Aliniere verticală').selectOption({ label: 'sus' })
  // The default color when a "none" is unchecked is black, so set all four
  // CMYK channels (inputs are ordered C, M, Y, K within the ColorField).
  async function setCmyk(fieldset, c, m, y, k) {
    const inputs = fieldset.locator('input[type="number"]')
    for (const [i, v] of [c, m, y, k].entries()) await inputs.nth(i).fill(String(v))
  }
  // Expand the collapsed style groups so the properties shot shows them all.
  await left.getByRole('button', { name: 'Stil' }).click()
  // Yellow text background: expand the collapsed group, drop "fără fundal".
  await left.getByRole('button', { name: 'Fundal text' }).click()
  const fundal = left.locator('fieldset', { hasText: 'fără fundal' }).last()
  await fundal.getByText('fără fundal').click()
  await page.waitForTimeout(200)
  await setCmyk(left.locator('fieldset', { hasText: 'fără fundal' }).last(), 0, 0, 100, 0)
  // Red text contour: same dance.
  await left.getByRole('button', { name: 'Contur text' }).click()
  const contur = left.locator('fieldset', { hasText: 'fără contur' }).last()
  await contur.getByText('fără contur').click()
  await page.waitForTimeout(200)
  await setCmyk(left.locator('fieldset', { hasText: 'fără contur' }).last(), 0, 100, 100, 0)
  await page.waitForTimeout(500)
})

await step('s3-properties', async () => {
  await unionShot([left.locator('div.border-t.pt-field').first()], 's3-properties.png')
})

await step('s3-font', async () => {
  // The radio + picker live in a div.w-full wrapper inside Tipografie.
  await unionShot([left.locator('div.w-full', { hasText: 'Font pentru acest cuvânt' }).last()], 's3-font.png')
})

await step('s3-preview-selected', async () => {
  await unionShot([right.locator('svg').first()], 's3-preview-selected.png')
})

await step('04-coduri-hero', async () => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await grid.screenshot({ path: `${A}/04-coduri.png` })
})

// ---------- Step 5: PDF ----------
await step('to-pdf-step', async () => {
  await goToStep(5, /PDF/)
})

await step('s4-mode', async () => {
  await page.getByText('Print + Contur', { exact: true }).click()
  await page.waitForTimeout(300)
  await unionShot([left.locator('fieldset', { hasText: 'Ce se generează' }).last()], 's4-mode.png')
})

await step('s4-page-layout', async () => {
  await unionShot(
    [
      left.getByText('Aspect pagină', { exact: true }),
      left.locator('label', { hasText: 'Lățime pagină (mm)' }),
      left.locator('label', { hasText: 'Diametru cerc (mm)' }),
    ],
    's4-page-layout.png',
  )
})

await step('s4-options', async () => {
  await unionShot(
    [
      left.getByText('Opțiuni', { exact: true }),
      left.locator('label', { hasText: 'Non-decupare' }),
      left.locator('label', { hasText: 'Măsoară traseele de tăiere' }),
    ],
    's4-options.png',
  )
})

await step('s4-cut-time', async () => {
  await left.getByText('Măsoară traseele de tăiere').click()
  await page.waitForTimeout(300)
  await unionShot(
    [
      left.getByText('Timp de tăiere', { exact: true }),
      left.locator('label', { hasText: 'Viteză de tăiere (mm/s)' }),
      left.locator('label', { hasText: 'Viteză deplasare (mm/s)' }),
    ],
    's4-cut-time.png',
  )
})

await step('05-pdf-hero', async () => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await grid.screenshot({ path: `${A}/05-pdf.png` })
})

await step('06-rezultat', async () => {
  await left.getByRole('button', { name: 'Generează PDF', exact: true }).click()
  const rezultat = right.locator('fieldset', { hasText: 'Rezultat' }).first()
  await rezultat.waitFor({ timeout: 180000 })
  // Give the iframes a moment to render their PDF previews.
  await page.waitForTimeout(4000)
  await unionShot([rezultat], '06-rezultat.png')
})

console.log(failures.length ? 'FAILURES:\n' + failures.join('\n') : 'ALL SHOTS OK')
process.exit(0)
