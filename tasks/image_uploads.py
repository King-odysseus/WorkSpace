"""Validate and normalise the images people upload.

Two places take an image from a browser and serve it back to other browsers:
a profile photo and a workspace logo. Both face the same problem, so both use
this instead of trusting the file.

An uploaded image is not just data. A file named .png whose contents are
something else, a decompression bomb, or EXIF carrying a home address all
arrive through the same form field. Every upload is therefore decoded, checked
against the extension it claims, bounded in size and pixel count, and written
out again as WebP. Re-encoding is what drops the metadata: it is a new file
built from the pixels, not the original with fields removed.
"""

import io
import warnings
from pathlib import Path

from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 5 * 1024 * 1024
MAX_DIMENSION = 8192
MAX_PIXELS = 25_000_000
OUTPUT_BOUNDS = (512, 512)
FORMAT_BY_EXTENSION = {
    '.png': 'PNG',
    '.jpg': 'JPEG',
    '.jpeg': 'JPEG',
    '.gif': 'GIF',
    '.webp': 'WEBP',
}


def validation_error(uploaded_file):
    """Return a user-facing error when an upload is not a safe image."""
    expected_format = FORMAT_BY_EXTENSION.get(Path(uploaded_file.name).suffix.lower())
    if expected_format is None:
        return 'Use a PNG, JPG, GIF, or WebP image.'
    try:
        uploaded_file.seek(0)
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            image = Image.open(uploaded_file)
            width, height = image.size
            detected_format = image.format
            # A .png that decodes as something else is either a mistake or an
            # attempt to get a different parser to run on the bytes.
            if detected_format != expected_format:
                return 'The image contents must match the file extension.'
            if (
                width < 1
                or height < 1
                or width > MAX_DIMENSION
                or height > MAX_DIMENSION
                or width * height > MAX_PIXELS
            ):
                return 'Image dimensions are too large. Use an image up to 8192 pixels per side.'
            image.verify()
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
    ):
        return 'This file is not a valid PNG, JPG, GIF, or WebP image.'
    finally:
        # verify() leaves the handle spent, and the caller still has to save it.
        try:
            uploaded_file.seek(0)
        except (AttributeError, OSError, ValueError):
            pass
    return None


def normalized_image(uploaded_file, name='image.webp', bounds=OUTPUT_BOUNDS):
    """Return a small, metadata-free WebP that is safe to serve to browsers."""
    uploaded_file.seek(0)
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(uploaded_file) as source:
            # Phone photos carry their rotation in EXIF, which the re-encode
            # discards, so the rotation is baked into the pixels first.
            image = ImageOps.exif_transpose(source)
            image.thumbnail(bounds, Image.Resampling.LANCZOS)
            has_alpha = image.mode in {'RGBA', 'LA'} or (
                image.mode == 'P' and 'transparency' in image.info
            )
            normalized = image.convert('RGBA' if has_alpha else 'RGB')

    output = io.BytesIO()
    normalized.save(output, format='WEBP', quality=88, method=6)
    return ContentFile(output.getvalue(), name=name)
