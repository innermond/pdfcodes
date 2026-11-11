import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

// Compile-time locale: one language per built bundle, chosen via the LOCALE env
// var (e.g. `LOCALE=en npm run build`). Defaults to Romanian.
const inlangSettings = JSON.parse(readFileSync('./project.inlang/settings.json', 'utf8')) as { locales: string[] }
const locale = process.env.LOCALE ?? 'ro'
if (!inlangSettings.locales.includes(locale)) {
  throw new Error(`Unknown LOCALE "${locale}" — expected one of: ${inlangSettings.locales.join(', ')}`)
}

// Code the editors have in common: the ui-common submodule next to this one.
const shared = decodeURIComponent(new URL('../../ui-common/src', import.meta.url).pathname)

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs so the built `dist/` can be dropped at any path on a
  // static host (root, subfolder, wherever) without rebuilding. Safe here
  // because this is a single page with no client-side router.
  base: './',
  //base: '/etichete/coduri-unice-decupare-contur/',
  resolve: { alias: { '@shared': shared }, dedupe: ['react', 'react-dom'] },
  server: { fs: { allow: ['../../..'] } },
  // ui-common has no test runner of its own; its tests run here, with the app that owns the checkout.
  test: { include: ['src/**/*.test.{ts,tsx}', '../../ui-common/src/**/*.test.{ts,tsx}'] },
  plugins: [
    react(),
    tailwindcss(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      emitTsDeclarations: true,
      // Locale fixed at build time — no cookie/URL detection or runtime switching.
      strategy: ['baseLocale'],
      // Compile-time locale constant: message functions and getLocale() resolve to
      // this literal, so the other locale's strings are dead-code-eliminated.
      experimentalStaticLocale: JSON.stringify(locale),
    }),
    {
      name: 'html-locale',
      transformIndexHtml: (html) => html.replace('<html lang="ro">', `<html lang="${locale}">`),
    },
  ],
})
