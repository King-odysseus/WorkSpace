'use strict'

/*
 * Chunking, driven through the bundle Electron loads.
 *
 * Three properties are what this file exists for, and two of them cannot be seen from a
 * chunk's text alone:
 *
 * 1. A chunk never spans two pages or two headings. If it did, the citation on screen
 *    would name one page while quoting another, and there would be no way to tell from
 *    the stored row that it had happened. So the test asserts every chunk carries
 *    exactly one location.
 * 2. A chunk's size lands near the plan's 500 to 800 tokens. Too small and a passage has
 *    no context; too large and it crowds other passages out of the window while still
 *    being cited as one place. Asserted as a range, because an exact count would be a
 *    test of the estimator rather than of the chunker.
 * 3. Consecutive chunks of one section overlap. Without it, a sentence straddling a
 *    boundary is broken into two halves that each fail to answer anything.
 *
 * The overlap test is the interesting one: it can only pass if the tail of one chunk
 * really does reappear at the head of the next, which a "join everything and slice"
 * implementation would fail while looking correct.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

for (const name of ['chunkSections', 'DEFAULT_CHUNKING']) {
  assert.notEqual(api[name], undefined, `${name} must be exported by the main bundle`)
}

/** A sentence of roughly `tokens` tokens, unique enough to find again in the output. */
function sentence (marker, tokens = 20) {
  return `${marker} ${'the loft survey covers the rear elevation and the shared stairwell '.repeat(1)}`.trim() +
    ' ' + `${marker} noted.`.repeat(Math.max(0, Math.ceil(tokens / 4)))
}

/** A section whose text is long enough to be cut into several chunks. */
function longSection (page, section, paragraphs = 12) {
  const parts = []
  for (let index = 0; index < paragraphs; index += 1) {
    parts.push(`Paragraph ${index} on page ${page}. The rear elevation needs repointing before the winter works begin.`)
  }
  return { page, section, text: parts.join('\n\n') }
}

test('a short section becomes exactly one chunk carrying its page and heading', () => {
  const chunks = api.chunkSections([{ page: 4, section: 'Pricing', text: 'The quotation expires on Friday.' }])

  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].page, 4)
  assert.equal(chunks[0].section, 'Pricing')
  assert.equal(chunks[0].text, 'The quotation expires on Friday.')
  assert.ok(chunks[0].tokens > 0, 'a chunk must record how big it is')
})

test('a long section is cut into several chunks, and none exceeds the ceiling', () => {
  const text = Array.from({ length: 90 }, (_, index) =>
    `Sentence ${index}. The rear elevation of the Tilley building needs repointing before winter.`).join(' ')

  const chunks = api.chunkSections([{ page: 1, section: null, text }])

  assert.ok(chunks.length >= 3, `expected several chunks, got ${chunks.length}`)

  /*
   * The ceiling is a bound on every chunk, including the last one, because that is what
   * is actually stored and sent. The target is a target: the final chunk of a section is
   * whatever is left over, and merging it into the one before would break the ceiling.
   * So the short tail is asserted as normal rather than treated as a defect.
   */
  for (const chunk of chunks) {
    assert.ok(chunk.tokens <= 800, `chunk of ${chunk.tokens} tokens is over the ceiling`)
  }
  for (const chunk of chunks.slice(0, -1)) {
    assert.ok(chunk.tokens >= 450, `chunk of ${chunk.tokens} tokens is far under the target`)
  }
  assert.ok(chunks.at(-1).tokens > 0, 'the trailing chunk must still hold text')
})

test('a chunk never spans two pages, so its citation can name one', () => {
  const chunks = api.chunkSections([
    { page: 1, section: null, text: longSection(1, null).text },
    { page: 2, section: null, text: longSection(2, null).text },
  ])

  const pages = new Set(chunks.map((chunk) => chunk.page))
  assert.deepEqual([...pages].sort((a, b) => a - b), [1, 2])
  // The specific failure this rules out: page 2's words arriving in a chunk labelled 1.
  for (const chunk of chunks) {
    const claimed = chunk.page === 1 ? 'page 2' : 'page 1'
    assert.equal(chunk.text.includes(claimed), false, `a chunk labelled ${chunk.page} quotes ${claimed}`)
  }
})

