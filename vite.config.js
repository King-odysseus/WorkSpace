/// <reference types="vitest" />
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// public/sw.js is copied verbatim into the build, so on its own it is byte
// identical from one deploy to the next and the browser never looks for a new
// worker. Stamping the build id in is what lets an installed app notice a new
// version and offer it (see src/lib/app-updates.js).
//
// The id is a hash of the emitted file names, which Vite content-hashes: it
// stays put when the same source is rebuilt, so redeploying unchanged code does
// not nag anyone, and moves as soon as any bundled file actually changes.
function stampServiceWorkerBuildId() {
  return {
    name: 'stamp-service-worker-build-id',
    apply: 'build',
    writeBundle(options, bundle) {
      const workerPath = path.join(options.dir, 'sw.js')
      const buildId = createHash('sha256').update(Object.keys(bundle).sort().join('\n')).digest('hex').slice(0, 12)
      let source
      try {
        source = readFileSync(workerPath, 'utf8')
      } catch {
        // No worker in the output (a partial or library build): nothing to stamp.
        return
      }
      writeFileSync(workerPath, source.replaceAll('__BUILD_ID__', buildId))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stampServiceWorkerBuildId()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  // Component tests run against happy-dom rather than jsdom: jsdom's dependency
  // chain needs `require(esm)`, which Node 20.17 (the current local runtime) does
  // not support. setup-tests.js registers jest-dom matchers and resets the fetch
  // stub between tests, so no test leaks state into the next.
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: './src/test/setup-tests.js',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
})
