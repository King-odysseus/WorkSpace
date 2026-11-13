"""Leave and absence requests, and what approved leave does to capacity.

Who decides: anyone with the approve_leave permission may approve a member's
leave; a manager's own leave needs an owner; nobody approves their own, and an
owner's leave is recorded as approved straight away (there is nobody above them).

Who sees what: everyone in the workspace sees who is away and when (name, dates,
half days) so they can plan around it. The kind of leave and the note are only
for the person, and for people who can approve.
"""

from datetime import date, timedelta

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import LeaveRequest, Membership
from .request_views import NOTE_LIMIT, json_body, notify_people, parse_date, people_with
from .views import require_workspace_member

MAX_SPAN_DAYS = 120
MAX_PAST_DAYS = 90
MAX_AHEAD_DAYS = 400
VISIBLE_PAST_DAYS = 14


def can_decide(membership, leave_membership):
    """May this approver decide that member's leave?"""
    if not membership.has_permission('approve_leave') or membership.user_id == leave_membership.user_id:
        return False
    if leave_membership.role in ('manager', 'owner'):
        return membership.role == 'owner'
    return True


def approved_leave_by_user(workspace_id, start, end):
    """{user_id: {date: share off}} for approved leave touching [start, end]."""
    members = {m.user_id: m for m in Membership.objects.filter(workspace_id=workspace_id)}
    out = {}
    leave = LeaveRequest.objects.filter(workspace_id=workspace_id, status='approved', end_date__gte=start, start_date__lte=end)
    for item in leave:
        member = members.get(item.user_id)
        if member is None:
            continue
        days = item.day_fractions(member.normalized_working_days())
        for day, share in days.items():
            if start <= day <= end:
                person = out.setdefault(item.user_id, {})
                person[day] = min(1.0, person.get(day, 0) + share)
    return out


def _overlapping(item):
    """Other people already off, or waiting to be, on any of these dates."""
    others = LeaveRequest.objects.filter(
        workspace_id=item.workspace_id, status__in=('approved', 'pending'),
        start_date__lte=item.end_date, end_date__gte=item.start_date,
    ).exclude(user_id=item.user_id).select_related('user')
    return [{'user_name': o.user.get_full_name() or o.user.email, 'start_date': o.start_date.isoformat(), 'end_date': o.end_date.isoformat(), 'status': o.status} for o in others]


