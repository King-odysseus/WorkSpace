import json
from datetime import date, timedelta

from django.utils.dateparse import parse_datetime
from django.db import IntegrityError
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from .models import CalendarEvent, CheckIn, ChatMessage, FollowUp, Membership, Project, Task, TaskComment, TaskSubtask, Workspace, WorkspaceInvitation


def user_workspace_ids(user):
    return user.workspace_memberships.values_list('workspace_id', flat=True)


def next_recurrence_date(due_date, recurrence):
    if due_date is None:
        return None
    if recurrence == 'daily':
        return due_date + timedelta(days=1)
    if recurrence == 'weekly':
        return due_date + timedelta(days=7)
    if recurrence == 'monthly':
        month = due_date.month % 12 + 1
        year = due_date.year + (1 if due_date.month == 12 else 0)
        day = min(due_date.day, [31, 29 if year % 4 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
        return date(year, month, day)
    return None


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


def require_workspace_leader(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return None, error
    if membership.role not in {'owner', 'manager'}:
        return None, JsonResponse({'error': 'Owner or manager access is required.'}, status=403)
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

    assignee = None
    if payload.get('assignee_id'):
        assignee = User.objects.filter(id=payload['assignee_id'], workspace_memberships__workspace_id=workspace_id).first()
        if assignee is None:
            return JsonResponse({'error': 'Assignee was not found in this workspace.'}, status=404)
    project_ref = None
    if payload.get('project_id'):
        project_ref = Project.objects.filter(id=payload['project_id'], workspace_id=workspace_id).first()
        if project_ref is None:
            return JsonResponse({'error': 'Project was not found in this workspace.'}, status=404)
    due_date = None
    if payload.get('due_date'):
        try:
            due_date = date.fromisoformat(str(payload['due_date']))
        except ValueError:
            return JsonResponse({'error': 'Due date must use YYYY-MM-DD format.'}, status=400)
    recurrence = str(payload.get('recurrence', 'none')).strip()
    if recurrence not in {choice[0] for choice in Task.RECURRENCE_CHOICES}:
        return JsonResponse({'error': 'Invalid recurrence rule.'}, status=400)

    task = Task.objects.create(
        workspace_id=workspace_id,
        assignee=assignee,
        project_ref=project_ref,
        title=title,
        description=str(payload.get('description', '')).strip(),
        assignee_name=str(payload.get('assignee_name', '')).strip(),
        project=str(payload.get('project', '')).strip(),
        recurrence=recurrence,
        due_date=due_date,
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

    allowed_fields = {'title', 'description', 'assignee_name', 'project', 'bucket', 'status', 'due_date', 'recurrence', 'assignee_id', 'project_id'}
    unknown_fields = set(payload) - allowed_fields
    if unknown_fields:
        return JsonResponse({'error': f'Unsupported fields: {", ".join(sorted(unknown_fields))}.'}, status=400)

    if 'title' in payload:
        title = str(payload['title']).strip()
        if not title or len(title) > 200:
            return JsonResponse({'error': 'Task title must be between 1 and 200 characters.'}, status=400)
        task.title = title

    previous_status = task.status
    if 'status' in payload:
        valid_statuses = {choice[0] for choice in Task.STATUS_CHOICES}
        if payload['status'] not in valid_statuses:
            return JsonResponse({'error': 'Invalid task status.'}, status=400)
        task.status = payload['status']

    if 'recurrence' in payload:
        if payload['recurrence'] not in {choice[0] for choice in Task.RECURRENCE_CHOICES}:
            return JsonResponse({'error': 'Invalid recurrence rule.'}, status=400)
        task.recurrence = payload['recurrence']

    if 'bucket' in payload:
        bucket = str(payload['bucket']).strip()
        if not bucket or len(bucket) > 80:
            return JsonResponse({'error': 'Bucket must be between 1 and 80 characters.'}, status=400)
        task.bucket = bucket

    if 'due_date' in payload and payload['due_date']:
        try:
            task.due_date = date.fromisoformat(str(payload['due_date']))
        except ValueError:
            return JsonResponse({'error': 'Due date must use YYYY-MM-DD format.'}, status=400)
    if 'due_date' in payload and not payload['due_date']:
        task.due_date = None

    if 'assignee_id' in payload:
        task.assignee = User.objects.filter(id=payload['assignee_id'], workspace_memberships__workspace_id=task.workspace_id).first() if payload['assignee_id'] else None
        if payload['assignee_id'] and task.assignee is None:
            return JsonResponse({'error': 'Assignee was not found in this workspace.'}, status=404)
    if 'project_id' in payload:
        task.project_ref = Project.objects.filter(id=payload['project_id'], workspace_id=task.workspace_id).first() if payload['project_id'] else None
        if payload['project_id'] and task.project_ref is None:
            return JsonResponse({'error': 'Project was not found in this workspace.'}, status=404)

    for field in {'description', 'assignee_name', 'project'} & set(payload):
        setattr(task, field, str(payload[field]).strip() or None)

    task.save()
    if previous_status != 'done' and task.status == 'done' and task.recurrence != 'none':
        Task.objects.create(
            workspace=task.workspace,
            assignee=task.assignee,
            project_ref=task.project_ref,
            title=task.title,
            description=task.description,
            assignee_name=task.assignee_name,
            project=task.project,
            bucket=task.bucket,
            due_date=next_recurrence_date(task.due_date, task.recurrence),
            recurrence=task.recurrence,
        )
    return JsonResponse({'task': task.as_dict()})


@require_http_methods(['GET', 'POST'])
def task_comment_list(request, task_id):
    auth_error = require_authenticated(request)
    if auth_error:
        return auth_error
    task = Task.objects.filter(id=task_id, workspace_id__in=user_workspace_ids(request.user)).first()
    if task is None:
        return JsonResponse({'error': 'Task was not found.'}, status=404)
    if request.method == 'GET':
        comments = TaskComment.objects.filter(task=task).select_related('author')
        return JsonResponse({'comments': [comment.as_dict() for comment in comments]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    body = str(payload.get('body', '')).strip()
    if not body or len(body) > 4000:
        return JsonResponse({'error': 'Comment must be between 1 and 4000 characters.'}, status=400)
    comment = TaskComment.objects.create(task=task, author=request.user, body=body)
    return JsonResponse({'comment': comment.as_dict()}, status=201)


@require_http_methods(['GET', 'POST'])
def task_subtask_list(request, task_id):
    auth_error = require_authenticated(request)
    if auth_error:
        return auth_error
    task = Task.objects.filter(id=task_id, workspace_id__in=user_workspace_ids(request.user)).first()
    if task is None:
        return JsonResponse({'error': 'Task was not found.'}, status=404)
    if request.method == 'GET':
        subtasks = TaskSubtask.objects.filter(task=task).select_related('assignee')
        return JsonResponse({'subtasks': [subtask.as_dict() for subtask in subtasks]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    title = str(payload.get('title', '')).strip()
    if not title or len(title) > 200:
        return JsonResponse({'error': 'Subtask title must be between 1 and 200 characters.'}, status=400)
    assignee = None
    if payload.get('assignee_id'):
        assignee = User.objects.filter(id=payload['assignee_id'], workspace_memberships__workspace_id=task.workspace_id).first()
        if assignee is None:
            return JsonResponse({'error': 'Subtask assignee was not found in this workspace.'}, status=404)
    subtask = TaskSubtask.objects.create(task=task, title=title, assignee=assignee)
    return JsonResponse({'subtask': subtask.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def task_subtask_detail(request, subtask_id):
    auth_error = require_authenticated(request)
    if auth_error:
        return auth_error
    subtask = TaskSubtask.objects.filter(id=subtask_id, task__workspace_id__in=user_workspace_ids(request.user)).first()
    if subtask is None:
        return JsonResponse({'error': 'Subtask was not found.'}, status=404)
    if request.method == 'DELETE':
        subtask.delete()
        return JsonResponse({'deleted': subtask_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if set(payload) - {'title', 'completed'}:
        return JsonResponse({'error': 'Only title and completed can be updated.'}, status=400)
    if 'title' in payload:
        title = str(payload['title']).strip()
        if not title or len(title) > 200:
            return JsonResponse({'error': 'Subtask title must be between 1 and 200 characters.'}, status=400)
        subtask.title = title
    if 'completed' in payload:
        if not isinstance(payload['completed'], bool):
            return JsonResponse({'error': 'Completed must be true or false.'}, status=400)
        subtask.completed = payload['completed']
    subtask.save()
    return JsonResponse({'subtask': subtask.as_dict()})


@require_http_methods(['GET'])
def member_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    members = Membership.objects.filter(workspace_id=workspace_id).select_related('user')
    return JsonResponse({'members': [member.as_dict() for member in members]})


@require_http_methods(['PATCH', 'DELETE'])
def member_detail(request, workspace_id, user_id):
    actor, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    membership = Membership.objects.filter(workspace_id=workspace_id, user_id=user_id).select_related('user').first()
    if membership is None:
        return JsonResponse({'error': 'Workspace member was not found.'}, status=404)
    if membership.role == 'owner':
        return JsonResponse({'error': 'The workspace owner cannot be changed here.'}, status=403)
    if actor.role == 'manager' and membership.role != 'member':
        return JsonResponse({'error': 'Managers can only manage regular members.'}, status=403)
    if request.method == 'DELETE':
        membership.delete()
        return JsonResponse({'removed': user_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if set(payload) != {'role'} or payload['role'] not in {'manager', 'member'}:
        return JsonResponse({'error': 'Role must be manager or member.'}, status=400)
    membership.role = payload['role']
    membership.save(update_fields=['role'])
    return JsonResponse({'member': membership.as_dict()})


@require_http_methods(['GET', 'POST'])
def invitation_list(request, workspace_id):
    membership_check = require_workspace_leader if request.method == 'POST' else require_workspace_member
    _, error = membership_check(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        invitations = WorkspaceInvitation.objects.filter(workspace_id=workspace_id)
        return JsonResponse({'invitations': [invitation.as_dict() for invitation in invitations]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    email = str(payload.get('email', '')).strip().lower()
    role = payload.get('role', 'member')
    if '@' not in email or len(email) > 254:
        return JsonResponse({'error': 'A valid email address is required.'}, status=400)
    if role not in {'manager', 'member'}:
        return JsonResponse({'error': 'Invitation role must be manager or member.'}, status=400)
    if Membership.objects.filter(workspace_id=workspace_id, user__email__iexact=email).exists():
        return JsonResponse({'error': 'This user is already a workspace member.'}, status=409)
    invitation, created = WorkspaceInvitation.objects.get_or_create(
        workspace_id=workspace_id,
        email=email,
        status='pending',
        defaults={'role': role, 'invited_by': request.user},
    )
    if not created:
        invitation.role = role
        invitation.invited_by = request.user
        invitation.save(update_fields=['role', 'invited_by'])
    return JsonResponse({'invitation': invitation.as_dict()}, status=201 if created else 200)


@require_http_methods(['POST'])
def invitation_accept(request, invitation_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    invitation = WorkspaceInvitation.objects.select_related('workspace').filter(id=invitation_id, status='pending').first()
    if invitation is None:
        return JsonResponse({'error': 'Pending invitation was not found.'}, status=404)
    if invitation.email.lower() != request.user.email.lower():
        return JsonResponse({'error': 'This invitation belongs to a different email address.'}, status=403)
    membership, _ = Membership.objects.get_or_create(workspace=invitation.workspace, user=request.user, defaults={'role': invitation.role})
    invitation.status = 'accepted'
    invitation.save(update_fields=['status'])
    return JsonResponse({'workspace': {'id': invitation.workspace_id, 'name': invitation.workspace.name, 'slug': invitation.workspace.slug}, 'membership': membership.as_dict()})


@require_http_methods(['GET', 'POST'])
def project_list(request, workspace_id):
    membership_check = require_workspace_leader if request.method == 'POST' else require_workspace_member
    _, error = membership_check(request, workspace_id)
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
    try:
        project = Project.objects.create(workspace_id=workspace_id, name=name, description=str(payload.get('description', '')).strip())
    except IntegrityError:
        return JsonResponse({'error': 'A project with this name already exists in the workspace.'}, status=409)
    return JsonResponse({'project': project.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def project_detail(request, workspace_id, project_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    project = Project.objects.filter(id=project_id, workspace_id=workspace_id).first()
    if project is None:
        return JsonResponse({'error': 'Project was not found.'}, status=404)
    if request.method == 'DELETE':
        project.delete()
        return JsonResponse({'deleted': project_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    allowed_fields = {'name', 'description', 'status', 'due_date'}
    unknown_fields = set(payload) - allowed_fields
    if unknown_fields:
        return JsonResponse({'error': f'Unsupported fields: {", ".join(sorted(unknown_fields))}.'}, status=400)
    if 'name' in payload:
        name = str(payload['name']).strip()
        if not name or len(name) > 160:
            return JsonResponse({'error': 'Project name must be between 1 and 160 characters.'}, status=400)
        if Project.objects.filter(workspace_id=workspace_id, name=name).exclude(id=project.id).exists():
            return JsonResponse({'error': 'A project with this name already exists in the workspace.'}, status=409)
        project.name = name
    if 'description' in payload:
        project.description = str(payload['description']).strip()
    if 'status' in payload:
        if payload['status'] not in {choice[0] for choice in Project.STATUS_CHOICES}:
            return JsonResponse({'error': 'Invalid project status.'}, status=400)
        project.status = payload['status']
    if 'due_date' in payload:
        try:
            project.due_date = date.fromisoformat(str(payload['due_date'])) if payload['due_date'] else None
        except ValueError:
            return JsonResponse({'error': 'Due date must use YYYY-MM-DD format.'}, status=400)
    project.save()
    return JsonResponse({'project': project.as_dict()})


def parse_event_datetime(value, field_name):
    parsed = parse_datetime(str(value or ''))
    if parsed is None:
        return None, JsonResponse({'error': f'{field_name} must be a valid ISO datetime.'}, status=400)
    return parsed, None


@require_http_methods(['GET', 'POST'])
def calendar_event_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        events = CalendarEvent.objects.filter(workspace_id=workspace_id).select_related('created_by')
        return JsonResponse({'events': [event.as_dict() for event in events]})

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)

    title = str(payload.get('title', '')).strip()
    if not title:
        return JsonResponse({'error': 'Event title is required.'}, status=400)
    if len(title) > 200:
        return JsonResponse({'error': 'Event title must be 200 characters or fewer.'}, status=400)
    start_at, error = parse_event_datetime(payload.get('start_at'), 'Start time')
    if error:
        return error
    end_at, error = parse_event_datetime(payload.get('end_at'), 'End time')
    if error:
        return error
    if end_at <= start_at:
        return JsonResponse({'error': 'End time must be after start time.'}, status=400)
    event_type = payload.get('event_type', 'meeting')
    if event_type not in {choice[0] for choice in CalendarEvent.EVENT_TYPES}:
        return JsonResponse({'error': 'Invalid event type.'}, status=400)
    event = CalendarEvent.objects.create(
        workspace_id=workspace_id,
        title=title,
        description=str(payload.get('description', '')).strip(),
        start_at=start_at,
        end_at=end_at,
        event_type=event_type,
        created_by=request.user,
    )
    return JsonResponse({'event': event.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def calendar_event_detail(request, workspace_id, event_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    event = CalendarEvent.objects.filter(id=event_id, workspace_id=workspace_id).first()
    if event is None:
        return JsonResponse({'error': 'Calendar event was not found.'}, status=404)
    if request.method == 'DELETE':
        event.delete()
        return JsonResponse({'deleted': event_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    allowed_fields = {'title', 'description', 'start_at', 'end_at', 'event_type'}
    if set(payload) - allowed_fields:
        return JsonResponse({'error': 'Unsupported calendar event fields.'}, status=400)
    start_at = event.start_at
    end_at = event.end_at
    if 'start_at' in payload:
        start_at, error = parse_event_datetime(payload['start_at'], 'Start time')
        if error:
            return error
    if 'end_at' in payload:
        end_at, error = parse_event_datetime(payload['end_at'], 'End time')
        if error:
            return error
    if end_at <= start_at:
        return JsonResponse({'error': 'End time must be after start time.'}, status=400)
    if 'title' in payload:
        title = str(payload['title']).strip()
        if not title or len(title) > 200:
            return JsonResponse({'error': 'Event title must be between 1 and 200 characters.'}, status=400)
        event.title = title
    if 'description' in payload:
        event.description = str(payload['description']).strip()
    if 'event_type' in payload:
        if payload['event_type'] not in {choice[0] for choice in CalendarEvent.EVENT_TYPES}:
            return JsonResponse({'error': 'Invalid event type.'}, status=400)
        event.event_type = payload['event_type']
    event.start_at = start_at
    event.end_at = end_at
    event.save()
    return JsonResponse({'event': event.as_dict()})


@require_http_methods(['GET', 'POST'])
def check_in_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        check_ins = CheckIn.objects.filter(workspace_id=workspace_id).select_related('user')
        requested_date = request.GET.get('date')
        if requested_date:
            try:
                check_ins = check_ins.filter(date=date.fromisoformat(requested_date))
            except ValueError:
                return JsonResponse({'error': 'Date must use YYYY-MM-DD format.'}, status=400)
        return JsonResponse({'check_ins': [check_in.as_dict() for check_in in check_ins]})

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    try:
        check_in_date = date.fromisoformat(str(payload.get('date', date.today().isoformat())))
    except ValueError:
        return JsonResponse({'error': 'Date must use YYYY-MM-DD format.'}, status=400)

    check_in, created = CheckIn.objects.update_or_create(
        workspace_id=workspace_id,
        user=request.user,
        date=check_in_date,
        defaults={
            'completed': str(payload.get('completed', '')).strip(),
            'next_steps': str(payload.get('next_steps', '')).strip(),
            'blockers': str(payload.get('blockers', '')).strip(),
        },
    )
    return JsonResponse({'check_in': check_in.as_dict()}, status=201 if created else 200)


@require_http_methods(['GET', 'POST'])
def chat_message_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        recent_messages = list(ChatMessage.objects.filter(workspace_id=workspace_id).select_related('author').order_by('-created_at')[:100])
        messages = reversed(recent_messages)
        return JsonResponse({'messages': [message.as_dict() for message in messages]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    message_text = str(payload.get('message', '')).strip()
    channel = str(payload.get('channel', 'general')).strip()
    if not message_text:
        return JsonResponse({'error': 'Message is required.'}, status=400)
    if len(message_text) > 4000:
        return JsonResponse({'error': 'Message must be 4000 characters or fewer.'}, status=400)
    if not channel or len(channel) > 80:
        return JsonResponse({'error': 'Channel must be between 1 and 80 characters.'}, status=400)
    message = ChatMessage.objects.create(workspace_id=workspace_id, author=request.user, channel=channel, message=message_text)
    return JsonResponse({'message': message.as_dict()}, status=201)


@require_http_methods(['GET', 'POST'])
def follow_up_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        follow_ups = FollowUp.objects.filter(workspace_id=workspace_id)
        return JsonResponse({'follow_ups': [follow_up.as_dict() for follow_up in follow_ups]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    note = str(payload.get('note', '')).strip()
    if not note:
        return JsonResponse({'error': 'Follow-up note is required.'}, status=400)
    if len(note) > 500:
        return JsonResponse({'error': 'Follow-up note must be 500 characters or fewer.'}, status=400)
    due_date = None
    if payload.get('due_date'):
        try:
            due_date = date.fromisoformat(str(payload['due_date']))
        except ValueError:
            return JsonResponse({'error': 'Due date must use YYYY-MM-DD format.'}, status=400)
    task = None
    if payload.get('task_id'):
        task = Task.objects.filter(id=payload['task_id'], workspace_id=workspace_id).first()
        if task is None:
            return JsonResponse({'error': 'Task was not found in this workspace.'}, status=404)
    follow_up = FollowUp.objects.create(workspace_id=workspace_id, task=task, created_by=request.user, note=note, due_date=due_date)
    return JsonResponse({'follow_up': follow_up.as_dict()}, status=201)


@require_http_methods(['PATCH'])
def follow_up_detail(request, follow_up_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    follow_up = FollowUp.objects.filter(id=follow_up_id, workspace_id__in=user_workspace_ids(request.user)).first()
    if follow_up is None:
        return JsonResponse({'error': 'Follow-up was not found.'}, status=404)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if set(payload) - {'status', 'note', 'due_date'}:
        return JsonResponse({'error': 'Only status, note, and due_date can be updated.'}, status=400)
    if 'status' in payload:
        if payload['status'] not in {choice[0] for choice in FollowUp.STATUS_CHOICES}:
            return JsonResponse({'error': 'Invalid follow-up status.'}, status=400)
        follow_up.status = payload['status']
    if 'note' in payload:
        note = str(payload['note']).strip()
        if not note or len(note) > 500:
            return JsonResponse({'error': 'Follow-up note must be between 1 and 500 characters.'}, status=400)
        follow_up.note = note
    if 'due_date' in payload:
        try:
            follow_up.due_date = date.fromisoformat(str(payload['due_date'])) if payload['due_date'] else None
        except ValueError:
            return JsonResponse({'error': 'Due date must use YYYY-MM-DD format.'}, status=400)
    follow_up.save()
    return JsonResponse({'follow_up': follow_up.as_dict()})
