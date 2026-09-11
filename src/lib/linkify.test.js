import { describe, expect, it } from 'vitest'
import { tokenizeText } from './linkify.js'

const links = text => tokenizeText(text).filter(segment => segment.type === 'link').map(segment => [segment.value, segment.href])

describe('tokenizeText', () => {
  it('links http, https and www URLs', () => {
    expect(links('See https://example.com/a?b=1 and http://x.org or www.site.com/page')).toEqual([
      ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
      ['http://x.org', 'http://x.org'],
      ['www.site.com/page', 'https://www.site.com/page'],
    ])
  })

  it('keeps sentence punctuation and wrapping parentheses out of the link', () => {
    const segments = tokenizeText('Read (https://example.com/doc). Thanks!')
    expect(links('Read (https://example.com/doc). Thanks!')).toEqual([['https://example.com/doc', 'https://example.com/doc']])
    expect(segments.map(segment => segment.value).join('')).toBe('Read (https://example.com/doc). Thanks!')
  })

  it('keeps balanced parentheses that belong to the URL', () => {
    expect(links('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://en.wikipedia.org/wiki/Foo_(bar)']])
  })

  it('links email addresses as mailto instead of treating the domain as a mention', () => {
    const segments = tokenizeText('Email jane.doe@example.com or ping @jane')
    expect(segments).toEqual([
      { type: 'text', value: 'Email ' },
      { type: 'link', value: 'jane.doe@example.com', href: 'mailto:jane.doe@example.com' },
      { type: 'text', value: ' or ping ' },
      { type: 'mention', value: '@jane' },
    ])
  })

  it('never produces a script or data href', () => {
    const hrefs = tokenizeText('javascript:alert(1) data:text/html,x https://ok.com').filter(segment => segment.href).map(segment => segment.href)
    expect(hrefs).toEqual(['https://ok.com'])
  })

  it('leaves a bare scheme as text', () => {
    expect(tokenizeText('just https:// here')).toEqual([{ type: 'text', value: 'just https:// here' }])
  })
})
