"""Shared reporting service.

Single source of truth for every workspace / operations / project report so the
frontend and any future consumer never re-derive the same numbers twice.

Calculations are documented here and exposed verbatim through the report API.
The module is intentionally free of HTTP concerns - it takes a workspace id and
options, and returns plain data. Views translate the result into JSON.

Drill-down filter vocabulary (keys are optional; only present keys constrain):

    status       one of Task.STATUS_CHOICES values
    priority     urgent | high | normal | low
    assignee_id  int (user id) or null meaning "unassigned"
    bucket       string
    project_id   int
    workstream   string
    phase        string
    due          'overdue' | 'today' | 'soon' | 'none'
    stale        true
    search       string

Any filter dict can be replayed through :func:`apply_task_filter` to obtain the
exact tasks behind a metric.
"""

from datetime import date, timedelta

from django.db.models import Count, Q
from django.utils import timezone

from .models import Project, Task, TaskSubtask, WorkspaceSetting

# --- Status taxonomy ---------------------------------------------------------
# Canonical definitions shared by reporting, integrity checks and automation.
COMPLETED_STATUS = 'done'
CANCELLED_STATUS = 'cancelled'
ON_HOLD_STATUS = 'on_hold'
BLOCKED_STATUS = 'blocked'

# Work still expected to progress. "on hold" is excluded because a paused task
# is neither overdue nor "due soon" - it has been deliberately parked.
PROGRESSABLE_STATUSES = {'todo', 'in_progress', 'blocked', 'review'}

# Active = not finished and not withdrawn. Includes "on hold".
ACTIVE_STATUSES = {'todo', 'in_progress', 'blocked', 'review', 'on_hold'}

# Applicable scope excludes cancelled tasks - they are withdrawn from delivery
# and would otherwise distort completion rate and average progress.
EXCLUDED_STATUSES = {CANCELLED_STATUS}

# Progress heuristic for tasks that carry no subtasks. Tasks with subtasks use
# the fraction of completed subtasks instead (see task_progress below).
PROGRESS_BY_STATUS = {
    'todo': 0,
    'blocked': 0,
    'on_hold': 0,
    'in_progress': 50,
    'review': 75,
    'done': 100,
    'cancelled': 0,
}

DEFAULT_DUE_SOON_DAYS = 7
DEFAULT_STALE_DAYS = 14

DEFAULT_KPI_TARGETS = {
    'completion_rate': 80,   # percent, at least
    'overdue': 0,            # count, at most
    'blocked': 0,            # count, at most
    'stale': 0,              # count, at most
}


def get_workspace_setting(workspace_id):
    """Return (due_soon_days, stale_days, kpi_targets) with defaults.

    Never creates a row on read; the settings endpoint persists explicit edits.
    """
    setting = WorkspaceSetting.objects.filter(workspace_id=workspace_id).first()
    if setting is None:
        return DEFAULT_DUE_SOON_DAYS, DEFAULT_STALE_DAYS, dict(DEFAULT_KPI_TARGETS)
    return setting.due_soon_days, setting.stale_days, (setting.kpi_targets or {})


def scope_queryset(workspace_id, scope, project_id=None):
    """Base Task queryset for a reporting scope.

    scope: 'all' (entire workspace), 'operations' (no project), 'project'.
    """
    queryset = Task.objects.filter(workspace_id=workspace_id)
    if scope == 'operations':
        queryset = queryset.filter(project_ref__isnull=True)
    elif scope == 'project':
        queryset = queryset.filter(project_ref_id=project_id)
    return queryset


