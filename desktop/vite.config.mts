/*
 * Renderer build. Local files only: the bundle is loaded from disk by Electron,
 * so `base: './'` matters more than any dev-server convenience here.
 *
 * This is deliberately separate from the web app's root Vite config. The
 * desktop folder must build on its own, and the web build must never read it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: `${here}renderer`,
  // file:// cannot resolve absolute asset paths.
  base: './',
  build: {
    outDir: `${here}build/renderer`,
    emptyOutDir: true,
    // Electron 45 ships a current Chromium; no need to down-level.
    target: 'chrome128',
    sourcemap: false,
    // IIFE output cannot code-split, so the stylesheet is emitted as one file
    // rather than per chunk. Without this Vite emits no CSS at all for an IIFE
    // build and the page renders unstyled.
    cssCodeSplit: false,
    rollupOptions: {
      input: `${here}renderer/index.html`,
      // A classic script, not an ES module. Chromium treats a file:// document
      // as an opaque origin, so a `type="module"` tag fetched from disk is
      // blocked as a cross-origin request and the page renders blank.
      output: {
        format: 'iife',
        inlineDynamicImports: true
      }
    }
  },
  plugins: [
    tailwindcss(),
    {
      // The token sheet is shared with the web app, and the web app loads Inter
      // from Google Fonts. A local page under this CSP must fetch nothing, so the
      // remote @import is stripped from the finished stylesheet: the desktop
      // renders in the document's own system stack instead.
      //
      // Done on the emitted asset rather than on the source, because Vite rewrites
      // the import into a form that no longer matches what was authored.
      name: 'copilot-strip-remote-font',
      // Written last: Vite emits the stylesheet from its own post plugin, so a
      // generateBundle hook here would run before the asset exists.
      writeBundle (options: { dir?: string }, bundle: Record<string, { type: string, fileName: string }>) {
        const dir = options.dir
        if (!dir) return
        for (const asset of Object.values(bundle)) {
          if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue
          const file = join(dir, asset.fileName)
          const text = readFileSync(file, 'utf8')
          // Match to the closing quote: the Google URL itself contains semicolons.
          const cleaned = text.replace(/@import\s*(?:url\()?["'][^"']*fonts\.googleapis\.com[^"']*["'];?\s*/g, '')
          if (cleaned !== text) writeFileSync(file, cleaned)
        }
      }
    },
    {
      // Vite injects module and crossorigin attributes that only make sense on
      // an http origin. Strip them so the built page loads from disk.
      name: 'copilot-local-file-page',
      transformIndexHtml: {
        order: 'post',
        handler (html: string) {
          return html
            .replace(/<script type="module" crossorigin /g, '<script defer ')
            .replace(/<link rel="stylesheet" crossorigin /g, '<link rel="stylesheet" ')
        }
      }
    }
  ],
  esbuild: {
    jsx: 'automatic'
  },
  server: {
    port: 5273,
    strictPort: true
  }
})
