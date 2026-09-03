"""Data-integrity checks.

Each check returns a structured result (key, label, severity, count, items and
an optional drill-down filter). Checks are read-only and never mutate data;
consumers surface the results to a leader so they can decide on remediation.

Severities: "error" = structurally invalid data, "warning" = advisory (review
whether the current shape is intended).

These checks target the current task model: a single owner (``assignee``), a
many-to-many ``supporters`` relation, a task ``code``, ``state``
(draft/active/archived), ``start_date``/``due_date``/``actual_completion_date``
and ``progress_percent``.
"""

from .models import Membership, Task
from .reporting import CANCELLED_STATUS, COMPLETED_STATUS

MAX_ITEMS = 50


def _item(task):
    return {
        'task_id': task.id,
        'title': task.title,
        'code': task.code,
        'status': task.status,
        'state': getattr(task, 'state', 'active'),
        'assignee_id': task.assignee_id,
        'supporter_ids': list(task.supporters.values_list('id', flat=True)) if task.id else [],
        'project_id': task.project_ref_id,
        'start_date': task.start_date.isoformat() if getattr(task, 'start_date', None) else None,
        'due_date': task.due_date.isoformat() if task.due_date else None,
        'completed_at': task.completed_at.isoformat() if task.completed_at else None,
        'progress_percent': getattr(task, 'progress_percent', 0),
    }


def _result(key, label, severity, items, task_filter=None, detail=''):
    items = items or []
    return {
        'key': key,
        'label': label,
        'severity': severity,
        'count': len(items),
        'detail': detail,
        'filter': task_filter,
        'items': [_item(task) for task in items[:MAX_ITEMS]],
    }


def _is_active(task):
    """Active = not finished, not withdrawn, and in the active state."""
    return getattr(task, 'state', 'active') == 'active' and task.status not in {COMPLETED_STATUS, CANCELLED_STATUS}


def check_duplicate_task_codes(tasks):
    """Non-empty task codes that appear on more than one task in the workspace."""
    codes = {}
    for task in tasks:
        if task.code:
            codes.setdefault(task.code.strip().lower(), []).append(task)
    duplicates = [task for group in codes.values() if len(group) > 1 for task in group]
    return _result(
        'duplicate_task_codes',
        'Duplicate task codes',
        'error',
        duplicates,
        detail='Each non-empty task code must be unique within the workspace (case-insensitive).',
    )


def check_active_tasks_without_owners(tasks):
    """Active tasks with no assignee (owner)."""
    active = [t for t in tasks if _is_active(t) and t.assignee_id is None]
    return _result(
        'active_tasks_without_owners',
        'Active tasks without owners',
        'error',
        active,
        task_filter={'assignee_id': None, 'state': 'active'},
        detail='Active work should have a single owner (assignee).',
    )


def check_multiple_active_owners(tasks):
    """Active tasks with a distinct owner and at least one supporter."""
    multiple = []
    for task in tasks:
        if not _is_active(task) or not task.assignee_id:
            continue
        supporter_ids = set(task.supporters.values_list('id', flat=True))
        supporter_ids.discard(task.assignee_id)
        if supporter_ids:
            multiple.append(task)
    return _result(
        'multiple_active_owners',
        'Multiple active owners',
        'warning',
        multiple,
        detail='An active task has both an assignee and a distinct supporter; confirm dual ownership/support is intended.',
    )


def check_invalid_date_ranges(tasks):
    """Tasks whose start/due/completion dates are internally inconsistent."""
    invalid = []
    for task in tasks:
        created_date = task.created_at.date() if task.created_at else None
        if task.due_date and created_date and task.due_date < created_date:
            invalid.append(task)
            continue
        if task.completed_at and task.created_at and task.completed_at < task.created_at:
            invalid.append(task)
            continue
        if getattr(task, 'start_date', None) and task.due_date and task.due_date < task.start_date:
            invalid.append(task)
            continue
        if getattr(task, 'actual_completion_date', None) and getattr(task, 'start_date', None) and task.actual_completion_date < task.start_date:
            invalid.append(task)
    return _result(
        'invalid_date_ranges',
        'Invalid date ranges',
        'error',
        invalid,
        detail='A start/due/completion date is ordered incorrectly (e.g. before creation or before start).',
    )


def check_completed_progress_inconsistencies(tasks):
    """Done tasks missing completion evidence, or non-done tasks with it."""
    inconsistent = []
    for task in tasks:
        progress = getattr(task, 'progress_percent', 0)
        if task.status == COMPLETED_STATUS:
            if task.completed_at is None or progress != 100:
                inconsistent.append(task)
        elif task.status != CANCELLED_STATUS:
            if task.completed_at is not None or progress == 100:
                inconsistent.append(task)
    return _result(
        'completed_progress_inconsistencies',
        'Completed/progress inconsistencies',
        'error',
        inconsistent,
        detail='A done task must be 100% and have a completion timestamp; a non-done task must not.',
    )


def check_orphan_project_relationships(tasks):
    """Tasks whose project reference belongs to a different workspace."""
    orphans = [t for t in tasks if t.project_ref_id and t.project_ref and t.project_ref.workspace_id != t.workspace_id]
    return _result(
        'orphan_project_relationships',
        'Orphan project relationships',
        'error',
        orphans,
        detail='A task references a project that belongs to another workspace.',
    )


def check_incorrect_supporter_owner_relationships(tasks, member_ids):
    """Supporters that are not workspace members, or that duplicate the owner."""
    incorrect = []
    for task in tasks:
        for supporter_id in task.supporters.values_list('id', flat=True):
            if supporter_id not in member_ids or supporter_id == task.assignee_id:
                incorrect.append(task)
                break
    return _result(
        'incorrect_supporter_owner_relationships',
        'Incorrect supporter/owner relationships',
        'error',
        incorrect,
        detail='A supporter must be a workspace member and must not be the same person as the assignee.',
    )


def run_integrity_checks(workspace_id):
    """Run every check for a workspace and return the ordered list of results."""
    tasks = list(
        Task.objects.filter(workspace_id=workspace_id)
        .select_related('assignee', 'project_ref')
        .prefetch_related('supporters')
    )
    member_ids = set(Membership.objects.filter(workspace_id=workspace_id).values_list('user_id', flat=True))
    return [
        check_duplicate_task_codes(tasks),
        check_active_tasks_without_owners(tasks),
        check_multiple_active_owners(tasks),
        check_invalid_date_ranges(tasks),
        check_completed_progress_inconsistencies(tasks),
        check_orphan_project_relationships(tasks),
        check_incorrect_supporter_owner_relationships(tasks, member_ids),
    ]
