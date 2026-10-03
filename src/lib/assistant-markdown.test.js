import { expect, it } from 'vitest'
import { renderAssistantMarkdown } from './assistant-markdown.js'

it('renders the markers the transcript used to print as typed', () => {
  expect(renderAssistantMarkdown('**Design UI** is overdue'))
    .toBe('<p><strong>Design UI</strong> is overdue</p>')
  expect(renderAssistantMarkdown('- first\n- second'))
    .toBe('<ul><li>first</li><li>second</li></ul>')
  expect(renderAssistantMarkdown('1. first\n2. second'))
    .toBe('<ol><li>first</li><li>second</li></ol>')
  expect(renderAssistantMarkdown('### Week 1')).toBe('<h3>Week 1</h3>')
})

it('keeps a sentence and the list under it as separate blocks', () => {
  // The shape Zuri's own answers take: a lead-in, then the items.
  expect(renderAssistantMarkdown('Two are overdue:\n- Design UI\n- create website UI'))
    .toBe('<p>Two are overdue:</p><ul><li>Design UI</li><li>create website UI</li></ul>')
})

it('restarts the list tag when the kind of list changes', () => {
  expect(renderAssistantMarkdown('- bullet\n1. number'))
    .toBe('<ul><li>bullet</li></ul><ol><li>number</li></ol>')
})

it('leaves code spans literal so markup inside them survives', () => {
  expect(renderAssistantMarkdown('use `**not bold**` here'))
    .toBe('<p>use <code>**not bold**</code> here</p>')
  expect(renderAssistantMarkdown('`<script>alert(1)</script>`'))
    .toBe('<p><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></p>')
})

it('escapes everything the model writes, so it cannot introduce markup', () => {
  expect(renderAssistantMarkdown('<img src=x onerror=alert(1)>'))
    .toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
  expect(renderAssistantMarkdown('a & b')).toBe('<p>a &amp; b</p>')
  // Text that already looks like an entity stays text: the ampersand it is
  // written with is escaped in turn, so no pass can resolve it back into a tag.
  const written = renderAssistantMarkdown('&lt;b&gt;**x**')
  expect(written).toBe('<p>&amp;lt;b&amp;gt;<strong>x</strong></p>')
  expect(written).not.toContain('<b>')
})

it('only builds a link out of an explicit markdown link', () => {
  expect(renderAssistantMarkdown('see [the plan](https://example.com/plan)'))
    .toBe('<p>see <a href="https://example.com/plan">the plan</a></p>')
  // A javascript: target is never a link, so it stays inert text.
  expect(renderAssistantMarkdown('[x](javascript:alert(1))'))
    .toBe('<p>[x](javascript:alert(1))</p>')
})

it('keeps a lone asterisk out of the emphasis pass', () => {
  expect(renderAssistantMarkdown('2 * 3 = 6')).toBe('<p>2 * 3 = 6</p>')
  expect(renderAssistantMarkdown('*italic*')).toBe('<p><em>italic</em></p>')
})

it('collapses runs of blank lines and trims each line', () => {
  expect(renderAssistantMarkdown('one\n\n\n\n   two   ')).toBe('<p>one</p><p>two</p>')
})

it('returns nothing for empty input', () => {
  expect(renderAssistantMarkdown('')).toBe('')
  expect(renderAssistantMarkdown('   \n  ')).toBe('')
  expect(renderAssistantMarkdown(undefined)).toBe('')
})
