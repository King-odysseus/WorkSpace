/*
 * Where an address lives: on this machine's side of the wire, or out in the
 * cloud.
 *
 * This module exists for one caller, the egress guard, and the guard has a job
 * it cannot do approximately: a business marked "local only" must never have its
 * content sent to a public host. Every routing decision therefore reduces to
 * "is this endpoint local", and the answer has to be exact in both directions.
 * Too generous and a local-only business leaks; too strict and a person cannot
 * reach their own Ollama at 127.0.0.1, which is the one case the feature exists
 * for.
 *
 * Three rules follow from that, and each is a place this could otherwise go
 * wrong.
 *
 * 1. Only the plan's ranges count as local. Loopback, RFC1918, and link-local
 *    for IPv4; loopback, fc00::/7 and fe80::/10 for IPv6. Nothing is added "to
 *    be safe": 0.0.0.0, 100.64.0.0/10, multicast and the IPv6 unspecified
 *    address are all cloud here, because a guard that quietly widened its own
 *    local set would be deciding policy the plan already decided.
 *
 * 2. Anything that is not a valid address is `invalid`, not `cloud`. The guard
 *    treats those differently: an invalid value means the caller handed over
 *    something that is not an address at all, which is a bug to surface, while
 *    `cloud` is a policy answer. Collapsing the two would turn a typo into a
 *    silent block. A value is never trimmed into validity either, because the
 *    guard has to classify what the app will actually dial, not a tidied-up
 *    version of it.
 *
 * 3. The awkward-but-legal IPv6 spellings are handled deliberately, because
 *    they are the exact shapes an attacker would use to slip past a naive
 *    check: a zone index (`fe80::1%eth0` names a local interface and is still
 *    link-local), an IPv4-mapped address (`::ffff:192.168.1.1` is the IPv4
 *    address it embeds, so it is classified by that IPv4 address and not by its
 *    IPv6 prefix), and the compressed, upper-case and full forms, which are all
 *    the same 128 bits.
 *
 * Everything here is pure and total: no network, no clock, no state, and no
 * input makes it throw. It is called on the main thread while a person types a
 * base URL, so a parser that could raise would turn a display problem into a
 * failed request. Text is parsed with plain arithmetic rather than `node:net`,
 * which keeps the module bundlable into the main process without a platform
 * dependency and makes every acceptance rule visible in one file.
 */

const MAX_ADDRESS_LENGTH = 128
const MAX_HOST_LENGTH = 255

export type AddressClass = 'local' | 'cloud' | 'invalid'

/** An IPv6 address as its eight 16-bit groups, most significant first. */
type Ipv6Groups = readonly number[]

/* ------------------------------------------------------------------ *
 * Character helpers
 * ------------------------------------------------------------------ */

function decimalDigit(char: string): number {
  const code = char.charCodeAt(0)
  return code >= 48 && code <= 57 ? code - 48 : -1
}

function hexDigit(char: string): number {
  const code = char.charCodeAt(0)
  if (code >= 48 && code <= 57) return code - 48
  if (code >= 97 && code <= 102) return code - 87
  if (code >= 65 && code <= 70) return code - 55
  return -1
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/**
 * Four decimal octets, or null.
 *
 * A leading zero is refused rather than read as decimal. `010.0.0.1` is octal in
 * some resolvers and decimal in others, and a guard must not classify an
 * ambiguous spelling as local on the strength of one reading.
 */
function parseIpv4(text: string): [number, number, number, number] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null

  const octets: [number, number, number, number] = [0, 0, 0, 0]
  for (let index = 0; index < 4; index += 1) {
    const part = parts[index]
    if (part === undefined) return null
    if (part.length === 0 || part.length > 3) return null
    if (part.length > 1 && part.startsWith('0')) return null

    let value = 0
    for (const char of part) {
      const digit = decimalDigit(char)
      if (digit < 0) return null
      value = value * 10 + digit
    }
    if (value > 255) return null
    octets[index] = value
  }
  return octets
}

/** One group of up to four hex digits. */
function parseHextet(text: string): number | null {
  if (text.length === 0 || text.length > 4) return null

  let value = 0
  for (const char of text) {
    const digit = hexDigit(char)
    if (digit < 0) return null
    value = value * 16 + digit
  }
  return value
}

function parseHextets(parts: readonly string[]): number[] | null {
  const values: number[] = []
  for (const part of parts) {
    const value = parseHextet(part)
    if (value === null) return null
    values.push(value)
  }
  return values
}

