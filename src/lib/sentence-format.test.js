import { describe, expect, it } from 'vitest'
import { formatSentenceBreaks } from './sentence-format.js'

describe('formatSentenceBreaks', () => {
  it('starts each new sentence on its own line', () => {
    expect(formatSentenceBreaks('Plan the day. Share the update! Ask for help?'))
      .toBe('Plan the day.\nShare the update!\nAsk for help?')
  })

  it('keeps common abbreviations inside the same sentence', () => {
    expect(formatSentenceBreaks('Meet Dr. Reed at 10. Bring the brief.'))
      .toBe('Meet Dr. Reed at 10.\nBring the brief.')
    expect(formatSentenceBreaks('Use e.g. This example as a guide.'))
      .toBe('Use e.g. This example as a guide.')
    expect(formatSentenceBreaks('The office opens at 9 a.m. Staff arrive by 8:45.'))
      .toBe('The office opens at 9 a.m.\nStaff arrive by 8:45.')
    expect(formatSentenceBreaks('The U.S. team owns this. Everyone else supports.'))
      .toBe('The U.S. team owns this.\nEveryone else supports.')
  })

  it('preserves explicit line breaks and non-string values', () => {
    expect(formatSentenceBreaks('First line.\nSecond line.')).toBe('First line.\nSecond line.')
    expect(formatSentenceBreaks(null)).toBeNull()
  })

  it('leaves single-sentence copy unchanged', () => {
    expect(formatSentenceBreaks('Everything needs your attention.'))
      .toBe('Everything needs your attention.')
  })
})
