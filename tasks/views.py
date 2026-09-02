import json
from datetime import date

from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from .models import Task


def health(request):
    return JsonResponse({'status': 'ok', 'service': 'workspace-api'})


@require_http_methods(['GET', 'POST'])
def task_list(request):
    if request.method == 'GET':
        return JsonResponse({'tasks': [task.as_dict() for task in Task.objects.all()]})

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)

    title = str(payload.get('title', '')).strip()
    if not title:
        return JsonResponse({'error': 'Task title is required.'}, status=400)
    if len(title) > 200:
        return JsonResponse({'error': 'Task title must be 200 characters or fewer.'}, status=400)

    task = Task.objects.create(
        title=title,
        description=str(payload.get('description', '')).strip(),
        assignee_name=str(payload.get('assignee_name', '')).strip(),
        project=str(payload.get('project', '')).strip(),
    )
    return JsonResponse({'task': task.as_dict()}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def task_detail(request, task_id):
    task = get_object_or_404(Task, id=task_id)

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
