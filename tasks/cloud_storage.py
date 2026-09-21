"""Durable off-container storage for uploads, backed by Cloudinary.

Uploads are written to the container's own disk by default, and Railway's
filesystem is ephemeral: every redeploy wipes media/ and private_media/ while
the rows that name those paths survive in Postgres. Pointing CLOUDINARY_URL at a
Cloudinary account makes new uploads outlive a deploy.

Everything here is optional. With no CLOUDINARY_URL the helpers report "not
stored" and every caller falls back to the local FileSystemStorage it already
used, so development and the test suite are unaffected. An upload failure is
logged and non-fatal for the same reason: the local copy is still there.

Access control stays in Django. Assets are uploaded with a non-public delivery
type, so the bare Cloudinary URL is not fetchable, and the membership-checked
download views mint a short-lived signed URL per request. That is the difference
that matters against the older behaviour of handing out a permanent public
secure_url, which anyone could then pass on.

Two limits of the free plan are worth knowing:

* Delivery URLs must carry the asset version. A version-less URL keeps serving
  the previous bytes from cache after a re-upload.
* Real expiry is only available on the download endpoint (private_download_url,
  used for documents). Signed delivery URLs for transformed images are
  unguessable but do not expire on their own; timed tokens are an Enterprise
  feature. Avatars use that path deliberately, since a workspace-mate can fetch
  the same image through the API anyway.
"""

import logging
import os
import time

from django.conf import settings as django_settings

logger = logging.getLogger(__name__)

# How long a minted document download link stays valid.
SIGNED_URL_TTL_SECONDS = getattr(django_settings, 'WORKSPACE_CLOUDINARY_URL_TTL', 300)

# Documents are uploaded as 'private': not deliverable without a signed, expiring
# download link. Images we transform (avatars) are 'authenticated': deliverable
# only through a signed URL, which is what lets Cloudinary resize them for us.
PRIVATE = 'private'
AUTHENTICATED = 'authenticated'


# What .env.example ships. A deployment that copied the file without filling it
# in is not configured, however much it looks like it from the variable alone.
PLACEHOLDER_URL = 'cloudinary://api_key:api_secret@cloud_name'


def is_configured():
    """True when a real Cloudinary account is wired up for this environment."""
    if not getattr(django_settings, 'WORKSPACE_CLOUD_STORAGE_ENABLED', True):
        return False
    configured_url = os.environ.get('CLOUDINARY_URL', '').strip()
    return bool(configured_url) and configured_url != PLACEHOLDER_URL


def _configured_cloudinary():
    """Import and configure the SDK, or return None when it is unusable.

    The package is an optional runtime dependency: a deployment without
    CLOUDINARY_URL never needs it, and local checkouts often do not install it.
    """
    if not is_configured():
        return None
    try:
        import cloudinary
        cloudinary.config()
        return cloudinary
    except Exception:
        logger.exception('Cloudinary is configured but the SDK could not be loaded')
        return None


def upload(uploaded, folder, *, resource_type='auto', delivery_type=PRIVATE):
    """Store an uploaded file and return the fields that locate it again.

    Returns an empty dict when Cloudinary is not configured or the upload fails,
    which every caller treats as "keep using the local copy".
    """
    cloudinary = _configured_cloudinary()
    if cloudinary is None:
        return {}
    try:
        import cloudinary.uploader
        # The caller has usually read the file already, to size or validate it.
        uploaded.seek(0)
        result = cloudinary.uploader.upload(
            uploaded, folder=folder, resource_type=resource_type, type=delivery_type,
        )
    except Exception:
        logger.exception('Cloudinary upload failed for folder %s', folder)
        return {}
    return {
        'public_id': result.get('public_id', ''),
        # 'auto' resolves to image/video/raw at upload time, so record what it chose.
        'resource_type': result.get('resource_type', ''),
        'type': result.get('type', delivery_type),
        # Stored as a string: it only ever goes back into a URL.
        'version': str(result.get('version', '')),
        # Empty for raw assets, whose public_id already carries the extension.
        'format': result.get('format', '') or '',
    }


def upload_stored_file(field_file, folder, **options):
    """Upload the copy Django just wrote, rather than the request's file object.

    Saving a FileField can consume or move the uploaded file: anything above
    FILE_UPLOAD_MAX_MEMORY_SIZE arrives as a temporary file on disk, which
    FileSystemStorage moves into place instead of copying. Re-reading the request
    object after that is unreliable, so the durable copy is made from what is now
    on disk, which is the same bytes either way.
    """
    if not is_configured() or not field_file:
        return {}
    try:
        with field_file.open('rb') as stored:
            return upload(stored, folder, **options)
    except (FileNotFoundError, OSError, ValueError):
        logger.exception('Could not re-read the stored upload for %s', folder)
        return {}


def is_stored(asset):
    """True when the asset dict actually points at something in Cloudinary."""
    return bool(asset) and bool(asset.get('public_id'))


def legacy_asset(public_id):
    """Describe an asset uploaded before this module existed.

    Those uploads took the SDK defaults, so they are public image/upload assets.
    Only the delete path needs this: their delivery URL is stored on the row.
    """
    if not public_id:
        return {}
    return {'public_id': public_id, 'resource_type': 'image', 'type': 'upload'}


def download_url(asset, *, attachment_name=None):
    """Mint an expiring download link for a stored document.

    ``attachment_name`` forces a download under that filename; leaving it None
    lets the browser display the file inline, which is how the local path serves
    previewable types today.
    """
    cloudinary = _configured_cloudinary()
    if cloudinary is None or not is_stored(asset):
        return ''
    try:
        import cloudinary.utils
        return cloudinary.utils.private_download_url(
            asset['public_id'],
            asset.get('format', ''),
            resource_type=asset.get('resource_type') or 'raw',
            type=asset.get('type') or PRIVATE,
            attachment=attachment_name if attachment_name else False,
            expires_at=int(time.time()) + SIGNED_URL_TTL_SECONDS,
        )
    except Exception:
        logger.exception('Could not sign a download URL for %s', asset.get('public_id'))
        return ''


def delivery_url(asset, *, transformation=None):
    """Sign a delivery URL for a stored image, optionally transformed.

    The version is always included: without it the CDN keeps serving the bytes
    from before a re-upload.
    """
    cloudinary = _configured_cloudinary()
    if cloudinary is None or not is_stored(asset):
        return ''
    try:
        import cloudinary.utils
        url, _ = cloudinary.utils.cloudinary_url(
            asset['public_id'],
            resource_type=asset.get('resource_type') or 'image',
            type=asset.get('type') or AUTHENTICATED,
            version=asset.get('version') or None,
            format=asset.get('format') or None,
            transformation=transformation,
            sign_url=True,
            secure=True,
        )
        return url
    except Exception:
        logger.exception('Could not sign a delivery URL for %s', asset.get('public_id'))
        return ''


def destroy(asset):
    """Remove a stored asset. Failure is logged, never raised.

    A delete that does not reach Cloudinary leaves an orphan there, which is a
    billing annoyance rather than a correctness problem: the row that named it is
    going away regardless.
    """
    cloudinary = _configured_cloudinary()
    if cloudinary is None or not is_stored(asset):
        return False
    try:
        import cloudinary.uploader
        cloudinary.uploader.destroy(
            asset['public_id'],
            resource_type=asset.get('resource_type') or 'raw',
            type=asset.get('type') or PRIVATE,
            invalidate=True,
        )
        return True
    except Exception:
        logger.exception('Cloudinary delete failed for %s', asset.get('public_id'))
        return False