def apply_task_filter(queryset, task_filter, today=None, due_soon_days=None, stale_days=None, now=None):
    """Apply a drill-down filter dict to a Task queryset."""
    task_filter = task_filter or {}
    today = today or timezone.localdate()
    due_soon_days = due_soon_days if due_soon_days is not None else DEFAULT_DUE_SOON_DAYS
    stale_days = stale_days if stale_days is not None else DEFAULT_STALE_DAYS
    now = now or timezone.now()

    if task_filter.get('status'):
        queryset = queryset.filter(status=task_filter['status'])
    if task_filter.get('priority'):
        queryset = queryset.filter(priority=task_filter['priority'])
    if 'assignee_id' in task_filter:
        assignee_id = task_filter['assignee_id']
        queryset = queryset.filter(assignee_id=assignee_id) if assignee_id is not None else queryset.filter(assignee__isnull=True)
    if task_filter.get('bucket'):
        queryset = queryset.filter(bucket=task_filter['bucket'])
    if task_filter.get('project_id') is not None:
        queryset = queryset.filter(project_ref_id=task_filter['project_id'])
    if task_filter.get('workstream'):
        value = task_filter['workstream']
        queryset = queryset.filter(Q(workstream=value) | Q(workstream_ref__name=value))
    if task_filter.get('phase'):
        value = task_filter['phase']
        queryset = queryset.filter(Q(phase=value) | Q(phase_ref__name=value))
    if task_filter.get('state'):
        queryset = queryset.filter(state=task_filter['state'])
    if task_filter.get('stale'):
        queryset = queryset.filter(updated_at__lt=now - timedelta(days=stale_days)).exclude(status=COMPLETED_STATUS)

    due = task_filter.get('due')
    if due == 'overdue':
        queryset = queryset.filter(due_date__lt=today, status__in=PROGRESSABLE_STATUSES)
    elif due == 'today':
        queryset = queryset.filter(due_date=today, status__in=PROGRESSABLE_STATUSES)
    elif due == 'soon':
        queryset = queryset.filter(due_date__gte=today, due_date__lte=today + timedelta(days=due_soon_days), status__in=PROGRESSABLE_STATUSES)
    elif due == 'none':
        queryset = queryset.filter(due_date__isnull=True)

    search = task_filter.get('search')
    if search:
        queryset = queryset.filter(
            Q(title__icontains=search)
            | Q(code__icontains=search)
            | Q(description__icontains=search)
            | Q(assignee_name__icontains=search)
            | Q(project__icontains=search)
            | Q(workstream__icontains=search)
            | Q(phase__icontains=search)
        )
    return queryset


def named_period_start(period, today):
    """Return the first date of a named reporting period ('week'/'month'/'quarter'/'year'), or None."""
    if period == 'week':
        return today - timedelta(days=6)
    if period == 'month':
        return today.replace(day=1)
    if period == 'quarter':
        quarter_start_month = (today.month - 1) // 3 * 3 + 1
        return today.replace(month=quarter_start_month, day=1)
    if period == 'year':
        return today.replace(month=1, day=1)
    return None


def apply_report_period(queryset, period, today=None, start=None, end=None):
    """Constrain a queryset to a reporting period.

    Periods are based on *delivery/completion* dates, never creation date:
      - a completed task belongs to the period its completed_at falls in;
      - an uncompleted task belongs to the period its due_date falls in.

    period: 'all' | 'week' (last 7 days) | 'month' (current calendar month) |
            'quarter' (current calendar quarter) | 'year' (current calendar year) |
            'custom' (explicit start/end).
    """
    today = today or timezone.localdate()
    if period in (None, 'all'):
        return queryset

    named_start = named_period_start(period, today)
    if named_start is not None:
        start, end = named_start, today
    elif period == 'custom':
        if start is None or end is None:
            return queryset
    else:
        return queryset

    start_date = start if isinstance(start, date) else date.fromisoformat(str(start))
    end_date = end if isinstance(end, date) else date.fromisoformat(str(end))
    return queryset.filter(
        Q(status=COMPLETED_STATUS, completed_at__date__gte=start_date, completed_at__date__lte=end_date)
        | Q(status__in=PROGRESSABLE_STATUSES, due_date__gte=start_date, due_date__lte=end_date)
    )


def task_progress(task, subtask_summary=None):
    """Progress (0-100) for a single task.

    Precedence (documented): a completed task is 100; otherwise an explicit
    ``progress_percent`` value (the canonical field maintained by the task
    service) wins; otherwise subtask completion ratio; otherwise the status
    mapping. ``subtask_summary`` is an optional {task_id: (total, completed)}
    map computed once for a whole batch to avoid an N+1 query.
    """
    if task.status == COMPLETED_STATUS:
        return 100
    if getattr(task, 'progress_percent', 0):
        return min(100, max(0, int(task.progress_percent)))
    if subtask_summary:
        total, completed = subtask_summary.get(task.id, (0, 0))
        if total:
            return min(100, round(completed * 100 / total))
    return PROGRESS_BY_STATUS.get(task.status, 0)


