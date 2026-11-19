'use strict'

/*
 * The desktop renderer owns no palette.
 *
 * The acceptance rule is that the shell reuses the application's tokens and
 * Tailwind convention without adding a stylesheet of its own. That is easy to
 * lose later: a second CSS file or an inline <style> would look harmless in
 * review and quietly become a place for colours to drift out of the design
 * system. These checks read the source, so the rule fails at test time rather
 * than at the next design review.
 *
 *   cd desktop && node --test features/copilot/main/shell/renderer-styles.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const RENDERER = path.join(__dirname, '..', '..', '..', '..', 'renderer')
const SOURCE = path.join(RENDERER, 'src')

function filesUnder (dir) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...filesUnder(full))
    else found.push(full)
  }
  return found
}

test('the renderer has exactly one stylesheet', () => {
  const stylesheets = filesUnder(SOURCE).filter(file => file.endsWith('.css'))
  assert.deepEqual(
    stylesheets.map(file => path.relative(SOURCE, file)),
    ['shell.css']
  )
})

test('that stylesheet only imports the application token sheet', () => {
  const css = fs.readFileSync(path.join(SOURCE, 'shell.css'), 'utf8')
  const imports = [...css.matchAll(/@import\s+["']([^"']+)["']/g)].map(match => match[1])

  assert.deepEqual(imports, ['../../../src/pencil.css'])
  // A second palette declared here would be invisible to the web app.
  assert.equal(/--[a-z0-9-]+\s*:/i.test(css), false)
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(css), false)
})

test('the document carries its policy inline instead of loading a stylesheet', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8')

  assert.equal(/<link\b/i.test(html), false)
  assert.equal(/<style\b/i.test(html), false)

  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)
  assert.ok(policy, 'index.html must ship a content security policy')
  assert.match(policy[1], /default-src 'none'/)
  assert.match(policy[1], /connect-src 'none'/)
})

/* ------------------------------------------------------------------ *
 * Controls a person can actually see and read.
 *
 * These pin four corrections that were each measured in the built renderer, in a
 * real browser at 1280x800. A stylesheet rule is the whole of each fix, so a
 * later tidy-up could undo one without any TypeScript or behaviour test noticing
 * - which is exactly how they went wrong in the first place.
 * ------------------------------------------------------------------ */

function shellCss () {
  return fs.readFileSync(path.join(SOURCE, 'shell.css'), 'utf8')
}

test('the assistant screen is given a definite height to fill', () => {
  /*
   * The token sheet gives these three a `min-height` and no height, so the
   * assistant screen - which sizes itself with `height: 100%` - had nothing to
   * resolve against. Measured: 557px of screen inside an 800px window, with the
   * foot of the sidebar and every panel cut off and the page background showing
   * underneath. Deleting this rule brings that straight back.
   */
  const css = shellCss()
  const block = css.match(/(^|\n)html,\s*\nbody,\s*\n#root\s*\{([^}]*)\}/u)

  assert.ok(block, 'shell.css must give html, body and #root a height')
  assert.match(block[2], /height:\s*100%/u)
})

test('no rule squares off a control the application rounds', () => {
  /*
   * The shell used to force `border-radius: 0` on the rail's current row and on
   * every control of the Models screen, while their neighbours stayed pills. The
   * measured result was the row a person had just clicked changing shape as they
   * used it, and a settings screen that was the only square thing in the window.
   * The application's untouched corner is what these selectors must leave alone.
   */
  const css = shellCss()
  const offenders = [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)]
    .filter(match => /border-radius:\s*0(px)?\s*!important/u.test(match[2]))
    .map(match => match[1].trim())

  assert.deepEqual(offenders, [], 'a control is being squared off again')
})

test('rail labels carry their own size, because the token sheet defeats the utility', () => {
  /*
   * The rail asks for `text-[10px]` and never got it: the token sheet's unlayered
   * `button { font: inherit }` beats everything inside Tailwind's utilities layer,
   * whatever the specificity. At the inherited 16px, "Workspace" needs 87px in a
   * 60px rail and broke into "Works pace". The size therefore has to be stated in
   * this stylesheet; if it goes, the labels silently break again.
   */
  const css = shellCss()
  const rule = css.match(/\[data-shell="rail"\]\s+button\s*>\s*span\s*\{([^}]*)\}/u)

  assert.ok(rule, 'shell.css must style the rail label itself')
  assert.match(rule[1], /font-size:\s*10px/u)
  assert.match(rule[1], /overflow-wrap:\s*normal/u)
})

test('the conversation screen\'s pickers sit on a surface that is not their own background', () => {
  /*
   * The three pickers in that header - business, provider, model - are on the card
   * surface. Filling them with the card surface too left them white on white with
   * no border: measured, three dropdowns reading as plain text with a chevron.
   * They take the app's muted tone, which is its own fill for a control on a card.
   */
  const css = shellCss()
  const rule = css.match(/\[data-shell="chat-screen"\]\s+select\s*\{([^}]*)\}/u)

  assert.ok(rule, 'shell.css must style the conversation screen\'s selects')
  assert.match(rule[1], /background-color:\s*var\(--pencil-surface-muted\)/u)
  assert.equal(/background-color:\s*var\(--pencil-surface\)/u.test(rule[1]), false)
})

test('a disabled control does not offer a pointer cursor', () => {
  /*
   * Same cause as the rail labels: the token sheet's unlayered `button { cursor:
   * pointer }` outranks the `disabled:cursor-not-allowed` utility, so a control the
   * screen had just disabled still said "click me" under the pointer. Measured on
   * the composer's send button with an empty box: disabled, half opacity, pointer.
   */
  const css = shellCss()

  assert.match(css, /\[data-shell\]\s+button:disabled\s*\{[^}]*cursor:\s*not-allowed/u)
})
