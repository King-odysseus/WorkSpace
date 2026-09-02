import json
import re
from pathlib import Path
from datetime import date, datetime, timedelta, timezone as datetime_timezone

from django.utils.dateparse import parse_datetime
from django.utils import timezone
from django.db import IntegrityError
from django.db.models import Count
from django.contrib.auth.models import User
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from .models import AuditLog, CalendarEvent, CheckIn, ChatMessage, FollowUp, Membership, PlanBucket, Project, Task, TaskAttachment, TaskComment, TaskSubtask, Workspace, WorkspaceInvitation


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


def record_activity(workspace_id, actor, kind, message):
    from .models import ActivityEvent
    AuditLog.objects.create(workspace_id=workspace_id, actor=actor, action=kind, target_type='workspace', details={'message': message})
    return ActivityEvent.objects.create(workspace_id=workspace_id, actor=actor, kind=kind, message=message)


def create_notification(workspace_id, recipient, kind, title, body=''):
    from .models import WorkspaceNotification
    return WorkspaceNotification.objects.create(workspace_id=workspace_id, recipient=recipient, kind=kind, title=title, body=body)


def parse_task_labels(value):
    if value is None:
        return [], None
    if not isinstance(value, list) or len(value) > 8:
        return None, 'Labels must be a list containing at most 8 items.'
    labels = []
    for item in value:
        label = str(item).strip()
        if not label or len(label) > 40:
            return None, 'Each label must be between 1 and 40 characters.'
        if label.lower() not in {existing.lower() for existing in labels}:
            labels.append(label)
    return labels, None


def parse_reminder_minutes(value):
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        return None, 'Reminder must be a whole number of minutes.'
    if minutes < 0 or minutes > 10080:
        return None, 'Reminder must be between 0 and 10080 minutes.'
    return minutes, None


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


