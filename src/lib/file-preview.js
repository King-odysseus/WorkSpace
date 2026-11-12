// Decisions the in-app file viewer makes about a single upload: whether it can
// be shown inline at all, and whether its URL is safe to hand to an <img> or an
// <iframe>.
//
// The kinds mirror INLINE_IMAGE_EXTENSIONS and INLINE_EXTENSIONS in
// tasks/file_responses.py. Those are the only types the server ever sends
// inline; everything else arrives as a download, which an element cannot render,
// so offering the element would just show a blank frame. The exception is
// 'docx': it is fetched and read in the browser (see docx-reader.js), which works
// whatever Content-Disposition the server sends, so it needs no entry there.

import { isImageFileName } from './workspace-format.js'

const PDF_EXTENSION = /\.pdf$/i
// Only .docx: the older binary .doc is not a zip and cannot be read in the
// browser, so it keeps the download fallback.
const DOCX_EXTENSION = /\.docx$/i

// Schemes a preview may load. Anything else - javascript:, vbscript:, data: with
// a non-image type - can run script once it is a frame or an image source.
const SAFE_SRC = /^(?:https?:\/\/|\/)/i

export function previewKind(name) {
  if (isImageFileName(name)) return 'image'
  if (PDF_EXTENSION.test(String(name || ''))) return 'pdf'
  if (DOCX_EXTENSION.test(String(name || ''))) return 'docx'
  return 'none'
}

export function previewSrc(url) {
  const value = String(url || '')
  return SAFE_SRC.test(value) ? value : ''
}

// Previews are served inline so the browser renders them; the viewer's own
// download action has to ask for the attachment form instead. The backend reads
// ?download=1 in stored_file_response.
export function downloadHref(url) {
  const value = previewSrc(url)
  if (!value) return ''
  return `${value}${value.includes('?') ? '&' : '?'}download=1`
}
