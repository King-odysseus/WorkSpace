"""Private day planners.

Every view here answers for exactly one person. Rows are scoped by
``owner=request.user``, the owner is taken from the session and never from the
request body, and an id belonging to somebody else is a 404 rather than a 403 so
the endpoints do not confirm that another member's planner exists.

Nothing in this module is gated on a capability. A member's own day is not team
work, so `create_tasks` and friends are irrelevant here: membership of the
workspace is the whole requirement.
"""

import json
from datetime import date, time

from django.db import IntegrityError, transaction
from django.db.models import Count, Max
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_http_methods

from .models import PersonalPlanner, PersonalTask
from .views import require_workspace_member


DEFAULT_PLANNER_NAME = 'My day'

# A member can make as many planners as they like, but the list is rendered in
# full on one page, so it is not left unbounded.
MAX_PLANNERS = 50

MAX_TITLE = 300
MAX_NOTES = 4000


def _payload(request):
    try:
        return json.loads(request.body or '{}'), None
    except json.JSONDecodeError:
        return None, JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)


def _planners_for(user, workspace_id):
    return PersonalPlanner.objects.filter(workspace_id=workspace_id, owner=user).annotate(task_count=Count('tasks'))


def _owned_planner(user, workspace_id, planner_id):
    """Return the caller's planner, or None. Never resolves another member's."""
    try:
        planner_id = int(planner_id)
    except (TypeError, ValueError):
        return None
    return PersonalPlanner.objects.filter(id=planner_id, workspace_id=workspace_id, owner=user).first()


def _owned_task(user, workspace_id, task_id):
    """Same as _owned_planner: scoped to the workspace in the URL as well as the
    owner, so a task is never reachable through another workspace the member
    also belongs to."""
    try:
        task_id = int(task_id)
    except (TypeError, ValueError):
        return None
    return PersonalTask.objects.filter(id=task_id, owner=user, planner__workspace_id=workspace_id).first()


def _default_planner(user, workspace_id):
    """The planner a task lands in when the caller did not name one.

    Created on demand rather than seeded at signup so the page works with no
    setup step, and reused by name so it is not recreated after a rename.
    """
    planner = _planners_for(user, workspace_id).order_by('position', 'id').first()
    if planner is not None:
        return planner
    planner, _ = PersonalPlanner.objects.get_or_create(
        workspace_id=workspace_id,
        owner=user,
        name=DEFAULT_PLANNER_NAME,
        defaults={'position': 0},
    )
    return planner


def _next_position(model, **filters):
    highest = model.objects.filter(**filters).aggregate(top=Max('position'))['top']
    return 0 if highest is None else highest + 1


def _parse_due_date(value):
    """Accept a YYYY-MM-DD date or an empty value, which clears the date."""
    if value in (None, ''):
        return None, None
    try:
        return date.fromisoformat(str(value)), None
    except (TypeError, ValueError):
        return None, JsonResponse({'error': 'due_date must use YYYY-MM-DD format.'}, status=400)


def _parse_due_time(value):
    """Accept HH:MM (or HH:MM:SS) or an empty value, which clears the time."""
    if value in (None, ''):
        return None, None
    try:
        return time.fromisoformat(str(value)), None
    except (TypeError, ValueError):
        return None, JsonResponse({'error': 'due_time must use HH:MM format.'}, status=400)


LONE_TIME_ERROR = 'A due time needs a due date.'


