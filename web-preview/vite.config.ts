import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
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

// https://vite.dev/config/
export default defineConfig({
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