test('a chunk never spans two headings, and each keeps its own name', () => {
  const chunks = api.chunkSections([
    { page: null, section: 'Pricing', text: longSection(null, 'Pricing').text },
    { page: null, section: 'Schedule', text: longSection(null, 'Schedule').text },
  ])

  const sections = new Set(chunks.map((chunk) => chunk.section))
  assert.deepEqual([...sections].sort(), ['Pricing', 'Schedule'])
  for (const chunk of chunks) {
    assert.notEqual(chunk.section, null, 'a chunk must keep the heading it came from')
  }
})

test('consecutive chunks of one section overlap, so a straddling sentence is not lost', () => {
  /*
   * Sentences that are individually meaningless make the overlap unambiguous: if a chunk
   * opens with a sentence also found at the tail of the previous chunk, that sentence came
   * from the overlap rather than from the ordinary packing of units.
   */
  const text = Array.from({ length: 60 }, (_, index) => `Marker${index} holds a distinct fragment.`).join(' ')
  const chunks = api.chunkSections([{ page: 1, section: null, text }], { targetTokens: 120, maxTokens: 160, overlapTokens: 40 })

  assert.ok(chunks.length >= 2, 'the fixture must produce more than one chunk to test overlap')

  const firstWords = chunks[1].text.split(' ').slice(0, 12).join(' ')
  const previousTail = chunks[0].text.split(' ').slice(-24).join(' ')
  assert.ok(
    previousTail.includes(firstWords.split(' ').slice(0, 4).join(' ')),
    'the second chunk must start with text repeated from the end of the first',
  )
})

test('overlap never crosses a page boundary', () => {
  const chunks = api.chunkSections(
    [
      { page: 1, section: null, text: longSection(1, null, 20).text },
      { page: 2, section: null, text: longSection(2, null, 20).text },
    ],
    { targetTokens: 120, maxTokens: 160, overlapTokens: 40 },
  )

  const pageTwo = chunks.filter((chunk) => chunk.page === 2)
  assert.ok(pageTwo.length > 0, 'the fixture must produce page 2 chunks')
  // The first page 2 chunk may only overlap within page 2, so it cannot begin with the
  // closing words of page 1.
  const lastOfPageOne = chunks.filter((chunk) => chunk.page === 1).at(-1)
  const headOfPageTwo = pageTwo[0].text.slice(0, 40)
  assert.equal(
    lastOfPageOne.text.slice(-40).includes(headOfPageTwo),
    false,
    'page 2 must not open with page 1 text',
  )
})

test('a paragraph with no full stop for thousands of characters is cut rather than left whole', () => {
  // One sentence, no punctuation, far past the ceiling: the case that would otherwise
  // become a single unindexable chunk.
  const run = 'repointing '.repeat(1_200)
  const chunks = api.chunkSections([{ page: null, section: null, text: run }], { maxTokens: 200, targetTokens: 150 })

  assert.ok(chunks.length >= 2, 'an unbroken run must be divided')
  for (const chunk of chunks) {
    assert.ok(chunk.tokens <= 260, `a cut chunk reached ${chunk.tokens} tokens`)
  }
  /*
   * Cut at word boundaries, not mid-word. The fixture is one word repeated, so a whole-word
   * cut leaves every chunk made only of that word - and any fragment such as "epointing"
   * would show up here as a piece that is not the word at all.
   */
  for (const chunk of chunks) {
    const words = chunk.text.split(' ').filter((word) => word !== '')
    assert.ok(words.length > 0, 'a chunk must hold at least one word')
    assert.deepEqual(
      words.filter((word) => word !== 'repointing'),
      [],
      `a chunk holds a fragment rather than whole words: ${words.filter((word) => word !== 'repointing').slice(0, 3).join(', ')}`,
    )
  }
})

test('a document with no readable text produces no chunks at all', () => {
  assert.deepEqual(api.chunkSections([]), [])
  assert.deepEqual(api.chunkSections([{ page: 1, section: null, text: '   \n\n  ' }]), [])
})

test('the chunker refuses settings that cannot work, rather than producing nonsense', () => {
  assert.throws(() => api.chunkSections([], { maxTokens: 0 }), /maxTokens/)
  assert.throws(() => api.chunkSections([], { targetTokens: 900, maxTokens: 800 }), /target/)
})

test('the default settings are the range the plan asks for', () => {
  assert.equal(api.DEFAULT_CHUNKING.targetTokens, 650)
  assert.equal(api.DEFAULT_CHUNKING.maxTokens, 800)
  assert.ok(api.DEFAULT_CHUNKING.overlapTokens > 0)
})