@require_http_methods(['GET'])
def report_summary(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    tasks = Task.objects.filter(workspace_id=workspace_id)
    status_counts = {item['status']: item['count'] for item in tasks.values('status').annotate(count=Count('id'))}
    today = timezone.localdate()
    overdue_count = tasks.filter(due_date__lt=today).exclude(status='done').count()
    workload = []
    for membership in Membership.objects.filter(workspace_id=workspace_id).select_related('user'):
        assigned = tasks.filter(assignee=membership.user)
        workload.append({
            'user_id': membership.user_id,
            'user_name': membership.user.get_full_name() or membership.user.email,
            'total': assigned.count(),
            'open': assigned.exclude(status='done').count(),
            'blocked': assigned.filter(status='blocked').count(),
        })
    check_in_total = CheckIn.objects.filter(workspace_id=workspace_id, date=today).count()
    member_total = Membership.objects.filter(workspace_id=workspace_id).count()
    return JsonResponse({'summary': {
        'total_tasks': tasks.count(),
        'status_counts': status_counts,
        'overdue_tasks': overdue_count,
        'blocked_tasks': status_counts.get('blocked', 0),
        'check_ins_today': check_in_total,
        'members': member_total,
        'workload': workload,
    }})


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
    priority = str(payload.get('priority', 'normal')).strip()
    if priority not in {choice[0] for choice in Task.PRIORITY_CHOICES}:
        return JsonResponse({'error': 'Invalid task priority.'}, status=400)
    labels, labels_error = parse_task_labels(payload.get('labels'))
    if labels_error:
        return JsonResponse({'error': labels_error}, status=400)

    task = Task.objects.create(
        workspace_id=workspace_id,
        assignee=assignee,
        project_ref=project_ref,
        title=title,
        description=str(payload.get('description', '')).strip(),
        assignee_name=str(payload.get('assignee_name', '')).strip(),
        project=str(payload.get('project', '')).strip(),
        recurrence=recurrence,
        priority=priority,
        due_date=due_date,
        labels=labels or [],
    )
    record_activity(workspace_id, request.user, 'task_created', f'{request.user.get_full_name() or request.user.email} created task {task.title}.')
    if assignee and assignee != request.user:
        create_notification(workspace_id, assignee, 'task_assigned', 'You were assigned a task.', task.title)
    return JsonResponse({'task': task.as_dict()}, status=201)


@require_http_methods(['GET', 'POST'])
def plan_bucket_list(request, workspace_id):
    membership_check = require_workspace_leader if request.method == 'POST' else require_workspace_member
    _, error = membership_check(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        buckets = PlanBucket.objects.filter(workspace_id=workspace_id)
        return JsonResponse({'buckets': [bucket.as_dict() for bucket in buckets]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    name = str(payload.get('name', '')).strip()
    if not name or len(name) > 80:
        return JsonResponse({'error': 'Bucket name must be between 1 and 80 characters.'}, status=400)
    try:
        bucket = PlanBucket.objects.create(workspace_id=workspace_id, name=name, position=PlanBucket.objects.filter(workspace_id=workspace_id).count())
    except IntegrityError:
        return JsonResponse({'error': 'A bucket with this name already exists.'}, status=409)
    record_activity(workspace_id, request.user, 'bucket_created', f'{request.user.get_full_name() or request.user.email} created the {name} bucket.')
    return JsonResponse({'bucket': bucket.as_dict()}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def task_detail(request, task_id):
    task = get_object_or_404(Task, id=task_id, workspace_id__in=user_workspace_ids(request.user)) if request.user.is_authenticated else None
    if task is None:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    membership = Membership.objects.filter(workspace_id=task.workspace_id, user=request.user).first()
    if membership is None:
        return JsonResponse({'error': 'You do not belong to this workspace.'}, status=403)

    if request.method == 'GET':
        return JsonResponse({'task': task.as_dict()})

    if request.method == 'DELETE':
        if membership.role not in {'owner', 'manager'}:
            return JsonResponse({'error': 'Only owners and managers can delete tasks.'}, status=403)
        record_activity(task.workspace_id, request.user, 'task_deleted', f'{request.user.get_full_name() or request.user.email} deleted task {task.title}.')
        task.delete()
        return JsonResponse({'deleted': task_id})

    if membership.role == 'member' and task.assignee_id != request.user.id:
        return JsonResponse({'error': 'Members can only update tasks assigned to them.'}, status=403)

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)

    allowed_fields = {'title', 'description', 'assignee_name', 'project', 'bucket', 'status', 'due_date', 'recurrence', 'priority', 'labels', 'assignee_id', 'project_id'}
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

    if 'priority' in payload:
        if payload['priority'] not in {choice[0] for choice in Task.PRIORITY_CHOICES}:
            return JsonResponse({'error': 'Invalid task priority.'}, status=400)
        task.priority = payload['priority']

    if 'labels' in payload:
        labels, labels_error = parse_task_labels(payload['labels'])
        if labels_error:
            return JsonResponse({'error': labels_error}, status=400)
        task.labels = labels

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
    if previous_status != task.status:
        record_activity(task.workspace_id, request.user, 'task_status', f'{request.user.get_full_name() or request.user.email} moved {task.title} to {task.get_status_display()}.')
        if task.assignee and task.assignee != request.user:
            create_notification(task.workspace_id, task.assignee, 'task_status', f'Task status changed: {task.title}', task.get_status_display())
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
            labels=task.labels,
            due_date=next_recurrence_date(task.due_date, task.recurrence),
            recurrence=task.recurrence,
            priority=task.priority,
        )
        record_activity(task.workspace_id, request.user, 'task_recurred', f'Created the next {task.recurrence} occurrence of {task.title}.')
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
    record_activity(task.workspace_id, request.user, 'task_comment', f'{request.user.get_full_name() or request.user.email} commented on {task.title}.')
    if task.assignee and task.assignee != request.user:
        create_notification(task.workspace_id, task.assignee, 'task_comment', f'New comment on {task.title}', body[:120])
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
    record_activity(task.workspace_id, request.user, 'subtask_created', f'{request.user.get_full_name() or request.user.email} added a subtask to {task.title}.')
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
    record_activity(subtask.task.workspace_id, request.user, 'subtask_updated', f'{request.user.get_full_name() or request.user.email} updated a subtask on {subtask.task.title}.')
    return JsonResponse({'subtask': subtask.as_dict()})


@require_http_methods(['GET', 'POST'])
def task_attachment_list(request, task_id):
    auth_error = require_authenticated(request)
    if auth_error:
        return auth_error
    task = Task.objects.filter(id=task_id, workspace_id__in=user_workspace_ids(request.user)).first()
    if task is None:
        return JsonResponse({'error': 'Task was not found.'}, status=404)
    if request.method == 'GET':
        attachments = TaskAttachment.objects.filter(task=task).select_related('uploaded_by')
        return JsonResponse({'attachments': [attachment.as_dict() for attachment in attachments]})
    uploaded_file = request.FILES.get('file')
    if uploaded_file is None:
        return JsonResponse({'error': 'A file is required.'}, status=400)
    if uploaded_file.size > 10 * 1024 * 1024:
        return JsonResponse({'error': 'Files must be 10 MB or smaller.'}, status=400)
    allowed_extensions = {'.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.zip'}
    if Path(uploaded_file.name).suffix.lower() not in allowed_extensions:
        return JsonResponse({'error': 'This file type is not supported.'}, status=400)
    attachment = TaskAttachment.objects.create(task=task, uploaded_by=request.user, file=uploaded_file, original_name=uploaded_file.name[:255])
    record_activity(task.workspace_id, request.user, 'task_attachment', f'{request.user.get_full_name() or request.user.email} attached {attachment.original_name} to {task.title}.')
    return JsonResponse({'attachment': attachment.as_dict()}, status=201)


@require_http_methods(['DELETE'])
def task_attachment_detail(request, attachment_id):
    auth_error = require_authenticated(request)
    if auth_error:
        return auth_error
    attachment = TaskAttachment.objects.filter(id=attachment_id, task__workspace_id__in=user_workspace_ids(request.user)).first()
    if attachment is None:
        return JsonResponse({'error': 'Attachment was not found.'}, status=404)
    attachment.file.delete(save=False)
    attachment.delete()
    return JsonResponse({'deleted': attachment_id})


@require_http_methods(['GET', 'PATCH'])
def notification_list(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    from .models import WorkspaceNotification
    if request.method == 'GET':
        notifications = WorkspaceNotification.objects.filter(workspace_id=workspace_id, recipient=request.user)[:50]
        return JsonResponse({'notifications': [notification.as_dict() for notification in notifications], 'unread_count': WorkspaceNotification.objects.filter(workspace_id=workspace_id, recipient=request.user, read_at__isnull=True).count()})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if payload.get('read_all') is True:
        WorkspaceNotification.objects.filter(workspace_id=workspace_id, recipient=request.user, read_at__isnull=True).update(read_at=timezone.now())
        return JsonResponse({'updated': 'all'})
    notification_id = payload.get('notification_id')
    notification = WorkspaceNotification.objects.filter(id=notification_id, workspace_id=workspace_id, recipient=request.user).first()
    if notification is None:
        return JsonResponse({'error': 'Notification was not found.'}, status=404)
    notification.read_at = timezone.now()
    notification.save(update_fields=['read_at'])
    return JsonResponse({'notification': notification.as_dict()})


@require_http_methods(['GET'])
def activity_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    from .models import ActivityEvent
    events = ActivityEvent.objects.filter(workspace_id=workspace_id).select_related('actor')[:50]
    return JsonResponse({'activity': [event.as_dict() for event in events]})


@require_http_methods(['GET'])
def audit_log_list(request, workspace_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    logs = AuditLog.objects.filter(workspace_id=workspace_id).select_related('actor')[:100]
    return JsonResponse({'audit_logs': [log.as_dict() for log in logs]})


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
    due_date = None
    if payload.get('due_date'):
        try:
            due_date = date.fromisoformat(str(payload['due_date']))
        except ValueError:
            return JsonResponse({'error': 'Due date must use YYYY-MM-DD format.'}, status=400)
    try:
        project = Project.objects.create(workspace_id=workspace_id, name=name, description=str(payload.get('description', '')).strip(), due_date=due_date)
    except IntegrityError:
        return JsonResponse({'error': 'A project with this name already exists in the workspace.'}, status=409)
    record_activity(workspace_id, request.user, 'project_created', f'{request.user.get_full_name() or request.user.email} created project {project.name}.')
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
        record_activity(workspace_id, request.user, 'project_deleted', f'{request.user.get_full_name() or request.user.email} deleted project {project.name}.')
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
    record_activity(workspace_id, request.user, 'project_updated', f'{request.user.get_full_name() or request.user.email} updated project {project.name}.')
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
    reminder_minutes, reminder_error = parse_reminder_minutes(payload.get('reminder_minutes', 15))
    if reminder_error:
        return JsonResponse({'error': reminder_error}, status=400)
    event = CalendarEvent.objects.create(
        workspace_id=workspace_id,
        title=title,
        description=str(payload.get('description', '')).strip(),
        start_at=start_at,
        end_at=end_at,
        event_type=event_type,
        reminder_minutes=reminder_minutes,
        created_by=request.user,
    )
    record_activity(workspace_id, request.user, 'calendar_created', f'{request.user.get_full_name() or request.user.email} created calendar event {event.title}.')
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
        record_activity(workspace_id, request.user, 'calendar_deleted', f'{request.user.get_full_name() or request.user.email} deleted calendar event {event.title}.')
        event.delete()
        return JsonResponse({'deleted': event_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    allowed_fields = {'title', 'description', 'start_at', 'end_at', 'event_type', 'reminder_minutes'}
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
    if 'reminder_minutes' in payload:
        reminder_minutes, reminder_error = parse_reminder_minutes(payload['reminder_minutes'])
        if reminder_error:
            return JsonResponse({'error': reminder_error}, status=400)
        event.reminder_minutes = reminder_minutes
    event.start_at = start_at
    event.end_at = end_at
    event.save()
    record_activity(workspace_id, request.user, 'calendar_updated', f'{request.user.get_full_name() or request.user.email} updated calendar event {event.title}.')
    return JsonResponse({'event': event.as_dict()})


def ics_escape(value):
    return str(value).replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\n', '\\n')


@require_http_methods(['GET'])
def calendar_ics(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    events = CalendarEvent.objects.filter(workspace_id=workspace_id)
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorkSpace//Team Calendar//EN']
    for event in events:
        start = event.start_at.astimezone(datetime_timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        end = event.end_at.astimezone(datetime_timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        lines.extend(['BEGIN:VEVENT', f'UID:workspace-event-{event.id}@workspace', f'DTSTAMP:{start}', f'DTSTART:{start}', f'DTEND:{end}', f'SUMMARY:{ics_escape(event.title)}', f'DESCRIPTION:{ics_escape(event.description)}', 'END:VEVENT'])
    lines.append('END:VCALENDAR')
    response = HttpResponse('\r\n'.join(lines) + '\r\n', content_type='text/calendar; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="workspace-{workspace_id}.ics"'
    return response


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
    parent = None
    if payload.get('parent_id'):
        parent = ChatMessage.objects.filter(id=payload['parent_id'], workspace_id=workspace_id, channel=channel, parent__isnull=True).first()
        if parent is None:
            return JsonResponse({'error': 'The parent message was not found in this channel.'}, status=404)
    message = ChatMessage.objects.create(workspace_id=workspace_id, author=request.user, channel=channel, parent=parent, message=message_text)
    record_activity(workspace_id, request.user, 'chat_message', f'{request.user.get_full_name() or request.user.email} posted in #{channel}.')
    mentioned_tokens = {token.lower() for token in re.findall(r'@([A-Za-z0-9_.-]+)', message_text)}
    if mentioned_tokens:
        members = Membership.objects.filter(workspace_id=workspace_id).select_related('user')
        for member in members:
            aliases = {member.user.email.split('@')[0].lower(), member.user.first_name.lower(), member.user.last_name.lower()}
            if mentioned_tokens.intersection(aliases) and member.user != request.user:
                create_notification(workspace_id, member.user, 'mention', f'{request.user.get_full_name() or request.user.email} mentioned you', message_text[:120])
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