def _subtask_summary(tasks):
    summary = {}
    task_ids = [task.id for task in tasks]
    if not task_ids:
        return summary
    rows = TaskSubtask.objects.filter(task_id__in=task_ids).values('task_id').annotate(
        total=Count('id'), completed=Count('id', filter=Q(completed=True))
    )
    for row in rows:
        summary[row['task_id']] = (row['total'], row['completed'])
    return summary


def _overdue_filter():
    return {'due': 'overdue'}


def _unassigned_filter():
    return {'assignee_id': None}


def build_report(workspace_id, scope='all', project_id=None, period='all',
                 period_start=None, period_end=None, task_filter=None, today=None):
    """Build the full report for a scope and return plain data.

    The returned dict is the documented report shape. Every count carries a
    ``filter`` object replayable against the task list (drill-down).
    """
    today = today or timezone.localdate()
    due_soon_days, stale_days, kpi_targets = get_workspace_setting(workspace_id)
    stale_cutoff = timezone.now() - timedelta(days=stale_days)

    queryset = scope_queryset(workspace_id, scope, project_id)
    queryset = apply_report_period(queryset, period, today, period_start, period_end)
    if task_filter:
        queryset = apply_task_filter(queryset, task_filter, today=today, due_soon_days=due_soon_days, stale_days=stale_days, now=timezone.now())

    tasks = list(queryset.select_related('assignee', 'project_ref', 'workstream_ref', 'phase_ref'))
    subtasks = _subtask_summary(tasks)

    applicable = [t for t in tasks if t.status not in EXCLUDED_STATUSES and getattr(t, 'state', 'active') != 'archived']
    completed = [t for t in applicable if t.status == COMPLETED_STATUS]
    active = [t for t in applicable if t.status != COMPLETED_STATUS]
    progressable = [t for t in active if t.status in PROGRESSABLE_STATUSES]

    overdue = [t for t in progressable if t.due_date and t.due_date < today]
    due_soon = [t for t in progressable if t.due_date and today <= t.due_date <= today + timedelta(days=due_soon_days)]
    blocked = [t for t in applicable if t.status == BLOCKED_STATUS]
    on_hold = [t for t in applicable if t.status == ON_HOLD_STATUS]
    cancelled = [t for t in tasks if t.status == CANCELLED_STATUS]
    archived = [t for t in tasks if getattr(t, 'state', 'active') == 'archived']
    unassigned = [t for t in applicable if t.status != COMPLETED_STATUS and t.assignee_id is None]
    stale = [t for t in applicable if t.status != COMPLETED_STATUS and t.updated_at < stale_cutoff]

    applicable_count = len(applicable)
    total_count = len(tasks)
    completed_count = len(completed)
    progress_total = sum(task_progress(t, subtasks) for t in applicable)

    status_counts = {
        status: {'count': sum(1 for t in tasks if t.status == status), 'filter': {'status': status}}
        for status, _label in Task.STATUS_CHOICES
    }

    workload = _build_workload(applicable, today, stale_cutoff, due_soon_days)

    return {
        'scope': {'type': scope, 'project_id': project_id, 'label': _scope_label(scope, project_id)},
        'period': {
            'type': period,
            'start': period_start.isoformat() if period_start else None,
            'end': period_end.isoformat() if period_end else None,
            'today': today.isoformat(),
        },
        'settings': {'due_soon_days': due_soon_days, 'stale_days': stale_days},
        'generated_at': timezone.now().isoformat(),
        'totals': {
            'total_tasks': total_count,
            'applicable_tasks': applicable_count,
            'cancelled_tasks': len(cancelled),
            'archived_tasks': len(archived),
            'completed_tasks': completed_count,
            'completion_rate': round(completed_count * 100 / applicable_count) if applicable_count else 0,
            'average_progress': round(progress_total / applicable_count) if applicable_count else 0,
        },
        'status_counts': status_counts,
        'overdue': {'count': len(overdue), 'filter': _overdue_filter()},
        'due_soon': {'count': len(due_soon), 'threshold_days': due_soon_days, 'filter': {'due': 'soon'}},
        'blocked': {'count': len(blocked), 'filter': {'status': BLOCKED_STATUS}},
        'on_hold': {'count': len(on_hold), 'filter': {'status': ON_HOLD_STATUS}},
        'cancelled': {'count': len(cancelled), 'filter': {'status': CANCELLED_STATUS}},
        'unassigned': {'count': len(unassigned), 'filter': _unassigned_filter()},
        'stale': {'count': len(stale), 'threshold_days': stale_days, 'filter': {'stale': True}},
        'workload': workload,
        'progress_by_workstream': _progress_group(applicable, subtasks, _workstream_name, lambda t: {'workstream': _workstream_name(t)}, today),
        'progress_by_phase': _progress_group(applicable, subtasks, _phase_name, lambda t: {'phase': _phase_name(t)}, today),
        'progress_by_project': _progress_group(applicable, subtasks, lambda t: t.project_ref.name if t.project_ref_id else 'Operations', lambda t: {'project_id': t.project_ref_id}, today),
        'progress_by_priority': _progress_group(applicable, subtasks, lambda t: t.priority or 'normal', lambda t: {'priority': t.priority or 'normal'}, today),
        'kpis': compute_kpis(applicable_count, completed_count, len(overdue), len(blocked), len(stale), kpi_targets),
    }