@require_http_methods(['GET', 'POST'])
def leave_list(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    today = timezone.localdate()
    if request.method == 'GET':
        base = LeaveRequest.objects.filter(workspace_id=workspace_id).select_related('user', 'reviewer')
        mine = [i.as_dict() for i in base.filter(user=request.user).order_by('-start_date')[:100]]
        team = [
            i.as_dict(detail=False)
            for i in base.filter(status='approved', end_date__gte=today - timedelta(days=VISIBLE_PAST_DAYS))
            .order_by('start_date')[:500]
        ]
        decidable = []
        recent = []
        if membership.has_permission('approve_leave'):
            members = {m.user_id: m for m in Membership.objects.filter(workspace_id=workspace_id)}
            # What was decided lately, for the people this approver is allowed to decide.
            since = timezone.now() - timedelta(days=60)
            for item in base.filter(status__in=('approved', 'declined'), reviewed_at__gte=since).exclude(user=request.user).order_by('-reviewed_at')[:60]:
                person = members.get(item.user_id)
                if person is not None and can_decide(membership, person):
                    recent.append(item.as_dict())
            for item in base.filter(status='pending').exclude(user=request.user).order_by('start_date')[:100]:
                person = members.get(item.user_id)
                if person is not None and can_decide(membership, person):
                    decidable.append({**item.as_dict(), 'overlapping': _overlapping(item)})
        return JsonResponse({
            'mine': mine, 'team': team, 'to_decide': decidable, 'recent': recent,
            'can_approve': membership.has_permission('approve_leave'), 'role': membership.role,
        })

    payload, error = json_body(request)
    if error:
        return error
    kind = payload.get('kind', 'annual')
    if kind not in ('annual', 'sick', 'other'):
        return JsonResponse({'error': 'Choose annual leave, sick leave or another absence.'}, status=400)
    start, error = parse_date(payload.get('start_date'))
    if error:
        return error
    end, error = parse_date(payload.get('end_date') or payload.get('start_date'))
    if error:
        return error
    if start is None or end is None:
        return JsonResponse({'error': 'Choose when the leave starts.'}, status=400)
    if end < start:
        return JsonResponse({'error': 'The end date cannot be before the start date.'}, status=400)
    if (end - start).days + 1 > MAX_SPAN_DAYS:
        return JsonResponse({'error': f'Leave can cover at most {MAX_SPAN_DAYS} days in one request.'}, status=400)
    if start < today - timedelta(days=MAX_PAST_DAYS) or start > today + timedelta(days=MAX_AHEAD_DAYS):
        return JsonResponse({'error': 'That start date is too far away.'}, status=400)
    start_half, end_half = bool(payload.get('start_half')), bool(payload.get('end_half'))
    note = str(payload.get('note', '')).strip()
    if len(note) > NOTE_LIMIT:
        return JsonResponse({'error': f'The note must be {NOTE_LIMIT} characters or fewer.'}, status=400)
    clash = LeaveRequest.objects.filter(
        workspace_id=workspace_id, user=request.user, status__in=('pending', 'approved'),
        start_date__lte=end, end_date__gte=start,
    ).exists()
    if clash:
        return JsonResponse({'error': 'You already have leave requested for some of those dates.'}, status=400)
    approved_at_once = membership.role == 'owner'
    item = LeaveRequest.objects.create(
        workspace_id=workspace_id, user=request.user, kind=kind, start_date=start, end_date=end,
        start_half=start_half, end_half=end_half, note=note,
        status='approved' if approved_at_once else 'pending',
        reviewed_at=timezone.now() if approved_at_once else None,
    )
    who = request.user.get_full_name() or request.user.email
    span = f'{start.isoformat()} to {end.isoformat()}' if end != start else start.isoformat()
    if approved_at_once:
        recipients = people_with(workspace_id, 'approve_leave', exclude=request.user)
        notify_people(workspace_id, recipients, 'leave', f'{who} will be away', span, 'leave', item.id)
    else:
        approvers = [
            m.user for m in Membership.objects.filter(workspace_id=workspace_id).select_related('user')
            if can_decide(m, membership)
        ]
        notify_people(workspace_id, approvers, 'leave', f'Leave request from {who}', span, 'leave', item.id)
    return JsonResponse({'leave': item.as_dict()}, status=201)


@require_http_methods(['PATCH'])
def leave_detail(request, workspace_id, leave_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    item = LeaveRequest.objects.filter(id=leave_id, workspace_id=workspace_id).select_related('user', 'reviewer').first()
    owner_membership = Membership.objects.filter(workspace_id=workspace_id, user_id=item.user_id).first() if item else None
    mine = item is not None and item.user_id == request.user.id
    if item is None or owner_membership is None or (not mine and not can_decide(membership, owner_membership)):
        return JsonResponse({'error': 'Leave request was not found.'}, status=404)
    payload, error = json_body(request)
    if error:
        return error
    decision = payload.get('decision')
    if decision == 'cancel':
        if not mine:
            return JsonResponse({'error': 'Only the person who asked can withdraw leave.'}, status=403)
        if item.status not in ('pending', 'approved') or item.end_date < timezone.localdate():
            return JsonResponse({'error': 'That leave can no longer be withdrawn.'}, status=409)
        was_approved = item.status == 'approved'
        item.status = 'cancelled'
        item.save(update_fields=['status'])
        if was_approved:
            who = request.user.get_full_name() or request.user.email
            notify_people(workspace_id, people_with(workspace_id, 'approve_leave', exclude=request.user), 'leave',
                          f'{who} withdrew approved leave', f'{item.start_date.isoformat()} to {item.end_date.isoformat()}', 'leave', item.id)
        return JsonResponse({'leave': item.as_dict()})
    if decision not in ('approved', 'declined'):
        return JsonResponse({'error': 'Choose approved, declined or cancel.'}, status=400)
    if mine:
        return JsonResponse({'error': 'You cannot decide your own leave.'}, status=403)
    if item.status != 'pending':
        return JsonResponse({'error': 'That leave has already been decided.'}, status=409)
    note = str(payload.get('note', '')).strip()
    if len(note) > NOTE_LIMIT:
        return JsonResponse({'error': f'The note must be {NOTE_LIMIT} characters or fewer.'}, status=400)
    item.status, item.review_note, item.reviewer, item.reviewed_at = decision, note, request.user, timezone.now()
    item.save(update_fields=['status', 'review_note', 'reviewer', 'reviewed_at'])
    span = f'{item.start_date.isoformat()} to {item.end_date.isoformat()}'
    notify_people(workspace_id, [item.user], 'leave', f'Your leave was {decision}', f'{span}. {note}'.strip(), 'leave', item.id)
    return JsonResponse({'leave': item.as_dict()})
