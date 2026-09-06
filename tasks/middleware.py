"""Tracks when each user was last actually active.

UserProfile.presence is self-reported and sticky: someone who picked
"Available" on Monday still reads as available on Friday. last_seen_at is the
observed counterpart, stamped here from real authenticated traffic.
"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone


class LastSeenMiddleware:
    # How stale last_seen_at may get before it is rewritten. Keep it well under
    # the "Active now" threshold in the frontend's formatLastSeen, or members
    # will flicker out of that state between writes.
    REFRESH_AFTER = timedelta(minutes=2)

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        self._stamp(request)
        return self.get_response(request)

    @staticmethod
    def cache_key(user_id):
        return f'last-seen-stamped:{user_id}'

    def _stamp(self, request):
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return
        # Throttle in the cache, not the database. This runs on every single
        # request, including the pulse endpoint that polls from every open tab,
        # so the steady-state path must cost zero queries - see the query-count
        # guards in tasks/tests.py. Doing the throttling with a WHERE clause
        # instead still spends a round trip per request to match no rows.
        key = self.cache_key(user.pk)
        if cache.get(key):
            return
        cache.set(key, True, timeout=int(self.REFRESH_AFTER.total_seconds()))

        # Imported lazily: middleware is constructed during app loading, before
        # the app registry is ready for a module-level model import.
        from .models import UserProfile

        # update_or_create rather than a plain update: profiles are created
        # lazily, only when someone uploads an avatar or sets presence, so most
        # users have no row and would otherwise never record a last-seen time.
        UserProfile.objects.update_or_create(user_id=user.pk, defaults={'last_seen_at': timezone.now()})
