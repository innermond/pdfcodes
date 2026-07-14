import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      emitTsDeclarations: true,
      // Locale fixat la build — fără detecție de cookie/URL sau schimbare la runtime.
      strategy: ['baseLocale'],
    }),
  ],
})
