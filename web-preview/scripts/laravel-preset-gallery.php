<?php
/**
 * Reference implementation for the saved-settings gallery.
 *
 * The app saves a preset as a `.zip` (see web-preview/src/lib/presetBundle.ts)
 * that carries `settings.json`, the background/contour/CSV resources, the
 * bundled fonts and a `thumbnail.png` preview of the card. This file is the
 * host side of that story: a Laravel page that lists the stored archives by
 * their thumbnail, and, when one is clicked, opens the app with those settings
 * already applied.
 *
 * Three routes:
 *   GET /presetari                    gallery of thumbnails
 *   GET /presetari/{slug}/thumbnail   the thumbnail.png extracted from the zip
 *   GET /etichete/coduri-unice-decupare-contur/?preset={slug}
 *                                     the app, with the preset handed over
 *   GET /presetari/{slug}/download    the .zip itself, fetched by the app
 *
 * The handover: the built `index.html` carries an inert marker
 *
 *     window.__PDFCODES_PRESET__ = null /* pdfcodes:preset *\/
 *
 * and the app route replaces it with `{"url":"…","name":"…"}` before sending
 * the page. On startup the app reads that global, downloads the archive from
 * `url` and restores it through the same path as a hand-picked file
 * (web-preview/src/lib/hostPreset.ts). Nothing about the preset format leaks
 * into Laravel: it only ever moves whole archives around.
 *
 * Ingest is manual — an admin drops the `.zip` files saved from the app into
 * `storage/app/pdfcodes-presets/`. The app has no upload path.
 *
 * ---------------------------------------------------------------------------
 * Deploying the built app so the injection is reachable
 * ---------------------------------------------------------------------------
 * `npm run build` produces `web-preview/dist/` with every asset URL prefixed by
 * the `base` from vite.config.ts (`/etichete/coduri-unice-decupare-contur/`).
 * Split the output in two:
 *
 *   dist/index.html      -> resources/pdfcodes/index.html     (read by PHP)
 *   dist/*  (the rest)   -> public/etichete/coduri-unice-decupare-contur/
 *
 * Keep `index.html` OUT of `public/`: if it sits there, Apache's DirectoryIndex
 * (or nginx's `try_files`) serves it as a static file and the Laravel route
 * never runs, so no preset is ever injected. The hashed assets stay in
 * `public/` on purpose — the web server serves them directly, no PHP involved.
 *
 * Also make sure `.wasm` is served as `application/wasm` (the app ships two
 * WebAssembly modules), and that the route answers the base path *with* its
 * trailing slash.
 *
 * ---------------------------------------------------------------------------
 * routes/web.php
 * ---------------------------------------------------------------------------
 *   use App\Http\Controllers\PresetGalleryController;
 *
 *   Route::get('/presetari', [PresetGalleryController::class, 'index'])
 *       ->name('pdfcodes.gallery');
 *   Route::get('/presetari/{slug}/thumbnail', [PresetGalleryController::class, 'thumbnail'])
 *       ->name('pdfcodes.preset.thumbnail');
 *   Route::get('/presetari/{slug}/download', [PresetGalleryController::class, 'download'])
 *       ->name('pdfcodes.preset.download');
 *   Route::get('/etichete/coduri-unice-decupare-contur/', [PresetGalleryController::class, 'app'])
 *       ->name('pdfcodes.app');
 *
 * ---------------------------------------------------------------------------
 * resources/views/pdfcodes/gallery.blade.php
 * ---------------------------------------------------------------------------
 *   <div class="grid">
 *     @foreach ($presets as $preset)
 *       <a href="{{ route('pdfcodes.app', ['preset' => $preset['slug']]) }}">
 *         <img src="{{ route('pdfcodes.preset.thumbnail', $preset['slug']) }}"
 *              alt="{{ $preset['name'] }}" loading="lazy">
 *         <span>{{ $preset['name'] }}</span>
 *       </a>
 *     @endforeach
 *   </div>
 */

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use ZipArchive;

class PresetGalleryController extends Controller
{
    /** Directory holding the archives an admin uploaded, relative to storage/app. */
    private const PRESET_DIR = 'pdfcodes-presets';

    /** The built index.html, kept outside public/ — see the header note. */
    private const APP_HTML = 'resources/pdfcodes/index.html';