/**
 * An IPv6 address in any of its legal textual forms, or null.
 *
 * The zone index is dropped before parsing: it names an interface on this
 * machine, not part of the number, so `fe80::1%eth0` and `fe80::1` are the same
 * address and must classify the same way.
 */
function parseIpv6(address: string): Ipv6Groups | null {
  const zoneAt = address.indexOf('%')
  let body = zoneAt < 0 ? address : address.slice(0, zoneAt)
  if (body.length === 0) return null

  if (body.includes('.')) {
    // A dotted tail is written as two hextets so everything after this is the
    // plain eight-group case. Which IPv4 address it spells is decided later, from
    // the groups, not from having seen a dot: the dot only says how it was typed.
    const lastColon = body.lastIndexOf(':')
    if (lastColon < 0) return null

    const octets = parseIpv4(body.slice(lastColon + 1))
    if (octets === null) return null

    const high = (octets[0] * 256 + octets[1]).toString(16)
    const low = (octets[2] * 256 + octets[3]).toString(16)
    body = `${body.slice(0, lastColon + 1)}${high}:${low}`
  }

  const halves = body.split('::')
  if (halves.length > 2) return null

  const headText = halves[0] ?? ''
  const tailText = halves.length === 2 ? halves[1] ?? '' : null

  const headValues = parseHextets(headText === '' ? [] : headText.split(':'))
  if (headValues === null) return null
  const tailValues = parseHextets(tailText === null || tailText === '' ? [] : tailText.split(':'))
  if (tailValues === null) return null

  const explicit = headValues.length + tailValues.length
  if (halves.length === 2) {
    // `::` stands for at least one zero group, so it cannot stand for none and
    // two runs of zeros is not an address.
    if (explicit > 7) return null
    const zeros = new Array<number>(8 - explicit).fill(0)
    return [...headValues, ...zeros, ...tailValues]
  }

  if (explicit !== 8) return null
  return [...headValues, ...tailValues]
}

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

function isLocalIpv4(octets: readonly [number, number, number, number]): boolean {
  const [first, second] = octets
  if (first === 127) return true // 127.0.0.0/8 loopback
  if (first === 10) return true // 10.0.0.0/8 private
  if (first === 172 && second >= 16 && second <= 31) return true // 172.16.0.0/12 private
  if (first === 192 && second === 168) return true // 192.168.0.0/16 private
  if (first === 169 && second === 254) return true // 169.254.0.0/16 link-local
  return false
}

/** The 0:0:0:0:0:ffff:a.b.c.d form, which is how IPv6 spells an IPv4 address. */
function isIpv4Mapped(groups: Ipv6Groups): boolean {
  return groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
}

function isLocalIpv6(groups: Ipv6Groups): boolean {
  /*
   * Only the ::ffff:0:0/96 form is judged by the IPv4 address it carries.
   *
   * Judging any address by a dotted tail was wrong in a way that mattered:
   * 2001:4860::127.0.0.1 is a public address that merely ends in those bits, and
   * reading it as loopback would let a cloud host pass a local-only check. The
   * other direction was wrong too - ::ffff:c0a8:0101 spells the same address as
   * ::ffff:192.168.1.1 and has to classify the same way, so the answer is taken
   * from the groups rather than from how the text was typed.
   */
  if (isIpv4Mapped(groups)) {
    const high = groups[6] ?? 0
    const low = groups[7] ?? 0
    return isLocalIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff])
  }

  const first = groups[0]
  if (first === undefined) return false

  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local

  // ::1 and nothing else. The unspecified address :: is deliberately not local.
  return groups.every((group, index) => (index === 7 ? group === 1 : group === 0))
}

/**
 * Local, cloud, or not an address at all.
 *
 * `invalid` is kept separate from `cloud` on purpose: the guard reports the two
 * differently, and a typo in a base URL is not a policy decision.
 */
export function classifyIpAddress(address: unknown): AddressClass {
  if (typeof address !== 'string') return 'invalid'
  if (address.length === 0 || address.length > MAX_ADDRESS_LENGTH) return 'invalid'
  // Padding is refused instead of trimmed: the guard must classify the bytes the
  // app will actually dial, and no resolver accepts a padded address either.
  if (address !== address.trim()) return 'invalid'

  const octets = parseIpv4(address)
  if (octets !== null) return isLocalIpv4(octets) ? 'local' : 'cloud'

  const groups = parseIpv6(address)
  if (groups === null) return 'invalid'

  return isLocalIpv6(groups) ? 'local' : 'cloud'
}

