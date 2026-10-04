import { describe, expect, it } from 'vitest'
import { safeUrl } from '../lib/sanitize.js'

// cleanHtml is not tested here, and the reason matters.
//
// cleanHtml delegates to DOMPurify, which does not behave correctly under
// happy-dom: it reports isSupported true, yet leaves <script> intact and strips
// legitimate elements. happy-dom's own DOMParser parses the same markup fine, so
// the fault is in the lower-level APIs DOMPurify walks the tree with, not in the
// library or in this integration - DOMPurify is correct in real browsers, which
// is the only place this code runs.
//
// Asserting its behaviour under happy-dom would test happy-dom, not the
// sanitizer. So the cases run in a real browser instead, against this same
// module: npm run test:sanitize, in scripts/sanitize/cases.test.mjs, and in CI.
// They were skipped here for long enough to be worth saying plainly.
//
// safeUrl is pure string logic, needs no DOM, and runs for real below.

describe('safeUrl', () => {
  it('rejects schemes that can execute, including obfuscated ones', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('')
    expect(safeUrl('vbscript:msgbox(1)')).toBe('')
    // Browsers ignore control characters, so these must be normalised before the check.
    expect(safeUrl('java\tscript:alert(1)')).toBe('')
    expect(safeUrl('  javascript:alert(1)')).toBe('')
  })

  it('accepts the schemes the app links to', () => {
    expect(safeUrl('https://example.test')).toBe('https://example.test')
    expect(safeUrl('/relative/path')).toBe('/relative/path')
    expect(safeUrl('#anchor')).toBe('#anchor')
  })

  it('rejects non-string and empty input', () => {
    expect(safeUrl(null)).toBe('')
    expect(safeUrl('   ')).toBe('')
  })
})
