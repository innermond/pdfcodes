# Preset gallery — handing a saved `settings.zip` to the app

Work plan for wiring the saved-settings archives into the printuridigital Laravel app as a
clickable gallery. Written to be picked up cold on another machine.

## The idea

The app saves a whole configuration as a `.zip` (`settings.json` + background/contour/CSV +
bundled fonts + a `thumbnail.png` of the card preview — see `web-preview/src/lib/presetBundle.ts`).
Today the only way back in is finding that file on disk and feeding it to the collapsed
„Presetări" picker.

The goal: a Laravel page showing those archives as a grid of thumbnails; clicking one opens the
pdfcodes app with the settings already applied.

## Two repos

- `/home/gabriel/Project/pdfcodes` — this repo, the upstream app (React 19 + Vite SPA).
- `/home/gabriel/Project/printuridigital` — the Laravel 13 app (`src/` is the Laravel root).

---

## Already done — upstream (this repo)

The app can already be handed a preset. Implemented and verified end-to-end in a browser
(success plus all three failure paths), 191 tests green, `tsc -b` clean, lint unchanged:

| File | What |
|---|---|
| `web-preview/index.html` | inert marker `window.__PDFCODES_PRESET__ = null /* pdfcodes:preset */` |
| `web-preview/src/lib/hostPreset.ts` + `.test.ts` | `parseHostPreset` (pure — validates the descriptor, resolves relative URLs, rejects cross-origin), `readHostPreset`, `fetchHostPreset` (same-origin fetch, ZIP-magic check) |
| `web-preview/src/App.tsx` | `presetNotice` banner (green on success / red on failure, dismissible), `handleLoadPresetFile(file, notice?)`, one-shot mount effect behind a StrictMode ref guard |
| `web-preview/messages/{ro,en}.json` | 5 new keys |
| `manual.ro.md` / `manual.en.md` | §2.2 |

`web-preview/scripts/laravel-preset-gallery.php` was written **before** I knew how the Laravel app
actually embeds pdfcodes. It assumes a static `dist/index.html` served through a controller,
which is **not** how printuridigital works. Keep it as notes only — the real design is below.

> **First thing on the new machine:** commit and push this repo's working tree. It is currently
> uncommitted.

---

## What the Laravel app actually does (this is why the design changed)

pdfcodes is **already embedded** there — not as a static build, but as vendored source compiled
by the *host's* Vite:

| Piece | Path (under `printuridigital/src/`) |
|---|---|
| Vendored SPA source | `resources/js/vendor/pdfcodes/web-preview/` |
| Public export | `…/web-preview/src/index.ts` → `export { default as PdfCodesApp } from './App'` |
| Mount entry | `resources/js/pdfcodes-entry.tsx` → mounts into every `[data-pdfcodes-root]` |
| Blade component | `resources/views/components/pdfcodes.blade.php` |
| Page view | `resources/views/pages/pdfcodes.blade.php` — **no route points at it today** |
| Layout | `resources/views/layouts/pdfcodes.blade.php` (full-width) |

There is no `index.html` to inject a marker into. The house pattern — see
`components/pricer.blade.php` and its `data-catalog-url` — is **data attributes on the mount div,
read by the entry, passed as props**. That is the handover mechanism here.

Two more facts that shape the work:

- The vendored copy is **~450 lines behind** upstream and **predates the i18n migration**
  (hardcoded Romanian strings, no paraglide; the host `vite.config.js` has no paraglide plugin).
- `.gitmodules` declares `resources/js/vendor/pdfcodes` as a submodule, but it is committed as
  **190 ordinary files** — only `digital-print-pricer` is a real submodule.

## Decisions

| Question | Decision |
|---|---|
| Vendor drift | Port the feature into the vendored copy in its own style — no paraglide, no re-sync |
| Storage | DB model + admin CRUD screen (the `ContentImage` pattern), not a filesystem scan |
| URLs | `/pdfcodes` for the app; gallery under `/admin/presetari` |
| Audience | Admin-only gallery and zip download; the pdfcodes tool itself stays public |
| Ingest | Admin uploads the `.zip` by hand. The app's save path is untouched |
| Landing | After a preset loads, the user stays on step 1 with a dismissible notice |

The last two were settled earlier; the first four came out of the Laravel exploration. Together
they read as: staff maintain a library of preset starting points behind the admin login, while
the tool stays open to everyone.

