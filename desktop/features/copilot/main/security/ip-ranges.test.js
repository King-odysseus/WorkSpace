'use strict'

/*
 * The local/cloud classification, tested through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven here is the
 * CommonJS the main process runs.
 *
 * The egress guard refuses a cloud call for a local-only business, so a wrong
 * answer in either direction is a real failure: a public address read as local
 * lets content leave the machine, and a private address read as cloud blocks a
 * person from their own model server. The tests therefore pin the edges of every
 * range the plan names, not just a sample inside each one, and they pin the
 * spellings an attacker would reach for: IPv4-mapped IPv6, zone indices, and
 * addresses padded with whitespace.
 *
 * The last test is the module's contract: no input makes it throw. It runs on
 * the main thread while a person types, so a parser that could raise would turn
 * a display problem into a failed request.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/** Assert one address classifies as expected, naming the input on failure. */
function expectClass (input, expected) {
  assert.equal(api.classifyIpAddress(input), expected, `classifyIpAddress(${JSON.stringify(input)})`)
}

/* ------------------------------------------------------------------ *
 * IPv4 boundaries
 * ------------------------------------------------------------------ */

test('IPv4 loopback and private ranges are local at both ends', () => {
  for (const address of [
    '127.0.0.0',
    '127.0.0.1',
    '127.255.255.255',
    '10.0.0.0',
    '10.255.255.255',
    '172.16.0.0',
    '172.31.255.255',
    '192.168.0.0',
    '192.168.255.255',
    '169.254.0.1',
    '169.254.1.1',
    '169.254.255.255'
  ]) {
    expectClass(address, 'local')
  }
})

test('IPv4 addresses just outside every local range are cloud', () => {
  // Each entry is one step past the end of a range the plan names, plus the
  // ranges that look local and are not: 172.32 leaves the /12, 100.64 is
  // carrier NAT, 0.0.0.0 is unspecified, and multicast is not a destination.
  for (const address of [
    '172.15.255.255',
    '172.32.0.0',
    '172.32.255.255',
    '11.0.0.1',
    '9.255.255.255',
    '126.0.0.1',
    '128.0.0.1',
    '192.167.255.255',
    '192.169.0.0',
    '169.253.255.255',
    '169.255.0.0',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1'
  ]) {
    expectClass(address, 'cloud')
  }
})

test('public IPv4 addresses are cloud', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '203.0.113.9']) {
    expectClass(address, 'cloud')
  }
})

/* ------------------------------------------------------------------ *
 * IPv6
 * ------------------------------------------------------------------ */

test('IPv6 loopback, unique local and link-local addresses are local', () => {
  for (const address of [
    '::1',
    'fc00::1',
    'fc00::',
    'fd12:3456:789a::1',
    'fdff:ffff::1',
    'fe80::1',
    'fe80::',
    'febf:ffff::1'
  ]) {
    expectClass(address, 'local')
  }
})

test('IPv6 has several legal spellings and they all classify the same', () => {
  // Compressed, upper case, full form, and a link-local address carrying the
  // zone index for an interface on this machine.
  expectClass('::1', 'local')
  expectClass('0:0:0:0:0:0:0:1', 'local')
  expectClass('FE80::1', 'local')
  expectClass('fe80:0000:0000:0000:0000:0000:0000:0001', 'local')
  expectClass('fe80::1%eth0', 'local')
  expectClass('fe80::1%lo0', 'local')

  expectClass('2001:4860:4860:0000:0000:0000:0000:8888', 'cloud')
  expectClass('2001:DB8::1', 'cloud')
})

test('an IPv4-mapped IPv6 address is classified by the IPv4 address it embeds', () => {
  // The prefix must not make a public host local, and must not make a private
  // host cloud: the bytes that travel are the embedded IPv4 address.
  expectClass('::ffff:192.168.1.1', 'local')
  expectClass('::ffff:127.0.0.1', 'local')
  expectClass('::ffff:10.0.0.1', 'local')
  expectClass('::ffff:8.8.8.8', 'cloud')
  expectClass('::ffff:172.32.0.1', 'cloud')
})

test('IPv6 addresses outside the local ranges are cloud, including unspecified', () => {
  for (const address of ['2001:4860:4860::8888', '::2', '::', '2a00:1450:4001::200e', 'ff02::1']) {
    expectClass(address, 'cloud')
  }
})

