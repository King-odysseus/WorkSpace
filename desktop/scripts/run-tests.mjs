#!/usr/bin/env node
/*
 * Run the desktop test suite in two halves, each in the runtime that can actually
 * run it.
 *
 * The split exists for one reason. The local database uses `node:sqlite`, which is
 * built into Electron's main process (Node 22 and later) but absent from the Node
 * 20 that `npm` happens to resolve on this machine. Running the database tests
 * under plain Node would report a failure that says "this test file is broken"
 * when the truth is "this runtime has no database engine".
 *
 * So the file list is partitioned by path:
 *
 * - everything except `features/copilot/main/db` runs under plain `node`, exactly
 *   as before, so the existing 650-odd tests keep their runtime;
 * - the `db` folder runs under Electron with `ELECTRON_RUN_AS_NODE=1`, which is
 *   the same engine and the same version the app will use in production.
 *
 * Files are passed explicitly rather than as a directory or a glob. Directory
 * arguments behave differently between Node 20 and Electron's Node 24, and a glob
 * that silently matches nothing would turn a whole folder into a green run that
 * tested zero files.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP = path.join(HERE, '..')
const FEATURES = path.join(DESKTOP, 'features')
const DB_DIR = path.join(FEATURES, 'copilot', 'main', 'db')

/** Every `*.test.js` under `features`, in a stable order. */
function testFiles (dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) testFiles(full, found)
    else if (entry.isFile() && entry.name.endsWith('.test.js')) found.push(full)
  }
  return found
}

const all = testFiles(FEATURES).sort()

/**
 * Whether a test file needs the database engine.
 *
 * The folder rule was enough while every storage test lived under `main/db`. It is
 * not enough now: the chat service test opens a real store in a temporary folder,
 * because what it proves is what is actually written, and running it under Node 20
 * would report "this build cannot open the local database" for every case - the
 * runtime lacking the engine, dressed up as a failing feature.
 *
 * So the folder is a shortcut and the content is the rule: a file that builds a
 * store or opens a database needs the engine, wherever it lives.
 */
const NEEDS_DATABASE = /createBusinessStore\s*\(|openDatabase\s*\(/

function needsDatabase (file) {
  if (file.startsWith(DB_DIR + path.sep)) return true
  return NEEDS_DATABASE.test(fs.readFileSync(file, 'utf8'))
}

const storage = all.filter(needsDatabase)
const unit = all.filter((file) => !needsDatabase(file))

if (all.length === 0) {
  console.error('run-tests: no test files were found under features')
  process.exit(1)
}

/** Run one group and return its exit code. */
function run (label, command, args, env) {
  console.log(`\nrun-tests: ${label} (${args.length - 1} files)`)
  const result = spawnSync(command, args, {
    cwd: DESKTOP,
    stdio: 'inherit',
    env: { ...process.env, ...(env ?? {}) },
  })
  if (result.error) {
    console.error(`run-tests: ${label} could not start: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

let exitCode = 0

if (unit.length > 0) {
  exitCode = run('unit tests under node', process.execPath, ['--test', ...unit])
}

if (exitCode === 0 && storage.length > 0) {
  const electronBinary = path.join(
    DESKTOP,
    'node_modules',
    'electron',
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron',
  )
  if (!fs.existsSync(electronBinary)) {
    /*
     * Refusing loudly rather than skipping. A skipped suite reads as "nothing to
     * prove here", which is the opposite of true: these are the isolation tests.
     */
    console.error('run-tests: Electron is not installed, so the database tests cannot run')
    process.exit(1)
  }
  exitCode = run(
    'database tests under Electron node',
    electronBinary,
    ['--test', ...storage],
    { ELECTRON_RUN_AS_NODE: '1' },
  )
}

process.exit(exitCode)
