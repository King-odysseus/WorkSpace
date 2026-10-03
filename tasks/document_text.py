"""Turn a stored workspace file into plain text that Zuri can read.

Extraction is best-effort and never raises in normal use: a document that
cannot be read is an outcome the caller reports to the user, not a failure that
should break the chat turn. ``extract_document_text`` therefore returns a
result dict rather than a string.

The third-party parsers are imported inside their handlers instead of at module
scope, because the PDF and image paths depend on system-level packages as well
as Python ones. An environment without them must still be able to summarise a
CSV.
"""

import base64
import codecs
import io
import logging
import os

logger = logging.getLogger(__name__)

# A document is the third channel into the prompt, alongside the message and the
# replayed history, both of which are already bounded. This keeps one oversized
# file from building a runaway prompt.
DOCUMENT_MAX_CHARS = 60000

# Bounds on parser work before the character cap applies, so a pathological file
# cannot spin through a million rows to produce text that is then thrown away.
SPREADSHEET_MAX_ROWS = 2000
PDF_MAX_PAGES = 200

PLAIN_TEXT_EXTENSIONS = {'.txt', '.md', '.csv', '.json', '.xml', '.log', '.yaml', '.yml'}
SPREADSHEET_EXTENSIONS = {'.xlsx', '.xlsm'}
PDF_EXTENSIONS = {'.pdf'}
WORD_EXTENSIONS = {'.docx'}
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.webp'}

# Formats the workspace accepts as uploads but that nothing here can open.
# Naming the format beats returning an empty summary that reads like an answer.
UNREADABLE_HINTS = {
    '.doc': 'the legacy binary Word format',
    '.xls': 'the legacy binary Excel format',
    '.ppt': 'PowerPoint files',
    '.pptx': 'PowerPoint files',
    '.odt': 'OpenDocument text',
    '.ods': 'OpenDocument spreadsheets',
    '.odp': 'OpenDocument presentations',
    '.rtf': 'rich text files',
    '.zip': 'archives',
    '.mp3': 'audio',
    '.mp4': 'video',
    '.wav': 'audio',
    '.webm': 'video',
}

READABLE_ADVICE = 'Save it as PDF, DOCX, XLSX, CSV, text or an image and try again.'

# The formats the vision APIs accept. Deliberately narrower than
# IMAGE_EXTENSIONS: BMP and TIFF are readable here by the OCR path but no
# provider takes them as a picture, so those keep going through OCR.
VISION_MEDIA_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
}

# A single image may be up to 32 MiB at the providers and base64 inflates it by
# about a third, against a 48 MiB request body. A screenshot worth reading is far
# smaller than this ceiling; anything larger falls back to OCR instead of being
# sent, which keeps one attachment from making every turn slow.
VISION_MAX_BYTES = 8 * 1024 * 1024


class DocumentReadError(Exception):
    """Raised when a file exists but cannot be turned into text."""


def _decode(data):
    """Decode bytes to text without guessing an encoding that would corrupt them.

    UTF-16 is only used when a byte-order mark proves it, otherwise almost any
    byte string decodes "successfully" as UTF-16 and comes out as mojibake.
    """
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return data.decode('utf-16')
    for encoding in ('utf-8-sig', 'cp1252', 'latin-1'):
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode('utf-8', errors='replace')


def clip_text(text):
    """Return (text, truncated) with the character ceiling applied.

    Public because redaction runs after extraction and substitutes placeholders
    that can be longer than what they replaced, so the caller has to re-apply the
    ceiling once the text is final.
    """
    if len(text) <= DOCUMENT_MAX_CHARS:
        return text, False
    return text[:DOCUMENT_MAX_CHARS], True


def _read_plain_text(stored_file):
    return _decode(stored_file.read())


def _read_spreadsheet(stored_file):
    import openpyxl

    try:
        workbook = openpyxl.load_workbook(io.BytesIO(stored_file.read()), read_only=True, data_only=True)
    except Exception as exc:
        raise DocumentReadError('That spreadsheet could not be opened. It may be damaged.') from exc
    try:
        sheets = []
        for sheet in workbook.worksheets:
            rows = []
            for index, row in enumerate(sheet.iter_rows(values_only=True)):
                if index >= SPREADSHEET_MAX_ROWS:
                    rows.append('... (further rows not read)')
                    break
                values = ['' if cell is None else str(cell) for cell in row]
                if any(value.strip() for value in values):
                    rows.append(' | '.join(values))
            if rows:
                sheets.append(f'[Sheet: {sheet.title}]\n' + '\n'.join(rows))
        return '\n\n'.join(sheets)
    finally:
        workbook.close()


