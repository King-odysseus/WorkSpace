// The app's rich-text sanitizer.
//
// It lives here rather than beside the editor it serves for one reason that
// matters: DOMPurify does not behave correctly under happy-dom, which is what
// the component tests run in - it reports isSupported true and then leaves
// <script> intact and strips legitimate elements. A module with no React in it
// can be bundled on its own and run in a real browser, which is the only place
// this code ever runs, and that is where its cases are checked
// (scripts/sanitize/cases.test.mjs).

import DOMPurify from 'dompurify'

// Schemes a link or image may use. Anything else - javascript:, vbscript:,
// data: with a non-image type - can run script when a reader clicks it.
const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|\/|#|\.\/|\.\.\/)/i
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i

export function safeUrl(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  // Browsers ignore control characters, so "java\tscript:alert(1)" still runs.
  const [head, ...rest] = trimmed.split('/')
  const candidate = [head.replace(/[\x00-\x20]/g, ''), ...rest].join('/')
  return SAFE_DATA_IMAGE.test(candidate) || SAFE_URL.test(candidate) ? candidate : ''
}

// DOMPurify does the tag/attribute filtering (including the mutation-XSS cases a
// hand-written pass tends to miss). The hook keeps this app's own two rules on
// top of it: URLs must satisfy safeUrl, and links never get to reach back into
// the opening page.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  for (const attribute of ['href', 'src']) {
    if (!node.hasAttribute(attribute)) continue
    const url = safeUrl(node.getAttribute(attribute))
    if (url) node.setAttribute(attribute, url)
    else node.removeAttribute(attribute)
  }
  if (node.tagName === 'A' && node.hasAttribute('href')) node.setAttribute('rel', 'noopener noreferrer')
})

export function cleanHtml(value) {
  if (typeof window === 'undefined') return value || ''
  // USE_PROFILES html keeps the editor's formatting markup while excluding the
  // SVG and MathML grammars the previous implementation stripped by hand.
  return DOMPurify.sanitize(value || '', { USE_PROFILES: { html: true } })
}
