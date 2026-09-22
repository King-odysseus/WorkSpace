"""Account-wide notification arrivals, unread state, and installed-app badges."""
from django.db.models import Count, Max, Q
import json
import time

from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .models import NotificationPreference, WorkspaceNotification


def _notification_summary(user, workspace_id=None, activity_only=False):
    notifications = WorkspaceNotification.objects.filter(
        recipient=user,
        workspace__members=user,
    )
    if workspace_id is not None:
        notifications = notifications.filter(workspace_id=workspace_id)
    if activity_only:
        # The bell and its installed-app badge represent workspace activity.
        # Channel and direct message totals live on the separate Messages view.
        notifications = notifications.exclude(target_type__in=['chat_channel', 'direct_conversation'])
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


def _notification_request_options(request):
    raw_workspace_id = request.GET.get('workspace_id')
    workspace_id = None
    if raw_workspace_id not in {None, ''}:
        try:
            workspace_id = int(raw_workspace_id)
        except (TypeError, ValueError):
            return None, False, JsonResponse({'error': 'workspace_id must be an integer.'}, status=400)
    scope = request.GET.get('scope', '').strip().lower()
    if scope not in {'', 'activity'}:
        return None, False, JsonResponse({'error': 'Unsupported notification scope.'}, status=400)
    return workspace_id, scope == 'activity', None


@never_cache
@require_GET
def notification_summary(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    workspace_id, activity_only, error = _notification_request_options(request)
    if error:
        return error
    return JsonResponse(_notification_summary(request.user, workspace_id=workspace_id, activity_only=activity_only))


@never_cache
@require_GET
def notification_stream(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    workspace_id, activity_only, error = _notification_request_options(request)
    if error:
        return error
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
            summary = _notification_summary(request.user, workspace_id=workspace_id, activity_only=activity_only)
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
