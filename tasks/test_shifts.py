from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Membership, WorkShift, Workspace
from .shifts import FORGOTTEN_CLOCK_OUT_NOTE, close_abandoned_shifts


class ForgottenShiftTests(TestCase):
    """A clock-out nobody pressed must not be counted up to the present moment."""

    def setUp(self):
        self.workspace = Workspace.objects.create(name='Clock', slug='clock')
        self.owner = User.objects.create_user(username='clock-owner@example.com', email='clock-owner@example.com', password='secure-pass-123')
        self.member = User.objects.create_user(username='clock-member@example.com', email='clock-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member', daily_capacity_minutes=420)
        self.now = timezone.now()

    def _open_shift(self, started_hours_ago, **extra):
        return WorkShift.objects.create(
            workspace=self.workspace, user=self.member, date=(self.now - timedelta(hours=started_hours_ago)).date(),
            started_at=self.now - timedelta(hours=started_hours_ago), **extra,
        )

    def test_a_break_left_running_is_closed_at_the_break_not_counted_for_weeks(self):
        shift = self._open_shift(
            700, break_started_at=self.now - timedelta(hours=700) + timedelta(minutes=42), break_plan_minutes=30,
        )
        self.assertEqual(close_abandoned_shifts(self.workspace.id, now=self.now), 1)
        shift.refresh_from_db()
        self.assertIsNotNone(shift.ended_at)
        self.assertIsNone(shift.break_started_at)
        self.assertEqual(shift.break_seconds, 30 * 60)
        # Worked until the break began: 42 minutes, not 700 hours.
        self.assertEqual(shift.worked_seconds(self.now), 42 * 60)
        self.assertEqual(shift.note, FORGOTTEN_CLOCK_OUT_NOTE)

    def test_an_open_break_with_no_plan_adds_no_break_time(self):
        shift = self._open_shift(40, break_started_at=self.now - timedelta(hours=39))
        close_abandoned_shifts(self.workspace.id, now=self.now)
        shift.refresh_from_db()
        self.assertEqual(shift.break_seconds, 0)

    def test_a_forgotten_clock_out_ends_after_the_members_normal_day(self):
        shift = self._open_shift(30, break_seconds=1800)
        close_abandoned_shifts(self.workspace.id, now=self.now)
        shift.refresh_from_db()
        # 7 hours of capacity plus the half hour of break already logged.
        self.assertEqual(shift.ended_at - shift.started_at, timedelta(hours=7, minutes=30))
        self.assertEqual(shift.worked_seconds(self.now), 7 * 3600)

    def test_a_shift_still_inside_a_working_day_is_left_alone(self):
        shift = self._open_shift(9)
        self.assertEqual(close_abandoned_shifts(self.workspace.id, now=self.now), 0)
        shift.refresh_from_db()
        self.assertIsNone(shift.ended_at)

    def test_reports_and_clocking_in_clean_up_first(self):
        stale = self._open_shift(50, break_started_at=self.now - timedelta(hours=49), break_plan_minutes=0)
        self.client.force_login(self.owner)
        summary = self.client.get(reverse('report-summary', args=[self.workspace.id])).json()['summary']['time_clock']
        self.assertEqual(summary['open_shifts'], 0)
        self.assertLess(summary['break_seconds'], 3600)
        stale.refresh_from_db()
        self.assertIsNotNone(stale.ended_at)

        self._open_shift(30)
        self.client.force_login(self.member)
        started = self.client.post(
            reverse('work-shift-list', args=[self.workspace.id]),
            data='{"action": "clock_in"}', content_type='application/json',
        )
        self.assertEqual(started.status_code, 201)
