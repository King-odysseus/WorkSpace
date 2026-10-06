"""Time clock housekeeping.

A shift is open from clock-in until clock-out. When someone forgets to clock out
- or leaves a break running - the shift stays open, and every report that counts
an open shift counts it up to *now*: one forgotten break turned into 701 hours of
break time and a team total that read 744 hours. It also leaves the person
"already clocked in", so they cannot clock in the next morning.

A shift still open after ABANDONED_SHIFT_AFTER is therefore treated as forgotten
and closed on the next read, at the latest time the person can be shown to have
been working.
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import Membership, WorkShift

# Longer than any real working day with its breaks, short enough that a forgotten
# clock-out is cleaned up before it spoils the next day.
ABANDONED_SHIFT_AFTER = timedelta(hours=16)
FORGOTTEN_CLOCK_OUT_NOTE = 'Closed automatically: the clock-out was forgotten.'


def close_abandoned_shifts(workspace_id, user_id=None, now=None):
    """Close shifts that were left open too long. Returns how many were closed.

    The end time is the last moment the person is known to have been working:
    - on a break: when the break began, plus the break they planned (none for an
      open-ended break), because nothing says they came back;
    - otherwise: a normal day's hours from clock-in, plus the breaks they logged,
      from the member's own daily capacity.
    """
    now = now or timezone.now()
    stale = WorkShift.objects.filter(
        workspace_id=workspace_id, ended_at__isnull=True, started_at__lt=now - ABANDONED_SHIFT_AFTER,
    )
    if user_id is not None:
        stale = stale.filter(user_id=user_id)
    closed = 0
    for shift in list(stale):
        with transaction.atomic():
            fresh = WorkShift.objects.select_for_update().filter(pk=shift.pk, ended_at__isnull=True).first()
            if fresh is None:
                continue
            if fresh.break_started_at is not None:
                planned = timedelta(minutes=fresh.break_plan_minutes or 0)
                fresh.break_seconds += int(planned.total_seconds())
                end = fresh.break_started_at + planned
                fresh.break_started_at = None
                fresh.break_plan_minutes = 0
            else:
                capacity = (
                    Membership.objects.filter(workspace_id=workspace_id, user_id=fresh.user_id)
                    .values_list('daily_capacity_minutes', flat=True).first()
                ) or 480
                end = fresh.started_at + timedelta(minutes=capacity, seconds=fresh.break_seconds)
            # Never before the shift began, never in the future.
            fresh.ended_at = min(max(end, fresh.started_at + timedelta(seconds=1)), now)
            if not fresh.note:
                fresh.note = FORGOTTEN_CLOCK_OUT_NOTE
            fresh.save(update_fields=['ended_at', 'break_seconds', 'break_started_at', 'break_plan_minutes', 'note', 'updated_at'])
            closed += 1
    return closed
