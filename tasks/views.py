import json
import re
import secrets
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pathlib import Path
from datetime import date, datetime, timedelta, timezone as datetime_timezone

from django.utils.dateparse import parse_datetime
from django.utils import timezone
from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Q
from django.core.exceptions import ValidationError
from django.core.paginator import EmptyPage, Paginator
from django.contrib.auth.models import User
from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods
from django.utils.text import slugify

from .models import AuditLog, CalendarEvent, ChatChannel, CheckIn, ChatMessage, DirectConversation, DirectMessage, FollowUp, LookupValue, Membership, NotificationPreference, PlanBucket, Project, ProjectResource, ProjectStakeholder, ProjectTemplate, RiskIssue, SavedView, Task, TaskAttachment, TaskChangeHistory, TaskCodeRegistry, TaskComment, TaskSubtask, TaskSupporter, TaskTemplate, Workspace, WorkspaceDocument, WorkspaceFile, WorkspaceInvitation, WorkspaceWebhook, WorkShift
from .webhooks import notify_workspace_webhooks


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


NOTIFICATION_KIND_PREFERENCE = {
    'mention': 'mentions',
    'direct_message': 'direct_messages',
    'task_assigned': 'task_updates',
    'task_status': 'task_updates',
    'task_comment': 'task_updates',
    'follow_up_assigned': 'task_updates',
    'follow_up_completed': 'task_updates',
    'check_in_blocker': 'task_updates',
    'calendar_reminder': 'calendar_reminders',
    'due_soon_reminder': 'task_updates',
    'overdue_reminder': 'task_updates',
    'blocked_alert': 'task_updates',
    'stale_update_reminder': 'task_updates',
    'workspace_digest': 'task_updates',
}


def create_notification(workspace_id, recipient, kind, title, body='', target_type='', target_id=''):
    from .models import WorkspaceNotification
    preference_field = NOTIFICATION_KIND_PREFERENCE.get(kind)
    if preference_field and recipient is not None:
        preference = NotificationPreference.objects.filter(workspace_id=workspace_id, user=recipient).first()
        if preference is not None and not getattr(preference, preference_field):
            return None
    notification = WorkspaceNotification.objects.create(workspace_id=workspace_id, recipient=recipient, kind=kind, title=title, body=body, target_type=target_type, target_id=str(target_id) if target_id else '')
    notify_workspace_webhooks(workspace_id, kind, title, body, target_type=target_type, target_id=target_id)
    return notification


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


def parse_bounded_text(value, field_name, max_length=4000):
    text = str(value or '').strip()
    if len(text) > max_length:
        return None, f'{field_name} must be {max_length} characters or fewer.'
    return text, None


def parse_iso_date(value, field_name, allow_null=True):
    if value in (None, '') and allow_null:
        return None, None
    try:
        return date.fromisoformat(str(value)), None
    except (TypeError, ValueError):
        return None, f'{field_name} must use YYYY-MM-DD format.'


def validation_error_response(error):
    if hasattr(error, 'message_dict'):
        details = error.message_dict
        message = next(iter(details.values()))[0]
        return JsonResponse({'error': message, 'errors': details}, status=400)
    return JsonResponse({'error': '; '.join(error.messages)}, status=400)


def json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if hasattr(value, 'pk'):
        return value.pk
    return value


def task_snapshot(task, fields):
    return {field: json_value(getattr(task, field)) for field in fields}


def record_task_changes(task, actor, previous, fields):
    changes = []
    for field in fields:
        old_value = previous.get(field)
        new_value = json_value(getattr(task, field))
        if old_value != new_value:
            changes.append(TaskChangeHistory(task=task, task_code=task.code, workspace_id=task.workspace_id, actor=actor, field=field, previous_value=old_value, new_value=new_value))
    if changes:
        TaskChangeHistory.objects.bulk_create(changes)


def reserve_task_code(workspace):
    locked = Workspace.objects.select_for_update().get(id=workspace.id)
    prefix = (slugify(locked.slug or locked.name).replace('-', '')[:8] or 'TASK').upper()
    number = locked.next_task_number
    while True:
        code = f'{prefix}-{number:06d}'
        if not TaskCodeRegistry.objects.filter(workspace=locked, code=code).exists():
            break
        number += 1
    locked.next_task_number = number + 1
    locked.save(update_fields=['next_task_number'])
    return code


def set_task_supporters(task, supporter_ids, actor):
    if supporter_ids is None:
        return None
    if not isinstance(supporter_ids, list):
        return JsonResponse({'error': 'supporter_ids must be a list.'}, status=400)
    try:
        ids = {int(value) for value in supporter_ids}
    except (TypeError, ValueError):
        return JsonResponse({'error': 'supporter_ids must contain valid user IDs.'}, status=400)
    valid_ids = set(Membership.objects.filter(workspace_id=task.workspace_id, user_id__in=ids).values_list('user_id', flat=True))
    if ids != valid_ids:
        return JsonResponse({'error': 'Every supporter must belong to the task workspace.'}, status=404)
    TaskSupporter.objects.filter(task=task).exclude(user_id__in=ids).delete()
    existing = set(TaskSupporter.objects.filter(task=task).values_list('user_id', flat=True))
    TaskSupporter.objects.bulk_create([TaskSupporter(task=task, user_id=user_id, added_by=actor) for user_id in ids - existing])
    return None


def set_task_blocked_by(task, blocked_by_ids):
    if blocked_by_ids is None:
        return None
    if not isinstance(blocked_by_ids, list):
        return JsonResponse({'error': 'blocked_by_ids must be a list.'}, status=400)
    try:
        ids = {int(value) for value in blocked_by_ids}
    except (TypeError, ValueError):
        return JsonResponse({'error': 'blocked_by_ids must contain valid task IDs.'}, status=400)
    if task.id in ids:
        return JsonResponse({'error': 'A task cannot depend on itself.'}, status=400)
    valid_ids = set(Task.objects.filter(id__in=ids, workspace_id=task.workspace_id).values_list('id', flat=True))
    if ids != valid_ids:
        return JsonResponse({'error': 'Every blocking task must belong to the same workspace.'}, status=404)
    if ids and Task.objects.filter(id__in=ids, blocked_by=task).exists():
        return JsonResponse({'error': 'That would create a circular dependency.'}, status=400)
    task.blocked_by.set(ids)
    return None


def deliver_due_calendar_reminders(workspace_id):
    now = timezone.now()
    horizon = now + timedelta(days=7)
    delivered_count = 0
    due_events = CalendarEvent.objects.filter(
        workspace_id=workspace_id,
        created_by__isnull=False,
        reminder_sent_at__isnull=True,
        start_at__gte=now,
        start_at__lte=horizon,
    )
    for event in due_events:
        reminder_at = event.start_at - timedelta(minutes=event.reminder_minutes)
        if reminder_at > now:
            continue
        with transaction.atomic():
            locked_event = CalendarEvent.objects.select_for_update().filter(id=event.id, reminder_sent_at__isnull=True).first()
            if locked_event is None:
                continue
            create_notification(
                workspace_id,
                locked_event.created_by,
                'calendar_reminder',
                f'Upcoming event: {locked_event.title}',
                f'Starts at {locked_event.start_at.isoformat()}.',
                target_type='calendar_event',
                target_id=locked_event.id,
            )
            locked_event.reminder_sent_at = now
            locked_event.save(update_fields=['reminder_sent_at'])
            delivered_count += 1
    return delivered_count


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


def require_task_editor(request, task):
    membership, error = require_workspace_member(request, task.workspace_id)
    if error:
        return error
    if membership.role == 'member' and task.assignee_id != request.user.id:
        return JsonResponse({'error': 'Members can only edit subtasks on tasks assigned to them.'}, status=403)
    return None


def require_follow_up_editor(request, follow_up, fields):
    membership, error = require_workspace_member(request, follow_up.workspace_id)
    if error:
        return error
    if membership.role in {'owner', 'manager'}:
        return None
    if request.user.id not in {follow_up.created_by_id, follow_up.assigned_to_id}:
        return JsonResponse({'error': 'Only the follow-up creator, assignee, or a workspace leader can update it.'}, status=403)
    if request.user.id != follow_up.created_by_id and fields - {'status'}:
        return JsonResponse({'error': 'Assigned members can only update follow-up status.'}, status=403)
    return None


def health(request):
    return JsonResponse({'status': 'ok', 'service': 'workspace-api'})


