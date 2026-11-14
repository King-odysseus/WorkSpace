#!/usr/bin/env node
/*
 * Section 5 "web is unchanged" proof, run from the repository root.
 *
 * The plan requires this proof at the end of every phase, so it is a script and
 * not a set of remembered commands: backticks in a report get re-typed from
 * memory, and a proof that is re-typed wrong is not a proof.
 *
 * What it checks, in the order the plan states them:
 *
 * 1. No protected path changed - committed, staged, unstaged or untracked.
 *    Untracked files need their own check because `git diff` cannot see them, and
 *    the untracked mockups are exactly the kind of work a plain diff would report
 *    as clean. The exemption is one exact path per file that was recorded at
 *    phase start, never a folder, so a new file cannot slip in behind the old
 *    ones and reach the production stylesheet unseen.
 * 2. `npm run build` succeeds and produces the baseline asset filenames.
 *    Vite content-hashes those names, so an identical set means identical output.
 * 3. No Copilot content in `dist/`, by file name or file text.
 * 4. Mockups stay outside the build inputs: the Vite config still takes the
 *    default single `index.html` entry, that page loads `/src/main.jsx`, no
 *    mockup marker or mockup page reaches the output, and no mockup-only class
 *    reaches the production stylesheet.
 *
 * Three defaults are deliberately strict, because each one was a way for a run
 * to report success while the web output had moved:
 *
 * - A new untracked file under a protected path fails check p4 unless it is one
 *   of the pinned paths above it in this file.
 * - Check m5 fails, not warns, when a mockup-only class ships in the app CSS.
 *   `--allow-mockup-css` records the coupling as a warning instead, and the run
 *   then says plainly that it has not proved independence from the mockups.
 * - `--record-baseline` runs every check first and writes nothing if one fails,
 *   so a baseline can never bless a tree that the proof just rejected.
 *
 * Exit codes: 0 every check passed, 1 a check failed, 2 the proof could not run
 * (no baseline, build failed, git or npm unavailable).
 *
 * Usage:
 *   node desktop/scripts/verify-web-unchanged.mjs
 *   node desktop/scripts/verify-web-unchanged.mjs --phase-start 1e67a94
 *   node desktop/scripts/verify-web-unchanged.mjs --record-baseline
 *   node desktop/scripts/verify-web-unchanged.mjs --skip-build
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const DIST_DIR = path.join(REPO_ROOT, 'dist')
const ASSETS_DIR = path.join(DIST_DIR, 'assets')
export const DEFAULT_BASELINE = path.join(REPO_ROOT, '.tmp-phase0', 'dist-assets-baseline.txt')

// The commit the Phase 0 baseline was recorded on. Later phases pass their own
// start commit; the default only exists so the Phase 0 run needs no arguments.
export const DEFAULT_PHASE_START = '1e67a947e2de1f19fec0f8b524e382a6c1f638c5'

// Paths section 5 protects. `vite.config.ts` is not listed by the plan, but a
// rename would move the build inputs without touching any listed path, so the
// script fails loudly if one appears rather than reporting a clean diff.
export const PROTECTED_PATHS = ['src', 'tasks', 'backend', 'package.json', 'package-lock.json', 'vite.config.js']
export const UNEXPECTED_CONFIG_VARIANTS = ['vite.config.ts', 'vite.config.mjs', 'vite.config.cjs']

// Files that were already untracked when Phase 0 started, recorded in
// desktop/reports/phase-0.md section 1. They are mockups, they are not build
// inputs, and check 4 proves the second point. Anything else untracked under a
// protected path is a real change and fails check 1.
//
// These are pinned paths, not a folder rule. `src/mockups/copilot/` as a folder
// entry accepts any file dropped into it later, and Tailwind scans that folder
// into the production stylesheet, so a new mockup file could change the shipped
// CSS while the proof still reported the tree clean. A new file now fails check
// p4 and has to be reviewed and pinned here on purpose.
export const PINNED_UNTRACKED = [
  'src/mockups/copilot/Chat.jsx',
  'src/mockups/copilot/CopilotMockup.jsx',
  'src/mockups/copilot/Dashboard.jsx',
  'src/mockups/copilot/WeeklyPlan.jsx',
  'src/mockups/copilot/WorkspaceMode.jsx',
  'src/mockups/copilot/main.jsx',
  'src/mockups/copilot/parts.jsx',
]

// Content fingerprint of exactly those files, taken with fingerprintFiles() when
// they were recorded. Check p6 compares it, so a later run can say whether the
// pinned files still describe the tree instead of assuming they do.
export const PINNED_UNTRACKED_FINGERPRINT = '639650acd9138e5d'

// A phrase that exists only in src/mockups/copilot/CopilotMockup.jsx. It is the
// marker for "the mockup got bundled"; the file-name scan in check 3 would not
// catch it, because a bundled mockup has a hashed name like index-abc123.js.
export const MOCKUP_MARKER = 'WorkSpace Desktop with ZuriCopilot (option A)'
export const MOCKUP_PAGES = ['copilot-mockup.html', 'mockup.html']

// Content scanning is limited to text output. Decoding a PNG as UTF-8 costs time
// and can only produce accidental matches.
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt', '.webmanifest', '.xml'])

// The mockup folder and page. Both are scanned by Tailwind's automatic source
// detection, which is why a mockup edit can change the production stylesheet.
const MOCKUP_SOURCES = ['src/mockups/copilot', 'copilot-mockup.html']
const APP_SOURCE_DIR = 'src'
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx'])

/** Baseline lines, ignoring the `#` context header that --record-baseline writes. */
export function baselineLines (baselineText) {
  return String(baselineText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

/** The `# key: value` header of a baseline file, as an object. */
export function parseBaselineContext (baselineText) {
  const context = {}
  for (const line of String(baselineText || '').split(/\r?\n/)) {
    const match = line.match(/^#\s*([a-z-]+)\s*:\s*(.*)$/i)
    if (match) context[match[1].toLowerCase()] = match[2].trim()
  }
  return context
}

/** One baseline file: a `#` header recording what the names were built from, then the names. */
export function serialiseBaseline (assetNames, context = {}) {
  const header = [
    '# ZuriCopilot section 5 asset baseline',
    `# recorded: ${context.recorded || new Date().toISOString()}`,
    `# commit: ${context.commit || 'unknown'}`,
    // Tailwind scans the mockups, so the stylesheet is only reproducible while
    // these files are unchanged. Recording the fingerprint makes a later drift
    // explainable instead of mysterious.
    `# mockups: ${context.mockups || 'unknown'}`,
  ]
  return `${[...header, ...[...assetNames].sort()].join('\n')}\n`
}

/** Compare the baseline asset names with what the build wrote. */
export function compareAssetLists (baselineText, actualNames) {
  const expected = baselineLines(baselineText)
  const actual = [...(actualNames || [])].map(name => String(name)).sort()
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  return {
    expected: [...expected].sort(),
    actual,
    missing: expected.filter(name => !actualSet.has(name)).sort(),
    added: actual.filter(name => !expectedSet.has(name)).sort(),
    matches: expected.length === actual.length && expected.every(name => actualSet.has(name)),
  }
}

/**
 * Files in the output that mention Copilot, by name or by text.
 *
 * `entries` is `[{ file, content }]`; `content` is null for a binary file, whose
 * name is still checked.
 */
export function findCopilotMatches (entries) {
  const hits = []
  for (const entry of entries || []) {
    const file = String(entry && entry.file ? entry.file : '')
    if (/copilot/i.test(file)) {
      hits.push({ file, kind: 'filename' })
      continue
    }
    const content = entry && typeof entry.content === 'string' ? entry.content : ''
    if (/copilot/i.test(content)) {
      const line = content.split(/\r?\n/).find(text => /copilot/i.test(text)) || ''
      hits.push({ file, kind: 'content', line: line.trim().slice(0, 120) })
    }
  }
  return hits
}

/**
 * Whether the Vite config still takes the default single-entry build.
 *
 * A `rollupOptions.input` would let a second page (a mockup) into the build, and
 * that is the one thing check 4 is guarding. The config is read as text rather
 * than imported: importing it would run the plugins, and this check must keep
 * working when the config is mid-change and will not load.
 */
export function inspectViteConfigInput (configText) {
  const text = String(configText || '')
  const rollupOptions = /rollupOptions\s*:/.test(text)
  const inputOverride = /(^|[\s,{])input\s*:/.test(text)
  return {
    hasRollupOptions: rollupOptions,
    hasInputOverride: inputOverride,
    defaultSingleEntry: !rollupOptions && !inputOverride,
  }
}

/** The `src` of every `<script>` in a page, module ones separated out. */
export function inspectIndexHtmlInputs (html) {
  const text = String(html || '')
  const tagPattern = /<script\b[^>]*>/gi
  const srcPattern = /\bsrc\s*=\s*["']([^"']+)["']/i
  const typePattern = /\btype\s*=\s*["']([^"']+)["']/i
  const scripts = []
  for (const tag of text.match(tagPattern) || []) {
    const src = tag.match(srcPattern)
    if (!src) continue
    const type = tag.match(typePattern)
    scripts.push({ src: src[1], type: type ? type[1] : '' })
  }
  return {
    scripts,
    moduleScripts: scripts.filter(script => script.type === 'module'),
  }
}

/**
 * Every whitespace-delimited token in a file, punctuation trimmed.
 *
 * Used for the app side of the m5 check, deliberately as generous as possible:
 * the app can compose class names through helpers, split them across template
 * literals, or mention them in a comment, and any of those means the class would
 * ship with or without the mockups. Its only job is to avoid accusing the
 * mockups of a class the app already has, so a false "app uses this" is the
 * safe direction to be wrong in.
 */
/**
 * One candidate token, with the JSX or array punctuation around it removed.
 *
 * A class's own square brackets are a matched pair (`max-w-[1240px]`), so only
 * an unbalanced one can be punctuation that wrapped the class.
 */
function trimToken (text) {
  let token = text
  while (token !== '' && !/[A-Za-z0-9@]/.test(token[0])) token = token.slice(1)
  const opens = (token.match(/\[/g) || []).length
  let extraCloses = (token.match(/\]/g) || []).length - opens
  while (extraCloses > 0 && token.endsWith(']')) {
    token = token.slice(0, -1)
    extraCloses -= 1
  }
  return token
}

export function extractSourceTokens (sourceText) {
  const tokens = new Set()
  // Quotes, brackets of JSX expressions, parentheses and commas can all sit
  // against a class name (`cn('px-6', x)`), so they split the source here.
  // Square brackets are kept: an arbitrary value such as `max-w-[1240px]`
  // needs them.
  for (const piece of String(sourceText || '').split(/[\s"'`(){}<>=,;]+/)) {
    const token = trimToken(piece)
    if (token !== '' && /[a-z]/i.test(token)) tokens.add(token)
  }
  return tokens
}

/**
 * Class-name tokens from `className` attributes, including template literals.
 *
 * This is deliberately loose: it only has to find tokens that are worth
 * looking for in the built stylesheet, and a token that is not a real utility
 * simply will not be found there.
 */
export function extractClassTokens (sourceText) {
  const tokens = new Set()
  const attribute = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g
  let match
  while ((match = attribute.exec(String(sourceText || ''))) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? ''
    for (const token of value.split(/\s+/)) {
      // Template literals carry quotes, braces and `${...}` fragments; a class
      // token never contains any of them.
      const cleaned = token.replace(/\$\{.*$/g, '').replace(/[{}`'"]/g, '').trim()
      if (cleaned !== '' && /[a-z]/i.test(cleaned)) tokens.add(cleaned)
    }
  }
  return tokens
}

/**
 * Mockup-only class tokens that appear in the built stylesheet.
 *
 * Tailwind v4 finds sources by scanning the project, so a class used only by a
 * mockup still lands in the app's CSS. The stylesheet ships those selectors and
 * nothing else from the mockup: no mockup code runs, but the app's own CSS
 * changes whenever the mockups change, which is not "the web app is unchanged".
 */
export function findMockupClassesInCss (cssText, appTokens, mockupTokens) {
  // Tailwind writes escaped selectors such as `.max-w-\[1240px\]`. Stripping
  // the backslashes once lets a plain token search work for every character.
  const unescaped = String(cssText || '').replace(/\\/g, '')
  const hits = []
  for (const token of mockupTokens || []) {
    if (!token || token.length < 4) continue
    if (appTokens && appTokens.has(token)) continue
    if (unescaped.includes(`.${token}`)) hits.push(token)
  }
  return hits.sort()
}

/**
 * How check m5 should be reported.
 *
 * Fails by default, because a run whose output carries mockup-only selectors has
 * not shown the app's CSS is independent of the mockups. `--allow-mockup-css`
 * is the only way to downgrade it, and the caller then says plainly what the run
 * no longer proves.
 */
export function mockupCssOutcome (hitCount, options = {}) {
  if (!(hitCount > 0)) return 'pass'
  return options.allowMockupCss === true ? 'warn' : 'fail'
}

/** The checks that decide the exit code. `--strict` promotes warnings too. */
export function failingChecks (checks, options = {}) {
  return (Array.isArray(checks) ? checks : [])
    .filter(check => !check.pass && (check.warning !== true || options.strict === true))
}

/**
 * Whether `--record-baseline` may write.
 *
 * The caller passes the same failing list the exit code uses, so a baseline can
 * never be blessed from a tree the proof just rejected.
 */
export function mayRecordBaseline (failures) {
  return (Array.isArray(failures) ? failures : []).length === 0
}

/** A stable fingerprint of the mockup files, so a baseline drift can be attributed. */
export function fingerprintFiles (files) {
  const digest = createHash('sha256')
  for (const file of [...(files || [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    digest.update(`${file.name}\n${file.content}\n`)
  }
  return digest.digest('hex').slice(0, 16)
}

/** One path in the form used for comparison: forward slashes, no trailing slash. */
export function normalisePath (file) {
  return String(file == null ? '' : file).replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Whether an untracked path is one of the exact files pinned at phase start.
 *
 * Exact comparison, never a folder prefix: the prefix form accepted any file
 * added to the folder later, and those files reach the production stylesheet
 * through Tailwind's scan.
 */
export function isKnownUntracked (file, known = PINNED_UNTRACKED) {
  const normalised = normalisePath(file)
  return (known || []).some(entry => normalisePath(entry) === normalised)
}

/**
 * Compare the pinned mockup files with the fingerprint taken at phase start.
 *
 * `currentFiles` is `[{ name, content }]` read from disk under the pinned names.
 * A pinned file that has gone missing is listed, because a deletion changes the
 * stylesheet's inputs as much as an edit does.
 */
export function comparePinnedFingerprint (currentFiles, pinned = {}) {
  const files = Array.isArray(currentFiles) ? currentFiles : []
  const expectedNames = [...(pinned.files || PINNED_UNTRACKED)]
  const expected = String(pinned.fingerprint || PINNED_UNTRACKED_FINGERPRINT)
  const present = files.map(file => normalisePath(file && file.name))
  const current = fingerprintFiles(files)
  return {
    pinned: expected,
    current,
    missing: expectedNames.filter(name => !present.includes(normalisePath(name))),
    matches: current === expected,
  }
}

function readText (file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function isFile (file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** Every file under a directory, relative to it, with slashes normalised. */
function walk (dir, prefix = '') {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      out.push(...walk(path.join(dir, entry.name), relative))
    } else {
      out.push(relative)
    }
  }
  return out.sort()
}

function run (command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // npm and npx are .cmd shims on Windows; git resolves without a shell.
    shell: process.platform === 'win32' && options.shell !== false,
    ...options,
  })
}

function gitChangedFiles (args) {
  const result = run('git', args, { shell: false })
  if (result.error) throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.status}: ${(result.stderr || '').trim()}`)
  }
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function parseArgs (argv) {
  const options = {
    phaseStart: DEFAULT_PHASE_START,
    baseline: DEFAULT_BASELINE,
    build: true,
    recordBaseline: false,
    allowMockupCss: false,
    strict: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null]
    const value = () => {
      if (inline !== null) return inline
      index += 1
      if (index >= argv.length) throw new Error(`${flag} needs a value`)
      return argv[index]
    }
    if (flag === '--phase-start') options.phaseStart = value()
    else if (flag === '--baseline') options.baseline = path.resolve(REPO_ROOT, value())
    else if (flag === '--skip-build') options.build = false
    else if (flag === '--record-baseline') options.recordBaseline = true
    else if (flag === '--allow-mockup-css') options.allowMockupCss = true
    else if (flag === '--strict') options.strict = true
    else if (flag === '--help' || flag === '-h') options.help = true
    else throw new Error(`unknown option ${arg}`)
  }
  return options
}

const HELP = `Verify the web app is unchanged (plan section 5).

Usage: node desktop/scripts/verify-web-unchanged.mjs [options]

  --phase-start <commit>   Commit the phase started on. Default ${DEFAULT_PHASE_START.slice(0, 7)}.
  --baseline <file>        Asset-name baseline. Default ${path.relative(REPO_ROOT, DEFAULT_BASELINE)}.
  --skip-build             Compare the existing dist/ instead of running npm run build.
  --record-baseline        Write the asset list as the new baseline, with the commit and
                           the mockup fingerprint in a comment header. Every check runs
                           first and nothing is written if one of them fails.
  --allow-mockup-css       Record the mockup-to-stylesheet coupling as a warning instead
                           of a failure. Required to record a baseline while that
                           coupling is unresolved.
  --strict                 Treat warnings as failures too, including an allowed m5.
  --help                   This text.

Exit codes: 0 passed, 1 a check failed, 2 the proof could not run.`

function printCheck (checks, id, pass, detail) {
  checks.push({ id, pass, detail, warning: false })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${detail}`)
}

function printWarning (checks, id, detail) {
  checks.push({ id, pass: false, detail, warning: true })
  console.log(`  WARN  ${detail}`)
}

/** Source files under a directory as `{ rel, content }`, relative to that directory. */
function sourceFiles (dir) {
  const files = []
  for (const rel of walk(dir)) {
    if (!SOURCE_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue
    const content = readText(path.join(dir, rel))
    if (content !== null) files.push({ rel, content })
  }
  return files
}

/** Class tokens used by the mockups, which the app's stylesheet should not carry. */
function mockupTokens () {
  const tokens = new Set()
  for (const root of MOCKUP_SOURCES) {
    const absolute = path.join(REPO_ROOT, root)
    if (!existsSync(absolute)) continue
    const files = isFile(absolute)
      ? [{ rel: root, content: readText(absolute) || '' }]
      : sourceFiles(absolute).map(file => ({ rel: `${root}/${file.rel}`, content: file.content }))
    for (const file of files) for (const token of extractClassTokens(file.content)) tokens.add(token)
  }
  return tokens
}

/** Fingerprint of the mockup sources, so a baseline drift can be attributed. */
function mockupFingerprint () {
  const files = []
  for (const root of MOCKUP_SOURCES) {
    const absolute = path.join(REPO_ROOT, root)
    if (!existsSync(absolute)) continue
    if (isFile(absolute)) {
      files.push({ name: root, content: readText(absolute) || '' })
      continue
    }
    for (const file of sourceFiles(absolute)) files.push({ name: `${root}/${file.rel}`, content: file.content })
  }
  return fingerprintFiles(files)
}

function headCommit () {
  try {
    const rev = run('git', ['rev-parse', 'HEAD'], { shell: false })
    if (rev.status === 0) return String(rev.stdout || '').trim()
  } catch {
    // Not a git checkout: the baseline can still be recorded without it.
  }
  return ''
}

/**
 * Run every check and return the collected results.
 *
 * Each check is independent so a failure in one still reports the rest: a
 * reviewer needs the whole picture, not the first failure.
 */
function main () {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`error: ${error.message}`)
    return 2
  }
  if (options.help) {
    console.log(HELP)
    return 0
  }

  console.log('ZuriCopilot proof - the web app is unchanged')
  console.log(`Repo: ${REPO_ROOT}`)
  console.log(`Phase start: ${options.phaseStart}`)
  console.log('')

  const checks = []

  // Check 1: protected paths, in all four states git can put a file in.
  console.log('1. Protected paths')
  const protectedPaths = [...PROTECTED_PATHS]
  let committed = []
  let staged = []
  let unstaged = []
  let untracked = []
  try {
    committed = gitChangedFiles(['diff', '--name-status', `${options.phaseStart}..HEAD`, '--', ...protectedPaths])
    staged = gitChangedFiles(['diff', '--cached', '--name-status', '--', ...protectedPaths])
    unstaged = gitChangedFiles(['diff', '--name-status', '--', ...protectedPaths])
    untracked = gitChangedFiles(['ls-files', '--others', '--exclude-standard', '--', ...protectedPaths])
  } catch (error) {
    console.error(`  ERROR  ${error.message}`)
    return 2
  }

  const label = protectedPaths.join(', ')
  printCheck(checks, 'p1', committed.length === 0,
    committed.length === 0
      ? `committed diff ${options.phaseStart.slice(0, 7)}..HEAD is empty for ${label}`
      : `committed diff ${options.phaseStart.slice(0, 7)}..HEAD touches ${committed.join(', ')}`)
  printCheck(checks, 'p2', staged.length === 0,
    staged.length === 0 ? 'staged changes are empty for the same paths' : `staged changes: ${staged.join(', ')}`)
  printCheck(checks, 'p3', unstaged.length === 0,
    unstaged.length === 0 ? 'unstaged changes are empty for the same paths' : `unstaged changes: ${unstaged.join(', ')}`)

  const unexpectedUntracked = untracked.filter(file => !isKnownUntracked(file))
  const knownUntracked = untracked.filter(file => isKnownUntracked(file))
  printCheck(checks, 'p4', unexpectedUntracked.length === 0,
    unexpectedUntracked.length === 0
      ? `untracked files under those paths: ${knownUntracked.length === 0 ? 'none' : `only the ${knownUntracked.length} pinned files`}`
      : `unrecorded untracked files: ${unexpectedUntracked.join(', ')}`)
  for (const file of knownUntracked) {
    console.log(`        pinned at phase start and left in place: ${file}`)
  }

  // p6: the pinned paths are a list of names, so this adds the content. A pinned
  // file that changed still passes p4 but no longer describes the tree, and a
  // reviewer reading "only the pinned files" deserves to know that.
  const pinnedFilesPresent = PINNED_UNTRACKED
    .map(file => ({ name: file, content: readText(path.join(REPO_ROOT, file)) }))
    .filter(file => file.content !== null)
  const pinned = comparePinnedFingerprint(pinnedFilesPresent)
  if (pinned.matches) {
    printCheck(checks, 'p6', true,
      `the ${pinnedFilesPresent.length} pinned mockup files match the fingerprint taken at phase start (${pinned.current})`)
  } else {
    const missingNote = pinned.missing.length === 0 ? '' : `; not on disk: ${pinned.missing.join(', ')}`
    printWarning(checks, 'p6',
      `the pinned mockup files no longer match the phase-start fingerprint (${pinned.pinned} -> ${pinned.current})${missingNote}`)
    console.log('        check m5 shows whether that changed the production stylesheet; re-pin after review')
  }

  const variants = UNEXPECTED_CONFIG_VARIANTS.filter(file => existsSync(path.join(REPO_ROOT, file)))
  printCheck(checks, 'p5', variants.length === 0,
    variants.length === 0
      ? 'no extra vite.config.* variant redirects the build'
      : `a build-config variant exists and must be reviewed: ${variants.join(', ')}`)
  console.log('')

  // Check 2: the build, and the asset names it produced.
  console.log('2. Production build')
  let buildSummary = 'build not run (--skip-build)'
  if (options.build) {
    const started = Date.now()
    const result = run('npm', ['run', 'build'], { shell: process.platform === 'win32' })
    const output = `${result.stdout || ''}${result.stderr || ''}`
    const failed = result.error || result.status !== 0
    if (failed) {
      const tail = output.split(/\r?\n/).filter(Boolean).slice(-12).join('\n        ')
      console.error(`  ERROR  npm run build exited ${result.status === null ? 'without a status' : result.status}`)
      if (tail) console.error(`        ${tail}`)
      if (result.error) console.error(`        ${result.error.message}`)
      return 2
    }
    const modules = output.match(/(\d+)\s+modules transformed/)
    buildSummary = `npm run build passed in ${((Date.now() - started) / 1000).toFixed(1)}s` +
      (modules ? `, ${modules[1]} modules transformed` : '')
    printCheck(checks, 'b1', true, buildSummary)
  } else {
    console.log(`  SKIP  ${buildSummary}`)
  }

  if (!isFile(path.join(DIST_DIR, 'index.html'))) {
    console.error('  ERROR  dist/index.html is missing; run without --skip-build')
    return 2
  }
  let actualAssets
  try {
    actualAssets = readdirSync(ASSETS_DIR).filter(name => isFile(path.join(ASSETS_DIR, name)))
  } catch (error) {
    console.error(`  ERROR  cannot read dist/assets: ${error.message}`)
    return 2
  }

  // The baseline is deliberately not written here. A baseline recorded before
  // the dist and mockup checks would bless a tree those checks are about to
  // reject as the reference every later phase is compared against. The write
  // happens at the very end, after check m5.
  if (options.recordBaseline) {
    console.log(`  NOTE  recording ${path.relative(REPO_ROOT, options.baseline)} after checks 3 and 4 run; there is nothing to compare against yet`)
  } else {
    const baselineText = readText(options.baseline)
    if (baselineText === null) {
      console.error(`  ERROR  no baseline at ${path.relative(REPO_ROOT, options.baseline)}`)
      console.error('        record one from a known-good build: --record-baseline')
      return 2
    }
    const comparison = compareAssetLists(baselineText, actualAssets)
    printCheck(checks, 'b2', comparison.matches,
      comparison.matches
        ? `dist/assets holds the same ${comparison.expected.length} hashed names as the baseline`
        : `asset list changed: ${comparison.missing.length} missing, ${comparison.added.length} added`)
    for (const name of comparison.missing) console.log(`        missing from the build: ${name}`)
    for (const name of comparison.added) console.log(`        added by the build: ${name}`)
    if (!comparison.matches) {
      // Tailwind scans the mockups, so editing a mockup changes the production
      // stylesheet and every JS chunk that references it. Without this note a
      // reviewer would read the drift as a web-app change.
      const recorded = parseBaselineContext(baselineText)
      const current = { mockups: mockupFingerprint(), commit: headCommit() }
      if (recorded.mockups && recorded.mockups !== 'unknown' && recorded.mockups !== current.mockups) {
        console.log(`        cause: the mockup files changed since the baseline was recorded (${recorded.mockups} -> ${current.mockups})`)
        console.log('        they feed the production stylesheet, see check m5; re-record with --record-baseline')
      } else if (recorded.commit && recorded.commit !== 'unknown' && current.commit && recorded.commit !== current.commit) {
        console.log(`        cause: the working tree is on ${current.commit.slice(0, 7)}, the baseline was recorded on ${recorded.commit.slice(0, 7)}`)
      }
    }
  }
  console.log('')

  // Check 3: no Copilot content in the output, by name or by text.
  console.log('3. No Copilot content in dist/')
  const entries = walk(DIST_DIR).map(file => {
    const extension = path.extname(file).toLowerCase()
    const content = TEXT_EXTENSIONS.has(extension) ? readText(path.join(DIST_DIR, file)) : null
    return { file, content }
  })
  const copilotHits = findCopilotMatches(entries)
  printCheck(checks, 'd1', copilotHits.length === 0,
    copilotHits.length === 0
      ? `scanned ${entries.length} files in dist/; none mention copilot in name or text`
      : `Copilot content found: ${copilotHits.map(hit => `${hit.file} (${hit.kind})`).join(', ')}`)
  for (const hit of copilotHits) {
    if (hit.line) console.log(`        ${hit.file}: ${hit.line}`)
  }
  console.log('')

  // Check 4: the mockups are not build inputs and do not reach the output.
  console.log('4. Mockups stay outside the build')
  const viteConfig = readText(path.join(REPO_ROOT, 'vite.config.js'))
  if (viteConfig === null) {
    console.error('  ERROR  vite.config.js is missing')
    return 2
  }
  const viteInput = inspectViteConfigInput(viteConfig)
  printCheck(checks, 'm1', viteInput.defaultSingleEntry,
    viteInput.defaultSingleEntry
      ? 'vite.config.js has no rollupOptions/input override, so the build takes the default index.html entry'
      : `vite.config.js sets a build input override (rollupOptions: ${viteInput.hasRollupOptions}, input: ${viteInput.hasInputOverride})`)

  const indexHtml = readText(path.join(REPO_ROOT, 'index.html'))
  const indexInputs = inspectIndexHtmlInputs(indexHtml)
  const entryScripts = indexInputs.moduleScripts.map(script => script.src)
  const entryIsApp = entryScripts.length === 1 && entryScripts[0] === '/src/main.jsx'
  printCheck(checks, 'm2', entryIsApp,
    entryIsApp
      ? 'index.html has exactly one module script, /src/main.jsx'
      : `index.html module scripts: ${entryScripts.length === 0 ? 'none' : entryScripts.join(', ')}`)

  const markerHits = entries.filter(entry => typeof entry.content === 'string' && entry.content.includes(MOCKUP_MARKER))
  printCheck(checks, 'm3', markerHits.length === 0,
    markerHits.length === 0
      ? 'no file in dist/ carries the mockup-only marker text'
      : `mockup marker text appears in: ${markerHits.map(entry => entry.file).join(', ')}`)

  const emittedMockupPages = MOCKUP_PAGES.filter(page => existsSync(path.join(DIST_DIR, page)))
  printCheck(checks, 'm4', emittedMockupPages.length === 0,
    emittedMockupPages.length === 0
      ? `no mockup page is emitted (${MOCKUP_PAGES.join(', ')})`
      : `mockup pages in dist/: ${emittedMockupPages.join(', ')}`)

  // m5: Tailwind v4 finds its sources by scanning the project, so a class used
  // only by a mockup still reaches the app's stylesheet. Nothing from the
  // mockup runs, but the app's CSS is not independent of the mockups, and the
  // asset baseline cannot hold while they are being edited.
  const cssFiles = actualAssets.filter(name => name.endsWith('.css'))
  const cssText = cssFiles.map(name => readText(path.join(ASSETS_DIR, name)) || '').join('\n')
  const appTokens = new Set()
  for (const file of sourceFiles(path.join(REPO_ROOT, APP_SOURCE_DIR))) {
    if (file.rel.startsWith('mockups/')) continue
    for (const token of extractSourceTokens(file.content)) appTokens.add(token)
  }
  const mockupCssHits = findMockupClassesInCss(cssText, appTokens, mockupTokens())
  const mockupCssDetail = `${mockupCssHits.length} mockup-only classes reach the production stylesheet: ${mockupCssHits.slice(0, 8).join(', ')}`
  const m5 = mockupCssOutcome(mockupCssHits.length, options)
  if (m5 === 'pass') {
    printCheck(checks, 'm5', true, 'no mockup-only class reaches the production stylesheet')
  } else if (m5 === 'warn') {
    printWarning(checks, 'm5', `${mockupCssDetail} (allowed by --allow-mockup-css)`)
    console.log('        this run does not prove the app stylesheet is independent of the mockups')
  } else {
    printCheck(checks, 'm5', false, mockupCssDetail)
    console.log('        the mockups are not build inputs, but Tailwind scans them and their selectors ship')
    console.log('        exclude the mockup folder from the Tailwind sources, or pass --allow-mockup-css to record the coupling')
  }
  console.log('')

  const warnings = checks.filter(check => check.warning)
  const failures = failingChecks(checks, options)

  let baselineWritten = false
  if (options.recordBaseline) {
    if (!mayRecordBaseline(failures)) {
      console.log(`  REFUSED baseline ${path.relative(REPO_ROOT, options.baseline)}: ` +
        `${failures.length} check${failures.length === 1 ? '' : 's'} failed (${failures.map(check => check.id).join(', ')})`)
      console.log('        fix them, or pass --allow-mockup-css to record the m5 coupling deliberately')
    } else {
      mkdirSync(path.dirname(options.baseline), { recursive: true })
      writeFileSync(options.baseline, serialiseBaseline(actualAssets, {
        recorded: new Date().toISOString(),
        commit: headCommit() || 'unknown',
        mockups: mockupFingerprint(),
      }))
      baselineWritten = true
      console.log(`  WROTE baseline ${path.relative(REPO_ROOT, options.baseline)} (${actualAssets.length} assets)`)
    }
    console.log('')
  }

  if (failures.length === 0) {
    console.log(`RESULT: PASS - ${checks.length} checks, ${buildSummary}` +
      (baselineWritten ? ', baseline recorded' : '') +
      (warnings.length === 0 ? '' : `; ${warnings.length} warning${warnings.length === 1 ? '' : 's'} (${warnings.map(check => check.id).join(', ')})`))
  } else {
    console.log(`RESULT: FAIL - ${failures.length} of ${checks.length} checks failed: ${failures.map(check => check.id).join(', ')}`)
  }
  return failures.length === 0 ? 0 : 1
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  process.exitCode = main()
}
