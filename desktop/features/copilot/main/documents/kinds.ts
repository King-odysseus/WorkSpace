/*
 * What kind of file this is, taken from its name and then checked against its bytes.
 *
 * Why the name alone is not enough. An extension is a claim made by whatever wrote the
 * file, and by whoever renamed it afterwards, and the two disagree often enough to
 * matter: a `.pdf` that is really a Word export, a `.png` that is an HTML error page
 * saved out of a browser, a `.docx` that was unzipped and re-zipped by a different
 * tool. Each parser here reports its own confusing failure when handed the wrong
 * thing - a PDF reader says the file is corrupt about a file that was never a PDF - and
 * the person is told their document is broken when it is simply not what it claimed to
 * be. Reading the first bytes here means ingestion can answer `unsupported` before a
 * parser is involved, which is the honest answer and the one a screen can explain.
 *
 * Why the signature checks are shallow. Each one reads the fewest bytes that tell the
 * formats apart, and no more. Proving a file is a well-formed PDF belongs to the PDF
 * reader, which has to open it anyway; what is decided here is only whether the file is
 * worth handing to that reader. A truncated file that starts correctly is the parser's
 * failure to report, not this function's.
 *
 * Why text, markdown and CSV get no check at all. Those formats are the absence of
 * structure: any byte can appear inside a CSV field, and a text file has no header by
 * definition. Pretending to verify them would be theatre. The reader refuses a file
 * that decodes to nothing but replacement characters instead, which is what a renamed
 * binary actually looks like.
 */

import type { DocumentKind } from '../../shared/storage-contract.js'

/** A signature as the byte values a file actually starts with. */
function asciiBytes (text: string): readonly number[] {
  const values: number[] = []
  for (let at = 0; at < text.length; at += 1) values.push(text.charCodeAt(at))
  return values
}

/** `%PDF-` is the first line of every PDF, comments and all. */
const PDF_HEADER = asciiBytes('%PDF-')

/**
 * The local file header of a ZIP entry: `PK`, then 3, then 4.
 *
 * DOCX, XLSX and PPTX are ZIP archives, so this is what the very first bytes of each
 * one are. Reading it does not say which of the three it is - only the archive's own
 * contents can - but the extension already names one, and a ZIP where any of them was
 * claimed is close enough to be worth the parser's time.
 */
const ZIP_LOCAL_HEADER = Object.freeze([0x50, 0x4b, 0x03, 0x04])

const PNG_MAGIC = Object.freeze([0x89, 0x50, 0x4e, 0x47])
const JPEG_MAGIC = Object.freeze([0xff, 0xd8, 0xff])

/*
 * TIFF writes its byte order first: `II` and 42 for little-endian, `MM` and 42 in the
 * other order for big-endian. Both are produced, so both are accepted.
 */
const TIFF_LITTLE_ENDIAN = Object.freeze([0x49, 0x49, 0x2a, 0x00])
const TIFF_BIG_ENDIAN = Object.freeze([0x4d, 0x4d, 0x00, 0x2a])

const BMP_MAGIC = asciiBytes('BM')

/* `GIF8` covers both GIF87a and GIF89a: the rest of the version number is not needed. */
const GIF_MAGIC = asciiBytes('GIF8')

const RIFF_MAGIC = asciiBytes('RIFF')
const WEBP_MAGIC = asciiBytes('WEBP')

/** Whether the bytes at `offset` are exactly this prefix. */
function startsWith (bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false
  for (const [at, expected] of prefix.entries()) {
    if (bytes[offset + at] !== expected) return false
  }
  return true
}

/**
 * The extension, lowercased, or an empty string.
 *
 * Only the last dot of the last path segment counts, because a dot in a folder name is
 * not an extension and neither is one in a name like `report.v2`. A name with no
 * extension, or one that ends in a dot, answers an empty string and is refused by the
 * caller below.
 */
function extensionOf (fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return ''
  const separator = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'))
  if (dot <= separator) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

/** The extensions this build treats as pictures. */
function isImageExtension (extension: string): boolean {
  switch (extension) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'tif':
    case 'tiff':
    case 'bmp':
    case 'webp':
    case 'gif':
      return true
    default:
      return false
  }
}

/** Whether these bytes carry the signature that extension's format writes first. */
function matchesImageSignature (extension: string, bytes: Uint8Array): boolean {
  switch (extension) {
    case 'png':
      return startsWith(bytes, PNG_MAGIC)
    case 'jpg':
    case 'jpeg':
      return startsWith(bytes, JPEG_MAGIC)
    case 'tif':
    case 'tiff':
      return startsWith(bytes, TIFF_LITTLE_ENDIAN) || startsWith(bytes, TIFF_BIG_ENDIAN)
    case 'bmp':
      return startsWith(bytes, BMP_MAGIC)
    case 'gif':
      return startsWith(bytes, GIF_MAGIC)
    case 'webp':
      // `RIFF` is the container header and says nothing about what is inside it; the
      // four bytes at offset 8 are what name WebP, so both have to be present.
      return startsWith(bytes, RIFF_MAGIC) && startsWith(bytes, WEBP_MAGIC, 8)
    default:
      return false
  }
}

/**
 * The kind of file this is, or `null` when this build has no reader for it.
 *
 * `null` is a first-class answer rather than an error: the caller turns it into the
 * `unsupported` failure, which is the same token an unknown extension and a renamed
 * file both deserve. Nothing downstream is asked to guess.
 */
export function detectKind (fileName: string, bytes: Uint8Array): DocumentKind | null {
  if (typeof fileName !== 'string') return null
  /*
   * Bytes that are not bytes are a caller bug, not an unknown kind - but this is the
   * function that decides whether any parser runs, so it refuses rather than trusting
   * an indexed read to be safe. A refused read upstream leaves `undefined` here.
   */
  if (!(bytes instanceof Uint8Array)) return null

  const extension = extensionOf(fileName)

  switch (extension) {
    case 'pdf':
      return startsWith(bytes, PDF_HEADER) ? 'pdf' : null
    case 'docx':
      return startsWith(bytes, ZIP_LOCAL_HEADER) ? 'docx' : null
    case 'xlsx':
      return startsWith(bytes, ZIP_LOCAL_HEADER) ? 'xlsx' : null
    case 'pptx':
      return startsWith(bytes, ZIP_LOCAL_HEADER) ? 'pptx' : null
    case 'txt':
      return 'txt'
    case 'md':
      return 'md'
    case 'markdown':
      // The long spelling is what several editors write, and it is the same format.
      return 'md'
    case 'csv':
      return 'csv'
    default:
      return isImageExtension(extension) && matchesImageSignature(extension, bytes)
        ? 'image'
        : null
  }
}

/**
 * Whether a kind is a picture.
 *
 * Asked by ingestion to decide whether a file is a picture, which is a document with no
 * text layer to read. Keeping the answer here means a caller does not have to repeat the
 * list of picture extensions and let the two drift apart.
 */
export function isImageKind (kind: DocumentKind): boolean {
  return kind === 'image'
}

/**
 * Whether the format numbers its own pages.
 *
 * Only PDF does. The office formats have sheets and slides but no pages, and the
 * text formats have neither, so a `pageCount` of anything but zero would be a number
 * this build invented.
 */
export function kindHasPages (kind: DocumentKind): boolean {
  return kind === 'pdf'
}
