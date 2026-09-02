import json

from django.http import JsonResponse
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
