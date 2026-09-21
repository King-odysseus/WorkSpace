const ABBREVIATIONS = new Set([
  'a.m.',
  'approx.',
  'co.',
  'dept.',
  'dr.',
  'e.g.',
  'etc.',
  'fig.',
  'i.e.',
  'inc.',
  'jr.',
  'ltd.',
  'max.',
  'min.',
  'mr.',
  'mrs.',
  'ms.',
  'no.',
  'p.m.',
  'prof.',
  'sr.',
  'st.',
  'u.k.',
  'u.s.',
  'u.s.a.',
  'vs.',
])
const SENTENCE_ENDING_ABBREVIATIONS = new Set(['a.m.', 'etc.', 'p.m.'])

function isAbbreviation(sentence) {
  const token = sentence.match(/[A-Za-z]+(?:\.[A-Za-z]+)*\.$|[A-Z]\.$/)?.[0]?.toLowerCase()
  if (token && SENTENCE_ENDING_ABBREVIATIONS.has(token)) return false
  return token ? ABBREVIATIONS.has(token) || /^[a-z]\.$/.test(token) : false
}

/**
 * Insert line breaks between complete sentences while preserving explicit
 * line breaks. This is intentionally conservative: labels, user content,
 * and strings without multiple sentences are returned unchanged.
 */
export function formatSentenceBreaks(value) {
  if (typeof value !== 'string' || !value) return value

  return value
    .split(/\r?\n/)
    .map((line) => {
      let output = ''
      let start = 0
      let index = 0

      while (index < line.length) {
        const character = line[index]
        if (!['.', '!', '?'].includes(character)) {
          index += 1
          continue
        }

        let end = index + 1
        while (end < line.length && /["')\]]/.test(line[end])) end += 1

        if (end >= line.length || !/\s/.test(line[end])) {
          index = end
          continue
        }

        let next = end
        while (next < line.length && /\s/.test(line[next])) next += 1
        if (next >= line.length || !/[A-Z0-9]/.test(line[next])) {
          index = end
          continue
        }

        const sentence = line.slice(start, end).trim()
        if (isAbbreviation(sentence)) {
          index = end
          continue
        }

        output += `${sentence}\n`
        start = next
        index = next - 1
      }

      return `${output}${line.slice(start).trim()}`
    })
    .join('\n')
    .trim()
}
