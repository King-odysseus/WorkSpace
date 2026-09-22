"""Account-wide notification arrivals, unread state, and installed-app badges."""
from django.db.models import Count, Max, Q
import json
import time

from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .models import NotificationPreference, WorkspaceNotification


def _notification_summary(user):
    notifications = WorkspaceNotification.objects.filter(
        recipient=user,
        workspace__members=user,
    )
    summary = notifications.aggregate(
        unread_count=Count('id', filter=Q(read_at__isnull=True)),
        latest_unread_id=Max('id', filter=Q(read_at__isnull=True)),
        latest_notification_id=Max('id'),
    )
    summary['unread_count'] = summary['unread_count'] or 0
    summary['latest_unread_id'] = summary['latest_unread_id'] or 0
    summary['latest_notification_id'] = summary['latest_notification_id'] or 0
    # Arrival checks must use the newest row even when it was read before the
    # next poll. A chat view can mark its notifications read immediately, so an
    # unread-only high-water mark misses real arrivals and silences them.
    latest = notifications.order_by('-id').only('workspace_id').first() if summary['latest_notification_id'] else None
    preference = NotificationPreference.objects.filter(workspace_id=latest.workspace_id, user=user).first() if latest else None
    summary['sound'] = preference.notification_sound if preference else True
    summary['sound_name'] = preference.notification_sound_name if preference else 'chime'
    summary['volume'] = preference.notification_volume if preference else 70
    return summary


@never_cache
@require_GET
def notification_summary(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    return JsonResponse(_notification_summary(request.user))


@never_cache
@require_GET
def notification_stream(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    try:
        since = max(int(request.GET.get('since', 0)), 0)
    except (TypeError, ValueError):
        since = 0
    try:
        unread = max(int(request.GET.get('unread', -1)), 0)
    except (TypeError, ValueError):
        unread = -1

    def events():
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            summary = _notification_summary(request.user)
            # A read action changes the unread count without creating a new row.
            # Clients that provide their last count are woken for that change too,
            # while older callers keep the original latest-id behavior.
            read_state_changed = unread >= 0 and summary['unread_count'] != unread
            if summary['latest_notification_id'] > since or read_state_changed:
                yield f"id: {summary['latest_notification_id']}\ndata: {json.dumps(summary)}\n\n"
                return
            yield ': keep-alive\n\n'
            time.sleep(5)

    response = StreamingHttpResponse(events(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response
