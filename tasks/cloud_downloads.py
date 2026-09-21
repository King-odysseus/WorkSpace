"""Redirect a membership-checked download to its durable Cloudinary copy.

The local path serves previewable types inline and everything else as an
attachment (see file_responses). A file served from Cloudinary has to honour the
same rule, so the decision lives here once and both download views use it.

Serving from res.cloudinary.com also means the bytes are no longer on the app's
own origin, so the sandboxing CSP that file_responses puts on inline images has
nothing left to protect: a hostile upload cannot reach same-origin state from
there. Extensions that are never safe to display are still sent as attachments
rather than rendered.
"""

from pathlib import Path

from django.http import HttpResponseRedirect

from . import cloud_storage
from .file_responses import INLINE_EXTENSIONS


def cloud_download_redirect(request, asset, filename):
    """Return a redirect to a freshly signed link, or None when not stored."""
    if not cloud_storage.is_stored(asset):
        return None
    extension = Path(filename or '').suffix.lower()
    inline = extension in INLINE_EXTENSIONS and request.GET.get('download') != '1'
    url = cloud_storage.download_url(asset, attachment_name=None if inline else (filename or True))
    if not url:
        return None
    return HttpResponseRedirect(url)
