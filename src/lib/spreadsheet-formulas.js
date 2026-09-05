/**
 * Formula evaluation for the workspace spreadsheet.
 *
 * Hand written rather than pulled from a library on purpose: the obvious
 * candidate (HyperFormula) is GPL, and this app ships closed source. The
 * grammar below covers what a team ops spreadsheet actually needs - cell
 * references, arithmetic, ranges and the common aggregate functions - and
 * stops there.
 */

const ERROR_VALUE = '#ERROR!'
const ERROR_NAME = '#NAME?'
const ERROR_REF = '#REF!'
const ERROR_DIV_ZERO = '#DIV/0!'
const ERROR_CYCLE = '#CYCLE!'

export const FORMULA_ERRORS = [ERROR_VALUE, ERROR_NAME, ERROR_REF, ERROR_DIV_ZERO, ERROR_CYCLE]

class FormulaError extends Error {
  constructor(value) { super(value); this.value = value }
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLabel(index) {
  let label = ''
  for (let value = index; value >= 0; value = Math.floor(value / 26) - 1) {
    label = String.fromCharCode(65 + (value % 26)) + label
  }
  return label
}

/** "A" -> 0, "AA" -> 26. Returns -1 for anything that is not a column. */
export function columnIndex(label) {
  if (!/^[A-Za-z]+$/.test(label || '')) return -1
  return [...label.toUpperCase()].reduce((total, character) => total * 26 + (character.charCodeAt(0) - 64), 0) - 1
}

const TOKEN_PATTERN = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|"((?:[^"]|"")*)"|([A-Za-z_][A-Za-z0-9_.]*)|(<>|<=|>=|[-+*/^(),:<>=%]))/y

function tokenize(source) {
  const tokens = []
  TOKEN_PATTERN.lastIndex = 0
  while (TOKEN_PATTERN.lastIndex < source.length) {
    const start = TOKEN_PATTERN.lastIndex
    const match = TOKEN_PATTERN.exec(source)
    if (!match || match.index !== start) {
      // Trailing whitespace is fine; anything else is a character we cannot read.
      if (!source.slice(start).trim()) break
      throw new FormulaError(ERROR_VALUE)
    }
    const [, number, text, word, operator] = match
    if (number !== undefined) tokens.push({ type: 'number', value: Number(number) })
    else if (text !== undefined) tokens.push({ type: 'text', value: text.replaceAll('""', '"') })
    else if (word !== undefined) tokens.push({ type: 'word', value: word })
    else tokens.push({ type: 'operator', value: operator })
  }
  return tokens
}

/** Splits "AB12" into its column and row, or returns null when it is a name. */
function parseReference(word) {
  const match = /^([A-Za-z]+)(\d+)$/.exec(word)
  if (!match) return null
  const column = columnIndex(match[1])
  const row = Number(match[2]) - 1
  return column < 0 || row < 0 ? null : { row, column }
}

function toNumber(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(String(value).trim())
  if (!Number.isFinite(parsed)) throw new FormulaError(ERROR_VALUE)
  return parsed
}

/** Range arguments arrive as arrays; everything else counts as a single value. */
function flatten(values) {
  return values.flatMap(value => Array.isArray(value) ? value : [value])
}

function numbersIn(values) {
  return flatten(values)
    .filter(value => value !== '' && value !== null && value !== undefined && typeof value !== 'boolean')
    .map(value => Number(value))
    .filter(Number.isFinite)
}

const FUNCTIONS = {
  SUM: values => numbersIn(values).reduce((total, number) => total + number, 0),
  AVERAGE: values => {
    const numbers = numbersIn(values)
    if (!numbers.length) throw new FormulaError(ERROR_DIV_ZERO)
    return numbers.reduce((total, number) => total + number, 0) / numbers.length
  },
  MIN: values => { const numbers = numbersIn(values); return numbers.length ? Math.min(...numbers) : 0 },
  MAX: values => { const numbers = numbersIn(values); return numbers.length ? Math.max(...numbers) : 0 },
  COUNT: values => numbersIn(values).length,
  COUNTA: values => flatten(values).filter(value => value !== '' && value !== null && value !== undefined).length,
  ABS: values => Math.abs(toNumber(values[0])),
  ROUND: values => {
    const digits = values.length > 1 ? toNumber(values[1]) : 0
    const factor = 10 ** digits
    return Math.round(toNumber(values[0]) * factor) / factor
  },
  IF: values => (values[0] === true || (values[0] !== false && toNumber(values[0]) !== 0)) ? (values[1] ?? true) : (values[2] ?? false),
  CONCAT: values => flatten(values).map(value => value === null || value === undefined ? '' : String(value)).join(''),
  LEN: values => String(values[0] ?? '').length,
  UPPER: values => String(values[0] ?? '').toUpperCase(),
  LOWER: values => String(values[0] ?? '').toLowerCase(),
  TRUE: () => true,
  FALSE: () => false,
}

