"""Milestones: dated checkpoints on a plan. Everyone in the workspace can see them;
owners and managers create, change and remove them. Tasks are attached from the task
(``tasks/<id>/milestone/``), which needs the right to edit team tasks."""

import json

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .board_access import task_is_visible
from .models import Milestone, Project, Task
from .request_views import parse_date
from .views import require_workspace_member

LEADER_ROLES = ('owner', 'manager')


def _payload(request):
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return None, JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    return (data, None) if isinstance(data, dict) else (None, JsonResponse({'error': 'Request body must be an object.'}, status=400))


def _counts(milestones):
    counts = {milestone.id: [0, 0] for milestone in milestones}
    for milestone_id, status in Task.objects.filter(milestone_id__in=counts, state='active').exclude(status='cancelled').values_list('milestone_id', 'status'):
        counts[milestone_id][0] += 1
        counts[milestone_id][1] += 1 if status == 'done' else 0
    return counts


def _serialize(milestones):
    today = timezone.localdate()
    counts = _counts(milestones)
    return [milestone.as_dict(*counts[milestone.id], today=today) for milestone in milestones]


def _project(workspace_id, value):
    if value in (None, ''):
        return None, None
    try:
        project = Project.objects.filter(id=int(value), workspace_id=workspace_id).first()
    except (TypeError, ValueError):
        project = None
    if project is None:
        return None, JsonResponse({'error': 'Project was not found.'}, status=400)
    return project, None


@require_http_methods(['GET', 'POST'])
def milestones(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        queryset = Milestone.objects.filter(workspace_id=workspace_id)
        if request.GET.get('project_id'):
            queryset = queryset.filter(project_id=request.GET['project_id'])
        return JsonResponse({'milestones': _serialize(list(queryset))})
    if membership.role not in LEADER_ROLES:
        return JsonResponse({'error': 'Only owners and managers can add milestones.'}, status=403)
    data, error = _payload(request)
    if error:
        return error
    title = str(data.get('title') or '').strip()
    if not title or len(title) > 200:
        return JsonResponse({'error': 'A milestone needs a title of up to 200 characters.'}, status=400)
    due, error = parse_date(data.get('due_date'))
    if error:
        return error
    if due is None:
        return JsonResponse({'error': 'A milestone needs a date.'}, status=400)
    project, error = _project(workspace_id, data.get('project_id'))
    if error:
        return error
    milestone = Milestone.objects.create(workspace_id=workspace_id, project=project, title=title, due_date=due, notes=str(data.get('notes') or '')[:2000], created_by=request.user)
    return JsonResponse({'milestone': _serialize([milestone])[0]}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def milestone_detail(request, workspace_id, milestone_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if membership.role not in LEADER_ROLES:
        return JsonResponse({'error': 'Only owners and managers can change milestones.'}, status=403)
    milestone = Milestone.objects.filter(id=milestone_id, workspace_id=workspace_id).first()
    if milestone is None:
        return JsonResponse({'error': 'Milestone was not found.'}, status=404)
    if request.method == 'DELETE':
        milestone.delete()
        return JsonResponse({'deleted': milestone_id})
    data, error = _payload(request)
    if error:
        return error
    if 'title' in data:
        title = str(data['title']).strip()
        if not title or len(title) > 200:
            return JsonResponse({'error': 'A milestone needs a title of up to 200 characters.'}, status=400)
        milestone.title = title
    if 'due_date' in data:
        due, error = parse_date(data['due_date'])
        if error:
            return error
        if due is None:
            return JsonResponse({'error': 'A milestone needs a date.'}, status=400)
        milestone.due_date = due
    if 'notes' in data:
        milestone.notes = str(data['notes'] or '')[:2000]
    if 'project_id' in data:
        project, error = _project(workspace_id, data['project_id'])
        if error:
            return error
        milestone.project = project
    if 'completed' in data:
        milestone.completed_at = timezone.now() if data['completed'] else None
    milestone.save()
    return JsonResponse({'milestone': _serialize([milestone])[0]})


@require_http_methods(['PUT'])
def task_milestone(request, task_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    task = Task.objects.filter(id=task_id).first()
    if task is None:
        return JsonResponse({'error': 'Task was not found.'}, status=404)
    membership, error = require_workspace_member(request, task.workspace_id)
    if error:
        return error
    if not task_is_visible(task, request.user, membership):
        return JsonResponse({'error': 'Task was not found.'}, status=404)
    if not membership.has_permission('edit_team_tasks'):
        return JsonResponse({'error': 'You do not have permission to attach tasks to milestones.'}, status=403)
    data, error = _payload(request)
    if error:
        return error
    milestone_id = data.get('milestone_id')
    milestone = None
    if milestone_id not in (None, ''):
        milestone = Milestone.objects.filter(id=milestone_id, workspace_id=task.workspace_id).first()
        if milestone is None:
            return JsonResponse({'error': 'Milestone was not found.'}, status=404)
    task.milestone = milestone
    task.save(update_fields=['milestone', 'updated_at'])
    return JsonResponse({'task': task.as_dict()})
