import json
from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .automation import run_workspace_automation
from .models import CheckIn, LeaveRequest, Membership, Task, Workspace, WorkShift, WorkspaceNotification


class TeamDayTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.com', 'owner@example.com', 'password', first_name='Olive')
        self.ada = User.objects.create_user('ada@example.com', 'ada@example.com', 'password', first_name='Ada')
        self.bo = User.objects.create_user('bo@example.com', 'bo@example.com', 'password', first_name='Bo')
        self.workspace = Workspace.objects.create(name='Daily', slug='daily')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.ada, role='member')
        Membership.objects.create(workspace=self.workspace, user=self.bo, role='member')
        self.today = timezone.localdate()
        while self.today.weekday() > 3:  # a Monday to Thursday, so it is a working day with a day after
            self.today -= timedelta(days=1)
        self.client.force_login(self.owner)

    def task(self, title, user=None, **fields):
        return Task.objects.create(workspace=self.workspace, title=title, assignee=user, **fields)

    def day(self, **params):
        query = '&'.join(f'{key}={value}' for key, value in {'date': self.today.isoformat(), **params}.items())
        return self.client.get(reverse('team-day', args=[self.workspace.id]) + '?' + query).json()

    def by_name(self, payload):
        return {member['name']: member for member in payload['members']}

    def test_only_owners_and_managers_can_see_it(self):
        self.client.force_login(self.ada)
        self.assertEqual(self.client.get(reverse('team-day', args=[self.workspace.id])).status_code, 403)
        self.assertEqual(self.client.get(reverse('team-week', args=[self.workspace.id])).status_code, 403)
        self.assertEqual(self.client.get(reverse('team-day-member', args=[self.workspace.id, self.bo.id])).status_code, 403)

    def test_planned_is_overdue_due_today_and_under_way_with_a_fallback_for_missing_estimates(self):
        self.task('Due today', self.ada, due_date=self.today, estimate_minutes=60)
        self.task('Late', self.ada, due_date=self.today - timedelta(days=2))
        self.task('Under way', self.ada, status='in_progress', estimate_minutes=30)
        self.task('Next week', self.ada, due_date=self.today + timedelta(days=7), estimate_minutes=500)
        ada = self.by_name(self.day())['Ada']
        self.assertEqual(ada['planned_count'], 3)
        self.assertEqual(ada['planned_minutes'], 60 + 180 + 30)
        self.assertEqual(ada['overdue_count'], 1)
        self.assertEqual(ada['missing_estimates'], 1)

    def test_done_today_counts_only_what_was_finished_today(self):
        now = timezone.now()
        finished = self.task('Finished', self.ada, status='done', estimate_minutes=45)
        Task.objects.filter(pk=finished.pk).update(completed_at=now)
        old = self.task('Old', self.ada, status='done', estimate_minutes=45)
        Task.objects.filter(pk=old.pk).update(completed_at=now - timedelta(days=3))
        payload = self.day(date=timezone.localdate().isoformat())
        ada = self.by_name(payload)['Ada']
        self.assertEqual((ada['done_count'], ada['done_minutes']), (1, 45))
        self.assertEqual(ada['last_done']['title'], 'Finished')
        self.assertEqual(payload['summary']['done_today'], 1)

    def test_capacity_loses_the_day_to_leave(self):
        LeaveRequest.objects.create(workspace=self.workspace, user=self.ada, start_date=self.today, end_date=self.today, status='approved')
        LeaveRequest.objects.create(workspace=self.workspace, user=self.bo, start_date=self.today, end_date=self.today, start_half=True, status='approved')
        payload = self.day()
        members = self.by_name(payload)
        self.assertEqual(members['Ada']['capacity_minutes'], 0)
        self.assertEqual(members['Bo']['capacity_minutes'], 240)
        self.assertEqual(payload['summary']['on_leave'], 1)

    def test_check_in_and_clock_in_show_and_an_opted_out_leader_is_not_expected(self):
        CheckIn.objects.create(workspace=self.workspace, user=self.ada, date=self.today, completed='Did it')
        WorkShift.objects.create(workspace=self.workspace, user=self.ada, date=self.today, started_at=timezone.now() - timedelta(hours=2))
        Membership.objects.filter(user=self.owner).update(skips_check_ins=True)
        payload = self.day()
        members = self.by_name(payload)
        self.assertTrue(members['Ada']['checked_in'])
        self.assertTrue(members['Ada']['clocked_in'])
        self.assertGreaterEqual(members['Ada']['logged_minutes'], 119)
        self.assertFalse(members['Olive']['expects_check_in'])
        self.assertEqual((payload['summary']['checked_in'], payload['summary']['expected_check_ins']), (1, 2))

    def test_unassigned_work_is_listed_and_unestimated_assigned_work_is_counted(self):
        self.task('Nobody owns this', None, due_date=self.today)
        self.task('No estimate', self.bo)
        payload = self.day()
        self.assertEqual([task['title'] for task in payload['unassigned']], ['Nobody owns this'])
        self.assertEqual(payload['summary']['missing_estimates'], 1)

    def test_a_task_shared_between_two_people_counts_for_both(self):
        shared = self.task('Shared', self.ada, due_date=self.today, estimate_minutes=60)
        from .models import TaskAssignee
        TaskAssignee.objects.create(task=shared, user=self.bo)
        members = self.by_name(self.day())
        self.assertEqual((members['Ada']['planned_count'], members['Bo']['planned_count']), (1, 1))

    def test_a_persons_day_in_full_with_four_weeks_of_finished_tasks(self):
        self.task('Blocked one', self.ada, status='blocked')
        self.task('Late one', self.ada, due_date=self.today - timedelta(days=1))
        done = self.task('Done one', self.ada, status='done')
        Task.objects.filter(pk=done.pk).update(completed_at=timezone.now())
        payload = self.client.get(reverse('team-day-member', args=[self.workspace.id, self.ada.id]) + f'?date={timezone.localdate().isoformat()}').json()
        self.assertEqual([t['title'] for t in payload['blocked']], ['Blocked one'])
        self.assertEqual([t['title'] for t in payload['overdue']], ['Late one'])
        self.assertEqual([t['title'] for t in payload['done']], ['Done one'])
        self.assertEqual(len(payload['weekly_done']), 4)
        self.assertEqual(payload['weekly_done'][-1], 1)

    def test_the_week_grid_has_each_days_tasks_against_its_capacity(self):
        monday = self.today - timedelta(days=self.today.weekday())
        self.task('Monday work', self.ada, due_date=monday, estimate_minutes=600)
        payload = self.client.get(reverse('team-week', args=[self.workspace.id]) + f'?start={monday.isoformat()}').json()
        ada = next(member for member in payload['members'] if member['name'] == 'Ada')
        cell = ada['days'][monday.isoformat()]
        self.assertEqual((cell['planned_minutes'], cell['capacity_minutes'], cell['task_count']), (600, 480, 1))
        self.assertEqual(cell['tasks'][0]['title'], 'Monday work')
        self.assertEqual(ada['days'][(monday + timedelta(days=5)).isoformat()]['capacity_minutes'], 0)


class DayDigestTests(TeamDayTests):
    def test_leaders_get_one_end_of_day_digest(self):
        done = self.task('Done one', self.ada, status='done')
        Task.objects.filter(pk=done.pk).update(completed_at=timezone.now())
        self.task('Still open', self.ada, status='in_progress')
        with mock.patch('tasks.automation.DAY_DIGEST_HOUR', timezone.localtime().hour):
            run_workspace_automation(self.workspace.id)
            run_workspace_automation(self.workspace.id)
        digests = WorkspaceNotification.objects.filter(kind='day_digest')
        self.assertEqual(digests.count(), 1)
        self.assertEqual(digests.first().recipient_id, self.owner.id)
        self.assertIn('1 done', digests.first().title)
        self.assertIn('1 carry over', digests.first().title)

    def test_no_digest_outside_the_hour(self):
        with mock.patch('tasks.automation.DAY_DIGEST_HOUR', (timezone.localtime().hour + 5) % 24):
            run_workspace_automation(self.workspace.id)
        self.assertFalse(WorkspaceNotification.objects.filter(kind='day_digest').exists())
