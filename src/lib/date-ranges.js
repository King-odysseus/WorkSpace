// Date presets for the kanban boards' date filter. Every range is worked out from
// "today" (a YYYY-MM-DD string) in the workspace's own calendar, with weeks running
// Monday to Sunday, the way the rest of the app reads them.
export const DATE_PRESETS = [
  ['any', 'Any date'],
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['this_week', 'This week'],
  ['next_week', 'Next week'],
  ['this_month', 'This month'],
  ['overdue', 'Overdue'],
  ['none', 'No due date'],
  ['custom', 'Pick dates...'],
]

const pad = value => String(value).padStart(2, '0')
const key = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const parse = iso => new Date(`${iso}T00:00:00`)
const shift = (iso, days) => { const date = parse(iso); date.setDate(date.getDate() + days); return key(date) }
const mondayOf = iso => shift(iso, -((parse(iso).getDay() + 6) % 7))

// What the filter means for one preset: a due-date range, or one of the special
// due filters the board already has (overdue, no due date).
export function rangeFor(preset, today) {
  switch (preset) {
    case 'today': return { from: today, to: today, due: 'all' }
    case 'tomorrow': return { from: shift(today, 1), to: shift(today, 1), due: 'all' }
    case 'this_week': { const start = mondayOf(today); return { from: start, to: shift(start, 6), due: 'all' } }
    case 'next_week': { const start = shift(mondayOf(today), 7); return { from: start, to: shift(start, 6), due: 'all' } }
    case 'this_month': {
      const first = parse(today)
      first.setDate(1)
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
      return { from: key(first), to: key(last), due: 'all' }
    }
    case 'overdue': return { from: '', to: '', due: 'overdue' }
    case 'none': return { from: '', to: '', due: 'none' }
    default: return { from: '', to: '', due: 'all' }
  }
}
