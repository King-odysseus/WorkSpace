// Zuri answers in markdown, and the transcript used to print the markers as
// typed - a reply arrived as "**Design UI**" and "- item" rather than bold text
// and a list.
//
// This renders the subset the model actually writes: headings, ordered and
// unordered lists, bold, italic, inline code, links and rules. Everything is
// escaped on the way in, so the only markup that can reach the page is markup
// this file wrote; the caller still runs the result through the app's own
// sanitiser, which is what validates the hrefs it produces.
//
// Deliberately not a markdown implementation: no tables, no blockquotes, no
// nesting, no raw HTML passthrough. Anything the model writes that is not one of
// the shapes below comes out as the text it is.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ESCAPES[character])

// Inline spans, applied to text that has already been escaped.
function renderInline(text) {
  // Code first: backticked content is literal, so nothing else may rewrite it.
  // It is parked behind a placeholder and restored once the other spans are done.
  const codeSpans = []
  let output = escapeHtml(text).replace(/`([^`\n]+)`/g, (_, code) => {
    codeSpans.push(code)
    return `\u0000${codeSpans.length - 1}\u0000`
  })

  output = output
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    // The leading group keeps a lone asterisk or underscore - a bullet marker,
    // a multiplication sign - from being read as the start of an emphasis span.
    .replace(/(^|[\s([{"'])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s([{"'])_([^_\n]+)_/g, '$1<em>$2</em>')

  return output.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codeSpans[Number(index)]}</code>`)
}

function matchesHeading(line) {
  return line.match(/^(#{1,6})\s+(.*)$/)
}

function listItemOf(line) {
  const bullet = line.match(/^[-*•]\s+(.*)$/)
  if (bullet) return { ordered: false, content: bullet[1] }
  const numbered = line.match(/^\d+[.)]\s+(.*)$/)
  if (numbered) return { ordered: true, content: numbered[1] }
  return null
}

/**
 * Render assistant prose as HTML. Returns an empty string for empty input.
 * The result is a single string with no whitespace between its tags, so a
 * caller that keeps `white-space: pre-wrap` on the surrounding element does not
 * pick up stray blank lines.
 */
export function renderAssistantMarkdown(value) {
  const text = typeof value === 'string' ? value : ''
  if (!text.trim()) return ''

  const blocks = []
  let paragraph = []
  let list = null

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    const tag = list.ordered ? 'ol' : 'ul'
    blocks.push(`<${tag}>${list.items.map(item => `<li>${item}</li>`).join('')}</${tag}>`)
    list = null
  }

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = matchesHeading(line)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph()
      flushList()
      blocks.push('<hr>')
      continue
    }

    const item = listItemOf(line)
    if (item) {
      flushParagraph()
      if (!list || list.ordered !== item.ordered) {
        flushList()
        list = { ordered: item.ordered, items: [] }
      }
      list.items.push(renderInline(item.content))
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  return blocks.join('')
}