def _scope_label(scope, project_id):
    if scope == 'operations':
        return 'Operations only'
    if scope == 'project':
        project = Project.objects.filter(id=project_id).first()
        return f'Project: {project.name}' if project else 'Project'
    return 'Entire workspace'


def _owner_name(task):
    if task.assignee_id:
        return task.assignee.get_full_name() or task.assignee.email
    return task.assignee_name or 'Unassigned'


def _workstream_name(task):
    return (task.workstream_ref.name if task.workstream_ref_id else task.workstream) or 'Unspecified'


def _phase_name(task):
    return (task.phase_ref.name if task.phase_ref_id else task.phase) or 'Unspecified'


def _build_workload(applicable, today, stale_cutoff, due_soon_days):
    owners = {}
    for task in applicable:
        owner_id = task.assignee_id
        bucket = owners.get(owner_id)
        if bucket is None:
            bucket = owners[owner_id] = {
                'user_id': owner_id,
                'user_name': _owner_name(task),
                'total': 0, 'open': 0, 'blocked': 0, 'on_hold': 0, 'completed': 0,
                'overdue': 0, 'due_soon': 0, 'stale': 0,
                'filter': {'assignee_id': owner_id},
            }
        bucket['total'] += 1
        if task.status == COMPLETED_STATUS:
            bucket['completed'] += 1
        else:
            bucket['open'] += 1
        if task.status == BLOCKED_STATUS:
            bucket['blocked'] += 1
        if task.status == ON_HOLD_STATUS:
            bucket['on_hold'] += 1
        if task.status in PROGRESSABLE_STATUSES and task.due_date and task.due_date < today:
            bucket['overdue'] += 1
        if task.status in PROGRESSABLE_STATUSES and task.due_date and today <= task.due_date <= today + timedelta(days=due_soon_days):
            bucket['due_soon'] += 1
        if task.status != COMPLETED_STATUS and task.updated_at < stale_cutoff:
            bucket['stale'] += 1
    return sorted(owners.values(), key=lambda item: (-(item['total'] or 0), item['user_name']))


def _progress_group(tasks, subtasks, key, filter_fn, today):
    groups = {}
    order = []
    for task in tasks:
        name = key(task)
        if name not in groups:
            groups[name] = {
                'name': name,
                'completed': 0, 'total': 0, 'progress_sum': 0, 'blocked': 0, 'overdue': 0,
                'filter': filter_fn(task),
            }
            order.append(name)
        group = groups[name]
        group['total'] += 1
        if task.status == COMPLETED_STATUS:
            group['completed'] += 1
        if task.status == BLOCKED_STATUS:
            group['blocked'] += 1
        group['progress_sum'] += task_progress(task, subtasks)
        if task.status in PROGRESSABLE_STATUSES and task.due_date and task.due_date < today:
            group['overdue'] += 1

    result = []
    for name in order:
        group = groups[name]
        total = group['total']
        result.append({
            'name': group['name'],
            'total': total,
            'completed': group['completed'],
            'completion_rate': round(group['completed'] * 100 / total) if total else 0,
            'average_progress': round(group['progress_sum'] / total) if total else 0,
            'blocked': group['blocked'],
            'overdue': group['overdue'],
            'filter': group['filter'],
        })
    return result


