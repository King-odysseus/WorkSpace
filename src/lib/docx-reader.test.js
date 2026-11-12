import { describe, expect, it } from 'vitest'
import { parseDocx } from './docx-reader.js'

const encoder = new TextEncoder()

// Builds a minimal one-entry zip. Method 0 stores the bytes as they are; method 8
// is raw deflate, which the browser's own CompressionStream produces.
async function buildZip(name, content, method = 0) {
  const nameBytes = encoder.encode(name)
  const raw = encoder.encode(content)
  let data = raw
  if (method === 8) {
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    data = new Uint8Array(await new Response(stream).arrayBuffer())
  }
  const local = new Uint8Array(30 + nameBytes.length)
  const localView = new DataView(local.buffer)
  localView.setUint32(0, 0x04034b50, true)
  localView.setUint16(8, method, true)
  localView.setUint32(18, data.length, true)
  localView.setUint32(22, raw.length, true)
  localView.setUint16(26, nameBytes.length, true)
  local.set(nameBytes, 30)
  const central = new Uint8Array(46 + nameBytes.length)
  const centralView = new DataView(central.buffer)
  centralView.setUint32(0, 0x02014b50, true)
  centralView.setUint16(10, method, true)
  centralView.setUint32(20, data.length, true)
  centralView.setUint32(24, raw.length, true)
  centralView.setUint16(28, nameBytes.length, true)
  centralView.setUint32(42, 0, true)
  central.set(nameBytes, 46)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, 1, true)
  endView.setUint16(10, 1, true)
  endView.setUint32(12, central.length, true)
  endView.setUint32(16, local.length + data.length, true)
  const zip = new Uint8Array(local.length + data.length + central.length + end.length)
  zip.set(local, 0)
  zip.set(data, local.length)
  zip.set(central, local.length + data.length)
  zip.set(end, local.length + data.length + central.length)
  return zip.buffer
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const documentXml = body => `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`

const BODY = [
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Launch plan</w:t></w:r></w:p>',
  '<w:p><w:r><w:t xml:space="preserve">Plain </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t> slanted</w:t></w:r></w:p>',
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First item</w:t></w:r></w:p>',
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Dana</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
].join('')

describe('parseDocx', () => {
  it('reads headings, formatted runs, list items and tables from a stored entry', async () => {
    const { blocks } = await parseDocx(await buildZip('word/document.xml', documentXml(BODY), 0))
    expect(blocks[0]).toMatchObject({ type: 'paragraph', level: 1, runs: [{ text: 'Launch plan' }] })
    expect(blocks[1].runs).toEqual([
      { text: 'Plain ', bold: false, italic: false, underline: false },
      { text: 'bold', bold: true, italic: false, underline: false },
      { text: ' slanted', bold: false, italic: true, underline: true },
    ])
    expect(blocks[2]).toMatchObject({ list: true, runs: [{ text: 'First item' }] })
    expect(blocks[3].type).toBe('table')
    expect(blocks[3].rows[0].map(cell => cell[0].runs[0].text)).toEqual(['Owner', 'Dana'])
  })

  it('reads a deflate-compressed entry', async () => {
    const { blocks } = await parseDocx(await buildZip('word/document.xml', documentXml(BODY), 8))
    expect(blocks[0].runs[0].text).toBe('Launch plan')
  })

  it('rejects a file that is not a Word document', async () => {
    await expect(parseDocx(encoder.encode('just some text, not a zip').buffer)).rejects.toThrow('not a valid Word document')
    await expect(parseDocx(await buildZip('other.xml', '<a/>'))).rejects.toThrow('not a valid Word document')
  })

  it('reports malformed XML instead of rendering garbage', async () => {
    await expect(parseDocx(await buildZip('word/document.xml', '<w:document><oops'))).rejects.toThrow()
  })
})
