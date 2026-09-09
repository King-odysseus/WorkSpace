"""Account-wide unread state for notification sounds and installed-app badges."""
from django.db.models import Count, Max
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .models import WorkspaceNotification


@never_cache
@require_GET
def notification_summary(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    summary = WorkspaceNotification.objects.filter(
        recipient=request.user,
        workspace__members=request.user,
        read_at__isnull=True,
    ).aggregate(unread_count=Count('id'), latest_unread_id=Max('id'))
    summary['latest_unread_id'] = summary['latest_unread_id'] or 0
    return JsonResponse(summary)