    /**
     * Slugs address files on disk, so keep them to an alphabet that cannot
     * escape the directory: no dots, no slashes, no traversal.
     */
    private function assertSlug(string $slug): void
    {
        if (!preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $slug)) {
            abort(404);
        }
    }

    private function zipPath(string $slug): string
    {
        $this->assertSlug($slug);
        $path = storage_path('app/' . self::PRESET_DIR . '/' . $slug . '.zip');
        if (!is_file($path)) {
            abort(404);
        }
        return $path;
    }

    /** The gallery: every archive in the preset directory, newest first. */
    public function index()
    {
        $presets = [];
        foreach (glob(storage_path('app/' . self::PRESET_DIR . '/*.zip')) as $path) {
            $slug = basename($path, '.zip');
            if (!preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $slug)) {
                continue; // not addressable by our routes; skip rather than 404 later
            }
            $presets[] = [
                'slug' => $slug,
                // `settings.json` carries no title, so the filename is the label.
                // Adding a name field to the preset would be a change in the app.
                'name' => ucfirst(str_replace('-', ' ', $slug)),
                'mtime' => filemtime($path),
            ];
        }
        usort($presets, fn ($a, $b) => $b['mtime'] <=> $a['mtime']);

        return view('pdfcodes.gallery', ['presets' => $presets]);
    }

    /**
     * The card preview the app bundled into the archive. Cached next to the
     * zips after the first extraction — reopening the archive on every gallery
     * render would be wasteful for a file that never changes.
     */
    public function thumbnail(string $slug)
    {
        $zipPath = $this->zipPath($slug);
        $cachePath = storage_path('app/' . self::PRESET_DIR . '/.thumbs/' . $slug . '.png');

        if (!is_file($cachePath) || filemtime($cachePath) < filemtime($zipPath)) {
            $png = $this->extractThumbnail($zipPath);
            if ($png === null) {
                // `buildPresetZip` omits thumbnail.png when the settings could not
                // produce a preview (no background yet).
                return response()->file(public_path('images/preset-placeholder.png'));
            }
            @mkdir(dirname($cachePath), 0775, true);
            file_put_contents($cachePath, $png);
        }

        return response()->file($cachePath, [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'public, max-age=3600',
        ]);
    }

    /**
     * Pull `thumbnail.png` out of the archive. Located by basename, skipping
     * `__MACOSX/` junk, so an archive that was unzipped and re-zipped inside a
     * folder still works — the same tolerance the app's loader has
     * (web-preview/src/lib/presetBundle.ts).
     */
    private function extractThumbnail(string $zipPath): ?string
    {
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) {
            return null;
        }
        try {
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $name = $zip->getNameIndex($i);
                if ($name === false || str_starts_with($name, '__MACOSX/')) {
                    continue;
                }
                if (basename($name) !== 'thumbnail.png') {
                    continue;
                }
                $bytes = $zip->getFromIndex($i);
                // Trust the bytes, not the name: only serve what is really a PNG.
                if ($bytes === false || !str_starts_with($bytes, "\x89PNG\r\n\x1a\n")) {
                    return null;
                }
                return $bytes;
            }
        } finally {
            $zip->close();
        }
        return null;
    }

    /**
     * The app page. Without `?preset=` this returns the built index.html
     * unchanged and the app behaves exactly as a direct visit; with one, the
     * marker is replaced by the descriptor the app reads on startup.
     */
    public function app(Request $request)
    {
        $html = file_get_contents(base_path(self::APP_HTML));
        if ($html === false) {
            abort(500, 'The built app (resources/pdfcodes/index.html) is missing.');
        }

        $slug = $request->query('preset');
        if (is_string($slug) && $slug !== '') {
            $this->zipPath($slug); // validates the slug and that the archive exists
            $descriptor = [
                'url' => route('pdfcodes.preset.download', $slug),
                'name' => ucfirst(str_replace('-', ' ', $slug)),
            ];
            // The descriptor is injected into a <script> body, so escape the
            // characters that could close it (`<`, `&`, quotes) — that, not the
            // slug check above, is what makes a future free-form name safe.
            $json = json_encode(
                $descriptor,
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
                    | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
            );
            $replaced = preg_replace('#null\s*/\* pdfcodes:preset \*/#', $json, $html, 1, $count);
            if ($replaced === null || $count !== 1) {
                // The marker moved or the deployed build predates it: serve the
                // app anyway (it just opens empty) but make the cause visible.
                report(new \RuntimeException('pdfcodes:preset marker not found in ' . self::APP_HTML));
            } else {
                $html = $replaced;
            }
        }

        return response($html, Response::HTTP_OK, [
            'Content-Type' => 'text/html; charset=utf-8',
            // The page varies per preset; don't let a proxy pin one visitor's.
            'Cache-Control' => 'no-store',
        ]);
    }

    /** The archive itself, downloaded by the app from the injected `url`. */
    public function download(string $slug)
    {
        return response()->file($this->zipPath($slug), [
            'Content-Type' => 'application/zip',
        ]);
    }
}