/* ------------------------------------------------------------------ *
 * Invalid input
 * ------------------------------------------------------------------ */

test('malformed addresses are invalid, not cloud', () => {
  // `invalid` and `cloud` mean different things to the guard: one is a caller
  // bug to surface, the other is a policy answer to enforce.
  for (const address of [
    '',
    ' ',
    '1.2.3',
    '1.2.3.4.5',
    '256.1.1.1',
    '1.2.3.256',
    '1.2.3.4/24',
    '1.2.3.4 ',
    ' 1.2.3.4',
    '+1.2.3.4',
    '-1.2.3.4',
    '1.2.3.-4',
    '1.2.3.4:443',
    'example.com',
    'localhost',
    '010.0.0.1',
    '::1::',
    '1::2::3',
    'fe80:::1',
    'gggg::1',
    '12345::1',
    '::1.2.3',
    '::1.2.3.4.5'
  ]) {
    expectClass(address, 'invalid')
  }
})

test('non-string input is invalid and never throws', () => {
  for (const value of [NaN, 0, 1, 127001, null, undefined, {}, [], ['10.0.0.1'], true, Symbol('x'), () => '10.0.0.1']) {
    assert.equal(api.classifyIpAddress(value), 'invalid')
  }
})

/* ------------------------------------------------------------------ *
 * normalizeHost
 * ------------------------------------------------------------------ */

test('normalizeHost lower-cases, trims, drops a trailing dot and unwraps brackets', () => {
  assert.equal(api.normalizeHost('Example.COM'), 'example.com')
  assert.equal(api.normalizeHost('  example.com  '), 'example.com')
  assert.equal(api.normalizeHost('example.com.'), 'example.com')
  assert.equal(api.normalizeHost('[::1]'), '::1')
  assert.equal(api.normalizeHost('[FE80::1%eth0]'), 'fe80::1%eth0')
  assert.equal(api.normalizeHost('localhost'), 'localhost')
  assert.equal(api.normalizeHost('127.0.0.1'), '127.0.0.1')
  assert.equal(api.normalizeHost('my-host.internal'), 'my-host.internal')
})

test('normalizeHost refuses anything that is not a bare host', () => {
  for (const value of [
    '',
    '   ',
    '.',
    'evil.com/path',
    'evil.com\\path',
    'user@evil.com',
    'evil.com?q=1',
    'evil.com#frag',
    'evil.com;rm -rf',
    'evil"com',
    "evil'com",
    'evil.com\nHost: other',
    'evil\tcom',
    'evil.com\u0000',
    '[::1',
    '::1]',
    '[]'
  ]) {
    assert.equal(api.normalizeHost(value), null, `normalizeHost(${JSON.stringify(value)})`)
  }

  for (const value of [null, undefined, 42, {}, [], true]) {
    assert.equal(api.normalizeHost(value), null)
  }
})

/* ------------------------------------------------------------------ *
 * isIpLiteral
 * ------------------------------------------------------------------ */

test('isIpLiteral separates literals from names', () => {
  assert.equal(api.isIpLiteral('127.0.0.1'), true)
  assert.equal(api.isIpLiteral('8.8.8.8'), true)
  assert.equal(api.isIpLiteral('::1'), true)
  assert.equal(api.isIpLiteral('[::1]'), true)
  assert.equal(api.isIpLiteral('fe80::1%eth0'), true)

  assert.equal(api.isIpLiteral('example.com'), false)
  assert.equal(api.isIpLiteral('localhost'), false)
  assert.equal(api.isIpLiteral('1.2.3'), false)
  assert.equal(api.isIpLiteral(''), false)
  assert.equal(api.isIpLiteral('evil.com/path'), false)
})

/* ------------------------------------------------------------------ *
 * splitHostAndPort
 * ------------------------------------------------------------------ */

