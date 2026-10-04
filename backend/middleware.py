"""Project-level middleware."""

from django.middleware.gzip import GZipMiddleware


class SelectiveGZipMiddleware(GZipMiddleware):
    """Compress responses, except the ones that are a stream.

    Django's own GZipMiddleware compresses streaming responses too, by running
    the server-sent event stream through a compressor. That stream carries the
    unread badge: it is a few dozen bytes per event, and the thing that matters
    about it is that each event arrives when it happens. A compressor holds
    bytes back until it has a block's worth, which changes exactly that, for a
    payload it could not meaningfully shrink anyway.

    Everything else behaves as Django's middleware does, including leaving
    short responses alone and skipping anything that has already been encoded.
    """

    def process_response(self, request, response):
        if response.streaming:
            return response
        return super().process_response(request, response)
