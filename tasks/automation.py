"""Scheduled automation: due-soon, overdue, blocked, stale and digest reminders.

Every generated notification is recorded in :class:`NotificationDelivery` under
a deterministic dedup key *before* it is sent, so repeated scheduled runs are
idempotent and never produce duplicates. The dedup key embeds the recipient id,
so a single event (e.g. a blocked task) can still notify several people once
each.
"""

import logging
from datetime import timedelta

from django.utils import timezone

from .models import Membership, NotificationDelivery, Task
from .reporting import (
    BLOCKED_STATUS,
    COMPLETED_STATUS,
    CANCELLED_STATUS,
    PROGRESSABLE_STATUSES,
    get_workspace_setting,
)
from .views import create_notification

logger = logging.getLogger(__name__)


def _leaders(workspace_id):
    return list(
        Membership.objects.filter(workspace_id=workspace_id, role__in=['owner', 'manager']).select_related('user')
    )


def deliver_once(workspace_id, recipient, kind, title, body, target_type='', target_id='', dedup_key=''):
    """Record + send a notification exactly once per (workspace, kind, dedup_key).

    Returns True when a new delivery was recorded (i.e. first time), False when
    it had already been delivered by a previous run.
    """
    _, created = NotificationDelivery.objects.get_or_create(
        workspace_id=workspace_id,
        kind=kind,
        dedup_key=dedup_key,
        defaults={
            'recipient_id': recipient.id,
            'target_type': target_type,
            'target_id': str(target_id) if target_id else '',
        },
    )
    if not created:
        return False
    create_notification(workspace_id, recipient, kind, title, body, target_type=target_type, target_id=str(target_id) if target_id else '')
    return True


def _deliver_task_reminder(workspace_id, task, kind, title_prefix, body_suffix, dedup_suffix):
    if task.assignee_id is None:
        return False
    title = f'{title_prefix}: {task.title}'
    body = task.description[:200] if task.description else body_suffix
    key = f'{kind}:{task.id}:{dedup_suffix}:{task.assignee_id}'
    return deliver_once(workspace_id, task.assignee, kind, title, body, target_type='task', target_id=task.id, dedup_key=key)


def _digest_body(scope_label, open_count, overdue_count, blocked_count, due_soon_count, stale_count):
    parts = [f'{open_count} open']
    flags = []
    if overdue_count:
        flags.append(f'{overdue_count} overdue')
    if blocked_count:
        flags.append(f'{blocked_count} blocked')
    if due_soon_count:
        flags.append(f'{due_soon_count} due soon')
    if stale_count:
        flags.append(f'{stale_count} stale')
    detail = (', '.join(flags) + '.') if flags else 'nothing needing attention.'
    return f'{scope_label}: {", ".join(parts)}, {detail}'


def run_workspace_automation(workspace_id):
    """Run all reminder/digest automation for one workspace.

    Returns a summary dict of how many deliveries were newly recorded.
    """
    due_soon_days, stale_days, _kpi = get_workspace_setting(workspace_id)
    today = timezone.localdate()
    now = timezone.now()
    stale_cutoff = now - timedelta(days=stale_days)

    tasks = list(Task.objects.filter(workspace_id=workspace_id).select_related('assignee', 'project_ref'))
    active = [t for t in tasks if t.status not in {COMPLETED_STATUS, CANCELLED_STATUS} and getattr(t, 'state', 'active') == 'active']
    progressable = [t for t in active if t.status in PROGRESSABLE_STATUSES]

    overdue = [t for t in progressable if t.due_date and t.due_date < today]
    due_soon = [t for t in progressable if t.due_date and today <= t.due_date <= today + timedelta(days=due_soon_days)]
    blocked = [t for t in active if t.status == BLOCKED_STATUS]
    stale = [t for t in active if t.updated_at < stale_cutoff]

    counts = {
        'due_soon': 0, 'overdue': 0, 'blocked': 0, 'stale': 0,
        'operations_digest': 0, 'project_digest': 0,
    }

    for task in due_soon:
        if _deliver_task_reminder(
            workspace_id, task, 'due_soon_reminder',
            'Due soon', f'Due {task.due_date.isoformat()}.',
            task.due_date.isoformat() if task.due_date else 'none',
        ):
            counts['due_soon'] += 1

    for task in overdue:
        if _deliver_task_reminder(
            workspace_id, task, 'overdue_reminder',
            'Overdue', f'Was due {task.due_date.isoformat()}.',
            task.due_date.isoformat() if task.due_date else 'none',
        ):
            counts['overdue'] += 1

    # Blocked alerts notify the owner and every workspace leader.
    leaders = _leaders(workspace_id)
    for task in blocked:
        recipients = [task.assignee] if task.assignee_id else []
        recipients += [m.user for m in leaders]
        seen = set()
        for recipient in recipients:
            if recipient.id in seen:
                continue
            seen.add(recipient.id)
            if deliver_once(
                workspace_id, recipient, 'blocked_alert',
                f'Blocked: {task.title}', 'This task is blocked and needs attention.',
                target_type='task', target_id=task.id, dedup_key=f'blocked:{task.id}:{recipient.id}',
            ):
                counts['blocked'] += 1

    for task in stale:
        if _deliver_task_reminder(
            workspace_id, task, 'stale_update_reminder',
            'Stale task', 'No update recorded recently.',
            task.updated_at.date().isoformat(),
        ):
            counts['stale'] += 1

    # Digests go to leaders only.
    digest_date = today.isoformat()
    for leader in leaders:
        leader_user = leader.user

        operations_tasks = [t for t in active if t.project_ref_id is None]
        if _deliver_digest(workspace_id, leader_user, 'operations', 'Operations', operations_tasks, digest_date, today, due_soon_days, stale_cutoff):
            counts['operations_digest'] += 1

        project_ids = {t.project_ref_id for t in active if t.project_ref_id}
        for project_id in project_ids:
            project_tasks = [t for t in active if t.project_ref_id == project_id]
            label = next((t.project_ref.name for t in active if t.project_ref_id == project_id), f'Project {project_id}')
            if _deliver_digest(workspace_id, leader_user, 'project', label, project_tasks, digest_date, today, due_soon_days, stale_cutoff, project_id):
                counts['project_digest'] += 1

    logger.info('Workspace %s automation: %s', workspace_id, counts)
    return counts


def _deliver_digest(workspace_id, leader, scope, label, tasks, digest_date, today, due_soon_days, stale_cutoff, project_id=None):
    open_count = len([t for t in tasks if t.status != COMPLETED_STATUS])
    overdue_count = len([t for t in tasks if t.status in PROGRESSABLE_STATUSES and t.due_date and t.due_date < today])
    blocked_count = len([t for t in tasks if t.status == BLOCKED_STATUS])
    due_soon_count = len([t for t in tasks if t.status in PROGRESSABLE_STATUSES and t.due_date and today <= t.due_date <= today + timedelta(days=due_soon_days)])
    stale_count = len([t for t in tasks if t.status != COMPLETED_STATUS and t.updated_at < stale_cutoff])

    body = _digest_body(label, open_count, overdue_count, blocked_count, due_soon_count, stale_count)
    target_type = 'project' if scope == 'project' else 'workspace'
    target_id = str(project_id) if project_id else ''
    dedup_key = f'digest:{scope}:{leader.id}:{digest_date}'
    return deliver_once(workspace_id, leader, 'workspace_digest', f'{label} digest', body, target_type=target_type, target_id=target_id, dedup_key=dedup_key)
