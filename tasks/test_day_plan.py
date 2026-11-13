import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Membership, PersonalPlanner, PersonalTask, PlannerDayNote, Workspace


class DayPlanTests(TestCase):
    def setUp(self):
        self.ada = User.objects.create_user('ada@example.com', 'ada@example.com', 'password')
        self.bo = User.objects.create_user('bo@example.com', 'bo@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Plans', slug='plans')
        for user in (self.ada, self.bo):
            Membership.objects.create(workspace=self.workspace, user=user, role='member')
        self.url = reverse('personal-day-plan', args=[self.workspace.id])
        self.client.force_login(self.ada)

    def put(self, body, **extra):
        return self.client.put(self.url, data=json.dumps({'body': body, **extra}), content_type='application/json')

    def test_save_read_replace_and_delete(self):
        self.assertIsNone(self.client.get(self.url).json()['note'])
        self.assertEqual(self.put('9:00 Report (2h)\n11:00 Break').status_code, 200)
        self.assertIn('Break', self.client.get(self.url).json()['note']['body'])
        self.put('New plan')
        self.assertEqual(PlannerDayNote.objects.count(), 1)
        self.assertEqual(self.client.get(self.url).json()['note']['body'], 'New plan')
        self.client.delete(self.url)
        self.assertEqual(PlannerDayNote.objects.count(), 0)

    def test_the_read_carries_the_persons_working_hours(self):
        Membership.objects.filter(user=self.ada).update(daily_capacity_minutes=360)
        self.assertEqual(self.client.get(self.url).json()['daily_minutes'], 360)

    def test_each_day_has_its_own_note(self):
        self.put('Today', date='2026-01-05')
        self.put('Later', date='2026-01-06')
        self.assertEqual(self.client.get(self.url + '?date=2026-01-05').json()['note']['body'], 'Today')
        self.assertEqual(self.client.get(self.url + '?date=2026-01-06').json()['note']['body'], 'Later')

    def test_nobody_else_sees_or_deletes_it(self):
        self.put('Private plan')
        self.client.force_login(self.bo)
        self.assertIsNone(self.client.get(self.url).json()['note'])
        self.client.delete(self.url)
        self.assertEqual(PlannerDayNote.objects.count(), 1)

    def test_bad_input_and_outsiders_are_refused(self):
        self.assertEqual(self.put('').status_code, 400)
        self.assertEqual(self.put('x' * 6001).status_code, 400)
        self.assertEqual(self.put('ok', date='nope').status_code, 400)
        self.client.force_login(User.objects.create_user('out@example.com', 'out@example.com', 'password'))
        self.assertGreaterEqual(self.client.get(self.url).status_code, 400)

    def test_a_note_never_counts_as_planner_work(self):
        planner = PersonalPlanner.objects.create(workspace=self.workspace, owner=self.ada, name='My day')
        PersonalTask.objects.create(planner=planner, owner=self.ada, title='Real', due_date=timezone.localdate())
        self.put('A plan')
        self.assertEqual(PersonalTask.objects.count(), 1)
        self.assertEqual(self.client.get(reverse('personal-planner-list', args=[self.workspace.id])).json()['tasks'].__len__(), 1)


class DayPlanLeaveTests(TestCase):
    def test_the_read_says_how_much_of_the_day_is_leave(self):
        from datetime import timedelta
        from .models import LeaveRequest
        user = User.objects.create_user('lv@example.com', 'lv@example.com', 'password')
        workspace = Workspace.objects.create(name='Leave plans', slug='leave-plans')
        Membership.objects.create(workspace=workspace, user=user, role='member')
        today = timezone.localdate()
        monday = today - timedelta(days=today.weekday())
        LeaveRequest.objects.create(workspace=workspace, user=user, start_date=monday, end_date=monday + timedelta(days=4), status='approved')
        self.client.force_login(user)
        url = reverse('personal-day-plan', args=[workspace.id]) + f'?date={monday.isoformat()}'
        self.assertEqual(self.client.get(url).json()['leave_share'], 1.0)
        saturday = monday + timedelta(days=5)
        self.assertEqual(self.client.get(reverse('personal-day-plan', args=[workspace.id]) + f'?date={saturday.isoformat()}').json()['leave_share'], 0)


class DayPlanBlockNoteTests(DayPlanTests):
    def test_notes_are_kept_per_block_and_survive_a_new_plan(self):
        self.put('09:00-10:00 Report (1h)')
        response = self.put(None, notes={'09:00': 'Ask Sam for the figures', '10:00': ''}) if False else self.client.put(
            self.url, data=json.dumps({'notes': {'09:00': 'Ask Sam for the figures', '10:00': ''}}), content_type='application/json')
        self.assertEqual(response.json()['note']['notes'], {'09:00': 'Ask Sam for the figures'})
        self.assertEqual(response.json()['note']['body'], '09:00-10:00 Report (1h)')
        self.put('09:00-10:30 Report (1h 30m)')
        self.assertEqual(self.client.get(self.url).json()['note']['notes'], {'09:00': 'Ask Sam for the figures'})

    def test_bad_notes_are_refused_and_a_note_alone_needs_a_plan(self):
        self.assertEqual(self.client.put(self.url, data=json.dumps({'notes': {'09:00': 'x'}}), content_type='application/json').status_code, 400)
        self.put('09:00-10:00 Report')
        for bad in ('text', {'09:00': 'x' * 501}):
            self.assertEqual(self.client.put(self.url, data=json.dumps({'notes': bad}), content_type='application/json').status_code, 400)


class DayPlanDoneAndLayoutTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('dl@example.com', 'dl@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Done layout', slug='done-layout')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='member')
        self.url = reverse('personal-day-plan', args=[self.workspace.id])
        self.client.force_login(self.user)
        self.client.put(self.url, data=json.dumps({'body': '09:00-10:00 Report (1h)'}), content_type='application/json')

    def put(self, **data):
        return self.client.put(self.url, data=json.dumps(data), content_type='application/json')

    def test_blocks_can_be_ticked_done_and_moved_and_it_is_kept(self):
        response = self.put(done=['09:00'], layout={'09:00': [320, 140]})
        self.assertEqual(response.status_code, 200)
        note = self.client.get(self.url).json()['note']
        self.assertEqual((note['done'], note['layout'], note['body']), (['09:00'], {'09:00': [320, 140]}, '09:00-10:00 Report (1h)'))
        self.put(done=[])
        self.assertEqual(self.client.get(self.url).json()['note']['done'], [])
        self.assertEqual(self.client.get(self.url).json()['note']['layout'], {'09:00': [320, 140]})

    def test_bad_done_and_layout_are_refused(self):
        for data in ({'done': 'all'}, {'done': [1]}, {'layout': []}, {'layout': {'09:00': [1]}}, {'layout': {'09:00': [-1, 5]}}, {'layout': {'09:00': [10, 99999]}}, {'layout': {'09:00': [True, 5]}}):
            self.assertEqual(self.put(**data).status_code, 400, data)