def compute_kpis(applicable, completed, overdue, blocked, stale, targets=None):
    """Compute KPI attainment with zero-target protection.

    Each KPI returns {target, actual, met, score}. ``score`` is a 0-100
    attainment figure that never divides by zero:
      - a zero target means "none/zero is required" (e.g. zero overdue);
      - met is True only when actual satisfies the target direction.
    """
    targets = targets or {}
    completion_rate = round(completed * 100 / applicable) if applicable else 0
    definitions = [
        ('completion_rate', completion_rate, targets.get('completion_rate', DEFAULT_KPI_TARGETS['completion_rate']), 'gte'),
        ('overdue', overdue, targets.get('overdue', DEFAULT_KPI_TARGETS['overdue']), 'lte'),
        ('blocked', blocked, targets.get('blocked', DEFAULT_KPI_TARGETS['blocked']), 'lte'),
        ('stale', stale, targets.get('stale', DEFAULT_KPI_TARGETS['stale']), 'lte'),
    ]
    result = {}
    for name, actual, target, direction in definitions:
        result[name] = _score_kpi(actual, target, direction)
    return result


def _score_kpi(actual, target, direction):
    if target is None or target == '':
        return {'target': None, 'actual': actual, 'met': None, 'score': None}
    try:
        target = float(target)
    except (TypeError, ValueError):
        return {'target': None, 'actual': actual, 'met': None, 'score': None}

    if direction == 'gte':
        met = actual >= target
        if target == 0:
            score = 100.0
        else:
            score = 100.0 if met else actual * 100.0 / target
    else:  # lte
        met = actual <= target
        if actual == 0:
            score = 100.0
        elif target == 0:
            score = 0.0
        else:
            score = 100.0 if met else target * 100.0 / actual
    return {'target': target, 'actual': actual, 'met': met, 'score': round(min(score, 100.0), 1)}


def project_health(workspace_id, project, today=None):
    """Compute a project's health (on-track / at-risk / off-track / completed).

    Canonical server-side equivalent of the frontend heuristic, driven by the
    configured thresholds. Returns health plus the contributing metrics.
    """
    today = today or timezone.localdate()
    due_soon_days, _stale_days, _kpi = get_workspace_setting(workspace_id)
    tasks = list(Task.objects.filter(workspace_id=workspace_id, project_ref_id=project.id))
    applicable = [t for t in tasks if t.status not in EXCLUDED_STATUSES and getattr(t, 'state', 'active') != 'archived']
    completed = [t for t in applicable if t.status == COMPLETED_STATUS]
    blocked = [t for t in applicable if t.status == BLOCKED_STATUS]
    on_hold = [t for t in applicable if t.status == ON_HOLD_STATUS]
    overdue = [t for t in applicable if t.status in PROGRESSABLE_STATUSES and t.due_date and t.due_date < today]
    completion_rate = round(len(completed) * 100 / len(applicable)) if applicable else 0
    project_overdue = project.due_date and project.due_date < today

    if project.status == 'completed':
        health = 'completed'
    elif project_overdue or overdue:
        health = 'off-track'
    elif blocked or on_hold or (project.due_date and today <= project.due_date <= today + timedelta(days=due_soon_days)):
        health = 'at-risk'
    else:
        health = 'on-track'

    return {
        'project_id': project.id,
        'name': project.name,
        'status': project.status,
        'due_date': project.due_date.isoformat() if project.due_date else None,
        'health': health,
        'metrics': {
            'total_tasks': len(tasks),
            'applicable_tasks': len(applicable),
            'completed_tasks': len(completed),
            'completion_rate': completion_rate,
            'blocked_tasks': len(blocked),
            'overdue_tasks': len(overdue),
            'on_hold_tasks': len(on_hold),
        },
    }
