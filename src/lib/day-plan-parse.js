// Zuri writes a day plan as plain lines such as
//   09:00-10:30 Finalise service offers (1h 30m) - most important, it blocks quoting
// The plan is stored as that text; this reads it into blocks for the sticky-note
// board and the list. Anything that is not a timed line (a summary, what to move
// to another day) is kept as intro and outro text, never dropped.
const LINE = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s+(.+)$/
const DURATION = /\s*\(((?:\d+\s*h(?:ours?)?)?\s*(?:\d+\s*m(?:in(?:ute)?s?)?)?)\)\s*$/i

const pad = time => time.replace(/^(\d):/, '0$1:')

export function parsePlan(text) {
  const blocks = []
  const intro = []
  const outro = []
  String(text || '').split('\n').forEach(raw => {
    const line = raw.trim()
    if (!line) return
    const match = line.match(LINE)
    if (!match) {
      ;(blocks.length ? outro : intro).push(line)
      return
    }
    const [, start, end, rest] = match
    const [first, ...others] = rest.split(/\s+[-–—]\s+/)
    const durationMatch = first.match(DURATION)
    const duration = durationMatch && durationMatch[1].trim() ? durationMatch[1].trim() : ''
    const title = (durationMatch ? first.slice(0, durationMatch.index) : first).trim()
    blocks.push({
      key: pad(start),
      start: pad(start),
      end: pad(end),
      title,
      duration,
      detail: others.join(' - ').trim(),
      kind: /\b(break|lunch)\b/i.test(title) ? 'break' : 'work',
    })
  })
  return { blocks, intro, outro }
}
