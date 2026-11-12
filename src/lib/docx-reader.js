// A small, dependency-free reader for .docx files, so the in-app viewer can show
// a Word document without a library or a server-side conversion.
//
// A .docx is a zip archive and the text lives in word/document.xml. The browser
// already ships both halves of what is needed: DecompressionStream inflates a
// zip entry and DOMParser reads the XML. The result is plain data (paragraphs,
// runs, tables), never HTML, so the viewer renders it as React elements and a
// hostile document has nothing to inject.
//
// This is a reading view, not a layout engine: headings, bold/italic/underline,
// lists, tables and line breaks come through; fonts, columns, headers, images
// and text boxes do not. Download is the route to the real document.

const MAX_ENTRY_BYTES = 30 * 1024 * 1024
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function readU16(view, offset) { return view.getUint16(offset, true) }
function readU32(view, offset) { return view.getUint32(offset, true) }

// Finds one entry through the zip's central directory, which is the only place
// the true compressed size is always recorded.
export function findZipEntry(buffer, wantedName) {
  const view = new DataView(buffer)
  let eocd = -1
  for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 65557); offset -= 1) {
    if (readU32(view, offset) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) throw new Error('This is not a valid Word document.')
  const entryCount = readU16(view, eocd + 10)
  let pointer = readU32(view, eocd + 16)
  const decoder = new TextDecoder()
  for (let index = 0; index < entryCount; index += 1) {
    if (pointer + 46 > buffer.byteLength || readU32(view, pointer) !== 0x02014b50) break
    const method = readU16(view, pointer + 10)
    const compressedSize = readU32(view, pointer + 20)
    const uncompressedSize = readU32(view, pointer + 24)
    const nameLength = readU16(view, pointer + 28)
    const extraLength = readU16(view, pointer + 30)
    const commentLength = readU16(view, pointer + 32)
    const localOffset = readU32(view, pointer + 42)
    const name = decoder.decode(new Uint8Array(buffer, pointer + 46, nameLength))
    if (name === wantedName) return { method, compressedSize, uncompressedSize, localOffset }
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return null
}

export async function readZipEntry(buffer, wantedName) {
  const entry = findZipEntry(buffer, wantedName)
  if (!entry) return null
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw new Error('This document is too large to show in the app.')
  const view = new DataView(buffer)
  const localOffset = entry.localOffset
  if (readU32(view, localOffset) !== 0x04034b50) throw new Error('This is not a valid Word document.')
  const start = localOffset + 30 + readU16(view, localOffset + 26) + readU16(view, localOffset + 28)
  const bytes = new Uint8Array(buffer, start, entry.compressedSize)
  if (entry.method === 0) return new TextDecoder().decode(bytes)
  if (entry.method !== 8) throw new Error('This document uses a compression the app cannot read.')
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open Word documents in the app.')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

const childrenNamed = (node, name) => Array.from(node.childNodes).filter(child => child.nodeType === 1 && child.localName === name && child.namespaceURI === W_NS)
const firstChild = (node, name) => childrenNamed(node, name)[0] || null
// Real browsers resolve the namespaced attribute; the prefixed name is the
// fallback for DOM implementations that do not. Word always writes the w: prefix.
const valueOf = element => element.getAttributeNS(W_NS, 'val') || element.getAttribute('w:val') || ''
const isOn = element => element !== null && !['0', 'false', 'off'].includes(valueOf(element))

function parseRun(run) {
  const properties = firstChild(run, 'rPr')
  let text = ''
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType !== 1 || child.namespaceURI !== W_NS) continue
    if (child.localName === 't') text += child.textContent
    else if (child.localName === 'tab') text += '\t'
    else if (child.localName === 'br' || child.localName === 'cr') text += '\n'
  }
  if (!text) return null
  return {
    text,
    bold: properties ? isOn(firstChild(properties, 'b')) : false,
    italic: properties ? isOn(firstChild(properties, 'i')) : false,
    underline: properties ? (firstChild(properties, 'u') !== null && valueOf(firstChild(properties, 'u')) !== 'none') : false,
  }
}

function parseParagraph(paragraph) {
  const properties = firstChild(paragraph, 'pPr')
  const style = properties ? (firstChild(properties, 'pStyle') ? valueOf(firstChild(properties, 'pStyle')) : '') : ''
  const heading = /^heading\s*([1-6])$/i.exec(style)
  const title = /^title$/i.test(style)
  const numbering = properties ? firstChild(properties, 'numPr') : null
  const runs = []
  const collect = node => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1 || child.namespaceURI !== W_NS) continue
      if (child.localName === 'r') { const run = parseRun(child); if (run) runs.push(run) }
      else if (child.localName === 'hyperlink' || child.localName === 'ins' || child.localName === 'smartTag') collect(child)
    }
  }
  collect(paragraph)
  return {
    type: 'paragraph',
    level: heading ? Number(heading[1]) : title ? 1 : 0,
    list: numbering !== null,
    runs,
  }
}

function parseBody(container) {
  const blocks = []
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType !== 1 || child.namespaceURI !== W_NS) continue
    if (child.localName === 'p') blocks.push(parseParagraph(child))
    else if (child.localName === 'tbl') {
      blocks.push({
        type: 'table',
        rows: childrenNamed(child, 'tr').map(row => childrenNamed(row, 'tc').map(cell => parseBody(cell))),
      })
    }
  }
  return blocks
}

// Turns the bytes of a .docx into { blocks }. Throws an Error with a message
// that is fit to show the reader.
export async function parseDocx(buffer) {
  const xml = await readZipEntry(buffer, 'word/document.xml')
  if (xml === null) throw new Error('This is not a valid Word document.')
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  if (parsed.getElementsByTagName('parsererror').length) throw new Error('This document could not be read.')
  const root = parsed.documentElement
  const body = root ? firstChild(root, 'body') : null
  if (!body) throw new Error('This document could not be read.')
  return { blocks: parseBody(body) }
}