test('splitHostAndPort reads every authority shape the app builds', () => {
  assert.deepEqual(api.splitHostAndPort('example.com:443'), { host: 'example.com', port: 443 })
  assert.deepEqual(api.splitHostAndPort('example.com'), { host: 'example.com', port: null })
  assert.deepEqual(api.splitHostAndPort('127.0.0.1:11434'), { host: '127.0.0.1', port: 11434 })
  assert.deepEqual(api.splitHostAndPort('127.0.0.1'), { host: '127.0.0.1', port: null })
  assert.deepEqual(api.splitHostAndPort('[::1]:11434'), { host: '::1', port: 11434 })
  assert.deepEqual(api.splitHostAndPort('[::1]'), { host: '::1', port: null })
  assert.deepEqual(api.splitHostAndPort('[fe80::1%eth0]:8080'), { host: 'fe80::1%eth0', port: 8080 })
  assert.deepEqual(api.splitHostAndPort('Example.COM.:443'), { host: 'example.com', port: 443 })
  assert.deepEqual(api.splitHostAndPort('localhost:8000'), { host: 'localhost', port: 8000 })
})

test('a bare IPv6 address with no brackets is a host with no port', () => {
  // There is no way to tell the last group from a port, so it is not split.
  assert.deepEqual(api.splitHostAndPort('::1'), { host: '::1', port: null })
  assert.deepEqual(api.splitHostAndPort('2001:db8::1'), { host: '2001:db8::1', port: null })
})

test('splitHostAndPort refuses a malformed authority', () => {
  for (const value of [
    '',
    '   ',
    'example.com:',
    'example.com:0',
    'example.com:65536',
    'example.com:99999',
    'example.com:12ab',
    'example.com:-1',
    'example.com:+443',
    'example.com:443:444',
    ':443',
    '[::1]:',
    '[::1]:70000',
    '[::1]443',
    '[::1',
    'evil.com/path:443',
    'user@example.com:443'
  ]) {
    assert.equal(api.splitHostAndPort(value), null, `splitHostAndPort(${JSON.stringify(value)})`)
  }

  for (const value of [null, undefined, 443, {}, []]) {
    assert.equal(api.splitHostAndPort(value), null)
  }
})

test('the port boundary is inclusive at 1 and 65535', () => {
  assert.deepEqual(api.splitHostAndPort('example.com:1'), { host: 'example.com', port: 1 })
  assert.deepEqual(api.splitHostAndPort('example.com:65535'), { host: 'example.com', port: 65535 })
  assert.equal(api.splitHostAndPort('example.com:65536'), null)
})

/* ------------------------------------------------------------------ *
 * Totality
 * ------------------------------------------------------------------ */

test('no function throws, whatever it is handed', () => {
  const odd = [
    undefined,
    null,
    0,
    NaN,
    Infinity,
    -1,
    true,
    {},
    [],
    { toString () { throw new Error('nope') } },
    [Symbol('x')],
    () => {},
    'a'.repeat(10_000),
    ':'.repeat(200),
    '%'.repeat(50),
    '::ffff:',
    '\u2028',
    '\uD800'
  ]

  for (const value of odd) {
    assert.doesNotThrow(() => api.classifyIpAddress(value))
    assert.doesNotThrow(() => api.normalizeHost(value))
    assert.doesNotThrow(() => api.splitHostAndPort(value))
  }

  for (const value of odd) {
    assert.equal(typeof api.isIpLiteral(value), 'boolean')
  }
})

test('only the mapped prefix may lend an address its IPv4 tail', () => {
  /*
   * The ::ffff:0:0/96 form is how IPv6 spells an IPv4 address, so the IPv4 tail
   * decides where it lives - in either spelling of the same 128 bits.
   */
  expectClass('::ffff:10.0.0.1', 'local')
  expectClass('::ffff:127.0.0.1', 'local')
  expectClass('::ffff:a00:1', 'local')
  expectClass('::ffff:8.8.8.8', 'cloud')
  expectClass('::ffff:808:808', 'cloud')

  /*
   * A public address whose tail merely looks like loopback is public. Judging it
   * by the tail is how a cloud host would pass a local-only check, which is the
   * one mistake this module cannot make.
   */
  expectClass('2001:4860::127.0.0.1', 'cloud')
  expectClass('2001:4860::7f00:1', 'cloud')

  // A link-local address is still local, and it is local by its own prefix rather
  // than by the shape of its tail.
  expectClass('fe80::127.0.0.1', 'local')
  expectClass('fe80::7f00:1', 'local')
})
