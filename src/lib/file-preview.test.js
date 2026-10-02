import { expect, it } from 'vitest'
import { downloadHref, previewKind, previewSrc } from './file-preview.js'

it('only calls a file previewable when the server would serve it inline', () => {
  expect(previewKind('holiday.png')).toBe('image')
  expect(previewKind('Scan.JPEG')).toBe('image')
  expect(previewKind('animation.webp')).toBe('image')
  expect(previewKind('Brief.pdf')).toBe('pdf')
  // Everything else arrives as an attachment, so an <img> or an <iframe> would
  // render nothing rather than the file.
  expect(previewKind('Plan.docx')).toBe('none')
  expect(previewKind('Budget.xlsx')).toBe('none')
  expect(previewKind('notes.txt')).toBe('none')
  expect(previewKind('')).toBe('none')
  expect(previewKind(null)).toBe('none')
})

it('refuses a URL whose scheme could run script', () => {
  expect(previewSrc('/api/workspace-files/9/download/')).toBe('/api/workspace-files/9/download/')
  expect(previewSrc('https://res.cloudinary.com/demo/x.pdf')).toBe('https://res.cloudinary.com/demo/x.pdf')
  expect(previewSrc('javascript:alert(1)')).toBe('')
  expect(previewSrc('data:text/html;base64,PHNjcmlwdD4=')).toBe('')
  expect(previewSrc('vbscript:msgbox(1)')).toBe('')
  expect(previewSrc('')).toBe('')
  expect(previewSrc(undefined)).toBe('')
})

it('asks the server for the attachment form when downloading', () => {
  expect(downloadHref('/api/workspace-files/9/download/')).toBe('/api/workspace-files/9/download/?download=1')
  // A URL that already carries a query keeps both parameters.
  expect(downloadHref('/api/files/9/?v=2')).toBe('/api/files/9/?v=2&download=1')
  expect(downloadHref('javascript:alert(1)')).toBe('')
})