---

## Part A — the vendored SPA

Port the upstream feature by hand into `printuridigital/src/resources/js/vendor/pdfcodes/web-preview/`,
in that copy's own style: **plain Romanian strings, no paraglide imports**. Do not copy the
upstream files verbatim — they import `../paraglide/messages`, which does not exist there.

Translate from `web-preview/src/lib/hostPreset.ts` and the `App.tsx` changes in this repo.

### A1. New `…/web-preview/src/lib/hostPreset.ts`

```ts
export interface HostPreset { url: string; name?: string }
export function parseHostPreset(raw: unknown, baseHref: string): HostPreset | null
export async function fetchHostPreset(preset: HostPreset): Promise<File>
```

- `parseHostPreset` — pure and testable: rejects non-objects, a missing/blank `url`, and any URL
  that resolves cross-origin; trims `name`, drops it when unusable.
- `fetchHostPreset` — `fetch(url, { credentials: 'same-origin' })`; `!resp.ok` →
  `Nu s-au putut descărca setările din galerie (HTTP ${status}).`; `TypeError` →
  `Nu s-a putut contacta serverul cu setările din galerie.`; wrong `PK\x03\x04` magic →
  `Răspunsul serverului nu este o arhivă de setări.`
  **That magic check is load-bearing given the admin-only decision** — it is what catches an
  admin-only zip route answering an anonymous visitor with a login page (HTML, status 200).
- **Drop `readHostPreset`.** Upstream needs it for its standalone `index.html`; here the
  descriptor arrives as a prop, so no window global is involved.

### A2. `…/web-preview/src/App.tsx`

Line numbers are from the vendored copy as it stands.

- Signature at line 647 → `export default function App({ preset }: { preset?: HostPreset } = {})`.
- Add `presetNotice` state (`{ text: string; tone: 'ok' | 'error' } | null`) next to `presetError`
  (line 881), and a `hostPresetLoadedRef = useRef(false)` guard.
- `handleLoadPresetFile` (line 1891) takes an optional second arg `notice?: string`: clear
  `presetNotice` at the top with the other clears, set `{ text: notice, tone: 'ok' }` at the end of
  the success path, and in the `.catch` set `{ text: message, tone: 'error' }` when `notice` was
  passed.
- Mount effect (one-shot, ref-guarded — StrictMode double-invokes effects):

  ```ts
  useEffect(() => {
    if (hostPresetLoadedRef.current || !preset) return
    hostPresetLoadedRef.current = true
    fetchHostPreset(preset)
      .then((file) => handleLoadPresetFile(file, `Setări încărcate din galerie: ${preset.name ?? file.name}`))
      .catch((err) => { /* set presetError + error banner */ })
  }, [])
  ```

- Render the banner **between the page subtitle and the „Presetări" `<Section>`** (around line
  3404). It must not go inside that section — it is `defaultCollapsed`, which is exactly why a
  failure would otherwise be invisible. Dismissible `×` with `aria-label="Închide"`.

`main.tsx` in the vendored copy is unused by Laravel (the entry is `pdfcodes-entry.tsx`); leave it.

### A3. `src/resources/js/pdfcodes-entry.tsx`

Read the dataset and pass it down, mirroring how `pricer-entry.tsx` consumes `data-catalog-url`:

```tsx
document.querySelectorAll<HTMLElement>('[data-pdfcodes-root]').forEach((el) => {
    const url = el.dataset.presetUrl
    const preset = url ? { url, name: el.dataset.presetName } : undefined
    createRoot(el).render(<StrictMode><PdfCodesApp preset={preset} /></StrictMode>)
})
```

Run it through `parseHostPreset` (with `location.href`) so a bad attribute is rejected before it
reaches the app.

### A4. `src/resources/views/components/pdfcodes.blade.php`

```blade
@props(['presetUrl' => null, 'presetName' => null])

<div
    data-pdfcodes-root
    @if($presetUrl) data-preset-url="{{ $presetUrl }}" data-preset-name="{{ $presetName }}" @endif
    {{ $attributes->merge(['class' => 'pdfcodes-root']) }}
></div>
```

Leave the existing `@once @push('scripts') @vite(...) @endpush @endonce` block untouched.

---

## Part B — Laravel

