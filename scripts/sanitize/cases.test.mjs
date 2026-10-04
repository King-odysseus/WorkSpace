// The rich-text safety cases, running in a browser.
//
// They were skipped in the component suite for months because DOMPurify does not
// behave correctly under happy-dom - it reports isSupported true and then leaves
// <script> intact. Testing it there would have tested happy-dom. So the cases
// moved here, where the sanitizer actually runs.
//
// The module is bundled with vite's own build API - a dependency this project
// already declares - and executed in Chromium, which is a real browser and
// therefore a real answer. No server, no app, no fixtures.

import assert from 'node:assert/strict'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { build } from 'vite'

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const entry = path.join(root, 'src', 'lib', 'sanitize.js')

let browser
let page

// vite's library build, in memory: the sanitizer and DOMPurify, as one script
// the page can be handed.
const bundleSanitizer = async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry,
        formats: ['iife'],
        name: '__sanitize',
        fileName: () => 'sanitize.js',
      },
    },
  })
  const outputs = Array.isArray(result) ? result[0].output : result.output
  const chunk = outputs.find((output) => output.type === 'chunk')
  if (!chunk) throw new Error('the sanitizer did not bundle')
  return chunk.code
}

const clean = (html) => page.evaluate((value) => window.__sanitize.cleanHtml(value), html)

before(async () => {
  const code = await bundleSanitizer()
  browser = await chromium.launch()
  page = await browser.newPage()
  // A blank page is enough: the sanitizer needs a DOM, not the app.
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ content: code })

  const ready = await page.evaluate(() => typeof window.__sanitize?.cleanHtml === 'function')
  assert.ok(ready, 'the sanitizer should be on the page before the cases run')
}, { timeout: 120000 })

after(async () => {
  await browser?.close()
})

describe('cleanHtml removes script vectors', () => {
  it('drops script, style and embedding elements', async () => {
    assert.equal(await clean('<p>ok</p><script>alert(1)</script>'), '<p>ok</p>')
    assert.equal(await clean('<iframe src="https://evil.test"></iframe>'), '')
    assert.equal(await clean('<object data="x"></object><embed src="x">'), '')
  })

  it('drops the SVG and MathML grammars', async () => {
    assert.doesNotMatch(await clean('<svg><script>alert(1)</script></svg>'), /script/)
    assert.doesNotMatch(await clean('<math><mi>x</mi></math>'), /<math/)
  })

  it('strips inline event handlers however they are cased', async () => {
    assert.doesNotMatch(await clean('<img src="/logo.png" onerror="alert(1)">'), /onerror/)
    assert.doesNotMatch(await clean('<div OnClick="alert(1)">hi</div>'), /onclick/i)
  })

  it('resists the noscript mutation vector', async () => {
    // Classic mXSS payload: a naive parser re-serialises this into a live <img
    // onerror>. Nothing executable may survive.
    const output = await clean('<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>')
    assert.doesNotMatch(output, /onerror/i)
    assert.doesNotMatch(output, /<script/)
  })
})

describe('cleanHtml applies the app URL policy', () => {
  it('removes javascript: hrefs but keeps the element', async () => {
    const output = await clean('<a href="javascript:alert(1)">click</a>')
    assert.doesNotMatch(output, /javascript:/i)
    assert.match(output, /click/)
  })

  it('keeps http, mailto and relative links', async () => {
    assert.match(await clean('<a href="https://example.test/x">a</a>'), /https:\/\/example\.test\/x/)
    assert.match(await clean('<a href="mailto:a@b.test">a</a>'), /mailto:a@b\.test/)
    assert.match(await clean('<a href="/docs">a</a>'), /href="\/docs"/)
  })

  it('allows inline base64 images but not other data URLs', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    assert.match(await clean(`<img src="${png}">`), new RegExp(png.replace(/[+/=]/g, '\\$&')))
    assert.doesNotMatch(
      await clean('<img src="data:text/html;base64,PHNjcmlwdD4=">'),
      /data:text\/html/,
    )
  })

  it('marks every link noopener noreferrer', async () => {
    assert.match(await clean('<a href="https://example.test">a</a>'), /rel="noopener noreferrer"/)
  })
})

describe('cleanHtml preserves editor formatting', () => {
  it('keeps the markup the rich text editor produces', async () => {
    const markup = '<p><b>bold</b> <i>italic</i> <u>under</u></p><ul><li>one</li></ul>'
    assert.equal(await clean(markup), markup)
  })

  it('returns an empty string for empty input', async () => {
    assert.equal(await clean(''), '')
    assert.equal(await clean(null), '')
  })
})
