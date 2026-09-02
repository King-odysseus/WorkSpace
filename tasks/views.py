import json
from datetime import date

from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from .models import Membership, Project, Task, Workspace


def user_workspace_ids(user):
    return user.workspace_memberships.values_list('workspace_id', flat=True)


def requested_workspace(request, user):
    workspace_id = request.headers.get('X-Workspace-Id')
    memberships = user_workspace_ids(user)
    if workspace_id:
        try:
            workspace_id = int(workspace_id)
        except ValueError:
            return None, JsonResponse({'error': 'Workspace ID must be an integer.'}, status=400)
        if workspace_id not in memberships:
            return None, JsonResponse({'error': 'You do not belong to this workspace.'}, status=403)
        return workspace_id, None
    first_workspace_id = memberships.first()
    if first_workspace_id is None:
        return None, JsonResponse({'error': 'Join a workspace before creating tasks.'}, status=400)
    return first_workspace_id, None


def require_authenticated(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    return None


def require_workspace_member(request, workspace_id):
    if not request.user.is_authenticated:
        return None, JsonResponse({'error': 'Authentication is required.'}, status=401)
    membership = Membership.objects.select_related('workspace', 'user').filter(workspace_id=workspace_id, user=request.user).first()
    if membership is None:
        return None, JsonResponse({'error': 'You do not belong to this workspace.'}, status=403)
    return membership, None


def health(request):
    return JsonResponse({'status': 'ok', 'service': 'workspace-api'})


@require_http_methods(['GET', 'POST'])
def task_list(request):
    auth_error = require_authenticated(request)
    if auth_error:
        return auth_error

    if request.method == 'GET':
        tasks = Task.objects.filter(workspace_id__in=user_workspace_ids(request.user))
        return JsonResponse({'tasks': [task.as_dict() for task in tasks]})

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)

    title = str(payload.get('title', '')).strip()
    if not title:
        return JsonResponse({'error': 'Task title is required.'}, status=400)
    if len(title) > 200:
        return JsonResponse({'error': 'Task title must be 200 characters or fewer.'}, status=400)

    workspace_id, error = requested_workspace(request, request.user)
    if error:
        return error

    task = Task.objects.create(
        workspace_id=workspace_id,
        title=title,
        description=str(payload.get('description', '')).strip(),
        assignee_name=str(payload.get('assignee_name', '')).strip(),
        project=str(payload.get('project', '')).strip(),
    )
    return JsonResponse({'task': task.as_dict()}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def task_detail(request, task_id):
    task = get_object_or_404(Task, id=task_id, workspace_id__in=user_workspace_ids(request.user)) if request.user.is_authenticated else None
    if task is None:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)

    if request.method == 'GET':
        return JsonResponse({'task': task.as_dict()})

    if request.method == 'DELETE':
        task.delete()
        return JsonResponse({'deleted': task_id})

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)

    allowed_fields = {'title', 'description', 'assignee_name', 'project', 'status', 'due_date'}
    unknown_fields = set(payload) - allowed_fields
    if unknown_fields:
        return JsonResponse({'error': f'Unsupported fields: {", ".join(sorted(unknown_fields))}.'}, status=400)

    if 'title' in payload:
        title = str(payload['title']).strip()
        if not title or len(title) > 200:
            return JsonResponse({'error': 'Task title must be between 1 and 200 characters.'}, status=400)
        task.title = title

    if 'status' in payload:
        valid_statuses = {choice[0] for choice in Task.STATUS_CHOICES}
        if payload['status'] not in valid_statuses:
            return JsonResponse({'error': 'Invalid task status.'}, status=400)
        task.status = payload['status']

    if 'due_date' in payload and payload['due_date']:
        try:
            task.due_date = date.fromisoformat(str(payload['due_date']))
        except ValueError:
            return JsonResponse({'error': 'Due date must use YYYY-MM-DD format.'}, status=400)

    for field in {'description', 'assignee_name', 'project'} & set(payload):
        setattr(task, field, str(payload[field]).strip() or None)

    task.save()
    return JsonResponse({'task': task.as_dict()})


@require_http_methods(['GET'])
def member_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    members = Membership.objects.filter(workspace_id=workspace_id).select_related('user')
    return JsonResponse({'members': [member.as_dict() for member in members]})


@require_http_methods(['GET', 'POST'])
def project_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        projects = Project.objects.filter(workspace_id=workspace_id)
        return JsonResponse({'projects': [project.as_dict() for project in projects]})

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    name = str(payload.get('name', '')).strip()
    if not name:
        return JsonResponse({'error': 'Project name is required.'}, status=400)
    if len(name) > 160:
        return JsonResponse({'error': 'Project name must be 160 characters or fewer.'}, status=400)
    if Project.objects.filter(workspace_id=workspace_id, name=name).exists():
        return JsonResponse({'error': 'A project with this name already exists in the workspace.'}, status=409)
    project = Project.objects.create(workspace_id=workspace_id, name=name, description=str(payload.get('description', '')).strip())
    return JsonResponse({'project': project.as_dict()}, status=201)
