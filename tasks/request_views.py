"""Requests: a member asks the people who run the workspace for something.

Members see only their own. Anyone with the manage_requests permission (owners
and managers by default) sees every request, and can approve, decline or answer
it. The person who asked is told the outcome. A request memo (see memo_views) is
the other direction: a manager asks the team.
"""

import json
from datetime import date

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import Membership, WorkRequest
from .views import create_notification, require_workspace_member

TITLE_LIMIT = 160
DETAILS_LIMIT = 3000
NOTE_LIMIT = 1000
OPEN_LIMIT = 50  # pending requests one person can have at a time


def json_body(request):
    try:
        return json.loads(request.body or '{}'), None
    except json.JSONDecodeError:
        return None, JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)


def parse_date(value):
    if value in (None, ''):
        return None, None
    try:
        return date.fromisoformat(str(value)), None
    except ValueError:
        return None, JsonResponse({'error': 'Dates must use YYYY-MM-DD format.'}, status=400)


def notify_people(workspace_id, recipients, kind, title, body, target_type, target_id):
    for user in recipients:
        create_notification(workspace_id, user, kind, title[:200], body[:200], target_type=target_type, target_id=target_id, notify_webhooks=False)


def people_with(workspace_id, permission, exclude=None):
    members = Membership.objects.filter(workspace_id=workspace_id).select_related('user')
    return [m.user for m in members if m.has_permission(permission) and m.user_id != getattr(exclude, 'id', None)]


@require_http_methods(['GET', 'POST'])
def work_request_list(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    can_manage = membership.has_permission('manage_requests')
    if request.method == 'GET':
        items = WorkRequest.objects.filter(workspace_id=workspace_id).select_related('requester', 'reviewer')
        if not can_manage:
            items = items.filter(requester=request.user)
        return JsonResponse({'requests': [item.as_dict() for item in items[:200]], 'can_manage': can_manage})
    payload, error = json_body(request)
    if error:
        return error
    title = str(payload.get('title', '')).strip()
    details = str(payload.get('details', '')).strip()
    if not title:
        return JsonResponse({'error': 'A request needs a title.'}, status=400)
    if len(title) > TITLE_LIMIT:
        return JsonResponse({'error': f'The title must be {TITLE_LIMIT} characters or fewer.'}, status=400)
    if len(details) > DETAILS_LIMIT:
        return JsonResponse({'error': f'The details must be {DETAILS_LIMIT} characters or fewer.'}, status=400)
    needed_by, error = parse_date(payload.get('needed_by'))
    if error:
        return error
    if WorkRequest.objects.filter(workspace_id=workspace_id, requester=request.user, status='pending').count() >= OPEN_LIMIT:
        return JsonResponse({'error': 'You have too many open requests. Wait for some to be answered.'}, status=400)
    item = WorkRequest.objects.create(workspace_id=workspace_id, requester=request.user, title=title, details=details, needed_by=needed_by)
    who = request.user.get_full_name() or request.user.email
    notify_people(workspace_id, people_with(workspace_id, 'manage_requests', exclude=request.user), 'request',
                  f'Request from {who}: {title}', details or title, 'request', item.id)
    return JsonResponse({'request': item.as_dict()}, status=201)


@require_http_methods(['PATCH'])
def work_request_detail(request, workspace_id, request_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    item = WorkRequest.objects.filter(id=request_id, workspace_id=workspace_id).select_related('requester', 'reviewer').first()
    can_manage = membership.has_permission('manage_requests')
    # Somebody else's request is a 404 for a member, so it does not confirm it exists.
    if item is None or (item.requester_id != request.user.id and not can_manage):
        return JsonResponse({'error': 'Request was not found.'}, status=404)
    payload, error = json_body(request)
    if error:
        return error
    decision = payload.get('decision')
    if item.status != 'pending':
        return JsonResponse({'error': 'That request has already been answered.'}, status=409)
    if decision == 'cancel':
        if item.requester_id != request.user.id:
            return JsonResponse({'error': 'Only the person who asked can withdraw a request.'}, status=403)
        item.status = 'cancelled'
        item.save(update_fields=['status'])
        return JsonResponse({'request': item.as_dict()})
    if decision not in ('approved', 'declined'):
        return JsonResponse({'error': 'Choose approved, declined or cancel.'}, status=400)
    if not can_manage:
        return JsonResponse({'error': 'You do not have permission to answer requests.'}, status=403)
    if item.requester_id == request.user.id:
        return JsonResponse({'error': 'You cannot answer your own request.'}, status=403)
    note = str(payload.get('note', '')).strip()
    if len(note) > NOTE_LIMIT:
        return JsonResponse({'error': f'The note must be {NOTE_LIMIT} characters or fewer.'}, status=400)
    item.status, item.review_note, item.reviewer, item.reviewed_at = decision, note, request.user, timezone.now()
    item.save(update_fields=['status', 'review_note', 'reviewer', 'reviewed_at'])
    notify_people(workspace_id, [item.requester], 'request', f'Your request was {decision}: {item.title}', note or item.title, 'request', item.id)
    return JsonResponse({'request': item.as_dict()})
