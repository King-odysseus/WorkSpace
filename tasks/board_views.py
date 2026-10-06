"""Who is on a board: read and change a project's or workstream's member list."""

import json

from django.contrib.auth.models import User
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .board_access import is_leader, visible_projects, visible_workstreams
from .models import Membership
from .views import record_activity, require_workspace_member


def _people(workspace_id, ids):
    """The workspace members with these user ids, as they are shown in the member picker."""
    rows = Membership.objects.filter(workspace_id=workspace_id, user_id__in=ids).select_related('user')
    return [
        {
            'id': row.user_id,
            'name': row.user.get_full_name() or row.user.email,
            'email': row.user.email,
            'role': row.role,
        }
        for row in rows
    ]


@require_http_methods(['GET', 'PUT'])
def board_members(request, workspace_id, kind, board_id):
    """The people on one board. Anyone who can see the board may read the list;
    only an owner or manager may change it."""
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if kind == 'project':
        board = visible_projects(workspace_id, request.user, membership).filter(id=board_id).first()
    elif kind == 'workstream':
        board = visible_workstreams(workspace_id, request.user, membership).filter(id=board_id).first()
    else:
        return JsonResponse({'error': 'Boards are projects or workstreams.'}, status=404)
    if board is None:
        return JsonResponse({'error': 'Board was not found.'}, status=404)

    if request.method == 'GET':
        ids = list(board.members.values_list('id', flat=True))
        return JsonResponse({'member_ids': ids, 'members': _people(workspace_id, ids), 'is_private': board.is_private})

    if not is_leader(membership):
        return JsonResponse({'error': 'Only an owner or manager can change who is on a board.'}, status=403)
    if board.is_private:
        return JsonResponse({'error': 'A private board belongs to the person who made it.'}, status=403)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    raw = payload.get('member_ids')
    if not isinstance(raw, list):
        return JsonResponse({'error': 'member_ids must be a list.'}, status=400)
    try:
        requested = list(dict.fromkeys(int(value) for value in raw))
    except (TypeError, ValueError):
        return JsonResponse({'error': 'member_ids must contain valid user IDs.'}, status=400)
    people = set(Membership.objects.filter(workspace_id=workspace_id, user_id__in=requested).values_list('user_id', flat=True))
    if len(people) != len(requested):
        return JsonResponse({'error': 'Every board member must belong to this workspace.'}, status=404)

    previous = set(board.members.values_list('id', flat=True))
    board.members.set(User.objects.filter(id__in=requested))
    added = set(requested) - previous
    removed = previous - set(requested)
    if added or removed:
        actor = request.user.get_full_name() or request.user.email
        record_activity(
            workspace_id, request.user, 'board_members_changed',
            f'{actor} changed who is on {board.name}: {len(added)} added, {len(removed)} removed.',
            target_type='project' if kind == 'project' else 'workstream', target_id=board.id,
        )
    ids = list(board.members.values_list('id', flat=True))
    return JsonResponse({'member_ids': ids, 'members': _people(workspace_id, ids), 'is_private': board.is_private})
