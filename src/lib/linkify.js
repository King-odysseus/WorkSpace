// Splits user-written text into plain, link, and mention segments so chat
// messages and comments can render URLs as real links without ever treating
// the text as HTML. Only http(s) and mailto hrefs are produced.

const TOKEN_PATTERN = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}|(?<![A-Za-z0-9_.@-])@[A-Za-z0-9_.-]+)/g

// Punctuation that usually ends a sentence rather than a URL.
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/

function trimUrl(candidate) {
  let url = candidate.replace(TRAILING_PUNCTUATION, '')
  // Keep a closing parenthesis only when the URL opened one, so
  // "(see https://x.com/a)" drops it but wiki-style "/Foo_(bar)" keeps it.
  while (url.endsWith(')') && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
    url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, '')
  }
  return url
}

export function tokenizeText(text) {
  const source = String(text || '')
  const segments = []
  let cursor = 0
  const pushText = value => {
    if (!value) return
    const last = segments[segments.length - 1]
    if (last && last.type === 'text') last.value += value
    else segments.push({ type: 'text', value })
  }
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const raw = match[0]
    pushText(source.slice(cursor, match.index))
    cursor = match.index + raw.length
    if (raw.startsWith('@')) {
      segments.push({ type: 'mention', value: raw })
      continue
    }
    if (!/^(https?:\/\/|www\.)/i.test(raw)) {
      segments.push({ type: 'link', value: raw, href: `mailto:${raw}` })
      continue
    }
    const url = trimUrl(raw)
    // A bare "https://" or "www." with nothing after it is not a link.
    if (!/^(https?:\/\/|www\.)[^./]/i.test(url)) {
      pushText(raw)
      continue
    }
    segments.push({ type: 'link', value: url, href: /^www\./i.test(url) ? `https://${url}` : url })
    pushText(raw.slice(url.length))
  }
  pushText(source.slice(cursor))
  return segments
}
