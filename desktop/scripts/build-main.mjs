#!/usr/bin/env node
/*
 * Bundle the main-process TypeScript entry for Electron.
 *
 * Electron runs plain CommonJS with no compiler in the loop, so the typed
 * sources under `features/copilot` are bundled once into `build/main/ipc.cjs`.
 * `electron` stays external: it is provided by the runtime, and bundling it
 * would ship a second copy of the API.
 *
 * esbuild does not typecheck. `npm run typecheck` (and `npm run check`, which
 * runs it first) is what proves the types, so a broken build cannot pass tests.
 */
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))

await build({
  entryPoints: [path.join(desktopRoot, 'features', 'copilot', 'main', 'ipc', 'index.ts')],
  outfile: path.join(desktopRoot, 'build', 'main', 'ipc.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info'
})