Follow `printuridigital/src/HANDOVER.md`: FormRequests with
`authorize() { return Gate::allows('admin-write'); }`, Action classes owning their own
`DB::transaction()` with side effects after commit returning `warnings`, controllers flashing
`success` + `warnings`. Generate files with `php artisan make:… --no-interaction` per
`src/CLAUDE.md`.

### B1. Migration + model

`presets` table — model it on `2026_07_27_120000_create_content_images_table.php`, including its
habit of commenting *why* each column exists:

| column | notes |
|---|---|
| `slug` | **unique** — the identity, like `ContentImage.name`; re-uploading the same slug replaces in place |
| `name` | gallery label |
| `note` | nullable, admin-facing |
| `size_bytes` | unsigned int |
| `has_thumbnail` | boolean — `buildPresetZip` omits `thumbnail.png` when the settings can't produce a preview |
| `timestamps` | `updated_at` doubles as the `?v=` cache-buster, as `ContentImage::version()` does |

Model `App\Models\Preset` with a `version()` accessor. No factory — this app builds fixtures by
hand via `tests/Traits/AdminTestHelpers.php`.

### B2. `App\Services\PresetArchive`

The only new domain logic, and pure enough to unit-test:

- `thumbnail(string $absolutePath): ?string` — open with `ZipArchive` (**`ext-zip` is already
  installed**, `docker/php/Dockerfile:19`), find the entry whose **basename** is `thumbnail.png`
  while skipping `__MACOSX/`, and return the bytes only if they start with the PNG magic. The
  basename/junk tolerance mirrors `loadPresetBundle` in the vendored
  `web-preview/src/lib/presetBundle.ts`, so both ends accept the same archives — one that was
  unzipped and re-zipped inside a folder still works.
- `hasSettings(string $absolutePath): bool` — same scan for `settings.json`. This is what makes
  "is it really a preset?" a validation answer instead of a runtime surprise.

### B3. Storage

- **Archives** → `local` disk (`storage/app/private`) under `presets/{slug}.zip`. Private, never
  web-served; the download route is the only way in. Avoids adding a disk to `config/filesystems.php`.
- **Thumbnails** → the existing `thumbs` disk (`public/t`, served by nginx, read as
  `asset('t/'.$name)`) as `preset-{slug}.png`. Add a sibling to `ImageService::uploadThumbnail()`
  (`src/app/Services/ImageService.php:84`) that takes **bytes** instead of an `UploadedFile`:
  `thumbnailFromContents(string $bytes, string $filename): ?string` — same
  `$this->manager->read(...)->scaleDown(config('services.image.thumb.width'), …)->encode()` then
  `Storage::disk('thumbs')->put(...)`. `generateResponsive(string $contents, …)` is the existing
  bytes-in precedent.
  - Consequence: thumbnails are publicly readable even though the gallery is admin-only, which
    matches every other thumbnail in this app. If they must be private too, serve them from a
    route off the `local` disk and skip the `thumbs` disk entirely.

### B4. Routes

In `src/routes/web.php`:

```php
// Public: the pdfcodes tool. MUST be registered above the redirect_from_to group —
// /{slug} (category.show) swallows every one-segment GET.
Route::get('/pdfcodes', [PdfCodesController::class, 'show'])->name('pdfcodes');
```

Inside the admin group's existing `admin.auth:main_admin,admin` block (`web.php:39-57`), next to
`imagini`:

```php
Route::resource('presetari', AdminPresetController::class)
    ->only(['index', 'store', 'update', 'destroy'])
    ->names('presets')
    ->parameters(['presetari' => 'preset']);
Route::get('presetari/{preset}/arhiva', [AdminPresetController::class, 'download'])
    ->name('presets.download');
```

### B5. Controllers + views

- `App\Http\Controllers\PdfCodesController@show` — renders `pages/pdfcodes.blade.php`. Reads
  `?presetare={slug}`, looks the row up, passes `presetUrl` / `presetName` into `<x-pdfcodes>`.
  **An unknown slug renders the page clean, without the attributes** — fail-soft, so a stale link
  still opens a working tool rather than a 404.
  - `pages/pdfcodes.blade.php` becomes
    `<x-pdfcodes class="h-screen" :preset-url="$presetUrl" :preset-name="$presetName" />`.
  - `layouts/pdfcodes.blade.php` currently rebrands the header to "PDF Codes" with a `route('home')`
    link — check how that reads on a printuridigital.ro URL.