@require_http_methods(['GET'])
def workspace_search(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    query = request.GET.get('q', '').strip()
    if len(query) < 2:
        return JsonResponse({'results': []})
    if len(query) > 200:
        return JsonResponse({'error': 'q must be 200 characters or fewer.'}, status=400)
    limit_per_kind = 8
    results = []

    tasks = Task.objects.filter(workspace_id=workspace_id).exclude(state='archived').filter(
        Q(title__icontains=query) | Q(description__icontains=query) | Q(code__icontains=query)
    ).order_by('-updated_at')[:limit_per_kind]
    for task in tasks:
        results.append({'kind': 'task', 'id': task.id, 'title': task.title, 'snippet': (task.description or '')[:160], 'target_type': 'task', 'target_id': task.id, 'meta': task.status})

    risks = RiskIssue.objects.filter(workspace_id=workspace_id).filter(archived_at__isnull=True).filter(
        Q(title__icontains=query) | Q(detail__icontains=query)
    ).order_by('-updated_at')[:limit_per_kind]
    for risk in risks:
        results.append({'kind': 'risk_issue', 'id': risk.id, 'title': risk.title, 'snippet': (risk.detail or '')[:160], 'target_type': 'risk_issue', 'target_id': risk.id, 'meta': risk.kind})

    comments = TaskComment.objects.filter(task__workspace_id=workspace_id).filter(body__icontains=query).select_related('task', 'author').order_by('-created_at')[:limit_per_kind]
    for comment in comments:
        results.append({'kind': 'task_comment', 'id': comment.id, 'title': comment.task.title, 'snippet': comment.body[:160], 'target_type': 'task', 'target_id': comment.task_id, 'meta': comment.author.get_full_name() or comment.author.email})

    allowed_channels = set(accessible_chat_channels(workspace_id, request.user).values_list('name', flat=True))
    messages = ChatMessage.objects.filter(workspace_id=workspace_id, channel__in=allowed_channels).filter(message__icontains=query).select_related('author').order_by('-created_at')[:limit_per_kind]
    for message in messages:
        results.append({'kind': 'chat_message', 'id': message.id, 'title': f'#{message.channel}', 'snippet': message.message[:160], 'target_type': 'chat_channel', 'target_id': message.channel, 'meta': message.author.get_full_name() or message.author.email})

    direct_messages = DirectMessage.objects.filter(conversation__workspace_id=workspace_id, conversation__participants=request.user).filter(message__icontains=query).select_related('author', 'conversation').order_by('-created_at')[:limit_per_kind]
    for message in direct_messages:
        results.append({'kind': 'direct_message', 'id': message.id, 'title': 'Direct message', 'snippet': message.message[:160], 'target_type': 'direct_conversation', 'target_id': message.conversation_id, 'meta': message.author.get_full_name() or message.author.email})

    check_ins = CheckIn.objects.filter(workspace_id=workspace_id).filter(
        Q(completed__icontains=query) | Q(next_steps__icontains=query) | Q(blockers__icontains=query)
    ).select_related('user').order_by('-date')[:limit_per_kind]
    for check_in in check_ins:
        snippet = check_in.completed or check_in.next_steps or check_in.blockers
        results.append({'kind': 'check_in', 'id': check_in.id, 'title': f'{check_in.user.get_full_name() or check_in.user.email} - {check_in.date.isoformat()}', 'snippet': (snippet or '')[:160], 'target_type': 'check_in', 'target_id': check_in.id, 'meta': check_in.date.isoformat()})

    follow_ups = FollowUp.objects.filter(workspace_id=workspace_id).filter(note__icontains=query).order_by('-updated_at')[:limit_per_kind]
    for follow_up in follow_ups:
        results.append({'kind': 'follow_up', 'id': follow_up.id, 'title': follow_up.note[:80], 'snippet': follow_up.note[:160], 'target_type': 'follow_up', 'target_id': follow_up.id, 'meta': follow_up.status})

    return JsonResponse({'results': results, 'query': query})


@require_http_methods(['GET'])
def report_summary(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    tasks = Task.objects.filter(workspace_id=workspace_id).exclude(state='archived')
    report_range = request.GET.get('range', 'all')
    shift_user_id = request.GET.get('shift_user_id')
    try:
        shift_page = max(int(request.GET.get('shift_page', 1)), 1)
    except ValueError:
        return JsonResponse({'error': 'shift_page must be an integer.'}, status=400)
    if shift_user_id is not None and not shift_user_id.isdigit():
        return JsonResponse({'error': 'shift_user_id must be an integer.'}, status=400)
    today = timezone.localdate()
    from .reporting import PROGRESSABLE_STATUSES, apply_report_period
    tasks = apply_report_period(tasks, report_range, today=today)
    status_counts = {item['status']: item['count'] for item in tasks.values('status').annotate(count=Count('id'))}
    overdue_count = tasks.filter(due_date__lt=today, status__in=PROGRESSABLE_STATUSES).count()
    due_this_week = tasks.filter(due_date__gte=today, due_date__lte=today + timedelta(days=6), status__in=PROGRESSABLE_STATUSES).count()
    unassigned_count = tasks.filter(assignee__isnull=True).exclude(status__in=['done', 'cancelled']).count()
    completed_count = status_counts.get('done', 0)
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
    time_clock = time_clock_summary(workspace_id, report_range, today, user_id=shift_user_id, page=shift_page)
    task_count = tasks.count()
    applicable_count = tasks.exclude(status='cancelled').count()
    return JsonResponse({'summary': {
        'total_tasks': task_count,
        'status_counts': status_counts,
        'overdue_tasks': overdue_count,
        'due_this_week': due_this_week,
        'unassigned_tasks': unassigned_count,
        'completion_rate': round((completed_count / applicable_count) * 100) if applicable_count else 0,
        'blocked_tasks': status_counts.get('blocked', 0),
        'check_ins_today': check_in_total,
        'members': member_total,
        'workload': workload,
        'time_clock': time_clock,
    }})


def time_clock_summary(workspace_id, report_range, today, user_id=None, page=1, page_size=20):
    """Aggregate work shifts for the Reports page over the same window the task report uses."""
    from .reporting import named_period_start
    shifts = WorkShift.objects.filter(workspace_id=workspace_id).select_related('user')
    period_start = named_period_start(report_range, today)
    if period_start is not None:
        shifts = shifts.filter(date__gte=period_start)
    if user_id is not None:
        shifts = shifts.filter(user_id=user_id)
    now = timezone.now()
    by_member = {}
    total_seconds = 0
    total_break_seconds = 0
    open_count = 0
    for shift in shifts:
        worked = shift.worked_seconds(now)
        breaks = shift.elapsed_break_seconds(now)
        total_seconds += worked
        total_break_seconds += breaks
        if shift.is_open:
            open_count += 1
        entry = by_member.setdefault(shift.user_id, {
            'user_id': shift.user_id,
            'user_name': shift.user.get_full_name() or shift.user.email,
            'worked_seconds': 0,
            'break_seconds': 0,
            'shift_count': 0,
            'days': set(),
        })
        entry['worked_seconds'] += worked
        entry['break_seconds'] += breaks
        entry['shift_count'] += 1
        entry['days'].add(shift.date)
    members = sorted(by_member.values(), key=lambda entry: entry['worked_seconds'], reverse=True)
    for entry in members:
        entry['day_count'] = len(entry.pop('days'))
    shift_total = sum(entry['shift_count'] for entry in members)
    paginator = Paginator(shifts, page_size)
    try:
        recent_page = paginator.page(page)
    except EmptyPage:
        recent_page = paginator.page(paginator.num_pages)
    return {
        'total_seconds': total_seconds,
        'break_seconds': total_break_seconds,
        'shift_count': shift_total,
        'open_shifts': open_count,
        'average_seconds': round(total_seconds / shift_total) if shift_total else 0,
        'by_member': members,
        'recent': [shift.as_dict() for shift in recent_page.object_list],
        'recent_pagination': {
            'page': recent_page.number,
            'page_size': page_size,
            'total_count': paginator.count,
            'total_pages': paginator.num_pages,
        },
    }


@require_http_methods(['GET', 'POST'])
def task_list(request, workspace_id=None):
    auth_error = require_authenticated(request)
    if auth_error:
        return auth_error

    if workspace_id is not None:
        _, error = require_workspace_member(request, workspace_id)
    else:
        workspace_id, error = requested_workspace(request, request.user)
    if error:
        return error

    if request.method == 'GET':
        tasks = Task.objects.filter(workspace_id=workspace_id).select_related('assignee', 'project_ref', 'workstream_ref', 'phase_ref').prefetch_related('supporters', 'blocked_by', 'blocks')
        scope = request.GET.get('scope', 'all')
        project_filter = request.GET.get('project') or request.GET.get('project_id')
        if scope == 'operations':
            tasks = tasks.filter(project_ref__isnull=True)
        elif scope not in ('', 'all'):
            project_filter = scope
        if project_filter:
            try:
                tasks = tasks.filter(project_ref_id=int(project_filter))
            except ValueError:
                return JsonResponse({'error': 'Project filter must be an integer.'}, status=400)
        filter_map = {'owner': 'assignee_id', 'supporter': 'supporters__id', 'workstream': 'workstream_ref_id', 'phase': 'phase_ref_id', 'status': 'status', 'priority': 'priority'}
        for parameter, lookup in filter_map.items():
            value = request.GET.get(parameter)
            if value:
                if parameter in {'owner', 'supporter', 'workstream', 'phase'}:
                    try:
                        value = int(value)
                    except ValueError:
                        return JsonResponse({'error': f'{parameter} filter must be an integer.'}, status=400)
                tasks = tasks.filter(**{lookup: value})
        date_from, date_error = parse_iso_date(request.GET.get('date_from'), 'date_from')
        if date_error:
            return JsonResponse({'error': date_error}, status=400)
        date_to, date_error = parse_iso_date(request.GET.get('date_to'), 'date_to')
        if date_error:
            return JsonResponse({'error': date_error}, status=400)
        if date_from:
            tasks = tasks.filter(due_date__gte=date_from)
        if date_to:
            tasks = tasks.filter(due_date__lte=date_to)
        today = timezone.localdate()
        if request.GET.get('overdue', '').lower() in {'1', 'true', 'yes'}:
            tasks = tasks.filter(due_date__lt=today).exclude(status='done')
        if request.GET.get('due_soon', '').lower() in {'1', 'true', 'yes'}:
            days = 7
            if project_filter:
                project = Project.objects.filter(id=project_filter, workspace_id=workspace_id).first()
                if project:
                    days = project.due_soon_days
                tasks = tasks.filter(due_date__gte=today, due_date__lte=today + timedelta(days=days)).exclude(status='done')
            else:
                setting = getattr(Workspace.objects.get(id=workspace_id), 'settings', None)
                if setting:
                    days = setting.due_soon_days
                due_scope = Q(project_ref__isnull=True, due_date__lte=today + timedelta(days=days))
                for project_id, project_days in Project.objects.filter(workspace_id=workspace_id).values_list('id', 'due_soon_days'):
                    due_scope |= Q(project_ref_id=project_id, due_date__lte=today + timedelta(days=project_days))
                tasks = tasks.filter(due_date__gte=today).filter(due_scope).exclude(status='done')
        archived = request.GET.get('archived', 'false').lower()
        if archived in {'true', '1', 'yes'}:
            tasks = tasks.filter(state='archived')
        elif archived != 'all':
            tasks = tasks.exclude(state='archived')
        search = request.GET.get('search', '').strip()
        if search:
            tasks = tasks.filter(Q(title__icontains=search) | Q(description__icontains=search) | Q(code__icontains=search) | Q(project_ref__name__icontains=search) | Q(workstream_ref__name__icontains=search) | Q(phase_ref__name__icontains=search))
        sort = request.GET.get('sort', 'default')
        sort_fields = {'default': ('status', 'due_date', '-created_at'), 'due_date': ('due_date', 'id'), '-due_date': ('-due_date', 'id'), 'created_at': ('created_at', 'id'), '-created_at': ('-created_at', 'id'), 'updated_at': ('updated_at', 'id'), '-updated_at': ('-updated_at', 'id'), 'priority': ('priority', 'id'), '-priority': ('-priority', 'id'), 'title': ('title', 'id'), '-title': ('-title', 'id'), 'task_code': ('code', 'id'), '-task_code': ('-code', 'id')}
        if sort not in sort_fields:
            return JsonResponse({'error': 'Unsupported sort value.'}, status=400)
        tasks = tasks.distinct().order_by(*sort_fields[sort])
        try:
            page_size = min(max(int(request.GET.get('page_size', 100)), 1), 200)
            page_number = max(int(request.GET.get('page', 1)), 1)
        except ValueError:
            return JsonResponse({'error': 'page and page_size must be integers.'}, status=400)
        paginator = Paginator(tasks, page_size)
        try:
            page = paginator.page(page_number)
        except EmptyPage:
            page = paginator.page(paginator.num_pages)
        return JsonResponse({'tasks': [task.as_dict() for task in page.object_list], 'pagination': {'page': page.number, 'page_size': page_size, 'total_items': paginator.count, 'total_pages': paginator.num_pages, 'has_next': page.has_next(), 'has_previous': page.has_previous()}})

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)

    create_fields = {'title', 'description', 'assignee_name', 'project', 'bucket', 'status', 'due_date', 'start_date', 'actual_completion_date', 'progress_percent', 'blocker_details', 'recurrence', 'priority', 'labels', 'assignee_id', 'project_id', 'supporter_ids', 'workstream_id', 'phase_id', 'state'}
    unknown_fields = set(payload) - create_fields
    if unknown_fields:
        return JsonResponse({'error': f'Unsupported fields: {", ".join(sorted(unknown_fields))}.'}, status=400)

    title = str(payload.get('title', '')).strip()
    if not title:
        return JsonResponse({'error': 'Task title is required.'}, status=400)
    if len(title) > 200:
        return JsonResponse({'error': 'Task title must be 200 characters or fewer.'}, status=400)

    membership = Membership.objects.get(workspace_id=workspace_id, user=request.user)

    assignee = None
    if payload.get('assignee_id'):
        assignee = User.objects.filter(id=payload['assignee_id'], workspace_memberships__workspace_id=workspace_id).first()
        if assignee is None:
            return JsonResponse({'error': 'Assignee was not found in this workspace.'}, status=404)
    if membership.role == 'member' and assignee is None:
        assignee = request.user
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
    bucket = str(payload.get('bucket', 'Backlog')).strip()
    if not bucket or len(bucket) > 80:
        return JsonResponse({'error': 'Bucket must be between 1 and 80 characters.'}, status=400)
    labels, labels_error = parse_task_labels(payload.get('labels'))
    if labels_error:
        return JsonResponse({'error': labels_error}, status=400)

    max_position = Task.objects.filter(workspace_id=workspace_id, bucket=bucket).aggregate(max_position=Max('position'))['max_position']
    restricted = {'assignee_id', 'assignee_name', 'project_id', 'project', 'supporter_ids', 'workstream_id', 'phase_id', 'state'}
    if membership.role == 'member' and restricted & set(payload):
        return JsonResponse({'error': 'Only owners and managers can set ownership, project, lookup, supporter, or lifecycle fields.'}, status=403)
    start_date, date_error = parse_iso_date(payload.get('start_date'), 'Start date')
    if date_error:
        return JsonResponse({'error': date_error}, status=400)
    actual_date, date_error = parse_iso_date(payload.get('actual_completion_date'), 'Actual completion date')
    if date_error:
        return JsonResponse({'error': date_error}, status=400)
    try:
        progress = int(payload.get('progress_percent', 0))
    except (TypeError, ValueError):
        return JsonResponse({'error': 'Progress must be a whole number between 0 and 100.'}, status=400)
    status = payload.get('status', 'todo')
    if status not in {choice[0] for choice in Task.STATUS_CHOICES}:
        return JsonResponse({'error': 'Invalid task status.'}, status=400)
    if status == 'done':
        progress = 100
        actual_date = actual_date or timezone.localdate()
    with transaction.atomic():
        workspace = Workspace.objects.get(id=workspace_id)
        code = reserve_task_code(workspace)
        task = Task(
            workspace_id=workspace_id, code=code, assignee=assignee, project_ref=project_ref,
            title=title, description=str(payload.get('description', '')).strip(),
            assignee_name=str(payload.get('assignee_name', '')).strip(), project=str(payload.get('project', '')).strip(),
            recurrence=recurrence, priority=priority, due_date=due_date, start_date=start_date,
            actual_completion_date=actual_date, progress_percent=progress,
            blocker_details=str(payload.get('blocker_details', '') or '').strip(), status=status,
            state=payload.get('state', 'active'), bucket=bucket,
            position=(max_position + 1) if max_position is not None else 0, labels=labels or [],
        )
        for field_name, kind in (('workstream_id', 'workstream'), ('phase_id', 'phase')):
            if payload.get(field_name):
                lookup = LookupValue.objects.filter(id=payload[field_name], workspace_id=workspace_id, kind=kind).first()
                if lookup is None:
                    return JsonResponse({'error': f'{kind.title()} was not found in this workspace.'}, status=404)
                setattr(task, f'{kind}_ref', lookup)
                setattr(task, kind, lookup.name)
        try:
            task.full_clean()
        except ValidationError as validation_error:
            return validation_error_response(validation_error)
        task.save()
        TaskCodeRegistry.objects.create(workspace_id=workspace_id, code=code, task_id=task.id)
        supporter_error = set_task_supporters(task, payload.get('supporter_ids'), request.user)
        if supporter_error:
            transaction.set_rollback(True)
            return supporter_error
        TaskChangeHistory.objects.create(task=task, task_code=task.code, workspace_id=workspace_id, actor=request.user, field='created', previous_value=None, new_value={'title': task.title, 'status': task.status})
    record_activity(workspace_id, request.user, 'task_created', f'{request.user.get_full_name() or request.user.email} created task {task.title}.')
    if assignee and assignee != request.user:
        create_notification(workspace_id, assignee, 'task_assigned', 'You were assigned a task.', task.title, target_type='task', target_id=task.id)
    return JsonResponse({'task': task.as_dict()}, status=201)


@require_http_methods(['PATCH'])
def task_reorder(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    columns = payload.get('columns')
    if not isinstance(columns, list) or not columns:
        return JsonResponse({'error': 'columns must be a non-empty list.'}, status=400)
    tasks = {task.id: task for task in Task.objects.filter(workspace_id=workspace_id).exclude(state='archived').prefetch_related('supporters', 'blocked_by', 'blocks')}
    supplied_ids = []
    updates = []
    reorder_history = []
    for column in columns:
        if not isinstance(column, dict):
            return JsonResponse({'error': 'Each column must include a bucket and task_ids.'}, status=400)
        bucket = str(column.get('bucket', '')).strip()
        task_ids = column.get('task_ids')
        if not bucket or len(bucket) > 80 or not isinstance(task_ids, list):
            return JsonResponse({'error': 'Each column must include a valid bucket and task_ids list.'}, status=400)
        for position, task_id in enumerate(task_ids):
            try:
                task_id = int(task_id)
            except (TypeError, ValueError):
                return JsonResponse({'error': 'task_ids must contain valid task IDs.'}, status=400)
            task = tasks.get(task_id)
            if task is None or task_id in supplied_ids:
                return JsonResponse({'error': 'Tasks must belong to the workspace and appear only once.'}, status=400)
            permission_error = require_task_editor(request, task)
            if permission_error:
                return permission_error
            supplied_ids.append(task_id)
            previous_bucket = task.bucket
            previous_position = task.position
            task.bucket = bucket
            task.position = position
            updates.append(task)
            if previous_bucket != bucket:
                reorder_history.append(TaskChangeHistory(task=task, task_code=task.code, workspace_id=workspace_id, actor=request.user, field='bucket', previous_value=previous_bucket, new_value=bucket))
            if previous_position != position:
                reorder_history.append(TaskChangeHistory(task=task, task_code=task.code, workspace_id=workspace_id, actor=request.user, field='position', previous_value=previous_position, new_value=position))
    with transaction.atomic():
        Task.objects.bulk_update(updates, ['bucket', 'position'])
        TaskChangeHistory.objects.bulk_create(reorder_history)
    return JsonResponse({'tasks': [task.as_dict() for task in updates]})


@require_http_methods(['GET', 'POST'])
def plan_bucket_list(request, workspace_id):
    membership_check = require_workspace_leader if request.method == 'POST' else require_workspace_member
    _, error = membership_check(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        buckets = PlanBucket.objects.filter(workspace_id=workspace_id, is_active=True)
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


@require_http_methods(['PATCH'])
def plan_bucket_reorder(request, workspace_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    order = payload.get('bucket_ids')
    if not isinstance(order, list) or not order:
        return JsonResponse({'error': 'bucket_ids must be a non-empty list.'}, status=400)
    buckets = list(PlanBucket.objects.filter(workspace_id=workspace_id, is_active=True))
    by_id = {bucket.id: bucket for bucket in buckets}
    try:
        ids = [int(value) for value in order]
    except (TypeError, ValueError):
        return JsonResponse({'error': 'bucket_ids must contain valid bucket IDs.'}, status=400)
    if set(ids) != set(by_id) or len(ids) != len(by_id):
        return JsonResponse({'error': 'The bucket order must include every workspace bucket exactly once.'}, status=400)
    for position, bucket_id in enumerate(ids):
        bucket = by_id[bucket_id]
        if bucket.position != position:
            bucket.position = position
            bucket.save(update_fields=['position'])
    return JsonResponse({'buckets': [bucket.as_dict() for bucket in PlanBucket.objects.filter(workspace_id=workspace_id, is_active=True)]})


@require_http_methods(['GET', 'POST'])


@require_http_methods(['PATCH', 'DELETE'])
def plan_bucket_detail(request, workspace_id, bucket_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    bucket = PlanBucket.objects.filter(id=bucket_id, workspace_id=workspace_id).first()
    if bucket is None:
        return JsonResponse({'error': 'Bucket was not found.'}, status=404)
    if request.method == 'DELETE':
        bucket.is_active = False
        bucket.save(update_fields=['is_active'])
        record_activity(workspace_id, request.user, 'bucket_archived', f'{request.user.get_full_name() or request.user.email} archived the {bucket.name} bucket.')
        return JsonResponse({'archived': bucket_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if set(payload) - {'name', 'position', 'is_active'}:
        return JsonResponse({'error': 'Unsupported bucket fields.'}, status=400)
    if 'name' in payload:
        name = str(payload['name']).strip()
        if not name or len(name) > 80:
            return JsonResponse({'error': 'Bucket name must be between 1 and 80 characters.'}, status=400)
        if PlanBucket.objects.filter(workspace_id=workspace_id, name=name, is_active=True).exclude(id=bucket.id).exists():
            return JsonResponse({'error': 'A bucket with this name already exists.'}, status=409)
        bucket.name = name
    if 'position' in payload:
        try:
            bucket.position = max(int(payload['position']), 0)
        except (TypeError, ValueError):
            return JsonResponse({'error': 'position must be a non-negative integer.'}, status=400)
    if 'is_active' in payload:
        if not isinstance(payload['is_active'], bool):
            return JsonResponse({'error': 'is_active must be a boolean.'}, status=400)
        bucket.is_active = payload['is_active']
    bucket.save()
    return JsonResponse({'bucket': bucket.as_dict()})



@require_http_methods(['GET', 'POST'])


@require_http_methods(['GET', 'POST'])
def project_resource_list(request, workspace_id, project_id):
    project = Project.objects.filter(id=project_id, workspace_id=workspace_id).first()
    if project is None:
        return JsonResponse({'error': 'Project was not found.'}, status=404)
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        resources = ProjectResource.objects.filter(project_id=project_id, is_active=True)
        return JsonResponse({'resources': [resource.as_dict() for resource in resources]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    name = str(payload.get('name', '')).strip()
    if not name or len(name) > 160:
        return JsonResponse({'error': 'Resource name must be between 1 and 160 characters.'}, status=400)
    resource_type = payload.get('resource_type', 'person')
    if resource_type not in dict(ProjectResource.RESOURCE_TYPES):
        return JsonResponse({'error': 'Invalid resource type.'}, status=400)
    resource = ProjectResource.objects.create(project_id=project_id, name=name, resource_type=resource_type, availability=str(payload.get('availability', '')).strip(), notes=str(payload.get('notes', '')).strip())
    return JsonResponse({'resource': resource.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def project_resource_detail(request, workspace_id, project_id, resource_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    resource = ProjectResource.objects.filter(id=resource_id, project_id=project_id).first()
    if resource is None:
        return JsonResponse({'error': 'Resource was not found.'}, status=404)
    if request.method == 'DELETE':
        resource.is_active = False
        resource.save(update_fields=['is_active'])
        return JsonResponse({'archived': resource_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if set(payload) - {'name', 'resource_type', 'availability', 'notes'}:
        return JsonResponse({'error': 'Unsupported resource fields.'}, status=400)
    if 'name' in payload:
        name = str(payload['name']).strip()
        if not name or len(name) > 160:
            return JsonResponse({'error': 'Resource name must be between 1 and 160 characters.'}, status=400)
        resource.name = name
    if 'resource_type' in payload:
        if payload['resource_type'] not in dict(ProjectResource.RESOURCE_TYPES):
            return JsonResponse({'error': 'Invalid resource type.'}, status=400)
        resource.resource_type = payload['resource_type']
    if 'availability' in payload:
        resource.availability = str(payload['availability']).strip()
    if 'notes' in payload:
        resource.notes = str(payload['notes']).strip()
    resource.save()
    return JsonResponse({'resource': resource.as_dict()})


@require_http_methods(['GET', 'POST'])
def project_stakeholder_list(request, workspace_id, project_id):
    project = Project.objects.filter(id=project_id, workspace_id=workspace_id).first()
    if project is None:
        return JsonResponse({'error': 'Project was not found.'}, status=404)
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        stakeholders = ProjectStakeholder.objects.filter(project_id=project_id, is_active=True)
        return JsonResponse({'stakeholders': [stakeholder.as_dict() for stakeholder in stakeholders]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    name = str(payload.get('name', '')).strip()
    if not name or len(name) > 160:
        return JsonResponse({'error': 'Stakeholder name must be between 1 and 160 characters.'}, status=400)
    influence = payload.get('influence', 'medium')
    interest = payload.get('interest', 'medium')
    if influence not in dict(ProjectStakeholder.INFLUENCE_CHOICES) or interest not in dict(ProjectStakeholder.INTEREST_CHOICES):
        return JsonResponse({'error': 'Invalid influence or interest.'}, status=400)
    stakeholder = ProjectStakeholder.objects.create(project_id=project_id, name=name, role=str(payload.get('role', '')).strip(), email=str(payload.get('email', '')).strip(), influence=influence, interest=interest, notes=str(payload.get('notes', '')).strip())
    return JsonResponse({'stakeholder': stakeholder.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def project_stakeholder_detail(request, workspace_id, project_id, stakeholder_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    stakeholder = ProjectStakeholder.objects.filter(id=stakeholder_id, project_id=project_id).first()
    if stakeholder is None:
        return JsonResponse({'error': 'Stakeholder was not found.'}, status=404)
    if request.method == 'DELETE':
        stakeholder.is_active = False
        stakeholder.save(update_fields=['is_active'])
        return JsonResponse({'archived': stakeholder_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if set(payload) - {'name', 'role', 'email', 'influence', 'interest', 'notes'}:
        return JsonResponse({'error': 'Unsupported stakeholder fields.'}, status=400)
    if 'name' in payload:
        name = str(payload['name']).strip()
        if not name or len(name) > 160:
            return JsonResponse({'error': 'Stakeholder name must be between 1 and 160 characters.'}, status=400)
        stakeholder.name = name
    if 'role' in payload:
        stakeholder.role = str(payload['role']).strip()
    if 'email' in payload:
        stakeholder.email = str(payload['email']).strip()
    if 'influence' in payload and payload['influence'] not in dict(ProjectStakeholder.INFLUENCE_CHOICES):
        return JsonResponse({'error': 'Invalid influence.'}, status=400)
    if 'interest' in payload and payload['interest'] not in dict(ProjectStakeholder.INTEREST_CHOICES):
        return JsonResponse({'error': 'Invalid interest.'}, status=400)
    for field in ('role', 'email', 'influence', 'interest', 'notes'):
        if field in payload:
            setattr(stakeholder, field, payload[field])
    stakeholder.save()
    return JsonResponse({'stakeholder': stakeholder.as_dict()})

def task_template_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        templates = TaskTemplate.objects.filter(workspace_id=workspace_id)
        return JsonResponse({'task_templates': [template.as_dict() for template in templates]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    name = str(payload.get('name', '')).strip()
    title = str(payload.get('title', '')).strip()
    if not name or len(name) > 120:
        return JsonResponse({'error': 'Template name must be between 1 and 120 characters.'}, status=400)
    if not title or len(title) > 200:
        return JsonResponse({'error': 'Task title must be between 1 and 200 characters.'}, status=400)
    priority = payload.get('priority', 'normal')
    if priority not in dict(Task.PRIORITY_CHOICES):
        return JsonResponse({'error': 'Invalid task priority.'}, status=400)
    recurrence = payload.get('recurrence', 'none')
    if recurrence not in dict(Task.RECURRENCE_CHOICES):
        return JsonResponse({'error': 'Invalid recurrence.'}, status=400)
    project = Project.objects.filter(id=payload.get('project_id'), workspace_id=workspace_id).first() if payload.get('project_id') else None
    if payload.get('project_id') and project is None:
        return JsonResponse({'error': 'Project was not found.'}, status=404)
    assignee = User.objects.filter(id=payload.get('assignee_id')).first() if payload.get('assignee_id') else None
    labels = payload.get('labels')
    if labels is not None and not isinstance(labels, list):
        return JsonResponse({'error': 'labels must be a list.'}, status=400)
    template = TaskTemplate.objects.create(
        workspace_id=workspace_id,
        name=name,
        title=title,
        description=str(payload.get('description', '')).strip(),
        priority=priority,
        bucket=str(payload.get('bucket', 'Backlog')).strip() or 'Backlog',
        recurrence=recurrence,
        project=project,
        assignee=assignee,
        workstream=str(payload.get('workstream', '')).strip(),
        labels=labels or [],
        created_by=request.user,
    )
    record_activity(workspace_id, request.user, 'task_template_created', f'{request.user.get_full_name() or request.user.email} created task template {template.name}.')
    return JsonResponse({'task_template': template.as_dict()}, status=201)


@require_http_methods(['DELETE'])
def task_template_detail(request, workspace_id, template_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    template = TaskTemplate.objects.filter(id=template_id, workspace_id=workspace_id).first()
    if template is None:
        return JsonResponse({'error': 'Task template was not found.'}, status=404)
    template.delete()
    record_activity(workspace_id, request.user, 'task_template_deleted', f'{request.user.get_full_name() or request.user.email} deleted task template {template.name}.')
    return JsonResponse({'deleted': template_id})


@require_http_methods(['POST'])
def task_template_apply(request, workspace_id, template_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    template = TaskTemplate.objects.filter(id=template_id, workspace_id=workspace_id).first()
    if template is None:
        return JsonResponse({'error': 'Task template was not found.'}, status=404)
    task = Task.objects.create(
        workspace_id=workspace_id,
        title=template.title,
        description=template.description,
        priority=template.priority,
        bucket=template.bucket,
        recurrence=template.recurrence,
        project_ref=template.project,
        assignee=template.assignee,
        assignee_name=template.assignee.get_full_name() or template.assignee.email if template.assignee else '',
        project=template.project.name if template.project else '',
        workstream=template.workstream,
        labels=template.labels or [],
    )
    record_activity(workspace_id, request.user, 'task_created', f'{request.user.get_full_name() or request.user.email} created task {task.title} from template {template.name}.')
    return JsonResponse({'task': task.as_dict()}, status=201)


@require_http_methods(['GET', 'POST'])
def project_template_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        templates = ProjectTemplate.objects.filter(workspace_id=workspace_id)
        return JsonResponse({'project_templates': [template.as_dict() for template in templates]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    name = str(payload.get('name', '')).strip()
    project_name = str(payload.get('project_name', '')).strip()
    if not name or len(name) > 120:
        return JsonResponse({'error': 'Template name must be between 1 and 120 characters.'}, status=400)
    if not project_name or len(project_name) > 160:
        return JsonResponse({'error': 'Project name must be between 1 and 160 characters.'}, status=400)
    try:
        due_days = int(payload.get('due_days', 14))
    except (TypeError, ValueError):
        return JsonResponse({'error': 'due_days must be an integer.'}, status=400)
    if not 0 <= due_days <= 365:
        return JsonResponse({'error': 'due_days must be between 0 and 365.'}, status=400)
    template = ProjectTemplate.objects.create(
        workspace_id=workspace_id,
        name=name,
        project_name=project_name,
        description=str(payload.get('description', '')).strip(),
        due_days=due_days,
        created_by=request.user,
    )
    record_activity(workspace_id, request.user, 'project_template_created', f'{request.user.get_full_name() or request.user.email} created project template {template.name}.')
    return JsonResponse({'project_template': template.as_dict()}, status=201)


@require_http_methods(['DELETE'])
def project_template_detail(request, workspace_id, template_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    template = ProjectTemplate.objects.filter(id=template_id, workspace_id=workspace_id).first()
    if template is None:
        return JsonResponse({'error': 'Project template was not found.'}, status=404)
    template.delete()
    record_activity(workspace_id, request.user, 'project_template_deleted', f'{request.user.get_full_name() or request.user.email} deleted project template {template.name}.')
    return JsonResponse({'deleted': template_id})


@require_http_methods(['POST'])
def project_template_apply(request, workspace_id, template_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    template = ProjectTemplate.objects.filter(id=template_id, workspace_id=workspace_id).first()
    if template is None:
        return JsonResponse({'error': 'Project template was not found.'}, status=404)
    project = Project.objects.create(
        workspace_id=workspace_id,
        name=template.project_name,
        description=template.description,
        status='planning',
        due_date=date.today() + timedelta(days=template.due_days),
    )
    record_activity(workspace_id, request.user, 'project_created', f'{request.user.get_full_name() or request.user.email} created project {project.name} from template {template.name}.')
    return JsonResponse({'project': project.as_dict()}, status=201)

def saved_view_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        views = SavedView.objects.filter(workspace_id=workspace_id, user=request.user)
        return JsonResponse({'saved_views': [view.as_dict() for view in views]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    name = str(payload.get('name', '')).strip()
    filter_value = str(payload.get('filter', 'all')).strip()
    search = str(payload.get('search', '')).strip()
    project_scope = str(payload.get('project_scope', 'all')).strip() or 'all'
    if not name or len(name) > 100:
        return JsonResponse({'error': 'Saved view name must be between 1 and 100 characters.'}, status=400)
    if len(filter_value) > 300 or len(search) > 200 or len(project_scope) > 80:
        return JsonResponse({'error': 'Saved view filters and searches are too long.'}, status=400)
    view, _ = SavedView.objects.update_or_create(workspace_id=workspace_id, user=request.user, name=name, defaults={'filter_value': filter_value, 'search': search, 'project_scope': project_scope})
    return JsonResponse({'saved_view': view.as_dict()}, status=201)


@require_http_methods(['DELETE'])
def saved_view_detail(request, workspace_id, view_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    view = SavedView.objects.filter(id=view_id, workspace_id=workspace_id, user=request.user).first()
    if view is None:
        return JsonResponse({'error': 'Saved view was not found.'}, status=404)
    view.delete()
    return JsonResponse({'deleted': view_id})


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
            return JsonResponse({'error': 'Only owners and managers can archive tasks.'}, status=403)
        hard_delete = request.GET.get('permanent', '').lower() in {'1', 'true', 'yes'}
        if hard_delete:
            if membership.role != 'owner':
                return JsonResponse({'error': 'Only workspace owners can permanently delete tasks.'}, status=403)
            TaskChangeHistory.objects.create(task=task, task_code=task.code, workspace_id=task.workspace_id, actor=request.user, field='permanently_deleted', previous_value={'title': task.title, 'state': task.state}, new_value=None)
            for attachment in task.attachments.all():
                attachment.file.delete(save=False)
            task.delete()
            record_activity(task.workspace_id, request.user, 'task_permanently_deleted', f'{request.user.get_full_name() or request.user.email} permanently deleted task {task.title}.')
            return JsonResponse({'deleted': task_id, 'permanent': True})
        previous_state = task.state
        task.state = 'archived'
        task.archived_at = timezone.now()
        task.archived_by = request.user
        task.save(update_fields=['state', 'archived_at', 'archived_by', 'updated_at'])
        record_task_changes(task, request.user, {'state': previous_state}, ['state'])
        record_activity(task.workspace_id, request.user, 'task_archived', f'{request.user.get_full_name() or request.user.email} archived task {task.title}.')
        return JsonResponse({'deleted': task_id, 'archived': True, 'task': task.as_dict()})

    if membership.role == 'member' and task.assignee_id != request.user.id:
        return JsonResponse({'error': 'Members can only update tasks assigned to them.'}, status=403)

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)

    allowed_fields = {'title', 'description', 'assignee_name', 'project', 'bucket', 'status', 'due_date', 'start_date', 'actual_completion_date', 'progress_percent', 'blocker_details', 'recurrence', 'priority', 'labels', 'assignee_id', 'project_id', 'supporter_ids', 'workstream_id', 'phase_id', 'state', 'blocked_by_ids'}
    unknown_fields = set(payload) - allowed_fields
    if unknown_fields:
        return JsonResponse({'error': f'Unsupported fields: {", ".join(sorted(unknown_fields))}.'}, status=400)
    leader_fields = {'assignee_id', 'assignee_name', 'project_id', 'project', 'supporter_ids', 'workstream_id', 'phase_id', 'state'}
    if membership.role == 'member' and leader_fields & set(payload):
        return JsonResponse({'error': 'Only owners and managers can change ownership, project, lookup, supporter, or lifecycle fields.'}, status=403)

    material_fields = ['title', 'description', 'assignee_id', 'project_ref_id', 'bucket', 'status', 'due_date', 'start_date', 'actual_completion_date', 'progress_percent', 'blocker_details', 'recurrence', 'priority', 'labels', 'workstream_ref_id', 'phase_ref_id', 'state']
    previous_values = task_snapshot(task, material_fields)
    previous_supporters = list(task.supporters.values_list('id', flat=True))

    previous_title = task.title
    previous_status = task.status
    previous_assignee = task.assignee
    previous_priority = task.priority
    previous_due_date = task.due_date
    previous_recurrence = task.recurrence
    previous_bucket = task.bucket
    previous_labels = list(task.labels or [])
    previous_project = task.project_ref

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
        task.completed_at = timezone.now() if task.status == 'done' else None
        if task.status == 'done':
            task.progress_percent = 100
            task.actual_completion_date = task.actual_completion_date or timezone.localdate()
        elif previous_status == 'done' and 'progress_percent' not in payload:
            task.progress_percent = 0
            task.actual_completion_date = None

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

    for payload_field, model_field, label in (
        ('start_date', 'start_date', 'Start date'),
        ('actual_completion_date', 'actual_completion_date', 'Actual completion date'),
    ):
        if payload_field in payload:
            parsed, date_error = parse_iso_date(payload[payload_field], label)
            if date_error:
                return JsonResponse({'error': date_error}, status=400)
            setattr(task, model_field, parsed)
    if 'progress_percent' in payload:
        try:
            task.progress_percent = int(payload['progress_percent'])
        except (TypeError, ValueError):
            return JsonResponse({'error': 'Progress must be a whole number between 0 and 100.'}, status=400)
    if 'blocker_details' in payload:
        task.blocker_details = str(payload['blocker_details'] or '').strip()

    if 'assignee_id' in payload:
        task.assignee = User.objects.filter(id=payload['assignee_id'], workspace_memberships__workspace_id=task.workspace_id).first() if payload['assignee_id'] else None
        if payload['assignee_id'] and task.assignee is None:
            return JsonResponse({'error': 'Assignee was not found in this workspace.'}, status=404)
    if 'project_id' in payload:
        task.project_ref = Project.objects.filter(id=payload['project_id'], workspace_id=task.workspace_id).first() if payload['project_id'] else None
        if payload['project_id'] and task.project_ref is None:
            return JsonResponse({'error': 'Project was not found in this workspace.'}, status=404)

    for payload_field, relation_field, legacy_field, kind in (
        ('workstream_id', 'workstream_ref', 'workstream', 'workstream'),
        ('phase_id', 'phase_ref', 'phase', 'phase'),
    ):
        if payload_field in payload:
            lookup = LookupValue.objects.filter(id=payload[payload_field], workspace_id=task.workspace_id, kind=kind).first() if payload[payload_field] else None
            if payload[payload_field] and lookup is None:
                return JsonResponse({'error': f'{kind.title()} was not found in this workspace.'}, status=404)
            setattr(task, relation_field, lookup)
            setattr(task, legacy_field, lookup.name if lookup else '')

    if 'state' in payload:
        if payload['state'] not in {choice[0] for choice in Task.STATE_CHOICES}:
            return JsonResponse({'error': 'Invalid task lifecycle state.'}, status=400)
        task.state = payload['state']
        task.archived_at = timezone.now() if task.state == 'archived' else None
        task.archived_by = request.user if task.state == 'archived' else None

    for field in {'description', 'assignee_name', 'project'} & set(payload):
        setattr(task, field, str(payload[field] or '').strip())

    try:
        task.full_clean()
    except ValidationError as validation_error:
        return validation_error_response(validation_error)
    with transaction.atomic():
        task.save()
        supporter_error = set_task_supporters(task, payload.get('supporter_ids') if 'supporter_ids' in payload else None, request.user)
        if supporter_error:
            transaction.set_rollback(True)
            return supporter_error
        blocked_by_error = set_task_blocked_by(task, payload.get('blocked_by_ids') if 'blocked_by_ids' in payload else None)
        if blocked_by_error:
            transaction.set_rollback(True)
            return blocked_by_error
        record_task_changes(task, request.user, previous_values, material_fields)
        if 'supporter_ids' in payload:
            new_supporters = list(task.supporters.values_list('id', flat=True))
            if sorted(previous_supporters) != sorted(new_supporters):
                TaskChangeHistory.objects.create(task=task, task_code=task.code, workspace_id=task.workspace_id, actor=request.user, field='supporter_ids', previous_value=previous_supporters, new_value=new_supporters)
    actor_name = request.user.get_full_name() or request.user.email
    if previous_status != task.status:
        record_activity(task.workspace_id, request.user, 'task_status', f'{actor_name} moved {task.title} to {task.get_status_display()}.')
        if task.assignee and task.assignee != request.user:
            create_notification(task.workspace_id, task.assignee, 'task_status', f'Task status changed: {task.title}', task.get_status_display(), target_type='task', target_id=task.id)
    if previous_title != task.title:
        record_activity(task.workspace_id, request.user, 'task_title', f'{actor_name} renamed task {previous_title} to {task.title}.')
    if previous_priority != task.priority:
        record_activity(task.workspace_id, request.user, 'task_priority', f'{actor_name} changed the priority of {task.title} to {task.get_priority_display()}.')
    if previous_due_date != task.due_date:
        due_label = task.due_date.isoformat() if task.due_date else 'no due date'
        record_activity(task.workspace_id, request.user, 'task_due_date', f'{actor_name} changed the due date of {task.title} to {due_label}.')
    if previous_recurrence != task.recurrence:
        record_activity(task.workspace_id, request.user, 'task_recurrence', f'{actor_name} changed recurrence for {task.title} to {task.get_recurrence_display()}.')
    if previous_bucket != task.bucket:
        record_activity(task.workspace_id, request.user, 'task_bucket', f'{actor_name} moved {task.title} to the {task.bucket} bucket.')
    if previous_labels != list(task.labels or []):
        record_activity(task.workspace_id, request.user, 'task_labels', f'{actor_name} updated labels for {task.title}.')
    if previous_project != task.project_ref:
        if task.project_ref:
            record_activity(task.workspace_id, request.user, 'task_project', f'{actor_name} assigned {task.title} to project {task.project_ref.name}.')
        else:
            record_activity(task.workspace_id, request.user, 'task_project', f'{actor_name} removed {task.title} from its project.')
    if previous_assignee != task.assignee and task.assignee and task.assignee != request.user:
        record_activity(task.workspace_id, request.user, 'task_assigned', f'{request.user.get_full_name() or request.user.email} assigned {task.title} to {task.assignee.get_full_name() or task.assignee.email}.')
        create_notification(task.workspace_id, task.assignee, 'task_assigned', 'You were assigned a task.', task.title, target_type='task', target_id=task.id)
    next_task = None
    if previous_status != 'done' and task.status == 'done' and task.recurrence != 'none':
        with transaction.atomic():
            next_code = reserve_task_code(task.workspace)
            next_task = Task.objects.create(
                workspace=task.workspace, code=next_code, assignee=task.assignee,
                project_ref=task.project_ref, title=task.title, description=task.description,
                assignee_name=task.assignee_name, project=task.project,
                workstream=task.workstream, phase=task.phase, workstream_ref=task.workstream_ref,
                phase_ref=task.phase_ref, bucket=task.bucket, labels=task.labels,
                due_date=next_recurrence_date(task.due_date, task.recurrence),
                recurrence=task.recurrence, priority=task.priority,
            )
            TaskCodeRegistry.objects.create(workspace=task.workspace, code=next_code, task_id=next_task.id)
            for link in task.supporter_links.all():
                TaskSupporter.objects.create(task=next_task, user_id=link.user_id, added_by=request.user)
            TaskChangeHistory.objects.create(task=next_task, task_code=next_code, workspace=task.workspace, actor=request.user, field='created_by_recurrence', previous_value=None, new_value={'source_task_id': task.id})
        record_activity(task.workspace_id, request.user, 'task_recurred', f'Created the next {task.recurrence} occurrence of {task.title}.')
    return JsonResponse({'task': task.as_dict(), 'next_task': next_task.as_dict() if next_task else None})


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
        create_notification(task.workspace_id, task.assignee, 'task_comment', f'New comment on {task.title}', body[:120], target_type='task', target_id=task.id)
    return JsonResponse({'comment': comment.as_dict()}, status=201)


@require_http_methods(['GET', 'POST'])
def task_subtask_list(request, task_id):
    auth_error = require_authenticated(request)
    if auth_error:
        return auth_error
    task = Task.objects.filter(id=task_id, workspace_id__in=user_workspace_ids(request.user)).first()
    if task is None:
        return JsonResponse({'error': 'Task was not found.'}, status=404)
    if request.method == 'POST':
        permission_error = require_task_editor(request, task)
        if permission_error:
            return permission_error
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
    permission_error = require_task_editor(request, subtask.task)
    if permission_error:
        return permission_error
    if request.method == 'DELETE':
        record_activity(subtask.task.workspace_id, request.user, 'subtask_deleted', f'{request.user.get_full_name() or request.user.email} deleted a subtask from {subtask.task.title}.')
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
    permission_error = require_task_editor(request, task)
    if permission_error:
        return permission_error
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
    permission_error = require_task_editor(request, attachment.task)
    if permission_error:
        return permission_error
    record_activity(attachment.task.workspace_id, request.user, 'task_attachment_deleted', f'{request.user.get_full_name() or request.user.email} deleted {attachment.original_name} from {attachment.task.title}.')
    attachment.file.delete(save=False)
    attachment.delete()
    return JsonResponse({'deleted': attachment_id})


@require_http_methods(['GET'])
def task_attachment_download(request, attachment_id):
    auth_error = require_authenticated(request)
    if auth_error:
        return auth_error
    attachment = TaskAttachment.objects.filter(id=attachment_id, task__workspace_id__in=user_workspace_ids(request.user)).first()
    if attachment is None:
        return JsonResponse({'error': 'Attachment was not found.'}, status=404)
    if not attachment.file:
        return JsonResponse({'error': 'Attachment file is unavailable.'}, status=404)
    try:
        attachment_file = attachment.file.open('rb')
    except FileNotFoundError:
        return JsonResponse({'error': 'Attachment file is unavailable.'}, status=404)
    return FileResponse(attachment_file, as_attachment=True, filename=attachment.original_name)


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


@require_http_methods(['GET', 'PATCH'])
def notification_preference_detail(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    preference, _ = NotificationPreference.objects.get_or_create(workspace_id=workspace_id, user=request.user)
    if request.method == 'GET':
        return JsonResponse({'preferences': preference.as_dict()})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    fields = ['mentions', 'direct_messages', 'task_updates', 'calendar_reminders']
    updated_fields = []
    for field in fields:
        if field in payload:
            if not isinstance(payload[field], bool):
                return JsonResponse({'error': f'{field} must be true or false.'}, status=400)
            setattr(preference, field, payload[field])
            updated_fields.append(field)
    if updated_fields:
        preference.save(update_fields=updated_fields)
    return JsonResponse({'preferences': preference.as_dict()})


@require_http_methods(['GET', 'POST'])
def workspace_webhook_list(request, workspace_id):
    membership_check = require_workspace_leader if request.method == 'POST' else require_workspace_member
    _, error = membership_check(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        hooks = WorkspaceWebhook.objects.filter(workspace_id=workspace_id)
        return JsonResponse({'webhooks': [hook.as_dict() for hook in hooks]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    url = str(payload.get('url', '')).strip()
    kind = str(payload.get('kind', 'teams')).strip()
    label = str(payload.get('label', '')).strip()
    if kind not in {choice[0] for choice in WorkspaceWebhook.KIND_CHOICES}:
        return JsonResponse({'error': 'kind must be teams, slack, or generic.'}, status=400)
    if not url.startswith('https://') or len(url) > 500:
        return JsonResponse({'error': 'url must be an https link of 500 characters or fewer.'}, status=400)
    if len(label) > 120:
        return JsonResponse({'error': 'label must be 120 characters or fewer.'}, status=400)
    hook = WorkspaceWebhook.objects.create(workspace_id=workspace_id, kind=kind, url=url, label=label, created_by=request.user)
    record_activity(workspace_id, request.user, 'webhook_created', f'{request.user.get_full_name() or request.user.email} connected a {hook.get_kind_display()} webhook.')
    return JsonResponse({'webhook': hook.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def workspace_webhook_detail(request, workspace_id, webhook_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    hook = WorkspaceWebhook.objects.filter(id=webhook_id, workspace_id=workspace_id).first()
    if hook is None:
        return JsonResponse({'error': 'Webhook was not found.'}, status=404)
    if request.method == 'DELETE':
        hook.delete()
        return JsonResponse({'deleted': webhook_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if set(payload) - {'is_active', 'label'}:
        return JsonResponse({'error': 'Unsupported webhook fields.'}, status=400)
    if 'is_active' in payload:
        if not isinstance(payload['is_active'], bool):
            return JsonResponse({'error': 'is_active must be a boolean.'}, status=400)
        hook.is_active = payload['is_active']
    if 'label' in payload:
        label = str(payload['label']).strip()
        if len(label) > 120:
            return JsonResponse({'error': 'label must be 120 characters or fewer.'}, status=400)
        hook.label = label
    hook.save()
    return JsonResponse({'webhook': hook.as_dict()})


@require_http_methods(['GET'])
def activity_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    from .models import ActivityEvent
    events = ActivityEvent.objects.filter(workspace_id=workspace_id).select_related('actor')
    try:
        page_size = min(max(int(request.GET.get('page_size', 50)), 1), 500)
        page_number = max(int(request.GET.get('page', 1)), 1)
    except ValueError:
        return JsonResponse({'error': 'page and page_size must be integers.'}, status=400)
    paginator = Paginator(events, page_size)
    try:
        page = paginator.page(page_number)
    except EmptyPage:
        page = paginator.page(paginator.num_pages)
    return JsonResponse({
        'activity': [event.as_dict() for event in page.object_list],
        'pagination': {
            'page': page.number,
            'page_size': page_size,
            'total_items': paginator.count,
            'total_pages': paginator.num_pages,
            'has_next': page.has_next(),
            'has_previous': page.has_previous(),
        },
    })


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
    members = Membership.objects.filter(workspace_id=workspace_id).select_related('user', 'user__profile')
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


@require_http_methods(['DELETE'])
def invitation_detail(request, workspace_id, invitation_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    invitation = WorkspaceInvitation.objects.filter(id=invitation_id, workspace_id=workspace_id, status='pending').first()
    if invitation is None:
        return JsonResponse({'error': 'Pending invitation was not found.'}, status=404)
    invitation.status = 'cancelled'
    invitation.save(update_fields=['status'])
    record_activity(workspace_id, request.user, 'invitation_cancelled', f'{request.user.get_full_name() or request.user.email} cancelled an invitation for {invitation.email}.')
    return JsonResponse({'invitation': invitation.as_dict()})


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
    dates = {}
    for field in ('due_date', 'start_date', 'end_date', 'week_anchor_date'):
        dates[field], date_error = parse_iso_date(payload.get(field), field.replace('_', ' ').title())
        if date_error:
            return JsonResponse({'error': date_error}, status=400)
    if dates['start_date'] and dates['end_date'] and dates['end_date'] < dates['start_date']:
        return JsonResponse({'error': 'Project end date cannot precede start date.'}, status=400)
    project_timezone = str(payload.get('timezone', timezone.get_current_timezone_name())).strip()
    try:
        ZoneInfo(project_timezone)
    except ZoneInfoNotFoundError:
        return JsonResponse({'error': 'timezone must be a valid IANA timezone name.'}, status=400)
    configuration = payload.get('configuration', {})
    if not isinstance(configuration, dict):
        return JsonResponse({'error': 'configuration must be a JSON object.'}, status=400)
    try:
        due_soon_days = int(payload.get('due_soon_days', 7))
    except (TypeError, ValueError):
        return JsonResponse({'error': 'due_soon_days must be an integer.'}, status=400)
    if not 0 <= due_soon_days <= 365:
        return JsonResponse({'error': 'due_soon_days must be between 0 and 365.'}, status=400)
    try:
        project = Project.objects.create(workspace_id=workspace_id, name=name, description=str(payload.get('description', '')).strip(), timezone=project_timezone, due_soon_days=due_soon_days, configuration=configuration, **dates)
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
    allowed_fields = {'name', 'description', 'status', 'due_date', 'start_date', 'end_date', 'timezone', 'week_anchor_date', 'due_soon_days', 'configuration'}
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
    for field in ('due_date', 'start_date', 'end_date', 'week_anchor_date'):
        if field in payload:
            parsed, date_error = parse_iso_date(payload[field], field.replace('_', ' ').title())
            if date_error:
                return JsonResponse({'error': date_error}, status=400)
            setattr(project, field, parsed)
    if project.start_date and project.end_date and project.end_date < project.start_date:
        return JsonResponse({'error': 'Project end date cannot precede start date.'}, status=400)
    if 'timezone' in payload:
        try:
            ZoneInfo(str(payload['timezone']))
        except ZoneInfoNotFoundError:
            return JsonResponse({'error': 'timezone must be a valid IANA timezone name.'}, status=400)
        project.timezone = str(payload['timezone'])
    if 'due_soon_days' in payload:
        try:
            project.due_soon_days = int(payload['due_soon_days'])
        except (TypeError, ValueError):
            return JsonResponse({'error': 'due_soon_days must be an integer.'}, status=400)
        if not 0 <= project.due_soon_days <= 365:
            return JsonResponse({'error': 'due_soon_days must be between 0 and 365.'}, status=400)
    if 'configuration' in payload:
        if not isinstance(payload['configuration'], dict):
            return JsonResponse({'error': 'configuration must be a JSON object.'}, status=400)
        project.configuration = payload['configuration']
    project.save()
    record_activity(workspace_id, request.user, 'project_updated', f'{request.user.get_full_name() or request.user.email} updated project {project.name}.')
    return JsonResponse({'project': project.as_dict()})


@require_http_methods(['GET', 'POST'])
def lookup_value_list(request, workspace_id):
    membership_check = require_workspace_leader if request.method == 'POST' else require_workspace_member
    _, error = membership_check(request, workspace_id)
    if error:
        return error
    values = LookupValue.objects.filter(workspace_id=workspace_id)
    if request.method == 'GET':
        if request.GET.get('kind'):
            values = values.filter(kind=request.GET['kind'])
        if request.GET.get('project_id'):
            values = values.filter(Q(project_id=request.GET['project_id']) | Q(project__isnull=True))
        if request.GET.get('active', 'true').lower() != 'all':
            values = values.filter(is_active=request.GET.get('active', 'true').lower() not in {'false', '0', 'no'})
        return JsonResponse({'lookup_values': [value.as_dict() for value in values]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    kind = payload.get('kind')
    name = str(payload.get('name', '')).strip()
    if kind not in {choice[0] for choice in LookupValue.KIND_CHOICES}:
        return JsonResponse({'error': 'kind must be workstream or phase.'}, status=400)
    if not name or len(name) > 120:
        return JsonResponse({'error': 'name must be between 1 and 120 characters.'}, status=400)
    project = None
    if payload.get('project_id'):
        project = Project.objects.filter(id=payload['project_id'], workspace_id=workspace_id).first()
        if project is None:
            return JsonResponse({'error': 'Project was not found.'}, status=404)
    value_slug = slugify(name)[:140] or kind
    if LookupValue.objects.filter(workspace_id=workspace_id, project=project, kind=kind, slug=value_slug).exists():
        return JsonResponse({'error': 'This lookup value already exists in the selected scope.'}, status=409)
    try:
        position = max(int(payload.get('position', 0)), 0)
    except (TypeError, ValueError):
        return JsonResponse({'error': 'position must be a non-negative integer.'}, status=400)
    value = LookupValue.objects.create(workspace_id=workspace_id, project=project, kind=kind, name=name, slug=value_slug, position=position)
    return JsonResponse({'lookup_value': value.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def lookup_value_detail(request, workspace_id, value_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    value = LookupValue.objects.filter(id=value_id, workspace_id=workspace_id).first()
    if value is None:
        return JsonResponse({'error': 'Lookup value was not found.'}, status=404)
    if request.method == 'DELETE':
        value.is_active = False
        value.save(update_fields=['is_active'])
        return JsonResponse({'archived': value_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if set(payload) - {'name', 'position', 'is_active'}:
        return JsonResponse({'error': 'Unsupported lookup value fields.'}, status=400)
    if 'name' in payload:
        name = str(payload['name']).strip()
        if not name or len(name) > 120:
            return JsonResponse({'error': 'name must be between 1 and 120 characters.'}, status=400)
        value.name = name
        value.slug = slugify(name)[:140] or value.kind
    if 'position' in payload:
        try:
            value.position = max(int(payload['position']), 0)
        except (TypeError, ValueError):
            return JsonResponse({'error': 'position must be a non-negative integer.'}, status=400)
    if 'is_active' in payload:
        if not isinstance(payload['is_active'], bool):
            return JsonResponse({'error': 'is_active must be a boolean.'}, status=400)
        value.is_active = payload['is_active']
    try:
        value.save()
    except IntegrityError:
        return JsonResponse({'error': 'This lookup value already exists in the selected scope.'}, status=409)
    return JsonResponse({'lookup_value': value.as_dict()})


@require_http_methods(['GET'])
def task_history_list(request, task_id):
    task = Task.objects.filter(id=task_id, workspace_id__in=user_workspace_ids(request.user)).first() if request.user.is_authenticated else None
    if task is None:
        return JsonResponse({'error': 'Task was not found.'}, status=404 if request.user.is_authenticated else 401)
    history = task.change_history.select_related('actor')
    return JsonResponse({'history': [change.as_dict() for change in history]})


def validate_risk_issue_status(kind, status):
    allowed = {'risk': {'open', 'mitigated', 'closed'}, 'issue': {'open', 'in_progress', 'in progress', 'resolved'}}
    return status in allowed[kind]


@require_http_methods(['GET', 'POST'])
def risk_issue_list(request, workspace_id):
    membership_check = require_workspace_leader if request.method == 'POST' else require_workspace_member
    _, error = membership_check(request, workspace_id)
    if error:
        return error
    records = RiskIssue.objects.filter(workspace_id=workspace_id).select_related('owner', 'project')
    if request.method == 'GET':
        if request.GET.get('project_id'):
            records = records.filter(project_id=request.GET['project_id'])
        if request.GET.get('scope') == 'workspace':
            records = records.filter(project__isnull=True)
        if request.GET.get('kind'):
            records = records.filter(kind=request.GET['kind'])
        if request.GET.get('archived', 'false').lower() in {'true', '1'}:
            records = records.filter(archived_at__isnull=False)
        else:
            records = records.filter(archived_at__isnull=True)
        return JsonResponse({'records': [record.as_dict() for record in records]})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    kind = payload.get('kind')
    title = str(payload.get('title', '')).strip()
    severity = payload.get('severity', 'medium')
    status = payload.get('status', 'open')
    if kind not in dict(RiskIssue.KIND_CHOICES) or not title or len(title) > 200:
        return JsonResponse({'error': 'A valid kind and title are required.'}, status=400)
    if severity not in dict(RiskIssue.SEVERITY_CHOICES) or not validate_risk_issue_status(kind, status):
        return JsonResponse({'error': 'Invalid severity or status for this record type.'}, status=400)
    project = Project.objects.filter(id=payload.get('project_id'), workspace_id=workspace_id).first() if payload.get('project_id') else None
    if payload.get('project_id') and project is None:
        return JsonResponse({'error': 'Project was not found.'}, status=404)
    owner = User.objects.filter(id=payload.get('owner_id'), workspace_memberships__workspace_id=workspace_id).first() if payload.get('owner_id') else None
    if payload.get('owner_id') and owner is None:
        return JsonResponse({'error': 'Owner was not found in this workspace.'}, status=404)
    due_date, date_error = parse_iso_date(payload.get('due_date', payload.get('due')), 'Due date')
    if date_error:
        return JsonResponse({'error': date_error}, status=400)
    record = RiskIssue.objects.create(workspace_id=workspace_id, project=project, kind=kind, title=title, detail=str(payload.get('detail', '') or '').strip(), severity=severity, status=status, owner=owner, owner_name=str(payload.get('owner', '') or '').strip(), due_date=due_date, created_by=request.user)
    record_activity(workspace_id, request.user, f'{kind}_created', f'{request.user.get_full_name() or request.user.email} created {kind} {record.title}.')
    return JsonResponse({'record': record.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def risk_issue_detail(request, workspace_id, record_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    record = RiskIssue.objects.filter(id=record_id, workspace_id=workspace_id).first()
    if record is None:
        return JsonResponse({'error': 'Risk or issue was not found.'}, status=404)
    if membership.role not in {'owner', 'manager'} and record.owner_id != request.user.id:
        return JsonResponse({'error': 'Only the record owner or a workspace leader can update it.'}, status=403)
    if request.method == 'DELETE':
        if membership.role not in {'owner', 'manager'}:
            return JsonResponse({'error': 'Only workspace leaders can archive risks and issues.'}, status=403)
        record.archived_at = timezone.now()
        record.save(update_fields=['archived_at', 'updated_at'])
        return JsonResponse({'archived': record_id})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    allowed = {'title', 'detail', 'severity', 'status', 'owner_id', 'owner', 'due_date', 'due'}
    if set(payload) - allowed:
        return JsonResponse({'error': 'Unsupported risk or issue fields.'}, status=400)
    if membership.role not in {'owner', 'manager'} and {'owner_id', 'owner'} & set(payload):
        return JsonResponse({'error': 'Only workspace leaders can change record ownership.'}, status=403)
    if 'status' in payload and not validate_risk_issue_status(record.kind, payload['status']):
        return JsonResponse({'error': 'Invalid status for this record type.'}, status=400)
    if 'severity' in payload and payload['severity'] not in dict(RiskIssue.SEVERITY_CHOICES):
        return JsonResponse({'error': 'Invalid severity.'}, status=400)
    if 'title' in payload and (not str(payload['title']).strip() or len(str(payload['title']).strip()) > 200):
        return JsonResponse({'error': 'title must be between 1 and 200 characters.'}, status=400)
    for field in {'title', 'detail', 'severity', 'status'} & set(payload):
        setattr(record, field, str(payload[field] or '').strip())
    if 'owner_id' in payload:
        record.owner = User.objects.filter(id=payload['owner_id'], workspace_memberships__workspace_id=workspace_id).first() if payload['owner_id'] else None
        if payload['owner_id'] and record.owner is None:
            return JsonResponse({'error': 'Owner was not found in this workspace.'}, status=404)
    if 'owner' in payload:
        record.owner_name = str(payload['owner'] or '').strip()
    if 'due_date' in payload or 'due' in payload:
        record.due_date, date_error = parse_iso_date(payload.get('due_date', payload.get('due')), 'Due date')
        if date_error:
            return JsonResponse({'error': date_error}, status=400)
    record.save()
    return JsonResponse({'record': record.as_dict()})


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
        deliver_due_calendar_reminders(workspace_id)
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
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    event = CalendarEvent.objects.filter(id=event_id, workspace_id=workspace_id).first()
    if event is None:
        return JsonResponse({'error': 'Calendar event was not found.'}, status=404)
    if membership.role == 'member' and event.created_by_id != request.user.id:
        return JsonResponse({'error': 'Members can only manage their own calendar events.'}, status=403)
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
    if {'start_at', 'end_at', 'reminder_minutes'} & set(payload):
        event.reminder_sent_at = None
    event.start_at = start_at
    event.end_at = end_at
    event.save()
    record_activity(workspace_id, request.user, 'calendar_updated', f'{request.user.get_full_name() or request.user.email} updated calendar event {event.title}.')
    return JsonResponse({'event': event.as_dict()})


def ics_escape(value):
    return str(value).replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\n', '\\n')


@require_http_methods(['GET'])
def calendar_ics(request, workspace_id):
    token = request.GET.get('token', '')
    if token:
        workspace = Workspace.objects.filter(id=workspace_id, calendar_feed_token=token).first()
        if workspace is None or not token:
            return JsonResponse({'error': 'Invalid calendar feed link.'}, status=403)
    else:
        _, error = require_workspace_member(request, workspace_id)
        if error:
            return error
    events = CalendarEvent.objects.filter(workspace_id=workspace_id)
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorkSpace//Team Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:WorkSpace', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H']
    for event in events:
        start = event.start_at.astimezone(datetime_timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        end = event.end_at.astimezone(datetime_timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        lines.extend(['BEGIN:VEVENT', f'UID:workspace-event-{event.id}@workspace', f'DTSTAMP:{start}', f'DTSTART:{start}', f'DTEND:{end}', f'SUMMARY:{ics_escape(event.title)}', f'DESCRIPTION:{ics_escape(event.description)}', 'END:VEVENT'])
    lines.append('END:VCALENDAR')
    response = HttpResponse('\r\n'.join(lines) + '\r\n', content_type='text/calendar; charset=utf-8')
    if token:
        response['Content-Disposition'] = f'inline; filename="workspace-{workspace_id}.ics"'
    else:
        response['Content-Disposition'] = f'attachment; filename="workspace-{workspace_id}.ics"'
    return response


@require_http_methods(['GET', 'POST'])
def calendar_feed_token(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if request.method == 'POST':
        if membership.role not in {'owner', 'manager'}:
            return JsonResponse({'error': 'Owner or manager access is required to reset the subscribe link.'}, status=403)
        workspace.calendar_feed_token = secrets.token_urlsafe(32)
        workspace.save(update_fields=['calendar_feed_token'])
    elif not workspace.calendar_feed_token:
        workspace.calendar_feed_token = secrets.token_urlsafe(32)
        workspace.save(update_fields=['calendar_feed_token'])
    return JsonResponse({'token': workspace.calendar_feed_token})


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

    completed, completed_error = parse_bounded_text(payload.get('completed'), 'Completed update')
    next_steps, next_steps_error = parse_bounded_text(payload.get('next_steps'), 'Next steps')
    blockers, blockers_error = parse_bounded_text(payload.get('blockers'), 'Blockers')
    if completed_error or next_steps_error or blockers_error:
        return JsonResponse({'error': completed_error or next_steps_error or blockers_error}, status=400)

    check_in, created = CheckIn.objects.update_or_create(
        workspace_id=workspace_id,
        user=request.user,
        date=check_in_date,
        defaults={
            'completed': completed,
            'next_steps': next_steps,
            'blockers': blockers,
        },
    )
    actor_name = request.user.get_full_name() or request.user.email
    action = 'submitted' if created else 'updated'
    record_activity(workspace_id, request.user, 'check_in_submitted', f'{actor_name} {action} a daily check-in for {check_in.date.isoformat()}.')
    if check_in.blockers:
        leaders = Membership.objects.filter(workspace_id=workspace_id, role__in=['owner', 'manager']).select_related('user')
        for leader in leaders:
            if leader.user != request.user:
                create_notification(workspace_id, leader.user, 'check_in_blocker', f'{actor_name} reported a blocker', check_in.blockers[:120], target_type='check_in', target_id=check_in.id)
    return JsonResponse({'check_in': check_in.as_dict()}, status=201 if created else 200)


def accessible_chat_channels(workspace_id, user):
    return ChatChannel.objects.filter(workspace_id=workspace_id).filter(
        Q(is_private=False) | Q(created_by=user) | Q(members=user)
    ).distinct()


def ensure_workspace_channels(workspace_id, user):
    ChatChannel.objects.get_or_create(
        workspace_id=workspace_id,
        name='general',
        defaults={'description': 'Workspace-wide conversation', 'created_by': user},
    )
    existing_names = set(ChatChannel.objects.filter(workspace_id=workspace_id).values_list('name', flat=True))
    legacy_names = ChatMessage.objects.filter(workspace_id=workspace_id).values_list('channel', flat=True).distinct()
    for legacy_name in legacy_names:
        if legacy_name and legacy_name not in existing_names:
            ChatChannel.objects.get_or_create(workspace_id=workspace_id, name=legacy_name, defaults={'created_by': user})


def shared_chat_items(workspace_id, payload):
    document_ids = {int(value) for value in (payload.get('document_ids') or []) if str(value).isdigit()}
    file_ids = {int(value) for value in (payload.get('file_ids') or []) if str(value).isdigit()}
    documents = [document.as_dict() for document in WorkspaceDocument.objects.filter(workspace_id=workspace_id, id__in=document_ids)]
    files = [item.as_dict() for item in WorkspaceFile.objects.filter(workspace_id=workspace_id, id__in=file_ids)]
    return documents, files


def notify_mentions(workspace_id, actor, text, target_type, target_id, recipients=None):
    tokens = {token.lower() for token in re.findall(r'@([A-Za-z0-9_.-]+)', text)}
    if not tokens:
        return
    members = recipients or Membership.objects.filter(workspace_id=workspace_id).select_related('user')
    for member in members:
        aliases = {member.user.email.split('@')[0].lower(), member.user.first_name.lower(), member.user.last_name.lower()}
        if 'channel' in tokens or tokens.intersection(aliases):
            if member.user != actor:
                create_notification(workspace_id, member.user, 'mention', f'{actor.get_full_name() or actor.email} mentioned you', text[:120], target_type=target_type, target_id=target_id)


@require_http_methods(['GET', 'POST'])
def chat_channel_list(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    ensure_workspace_channels(workspace_id, request.user)
    if request.method == 'GET':
        channels = accessible_chat_channels(workspace_id, request.user)
        payload = []
        for channel in channels:
            item = channel.as_dict()
            item['message_count'] = ChatMessage.objects.filter(workspace_id=workspace_id, channel=channel.name).count()
            payload.append(item)
        return JsonResponse({'channels': payload})
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    name = slugify(str(data.get('name', '')).strip())
    description = str(data.get('description', '')).strip()
    is_private = bool(data.get('is_private', False))
    if not name or len(name) > 80:
        return JsonResponse({'error': 'Channel name must contain letters or numbers and be 80 characters or fewer.'}, status=400)
    if len(description) > 240:
        return JsonResponse({'error': 'Channel description must be 240 characters or fewer.'}, status=400)
    if ChatChannel.objects.filter(workspace_id=workspace_id, name=name).exists():
        return JsonResponse({'error': 'A channel with this name already exists.'}, status=409)
    channel = ChatChannel.objects.create(workspace_id=workspace_id, created_by=request.user, name=name, description=description, is_private=is_private)
    if is_private:
        requested_ids = {int(value) for value in data.get('member_ids', []) if str(value).isdigit()}
        valid_ids = set(Membership.objects.filter(workspace_id=workspace_id, user_id__in=requested_ids).values_list('user_id', flat=True))
        channel.members.add(request.user, *User.objects.filter(id__in=valid_ids))
    record_activity(workspace_id, request.user, 'chat_channel_created', f'{request.user.get_full_name() or request.user.email} created #{name}.')
    return JsonResponse({'channel': {**channel.as_dict(), 'message_count': 0}}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def chat_channel_detail(request, channel_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    channel = ChatChannel.objects.filter(id=channel_id, workspace_id__in=user_workspace_ids(request.user)).first()
    if channel is None:
        return JsonResponse({'error': 'Channel was not found.'}, status=404)
    membership, error = require_workspace_member(request, channel.workspace_id)
    if error:
        return error
    if membership.role not in {'owner', 'manager'} and channel.created_by_id != request.user.id:
        return JsonResponse({'error': 'Only the channel creator or a workspace leader can manage it.'}, status=403)
    if request.method == 'DELETE':
        if channel.name == 'general':
            return JsonResponse({'error': 'The general channel cannot be deleted.'}, status=400)
        ChatMessage.objects.filter(workspace_id=channel.workspace_id, channel=channel.name).delete()
        channel_id_value = channel.id
        channel.delete()
        return JsonResponse({'deleted': channel_id_value})
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if 'description' in data:
        description = str(data.get('description', '')).strip()
        if len(description) > 240:
            return JsonResponse({'error': 'Channel description must be 240 characters or fewer.'}, status=400)
        channel.description = description
    if 'member_ids' in data and channel.is_private:
        requested_ids = {int(value) for value in data.get('member_ids', []) if str(value).isdigit()}
        valid_users = User.objects.filter(id__in=requested_ids, workspace_memberships__workspace_id=channel.workspace_id)
        channel.members.set([request.user, *valid_users])
    channel.save()
    return JsonResponse({'channel': channel.as_dict()})


@require_http_methods(['GET', 'POST'])
def chat_message_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    ensure_workspace_channels(workspace_id, request.user)
    allowed_channels = set(accessible_chat_channels(workspace_id, request.user).values_list('name', flat=True))
    if request.method == 'GET':
        recent_messages = list(ChatMessage.objects.filter(workspace_id=workspace_id, channel__in=allowed_channels).select_related('author').order_by('-created_at')[:100])
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
    if channel not in allowed_channels:
        existing_channel = ChatChannel.objects.filter(workspace_id=workspace_id, name=channel).first()
        if existing_channel is not None:
            return JsonResponse({'error': 'Create or join this channel before posting to it.'}, status=403)
        # Preserve compatibility with older clients that created a public channel
        # by sending its first message. The current UI uses the dedicated endpoint.
        ChatChannel.objects.create(workspace_id=workspace_id, name=channel, created_by=request.user)
        allowed_channels.add(channel)
    parent = None
    if payload.get('parent_id'):
        parent = ChatMessage.objects.filter(id=payload['parent_id'], workspace_id=workspace_id, channel=channel, parent__isnull=True).first()
        if parent is None:
            return JsonResponse({'error': 'The parent message was not found in this channel.'}, status=404)
    shared_documents, shared_files = shared_chat_items(workspace_id, payload)
    message = ChatMessage.objects.create(workspace_id=workspace_id, author=request.user, channel=channel, parent=parent, message=message_text, shared_documents=shared_documents, shared_files=shared_files)
    record_activity(workspace_id, request.user, 'chat_message', f'{request.user.get_full_name() or request.user.email} posted in #{channel}.')
    notify_mentions(workspace_id, request.user, message_text, 'chat_channel', channel)
    return JsonResponse({'message': message.as_dict()}, status=201)


@require_http_methods(['GET', 'POST'])
def direct_conversation_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        conversations = DirectConversation.objects.filter(workspace_id=workspace_id, participants=request.user).prefetch_related('participants')
        conversations = sorted(conversations, key=lambda item: item.messages.order_by('-created_at').values_list('created_at', flat=True).first() or item.created_at, reverse=True)
        return JsonResponse({'conversations': [conversation.as_dict(request.user) for conversation in conversations]})
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    participant_ids = data.get('participant_ids') or [data.get('recipient_id')]
    participant_ids = {int(value) for value in participant_ids if value is not None and str(value).isdigit()}
    participant_ids.discard(request.user.id)
    valid_ids = set(Membership.objects.filter(workspace_id=workspace_id, user_id__in=participant_ids).values_list('user_id', flat=True))
    if not valid_ids or valid_ids != participant_ids:
        return JsonResponse({'error': 'Choose one or more members from this workspace.'}, status=400)
    all_ids = sorted(valid_ids | {request.user.id})
    key = ':'.join(str(value) for value in all_ids)
    conversation, created = DirectConversation.objects.get_or_create(workspace_id=workspace_id, conversation_key=key)
    if created:
        conversation.participants.add(*User.objects.filter(id__in=all_ids))
    return JsonResponse({'conversation': conversation.as_dict(request.user)}, status=201 if created else 200)


@require_http_methods(['GET', 'POST'])
def direct_message_list(request, conversation_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    conversation = DirectConversation.objects.filter(id=conversation_id, participants=request.user).select_related('workspace').first()
    if conversation is None:
        return JsonResponse({'error': 'Conversation was not found.'}, status=404)
    if request.method == 'GET':
        messages = conversation.messages.select_related('author')
        return JsonResponse({'messages': [message.as_dict() for message in messages]})
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    message_text = str(data.get('message', '')).strip()
    if not message_text:
        return JsonResponse({'error': 'Message is required.'}, status=400)
    if len(message_text) > 4000:
        return JsonResponse({'error': 'Message must be 4000 characters or fewer.'}, status=400)
    shared_documents, shared_files = shared_chat_items(conversation.workspace_id, data)
    message = DirectMessage.objects.create(conversation=conversation, author=request.user, message=message_text, shared_documents=shared_documents, shared_files=shared_files)
    sender = request.user.get_full_name() or request.user.email
    for participant in conversation.participants.exclude(id=request.user.id):
        create_notification(conversation.workspace_id, participant, 'direct_message', f'New message from {sender}', message_text[:120], target_type='direct_conversation', target_id=conversation.id)
    notify_mentions(conversation.workspace_id, request.user, message_text, 'direct_conversation', conversation.id, Membership.objects.filter(workspace_id=conversation.workspace_id, user__in=conversation.participants.all()).select_related('user'))
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
    assigned_to = None
    if payload.get('assigned_to'):
        assigned_to = User.objects.filter(id=payload['assigned_to'], workspace_memberships__workspace_id=workspace_id).first()
        if assigned_to is None:
            return JsonResponse({'error': 'Assignee was not found in this workspace.'}, status=404)
    follow_up = FollowUp.objects.create(workspace_id=workspace_id, task=task, created_by=request.user, assigned_to=assigned_to, note=note, due_date=due_date)
    record_activity(workspace_id, request.user, 'follow_up_created', f'{request.user.get_full_name() or request.user.email} created a follow-up.')
    if assigned_to and assigned_to != request.user:
        create_notification(workspace_id, assigned_to, 'follow_up_assigned', 'You were assigned a follow-up.', note, target_type='follow_up', target_id=follow_up.id)
    return JsonResponse({'follow_up': follow_up.as_dict()}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def follow_up_detail(request, follow_up_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    follow_up = FollowUp.objects.filter(id=follow_up_id, workspace_id__in=user_workspace_ids(request.user)).first()
    if follow_up is None:
        return JsonResponse({'error': 'Follow-up was not found.'}, status=404)
    membership, error = require_workspace_member(request, follow_up.workspace_id)
    if error:
        return error
    if request.method == 'DELETE':
        if membership.role not in {'owner', 'manager'} and follow_up.created_by_id != request.user.id:
            return JsonResponse({'error': 'Only the follow-up creator or a workspace leader can delete it.'}, status=403)
        record_activity(follow_up.workspace_id, request.user, 'follow_up_deleted', f'{request.user.get_full_name() or request.user.email} deleted a follow-up.')
        follow_up.delete()
        return JsonResponse({'deleted': follow_up_id})
    previous_status = follow_up.status
    previous_assignee = follow_up.assigned_to
    previous_task = follow_up.task
    previous_due_date = follow_up.due_date
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if set(payload) - {'status', 'note', 'due_date', 'assigned_to', 'task_id'}:
        return JsonResponse({'error': 'Only status, note, due date, assignee, and task can be updated.'}, status=400)
    permission_error = require_follow_up_editor(request, follow_up, set(payload))
    if permission_error:
        return permission_error
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
    if 'assigned_to' in payload:
        follow_up.assigned_to = User.objects.filter(id=payload['assigned_to'], workspace_memberships__workspace_id=follow_up.workspace_id).first() if payload['assigned_to'] else None
        if payload['assigned_to'] and follow_up.assigned_to is None:
            return JsonResponse({'error': 'Assignee was not found in this workspace.'}, status=404)
    if 'task_id' in payload:
        follow_up.task = Task.objects.filter(id=payload['task_id'], workspace_id=follow_up.workspace_id).first() if payload['task_id'] else None
        if payload['task_id'] and follow_up.task is None:
            return JsonResponse({'error': 'Task was not found in this workspace.'}, status=404)
    follow_up.save()
    actor_name = request.user.get_full_name() or request.user.email
    if previous_status != follow_up.status:
        record_activity(follow_up.workspace_id, request.user, 'follow_up_status', f'{actor_name} marked a follow-up {follow_up.status}.')
        if follow_up.status == 'completed' and follow_up.created_by != request.user:
            create_notification(follow_up.workspace_id, follow_up.created_by, 'follow_up_completed', 'Follow-up completed.', follow_up.note, target_type='follow_up', target_id=follow_up.id)
    if previous_assignee != follow_up.assigned_to:
        if follow_up.assigned_to:
            record_activity(follow_up.workspace_id, request.user, 'follow_up_assigned', f'{actor_name} assigned a follow-up to {follow_up.assigned_to.get_full_name() or follow_up.assigned_to.email}.')
        else:
            record_activity(follow_up.workspace_id, request.user, 'follow_up_assigned', f'{actor_name} unassigned a follow-up.')
        if follow_up.assigned_to and follow_up.assigned_to != request.user:
            create_notification(follow_up.workspace_id, follow_up.assigned_to, 'follow_up_assigned', 'You were assigned a follow-up.', follow_up.note, target_type='follow_up', target_id=follow_up.id)
    if previous_due_date != follow_up.due_date:
        if follow_up.due_date:
            record_activity(follow_up.workspace_id, request.user, 'follow_up_due_date', f'{actor_name} set the follow-up due date to {follow_up.due_date.isoformat()}.')
        else:
            record_activity(follow_up.workspace_id, request.user, 'follow_up_due_date', f'{actor_name} cleared the follow-up due date.')
    if previous_task != follow_up.task:
        record_activity(follow_up.workspace_id, request.user, 'follow_up_task', f'{actor_name} linked a task to a follow-up.' if follow_up.task else f'{actor_name} removed a task link from a follow-up.')
    return JsonResponse({'follow_up': follow_up.as_dict()})


BREAK_PRESET_MINUTES = {0, 30, 60}


def format_worked_duration(seconds):
    hours, remainder = divmod(max(0, seconds), 3600)
    return f'{hours}h {remainder // 60:02d}m'


@require_http_methods(['GET', 'POST'])
def work_shift_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error

    if request.method == 'GET':
        requested_date = request.GET.get('date')
        if requested_date:
            try:
                shift_date = date.fromisoformat(requested_date)
            except ValueError:
                return JsonResponse({'error': 'Date must use YYYY-MM-DD format.'}, status=400)
        else:
            shift_date = timezone.localdate()
        shifts = WorkShift.objects.filter(workspace_id=workspace_id).select_related('user').filter(
            Q(date=shift_date) | Q(user=request.user, ended_at__isnull=True)
        ).distinct()
        if request.GET.get('mine') == '1':
            shifts = shifts.filter(user=request.user)
        return JsonResponse({'work_shifts': [shift.as_dict() for shift in shifts]})

    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)

    action = str(payload.get('action') or '').strip()
    if action not in {'clock_in', 'clock_out', 'start_break', 'end_break'}:
        return JsonResponse({'error': 'Action must be clock_in, clock_out, start_break, or end_break.'}, status=400)

    note, note_error = parse_bounded_text(payload.get('note'), 'Note', max_length=255)
    if note_error:
        return JsonResponse({'error': note_error}, status=400)

    break_minutes = payload.get('minutes', 0)
    if action == 'start_break':
        if break_minutes in (None, ''):
            break_minutes = 0
        if break_minutes not in BREAK_PRESET_MINUTES:
            return JsonResponse({'error': 'Break length must be 30 or 60 minutes, or 0 for an open break.'}, status=400)

    now = timezone.now()
    actor_name = request.user.get_full_name() or request.user.email

    with transaction.atomic():
        open_shift = WorkShift.objects.select_for_update().filter(
            workspace_id=workspace_id, user=request.user, ended_at__isnull=True
        ).first()

        if action == 'clock_in':
            if open_shift is not None:
                return JsonResponse({'error': 'You are already clocked in.'}, status=409)
            shift = WorkShift.objects.create(
                workspace_id=workspace_id,
                user=request.user,
                date=timezone.localdate(),
                started_at=now,
                note=note,
            )
            record_activity(workspace_id, request.user, 'clocked_in', f'{actor_name} clocked in.')
            status_code = 201
        else:
            if open_shift is None:
                return JsonResponse({'error': 'You are not clocked in.'}, status=409)
            shift = open_shift
            if action == 'start_break':
                if shift.break_started_at is not None:
                    return JsonResponse({'error': 'You are already on a break.'}, status=409)
                shift.break_started_at = now
                shift.break_plan_minutes = break_minutes
                shift.save(update_fields=['break_started_at', 'break_plan_minutes', 'updated_at'])
            elif action == 'end_break':
                if shift.break_started_at is None:
                    return JsonResponse({'error': 'You are not on a break.'}, status=409)
                shift.break_seconds += int((now - shift.break_started_at).total_seconds())
                shift.break_started_at = None
                shift.break_plan_minutes = 0
                shift.save(update_fields=['break_seconds', 'break_started_at', 'break_plan_minutes', 'updated_at'])
            else:
                if shift.break_started_at is not None:
                    shift.break_seconds += int((now - shift.break_started_at).total_seconds())
                    shift.break_started_at = None
                shift.break_plan_minutes = 0
                shift.ended_at = now
                if note:
                    shift.note = note
                shift.save(update_fields=['break_seconds', 'break_started_at', 'break_plan_minutes', 'ended_at', 'note', 'updated_at'])
                record_activity(workspace_id, request.user, 'clocked_out', f'{actor_name} clocked out after {format_worked_duration(shift.worked_seconds(now))}.')
            status_code = 200

    return JsonResponse({'work_shift': shift.as_dict()}, status=status_code)
