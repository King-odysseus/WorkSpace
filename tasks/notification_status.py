"""Account-wide unread state for notification sounds and installed-app badges."""
from django.db.models import Count, Max
import json
import time

from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .models import WorkspaceNotification


def _notification_summary(user):
    summary = WorkspaceNotification.objects.filter(
        recipient=user,
        workspace__members=user,
        read_at__isnull=True,
    ).aggregate(unread_count=Count('id'), latest_unread_id=Max('id'))
    summary['latest_unread_id'] = summary['latest_unread_id'] or 0
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

    def events():
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            summary = _notification_summary(request.user)
            if summary['latest_unread_id'] > since:
                yield f"id: {summary['latest_unread_id']}\ndata: {json.dumps(summary)}\n\n"
                return
            yield ': keep-alive\n\n'
            time.sleep(5)

    response = StreamingHttpResponse(events(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response