/* ------------------------------------------------------------------ *
 * Hosts
 * ------------------------------------------------------------------ */

/** Characters that mean the value is a URL or a header, not a bare host. */
const FORBIDDEN_HOST_CHARS: ReadonlySet<string> = new Set(['/', '\\', '@', '?', '#', ';', '"', "'"])

/**
 * A host in the one spelling the rest of the app compares against, or null.
 *
 * Lower-cased because DNS is case-insensitive and two spellings of one host must
 * not look like two hosts to the guard. The trailing dot is stripped because
 * `example.com.` is the same name as `example.com`, and the brackets are removed
 * because they are URL syntax around an IPv6 literal, not part of it.
 *
 * A value carrying a path, credentials, a query, a fragment, or surrounding
 * whitespace is refused rather than repaired: those are all signs that something
 * other than a host was passed, and guessing which part was meant is how a
 * guard ends up inspecting a different host from the one that gets dialled.
 */
export function normalizeHost(host: unknown): string | null {
  if (typeof host !== 'string') return null

  let text = host.trim()
  if (text.length === 0 || text.length > MAX_HOST_LENGTH) return null

  if (text.startsWith('[') || text.endsWith(']')) {
    if (!text.startsWith('[') || !text.endsWith(']') || text.length < 3) return null
    text = text.slice(1, -1)
  }

  if (text.endsWith('.')) text = text.slice(0, -1)
  if (text.length === 0) return null

  const lower = text.toLowerCase()
  for (const char of lower) {
    if (FORBIDDEN_HOST_CHARS.has(char)) return null
    // Any C0 control or DEL, which includes tabs, newlines and the space that
    // would otherwise smuggle a second value past a caller that splits on them.
    const code = char.charCodeAt(0)
    if (code <= 0x20 || code === 0x7f) return null
  }
  return lower
}

/**
 * Whether a host is an IP literal rather than a name.
 *
 * The answer is the parser's, not a shape test: a name has to be resolved before
 * anyone can say where it points, while a literal can be classified right here.
 * A zone index is accepted because it is still a literal addressing a local
 * interface.
 */
export function isIpLiteral(host: string): boolean {
  const normalized = normalizeHost(host)
  if (normalized === null) return false
  return classifyIpAddress(normalized) !== 'invalid'
}

/* ------------------------------------------------------------------ *
 * Authority strings
 * ------------------------------------------------------------------ */

function parsePort(digits: string): number | null {
  if (digits.length === 0 || digits.length > 5) return null

  let value = 0
  for (const char of digits) {
    const digit = decimalDigit(char)
    if (digit < 0) return null
    value = value * 10 + digit
  }
  // Port 0 is not a destination anyone can be sent to, and 65536 and above
  // cannot be written in a socket address at all.
  if (value < 1 || value > 65535) return null
  return value
}

/**
 * The host and port out of a URL authority, or null.
 *
 * Brackets are the only way to tell an IPv6 literal's last group from a port, so
 * an unbracketed address with more than one colon is read as a host with no
 * port instead of being split at the wrong colon. A port that is not all digits
 * or is out of range fails the whole parse: it means the authority is malformed,
 * and a guard that silently dropped it would be checking a different endpoint
 * from the one the app connects to.
 */
export function splitHostAndPort(authority: unknown): { host: string; port: number | null } | null {
  if (typeof authority !== 'string') return null

  const text = authority.trim()
  if (text.length === 0) return null

  if (text.startsWith('[')) {
    const close = text.indexOf(']')
    if (close < 0) return null

    const host = normalizeHost(text.slice(1, close))
    if (host === null) return null

    const rest = text.slice(close + 1)
    if (rest.length === 0) return { host, port: null }
    if (!rest.startsWith(':')) return null

    const port = parsePort(rest.slice(1))
    return port === null ? null : { host, port }
  }

  const colonAt = text.indexOf(':')
  if (colonAt < 0) {
    const host = normalizeHost(text)
    return host === null ? null : { host, port: null }
  }

  if (text.indexOf(':', colonAt + 1) >= 0) {
    // More than one colon can only be an unbracketed IPv6 literal, which has no
    // port. Anything else with two colons is a malformed authority, and
    // returning it as a host would let a caller dial a different endpoint from
    // the one the guard checked.
    const host = normalizeHost(text)
    if (host === null) return null
    return isIpLiteral(host) ? { host, port: null } : null
  }

  const host = normalizeHost(text.slice(0, colonAt))
  if (host === null) return null

  const port = parsePort(text.slice(colonAt + 1))
  return port === null ? null : { host, port }
}