function parse(tokens, resolve) {
  let position = 0
  const peek = () => tokens[position]
  const eat = value => {
    const token = tokens[position]
    if (!token || token.type !== 'operator' || token.value !== value) return false
    position += 1
    return true
  }
  const expect = value => { if (!eat(value)) throw new FormulaError(ERROR_VALUE) }

  // A range is only meaningful directly inside a function call, so it is read
  // there rather than being a value the rest of the grammar can produce.
  const readRange = first => {
    const second = peek()
    if (!second || second.type !== 'word') throw new FormulaError(ERROR_VALUE)
    position += 1
    const end = parseReference(second.value)
    if (!end) throw new FormulaError(ERROR_REF)
    const values = []
    for (let row = Math.min(first.row, end.row); row <= Math.max(first.row, end.row); row += 1) {
      for (let column = Math.min(first.column, end.column); column <= Math.max(first.column, end.column); column += 1) {
        values.push(resolve(row, column))
      }
    }
    return values
  }

  const readArguments = () => {
    const values = []
    expect('(')
    if (eat(')')) return values
    do {
      const token = peek()
      const reference = token && token.type === 'word' ? parseReference(token.value) : null
      if (reference && tokens[position + 1]?.value === ':') {
        position += 2
        values.push(readRange(reference))
      } else {
        values.push(expression())
      }
    } while (eat(','))
    expect(')')
    return values
  }

  const primary = () => {
    const token = peek()
    if (!token) throw new FormulaError(ERROR_VALUE)
    if (token.type === 'number' || token.type === 'text') { position += 1; return token.value }
    if (token.type === 'word') {
      position += 1
      const upper = token.value.toUpperCase()
      if (tokens[position]?.value === '(') {
        const handler = FUNCTIONS[upper]
        if (!handler) throw new FormulaError(ERROR_NAME)
        return handler(readArguments())
      }
      if (upper === 'TRUE' || upper === 'FALSE') return upper === 'TRUE'
      const reference = parseReference(token.value)
      if (!reference) throw new FormulaError(ERROR_NAME)
      return resolve(reference.row, reference.column)
    }
    if (eat('(')) { const value = expression(); expect(')'); return value }
    if (eat('-')) return -toNumber(primary())
    if (eat('+')) return toNumber(primary())
    throw new FormulaError(ERROR_VALUE)
  }

  const power = () => {
    const base = primary()
    return eat('^') ? toNumber(base) ** toNumber(power()) : base
  }

  const multiplicative = () => {
    let left = power()
    for (;;) {
      if (eat('*')) left = toNumber(left) * toNumber(power())
      else if (eat('/')) {
        const divisor = toNumber(power())
        if (divisor === 0) throw new FormulaError(ERROR_DIV_ZERO)
        left = toNumber(left) / divisor
      } else return left
    }
  }

  const additive = () => {
    let left = multiplicative()
    for (;;) {
      if (eat('+')) left = toNumber(left) + toNumber(multiplicative())
      else if (eat('-')) left = toNumber(left) - toNumber(multiplicative())
      else return left
    }
  }

  const compare = (left, right, operator) => {
    const comparable = typeof left === 'string' || typeof right === 'string' ? [String(left), String(right)] : [toNumber(left), toNumber(right)]
    const [a, b] = comparable
    if (operator === '=') return a === b
    if (operator === '<>') return a !== b
    if (operator === '<') return a < b
    if (operator === '>') return a > b
    if (operator === '<=') return a <= b
    return a >= b
  }

  const expression = () => {
    let left = additive()
    for (;;) {
      const token = peek()
      if (!token || token.type !== 'operator' || !['=', '<>', '<', '>', '<=', '>='].includes(token.value)) return left
      position += 1
      left = compare(left, additive(), token.value)
    }
  }

  const value = expression()
  if (position !== tokens.length) throw new FormulaError(ERROR_VALUE)
  return value
}

function formatValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value !== 'number') return String(value)
  if (!Number.isFinite(value)) return ERROR_VALUE
  // Trim the float noise 0.1 + 0.2 style arithmetic leaves behind.
  return String(Math.round(value * 1e10) / 1e10)
}

/**
 * Evaluates every formula in a sheet and returns a grid of display strings.
 *
 * Results are memoised per cell as they are resolved, so a column of formulas
 * that each reference the one above costs a single pass rather than one pass
 * per cell. Cells currently being resolved are tracked so a reference cycle
 * reports #CYCLE! instead of overflowing the stack.
 */
export function evaluateSheet(rows) {
  const grid = Array.isArray(rows) ? rows : []
  const cache = new Map()
  const visiting = new Set()

  const resolve = (row, column) => {
    if (row < 0 || column < 0 || row >= grid.length) return ''
    const key = `${row}:${column}`
    if (cache.has(key)) return cache.get(key)
    if (visiting.has(key)) throw new FormulaError(ERROR_CYCLE)
    const raw = grid[row]?.[column]
    if (typeof raw !== 'string' || !raw.startsWith('=')) {
      const literal = raw === null || raw === undefined || raw === '' ? '' : (Number.isFinite(Number(raw)) && String(raw).trim() !== '' ? Number(raw) : raw)
      cache.set(key, literal)
      return literal
    }
    visiting.add(key)
    let value
    try {
      value = parse(tokenize(raw.slice(1)), resolve)
    } catch (error) {
      value = error instanceof FormulaError ? error.value : ERROR_VALUE
    } finally {
      visiting.delete(key)
    }
    cache.set(key, value)
    return value
  }

  return grid.map((row, rowIndex) => row.map((cell, columnIndex) => {
    if (typeof cell !== 'string' || !cell.startsWith('=')) return cell === null || cell === undefined ? '' : String(cell)
    return formatValue(resolve(rowIndex, columnIndex))
  }))
}
