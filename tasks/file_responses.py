"""Serve stored uploads so images and PDFs open in the browser.

Download endpoints used to force ``Content-Disposition: attachment`` for every
file, so clicking an image saved it to disk (or, in the installed app, appeared
to do nothing) instead of showing it. Previewable types are now served inline.
Everything else still downloads, and ``?download=1`` forces a download for any
file.

Uploads are user-controlled content served from the app's own origin, so only a
fixed list of extensions is ever sent inline. SVG and HTML are never on it,
since both can run script. Images also get a sandboxing CSP. PDFs don't, because
Chromium refuses to render a PDF in a sandboxed document.
"""

from pathlib import Path

from django.http import FileResponse

INLINE_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
INLINE_EXTENSIONS = INLINE_IMAGE_EXTENSIONS | {'.pdf'}
IMAGE_CSP = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"


def stored_file_response(request, file_handle, filename):
    extension = Path(filename or '').suffix.lower()
    inline = extension in INLINE_EXTENSIONS and request.GET.get('download') != '1'
    response = FileResponse(file_handle, as_attachment=not inline, filename=filename)
    if inline and extension in INLINE_IMAGE_EXTENSIONS:
        response['Content-Security-Policy'] = IMAGE_CSP
    return response
