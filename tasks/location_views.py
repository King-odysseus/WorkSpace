"""Where people work: office, home or somewhere else, day by day.

Everyone sees everyone's location, because planning around it is the point.
People only ever set their own. A day is worked out in this order:

1. approved leave for the whole day: On leave (no location);
2. a day the person set by hand;
3. the person's usual weekly pattern;
4. the workspace's optional office days, if it has any (an assumption, flagged);
5. otherwise nothing - never a guess about someone with no pattern or policy.
"""

from datetime import date, timedelta

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .leave_views import approved_leave_by_user
from .models import Membership, WorkLocation, WorkspaceSetting
from .request_views import json_body, parse_date
from .views import require_workspace_member

LOCATIONS = ('office', 'home', 'other')
MAX_RANGE_DAYS = 62


def clean_pattern(raw):
    if not isinstance(raw, dict):
        return None
    pattern = {}
    for key, value in raw.items():
        if str(key) not in {'0', '1', '2', '3', '4', '5', '6'} or value not in LOCATIONS:
            return None
        pattern[str(key)] = value
    return pattern


def resolve_day(day, member, overrides, office_days, leave_share):
    """(location, source, leave_share) for one person on one date."""
    if day.weekday() not in member.normalized_working_days():
        return None, 'off', 0
    if leave_share >= 1:
        return None, 'leave', leave_share
    if day in overrides:
        return overrides[day], 'set', leave_share
    pattern = member.default_locations or {}
    if str(day.weekday()) in pattern:
        return pattern[str(day.weekday())], 'pattern', leave_share
    if day.weekday() in office_days:
        return 'office', 'policy', leave_share
    return None, 'none', leave_share


def _week_start(day):
    return day - timedelta(days=day.weekday())


@require_http_methods(['GET', 'PUT'])
def work_locations(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'PUT':
        payload, error = json_body(request)
        if error:
            return error
        day, error = parse_date(payload.get('date'))
        if error:
            return error
        if day is None:
            return JsonResponse({'error': 'Choose a date.'}, status=400)
        location = payload.get('location')
        if location is None:
            WorkLocation.objects.filter(workspace_id=workspace_id, user=request.user, date=day).delete()
        elif location in LOCATIONS:
            WorkLocation.objects.update_or_create(workspace_id=workspace_id, user=request.user, date=day, defaults={'location': location})
        else:
            return JsonResponse({'error': 'Choose office, home or other.'}, status=400)
        return JsonResponse({'date': day.isoformat(), 'location': location})

    start, error = parse_date(request.GET.get('start'))
    if error:
        return error
    end, error = parse_date(request.GET.get('end'))
    if error:
        return error
    start = start or _week_start(timezone.localdate())
    end = end or start + timedelta(days=6)
    if end < start or (end - start).days + 1 > MAX_RANGE_DAYS:
        return JsonResponse({'error': f'Ask for at most {MAX_RANGE_DAYS} days at a time.'}, status=400)
    setting = WorkspaceSetting.objects.filter(workspace_id=workspace_id).first()
    office_days = [d for d in (setting.office_days if setting else []) if isinstance(d, int)]
    leave = approved_leave_by_user(workspace_id, start, end)
    set_days = {}
    for row in WorkLocation.objects.filter(workspace_id=workspace_id, date__gte=start, date__lte=end):
        set_days.setdefault(row.user_id, {})[row.date] = row.location
    members = []
    for person in Membership.objects.filter(workspace_id=workspace_id).select_related('user').order_by('user__first_name', 'user__email'):
        days = {}
        day = start
        while day <= end:
            location, source, share = resolve_day(day, person, set_days.get(person.user_id, {}), office_days, leave.get(person.user_id, {}).get(day, 0))
            days[day.isoformat()] = {'location': location, 'source': source, 'leave': share}
            day += timedelta(days=1)
        members.append({
            'id': person.user_id, 'name': person.user.get_full_name() or person.user.email,
            'working_days': person.normalized_working_days(), 'days': days,
        })
    return JsonResponse({
        'start': start.isoformat(), 'end': end.isoformat(), 'members': members, 'office_days': office_days,
        'can_set_policy': membership.role in ('owner', 'manager'),
        'my_pattern': membership.default_locations or {},
    })


@require_http_methods(['PUT'])
def work_location_pattern(request, workspace_id):
    """The signed-in person's usual weekly pattern. Their own only."""
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    payload, error = json_body(request)
    if error:
        return error
    pattern = clean_pattern(payload.get('pattern'))
    if pattern is None:
        return JsonResponse({'error': 'Give a weekday number from 0 to 6 and office, home or other for each day.'}, status=400)
    membership.default_locations = pattern
    membership.save(update_fields=['default_locations'])
    return JsonResponse({'my_pattern': pattern})


@require_http_methods(['PATCH'])
def office_days_policy(request, workspace_id):
    """The optional hybrid policy: weekdays people are expected in the office."""
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if membership.role not in ('owner', 'manager'):
        return JsonResponse({'error': 'Only owners and managers can set office days.'}, status=403)
    payload, error = json_body(request)
    if error:
        return error
    days = payload.get('office_days')
    if not isinstance(days, list) or any(isinstance(d, bool) or not isinstance(d, int) or not 0 <= d <= 6 for d in days) or len(set(days)) != len(days):
        return JsonResponse({'error': 'office_days must be a list of different weekday numbers from 0 to 6.'}, status=400)
    setting, _ = WorkspaceSetting.objects.get_or_create(workspace_id=workspace_id)
    setting.office_days = sorted(days)
    setting.save(update_fields=['office_days'])
    return JsonResponse({'office_days': setting.office_days})