@require_http_methods(['GET', 'POST'])
def personal_planner_list(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        planners = _planners_for(membership.user, workspace_id).order_by('position', 'id')
        tasks = PersonalTask.objects.filter(owner=membership.user, planner__workspace_id=workspace_id).order_by('position', 'id')
        return JsonResponse({
            'planners': [planner.as_dict() for planner in planners],
            'tasks': [task.as_dict() for task in tasks],
        })

    payload, error = _payload(request)
    if error:
        return error
    name = str(payload.get('name', '')).strip()
    if not name:
        return JsonResponse({'error': 'A planner name is required.'}, status=400)
    if len(name) > 120:
        return JsonResponse({'error': 'Planner names must be 120 characters or fewer.'}, status=400)
    if PersonalPlanner.objects.filter(workspace_id=workspace_id, owner=membership.user).count() >= MAX_PLANNERS:
        return JsonResponse({'error': f'You can keep up to {MAX_PLANNERS} planners.'}, status=400)
    try:
        planner = PersonalPlanner.objects.create(
            workspace_id=workspace_id,
            owner=membership.user,
            name=name,
            position=_next_position(PersonalPlanner, workspace_id=workspace_id, owner=membership.user),
        )
    except IntegrityError:
        return JsonResponse({'error': 'You already have a planner with that name.'}, status=400)
    return JsonResponse({'planner': planner.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def personal_planner_detail(request, workspace_id, planner_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    planner = _owned_planner(membership.user, workspace_id, planner_id)
    if planner is None:
        return JsonResponse({'error': 'Planner was not found.'}, status=404)
    if request.method == 'DELETE':
        planner.delete()
        return JsonResponse({'deleted': planner.id})

    payload, error = _payload(request)
    if error:
        return error
    fields = []
    if 'name' in payload:
        name = str(payload['name']).strip()
        if not name:
            return JsonResponse({'error': 'A planner name is required.'}, status=400)
        if len(name) > 120:
            return JsonResponse({'error': 'Planner names must be 120 characters or fewer.'}, status=400)
        planner.name = name
        fields.append('name')
    if 'position' in payload:
        try:
            planner.position = max(0, int(payload['position']))
        except (TypeError, ValueError):
            return JsonResponse({'error': 'position must be a number.'}, status=400)
        fields.append('position')
    if not fields:
        return JsonResponse({'error': 'Nothing to update.'}, status=400)
    try:
        planner.save(update_fields=fields)
    except IntegrityError:
        return JsonResponse({'error': 'You already have a planner with that name.'}, status=400)
    return JsonResponse({'planner': planner.as_dict()})


@require_http_methods(['POST'])
def personal_task_list(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    payload, error = _payload(request)
    if error:
        return error
    title = str(payload.get('title', '')).strip()
    if not title:
        return JsonResponse({'error': 'A title is required.'}, status=400)
    if len(title) > MAX_TITLE:
        return JsonResponse({'error': f'Titles must be {MAX_TITLE} characters or fewer.'}, status=400)

    if payload.get('planner_id') in (None, ''):
        planner = _default_planner(membership.user, workspace_id)
    else:
        planner = _owned_planner(membership.user, workspace_id, payload.get('planner_id'))
        if planner is None:
            return JsonResponse({'error': 'Planner was not found.'}, status=404)
    due_date, error = _parse_due_date(payload.get('due_date'))
    if error:
        return error
    due_time, error = _parse_due_time(payload.get('due_time'))
    if error:
        return error
    if due_time is not None and due_date is None:
        return JsonResponse({'error': LONE_TIME_ERROR}, status=400)
    notes = str(payload.get('notes', ''))[:MAX_NOTES]

    task = PersonalTask.objects.create(
        planner=planner,
        owner=membership.user,
        title=title,
        notes=notes,
        due_date=due_date,
        due_time=due_time,
        position=_next_position(PersonalTask, planner=planner),
    )
    return JsonResponse({'task': task.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def personal_task_detail(request, workspace_id, task_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    task = _owned_task(membership.user, workspace_id, task_id)
    if task is None:
        return JsonResponse({'error': 'Task was not found.'}, status=404)
    if request.method == 'DELETE':
        task.delete()
        return JsonResponse({'deleted': task.id})

    payload, error = _payload(request)
    if error:
        return error
    fields = []
    if 'title' in payload:
        title = str(payload['title']).strip()
        if not title:
            return JsonResponse({'error': 'A title is required.'}, status=400)
        if len(title) > MAX_TITLE:
            return JsonResponse({'error': f'Titles must be {MAX_TITLE} characters or fewer.'}, status=400)
        task.title = title
        fields.append('title')
    if 'notes' in payload:
        task.notes = str(payload['notes'])[:MAX_NOTES]
        fields.append('notes')
    if 'due_date' in payload or 'due_time' in payload:
        # Resolved as a pair, because the date decides whether the time is part of
        # a moment or an orphan. Clearing the date drops the time with it, so a
        # client that only manages dates cannot leave a half-set moment behind.
        date_sent = 'due_date' in payload
        time_sent = 'due_time' in payload
        due_date = task.due_date
        if date_sent:
            due_date, error = _parse_due_date(payload['due_date'])
            if error:
                return error
        due_time = task.due_time
        if time_sent:
            due_time, error = _parse_due_time(payload['due_time'])
            if error:
                return error
        if due_time is not None and due_date is None:
            if time_sent:
                return JsonResponse({'error': LONE_TIME_ERROR}, status=400)
            due_time = None
        # A field that was sent is written even when it matches, the way every other
        # field in this view behaves; the time the date cleared is written because
        # the row changed, not because the client named it.
        if date_sent or task.due_date != due_date:
            task.due_date = due_date
            fields.append('due_date')
        if time_sent or task.due_time != due_time:
            task.due_time = due_time
            fields.append('due_time')
    if 'is_done' in payload:
        task.is_done = bool(payload['is_done'])
        # Stamped here rather than in the client, so "when was this finished" is
        # the server's answer and cannot be back-dated by a request body.
        task.completed_at = timezone.now() if task.is_done else None
        fields.extend(['is_done', 'completed_at'])
    if 'position' in payload:
        try:
            task.position = max(0, int(payload['position']))
        except (TypeError, ValueError):
            return JsonResponse({'error': 'position must be a number.'}, status=400)
        fields.append('position')
    if 'planner_id' in payload:
        planner = _owned_planner(membership.user, workspace_id, payload.get('planner_id'))
        if planner is None:
            return JsonResponse({'error': 'Planner was not found.'}, status=404)
        task.planner = planner
        fields.append('planner')
    if not fields:
        return JsonResponse({'error': 'Nothing to update.'}, status=400)
    with transaction.atomic():
        task.save(update_fields=fields + ['updated_at'])
    return JsonResponse({'task': task.as_dict()})