def _read_pdf(stored_file):
    import pypdf

    try:
        reader = pypdf.PdfReader(io.BytesIO(stored_file.read()))
        if reader.is_encrypted and not reader.decrypt(''):
            raise DocumentReadError('That PDF is password-protected, so Zuri cannot read it.')
        pages = []
        for number, page in enumerate(reader.pages, start=1):
            if len(pages) >= PDF_MAX_PAGES:
                pages.append(f'... (further pages beyond {PDF_MAX_PAGES} not read)')
                break
            try:
                text = page.extract_text() or ''
            except Exception:
                # One unreadable page should not discard the rest of the file.
                text = ''
            if text.strip():
                pages.append(f'[Page {number}]\n{text.strip()}')
    except DocumentReadError:
        raise
    except Exception as exc:
        raise DocumentReadError('That PDF could not be parsed. It may be damaged.') from exc
    if not pages:
        # Rasterising a PDF needs a separate renderer that this project does not
        # ship, so point the user at the path that does work.
        raise DocumentReadError(
            'That PDF has no text layer, which usually means it is a scan. '
            'Zuri reads images directly, so upload a screenshot or photo of the pages instead.'
        )
    return '\n\n'.join(pages)


def _read_word(stored_file):
    import docx

    try:
        document = docx.Document(io.BytesIO(stored_file.read()))
    except Exception as exc:
        raise DocumentReadError('That Word document could not be parsed. It may be damaged.') from exc
    chunks = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables:
        for row in table.rows:
            values = [cell.text.strip() for cell in row.cells]
            if any(values):
                chunks.append(' | '.join(values))
    return '\n'.join(chunks)


def _read_image(stored_file):
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise DocumentReadError('Image reading is not available on this server.') from exc
    try:
        image = Image.open(io.BytesIO(stored_file.read()))
        image.load()
    except Exception as exc:
        raise DocumentReadError('That image could not be opened.') from exc
    try:
        return pytesseract.image_to_string(image)
    except pytesseract.TesseractNotFoundError as exc:
        raise DocumentReadError(
            'Optical character recognition is not installed on this server, so Zuri cannot read images yet.'
        ) from exc
    except Exception as exc:
        raise DocumentReadError('That image could not be read.') from exc


def read_image_for_vision(stored_file, original_name=''):
    """Read an attached image as bytes a vision request can carry.

    Returns ``{'data': base64 str, 'media_type': str, 'reason': str}``. A
    non-empty ``reason`` means the picture cannot ride along - an unreadable
    format, or one the providers will not take - and the caller falls back to
    reading the file as text instead.
    """
    if not stored_file:
        return {'data': '', 'media_type': '', 'reason': 'That file is no longer stored, so Zuri cannot read it.'}

    name = str(original_name or getattr(stored_file, 'name', '') or '')
    media_type = VISION_MEDIA_TYPES.get(os.path.splitext(name)[1].lower())
    if not media_type:
        return {'data': '', 'media_type': '', 'reason': 'That image format cannot be sent as a picture.'}

    try:
        stored_file.open('rb')
        try:
            raw = stored_file.read()
        finally:
            stored_file.close()
    except Exception:
        logger.exception('Could not open an image for a vision request: %s', name)
        return {'data': '', 'media_type': '', 'reason': 'That image could not be opened.'}

    if not raw:
        return {'data': '', 'media_type': '', 'reason': 'That image is empty.'}
    if len(raw) > VISION_MAX_BYTES:
        return {'data': '', 'media_type': '', 'reason': 'That image is too large to send as a picture.'}
    return {'data': base64.b64encode(raw).decode('ascii'), 'media_type': media_type, 'reason': ''}


def extract_document_text(stored_file, original_name=''):
    """Read one stored file into text.

    Returns ``{'text': str, 'reason': str, 'truncated': bool}``. A non-empty
    ``reason`` means nothing usable came back and ``text`` is empty, so the
    caller can surface the reason verbatim.
    """
    if not stored_file:
        return {'text': '', 'reason': 'That file is no longer stored, so Zuri cannot read it.', 'truncated': False}

    name = str(original_name or getattr(stored_file, 'name', '') or '')
    extension = os.path.splitext(name)[1].lower()

    try:
        stored_file.open('rb')
    except Exception:
        logger.exception('Could not open a stored file for extraction: %s', name)
        return {'text': '', 'reason': 'That file could not be opened for reading.', 'truncated': False}

    try:
        if extension in PLAIN_TEXT_EXTENSIONS:
            text = _read_plain_text(stored_file)
        elif extension in SPREADSHEET_EXTENSIONS:
            text = _read_spreadsheet(stored_file)
        elif extension in PDF_EXTENSIONS:
            text = _read_pdf(stored_file)
        elif extension in WORD_EXTENSIONS:
            text = _read_word(stored_file)
        elif extension in IMAGE_EXTENSIONS:
            text = _read_image(stored_file)
        else:
            hint = UNREADABLE_HINTS.get(extension)
            if hint:
                return {
                    'text': '',
                    'reason': f'Zuri cannot read {hint} yet. {READABLE_ADVICE}',
                    'truncated': False,
                }
            return {
                'text': '',
                'reason': f'Zuri cannot read that file type. {READABLE_ADVICE}',
                'truncated': False,
            }
    except DocumentReadError as exc:
        return {'text': '', 'reason': str(exc), 'truncated': False}
    except Exception:
        logger.exception('Unexpected failure extracting text from %s', name)
        return {'text': '', 'reason': 'Zuri could not read that file.', 'truncated': False}
    finally:
        stored_file.close()

    text = (text or '').strip()
    if not text:
        return {'text': '', 'reason': 'Zuri found no readable text in that file.', 'truncated': False}
    text, truncated = clip_text(text)
    return {'text': text, 'reason': '', 'truncated': truncated}
