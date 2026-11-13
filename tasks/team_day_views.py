"""The Team page's daily picture: who is planned for what today, what has been done,
who has checked in and clocked in, and where the week is over- or under-booked.

Owners and managers only. These figures read every member's tasks, so a member
never receives them (the page for a member stays the overview it always was).

How the numbers are worked out:
- Planned today: open tasks assigned to the person that are overdue, due today, or
  in progress or review. A task with no estimate counts as three hours and is
  flagged, so a low number is never silently trusted.
- Capacity today: the person's daily hours if today is a working day, less any
  approved leave (half a day off halves it).
- Done today: tasks the person is assigned to that were finished today.
- Logged: time clocked in today, breaks taken off.
"""

from datetime import date, datetime, time, timedelta

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from .leave_views import approved_leave_by_user
from .location_views import resolve_day
from .models import CheckIn, Membership, Task, WorkLocation, WorkShift, WorkspaceSetting
from .request_views import parse_date
from .views import require_workspace_member

FALLBACK_MINUTES = 180
OPEN_EXCLUDED = ('done', 'cancelled')
WORKING_STATUSES = ('in_progress', 'review')
MAX_WEEK_TASKS_PER_CELL = 8
UNASSIGNED_LIMIT = 20


def _leader_only(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return None, error
    if membership.role not in ('owner', 'manager'):
        return None, JsonResponse({'error': 'Only owners and managers can see the daily team view.'}, status=403)
    return membership, None


def _day_bounds(day):
    start = timezone.make_aware(datetime.combine(day, time.min))
    return start, start + timedelta(days=1)


def _assignees(task):
    ids = {link.user_id for link in task.assignee_links.all()}
    if task.assignee_id:
        ids.add(task.assignee_id)
    return ids


def _minutes(task):
    return task.estimate_minutes if task.estimate_minutes else FALLBACK_MINUTES


def _name(user):
    return user.get_full_name() or user.email


def _office_days(workspace_id):
    setting = WorkspaceSetting.objects.filter(workspace_id=workspace_id).first()
    return [d for d in (setting.office_days if setting else []) if isinstance(d, int)]


def _capacity(member, day, leave_share):
    if day.weekday() not in member.normalized_working_days():
        return 0
    return round(member.daily_capacity_minutes * (1 - min(1.0, leave_share)))


def _open_tasks(workspace_id):
    return list(
        Task.objects.filter(workspace_id=workspace_id)
        .exclude(state='archived').exclude(status__in=OPEN_EXCLUDED)
        .prefetch_related('assignee_links')
    )


def build_day(workspace_id, day):
    """Everything the Today view and the end-of-day digest read, for one date."""
    members = list(Membership.objects.filter(workspace_id=workspace_id).select_related('user').order_by('user__first_name', 'user__email'))
    open_tasks = _open_tasks(workspace_id)
    start, end = _day_bounds(day)
    done_today = list(
        Task.objects.filter(workspace_id=workspace_id, status='done', completed_at__gte=start, completed_at__lt=end)
        .exclude(state='archived').prefetch_related('assignee_links')
    )
    shifts = list(WorkShift.objects.filter(workspace_id=workspace_id, date=day))
    open_shifts = {shift.user_id: shift for shift in WorkShift.objects.filter(workspace_id=workspace_id, ended_at__isnull=True)}
    checked_in = set(CheckIn.objects.filter(workspace_id=workspace_id, date=day).values_list('user_id', flat=True))
    leave = approved_leave_by_user(workspace_id, day, day)
    overrides = {row.user_id: {row.date: row.location} for row in WorkLocation.objects.filter(workspace_id=workspace_id, date=day)}
    office_days = _office_days(workspace_id)
    now = timezone.now()

    rows = []
    for member in members:
        uid = member.user_id
        mine_open = [task for task in open_tasks if uid in _assignees(task)]
        planned = [
            task for task in mine_open
            if (task.due_date and task.due_date <= day) or task.status in WORKING_STATUSES
        ]
        overdue = [task for task in mine_open if task.due_date and task.due_date < day]
        mine_done = [task for task in done_today if uid in _assignees(task)]
        share = leave.get(uid, {}).get(day, 0)
        location, source, _ = resolve_day(day, member, overrides.get(uid, {}), office_days, share)
        logged = sum(shift.worked_seconds(now) for shift in shifts if shift.user_id == uid) // 60
        last_done = max(mine_done, key=lambda task: task.completed_at, default=None)
        skips = member.skips_check_ins
        rows.append({
            'id': uid,
            'name': _name(member.user),
            'role': member.role,
            'planned_minutes': sum(_minutes(task) for task in planned),
            'planned_count': len(planned),
            'capacity_minutes': _capacity(member, day, share),
            'leave_share': share,
            'location': location,
            'location_source': source,
            'done_count': len(mine_done),
            'done_minutes': sum(task.estimate_minutes or 0 for task in mine_done),
            'logged_minutes': logged,
            'clocked_in': uid in open_shifts,
            'on_break': bool(open_shifts.get(uid) and open_shifts[uid].break_started_at),
            'checked_in': uid in checked_in,
            'expects_check_in': (not skips) or uid in checked_in,
            'open_count': len(mine_open),
            'blocked_count': sum(1 for task in mine_open if task.status == 'blocked'),
            'overdue_count': len(overdue),
            'missing_estimates': sum(1 for task in mine_open if not task.estimate_minutes),
            'last_done': {'title': last_done.title, 'at': last_done.completed_at.isoformat()} if last_done else None,
        })

    unassigned = sorted(
        (task for task in open_tasks if not _assignees(task)),
        key=lambda task: (task.due_date or date.max, task.id),
    )
    expecting = [row for row in rows if row['expects_check_in'] and row['leave_share'] < 1]
    summary = {
        'members': len(rows),
        'checked_in': sum(1 for row in expecting if row['checked_in']),
        'expected_check_ins': len(expecting),
        'clocked_in': sum(1 for row in rows if row['clocked_in']),
        'done_today': sum(row['done_count'] for row in rows),
        'blocked': sum(row['blocked_count'] for row in rows),
        'overdue': sum(row['overdue_count'] for row in rows),
        'on_leave': sum(1 for row in rows if row['leave_share'] >= 1),
        'at_home': sum(1 for row in rows if row['location'] == 'home'),
        'in_office': sum(1 for row in rows if row['location'] == 'office'),
        'planned_minutes': sum(row['planned_minutes'] for row in rows),
        'capacity_minutes': sum(row['capacity_minutes'] for row in rows),
        'unassigned': len(unassigned),
        'missing_estimates': sum(1 for task in open_tasks if not task.estimate_minutes and _assignees(task)),
    }
    return rows, summary, unassigned


@require_GET
def team_day(request, workspace_id):
    membership, error = _leader_only(request, workspace_id)
    if error:
        return error
    day, error = parse_date(request.GET.get('date'))
    if error:
        return error
    day = day or timezone.localdate()
    rows, summary, unassigned = build_day(workspace_id, day)
    return JsonResponse({
        'date': day.isoformat(), 'summary': summary, 'members': rows,
        'unassigned': [
            {'id': task.id, 'title': task.title, 'due_date': task.due_date.isoformat() if task.due_date else '', 'estimate_minutes': task.estimate_minutes}
            for task in unassigned[:UNASSIGNED_LIMIT]
        ],
    })


def _task_line(task):
    return {
        'id': task.id, 'title': task.title, 'status': task.status,
        'due_date': task.due_date.isoformat() if task.due_date else '',
        'estimate_minutes': task.estimate_minutes, 'progress_percent': task.progress_percent,
    }


@require_GET
def team_day_member(request, workspace_id, user_id):
    """One person's day in full: what is done, under way, blocked and late, and how
    many tasks they finished in each of the last four weeks."""
    membership, error = _leader_only(request, workspace_id)
    if error:
        return error
    person = Membership.objects.filter(workspace_id=workspace_id, user_id=user_id).select_related('user').first()
    if person is None:
        return JsonResponse({'error': 'That person is not in this workspace.'}, status=404)
    day, error = parse_date(request.GET.get('date'))
    if error:
        return error
    day = day or timezone.localdate()
    start, end = _day_bounds(day)
    open_tasks = [task for task in _open_tasks(workspace_id) if user_id in _assignees(task)]
    done = [
        task for task in Task.objects.filter(workspace_id=workspace_id, status='done', completed_at__gte=start, completed_at__lt=end).exclude(state='archived').prefetch_related('assignee_links')
        if user_id in _assignees(task)
    ]
    check_in = CheckIn.objects.filter(workspace_id=workspace_id, user_id=user_id, date=day).first()
    week_start = day - timedelta(days=day.weekday())
    weekly_done = []
    for weeks_back in (3, 2, 1, 0):
        first = week_start - timedelta(weeks=weeks_back)
        low, _ = _day_bounds(first)
        _, high = _day_bounds(first + timedelta(days=6))
        weekly_done.append(sum(
            1 for task in Task.objects.filter(workspace_id=workspace_id, status='done', completed_at__gte=low, completed_at__lt=high).prefetch_related('assignee_links')
            if user_id in _assignees(task)
        ))
    return JsonResponse({
        'date': day.isoformat(), 'user_id': user_id, 'name': _name(person.user),
        'done': [_task_line(task) for task in done],
        'in_progress': [_task_line(task) for task in open_tasks if task.status in WORKING_STATUSES],
        'blocked': [_task_line(task) for task in open_tasks if task.status == 'blocked'],
        'overdue': [_task_line(task) for task in open_tasks if task.due_date and task.due_date < day],
        'due_today': [_task_line(task) for task in open_tasks if task.due_date == day],
        'check_in': {'completed': check_in.completed, 'next_steps': check_in.next_steps, 'blockers': check_in.blockers} if check_in else None,
        'weekly_done': weekly_done,
    })


@require_GET
def team_week(request, workspace_id):
    """People by day: tasks due each day against that day's capacity, with leave and
    where each person works. Cells carry their tasks so a manager can move one."""
    membership, error = _leader_only(request, workspace_id)
    if error:
        return error
    first, error = parse_date(request.GET.get('start'))
    if error:
        return error
    today = timezone.localdate()
    first = first or today - timedelta(days=today.weekday())
    days = [first + timedelta(days=offset) for offset in range(7)]
    members = list(Membership.objects.filter(workspace_id=workspace_id).select_related('user').order_by('user__first_name', 'user__email'))
    open_tasks = _open_tasks(workspace_id)
    leave = approved_leave_by_user(workspace_id, days[0], days[-1])
    overrides = {}
    for row in WorkLocation.objects.filter(workspace_id=workspace_id, date__gte=days[0], date__lte=days[-1]):
        overrides.setdefault(row.user_id, {})[row.date] = row.location
    office_days = _office_days(workspace_id)
    rows = []
    for member in members:
        uid = member.user_id
        mine = [task for task in open_tasks if uid in _assignees(task) and task.due_date]
        cells = {}
        for day in days:
            share = leave.get(uid, {}).get(day, 0)
            location, source, _ = resolve_day(day, member, overrides.get(uid, {}), office_days, share)
            due = [task for task in mine if task.due_date == day]
            cells[day.isoformat()] = {
                'planned_minutes': sum(_minutes(task) for task in due),
                'capacity_minutes': _capacity(member, day, share),
                'leave_share': share, 'location': location, 'source': source,
                'task_count': len(due),
                'tasks': [{'id': task.id, 'title': task.title, 'minutes': _minutes(task), 'estimated': bool(task.estimate_minutes)} for task in due[:MAX_WEEK_TASKS_PER_CELL]],
            }
        rows.append({'id': uid, 'name': _name(member.user), 'days': cells})
    return JsonResponse({'start': days[0].isoformat(), 'end': days[-1].isoformat(), 'members': rows})