- `App\Http\Controllers\Admin\PresetController` — `index` (upload form + thumbnail grid, each thumb
  linking to `route('pdfcodes', ['presetare' => $preset->slug])`), `store`, `update` (metadata
  only), `destroy`, `download` (`response()->file(..., ['Content-Type' => 'application/zip'])`).
  Model it on `ContentImageController`: the index page *is* the form plus the grid.
- `StorePresetRequest` / `UpdatePresetRequest` in `src/app/Http/Requests/`, with
  `authorize() => Gate::allows('admin-write')`, a `prepareForValidation()` doing `Str::slug($slug)`,
  and Romanian per-rule `messages()`. Rules: `file` → `required|file|mimes:zip|max:…` plus a check
  via `PresetArchive::hasSettings()`; `slug` → `required|alpha_dash|max:100`; `name` → `required|max:150`.
- Actions `App\Actions\Admin\Presets\{StorePreset,DestroyPreset}` — transaction inside; a failed
  thumbnail extraction returns a `warning` ("preset saved, no preview available") rather than
  throwing, per the app's convention.
- View `src/resources/views/admin/presets/index.blade.php` (`@extends('layouts.admin')`), plus a
  nav entry in `layouts/admin.blade.php` alongside `admin.content-images.*` (line ~120).

---

## Verification

PHP only runs in Docker on that machine; Node runs on the host.

```bash
cd /home/gabriel/Project/printuridigital
source ./export_uid_gid && docker compose up -d

# Front end (host): wasm first, per resources/js/vendor/README.md
cd src/resources/js/vendor/pdfcodes/web-preview && npm run build:wasm && npm run build:wasm-svg
cd /home/gabriel/Project/printuridigital/src && npm run build

# Tests (CLAUDE.md requires a test per change; the pd_test schema must exist)
docker compose exec app php artisan test --compact --filter=Preset
docker compose exec app php artisan test --compact
docker compose exec app vendor/bin/pint --dirty --format agent
```

Tests to write:

- **Unit** `tests/Unit/PresetArchiveTest.php` — build zips in-test with `ZipArchive`: flat,
  folder-wrapped, one with `__MACOSX/thumbnail.png` junk, one with no thumbnail, one whose
  `thumbnail.png` is not really a PNG. Assert flat and wrapped yield identical bytes.
- **Feature** `tests/Feature/Admin/PresetControllerTest.php` — `use DatabaseTransactions, AdminTestHelpers;`
  with `Storage::fake('thumbs')` in `setUp` (copy `ContentImageControllerTest`). Cover: guest
  redirected to login; `viewer` role gets 403; store creates the row + thumbnail; a zip without
  `settings.json` is rejected; same-slug re-upload replaces in place; destroy removes both files;
  download returns `application/zip`.
- **Feature** `tests/Feature/PdfCodesPageTest.php` — `/pdfcodes` is 200 and contains
  `data-pdfcodes-root`; `?presetare={slug}` adds `data-preset-url`; an unknown slug renders without it.

Manual end-to-end (what tests can't cover):

1. Save a `.zip` from the app, upload it at `/admin/presetari`, confirm the thumbnail renders.
2. Click the thumbnail → `/pdfcodes?presetare=…` with the green banner
   „Setări încărcate din galerie: …", step 1 populated, steps 2–5 unlocked.
3. Log out and open the same URL → the zip route redirects to login and the app shows the red
   „nu este o arhivă de setări" banner rather than failing silently. **Verify this specific case** —
   it is the seam between an admin-only download and a public app page.

## Notes / risks

- **Vendor drift becomes load-bearing.** After this, the vendored copy carries a hand-ported
  feature that differs from upstream in shape (upstream reads a window global; the vendored copy
  takes a prop). Worth reconciling later by giving upstream's `App` the same `preset` prop and
  having its `main.tsx` call `readHostPreset()` — then the two differ only in who supplies the
  descriptor. Not required for this work.
- `src/public/build` and `src/public/t` are gitignored, so a fresh checkout needs `npm run build`
  before the page renders; thumbnails regenerate on re-upload.
- Don't remove `resolve.dedupe: ['react','react-dom']` from `src/vite.config.js` — the vendored
  copies ship their own React and it breaks without it.
- `SitemapService` builds URLs from `Category`/`Product` rows only, so `/pdfcodes` won't appear in
  `sitemap.xml`. Fine for an admin-adjacent tool; worth noting if the page should be indexed.
